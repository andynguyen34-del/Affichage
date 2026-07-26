/** Fonctions de normalisation partagees entre l'import et le moteur de requetes. */

export function slug(input, fallback = 'champ') {
  const base = String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || fallback;
}

/**
 * Variante pour les cles qui apparaissent dans une adresse (/ecran/atelier-1).
 * Le tiret y est plus lisible que le souligne.
 */
export function slugUrl(input, fallback = 'element') {
  return slug(input, fallback).replace(/_/g, '-');
}

/** Identifiant technique sur (utilisable tel quel dans une requete SQL). */
export function safeKey(input) {
  const s = slug(input, '');
  if (!/^[a-z][a-z0-9_]*$/.test(s)) return null;
  return s;
}

// Espaces classiques, insecables, fines insecables, apostrophe de milliers.
const SPACES = /[\s\u00a0\u202f\u2009']/g;

/**
 * Convertit une valeur de cellule en nombre, en tolerant les ecritures
 * francaises : « 1 234,56 », « 45 % », « 12,5 € », « (250) » pour un negatif.
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();

  let text = String(value).replace(SPACES, '');
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  const isPercent = text.includes('%');
  text = text.replace(/[%€$£]/g, '');

  // « 1,234.56 » (anglais) vs « 1.234,56 » (francais)
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma > -1) {
    text = text.replace(',', '.');
  }

  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return sign * (isPercent ? n / 100 : n);
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Convertit une valeur de cellule en date ISO « AAAA-MM-JJ » (ou null). */
export function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isoDay(value);
  if (typeof value === 'number') {
    // Numero de serie Excel (1 = 1900-01-01, plage plausible 1990-2100).
    if (value > 25000 && value < 80000) {
      return isoDay(new Date(EXCEL_EPOCH + Math.round(value) * 86400000));
    }
    return null;
  }
  const text = String(value).trim();

  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = String(Number(y) + (Number(y) > 70 ? 1900 : 2000));
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Pas de repli sur `new Date(texte)` : l'analyseur de JavaScript est trop
  // permissif et transformerait « Ligne 2 » en 1er fevrier 2001. Une chaine qui
  // ne ressemble pas a une date n'en est pas une.
  return null;
}

export function isoDay(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isoDay(value);
  const text = String(value).trim();
  return text === '' ? null : text;
}

// Une chaine n'est convertie en nombre que si elle ne contient que des chiffres,
// des separateurs de milliers/decimales et eventuellement une unite monetaire.
// Le trait d'union interne est exclu : « 07-26 » est une plage, pas un nombre.
const RESSEMBLE_A_UN_NOMBRE = /^\(?[+-]?[\d\s\u00a0\u202f\u2009'.,]+\)?\s*[%€$£]?$/;

/** Applique le type declare dans le mapping d'un jeu de donnees. */
export function coerce(value, type) {
  switch (type) {
    case 'number':
      return toNumber(value);
    case 'date':
      return toDate(value);
    case 'text':
      return toText(value);
    default: {
      // auto : les cellules deja typees par Excel sont reprises telles quelles,
      // les chaines sont testees en date puis en nombre — dans cet ordre, sinon
      // « 2026-07-26 » se lirait comme le nombre 2026.
      if (value instanceof Date) return isoDay(value);
      if (typeof value === 'number') return value;
      const asDate = toDate(value);
      if (asDate !== null) return asDate;
      const asNumber = toNumber(value);
      if (asNumber !== null && RESSEMBLE_A_UN_NOMBRE.test(String(value).trim())) return asNumber;
      return toText(value);
    }
  }
}

/** Devine le type d'une colonne a partir d'un echantillon de valeurs. */
export function guessType(samples) {
  const values = samples.filter((v) => v !== null && v !== undefined && v !== '');
  if (!values.length) return 'text';
  const dates = values.filter((v) => v instanceof Date || (typeof v === 'string' && toDate(v))).length;
  if (dates / values.length > 0.8) return 'date';
  const numbers = values.filter((v) => toNumber(v) !== null).length;
  if (numbers / values.length > 0.8) return 'number';
  return 'text';
}
