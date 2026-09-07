// Les deux entrées de l'application : l'espace des propriétaires (gestion)
// et l'espace des colocataires (leurs documents et dépôts). Le choix ne
// change que la présentation de la page de connexion — le RÔLE du compte,
// vérifié après connexion (systeme/roles), reste seul juge de ce qui s'ouvre.
// L'adresse …/colocataire présélectionne l'espace colocataires ; le dernier
// espace utilisé est mémorisé sur l'appareil.

const CLE = 'lmnp-espace';

export const ESPACES = {
  proprietaire: {
    titre: '🏠 Gestion LMNP',
    sousTitre: 'Espace propriétaires',
    message: 'Connectez-vous avec votre adresse e-mail et votre mot de passe.',
    note: 'Accès réservé aux bailleurs : seuls les comptes créés dans la console peuvent se connecter. Données hébergées en Europe, sur un espace privé.',
    documentTitre: 'Gestion LMNP — propriétaires',
  },
  colocataire: {
    titre: '👥 Résidence ANIKA',
    sousTitre: 'Espace colocataires',
    message: 'Connectez-vous avec l’adresse e-mail communiquée à votre bailleur. Première visite : saisissez votre adresse puis cliquez sur « Première connexion ou mot de passe oublié ? » pour choisir votre mot de passe.',
    note: 'Votre espace : quittances, bail, état des lieux, dépôt de vos photos contradictoires et de vos justificatifs. Données hébergées en Europe, sur un espace privé.',
    documentTitre: 'Résidence ANIKA — colocataires',
  },
};

const lire = () => { try { return localStorage.getItem(CLE); } catch { return null; } };

/** Espace désigné par l'adresse : …/colocataire(s) ou …/proprietaire(s). */
export function espaceDepuisAdresse() {
  const chemin = String(location.pathname || '').toLowerCase();
  if (/\/colocataires?\/?$/.test(chemin)) return 'colocataire';
  if (/\/proprietaires?\/?$/.test(chemin)) return 'proprietaire';
  return null;
}

export function espaceChoisi() {
  return espaceDepuisAdresse() || (ESPACES[lire()] ? lire() : null) || 'proprietaire';
}

export function memoriserEspace(espace) {
  if (!ESPACES[espace]) return;
  try { localStorage.setItem(CLE, espace); } catch { /* sans importance */ }
}

/** Habille la page de connexion pour l'espace choisi. */
export function appliquerEspace(espace) {
  const e = ESPACES[espace] || ESPACES.proprietaire;
  const titre = document.getElementById('connexion-titre');
  const sousTitre = document.getElementById('connexion-sous-titre');
  const message = document.getElementById('connexion-message');
  const note = document.getElementById('connexion-note');
  if (titre) titre.textContent = e.titre;
  if (sousTitre) { sousTitre.textContent = e.sousTitre; sousTitre.hidden = false; }
  if (message) message.textContent = e.message;
  if (note) note.textContent = e.note;
  document.title = e.documentTitre;
  for (const bouton of document.querySelectorAll('#connexion-espaces [data-espace]')) {
    bouton.classList.toggle('actif', bouton.dataset.espace === espace);
    bouton.setAttribute('aria-selected', bouton.dataset.espace === espace ? 'true' : 'false');
  }
}

/** Affiche le sélecteur et branche ses boutons. */
export function brancherSelecteurEspace() {
  const selecteur = document.getElementById('connexion-espaces');
  if (!selecteur) return;
  selecteur.hidden = false;
  for (const bouton of selecteur.querySelectorAll('[data-espace]')) {
    bouton.onclick = () => { memoriserEspace(bouton.dataset.espace); appliquerEspace(bouton.dataset.espace); };
  }
  appliquerEspace(espaceChoisi());
}
