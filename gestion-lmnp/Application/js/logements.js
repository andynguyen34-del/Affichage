// Plusieurs logements : type de location de chacun, sélection d'un logement
// dans l'en-tête (mémorisée sur l'appareil), filtrage des données par
// logement, et séjours de courte durée (Airbnb, Booking…).
// Module PUR (pas d'accès au DOM ni au magasin) — utilisable dans les tests.

export const TYPES_LOCATION = [
  { valeur: 'colocation', libelle: 'Colocation — un bail, plusieurs colocataires avec leur part' },
  { valeur: 'entiere', libelle: 'Location entière — un bail, un locataire (ou un couple)' },
  { valeur: 'courte', libelle: 'Courte durée — Airbnb, Booking… (séjours, pas de loyer mensuel)' },
];

export const LIBELLES_TYPE_LOCATION = {
  colocation: 'Colocation',
  entiere: 'Location entière',
  courte: 'Courte durée',
};

export const PLATEFORMES = ['Airbnb', 'Booking', 'Abritel', 'En direct', 'Autre'];

/** Type de location d'un logement (les logements existants sont des colocations). */
export const typeLocation = (bien) => (bien?.typeLocation && LIBELLES_TYPE_LOCATION[bien.typeLocation] ? bien.typeLocation : 'colocation');
export const libelleTypeLocation = (bien) => LIBELLES_TYPE_LOCATION[typeLocation(bien)];
export const estCourteDuree = (bien) => typeLocation(bien) === 'courte';

/** Le mot pour désigner l'occupant, selon le type de location. */
export const motOccupant = (bien, pluriel = false) => {
  const mot = { colocation: 'colocataire', entiere: 'locataire', courte: 'voyageur' }[typeLocation(bien)];
  return pluriel ? `${mot}s` : mot;
};

export const nomLogement = (biens, bienId) => (biens || []).find((b) => b.id === bienId)?.nom || 'logement inconnu';

// --------------------------------------------------------- sélection mémorisée

export const CLE_LOGEMENT = 'lmnp-logement';

export function logementMemorise() {
  try { return localStorage.getItem(CLE_LOGEMENT) || ''; } catch { return ''; }
}

export function memoriserLogement(bienId) {
  try {
    if (bienId) localStorage.setItem(CLE_LOGEMENT, bienId);
    else localStorage.removeItem(CLE_LOGEMENT);
  } catch { /* stockage local indisponible */ }
}

// ------------------------------------------------------------------- filtrage

/**
 * Les données vues par un logement : ses baux, les loyers et séjours qui s'y
 * rattachent, ses cautions, ses états des lieux, ses régularisations.
 * Sans logement choisi (« Tous les logements »), les données sont rendues telles quelles.
 */
export function filtrerDonnees(donnees, bienId) {
  if (!bienId) return donnees;
  const biens = (donnees.biens || []).filter((b) => b.id === bienId);
  const baux = (donnees.baux || []).filter((b) => b.bienId === bienId);
  const bailIds = new Set(baux.map((b) => b.id));
  return {
    ...donnees,
    biens,
    baux,
    loyers: (donnees.loyers || []).filter((l) => (l.sejour ? l.bienId === bienId : bailIds.has(l.bailId))),
    cautions: (donnees.cautions || []).filter((c) => bailIds.has(c.bailId)),
    etatsDesLieux: (donnees.etatsDesLieux || []).filter((e) => (e.bienId ? e.bienId === bienId : bailIds.has(e.bailId))),
    regularisations: (donnees.regularisations || []).filter((r) => bailIds.has(r.bailId)),
  };
}

/** Le logement d'un bail. */
export const bienDuBail = (donnees, bail) => (donnees.biens || []).find((b) => b.id === bail?.bienId) || null;

/** Le logement d'un état des lieux : celui noté dessus, sinon celui de son bail. */
export function bienDeEdl(donnees, edl) {
  if (edl?.bienId) return (donnees.biens || []).find((b) => b.id === edl.bienId) || null;
  return bienDuBail(donnees, (donnees.baux || []).find((b) => b.id === edl?.bailId));
}

// -------------------------------------------------------------------- séjours

/** Nombre de nuits entre deux dates ISO (arrivée incluse, départ exclu). */
export function nuitsEntre(arrivee, depart) {
  const a = Date.parse(`${String(arrivee || '').slice(0, 10)}T12:00:00Z`);
  const d = Date.parse(`${String(depart || '').slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(d)) return 0;
  return Math.max(0, Math.round((d - a) / 86400000));
}

/**
 * Un séjour se range dans la collection « loyers » (même circuit d'encaissement
 * et de sauvegarde que les échéances), marqué `sejour: true` et rattaché au
 * logement plutôt qu'à un bail.
 */
export function gabaritSejour(bienId, saisie = {}, existant = {}) {
  const arrivee = String(saisie.arrivee || existant.arrivee || '').slice(0, 10);
  const montant = Number(saisie.montant ?? existant.montant) || 0;
  return {
    id: existant.id,
    sejour: true,
    bienId,
    bailId: '',
    locataireId: '',
    annee: Number(arrivee.slice(0, 4)) || new Date().getFullYear(),
    mois: Number(arrivee.slice(5, 7)) || 1,
    arrivee,
    depart: String(saisie.depart || existant.depart || '').slice(0, 10),
    voyageur: String(saisie.voyageur ?? existant.voyageur ?? '').trim(),
    plateforme: saisie.plateforme || existant.plateforme || PLATEFORMES[0],
    montant,
    // Champs communs aux échéances : le statut (payé, partiel, en retard) et
    // les totaux se calculent avec les mêmes fonctions que les loyers.
    loyerHc: montant,
    charges: 0,
    autres: 0,
    total: montant,
    dateEcheance: arrivee,
    encaissements: existant.encaissements || [],
    notes: String(saisie.notes ?? existant.notes ?? ''),
  };
}

/** Les séjours d'un logement sur une année (par date d'arrivée). */
export function sejoursDe(loyers, bienId, annee) {
  return (loyers || [])
    .filter((l) => l.sejour && l.bienId === bienId && Number(l.annee) === Number(annee))
    .map((l) => ({ ...l, total: Number(l.montant) || 0 }))
    .sort((a, b) => String(a.arrivee).localeCompare(String(b.arrivee)));
}

/** Où en est un séjour par rapport à aujourd'hui. */
export function phaseSejour(sejour, dateReference) {
  if (sejour.depart && sejour.depart <= dateReference) return 'termine';
  if (sejour.arrivee && sejour.arrivee <= dateReference) return 'en-cours';
  return 'a-venir';
}
