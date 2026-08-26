// Échéancier d'un prêt à mensualités constantes.

import { ajouterMois, anneeDe, centimes } from '../format.js';

export function mensualite(emprunt) {
  const capital = Number(emprunt.capital) || 0;
  const duree = Number(emprunt.dureeMois) || 0;
  const tauxMensuel = (Number(emprunt.tauxAnnuel) || 0) / 100 / 12;
  if (!capital || !duree) return 0;
  if (tauxMensuel === 0) return centimes(capital / duree);
  return centimes((capital * tauxMensuel) / (1 - (1 + tauxMensuel) ** -duree));
}

/** Toutes les échéances du prêt, de la première à la dernière. */
export function echeancier(emprunt) {
  const capital = Number(emprunt.capital) || 0;
  const duree = Number(emprunt.dureeMois) || 0;
  const premiere = emprunt.datePremiereEcheance;
  if (!capital || !duree || !premiere) return [];

  const tauxMensuel = (Number(emprunt.tauxAnnuel) || 0) / 100 / 12;
  const assurance = Number(emprunt.assuranceMensuelle) || 0;
  const montantMensuel = mensualite(emprunt);
  const lignes = [];
  let restant = capital;

  for (let numero = 1; numero <= duree; numero += 1) {
    const interets = centimes(restant * tauxMensuel);
    let partCapital = centimes(montantMensuel - interets);
    if (numero === duree || partCapital > restant) partCapital = centimes(restant);
    restant = centimes(restant - partCapital);
    const date = ajouterMois(premiere, numero - 1);
    lignes.push({
      numero,
      date,
      annee: anneeDe(date),
      capital: partCapital,
      interets,
      assurance,
      total: centimes(partCapital + interets + assurance),
      restantDu: restant,
    });
    if (restant <= 0) break;
  }
  return lignes;
}

/** Cumul des intérêts et de l'assurance pour une année. */
export function syntheseAnnee(emprunt, annee) {
  const total = { interets: 0, assurance: 0, capital: 0, echeances: 0 };
  for (const ligne of echeancier(emprunt)) {
    if (ligne.annee !== annee) continue;
    total.interets += ligne.interets;
    total.assurance += ligne.assurance;
    total.capital += ligne.capital;
    total.echeances += 1;
  }
  total.interets = centimes(total.interets);
  total.assurance = centimes(total.assurance);
  total.capital = centimes(total.capital);
  total.deductible = centimes(total.interets + total.assurance);
  return total;
}

export function syntheseAnneeTousEmprunts(emprunts, annee) {
  const cumul = { interets: 0, assurance: 0, capital: 0, deductible: 0, echeances: 0 };
  for (const emprunt of emprunts) {
    const partiel = syntheseAnnee(emprunt, annee);
    cumul.interets += partiel.interets;
    cumul.assurance += partiel.assurance;
    cumul.capital += partiel.capital;
    cumul.deductible += partiel.deductible;
    cumul.echeances += partiel.echeances;
  }
  for (const cle of ['interets', 'assurance', 'capital', 'deductible']) cumul[cle] = centimes(cumul[cle]);
  return cumul;
}

/** Capital restant dû à une date donnée (fin d'année). */
export function capitalRestantDu(emprunt, annee) {
  const lignes = echeancier(emprunt).filter((l) => l.annee <= annee);
  if (!lignes.length) return Number(emprunt.capital) || 0;
  return lignes[lignes.length - 1].restantDu;
}
