// Appel de loyer côté application : test vers une adresse, envoi manuel,
// envoi automatique à l'ouverture (si personne n'a déployé la fonction
// planifiée, ou en plus d'elle : le journal des envois évite tout doublon).

import * as etat from './etat.js';
import * as api from './api.js';
import { preparerAppels, doitEnvoyer, moisVise, cleMois, APPEL_PAR_DEFAUT } from './appel-loyer.js';
import { aujourdhui, nomMois } from './format.js';

const DOCUMENT_JOURNAL = 'appels-loyer';

export const reglageAppel = () => ({ ...APPEL_PAR_DEFAUT, ...(etat.parametres().appelLoyer || {}) });

export async function lireJournalAppels() {
  return (await api.lireDocumentSysteme(DOCUMENT_JOURNAL)) || { envois: {} };
}

function donneesCourantes() {
  return {
    baux: etat.liste('baux'), locataires: etat.liste('locataires'), loyers: etat.liste('loyers'),
    biens: etat.liste('biens'), parametres: etat.parametres(),
  };
}

/** Les courriels qui partiraient pour un mois donné (aperçu, test, envoi). */
export function apercuAppels({ annee, mois } = moisVise(aujourdhui(), reglageAppel().cible)) {
  return preparerAppels({ ...donneesCourantes(), annee, mois });
}

/** Envoie un exemplaire de test (le premier appel préparé) à une adresse. */
export async function envoyerTest(adresse, { annee, mois } = moisVise(aujourdhui(), reglageAppel().cible)) {
  const { courriels } = apercuAppels({ annee, mois });
  if (!courriels.length) throw new Error(`Aucun appel à préparer pour ${nomMois(mois)} ${annee} (pas d’échéance non soldée, ou aucune adresse e-mail de colocataire).`);
  const modele = courriels[0];
  await api.envoyerCourriel({
    destinataires: [adresse],
    sujet: `[TEST] ${modele.sujet}`,
    html: `<p style="color:#7d1f1f"><em>Message de test — exemplaire préparé pour ${modele.nom}.</em></p>${modele.html}`,
  });
  return modele;
}

/**
 * Envoie l'appel du mois à tous les colocataires concernés et l'inscrit au
 * journal. `origine` : 'manuel', 'automatique'.
 */
export async function envoyerAppels({ annee, mois, origine = 'manuel', force = false } = {}) {
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel().cible);
  const journal = await lireJournalAppels();
  const cle = cleMois(vise.annee, vise.mois);
  if (journal.envois?.[cle] && !force) {
    throw new Error(`L’appel de ${nomMois(vise.mois)} ${vise.annee} a déjà été envoyé le ${journal.envois[cle].le?.slice(0, 10) || '?'}.`);
  }
  const { courriels, ecartes, reglage } = apercuAppels(vise);
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
      sujet: `Copie — appels de loyer ${nomMois(vise.mois)} ${vise.annee} envoyés`,
      html: `<p>${envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(vise.mois)} ${vise.annee} :</p><ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`
        + (ecartes.length ? `<p>Non envoyés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.</p>` : ''),
    });
  }
  journal.envois = { ...(journal.envois || {}), [cle]: { le: new Date().toISOString(), origine, nombre: envoyes, details, ecartes } };
  await api.ecrireDocumentSysteme(DOCUMENT_JOURNAL, journal);
  return { envoyes, ecartes, vise };
}

/** À l'ouverture de l'application (gérant) : envoi automatique si c'est le jour. */
export async function verifierAppelAutomatique() {
  const reglage = reglageAppel();
  if (!reglage.actif) return null;
  const journal = await lireJournalAppels();
  if (!doitEnvoyer(reglage, aujourdhui(), journal)) return null;
  return envoyerAppels({ origine: 'automatique (ouverture de l’application)' });
}
