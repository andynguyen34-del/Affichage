// États des lieux : reportage photo pièce par pièce, relevés, signatures des
// parties à l'écran, et génération du rapport PDF publié sur le portail de
// chaque colocataire.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { date, aujourdhui, taille, nomFichierTelechargement } from '../format.js';
import { demanderSignature } from '../signature.js';
import { pdfEtatDesLieux } from '../pdf.js';
import { publierDocument, ouvrirFenetreContradictoire } from '../portail-publication.js';
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
  { valeur: 'bon', libelle: 'Bon état' },
  { valeur: 'usage', libelle: 'État d’usage' },
  { valeur: 'mauvais', libelle: 'Mauvais état' },
];

// Identifiant de l'état des lieux ouvert en édition (état de la page).
let edlOuvert = null;

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
        options: donnees.baux.map((b) => ({ valeur: b.id, libelle: `${date(b.dateDebut)} — ${donnees.biens.find((x) => x.id === b.bienId)?.nom || ''}` })) },
    ],
    valeurs: { type: 'entree', date: aujourdhui(), bailId: bailActif?.id },
  });
  if (!saisie) return;
  const bail = donnees.baux.find((b) => b.id === saisie.bailId);
  const locataireIds = (bail?.colocataires?.length
    ? bail.colocataires.map((c) => c.locataireId)
    : [bail?.locataireId, bail?.coTitulaireId]).filter(Boolean);
  const nouveau = await executer(etat.enregistrer('etatsDesLieux', {
    type: saisie.type,
    date: saisie.date,
    bailId: saisie.bailId,
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
        onclick: () => surRetrait(photo),
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
  const charger = () => {
    cadre.replaceChildren(h('span', { class: 'legende', style: 'font-size:.7rem', texte: '…' }));
    chargerImage(chemin).then((url) => {
      const image = h('img', { src: url, alt: 'photo', style: 'width:110px;height:82px;object-fit:cover;display:block' });
      if (surClic) image.addEventListener('click', surClic);
      cadre.replaceChildren(image);
    }).catch((erreur) => {
      const code = erreur?.code || '';
      cadre.title = `${erreur?.message || erreur} ${code}`.trim();
      cadre.replaceChildren(h('div', { style: 'text-align:center;padding:.2rem;line-height:1.2' }, [
        h('div', { style: 'font-size:.68rem;color:var(--danger, #b3261e)', texte: `Photo indisponible${code ? ` (${code.replace('storage/', '')})` : ''}` }),
        h('button', { class: 'bouton bouton-petit', type: 'button', style: 'margin-top:.2rem;font-size:.7rem', onclick: charger }, 'Réessayer'),
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
  fond.append(
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
  return h('div', { style: 'border:1px solid var(--bordure);border-radius:8px;padding: .8rem;margin-bottom:.8rem' }, [
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
        if (ok) await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          x.pieces = x.pieces.filter((p) => p.id !== piece.id);
        }), 'Pièce retirée.');
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

// ----------------------------------------------- photos contradictoires

const ajouterJours = (dateIso, jours) => {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
};

/**
 * Fenêtre contradictoire : pendant 3 semaines après l'état des lieux, chaque
 * colocataire peut déposer ses propres photos depuis son espace. Ici, côté
 * gérant : ouverture de la fenêtre et relevé des photos déposées.
 */
function carteContradictoire(edl, donnees) {
  const locataires = (edl.locataireIds || []).map((id) => donnees.locataires.find((l) => l.id === id)).filter(Boolean);
  const zone = h('div');

  const ouvrir = async () => {
    const finLe = ajouterJours(edl.date, 21);
    const pieces = (edl.pieces || []).map((p, i) => ({ numero: i + 1, nom: p.nom }));
    let ouverts = 0;
    for (const locataire of locataires) {
      try {
        /* eslint-disable no-await-in-loop */
        await ouvrirFenetreContradictoire({
          locataire, edl, finLe, pieces, bailleur: donnees.parametres.bailleurs?.[0],
        });
        ouverts += 1;
      } catch (erreur) { notifier(erreur.message, 'erreur'); }
    }
    if (ouverts) {
      await executer(etat.modifierElement('etatsDesLieux', edl.id, (e) => { e.contradictoireFinLe = finLe; }),
        `Fenêtre ouverte jusqu'au ${date(finLe)} pour ${ouverts} colocataire(s), e-mails envoyés.`);
      edl.contradictoireFinLe = finLe;
      dessiner();
    }
  };

  const relever = async () => {
    zone.querySelector('.releve-contradictoire')?.remove();
    const bloc = h('div', { class: 'releve-contradictoire', style: 'margin-top: .8rem' });
    zone.append(bloc);
    for (const locataire of locataires) {
      const email = String(locataire.email || '').trim().toLowerCase();
      if (!email) continue;
      let fichiers = [];
      try {
        /* eslint-disable no-await-in-loop */
        fichiers = await api.listerFichiers('portail', `${email}/contradictoire/${edl.id}`);
      } catch { /* pas de dossier : aucune photo */ }
      bloc.append(h('div', { style: 'margin-bottom:.6rem' }, [
        h('div', { style: 'font-weight:600', texte: `${nomDe(locataire)} — ${fichiers.length} photo(s)` }),
        fichiers.length ? h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem' },
          fichiers.map((f) => bouton(f.nom, () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur), { petit: true }))) : null,
      ]));
    }
    if (!bloc.children.length) bloc.append(h('p', { class: 'legende', texte: 'Aucune photo contradictoire déposée pour l\'instant.' }));
  };

  const dessiner = () => {
    zone.replaceChildren();
    if (!edl.contradictoireFinLe) {
      zone.append(
        h('p', { class: 'legende', texte: 'Après la visite et les signatures, ouvrez la fenêtre contradictoire : '
          + 'chaque colocataire disposera de 3 semaines pour déposer ses propres photos des pièces depuis son espace. '
          + 'Il en sera informé par e-mail, avec la date limite.' }),
        bouton('Ouvrir la fenêtre contradictoire (3 semaines)', () => ouvrir().catch(signalerErreur), { type: 'primaire' }),
      );
      return;
    }
    const close = edl.contradictoireFinLe < aujourdhui();
    zone.append(
      h('p', {}, [
        close ? badge(`Close depuis le ${date(edl.contradictoireFinLe)}`, 'attente')
          : badge(`Ouverte jusqu'au ${date(edl.contradictoireFinLe)}`, 'succes'),
      ]),
      h('div', { class: 'groupe-boutons', style: 'margin-top:.5rem' }, [
        bouton('Relever les photos déposées', () => relever().catch(signalerErreur), { petit: true, type: 'primaire' }),
      ]),
    );
  };
  dessiner();

  return carte({
    titre: 'Photos contradictoires des colocataires',
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

async function genererRapport(edl, donnees) {
  const manquantes = partiesAttendues(edl, donnees)
    .filter((p) => !(edl.signatures || []).some((s) => s.cle === p.cle));
  if (manquantes.length) {
    const ok = await confirmer({
      titre: 'Signatures manquantes',
      message: `${manquantes.map((p) => p.nom).join(', ')} n'${manquantes.length > 1 ? 'ont' : 'a'} pas encore signé. Générer le rapport quand même ?`,
      libelleValider: 'Générer sans ces signatures',
    });
    if (!ok) return;
  }
  notifier('Préparation du rapport (chargement des photos)…');
  const bail = donnees.baux.find((b) => b.id === edl.bailId);
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
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

  const signatures = partiesAttendues(edl, donnees).map((partie) => ({
    nom: partie.nom,
    image: (edl.signatures || []).find((s) => s.cle === partie.cle)?.image || null,
  }));

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

  const octets = await pdfEtatDesLieux({
    edl, bien, bailleur: donnees.parametres.bailleurs?.[0], locataires, photosParPiece, photosParMeuble, signatures, plan,
  });
  const nomFichier = `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} ${edl.date}.pdf`;

  await api.deposerOctets('documents', `États des lieux/${nomFichier}`, octets, 'application/pdf');

  const publications = [];
  for (const locataire of locataires) {
    try {
      await publierDocument({
        locataire, type: 'etat-des-lieux',
        titre: `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} — ${date(edl.date)}`,
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

function editeur(edl, donnees, contexte) {
  const conteneur = h('div');
  conteneur.append(barreOutils([
    bouton('← Retour à la liste', () => { edlOuvert = null; contexte.allerA('etat-des-lieux'); }),
    bouton('+ Pièce', async () => {
      const id = crypto.randomUUID();
      await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
        x.pieces = [...(x.pieces || []), { id, nom: 'Nouvelle pièce', etatGeneral: '', commentaire: '', elements: elementsParDefaut(), photos: [], meubles: [] }];
      }), 'Pièce ajoutée.');
      focaliser(`piece-${id}-nom`, { selectionner: true });
    }),
    bouton('Générer le rapport PDF', () => genererRapport(edl, donnees).catch(signalerErreur), { type: 'primaire' }),
  ]));

  conteneur.append(carte({
    titre: `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${date(edl.date)}`,
    aide: edl.statut === 'finalise' ? 'Rapport déjà généré — toute modification demandera une nouvelle génération.' : 'Brouillon — tout est modifiable.',
    corps: h('div', {}, (edl.pieces || []).map((piece, index) => blocPiece(edl, piece, index + 1))),
  }));

  conteneur.append(cartePlan(edl));
  conteneur.append(carteContradictoire(edl, donnees));

  conteneur.append(carte({
    titre: 'Relevés des compteurs et clés',
    corps: h('div', {}, [
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
        rows: 2, style: 'width:100%;margin-top:.6rem', placeholder: 'Observations générales', 'data-focus': 'observations',
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => { x.observations = e.target.value; }).catch(signalerErreur),
      }, edl.observations || ''),
    ]),
  }));

  conteneur.append(carte({
    titre: 'Signatures des parties',
    aide: 'Chaque partie signe à l’écran, au doigt ou à la souris — idéalement sur place, le jour de l’état des lieux.',
    corps: h('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap' },
      partiesAttendues(edl, donnees).map((partie) => {
        const signature = (edl.signatures || []).find((s) => s.cle === partie.cle);
        return h('div', { style: 'border:1px solid var(--bordure);border-radius:8px;padding:.7rem;min-width:14rem' }, [
          h('div', { style: 'font-weight:600;margin-bottom:.4rem', texte: partie.nom }),
          signature
            ? h('img', { src: signature.image, alt: 'signature', style: 'width:170px;height:64px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid var(--bordure)' })
            : h('div', { class: 'legende', texte: 'Pas encore signé' }),
          h('div', { style: 'margin-top:.5rem' }, [
            bouton(signature ? 'Signer à nouveau' : 'Signer', () => signer(edl, donnees, partie), { petit: true, type: signature ? undefined : 'primaire' }),
          ]),
        ]);
      })),
  }));

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
      conteneur.append(carte({
        titre: `${edl.type === 'sortie' ? 'Sortie' : 'Entrée'} — ${date(edl.date)}`,
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
