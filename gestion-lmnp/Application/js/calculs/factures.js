// Lecture automatique des factures déposées dans le dossier « Factures ».
// Le nom du fichier est analysé pour en tirer une date, un montant, un
// fournisseur et une catégorie de charge.

import { centimes, isoDepuis } from '../format.js';

const sansAccent = (texte) => String(texte)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase();

const REGLES_CATEGORIE = [
  { categorie: 'taxe-fonciere', mots: ['taxe fonciere', 'taxes foncieres', 'impot foncier', 'tf '] },
  { categorie: 'cfe', mots: ['cfe', 'cotisation fonciere'] },
  { categorie: 'ordures', mots: ['ordures menageres', 'teom'] },
  { categorie: 'energie', mots: ['edf', 'engie', 'totalenergies', 'total energies', 'electricite', 'enedis', 'gaz', 'veolia', 'saur', 'suez', 'eau'] },
  { categorie: 'abonnements', mots: ['orange', 'sfr', 'bouygues', 'free', 'internet', 'box', 'fibre'] },
  { categorie: 'assurance-pno', mots: ['assurance', 'pno', 'maif', 'macif', 'axa', 'allianz', 'matmut', 'gmf', 'maaf', 'groupama'] },
  { categorie: 'assurance-gli', mots: ['gli', 'loyers impayes'] },
  { categorie: 'copropriete', mots: ['syndic', 'copropriete', 'charges de copro', 'foncia', 'nexity'] },
  { categorie: 'honoraires-comptables', mots: ['comptable', 'expertise comptable', 'oga', 'cga', 'liasse'] },
  { categorie: 'honoraires-gestion', mots: ['gestion locative', 'honoraires agence', 'mandat de gestion'] },
  { categorie: 'annonces', mots: ['annonce', 'leboncoin', 'seloger', 'pap '] },
  { categorie: 'frais-acquisition', mots: ['notaire', 'acte authentique'] },
  { categorie: 'frais-bancaires', mots: ['frais bancaires', 'agios', 'credit agricole', 'societe generale', 'banque populaire', 'caisse d epargne', 'lcl', 'bnp'] },
  { categorie: 'mobilier-petit', mots: ['ikea', 'conforama', 'maisons du monde', 'mobilier', 'meuble', 'literie', 'matelas', 'canape', 'darty', 'boulanger', 'electromenager', 'lave-linge', 'lave linge', 'refrigerateur', 'seche-linge'] },
  { categorie: 'entretien', mots: ['leroy merlin', 'castorama', 'brico', 'point p', 'plomberie', 'plombier', 'electricien', 'chauffagiste', 'serrurier', 'peinture', 'reparation', 'entretien', 'ramonage', 'chaudiere', 'depannage', 'menuisier', 'jardin'] },
  { categorie: 'travaux', mots: ['travaux', 'renovation', 'chantier', 'devis'] },
];

function detecterDate(texte) {
  const motifs = [
    { regex: /(20\d{2})[-_. /](\d{1,2})[-_. /](\d{1,2})(?!\d)/, ordre: [1, 2, 3] },
    { regex: /(?<!\d)(\d{1,2})[-_. /](\d{1,2})[-_. /](20\d{2})(?!\d)/, ordre: [3, 2, 1] },
    { regex: /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/, ordre: [1, 2, 3] },
    { regex: /(20\d{2})[-_. /](\d{1,2})(?!\d)/, ordre: [1, 2, null] },
  ];
  for (const motif of motifs) {
    const trouve = texte.match(motif.regex);
    if (!trouve) continue;
    const annee = Number(trouve[motif.ordre[0]]);
    const mois = Number(trouve[motif.ordre[1]]);
    const jour = motif.ordre[2] ? Number(trouve[motif.ordre[2]]) : 1;
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) continue;
    if (annee < 2000 || annee > 2100) continue;
    return { date: isoDepuis(annee, mois, jour), extrait: trouve[0], complete: motif.ordre[2] !== null };
  }
  return null;
}

function detecterMontant(texte) {
  const candidats = [];
  // Le groupe de milliers ne doit pas être collé à une lettre ni à un chiffre :
  // un « 3 » de « lot 3 » ne devient pas le millier de « 3 250 ».
  const regex = /(?<![\p{L}\d])(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:€|eur\b|euros?\b)?/giu;
  let trouve = regex.exec(texte);
  while (trouve) {
    const brut = trouve[0];
    const entier = trouve[1].replace(/[ .]/g, '');
    const decimales = trouve[2] || '';
    const valeur = Number(`${entier}.${decimales || '0'}`);
    const avecSymbole = /€|eur/i.test(brut);
    const avecDecimales = Boolean(decimales);
    // Un groupe de 6+ chiffres accolés (horodatage 20250630) n'est pas un montant.
    const horodatage = /^\d{6,}$/.test(entier);
    if (Number.isFinite(valeur) && valeur > 0 && valeur < 1000000 && !horodatage) {
      candidats.push({ valeur, avecSymbole, avecDecimales, position: trouve.index, extrait: brut.trim() });
    }
    trouve = regex.exec(texte);
  }
  if (!candidats.length) return null;
  candidats.sort((a, b) => {
    const score = (c) => (c.avecSymbole ? 4 : 0) + (c.avecDecimales ? 2 : 0);
    return (score(b) - score(a)) || (b.position - a.position);
  });
  const retenu = candidats[0];
  // Un montant est « fiable » seulement s'il porte € / EUR ou des décimales ;
  // un entier nu (millésime, numéro) ne l'est pas.
  const fiable = retenu.avecSymbole || retenu.avecDecimales;
  return { montant: centimes(retenu.valeur), extrait: retenu.extrait, fiable };
}

function detecterCategorie(texte) {
  const normalise = sansAccent(texte);
  for (const regle of REGLES_CATEGORIE) {
    // Comparaison sur frontières de mots : « eau » ne se déclenche pas sur
    // « bureau », ni « box » sur « boxer ».
    if (regle.mots.some((mot) => new RegExp(`(^|[^a-z0-9])${mot}([^a-z0-9]|$)`).test(normalise))) {
      return regle.categorie;
    }
  }
  return null;
}

/** Analyse le nom d'un fichier de facture. */
export function analyser(nomFichier) {
  const sansExtension = String(nomFichier).replace(/\.[a-z0-9]{1,5}$/i, '');
  const espace = sansExtension.replace(/[_]+/g, ' ').trim();

  // Le montant est détecté AVANT la date : sinon le motif de date partielle
  // « AAAA M » avalerait le chiffre des milliers d'un montant à espace.
  const montant = detecterMontant(espace);
  let reste = montant ? espace.replace(montant.extrait, ' ') : espace;
  const date = detecterDate(reste);
  if (date) reste = reste.replace(date.extrait, ' ');

  const fournisseur = reste
    .replace(/(^|\s)(€|eur|euros?)\b/gi, ' ')
    .replace(/[-–—.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  const categorie = detecterCategorie(espace);

  // Confiance « haute » réservée à un montant fiable (€ ou décimales) ET une
  // date complète : c'est le seuil de l'intégration automatique sans confirmation.
  let confiance = 'faible';
  if (date?.complete && montant?.fiable) confiance = 'haute';
  else if (date || montant) confiance = 'moyenne';

  return {
    date: date?.date || null,
    dateComplete: date?.complete ?? false,
    montant: montant?.montant ?? null,
    montantFiable: montant?.fiable ?? false,
    fournisseur: fournisseur || null,
    categorie,
    confiance,
    libelle: fournisseur || sansExtension.slice(0, 60),
  };
}

/** Clé stable d'une facture, indépendante de son emplacement. */
export const cleFacture = (fichier) => `facture:${fichier.nom}:${fichier.taille}`;

/** Fichiers du dossier Factures qui restent à intégrer. */
export function aTraiter(fichiersFactures, charges) {
  const cheminsRattaches = new Set(charges
    .filter((c) => c.documentChemin && (c.documentEspace || 'documents') === 'factures')
    .map((c) => c.documentChemin));
  const clesRattachees = new Set(charges.map((c) => c.cleFacture).filter(Boolean));
  return fichiersFactures
    .filter((fichier) => !fichier.chemin.startsWith('Traitées/'))
    .filter((fichier) => !cheminsRattaches.has(fichier.chemin))
    .filter((fichier) => !clesRattachees.has(cleFacture(fichier)))
    .map((fichier) => ({ fichier, analyse: analyser(fichier.nom) }));
}

/** Emplacement de rangement d'une facture intégrée. */
export const cheminRangement = (nomFichier, annee) => `Traitées/${annee}/${nomFichier}`;
