// Fonctions du projet : appel de loyer planifié et relais de fichiers.
//
// Appel de loyer planifié : chaque jour à 8 h 10 (heure de Paris), si c'est
// le jour réglé dans l'application et que le mois n'a pas encore été appelé,
// dépose un e-mail par colocataire dans la collection « mail » (expédiée par
// la fonction expedierCourriel, courriel.js) et l'inscrit au journal systeme/appels-loyer,
// logement par logement (chacun a ses réglages).
// Le calcul et le texte sont ceux de l'application (lib/appel-loyer.js).
// Codebase « appel-loyer », indépendant de toute autre fonction du projet
// (par exemple une fonction d'envoi de courriels déployée séparément) :
// déployer ce dossier ne modifie ni ne supprime les autres fonctions.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { preparerAppels, doitEnvoyer, moisVise, cleEnvoi, reglageAppelDe, sansAppel, nomMois } from './lib/appel-loyer.js';

initializeApp();

// Relais de fichiers (/api/fichiers) : voir relais-fichiers.js.
export { fichiers } from './relais-fichiers.js';
// Expédition des e-mails de la collection « mail » (v42) : voir courriel.js.
export { expedierCourriel, expedier, aReprendre } from './courriel.js';

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
 * Chaque logement a ses réglages (jour, textes, IBAN) et son journal : un
 * logement de courte durée (Airbnb…) n'a pas d'appel de loyer.
 */
export async function executerAppelLoyer(base, dateIso = aujourdhuiParis()) {
  const [parametres, biens] = await Promise.all([lireCollection(base, 'parametres'), lireCollection(base, 'biens')]);
  const refJournal = base.doc('systeme/appels-loyer');
  const journal = (await refJournal.get()).data() || { envois: {} };
  const candidats = biens.filter((bien) => !sansAppel(bien) && doitEnvoyer(reglageAppelDe(parametres, bien), dateIso, journal, bien.id));
  if (!candidats.length) {
    const actifs = biens.filter((bien) => !sansAppel(bien) && reglageAppelDe(parametres, bien).actif).length;
    return { envoye: false, raison: actifs ? 'pas le jour, ou mois déjà appelé' : 'désactivé' };
  }

  const [baux, locataires, loyers] = await Promise.all(['baux', 'locataires', 'loyers'].map((n) => lireCollection(base, n)));
  const bailleurs = (parametres.bailleurs || []).map((b) => String(b?.email || '').trim()).filter(Boolean);
  const logements = [];
  let nombre = 0;
  const envois = { ...(journal.envois || {}) };
  for (const bien of candidats) {
    const reglage = reglageAppelDe(parametres, bien);
    const vise = moisVise(dateIso, reglage.cible);
    // eslint-disable-next-line no-await-in-loop
    const { courriels, ecartes } = preparerAppels({ baux, locataires, loyers, biens, parametres, annee: vise.annee, mois: vise.mois, bienId: bien.id });
    const details = [];
    for (const courriel of courriels) {
      // eslint-disable-next-line no-await-in-loop
      await base.collection('mail').add({ to: courriel.destinataires, type: 'appels', creeLe: new Date().toISOString(), message: { subject: courriel.sujet, html: courriel.html } });
      details.push(`${courriel.nom} (${courriel.destinataires.join(', ')})`);
      // L'échéance appelée s'affiche aussi sur l'espace du colocataire (accueil).
      const email = String(locataires.find((l) => l.id === courriel.locataireId)?.email || '').trim().toLowerCase();
      if (email) {
        // eslint-disable-next-line no-await-in-loop
        await base.doc(`portail/${email}`).set({ email, echeance: {
          annee: vise.annee, mois: vise.mois, montant: courriel.montantDu, dateLimite: courriel.dateLimite,
          logement: bien.nom, libelle: `Loyer ${nomMois(vise.mois)} ${courriel.nom}`, appeleLe: dateIso,
        } }, { merge: true }).catch((erreur) => console.warn('Échéance sur l’espace :', email, erreur.message));
      }
    }
    if (courriels.length && reglage.copieBailleur && bailleurs.length) {
      // eslint-disable-next-line no-await-in-loop
      await base.collection('mail').add({
        to: bailleurs,
        type: 'appels-recap',
        creeLe: new Date().toISOString(),
        message: {
          subject: `Copie — appels de loyer ${nomMois(vise.mois)} ${vise.annee} — ${bien.nom} envoyés`,
          html: `<p>${courriels.length} appel(s) de loyer envoyé(s) automatiquement pour ${nomMois(vise.mois)} ${vise.annee} (${bien.nom}) :</p>`
            + `<ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`
            + (ecartes.length ? `<p>Non envoyés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.</p>` : ''),
        },
      });
    }
    envois[cleEnvoi(bien.id, vise.annee, vise.mois)] = {
      le: new Date().toISOString(), origine: 'automatique (fonction planifiée)', nombre: courriels.length, details, ecartes,
      bienId: bien.id, logement: bien.nom,
    };
    nombre += courriels.length;
    logements.push({ bienId: bien.id, logement: bien.nom, vise, nombre: courriels.length, details, ecartes });
  }
  await refJournal.set({ envois }, { merge: true });
  return { envoye: true, nombre, vise: logements[0].vise, logements };
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
