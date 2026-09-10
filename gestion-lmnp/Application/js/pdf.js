// Documents PDF générés par l'application : quittance de loyer et rapport
// d'état des lieux avec reportage photo et signatures.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { montant, dateLongue, nomMois } from './format.js';

const A4 = { largeur: 595.28, hauteur: 841.89 };
const MARGE = 50;
const ENCRE = rgb(0.09, 0.13, 0.17);
const DOUX = rgb(0.36, 0.42, 0.48);
const TRAIT = rgb(0.78, 0.82, 0.85);
const VERT = rgb(0.12, 0.44, 0.33);

/** Remplace les caractères hors WinAnsi (l'encodage des polices standard). */
const sur = (texte) => String(texte ?? '')
  .replace(/’/g, "'").replace(/–|—/g, '-')
  .replace(/ | /g, ' ').replace(/[«»]/g, '"')
  .replace(/[^\x20-\x7E¡-ÿ€]/g, '');

class Page {
  constructor(document_, polices) {
    this.doc = document_;
    this.polices = polices;
    this.page = document_.addPage([A4.largeur, A4.hauteur]);
    this.y = A4.hauteur - MARGE;
  }

  besoin(hauteur) {
    if (this.y - hauteur < MARGE) {
      this.page = this.doc.addPage([A4.largeur, A4.hauteur]);
      this.y = A4.hauteur - MARGE;
    }
  }

  texte(contenu, { taille = 10.5, police = 'normale', couleur = ENCRE, x = MARGE, interligne = 1.45, largeur = A4.largeur - 2 * MARGE } = {}) {
    const fonte = this.polices[police];
    const mots = sur(contenu).split(/\s+/).filter(Boolean);
    let ligne = '';
    const lignes = [];
    for (const mot of mots) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (fonte.widthOfTextAtSize(essai, taille) > largeur && ligne) { lignes.push(ligne); ligne = mot; }
      else ligne = essai;
    }
    if (ligne) lignes.push(ligne);
    if (!lignes.length) lignes.push('');
    for (const l of lignes) {
      this.besoin(taille * interligne);
      this.y -= taille * interligne;
      this.page.drawText(l, { x, y: this.y, size: taille, font: fonte, color: couleur });
    }
  }

  titre(contenu) {
    this.espace(6);
    this.texte(contenu, { taille: 16, police: 'grasse' });
    this.espace(4);
  }

  sousTitre(contenu) {
    this.espace(8);
    this.texte(contenu, { taille: 12, police: 'grasse', couleur: VERT });
    this.espace(2);
  }

  espace(hauteur = 8) { this.y -= hauteur; }

  trait() {
    this.besoin(10);
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGE, y: this.y }, end: { x: A4.largeur - MARGE, y: this.y },
      thickness: 0.7, color: TRAIT,
    });
    this.y -= 6;
  }

  ligneMontant(libelle, valeur, { grasse = false } = {}) {
    const police = grasse ? 'grasse' : 'normale';
    this.besoin(18);
    this.y -= 16;
    this.page.drawText(sur(libelle), { x: MARGE, y: this.y, size: 10.5, font: this.polices[police], color: ENCRE });
    const texteValeur = sur(valeur);
    const largeurValeur = this.polices[police].widthOfTextAtSize(texteValeur, 10.5);
    this.page.drawText(texteValeur, {
      x: A4.largeur - MARGE - largeurValeur, y: this.y, size: 10.5, font: this.polices[police], color: ENCRE,
    });
  }

  async image(donnees, { largeurMax, hauteurMax, x = MARGE, legende = '' } = {}) {
    let image;
    try {
      image = donnees.startsWith?.('data:image/png') || donnees.type === 'png'
        ? await this.doc.embedPng(donnees.octets || donnees)
        : await this.doc.embedJpg(donnees.octets || donnees);
    } catch {
      try { image = await this.doc.embedPng(donnees.octets || donnees); }
      catch { return; }
    }
    const echelle = Math.min(largeurMax / image.width, hauteurMax / image.height, 1);
    const l = image.width * echelle;
    const h = image.height * echelle;
    this.besoin(h + (legende ? 16 : 6));
    this.y -= h;
    this.page.drawImage(image, { x, y: this.y, width: l, height: h });
    if (legende) {
      this.y -= 12;
      this.page.drawText(sur(legende), { x, y: this.y, size: 8.5, font: this.polices.normale, color: DOUX });
    }
    this.y -= 6;
  }
}

async function nouvellePage() {
  const document_ = await PDFDocument.create();
  const polices = {
    normale: await document_.embedFont(StandardFonts.Helvetica),
    grasse: await document_.embedFont(StandardFonts.HelveticaBold),
  };
  return { document_, page: new Page(document_, polices) };
}

function blocParties(page, bailleur, locataire, bien) {
  page.texte('BAILLEUR', { taille: 8.5, couleur: DOUX, police: 'grasse' });
  page.texte(bailleur?.nom || '-', { police: 'grasse' });
  for (const ligne of String(bailleur?.adresse || '').split('\n').filter(Boolean)) page.texte(ligne);
  if (bailleur?.email) page.texte(bailleur.email, { couleur: DOUX });
  page.espace(8);
  page.texte('LOCATAIRE', { taille: 8.5, couleur: DOUX, police: 'grasse' });
  page.texte(locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : '-', { police: 'grasse' });
  const adresse = [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean);
  for (const ligne of adresse) page.texte(ligne);
}

/**
 * Quittance de loyer d'un colocataire pour un mois. Renvoie les octets du PDF.
 */
export async function pdfQuittance({ bailleur, locataire, bien, echeance, periode, dateReglement, lieu }) {
  const { document_, page } = await nouvellePage();

  blocParties(page, bailleur, locataire, bien);
  page.titre(`Quittance de loyer - ${nomMois(echeance.mois)} ${echeance.annee}`);
  page.texte(`Période : ${periode}`);
  page.trait();
  page.ligneMontant('Loyer hors charges', montant(echeance.loyerHc || 0));
  page.ligneMontant('Provision pour charges', montant(echeance.charges || 0));
  if (echeance.autres) page.ligneMontant('Autres sommes dues', montant(echeance.autres));
  page.trait();
  page.ligneMontant('Total', montant(echeance.total || 0), { grasse: true });
  page.espace(14);
  page.texte(
    `Je soussigné${bailleur?.feminin ? 'e' : ''} ${bailleur?.nom}, bailleur du logement désigné ci-dessus, `
    + `déclare avoir reçu de ${locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'le locataire'} `
    + `la somme de ${montant(echeance.total || 0)} au titre du loyer et des charges pour la période ${periode}, `
    + 'et lui en donne quittance, sous réserve de tous mes droits.',
  );
  page.espace(10);
  page.texte(
    'Cette quittance annule tous les reçus qui auraient pu être établis précédemment pour la même période. '
    + 'Elle est délivrée sous réserve d\'encaissement définitif des sommes versées.',
    { taille: 8.5, couleur: DOUX },
  );
  page.espace(18);
  page.texte(`${lieu ? `${lieu}, le ` : 'Le '}${dateLongue(dateReglement)}`);
  page.texte(bailleur?.nom || '', { police: 'grasse' });

  return document_.save();
}

/**
 * Décompte de régularisation des charges d'un colocataire : dépenses réelles
 * de la période, provisions versées, quote-part et solde.
 */
export async function pdfRegularisation({ bailleur, locataire, bien, debut, fin, depenses, totalReel, ligne, lieu }) {
  const { document_, page } = await nouvellePage();

  blocParties(page, bailleur, locataire, bien);
  page.titre('Décompte de régularisation des charges');
  page.texte(`Période : du ${dateLongue(debut)} au ${dateLongue(fin)}`);
  page.trait();

  page.sousTitre('Dépenses récupérables réellement payées sur la période');
  for (const depense of depenses || []) page.ligneMontant(depense.libelle, montant(depense.montant));
  page.trait();
  page.ligneMontant('Total des dépenses récupérables', montant(totalReel || 0), { grasse: true });

  page.sousTitre('Votre situation');
  page.ligneMontant('Provisions pour charges prévues sur la période', montant(ligne.prevu || 0));
  page.ligneMontant('Provisions réellement versées avec vos loyers', montant(ligne.encaisse || 0));
  page.ligneMontant('Votre quote-part des dépenses réelles', montant(ligne.part || 0));
  page.trait();
  const solde = Number(ligne.solde) || 0;
  page.ligneMontant('Solde de la régularisation', montant(solde), { grasse: true });
  page.espace(10);
  if (solde > 0.005) {
    page.texte(`Vos provisions excèdent votre quote-part des dépenses réelles : un trop-perçu de ${montant(solde)} `
      + 'vous est remboursé.');
  } else if (solde < -0.005) {
    page.texte(`Vos provisions n'ont pas couvert votre quote-part des dépenses réelles : un complément de `
      + `${montant(-solde)} reste à régler.`);
  } else {
    page.texte('Vos provisions couvrent exactement votre quote-part : le décompte est équilibré.');
  }
  page.espace(8);
  page.texte(
    'La quote-part est calculée au prorata des provisions prévues de chaque colocataire sur la période, '
    + 'ce qui tient compte des arrivées et départs en cours de période. Les justificatifs des dépenses '
    + '(factures d\'eau, avis de taxe foncière) sont tenus à votre disposition.',
    { taille: 8.5, couleur: DOUX },
  );
  page.espace(18);
  page.texte(`${lieu ? `${lieu}, le ` : 'Le '}${dateLongue(new Date().toISOString().slice(0, 10))}`);
  page.texte(bailleur?.nom || '', { police: 'grasse' });

  return document_.save();
}

const LIBELLES_ETAT = { neuf: 'Neuf', 'tres-bon': 'Très bon état', bon: 'Bon état', usage: 'État d\'usage', mauvais: 'Mauvais état' };

/**
 * Rapport d'état des lieux : informations, pièces avec photos, compteurs,
 * clés, observations et signatures. `photosParPiece` associe l'identifiant de
 * chaque pièce à ses photos déjà chargées ({octets, legende}) ;
 * `photosParMeuble` fait de même pour chaque meuble de l'inventaire.
 */
const LARGEUR = A4.largeur - 2 * MARGE;
const VERT_CLAIR = rgb(0.90, 0.95, 0.94);
const GRIS_CLAIR = rgb(0.96, 0.97, 0.98);

/** Coupe un texte en lignes qui tiennent dans `largeur`. */
function couper(fonte, texte, taille, largeur) {
  const mots = sur(texte).split(/\s+/).filter(Boolean);
  const lignes = [];
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (fonte.widthOfTextAtSize(essai, taille) > largeur && ligne) { lignes.push(ligne); ligne = mot; } else ligne = essai;
  }
  if (ligne) lignes.push(ligne);
  return lignes.length ? lignes : [''];
}

/** Texte tronqué avec « … » pour tenir dans `largeur`. */
function tronquer(fonte, texte, taille, largeur) {
  let t = sur(texte);
  if (fonte.widthOfTextAtSize(t, taille) <= largeur) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}...`, taille) > largeur) t = t.slice(0, -1);
  return `${t}...`;
}

/**
 * Bande de titre d'une pièce : fond vert clair, titre à gauche, mention à droite.
 * Reste solidaire du début de son contenu (`besoin`).
 */
function bande(page, titre, droite = '', { besoin = 60 } = {}) {
  page.besoin(besoin);
  page.y -= 6;
  const h = 17;
  page.page.drawRectangle({ x: MARGE, y: page.y - h + 4, width: LARGEUR, height: h, color: VERT_CLAIR });
  page.page.drawText(sur(titre), { x: MARGE + 6, y: page.y - h + 9, size: 10.5, font: page.polices.grasse, color: VERT });
  if (droite) {
    const texte = tronquer(page.polices.normale, droite, 8.5, LARGEUR * 0.55);
    const l = page.polices.normale.widthOfTextAtSize(texte, 8.5);
    page.page.drawText(texte, { x: MARGE + LARGEUR - 6 - l, y: page.y - h + 9.5, size: 8.5, font: page.polices.normale, color: DOUX });
  }
  page.y -= h + 2;
}

/**
 * Tableau compact : en-tête gris, lignes fines, texte replié par cellule.
 * `colonnes` : [{ titre, largeur (fraction de la largeur utile), gras }].
 */
function tableau(page, colonnes, lignes, { taille = 8.8 } = {}) {
  const largeurs = colonnes.map((c) => c.largeur * LARGEUR);
  const interligne = taille * 1.3;
  const dessinerEntete = () => {
    page.besoin(14);
    page.page.drawRectangle({ x: MARGE, y: page.y - 12, width: LARGEUR, height: 12, color: GRIS_CLAIR });
    let x = MARGE;
    colonnes.forEach((c, i) => {
      page.page.drawText(sur(c.titre).toUpperCase(), { x: x + 3, y: page.y - 9, size: 6.8, font: page.polices.grasse, color: DOUX });
      x += largeurs[i];
    });
    page.y -= 12;
  };
  dessinerEntete();
  for (const ligne of lignes) {
    const cellules = ligne.map((v, i) => couper(page.polices[colonnes[i].gras ? 'grasse' : 'normale'], v ?? '', taille, largeurs[i] - 6));
    const hauteur = Math.max(...cellules.map((c) => c.length)) * interligne + 4;
    if (page.y - hauteur < MARGE) { page.besoin(hauteur + 14); dessinerEntete(); }
    let x = MARGE;
    cellules.forEach((c, i) => {
      c.forEach((t, j) => {
        page.page.drawText(t, { x: x + 3, y: page.y - 2 - (j + 1) * interligne + 3, size: taille, font: page.polices[colonnes[i].gras ? 'grasse' : 'normale'], color: ENCRE });
      });
      x += largeurs[i];
    });
    page.y -= hauteur;
    page.page.drawLine({ start: { x: MARGE, y: page.y }, end: { x: MARGE + LARGEUR, y: page.y }, thickness: 0.4, color: TRAIT });
  }
  page.y -= 4;
}

/** Deux blocs côte à côte (Logement | Parties), encadrés, hauteur commune. */
function deuxBlocs(page, gauche, droite) {
  const largeurBloc = (LARGEUR - 10) / 2;
  const taille = 9;
  const interligne = 12;
  const preparer = (bloc) => bloc.lignes.flatMap((l) => couper(page.polices.normale, l, taille, largeurBloc - 12));
  const lignesG = preparer(gauche);
  const lignesD = preparer(droite);
  const hauteur = 16 + Math.max(lignesG.length, lignesD.length) * interligne + 6;
  page.besoin(hauteur + 6);
  [[gauche, lignesG, MARGE], [droite, lignesD, MARGE + largeurBloc + 10]].forEach(([bloc, lignes, x]) => {
    page.page.drawRectangle({ x, y: page.y - hauteur, width: largeurBloc, height: hauteur, borderColor: TRAIT, borderWidth: 0.6 });
    page.page.drawText(sur(bloc.titre).toUpperCase(), { x: x + 6, y: page.y - 11, size: 6.8, font: page.polices.grasse, color: DOUX });
    lignes.forEach((l, i) => page.page.drawText(l, { x: x + 6, y: page.y - 16 - (i + 1) * interligne + 3, size: taille, font: page.polices.normale, color: ENCRE }));
  });
  page.y -= hauteur + 6;
}

/**
 * Photos en grille de trois par ligne, légende courte sous chacune
 * (« Sujet — 2 » ou « Sujet : légende »).
 */
async function grillePhotos(page, photos, sujet, { colonnes = 3, hauteurMax = 118 } = {}) {
  const ecart = 8;
  const largeurCellule = (LARGEUR - ecart * (colonnes - 1)) / colonnes;
  for (let i = 0; i < photos.length; i += colonnes) {
    const rangee = photos.slice(i, i + colonnes);
    const images = [];
    for (const photo of rangee) {
      let image = null;
      // eslint-disable-next-line no-await-in-loop
      try { image = await page.doc.embedJpg(photo.octets || photo); } catch { try { image = await page.doc.embedPng(photo.octets || photo); } catch { image = null; } }
      images.push(image);
    }
    const hauteurs = images.map((img) => (img ? Math.min(largeurCellule / img.width, hauteurMax / img.height, 1) * img.height : 0));
    const hauteurRangee = Math.max(...hauteurs, 0) + 13;
    // (une seconde ligne de légende éventuelle est réservée après la rangée)
    page.besoin(hauteurRangee + 4);
    const yHaut = page.y;
    rangee.forEach((photo, j) => {
      const img = images[j];
      const x = MARGE + j * (largeurCellule + ecart);
      if (img) {
        const echelle = Math.min(largeurCellule / img.width, hauteurMax / img.height, 1);
        const l = img.width * echelle;
        const hImg = img.height * echelle;
        page.page.drawImage(img, { x, y: yHaut - hImg, width: l, height: hImg });
      }
      const numero = photos.length > 1 ? ` — ${i + j + 1}` : '';
      const legende = photo.legende ? (sujet ? `${sujet} : ${photo.legende}` : photo.legende) : `${sujet}${numero}`;
      // Légende sur deux lignes au plus, puis « ... ».
      const lignes = couper(page.polices.normale, legende, 7.5, largeurCellule);
      const affichees = lignes.length > 2 ? [lignes[0], tronquer(page.polices.normale, lignes.slice(1).join(' '), 7.5, largeurCellule)] : lignes;
      affichees.forEach((t, k) => page.page.drawText(t, { x, y: yHaut - Math.max(...hauteurs, 0) - 9 - k * 8.5, size: 7.5, font: page.polices.normale, color: DOUX }));
    });
    page.y = yHaut - hauteurRangee - 2 - 8.5;
  }
}

/** Pied de page sur toutes les pages : titre du document à gauche, « page n / N » à droite. */
function piedsDePage(page, texte) {
  const pages = page.doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGE, y: 30 }, end: { x: A4.largeur - MARGE, y: 30 }, thickness: 0.4, color: TRAIT });
    p.drawText(tronquer(page.polices.normale, texte, 7.5, LARGEUR - 70), { x: MARGE, y: 20, size: 7.5, font: page.polices.normale, color: DOUX });
    const numero = `page ${i + 1} / ${pages.length}`;
    p.drawText(numero, { x: A4.largeur - MARGE - page.polices.normale.widthOfTextAtSize(numero, 7.5), y: 20, size: 7.5, font: page.polices.normale, color: DOUX });
  });
}

/**
 * Rapport d'état des lieux : en-tête sur deux blocs, résumé, plan réduit,
 * une bande par pièce avec tableaux compacts (postes, mobilier) et photos
 * sur trois colonnes, signatures sur trois colonnes, annexe contradictoire,
 * pied de page numéroté.
 */
export async function pdfEtatDesLieux({ edl, bien, bailleur, locataires, photosParPiece, photosParMeuble, signatures, plan, annexe = null }) {
  const { page } = await nouvellePage();
  const typeLibelle = edl.type === 'sortie' ? 'de sortie' : 'd\'entrée';
  const adresse = [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const noms = (liste) => liste.map((s) => s.nom.replace(/\s*\(bailleur\)\s*$/, ''));
  const bailleursNoms = noms((signatures || []).filter((s) => /\(bailleur\)/.test(s.nom)));
  if (!bailleursNoms.length && bailleur?.nom) bailleursNoms.push(bailleur.nom);

  // ---- en-tête
  page.texte(`État des lieux ${typeLibelle}`, { taille: 16, police: 'grasse' });
  page.texte(`Établi le ${dateLongue(edl.date)} de manière contradictoire entre les parties.`, { taille: 9, couleur: DOUX });
  page.espace(6);
  deuxBlocs(page,
    { titre: 'Logement', lignes: [bien?.nom || 'Logement', adresse || '-', bien?.surface ? `${bien.surface} m²${bien?.type ? ` · ${bien.type}` : ''}` : (bien?.type || '')].filter(Boolean) },
    { titre: 'Parties', lignes: [
      `Bailleur${bailleursNoms.length > 1 ? 's' : ''} : ${bailleursNoms.join(', ') || '-'}`,
      `Locataire${locataires.length > 1 ? 's' : ''} : ${locataires.map((l) => `${l.prenom || ''} ${l.nom}`.trim()).join(', ') || '-'}`,
    ] });

  const pieces = edl.pieces || [];
  const nbPostes = pieces.reduce((s, p) => s + (p.elements || []).filter((e) => e.etat || e.commentaire).length, 0);
  const nbMeubles = pieces.reduce((s, p) => s + (p.meubles || []).filter((m) => m.nom).length, 0);
  const nbPhotos = pieces.reduce((s, p) => s + (photosParPiece?.[p.id] || []).length + (p.meubles || []).reduce((t, m) => t + (photosParMeuble?.[m.id] || []).length, 0), 0);
  const compteurs = (edl.compteurs || []).filter((c) => c.valeur).map((c) => `${c.nom} ${c.valeur}${c.unite ? ` ${c.unite}` : ''}`);
  const resume = [`${pieces.length} pièce${pieces.length > 1 ? 's' : ''}`, `${nbPostes} poste${nbPostes > 1 ? 's' : ''} évalué${nbPostes > 1 ? 's' : ''}`,
    `${nbMeubles} meuble${nbMeubles > 1 ? 's' : ''}`, `${nbPhotos} photo${nbPhotos > 1 ? 's' : ''}`,
    compteurs.length ? `relevés : ${compteurs.join(', ')}` : '', edl.cles ? `clés : ${edl.cles}` : ''].filter(Boolean).join(' · ');
  page.texte(resume, { taille: 8.5, couleur: DOUX });

  // ---- plan réduit (à droite) avec sa légende, résumé des observations à gauche
  if (plan?.octets) {
    let imagePlan = null;
    try { imagePlan = await page.doc.embedJpg(plan.octets); } catch { try { imagePlan = await page.doc.embedPng(plan.octets); } catch { imagePlan = null; } }
    if (imagePlan) {
      const largeurPlan = LARGEUR * 0.42;
      const echelle = Math.min(largeurPlan / imagePlan.width, 150 / imagePlan.height, 1);
      const l = imagePlan.width * echelle;
      const hPlan = imagePlan.height * echelle;
      const legende = (plan.legende || []).map((p) => `${p.numero} ${sur(p.nom)}`).join(' · ');
      const lignesLegende = couper(page.polices.normale, legende, 7.5, largeurPlan);
      page.besoin(hPlan + lignesLegende.length * 9 + 24);
      page.y -= 6;
      const xPlan = MARGE + LARGEUR - l;
      const yHaut = page.y;
      page.page.drawText('PLAN DU LOGEMENT', { x: xPlan, y: yHaut - 8, size: 6.8, font: page.polices.grasse, color: DOUX });
      page.page.drawImage(imagePlan, { x: xPlan, y: yHaut - 12 - hPlan, width: l, height: hPlan });
      for (const repere of plan.reperes || []) {
        const cx = xPlan + repere.x * l;
        const cy = yHaut - 12 - hPlan + (1 - repere.y) * hPlan;
        page.page.drawEllipse({ x: cx, y: cy, xScale: 7, yScale: 7, color: VERT, borderColor: rgb(1, 1, 1), borderWidth: 1.2 });
        const numero = String(repere.numero);
        page.page.drawText(numero, { x: cx - (numero.length > 1 ? 4.2 : 2.2), y: cy - 2.8, size: 7.5, font: page.polices.grasse, color: rgb(1, 1, 1) });
      }
      lignesLegende.forEach((t, i) => page.page.drawText(t, { x: xPlan, y: yHaut - 12 - hPlan - 10 - i * 9, size: 7.5, font: page.polices.normale, color: DOUX }));
      // Observations générales à gauche du plan, si elles tiennent ; sinon plus bas.
      const largeurGauche = LARGEUR - l - 12;
      if (edl.observations) {
        const lignesObs = couper(page.polices.normale, edl.observations, 9, largeurGauche);
        const hauteurDispo = hPlan + 12;
        if (lignesObs.length * 12 + 14 <= hauteurDispo) {
          page.page.drawText('OBSERVATIONS GÉNÉRALES', { x: MARGE, y: yHaut - 8, size: 6.8, font: page.polices.grasse, color: DOUX });
          lignesObs.forEach((t, i) => page.page.drawText(t, { x: MARGE, y: yHaut - 20 - i * 12, size: 9, font: page.polices.normale, color: ENCRE }));
          edl = { ...edl, observations: '' };
        }
      }
      page.y = yHaut - 12 - hPlan - 10 - lignesLegende.length * 9 - 4;
    }
  }

  // ---- pièces
  for (const [indexPiece, piece] of pieces.entries()) {
    const nomPiece = piece.nom || 'Pièce';
    const elements = (piece.elements || []).filter((e) => e.etat || e.commentaire);
    const meubles = (piece.meubles || []).filter((m) => m.nom || (photosParMeuble?.[m.id] || []).length);
    const photosPiece = photosParPiece?.[piece.id] || [];
    const etatGeneral = [piece.etatGeneral ? `État général : ${LIBELLES_ETAT[piece.etatGeneral] || piece.etatGeneral}` : '', piece.commentaire || ''].filter(Boolean).join(' — ');
    bande(page, `${indexPiece + 1}. ${nomPiece}`, etatGeneral, { besoin: elements.length || meubles.length || photosPiece.length ? 70 : 34 });
    if (!elements.length && !meubles.length && !photosPiece.length) {
      page.texte('Rien à signaler.', { taille: 9, couleur: DOUX });
      continue;
    }
    if (elements.length) {
      tableau(page, [{ titre: 'Poste', largeur: 0.26, gras: false }, { titre: 'État', largeur: 0.2 }, { titre: 'Observation', largeur: 0.54 }],
        elements.map((e) => [e.nom, LIBELLES_ETAT[e.etat] || e.etat || 'non évalué', e.commentaire || '-']));
    }
    if (photosPiece.length) await grillePhotos(page, photosPiece, nomPiece);
    if (meubles.length) {
      tableau(page, [{ titre: 'Mobilier', largeur: 0.28 }, { titre: 'Qté', largeur: 0.07 }, { titre: 'État', largeur: 0.19 }, { titre: 'Observation', largeur: 0.46 }],
        meubles.map((m) => [m.nom || 'Meuble', String(m.quantite || 1), LIBELLES_ETAT[m.etat] || m.etat || 'non précisé',
          [m.commentaire, (photosParMeuble?.[m.id] || []).length ? `${(photosParMeuble[m.id]).length} photo${photosParMeuble[m.id].length > 1 ? 's' : ''} ci-dessous` : ''].filter(Boolean).join(' — ') || '-']));
      const photosMeubles = meubles.flatMap((m) => (photosParMeuble?.[m.id] || []).map((p) => ({ ...p, legende: p.legende ? `${m.nom || 'Meuble'} : ${p.legende}` : (m.nom || 'Meuble') })));
      if (photosMeubles.length) await grillePhotos(page, photosMeubles.map((p) => ({ octets: p.octets, legende: p.legende })), '', { hauteurMax: 100 });
    }
  }

  if (edl.observations) {
    page.sousTitre('Observations générales');
    page.texte(edl.observations, { taille: 9.5 });
  }

  // ---- signatures sur trois colonnes
  page.besoin(120);
  page.sousTitre('Signatures');
  page.texte('Les parties reconnaissent l\'exactitude du présent état des lieux, photographies comprises, sous réserve des observations en annexe.', { taille: 8.5, couleur: DOUX });
  page.espace(4);
  {
    const colonnes = 3;
    const ecart = 8;
    const largeurCellule = (LARGEUR - ecart * (colonnes - 1)) / colonnes;
    const hauteurCellule = 92;
    for (let i = 0; i < signatures.length; i += colonnes) {
      page.besoin(hauteurCellule + 6);
      const yHaut = page.y;
      for (const [j, signature] of signatures.slice(i, i + colonnes).entries()) {
        const x = MARGE + j * (largeurCellule + ecart);
        page.page.drawRectangle({ x, y: yHaut - hauteurCellule, width: largeurCellule, height: hauteurCellule, borderColor: TRAIT, borderWidth: 0.6 });
        page.page.drawText(tronquer(page.polices.grasse, signature.nom, 8.5, largeurCellule - 10), { x: x + 5, y: yHaut - 12, size: 8.5, font: page.polices.grasse, color: ENCRE });
        if (signature.image) {
          let img = null;
          // eslint-disable-next-line no-await-in-loop
          try { img = await page.doc.embedPng(signature.image); } catch { img = null; }
          if (img) {
            const echelle = Math.min((largeurCellule - 10) / img.width, 46 / img.height, 1);
            page.page.drawImage(img, { x: x + 5, y: yHaut - 18 - img.height * echelle, width: img.width * echelle, height: img.height * echelle });
          }
        }
        const dateSig = signature.signeLe ? String(signature.signeLe) : '';
        const mention = !signature.image ? 'Non signé'
          : signature.mode === 'distance'
            ? `À distance le ${dateLongue(dateSig.slice(0, 10))}${dateSig.includes('T') ? ` à ${new Date(dateSig).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''} · code e-mail ${String(signature.emailMasque || '').replace('…', '...')}`
            : `Sur la tablette${dateSig ? ` le ${dateLongue(dateSig.slice(0, 10))}` : ''}`;
        couper(page.polices.normale, mention, 7, largeurCellule - 10).slice(0, 2).forEach((t, k) => {
          page.page.drawText(t, { x: x + 5, y: yHaut - hauteurCellule + 14 - k * 8.5, size: 7, font: page.polices.normale, color: signature.image ? DOUX : rgb(0.69, 0.19, 0.19) });
        });
      }
      page.y = yHaut - hauteurCellule - 6;
    }
  }

  // ---- annexe contradictoire
  if (annexe && annexe.length) {
    page.besoin(90);
    page.sousTitre('Annexe — observations contradictoires des colocataires');
    page.texte(`Réponses données par chaque colocataire sur son espace, point par point, jusqu'au ${dateLongue(edl.contradictoireFinLe || edl.date)}. Un point sans réponse vaut accord.`, { taille: 8.5, couleur: DOUX });
    for (const entree of annexe) {
      bande(page, entree.nom, entree.repondLe ? `Réponses du ${dateLongue(entree.repondLe)} — ${entree.bilan.accords} accord(s), ${entree.remarques.length} remarque(s) sur ${entree.bilan.total}` : 'Aucune réponse déposée', { besoin: 50 });
      if (!entree.repondLe && !entree.photos?.length) { page.texte('État des lieux réputé accepté en l\'état.', { taille: 9, couleur: DOUX }); continue; }
      if (entree.remarques.length) {
        tableau(page, [{ titre: 'Pièce', largeur: 0.2 }, { titre: 'Point', largeur: 0.26 }, { titre: 'Remarque du colocataire', largeur: 0.54 }],
          entree.remarques.map((r) => [r.piece, `${r.libelle}${r.etat ? ` (${LIBELLES_ETAT[r.etat] || r.etat})` : ''}`, r.texte || 'remarque sans texte']));
      } else if (entree.repondLe) page.texte('Aucune remarque : d\'accord sur tous les points.', { taille: 9, couleur: DOUX });
      if (entree.photos?.length) {
        page.texte(`Photos déposées par ${entree.nom} (${entree.photos.length}) :`, { taille: 8.5, police: 'grasse', couleur: DOUX });
        // eslint-disable-next-line no-await-in-loop
        await grillePhotos(page, entree.photos, entree.nom, { hauteurMax: 110 });
      }
    }
  }

  piedsDePage(page, `État des lieux ${typeLibelle} — ${bien?.nom || adresse || ''} — ${dateLongue(edl.date)}`);
  return page.doc.save();
}

/**
 * Bail signé : le PDF original du bail, complété d'une page datée portant
 * les signatures données à l'écran dans l'application (nom, qualité, date,
 * tracé de chaque signataire).
 */
export async function pdfBailSigne({ octetsOriginal, signatures, lieu }) {
  const document_ = await PDFDocument.load(octetsOriginal);
  const normale = await document_.embedFont(StandardFonts.Helvetica);
  const grasse = await document_.embedFont(StandardFonts.HelveticaBold);
  let page = document_.addPage([A4.largeur, A4.hauteur]);
  let y = A4.hauteur - MARGE;

  const ecrire = (texte, { taille = 10.5, police = normale, couleur = ENCRE, saut = 16 } = {}) => {
    y -= saut;
    page.drawText(sur(texte), { x: MARGE, y, size: taille, font: police, color: couleur });
  };

  ecrire('Signatures des parties', { taille: 16, police: grasse, saut: 20 });
  ecrire('Signatures recueillies électroniquement dans l\'application de gestion locative,', { taille: 9, couleur: DOUX, saut: 18 });
  ecrire('chaque partie ayant tracé sa signature à l\'écran. La présente page fait partie intégrante du bail.', { taille: 9, couleur: DOUX, saut: 12 });
  y -= 10;

  for (const signature of signatures || []) {
    if (y < MARGE + 130) {
      // Plus de place : on continue sur une page supplémentaire.
      page = document_.addPage([A4.largeur, A4.hauteur]);
      y = A4.hauteur - MARGE;
    }
    ecrire(`${signature.nom} — ${signature.role || ''}`.trim(), { police: grasse, saut: 22 });
    ecrire(`${lieu ? `${lieu}, le ` : 'Le '}${dateLongue(signature.date)}`, { taille: 9, couleur: DOUX, saut: 14 });
    if (signature.image) {
      try {
        const image = await document_.embedPng(signature.image);
        const echelle = Math.min(200 / image.width, 80 / image.height, 1);
        y -= image.height * echelle + 6;
        page.drawImage(image, { x: MARGE, y, width: image.width * echelle, height: image.height * echelle });
      } catch { /* image illisible : le nom et la date restent */ }
    }
    y -= 14;
  }

  return document_.save();
}

/** Encode des octets en base64 (pièce jointe de courriel). */
export function octetsEnBase64(octets) {
  let binaire = '';
  const tampon = new Uint8Array(octets);
  for (let i = 0; i < tampon.length; i += 1) binaire += String.fromCharCode(tampon[i]);
  return btoa(binaire);
}
