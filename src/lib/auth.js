import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, getSetting, setSetting, purgeExpiredSessions } from '../db.js';

const COOKIE = 'affichage_session';
const SESSION_DAYS = 30;

export function login(password) {
  const hash = getSetting('admin_password_hash');
  if (!hash || !bcrypt.compareSync(String(password || ''), hash)) return null;

  purgeExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, created_at, expires_at)
     VALUES (?, datetime('now'), datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token);
  return token;
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function isValidSession(token) {
  if (!token) return false;
  const row = db
    .prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(token);
  return !!row;
}

export function changePassword(current, next) {
  const hash = getSetting('admin_password_hash');
  if (!bcrypt.compareSync(String(current || ''), hash)) {
    return { ok: false, error: 'Mot de passe actuel incorrect.' };
  }
  if (String(next || '').length < 6) {
    return { ok: false, error: 'Le nouveau mot de passe doit faire au moins 6 caracteres.' };
  }
  setSetting('admin_password_hash', bcrypt.hashSync(String(next), 10));
  setSetting('admin_password_is_default', '0');
  db.prepare('DELETE FROM sessions').run(); // invalide les autres sessions
  return { ok: true };
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

export function readToken(req) {
  return req.cookies?.[COOKIE] || null;
}

/** Protege les routes d'administration. Les pages d'affichage restent libres. */
export function requireAuth(req, res, next) {
  if (isValidSession(readToken(req))) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}

export const COOKIE_NAME = COOKIE;
