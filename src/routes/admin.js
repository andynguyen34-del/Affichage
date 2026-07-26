import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { listCandidates, resolveInsideRoot, pickFile } from '../lib/paths.js';
import { listSheets, readTable } from '../lib/excel.js';
import { buildMapping, toRecords, importSource, importDataset } from '../lib/importer.js';
import {
  runQuery,
  runRawQuery,
  distinctValues,
  AGGREGATIONS,
  FILTER_OPS,
  invalidateDataset,
} from '../lib/query.js';
import { evaluateIndicator, resolveView, buildScreenPayload } from '../lib/render.js';
import { slugUrl } from '../lib/values.js';
import { tick } from '../lib/scheduler.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

// --- Utilitaires -----------------------------------------------------------

function fail(res, err, code = 400) {
  return res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
}

/** Genere une cle unique et stable pour une table donnee. */
function uniqueKey(table, proposed, fallback, currentId = null) {
  const base = slugUrl(proposed || fallback, fallback);
  let key = base;
  let i = 2;
  for (;;) {
    const row = db.prepare(`SELECT id FROM ${table} WHERE key = ?`).get(key);
    if (!row || row.id === currentId) return key;
    key = `${base}_${i}`;
    i += 1;
  }
}

function jsonColumn(value, fallback = '[]') {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseRow(row, jsonFields) {
  if (!row) return row;
  const out = { ...row };
  for (const field of jsonFields) {
    try {
      out[field] = JSON.parse(row[field] ?? '[]');
    } catch {
      out[field] = [];
    }
  }
  return out;
}

// --- Explorateur de fichiers ----------------------------------------------

adminRouter.get('/browse', async (req, res) => {
  try {
    const folder = String(req.query.folder || '');
    const dir = resolveInsideRoot(folder);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const folders = [];
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('~$') || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        folders.push(entry.name);
      } else if (/\.(xlsx|xlsm|csv|txt)$/i.test(entry.name)) {
        const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
        files.push({
          name: entry.name,
          size: stat?.size ?? 0,
          modifiedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
        });
      }
    }
    folders.sort((a, b) => a.localeCompare(b, 'fr'));
    files.sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
    res.json({ root: config.sourceRoot, folder, folders, files });
  } catch (err) {
    fail(res, err);
  }
});

/** Apercu d'un fichier : feuilles disponibles, en-tetes, 20 premieres lignes. */
adminRouter.get('/preview', async (req, res) => {
  try {
    const { folder = '', pattern = '*.xlsx', pick = 'latest' } = req.query;
    const file = await pickFile({ folder, pattern, pick });
    if (!file) return fail(res, `Aucun fichier « ${pattern} » trouve dans « ${folder || '/'} ».`);

    const sheets = await listSheets(file.path);
    const { headers, rows } = await readTable({
      filePath: file.path,
      sheet: req.query.sheet || '',
      headerRow: Number(req.query.headerRow) || 1,
      skipRows: Number(req.query.skipRows) || 0,
      maxRows: 20,
    });
    const mapping = buildMapping(headers, rows, []);

    res.json({
      file: { name: file.name, modifiedAt: new Date(file.mtime).toISOString(), size: file.size },
      sheets,
      headers,
      rows: rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString() : c))),
      mapping,
    });
  } catch (err) {
    fail(res, err);
  }
});

// --- Sources ---------------------------------------------------------------

const SOURCE_FIELDS = ['name', 'folder', 'pattern', 'pick', 'refresh_minutes', 'enabled'];

adminRouter.get('/sources', (req, res) => {
  const sources = db.prepare('SELECT * FROM sources ORDER BY name').all();
  const counts = db
    .prepare('SELECT source_id, COUNT(*) AS n FROM datasets GROUP BY source_id')
    .all();
  const byId = Object.fromEntries(counts.map((c) => [c.source_id, c.n]));
  res.json(sources.map((s) => ({ ...s, datasetCount: byId[s.id] || 0 })));
});

adminRouter.post('/sources', (req, res) => {
  try {
    const b = req.body || {};
    const info = db
      .prepare(
        `INSERT INTO sources (name, folder, pattern, pick, refresh_minutes, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.name || 'Nouvelle source',
        b.folder || '',
        b.pattern || '*.xlsx',
        b.pick || 'latest',
        Number(b.refresh_minutes) || 15,
        b.enabled === false ? 0 : 1,
      );
    res.json(db.prepare('SELECT * FROM sources WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.put('/sources/:id', (req, res) => {
  try {
    const b = req.body || {};
    const current = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!current) return fail(res, 'Source introuvable', 404);
    const next = {};
    for (const f of SOURCE_FIELDS) next[f] = b[f] === undefined ? current[f] : b[f];
    next.enabled = next.enabled ? 1 : 0;
    next.refresh_minutes = Number(next.refresh_minutes) || 15;
    db.prepare(
      `UPDATE sources SET name=@name, folder=@folder, pattern=@pattern, pick=@pick,
              refresh_minutes=@refresh_minutes, enabled=@enabled, updated_at=datetime('now')
        WHERE id=@id`,
    ).run({ ...next, id: current.id });
    res.json(db.prepare('SELECT * FROM sources WHERE id = ?').get(current.id));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.delete('/sources/:id', (req, res) => {
  db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

adminRouter.post('/sources/:id/import', async (req, res) => {
  const result = await importSource(Number(req.params.id), { force: true });
  res.json(result);
});

adminRouter.get('/sources/:id/files', async (req, res) => {
  try {
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!source) return fail(res, 'Source introuvable', 404);
    const files = await listCandidates(source);
    res.json(
      files.map((f) => ({
        name: f.name,
        size: f.size,
        modifiedAt: new Date(f.mtime).toISOString(),
      })),
    );
  } catch (err) {
    fail(res, err);
  }
});

// --- Jeux de donnees -------------------------------------------------------

adminRouter.get('/datasets', (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS source_name, s.folder AS source_folder, s.pattern AS source_pattern
         FROM datasets d LEFT JOIN sources s ON s.id = d.source_id
        ORDER BY d.name`,
    )
    .all();
  res.json(rows.map((r) => parseRow(r, ['mapping', 'filters', 'fields'])));
});

adminRouter.get('/datasets/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'Jeu de donnees introuvable', 404);
  res.json(parseRow(row, ['mapping', 'filters', 'fields']));
});

adminRouter.post('/datasets', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.source_id) return fail(res, 'Une source est obligatoire.');
    const key = uniqueKey('datasets', b.key || b.name, 'jeu_de_donnees');
    const info = db
      .prepare(
        `INSERT INTO datasets (source_id, key, name, sheet, header_row, skip_rows, mapping, filters, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Number(b.source_id),
        key,
        b.name || 'Nouveau jeu de donnees',
        b.sheet || '',
        Number(b.header_row) || 1,
        Number(b.skip_rows) || 0,
        jsonColumn(b.mapping),
        jsonColumn(b.filters),
        b.enabled === false ? 0 : 1,
      );
    res.json(db.prepare('SELECT * FROM datasets WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.put('/datasets/:id', (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
    if (!current) return fail(res, 'Jeu de donnees introuvable', 404);
    const b = req.body || {};
    const next = {
      id: current.id,
      source_id: b.source_id === undefined ? current.source_id : Number(b.source_id),
      key: b.key ? uniqueKey('datasets', b.key, current.key, current.id) : current.key,
      name: b.name === undefined ? current.name : b.name,
      sheet: b.sheet === undefined ? current.sheet : b.sheet,
      header_row: b.header_row === undefined ? current.header_row : Number(b.header_row) || 1,
      skip_rows: b.skip_rows === undefined ? current.skip_rows : Number(b.skip_rows) || 0,
      mapping: b.mapping === undefined ? current.mapping : jsonColumn(b.mapping),
      filters: b.filters === undefined ? current.filters : jsonColumn(b.filters),
      enabled: (b.enabled === undefined ? current.enabled : b.enabled) ? 1 : 0,
    };
    db.prepare(
      `UPDATE datasets SET source_id=@source_id, key=@key, name=@name, sheet=@sheet,
              header_row=@header_row, skip_rows=@skip_rows, mapping=@mapping, filters=@filters,
              enabled=@enabled, updated_at=datetime('now')
        WHERE id=@id`,
    ).run(next);
    invalidateDataset(current.id);
    res.json(db.prepare('SELECT * FROM datasets WHERE id = ?').get(current.id));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.delete('/datasets/:id', (req, res) => {
  db.prepare('DELETE FROM datasets WHERE id = ?').run(req.params.id);
  invalidateDataset(req.params.id);
  res.json({ ok: true });
});

adminRouter.post('/datasets/:id/import', async (req, res) => {
  try {
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
    if (!dataset) return fail(res, 'Jeu de donnees introuvable', 404);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(dataset.source_id);
    if (!source) return fail(res, 'Source introuvable', 404);
    const file = await pickFile(source);
    if (!file) return fail(res, `Aucun fichier « ${source.pattern} » dans « ${source.folder || '/'} ».`);
    const result = await importDataset(dataset, file);
    res.json({ ...result, file: file.name });
  } catch (err) {
    fail(res, err);
  }
});

/** Apercu du resultat d'un jeu de donnees, avec le mapping courant applique. */
adminRouter.get('/datasets/:id/preview', async (req, res) => {
  try {
    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
    if (!dataset) return fail(res, 'Jeu de donnees introuvable', 404);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(dataset.source_id);
    const file = await pickFile(source);
    if (!file) return fail(res, 'Fichier source introuvable.');

    const { headers, rows } = await readTable({
      filePath: file.path,
      sheet: dataset.sheet,
      headerRow: dataset.header_row,
      skipRows: dataset.skip_rows,
      maxRows: 25,
    });
    const mapping = buildMapping(headers, rows, JSON.parse(dataset.mapping || '[]'));
    res.json({
      file: file.name,
      headers,
      mapping,
      records: toRecords(mapping, rows),
    });
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.get('/datasets/:id/distinct', (req, res) => {
  res.json(distinctValues(Number(req.params.id), String(req.query.field || '')));
});

// --- Requetes ad hoc (utilise par l'editeur de widgets) --------------------

adminRouter.post('/query', (req, res) => {
  try {
    res.json(req.body?.raw ? runRawQuery(req.body.query || {}) : runQuery(req.body?.query || {}));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.get('/meta', (req, res) => {
  res.json({
    aggregations: AGGREGATIONS,
    filterOps: FILTER_OPS,
    sourceRoot: config.sourceRoot,
  });
});

// --- Indicateurs -----------------------------------------------------------

adminRouter.get('/indicators', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, d.name AS dataset_name FROM indicators i
         LEFT JOIN datasets d ON d.id = i.dataset_id ORDER BY i.name`,
    )
    .all();
  res.json(
    rows.map((r) => ({
      ...parseRow(r, []),
      query: JSON.parse(r.query || '{}'),
      current: (() => {
        try {
          return evaluateIndicator(r);
        } catch (err) {
          return { error: err.message };
        }
      })(),
    })),
  );
});

adminRouter.post('/indicators', (req, res) => {
  try {
    const b = req.body || {};
    const key = uniqueKey('indicators', b.key || b.name, 'indicateur');
    const info = db
      .prepare(
        `INSERT INTO indicators (key, name, dataset_id, query, unit, decimals, target, direction, warn_at, alert_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key,
        b.name || 'Nouvel indicateur',
        b.dataset_id ? Number(b.dataset_id) : null,
        jsonColumn(b.query, '{}'),
        b.unit || '',
        Number(b.decimals) || 0,
        b.target === '' || b.target === undefined ? null : Number(b.target),
        b.direction || 'higher_better',
        b.warn_at === '' || b.warn_at === undefined ? null : Number(b.warn_at),
        b.alert_at === '' || b.alert_at === undefined ? null : Number(b.alert_at),
      );
    res.json(db.prepare('SELECT * FROM indicators WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.put('/indicators/:id', (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM indicators WHERE id = ?').get(req.params.id);
    if (!current) return fail(res, 'Indicateur introuvable', 404);
    const b = req.body || {};
    const num = (v, fb) => (v === '' || v === undefined || v === null ? fb : Number(v));
    const next = {
      id: current.id,
      key: b.key ? uniqueKey('indicators', b.key, current.key, current.id) : current.key,
      name: b.name ?? current.name,
      dataset_id: b.dataset_id === undefined ? current.dataset_id : Number(b.dataset_id) || null,
      query: b.query === undefined ? current.query : jsonColumn(b.query, '{}'),
      unit: b.unit ?? current.unit,
      decimals: num(b.decimals, current.decimals),
      target: b.target === undefined ? current.target : num(b.target, null),
      direction: b.direction ?? current.direction,
      warn_at: b.warn_at === undefined ? current.warn_at : num(b.warn_at, null),
      alert_at: b.alert_at === undefined ? current.alert_at : num(b.alert_at, null),
    };
    db.prepare(
      `UPDATE indicators SET key=@key, name=@name, dataset_id=@dataset_id, query=@query, unit=@unit,
              decimals=@decimals, target=@target, direction=@direction, warn_at=@warn_at,
              alert_at=@alert_at, updated_at=datetime('now')
        WHERE id=@id`,
    ).run(next);
    res.json(db.prepare('SELECT * FROM indicators WHERE id = ?').get(current.id));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.delete('/indicators/:id', (req, res) => {
  db.prepare('DELETE FROM indicators WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Vues ------------------------------------------------------------------

adminRouter.get('/views', (req, res) => {
  const rows = db.prepare('SELECT * FROM views ORDER BY name').all();
  res.json(rows.map((r) => parseRow(r, ['widgets'])));
});

adminRouter.get('/views/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM views WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'Vue introuvable', 404);
  res.json(parseRow(row, ['widgets']));
});

adminRouter.post('/views', (req, res) => {
  try {
    const b = req.body || {};
    const key = uniqueKey('views', b.key || b.name, 'vue');
    const info = db
      .prepare('INSERT INTO views (key, name, widgets, theme, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(
        key,
        b.name || 'Nouvelle vue',
        jsonColumn(b.widgets),
        b.theme || 'sombre',
        b.enabled === false ? 0 : 1,
      );
    res.json(db.prepare('SELECT * FROM views WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.put('/views/:id', (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM views WHERE id = ?').get(req.params.id);
    if (!current) return fail(res, 'Vue introuvable', 404);
    const b = req.body || {};
    const next = {
      id: current.id,
      key: b.key ? uniqueKey('views', b.key, current.key, current.id) : current.key,
      name: b.name ?? current.name,
      widgets: b.widgets === undefined ? current.widgets : jsonColumn(b.widgets),
      theme: b.theme ?? current.theme,
      enabled: (b.enabled === undefined ? current.enabled : b.enabled) ? 1 : 0,
    };
    db.prepare(
      `UPDATE views SET key=@key, name=@name, widgets=@widgets, theme=@theme, enabled=@enabled,
              updated_at=datetime('now') WHERE id=@id`,
    ).run(next);
    res.json(db.prepare('SELECT * FROM views WHERE id = ?').get(current.id));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.delete('/views/:id', (req, res) => {
  db.prepare('DELETE FROM views WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Rendu complet d'une vue (utilise par l'apercu de l'editeur). */
adminRouter.get('/views/:id/resolved', (req, res) => {
  const view = db.prepare('SELECT * FROM views WHERE id = ?').get(req.params.id);
  if (!view) return fail(res, 'Vue introuvable', 404);
  res.json(resolveView(view));
});

// --- Ecrans ----------------------------------------------------------------

adminRouter.get('/screens', (req, res) => {
  const rows = db.prepare('SELECT * FROM screens ORDER BY name').all();
  res.json(rows.map((r) => parseRow(r, ['playlist'])));
});

adminRouter.post('/screens', (req, res) => {
  try {
    const b = req.body || {};
    const key = uniqueKey('screens', b.key || b.name, 'ecran');
    const info = db
      .prepare(
        `INSERT INTO screens (key, name, location, playlist, refresh_seconds, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key,
        b.name || 'Nouvel ecran',
        b.location || '',
        jsonColumn(b.playlist),
        Number(b.refresh_seconds) || 30,
        b.enabled === false ? 0 : 1,
      );
    res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.put('/screens/:id', (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
    if (!current) return fail(res, 'Ecran introuvable', 404);
    const b = req.body || {};
    const next = {
      id: current.id,
      key: b.key ? uniqueKey('screens', b.key, current.key, current.id) : current.key,
      name: b.name ?? current.name,
      location: b.location ?? current.location,
      playlist: b.playlist === undefined ? current.playlist : jsonColumn(b.playlist),
      refresh_seconds:
        b.refresh_seconds === undefined
          ? current.refresh_seconds
          : Number(b.refresh_seconds) || 30,
      enabled: (b.enabled === undefined ? current.enabled : b.enabled) ? 1 : 0,
    };
    db.prepare(
      `UPDATE screens SET key=@key, name=@name, location=@location, playlist=@playlist,
              refresh_seconds=@refresh_seconds, enabled=@enabled, updated_at=datetime('now')
        WHERE id=@id`,
    ).run(next);
    res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(current.id));
  } catch (err) {
    fail(res, err);
  }
});

adminRouter.delete('/screens/:id', (req, res) => {
  db.prepare('DELETE FROM screens WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

adminRouter.get('/screens/:id/payload', (req, res) => {
  const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!screen) return fail(res, 'Ecran introuvable', 404);
  res.json(buildScreenPayload(screen));
});

// --- Journal et maintenance ------------------------------------------------

adminRouter.get('/imports', (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json(db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT ?').all(limit));
});

adminRouter.post('/refresh-all', async (req, res) => {
  const sources = db.prepare('SELECT id, name FROM sources WHERE enabled = 1').all();
  const results = [];
  for (const s of sources) {
    results.push({ source: s.name, ...(await importSource(s.id, { force: true })) });
  }
  res.json({ ok: true, results });
});

adminRouter.post('/scheduler/tick', async (req, res) => {
  await tick();
  res.json({ ok: true });
});

adminRouter.get('/settings', (req, res) => {
  res.json({
    site_title: getSetting('site_title', "Indicateurs de l'usine"),
    logo_text: getSetting('logo_text', ''),
    sourceRoot: config.sourceRoot,
    timezone: config.timezone,
    schedulerTickSeconds: config.schedulerTickSeconds,
  });
});

adminRouter.post('/settings', (req, res) => {
  const b = req.body || {};
  if (b.site_title !== undefined) setSetting('site_title', b.site_title);
  if (b.logo_text !== undefined) setSetting('logo_text', b.logo_text);
  res.json({ ok: true });
});

/** Export complet de la configuration (sauvegarde / recopie sur un autre poste). */
adminRouter.get('/export', (req, res) => {
  const dump = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sources: db.prepare('SELECT * FROM sources').all(),
    datasets: db.prepare('SELECT * FROM datasets').all(),
    indicators: db.prepare('SELECT * FROM indicators').all(),
    views: db.prepare('SELECT * FROM views').all(),
    screens: db.prepare('SELECT * FROM screens').all(),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="affichage-configuration.json"');
  res.json(dump);
});
