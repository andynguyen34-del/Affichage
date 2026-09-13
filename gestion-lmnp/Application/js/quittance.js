// Quittance de loyer (v51) : numéro, solde antérieur, nom de fichier.
// Module PUR, partagé entre la page Loyers et les tests.

import { centimes } from './format.js';
import { totalEncaisse } from './calculs/loyers.js';

const sansAccents = (texte) => String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Code court d'un logement pour le numéro de quittance : le premier mot tout
 * en capitales de son nom (« Maison SML — … » → SML), à défaut les initiales
 * des mots (« Studio Beauvais » → SB), 4 lettres au plus.
 */
export function codeLogement(bien) {
  const nom = sansAccents(bien?.nom);
  const mots = nom.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const capitales = mots.find((m) => m.length >= 2 && m.length <= 4 && m === m.toUpperCase() && /[A-Z]/.test(m));
  if (capitales) return capitales;
  const initiales = mots.map((m) => m[0].toUpperCase()).join('').slice(0, 4);
  return initiales || 'LOG';
}

/** Initiales d'un colocataire : initiale du prénom + deux premières lettres du nom (« Nicolas NGUYEN » → NNG). */
export function initiales(locataire) {
  const prenom = sansAccents(locataire?.prenom).replace(/[^A-Za-z]/g, '');
  const nom = sansAccents(locataire?.nom).replace(/[^A-Za-z]/g, '');
  return `${prenom.slice(0, 1)}${nom.slice(0, 2)}`.toUpperCase() || 'LOC';
}

/** Numéro de quittance : « 2026-10-SML-NNG » (année, mois, logement, initiales) — unique par colocataire et par mois. */
export function numeroQuittance({ annee, mois, bien, locataire }) {
  return `${annee}-${String(mois).padStart(2, '0')}-${codeLogement(bien)}-${initiales(locataire)}`;
}

/**
 * Solde antérieur : ce qui reste dû par le même colocataire, sur le même
 * bail, pour les mois qui précèdent l'échéance quittancée (échéances
 * passées et non soldées).
 */
export function soldeAnterieur(echeances, echeance) {
  const cle = (e) => Number(e.annee) * 100 + Number(e.mois);
  return centimes(echeances
    .filter((e) => e.bailId === echeance.bailId && (e.locataireId || '') === (echeance.locataireId || '') && cle(e) < cle(echeance))
    .reduce((s, e) => s + Math.max(0, (Number(e.total) || 0) - totalEncaisse(e)), 0));
}

/** Le dernier encaissement d'une échéance : { date, mode, reference } ou null. */
export function dernierReglement(echeance) {
  const dernier = (echeance?.encaissements || []).slice(-1)[0];
  return dernier ? { date: dernier.date || '', mode: String(dernier.mode || '').toLowerCase(), reference: dernier.reference || '' } : null;
}
