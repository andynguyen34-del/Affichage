import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

function envInt(name, fallback) {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt('PORT', 8080),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  /**
   * Racine au-dela de laquelle aucune lecture de fichier n'est autorisee.
   * Toutes les sources sont exprimees en chemins relatifs a cette racine, ce qui
   * evite qu'une configuration mal saisie (ou malveillante) fasse lire /etc.
   */
  sourceRoot: path.resolve(process.env.SOURCE_ROOT || '/partage'),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  sessionSecret: process.env.SESSION_SECRET || 'affichage-secret-par-defaut',
  schedulerTickSeconds: envInt('SCHEDULER_TICK_SECONDS', 60),
  timezone: process.env.TZ || 'Europe/Paris',
  publicDir: path.join(ROOT, 'public'),
};

fs.mkdirSync(config.dataDir, { recursive: true });

export const DB_PATH = path.join(config.dataDir, 'affichage.db');
