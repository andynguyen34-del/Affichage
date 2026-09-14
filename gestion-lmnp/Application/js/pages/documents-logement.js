// Cadre « Documents du logement » (v53) de la carte d'un logement, page
// « Logements & baux » : dépôt d'un DPE, d'un diagnostic ou d'un autre
// document, case « visible par les colocataires » par document, e-mail
// « Nouveau document » aux occupants, retrait vers la Corbeille.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, bouton, badge, formulaire, confirmer, executer, choisirFichier, notifier, signalerErreur, groupeRepliable } from '../ui.js';
import { date, taille, aujourdhui } from '../format.js';
import { CATEGORIES_DOCUMENTS, categorieDocument, cheminDocument, nomDuChemin, titreDepuisFichier, validiteProposee,
  etatValidite, documentsDe, documentsVisibles, documentsAPrevenir, resumeDocuments, occupantsDe, preparerCourrielDocuments } from '../documents-logement.js';
import { publierCatalogueLogement } from '../portail-publication.js';
/** Un bail en cours ou à venir : ses occupants reçoivent les documents du logement (même avant l'entrée dans les lieux). */
const bailOuvert = (bail) => !bail?.dateFin || String(bail.dateFin) >= aujourdhui();

const TAILLE_MAX = 10 * 1024 * 1024;
const nomDe = (l) => `${l.prenom || ''} ${l.nom || ''}`.trim();

/** Republie le catalogue visible du logement (Firestore logements/{bienId}). */
async function republier(bien) {
  await publierCatalogueLogement(bien, etat.liste('documentsLogement'));
}

/** Envoie l'e-mail « Nouveau document » aux occupants du logement pour ces documents ; renvoie le nombre d'envois. */
async function prevenirOccupants(tout, bien, documents) {
  const occupants = occupantsDe(tout, bien.id, bailOuvert).filter((l) => String(l.email || '').trim());
  if (!occupants.length) throw new Error(`Aucun occupant avec une adresse e-mail sur ${bien.nom} (bail en cours).`);
  const parametres = etat.parametres();
  const origine = window.location.origin;
  for (const locataire of occupants) {
    const courriel = preparerCourrielDocuments({ locataire, bien, documents, parametres, origine });
    // eslint-disable-next-line no-await-in-loop
    await api.envoyerCourriel({ ...courriel, type: 'documents' });
  }
  const quand = new Date().toISOString();
  for (const d of documents) {
    // eslint-disable-next-line no-await-in-loop
    await etat.modifierElement('documentsLogement', d.id, (e) => { e.notifieLe = quand; });
  }
  return occupants;
}

async function deposer(tout, bien) {
  const fichier = await choisirFichier({ accept: 'application/pdf,image/*' });
  if (!fichier) return;
  if (fichier.size > TAILLE_MAX) { notifier('Fichier trop lourd : 10 Mo au plus.', 'erreur'); return; }
  const jour = aujourdhui();
  const saisie = await formulaire({
    titre: `Déposer un document — ${bien.nom}`,
    libelleValider: 'Déposer et publier',
    aide: `Fichier : ${fichier.name} (${taille(fichier.size)}). Le nom d'origine est conservé dans le nuage.`,
    champs: [
      { cle: 'categorie', libelle: 'Catégorie', type: 'liste', options: CATEGORIES_DOCUMENTS.map((c) => ({ valeur: c.cle, libelle: c.libelle })), requis: true, largeur: 'pleine',
        aide: 'DPE : 10 ans de validité proposés · Diagnostic : électricité, gaz, amiante, plomb, ERP… · Autre : règlement intérieur, notices, plan.' },
      { cle: 'titre', libelle: 'Titre affiché aux colocataires', type: 'texte', requis: true, largeur: 'pleine' },
      { cle: 'valableJusquau', libelle: 'Valable jusqu’au (facultatif)', type: 'date', aide: 'Proposé d’après la catégorie ; effacez si sans objet.' },
      { cle: 'visible', libelle: 'Visible par les colocataires du logement', type: 'case' },
      { cle: 'prevenir', libelle: 'Prévenir les colocataires par e-mail', type: 'case', quand: (v) => v.visible !== false && api.MODE === 'nuage' },
    ],
    valeurs: { categorie: 'dpe', titre: titreDepuisFichier(fichier.name), valableJusquau: validiteProposee('dpe', jour), visible: true, prevenir: true },
  });
  if (!saisie) return;
  const categorie = saisie.categorie || 'autre';
  const depot = await api.deposerFichier('partage', cheminDocument(bien.id, fichier.name), fichier);
  const document_ = await etat.enregistrer('documentsLogement', {
    bienId: bien.id, categorie, titre: String(saisie.titre || '').trim() || titreDepuisFichier(fichier.name) || categorieDocument(categorie).court,
    nomFichier: nomDuChemin(depot.chemin), chemin: depot.chemin, taille: fichier.size, deposeLe: jour, deposeA: new Date().toISOString(),
    valableJusquau: saisie.valableJusquau || '', visible: saisie.visible !== false, notifieLe: '',
  });
  await republier(bien);
  if (saisie.visible !== false && saisie.prevenir && api.MODE === 'nuage') {
    try {
      const occupants = await prevenirOccupants(tout, bien, [document_]);
      notifier(`« ${document_.titre} » déposé et publié ; ${occupants.length} colocataire${occupants.length > 1 ? 's' : ''} prévenu${occupants.length > 1 ? 's' : ''} par e-mail (${occupants.map(nomDe).join(', ')}).`, 'succes');
    } catch (erreur) {
      notifier(`« ${document_.titre} » déposé et publié, mais sans e-mail : ${erreur.message}`, 'erreur');
    }
  } else {
    notifier(`« ${document_.titre} » déposé${document_.visible ? ' et publié sur les espaces des colocataires' : ' (masqué aux colocataires)'}.`, 'succes');
  }
}

async function remplacer(bien, document_) {
  const fichier = await choisirFichier({ accept: 'application/pdf,image/*' });
  if (!fichier) return;
  if (fichier.size > TAILLE_MAX) { notifier('Fichier trop lourd : 10 Mo au plus.', 'erreur'); return; }
  const depot = await api.deposerFichier('partage', cheminDocument(bien.id, fichier.name), fichier);
  if (document_.chemin && document_.chemin !== depot.chemin) {
    try { await api.supprimerFichier('partage', document_.chemin); } catch { /* l'ancien fichier reste, sans conséquence */ }
  }
  await etat.modifierElement('documentsLogement', document_.id, (e) => {
    e.nomFichier = nomDuChemin(depot.chemin); e.chemin = depot.chemin; e.taille = fichier.size; e.deposeLe = aujourdhui(); e.deposeA = new Date().toISOString(); e.notifieLe = '';
  });
  await republier(bien);
  notifier(`« ${document_.titre} » remplacé par ${fichier.name}.`, 'succes');
}

async function modifierFiche(bien, document_) {
  const saisie = await formulaire({
    titre: `Modifier — ${document_.titre}`,
    champs: [
      { cle: 'categorie', libelle: 'Catégorie', type: 'liste', options: CATEGORIES_DOCUMENTS.map((c) => ({ valeur: c.cle, libelle: c.libelle })), requis: true, largeur: 'pleine' },
      { cle: 'titre', libelle: 'Titre affiché aux colocataires', type: 'texte', requis: true, largeur: 'pleine' },
      { cle: 'valableJusquau', libelle: 'Valable jusqu’au (facultatif)', type: 'date' },
    ],
    valeurs: { categorie: document_.categorie || 'autre', titre: document_.titre || '', valableJusquau: document_.valableJusquau || '' },
  });
  if (!saisie) return;
  await etat.modifierElement('documentsLogement', document_.id, (e) => {
    e.categorie = saisie.categorie || 'autre'; e.titre = String(saisie.titre || '').trim() || e.titre; e.valableJusquau = saisie.valableJusquau || '';
  });
  await republier(bien);
  notifier('Document mis à jour.', 'succes');
}

async function retirer(bien, document_) {
  const ok = await confirmer({
    titre: 'Retirer le document',
    message: `« ${document_.titre} » sera retiré des espaces des colocataires et déposé dans la Corbeille (Paramètres → Corbeille), d'où il reste téléchargeable.`,
    libelleValider: 'Retirer', danger: true,
  });
  if (!ok) return;
  try { await api.supprimerFichier('partage', document_.chemin); } catch (erreur) { notifier(`Fichier non retiré du nuage : ${erreur.message}`, 'erreur'); }
  await etat.supprimer('documentsLogement', document_.id);
  await republier(bien);
  notifier(`« ${document_.titre} » retiré et déposé dans la Corbeille.`, 'succes');
}

async function basculerVisibilite(bien, document_, visible) {
  await etat.modifierElement('documentsLogement', document_.id, (e) => { e.visible = visible; });
  await republier(bien);
  notifier(visible ? `« ${document_.titre} » est visible par les colocataires.` : `« ${document_.titre} » est masqué aux colocataires.`, 'succes');
}

async function prevenir(tout, bien) {
  const liste = etat.liste('documentsLogement');
  let documents = documentsAPrevenir(liste, bien.id);
  const tousVisibles = documentsVisibles(liste, bien.id);
  if (!tousVisibles.length) { notifier('Aucun document visible à annoncer.'); return; }
  const rappel = !documents.length;
  if (rappel) documents = tousVisibles;
  const occupants = occupantsDe(tout, bien.id, bailOuvert).filter((l) => String(l.email || '').trim());
  const ok = await confirmer({
    titre: 'Prévenir les colocataires',
    message: `${rappel ? 'Tous les colocataires ont déjà été prévenus : renvoyer la liste complète' : `Annoncer ${documents.length} document${documents.length > 1 ? 's' : ''} (${documents.map((d) => d.titre).join(', ')})`} à ${occupants.length ? occupants.map(nomDe).join(', ') : 'personne (aucun occupant avec e-mail)'} ?`,
    libelleValider: 'Envoyer',
  });
  if (!ok) return;
  const prevenus = await prevenirOccupants(tout, bien, documents);
  notifier(`E-mail « Nouveau${documents.length > 1 ? 'x' : ''} document${documents.length > 1 ? 's' : ''} » envoyé à ${prevenus.map(nomDe).join(', ')}.`, 'succes');
}

function ligneDocument(tout, bien, document_) {
  const categorie = categorieDocument(document_.categorie);
  const validite = etatValidite(document_, aujourdhui());
  const tonValidite = { valide: 'succes', bientot: 'attention', expire: 'alerte' }[validite.etat];
  const case_ = h('input', { type: 'checkbox', checked: document_.visible !== false, title: 'Visible par les colocataires du logement', 'aria-label': `Visible : ${document_.titre}` });
  case_.addEventListener('change', () => executer(basculerVisibilite(bien, document_, case_.checked)));
  return h('div', { class: `doc-logement${document_.visible === false ? ' masque' : ''}`, 'data-document': document_.id }, [
    h('label', { class: 'doc-logement-visible', title: 'Visible par les colocataires' }, [case_, h('span', { class: 'legende', texte: 'visible' })]),
    h('span', { class: 'doc-logement-icone', texte: categorie.icone }),
    h('div', { class: 'doc-logement-details' }, [
      h('div', { class: 'doc-logement-titre', texte: document_.titre || categorie.court }),
      h('div', { class: 'legende' }, [
        `${categorie.libelle} · déposé le ${date(document_.deposeLe)}${document_.taille ? ` · ${taille(document_.taille)}` : ''}${document_.notifieLe ? ` · annoncé le ${date(String(document_.notifieLe).slice(0, 10))}` : ''} `,
        validite.libelle ? badge(validite.libelle, tonValidite) : null,
        document_.visible === false ? badge('masqué aux colocataires', 'attente') : null,
      ]),
    ]),
    h('div', { class: 'groupe-boutons' }, [
      bouton('Consulter', () => api.ouvrirFichier('partage', document_.chemin).catch(signalerErreur), { petit: true }),
      bouton('Télécharger', () => api.telechargerFichier('partage', document_.chemin, document_.nomFichier || nomDuChemin(document_.chemin)).catch(signalerErreur), { petit: true }),
      bouton('Modifier', () => modifierFiche(bien, document_).catch(signalerErreur), { petit: true, titre: 'Titre, catégorie, validité' }),
      bouton('Remplacer', () => remplacer(bien, document_).catch(signalerErreur), { petit: true, titre: 'Nouveau fichier à la place de celui-ci (l’ancien va dans la Corbeille)' }),
      bouton('Retirer', () => retirer(bien, document_).catch(signalerErreur), { petit: true, type: 'danger' }),
    ]),
  ]);
}

/**
 * Le cadre repliable « Documents du logement » d'une carte de logement.
 *   tout : le dossier entier (baux, locataires, documentsLogement)
 */
export function cadreDocumentsLogement(tout, bien) {
  const liste = tout.documentsLogement || etat.liste('documentsLogement');
  const documents = documentsDe(liste, bien.id);
  const visibles = documentsVisibles(liste, bien.id).length;
  const aPrevenir = documentsAPrevenir(liste, bien.id).length;
  const occupants = occupantsDe(tout, bien.id, bailOuvert);
  const groupe = groupeRepliable({ cle: `documents:${bien.id}`, entete: h('div', { class: 'doc-logement-entete' }, [
    h('span', { class: 'doc-logement-entete-titre', texte: 'Documents du logement' }),
    h('span', { class: 'legende', texte: resumeDocuments(liste, bien.id, aujourdhui()) }),
    documents.length ? badge(visibles ? `visibles par ${occupants.length} colocataire${occupants.length > 1 ? 's' : ''}` : 'rien de visible', visibles ? 'info' : 'attente') : null,
  ]) });
  groupe.corps.append(h('div', { class: 'groupe-boutons doc-logement-barre' }, [
    bouton('Déposer un document', () => deposer(tout, bien).catch(signalerErreur), { petit: true, type: 'primaire', titre: 'DPE, diagnostic, règlement, notice… (PDF ou image, 10 Mo au plus)' }),
    api.MODE === 'nuage' && documents.length ? bouton(`Prévenir les colocataires ✉${aPrevenir ? ` (${aPrevenir})` : ''}`, () => prevenir(tout, bien).catch(signalerErreur), { petit: true, titre: aPrevenir ? `${aPrevenir} document(s) pas encore annoncé(s)` : 'Renvoyer la liste des documents visibles' }) : null,
    h('span', { class: 'legende', texte: documents.length ? 'Décochez « visible » pour masquer un document aux colocataires sans le retirer.' : 'DPE, diagnostics, règlement intérieur, notices : déposés une fois ici, téléchargeables par tous les colocataires du logement (rubrique « Bail & documents » de leur espace).' }),
  ]));
  if (documents.length) groupe.corps.append(h('div', { class: 'doc-logement-liste' }, documents.map((d) => ligneDocument(tout, bien, d))));
  groupe.element.classList.add('doc-logement-cadre');
  return groupe.element;
}
