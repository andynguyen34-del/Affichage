// Mise à jour des échéances (v43) : les échéances ENREGISTRÉES (quittance
// émise, virement saisi, montant ajusté, appel de loyer…) ne suivent pas les
// modifications du bail — un colocataire retiré de la répartition, un bail
// supprimé, une part changée. Ce module compare chaque enregistrement à ce
// que le bail prévoit et propose : supprimer (échéance orpheline), réaligner
// (montant différent de la part du bail), ou conserver (elle porte un
// virement ou une quittance). Module PUR ; l'application applique ensuite.

import { echeancesTheoriques, fluxDuBail } from './loyers.js';

const centimes = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Une échéance enregistrée « protégée » : un virement ou une quittance s'y rattache. */
export function protection(loyer) {
  if ((loyer?.encaissements || []).some((e) => Number(e?.montant) > 0)) return 'virement enregistré';
  if (loyer?.quittanceEmiseLe) return 'quittance émise';
  return '';
}

/**
 * Analyse les échéances enregistrées d'un dossier.
 * Renvoie une proposition par enregistrement concerné :
 *   { id, loyer, bailId, locataireId, annee, mois, raison, action: 'supprimer'|'realigner'|'conserver',
 *     protege: '' | motif, nouveau: { loyerHc, charges } (réalignement), ancien }
 */
export function analyserEcheances({ baux = [], loyers = [] } = {}) {
  const propositions = [];
  const cacheTheoriques = new Map();
  const theoriquesDe = (bail, annee) => {
    const cle = `${bail.id}|${annee}`;
    if (!cacheTheoriques.has(cle)) cacheTheoriques.set(cle, echeancesTheoriques(bail, Number(annee)));
    return cacheTheoriques.get(cle);
  };
  for (const loyer of loyers) {
    if (!loyer || loyer.sejour || !loyer.bailId) continue;
    const protege = protection(loyer);
    const base = { id: loyer.id, loyer, bailId: loyer.bailId, locataireId: loyer.locataireId || '', annee: Number(loyer.annee), mois: Number(loyer.mois), protege };
    const bail = baux.find((b) => b.id === loyer.bailId);
    if (!bail) {
      propositions.push({ ...base, raison: 'Bail supprimé', action: protege ? 'conserver' : 'supprimer' });
      continue;
    }
    const theorique = theoriquesDe(bail, loyer.annee).find((t) => t.id === loyer.id);
    if (!theorique) {
      const surBail = fluxDuBail(bail).some((p) => p.locataireId === (loyer.locataireId || ''));
      propositions.push({ ...base, raison: surBail ? 'Mois hors période du bail' : 'Plus sur le bail', action: protege ? 'conserver' : 'supprimer' });
      continue;
    }
    const loyerHc = centimes(loyer.loyerHc ?? theorique.loyerHc);
    const charges = centimes(loyer.charges ?? theorique.charges);
    if (Math.abs(loyerHc - theorique.loyerHc) > 0.005 || Math.abs(charges - theorique.charges) > 0.005) {
      propositions.push({
        ...base,
        raison: `Part modifiée : ${(loyerHc + charges).toFixed(2)} € → ${(theorique.loyerHc + theorique.charges).toFixed(2)} €`,
        action: protege ? 'conserver' : 'realigner',
        ancien: { loyerHc, charges },
        nouveau: { loyerHc: theorique.loyerHc, charges: theorique.charges },
      });
    }
  }
  return propositions.sort((a, b) => (a.locataireId.localeCompare(b.locataireId)) || (a.annee - b.annee) || (a.mois - b.mois));
}

/** Un dépôt de garantie enregistré « protégé » : de l'argent est détenu (reçu, non restitué). */
export function protectionCaution(caution) {
  return (Number(caution?.montantRecu) || 0) > 0 && !caution?.restitueLe ? 'dépôt détenu' : '';
}

/**
 * Analyse les dépôts de garantie enregistrés : bail supprimé ou colocataire
 * retiré du bail → supprimer (conserver si de l'argent est détenu).
 */
export function analyserCautions({ baux = [], cautions = [] } = {}) {
  const propositions = [];
  for (const caution of cautions) {
    if (!caution || !caution.bailId) continue;
    const protege = protectionCaution(caution);
    const base = { id: caution.id, caution, nature: 'caution', bailId: caution.bailId, locataireId: caution.locataireId || '', annee: 0, mois: 0, protege };
    const bail = baux.find((b) => b.id === caution.bailId);
    if (!bail) { propositions.push({ ...base, raison: 'Bail supprimé', action: protege ? 'conserver' : 'supprimer' }); continue; }
    if (!fluxDuBail(bail).some((p) => p.locataireId === (caution.locataireId || ''))) {
      propositions.push({ ...base, raison: 'Plus sur le bail', action: protege ? 'conserver' : 'supprimer' });
    }
  }
  return propositions;
}

/**
 * Regroupe les propositions par colocataire, bail, action et raison, pour
 * les présenter en lignes lisibles (« sept. → déc. 2026 (4) »).
 */
export function grouperPropositions(propositions) {
  const groupes = new Map();
  for (const p of propositions) {
    const nature = p.nature || 'echeance';
    const cle = [nature, p.locataireId, p.bailId, p.action, p.raison, p.protege].join('|');
    if (!groupes.has(cle)) groupes.set(cle, { cle, nature, locataireId: p.locataireId, bailId: p.bailId, action: p.action, raison: p.raison, protege: p.protege, elements: [] });
    groupes.get(cle).elements.push(p);
  }
  return [...groupes.values()];
}

/** Compte des propositions par action. */
export function resumerPropositions(propositions) {
  const compte = { supprimer: 0, realigner: 0, conserver: 0 };
  for (const p of propositions) compte[p.action] = (compte[p.action] || 0) + 1;
  return compte;
}
