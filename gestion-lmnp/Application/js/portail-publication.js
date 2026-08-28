// Publication de documents sur le portail d'un colocataire : le fichier part
// dans l'espace de stockage « portail/{e-mail}/… » et la liste des documents
// du colocataire (Firestore portail/{e-mail}) est mise à jour.

import * as api from './api.js';
import { aujourdhui } from './format.js';

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
  await api.publierPortail(email, {
    nom: `${locataire.prenom || ''} ${locataire.nom || ''}`.trim(),
    locataireId: locataire.id || '',
    documents,
  });
  return { email, chemin };
}
