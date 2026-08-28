// États des lieux : reportage photo pièce par pièce, relevés, signatures des
// parties à l'écran, et génération du rapport PDF publié sur le portail de
// chaque colocataire.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { date, aujourdhui, taille } from '../format.js';
import { demanderSignature } from '../signature.js';
import { pdfEtatDesLieux } from '../pdf.js';
import { publierDocument } from '../portail-publication.js';

const PIECES_PROPOSEES = ['Séjour', 'Cuisine', 'Chambre 1', 'Chambre 2', 'Chambre 3',
  'Salle de bain', 'WC', 'Entrée / couloir', 'Extérieur / jardin', 'Garage / annexe'];
const COMPTEURS_PAR_DEFAUT = [
  { nom: 'Électricité', valeur: '', unite: 'kWh' },
  { nom: 'Eau froide', valeur: '', unite: 'm³' },
  { nom: 'Gaz', valeur: '', unite: 'm³' },
];
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

/** Réduit une photo (canvas) : au plus 1400 px de large, JPEG qualité 0,82. */
async function compresserPhoto(fichier) {
  const image = await createImageBitmap(fichier);
  const echelle = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canevas = document.createElement('canvas');
  canevas.width = Math.round(image.width * echelle);
  canevas.height = Math.round(image.height * echelle);
  canevas.getContext('2d').drawImage(image, 0, 0, canevas.width, canevas.height);
  image.close?.();
  return new Promise((resoudre) => { canevas.toBlob(resoudre, 'image/jpeg', 0.82); });
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
    pieces: PIECES_PROPOSEES.slice(0, 6).map((nom) => ({ id: crypto.randomUUID(), nom, etatGeneral: '', commentaire: '', photos: [] })),
    compteurs: COMPTEURS_PAR_DEFAUT.map((c) => ({ ...c })),
    cles: '',
    observations: '',
    signatures: [],
    statut: 'brouillon',
  }), 'État des lieux créé.');
  if (nouveau?.id) { edlOuvert = nouveau.id; contexte.allerA('etat-des-lieux'); }
}

async function ajouterPhotos(edl, piece) {
  const fichiers = await choisirFichier({ accept: 'image/*', multiple: true });
  if (!fichiers?.length) return;
  notifier(`Envoi de ${fichiers.length} photo(s)…`);
  for (const fichier of fichiers) {
    try {
      /* eslint-disable no-await-in-loop */
      const reduite = await compresserPhoto(fichier);
      const nomPropre = fichier.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-');
      const depose = await api.deposerFichier('etats-des-lieux', `${edl.id}/${piece.id}/${nomPropre}.jpg`, reduite);
      await etat.modifierElement('etatsDesLieux', edl.id, (e) => {
        const cible = (e.pieces || []).find((p) => p.id === piece.id);
        if (cible) cible.photos = [...(cible.photos || []), { chemin: depose.chemin, legende: '' }];
      });
    } catch (erreur) { signalerErreur(erreur); }
  }
  notifier('Photos ajoutées.', 'succes');
}

function vignette(chemin) {
  const image = h('img', {
    alt: '', style: 'width:110px;height:82px;object-fit:cover;border-radius:6px;border:1px solid var(--bordure)',
  });
  const connue = vignettes.get(chemin);
  if (connue) { image.src = connue; return image; }
  api.lireOctets('etats-des-lieux', chemin).then((octets) => {
    const url = URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' }));
    vignettes.set(chemin, url);
    image.src = url;
  }).catch(() => { image.alt = 'photo indisponible'; });
  return image;
}

function blocPiece(edl, piece) {
  return h('div', { style: 'border:1px solid var(--bordure);border-radius:8px;padding: .8rem;margin-bottom:.8rem' }, [
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem' }, [
      h('input', {
        value: piece.nom, style: 'font-weight:600;flex:2;min-width:9rem',
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.nom = e.target.value;
        }).catch(signalerErreur),
      }),
      h('select', {
        style: 'flex:1;min-width:8rem',
        onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.etatGeneral = e.target.value;
        }).catch(signalerErreur),
      }, ETATS.map((o) => h('option', { value: o.valeur, selected: o.valeur === (piece.etatGeneral || '') }, o.libelle))),
      bouton('+ Photos', () => ajouterPhotos(edl, piece), { petit: true, type: 'primaire' }),
      bouton('✕ Pièce', async () => {
        const ok = await confirmer({ titre: 'Retirer la pièce', message: `Retirer « ${piece.nom} » et ses photos du rapport ?`, libelleValider: 'Retirer', danger: true });
        if (ok) await executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
          x.pieces = x.pieces.filter((p) => p.id !== piece.id);
        }), 'Pièce retirée.');
      }, { petit: true, type: 'danger' }),
    ]),
    h('textarea', {
      rows: 2, style: 'width:100%', placeholder: 'Observations sur cette pièce (sols, murs, équipements…)',
      onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
        const cible = x.pieces.find((p) => p.id === piece.id); if (cible) cible.commentaire = e.target.value;
      }).catch(signalerErreur),
    }, piece.commentaire || ''),
    (piece.photos || []).length ? h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem' },
      piece.photos.map((photo) => h('div', { style: 'position:relative' }, [
        vignette(photo.chemin),
        h('button', {
          class: 'bouton bouton-petit bouton-danger', type: 'button', title: 'Retirer cette photo',
          style: 'position:absolute;top:2px;right:2px;padding:0 .35rem',
          onclick: () => executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
            const cible = x.pieces.find((p) => p.id === piece.id);
            if (cible) cible.photos = cible.photos.filter((f) => f.chemin !== photo.chemin);
          }), 'Photo retirée.'),
        }, '✕'),
      ]))) : null,
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

/** Les signataires attendus : le bailleur et chaque colocataire du bail. */
function partiesAttendues(edl, donnees) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  const parties = [{ cle: 'bailleur', nom: `${bailleur?.nom || 'Bailleur'} (bailleur)` }];
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
  for (const piece of edl.pieces || []) {
    photosParPiece[piece.id] = [];
    for (const photo of piece.photos || []) {
      try {
        /* eslint-disable no-await-in-loop */
        const octets = await api.lireOctets('etats-des-lieux', photo.chemin);
        photosParPiece[piece.id].push({ octets, legende: photo.legende || '' });
      } catch { /* photo manquante : on continue */ }
    }
  }

  const signatures = partiesAttendues(edl, donnees).map((partie) => ({
    nom: partie.nom,
    image: (edl.signatures || []).find((s) => s.cle === partie.cle)?.image || null,
  }));

  const octets = await pdfEtatDesLieux({
    edl, bien, bailleur: donnees.parametres.bailleurs?.[0], locataires, photosParPiece, signatures,
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
  lien.download = nomFichier;
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
    bouton('+ Pièce', () => executer(etat.modifierElement('etatsDesLieux', edl.id, (x) => {
      x.pieces = [...(x.pieces || []), { id: crypto.randomUUID(), nom: 'Nouvelle pièce', etatGeneral: '', commentaire: '', photos: [] }];
    }), 'Pièce ajoutée.')),
    bouton('Générer le rapport PDF', () => genererRapport(edl, donnees).catch(signalerErreur), { type: 'primaire' }),
  ]));

  conteneur.append(carte({
    titre: `État des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${date(edl.date)}`,
    aide: edl.statut === 'finalise' ? 'Rapport déjà généré — toute modification demandera une nouvelle génération.' : 'Brouillon — tout est modifiable.',
    corps: h('div', {}, (edl.pieces || []).map((piece) => blocPiece(edl, piece))),
  }));

  conteneur.append(carte({
    titre: 'Relevés des compteurs et clés',
    corps: h('div', {}, [
      ...(edl.compteurs || []).map((compteur, index) => h('div', { style: 'display:flex;gap:.6rem;align-items:center;margin-bottom:.5rem' }, [
        h('span', { style: 'min-width:7rem', texte: compteur.nom }),
        h('input', {
          value: compteur.valeur || '', placeholder: 'relevé',
          onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => {
            if (x.compteurs?.[index]) x.compteurs[index].valeur = e.target.value;
          }).catch(signalerErreur),
        }),
        h('span', { class: 'legende', texte: compteur.unite || '' }),
      ])),
      h('div', { style: 'display:flex;gap:.6rem;align-items:center;margin-top:.6rem' }, [
        h('span', { style: 'min-width:7rem', texte: 'Clés remises' }),
        h('input', {
          value: edl.cles || '', placeholder: 'ex. : 3 clés d’entrée, 1 badge, 1 clé boîte aux lettres', style: 'flex:1',
          onchange: (e) => etat.modifierElement('etatsDesLieux', edl.id, (x) => { x.cles = e.target.value; }).catch(signalerErreur),
        }),
      ]),
      h('textarea', {
        rows: 2, style: 'width:100%;margin-top:.6rem', placeholder: 'Observations générales',
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
      const nbPhotos = (edl.pieces || []).reduce((s, p) => s + (p.photos || []).length, 0);
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
