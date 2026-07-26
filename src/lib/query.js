import { db } from '../db.js';
import { toNumber, toDate, isoDay } from './values.js';

/**
 * Moteur de requetes applique aux lignes importees.
 *
 * Les jeux de donnees issus de fichiers Excel restent petits (quelques milliers
 * de lignes) : on les charge en memoire et on agrege en JavaScript. C'est plus
 * simple a maintenir que du SQL genere, et cela permet de reutiliser exactement
 * les memes regles de conversion qu'a l'import.
 */

const cache = new Map(); // datasetId -> { stamp, rows }

export function invalidateDataset(datasetId) {
  cache.delete(Number(datasetId));
}

export function invalidateAll() {
  cache.clear();
}

function loadRows(dataset) {
  const stamp = `${dataset.last_import_at}|${dataset.row_count}`;
  const hit = cache.get(dataset.id);
  if (hit && hit.stamp === stamp) return hit.rows;

  const rows = db
    .prepare('SELECT data FROM dataset_rows WHERE dataset_id = ? ORDER BY row_index')
    .all(dataset.id)
    .map((r) => JSON.parse(r.data));

  cache.set(dataset.id, { stamp, rows });
  return rows;
}

export function findDataset(ref) {
  if (ref === null || ref === undefined || ref === '') return null;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    return db.prepare('SELECT * FROM datasets WHERE id = ?').get(Number(ref)) || null;
  }
  return db.prepare('SELECT * FROM datasets WHERE key = ?').get(String(ref)) || null;
}

// --- Filtres ---------------------------------------------------------------

const OPS = {
  eq: 'est egal a',
  ne: 'est different de',
  gt: 'est superieur a',
  gte: 'est superieur ou egal a',
  lt: 'est inferieur a',
  lte: 'est inferieur ou egal a',
  contains: 'contient',
  starts: 'commence par',
  in: 'fait partie de',
  not_in: 'ne fait pas partie de',
  empty: 'est vide',
  not_empty: 'est renseigne',
  between: 'est compris entre',
  last_days: 'date dans les N derniers jours',
  this_month: 'date dans le mois en cours',
  this_year: 'date dans l annee en cours',
};

export const FILTER_OPS = OPS;

function splitList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim());
  return String(value ?? '')
    .split(/[;,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function matchFilter(row, filter) {
  const raw = row[filter.field];
  const op = filter.op || 'eq';

  switch (op) {
    case 'empty':
      return raw === null || raw === undefined || raw === '';
    case 'not_empty':
      return !(raw === null || raw === undefined || raw === '');
    case 'contains':
      return norm(raw).includes(norm(filter.value));
    case 'starts':
      return norm(raw).startsWith(norm(filter.value));
    case 'in':
      return splitList(filter.value).some((v) => norm(v) === norm(raw));
    case 'not_in':
      return !splitList(filter.value).some((v) => norm(v) === norm(raw));
    case 'between': {
      const [a, b] = splitList(filter.value);
      const n = toNumber(raw);
      if (n !== null && toNumber(a) !== null) return n >= toNumber(a) && n <= toNumber(b);
      const d = toDate(raw);
      return d !== null && d >= String(a) && d <= String(b);
    }
    case 'last_days': {
      const days = toNumber(filter.value) ?? 7;
      const d = toDate(raw);
      if (!d) return false;
      const limit = isoDay(new Date(Date.now() - days * 86400000));
      return d >= limit;
    }
    case 'this_month': {
      const d = toDate(raw);
      return !!d && d.slice(0, 7) === new Date().toISOString().slice(0, 7);
    }
    case 'this_year': {
      const d = toDate(raw);
      return !!d && d.slice(0, 4) === String(new Date().getFullYear());
    }
    default: {
      const n = toNumber(raw);
      const target = toNumber(filter.value);
      if (n !== null && target !== null) {
        if (op === 'eq') return n === target;
        if (op === 'ne') return n !== target;
        if (op === 'gt') return n > target;
        if (op === 'gte') return n >= target;
        if (op === 'lt') return n < target;
        if (op === 'lte') return n <= target;
      }
      const a = norm(raw);
      const b = norm(filter.value);
      if (op === 'eq') return a === b;
      if (op === 'ne') return a !== b;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      return true;
    }
  }
}

export function applyFilters(rows, filters = []) {
  const active = (filters || []).filter((f) => f && f.field);
  if (!active.length) return rows;
  return rows.filter((row) => active.every((f) => matchFilter(row, f)));
}

// --- Agregations -----------------------------------------------------------

export const AGGREGATIONS = {
  sum: 'Somme',
  avg: 'Moyenne',
  count: 'Nombre de lignes',
  count_distinct: 'Nombre de valeurs distinctes',
  min: 'Minimum',
  max: 'Maximum',
  last: 'Derniere valeur',
  first: 'Premiere valeur',
};

function aggregate(rows, agg, field) {
  if (agg === 'count') return rows.length;

  if (agg === 'count_distinct') {
    const set = new Set();
    for (const r of rows) {
      const v = r[field];
      if (v !== null && v !== undefined && v !== '') set.add(String(v));
    }
    return set.size;
  }

  if (agg === 'last' || agg === 'first') {
    const list = agg === 'last' ? [...rows].reverse() : rows;
    for (const r of list) {
      const v = r[field];
      if (v !== null && v !== undefined && v !== '') return toNumber(v) ?? v;
    }
    return null;
  }

  const numbers = [];
  for (const r of rows) {
    const n = toNumber(r[field]);
    if (n !== null) numbers.push(n);
  }
  if (!numbers.length) return agg === 'sum' ? 0 : null;

  switch (agg) {
    case 'avg':
      return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    default:
      return numbers.reduce((a, b) => a + b, 0);
  }
}

// --- Requete ---------------------------------------------------------------

const DEFAULT_METRIC = { agg: 'sum', field: '', label: 'Valeur' };

/**
 * @param {object} q
 * @param {string|number} q.dataset  cle ou identifiant du jeu de donnees
 * @param {Array}  [q.filters]
 * @param {string} [q.groupBy]       champ de regroupement (axe des categories)
 * @param {Array}  [q.metrics]       [{agg, field, label}]
 * @param {object} [q.sort]          {by:'value'|'label'|'none', dir:'asc'|'desc'}
 * @param {number} [q.limit]
 * @param {boolean}[q.cumulative]    ajoute le cumul en % (Pareto)
 * @param {boolean}[q.others]        regroupe le reste dans « Autres » quand limit est atteint
 */
export function runQuery(q = {}) {
  const dataset = findDataset(q.dataset);
  if (!dataset) {
    return { error: 'Jeu de donnees introuvable', rows: [], metrics: [], total: {} };
  }

  const all = loadRows(dataset);
  const filtered = applyFilters(all, q.filters);

  const metrics = (Array.isArray(q.metrics) && q.metrics.length ? q.metrics : [DEFAULT_METRIC]).map(
    (m, i) => ({
      key: `m${i}`,
      agg: m.agg || 'sum',
      field: m.field || '',
      label: m.label || m.field || AGGREGATIONS[m.agg || 'sum'],
    }),
  );

  const total = {};
  for (const m of metrics) total[m.key] = aggregate(filtered, m.agg, m.field);

  let rows = [];
  if (q.groupBy) {
    const groups = new Map();
    for (const r of filtered) {
      const raw = r[q.groupBy];
      const label = raw === null || raw === undefined || raw === '' ? '(non renseigne)' : String(raw);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(r);
    }
    rows = [...groups.entries()].map(([label, groupRows]) => {
      const values = {};
      for (const m of metrics) values[m.key] = aggregate(groupRows, m.agg, m.field);
      return { label, values, count: groupRows.length };
    });

    const sortBy = q.sort?.by || 'value';
    const dir = q.sort?.dir === 'asc' ? 1 : -1;
    if (sortBy === 'label') {
      rows.sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }) * dir);
    } else if (sortBy === 'value') {
      rows.sort((a, b) => ((a.values.m0 ?? 0) - (b.values.m0 ?? 0)) * dir);
    }

    const limit = Number(q.limit) || 0;
    if (limit > 0 && rows.length > limit) {
      const kept = rows.slice(0, limit);
      if (q.others) {
        const rest = rows.slice(limit);
        const values = {};
        for (const m of metrics) {
          values[m.key] = rest.reduce((acc, r) => acc + (toNumber(r.values[m.key]) ?? 0), 0);
        }
        kept.push({ label: `Autres (${rest.length})`, values, count: rest.length });
      }
      rows = kept;
    }

    if (q.cumulative) {
      const sum = rows.reduce((acc, r) => acc + (toNumber(r.values.m0) ?? 0), 0);
      let running = 0;
      for (const r of rows) {
        running += toNumber(r.values.m0) ?? 0;
        r.cumulative = sum ? running / sum : 0;
      }
    }
  }

  return {
    dataset: { id: dataset.id, key: dataset.key, name: dataset.name },
    metrics,
    groupBy: q.groupBy || null,
    rows,
    total,
    rowCount: filtered.length,
    sourceRowCount: all.length,
    lastImportAt: dataset.last_import_at,
  };
}

/** Renvoie les lignes brutes (widget « tableau »). */
export function runRawQuery(q = {}) {
  const dataset = findDataset(q.dataset);
  if (!dataset) return { error: 'Jeu de donnees introuvable', columns: [], rows: [] };

  const fields = JSON.parse(dataset.fields || '[]');
  const wanted =
    Array.isArray(q.columns) && q.columns.length ? q.columns : fields.map((f) => f.key);

  let rows = applyFilters(loadRows(dataset), q.filters);

  if (q.sortField) {
    const dir = q.sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const na = toNumber(a[q.sortField]);
      const nb = toNumber(b[q.sortField]);
      if (na !== null && nb !== null) return (na - nb) * dir;
      return String(a[q.sortField] ?? '').localeCompare(String(b[q.sortField] ?? ''), 'fr') * dir;
    });
  }

  const limit = Number(q.limit) || 20;
  const columns = wanted.map((key) => {
    const f = fields.find((x) => x.key === key);
    return { key, label: f ? f.label : key, type: f ? f.type : 'text' };
  });

  return {
    dataset: { id: dataset.id, key: dataset.key, name: dataset.name },
    columns,
    rows: rows.slice(0, limit).map((r) => wanted.map((k) => r[k] ?? null)),
    rowCount: rows.length,
    lastImportAt: dataset.last_import_at,
  };
}

/** Valeurs distinctes d'un champ (aide a la saisie des filtres). */
export function distinctValues(datasetRef, field, limit = 50) {
  const dataset = findDataset(datasetRef);
  if (!dataset) return [];
  const set = new Set();
  for (const row of loadRows(dataset)) {
    const v = row[field];
    if (v !== null && v !== undefined && v !== '') set.add(String(v));
    if (set.size >= limit) break;
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
}
