// Espace colocataire : consultation et téléchargement de ses documents
// (quittances, états des lieux, bail). Lecture seule — aucun accès aux
// données de gestion.

import * as api from '../api.js';
import { h, vider, signalerErreur, choisirFichier, notifier } from '../ui.js';
import { date, dateLongue, taille, aujourdhui } from '../format.js';
import { compresserPhoto } from '../photos.js';
import { CATEGORIES_JUSTIFICATIFS, libelleCategorie, categorieDuChemin } from '../justificatifs.js';
import { ouvrirChangementMotDePasse } from '../compte.js';

const LIBELLES_TYPE = {
  quittance: { libelle: 'Quittance de loyer', pluriel: 'Quittances de loyer', icone: '🧾' },
  'etat-des-lieux': { libelle: 'État des lieux', pluriel: 'États des lieux', icone: '📷' },
  bail: { libelle: 'Bail', pluriel: 'Baux', icone: '📜' },
  regularisation: { libelle: 'Régularisation des charges', pluriel: 'Régularisations des charges', icone: '💧' },
  restitution: { libelle: 'Restitution du dépôt de garantie', pluriel: 'Restitutions de dépôt de garantie', icone: '💶' },
  autre: { libelle: 'Document', pluriel: 'Documents', icone: '📄' },
};

function ligneDocument(document_) {
  const type = LIBELLES_TYPE[document_.type] || LIBELLES_TYPE.autre;
  const nomFichier = document_.chemin.split('/').pop();
  return h('div', { class: 'portail-document' }, [
    h('span', { class: 'portail-icone', texte: type.icone }),
    h('div', { class: 'portail-details' }, [
      h('div', { class: 'portail-titre', texte: document_.titre || type.libelle }),
      h('div', { class: 'legende', texte: `${type.libelle} · publié le ${date(document_.publieLe)}`
        + (document_.taille ? ` · ${taille(document_.taille)}` : '') }),
    ]),
    h('div', { class: 'groupe-boutons' }, [
      h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => {
        api.ouvrirFichier('portail', document_.chemin).catch(signalerErreur);
      } }, 'Consulter'),
      h('button', { class: 'bouton bouton-petit bouton-primaire', type: 'button', onclick: () => {
        api.telechargerFichier('portail', document_.chemin, nomFichier).catch(signalerErreur);
      } }, 'Télécharger'),
    ]),
  ]);
}

/**
 * Photos contradictoires : pendant la fenêtre ouverte par le bailleur après
 * l'état des lieux, le colocataire dépose ici ses propres photos des pièces.
 * Elles ne sont ni modifiables ni supprimables une fois déposées.
 */
function sectionContradictoire(contradictoire) {
  const email = String(api.utilisateurEmail() || '').trim().toLowerCase();
  const prefixe = `${email}/contradictoire/${contradictoire.edlId}`;
  const ouverte = contradictoire.finLe >= aujourdhui();
  const listeZone = h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem' });

  const rafraichir = async () => {
    let fichiers = [];
    try { fichiers = await api.listerFichiers('portail', prefixe); } catch { /* rien déposé */ }
    listeZone.replaceChildren(...fichiers.map((f) => h('button', {
      class: 'bouton bouton-petit', type: 'button',
      onclick: () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur),
    }, `📷 ${f.nom}`)));
    if (!fichiers.length) listeZone.append(h('span', { class: 'legende', texte: 'Aucune photo déposée pour l’instant.' }));
  };
  rafraichir();

  const selecteur = h('select', { style: 'min-width:11rem' },
    (contradictoire.pieces || []).map((p) => h('option', { value: `${p.numero}-${p.nom}` }, `${p.numero} — ${p.nom}`)));

  const deposer = async ({ camera = false } = {}) => {
    const choisi = await choisirFichier({ accept: 'image/*', multiple: !camera, camera });
    const fichiers = camera ? (choisi ? [choisi] : []) : choisi;
    if (!fichiers?.length) return;
    notifier(`Envoi de ${fichiers.length} photo(s)…`);
    const piece = String(selecteur.value || 'piece').replace(/[\\/:*?"<>|]/g, '-');
    for (const fichier of fichiers) {
      try {
        /* eslint-disable no-await-in-loop */
        const reduite = await compresserPhoto(fichier);
        const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await api.deposerOctets('portail', `${prefixe}/${piece} ${horodatage}.jpg`,
          new Uint8Array(await reduite.arrayBuffer()), 'image/jpeg');
      } catch (erreur) { signalerErreur(erreur); }
    }
    notifier('Photos déposées : elles sont horodatées et ne peuvent plus être modifiées.', 'succes');
    rafraichir();
  };

  return h('section', { class: 'portail-section' }, [
    h('h2', { texte: '📷 Vos photos contradictoires' }),
    h('p', { class: 'legende', texte:
      `Suite à l'état des lieux ${contradictoire.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${dateLongue(contradictoire.dateEdl)}, `
      + (ouverte
        ? `vous pouvez déposer vos propres photos des pièces jusqu'au ${dateLongue(contradictoire.finLe)} inclus. `
          + 'Choisissez la pièce, puis ajoutez vos photos : elles sont datées automatiquement.'
        : `la période de dépôt s'est terminée le ${dateLongue(contradictoire.finLe)}. Vos photos restent consultables ci-dessous.`) }),
    ouverte ? h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' }, [
      selecteur,
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => deposer({ camera: true }).catch(signalerErreur) },
        '📷 Prendre une photo'),
      h('button', { class: 'bouton', type: 'button', onclick: () => deposer().catch(signalerErreur) },
        '+ Ajouter des photos'),
    ]) : null,
    listeZone,
  ]);
}

/**
 * Justificatifs à fournir au bailleur : assurance habitation, entretien des
 * climatiseurs, ramonage… Le colocataire dépose ici ses attestations (photo
 * ou PDF) ; elles sont horodatées et non modifiables une fois déposées.
 */
function sectionJustificatifs() {
  const email = String(api.utilisateurEmail() || '').trim().toLowerCase();
  const prefixe = `${email}/justificatifs`;
  const listeZone = h('div', { style: 'margin-top:.6rem' });

  const rafraichir = async () => {
    let fichiers = [];
    try { fichiers = await api.listerFichiers('portail', prefixe); } catch { /* rien déposé */ }
    const parCategorie = new Map();
    for (const fichier of fichiers) {
      const cle = categorieDuChemin(fichier.chemin);
      if (!parCategorie.has(cle)) parCategorie.set(cle, []);
      parCategorie.get(cle).push(fichier);
    }
    listeZone.replaceChildren(...CATEGORIES_JUSTIFICATIFS.map((categorie) => {
      const deposes = parCategorie.get(categorie.cle) || [];
      if (!deposes.length && categorie.cle === 'autre') return null;
      return h('div', { style: 'margin-bottom:.6rem' }, [
        h('div', {}, [
          h('strong', { texte: categorie.libelle }),
          categorie.periodicite ? h('span', { class: 'legende', texte: ` — ${categorie.periodicite}` }) : null,
          h('span', { class: `badge badge-${deposes.length ? 'succes' : 'attente'}`, style: 'margin-left:.5rem',
            texte: deposes.length ? `${deposes.length} document(s)` : 'à fournir' }),
        ]),
        deposes.length ? h('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem' },
          deposes.map((f) => h('button', {
            class: 'bouton bouton-petit', type: 'button',
            onclick: () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur),
          }, `📄 ${f.nom}`))) : null,
      ]);
    }).filter(Boolean));
  };
  rafraichir();

  const selecteur = h('select', { style: 'min-width:13rem' },
    CATEGORIES_JUSTIFICATIFS.map((c) => h('option', { value: c.cle }, c.libelle)));

  const deposer = async ({ camera = false } = {}) => {
    const accept = camera ? 'image/*' : 'image/*,application/pdf';
    const choisi = await choisirFichier({ accept, multiple: !camera, camera });
    const fichiers = camera ? (choisi ? [choisi] : []) : choisi;
    if (!fichiers?.length) return;
    notifier(`Envoi de ${fichiers.length} document(s)…`);
    const categorie = selecteur.value || 'autre';
    for (const fichier of fichiers) {
      try {
        /* eslint-disable no-await-in-loop */
        const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const estPdf = (fichier.type === 'application/pdf') || /\.pdf$/i.test(fichier.name || '');
        if (estPdf) {
          await api.deposerOctets('portail', `${prefixe}/${categorie}/${horodatage} ${String(fichier.name).replace(/[\\/:*?"<>|]/g, '-')}`,
            new Uint8Array(await fichier.arrayBuffer()), 'application/pdf');
        } else {
          const reduite = await compresserPhoto(fichier);
          await api.deposerOctets('portail', `${prefixe}/${categorie}/${horodatage}.jpg`,
            new Uint8Array(await reduite.arrayBuffer()), 'image/jpeg');
        }
      } catch (erreur) { signalerErreur(erreur); }
    }
    notifier('Document(s) déposé(s) : votre bailleur y a accès, ils ne sont plus modifiables.', 'succes');
    rafraichir();
  };

  return h('section', { class: 'portail-section' }, [
    h('h2', { texte: '📎 Vos justificatifs à fournir' }),
    h('p', { class: 'legende', texte:
      'Le bail prévoit que vous fournissiez chaque année certaines attestations : assurance habitation '
      + '(art. 11), entretien des climatiseurs et ramonage de la cheminée (entretien courant, art. 8). '
      + 'Choisissez le type de document, puis déposez la photo ou le PDF de l\'attestation.' }),
    h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' }, [
      selecteur,
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => deposer().catch(signalerErreur) },
        '+ Déposer un document'),
      h('button', { class: 'bouton', type: 'button', onclick: () => deposer({ camera: true }).catch(signalerErreur) },
        '📷 Photographier'),
    ]),
    listeZone,
  ]);
}

/** Affiche le portail dans la page (remplace l'application de gestion). */
export async function rendrePortail({ seDeconnecter }) {
  const application = document.getElementById('application');
  application.hidden = false;
  application.classList.add('portail');
  const racine = vider(application);

  let portail = null;
  let erreur = null;
  try { portail = await api.lireMonPortail(); }
  catch (e) { erreur = e; }

  const documents = portail?.documents || [];
  const groupes = new Map();
  for (const document_ of documents) {
    // Un type inconnu de cette version se range dans « Document » plutôt que
    // de disparaître de l'affichage.
    const cle = LIBELLES_TYPE[document_.type] ? document_.type : 'autre';
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(document_);
  }

  racine.append(h('div', { class: 'portail-cadre' }, [
    h('header', { class: 'portail-entete' }, [
      h('div', {}, [
        h('div', { class: 'portail-marque', texte: '🏠 Espace colocataire' }),
        h('h1', { texte: portail?.nom ? `Bonjour ${portail.nom.split(' ')[0]}` : 'Bonjour' }),
        h('p', { class: 'legende', texte: 'Vos documents de location : consultez-les à l’écran ou téléchargez-les.' }),
      ]),
      h('div', { class: 'groupe-boutons' }, [
        h('button', { class: 'bouton', type: 'button', onclick: () => { ouvrirChangementMotDePasse().catch(signalerErreur); } }, 'Mot de passe'),
        h('button', { class: 'bouton', type: 'button', onclick: () => { seDeconnecter().catch(signalerErreur); } }, 'Se déconnecter'),
      ]),
    ]),
    erreur
      ? h('div', { class: 'alerte alerte-erreur', texte: `Impossible de charger vos documents : ${erreur.message}. Rechargez la page (F5).` })
      : null,
    !erreur && !documents.length
      ? h('div', { class: 'alerte alerte-info', texte: 'Aucun document pour l’instant. Vos quittances et votre état des lieux apparaîtront ici dès que votre bailleur les aura publiés.' })
      : null,
    ...['etat-des-lieux', 'bail', 'quittance', 'regularisation', 'restitution', 'autre']
      .filter((cle) => groupes.has(cle))
      .map((cle) => h('section', { class: 'portail-section' }, [
        h('h2', { texte: `${LIBELLES_TYPE[cle].icone} ${groupes.get(cle).length > 1 ? LIBELLES_TYPE[cle].pluriel : LIBELLES_TYPE[cle].libelle}` }),
        ...groupes.get(cle)
          .sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)))
          .map(ligneDocument),
      ])),
    portail?.contradictoire ? sectionContradictoire(portail.contradictoire) : null,
    erreur ? null : sectionJustificatifs(),
    h('footer', { class: 'portail-pied', texte: 'Espace privé — seuls vous et votre bailleur voyez ces documents.' }),
  ]));
}
