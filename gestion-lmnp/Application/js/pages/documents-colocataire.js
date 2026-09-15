// Documents publiés sur l'espace d'un colocataire (v53) : le gérant les
// consulte, les télécharge ou les supprime un par un depuis la page
// « Locataires ». Une suppression retire le document de l'espace et dépose le
// fichier dans la Corbeille (Paramètres → Corbeille).

import * as api from '../api.js';
import { h, bouton, confirmer, ouvrirModale, notifier, signalerErreur } from '../ui.js';
import { date, taille } from '../format.js';

const LIBELLES_TYPE = {
  quittance: { libelle: 'Quittance de loyer', icone: '🧾' },
  'etat-des-lieux': { libelle: 'État des lieux', icone: '📷' },
  bail: { libelle: 'Bail', icone: '📜' },
  regularisation: { libelle: 'Régularisation des charges', icone: '💧' },
  depot: { libelle: 'Reçu de dépôt de garantie', icone: '🛡️' },
  restitution: { libelle: 'Restitution du dépôt de garantie', icone: '💶' },
  autre: { libelle: 'Document', icone: '📄' },
};

const nomDe = (l) => `${l.prenom || ''} ${l.nom || ''}`.trim();

/**
 * Fenêtre « Documents de {colocataire} » : la liste des documents de son
 * espace (portail.documents) avec Consulter / Télécharger / Supprimer.
 *   surChangement(portail) : appelé après chaque suppression avec l'espace mis à jour.
 */
export async function ouvrirDocumentsColocataire(locataire, portail, { surChangement = () => {} } = {}) {
  const email = String(locataire?.email || '').trim().toLowerCase();
  let documents = [...(portail?.documents || [])].sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)));
  const corps = h('div', { class: 'documents-colocataire' });

  // La confirmation prend la place de la fenêtre (une seule modale à la fois) :
  // chaque suppression ferme la liste, qui est réouverte ensuite.
  let demande = null;
  const supprimer = async (document_) => {
    const ok = await confirmer({
      titre: 'Supprimer le document',
      message: `« ${document_.titre || 'Document'} » sera retiré de l'espace de ${nomDe(locataire)} et déposé dans la Corbeille (Paramètres → Corbeille), d'où il reste téléchargeable.`,
      libelleValider: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try { await api.supprimerFichier('portail', document_.chemin); }
    catch (erreur) { notifier(`Fichier non retiré du nuage : ${erreur.message}`, 'erreur'); }
    documents = documents.filter((d) => d.chemin !== document_.chemin);
    await api.completerPortail(email, { documents });
    notifier(`« ${document_.titre || 'Document'} » supprimé de l'espace de ${nomDe(locataire)} (copie dans la Corbeille).`, 'succes');
    surChangement({ ...portail, documents });
  };

  const ligne = (document_) => {
    const type = LIBELLES_TYPE[document_.type] || LIBELLES_TYPE.autre;
    const nomFichier = String(document_.chemin || '').split('/').pop();
    return h('div', { class: 'doc-logement', 'data-chemin': document_.chemin }, [
      h('span', { class: 'doc-logement-icone', texte: type.icone }),
      h('div', { class: 'doc-logement-details' }, [
        h('div', { class: 'doc-logement-titre', texte: document_.titre || type.libelle }),
        h('div', { class: 'legende', texte: `${type.libelle} · publié le ${date(document_.publieLe)}${document_.taille ? ` · ${taille(document_.taille)}` : ''} · ${nomFichier}` }),
      ]),
      h('div', { class: 'groupe-boutons' }, [
        bouton('Consulter', () => api.ouvrirFichier('portail', document_.chemin).catch(signalerErreur), { petit: true }),
        bouton('Télécharger', () => api.telechargerFichier('portail', document_.chemin, nomFichier).catch(signalerErreur), { petit: true }),
        bouton('Supprimer', () => { demande = document_; fermerCourante({ valide: true }); }, { petit: true, type: 'danger' }),
      ]),
    ]);
  };

  let fermerCourante = () => {};
  const dessiner = () => {
    corps.replaceChildren(
      h('p', { class: 'legende', texte: documents.length
        ? `${documents.length} document${documents.length > 1 ? 's' : ''} sur l'espace de ${nomDe(locataire)} (${email}). Une suppression le retire de son espace ; le fichier va dans la Corbeille.`
        : `Plus aucun document sur l'espace de ${nomDe(locataire)}.` }),
      ...(documents.length ? [h('div', { class: 'doc-logement-liste' }, documents.map(ligne))] : []),
    );
  };

  for (;;) {
    dessiner();
    demande = null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resoudre) => {
      fermerCourante = ouvrirModale({
        titre: `Documents de ${nomDe(locataire)}`,
        corps,
        large: true,
        surFermeture: resoudre,
        pied: [bouton('Fermer', () => { fermerCourante({ valide: true }); resoudre(); })],
      });
      const fermerBrut = fermerCourante;
      fermerCourante = (options) => { fermerBrut(options); resoudre(); };
    });
    if (!demande) return;
    // eslint-disable-next-line no-await-in-loop
    await supprimer(demande);
  }
}
