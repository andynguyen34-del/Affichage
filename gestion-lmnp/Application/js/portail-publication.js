// Publication de documents sur le portail d'un colocataire : le fichier part
// dans l'espace de stockage « portail/{e-mail}/… » et la liste des documents
// du colocataire (Firestore portail/{e-mail}) est mise à jour.

import * as api from './api.js';
import * as etat from './etat.js';
import { aujourdhui, dateLongue } from './format.js';
import { finEnMillisecondes, DUREE_PAR_DEFAUT } from './contradictoire.js';

/**
 * Le logement d'un colocataire : celui de son bail le plus récent.
 * (Affiché dans l'en-tête de son espace.)
 */
export function logementDe(locataire) {
  const baux = etat.liste('baux')
    .filter((b) => b.locataireId === locataire?.id || b.coTitulaireId === locataire?.id || (b.colocataires || []).some((c) => c.locataireId === locataire?.id))
    .sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)));
  const bien = etat.liste('biens').find((b) => b.id === baux[0]?.bienId);
  return bien ? { nom: bien.nom, adresse: [bien.adresse, [bien.codePostal, bien.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') } : null;
}

const nettoyerNomFichier = (nom) => String(nom)
  .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Destinataires des notifications d'un colocataire : son adresse, plus le
 * second destinataire s'il est renseigné (parent, garant…).
 */
export const destinatairesDe = (locataire) => [locataire?.email, locataire?.email2]
  .map((e) => String(e || '').trim()).filter(Boolean);

/**
 * Publie un document (octets PDF) pour un colocataire.
 * type : 'quittance' | 'etat-des-lieux' | 'bail' | 'autre'.
 */
export async function publierDocument({ locataire, type, titre, nomFichier, octets }) {
  const email = String(locataire?.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error(`${locataire?.prenom || ''} ${locataire?.nom || 'Ce colocataire'} n'a pas d'adresse e-mail : `
      + 'renseignez-la dans « Logements & baux » pour publier ses documents.');
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
    logement: logementDe(locataire) || actuel.logement || null,
    documents,
  });
  return { email, chemin };
}

/**
 * Ouvre (ou met à jour) la fenêtre de photos contradictoires d'un état des
 * lieux sur l'espace du colocataire : jusqu'à `finLe`, il peut déposer ses
 * propres photos, pièce par pièce. Envoie aussi l'e-mail d'information.
 */
export async function ouvrirFenetreContradictoire({ locataire, edl, finLe, dureeJours, pieces, apercu, logement, bailleur, notifier: envoyerEmail = true }) {
  const email = String(locataire?.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error(`${locataire?.prenom || ''} ${locataire?.nom || 'Ce colocataire'} n'a pas d'adresse e-mail : `
      + 'renseignez-la dans « Logements & baux » pour ouvrir sa fenêtre contradictoire.');
  }
  const actuel = (await api.lirePortail(email)) || {};
  await api.publierPortail(email, {
    ...actuel,
    nom: actuel.nom || `${locataire.prenom || ''} ${locataire.nom || ''}`.trim(),
    locataireId: actuel.locataireId || locataire.id || '',
    logement: logementDe(locataire) || actuel.logement || null,
    documents: actuel.documents || [],
    contradictoire: {
      edlId: edl.id,
      type: edl.type,
      dateEdl: edl.date,
      finLe,
      finLeMs: finEnMillisecondes(finLe),
      dureeJours: Number(dureeJours) || DUREE_PAR_DEFAUT,
      pieces: pieces || [],
      // L'état des lieux lui-même (postes, observations, mobilier, photos
      // copiées dans l'espace partagé) : le colocataire y répond point par point.
      apercu: apercu || null,
      logement: logement || actuel.logement || null,
      publieLe: aujourdhui(),
    },
  });
  if (envoyerEmail) {
    await api.envoyerCourriel({
      destinataires: destinatairesDe(locataire),
      sujet: 'État des lieux : vos photos contradictoires',
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Suite à l'état des lieux ${edl.type === 'sortie' ? 'de sortie' : "d'entrée"} du `
        + `<strong>${dateLongue(edl.date)}</strong>, il est consultable sur votre espace, pièce par pièce : `
        + 'vous pouvez y indiquer, pour chaque point, si vous êtes d\'accord ou ajouter une remarque, et déposer vos propres photos, '
        + `<strong>jusqu'au ${dateLongue(finLe)}</strong> inclus :</p>`
        + `<p><a href="${window.location.origin}/colocataire">${window.location.origin}/colocataire</a></p>`
        + '<p>Passé ce délai, vos réponses sont figées et jointes au rapport ; sans réponse, l\'état des lieux sera réputé accepté en l\'état.</p>'
        + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
    });
  }
  return { email };
}
