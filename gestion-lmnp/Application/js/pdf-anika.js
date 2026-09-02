// Documents PDF à l'identité visuelle ANIKA : quittance de loyer,
// régularisation des charges, restitution du dépôt de garantie.
// Mise en page reproduite depuis les gabarits fournis (anika-documents) :
// polices Italiana et Jura, cachet, page A4 unique, pied de page de marque.

import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { octetsItaliana, octetsJuraLight, octetsJuraMedium, octetsCachet } from './anika-actifs.js';

const mm = (v) => v * 2.83465;
const PAGE = { l: 595.28, h: 841.89 };
const MARGE = { haut: mm(18), cote: mm(20), bas: mm(14) };
const LARGEUR = PAGE.l - 2 * MARGE.cote;

const ENCRE = rgb(0x16 / 255, 0x16 / 255, 0x16 / 255);
const SECONDAIRE = rgb(0x3a / 255, 0x3a / 255, 0x3a / 255);
const DISCRET = rgb(0x8a / 255, 0x8a / 255, 0x8a / 255);
const TRES_DISCRET = rgb(0x9a / 255, 0x9a / 255, 0x9a / 255);
const TRAIT_FIN = rgb(0xe3 / 255, 0xe3 / 255, 0xe3 / 255);
const ROUGE = rgb(0x8a / 255, 0x1f / 255, 0x1f / 255);

/** Montant au format français : « 1 234,56 € ». */
export const eur = (valeur) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
  .format(Number(valeur) || 0).replace(/[  ]/g, ' ');

/** Date longue française : « 2 septembre 2026 », avec l'exception « 1er ». */
export function dateLongueFr(iso) {
  const [a, m, j] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !j) return String(iso || '');
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`;
}

const propre = (texte) => String(texte ?? '').replace(/[  ]/g, ' ').replace(/’/g, '\'');

/** SIREN (9 chiffres, groupes par 3) depuis le SIRET des parametres ; '' si absent. */
export function sirenDepuisSiret(siret) {
  const chiffres = String(siret || '').replace(/\D/g, '').slice(0, 9);
  return chiffres.length === 9 ? chiffres.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : '';
}

/** Nombre de mois civils couverts (bornes incluses), pour la mention (12 mois). */
export function nbMoisEntre(debut, fin) {
  const d = new Date(`${String(debut).slice(0, 10)}T12:00:00`);
  const f = new Date(`${String(fin).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return 12;
  const jours = (f - d) / 86400000 + 1;
  return Math.max(1, Math.round(jours / 30.437));
}

async function preparer() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const polices = {
    italiana: await doc.embedFont(octetsItaliana(), { subset: true }),
    light: await doc.embedFont(octetsJuraLight(), { subset: true }),
    medium: await doc.embedFont(octetsJuraMedium(), { subset: true }),
  };
  const cachet = await doc.embedPng(octetsCachet());
  const page = doc.addPage([PAGE.l, PAGE.h]);
  return { doc, page, polices, cachet };
}

/** Texte avec interlettrage (les libellés « L O U E U R … » des gabarits). */
function texteEspace(page, police, texte, taille, x, y, ecart, couleur) {
  let cx = x;
  for (const caractere of propre(texte)) {
    page.drawText(caractere, { x: cx, y, size: taille, font: police, color: couleur });
    cx += police.widthOfTextAtSize(caractere, taille) + ecart;
  }
  return cx - ecart - x;
}

const largeurEspacee = (police, texte, taille, ecart) => {
  const caracteres = [...propre(texte)];
  return caracteres.reduce((s, c) => s + police.widthOfTextAtSize(c, taille), 0)
    + ecart * Math.max(0, caracteres.length - 1);
};

/** Découpe un paragraphe en lignes tenant dans `largeur`. */
function enLignes(police, texte, taille, largeur) {
  const lignes = [];
  let ligne = '';
  for (const mot of propre(texte).split(/\s+/).filter(Boolean)) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (police.widthOfTextAtSize(essai, taille) > largeur && ligne) { lignes.push(ligne); ligne = mot; }
    else ligne = essai;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

function contexteDessin(page, polices) {
  const c = {
    y: PAGE.h - MARGE.haut,
    texte(texte, { taille = 9.5, police = polices.light, couleur = ENCRE, x = MARGE.cote, interligne = 1.5, largeur = LARGEUR } = {}) {
      for (const ligne of enLignes(police, texte, taille, largeur)) {
        c.y -= taille * interligne;
        page.drawText(ligne, { x, y: c.y, size: taille, font: police, color: couleur });
      }
    },
    droite(texte, taille, police, couleur, y) {
      const largeurTexte = police.widthOfTextAtSize(propre(texte), taille);
      page.drawText(propre(texte), { x: PAGE.l - MARGE.cote - largeurTexte, y, size: taille, font: police, color: couleur });
    },
    trait(couleur, epaisseur = 0.7) {
      page.drawLine({
        start: { x: MARGE.cote, y: c.y }, end: { x: PAGE.l - MARGE.cote, y: c.y },
        thickness: epaisseur, color: couleur,
      });
    },
  };
  return c;
}

/** En-tête commun : marque à gauche, nature du document et période à droite. */
function entete(page, polices, c, nature, periode) {
  const yMarque = c.y - 27;
  texteEspace(page, polices.italiana, 'ANIKA', 27, MARGE.cote, yMarque, 4, ENCRE);
  texteEspace(page, polices.medium, 'LOUEUR MEUBLÉ NON PROFESSIONNEL', 7.2, MARGE.cote, yMarque - 16, 1.8, DISCRET);
  texteEspace(page, polices.medium, 'SAINT MARTIN DE LONDRES', 7.2, MARGE.cote, yMarque - 27, 1.8, DISCRET);

  const largeurNature = largeurEspacee(polices.medium, nature, 7.3, 2.2);
  texteEspace(page, polices.medium, nature, 7.3, PAGE.l - MARGE.cote - largeurNature, c.y - 12, 2.2, ENCRE);
  c.droite(periode, 9.3, polices.light, SECONDAIRE, c.y - 28);

  c.y -= 58;
  c.trait(ENCRE, 1);
  c.y -= 24;
}

function titre(page, polices, c, texte, sousTexte) {
  c.y -= 18;
  page.drawText(propre(texte), { x: MARGE.cote, y: c.y, size: 18, font: polices.italiana, color: ENCRE });
  c.y -= 16;
  page.drawText(propre(sousTexte), { x: MARGE.cote, y: c.y, size: 9.4, font: polices.light, color: SECONDAIRE });
  c.y -= 22;
}

/** Blocs BAILLEUR / LOCATAIRE sur deux colonnes. */
function parties(page, polices, c, bailleur, locataireNom, logement) {
  const x2 = MARGE.cote + LARGEUR * 0.5;
  const yDepart = c.y;
  const lignesBailleur = [
    bailleur.nom,
    ...String(bailleur.adresse || '').split('\n').map((l) => l.trim()).filter(Boolean),
    bailleur.email || null,
    bailleur.siren ? `SIREN ${bailleur.siren}` : null,
  ].filter(Boolean);
  const lignesLocataire = [
    locataireNom,
    logement.adresse,
    `${logement.codePostal || ''} ${logement.ville || ''}`.trim(),
  ].filter(Boolean);

  const colonne = (x, etiquette, lignes, etiquetteFinale) => {
    let y = yDepart;
    texteEspace(page, polices.medium, etiquette, 7.2, x, y, 1.6, DISCRET);
    y -= 16;
    lignes.forEach((ligne, index) => {
      page.drawText(propre(ligne), {
        x, y, size: index === 0 ? 10.4 : 9.4,
        font: index === 0 ? polices.medium : polices.light,
        color: index === 0 ? ENCRE : SECONDAIRE,
      });
      y -= index === 0 ? 15 : 13;
    });
    if (etiquetteFinale) { texteEspace(page, polices.medium, etiquetteFinale, 6.8, x, y, 1.4, TRES_DISCRET); y -= 13; }
    return y;
  };

  const y1 = colonne(MARGE.cote, 'BAILLEUR', lignesBailleur, null);
  const y2 = colonne(x2, 'LOCATAIRE', lignesLocataire, 'ADRESSE DU LOGEMENT LOUÉ');
  c.y = Math.min(y1, y2) - 14;
}

/**
 * Tableau des montants. lignes : { type: 'ligne'|'section'|'sousTotal'|'total',
 * libelle, montant?, negatif? }.
 */
function tableauMontants(page, polices, c, lignes) {
  for (const ligne of lignes) {
    if (ligne.type === 'section') {
      c.y -= 20;
      texteEspace(page, polices.medium, ligne.libelle, 7.1, MARGE.cote, c.y, 1.6, TRES_DISCRET);
      c.y -= 8;
      continue;
    }
    const total = ligne.type === 'total';
    const sousTotal = ligne.type === 'sousTotal';
    if (total) { c.y -= 10; c.trait(ENCRE, 1.1); }
    c.y -= total ? 20 : 18;
    const policeLibelle = total ? polices.medium : polices.light;
    const tailleLibelle = total ? 10.6 : 9.5;
    page.drawText(propre(ligne.libelle), { x: MARGE.cote, y: c.y, size: tailleLibelle, font: policeLibelle, color: ENCRE });
    const texteMontant = `${ligne.negatif ? '- ' : ''}${eur(ligne.montant)}`;
    c.droite(texteMontant, total ? 11 : (sousTotal ? 9.8 : 9.6), polices.medium, ligne.negatif ? ROUGE : ENCRE, c.y);
    c.y -= 8;
    if (!total) c.trait(sousTotal ? DISCRET : TRAIT_FIN, sousTotal ? 0.9 : 0.7);
  }
  c.y -= 12;
}

function attestation(page, polices, c, texte) {
  c.y -= 8;
  c.texte(texte, { taille: 9.5, police: polices.light, couleur: ENCRE, interligne: 1.55 });
}

function noteLegale(page, polices, c, texte) {
  c.y -= 8;
  c.texte(texte, { taille: 7.5, police: polices.light, couleur: TRES_DISCRET, interligne: 1.5 });
}

function signature(page, polices, c, cachet, lieu, dateSignature, nomBailleur) {
  c.y -= 34;
  const yHautBloc = c.y;
  page.drawText(propre(`${lieu ? `${lieu}, le ` : 'Le '}${dateSignature}`), {
    x: MARGE.cote, y: c.y, size: 9.4, font: polices.light, color: ENCRE,
  });
  c.y -= 22;
  page.drawLine({
    start: { x: MARGE.cote, y: c.y }, end: { x: MARGE.cote + mm(60), y: c.y },
    thickness: 0.8, color: ENCRE,
  });
  c.y -= 16;
  page.drawText(propre(nomBailleur || ''), { x: MARGE.cote, y: c.y, size: 10.2, font: polices.medium, color: ENCRE });

  const cote = mm(26);
  page.drawImage(cachet, {
    x: PAGE.l - MARGE.cote - cote,
    y: yHautBloc - cote + 10,
    width: cote, height: cote,
    rotate: degrees(-7), opacity: 0.92,
  });
}

function piedDePage(page, polices) {
  const texte = 'ANIKA · LOUEUR MEUBLÉ NON PROFESSIONNEL · SAINT MARTIN DE LONDRES';
  const largeurTexte = largeurEspacee(polices.light, texte, 7.2, 1.2);
  texteEspace(page, polices.light, texte, 7.2, (PAGE.l - largeurTexte) / 2, MARGE.bas - 6, 1.2, TRES_DISCRET);
}

const prenomMoisMajuscule = (libelle) => libelle.charAt(0).toUpperCase() + libelle.slice(1);

// -------------------------------------------------------------- documents

/** Quittance de loyer ANIKA. */
export async function pdfQuittanceAnika({ bailleur, locataireNom, logement, periodeLibelle,
  periodeDebut, periodeFin, loyerHc, charges, lieu, dateSignature }) {
  const { doc, page, polices, cachet } = await preparer();
  const c = contexteDessin(page, polices);

  entete(page, polices, c, 'QUITTANCE DE LOYER', prenomMoisMajuscule(periodeLibelle));
  titre(page, polices, c, 'Quittance de loyer', `Période du ${periodeDebut} au ${periodeFin}`);
  parties(page, polices, c, bailleur, locataireNom, logement);

  const total = Math.round(((Number(loyerHc) || 0) + (Number(charges) || 0)) * 100) / 100;
  tableauMontants(page, polices, c, [
    { type: 'ligne', libelle: 'Loyer hors charges', montant: loyerHc },
    { type: 'ligne', libelle: 'Provision pour charges', montant: charges },
    { type: 'total', libelle: 'Total', montant: total },
  ]);

  attestation(page, polices, c,
    `Je soussigné ${bailleur.nom}, bailleur du logement désigné ci-dessus, déclare avoir reçu de ${locataireNom} `
    + `la somme de ${eur(total)} au titre du loyer et des charges pour la période du ${periodeDebut} au `
    + `${periodeFin}, et lui en donne quittance, sous réserve de tous mes droits.`);
  noteLegale(page, polices, c,
    'Cette quittance annule tous les reçus qui auraient pu être établis précédemment pour la même période. '
    + 'Elle est délivrée sous réserve d\'encaissement définitif des sommes versées.');
  signature(page, polices, c, cachet, lieu, dateSignature, bailleur.nom);
  piedDePage(page, polices);
  return doc.save();
}

/** Régularisation des charges locatives ANIKA (décompte d'un colocataire). */
export async function pdfRegularisationAnika({ bailleur, locataireNom, logement, anneeLibelle,
  periodeDebut, periodeFin, nbMois, provisionsVersees, charges, lieu, dateSignature }) {
  const { doc, page, polices, cachet } = await preparer();
  const c = contexteDessin(page, polices);

  entete(page, polices, c, 'RÉGULARISATION DES CHARGES', anneeLibelle);
  titre(page, polices, c, 'Régularisation des charges locatives', `Période de référence du ${periodeDebut} au ${periodeFin}`);
  parties(page, polices, c, bailleur, locataireNom, logement);

  const chargesTotal = Math.round(charges.reduce((s, l) => s + (Number(l.montant) || 0), 0) * 100) / 100;
  const solde = Math.round((chargesTotal - (Number(provisionsVersees) || 0)) * 100) / 100;
  const soldeAbs = Math.abs(solde);
  const soldeLibelle = solde > 0.004 ? 'complément dû par le locataire'
    : (solde < -0.004 ? 'trop-perçu à rembourser au locataire' : 'aucune régularisation');
  const soldePhrase = solde > 0.004 ? `un complément de ${eur(soldeAbs)} dû par le locataire`
    : (solde < -0.004 ? `un trop-perçu de ${eur(soldeAbs)} à rembourser au locataire` : 'aucun complément ni trop-perçu');

  tableauMontants(page, polices, c, [
    { type: 'section', libelle: 'PROVISIONS VERSÉES' },
    { type: 'ligne', libelle: `Provisions pour charges (${nbMois} mois)`, montant: provisionsVersees },
    { type: 'section', libelle: 'CHARGES RÉELLES CONSTATÉES' },
    ...charges.map((l) => ({ type: 'ligne', libelle: l.libelle, montant: l.montant })),
    { type: 'sousTotal', libelle: 'Total des charges réelles', montant: chargesTotal },
    { type: 'total', libelle: `Solde — ${soldeLibelle}`, montant: soldeAbs },
  ]);

  attestation(page, polices, c,
    `Je soussigné ${bailleur.nom}, bailleur du logement désigné ci-dessus, ai procédé à la régularisation `
    + `annuelle des charges locatives pour la période du ${periodeDebut} au ${periodeFin}. Les provisions `
    + `versées par ${locataireNom} s'élèvent à ${eur(provisionsVersees)}, pour des charges réelles constatées `
    + `de ${eur(chargesTotal)}, soit ${soldePhrase}.`);
  noteLegale(page, polices, c,
    'Conformément à l\'article 23 de la loi n°89-462 du 6 juillet 1989, le présent décompte accompagné du '
    + 'détail par nature de charges est tenu à disposition du locataire pendant six mois à compter de son '
    + 'envoi. Un mois au moins avant l\'envoi, le bailleur informe le locataire des modalités de consultation '
    + 'des pièces justificatives.');
  signature(page, polices, c, cachet, lieu, dateSignature, bailleur.nom);
  piedDePage(page, polices);
  return doc.save();
}

/** Restitution du dépôt de garantie ANIKA. */
export async function pdfRestitutionAnika({ bailleur, locataireNom, logement, entreeLe,
  edlSortieLe, depotVerse, retenues, modeRestitution, lieu, dateSignature }) {
  const { doc, page, polices, cachet } = await preparer();
  const c = contexteDessin(page, polices);

  entete(page, polices, c, 'RESTITUTION DE DÉPÔT DE GARANTIE', 'Fin de bail');
  titre(page, polices, c, 'Restitution du dépôt de garantie',
    `Décompte établi à la suite de l'état des lieux de sortie du ${edlSortieLe}`);
  parties(page, polices, c, bailleur, locataireNom, logement);

  // Bandeau d'informations : entrée, état des lieux de sortie, dépôt versé.
  const colonnes = [
    ['ENTRÉE DANS LES LIEUX', entreeLe],
    ['ÉTAT DES LIEUX DE SORTIE', edlSortieLe],
    ['DÉPÔT DE GARANTIE VERSÉ', eur(depotVerse)],
  ];
  const largeurColonne = LARGEUR / 3;
  colonnes.forEach(([etiquette, valeur], index) => {
    const x = MARGE.cote + index * largeurColonne;
    texteEspace(page, polices.medium, etiquette, 7.1, x, c.y, 1.5, TRES_DISCRET);
    page.drawText(propre(valeur), { x, y: c.y - 15, size: 9.8, font: polices.medium, color: ENCRE });
  });
  c.y -= 34;

  const avecRetenues = (retenues || []).length > 0;
  const retenuesTotal = Math.round((retenues || []).reduce((s, r) => s + (Number(r.montant) || 0), 0) * 100) / 100;
  const restitue = Math.round(((Number(depotVerse) || 0) - retenuesTotal) * 100) / 100;

  tableauMontants(page, polices, c, [
    { type: 'ligne', libelle: 'Dépôt de garantie versé à l\'entrée', montant: depotVerse },
    ...(avecRetenues ? [
      { type: 'section', libelle: 'RETENUES CONSTATÉES À L\'ÉTAT DES LIEUX DE SORTIE' },
      ...retenues.map((r) => ({ type: 'ligne', libelle: r.libelle, montant: r.montant, negatif: true })),
      { type: 'sousTotal', libelle: 'Sous-total des retenues', montant: retenuesTotal, negatif: true },
    ] : []),
    { type: 'total', libelle: 'Montant restitué au locataire', montant: restitue },
  ]);

  attestation(page, polices, c,
    `Je soussigné ${bailleur.nom}, bailleur du logement désigné ci-dessus, atteste que le dépôt de garantie `
    + `versé par ${locataireNom} à son entrée dans les lieux s'élevait à ${eur(depotVerse)}. `
    + (avecRetenues
      ? `Après déduction des retenues justifiées ci-dessus, le solde de ${eur(restitue)} lui sera restitué par ${modeRestitution}.`
      : `Aucune retenue n'ayant été constatée, ce montant lui sera intégralement restitué par ${modeRestitution}.`));
  noteLegale(page, polices, c,
    'Conformément à l\'article 22 de la loi n°89-462 du 6 juillet 1989, ce solde est restitué dans un délai '
    + `maximal de ${avecRetenues ? 'deux mois' : 'un mois'} à compter de la remise des clés`
    + (avecRetenues ? ', les retenues étant justifiées par l\'état des lieux de sortie.' : '.'));
  signature(page, polices, c, cachet, lieu, dateSignature, bailleur.nom);
  piedDePage(page, polices);
  return doc.save();
}
