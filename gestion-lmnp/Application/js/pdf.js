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

const LIBELLES_ETAT = { neuf: 'Neuf', bon: 'Bon état', usage: 'État d\'usage', mauvais: 'Mauvais état' };

/**
 * Rapport d'état des lieux : informations, pièces avec photos, compteurs,
 * clés, observations et signatures. `photosParPiece` associe l'identifiant de
 * chaque pièce à ses photos déjà chargées ({octets, legende}).
 */
export async function pdfEtatDesLieux({ edl, bien, bailleur, locataires, photosParPiece, signatures, plan }) {
  const { document_, page } = await nouvellePage();

  page.titre(`État des lieux ${edl.type === 'sortie' ? 'de sortie' : 'd\'entrée'}`);
  page.texte(`Établi le ${dateLongue(edl.date)} de manière contradictoire entre les parties.`, { couleur: DOUX });
  page.espace(8);
  page.sousTitre('Logement');
  page.texte([bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '-');
  page.espace(4);
  page.sousTitre('Parties');
  page.texte(`Bailleur : ${bailleur?.nom || '-'}`);
  for (const locataire of locataires) {
    page.texte(`Locataire : ${`${locataire.prenom || ''} ${locataire.nom}`.trim()}`);
  }

  // Plan du logement avec le numéro de chaque pièce posé par le bailleur.
  if (plan?.octets) {
    page.sousTitre('Plan du logement');
    let imagePlan = null;
    try { imagePlan = await page.doc.embedJpg(plan.octets); }
    catch { try { imagePlan = await page.doc.embedPng(plan.octets); } catch { imagePlan = null; } }
    if (imagePlan) {
      const largeurMax = A4.largeur - 2 * MARGE;
      const echelle = Math.min(largeurMax / imagePlan.width, 430 / imagePlan.height, 1);
      const l = imagePlan.width * echelle;
      const hPlan = imagePlan.height * echelle;
      page.besoin(hPlan + 10);
      page.y -= hPlan;
      page.page.drawImage(imagePlan, { x: MARGE, y: page.y, width: l, height: hPlan });
      for (const repere of plan.reperes || []) {
        const cx = MARGE + repere.x * l;
        const cy = page.y + hPlan - repere.y * hPlan;
        page.page.drawEllipse({ x: cx, y: cy, xScale: 9, yScale: 9, color: VERT, borderColor: rgb(1, 1, 1), borderWidth: 1.5 });
        const numero = String(repere.numero);
        page.page.drawText(numero, {
          x: cx - (numero.length > 1 ? 5.4 : 2.8), y: cy - 3.4,
          size: 9.5, font: page.polices.grasse, color: rgb(1, 1, 1),
        });
      }
      page.y -= 8;
      const legende = (plan.legende || []).map((p) => `${p.numero} ${sur(p.nom)}`).join(' · ');
      if (legende) page.texte(legende, { taille: 8.5, couleur: DOUX });
    }
  }

  if ((edl.compteurs || []).some((c) => c.valeur)) {
    page.sousTitre('Relevés des compteurs');
    for (const compteur of edl.compteurs.filter((c) => c.valeur)) {
      page.ligneMontant(compteur.nom, `${compteur.valeur}${compteur.unite ? ` ${compteur.unite}` : ''}`);
    }
  }

  if (edl.cles) {
    page.sousTitre('Clés remises');
    page.texte(edl.cles);
  }

  for (const [indexPiece, piece] of (edl.pieces || []).entries()) {
    page.sousTitre(`${indexPiece + 1}. ${piece.nom || 'Pièce'}`);
    if (piece.etatGeneral) page.texte(`État général : ${LIBELLES_ETAT[piece.etatGeneral] || piece.etatGeneral}`);
    if (piece.commentaire) page.texte(piece.commentaire);
    // Inventaire du mobilier de la pièce (obligatoire en location meublée).
    const meubles = (piece.meubles || []).filter((m) => m.nom);
    if (meubles.length) {
      page.espace(2);
      page.texte('Mobilier :', { taille: 9.5, police: 'grasse', couleur: DOUX });
      for (const meuble of meubles) {
        page.texte(`- ${meuble.nom}${(meuble.quantite || 1) > 1 ? ` (x ${meuble.quantite})` : ''}`
          + ` — ${LIBELLES_ETAT[meuble.etat] || meuble.etat || 'état non précisé'}`, { taille: 9.5 });
      }
      page.espace(2);
    }
    const photos = photosParPiece?.[piece.id] || [];
    // Reportage photo : deux photos par ligne.
    for (let i = 0; i < photos.length; i += 2) {
      const paire = photos.slice(i, i + 2);
      const hauteurMax = 150;
      const largeurMax = (A4.largeur - 2 * MARGE - 14) / 2;
      page.besoin(hauteurMax + 20);
      const yDepart = page.y;
      let yBas = page.y;
      for (let j = 0; j < paire.length; j += 1) {
        page.y = yDepart;
        // eslint-disable-next-line no-await-in-loop
        await page.image(paire[j], {
          largeurMax, hauteurMax, x: MARGE + j * (largeurMax + 14), legende: paire[j].legende || '',
        });
        yBas = Math.min(yBas, page.y);
      }
      page.y = yBas;
    }
  }

  if (edl.observations) {
    page.sousTitre('Observations générales');
    page.texte(edl.observations);
  }

  page.sousTitre('Signatures');
  page.texte('Les parties reconnaissent l\'exactitude du présent état des lieux, photographies comprises.', { taille: 9, couleur: DOUX });
  page.espace(6);
  for (const signature of signatures || []) {
    page.texte(signature.nom, { police: 'grasse' });
    if (signature.image) {
      // eslint-disable-next-line no-await-in-loop
      await page.image(signature.image, { largeurMax: 180, hauteurMax: 70 });
    } else {
      page.texte('(non signé)', { couleur: DOUX });
    }
    page.espace(6);
  }

  return document_.save();
}

/**
 * Bail signé : le PDF du bail est repris tel quel, augmenté d'une page de
 * signatures recueillies à l'écran dans l'application (nom, qualité, date,
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
