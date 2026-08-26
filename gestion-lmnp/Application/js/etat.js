// Magasin de données partagé : chargement, écriture tolérante aux conflits,
// et notification des pages quand quelque chose change.

import * as api from './api.js';

export const COLLECTIONS = ['parametres', 'biens', 'locataires', 'baux', 'loyers',
  'charges', 'immobilisations', 'emprunts', 'exercices'];

const LISTES = new Set(COLLECTIONS.filter((n) => n !== 'parametres'));

export const CATEGORIES_CHARGES = [
  { code: 'taxe-fonciere', libelle: 'Taxe foncière' },
  { code: 'cfe', libelle: 'Cotisation foncière des entreprises (CFE)' },
  { code: 'assurance-pno', libelle: 'Assurance propriétaire non occupant' },
  { code: 'assurance-gli', libelle: 'Assurance loyers impayés' },
  { code: 'copropriete', libelle: 'Charges de copropriété non récupérables' },
  { code: 'entretien', libelle: 'Entretien et petites réparations' },
  { code: 'travaux', libelle: 'Travaux de réparation' },
  { code: 'honoraires-comptables', libelle: 'Honoraires comptables, OGA' },
  { code: 'honoraires-gestion', libelle: 'Frais de gestion locative' },
  { code: 'annonces', libelle: 'Annonces, recherche de locataire' },
  { code: 'energie', libelle: 'Énergie, eau, chauffage (à charge du bailleur)' },
  { code: 'abonnements', libelle: 'Abonnements (internet, télévision)' },
  { code: 'mobilier-petit', libelle: 'Petit mobilier et équipement (moins de 600 €)' },
  { code: 'frais-bancaires', libelle: 'Frais bancaires' },
  { code: 'fournitures', libelle: 'Fournitures et petit matériel' },
  { code: 'deplacements', libelle: 'Frais de déplacement' },
  { code: 'ordures', libelle: 'Taxe d’ordures ménagères non récupérable' },
  { code: 'interets-emprunt', libelle: 'Intérêts d’emprunt (saisie manuelle)' },
  { code: 'assurance-emprunteur', libelle: 'Assurance emprunteur (saisie manuelle)' },
  { code: 'frais-acquisition', libelle: 'Frais d’acquisition déduits' },
  { code: 'autres', libelle: 'Autres charges déductibles' },
];

export const CATEGORIES_IMMOBILISATIONS = [
  { code: 'gros-oeuvre', libelle: 'Gros œuvre', duree: 50, partIndicative: 40 },
  { code: 'facade', libelle: 'Façade, toiture, étanchéité', duree: 25, partIndicative: 10 },
  { code: 'installations', libelle: 'Installations générales et techniques', duree: 20, partIndicative: 25 },
  { code: 'agencements', libelle: 'Agencements intérieurs', duree: 15, partIndicative: 25 },
  { code: 'mobilier', libelle: 'Mobilier et équipement', duree: 7, partIndicative: 0 },
  { code: 'electromenager', libelle: 'Électroménager', duree: 5, partIndicative: 0 },
  { code: 'travaux-amelioration', libelle: 'Travaux d’amélioration', duree: 12, partIndicative: 0 },
  { code: 'frais-acquisition', libelle: 'Frais d’acquisition amortis', duree: 25, partIndicative: 0 },
];

export const MODES_REGLEMENT = ['Virement', 'Chèque', 'Espèces', 'Prélèvement', 'CAF / APL', 'Autre'];

function parametresParDefaut() {
  return {
    bailleurs: [],
    adresseCorrespondance: '',
    siret: '',
    debutActivite: '',
    methodeComptable: 'encaissement',
    interetsAutomatiques: true,
    microAbattement: 50,
    microPlafond: 77700,
    reports: { amortissementsDifferes: 0, deficits: [] },
    casesDeclaration: { beneficeAvecOga: '5NA', beneficeSansOga: '5NK', deficit: '5NY' },
    adherentOga: false,
    indicesIrl: [],
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
export const utilisateur = () => magasin.etat?.utilisateur || 'inconnu';

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

export async function chargerTout() {
  magasin.etat = await api.lireEtat();
  await Promise.all(COLLECTIONS.map(async (nom) => {
    const resultat = await api.lireCollection(nom);
    magasin.versions[nom] = resultat.version;
    magasin.donnees[nom] = normaliser(nom, resultat.contenu);
  }));
  await rechargerFichiers();
  notifier('chargement');
}

export async function rechargerFichiers() {
  for (const espace of ['documents', 'factures']) {
    try { magasin.fichiers[espace] = await api.listerFichiers(espace); }
    catch { magasin.fichiers[espace] = []; }
  }
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
    await rechargerFichiers();
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

/** Crée ou met à jour un élément d'une collection. Renvoie l'élément enregistré. */
export async function enregistrer(nom, element) {
  const complet = estampiller({ ...element, id: element.id || crypto.randomUUID() });
  await modifier(nom, (contenu) => {
    const index = contenu.elements.findIndex((e) => e.id === complet.id);
    if (index >= 0) contenu.elements[index] = complet;
    else contenu.elements.push(complet);
  });
  return complet;
}

export async function supprimer(nom, id) {
  await modifier(nom, (contenu) => {
    contenu.elements = contenu.elements.filter((e) => e.id !== id);
  });
}

export async function enregistrerParametres(modifications) {
  await modifier('parametres', (contenu) => {
    Object.assign(contenu, modifications);
  });
}

export const trouver = (nom, id) => liste(nom).find((e) => e.id === id) || null;

export function libelleCategorieCharge(code) {
  return CATEGORIES_CHARGES.find((c) => c.code === code)?.libelle || code || 'Sans catégorie';
}

export function libelleCategorieImmobilisation(code) {
  return CATEGORIES_IMMOBILISATIONS.find((c) => c.code === code)?.libelle || code || 'Autre';
}
