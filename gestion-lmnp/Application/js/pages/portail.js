// Espace colocataire : ses documents (quittances, bail, états des lieux…),
// l'état des lieux contradictoire auquel il répond point par point, ses
// justificatifs à fournir, son compte. Aucun accès aux données de gestion.
// Organisé en rubriques (Accueil « À faire », État des lieux, Quittances,
// Bail & documents, Justificatifs, Mon compte).

import * as api from '../api.js';
import { h, vider, signalerErreur, choisirFichier, notifier } from '../ui.js';
import { date, dateLongue, taille, aujourdhui, montant, nomMois } from '../format.js';
import { compresserPhoto } from '../photos.js';
import { estInstallee, installable, proposerInstallation, consigneInstallation } from '../plein-ecran.js';
import { CATEGORIES_JUSTIFICATIFS, categorieDuChemin } from '../justificatifs.js';
import { ouvrirChangementMotDePasse } from '../compte.js';
import { pointsDe, bilanReponses, toutDaccord, estRepondu, libelleEtat } from '../contradictoire.js';
import { demanderSignature } from '../signature.js';

const LIBELLES_TYPE = {
  quittance: { libelle: 'Quittance de loyer', pluriel: 'Quittances de loyer', icone: '🧾' },
  'etat-des-lieux': { libelle: 'État des lieux', pluriel: 'États des lieux', icone: '📷' },
  bail: { libelle: 'Bail', pluriel: 'Baux', icone: '📜' },
  regularisation: { libelle: 'Régularisation des charges', pluriel: 'Régularisations des charges', icone: '💧' },
  restitution: { libelle: 'Restitution du dépôt de garantie', pluriel: 'Restitutions de dépôt de garantie', icone: '💶' },
  autre: { libelle: 'Document', pluriel: 'Documents', icone: '📄' },
};

const RUBRIQUES = [
  { cle: 'accueil', libelle: 'Accueil', icone: '🏠' },
  { cle: 'edl', libelle: 'État des lieux', icone: '📷' },
  { cle: 'quittances', libelle: 'Quittances', icone: '🧾' },
  { cle: 'documents', libelle: 'Bail & documents', icone: '📜' },
  { cle: 'justificatifs', libelle: 'Justificatifs', icone: '📎' },
  { cle: 'compte', libelle: 'Mon compte', icone: '⚙️' },
];

const monEmail = () => String(api.utilisateurEmail() || '').trim().toLowerCase();

/** Les états des lieux publiés sur l'espace (tous conservés depuis la v39), du plus récent au plus ancien. */
function contradictoiresDe(portail) {
  const parId = { ...(portail?.contradictoires || {}) };
  if (portail?.contradictoire?.edlId && !parId[portail.contradictoire.edlId]) parId[portail.contradictoire.edlId] = portail.contradictoire;
  return Object.values(parId).filter((c) => c && c.edlId)
    .sort((a, b) => String(b.dateEdl || '').localeCompare(String(a.dateEdl || '')) || String(b.publieLe || '').localeCompare(String(a.publieLe || '')));
}
const libelleEdl = (c) => `État des lieux ${c.type === 'sortie' ? 'de sortie' : 'd’entrée'} du ${date(c.dateEdl)}${c.logement?.nom ? ` — ${c.logement.nom}` : ''}`;
const nettoyer = (texte) => String(texte || '').replace(/[\\/:*?"<>|]/g, '-');

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

/** Documents d'un ou plusieurs types, rangés par année (la plus récente en premier). */
function sectionDocuments(documents, types, { titre, vide }) {
  const retenus = documents.filter((d) => types.includes(LIBELLES_TYPE[d.type] ? d.type : 'autre'))
    .sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)));
  const parAnnee = new Map();
  for (const d of retenus) {
    const annee = String(d.publieLe || '').slice(0, 4) || 'Sans date';
    if (!parAnnee.has(annee)) parAnnee.set(annee, []);
    parAnnee.get(annee).push(d);
  }
  return h('section', { class: 'portail-section' }, [
    h('h2', { texte: titre }),
    retenus.length ? null : h('p', { class: 'legende', texte: vide }),
    ...[...parAnnee.entries()].map(([annee, liste]) => h('div', { class: 'portail-annee' }, [
      h('div', { class: 'portail-annee-titre', texte: annee }),
      ...liste.map(ligneDocument),
    ])),
  ]);
}

// ------------------------------------------------- état des lieux contradictoire

/**
 * L'état des lieux publié par le bailleur, pièce par pièce, avec pour chaque
 * point (état général, postes, meubles, relevés) la réponse du colocataire :
 * d'accord, ou remarque. Réponses enregistrées au fil de l'eau pendant la
 * fenêtre ; figées ensuite. Photos du colocataire par pièce, non modifiables.
 */
function sectionContradictoire(contradictoire, { surChangement = () => {} } = {}) {
  const email = monEmail();
  const prefixe = `${email}/contradictoire/${contradictoire.edlId}`;
  const ouverte = contradictoire.finLe >= aujourdhui();
  const apercu = contradictoire.apercu || null;
  const points = pointsDe(apercu);
  const conteneur = h('div', { class: 'portail-edl', 'data-edl': contradictoire.edlId });
  let reponses = {};
  let signature = null; // portail/{email}/signatures/{edlId}, écrite par le serveur
  let minuterie = null;
  let enregistrement = Promise.resolve();
  const etatPourAccueil = () => ({ ...bilanReponses(apercu, reponses), signe: Boolean(signature) });

  const enregistrer = () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      enregistrement = enregistrement.then(() => api.ecrireMesReponses(contradictoire.edlId, reponses))
        .then(() => { const z = conteneur.querySelector('.edl-enregistre'); if (z) z.textContent = `Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`; })
        .catch((erreur) => notifier(`Réponses non enregistrées : ${erreur.message}`, 'erreur'));
    }, 700);
  };

  const repondre = (cle, accord, texte) => {
    if (!ouverte) return;
    const actuel = reponses[cle] || {};
    reponses = { ...reponses, [cle]: { accord, texte: texte !== undefined ? texte : (accord ? '' : (actuel.texte || '')) } };
    enregistrer();
    dessinerEntete();
    dessinerSignature();
    surChangement(etatPourAccueil());
  };

  // Photos du colocataire, par pièce (nom de fichier « {numéro}-{pièce} {horodatage}.jpg »).
  let fichiers = [];
  const rechargerFichiers = async () => {
    try { fichiers = await api.listerFichiers('portail', prefixe); } catch { fichiers = []; }
  };
  const fichiersDe = (piece) => fichiers.filter((f) => f.nom.startsWith(`${piece.numero}-${nettoyer(piece.nom)} `));

  const deposer = async (piece, { camera = false } = {}) => {
    const choisi = await choisirFichier({ accept: 'image/*', multiple: !camera, camera });
    const liste = camera ? (choisi ? [choisi] : []) : choisi;
    if (!liste?.length) return;
    notifier(`Envoi de ${liste.length} photo(s)…`);
    const nomPiece = `${piece.numero}-${nettoyer(piece.nom)}`;
    for (const fichier of liste) {
      try {
        /* eslint-disable no-await-in-loop */
        const reduite = await compresserPhoto(fichier);
        const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await api.deposerOctets('portail', `${prefixe}/${nomPiece} ${horodatage}.jpg`,
          new Uint8Array(await reduite.arrayBuffer()), 'image/jpeg');
      } catch (erreur) { signalerErreur(erreur); }
    }
    notifier('Photos déposées : elles sont horodatées et ne peuvent plus être modifiées.', 'succes');
    await rechargerFichiers();
    dessinerPieces();
  };

  const vignette = (espace, chemin, legende) => {
    const image = h('img', { alt: legende || 'photo', class: 'portail-vignette', loading: 'lazy', title: legende || '' });
    api.lireOctets(espace, chemin).then((octets) => { image.src = URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' })); })
      .catch(() => { image.alt = 'Photo indisponible'; image.classList.add('indisponible'); });
    return h('button', { class: 'portail-vignette-bouton', type: 'button', title: legende || 'Agrandir', onclick: () => api.ouvrirFichier(espace, chemin).catch(signalerErreur) }, image);
  };

  const rangee = (point) => {
    const reponse = reponses[point.cle];
    const zoneTexte = h('textarea', {
      rows: 2, placeholder: 'Votre remarque (visible du bailleur, jointe au rapport)', 'data-point': point.cle,
      hidden: reponse?.accord !== false, disabled: !ouverte,
      oninput: (e) => { repondre(point.cle, false, e.target.value); },
    }, reponse?.texte || '');
    const ok = h('button', {
      class: `bouton bouton-petit${reponse?.accord === true ? ' actif-ok' : ''}`, type: 'button', disabled: !ouverte,
      onclick: (e) => { repondre(point.cle, true); e.target.classList.add('actif-ok'); e.target.nextElementSibling.classList.remove('actif-non'); zoneTexte.hidden = true; },
    }, '✓ D’accord');
    const non = h('button', {
      class: `bouton bouton-petit${reponse?.accord === false ? ' actif-non' : ''}`, type: 'button', disabled: !ouverte,
      onclick: (e) => { repondre(point.cle, false); e.target.classList.add('actif-non'); e.target.previousElementSibling.classList.remove('actif-ok'); zoneTexte.hidden = false; zoneTexte.focus(); },
    }, '✗ Remarque');
    return h('div', { class: `edl-point${point.meuble ? ' meuble' : ''}`, 'data-cle': point.cle }, [
      h('div', { class: 'edl-constat' }, [
        h('div', { class: 'edl-constat-nom' }, [point.libelle, point.etat ? h('span', { class: `badge badge-etat etat-${point.etat}`, texte: libelleEtat(point.etat) }) : null]),
        h('div', { class: 'legende', texte: point.observation || '—' }),
      ]),
      h('div', { class: 'edl-reponse' }, [
        h('div', { class: 'edl-choix' }, [ok, non]),
        zoneTexte,
        !ouverte && !estRepondu(reponse) ? h('span', { class: 'legende', texte: 'Sans réponse : accord.' }) : null,
      ]),
    ]);
  };

  const carteAncienne = () => {
    // Publication antérieure (sans aperçu) : dépôt de photos par pièce seulement.
    const selecteur = h('select', { style: 'min-width:11rem' },
      (contradictoire.pieces || []).map((p) => h('option', { value: `${p.numero}-${p.nom}` }, `${p.numero} — ${p.nom}`)));
    const listeZone = h('div', { class: 'portail-photos' });
    const rafraichir = async () => {
      await rechargerFichiers();
      listeZone.replaceChildren(...fichiers.map((f) => h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur) }, `📷 ${f.nom}`)));
      if (!fichiers.length) listeZone.append(h('span', { class: 'legende', texte: 'Aucune photo déposée pour l’instant.' }));
    };
    rafraichir();
    const deposerAncien = (options) => deposer({ numero: selecteur.value.split('-')[0], nom: selecteur.value.split('-').slice(1).join('-') }, options).then(rafraichir);
    return [
      ouverte ? h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' }, [
        selecteur,
        h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => deposerAncien({ camera: true }).catch(signalerErreur) }, '📷 Prendre une photo'),
        h('button', { class: 'bouton', type: 'button', onclick: () => deposerAncien().catch(signalerErreur) }, '+ Ajouter des photos'),
      ]) : null,
      listeZone,
    ];
  };

  const entete = h('div', { class: 'edl-tete' });
  const dessinerEntete = () => {
    const bilan = bilanReponses(apercu, reponses);
    entete.replaceChildren(
      h('div', {}, [
        h('div', { class: 'edl-tete-titre', texte: `État des lieux ${contradictoire.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${date(contradictoire.dateEdl)}${contradictoire.logement?.nom ? ` — ${contradictoire.logement.nom}` : ''}` }),
        h('div', { class: 'legende', texte: ouverte
          ? `Vos réponses sont possibles jusqu'au ${dateLongue(contradictoire.finLe)} inclus, en plusieurs fois. Passé cette date, elles sont figées et jointes au rapport ; un point sans réponse vaut accord.`
          : `Période de réponse terminée le ${dateLongue(contradictoire.finLe)} : vos réponses sont figées et jointes au rapport.` }),
      ]),
      apercu ? h('div', { class: 'edl-progression' }, [
        h('div', { texte: bilan.complet ? `✓ Tous les points vus (${bilan.remarques} remarque${bilan.remarques > 1 ? 's' : ''})` : `${bilan.repondus} / ${bilan.total} points vus · ${bilan.remarques} remarque${bilan.remarques > 1 ? 's' : ''}` }),
        h('div', { class: 'legende edl-enregistre', texte: ouverte ? 'Enregistrement automatique' : '' }),
      ]) : null,
    );
  };

  const zonePieces = h('div', { class: 'edl-pieces' });
  const dessinerPieces = () => {
    if (!apercu) { zonePieces.replaceChildren(...carteAncienne()); return; }
    const bilan = bilanReponses(apercu, reponses);
    // Pièces repliées par défaut ; celles déjà dépliées le restent au redessin.
    const deplieesAvant = new Set([...zonePieces.querySelectorAll('.edl-piece[open]')].map((d) => d.dataset.piece));
    zonePieces.replaceChildren(...apercu.pieces.map((piece) => {
      const etatPiece = bilan.parPiece.get(piece.id) || { total: 0, repondus: 0, remarques: 0 };
      const ouvrir = deplieesAvant.has(piece.id);
      const mesPhotos = fichiersDe(piece);
      const resume = etatPiece.total === 0 ? 'rien à évaluer'
        : etatPiece.repondus < etatPiece.total ? `${etatPiece.total - etatPiece.repondus} à voir`
          : (etatPiece.remarques ? `${etatPiece.remarques} remarque${etatPiece.remarques > 1 ? 's' : ''}` : 'tout d’accord');
      const details = h('details', { class: 'edl-piece', 'data-piece': piece.id, open: ouvrir || null }, [
        h('summary', {}, [
          h('span', { class: 'edl-numero', texte: String(piece.numero) }),
          h('span', { class: 'edl-piece-nom', texte: piece.nom }),
          h('span', { class: `legende edl-resume${etatPiece.repondus < etatPiece.total ? ' a-voir' : ''}`, texte: resume }),
        ]),
        h('div', { class: 'edl-piece-corps' }, [
          ...points.filter((p) => p.pieceId === piece.id).map(rangee),
          piece.photos.length ? h('div', { class: 'edl-bloc-photos' }, [
            h('div', { class: 'edl-bloc-titre', texte: `Photos du bailleur (${piece.photos.length})` }),
            h('div', { class: 'portail-photos' }, piece.photos.map((p) => vignette('partage', p.chemin, p.legende || `${piece.nom} — photo`))),
          ]) : null,
          piece.meubles.some((m) => m.photos.length) ? h('div', { class: 'edl-bloc-photos' }, [
            h('div', { class: 'edl-bloc-titre', texte: 'Photos du mobilier (bailleur)' }),
            h('div', { class: 'portail-photos' }, piece.meubles.flatMap((m) => m.photos.map((p) => vignette('partage', p.chemin, p.legende ? `${m.nom} : ${p.legende}` : m.nom)))),
          ]) : null,
          h('div', { class: 'edl-bloc-photos' }, [
            h('div', { class: 'edl-bloc-titre', texte: `Vos photos de cette pièce (${mesPhotos.length})` }),
            h('span', { class: 'legende', texte: 'Datées automatiquement, non modifiables une fois déposées.' }),
            h('div', { class: 'portail-photos' }, [
              ...mesPhotos.map((f) => vignette('portail', f.chemin, f.nom)),
              ouverte ? h('button', { class: 'bouton bouton-petit bouton-primaire', type: 'button', onclick: () => deposer(piece, { camera: true }).catch(signalerErreur) }, '📷 Prendre une photo') : null,
              ouverte ? h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => deposer(piece).catch(signalerErreur) }, '+ Ajouter des photos') : null,
            ]),
          ]),
        ]),
      ]);
      return details;
    }),
    ...points.filter((p) => !p.pieceId).map((p) => h('div', { class: 'edl-releves' }, [h('div', { class: 'edl-bloc-titre', texte: 'Relevés et clés' }), rangee(p)])),
    ouverte && points.length ? h('div', { class: 'edl-pied' }, [
      h('span', { class: 'legende', texte: 'Les points sans réponse vaudront accord à la fin de la période.' }),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => {
        reponses = toutDaccord(apercu, reponses);
        enregistrer();
        dessinerEntete();
        dessinerPieces();
        dessinerSignature();
        surChangement(etatPourAccueil());
        notifier('Tous les points restants marqués « d’accord ».', 'succes');
      } }, 'Tout est d’accord pour le reste'),
    ]) : null);
  };

  // ---- signature à distance : tracé, code reçu par e-mail, enregistrement côté serveur
  const zoneSignature = h('div', { class: 'edl-signature' });
  const dessinerSignature = () => {
    const bilan = bilanReponses(apercu, reponses);
    const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    let corps;
    if (signature) {
      corps = [
        h('div', { class: 'edl-signature-faite' }, [
          h('img', { src: signature.image, alt: 'Votre signature', class: 'edl-signature-image' }),
          h('div', {}, [
            h('div', { style: 'font-weight:600', texte: `✓ Signé le ${date(signature.signeLe.slice(0, 10))} à ${heure(signature.signeLe)} depuis votre espace` }),
            h('div', { class: 'legende', texte: `Validation par code envoyé à ${signature.emailMasque || 'votre adresse'}. ${ouverte ? 'Vous pouvez encore compléter vos remarques et photos jusqu’à la fin de la période ; votre signature porte sur l’état des lieux.' : ''}` }),
          ]),
        ]),
      ];
    } else if (!ouverte) {
      corps = [h('p', { class: 'legende', texte: 'La période de réponse est terminée : la signature n’est plus possible depuis votre espace. Votre bailleur peut vous faire signer sur sa tablette.' })];
    } else if (!apercu || (bilan.total > 0 && !bilan.complet)) {
      corps = [h('p', { class: 'legende', texte: `Répondez d’abord à tous les points (${bilan.total - bilan.repondus} restant${bilan.total - bilan.repondus > 1 ? 's' : ''}), ou utilisez « Tout est d’accord pour le reste » : la signature devient alors possible.` })];
    } else {
      let image = null;
      const zoneCode = h('div', { class: 'edl-code', hidden: true });
      const champCode = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, placeholder: '6 chiffres', class: 'edl-code-champ', 'aria-label': 'Code reçu par e-mail' });
      const message = h('p', { class: 'legende' });
      const demanderCode = async () => {
        message.textContent = 'Envoi du code…';
        try {
          const r = await api.envoyerCodeSignature(contradictoire.edlId);
          message.textContent = `Un code à 6 chiffres vient d’être envoyé à ${r.envoyeA} (valable 15 minutes). Saisissez-le pour confirmer votre signature.`;
          zoneCode.hidden = false; champCode.focus();
        } catch (erreur) { message.textContent = ''; notifier(erreur.message, 'erreur'); }
      };
      const confirmer = async () => {
        const code = champCode.value.replace(/\D/g, '');
        if (code.length !== 6) { notifier('Saisissez les 6 chiffres du code.', 'erreur'); return; }
        try {
          const r = await api.confirmerSignature(contradictoire.edlId, code, image);
          signature = { image, signeLe: r.signeLe, mode: r.mode, emailMasque: r.emailMasque };
          notifier('Signature enregistrée. Merci !', 'succes');
          dessinerSignature();
          surChangement(etatPourAccueil());
        } catch (erreur) { notifier(erreur.message, 'erreur'); }
      };
      const boutonSigner = h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: async () => {
        const tracee = await demanderSignature({ titre: 'Signer l’état des lieux', nom: '' });
        if (!tracee) return;
        image = tracee;
        boutonSigner.textContent = '✓ Signature tracée — refaire';
        await demanderCode();
      } }, '✍️ Signer l’état des lieux');
      zoneCode.append(
        h('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap' }, [
          champCode,
          h('button', { class: 'bouton bouton-primaire bouton-petit', type: 'button', onclick: () => confirmer().catch(signalerErreur) }, 'Confirmer'),
          h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => demanderCode().catch(signalerErreur) }, 'Renvoyer un code'),
        ]),
      );
      corps = [
        h('p', { class: 'legende', texte: 'Vos réponses sont complètes. En signant, vous reconnaissez l’exactitude de l’état des lieux, photographies comprises, sous réserve de vos remarques. Un code vous sera envoyé par e-mail pour confirmer.' }),
        h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' }, [boutonSigner]),
        message, zoneCode,
      ];
    }
    zoneSignature.replaceChildren(h('div', { class: 'edl-bloc-titre', texte: '✍️ Votre signature' }), ...corps);
  };

  conteneur.append(entete, zonePieces, zoneSignature);
  dessinerEntete();
  zonePieces.append(h('p', { class: 'legende', texte: 'Chargement…' }));
  Promise.all([
    api.lireReponsesContradictoire(email, contradictoire.edlId).then((d) => { reponses = d?.reponses || {}; }).catch(() => {}),
    api.lireSignatureContradictoire(email, contradictoire.edlId).then((d) => { signature = d || null; }).catch(() => {}),
    rechargerFichiers(),
  ]).then(() => { dessinerEntete(); dessinerPieces(); dessinerSignature(); surChangement(etatPourAccueil()); });
  return conteneur;
}

// --------------------------------------------------------------- justificatifs

/**
 * Justificatifs à fournir au bailleur : assurance habitation, entretien des
 * climatiseurs, ramonage… Le colocataire dépose ici ses attestations (photo
 * ou PDF) ; elles sont horodatées et non modifiables une fois déposées.
 */
function sectionJustificatifs({ surChargement = () => {} } = {}) {
  const email = monEmail();
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
    surChargement(CATEGORIES_JUSTIFICATIFS.filter((c) => c.cle !== 'autre' && !(parCategorie.get(c.cle) || []).length));
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
          await api.deposerOctets('portail', `${prefixe}/${categorie}/${horodatage} ${nettoyer(fichier.name)}`,
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

// -------------------------------------------------------------------- accueil

/** L'accueil : ce qui attend le colocataire, la prochaine échéance, le dernier document. */
function sectionAccueil({ portail, documents, etatEdl, justificatifsManquants, allerA }) {
  const taches = [];
  for (const contradictoire of contradictoiresDe(portail)) {
    if (contradictoire.finLe < aujourdhui()) continue;
    const bilan = etatEdl?.[contradictoire.edlId];
    const fait = bilan && bilan.complet;
    const signe = Boolean(bilan && bilan.signe);
    const suffixe = `${contradictoire.type === 'sortie' ? 'de sortie' : 'd’entrée'} du ${date(contradictoire.dateEdl)}${contradictoire.logement?.nom ? ` (${contradictoire.logement.nom})` : ''}`;
    taches.push({ icone: '📷', urgent: !fait, fait,
      titre: fait ? `État des lieux ${suffixe} : vos réponses sont complètes` : `Répondre à l’état des lieux ${suffixe}`,
      detail: `${bilan && bilan.total ? `${bilan.total - bilan.repondus} point(s) à voir · ` : ''}jusqu'au ${dateLongue(contradictoire.finLe)} inclus`,
      action: fait ? 'Revoir' : 'Continuer', rubrique: 'edl', edlId: contradictoire.edlId });
    if (fait) {
      taches.push({ icone: '✍️', urgent: !signe, fait: signe,
        titre: signe ? `État des lieux ${suffixe} signé depuis votre espace` : `Signer l’état des lieux ${suffixe}`,
        detail: signe ? 'Validé par code e-mail' : `Signature au doigt puis code reçu par e-mail · jusqu'au ${dateLongue(contradictoire.finLe)} inclus`,
        action: signe ? 'Voir' : 'Signer', rubrique: 'edl', edlId: contradictoire.edlId });
    }
  }
  for (const categorie of justificatifsManquants || []) {
    taches.push({ icone: '📎', titre: `Fournir : ${categorie.libelle.toLowerCase()}`, detail: categorie.periodicite || '', action: 'Déposer', rubrique: 'justificatifs' });
  }
  const dernier = [...documents].sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)))[0];
  if (dernier) {
    taches.push({ icone: (LIBELLES_TYPE[dernier.type] || LIBELLES_TYPE.autre).icone, fait: true, titre: `${dernier.titre || 'Document'} disponible`, detail: `Publié le ${date(dernier.publieLe)}`, action: 'Voir', rubrique: dernier.type === 'quittance' ? 'quittances' : 'documents' });
  }

  const echeance = portail?.echeance;
  let blocEcheance = null;
  if (echeance?.mois) {
    const libelleMois = `${nomMois(echeance.mois)} ${echeance.annee}`;
    const quittance = documents.find((d) => d.type === 'quittance' && String(d.titre || '').includes(libelleMois));
    const enRetard = !quittance && echeance.dateLimite && echeance.dateLimite < aujourdhui();
    blocEcheance = h('div', { class: `portail-tache${enRetard ? ' urgent' : ''}${quittance ? ' fait' : ''}` }, [
      h('span', { class: 'portail-tache-icone', texte: '📅' }),
      h('div', {}, [
        h('div', { class: 'portail-tache-titre', texte: `Loyer de ${libelleMois} : ${montant(echeance.montant)}${echeance.dateLimite ? ` au plus tard le ${date(echeance.dateLimite)}` : ''}` }),
        h('div', { class: 'legende', texte: quittance ? `Réglé — quittance publiée le ${date(quittance.publieLe)}` : `Virement avec le libellé « ${echeance.libelle || `Loyer ${libelleMois}`} » (coordonnées dans l'appel de loyer reçu par e-mail)${echeance.logement ? ` · ${echeance.logement}` : ''}` }),
      ]),
      h('span', { class: `badge badge-${quittance ? 'succes' : (enRetard ? 'alerte' : 'attente')}`, texte: quittance ? 'réglé' : (enRetard ? 'en retard' : 'à venir') }),
    ]);
  }

  return h('section', { class: 'portail-section' }, [
    h('h2', { texte: '🏠 À faire' }),
    taches.length ? h('div', { class: 'portail-taches' }, taches.map((t) => h('div', { class: `portail-tache${t.urgent ? ' urgent' : ''}${t.fait ? ' fait' : ''}` }, [
      h('span', { class: 'portail-tache-icone', texte: t.icone }),
      h('div', {}, [h('div', { class: 'portail-tache-titre', texte: t.titre }), t.detail ? h('div', { class: 'legende', texte: t.detail }) : null]),
      h('button', { class: `bouton bouton-petit${t.urgent ? ' bouton-primaire' : ''}`, type: 'button', onclick: () => allerA(t.rubrique, t.edlId) }, t.action),
    ]))) : h('p', { class: 'legende', texte: 'Rien à faire pour l’instant. Vos documents sont dans les rubriques ci-dessus.' }),
    blocEcheance ? h('h2', { texte: '📅 Prochaine échéance', style: 'margin-top:1rem' }) : null,
    blocEcheance,
  ]);
}

// ----------------------------------------------------------------- mon compte

function sectionCompte({ portail, seDeconnecter }) {
  const installation = estInstallee() ? h('span', { class: 'legende', texte: '✓ Déjà installée sur cet appareil.' })
    : (installable()
      ? h('button', { class: 'bouton bouton-petit bouton-primaire', type: 'button', onclick: (e) => { proposerInstallation().then((r) => { if (r === 'accepted') e.target.replaceWith(h('span', { class: 'legende', texte: 'Installation lancée.' })); }); } }, 'Installer')
      : h('span', { class: 'legende', texte: consigneInstallation() }));
  const ligne = (icone, titre, detail, action) => h('div', { class: 'portail-document' }, [
    h('span', { class: 'portail-icone', texte: icone }),
    h('div', { class: 'portail-details' }, [h('div', { class: 'portail-titre', texte: titre }), h('div', { class: 'legende', texte: detail })]),
    action,
  ]);
  return h('section', { class: 'portail-section' }, [
    h('h2', { texte: '⚙️ Mon compte' }),
    ligne('🔑', 'Mot de passe', 'Changer le mot de passe de votre espace.', h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => { ouvrirChangementMotDePasse().catch(signalerErreur); } }, 'Modifier')),
    ligne('📲', 'Icône « Résidence ANIKA »', 'Installer votre espace sur cet appareil : écran d’accueil de la tablette, Bureau et barre des tâches sur PC.', installation),
    ligne('✉️', 'Adresse de connexion', `${monEmail() || '—'}${portail?.nom ? ` · ${portail.nom}` : ''} — pour la modifier, demandez à votre bailleur.`, h('span', { class: 'badge badge-attente', texte: 'lecture' })),
    ligne('🚪', 'Se déconnecter', 'Fermer votre espace sur cet appareil.', h('button', { class: 'bouton bouton-petit', type: 'button', onclick: () => { seDeconnecter().catch(signalerErreur); } }, 'Se déconnecter')),
  ]);
}

// ---------------------------------------------------------------------- page

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

  const etatPortail = { edl: {}, justificatifsManquants: [] };
  const contradictoires = contradictoiresDe(portail);
  const rubriqueDepuisHachage = () => {
    const cle = location.hash.replace('#', '');
    return RUBRIQUES.some((r) => r.cle === cle) ? cle : 'accueil';
  };
  let rubrique = rubriqueDepuisHachage();

  const navigation = h('nav', { class: 'portail-nav', 'aria-label': 'Rubriques' });
  const zone = h('div', { class: 'portail-rubrique' });
  // Les rubriques sont construites une fois et conservées : les réponses en
  // cours et les photos chargées ne sont pas perdues en changeant d'onglet.
  const sections = new Map();

  const pastilles = () => {
    const p = { accueil: 0, edl: 0, quittances: 0, documents: 0, justificatifs: 0, compte: 0 };
    p.edl = contradictoires.filter((c) => c.finLe >= aujourdhui() && !(etatPortail.edl[c.edlId]?.complet && etatPortail.edl[c.edlId]?.signe)).length;
    p.justificatifs = etatPortail.justificatifsManquants.length;
    p.accueil = p.edl + p.justificatifs;
    return p;
  };

  const dessinerNavigation = () => {
    const p = pastilles();
    vider(navigation).append(...RUBRIQUES.filter((r) => r.cle !== 'edl' || contradictoires.length).map((r) => h('button', {
      class: r.cle === rubrique ? 'actif' : '', type: 'button', 'data-rubrique': r.cle,
      onclick: () => { allerA(r.cle); },
    }, [`${r.icone} ${r.libelle}`, p[r.cle] ? h('span', { class: 'pastille', texte: String(p[r.cle]) }) : null])));
  };

  const construire = (cle) => {
    if (sections.has(cle)) return sections.get(cle);
    let section;
    if (cle === 'accueil') section = sectionAccueil({ portail, documents, etatEdl: etatPortail.edl, justificatifsManquants: etatPortail.justificatifsManquants, allerA });
    else if (cle === 'edl') {
      // Un bloc repliable par état des lieux publié, replié par défaut ;
      // « Continuer » depuis l'accueil déplie celui qui est visé.
      section = h('section', { class: 'portail-section' }, [
        h('h2', { texte: `📷 ${contradictoires.length > 1 ? 'États des lieux contradictoires' : 'État des lieux contradictoire'}` }),
        h('p', { class: 'legende', texte: 'Dépliez un état des lieux pour le consulter et répondre point par point, pièce par pièce.' }),
        ...contradictoires.map((c) => {
          const ouvert = c.finLe >= aujourdhui();
          const resume = h('span', { class: 'legende edl-bloc-resume', texte: ouvert ? `réponses jusqu'au ${date(c.finLe)}` : `clos le ${date(c.finLe)}` });
          return h('details', { class: 'portail-edl-bloc', 'data-edl': c.edlId }, [
            h('summary', {}, [h('span', { class: 'edl-bloc-titre', texte: libelleEdl(c) }), resume]),
            sectionContradictoire(c, { surChangement: (bilan) => {
              etatPortail.edl = { ...etatPortail.edl, [c.edlId]: bilan };
              resume.textContent = `${ouvert ? `réponses jusqu'au ${date(c.finLe)}` : `clos le ${date(c.finLe)}`} · ${bilan.signe ? 'signé' : (bilan.complet ? 'réponses complètes' : `${bilan.repondus}/${bilan.total} points vus`)}`;
              sections.delete('accueil'); dessinerNavigation(); if (rubrique === 'accueil') dessinerRubrique();
            } }),
          ]);
        }),
      ]);
    }
    else if (cle === 'quittances') section = sectionDocuments(documents, ['quittance'], { titre: '🧾 Quittances de loyer', vide: 'Aucune quittance pour l’instant : elle est publiée ici dès que votre loyer du mois est réglé.' });
    else if (cle === 'documents') section = sectionDocuments(documents, ['bail', 'etat-des-lieux', 'regularisation', 'restitution', 'autre'], { titre: '📜 Bail, états des lieux et autres documents', vide: 'Aucun document pour l’instant : votre bail et votre état des lieux apparaîtront ici dès que votre bailleur les aura publiés.' });
    else if (cle === 'justificatifs') section = sectionJustificatifs({ surChargement: (manquants) => { etatPortail.justificatifsManquants = manquants; sections.delete('accueil'); dessinerNavigation(); if (rubrique === 'accueil') dessinerRubrique(); } });
    else section = sectionCompte({ portail, seDeconnecter });
    // L'accueil se recalcule à chaque affichage (tâches à jour) ; les autres restent en mémoire.
    if (cle !== 'accueil') sections.set(cle, section);
    return section;
  };

  const dessinerRubrique = () => {
    vider(zone).append(construire(rubrique));
    dessinerNavigation();
  };

  function allerA(cle, edlId = '') {
    rubrique = RUBRIQUES.some((r) => r.cle === cle) ? cle : 'accueil';
    if (location.hash !== `#${rubrique}`) history.replaceState(null, '', `#${rubrique}`);
    dessinerRubrique();
    if (edlId) {
      const bloc = zone.querySelector(`.portail-edl-bloc[data-edl="${edlId}"]`);
      if (bloc) { bloc.open = true; bloc.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    }
    zone.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  window.addEventListener('hashchange', () => { const cle = rubriqueDepuisHachage(); if (cle !== rubrique) { rubrique = cle; dessinerRubrique(); } });

  racine.append(h('div', { class: 'portail-cadre' }, [
    h('header', { class: 'portail-entete' }, [
      h('div', {}, [
        h('div', { class: 'portail-marque', texte: '👥 Espace colocataire' }),
        h('h1', { texte: portail?.nom ? `Bonjour ${portail.nom.split(' ')[0]}` : 'Bonjour' }),
        portail?.logement?.nom ? h('p', { class: 'legende portail-logement', texte: `🏠 ${portail.logement.nom}${portail.logement.adresse ? ` — ${portail.logement.adresse}` : ''}` }) : null,
      ]),
      h('div', { class: 'groupe-boutons' }, [
        h('button', { class: 'bouton', type: 'button', onclick: () => { ouvrirChangementMotDePasse().catch(signalerErreur); } }, 'Mot de passe'),
        h('button', { class: 'bouton', type: 'button', onclick: () => { seDeconnecter().catch(signalerErreur); } }, 'Se déconnecter'),
      ]),
    ]),
    navigation,
    erreur
      ? h('div', { class: 'alerte alerte-erreur', texte: `Impossible de charger vos documents : ${erreur.message}. Rechargez la page (F5).` })
      : null,
    zone,
    h('footer', { class: 'portail-pied', texte: 'Espace privé — seuls vous et votre bailleur voyez ces documents.' }),
  ]));

  // Les justificatifs manquants et l'avancement de l'état des lieux
  // alimentent l'accueil et les pastilles : on les charge dès l'ouverture.
  if (!erreur) {
    construire('justificatifs');
    if (contradictoires.some((c) => c.apercu)) construire('edl');
  }
  dessinerRubrique();
}
