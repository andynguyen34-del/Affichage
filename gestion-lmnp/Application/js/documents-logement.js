// Documents du logement (v53) : DPE, diagnostics, règlement intérieur,
// notices… déposés une fois par le gérant pour un logement (page « Logements
// & baux ») et téléchargeables par tous les colocataires du logement depuis
// leur espace (rubrique « Bail & documents »). Un seul exemplaire du fichier,
// dans l'espace partage, dossier documents/{bienId}/ ; le catalogue visible
// des colocataires est publié dans le document Firestore logements/{bienId}.
// Module PUR (gérant, espace colocataire, tests).
//
// Élément de la collection « documentsLogement » :
//   { id, bienId, categorie, titre, nomFichier, chemin, taille, deposeLe (jour),
//     deposeA (instant), valableJusquau, visible, notifieLe }

import { date, dateLongue } from './format.js';

export const CATEGORIES_DOCUMENTS = [
  { cle: 'dpe', libelle: 'Diagnostic de performance énergétique (DPE)', court: 'DPE', icone: '🏷️', validiteAnnees: 10 },
  { cle: 'diagnostic', libelle: 'Diagnostic technique', court: 'Diagnostic', icone: '⚡', validiteAnnees: 6,
    aide: 'Électricité, gaz, amiante, plomb, état des risques (ERP), surface…' },
  { cle: 'autre', libelle: 'Autre document', court: 'Document', icone: '📄', validiteAnnees: 0,
    aide: 'Règlement intérieur, notices des appareils, plan, consignes de tri…' },
];

export const categorieDocument = (cle) => CATEGORIES_DOCUMENTS.find((c) => c.cle === cle) || CATEGORIES_DOCUMENTS[CATEGORIES_DOCUMENTS.length - 1];

const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nom de fichier sûr pour le nuage (sans / \ : * ? " < > |). */
export const nettoyerNomFichier = (nom) => String(nom || 'document').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'document';

/** Chemin du fichier dans l'espace partage : documents/{bienId}/{fichier}. */
export const cheminDocument = (bienId, nomFichier) => `documents/${bienId}/${nettoyerNomFichier(nomFichier)}`;

/** Le nom de fichier d'un chemin. */
export const nomDuChemin = (chemin) => String(chemin || '').split('/').pop();

/** Titre proposé à partir du nom du fichier (« DPE-maison.pdf » → « DPE-maison »). */
export const titreDepuisFichier = (nomFichier) => String(nomFichier || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').trim();

const ajouterAnnees = (iso, annees) => {
  const jour = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return '';
  return `${Number(jour.slice(0, 4)) + annees}${jour.slice(4)}`;
};

/** Date de validité proposée pour une catégorie (10 ans pour un DPE, 6 pour un diagnostic, rien sinon). */
export function validiteProposee(categorie, dateJour) {
  const annees = categorieDocument(categorie).validiteAnnees;
  return annees ? ajouterAnnees(dateJour, annees) : '';
}

/**
 * État de validité d'un document : { etat: 'sans' | 'valide' | 'bientot' | 'expire', libelle }.
 * « bientot » : expire dans les 3 mois.
 */
export function etatValidite(document_, dateJour) {
  const limite = String(document_?.valableJusquau || '').slice(0, 10);
  if (!limite) return { etat: 'sans', libelle: '' };
  const jour = String(dateJour || '').slice(0, 10);
  if (limite < jour) return { etat: 'expire', libelle: `expiré le ${date(limite)}` };
  const dans3mois = (() => { const d = new Date(`${jour}T12:00:00`); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10); })();
  if (limite <= dans3mois) return { etat: 'bientot', libelle: `expire le ${date(limite)}` };
  return { etat: 'valide', libelle: `valable jusqu'au ${date(limite)}` };
}

/** Les documents d'un logement, les plus récents en premier. */
export const documentsDe = (liste, bienId) => (liste || []).filter((d) => d && d.bienId === bienId).sort(plusRecentDabord);

/** Tri du plus récent au plus ancien : jour de dépôt, puis instant de dépôt, puis titre. */
export const plusRecentDabord = (a, b) => String(b.deposeLe || '').localeCompare(String(a.deposeLe || ''))
  || String(b.deposeA || '').localeCompare(String(a.deposeA || '')) || String(a.titre || '').localeCompare(String(b.titre || ''));

/** Ceux que les colocataires voient (case « visible » cochée). */
export const documentsVisibles = (liste, bienId) => documentsDe(liste, bienId).filter((d) => d.visible !== false);

/** Ceux, visibles, dont les colocataires n'ont pas encore été prévenus. */
export const documentsAPrevenir = (liste, bienId) => documentsVisibles(liste, bienId).filter((d) => !d.notifieLe);

/** Résumé pour le titre du cadre replié : « 3 documents · DPE valable jusqu'au … ». */
export function resumeDocuments(liste, bienId, dateJour) {
  const tous = documentsDe(liste, bienId);
  if (!tous.length) return 'aucun document déposé';
  const morceaux = [`${tous.length} document${tous.length > 1 ? 's' : ''}`];
  const caches = tous.filter((d) => d.visible === false).length;
  if (caches) morceaux.push(`${caches} masqué${caches > 1 ? 's' : ''}`);
  const dpe = tous.find((d) => d.categorie === 'dpe');
  if (dpe) {
    const v = etatValidite(dpe, dateJour);
    morceaux.push(v.libelle ? `DPE ${v.libelle}` : 'DPE déposé');
  }
  return morceaux.join(' · ');
}

/**
 * Le catalogue publié pour les colocataires du logement (document Firestore
 * logements/{bienId}) : seulement les documents visibles, et la liste des
 * noms de fichiers que la règle de stockage autorise en lecture.
 */
export function catalogueLogement(bien, liste) {
  const visibles = documentsVisibles(liste, bien?.id);
  return {
    nom: bien?.nom || '',
    documents: visibles.map((d) => ({
      id: d.id, categorie: d.categorie || 'autre', titre: d.titre || titreDepuisFichier(d.nomFichier) || 'Document',
      chemin: d.chemin, nomFichier: d.nomFichier || nomDuChemin(d.chemin), taille: Number(d.taille) || 0,
      deposeLe: d.deposeLe || '', deposeA: d.deposeA || '', valableJusquau: d.valableJusquau || '',
    })),
    fichiers: visibles.map((d) => nomDuChemin(d.chemin)),
  };
}

/** Les occupants d'un logement : les locataires de ses baux en cours (titulaire, co-titulaire, colocataires). */
export function occupantsDe({ baux = [], locataires = [] }, bienId, estActif) {
  const ids = new Set();
  for (const bail of baux.filter((b) => b.bienId === bienId && estActif(b))) {
    for (const id of [bail.locataireId, bail.coTitulaireId, ...(bail.colocataires || []).map((c) => c?.locataireId)]) if (id) ids.add(id);
  }
  return locataires.filter((l) => ids.has(l.id));
}

function signatureBailleurs(parametres = {}) {
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  return bailleurs.map((b) => b.nom).join(' et ') || parametres.nomActivite || 'Le bailleur';
}

/**
 * L'e-mail « Nouveau document » d'un colocataire : un ou plusieurs documents
 * du logement. Renvoie { destinataires, sujet, html }.
 */
export function preparerCourrielDocuments({ locataire, bien, documents = [], parametres = {}, origine = '' }) {
  const prenom = locataire?.prenom || `${locataire?.prenom || ''} ${locataire?.nom || ''}`.trim() || 'colocataire';
  const nomBien = bien?.nom || 'votre logement';
  const plusieurs = documents.length > 1;
  const sujet = plusieurs
    ? `Nouveaux documents pour ${nomBien} — ${documents.length} documents`
    : `Nouveau document pour ${nomBien} — ${categorieDocument(documents[0]?.categorie).court}`;
  const ligne = (d) => {
    const c = categorieDocument(d.categorie);
    const validite = d.valableJusquau ? `, valable jusqu'au ${dateLongue(d.valableJusquau)}` : '';
    return `<li><strong>${echapper(d.titre || c.libelle)}</strong> — ${echapper(c.libelle)}${echapper(validite)}.</li>`;
  };
  const html = [
    `<p>Bonjour ${echapper(prenom)},</p>`,
    `<p>${plusieurs ? 'De nouveaux documents concernant' : 'Un nouveau document concernant'} <strong>${echapper(nomBien)}</strong> ${plusieurs ? 'sont disponibles' : 'est disponible'} sur votre espace, rubrique « Bail &amp; documents » → « Documents du logement » :</p>`,
    `<ul>${documents.map(ligne).join('')}</ul>`,
    origine ? `<p><a href="${echapper(origine)}/colocataire">${echapper(origine)}/colocataire</a></p>` : '',
    `<p>Bien cordialement,<br>${echapper(signatureBailleurs(parametres))}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ''}</p>`,
  ].filter(Boolean).join('\n');
  return {
    destinataires: [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean),
    sujet,
    html,
  };
}
