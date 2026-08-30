// Espace colocataire : consultation et téléchargement de ses documents
// (quittances, états des lieux, bail). Lecture seule — aucun accès aux
// données de gestion.

import * as api from '../api.js';
import { h, vider, signalerErreur } from '../ui.js';
import { date, taille } from '../format.js';

const LIBELLES_TYPE = {
  quittance: { libelle: 'Quittance de loyer', pluriel: 'Quittances de loyer', icone: '🧾' },
  'etat-des-lieux': { libelle: 'État des lieux', pluriel: 'États des lieux', icone: '📷' },
  bail: { libelle: 'Bail', pluriel: 'Baux', icone: '📜' },
  regularisation: { libelle: 'Régularisation des charges', pluriel: 'Régularisations des charges', icone: '💧' },
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
      h('button', { class: 'bouton', type: 'button', onclick: () => { seDeconnecter().catch(signalerErreur); } }, 'Se déconnecter'),
    ]),
    erreur
      ? h('div', { class: 'alerte alerte-erreur', texte: `Impossible de charger vos documents : ${erreur.message}. Rechargez la page (F5).` })
      : null,
    !erreur && !documents.length
      ? h('div', { class: 'alerte alerte-info', texte: 'Aucun document pour l’instant. Vos quittances et votre état des lieux apparaîtront ici dès que votre bailleur les aura publiés.' })
      : null,
    ...['etat-des-lieux', 'bail', 'quittance', 'regularisation', 'autre']
      .filter((cle) => groupes.has(cle))
      .map((cle) => h('section', { class: 'portail-section' }, [
        h('h2', { texte: `${LIBELLES_TYPE[cle].icone} ${groupes.get(cle).length > 1 ? LIBELLES_TYPE[cle].pluriel : LIBELLES_TYPE[cle].libelle}` }),
        ...groupes.get(cle)
          .sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)))
          .map(ligneDocument),
      ])),
    h('footer', { class: 'portail-pied', texte: 'Espace privé — seuls vous et votre bailleur voyez ces documents.' }),
  ]));
}
