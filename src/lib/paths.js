import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';

/**
 * Convertit un chemin saisi dans l'interface en chemin absolu, en garantissant
 * qu'il reste sous SOURCE_ROOT. Accepte les separateurs Windows et les chemins
 * UNC copies-colles depuis l'explorateur.
 */
export function resolveInsideRoot(relative = '') {
  const cleaned = String(relative).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const abs = path.resolve(config.sourceRoot, cleaned);
  const root = config.sourceRoot.endsWith(path.sep)
    ? config.sourceRoot
    : config.sourceRoot + path.sep;
  if (abs !== config.sourceRoot && !abs.startsWith(root)) {
    throw new Error(
      `Chemin refuse : « ${relative} » sort du dossier autorise (${config.sourceRoot}).`,
    );
  }
  return abs;
}

/** Traduit un motif type « Production_*.xlsx » en expression reguliere. */
export function patternToRegExp(pattern) {
  const escaped = String(pattern || '*')
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

const READABLE = /\.(xlsx|xlsm|csv|txt)$/i;

/**
 * Liste les fichiers d'un dossier correspondant au motif, tries selon `pick`.
 * Les fichiers temporaires d'Excel (~$Classeur.xlsx) sont ignores.
 */
export async function listCandidates({ folder, pattern, pick = 'latest' }) {
  const dir = resolveInsideRoot(folder);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Dossier introuvable : ${dir}`);
    if (err.code === 'EACCES') throw new Error(`Acces refuse au dossier : ${dir}`);
    throw err;
  }

  const rx = patternToRegExp(pattern);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('~$')) continue;
    if (!rx.test(entry.name)) continue;
    if (!READABLE.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    files.push({ name: entry.name, path: full, mtime: stat.mtimeMs, size: stat.size });
  }

  if (pick === 'name_asc') files.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  else if (pick === 'name_desc') files.sort((a, b) => b.name.localeCompare(a.name, 'fr'));
  else files.sort((a, b) => b.mtime - a.mtime);

  return files;
}

/** Retourne le fichier retenu pour une source, ou null si le dossier est vide. */
export async function pickFile(source) {
  const files = await listCandidates(source);
  return files[0] || null;
}

export function fileSignature(file) {
  return file ? `${file.name}:${Math.round(file.mtime)}:${file.size}` : '';
}
