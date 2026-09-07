// Appel de loyer planifié : chaque jour à 8 h 10 (heure de Paris), si c'est
// le jour réglé dans l'application et que le mois n'a pas encore été appelé,
// dépose un e-mail par colocataire dans la collection « mail » (envoyée par
// l'extension Trigger Email) et l'inscrit au journal systeme/appels-loyer.
// Le calcul et le texte sont ceux de l'application (lib/appel-loyer.js).

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { preparerAppels, doitEnvoyer, moisVise, cleMois, APPEL_PAR_DEFAUT, nomMois } from './lib/appel-loyer.js';

initializeApp();

const lireCollection = async (base, nom) => {
  const photo = await base.doc(`donnees/${nom}`).get();
  if (!photo.exists) return nom === 'parametres' ? {} : [];
  let contenu;
  try { contenu = JSON.parse(photo.data().json || 'null'); } catch { contenu = null; }
  if (nom === 'parametres') return contenu || {};
  return Array.isArray(contenu?.elements) ? contenu.elements : [];
};

/** Date du jour en heure de Paris (AAAA-MM-JJ). */
export const aujourdhuiParis = (instant = new Date()) => new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(instant);

/**
 * Cœur de la fonction, testable à part : renvoie un compte rendu.
 * `base` : Firestore (admin) ; `dateIso` : la date à considérer.
 */
export async function executerAppelLoyer(base, dateIso = aujourdhuiParis()) {
  const parametres = await lireCollection(base, 'parametres');
  const reglage = { ...APPEL_PAR_DEFAUT, ...(parametres.appelLoyer || {}) };
  const refJournal = base.doc('systeme/appels-loyer');
  const journal = (await refJournal.get()).data() || { envois: {} };
  if (!doitEnvoyer(reglage, dateIso, journal)) return { envoye: false, raison: reglage.actif ? 'pas le jour, ou mois déjà appelé' : 'désactivé' };

  const [baux, locataires, loyers, biens] = await Promise.all(['baux', 'locataires', 'loyers', 'biens'].map((n) => lireCollection(base, n)));
  const vise = moisVise(dateIso, reglage.cible);
  const { courriels, ecartes } = preparerAppels({ baux, locataires, loyers, biens, parametres, annee: vise.annee, mois: vise.mois });
  const details = [];
  for (const courriel of courriels) {
    // eslint-disable-next-line no-await-in-loop
    await base.collection('mail').add({ to: courriel.destinataires, message: { subject: courriel.sujet, html: courriel.html } });
    details.push(`${courriel.nom} (${courriel.destinataires.join(', ')})`);
  }
  const bailleurs = (parametres.bailleurs || []).map((b) => String(b?.email || '').trim()).filter(Boolean);
  if (courriels.length && reglage.copieBailleur && bailleurs.length) {
    await base.collection('mail').add({
      to: bailleurs,
      message: {
        subject: `Copie — appels de loyer ${nomMois(vise.mois)} ${vise.annee} envoyés`,
        html: `<p>${courriels.length} appel(s) de loyer envoyé(s) automatiquement pour ${nomMois(vise.mois)} ${vise.annee} :</p>`
          + `<ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`
          + (ecartes.length ? `<p>Non envoyés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.</p>` : ''),
      },
    });
  }
  await refJournal.set({
    envois: { ...(journal.envois || {}), [cleMois(vise.annee, vise.mois)]: {
      le: new Date().toISOString(), origine: 'automatique (fonction planifiée)', nombre: courriels.length, details, ecartes,
    } },
  }, { merge: true });
  return { envoye: true, vise, nombre: courriels.length, details, ecartes };
}

export const appelLoyer = onSchedule({
  schedule: '10 8 * * *',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async () => {
  const resultat = await executerAppelLoyer(getFirestore());
  console.log('Appel de loyer :', JSON.stringify(resultat));
});
