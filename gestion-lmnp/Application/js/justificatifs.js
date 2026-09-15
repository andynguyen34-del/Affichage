// Justificatifs que les colocataires doivent fournir au bailleur, d'après le
// bail (assurance des risques locatifs, art. 11) et l'entretien courant à
// leur charge (art. 8) : climatiseurs et cheminée à granulés.
//
// Depuis la v41, deux portées :
// - « personne » : chacun fournit la sienne (assurance habitation) — mais une
//   attestation d'assurance peut être déposée « pour tous les colocataires »
//   et couvre alors chacun d'eux ;
// - « logement » : un seul document pour la résidence (entretien des
//   climatiseurs, ramonage), déposé par n'importe quel colocataire.
// Les documents communs vivent dans l'espace « partage », dossier
// justificatifs/{bienId}/{catégorie}/, lisible par tous les colocataires du
// logement ; les documents personnels restent dans portail/{email}/justificatifs/.
// Module PUR (partagé entre l'application du gérant et l'espace colocataire).

export const CATEGORIES_JUSTIFICATIFS = [
  { cle: 'assurance', libelle: 'Attestation d\'assurance habitation', periodicite: 'à la remise des clés, puis chaque année', portee: 'personne', communePossible: true },
  { cle: 'clim', libelle: 'Entretien des climatiseurs', periodicite: 'chaque année', portee: 'logement' },
  { cle: 'ramonage', libelle: 'Ramonage de la cheminée à granulés', periodicite: 'chaque année', portee: 'logement' },
  { cle: 'autre', libelle: 'Autre justificatif', periodicite: '', portee: 'personne' },
];

/** Les catégories demandées (tout sauf « autre »). */
export const CATEGORIES_DEMANDEES = CATEGORIES_JUSTIFICATIFS.filter((c) => c.cle !== 'autre');

export const categorie = (cle) => CATEGORIES_JUSTIFICATIFS.find((c) => c.cle === cle) || null;
export const libelleCategorie = (cle) => categorie(cle)?.libelle || 'Justificatif';
/** Un document de cette catégorie vaut pour tout le logement. */
export const estCommune = (cle) => categorie(cle)?.portee === 'logement';

/** Catégorie d'un fichier déposé, déduite de son chemin `…/justificatifs/{cle}/…` ou `justificatifs/{bienId}/{cle}/…`. */
export function categorieDuChemin(chemin) {
  const morceaux = String(chemin).split('/');
  const index = morceaux.indexOf('justificatifs');
  if (index < 0) return 'autre';
  // Espace partage : justificatifs/{bienId}/{cle}/fichier ; espace portail : justificatifs/{cle}/fichier.
  const candidats = morceaux.slice(index + 1, -1);
  const cle = candidats.find((m) => CATEGORIES_JUSTIFICATIFS.some((c) => c.cle === m));
  return cle || 'autre';
}

/** Dossier, dans l'espace « partage », des justificatifs communs d'un logement. */
export const prefixeCommun = (bienId) => `justificatifs/${bienId}`;

const HORODATAGE = /^(\d{4}-\d{2}-\d{2})T?[\d-]*/;

/**
 * Nom d'un document commun déposé : « AAAA-MM-JJTHH-MM-SS Prénom - fichier.pdf »
 * (ou « … Prénom.jpg » pour une photo) : le prénom du déposant reste lisible.
 */
export function nomDepotCommun(horodatage, prenom, nomFichier = '') {
  const qui = String(prenom || '').trim().replace(/[\\/:*?"<>|]/g, '-') || 'colocataire';
  return nomFichier ? `${horodatage} ${qui} - ${nomFichier}` : `${horodatage} ${qui}.jpg`;
}

/** Qui a déposé un document commun et quand : { par, le } (le : AAAA-MM-JJ). */
export function infoDepot(fichier) {
  const nom = String(fichier?.nom || String(fichier?.chemin || '').split('/').pop() || '');
  const le = (nom.match(HORODATAGE) || [])[1] || String(fichier?.modifie || '').slice(0, 10) || '';
  const reste = nom.replace(HORODATAGE, '').trim();
  const par = reste.includes(' - ') ? reste.split(' - ')[0].trim() : reste.replace(/\.[a-z0-9]+$/i, '').trim();
  return { par, le };
}

/** Classe des fichiers par catégorie : Map cle → [fichiers]. */
export function classerParCategorie(fichiers) {
  const parCategorie = new Map();
  for (const fichier of fichiers || []) {
    const cle = categorieDuChemin(fichier.chemin);
    if (!parCategorie.has(cle)) parCategorie.set(cle, []);
    parCategorie.get(cle).push(fichier);
  }
  return parCategorie;
}

/**
 * Bilan des justificatifs d'un logement.
 *   communs     : fichiers du dossier partagé du logement
 *   personnels  : [{ id, parCategorie }] — un par colocataire (fichiers de son espace)
 * Renvoie :
 *   logement    : { parCategorie: Map cle → [{ fichier, par, le, personnel }], manquants: [catégories] }
 *   parPersonne : Map id → { parCategorie, manquants: [catégories], couvertPar: fichier|null }
 * Un document d'entretien ou de ramonage déposé dans un espace personnel
 * (avant la v41) compte pour le logement.
 */
export function bilanJustificatifs({ communs = [], personnels = [] } = {}) {
  const logement = new Map();
  const ajouter = (cle, entree) => { if (!logement.has(cle)) logement.set(cle, []); logement.get(cle).push(entree); };
  for (const fichier of communs) {
    const { par, le } = infoDepot(fichier);
    ajouter(categorieDuChemin(fichier.chemin), { fichier, par, le, personnel: false });
  }
  for (const { nom, parCategorie } of personnels) {
    for (const [cle, fichiers] of parCategorie.entries()) {
      if (!estCommune(cle)) continue;
      for (const fichier of fichiers) ajouter(cle, { fichier, par: nom || '', le: String(fichier.modifie || '').slice(0, 10), personnel: true });
    }
  }
  for (const liste of logement.values()) liste.sort((a, b) => String(b.le).localeCompare(String(a.le)));
  const manquantsLogement = CATEGORIES_DEMANDEES.filter((c) => c.portee === 'logement' && !(logement.get(c.cle) || []).length);

  const parPersonne = new Map();
  for (const { id, parCategorie } of personnels) {
    const manquants = [];
    let couvertPar = null;
    for (const c of CATEGORIES_DEMANDEES.filter((x) => x.portee === 'personne')) {
      if ((parCategorie.get(c.cle) || []).length) continue;
      const commun = c.communePossible ? (logement.get(c.cle) || [])[0] : null;
      if (commun) { couvertPar = commun; continue; }
      manquants.push(c);
    }
    parPersonne.set(id, { parCategorie, manquants, couvertPar });
  }
  return { logement: { parCategorie: logement, manquants: manquantsLogement }, parPersonne };
}
