import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { buildScreenPayload, resolveView } from '../lib/render.js';

/**
 * Routes consultees par les ecrans de l'usine. Elles sont volontairement
 * ouvertes (pas d'authentification) : un ecran mural n'a personne pour saisir
 * un mot de passe, et l'application n'est joignable que depuis le reseau
 * interne. Elles sont strictement en lecture seule.
 */
export const displayRouter = Router();

displayRouter.get('/screens', (req, res) => {
  const screens = db
    .prepare('SELECT key, name, location FROM screens WHERE enabled = 1 ORDER BY name')
    .all();
  res.json({ title: getSetting('site_title', "Indicateurs de l'usine"), screens });
});

displayRouter.get('/screen/:key', (req, res) => {
  const screen = db
    .prepare('SELECT * FROM screens WHERE key = ? AND enabled = 1')
    .get(req.params.key);
  if (!screen) return res.status(404).json({ error: `Ecran « ${req.params.key} » introuvable.` });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();
  db.prepare("UPDATE screens SET last_seen_at = datetime('now'), last_ip = ? WHERE id = ?").run(
    ip,
    screen.id,
  );

  const payload = buildScreenPayload(screen);
  payload.title = getSetting('site_title', "Indicateurs de l'usine");
  res.set('Cache-Control', 'no-store');
  res.json(payload);
});

/** Affichage d'une vue seule, pratique pour tester ou pour un ecran dedie. */
displayRouter.get('/view/:key', (req, res) => {
  const view = db.prepare('SELECT * FROM views WHERE key = ? AND enabled = 1').get(req.params.key);
  if (!view) return res.status(404).json({ error: `Vue « ${req.params.key} » introuvable.` });
  res.set('Cache-Control', 'no-store');
  res.json({
    title: getSetting('site_title', "Indicateurs de l'usine"),
    screen: { key: `vue-${view.key}`, name: view.name, location: '', refreshSeconds: 30 },
    slides: [{ seconds: 999999, view: resolveView(view) }],
    generatedAt: new Date().toISOString(),
  });
});
