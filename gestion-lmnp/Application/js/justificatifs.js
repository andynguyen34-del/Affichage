// Justificatifs que chaque colocataire doit fournir au bailleur, d'après le
// bail (assurance des risques locatifs, art. 11) et l'entretien courant à sa
// charge (art. 8) : climatiseurs et cheminée à granulés.

export const CATEGORIES_JUSTIFICATIFS = [
  { cle: 'assurance', libelle: 'Attestation d\'assurance habitation', periodicite: 'à la remise des clés, puis chaque année' },
  { cle: 'clim', libelle: 'Entretien des climatiseurs', periodicite: 'chaque année' },
  { cle: 'ramonage', libelle: 'Ramonage de la cheminée à granulés', periodicite: 'chaque année' },
  { cle: 'autre', libelle: 'Autre justificatif', periodicite: '' },
];

export const libelleCategorie = (cle) =>
  CATEGORIES_JUSTIFICATIFS.find((c) => c.cle === cle)?.libelle || 'Justificatif';

/** Catégorie d'un fichier déposé, déduite de son chemin `…/justificatifs/{cle}/…`. */
export function categorieDuChemin(chemin) {
  const morceaux = String(chemin).split('/');
  const index = morceaux.indexOf('justificatifs');
  return (index >= 0 && morceaux[index + 1]) ? morceaux[index + 1] : 'autre';
}
