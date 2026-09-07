// Relais de fichiers : l'application lit et dépose ses fichiers (photos
// d'état des lieux, documents des colocataires…) directement dans Firebase
// Storage. Certains réseaux d'entreprise bloquent le serveur de stockage
// (firebasestorage.googleapis.com) tout en laissant passer l'adresse de
// l'application : ce relais, servi derrière /api/fichiers par Firebase
// Hosting, fait alors transiter les fichiers par l'adresse de l'application.
//
// Il applique les MÊMES droits que storage.rules :
// - gérant (systeme/roles.admins, ou aucun document de rôles) : tout ;
// - colocataire : lecture de son espace portail/{email}/**, dépôt (création
//   seulement, images ou PDF < 10 Mo) sous portail/{email}/contradictoire/**
//   et portail/{email}/justificatifs/**, jamais de modification ni de
//   suppression (intégrité des preuves) ; lecture de l'espace partage/**
//   (copies des photos de l'état des lieux contradictoire).

import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { traiterSignature } from './signature-distante.js';

const TAILLE_MAX_COLOCATAIRE = 10 * 1024 * 1024;

class ErreurHttp extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}
const refus = (statut, message) => new ErreurHttp(statut, message);

/** Un chemin sûr : segments simples, sans « .. », sans barre initiale. */
function nettoyerChemin(valeur, { vide = false } = {}) {
  const chemin = String(valeur || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!chemin) { if (vide) return ''; throw refus(400, 'Chemin manquant.'); }
  if (chemin.split('/').some((s) => s === '' || s === '.' || s === '..')) throw refus(400, 'Chemin invalide.');
  return chemin;
}

async function identifier(req) {
  const entete = String(req.get('authorization') || '');
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
  if (!jeton) throw refus(401, 'Connexion requise.');
  let decode;
  try { decode = await getAuth().verifyIdToken(jeton); } catch { throw refus(401, 'Session invalide ou expirée : reconnectez-vous.'); }
  const email = String(decode.email || '').trim().toLowerCase();
  if (!email) throw refus(401, 'Compte sans adresse e-mail.');
  const base = getFirestore();
  const roles = await base.doc('systeme/roles').get();
  const admins = roles.exists ? (roles.data().admins || []).map((a) => String(a).trim().toLowerCase()) : null;
  const gerant = admins === null || admins.includes(email);
  // Un colocataire de la résidence a un espace portail à son nom : il lit
  // aussi l'espace « partage » (photos de l'état des lieux contradictoire).
  const colocataire = !gerant && (await base.doc(`portail/${email}`).get()).exists;
  return { email, gerant, colocataire };
}

const sonEspace = (qui, objet) => objet.startsWith(`portail/${qui.email}/`);
const partage = (qui, objet) => qui.colocataire && objet.startsWith('partage/');

function verifierLecture(qui, objet) {
  if (qui.gerant || sonEspace(qui, objet) || partage(qui, objet)) return;
  throw refus(403, 'Accès refusé à ce fichier.');
}

function verifierDepot(qui, objet, typeMime, taille) {
  if (qui.gerant) return;
  const image = /^image\//.test(typeMime);
  const pdf = typeMime === 'application/pdf';
  const contradictoire = objet.startsWith(`portail/${qui.email}/contradictoire/`) && image;
  const justificatif = objet.startsWith(`portail/${qui.email}/justificatifs/`) && (image || pdf);
  if (!(contradictoire || justificatif)) throw refus(403, 'Dépôt refusé à cet emplacement.');
  if (taille >= TAILLE_MAX_COLOCATAIRE) throw refus(413, 'Fichier trop volumineux (10 Mo au plus).');
}

/** Premier nom libre : « nom.ext », « nom (1).ext », « nom (2).ext »… */
async function nomDisponible(bucket, espace, chemin) {
  const point = chemin.lastIndexOf('.');
  const barre = chemin.lastIndexOf('/');
  const base = point > barre ? chemin.slice(0, point) : chemin;
  const ext = point > barre ? chemin.slice(point) : '';
  let candidat = chemin;
  for (let i = 1; i <= 200; i += 1) {
    const [existe] = await bucket.file(`${espace}/${candidat}`).exists();
    if (!existe) return candidat;
    candidat = `${base} (${i})${ext}`;
  }
  throw refus(409, 'Trop de fichiers de même nom.');
}

const relatif = (espace, nom) => nom.slice(espace.length + 1);

export async function traiter(req, res) {
  const op = String(req.query.op || '');
  const qui = await identifier(req);
  const bucket = getStorage().bucket();

  if (op === 'sonde') {
    res.json({ ok: true, email: qui.email, gerant: qui.gerant, bucket: bucket.name });
    return;
  }

  // Signature à distance de l'état des lieux (colocataire) : voir signature-distante.js.
  if (op === 'signature-envoyer' || op === 'signature-confirmer') {
    try { await traiterSignature(op, req, res, qui); }
    catch (erreur) { if (erreur?.statut) throw refus(erreur.statut, erreur.message); throw erreur; }
    return;
  }

  const espace = nettoyerChemin(req.query.espace);
  if (espace.includes('/')) throw refus(400, 'Espace invalide.');

  if (op === 'lire' && req.method === 'GET') {
    const chemin = nettoyerChemin(req.query.chemin);
    const objet = `${espace}/${chemin}`;
    verifierLecture(qui, objet);
    const fichier = bucket.file(objet);
    const [existe] = await fichier.exists();
    if (!existe) throw refus(404, 'Fichier introuvable.');
    const [meta] = await fichier.getMetadata();
    res.set('Content-Type', meta.contentType || 'application/octet-stream');
    if (meta.size) res.set('Content-Length', String(meta.size));
    res.set('Cache-Control', 'private, no-store');
    await new Promise((resoudre, rejeter) => {
      fichier.createReadStream().on('error', rejeter).on('end', resoudre).pipe(res);
    });
    return;
  }

  if (op === 'liste' && req.method === 'GET') {
    const prefixe = nettoyerChemin(req.query.prefixe, { vide: true });
    const depart = prefixe ? `${espace}/${prefixe}/` : `${espace}/`;
    if (!qui.gerant && !depart.startsWith(`portail/${qui.email}/`) && !partage(qui, depart)) throw refus(403, 'Accès refusé à ce dossier.');
    const [fichiers] = await bucket.getFiles({ prefix: depart });
    const elements = fichiers
      .filter((f) => !f.name.endsWith('/'))
      .map((f) => ({
        espace, chemin: relatif(espace, f.name), nom: f.name.slice(f.name.lastIndexOf('/') + 1),
        taille: Number(f.metadata?.size || 0), modifie: String(f.metadata?.updated || '').slice(0, 19),
      }))
      .sort((a, b) => a.chemin.localeCompare(b.chemin));
    res.json({ elements });
    return;
  }

  if (op === 'deposer' && req.method === 'POST') {
    const chemin = nettoyerChemin(req.query.chemin);
    const ecraser = String(req.query.ecraser || '') === '1';
    const corps = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    if (!corps || !corps.length) throw refus(400, 'Contenu manquant.');
    const typeMime = String(req.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    verifierDepot(qui, `${espace}/${chemin}`, typeMime, corps.length);
    let cheminFinal = chemin;
    if (ecraser) {
      // Dépôt au nom exact. Pour un colocataire, seule la CRÉATION est
      // permise (comme dans storage.rules) : un fichier existant n'est
      // jamais remplacé.
      if (!qui.gerant) {
        const [existe] = await bucket.file(`${espace}/${chemin}`).exists();
        if (existe) throw refus(403, 'Remplacement refusé : ce fichier existe déjà.');
      }
    } else {
      cheminFinal = await nomDisponible(bucket, espace, chemin);
    }
    await bucket.file(`${espace}/${cheminFinal}`).save(corps, { contentType: typeMime, resumable: false });
    res.json({ espace, chemin: cheminFinal });
    return;
  }

  if (op === 'supprimer' && req.method === 'POST') {
    if (!qui.gerant) throw refus(403, 'Suppression réservée aux gérants.');
    const chemin = nettoyerChemin(req.query.chemin);
    const fichier = bucket.file(`${espace}/${chemin}`);
    // Copie vers la Corbeille avant suppression, comme l'application.
    try {
      const horodatage = new Date().toISOString().replace(/[:T]/g, '').slice(0, 15);
      const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
      await fichier.copy(bucket.file(`corbeille/${horodatage}-${nom}`));
    } catch { /* si la copie échoue, on supprime quand même */ }
    await fichier.delete({ ignoreNotFound: true });
    res.json({ ok: true });
    return;
  }

  if (op === 'deplacer' && req.method === 'POST') {
    if (!qui.gerant) throw refus(403, 'Déplacement réservé aux gérants.');
    const chemin = nettoyerChemin(req.query.chemin);
    const espaceCible = nettoyerChemin(req.query.espaceCible);
    if (espaceCible.includes('/')) throw refus(400, 'Espace cible invalide.');
    const cible = await nomDisponible(bucket, espaceCible, nettoyerChemin(req.query.cible));
    await bucket.file(`${espace}/${chemin}`).move(bucket.file(`${espaceCible}/${cible}`));
    res.json({ espace: espaceCible, chemin: cible });
    return;
  }

  throw refus(400, `Opération inconnue : ${op || '(vide)'}.`);
}

export const fichiers = onRequest({
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 120,
  maxInstances: 5,
}, async (req, res) => {
  try {
    await traiter(req, res);
  } catch (erreur) {
    const statut = erreur instanceof ErreurHttp ? erreur.statut : 500;
    if (statut === 500) console.error('Relais de fichiers :', erreur);
    if (!res.headersSent) res.status(statut).json({ erreur: erreur?.message || 'Erreur du relais.' });
    else res.end();
  }
});
