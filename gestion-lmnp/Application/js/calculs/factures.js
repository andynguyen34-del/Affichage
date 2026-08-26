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
  const regex = /(?<!\d)(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:€|eur\b|euros?\b)?/gi;
  let trouve = regex.exec(texte);
  while (trouve) {
    const brut = trouve[0];
    const entier = trouve[1].replace(/[ .]/g, '');
    const decimales = trouve[2] || '';
    const valeur = Number(`${entier}.${decimales || '0'}`);
    const avecSymbole = /€|eur/i.test(brut);
    const avecDecimales = Boolean(decimales);
    if (Number.isFinite(valeur) && valeur > 0 && valeur < 1000000) {
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
  if (!retenu.avecSymbole && !retenu.avecDecimales && retenu.valeur < 10) return null;
  return { montant: centimes(retenu.valeur), extrait: retenu.extrait };
}

function detecterCategorie(texte) {
  const normalise = sansAccent(texte);
  for (const regle of REGLES_CATEGORIE) {
    if (regle.mots.some((mot) => normalise.includes(mot))) return regle.categorie;
  }
  return null;
}

/** Analyse le nom d'un fichier de facture. */
export function analyser(nomFichier) {
  const sansExtension = String(nomFichier).replace(/\.[a-z0-9]{1,5}$/i, '');
  const espace = sansExtension.replace(/[_]+/g, ' ').trim();

  const date = detecterDate(espace);
  let reste = date ? espace.replace(date.extrait, ' ') : espace;
  const montant = detecterMontant(reste);
  if (montant) reste = reste.replace(montant.extrait, ' ');

  const fournisseur = reste
    .replace(/[€]|eur\b|euros?\b/gi, ' ')
    .replace(/[-–—.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  const categorie = detecterCategorie(espace);

  let confiance = 'faible';
  if (date && montant) confiance = 'haute';
  else if (date || montant) confiance = 'moyenne';

  return {
    date: date?.date || null,
    dateComplete: date?.complete ?? false,
    montant: montant?.montant ?? null,
    fournisseur: fournisseur || null,
    categorie,
    confiance,
    libelle: fournisseur || sansExtension.slice(0, 60),
  };
}

/** Fichiers du dossier Factures qui restent à intégrer. */
export function aTraiter(fichiersFactures, charges) {
  const dejaRattaches = new Set(charges
    .filter((c) => c.documentChemin && (c.documentEspace || 'documents') === 'factures')
    .map((c) => c.documentChemin));
  return fichiersFactures
    .filter((fichier) => !fichier.chemin.startsWith('Traitées/'))
    .filter((fichier) => !dejaRattaches.has(fichier.chemin))
    .map((fichier) => ({ fichier, analyse: analyser(fichier.nom) }));
}

/** Emplacement de rangement d'une facture intégrée. */
export const cheminRangement = (nomFichier, annee) => `Traitées/${annee}/${nomFichier}`;
