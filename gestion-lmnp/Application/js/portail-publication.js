// Publication de documents sur le portail d'un colocataire : le fichier part
// dans l'espace de stockage « portail/{e-mail}/… » et la liste des documents
// du colocataire (Firestore portail/{e-mail}) est mise à jour.

import * as api from './api.js';
import { aujourdhui, dateLongue } from './format.js';

const nettoyerNomFichier = (nom) => String(nom)
  .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Publie un document (octets PDF) pour un colocataire.
 * type : 'quittance' | 'etat-des-lieux' | 'bail' | 'autre'.
 */
export async function publierDocument({ locataire, type, titre, nomFichier, octets }) {
  const email = String(locataire?.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error(`${locataire?.prenom || ''} ${locataire?.nom || 'Ce colocataire'} n'a pas d'adresse e-mail : `
      + 'renseignez-la dans « Bien & baux » pour publier ses documents.');
  }
  const chemin = `${email}/${nettoyerNomFichier(nomFichier)}`;
  await api.deposerOctets('portail', chemin, octets, 'application/pdf');

  const actuel = (await api.lirePortail(email)) || {};
  const documents = (actuel.documents || []).filter((d) => d.chemin !== chemin);
  documents.push({
    type,
    titre,
    chemin,
    taille: octets.byteLength || octets.length || 0,
    publieLe: aujourdhui(),
  });
  documents.sort((a, b) => String(b.publieLe).localeCompare(String(a.publieLe)));
  // On repart du document existant : la fenêtre contradictoire et les autres
  // informations de l'espace ne doivent pas être perdues à chaque publication.
  await api.publierPortail(email, {
    ...actuel,
    nom: `${locataire.prenom || ''} ${locataire.nom || ''}`.trim(),
    locataireId: locataire.id || '',
    documents,
  });
  return { email, chemin };
}

/**
 * Ouvre (ou met à jour) la fenêtre de photos contradictoires d'un état des
 * lieux sur l'espace du colocataire : jusqu'à `finLe`, il peut déposer ses
 * propres photos, pièce par pièce. Envoie aussi l'e-mail d'information.
 */
export async function ouvrirFenetreContradictoire({ locataire, edl, finLe, pieces, bailleur, notifier: envoyerEmail = true }) {
  const email = String(locataire?.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error(`${locataire?.prenom || ''} ${locataire?.nom || 'Ce colocataire'} n'a pas d'adresse e-mail : `
      + 'renseignez-la dans « Bien & baux » pour ouvrir sa fenêtre contradictoire.');
  }
  const actuel = (await api.lirePortail(email)) || {};
  await api.publierPortail(email, {
    ...actuel,
    nom: actuel.nom || `${locataire.prenom || ''} ${locataire.nom || ''}`.trim(),
    locataireId: actuel.locataireId || locataire.id || '',
    documents: actuel.documents || [],
    contradictoire: {
      edlId: edl.id,
      type: edl.type,
      dateEdl: edl.date,
      finLe,
      pieces: pieces || [],
    },
  });
  if (envoyerEmail) {
    await api.envoyerCourriel({
      destinataires: [email],
      sujet: 'État des lieux : vos photos contradictoires',
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Suite à l'état des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du `
        + `<strong>${dateLongue(edl.date)}</strong>, vous pouvez déposer vos propres photos des pièces `
        + `sur votre espace, <strong>jusqu'au ${dateLongue(finLe)}</strong> :</p>`
        + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
        + '<p>Passé ce délai, l\'état des lieux sera réputé accepté en l\'état.</p>'
        + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
    });
  }
  return { email };
}
