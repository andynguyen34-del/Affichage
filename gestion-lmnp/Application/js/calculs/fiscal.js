// Résultat fiscal LMNP au régime réel, exercice par exercice.
//
// Règles appliquées :
//  - amortissement déductible plafonné au loyer diminué des autres charges
//    (article 39 C II 2° du CGI) ; l'excédent devient un amortissement réputé
//    différé, reportable sans limite de durée ;
//  - déficit d'exploitation reportable sur les BIC non professionnels des
//    dix exercices suivants.

import { anneeDe, centimes } from '../format.js';
import * as amortissements from './amortissements.js';
import * as emprunts from './emprunt.js';
import * as loyers from './loyers.js';

export const DUREE_REPORT_DEFICIT = 10;

function dateRetenue(charge, methode) {
  if (methode === 'engagement') return charge.date || charge.dateReglement;
  return charge.dateReglement || charge.date;
}

/** Charges déductibles d'une année, groupées par catégorie. */
export function chargesAnnee(donnees, annee, methode) {
  const groupes = new Map();
  let total = 0;
  for (const charge of donnees.charges) {
    if (charge.immobilise) continue;
    if (charge.deductible === false) continue;
    if (anneeDe(dateRetenue(charge, methode)) !== annee) continue;
    const taux = charge.tauxDeduction === undefined || charge.tauxDeduction === null ? 100 : Number(charge.tauxDeduction);
    const montant = centimes((Number(charge.montant) || 0) * (taux / 100));
    total += montant;
    const cle = charge.categorie || 'autres';
    groupes.set(cle, centimes((groupes.get(cle) || 0) + montant));
  }
  return { total: centimes(total), groupes };
}

/** Charges saisies mais non déductibles — affichées pour mémoire. */
export function chargesNonDeductibles(donnees, annee, methode) {
  return donnees.charges.filter((charge) => charge.deductible === false
    && !charge.immobilise
    && anneeDe(dateRetenue(charge, methode)) === annee);
}

/** Calcul d'un exercice, à partir des reports de l'exercice précédent. */
export function calculerExercice(donnees, annee, report) {
  const parametres = donnees.parametres;
  const methode = parametres.methodeComptable === 'engagement' ? 'engagement' : 'encaissement';

  const produits = methode === 'engagement'
    ? loyers.creancesAnnee(donnees.baux, annee, donnees.loyers)
    : loyers.encaissementsAnnee(donnees.loyers, annee);

  const recettes = {
    loyers: produits.loyer,
    charges: produits.charges,
    autres: produits.autres,
    total: produits.total,
  };

  const detailCharges = chargesAnnee(donnees, annee, methode);
  const emprunt = parametres.interetsAutomatiques
    ? emprunts.syntheseAnneeTousEmprunts(donnees.emprunts, annee)
    : { interets: 0, assurance: 0, deductible: 0, capital: 0, echeances: 0 };

  const chargesTotales = centimes(detailCharges.total + emprunt.deductible);
  const resultatAvantAmortissement = centimes(recettes.total - chargesTotales);

  const dotations = amortissements.dotationsAnnee(donnees.immobilisations, annee);
  const stockAnterieur = centimes(Number(report?.amortissementsDifferes) || 0);
  const plafond = Math.max(0, resultatAvantAmortissement);
  const amortissementImpute = centimes(Math.min(dotations.total + stockAnterieur, plafond));
  const amortissementsDifferes = centimes(dotations.total + stockAnterieur - amortissementImpute);

  const resultatApresAmortissement = centimes(resultatAvantAmortissement - amortissementImpute);

  // Déficits antérieurs : les plus anciens d'abord, dans la limite de dix ans.
  const deficitsEntrants = (report?.deficits || []).map((d) => ({ ...d }));
  const perimes = deficitsEntrants.filter((d) => annee - d.annee > DUREE_REPORT_DEFICIT);
  const utilisables = deficitsEntrants
    .filter((d) => annee - d.annee <= DUREE_REPORT_DEFICIT)
    .sort((a, b) => a.annee - b.annee);

  let restantAImputer = Math.max(0, resultatApresAmortissement);
  const imputations = [];
  for (const deficit of utilisables) {
    if (restantAImputer <= 0) break;
    const utilise = centimes(Math.min(deficit.montant, restantAImputer));
    if (utilise <= 0) continue;
    deficit.montant = centimes(deficit.montant - utilise);
    restantAImputer = centimes(restantAImputer - utilise);
    imputations.push({ annee: deficit.annee, montant: utilise });
  }
  const deficitsImputes = centimes(imputations.reduce((s, i) => s + i.montant, 0));

  const resultatImposable = resultatApresAmortissement > 0
    ? centimes(resultatApresAmortissement - deficitsImputes)
    : 0;

  const deficitsSortants = utilisables.filter((d) => d.montant > 0.005);
  if (resultatApresAmortissement < 0) {
    deficitsSortants.push({ annee, montant: centimes(-resultatApresAmortissement) });
  }

  return {
    annee,
    methode,
    recettes,
    charges: {
      total: chargesTotales,
      horsEmprunt: detailCharges.total,
      groupes: detailCharges.groupes,
      emprunt,
    },
    resultatAvantAmortissement,
    amortissements: {
      dotation: dotations.total,
      detail: dotations.detail,
      stockAnterieur,
      impute: amortissementImpute,
      differes: amortissementsDifferes,
      plafond,
      brides: dotations.total + stockAnterieur > plafond,
    },
    resultatApresAmortissement,
    deficits: {
      entrants: deficitsEntrants,
      imputes: deficitsImputes,
      imputations,
      perimes: centimes(perimes.reduce((s, d) => s + d.montant, 0)),
      sortants: deficitsSortants,
      nouveau: resultatApresAmortissement < 0 ? centimes(-resultatApresAmortissement) : 0,
    },
    resultatImposable,
    reportSortant: {
      amortissementsDifferes,
      deficits: deficitsSortants,
    },
  };
}

/** Première année à calculer : début d'activité, ou plus ancienne donnée connue. */
export function premiereAnnee(donnees) {
  const candidats = [];
  if (donnees.parametres.debutActivite) candidats.push(anneeDe(donnees.parametres.debutActivite));
  for (const bien of donnees.biens) if (bien.dateAcquisition) candidats.push(anneeDe(bien.dateAcquisition));
  for (const bail of donnees.baux) if (bail.dateDebut) candidats.push(anneeDe(bail.dateDebut));
  for (const charge of donnees.charges) if (charge.date) candidats.push(anneeDe(charge.date));
  for (const immobilisation of donnees.immobilisations) {
    if (immobilisation.dateMiseEnService) candidats.push(anneeDe(immobilisation.dateMiseEnService));
  }
  for (const loyer of donnees.loyers) if (loyer.annee) candidats.push(Number(loyer.annee));
  const valides = candidats.filter((a) => a && a > 1990 && a < 2200);
  return valides.length ? Math.min(...valides) : new Date().getFullYear();
}

/** Chaîne tous les exercices de la première année jusqu'à l'année demandée. */
export function calculerSerie(donnees, anneeMax) {
  const debut = premiereAnnee(donnees);
  const reports = donnees.parametres.reports || {};
  let report = {
    amortissementsDifferes: Number(reports.amortissementsDifferes) || 0,
    deficits: (reports.deficits || []).map((d) => ({ annee: Number(d.annee), montant: Number(d.montant) || 0 })),
  };
  const exercices = new Map();
  for (let annee = debut; annee <= anneeMax; annee += 1) {
    const exercice = calculerExercice(donnees, annee, report);
    exercices.set(annee, exercice);
    report = exercice.reportSortant;
  }
  return exercices;
}

export function exercice(donnees, annee) {
  return calculerSerie(donnees, annee).get(annee);
}

/**
 * Comparaison avec le micro-BIC : abattement forfaitaire, plancher de 305 €.
 * Les taux et seuils évoluent ; ils sont modifiables dans les paramètres.
 */
export function comparaisonMicroBic(donnees, annee, recettesBrutes) {
  const parametres = donnees.parametres;
  const abattement = Number(parametres.microAbattement) || 0;
  const plafond = Number(parametres.microPlafond) || 0;
  const reduction = Math.max(centimes(recettesBrutes * (abattement / 100)), Math.min(305, recettesBrutes));
  return {
    annee,
    recettes: centimes(recettesBrutes),
    abattement,
    plafond,
    eligible: plafond === 0 || recettesBrutes <= plafond,
    base: centimes(Math.max(0, recettesBrutes - reduction)),
  };
}
