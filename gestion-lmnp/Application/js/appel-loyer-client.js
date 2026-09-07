// Appel de loyer côté application : test vers une adresse, envoi manuel,
// envoi automatique à l'ouverture (si personne n'a déployé la fonction
// planifiée, ou en plus d'elle : le journal des envois évite tout doublon).
// Depuis la v35, chaque logement a ses réglages et son journal.

import * as etat from './etat.js';
import * as api from './api.js';
import { preparerAppels, doitEnvoyer, moisVise, cleEnvoi, dejaEnvoye, reglageAppelDe, sansAppel } from './appel-loyer.js';
import { aujourdhui, nomMois } from './format.js';

const DOCUMENT_JOURNAL = 'appels-loyer';

/** Réglages effectifs d'un logement (à défaut, les réglages communs). */
export const reglageAppel = (bien = null) => reglageAppelDe(etat.parametres(), bien);

/** Les logements concernés par un appel de loyer (pas la courte durée). */
export const logementsAvecAppel = () => etat.liste('biens').filter((b) => !sansAppel(b));

export async function lireJournalAppels() {
  return (await api.lireDocumentSysteme(DOCUMENT_JOURNAL)) || { envois: {} };
}

function donneesCourantes() {
  return {
    baux: etat.liste('baux'), locataires: etat.liste('locataires'), loyers: etat.liste('loyers'),
    biens: etat.liste('biens'), parametres: etat.parametres(),
  };
}

const bienDe = (bienId) => etat.liste('biens').find((b) => b.id === bienId) || null;

/** Les courriels qui partiraient pour un logement et un mois donnés (aperçu, test, envoi). */
export function apercuAppels({ bienId, annee, mois } = {}) {
  const bien = bienDe(bienId);
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel(bien).cible);
  return preparerAppels({ ...donneesCourantes(), ...vise, bienId: bien?.id || '' });
}

/** Envoie un exemplaire de test (le premier appel préparé) à une adresse. */
export async function envoyerTest(adresse, { bienId, annee, mois } = {}) {
  const { courriels, logement } = apercuAppels({ bienId, annee, mois });
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel(bienDe(bienId)).cible);
  if (!courriels.length) throw new Error(`Aucun appel à préparer pour ${nomMois(vise.mois)} ${vise.annee}${logement ? ` (${logement})` : ''} : pas d’échéance non soldée, ou aucune adresse e-mail de colocataire.`);
  const modele = courriels[0];
  await api.envoyerCourriel({
    destinataires: [adresse],
    sujet: `[TEST] ${modele.sujet}`,
    html: `<p style="color:#7d1f1f"><em>Message de test — exemplaire préparé pour ${modele.nom}${logement ? ` (${logement})` : ''}.</em></p>${modele.html}`,
  });
  return modele;
}

/**
 * Envoie l'appel du mois d'un logement à tous ses colocataires concernés et
 * l'inscrit au journal. `origine` : 'manuel', 'automatique'.
 */
export async function envoyerAppels({ bienId, annee, mois, origine = 'manuel', force = false } = {}) {
  const bien = bienDe(bienId);
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel(bien).cible);
  const journal = await lireJournalAppels();
  const deja = dejaEnvoye(journal, bien?.id || '', vise.annee, vise.mois);
  if (deja && !force) {
    throw new Error(`L’appel de ${nomMois(vise.mois)} ${vise.annee}${bien ? ` pour ${bien.nom}` : ''} a déjà été envoyé le ${deja.le?.slice(0, 10) || '?'}.`);
  }
  const { courriels, ecartes, reglage, logement } = apercuAppels({ bienId: bien?.id, ...vise });
  const bailleurs = (etat.parametres().bailleurs || []).map((b) => String(b?.email || '').trim()).filter(Boolean);
  let envoyes = 0;
  const details = [];
  for (const courriel of courriels) {
    /* eslint-disable no-await-in-loop */
    await api.envoyerCourriel({ destinataires: courriel.destinataires, sujet: courriel.sujet, html: courriel.html });
    envoyes += 1;
    details.push(`${courriel.nom} (${courriel.destinataires.join(', ')})`);
  }
  if (envoyes && reglage.copieBailleur && bailleurs.length) {
    await api.envoyerCourriel({
      destinataires: bailleurs,
      sujet: `Copie — appels de loyer ${nomMois(vise.mois)} ${vise.annee}${logement ? ` — ${logement}` : ''} envoyés`,
      html: `<p>${envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(vise.mois)} ${vise.annee}${logement ? ` (${logement})` : ''} :</p><ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`
        + (ecartes.length ? `<p>Non envoyés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.</p>` : ''),
    });
  }
  journal.envois = {
    ...(journal.envois || {}),
    [cleEnvoi(bien?.id || '', vise.annee, vise.mois)]: {
      le: new Date().toISOString(), origine, nombre: envoyes, details, ecartes, bienId: bien?.id || '', logement: logement || '',
    },
  };
  await api.ecrireDocumentSysteme(DOCUMENT_JOURNAL, journal);
  return { envoyes, ecartes, vise, logement: logement || '' };
}

/**
 * À l'ouverture de l'application (gérant) : pour chaque logement dont l'envoi
 * automatique est actif et dont c'est le jour, envoi de l'appel du mois.
 * Renvoie un compte rendu par logement envoyé.
 */
export async function verifierAppelAutomatique() {
  const candidats = logementsAvecAppel().filter((b) => reglageAppel(b).actif);
  if (!candidats.length) return [];
  const journal = await lireJournalAppels();
  const resultats = [];
  for (const bien of candidats) {
    if (!doitEnvoyer(reglageAppel(bien), aujourdhui(), journal, bien.id)) continue;
    // eslint-disable-next-line no-await-in-loop
    resultats.push(await envoyerAppels({ bienId: bien.id, origine: 'automatique (ouverture de l’application)' }));
  }
  return resultats;
}
