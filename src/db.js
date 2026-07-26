import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { DB_PATH, config } from './config.js';

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Une source = un emplacement de fichier Excel sur le partage reseau.
CREATE TABLE IF NOT EXISTS sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  folder          TEXT NOT NULL DEFAULT '',   -- relatif a SOURCE_ROOT
  pattern         TEXT NOT NULL DEFAULT '*.xlsx',
  pick            TEXT NOT NULL DEFAULT 'latest', -- latest | name_asc | name_desc
  refresh_minutes INTEGER NOT NULL DEFAULT 15,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  last_status     TEXT,
  last_message    TEXT,
  last_signature  TEXT,
  last_file       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un jeu de donnees = une feuille d'un classeur + un mapping de colonnes.
CREATE TABLE IF NOT EXISTS datasets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sheet       TEXT NOT NULL DEFAULT '',       -- vide = premiere feuille
  header_row  INTEGER NOT NULL DEFAULT 1,
  skip_rows   INTEGER NOT NULL DEFAULT 0,
  mapping     TEXT NOT NULL DEFAULT '[]',     -- [{source,key,label,type}]
  filters     TEXT NOT NULL DEFAULT '[]',     -- filtres appliques a l'import
  enabled     INTEGER NOT NULL DEFAULT 1,
  row_count   INTEGER NOT NULL DEFAULT 0,
  fields      TEXT NOT NULL DEFAULT '[]',     -- champs detectes au dernier import
  last_import_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_index  INTEGER NOT NULL,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rows_dataset ON dataset_rows(dataset_id);

CREATE TABLE IF NOT EXISTS imports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  INTEGER,
  dataset_id INTEGER,
  label      TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  status     TEXT NOT NULL,   -- ok | erreur | ignore
  message    TEXT,
  row_count  INTEGER,
  file_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_imports_started ON imports(started_at DESC);

-- Indicateur = une requete nommee + un objectif + des seuils.
CREATE TABLE IF NOT EXISTS indicators (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  dataset_id INTEGER REFERENCES datasets(id) ON DELETE SET NULL,
  query      TEXT NOT NULL DEFAULT '{}',
  unit       TEXT NOT NULL DEFAULT '',
  decimals   INTEGER NOT NULL DEFAULT 0,
  target     REAL,
  direction  TEXT NOT NULL DEFAULT 'higher_better', -- higher_better | lower_better
  warn_at    REAL,
  alert_at   REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vue = une page composee de widgets.
CREATE TABLE IF NOT EXISTS views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  widgets    TEXT NOT NULL DEFAULT '[]',
  theme      TEXT NOT NULL DEFAULT 'sombre',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ecran = un poste physique dans l'usine qui deroule une liste de vues.
CREATE TABLE IF NOT EXISTS screens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  location     TEXT NOT NULL DEFAULT '',
  playlist     TEXT NOT NULL DEFAULT '[]',   -- [{view_id, seconds}]
  refresh_seconds INTEGER NOT NULL DEFAULT 30,
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  last_ip      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

/** Cree le mot de passe administrateur au tout premier demarrage. */
export function ensureAdminPassword() {
  if (!getSetting('admin_password_hash')) {
    setSetting('admin_password_hash', bcrypt.hashSync(config.adminPassword, 10));
    setSetting('admin_password_is_default', '1');
  }
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

/** Garde le journal d'import a une taille raisonnable. */
export function trimImportLog(keep = 500) {
  db.prepare(
    `DELETE FROM imports WHERE id NOT IN (
       SELECT id FROM imports ORDER BY id DESC LIMIT ?
     )`,
  ).run(keep);
}
