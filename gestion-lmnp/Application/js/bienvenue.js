// E-mail « Bienvenue sur votre espace » (v47) : envoyé à chaque nouveau
// colocataire depuis la page Locataires. Adresse de l'espace, identifiant,
// les quatre étapes de la première connexion (le mot de passe se choisit via
// le lien « Réinitialisez votre mot de passe » de Firebase, jamais par
// e-mail), l'icône « Résidence ANIKA » sur PC et tablette, ce qu'on trouve
// sur l'espace, les justificatifs manquants. Module PUR.
//
// parametres.bienvenue = { objet, message } (Paramètres → « Bienvenue sur
// l'espace »). Variables : {prenom} {nom} {logement} {adresse} {entree} {espace}.

import { dateLongue } from './format.js';

export const BIENVENUE_PAR_DEFAUT = {
  objet: 'Bienvenue sur votre espace — {logement}',
  message: '',
};

/** Nom du raccourci joint à l'e-mail (fichier Internet à poser sur le Bureau). */
export const NOM_RACCOURCI = 'Résidence ANIKA.url';

const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const remplir = (gabarit, valeurs) => String(gabarit || '')
  .replace(/\{(\w+)\}/g, (tout, cle) => (valeurs[cle] !== undefined ? valeurs[cle] : tout));

const nomComplet = (l) => `${l?.prenom || ''} ${l?.nom || ''}`.trim();
const adresseBien = (bien) => [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export function reglageBienvenueDe(parametres = {}) {
  return { ...BIENVENUE_PAR_DEFAUT, ...(parametres?.bienvenue || {}) };
}

/** L'adresse de l'espace colocataires pour une origine (« https://… »). */
export const adresseEspace = (origine) => `${String(origine || '').replace(/\/+$/, '')}/colocataire`;

/** Contenu du raccourci Internet (.url) vers l'espace colocataires. */
export const contenuRaccourci = (origine) => `[InternetShortcut]\r\nURL=${adresseEspace(origine)}\r\n`;

/** Signature : les bailleurs des Paramètres, à défaut l'activité. */
export function signatureBailleurs(parametres = {}) {
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  return bailleurs.map((b) => b.nom).join(' et ') || parametres.nomActivite || 'Le bailleur';
}

/**
 * L'e-mail de bienvenue d'un colocataire.
 *   locataire, bail, bien : la personne, son bail courant, le logement
 *   origine               : adresse de l'application (window.location.origin)
 *   manquants             : catégories de justificatifs qui lui manquent ([{ libelle, periodicite }])
 *   compteCree            : le compte de connexion vient d'être créé et l'e-mail
 *                           de mot de passe envoyé (le texte s'y adapte)
 *   renvoi                : nouvel envoi d'une bienvenue déjà partie
 * Renvoie { destinataires, sujet, html, raccourci: { nom, contenu } }.
 */
export function preparerBienvenue({ locataire, bail = null, bien = null, parametres = {}, origine = '', manquants = [], compteCree = true, renvoi = false }) {
  const reglage = reglageBienvenueDe(parametres);
  const email = String(locataire?.email || '').trim().toLowerCase();
  const nom = nomComplet(locataire) || 'colocataire';
  const espace = adresseEspace(origine);
  const valeurs = {
    prenom: locataire?.prenom || nom, nom,
    logement: bien?.nom || 'votre logement', adresse: adresseBien(bien) || '',
    entree: bail?.dateDebut ? dateLongue(bail.dateDebut) : '', espace, activite: parametres.nomActivite || '',
  };
  const sujet = `${renvoi ? 'Rappel — ' : ''}${remplir(reglage.objet || BIENVENUE_PAR_DEFAUT.objet, valeurs)}`;
  const accueil = reglage.message
    ? `<p>${echapper(remplir(reglage.message, valeurs)).replace(/\n/g, '<br>')}</p>`
    : `<p>Bienvenue ${bien?.nom ? `à <strong>${echapper(bien.nom)}</strong>` : 'chez vous'}${valeurs.adresse ? ` (${echapper(valeurs.adresse)})` : ''}`
      + `${valeurs.entree ? `, à compter du ${echapper(valeurs.entree)}` : ''}. Un espace en ligne vous est réservé : vous y trouverez votre bail, `
      + 'vos quittances de loyer, l’état des lieux (avec vos réponses et vos photos), le reçu de votre dépôt de garantie, et vous pourrez y déposer vos justificatifs.</p>';
  const etapes = [
    `Ouvrez l’adresse ci-dessus. La page « Résidence ANIKA — Espace colocataires » s’affiche.`,
    'Saisissez votre adresse e-mail, puis cliquez sur <strong>« Première connexion ou mot de passe oublié ? »</strong>.',
    compteCree
      ? 'Vous recevez aussitôt un e-mail « Réinitialisez votre mot de passe » (il a peut-être déjà été envoyé avec ce message) : suivez son lien et choisissez votre mot de passe, 8 caractères au moins.'
      : 'Vous recevez aussitôt un e-mail « Réinitialisez votre mot de passe » : suivez son lien et choisissez votre mot de passe, 8 caractères au moins.',
    'Revenez sur la page et connectez-vous avec votre adresse et ce mot de passe. Vous êtes chez vous.',
  ];
  const lignes = [
    `<p>Bonjour ${echapper(valeurs.prenom)},</p>`,
    renvoi ? '<p>Pour rappel, voici comment accéder à votre espace :</p>' : accueil,
    `<p><strong>Votre espace :</strong> <a href="${echapper(espace)}">${echapper(espace)}</a><br><strong>Identifiant :</strong> ${echapper(email)}</p>`,
    '<p><strong>Première connexion</strong></p>',
    `<ol>${etapes.map((e) => `<li>${e}</li>`).join('')}</ol>`,
    '<p><strong>Un raccourci sur votre écran</strong><br>'
      + 'Sur PC (Chrome ou Edge) : sous le formulaire de connexion, « Installer l’icône Résidence ANIKA sur cet appareil », puis cochez « Épingler à la barre des tâches ». '
      + 'Sur tablette ou téléphone : le même bouton ajoute l’icône « Résidence ANIKA » à l’écran d’accueil (sur iPad : Partager → « Sur l’écran d’accueil »). '
      + `Le fichier joint <em>${echapper(NOM_RACCOURCI)}</em> fait la même chose sur le Bureau d’un PC.</p>`,
    manquants.length
      ? `<p><strong>À déposer dès que possible</strong> (rubrique « Justificatifs » de votre espace) : ${manquants.map((c) => echapper(`${c.libelle}${c.periodicite ? ` (${c.periodicite})` : ''}`)).join(', ')}.</p>`
      : '',
    '<p>Vos quittances arrivent sur l’espace dès que le loyer du mois est réglé ; l’appel de loyer vous parvient par e-mail chaque mois.</p>',
    `<p>Bien cordialement,<br>${echapper(signatureBailleurs(parametres))}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ''}</p>`,
  ];
  return {
    destinataires: [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean),
    sujet,
    html: lignes.filter(Boolean).join('\n'),
    raccourci: { nom: NOM_RACCOURCI, contenu: contenuRaccourci(origine) },
  };
}
