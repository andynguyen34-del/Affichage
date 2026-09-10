// Appel de loyer : le courriel envoyé à chaque colocataire pour l'échéance du
// mois (montant de sa part, reste dû, date limite, moyens de paiement).
// Module PUR, partagé entre l'application (test, envoi manuel, envoi à
// l'ouverture) et la fonction planifiée côté serveur : même calcul, même texte.

import { echeancesGlobales, totalEncaisse } from './calculs/loyers.js';
import { montant, nomMois, dateLongue, centimes } from './format.js';

export const APPEL_PAR_DEFAUT = {
  actif: false,
  jour: 1, // jour du mois de l'envoi (1 à 28)
  cible: 'courant', // 'courant' : le loyer du mois de l'envoi ; 'suivant' : celui du mois d'après
  objet: 'Appel de loyer — {mois} {annee}',
  message: '',
  paiement: '',
  copieBailleur: true,
};

export const cleMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}`;

/** Clé d'un envoi au journal : un logement et un mois (« {bienId}:{AAAA-MM} »). */
export const cleEnvoi = (bienId, annee, mois) => `${bienId || ''}:${cleMois(annee, mois)}`;

/** Un logement de courte durée (Airbnb…) n'a pas d'appel de loyer. */
export const sansAppel = (bien) => bien?.typeLocation === 'courte';

/**
 * Réglages d'appel d'un logement : ceux notés sur le logement, à défaut les
 * réglages communs (Paramètres → appelLoyer, tels qu'ils existaient avant
 * les réglages par logement), à défaut les valeurs par défaut.
 */
export function reglageAppelDe(parametres = {}, bien = null) {
  return { ...APPEL_PAR_DEFAUT, ...(parametres?.appelLoyer || {}), ...(bien?.appelLoyer || {}) };
}

/** L'envoi d'un mois est-il inscrit au journal pour ce logement ? */
export function dejaEnvoye(historique, bienId, annee, mois) {
  const envois = historique?.envois || {};
  // Les envois d'avant les réglages par logement (clé « AAAA-MM » seule)
  // valaient pour tous les logements de l'époque : on ne renvoie pas.
  return envois[cleEnvoi(bienId, annee, mois)] || envois[cleMois(annee, mois)] || null;
}

/** Le mois dont on appelle le loyer, pour un envoi à cette date. */
export function moisVise(dateIso, cible = 'courant') {
  let annee = Number(dateIso.slice(0, 4));
  let mois = Number(dateIso.slice(5, 7));
  if (cible === 'suivant') { mois += 1; if (mois > 12) { mois = 1; annee += 1; } }
  return { annee, mois };
}

/** Le jour d'envoi, ramené au dernier jour du mois s'il n'existe pas (30 février…). */
export function jourEnvoi(reglage, annee, mois) {
  const dernier = new Date(annee, mois, 0).getDate();
  return Math.min(Math.max(1, Number(reglage.jour) || 1), dernier);
}

/** Fenêtre de rattrapage : l'appel part encore jusqu'à 7 jours après le jour réglé. */
export const JOURS_RATTRAPAGE = 7;

/**
 * Faut-il envoyer aujourd'hui ? Oui si l'appel est actif, si l'on est au jour
 * réglé ou dans les 7 jours qui suivent (l'envoi n'est pas perdu si le poste
 * était éteint ce jour-là — mais activer la fonction en fin de mois n'envoie
 * pas l'appel du mois en retard), et si le mois visé n'a pas déjà été appelé.
 */
export function doitEnvoyer(reglage, dateIso, historique = {}, bienId = '') {
  const r = { ...APPEL_PAR_DEFAUT, ...(reglage || {}) };
  if (!r.actif) return false;
  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  const jour = Number(dateIso.slice(8, 10));
  const cible = jourEnvoi(r, annee, mois);
  if (jour < cible || jour > cible + JOURS_RATTRAPAGE) return false;
  const vise = moisVise(dateIso, r.cible);
  return !dejaEnvoye(historique, bienId, vise.annee, vise.mois);
}

const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const remplir = (gabarit, valeurs) => String(gabarit || '')
  .replace(/\{(\w+)\}/g, (tout, cle) => (valeurs[cle] !== undefined ? valeurs[cle] : tout));

const nomComplet = (l) => `${l?.prenom || ''} ${l?.nom || ''}`.trim();
const adresseBien = (bien) => [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// ------------------------------------------------ journal par personne (v49)
// systeme/appels-loyer.personnes = { [idEcheance]: [{ le, type: 'appel'|'relance', origine }] }
// L'identifiant d'une échéance (bail + colocataire + mois) est stable : le
// journal se lit depuis la page Loyers, l'application et la fonction planifiée.

/** Les appels déjà envoyés pour une échéance (du plus ancien au plus récent). */
export const appelsDe = (journal, echeanceId) => [].concat(journal?.personnes?.[echeanceId] || [])
  .filter((a) => a && a.le).sort((a, b) => String(a.le).localeCompare(String(b.le)));

/** Le premier appel et la dernière relance d'une échéance, ou null. */
export function resumeAppels(journal, echeanceId) {
  const appels = appelsDe(journal, echeanceId);
  if (!appels.length) return null;
  const premier = appels.find((a) => a.type !== 'relance') || appels[0];
  const relances = appels.filter((a) => a.type === 'relance');
  return { premier, derniereRelance: relances[relances.length - 1] || null, nombre: appels.length };
}

/** Journal complété d'un appel (nouvel objet, l'original n'est pas modifié). */
export function noterAppel(journal, echeanceId, { le = new Date().toISOString(), type = 'appel', origine = 'manuel' } = {}) {
  const personnes = { ...(journal?.personnes || {}) };
  personnes[echeanceId] = [...appelsDe(journal, echeanceId), { le, type, origine }];
  return { ...(journal || {}), envois: journal?.envois || {}, personnes };
}

const dateCourte = (iso) => {
  const [a, m, j] = String(iso || '').slice(0, 10).split('-');
  return a && m && j ? `${j}/${m}/${a}` : String(iso || '');
};

/**
 * Le courriel d'appel (ou de relance) d'une échéance pour son colocataire.
 *   relance   : objet « Relance — … », rappel du premier appel, échéance dépassée
 *   dateJour  : date ISO du jour (pour « échéance dépassée depuis le … »)
 * Renvoie null si rien n'est dû ou sans adresse.
 */
export function composerAppel({ echeance, locataire, bail, bien, parametres = {}, relance = false, journal = null, dateJour = '' }) {
  const reglage = reglageAppelDe(parametres, bien);
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  const signature = bailleurs.map((b) => b.nom).join(' et ') || parametres.nomActivite || 'Le bailleur';
  const nom = nomComplet(locataire) || 'colocataire';
  const reste = centimes((Number(echeance.total) || 0) - totalEncaisse(echeance));
  if (reste <= 0.005) return null;
  const destinataires = [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean);
  if (!destinataires.length) return null;
  const annee = Number(echeance.annee);
  const mois = Number(echeance.mois);
  const valeurs = {
    prenom: locataire?.prenom || nom, nom, mois: nomMois(mois), annee,
    montant: montant(reste), total: montant(echeance.total), date: dateLongue(echeance.dateEcheance),
    logement: adresseBien(bien) || bien?.nom || 'le logement', activite: parametres.nomActivite || '',
  };
  const objet = remplir(reglage.objet || APPEL_PAR_DEFAUT.objet, valeurs);
  const sujet = relance ? `Relance — ${objet}` : objet;
  const partiel = totalEncaisse(echeance) > 0.005;
  const depassee = Boolean(dateJour && echeance.dateEcheance && String(echeance.dateEcheance) < String(dateJour));
  const premier = relance ? resumeAppels(journal, echeance.id)?.premier : null;
  const lignes = [
    `<p>Bonjour ${echapper(valeurs.prenom)},</p>`,
    relance
      ? `<p>Sauf erreur de notre part, nous n’avons pas encore reçu votre loyer de <strong>${echapper(valeurs.mois)} ${annee}</strong>`
        + `${premier ? `, appelé le ${echapper(dateCourte(premier.le))}` : ''}. Pour rappel :</p>`
      : `<p>Voici l’appel de loyer pour <strong>${echapper(valeurs.mois)} ${annee}</strong>, `
        + `pour le logement situé ${echapper(valeurs.logement)}${echeance.partiel ? ' (mois partiel, calculé au prorata)' : ''} :</p>`,
    '<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ccd">',
    `<tr><td>Loyer hors charges</td><td align="right">${echapper(montant(echeance.loyerHc))}</td></tr>`,
    `<tr><td>Provision pour charges (eau, ordures ménagères)</td><td align="right">${echapper(montant(echeance.charges))}</td></tr>`,
    echeance.autres ? `<tr><td>Autres sommes</td><td align="right">${echapper(montant(echeance.autres))}</td></tr>` : '',
    `<tr><td><strong>Total du mois</strong></td><td align="right"><strong>${echapper(montant(echeance.total))}</strong></td></tr>`,
    partiel ? `<tr><td>Déjà reçu</td><td align="right">${echapper(montant(totalEncaisse(echeance)))}</td></tr>`
      + `<tr><td><strong>Reste à régler</strong></td><td align="right"><strong>${echapper(montant(reste))}</strong></td></tr>` : '',
    '</table>',
    depassee && relance
      ? `<p>Montant à régler : <strong>${echapper(montant(reste))}</strong>, échéance dépassée depuis le <strong>${echapper(valeurs.date)}</strong>.</p>`
      : `<p>Montant à régler : <strong>${echapper(montant(reste))}</strong>, au plus tard le <strong>${echapper(valeurs.date)}</strong>.</p>`,
    reglage.paiement ? `<p>${echapper(remplir(reglage.paiement, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
    reglage.message ? `<p>${echapper(remplir(reglage.message, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
    relance ? '<p>Si le règlement vient d’être fait, merci de ne pas tenir compte de ce message.</p>'
      : '<p>Si le règlement a déjà été fait, merci de ne pas tenir compte de ce message.</p>',
    `<p>Cordialement,<br>${echapper(signature)}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ''}</p>`,
  ];
  return {
    echeanceId: echeance.id, locataireId: echeance.locataireId, nom, destinataires, sujet,
    html: lignes.filter(Boolean).join('\n'),
    montantDu: reste, dateLimite: echeance.dateEcheance, bienId: bien?.id || '', annee, mois, relance,
  };
}

/**
 * Prépare les courriels d'appel de loyer d'un mois : un par colocataire ayant
 * une échéance non soldée. Renvoie aussi les colocataires laissés de côté
 * (déjà réglé, sans adresse, déjà appelé) pour le compte rendu.
 * `bienId`  : un logement précis (ses réglages, ses baux) ; sans lui, tous les
 *             baux avec les réglages communs.
 * `journal` : journal des appels ; avec lui, un colocataire déjà appelé pour
 *             ce mois est écarté (« déjà appelé le … »), sauf `inclureAppeles`.
 */
export function preparerAppels({ baux = [], locataires = [], loyers = [], biens = [], parametres = {}, annee, mois, bienId = '', journal = null, inclureAppeles = false, dateJour = '' }) {
  const bienVise = bienId ? biens.find((b) => b.id === bienId) || null : null;
  const reglage = reglageAppelDe(parametres, bienVise);
  const courriels = [];
  const ecartes = [];
  const bauxVises = bienId ? baux.filter((b) => b.bienId === bienId) : baux;
  if (bienVise && sansAppel(bienVise)) return { courriels, ecartes, reglage, logement: bienVise.nom };
  const echeances = echeancesGlobales(bauxVises, annee, loyers).filter((e) => Number(e.mois) === Number(mois) && (Number(e.total) || 0) > 0);
  for (const echeance of echeances) {
    const locataire = locataires.find((l) => l.id === echeance.locataireId);
    const nom = nomComplet(locataire) || 'colocataire';
    const reste = centimes((Number(echeance.total) || 0) - totalEncaisse(echeance));
    if (reste <= 0.005) { ecartes.push({ nom, raison: 'déjà réglé' }); continue; }
    const destinataires = [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean);
    if (!destinataires.length) { ecartes.push({ nom, raison: 'aucune adresse e-mail' }); continue; }
    const deja = journal && !inclureAppeles ? resumeAppels(journal, echeance.id) : null;
    if (deja) { ecartes.push({ nom, raison: `déjà appelé le ${dateCourte(deja.premier.le)}` }); continue; }
    const bail = baux.find((b) => b.id === echeance.bailId);
    const bien = biens.find((b) => b.id === bail?.bienId);
    const courriel = composerAppel({ echeance, locataire, bail, bien, parametres, journal, dateJour });
    if (courriel) courriels.push(courriel);
  }
  return { courriels, ecartes, reglage, logement: bienVise?.nom || '' };
}
