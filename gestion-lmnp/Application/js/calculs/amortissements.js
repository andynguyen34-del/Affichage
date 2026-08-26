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

  // Année de cession et au-delà : le cumul se fige à la date de sortie.
  // On le calcule directement à partir des jours 30/360 réellement courus
  // depuis la mise en service, sans composer deux prorata (celui de la
  // première année et celui de la cession se combineraient à tort).
  const { base, duree, debut } = parametresPlan(immobilisation);
  if (!base || !duree || !debut) return 0;
  const joursDerniere = joursDepuisDebutAnnee(immobilisation.sortieLe);
  let joursCourus;
  if (anneeSortie === debut) {
    // Mise en service et cession la même année : une seule période courue.
    const joursAvantDebut = 360 - joursJusquaFinAnnee(immobilisation.dateMiseEnService);
    joursCourus = Math.max(0, joursDerniere - joursAvantDebut);
  } else {
    joursCourus = joursJusquaFinAnnee(immobilisation.dateMiseEnService)
      + Math.max(0, anneeSortie - debut - 1) * 360 + joursDerniere;
  }
  return centimes(Math.min(base, (base / duree) * (joursCourus / 360)));
}

/** Jours 30/360 écoulés du 1er janvier à une date (incluse). Une date de fin de mois vaut mois plein. */
function joursDepuisDebutAnnee(iso) {
  const [, mois, jour] = String(iso).slice(0, 10).split('-').map(Number);
  if (!mois || !jour) return 0;
  return Math.max(0, Math.min(360, (mois - 1) * 30 + Math.min(jour, 30)));
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

/** Un composant est-il encore inscrit à l'actif à la fin de l'exercice ? */
export const estInscrit = (immobilisation, annee) => {
  const sortie = anneeDe(immobilisation.sortieLe);
  return !sortie || sortie > annee;
};

/** Composants encore au bilan à la fin de l'exercice (cessions exclues). */
export const actifsInscrits = (immobilisations, annee) =>
  immobilisations.filter((i) => estInscrit(i, annee));

/** Valeur brute inscrite au bilan (cessions de l'exercice et antérieures exclues). */
export const baseInscrite = (immobilisations, annee) =>
  centimes(actifsInscrits(immobilisations, annee).reduce((somme, i) => somme + (Number(i.base) || 0), 0));

/** Cumul des amortissements des seuls actifs encore inscrits (pour le bilan). */
export const cumulInscrit = (immobilisations, annee) =>
  centimes(actifsInscrits(immobilisations, annee).reduce((somme, i) => somme + cumulFinAnnee(i, annee), 0));
