import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, ROOT } from './config.js';
import { ensureAdminPassword, purgeExpiredSessions, db } from './db.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { displayRouter } from './routes/display.js';
import { startScheduler, stopScheduler } from './lib/scheduler.js';

ensureAdminPassword();
purgeExpiredSessions();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  const sources = db.prepare('SELECT COUNT(*) AS n FROM sources').get().n;
  res.json({ ok: true, sources, uptimeSeconds: Math.round(process.uptime()) });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/display', displayRouter);

// Chart.js est servi depuis node_modules : aucune dependance a Internet, ce qui
// est indispensable sur un reseau d'usine cloisonne.
app.use(
  '/vendor',
  express.static(path.join(ROOT, 'node_modules', 'chart.js', 'dist'), {
    maxAge: '30d',
    immutable: true,
  }),
);

app.use(express.static(config.publicDir, { extensions: ['html'] }));

/** Pages plein ecran destinees aux televiseurs de l'atelier. */
const affichage = path.join(config.publicDir, 'affichage.html');
app.get('/ecran/:key', (req, res) => res.sendFile(affichage));
app.get('/vue/:key', (req, res) => res.sendFile(affichage));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ressource introuvable' });
  return res.status(404).sendFile(path.join(config.publicDir, 'index.html'));
});

// La signature a quatre parametres est ce qui identifie un gestionnaire
// d'erreurs aupres d'Express : `next` doit rester declare meme s'il est inutile.
app.use((err, req, res, next) => {
  console.error('[erreur]', err);
  res.status(500).json({ error: err.message || 'Erreur interne' });
});

const server = app.listen(config.port, () => {
  console.log(`Affichage Usine demarre sur le port ${config.port}`);
  console.log(`  Administration : http://localhost:${config.port}/admin`);
  console.log(`  Dossier surveille : ${config.sourceRoot}`);
  startScheduler();
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\nArret demande (${signal})...`);
    stopScheduler();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
