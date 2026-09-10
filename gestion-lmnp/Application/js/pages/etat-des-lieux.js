// États des lieux : reportage photo pièce par pièce, relevés, signatures des
// parties à l'écran, et génération du rapport PDF publié sur le portail de
// chaque colocataire.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { date, aujourdhui, taille, nomFichierTelechargement } from '../format.js';
import { estCourteDuree, bienDeEdl } from '../logements.js';
import { demanderSignature } from '../signature.js';
import { pdfEtatDesLieux } from '../pdf.js';
import { publierDocument, ouvrirFenetreContradictoire, destinatairesDe } from '../portail-publication.js';
import { apercuPourColocataire, annexeContradictoire, cheminPartage, finDeFenetre, finEnMillisecondes, DUREE_PAR_DEFAUT, libelleEtat, legendeDepot } from '../contradictoire.js';
import { compresserPhoto } from '../photos.js';

const PIECES_PROPOSEES = ['Séjour', 'Cuisine', 'Chambre 1', 'Chambre 2', 'Chambre 3',
  'Salle de bain', 'WC', 'Entrée / couloir', 'Extérieur / jardin', 'Garage / annexe'];
const COMPTEURS_PAR_DEFAUT = [
  { nom: 'Électricité', valeur: '', unite: 'kWh' },
  { nom: 'Eau froide', valeur: '', unite: 'm³' },
  { nom: 'Gaz', valeur: '', unite: 'm³' },
];
// Les postes évalués d'office dans chaque pièce (état + observation).
const ELEMENTS_PAR_DEFAUT = [
  { cle: 'murs', nom: 'Murs' },
  { cle: 'plafond', nom: 'Plafond' },
  { cle: 'sol', nom: 'Sol' },
  { cle: 'prises', nom: 'Prises et interrupteurs' },
  { cle: 'fenetres', nom: 'Fenêtres et volets' },
  { cle: 'porte', nom: 'Porte' },
];
const elementsParDefaut = () => ELEMENTS_PAR_DEFAUT.map((e) => ({ ...e, etat: '', commentaire: '' }));
/** Les postes d'une pièce, complétés des postes de base manquants (états des lieux créés avant cette version). */
const elementsDe = (piece) => {
  const existants = piece.elements || [];
  return [...ELEMENTS_PAR_DEFAUT.map((e) => existants.find((x) => x.cle === e.cle) || { ...e, etat: '', commentaire: '' }),
    ...existants.filter((x) => !ELEMENTS_PAR_DEFAUT.some((e) => e.cle === x.cle))];
};
const ETATS = [
  { valeur: '', libelle: '—' },
  { valeur: 'neuf', libelle: 'Neuf' },
  { valeur: 'tres-bon', libelle: 'Très bon état' },
  { valeur: 'bon', libelle: 'Bon état' },
  { valeur: 'usage', libelle: 'État d’usage' },
  { valeur: 'mauvais', libelle: 'Mauvais état' },
];

// Identifiant de l'état des lieux ouvert en édition (état de la page).
let edlOuvert = null;
// Signatures données à distance par les colocataires (portail/{email}/signatures/{edlId}),
// chargées par état des lieux : { locataireId → { image, signeLe, mode, emailMasque } }.
const signaturesDistantes = new Map();

/** Charge (ou recharge) les signatures à distance des colocataires d'un état des lieux. */
async function chargerSignaturesDistantes(edl, donnees) {
  const resultat = new Map();
  for (const id of edl.locataireIds || []) {
    const locataire = donnees.locataires.find((l) => l.id === id);
    const email = String(locataire?.email || '').trim().toLowerCase();
    if (!email) continue;
    try {
      /* eslint-disable no-await-in-loop */
      const signature = await api.lireSignatureContradictoire(email, edl.id);
      if (signature?.image) resultat.set(id, signature);
    } catch { /* espace non lisible : rien */ }
  }
  signaturesDistantes.set(edl.id, resultat);
  return resultat;
}

/** Signature d'une partie : sur la tablette (edl.signatures) ou à distance (colocataire). */
function signatureDe(edl, partie) {
  const locale = (edl.signatures || []).find((s) => s.cle === partie.cle);
  if (locale) return { ...locale, mode: 'tablette' };
  const distante = partie.locataireId ? signaturesDistantes.get(edl.id)?.get(partie.locataireId) : null;
  return distante ? { ...distante, cle: partie.cle, nom: partie.nom, mode: 'distance' } : null;
}
const nombreSignatures = (edl, donnees) => partiesAttendues(edl, donnees).filter((p) => signatureDe(edl, p)).length;
// Onglet ouvert dans l'éditeur, par état des lieux : 'piece:<id>', 'plan',
// 'releves', 'signatures' ou 'contradictoire'.
const ongletsActifs = new Map();

// Vignettes déjà chargées : chemin → URL d'objet.
const vignettes = new Map();

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : '?');

/** Donne le focus au champ portant cette clé (après le rafraîchissement de la page), sans sauter en haut. */
function focaliser(cle, { selectionner = false } = {}) {
  requestAnimationFrame(() => {
    const champ = document.querySelector(`[data-focus="${cle}"]`);
    if (!champ) return;
    champ.focus({ preventScroll: true });
    champ.scrollIntoView({ block: 'nearest' });
    if (selectionner && typeof champ.select === 'function') champ.select();
  });
}


async function creerEtatDesLieux(donnees, contexte) {
  if (!donnees.baux.length && !donnees.biens.some(estCourteDuree)) {
    notifier('Enregistrez d’abord un bail dans « Logements & baux » (ou déclarez un logement de courte durée).', 'erreur');
    return;
  }
  const bailActif = [...donnees.baux].sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)))[0];
  const saisie = await formulaire({
    titre: 'Nouvel état des lieux',
    champs: [
      { cle: 'type', libelle: 'Type', type: 'liste', requis: true, options: [
        { valeur: 'entree', libelle: 'Entrée dans les lieux' },
        { valeur: 'sortie', libelle: 'Sortie des lieux' },
      ] },
      { cle: 'date', libelle: 'Date', type: 'date', requis: true },
      { cle: 'bailId', libelle: 'Bail concerné', type: 'liste', requis: true,
        options: [
          ...donnees.baux.map((b) => ({ valeur: b.id, libelle: `${donnees.biens.find((x) => x.id === b.bienId)?.nom || 'Logement ?'} — bail du ${date(b.dateDebut)}` })),
          // Un logement de courte durée n'a pas de bail : l'état des lieux se rattache au logement lui-même.
          ...donnees.biens.filter(estCourteDuree).map((b) => ({ valeur: `bien:${b.id}`, libelle: `${b.nom} — sans bail (courte durée)` })),
        ] },
    ],
    valeurs: { type: 'entree', date: aujourdhui(), bailId: bailActif?.id || (donnees.biens.find(estCourteDuree) ? `bien:${donnees.biens.find(estCourteDuree).id}` : '') },
  });
  if (!saisie) return;
  const sansBail = String(saisie.bailId || '').startsWith('bien:');
  const bail = sansBail ? null : donnees.baux.find((b) => b.id === saisie.bailId);
  const locataireIds = (bail?.colocataires?.length
    ? bail.colocataires.map((c) => c.locataireId)
    : [bail?.locataireId, bail?.coTitulaireId]).filter(Boolean);
  const nouveau = await executer(etat.enregistrer('etatsDesLieux', {
    type: saisie.type,
    date: saisie.date,
    bailId: sansBail ? '' : saisie.bailId,
    bienId: sansBail ? saisie.bailId.slice(5) : (bail?.bienId || ''),
    locataireIds,
    pieces: PIECES_PROPOSEES.slice(0, 6).map((nom) => ({ id: crypto.randomUUID(), nom, etatGeneral: '', commentaire: '', elements: elementsParDefaut(), photos: [], meubles: [] })),
    compteurs: COMPTEURS_PAR_DEFAUT.map((c) => ({ ...c })),
    cles: '',
    observations: '',
    signatures: [],
    statut: 'brouillon',
  }), 'État des lieux créé.');
  if (nouveau?.id) { edlOuvert = nouveau.id; contexte.allerA('etat-des-lieux'); }
}

async function ajouterPhotos(edl, piece, { camera = false } = {}) {
  // camera : ouvre directement l'appareil photo de la tablette ; sinon, la
  // galerie (avec sélection multiple).
  const choisi = await choisirFichier({ accept: 'image/*', multiple: !camera, camera });
  const fichiers = camera ? (choisi ? [choisi] : []) : choisi;
  if (!fichiers?.length) return;
  notifier(`Envoi de ${fichiers.length} photo(s)…`);
  let reussies = 0;
  for (const fichier of fichiers) {
    try {
      /* eslint-disable no-await-in-loop */
      const reduite = await compresserPhoto(fichier);
      const nomPropre = nomPhoto(fichier);
      const depose = await api.deposerFichier('etats-des-lieux', `${edl.id}/${piece.id}/${nomPropre}.jpg`, reduite);
      await etat.modifierElement('etatsDesLieux', edl.id, (e) => {
        const cible = (e.pieces || []).find((p) => p.id === piece.id);
        if (cible) cible.photos = [...(cible.photos || []), { chemin: depose.chemin, legende: '' }];
      });
      reussies += 1;
    } catch (erreur) { notifier(messageStockage(erreur), 'erreur'); }
  }
  bilanEnvoi(reussies, fichiers.length);
}

/** Nom de fichier propre pour une photo (les photos de caméra n'ont parfois pas de nom). */
const nomPhoto = (fichier) => {
  const base = String(fichier.name || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return base || `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
};

const CODES_STOCKAGE = {
  'storage/unauthorized': 'accès refusé par les règles de sécurité du stockage (compte non reconnu comme gérant ?)',
  'storage/unauthenticated': 'session expirée — reconnectez-vous',
  'storage/retry-limit-exceeded': 'réseau trop lent ou coupé pendant l’envoi',
  'storage/quota-exceeded': 'quota de stockage dépassé',
  'storage/canceled': 'envoi annulé',
  'storage/object-not-found': 'fichier introuvable sur le stockage',
};
export const messageStockage = (erreur) => {
  const code = erreur?.code || '';
  const explication = CODES_STOCKAGE[code];
  return explication ? `Photo non enregistrée : ${explication} [${code}].` : `Photo non enregistrée : ${erreur?.message || erreur} ${code ? `[${code}]` : ''}`.trim();
};

function bilanEnvoi(reussies, total) {
  if (reussies === total) notifier(total > 1 ? `${total} photos ajoutées.` : 'Photo ajoutée.', 'succes');
  else if (reussies) notifier(`${reussies} photo(s) sur ${total} ajoutée(s) — voir l’erreur ci-dessus.`, 'erreur');
  else notifier('Aucune photo n’a pu être enregistrée — voir l’erreur ci-dessus (Paramètres → « Tester le stockage » pour diagnostiquer).', 'erreur');
}

async function ajouterPhotosMeuble(edl, piece, meuble, { camera = false } = {}) {
  // Photos propres au meuble : rangées sous le dossier du meuble, reprises
  // sous sa ligne dans l'inventaire et dans le rapport PDF.
  const choisi = await choisirFichier({ accept: 'image/*', multiple: !camera, camera });
  const fichiers = camera ? (choisi ? [choisi] : []) : choisi;
  if (!fichiers?.length) return;
  notifier(`Envoi de ${fichiers.length} photo(s)…`);
  let reussies = 0;
  for (const fichier of fichiers) {
    try {
      /* eslint-disable no-await-in-loop */
      const reduite = await compresserPhoto(fichier);
      const nomPropre = nomPhoto(fichier);
      const depose = await api.deposerFichier('etats-des-lieux', `${edl.id}/${piece.id}/meubles/${meuble.id}/${nomPropre}.jpg`, reduite);
      await etat.modifierElement('etatsDesLieux', edl.id, (e) => {
        const cible = (e.pieces || []).find((p) => p.id === piece.id);
        const m = cible && (cible.meubles || []).find((x) => x.id === meuble.id);
        if (m) m.photos = [...(m.photos || []), { chemin: depose.chemin, legende: '' }];
      });
      reussies += 1;
    } catch (erreur) { notifier(messageStockage(erreur), 'erreur'); }
  }
  bilanEnvoi(reussies, fichiers.length);
}

/**
 * Galerie de vignettes avec, sous chacune, une légende modifiable et un ✕.
 * `surLegende(photo, texte)` et `surRetrait(photo)` enregistrent ; `cle`
 * sert à retrouver le champ après le rafraîchissement de la page.
 */
function galerie(photos, { cle, surLegende, surRetrait, retrait = false }) {
  if (!photos.length) return null;
  return h('div', { style: `display:flex;gap:.5rem;flex-wrap:wrap;margin:.4rem 0 0 ${retrait ? '1rem' : '0'}` },
    photos.map((photo, index) => h('div', { style: 'position:relative;width:110px' }, [
      vignette(photo.chemin, { surClic: () => ouvrirVisionneuse(photos, index, sujetDe(cle)) }),
      h('button', {
        class: 'bouton bouton-petit bouton-danger', type: 'button', title: 'Retirer cette photo',
        style: 'position:absolute;top:2px;right:2px;padding:0 .35rem',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await confirmer({
            titre: 'Retirer la photo',
            message: `Retirer la photo ${index + 1}${photo.legende ? ` (« ${photo.legende} »)` : ''} de l’état des lieux ? Elle ne figurera plus dans le rapport.`,
            libelleValider: 'Retirer la photo', danger: true,
          });
          if (ok) surRetrait(photo);
        },
      }, '✕'),
      h('input', {
        value: photo.legende || '', placeholder: `photo ${index + 1}`, title: 'Légende de la photo (reprise dans le rapport)',
        'data-focus': `${cle}-legende-${index}`,
        style: 'width:110px;font-size:.78rem;padding:.15rem .3rem;margin-top:.15rem',
        onchange: (e) => surLegende(photo, e.target.value),
      }),
    ])));
}

/** Charge (une fois) l'image d'une photo et renvoie son URL locale. */
function chargerImage(chemin) {
  const connue = vignettes.get(chemin);
  if (connue) return Promise.resolve(connue);
  return api.lireOctets('etats-des-lieux', chemin).then((octets) => {
    const url = URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' }));
    vignettes.set(chemin, url);
    return url;
  });
}

/**
 * Vignette d'une photo. En cas d'échec de chargement, le cadre l'indique en
 * clair (avec le code d'erreur) et propose de réessayer — jamais une case vide.
 */
function vignette(chemin, { surClic = null } = {}) {
  const cadre = h('div', {
    class: 'vignette', title: surClic ? 'Agrandir la photo' : '',
    style: 'width:110px;height:82px;border-radius:6px;border:1px solid var(--bordure);overflow:hidden;'
      + `background:#f1f3f5;display:flex;align-items:center;justify-content:center;${surClic ? 'cursor:zoom-in' : ''}`,
  });
  if (surClic) cadre.addEventListener('click', surClic);
  const charger = () => {
    cadre.replaceChildren(h('span', { class: 'legende', style: 'font-size:.7rem', texte: 'chargement…' }));
    chargerImage(chemin).then((url) => {
      const image = h('img', { src: url, alt: 'photo', style: 'width:110px;height:82px;object-fit:cover;display:block' });
      // Si le navigateur refuse l'adresse locale (blob:), on repasse en data:.
      image.addEventListener('error', () => {
        if (image.dataset.repli) { image.replaceWith(h('span', { class: 'legende', style: 'font-size:.68rem', texte: 'image illisible' })); return; }
        image.dataset.repli = '1';
        api.lireOctets('etats-des-lieux', chemin).then((octets) => new Promise((resoudre) => {
          const lecteur = new FileReader();
          lecteur.onload = () => resoudre(lecteur.result);
          lecteur.readAsDataURL(new Blob([octets], { type: 'image/jpeg' }));
        })).then((dataUrl) => { vignettes.set(chemin, dataUrl); image.src = dataUrl; }).catch(() => { image.replaceWith(h('span', { class: 'legende', texte: 'illisible' })); });
      }, { once: false });
      cadre.replaceChildren(image);
    }).catch((erreur) => {
      const code = erreur?.code || '';
      cadre.title = `${erreur?.message || erreur} ${code}`.trim();
      cadre.replaceChildren(h('div', { style: 'text-align:center;padding:.2rem;line-height:1.2' }, [
        h('div', { style: 'font-size:.68rem;color:var(--danger, #b3261e)', texte: `Photo indisponible${code ? ` (${code.replace('storage/', '')})` : ''}` }),
        h('button', { class: 'bouton bouton-petit', type: 'button', style: 'margin-top:.2rem;font-size:.7rem', onclick: (e) => { e.stopPropagation(); charger(); } }, 'Réessayer'),
      ]));
    });
  };
  charger();
  return cadre;
}

/** Intitulé lisible d'une galerie d'après sa clé (« piece-… » ou « meuble-… »). */
const sujetDe = (cle) => (String(cle).startsWith('meuble-') ? 'Photo du meuble' : 'Photo de la pièce');

/**
 * Visionneuse plein écran : la photo agrandie, sa légende, précédente /
 * suivante, fermeture par ✕, Échap ou clic sur le fond.
 */
function ouvrirVisionneuse(photos, indexDepart, sujet = 'Photo') {
  let index = indexDepart;
  const image = h('img', { alt: 'photo agrandie', style: 'max-width:92vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);background:#222' });
  const legende = h('div', { style: 'color:#fff;margin-top:.7rem;font-size:.95rem;text-align:center;max-width:92vw' });
  const fond = h('div', {
    class: 'visionneuse', role: 'dialog', 'aria-label': 'Photo agrandie',
    style: 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.88);display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;padding:1rem;touch-action:pan-x',
  });
  const fermer = () => { fond.remove(); document.removeEventListener('keydown', surTouche); };
  const montrer = () => {
    const photo = photos[index];
    image.removeAttribute('src');
    chargerImage(photo.chemin).then((url) => { image.src = url; }).catch(() => { legende.textContent = 'Photo indisponible.'; });
    legende.textContent = `${sujet} ${index + 1} / ${photos.length}${photo.legende ? ` — ${photo.legende}` : ''}`;
  };
  const precedent = () => { index = (index - 1 + photos.length) % photos.length; montrer(); };
  const suivant = () => { index = (index + 1) % photos.length; montrer(); };
  const surTouche = (e) => {
    if (e.key === 'Escape') fermer();
    else if (e.key === 'ArrowLeft') precedent();
    else if (e.key === 'ArrowRight') suivant();
  };
  const boutonFlottant = (texte, action, style) => h('button', {
    type: 'button', class: 'visionneuse-bouton', onclick: (e) => { e.stopPropagation(); action(); },
    style: `position:absolute;${style};background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:50%;`
      + 'width:2.8rem;height:2.8rem;font-size:1.4rem;cursor:pointer',
  }, texte);
  // Enregistrer la photo sur l'appareil : sur tablette/téléphone, la feuille
  // de partage propose Google Photos (« Importer dans Photos ») ; sinon, téléchargement.
  const partageDisponible = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  const enregistrer = async () => {
    try {
      const photo = photos[index];
      const url = await chargerImage(photo.chemin);
      const blob = await (await fetch(url)).blob();
      const nom = `${nomFichierTelechargement(`${sujet} ${index + 1}${photo.legende ? ` ${photo.legende}` : ''}`)}.jpg`;
      const fichier = new File([blob], nom, { type: 'image/jpeg' });
      if (partageDisponible && navigator.canShare({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: nom });
        return;
      }
      const lien = h('a', { href: url, download: nom, style: 'display:none' });
      document.body.append(lien);
      lien.click();
      setTimeout(() => lien.remove(), 1000);
    } catch (erreur) {
      if (erreur?.name !== 'AbortError') notifier(`Enregistrement impossible : ${erreur?.message || erreur}`, 'erreur');
    }
  };
  const boutonEnregistrer = h('button', {
    type: 'button', class: 'bouton bouton-petit visionneuse-enregistrer',
    style: 'position:absolute;top:.9rem;left:.9rem;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.4)',
    title: partageDisponible ? 'Envoyer la photo vers Google Photos ou une autre application' : 'Télécharger la photo sur cet appareil',
    onclick: (e) => { e.stopPropagation(); enregistrer(); },
  }, partageDisponible ? '📤 Enregistrer dans Google Photos…' : '⬇ Télécharger la photo');
  fond.append(
    boutonEnregistrer,
    boutonFlottant('✕', fermer, 'top:.8rem;right:.8rem'),
    photos.length > 1 ? boutonFlottant('‹', precedent, 'left:.6rem;top:50%;transform:translateY(-50%)') : null,
    photos.length > 1 ? boutonFlottant('›', suivant, 'right:.6rem;top:50%;transform:translateY(-50%)') : null,
    image, legende,
  );
  fond.addEventListener('click', (e) => { if (e.target === fond || e.target === legende) fermer(); });
  image.addEventListener('click', (e) => e.stopPropagation());
  // Balayage tactile : suivante / précédente.
  let departX = null;
  fond.addEventListener('touchstart', (e) => { departX = e.touches[0]?.clientX ?? null; }, { passive: true });
  fond.addEventListener('touchend', (e) => {
    const finX = e.changedTouches[0]?.clientX;
    if (departX !== null && finX !== undefined && Math.abs(finX - departX) > 50) (finX < departX ? suivant : precedent)();
    departX = null;
  }, { passive: true });
  document.addEventListener('keydown', surTouche);
  document.body.append(fond);
  montrer();
}

function blocPiece(edl, piece, numero) {
  return h('div', { class: 'piece-detail' }, [
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem' }, [
      h('span', {
        class: 'badge badge-attente', title: 'Numéro de la pièce sur le plan',
        style: 'min-width:1.6rem;text-align:center', texte: String(numero),
      }),
      h('input', {
        value: piece.nom, style: 'font-weight:600;flex:2;min-width:9rem', 'data-focus': `piece-${piece.id}-nom`,
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.nom = e.target.value;
        }).catch(signalerErreur),
      }),
      h('select', {
        style: 'flex:1;min-width:8rem', 'data-focus': `piece-${piece.id}-etat`,
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.etatGeneral = e.target.value;
        }).catch(signalerErreur),
      }, ETATS.map((o) => h('option', { value: o.valeur, selected: o.valeur === (piece.etatGeneral || '') }, o.libelle))),
      bouton('📷 Caméra', () => ajouterPhotos(edl, piece, { camera: true }), {
        petit: true, type: 'primaire', titre: 'Prendre une photo avec la caméra de la tablette',
      }),
      bouton('+ Photos', () => ajouterPhotos(edl, piece), { petit: true, titre: 'Choisir des photos dans la galerie' }),
      bouton('✕ Pièce', async () => {
        const ok = await confirmer({ titre: 'Retirer la pièce', message: `Retirer « ${piece.nom} » et ses photos du rapport ?`, libelleValider: 'Retirer', danger: true });
        if (ok) {
          ongletsActifs.delete(edl.id);
          await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
            x.pieces = x.pieces.filter((p) => p.id !== piece.id);
          }), 'Pièce retirée.');
        }
      }, { petit: true, type: 'danger' }),
    ]),
    blocElements(edl, piece),
    h('textarea', {
      rows: 2, style: 'width:100%;margin-top:.5rem', placeholder: 'Autres observations sur cette pièce (équipements, chauffage, éclairage…)',
      'data-focus': `piece-${piece.id}-commentaire`,
      onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
        const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.commentaire = e.target.value;
      }).catch(signalerErreur),
    }, piece.commentaire || ''),
    (piece.photos || []).length ? h('div', { class: 'legende', style: 'margin-top:.5rem', texte: `Photos de la pièce (${piece.photos.length})` }) : null,
    galerie(piece.photos || [], {
      cle: `piece-${piece.id}`,
      surLegende: (photo, texte) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
        const cible = x.pieces.find((p) => p.id === piece.id);
        const f = cible && (cible.photos || []).find((y) => y.chemin === photo.chemin);
        if (f) f.legende = texte;
      }).catch(signalerErreur),
      surRetrait: (photo) => executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
        const cible = x.pieces.find((p) => p.id === piece.id);
        if (cible) cible.photos = cible.photos.filter((f) => f.chemin !== photo.chemin);
      }), 'Photo retirée.'),
    }),
    blocMeubles(edl, piece),
  ]);
}

// ------------------------------------------------------------------- plan

/**
 * Plan du logement : une photo ou un scan du plan, sur lequel on pose le
 * numéro de chaque pièce d'un simple clic — le rapport PDF reprend le plan
 * avec ses repères.
 */
function cartePlan(edl) {
  const cheminPlan = `${edl.id}/plan.jpg`;
  const zone = h('div');

  const chargerImage = () => {
    const cadre = h('div', { style: 'position:relative;display:inline-block;max-width:100%' });
    const image = h('img', { alt: 'Plan du logement', style: 'max-width:100%;border-radius:8px;border:1px solid var(--bordure);display:block' });
    const connue = vignettes.get(cheminPlan);
    if (connue) image.src = connue;
    else {
      api.lireOctets('etats-des-lieux', cheminPlan).then((octets) => {
        const url = URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' }));
        vignettes.set(cheminPlan, url);
        image.src = url;
      }).catch(() => { image.alt = 'plan indisponible'; });
    }
    cadre.append(image);

    const selecteur = h('select', { style: 'min-width:11rem' },
      (edl.pieces || []).map((p, i) => h('option', { value: p.id }, `${i + 1} — ${p.nom}`)));

    const dessinerReperes = () => {
      cadre.querySelectorAll('.repere-plan').forEach((r) => r.remove());
      for (const repere of edl.plan?.reperes || []) {
        const numero = (edl.pieces || []).findIndex((p) => p.id === repere.pieceId) + 1;
        if (!numero) continue;
        cadre.append(h('button', {
          class: 'repere-plan', type: 'button',
          title: 'Cliquer pour retirer ce repère',
          style: `position:absolute;left:${repere.x * 100}%;top:${repere.y * 100}%;transform:translate(-50%,-50%);`
            + 'width:26px;height:26px;border-radius:50%;border:2px solid #fff;background:var(--accent, #1d6f5c);'
            + 'color:#fff;font-weight:700;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4);padding:0',
          onclick: (evenement) => {
            evenement.stopPropagation();
            executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
              x.plan = x.plan || { reperes: [] };
              x.plan.reperes = (x.plan.reperes || []).filter((r) => !(r.pieceId === repere.pieceId && r.x === repere.x && r.y === repere.y));
            }), 'Repère retiré.').then(() => {
              edl.plan.reperes = edl.plan.reperes.filter((r) => !(r.pieceId === repere.pieceId && r.x === repere.x && r.y === repere.y));
              dessinerReperes();
            });
          },
        }, String(numero)));
      }
    };

    image.addEventListener('click', (evenement) => {
      const cadreImage = image.getBoundingClientRect();
      const x = (evenement.clientX - cadreImage.left) / cadreImage.width;
      const y = (evenement.clientY - cadreImage.top) / cadreImage.height;
      const pieceId = selecteur.value;
      if (!pieceId) return;
      const repere = { pieceId, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      executer(etat.modifierElement('etatsDesLieux', edl.id, (e) => {
        e.plan = e.plan || {};
        e.plan.reperes = [...(e.plan.reperes || []), repere];
      })).then(() => {
        edl.plan = edl.plan || {};
        edl.plan.reperes = [...(edl.plan.reperes || []), repere];
        dessinerReperes();
      });
    });

    zone.replaceChildren(
      h('p', { class: 'legende', texte: 'Choisissez une pièce puis touchez le plan à son emplacement : son numéro s\'y pose. '
        + 'Toucher un repère le retire. Les numéros correspondent aux pièces ci-dessus.' }),
      h('div', { style: 'margin-bottom:.6rem' }, selecteur),
      cadre,
    );
    dessinerReperes();
  };

  const televerserPlan = async () => {
    const fichier = await choisirFichier({ accept: 'image/*' });
    if (!fichier) return;
    const reduite = await compresserPhoto(fichier);
    await api.deposerOctets('etats-des-lieux', cheminPlan, new Uint8Array(await reduite.arrayBuffer()), 'image/jpeg');
    vignettes.delete(cheminPlan);
    await executer(etat.modifierElement('etatsDesLieux', edl.id, (e) => {
      e.plan = { chemin: cheminPlan, reperes: (e.plan?.reperes || []) };
    }), 'Plan enregistré.');
    edl.plan = { chemin: cheminPlan, reperes: (edl.plan?.reperes || []) };
    chargerImage();
  };

  if (edl.plan?.chemin) chargerImage();
  else {
    zone.append(vide('Aucun plan pour l\'instant',
      'Photographiez un plan du logement (plan papier, croquis…) : vous poserez le numéro de chaque pièce dessus, '
      + 'et le rapport PDF le reprendra.'));
  }

  return carte({
    titre: 'Plan du logement et repères des pièces',
    actions: [bouton(edl.plan?.chemin ? 'Remplacer le plan…' : 'Ajouter le plan…', () => televerserPlan().catch(signalerErreur), { petit: true, type: 'primaire' })],
    corps: zone,
  });
}

// ----------------------------------------------- état des lieux contradictoire

/**
 * Fenêtre contradictoire : pendant une durée réglable (21 jours par défaut)
 * après l'état des lieux, chaque colocataire consulte l'état des lieux sur
 * son espace (postes, observations, mobilier, photos), répond point par
 * point (d'accord / remarque) et dépose ses propres photos. Ici, côté
 * gérant : publication, réglage de la date de fin, relevé des réponses,
 * rappel, rapport avec annexe.
 */
function carteContradictoire(edl, donnees, contexte) {
  const locataires = (edl.locataireIds || []).map((id) => donnees.locataires.find((l) => l.id === id)).filter(Boolean);
  const bien = bienDeEdl(contexte?.tout || donnees, edl);
  const zone = h('div');
  const apercu = apercuPourColocataire(edl);

  /** Copie les photos de l'état des lieux dans l'espace partagé (lisible par les colocataires). */
  const partagerPhotos = async () => {
    const photos = (edl.pieces || []).flatMap((p) => [...(p.photos || []), ...(p.meubles || []).flatMap((m) => m.photos || [])]);
    let copiees = 0;
    for (const photo of photos) {
      try {
        /* eslint-disable no-await-in-loop */
        const octets = await api.lireOctets('etats-des-lieux', photo.chemin);
        await api.deposerOctets('partage', cheminPartage(photo.chemin), octets, 'image/jpeg');
        copiees += 1;
      } catch (erreur) { console.warn('Copie de photo :', photo.chemin, erreur); }
    }
    return { copiees, total: photos.length };
  };

  /** Publie (ou republie) l'état des lieux sur l'espace de chaque colocataire. */
  const publier = async ({ finLe, dureeJours, envoyerEmail }) => {
    notifier('Publication : copie des photos pour les colocataires…');
    const copie = await partagerPhotos();
    const pieces = (edl.pieces || []).map((p, i) => ({ numero: i + 1, nom: p.nom }));
    let ouverts = 0;
    for (const locataire of locataires) {
      try {
        await ouvrirFenetreContradictoire({
          locataire, edl, finLe, dureeJours, pieces, apercu, bailleur: donnees.parametres.bailleurs?.[0], notifier: envoyerEmail,
          logement: bien ? { nom: bien.nom, adresse: [bien.adresse, [bien.codePostal, bien.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') } : null,
        });
        ouverts += 1;
      } catch (erreur) { notifier(erreur.message, 'erreur'); }
    }
    if (ouverts) {
      await executer(etat.modifierElement('etatsDesLieux', edl.id, (e) => {
        e.contradictoireFinLe = finLe; e.contradictoireDuree = dureeJours; e.contradictoirePublieLe = aujourdhui();
      }), `État des lieux publié pour ${ouverts} colocataire(s) (${copie.copiees}/${copie.total} photos), fenêtre ouverte jusqu'au ${date(finLe)}${envoyerEmail ? ', e-mails envoyés' : ''}.`);
      Object.assign(edl, { contradictoireFinLe: finLe, contradictoireDuree: dureeJours });
      dessiner();
    }
  };

  const ouvrir = async () => {
    const dureeInitiale = edl.contradictoireDuree || DUREE_PAR_DEFAUT;
    const saisie = await formulaire({
      titre: 'Ouvrir la fenêtre contradictoire',
      aide: 'L’état des lieux (postes, observations, mobilier, photos) est publié sur l’espace de chaque colocataire, qui répond point par point et dépose ses photos jusqu’à la date de fin incluse. Il en est informé par e-mail.',
      champs: [
        { cle: 'dureeJours', libelle: 'Durée de la fenêtre (jours après l’état des lieux)', type: 'entier', min: 1, max: 365, requis: true },
        { cle: 'finLe', libelle: 'Date de fin (calculée d’après la durée ; modifiable)', type: 'date', requis: true },
        { cle: 'email', libelle: 'Prévenir chaque colocataire par e-mail', type: 'case' },
      ],
      valeurs: { dureeJours: dureeInitiale, finLe: finDeFenetre(edl.date, dureeInitiale), email: true },
      libelleValider: 'Publier et ouvrir',
    });
    if (!saisie) return;
    const dureeJours = Math.max(1, Number(saisie.dureeJours) || DUREE_PAR_DEFAUT);
    // La durée saisie prime ; une date de fin modifiée à la main prime sur les deux.
    const finLe = saisie.finLe && saisie.finLe !== finDeFenetre(edl.date, dureeInitiale) ? saisie.finLe : finDeFenetre(edl.date, dureeJours);
    await publier({ finLe, dureeJours, envoyerEmail: Boolean(saisie.email) });
  };

  const modifierFin = async () => {
    const saisie = await formulaire({
      titre: 'Date de fin de la fenêtre contradictoire',
      aide: 'Prolonger ou raccourcir la période pendant laquelle les colocataires peuvent répondre. Les espaces sont mis à jour (sans nouvel e-mail).',
      champs: [{ cle: 'finLe', libelle: 'Réponses possibles jusqu’au (inclus)', type: 'date', requis: true }],
      valeurs: { finLe: edl.contradictoireFinLe },
    });
    if (!saisie?.finLe) return;
    for (const locataire of locataires) {
      const email = String(locataire.email || '').trim().toLowerCase();
      if (!email) continue;
      try {
        /* eslint-disable no-await-in-loop */
        const actuel = (await api.lirePortail(email)) || {};
        const complement = {};
        if (actuel.contradictoire?.edlId === edl.id) complement.contradictoire = { ...actuel.contradictoire, finLe: saisie.finLe, finLeMs: finEnMillisecondes(saisie.finLe) };
        if (actuel.contradictoires?.[edl.id]) complement.contradictoires = { ...actuel.contradictoires, [edl.id]: { ...actuel.contradictoires[edl.id], finLe: saisie.finLe, finLeMs: finEnMillisecondes(saisie.finLe) } };
        if (Object.keys(complement).length) await api.completerPortail(email, complement);
      } catch (erreur) { notifier(`${nomDe(locataire)} : ${erreur.message}`, 'erreur'); }
    }
    await executer(etat.modifierElement('etatsDesLieux', edl.id, (e) => { e.contradictoireFinLe = saisie.finLe; }), `Fenêtre ouverte jusqu'au ${date(saisie.finLe)}.`);
    edl.contradictoireFinLe = saisie.finLe;
    dessiner();
  };

  /** Les réponses et photos de chaque colocataire. */
  const chargerReponses = async () => {
    const resultats = [];
    for (const locataire of locataires) {
      const email = String(locataire.email || '').trim().toLowerCase();
      let reponses = null;
      let fichiers = [];
      if (email) {
        try { reponses = await api.lireReponsesContradictoire(email, edl.id); } catch { reponses = null; }
        try { fichiers = await api.listerFichiers('portail', `${email}/contradictoire/${edl.id}`); } catch { fichiers = []; }
      }
      resultats.push({ locataire, email, reponses, fichiers });
    }
    return resultats;
  };

  const relever = async () => {
    zone.querySelector('.releve-contradictoire')?.remove();
    const bloc = h('div', { class: 'releve-contradictoire', style: 'margin-top: .8rem' }, h('p', { class: 'legende', texte: 'Relevé en cours…' }));
    zone.append(bloc);
    const resultats = await chargerReponses();
    const annexe = annexeContradictoire(apercu, resultats.map((r) => ({ nom: nomDe(r.locataire), reponses: r.reponses?.reponses || {}, majLe: r.reponses?.majLe || '' })));
    bloc.replaceChildren(...resultats.map((r, i) => {
      const a = annexe[i];
      const repondu = Boolean(r.reponses);
      return h('div', { class: 'reponse-colocataire', style: 'margin-bottom:.7rem;padding:.55rem .7rem;border:1px solid var(--bordure);border-radius:8px' }, [
        h('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;font-weight:600' }, [
          nomDe(r.locataire),
          repondu ? badge(`répondu le ${date(a.repondLe)}`, 'info') : badge(r.email ? 'pas encore répondu' : 'sans adresse e-mail', 'attente'),
          repondu ? badge(a.bilan.complet ? (a.remarques.length ? `${a.remarques.length} remarque(s)` : 'tout d’accord') : `${a.bilan.repondus}/${a.bilan.total} points vus`, a.remarques.length ? 'attention' : 'succes') : null,
          r.fichiers.length ? badge(`${r.fichiers.length} photo(s)`, 'info') : null,
        ]),
        a.remarques.length ? h('ul', { style: 'margin:.3rem 0 0;padding-left:1.2rem;font-size:.9rem' }, a.remarques.map((rem) => h('li', {}, [
          h('strong', { texte: `${rem.piece} · ${rem.libelle}` }), rem.etat ? ` (${libelleEtat(rem.etat)})` : '', ` : ${rem.texte || 'remarque sans texte'}`,
        ]))) : null,
        r.fichiers.length ? h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem' },
          r.fichiers.map((f) => bouton(`📷 ${legendeDepot(f.nom)}`, () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur), { petit: true, titre: f.nom }))) : null,
      ]);
    }));
    if (!resultats.length) bloc.append(h('p', { class: 'legende', texte: 'Aucun colocataire rattaché à cet état des lieux.' }));
  };

  const rappeler = async () => {
    const resultats = await chargerReponses();
    const retardataires = resultats.filter((r) => r.email && !r.reponses);
    if (!retardataires.length) { notifier('Tous les colocataires ont répondu.'); return; }
    const ok = await confirmer({
      titre: 'Rappel par e-mail',
      message: `Envoyer un rappel à ${retardataires.map((r) => nomDe(r.locataire)).join(', ')} (réponses possibles jusqu'au ${date(edl.contradictoireFinLe)}) ?`,
      libelleValider: 'Envoyer le rappel',
    });
    if (!ok) return;
    for (const r of retardataires) {
      /* eslint-disable no-await-in-loop */
      await api.envoyerCourriel({ type: 'contradictoire',
        destinataires: destinatairesDe(r.locataire),
        sujet: 'Rappel : état des lieux à valider sur votre espace',
        html: `<p>Bonjour ${r.locataire.prenom || ''},</p><p>L'état des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du <strong>${date(edl.date)}</strong> attend vos réponses sur votre espace, jusqu'au <strong>${date(edl.contradictoireFinLe)}</strong> inclus :</p>`
          + `<p><a href="${window.location.origin}/colocataire">${window.location.origin}/colocataire</a></p><p>Sans réponse, l'état des lieux sera réputé accepté en l'état.</p><p>Bien cordialement,<br>${donnees.parametres.bailleurs?.[0]?.nom || ''}</p>`,
      });
    }
    notifier(`Rappel envoyé à ${retardataires.length} colocataire(s).`, 'succes');
  };

  const dessiner = () => {
    zone.replaceChildren();
    if (!edl.contradictoireFinLe) {
      zone.append(
        h('p', { class: 'legende', texte: 'Après la visite et les signatures, ouvrez la fenêtre contradictoire : l’état des lieux est publié sur l’espace de chaque colocataire, '
          + `qui y répond point par point (d’accord ou remarque) et dépose ses propres photos pendant la durée choisie (${DUREE_PAR_DEFAUT} jours par défaut). Il en est informé par e-mail, avec la date limite.` }),
        bouton('Ouvrir la fenêtre contradictoire…', () => ouvrir().catch(signalerErreur), { type: 'primaire' }),
      );
      return;
    }
    const close = edl.contradictoireFinLe < aujourdhui();
    zone.append(
      h('p', {}, [
        close ? badge(`Close depuis le ${date(edl.contradictoireFinLe)}`, 'attente')
          : badge(`Ouverte jusqu'au ${date(edl.contradictoireFinLe)} inclus`, 'succes'),
        h('span', { class: 'legende', texte: `  Publié le ${date(edl.contradictoirePublieLe || edl.date)} · ${edl.contradictoireDuree || DUREE_PAR_DEFAUT} jours` }),
      ]),
      h('div', { class: 'groupe-boutons', style: 'margin-top:.5rem' }, [
        bouton('Relever les réponses', () => relever().catch(signalerErreur), { petit: true, type: 'primaire', titre: 'Réponses point par point et photos de chaque colocataire' }),
        bouton('Rappel par e-mail', () => rappeler().catch(signalerErreur), { petit: true, titre: 'Aux colocataires qui n’ont pas encore répondu' }),
        bouton('Modifier la date de fin', () => modifierFin().catch(signalerErreur), { petit: true }),
        bouton('Republier l’état des lieux', async () => {
          const ok = await confirmer({ titre: 'Republier', message: 'Mettre à jour l’état des lieux publié sur les espaces (postes, observations, photos) avec sa version actuelle, sans nouvel e-mail ? Les réponses déjà données sont conservées.', libelleValider: 'Republier' });
          if (ok) await publier({ finLe: edl.contradictoireFinLe, dureeJours: edl.contradictoireDuree || DUREE_PAR_DEFAUT, envoyerEmail: false }).catch(signalerErreur);
        }, { petit: true }),
        bouton('Rapport PDF avec annexe contradictoire', () => genererRapport(edl, donnees, { annexe: true }).catch(signalerErreur), { petit: true, titre: 'Regénère le rapport avec les réponses et photos des colocataires en annexe, et le republie' }),
      ]),
    );
  };
  dessiner();

  return carte({
    titre: 'État des lieux contradictoire',
    aide: 'Les colocataires consultent l’état des lieux sur leur espace et y répondent point par point.',
    corps: zone,
  });
}

/**
 * Évaluation des postes de la pièce (murs, plafond, sol, prises et
 * interrupteurs, fenêtres, porte) : un état et une observation par poste,
 * repris dans le rapport PDF.
 */
function blocElements(edl, piece) {
  const majElement = (cle, transformation) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
    const cible = x.pieces.find((p) => p.id === piece.id);
    if (!cible) return;
    cible.elements = elementsDe(cible);
    const element = cible.elements.find((e) => e.cle === cle);
    if (element) transformation(element);
  }).catch(signalerErreur);

  return h('div', { style: 'display:grid;grid-template-columns:auto minmax(7rem,9rem) 1fr;gap:.3rem .5rem;align-items:center;margin-top:.2rem' },
    elementsDe(piece).flatMap((element) => [
      h('span', { style: 'font-size:.9rem', texte: element.nom }),
      h('select', {
        'data-focus': `piece-${piece.id}-${element.cle}-etat`, title: `État : ${element.nom.toLowerCase()}`,
        onchange: (e) => majElement(element.cle, (x) => { x.etat = e.target.value; }),
      }, ETATS.map((o) => h('option', { value: o.valeur, selected: o.valeur === (element.etat || '') }, o.libelle))),
      h('input', {
        value: element.commentaire || '', placeholder: 'observation (trace, fissure, rayure…)',
        'data-focus': `piece-${piece.id}-${element.cle}-commentaire`, style: 'min-width:0',
        onchange: (e) => majElement(element.cle, (x) => { x.commentaire = e.target.value; }),
      }),
    ]));
}

/**
 * Inventaire du mobilier de la pièce : chaque meuble avec sa quantité et son
 * état — c'est l'inventaire obligatoire du meublé (annexe du bail), repris
 * dans le rapport PDF.
 */
function blocMeubles(edl, piece) {
  const meubles = piece.meubles || [];
  const majMeuble = (meubleId, transformation) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
    const cible = x.pieces.find((p) => p.id === piece.id);
    const meuble = cible && (cible.meubles || []).find((m) => m.id === meubleId);
    if (meuble) transformation(meuble);
  }).catch(signalerErreur);

  return h('div', { style: 'margin-top:.6rem' }, [
    h('div', { style: 'display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem' }, [
      h('span', { class: 'legende', texte: `Mobilier (${meubles.length})` }),
      bouton('+ Meuble', async () => {
        const id = crypto.randomUUID();
        await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id);
          if (cible) cible.meubles = [...(cible.meubles || []), { id, nom: '', quantite: 1, etat: 'bon', commentaire: '', photos: [] }];
        }), null);
        focaliser(`meuble-${id}-nom`);
      }, { petit: true }),
    ]),
    ...meubles.map((meuble) => h('div', { style: 'margin-bottom:.45rem' }, [
      h('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap' }, [
        h('input', {
          value: meuble.nom || '', placeholder: 'ex. : lit double 160, matelas, table de chevet…',
          style: 'flex:3;min-width:11rem', 'data-focus': `meuble-${meuble.id}-nom`,
          onchange: (e) => majMeuble(meuble.id, (m) => { m.nom = e.target.value; }),
        }),
        h('input', {
          type: 'number', min: '1', step: '1', value: meuble.quantite || 1,
          style: 'width:4.2rem', title: 'Quantité', 'data-focus': `meuble-${meuble.id}-quantite`,
          onchange: (e) => majMeuble(meuble.id, (m) => { m.quantite = Number(e.target.value) || 1; }),
        }),
        h('select', {
          style: 'flex:1;min-width:7rem', title: 'État du meuble', 'data-focus': `meuble-${meuble.id}-etat`,
          onchange: (e) => majMeuble(meuble.id, (m) => { m.etat = e.target.value; }),
        }, ETATS.filter((o) => o.valeur).map((o) => h('option', { value: o.valeur, selected: o.valeur === (meuble.etat || 'bon') }, o.libelle))),
        bouton('📷', () => ajouterPhotosMeuble(edl, piece, meuble, { camera: true }), {
          petit: true, type: 'primaire', titre: 'Photographier ce meuble avec la caméra de la tablette',
        }),
        bouton('+ Photos', () => ajouterPhotosMeuble(edl, piece, meuble), {
          petit: true, titre: 'Choisir des photos de ce meuble dans la galerie',
        }),
        h('button', {
          class: 'bouton bouton-petit bouton-danger', type: 'button', title: 'Retirer ce meuble (et ses photos du rapport)',
          onclick: () => executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
            const cible = x.pieces.find((p) => p.id === piece.id);
            if (cible) cible.meubles = (cible.meubles || []).filter((m) => m.id !== meuble.id);
          }), 'Meuble retiré.'),
        }, '✕'),
      ]),
      h('input', {
        value: meuble.commentaire || '', placeholder: 'Observation sur ce meuble (rayure, tache, pied abîmé…)',
        'data-focus': `meuble-${meuble.id}-commentaire`,
        style: 'display:block;width:calc(100% - 1rem);margin:.25rem 0 0 1rem;font-size:.9rem;box-sizing:border-box',
        onchange: (e) => majMeuble(meuble.id, (m) => { m.commentaire = e.target.value; }),
      }),
      galerie(meuble.photos || [], {
        cle: `meuble-${meuble.id}`, retrait: true,
        surLegende: (photo, texte) => majMeuble(meuble.id, (m) => {
          const f = (m.photos || []).find((y) => y.chemin === photo.chemin); if (f) f.legende = texte;
        }),
        surRetrait: (photo) => executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id);
          const m = cible && (cible.meubles || []).find((y) => y.id === meuble.id);
          if (m) m.photos = (m.photos || []).filter((f) => f.chemin !== photo.chemin);
        }), 'Photo retirée.'),
      }),
    ])),
  ]);
}

async function signer(edl, donnees, partie) {
  const image = await demanderSignature({ titre: 'Signature', nom: partie.nom });
  if (!image) return;
  await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
    x.signatures = (x.signatures || []).filter((s) => s.cle !== partie.cle);
    x.signatures.push({ cle: partie.cle, nom: partie.nom, image, signeLe: aujourdhui() });
  }), `Signature de ${partie.nom} enregistrée.`);
}

/** Les signataires attendus : TOUS les bailleurs (Andy et Karine), puis chaque colocataire du bail. */
function partiesAttendues(edl, donnees) {
  const bailleurs = (donnees.parametres.bailleurs || []).filter((b) => b.nom);
  const parties = bailleurs.length
    ? bailleurs.map((b, i) => ({ cle: i === 0 ? 'bailleur' : `bailleur-${i}`, nom: `${b.nom} (bailleur)` }))
    : [{ cle: 'bailleur', nom: 'Bailleur' }];
  for (const id of edl.locataireIds || []) {
    const locataire = donnees.locataires.find((l) => l.id === id);
    if (locataire) parties.push({ cle: `locataire-${id}`, nom: nomDe(locataire), locataireId: id });
  }
  return parties;
}

async function genererRapport(edl, donnees, { annexe = false } = {}) {
  await chargerSignaturesDistantes(edl, donnees);
  const manquantes = partiesAttendues(edl, donnees).filter((p) => !signatureDe(edl, p));
  if (manquantes.length) {
    const ok = await confirmer({
      titre: 'Signatures manquantes',
      message: `${manquantes.map((p) => p.nom).join(', ')} n'${manquantes.length > 1 ? 'ont' : 'a'} pas encore signé. Générer le rapport quand même ?`,
      libelleValider: 'Générer sans ces signatures',
    });
    if (!ok) return;
  }
  notifier('Préparation du rapport (chargement des photos)…');
  const bien = bienDeEdl(donnees, edl);
  const locataires = (edl.locataireIds || []).map((id) => donnees.locataires.find((l) => l.id === id)).filter(Boolean);

  const photosParPiece = {};
  const photosParMeuble = {};
  for (const piece of edl.pieces || []) {
    photosParPiece[piece.id] = [];
    for (const photo of piece.photos || []) {
      try {
        /* eslint-disable no-await-in-loop */
        const octets = await api.lireOctets('etats-des-lieux', photo.chemin);
        photosParPiece[piece.id].push({ octets, legende: photo.legende || '' });
      } catch { /* photo manquante : on continue */ }
    }
    for (const meuble of piece.meubles || []) {
      for (const photo of meuble.photos || []) {
        try {
          const octets = await api.lireOctets('etats-des-lieux', photo.chemin);
          photosParMeuble[meuble.id] = [...(photosParMeuble[meuble.id] || []), { octets, legende: photo.legende || '' }];
        } catch { /* photo manquante : on continue */ }
      }
    }
  }

  const signatures = partiesAttendues(edl, donnees).map((partie) => {
    const signature = signatureDe(edl, partie);
    return {
      nom: partie.nom,
      image: signature?.image || null,
      signeLe: signature?.signeLe || '',
      mode: signature?.mode || '',
      emailMasque: signature?.emailMasque || '',
    };
  });

  // Plan avec repères, s'il a été fourni.
  let plan = null;
  if (edl.plan?.chemin) {
    try {
      const octetsPlan = await api.lireOctets('etats-des-lieux', edl.plan.chemin);
      plan = {
        octets: octetsPlan,
        reperes: (edl.plan.reperes || []).map((r) => ({
          numero: (edl.pieces || []).findIndex((p) => p.id === r.pieceId) + 1, x: r.x, y: r.y,
        })).filter((r) => r.numero > 0),
        legende: (edl.pieces || []).map((p, i) => ({ numero: i + 1, nom: p.nom })),
      };
    } catch { /* plan indisponible : le rapport se génère sans lui */ }
  }

  // Annexe contradictoire : réponses (d'accord / remarques) et photos de chaque colocataire.
  let annexeDonnees = null;
  if (annexe) {
    const apercu = apercuPourColocataire(edl);
    const entrees = [];
    for (const locataire of locataires) {
      const email = String(locataire.email || '').trim().toLowerCase();
      let reponses = null;
      const photos = [];
      if (email) {
        try { reponses = await api.lireReponsesContradictoire(email, edl.id); } catch { reponses = null; }
        let fichiers = [];
        try { fichiers = await api.listerFichiers('portail', `${email}/contradictoire/${edl.id}`); } catch { fichiers = []; }
        for (const fichier of fichiers) {
          try { photos.push({ octets: await api.lireOctets('portail', fichier.chemin), legende: legendeDepot(fichier.nom) }); } catch { /* photo illisible */ }
        }
      }
      entrees.push({ nom: nomDe(locataire), reponses: reponses?.reponses || {}, majLe: reponses?.majLe || '', photos });
    }
    annexeDonnees = annexeContradictoire(apercu, entrees);
  }

  const octets = await pdfEtatDesLieux({
    edl, bien, bailleur: donnees.parametres.bailleurs?.[0], locataires, photosParPiece, photosParMeuble, signatures, plan,
    annexe: annexeDonnees,
  });
  const nomFichier = `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} ${edl.date}${bien?.nom ? ` — ${bien.nom}` : ''}${annexe ? ' avec annexe contradictoire' : ''}.pdf`;

  await api.deposerOctets('documents', `États des lieux/${nomFichier}`, octets, 'application/pdf');

  const publications = [];
  for (const locataire of locataires) {
    try {
      await publierDocument({
        locataire, type: 'etat-des-lieux',
        titre: `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} — ${date(edl.date)}${bien?.nom ? ` — ${bien.nom}` : ''}`,
        nomFichier, octets,
      });
      publications.push(nomDe(locataire));
    } catch (erreur) { notifier(erreur.message, 'erreur'); }
  }

  await etat.enregistrer('etatsDesLieux', { ...edl, statut: 'finalise', rapportGenereLe: aujourdhui() });

  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
  lien.download = nomFichierTelechargement(nomFichier);
  document.body.append(lien);
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  notifier(publications.length
    ? `Rapport généré, téléchargé, rangé dans Documents et publié pour : ${publications.join(', ')}.`
    : 'Rapport généré, téléchargé et rangé dans Documents.', 'succes');
}

function carteReleves(edl) {
  return h('div', {}, [
    h('p', { class: 'legende', texte: 'Relevés des compteurs le jour de l’état des lieux, clés remises et observations générales.' }),
    ...(edl.compteurs || []).map((compteur, index) => h('div', { style: 'display:flex;gap:.6rem;align-items:center;margin-bottom:.5rem' }, [
      h('span', { style: 'min-width:7rem', texte: compteur.nom }),
      h('input', {
        value: compteur.valeur || '', placeholder: 'relevé', 'data-focus': `compteur-${index}`,
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          if (x.compteurs?.[index]) x.compteurs[index].valeur = e.target.value;
        }).catch(signalerErreur),
      }),
      h('span', { class: 'legende', texte: compteur.unite || '' }),
    ])),
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;margin-top:.6rem' }, [
      h('span', { style: 'min-width:7rem', texte: 'Clés remises' }),
      h('input', {
        value: edl.cles || '', placeholder: 'ex. : 3 clés d’entrée, 1 badge, 1 clé boîte aux lettres', style: 'flex:1', 'data-focus': 'cles',
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => { x.cles = e.target.value; }).catch(signalerErreur),
      }),
    ]),
    h('textarea', {
      rows: 3, style: 'width:100%;margin-top:.6rem', placeholder: 'Observations générales', 'data-focus': 'observations',
      onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => { x.observations = e.target.value; }).catch(signalerErreur),
    }, edl.observations || ''),
  ]);
}

function carteSignatures(edl, donnees) {
  const zone = h('div');
  const heure = (iso) => (iso && iso.includes('T') ? ` à ${new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '');
  const dessiner = () => {
    zone.replaceChildren(
      h('p', { class: 'legende', texte: 'Les bailleurs signent à l’écran, au doigt ou à la souris, idéalement sur place le jour de l’état des lieux. '
        + 'Chaque colocataire signe depuis son espace, à la fin de ses réponses contradictoires, avec un code reçu par e-mail ; il peut aussi signer ici, sur la tablette.' }),
      h('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap' },
        partiesAttendues(edl, donnees).map((partie) => {
          const signature = signatureDe(edl, partie);
          const locataire = partie.locataireId ? donnees.locataires.find((l) => l.id === partie.locataireId) : null;
          return h('div', { class: 'signature-partie', style: 'border:1px solid var(--bordure);border-radius:8px;padding:.7rem;min-width:14rem;max-width:20rem' }, [
            h('div', { style: 'font-weight:600;margin-bottom:.4rem;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap' }, [
              partie.nom,
              signature?.mode === 'distance' ? badge('signé à distance', 'info') : null,
            ]),
            signature
              ? h('img', { src: signature.image, alt: 'signature', style: 'width:170px;height:64px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid var(--bordure)' })
              : h('div', { class: 'legende', texte: partie.locataireId
                ? (edl.contradictoireFinLe ? `Pas encore signé · peut signer depuis son espace jusqu'au ${date(edl.contradictoireFinLe)}` : 'Pas encore signé')
                : 'Pas encore signé' }),
            signature ? h('div', { class: 'legende', style: 'margin-top:.3rem', texte: signature.mode === 'distance'
              ? `Depuis son espace le ${date(String(signature.signeLe).slice(0, 10))}${heure(signature.signeLe)} · code e-mail validé (${signature.emailMasque || ''})`
              : `Sur la tablette le ${date(String(signature.signeLe).slice(0, 10))}` }) : null,
            h('div', { style: 'margin-top:.5rem', class: 'groupe-boutons' }, [
              bouton(signature ? 'Signer à nouveau ici' : 'Signer ici', () => signer(edl, donnees, partie), { petit: true, type: signature ? undefined : 'primaire' }),
              !signature && locataire?.email && edl.contradictoireFinLe && edl.contradictoireFinLe >= aujourdhui()
                ? bouton('Rappel par e-mail', () => rappelerSignature(edl, donnees, locataire).catch(signalerErreur), { petit: true }) : null,
            ]),
          ]);
        })),
    );
  };
  dessiner();
  chargerSignaturesDistantes(edl, donnees).then(() => { dessiner(); const compteur = document.querySelector('.onglet[data-onglet="signatures"]'); if (compteur) compteur.textContent = `✍️ Signatures ${nombreSignatures(edl, donnees)}/${partiesAttendues(edl, donnees).length}`; });
  return zone;
}

async function rappelerSignature(edl, donnees, locataire) {
  await executer(api.envoyerCourriel({ type: 'contradictoire',
    destinataires: destinatairesDe(locataire),
    sujet: 'Rappel : signature de l’état des lieux sur votre espace',
    html: `<p>Bonjour ${locataire.prenom || ''},</p><p>L'état des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du <strong>${date(edl.date)}</strong> attend votre signature sur votre espace (rubrique « État des lieux », après vos réponses), jusqu'au <strong>${date(edl.contradictoireFinLe)}</strong> inclus :</p>`
      + `<p><a href="${window.location.origin}/colocataire">${window.location.origin}/colocataire</a></p><p>Bien cordialement,<br>${donnees.parametres.bailleurs?.[0]?.nom || ''}</p>`,
  }), `Rappel envoyé à ${nomDe(locataire)}.`);
}

/**
 * L'éditeur : un onglet par pièce (tout le détail de la pièce sur un seul
 * écran, sans ascenseur), puis les onglets Plan, Relevés & clés, Signatures
 * et Photos contradictoires.
 */
function editeur(edl, donnees, contexte) {
  const conteneur = h('div');
  const pieces = edl.pieces || [];
  const onglets = [
    ...pieces.map((piece, index) => ({ cle: `piece:${piece.id}`, numero: index + 1, libelle: piece.nom || 'Pièce', piece })),
    { cle: 'plan', libelle: '🗺️ Plan', titre: 'Plan du logement et repères' },
    { cle: 'releves', libelle: '🔢 Relevés', titre: 'Relevés des compteurs, clés, observations générales' },
    { cle: 'signatures', libelle: `✍️ Signatures ${nombreSignatures(edl, donnees)}/${partiesAttendues(edl, donnees).length}`, titre: 'Signatures des parties (tablette ou à distance depuis l’espace colocataire)' },
    { cle: 'contradictoire', libelle: '📷 Contradictoire', titre: 'État des lieux contradictoire : réponses et photos des colocataires' },
  ];
  let actif = ongletsActifs.get(edl.id);
  if (!onglets.some((o) => o.cle === actif)) actif = onglets[0].cle;
  ongletsActifs.set(edl.id, actif);

  const zone = h('div', { class: 'onglet-contenu' });
  const barre = h('div', { class: 'onglets', role: 'tablist' });

  const rendreContenu = () => {
    const onglet = onglets.find((o) => o.cle === actif) || onglets[0];
    let contenu;
    if (onglet.piece) contenu = blocPiece(edl, onglet.piece, onglet.numero);
    else if (onglet.cle === 'plan') contenu = cartePlan(edl);
    else if (onglet.cle === 'releves') contenu = carteReleves(edl);
    else if (onglet.cle === 'signatures') contenu = carteSignatures(edl, donnees);
    else contenu = carteContradictoire(edl, donnees, contexte);
    zone.replaceChildren(contenu);
    for (const b of barre.querySelectorAll('.onglet')) {
      const estActif = b.dataset.onglet === actif;
      b.classList.toggle('actif', estActif);
      if (estActif) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  };
  const choisir = (cle) => {
    actif = cle;
    ongletsActifs.set(edl.id, cle);
    rendreContenu();
    // Le bandeau reste fixé en haut : on remet le détail de l'onglet en début de zone.
    const defilant = document.getElementById('contenu');
    if (defilant) defilant.scrollTop = 0;
  };

  for (const onglet of onglets) {
    barre.append(h('button', {
      type: 'button', role: 'tab', class: `onglet${onglet.piece ? ' onglet-piece' : ' onglet-section'}`,
      'data-onglet': onglet.cle, 'data-focus': `onglet-${onglet.cle}`,
      title: onglet.piece ? `Pièce ${onglet.numero} : ${onglet.libelle}` : (onglet.titre || onglet.libelle),
      onclick: () => choisir(onglet.cle),
    }, onglet.piece
      ? [h('span', { class: 'onglet-numero', texte: String(onglet.numero) }), h('span', { texte: onglet.libelle })]
      : onglet.libelle));
  }

  // Bandeau compact et FIXE en haut de la zone : retour, titre et statut,
  // actions, puis les onglets sur une seule ligne (défilante si besoin).
  const bandeau = h('div', { class: 'edl-bandeau' }, [
    h('div', { class: 'edl-bandeau-ligne' }, [
      bouton('← Liste', () => { edlOuvert = null; contexte.allerA('etat-des-lieux'); }, { petit: true, titre: 'Retour à la liste des états des lieux' }),
      h('div', { class: 'edl-titre' }, [
        h('strong', { texte: `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${date(edl.date)}${bienDeEdl(contexte.tout || donnees, edl)?.nom ? ` — ${bienDeEdl(contexte.tout || donnees, edl).nom}` : ''}` }),
        edl.statut === 'finalise'
          ? h('span', { class: 'badge badge-succes', title: 'Rapport déjà généré — toute modification demandera une nouvelle génération.', texte: 'Rapport généré' })
          : h('span', { class: 'badge badge-attention', title: 'Brouillon — tout est modifiable.', texte: 'Brouillon' }),
      ]),
      h('div', { class: 'groupe-boutons' }, [
        bouton('+ Pièce', async () => {
          const id = crypto.randomUUID();
          ongletsActifs.set(edl.id, `piece:${id}`);
          await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
            x.pieces = [...(x.pieces || []), { id, nom: 'Nouvelle pièce', etatGeneral: '', commentaire: '', elements: elementsParDefaut(), photos: [], meubles: [] }];
          }), 'Pièce ajoutée.');
          focaliser(`piece-${id}-nom`, { selectionner: true });
        }, { petit: true, titre: 'Ajouter une pièce (un nouvel onglet)' }),
        bouton('Rapport PDF', () => genererRapport(edl, donnees).catch(signalerErreur), { petit: true, type: 'primaire', titre: 'Générer le rapport PDF, le ranger et le publier' }),
      ]),
    ]),
    barre,
  ]);

  conteneur.append(bandeau, carte({ corps: zone }));
  rendreContenu();

  return conteneur;
}

export default {
  cle: 'etat-des-lieux',
  libelle: 'États des lieux',
  icone: '📷',
  titre: 'États des lieux',
  sousTitre: 'Reportage photo pièce par pièce, signatures des parties, rapport PDF.',
  compteur(contexte) {
    const brouillons = (contexte.donnees?.etatsDesLieux || []).filter((e) => e.statut !== 'finalise').length;
    return brouillons || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const edls = donnees.etatsDesLieux || [];

    if (edlOuvert) {
      const edl = edls.find((e) => e.id === edlOuvert);
      if (edl) return editeur(edl, donnees, contexte);
      edlOuvert = null;
    }

    const conteneur = h('div');
    conteneur.append(barreOutils([
      bouton('+ État des lieux', () => creerEtatDesLieux(donnees, contexte), { type: 'primaire' }),
    ]));

    if (!edls.length) {
      conteneur.append(carte({
        titre: 'Aucun état des lieux',
        corps: vide('Préparez l’entrée des colocataires',
          'Créez l’état des lieux d’entrée : vous photographierez chaque pièce depuis votre téléphone ou votre ordinateur, '
          + 'chacun signera à l’écran, et le rapport PDF sera envoyé sur l’espace de chaque colocataire.'),
      }));
      return conteneur;
    }

    for (const edl of [...edls].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
      const nbPhotos = (edl.pieces || []).reduce((s, p) => s + (p.photos || []).length
        + (p.meubles || []).reduce((t, m) => t + (m.photos || []).length, 0), 0);
      const nbSignatures = (edl.signatures || []).length;
      const logement = bienDeEdl(contexte.tout || donnees, edl);
      conteneur.append(carte({
        titre: `${edl.type === 'sortie' ? 'Sortie' : 'Entrée'} — ${date(edl.date)}${logement ? ` — ${logement.nom}` : ''}`,
        aide: `${(edl.pieces || []).length} pièce(s), ${nbPhotos} photo(s), ${nbSignatures} signature(s)`,
        actions: [
          edl.statut === 'finalise' ? badge('Rapport généré', 'succes') : badge('Brouillon', 'attention'),
          bouton('Ouvrir', () => { edlOuvert = edl.id; contexte.allerA('etat-des-lieux'); }, { petit: true, type: 'primaire' }),
          bouton('✕', async () => {
            const ok = await confirmer({
              titre: 'Supprimer l’état des lieux',
              message: 'Le rapport PDF déjà publié sur les espaces colocataires ne sera pas retiré.',
              libelleValider: 'Supprimer', danger: true,
            });
            if (ok) await executer(etat.supprimer('etatsDesLieux', edl.id), 'État des lieux supprimé.');
          }, { petit: true, type: 'danger' }),
        ],
        corps: h('div'),
        serre: true,
      }));
    }
    return conteneur;
  },
};
