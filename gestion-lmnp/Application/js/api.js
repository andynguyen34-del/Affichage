// Accès aux fichiers du dossier partagé — directement depuis le navigateur,
// via l'API « File System Access » de Chrome/Edge. Aucun serveur, aucun
// programme : la page lit et écrit dans le dossier que vous désignez une fois.

const SOUS_DOSSIERS = {
  donnees: 'Données',
  documents: 'Documents',
  factures: 'Factures',
  sauvegardes: 'Sauvegardes',
  corbeille: 'Corbeille',
};

let racine = null;               // FileSystemDirectoryHandle du dossier partagé
const encodeur = new TextEncoder();

export const dossierConnecte = () => racine !== null;
export const nomDossier = () => racine?.name || '';
export const apiDisponible = () => typeof window.showDirectoryPicker === 'function';

// ------------------------------------------------------- persistance du dossier

const IDB = 'gestion-lmnp';
const CLE_DOSSIER = 'dossier-partage';

function ouvrirIndexedDB() {
  // Certaines configurations de Chrome bloquent IndexedDB pour les fichiers
  // ouverts en local (file://) : la requête ne répond alors jamais. Un délai
  // de garde évite que le démarrage reste figé — on se passe simplement de la
  // mémorisation du dossier (il faudra le re-choisir, un clic de plus).
  return new Promise((resoudre, rejeter) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { rejeter(new Error('IndexedDB indisponible')); return; }
    let regle = false;
    const minuteur = setTimeout(() => { if (!regle) { regle = true; rejeter(new Error('IndexedDB ne répond pas')); } }, 1500);
    let requete;
    try { requete = indexedDB.open(IDB, 1); }
    catch (erreur) { clearTimeout(minuteur); rejeter(erreur); return; }
    requete.onupgradeneeded = () => requete.result.createObjectStore('handles');
    requete.onsuccess = () => { if (!regle) { regle = true; clearTimeout(minuteur); resoudre(requete.result); } };
    requete.onerror = () => { if (!regle) { regle = true; clearTimeout(minuteur); rejeter(requete.error); } };
  });
}

async function memoriser(handle) {
  try {
    const db = await ouvrirIndexedDB();
    await new Promise((resoudre, rejeter) => {
      const t = db.transaction('handles', 'readwrite');
      t.objectStore('handles').put(handle, CLE_DOSSIER);
      t.oncomplete = resoudre;
      t.onerror = () => rejeter(t.error);
    });
    db.close();
  } catch { /* mémorisation facultative */ }
}

export async function handleMemorise() {
  try {
    const db = await ouvrirIndexedDB();
    const handle = await new Promise((resoudre, rejeter) => {
      const t = db.transaction('handles', 'readonly');
      const r = t.objectStore('handles').get(CLE_DOSSIER);
      r.onsuccess = () => resoudre(r.result || null);
      r.onerror = () => rejeter(r.error);
    });
    db.close();
    return handle;
  } catch { return null; }
}

async function verifierPermission(handle, demander) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (demander && (await handle.requestPermission(options)) === 'granted') return true;
  return false;
}

/** Ouvre le sélecteur de dossier (nécessite un clic). */
export async function choisirDossier() {
  const handle = await window.showDirectoryPicker({ id: 'gestion-lmnp', mode: 'readwrite' });
  if (!(await verifierPermission(handle, true))) throw new Error('Accès au dossier refusé.');
  racine = handle;
  await memoriser(handle);
  return nomDossier();
}

/** Reconnecte le dossier déjà choisi (nécessite un clic pour redonner l'accès). */
export async function reconnecterDossier() {
  const handle = await handleMemorise();
  if (!handle) return false;
  if (!(await verifierPermission(handle, true))) return false;
  racine = handle;
  return true;
}

/** Tente une reconnexion silencieuse (sans clic) — marche si l'accès est encore accordé. */
export async function reconnexionSilencieuse() {
  const handle = await handleMemorise();
  if (!handle) return false;
  if (!(await verifierPermission(handle, false))) return false;
  racine = handle;
  return true;
}

// ------------------------------------------------------------- accès bas niveau

async function dossier(espace, creer = true) {
  if (!racine) throw new Error('Aucun dossier partagé connecté.');
  return racine.getDirectoryHandle(SOUS_DOSSIERS[espace] || espace, { create: creer });
}

/** Descend jusqu'au dossier parent d'un chemin relatif, en créant au besoin. */
async function cheminVersFichier(base, chemin, creer) {
  const segments = String(chemin).split('/').filter(Boolean);
  const nom = segments.pop();
  let courant = base;
  for (const segment of segments) {
    courant = await courant.getDirectoryHandle(segment, { create: creer });
  }
  return { parent: courant, nom };
}

async function empreinte(octets) {
  const condense = await crypto.subtle.digest('SHA-256', octets);
  const hexa = [...new Uint8Array(condense)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hexa.slice(0, 16);
}

async function ecrireAtomique(parent, nom, octets) {
  // createWritable écrit dans un fichier temporaire et bascule à la fermeture :
  // la cible n'est jamais laissée à moitié écrite.
  const handle = await parent.getFileHandle(nom, { create: true });
  const flux = await handle.createWritable();
  await flux.write(octets);
  await flux.close();
}

// --------------------------------------------------------------------- données

export async function lireEtat() {
  return {
    marqueur: 'gestion-lmnp',
    version: '2.0.0',
    dossier: nomDossier(),
    poste: localStorage.getItem('lmnp-poste') || '',
    utilisateur: localStorage.getItem('lmnp-utilisateur') || '',
    fichiersInattendus: [],
  };
}

const nomFichierCollection = (nom) => `${nom}.json`;

export async function lireCollection(nom) {
  const dir = await dossier('donnees');
  let fichier;
  try {
    const handle = await dir.getFileHandle(nomFichierCollection(nom));
    fichier = await handle.getFile();
  } catch { return { version: '', contenu: null }; }

  const octets = new Uint8Array(await fichier.arrayBuffer());
  let texte = new TextDecoder().decode(octets).replace(/^﻿/, '');
  if (!texte.trim()) return { version: '', contenu: null, abime: true, fichier: nomFichierCollection(nom) };
  try {
    const contenu = JSON.parse(texte);
    return { version: await empreinte(octets), contenu };
  } catch {
    return { version: await empreinte(octets), contenu: null, abime: true, fichier: nomFichierCollection(nom) };
  }
}

async function sauvegardeQuotidienne(dir, nom, octetsActuels) {
  try {
    const jour = new Date().toISOString().slice(0, 10);
    const sauvegardes = await dossier('sauvegardes');
    const dossierJour = await sauvegardes.getDirectoryHandle(jour, { create: true });
    try { await dossierJour.getFileHandle(nomFichierCollection(nom)); return; } // déjà sauvegardé aujourd'hui
    catch { /* pas encore : on sauvegarde */ }
    await ecrireAtomique(dossierJour, nomFichierCollection(nom), octetsActuels);
  } catch { /* la sauvegarde ne doit jamais bloquer l'écriture */ }
}

export async function ecrireCollection(nom, versionAttendue, contenu) {
  const dir = await dossier('donnees');
  let handleActuel = null;
  let octetsActuels = null;
  try {
    handleActuel = await dir.getFileHandle(nomFichierCollection(nom));
    octetsActuels = new Uint8Array(await (await handleActuel.getFile()).arrayBuffer());
  } catch { /* fichier absent : première écriture */ }

  const versionActuelle = octetsActuels ? await empreinte(octetsActuels) : '';
  if (versionActuelle !== (versionAttendue || '')) {
    // Quelqu'un a écrit entre-temps : on renvoie le contenu frais pour rejeu.
    let contenuFrais = null;
    if (octetsActuels) {
      try { contenuFrais = JSON.parse(new TextDecoder().decode(octetsActuels).replace(/^﻿/, '')); }
      catch { contenuFrais = null; }
    }
    return { conflit: true, version: versionActuelle, contenu: contenuFrais };
  }

  if (octetsActuels) await sauvegardeQuotidienne(dir, nom, octetsActuels);
  const octets = encodeur.encode(JSON.stringify(contenu, null, 2));
  await ecrireAtomique(dir, nomFichierCollection(nom), octets);
  return { ok: true, version: await empreinte(octets) };
}

// ---------------------------------------------------------------------- fichiers

async function parcourir(dir, prefixe, espace, elements) {
  for await (const [nom, handle] of dir.entries()) {
    if (nom.startsWith('~$') || nom === 'LISEZ-MOI.txt' || nom.endsWith('.tmp')) continue;
    const chemin = prefixe ? `${prefixe}/${nom}` : nom;
    if (handle.kind === 'directory') {
      await parcourir(handle, chemin, espace, elements);
    } else {
      const fichier = await handle.getFile();
      elements.push({
        espace, chemin, nom,
        taille: fichier.size,
        modifie: new Date(fichier.lastModified).toISOString().slice(0, 19),
      });
    }
  }
}

export async function listerFichiers(espace) {
  if (!racine) return [];
  const dir = await dossier(espace);
  const elements = [];
  await parcourir(dir, '', espace, elements);
  return elements.sort((a, b) => a.chemin.localeCompare(b.chemin));
}

async function nomDisponible(parent, nom) {
  const point = nom.lastIndexOf('.');
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : '';
  let candidat = nom;
  for (let i = 1; i <= 200; i += 1) {
    try { await parent.getFileHandle(candidat); candidat = `${base} (${i})${ext}`; }
    catch { return candidat; } // n'existe pas → disponible
  }
  throw new Error('Trop de fichiers de même nom.');
}

export async function deposerFichier(espace, chemin, fichier) {
  const dir = await dossier(espace);
  const { parent, nom } = await cheminVersFichier(dir, chemin, true);
  const nomFinal = await nomDisponible(parent, nom);
  const octets = new Uint8Array(await fichier.arrayBuffer());
  await ecrireAtomique(parent, nomFinal, octets);
  const cheminFinal = chemin.includes('/') ? `${chemin.slice(0, chemin.lastIndexOf('/'))}/${nomFinal}` : nomFinal;
  return { espace, chemin: cheminFinal };
}

export async function deplacerFichier(espace, chemin, espaceCible, cible) {
  const dirSource = await dossier(espace);
  const { parent: pSource, nom: nSource } = await cheminVersFichier(dirSource, chemin, false);
  const fichier = await (await pSource.getFileHandle(nSource)).getFile();

  const dirCible = await dossier(espaceCible);
  const { parent: pCible, nom: nCible } = await cheminVersFichier(dirCible, cible, true);
  const nomFinal = await nomDisponible(pCible, nCible);
  await ecrireAtomique(pCible, nomFinal, new Uint8Array(await fichier.arrayBuffer()));
  await pSource.removeEntry(nSource);

  const cheminFinal = cible.includes('/') ? `${cible.slice(0, cible.lastIndexOf('/'))}/${nomFinal}` : nomFinal;
  return { espace: espaceCible, chemin: cheminFinal };
}

export async function supprimerFichier(espace, chemin) {
  const dir = await dossier(espace);
  const { parent, nom } = await cheminVersFichier(dir, chemin, false);
  // On déplace vers la Corbeille plutôt que de supprimer définitivement.
  try {
    const fichier = await (await parent.getFileHandle(nom)).getFile();
    const corbeille = await dossier('corbeille');
    const horodatage = new Date().toISOString().replace(/[:T]/g, '').slice(0, 15);
    await ecrireAtomique(corbeille, `${horodatage}-${nom}`, new Uint8Array(await fichier.arrayBuffer()));
  } catch { /* si la copie échoue, on supprime quand même */ }
  await parent.removeEntry(nom);
}

/** Ouvre un fichier (justificatif) dans un nouvel onglet, via une adresse temporaire. */
export async function ouvrirFichier(espace, chemin) {
  const dir = await dossier(espace);
  const { parent, nom } = await cheminVersFichier(dir, chemin, false);
  const fichier = await (await parent.getFileHandle(nom)).getFile();
  const url = URL.createObjectURL(fichier);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function arreter() { /* aucune ressource à libérer : rien à faire */ }

// ------------------------------------------------------------------- verrou

// Verrou coopératif « un seul poste à la fois », matérialisé par un fichier
// dans Données. Il n'est pas absolu (OneDrive met quelques secondes à
// synchroniser) mais transforme une écriture concurrente — sinon silencieuse —
// en avertissement visible.
const FICHIER_VERROU = '_verrou.json';

export async function lireVerrou() {
  try {
    const dir = await dossier('donnees');
    const fichier = await (await dir.getFileHandle(FICHIER_VERROU)).getFile();
    const texte = (await fichier.text()).replace(/^﻿/, '');
    return texte.trim() ? JSON.parse(texte) : null;
  } catch { return null; }
}

export async function ecrireVerrou(verrou) {
  const dir = await dossier('donnees');
  await ecrireAtomique(dir, FICHIER_VERROU, encodeur.encode(JSON.stringify(verrou)));
}

export async function libererVerrou(idPoste) {
  try {
    const actuel = await lireVerrou();
    if (actuel && actuel.idPoste !== idPoste) return; // le verrou est à quelqu'un d'autre
    const dir = await dossier('donnees');
    await dir.removeEntry(FICHIER_VERROU);
  } catch { /* rien à libérer */ }
}
