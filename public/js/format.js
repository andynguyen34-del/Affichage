// Mise en forme des valeurs, en francais.

const cacheNombre = new Map();

function formateur(decimals) {
  if (!cacheNombre.has(decimals)) {
    cacheNombre.set(
      decimals,
      new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    );
  }
  return cacheNombre.get(decimals);
}

export function nombre(valeur, decimals = 0) {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const n = Number(valeur);
  if (!Number.isFinite(n)) return String(valeur);
  return formateur(Math.max(0, Math.min(6, Number(decimals) || 0))).format(n);
}

/** Abrege les grands nombres pour ne pas deborder d'une tuile : 12 400 -> 12,4 k */
export function nombreCompact(valeur, decimals = 0) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return nombre(valeur, decimals);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${nombre(n / 1_000_000, 1)} M`;
  if (abs >= 100_000) return `${nombre(n / 1000, 0)} k`;
  return nombre(n, decimals);
}

export function pourcentage(valeur, decimals = 0) {
  if (valeur === null || valeur === undefined) return '—';
  return `${nombre(Number(valeur) * 100, decimals)} %`;
}

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });
const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const HORODATAGE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function dateLongue(d = new Date()) {
  return DATE_LONGUE.format(d);
}
export function dateCourte(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v ?? '') : DATE_COURTE.format(d);
}
export function heure(d = new Date()) {
  return HEURE.format(d);
}
export function horodatage(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? String(v) : HORODATAGE.format(d);
}

/** « il y a 3 min », utilise dans le bandeau des ecrans et le journal. */
export function depuis(v) {
  if (!v) return 'jamais';
  const d = v instanceof Date ? v : new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(v);
  const secondes = Math.round((Date.now() - d.getTime()) / 1000);
  if (secondes < 60) return "a l'instant";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} j`;
}

/** Detecte si une valeur de cellule doit s'afficher alignee a droite. */
export function estNombre(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function valeurCellule(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') return dateCourte(v);
  if (typeof v === 'number') return nombre(v, Number.isInteger(v) ? 0 : 2);
  return String(v);
}
