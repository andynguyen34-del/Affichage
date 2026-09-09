// Enveloppe des e-mails de l'application (v44) : expéditeur affiché, adresse
// de réponse et copies par type d'envoi, réglés dans Paramètres → « Adresses
// e-mail » (parametres.courriel) et lus par la fonction d'expédition à chaque
// courriel. Module PUR, partagé entre l'application et la fonction.
//
// parametres.courriel = {
//   expediteurNom, expediteurAdresse, reponseA,
//   copies: { appels: [adresses], depots: [...], documents: [...], justificatifs: [...], contradictoire: [...] },
// }

export const TYPES_COPIE = [
  { cle: 'appels', libelle: 'Appels de loyer' },
  { cle: 'depots', libelle: 'Dépôts de garantie (appels, reçus)' },
  { cle: 'documents', libelle: 'Quittances, décomptes, bail, restitutions' },
  { cle: 'justificatifs', libelle: 'Rappels de justificatifs' },
  { cle: 'contradictoire', libelle: 'État des lieux contradictoire, signatures' },
];

export const ADRESSE_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Liste d'adresses propre : tableau ou texte séparé par virgules, minuscules, sans doublon ni invalide. */
export function normaliserAdresses(liste) {
  const brut = Array.isArray(liste) ? liste : String(liste || '').split(/[,;\s]+/);
  const vues = new Set();
  const resultat = [];
  for (const element of brut) {
    const adresse = String(element || '').trim().toLowerCase();
    if (!adresse || !ADRESSE_VALIDE.test(adresse) || vues.has(adresse)) continue;
    vues.add(adresse);
    resultat.push(adresse);
  }
  return resultat;
}

/** « Nom <adresse> » → { nom, adresse } ; « adresse » seule → { nom: '', adresse }. */
export function decomposerExpediteur(texte) {
  const t = String(texte || '').trim();
  const m = t.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { nom: m[1].trim().replace(/^"|"$/g, ''), adresse: m[2].trim() };
  return { nom: '', adresse: t };
}

export const formaterExpediteur = (nom, adresse) => (adresse ? (nom ? `${nom} <${adresse}>` : adresse) : (nom || ''));

/**
 * L'enveloppe d'un envoi : from, replyTo, cc.
 *   reglage             : parametres.courriel (peut être vide)
 *   type                : type de l'envoi (clé de TYPES_COPIE) ; 'code', 'test', 'appels-recap' : jamais de copie
 *   destinataires       : adresses « to » (les copies ne les répètent pas)
 *   expediteurParDefaut : expéditeur du déploiement (« Nom <adresse> »)
 * Sans adresse d'expéditeur réglée, le nom réglé remplace seulement le nom du
 * déploiement ; sans rien de réglé, l'expéditeur du déploiement.
 */
export function composerEnveloppe({ reglage = {}, type = '', destinataires = [], expediteurParDefaut = '' } = {}) {
  const defaut = decomposerExpediteur(expediteurParDefaut);
  const nom = String(reglage?.expediteurNom || '').trim();
  const adresse = String(reglage?.expediteurAdresse || '').trim().toLowerCase();
  const from = adresse && ADRESSE_VALIDE.test(adresse)
    ? formaterExpediteur(nom || defaut.nom, adresse)
    : formaterExpediteur(nom || defaut.nom, defaut.adresse);
  const reponse = String(reglage?.reponseA || '').trim().toLowerCase();
  const replyTo = ADRESSE_VALIDE.test(reponse) ? reponse : '';
  const exclus = new Set(normaliserAdresses(destinataires));
  const copies = TYPES_COPIE.some((t) => t.cle === type) ? normaliserAdresses(reglage?.copies?.[type] || []) : [];
  return { from, replyTo, cc: copies.filter((a) => !exclus.has(a)) };
}

/** L'expéditeur réglé correspond-il au compte d'envoi ? (null si rien n'est réglé) */
export function expediteurCoherent(reglage = {}, compte = '') {
  const adresse = String(reglage?.expediteurAdresse || '').trim().toLowerCase();
  if (!adresse) return null;
  return adresse === String(compte || '').trim().toLowerCase();
}
