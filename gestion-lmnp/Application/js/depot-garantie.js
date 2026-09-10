// Dépôt de garantie (v46) : l'appel de dépôt (e-mail envoyé à chaque
// colocataire avant la remise des clés) et l'e-mail de mise à disposition du
// reçu. Documents distincts de l'appel de loyer : celui-ci ne parle jamais du
// dépôt. Module PUR, sans accès aux données ni au navigateur.
//
// parametres.depotGarantie = { objet, message, paiement, delaiJours } (Paramètres
// → « Dépôt de garantie ») ; sans texte de paiement, celui de l'appel de loyer
// du logement est repris (même compte, autre libellé de virement).

import { montant, dateLongue, date, centimes } from './format.js';
import { reglageAppelDe } from './appel-loyer.js';

export const DEPOT_PAR_DEFAUT = {
  objet: 'Dépôt de garantie — {logement} — {montant} à verser avant le {date}',
  message: '',
  paiement: '',
  delaiJours: 0, // date limite : la date d'entrée du bail, moins ce nombre de jours (0 : le jour de l'entrée)
};

const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const remplir = (gabarit, valeurs) => String(gabarit || '')
  .replace(/\{(\w+)\}/g, (tout, cle) => (valeurs[cle] !== undefined ? valeurs[cle] : tout));

export const nomComplet = (l) => `${l?.prenom || ''} ${l?.nom || ''}`.trim();
const adresseBien = (bien) => [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Réglages de l'appel de dépôt : Paramètres → depotGarantie, à défaut les valeurs par défaut. */
export function reglageDepotDe(parametres = {}) {
  return { ...DEPOT_PAR_DEFAUT, ...(parametres?.depotGarantie || {}) };
}

/** Le texte de paiement : celui réglé pour le dépôt, sinon celui de l'appel de loyer du logement. */
export function paiementDepot(parametres = {}, bien = null) {
  const reglage = reglageDepotDe(parametres);
  return String(reglage.paiement || '').trim() || String(reglageAppelDe(parametres, bien).paiement || '').trim();
}

/** Date limite de versement : l'entrée dans les lieux, avancée de `delaiJours`. */
export function dateLimiteDepot(bail, reglage = DEPOT_PAR_DEFAUT) {
  const debut = String(bail?.dateDebut || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) return '';
  const d = new Date(`${debut}T12:00:00`);
  d.setDate(d.getDate() - (Number(reglage?.delaiJours) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Signature des e-mails : les bailleurs des Paramètres, à défaut l'activité. */
export function signatureBailleurs(parametres = {}) {
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  return bailleurs.map((b) => b.nom).join(' et ') || parametres.nomActivite || 'Le bailleur';
}

/**
 * L'e-mail d'appel de dépôt de garantie d'un colocataire.
 *   ligne      : la caution (attendu, appeleLe…)
 *   locataire  : le colocataire ; bail, bien : son bail et le logement
 *   relance    : true pour une relance (l'objet est préfixé, le texte rappelle l'appel précédent)
 * Renvoie { destinataires, sujet, html, montant, dateLimite } — ou null si rien n'est dû.
 */
export function preparerAppelDepot({ ligne, locataire, bail, bien, parametres = {}, relance = false, dateLimite = '' }) {
  const attendu = centimes(Number(ligne?.attendu) || 0);
  const du = centimes(attendu - (Number(ligne?.montantRecu) || 0));
  if (du <= 0.005) return null;
  const reglage = reglageDepotDe(parametres);
  const limite = dateLimite || dateLimiteDepot(bail, reglage);
  const colocation = (bail?.colocataires || []).some((c) => c && c.locataireId);
  const nom = nomComplet(locataire) || 'colocataire';
  const valeurs = {
    prenom: locataire?.prenom || nom, nom, montant: montant(du), convenu: montant(attendu),
    date: limite ? date(limite) : 'la remise des clés', dateLongue: limite ? dateLongue(limite) : 'la remise des clés',
    logement: bien?.nom || 'le logement', adresse: adresseBien(bien) || bien?.nom || 'le logement',
    entree: bail?.dateDebut ? dateLongue(bail.dateDebut) : '', activite: parametres.nomActivite || '',
  };
  const sujet = `${relance ? 'Relance — ' : ''}${remplir(reglage.objet || DEPOT_PAR_DEFAUT.objet, valeurs)}`;
  // Le libellé de virement de l'appel de loyer (« Loyer {mois} … ») devient celui du dépôt.
  const paiement = paiementDepot(parametres, bien).replace(/«\s*Loyer[^»]*»/i, `« Dépôt de garantie ${nom} »`);
  const partiel = (Number(ligne?.montantRecu) || 0) > 0.005;
  const lignes = [
    `<p>Bonjour ${echapper(valeurs.prenom)},</p>`,
    relance
      ? `<p>Sauf erreur de notre part, nous n’avons pas encore reçu votre dépôt de garantie${ligne?.appeleLe ? `, appelé le ${echapper(date(ligne.appeleLe))}` : ''}. Pour rappel :</p>`
      : '',
    `<p>Conformément au bail ${colocation ? 'de colocation ' : ''}${bien?.nom ? `de <strong>${echapper(bien.nom)}</strong> ` : ''}(${echapper(valeurs.adresse)})`
      + `${valeurs.entree ? `, avec entrée dans les lieux le <strong>${echapper(valeurs.entree)}</strong>` : ''}, le dépôt de garantie à votre charge s’élève à `
      + `<strong>${echapper(valeurs.convenu)}</strong>${colocation ? ' (un mois de votre loyer hors charges)' : ''}`
      + (partiel ? `, dont ${echapper(montant(ligne.montantRecu))} déjà reçus : reste <strong>${echapper(valeurs.montant)}</strong>` : '')
      + `, à verser avant la remise des clés, <strong>le ${echapper(valeurs.dateLongue)}</strong>.</p>`,
    paiement ? `<p>${echapper(remplir(paiement, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
    reglage.message ? `<p>${echapper(remplir(reglage.message, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
    '<p>Ce dépôt n’est pas un loyer : il vous sera restitué en fin de bail, déduction faite des éventuelles retenues justifiées, '
      + 'dans les délais légaux (article 22 de la loi du 6 juillet 1989). Un reçu vous sera remis sur votre espace dès réception.</p>',
    `<p>Bien cordialement,<br>${echapper(signatureBailleurs(parametres))}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ''}</p>`,
  ];
  const destinataires = [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean);
  return { destinataires, sujet, html: lignes.filter(Boolean).join('\n'), montant: du, dateLimite: limite };
}

/** L'e-mail qui accompagne le reçu de dépôt publié sur l'espace du colocataire. */
export function courrielRecuDepot({ locataire, montantRecu, recuLe, modeVersement, parametres = {}, origine = '' }) {
  const nom = nomComplet(locataire);
  return {
    destinataires: [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean),
    sujet: `Reçu de dépôt de garantie — ${montant(montantRecu)}`,
    html: [
      `<p>Bonjour ${echapper(locataire?.prenom || nom)},</p>`,
      `<p>Nous avons bien reçu votre dépôt de garantie de <strong>${echapper(montant(montantRecu))}</strong> le <strong>${echapper(dateLongue(recuLe))}</strong>`
        + `${modeVersement ? `, par ${echapper(modeVersement)}` : ''}. Le reçu est disponible sur votre espace, rubrique « Bail &amp; documents ».</p>`,
      origine ? `<p><a href="${echapper(origine)}/colocataire">${echapper(origine)}/colocataire</a></p>` : '',
      '<p>Ce dépôt vous sera restitué en fin de bail, déduction faite des éventuelles retenues justifiées, dans les délais légaux.</p>',
      `<p>Bien cordialement,<br>${echapper(signatureBailleurs(parametres))}</p>`,
    ].filter(Boolean).join('\n'),
  };
}

// ------------------------------------------------ montant en toutes lettres

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function moinsDeCent(n) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) { // 71 : soixante-et-onze, 75 : soixante-quinze, 91 : quatre-vingt-onze
    const reste = n - (d - 1) * 10;
    return `${DIZAINES[d]}${d === 7 && reste === 11 ? '-et-' : '-'}${UNITES[reste]}`;
  }
  if (d === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`;
  if (u === 0) return DIZAINES[d];
  return u === 1 ? `${DIZAINES[d]}-et-un` : `${DIZAINES[d]}-${UNITES[u]}`;
}

function moinsDeMille(n) {
  const c = Math.floor(n / 100);
  const reste = n % 100;
  if (c === 0) return moinsDeCent(reste);
  const centaines = c === 1 ? 'cent' : `${UNITES[c]} cent${reste === 0 ? 's' : ''}`;
  return reste === 0 ? centaines : `${centaines} ${moinsDeCent(reste)}`;
}

/** 375,50 → « trois cent soixante-quinze euros et cinquante centimes ». */
export function montantEnLettres(valeur) {
  const total = Math.round((Number(valeur) || 0) * 100);
  const euros = Math.floor(total / 100);
  const cents = total % 100;
  const partie = (n) => {
    if (n === 0) return 'zéro';
    const millions = Math.floor(n / 1000000);
    const milliers = Math.floor((n % 1000000) / 1000);
    const reste = n % 1000;
    const morceaux = [];
    if (millions) morceaux.push(`${moinsDeMille(millions)} million${millions > 1 ? 's' : ''}`);
    if (milliers) morceaux.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers)} mille`);
    if (reste) morceaux.push(moinsDeMille(reste));
    return morceaux.join(' ');
  };
  const texteEuros = euros >= 1000000 && euros % 1000000 === 0 ? `${partie(euros)} d'euros` : `${partie(euros)} euro${euros > 1 ? 's' : ''}`;
  return cents ? `${texteEuros} et ${partie(cents)} centime${cents > 1 ? 's' : ''}` : texteEuros;
}
