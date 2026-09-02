// Accès aux données — version hébergée (« nuage ») : Firebase Auth pour
// l'identité, Firestore pour la comptabilité, Storage pour les justificatifs.
// Même interface que api.js (version « dossier partagé ») : les pages et le
// magasin d'état ne voient pas la différence.

import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  connectAuthEmulator, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, runTransaction,
  collection, addDoc, connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getStorage, ref as refStockage, uploadBytes, listAll, getMetadata,
  getBlob, deleteObject, connectStorageEmulator,
} from 'firebase/storage';

export const MODE = 'nuage';

let app = null;
let auth = null;
let base = null;
let stockage = null;

// ------------------------------------------------------------ initialisation

/**
 * Initialise Firebase. La configuration vient de l'hébergement lui-même
 * (adresse réservée /__/firebase/init.json de Firebase Hosting) : rien à
 * recopier à la main. Pour les tests, window.__FIREBASE_CONFIG__ et
 * window.__EMULATEURS__ permettent de brancher les émulateurs locaux.
 */
export async function initialiser() {
  if (app) return;
  let config = window.__FIREBASE_CONFIG__ || null;
  if (!config) {
    const reponse = await fetch('/__/firebase/init.json');
    if (!reponse.ok) {
      throw new Error('Configuration Firebase introuvable : cette page doit être servie par Firebase Hosting.');
    }
    config = await reponse.json();
  }
  app = initializeApp(config);
  auth = getAuth(app);
  base = getFirestore(app);
  stockage = getStorage(app);
  if (window.__EMULATEURS__) {
    const e = window.__EMULATEURS__;
    connectAuthEmulator(auth, `http://${e.hote}:${e.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(base, e.hote, e.firestore);
    connectStorageEmulator(stockage, e.hote, e.stockage);
  }
  try { await setPersistence(auth, browserLocalPersistence); } catch { /* session seulement */ }
}

// ----------------------------------------------------------------- connexion

/** Attend que Firebase ait déterminé si quelqu'un est déjà connecté. */
export function attendreConnexion() {
  return new Promise((resoudre) => {
    const arreterEcoute = onAuthStateChanged(auth, (utilisateur) => {
      arreterEcoute();
      resoudre(utilisateur || null);
    });
  });
}

const MESSAGES_AUTH = {
  'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
  'auth/invalid-email': 'Cette adresse e-mail n’est pas valide.',
  'auth/user-disabled': 'Ce compte a été désactivé.',
  'auth/user-not-found': 'Aucun compte ne correspond à cette adresse.',
  'auth/wrong-password': 'Mot de passe incorrect.',
  'auth/too-many-requests': 'Trop de tentatives : patientez quelques minutes puis réessayez.',
  'auth/network-request-failed': 'Pas de connexion à Internet, ou réseau bloqué.',
};

export async function seConnecter(email, motDePasse) {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), motDePasse);
  } catch (erreur) {
    throw new Error(MESSAGES_AUTH[erreur?.code] || `Connexion impossible (${erreur?.code || erreur?.message}).`);
  }
}

export async function seDeconnecter() { await signOut(auth); }
export const utilisateurEmail = () => auth?.currentUser?.email || '';

// ---------------------------------------------------------------- collections

// Une collection = un document Firestore `donnees/{nom}`, dont le champ
// `json` contient le contenu tel quel (chaîne JSON, pour préserver la
// structure exacte) et `version` un compteur incrémenté à chaque écriture.
const documentCollection = (nom) => doc(base, 'donnees', nom);

const analyser = (json) => {
  try { return JSON.parse(json); } catch { return null; }
};

export async function lireEtat() {
  return {
    marqueur: 'gestion-lmnp',
    version: '3.0.0',
    dossier: `En ligne — ${utilisateurEmail()}`,
    poste: localStorage.getItem('lmnp-poste') || '',
    utilisateur: localStorage.getItem('lmnp-utilisateur') || '',
    fichiersInattendus: [],
  };
}

export async function lireCollection(nom) {
  const photo = await getDoc(documentCollection(nom));
  if (!photo.exists()) return { version: '', contenu: null };
  const { json, version } = photo.data();
  const contenu = analyser(json);
  if (contenu === null) return { version: String(version), contenu: null, abime: true, fichier: `${nom}` };
  return { version: String(version), contenu };
}

async function sauvegardeQuotidienne(nom, jsonPrecedent) {
  // Une photo par collection et par jour, comme le dossier Sauvegardes.
  try {
    const jour = new Date().toISOString().slice(0, 10);
    const cible = doc(base, 'sauvegardes', `${jour}_${nom}`);
    if ((await getDoc(cible)).exists()) return;
    await setDoc(cible, { json: jsonPrecedent, jour, nom });
  } catch { /* la sauvegarde ne doit jamais bloquer l'écriture */ }
}

export async function ecrireCollection(nom, versionAttendue, contenu) {
  const json = JSON.stringify(contenu, null, 2);
  const resultat = await runTransaction(base, async (transaction) => {
    const photo = await transaction.get(documentCollection(nom));
    const versionActuelle = photo.exists() ? String(photo.data().version) : '';
    if (versionActuelle !== String(versionAttendue || '')) {
      return {
        conflit: true,
        version: versionActuelle,
        contenu: photo.exists() ? analyser(photo.data().json) : null,
      };
    }
    const nouvelleVersion = (photo.exists() ? photo.data().version : 0) + 1;
    transaction.set(documentCollection(nom), {
      json,
      version: nouvelleVersion,
      majLe: new Date().toISOString(),
      majPar: utilisateurEmail(),
    });
    return { ok: true, version: String(nouvelleVersion), jsonPrecedent: photo.exists() ? photo.data().json : null };
  });
  if (resultat.ok && resultat.jsonPrecedent) sauvegardeQuotidienne(nom, resultat.jsonPrecedent);
  return resultat.ok ? { ok: true, version: resultat.version } : resultat;
}

// ------------------------------------------------------------------- fichiers

// Les justificatifs vivent dans Firebase Storage : `{espace}/{chemin}`.
const refFichier = (espace, chemin) => refStockage(stockage, `${espace}/${chemin}`);

async function parcourir(reference, prefixe, espace, elements) {
  const page = await listAll(reference);
  for (const fichier of page.items) {
    const chemin = prefixe ? `${prefixe}/${fichier.name}` : fichier.name;
    let meta = null;
    try { meta = await getMetadata(fichier); } catch { /* métadonnées facultatives */ }
    elements.push({
      espace, chemin, nom: fichier.name,
      taille: Number(meta?.size || 0),
      modifie: (meta?.updated || '').slice(0, 19),
    });
  }
  for (const sousDossier of page.prefixes) {
    const chemin = prefixe ? `${prefixe}/${sousDossier.name}` : sousDossier.name;
    await parcourir(sousDossier, chemin, espace, elements);
  }
}

export async function listerFichiers(espace, prefixe = '') {
  const elements = [];
  const depart = prefixe ? `${espace}/${prefixe}` : espace;
  await parcourir(refStockage(stockage, depart), prefixe, espace, elements);
  return elements.sort((a, b) => a.chemin.localeCompare(b.chemin));
}

async function existe(reference) {
  try { await getMetadata(reference); return true; }
  catch { return false; }
}

async function nomDisponible(espace, chemin) {
  const point = chemin.lastIndexOf('.');
  const barre = chemin.lastIndexOf('/');
  const base_ = point > barre ? chemin.slice(0, point) : chemin;
  const ext = point > barre ? chemin.slice(point) : '';
  let candidat = chemin;
  for (let i = 1; i <= 200; i += 1) {
    if (!(await existe(refFichier(espace, candidat)))) return candidat;
    candidat = `${base_} (${i})${ext}`;
  }
  throw new Error('Trop de fichiers de même nom.');
}

export async function deposerFichier(espace, chemin, fichier) {
  const cheminFinal = await nomDisponible(espace, chemin);
  await uploadBytes(refFichier(espace, cheminFinal), fichier, {
    contentType: fichier.type || 'application/octet-stream',
  });
  return { espace, chemin: cheminFinal };
}

export async function deplacerFichier(espace, chemin, espaceCible, cible) {
  const source = refFichier(espace, chemin);
  const contenu = await getBlob(source);
  const cheminFinal = await nomDisponible(espaceCible, cible);
  await uploadBytes(refFichier(espaceCible, cheminFinal), contenu);
  await deleteObject(source);
  return { espace: espaceCible, chemin: cheminFinal };
}

export async function supprimerFichier(espace, chemin) {
  const source = refFichier(espace, chemin);
  // Copie vers la Corbeille avant suppression, comme la version dossier.
  try {
    const contenu = await getBlob(source);
    const horodatage = new Date().toISOString().replace(/[:T]/g, '').slice(0, 15);
    const nom = chemin.includes('/') ? chemin.slice(chemin.lastIndexOf('/') + 1) : chemin;
    await uploadBytes(refFichier('corbeille', `${horodatage}-${nom}`), contenu);
  } catch { /* si la copie échoue, on supprime quand même */ }
  await deleteObject(source);
}

export async function ouvrirFichier(espace, chemin) {
  const contenu = await getBlob(refFichier(espace, chemin));
  const url = URL.createObjectURL(contenu);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Lit le contenu brut d'un fichier (octets). */
export async function lireOctets(espace, chemin) {
  const contenu = await getBlob(refFichier(espace, chemin));
  return new Uint8Array(await contenu.arrayBuffer());
}

/** Télécharge un fichier sur le poste (bouton « Télécharger »). */
export async function telechargerFichier(espace, chemin, nomFichier) {
  const contenu = await getBlob(refFichier(espace, chemin));
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(contenu);
  lien.download = nomFichier || chemin.split('/').pop();
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
}

/** Dépose des octets générés par l'application (PDF de quittance, rapport…). */
export async function deposerOctets(espace, chemin, octets, typeMime) {
  await uploadBytes(refFichier(espace, chemin), octets, { contentType: typeMime || 'application/octet-stream' });
  return { espace, chemin };
}

export async function arreter() { /* rien à libérer */ }

// ------------------------------------------------------------ rôles et portail

// systeme/roles : { admins: [e-mails gérants], colocataires: { e-mail: locataireId } }.
// Lisible par les gérants seulement ; sert aussi aux règles de sécurité.
const documentRoles = () => doc(base, 'systeme', 'roles');

/**
 * Détermine le rôle du compte connecté. Les règles n'autorisent la lecture de
 * systeme/roles qu'aux gérants : un refus de permission signifie « colocataire ».
 * Au premier lancement (document absent), le compte courant devient gérant.
 */
export async function detecterRole() {
  try {
    const photo = await getDoc(documentRoles());
    if (!photo.exists()) {
      await setDoc(documentRoles(), { admins: [utilisateurEmail()], colocataires: {} });
    }
    return 'admin';
  } catch { return 'colocataire'; }
}

export async function lireRoles() {
  const photo = await getDoc(documentRoles());
  return photo.exists() ? photo.data() : { admins: [utilisateurEmail()], colocataires: {} };
}

export async function ecrireRoles(roles) {
  await setDoc(documentRoles(), roles);
}

// portail/{e-mail} : ce que voit un colocataire connecté — son nom et la liste
// de ses documents. Écrit par les gérants, lu par le colocataire concerné.
const cleEmail = (email) => String(email || '').trim().toLowerCase();

export async function publierPortail(email, contenu) {
  await setDoc(doc(base, 'portail', cleEmail(email)), {
    ...contenu,
    email: cleEmail(email),
    majLe: new Date().toISOString(),
  });
}

export async function lirePortail(email) {
  const photo = await getDoc(doc(base, 'portail', cleEmail(email)));
  return photo.exists() ? photo.data() : null;
}

export async function lireMonPortail() {
  return lirePortail(utilisateurEmail());
}

export async function supprimerPortail(email) {
  try { await deleteDoc(doc(base, 'portail', cleEmail(email))); } catch { /* déjà absent */ }
}

// --------------------------------------------------------------------- courriel

/**
 * Met un courriel en file d'envoi (collection « mail », lue par l'extension
 * Firebase « Trigger Email » — voir le guide de mise en place). Les pièces
 * jointes sont passées en base64.
 */
export async function envoyerCourriel({ destinataires, sujet, html, piecesJointes = [] }) {
  await addDoc(collection(base, 'mail'), {
    to: destinataires,
    message: {
      subject: sujet,
      html,
      attachments: piecesJointes.map((p) => ({
        filename: p.nom,
        content: p.base64,
        encoding: 'base64',
      })),
    },
  });
}

// -------------------------------------------------------------------- verrou

// Verrou « un seul poste à la fois », même sémantique que la version dossier,
// matérialisé par le document Firestore `systeme/verrou`.
const documentVerrou = () => doc(base, 'systeme', 'verrou');

export async function lireVerrou() {
  try {
    const photo = await getDoc(documentVerrou());
    return photo.exists() ? photo.data() : null;
  } catch { return null; }
}

export async function ecrireVerrou(verrou) {
  await setDoc(documentVerrou(), verrou);
}

export async function libererVerrou(idPoste) {
  try {
    const actuel = await lireVerrou();
    if (actuel && actuel.idPoste !== idPoste) return;
    await deleteDoc(documentVerrou());
  } catch { /* rien à libérer */ }
}

// ------------------------------------- compatibilité avec la version dossier

// Ces fonctions n'ont pas de sens en ligne ; app.js ne les appelle que dans
// la branche « dossier », jamais ici.
export const apiDisponible = () => true;
export const dossierConnecte = () => auth?.currentUser != null;
export const nomDossier = () => utilisateurEmail();
export async function choisirDossier() { throw new Error('Sans objet en version en ligne.'); }
export async function connecterHandle() { return false; }
export async function handleMemorise() { return null; }
export async function reconnecterDossier() { return false; }
export async function reconnexionSilencieuse() { return false; }
