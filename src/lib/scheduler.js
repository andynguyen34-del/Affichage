import { db, trimImportLog } from '../db.js';
import { config } from '../config.js';
import { importSource } from './importer.js';

let timer = null;
let running = false;

/** Une source est due si elle n'a jamais tourne ou si son delai est ecoule. */
function dueSources() {
  return db
    .prepare(
      `SELECT * FROM sources
        WHERE enabled = 1
          AND (last_run_at IS NULL
               OR datetime(last_run_at, '+' || MAX(refresh_minutes, 1) || ' minutes') <= datetime('now'))
        ORDER BY id`,
    )
    .all();
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    for (const source of dueSources()) {
      try {
        const result = await importSource(source.id);
        if (!result.skipped) {
          console.log(
            `[planificateur] source « ${source.name} » : ${result.ok ? 'ok' : 'erreur'} — ${result.message || result.error || ''}`,
          );
        }
      } catch (err) {
        console.error(`[planificateur] source « ${source.name} » a echoue :`, err.message);
      }
    }
    trimImportLog();
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const seconds = Math.max(10, config.schedulerTickSeconds);
  // Premier passage au demarrage pour que les ecrans aient des donnees vite.
  setTimeout(() => { tick().catch((e) => console.error(e)); }, 3000);
  timer = setInterval(() => { tick().catch((e) => console.error(e)); }, seconds * 1000);
  timer.unref?.();
  console.log(`[planificateur] demarre, verification toutes les ${seconds} s`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
