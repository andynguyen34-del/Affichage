// Appel de loyer côté application : test vers une adresse, envoi manuel,
// envoi automatique à l'ouverture (si personne n'a déployé la fonction
// planifiée, ou en plus d'elle : le journal des envois évite tout doublon).
// Depuis la v35, chaque logement a ses réglages et son journal.

import * as etat from './etat.js';
import * as api from './api.js';
import { preparerAppels, composerAppel, noterAppel, doitEnvoyer, moisVise, cleEnvoi, dejaEnvoye, reglageAppelDe, sansAppel } from './appel-loyer.js';
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
export function apercuAppels({ bienId, annee, mois, journal = null, inclureAppeles = false } = {}) {
  const bien = bienDe(bienId);
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel(bien).cible);
  return preparerAppels({ ...donneesCourantes(), ...vise, bienId: bien?.id || '', journal, inclureAppeles, dateJour: aujourdhui() });
}

/** L'échéance appelée s'affiche sur l'accueil de l'espace du colocataire. */
async function publierEcheanceSurEspace(courriel, logement) {
  const email = String(etat.liste('locataires').find((l) => l.id === courriel.locataireId)?.email || '').trim().toLowerCase();
  if (!email) return;
  try {
    await api.completerPortail(email, { echeance: {
      annee: courriel.annee, mois: courriel.mois, montant: courriel.montantDu, dateLimite: courriel.dateLimite,
      logement: logement || '', libelle: `Loyer ${nomMois(courriel.mois)} ${courriel.nom}`, appeleLe: aujourdhui(),
      ...(courriel.relance ? { relanceLe: aujourdhui() } : {}),
    } });
  } catch (erreur) { console.warn('Échéance sur l’espace :', email, erreur); }
}

/** Le courriel d'appel ou de relance d'une échéance précise (page Loyers, v49), ou null. */
export function apercuAppelEcheance({ echeance, relance = false, journal = null }) {
  const d = donneesCourantes();
  const locataire = d.locataires.find((l) => l.id === echeance.locataireId) || null;
  const bail = d.baux.find((b) => b.id === echeance.bailId) || null;
  const bien = d.biens.find((b) => b.id === bail?.bienId) || null;
  return composerAppel({ echeance, locataire, bail, bien, parametres: d.parametres, relance, journal, dateJour: aujourdhui() });
}

/**
 * Envoie l'appel (ou la relance) d'une échéance à son colocataire, l'inscrit
 * au journal par personne et sur son espace (v49).
 */
export async function envoyerAppelEcheance({ echeance, relance = false, origine = 'manuel (page Loyers)' }) {
  const journal = await lireJournalAppels();
  const courriel = apercuAppelEcheance({ echeance, relance, journal });
  if (!courriel) throw new Error('Rien à appeler : échéance soldée ou colocataire sans adresse e-mail.');
  await api.envoyerCourriel({ type: 'appels', destinataires: courriel.destinataires, sujet: courriel.sujet, html: courriel.html });
  const bail = etat.liste('baux').find((b) => b.id === echeance.bailId);
  await publierEcheanceSurEspace(courriel, bienDe(bail?.bienId)?.nom || '');
  await api.ecrireDocumentSysteme(DOCUMENT_JOURNAL, noterAppel(journal, echeance.id, { type: relance ? 'relance' : 'appel', origine }));
  return courriel;
}

/** Envoie un exemplaire de test (le premier appel préparé) à une adresse. */
export async function envoyerTest(adresse, { bienId, annee, mois } = {}) {
  const { courriels, logement } = apercuAppels({ bienId, annee, mois });
  const vise = annee && mois ? { annee, mois } : moisVise(aujourdhui(), reglageAppel(bienDe(bienId)).cible);
  if (!courriels.length) throw new Error(`Aucun appel à préparer pour ${nomMois(vise.mois)} ${vise.annee}${logement ? ` (${logement})` : ''} : pas d’échéance non soldée, ou aucune adresse e-mail de colocataire.`);
  const modele = courriels[0];
  await api.envoyerCourriel({ type: 'appels',
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
  // v49 : un colocataire déjà appelé pour ce mois (page Loyers, fonction) n'est
  // pas appelé une seconde fois, sauf renvoi forcé.
  const { courriels, ecartes, reglage, logement } = apercuAppels({ bienId: bien?.id, ...vise, journal, inclureAppeles: force });
  const bailleurs = (etat.parametres().bailleurs || []).map((b) => String(b?.email || '').trim()).filter(Boolean);
  let envoyes = 0;
  const details = [];
  let journalMaj = journal;
  for (const courriel of courriels) {
    /* eslint-disable no-await-in-loop */
    await api.envoyerCourriel({ type: 'appels', destinataires: courriel.destinataires, sujet: courriel.sujet, html: courriel.html });
    envoyes += 1;
    details.push(`${courriel.nom} (${courriel.destinataires.join(', ')})`);
    await publierEcheanceSurEspace(courriel, logement);
    journalMaj = noterAppel(journalMaj, courriel.echeanceId, { type: 'appel', origine });
  }
  if (envoyes && reglage.copieBailleur && bailleurs.length) {
    await api.envoyerCourriel({
      type: 'appels-recap',
      destinataires: bailleurs,
      sujet: `Copie — appels de loyer ${nomMois(vise.mois)} ${vise.annee}${logement ? ` — ${logement}` : ''} envoyés`,
      html: `<p>${envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(vise.mois)} ${vise.annee}${logement ? ` (${logement})` : ''} :</p><ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`
        + (ecartes.length ? `<p>Non envoyés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.</p>` : ''),
    });
  }
  journalMaj.envois = {
    ...(journalMaj.envois || {}),
    [cleEnvoi(bien?.id || '', vise.annee, vise.mois)]: {
      le: new Date().toISOString(), origine, nombre: envoyes, details, ecartes, bienId: bien?.id || '', logement: logement || '',
    },
  };
  await api.ecrireDocumentSysteme(DOCUMENT_JOURNAL, journalMaj);
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
