// Expédition des e-mails de l'application (v42).
//
// L'application (et la fonction d'appel de loyer) dépose chaque courriel dans
// la collection Firestore « mail », au format
//   { to: [adresses], message: { subject, html, attachments: [{ filename, content (base64), encoding }] } }.
// La fonction `expedierCourriel` se déclenche à la création du document et
// l'envoie par Gmail (SMTP, mot de passe d'application dans le secret
// GMAIL_APP_PASSWORD ; compte dans le paramètre GMAIL_COMPTE, expéditeur
// affiché dans COURRIEL_EXPEDITEUR), puis inscrit le résultat dans le champ
// `delivery` du document : state PROCESSING → SUCCESS ou ERROR (avec le
// message d'erreur), attempts, startTime, endTime, messageId.
//
// Derrière /api/fichiers, trois opérations réservées aux gérants :
//   courriels-etat      : les derniers courriels et leur état (page Paramètres)
//   courriels-relancer  : renvoie ceux restés en attente ou en échec
//   courriels-test      : dépose et envoie un e-mail de test
//
// Elle remplace la fonction envoiMail (codebase « default », déployée à part
// jusqu'à la v41) : une fois celle-ci retirée, plus rien ne part en double.
// Dans l'émulateur, rien n'est expédié : transport « json » de nodemailer.

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

export const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const GMAIL_COMPTE = defineString('GMAIL_COMPTE', {
  description: 'Adresse Gmail du compte qui expédie (celui du mot de passe d’application GMAIL_APP_PASSWORD)',
});
const COURRIEL_EXPEDITEUR = defineString('COURRIEL_EXPEDITEUR', {
  default: 'Andy Nguyen <a-nguyen@sfr.fr>',
  description: 'Expéditeur affiché (« Nom <adresse> ») ; l’adresse doit être autorisée en « envoyer en tant que » dans Gmail',
});

const ESSAIS_MAX = 3;
const BLOQUE_APRES_MS = 10 * 60 * 1000; // un envoi « en cours » depuis plus de 10 min est considéré perdu
const LISTE_MAX = 400;

class ErreurHttp extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}
const refus = (statut, message) => new ErreurHttp(statut, message);

const enEmulateur = () => process.env.FUNCTIONS_EMULATOR === 'true';

/** Transport nodemailer : Gmail en production, « json » (rien n'est envoyé) dans l'émulateur. */
export function transporteur() {
  if (enEmulateur()) return nodemailer.createTransport({ jsonTransport: true });
  const compte = String(GMAIL_COMPTE.value() || '').trim();
  if (!compte) throw new Error('Paramètre GMAIL_COMPTE absent : redéployez la fonction et renseignez le compte Gmail.');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: compte, pass: GMAIL_APP_PASSWORD.value() },
  });
}

const millis = (valeur) => {
  if (!valeur) return 0;
  if (typeof valeur.toMillis === 'function') return valeur.toMillis();
  const t = Date.parse(valeur);
  return Number.isFinite(t) ? t : 0;
};

/** Un document est à (re)prendre : jamais traité, en échec (moins de 3 essais), ou bloqué « en cours ». */
export function aReprendre(donnees, maintenant = Date.now()) {
  const livraison = donnees?.delivery || null;
  if (!livraison) return true;
  if (livraison.state === 'SUCCESS') return false;
  if (livraison.state === 'PROCESSING') return maintenant - millis(livraison.startTime) > BLOQUE_APRES_MS;
  return Number(livraison.attempts || 0) < ESSAIS_MAX;
}

/**
 * Expédie un document « mail ». Réclame d'abord le document dans une
 * transaction (state PROCESSING) : deux déclenchements simultanés — ou
 * l'ancienne fonction envoiMail encore déployée — n'envoient pas en double.
 * `transport` : nodemailer (injectable pour les tests).
 */
export async function expedier(base, ref, { transport = null, force = false } = {}) {
  const reclame = await base.runTransaction(async (t) => {
    const photo = await t.get(ref);
    if (!photo.exists) return null;
    const donnees = photo.data();
    if (!force && !aReprendre(donnees)) return null;
    if (force && donnees.delivery?.state === 'SUCCESS') return null;
    t.update(ref, {
      'delivery.state': 'PROCESSING',
      'delivery.startTime': FieldValue.serverTimestamp(),
      'delivery.attempts': FieldValue.increment(1),
    });
    return donnees;
  });
  if (!reclame) return { ignore: true };

  const message = reclame.message || {};
  const destinataires = [].concat(reclame.to || []).map((a) => String(a || '').trim()).filter(Boolean);
  try {
    if (!destinataires.length) throw new Error('Aucun destinataire.');
    const info = await (transport || transporteur()).sendMail({
      from: COURRIEL_EXPEDITEUR.value(),
      to: destinataires,
      subject: message.subject || '(sans objet)',
      html: message.html || undefined,
      text: message.text || undefined,
      attachments: (message.attachments || []).map((p) => ({ filename: p.filename, content: p.content, encoding: p.encoding || 'base64' })),
    });
    await ref.update({
      'delivery.state': 'SUCCESS', 'delivery.endTime': FieldValue.serverTimestamp(),
      'delivery.messageId': String(info?.messageId || ''), 'delivery.error': FieldValue.delete(),
      'delivery.par': 'expedierCourriel', 'delivery.expediteur': String(COURRIEL_EXPEDITEUR.value() || ''),
    });
    return { ok: true, destinataires };
  } catch (erreur) {
    const texte = String(erreur?.message || erreur).slice(0, 600);
    console.error('Envoi impossible', ref.id, texte);
    await ref.update({ 'delivery.state': 'ERROR', 'delivery.endTime': FieldValue.serverTimestamp(), 'delivery.error': texte, 'delivery.par': 'expedierCourriel' });
    return { ok: false, erreur: texte, destinataires };
  }
}

/** Déclenchement à la création d'un document « mail ». */
export const expedierCourriel = onDocumentCreated({
  document: 'mail/{id}', region: 'europe-west1', secrets: [GMAIL_APP_PASSWORD], memory: '256MiB', timeoutSeconds: 60, retry: false,
}, async (evenement) => {
  const photo = evenement.data;
  if (!photo) return;
  await expedier(getFirestore(), photo.ref);
});

// ------------------------------------------------------------------ relais

const resume = (photo) => {
  const d = photo.data() || {};
  const livraison = d.delivery || null;
  return {
    id: photo.id,
    to: [].concat(d.to || []),
    sujet: String(d.message?.subject || ''),
    etat: livraison?.state || 'PENDING',
    erreur: livraison?.error || '',
    tentatives: Number(livraison?.attempts || 0),
    par: String(livraison?.par || ''),
    expediteur: String(livraison?.expediteur || ''),
    le: millis(livraison?.endTime) || millis(livraison?.startTime) || millis(d.creeLe) || 0,
  };
};

async function lireTout(base) {
  const photos = (await base.collection('mail').limit(LISTE_MAX).get()).docs;
  return photos.sort((a, b) => resume(b).le - resume(a).le);
}

const lireCorps = (req) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try { return JSON.parse((req.rawBody || req.body || '').toString() || '{}'); } catch { return {}; }
};

/** Opérations « courriels-* » du relais (gérants seulement). */
export async function traiterCourriels(op, req, res, qui) {
  if (!qui.gerant) throw refus(403, 'Réservé aux gérants.');
  const base = getFirestore();

  if (op === 'courriels-etat') {
    const photos = await lireTout(base);
    const courriels = photos.slice(0, 30).map(resume);
    const enAttente = photos.filter((p) => aReprendre(p.data())).length;
    res.json({ courriels, enAttente, total: photos.length, emulateur: enEmulateur() });
    return;
  }

  if (op === 'courriels-relancer') {
    if (req.method !== 'POST') throw refus(405, 'Méthode non autorisée.');
    const photos = (await lireTout(base)).filter((p) => aReprendre(p.data()));
    let envoyes = 0;
    const echecs = [];
    for (const photo of photos.slice(0, 40)) {
      // eslint-disable-next-line no-await-in-loop
      const resultat = await expedier(base, photo.ref);
      if (resultat.ok) envoyes += 1;
      else if (!resultat.ignore) echecs.push(`${resume(photo).sujet || photo.id} : ${resultat.erreur}`);
    }
    res.json({ ok: true, candidats: photos.length, envoyes, echecs });
    return;
  }

  if (op === 'courriels-test') {
    if (req.method !== 'POST') throw refus(405, 'Méthode non autorisée.');
    const corps = lireCorps(req);
    const to = String(corps.to || qui.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw refus(400, 'Adresse de test invalide.');
    const quand = new Date();
    const ref = await base.collection('mail').add({
      to: [to],
      message: {
        subject: `Test d’envoi — Gestion LMNP (${quand.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })})`,
        html: `<p>Bonjour,</p><p>Ceci est un e-mail de test envoyé depuis Paramètres → « Envoi des e-mails » le ${quand.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.</p><p>Si vous le lisez, l’expédition des courriels de l’application fonctionne.</p>`,
      },
      creeLe: quand.toISOString(),
      test: true,
    });
    const resultat = await expedier(base, ref);
    const final = (await ref.get()).data();
    res.json({ ok: Boolean(resultat.ok || final?.delivery?.state === 'SUCCESS'), id: ref.id, to, delivery: final?.delivery ? { state: final.delivery.state, error: final.delivery.error || '' } : null });
    return;
  }

  throw refus(400, `Opération inconnue : ${op}.`);
}
