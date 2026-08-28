// Échéances de loyer déduites des baux, et rapprochement avec les encaissements.

import { anneeDe, centimes, isoDepuis, aujourdhui } from '../format.js';

const dernierJourDuMois = (annee, mois) => new Date(annee, mois, 0).getDate();

/** Part du mois couverte par le bail (1 = mois entier). */
function proportionDuMois(bail, annee, mois) {
  const jours = dernierJourDuMois(annee, mois);
  const debutMois = isoDepuis(annee, mois, 1);
  const finMois = isoDepuis(annee, mois, jours);
  const debutBail = String(bail.dateDebut || '').slice(0, 10);
  const finBail = String(bail.dateFin || '').slice(0, 10);

  if (!debutBail || debutBail > finMois) return 0;
  if (finBail && finBail < debutMois) return 0;

  const premier = debutBail > debutMois ? Number(debutBail.slice(8, 10)) : 1;
  const dernier = (finBail && finBail < finMois) ? Number(finBail.slice(8, 10)) : jours;
  const couverts = dernier - premier + 1;
  if (couverts <= 0) return 0;
  return couverts / jours;
}

/**
 * Flux de loyer d'un bail : un par payeur.
 * - Bail de colocation (bail.colocataires renseigné) : un flux par colocataire,
 *   avec sa part de loyer et de charges — chacun a ses propres échéances,
 *   virements et quittances.
 * - Bail classique : un seul flux au nom du titulaire.
 */
export function fluxDuBail(bail) {
  const colocataires = Array.isArray(bail.colocataires)
    ? bail.colocataires.filter((c) => c && c.locataireId)
    : [];
  if (colocataires.length) {
    return colocataires.map((c) => ({
      locataireId: c.locataireId,
      loyerHc: Number(c.partLoyer) || 0,
      charges: Number(c.partCharges) || 0,
      // Le suffixe rend l'identifiant d'échéance propre à chaque colocataire.
      suffixe: `-${String(c.locataireId).slice(0, 8)}`,
    }));
  }
  return [{
    locataireId: bail.locataireId || '',
    loyerHc: Number(bail.loyerHc) || 0,
    charges: Number(bail.provisionCharges) || 0,
    suffixe: '',
  }];
}

/** Échéances théoriques d'un bail pour une année, d'après le bail lui-même. */
export function echeancesTheoriques(bail, annee) {
  const lignes = [];
  const flux = fluxDuBail(bail);
  for (let mois = 1; mois <= 12; mois += 1) {
    const proportion = proportionDuMois(bail, annee, mois);
    if (proportion <= 0) continue;
    // La date d'échéance est bornée à la période réellement couverte par le
    // bail dans ce mois, pour ne pas afficher une échéance hors bail.
    let dateEcheance = isoDepuis(annee, mois, Number(bail.jourEcheance) || 1);
    const debutBail = String(bail.dateDebut || '').slice(0, 10);
    const finBail = String(bail.dateFin || '').slice(0, 10);
    if (debutBail && dateEcheance < debutBail) dateEcheance = debutBail;
    if (finBail && dateEcheance > finBail) dateEcheance = finBail;
    for (const payeur of flux) {
      const loyerHc = centimes(payeur.loyerHc * proportion);
      const charges = centimes(payeur.charges * proportion);
      lignes.push({
        // Identifiant déterministe : deux postes qui « créent » le même mois
        // visent le même enregistrement, jamais deux doublons.
        id: `${bail.id}-${annee}-${String(mois).padStart(2, '0')}${payeur.suffixe}`,
        bailId: bail.id,
        locataireId: payeur.locataireId,
        annee,
        mois,
        proportion,
        partiel: proportion < 1,
        dateEcheance,
        loyerHc,
        charges,
        autres: 0,
        total: centimes(loyerHc + charges),
      });
    }
  }
  return lignes;
}

export const totalEncaisse = (echeance) =>
  centimes((echeance?.encaissements || []).reduce((somme, e) => somme + (Number(e.montant) || 0), 0));

export function statut(echeance, dateReference = aujourdhui()) {
  const attendu = centimes(Number(echeance.total) || 0);
  const recu = totalEncaisse(echeance);
  if (attendu <= 0) return 'sans-objet';
  if (recu >= attendu - 0.01) return 'paye';
  if (recu > 0) return 'partiel';
  return echeance.dateEcheance < dateReference ? 'retard' : 'attente';
}

export const LIBELLES_STATUT = {
  paye: { texte: 'Encaissé', ton: 'succes' },
  partiel: { texte: 'Partiel', ton: 'attention' },
  retard: { texte: 'En retard', ton: 'alerte' },
  attente: { texte: 'À venir', ton: 'attente' },
  'sans-objet': { texte: '—', ton: 'attente' },
};

/**
 * Échéances d'une année pour un bail : théoriques, complétées par ce qui a
 * réellement été enregistré (montant ajusté, encaissements, quittance).
 */
export function echeancesAnnee(bail, annee, loyersEnregistres) {
  // Rapprochement par identifiant (déterministe : bail + mois + colocataire).
  const parId = new Map();
  for (const loyer of loyersEnregistres) {
    if (loyer.bailId === bail.id && Number(loyer.annee) === Number(annee)) parId.set(loyer.id, loyer);
  }
  const lignes = echeancesTheoriques(bail, annee).map((theorique) => {
    const reel = parId.get(theorique.id);
    if (!reel) return { ...theorique, encaissements: [], enregistre: false };
    parId.delete(theorique.id);
    const loyerHc = reel.loyerHc ?? theorique.loyerHc;
    const charges = reel.charges ?? theorique.charges;
    const autres = reel.autres ?? 0;
    return {
      ...theorique,
      ...reel,
      loyerHc,
      charges,
      autres,
      total: centimes(loyerHc + charges + autres),
      enregistre: true,
    };
  });
  // Mois enregistrés hors période du bail (régularisation, indemnité…) : on les garde.
  for (const reste of parId.values()) {
    const loyerHc = reste.loyerHc ?? 0;
    const charges = reste.charges ?? 0;
    const autres = reste.autres ?? 0;
    lignes.push({
      ...reste,
      proportion: 1,
      partiel: false,
      horsBail: true,
      enregistre: true,
      total: centimes(loyerHc + charges + autres),
    });
  }
  return lignes.sort((a, b) => a.mois - b.mois);
}

/** Toutes les échéances de l'année, tous baux confondus. */
export function echeancesGlobales(baux, annee, loyersEnregistres) {
  return baux.flatMap((bail) => echeancesAnnee(bail, annee, loyersEnregistres));
}

/**
 * Encaissements réellement perçus sur une année civile, ventilés entre loyer,
 * provisions pour charges et autres — au prorata de ce qui était attendu.
 */
export function encaissementsAnnee(loyersEnregistres, annee) {
  const total = { loyer: 0, charges: 0, autres: 0, total: 0 };
  for (const loyer of loyersEnregistres) {
    const attendu = (Number(loyer.loyerHc) || 0) + (Number(loyer.charges) || 0) + (Number(loyer.autres) || 0);
    for (const encaissement of loyer.encaissements || []) {
      if (anneeDe(encaissement.date) !== annee) continue;
      const recu = Number(encaissement.montant) || 0;
      total.total += recu;
      if (attendu <= 0) { total.loyer += recu; continue; }
      total.loyer += recu * ((Number(loyer.loyerHc) || 0) / attendu);
      total.charges += recu * ((Number(loyer.charges) || 0) / attendu);
      total.autres += recu * ((Number(loyer.autres) || 0) / attendu);
    }
  }
  // Répartition au centime : on arrondit le total et deux postes, le
  // troisième absorbe le reliquat pour que la somme des lignes égale le total.
  total.total = centimes(total.total);
  total.loyer = centimes(total.loyer);
  total.charges = centimes(total.charges);
  total.autres = centimes(total.total - total.loyer - total.charges);
  return total;
}

/** Ce qui était dû sur l'année (comptabilité d'engagement). */
export function creancesAnnee(baux, annee, loyersEnregistres) {
  const total = { loyer: 0, charges: 0, autres: 0, total: 0 };
  for (const echeance of echeancesGlobales(baux, annee, loyersEnregistres)) {
    total.loyer += Number(echeance.loyerHc) || 0;
    total.charges += Number(echeance.charges) || 0;
    total.autres += Number(echeance.autres) || 0;
  }
  total.total = total.loyer + total.charges + total.autres;
  for (const cle of Object.keys(total)) total[cle] = centimes(total[cle]);
  return total;
}

/** Loyer révisé selon l'IRL : loyer × (indice nouveau / indice de référence). */
export function loyerIndexe(loyerActuel, indiceReference, indiceNouveau) {
  const reference = Number(indiceReference) || 0;
  const nouveau = Number(indiceNouveau) || 0;
  if (!reference || !nouveau) return null;
  return centimes((Number(loyerActuel) || 0) * (nouveau / reference));
}
