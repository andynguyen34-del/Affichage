import { db } from '../db.js';
import { readTable } from './excel.js';
import { pickFile, fileSignature } from './paths.js';
import { coerce, guessType, slug } from './values.js';
import { applyFilters, invalidateDataset } from './query.js';

/**
 * Construit le mapping « colonne Excel -> champ » d'un jeu de donnees.
 * Si aucun mapping n'est configure, toutes les colonnes sont reprises et leur
 * type est devine a partir des premieres lignes.
 */
export function buildMapping(headers, rows, configured = []) {
  const list = Array.isArray(configured) ? configured.filter((m) => m && m.source) : [];

  if (list.length) {
    const used = new Set();
    return list.map((m, i) => {
      let key = slug(m.key || m.source, `champ_${i + 1}`);
      while (used.has(key)) key = `${key}_`;
      used.add(key);
      const index = headers.indexOf(m.source);
      return {
        source: m.source,
        index,
        key,
        label: m.label || m.source,
        type: m.type || 'auto',
      };
    });
  }

  const used = new Set();
  return headers.map((header, index) => {
    let key = slug(header, `col_${index + 1}`);
    while (used.has(key)) key = `${key}_`;
    used.add(key);
    const samples = rows.slice(0, 60).map((r) => r[index]);
    return { source: header, index, key, label: header, type: guessType(samples) };
  });
}

/** Transforme les lignes brutes du tableur en enregistrements typees. */
export function toRecords(mapping, rows) {
  return rows.map((cells) => {
    const record = {};
    for (const m of mapping) {
      const raw = m.index >= 0 ? cells[m.index] : null;
      record[m.key] = coerce(raw, m.type);
    }
    return record;
  });
}

function logImport(entry) {
  db.prepare(
    `INSERT INTO imports (source_id, dataset_id, label, started_at, duration_ms, status, message, row_count, file_name)
     VALUES (@source_id, @dataset_id, @label, @started_at, @duration_ms, @status, @message, @row_count, @file_name)`,
  ).run({
    source_id: null,
    dataset_id: null,
    label: null,
    duration_ms: null,
    message: null,
    row_count: null,
    file_name: null,
    ...entry,
  });
}

const replaceRows = db.transaction((datasetId, records, fields) => {
  db.prepare('DELETE FROM dataset_rows WHERE dataset_id = ?').run(datasetId);
  const insert = db.prepare(
    'INSERT INTO dataset_rows (dataset_id, row_index, data) VALUES (?, ?, ?)',
  );
  records.forEach((record, i) => insert.run(datasetId, i, JSON.stringify(record)));
  db.prepare(
    `UPDATE datasets
        SET row_count = ?, fields = ?, last_import_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(records.length, JSON.stringify(fields), datasetId);
});

/** Importe un seul jeu de donnees depuis un fichier deja resolu. */
export async function importDataset(dataset, file) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const { headers, rows } = await readTable({
      filePath: file.path,
      sheet: dataset.sheet,
      headerRow: dataset.header_row,
      skipRows: dataset.skip_rows,
    });

    const mapping = buildMapping(headers, rows, JSON.parse(dataset.mapping || '[]'));
    const missing = mapping.filter((m) => m.index < 0).map((m) => m.source);
    let records = toRecords(mapping, rows);
    records = applyFilters(records, JSON.parse(dataset.filters || '[]'));

    const fields = mapping.map((m) => ({ key: m.key, label: m.label, type: m.type }));
    replaceRows(dataset.id, records, fields);
    invalidateDataset(dataset.id);

    const message = missing.length
      ? `Colonnes absentes du fichier, ignorees : ${missing.join(', ')}`
      : null;

    logImport({
      source_id: dataset.source_id,
      dataset_id: dataset.id,
      label: dataset.name,
      started_at: startedAt,
      duration_ms: Date.now() - t0,
      status: missing.length ? 'avertissement' : 'ok',
      message,
      row_count: records.length,
      file_name: file.name,
    });

    return { ok: true, rowCount: records.length, fields, missing, message };
  } catch (err) {
    logImport({
      source_id: dataset.source_id,
      dataset_id: dataset.id,
      label: dataset.name,
      started_at: startedAt,
      duration_ms: Date.now() - t0,
      status: 'erreur',
      message: err.message,
      file_name: file?.name || null,
    });
    return { ok: false, error: err.message };
  }
}

/**
 * Importe tous les jeux de donnees d'une source.
 * `force` ignore la detection de changement (bouton « Importer maintenant »).
 */
export async function importSource(sourceId, { force = false } = {}) {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) return { ok: false, error: 'Source introuvable' };

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  let file;
  try {
    file = await pickFile(source);
  } catch (err) {
    db.prepare(
      `UPDATE sources SET last_run_at = datetime('now'), last_status = 'erreur', last_message = ?
        WHERE id = ?`,
    ).run(err.message, sourceId);
    logImport({
      source_id: sourceId,
      label: source.name,
      started_at: startedAt,
      duration_ms: Date.now() - t0,
      status: 'erreur',
      message: err.message,
    });
    return { ok: false, error: err.message };
  }

  if (!file) {
    const message = `Aucun fichier « ${source.pattern} » dans le dossier « ${source.folder || '/'} ».`;
    db.prepare(
      `UPDATE sources SET last_run_at = datetime('now'), last_status = 'erreur', last_message = ?
        WHERE id = ?`,
    ).run(message, sourceId);
    logImport({
      source_id: sourceId,
      label: source.name,
      started_at: startedAt,
      duration_ms: Date.now() - t0,
      status: 'erreur',
      message,
    });
    return { ok: false, error: message };
  }

  const signature = fileSignature(file);
  if (!force && signature === source.last_signature) {
    db.prepare(
      `UPDATE sources SET last_run_at = datetime('now'), last_status = 'inchange',
              last_message = 'Fichier inchange depuis le dernier import.', last_file = ?
        WHERE id = ?`,
    ).run(file.name, sourceId);
    return { ok: true, skipped: true, file: file.name };
  }

  const datasets = db
    .prepare('SELECT * FROM datasets WHERE source_id = ? AND enabled = 1 ORDER BY id')
    .all(sourceId);

  const results = [];
  for (const dataset of datasets) {
    results.push({ dataset: dataset.name, ...(await importDataset(dataset, file)) });
  }

  const failed = results.filter((r) => !r.ok);
  const totalRows = results.reduce((acc, r) => acc + (r.rowCount || 0), 0);
  const status = failed.length ? 'erreur' : datasets.length ? 'ok' : 'inchange';
  const message = failed.length
    ? failed.map((r) => `${r.dataset} : ${r.error}`).join(' | ')
    : datasets.length
      ? `${datasets.length} jeu(x) de donnees, ${totalRows} ligne(s) importee(s).`
      : 'Aucun jeu de donnees actif rattache a cette source.';

  db.prepare(
    `UPDATE sources
        SET last_run_at = datetime('now'), last_status = ?, last_message = ?,
            last_signature = ?, last_file = ?
      WHERE id = ?`,
  ).run(status, message, failed.length ? source.last_signature : signature, file.name, sourceId);

  logImport({
    source_id: sourceId,
    label: source.name,
    started_at: startedAt,
    duration_ms: Date.now() - t0,
    status,
    message,
    row_count: totalRows,
    file_name: file.name,
  });

  return { ok: !failed.length, file: file.name, results, message };
}
