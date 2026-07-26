import { Router } from 'express';
import { getSetting } from '../db.js';
import {
  login,
  logout,
  isValidSession,
  changePassword,
  setSessionCookie,
  clearSessionCookie,
  readToken,
} from '../lib/auth.js';

export const authRouter = Router();

authRouter.get('/session', (req, res) => {
  res.json({
    authenticated: isValidSession(readToken(req)),
    passwordIsDefault: getSetting('admin_password_is_default') === '1',
  });
});

authRouter.post('/login', (req, res) => {
  const token = login(req.body?.password);
  if (!token) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  setSessionCookie(res, token);
  res.json({ ok: true, passwordIsDefault: getSetting('admin_password_is_default') === '1' });
});

authRouter.post('/logout', (req, res) => {
  logout(readToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/password', (req, res) => {
  if (!isValidSession(readToken(req))) return res.status(401).json({ error: 'Non connecte' });
  const result = changePassword(req.body?.current, req.body?.next);
  if (!result.ok) return res.status(400).json(result);
  clearSessionCookie(res);
  res.json({ ok: true });
});
