// Magasin de données partagé : chargement, écriture tolérante aux conflits,
// et notification des pages quand quelque chose change.

import * as api from './api.js';

export const COLLECTIONS = ['parametres', 'biens', 'locataires', 'baux', 'loyers', 'etatsDesLieux'];

export const MODES_REGLEMENT = ['Virement', 'Chèque', 'Espèces', 'Prélèvement', 'CAF / APL', 'Autre'];

function parametresParDefaut() {
  return {
    bailleurs: [],
    adresseCorrespondance: '',
    lieuSignature: '',
  };
}

const contenuParDefaut = (nom) => (nom === 'parametres' ? parametresParDefaut() : { elements: [] });

const magasin = {
  donnees: {},
  versions: {},
  etat: null,
  fichiers: { documents: [], factures: [] },
  abonnes: new Set(),
  synchro: 'ok',
};

export const donnees = () => magasin.donnees;
export const infosServeur = () => magasin.etat;
export const fichiers = (espace) => magasin.fichiers[espace] || [];
export const utilisateur = () => {
  try { const local = localStorage.getItem('lmnp-utilisateur'); if (local) return local; } catch { /* ignore */ }
  return magasin.etat?.utilisateur || 'inconnu';
};

export function liste(nom) {
  const valeur = magasin.donnees[nom];
  return Array.isArray(valeur?.elements) ? valeur.elements : [];
}

export const parametres = () => magasin.donnees.parametres || parametresParDefaut();

export function abonner(fonction) {
  magasin.abonnes.add(fonction);
  return () => magasin.abonnes.delete(fonction);
}

function notifier(raison) {
  magasin.abonnes.forEach((fn) => {
    try { fn(raison); } catch (e) { console.error(e); }
  });
}

export function etatSynchro() { return magasin.synchro; }

function definirSynchro(valeur) {
  magasin.synchro = valeur;
  notifier('synchro');
}


function normaliser(nom, contenu) {
  if (contenu === null || contenu === undefined) return contenuParDefaut(nom);
  if (nom === 'parametres') return { ...parametresParDefaut(), ...contenu };
  if (!Array.isArray(contenu.elements)) return { elements: [] };
  return contenu;
}

export async function chargerTout(onEtape = () => {}) {
  onEtape('Préparation du dossier…');
  magasin.etat = await api.lireEtat();
  const abimes = [];
  onEtape('Lecture des écritures comptables…');
  await Promise.all(COLLECTIONS.map(async (nom) => {
    const resultat = await api.lireCollection(nom);
    if (resultat.abime) { abimes.push(resultat.fichier || `${nom}.json`); return; }
    magasin.versions[nom] = resultat.version;
    magasin.donnees[nom] = normaliser(nom, resultat.contenu);
  }));
  if (abimes.length) {
    // On refuse de démarrer sur un fichier illisible : le traiter comme vide
    // écraserait des données récupérables à la première sauvegarde.
    const erreur = new Error(
      `Fichier(s) de données illisible(s) : ${abimes.join(', ')}. `
      + 'Restaurez la dernière version depuis le sous-dossier « Sauvegardes » du dossier partagé, '
      + 'puis rechargez la page.');
    erreur.abime = true;
    throw erreur;
  }
  onEtape('Lecture des dossiers Documents et Factures…');
  await rechargerFichiers();
  notifier('chargement');
}

const empreinteFichiers = (liste) =>
  liste.map((f) => `${f.espace}:${f.chemin}:${f.taille}:${f.modifie}`).sort().join('|');

/** Relit le dossier Documents. Renvoie true si la liste a changé. */
export async function rechargerFichiers({ notifier: doitNotifier = false } = {}) {
  let changement = false;
  for (const espace of ['documents']) {
    const avant = empreinteFichiers(magasin.fichiers[espace] || []);
    // eslint-disable-next-line no-await-in-loop
    try { magasin.fichiers[espace] = await api.listerFichiers(espace); }
    catch { magasin.fichiers[espace] = []; }
    if (empreinteFichiers(magasin.fichiers[espace]) !== avant) changement = true;
  }
  if (changement && doitNotifier) notifier('fichiers');
  return changement;
}

/** Relit le dossier partagé ; signale si le contenu a changé (modification de l'autre poste). */
export async function rafraichir({ silencieux = false } = {}) {
  let changement = false;
  definirSynchro('occupe');
  try {
    for (const nom of COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      const majeur = await enFile(nom, async () => {
        const resultat = await api.lireCollection(nom);
        if (resultat.version === magasin.versions[nom]) return false;
        magasin.versions[nom] = resultat.version;
        magasin.donnees[nom] = normaliser(nom, resultat.contenu);
        return true;
      });
      if (majeur) changement = true;
    }
    if (await rechargerFichiers()) changement = true;
    definirSynchro('ok');
  } catch (erreur) {
    definirSynchro('erreur');
    if (!silencieux) throw erreur;
    return false;
  }
  if (changement) notifier('rafraichissement');
  return changement;
}

/**
 * File d'attente par collection : deux écritures lancées en même temps depuis
 * ce poste se suivent au lieu de se concurrencer. Sans cela, elles se
 * déclencheraient mutuellement des conflits et finiraient par épuiser leurs
 * tentatives.
 */
const filesDattente = new Map();

function enFile(nom, tache) {
  const precedent = filesDattente.get(nom) || Promise.resolve();
  const suivant = precedent.then(tache, tache);
  filesDattente.set(nom, suivant.catch(() => {}));
  return suivant;
}

const patienter = (millisecondes) => new Promise((resoudre) => { setTimeout(resoudre, millisecondes); });

const TENTATIVES_MAXIMUM = 8;

/**
 * Applique une modification et l'enregistre.
 * Si l'autre poste a écrit entre-temps, la modification est rejouée sur la
 * version fraîche du fichier : deux personnes qui touchent des lignes
 * différentes ne s'écrasent jamais.
 */
export function modifier(nom, mutation) {
  return enFile(nom, async () => {
    definirSynchro('occupe');
    try {
      for (let tentative = 0; tentative < TENTATIVES_MAXIMUM; tentative += 1) {
        const copie = structuredClone(magasin.donnees[nom] ?? contenuParDefaut(nom));
        const retour = mutation(copie);
        const resultat = await api.ecrireCollection(nom, magasin.versions[nom], copie);
        if (resultat.conflit) {
          magasin.versions[nom] = resultat.version;
          magasin.donnees[nom] = normaliser(nom, resultat.contenu);
          // Petite attente irrégulière : deux postes qui réessaient ensemble
          // finiraient sinon par se retrouver systématiquement en concurrence.
          await patienter(20 * (tentative + 1) + Math.floor(Math.random() * 40));
          continue;
        }
        magasin.versions[nom] = resultat.version;
        magasin.donnees[nom] = copie;
        definirSynchro('ok');
        notifier('modification');
        return retour;
      }
      throw new Error('Le fichier est modifié en continu depuis l’autre poste. Réessayez dans un instant.');
    } catch (erreur) {
      definirSynchro('erreur');
      throw erreur;
    }
  });
}

function estampiller(element) {
  return {
    ...element,
    majLe: new Date().toISOString().slice(0, 19),
    majPar: utilisateur(),
  };
}

/**
 * Crée ou met à jour un élément d'une collection. Renvoie l'élément enregistré.
 * La fusion est recalculée à chaque tentative sur la version fraîche du
 * fichier : les champs qu'on ne soumet pas et qu'un autre poste a ajoutés
 * entre-temps sont conservés au lieu d'être écrasés.
 */
export async function enregistrer(nom, element) {
  const id = element.id || crypto.randomUUID();
  let enregistre;
  await modifier(nom, (contenu) => {
    const index = contenu.elements.findIndex((e) => e.id === id);
    const base = index >= 0 ? contenu.elements[index] : {};
    enregistre = estampiller({ ...base, ...element, id });
    if (index >= 0) contenu.elements[index] = enregistre;
    else contenu.elements.push(enregistre);
  });
  return enregistre;
}

/**
 * Applique une transformation en place à UN élément, sur la version fraîche du
 * fichier à chaque tentative. À utiliser pour les ajouts dans une sous-liste
 * (encaissements) : deux ajouts concurrents s'additionnent au lieu de s'écraser.
 */
export async function modifierElement(nom, id, transformation, gabaritSiAbsent = null) {
  let enregistre;
  await modifier(nom, (contenu) => {
    let index = contenu.elements.findIndex((e) => e.id === id);
    if (index < 0) {
      if (!gabaritSiAbsent) throw new Error('Élément introuvable.');
      contenu.elements.push({ ...gabaritSiAbsent, id });
      index = contenu.elements.length - 1;
    }
    transformation(contenu.elements[index]);
    enregistre = estampiller(contenu.elements[index]);
    contenu.elements[index] = enregistre;
  });
  return enregistre;
}

export async function supprimer(nom, id) {
  await modifier(nom, (contenu) => {
    contenu.elements = contenu.elements.filter((e) => e.id !== id);
  });
}

/**
 * Remplace entièrement une collection par un contenu importé (reprise d'une
 * sauvegarde). Passe par le circuit d'écriture normal : conflit détecté,
 * version incrémentée, sauvegarde quotidienne.
 */
export async function remplacerCollection(nom, contenu) {
  const propre = normaliser(nom, structuredClone(contenu));
  await modifier(nom, (copie) => {
    for (const cle of Object.keys(copie)) delete copie[cle];
    Object.assign(copie, propre);
  });
}

export async function enregistrerParametres(modifications) {
  await modifier('parametres', (contenu) => {
    Object.assign(contenu, modifications);
  });
}

export const trouver = (nom, id) => liste(nom).find((e) => e.id === id) || null;
