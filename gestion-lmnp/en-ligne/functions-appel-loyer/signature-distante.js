// Signature à distance de l'état des lieux par un colocataire, depuis son
// espace, validée par un code envoyé à son adresse e-mail.
//
// Servi derrière /api/fichiers (opérations « signature-envoyer » et
// « signature-confirmer ») pour ne pas ajouter de fonction à déployer.
// Tout ce qui fait foi est écrit ICI, côté serveur, jamais par le navigateur
// du colocataire : l'empreinte du code, la date et l'heure de la signature.
//
// - signature-envoyer { edlId } : vérifie que l'état des lieux est publié
//   sur l'espace du colocataire, que la fenêtre est ouverte et que ses
//   réponses sont complètes, puis dépose un code à 6 chiffres (15 minutes)
//   dans la file « mail » et son empreinte dans portail/{email}/codes/{edlId}.
// - signature-confirmer { edlId, code, image } : compare le code (5 essais),
//   puis enregistre portail/{email}/signatures/{edlId} : image, date, mode.

import { createHash, randomInt } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { bilanReponses } from './lib/contradictoire.js';

const VALIDITE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 5;
const TAILLE_IMAGE_MAX = 400 * 1024; // data URL PNG d'une signature : quelques dizaines de Ko

class ErreurHttp extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}
const refus = (statut, message) => new ErreurHttp(statut, message);

const empreinte = (email, edlId, code) => createHash('sha256').update(`${email}|${edlId}|${code}`).digest('hex');

/** Adresse masquée pour l'affichage : « nic…@test.fr ». */
export const masquer = (email) => {
  const [avant, apres] = String(email || '').split('@');
  if (!apres) return '…';
  return `${avant.slice(0, 3)}…@${apres}`;
};

const lireCorps = (req) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try { return JSON.parse((req.rawBody || req.body || '').toString() || '{}'); } catch { return {}; }
};

/** L'état des lieux publié sur l'espace du colocataire, fenêtre ouverte. */
async function contexteSignature(base, qui, edlId) {
  if (qui.gerant) throw refus(403, 'La signature à distance est réservée aux colocataires ; les bailleurs signent dans l’application.');
  const portail = (await base.doc(`portail/${qui.email}`).get()).data();
  const c = portail?.contradictoires?.[edlId] || (portail?.contradictoire?.edlId === edlId ? portail.contradictoire : null);
  if (!c) throw refus(404, 'Aucun état des lieux publié sur votre espace pour cet identifiant.');
  if (Date.now() > Number(c.finLeMs || 0)) throw refus(403, `La période de réponse est terminée (${c.finLe}) : la signature n’est plus possible depuis votre espace.`);
  const reponses = (await base.doc(`portail/${qui.email}/reponses/${edlId}`).get()).data();
  const bilan = bilanReponses(c.apercu || null, reponses?.reponses || {});
  if (bilan.total > 0 && !bilan.complet) throw refus(409, `Répondez d’abord à tous les points (${bilan.total - bilan.repondus} restant(s)), ou utilisez « Tout est d’accord pour le reste ».`);
  return { portail, contradictoire: c, bilan };
}

export async function traiterSignature(op, req, res, qui) {
  if (req.method !== 'POST') throw refus(405, 'Méthode non autorisée.');
  const base = getFirestore();
  const corps = lireCorps(req);
  const edlId = String(corps.edlId || '').trim();
  if (!/^[\w-]{1,80}$/.test(edlId)) throw refus(400, 'Identifiant d’état des lieux manquant.');

  if (op === 'signature-envoyer') {
    const { contradictoire } = await contexteSignature(base, qui, edlId);
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const expireMs = Date.now() + VALIDITE_MS;
    await base.doc(`portail/${qui.email}/codes/${edlId}`).set({ empreinte: empreinte(qui.email, edlId, code), expireMs, essais: 0, envoyeLe: new Date().toISOString() });
    await base.collection('mail').add({
      to: [qui.email],
      type: 'code',
      creeLe: new Date().toISOString(),
      message: {
        subject: `Votre code de signature : ${code}`,
        html: `<p>Bonjour,</p><p>Pour signer l'état des lieux ${contradictoire.type === 'sortie' ? 'de sortie' : "d'entrée"} du ${String(contradictoire.dateEdl || '').split('-').reverse().join('/')} depuis votre espace, saisissez ce code :</p>`
          + `<p style="font-size:1.6em;letter-spacing:.3em;font-weight:bold">${code}</p>`
          + '<p>Il est valable 15 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message.</p>',
      },
    });
    res.json({ ok: true, envoyeA: masquer(qui.email), expireMs });
    return;
  }

  if (op === 'signature-confirmer') {
    const { contradictoire } = await contexteSignature(base, qui, edlId);
    const code = String(corps.code || '').replace(/\D/g, '');
    const image = String(corps.image || '');
    if (!/^\d{6}$/.test(code)) throw refus(400, 'Code à 6 chiffres attendu.');
    if (!image.startsWith('data:image/png;base64,') || image.length > TAILLE_IMAGE_MAX) throw refus(400, 'Signature (image) manquante ou trop lourde.');
    const refCode = base.doc(`portail/${qui.email}/codes/${edlId}`);
    const enregistre = (await refCode.get()).data();
    if (!enregistre) throw refus(404, 'Aucun code envoyé : demandez d’abord un code.');
    if (Date.now() > Number(enregistre.expireMs || 0)) { await refCode.delete(); throw refus(410, 'Code expiré : demandez un nouveau code.'); }
    if (Number(enregistre.essais || 0) >= ESSAIS_MAX) { await refCode.delete(); throw refus(429, 'Trop d’essais : demandez un nouveau code.'); }
    if (enregistre.empreinte !== empreinte(qui.email, edlId, code)) {
      await refCode.set({ essais: Number(enregistre.essais || 0) + 1 }, { merge: true });
      throw refus(403, `Code incorrect (${ESSAIS_MAX - Number(enregistre.essais || 0) - 1} essai(s) restant(s)).`);
    }
    const signeLe = new Date().toISOString();
    await base.doc(`portail/${qui.email}/signatures/${edlId}`).set({
      edlId, image, signeLe, mode: 'email', emailMasque: masquer(qui.email), empreinteCode: enregistre.empreinte,
      type: contradictoire.type || '', dateEdl: contradictoire.dateEdl || '',
    });
    await refCode.delete();
    res.json({ ok: true, signeLe, mode: 'email', emailMasque: masquer(qui.email) });
    return;
  }

  throw refus(400, `Opération inconnue : ${op}.`);
}
