// Amortissement linéaire par composant, prorata temporis en mois de 30 jours
// (usage comptable français : année de 360 jours).

import { anneeDe, centimes } from '../format.js';

/** Nombre de jours amortissables entre une date et le 31 décembre de son année. */
export function joursJusquaFinAnnee(iso) {
  const [, mois, jour] = String(iso).slice(0, 10).split('-').map(Number);
  if (!mois || !jour) return 0;
  const jours = (12 - mois) * 30 + (30 - Math.min(jour, 30) + 1);
  return Math.max(0, Math.min(360, jours));
}

function parametresPlan(immobilisation) {
  return {
    base: Number(immobilisation.base) || 0,
    duree: Number(immobilisation.dureeAnnees) || 0,
    debut: anneeDe(immobilisation.dateMiseEnService),
    fractionPremiereAnnee: joursJusquaFinAnnee(immobilisation.dateMiseEnService) / 360,
  };
}

/** Cumul théorique, sans tenir compte d'une éventuelle cession. */
function cumulTheorique(immobilisation, annee) {
  const { base, duree, debut, fractionPremiereAnnee } = parametresPlan(immobilisation);
  if (!base || !duree || !debut || annee < debut) return 0;
  if (annee >= debut + duree) return base;
  const annuite = base / duree;
  return Math.min(base, annuite * (fractionPremiereAnnee + (annee - debut)));
}

/** Cumul des amortissements à la fin d'une année, cession comprise. */
export function cumulFinAnnee(immobilisation, annee) {
  const anneeSortie = anneeDe(immobilisation.sortieLe);
  if (!anneeSortie || annee < anneeSortie) return centimes(cumulTheorique(immobilisation, annee));

  const avant = cumulTheorique(immobilisation, anneeSortie - 1);
  const pleine = cumulTheorique(immobilisation, anneeSortie) - avant;
  const fraction = (360 - joursJusquaFinAnnee(immobilisation.sortieLe)) / 360;
  return centimes(avant + pleine * Math.max(0, Math.min(1, fraction)));
}

/** Dotation d'un composant pour une année donnée. */
export function dotation(immobilisation, annee) {
  return centimes(cumulFinAnnee(immobilisation, annee) - cumulFinAnnee(immobilisation, annee - 1));
}

export const valeurNetteComptable = (immobilisation, annee) =>
  centimes((Number(immobilisation.base) || 0) - cumulFinAnnee(immobilisation, annee));

/** Tableau année par année pour un composant. */
export function plan(immobilisation) {
  const { base, duree, debut } = parametresPlan(immobilisation);
  const lignes = [];
  if (!base || !duree || !debut) return lignes;
  const anneeSortie = anneeDe(immobilisation.sortieLe);
  const fin = anneeSortie ? Math.min(anneeSortie, debut + duree) : debut + duree;
  for (let annee = debut; annee <= fin; annee += 1) {
    lignes.push({
      annee,
      dotation: dotation(immobilisation, annee),
      cumul: cumulFinAnnee(immobilisation, annee),
      valeurNette: valeurNetteComptable(immobilisation, annee),
    });
  }
  return lignes.filter((ligne, index) => index === 0 || ligne.dotation > 0);
}

/** Dotation totale d'une année, avec le détail par composant. */
export function dotationsAnnee(immobilisations, annee) {
  const detail = immobilisations
    .map((immobilisation) => ({ immobilisation, dotation: dotation(immobilisation, annee) }))
    .filter((ligne) => ligne.dotation > 0);
  const total = centimes(detail.reduce((somme, ligne) => somme + ligne.dotation, 0));
  return { total, detail };
}

/** Cumul de tous les amortissements pratiqués (utile pour la plus-value de cession). */
export function cumulGlobal(immobilisations, annee) {
  return centimes(immobilisations.reduce((somme, i) => somme + cumulFinAnnee(i, annee), 0));
}
