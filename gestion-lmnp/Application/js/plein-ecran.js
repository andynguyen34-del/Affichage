// Plein écran et installation sur l'appareil.
//
// - Application installée (« Ajouter à l'écran d'accueil ») : elle s'ouvre
//   déjà sans barre de navigateur, rien à faire.
// - Sinon, au premier geste (toucher, clic, touche) après le lancement, on
//   demande le plein écran au navigateur — celui-ci ne l'accorde qu'à la
//   suite d'un geste de l'utilisateur, jamais tout seul au chargement.
//   Réglage par appareil : automatique (tablette / téléphone), toujours,
//   jamais. Le bouton ⛶ de l'en-tête bascule à tout moment.

const CLE = 'lmnp-plein-ecran';
const lire = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrire = (cle, valeur) => { try { localStorage.setItem(cle, valeur); } catch { /* sans importance */ } };

export const REGLAGES_PLEIN_ECRAN = [
  { valeur: 'auto', libelle: 'Automatique — sur tablette et téléphone seulement' },
  { valeur: 'toujours', libelle: 'Toujours (tablette, téléphone et ordinateur)' },
  { valeur: 'jamais', libelle: 'Jamais (le bouton ⛶ reste disponible)' },
];
export const reglagePleinEcran = () => lire(CLE) || 'auto';
export function definirReglagePleinEcran(valeur) { ecrire(CLE, valeur); }

export const estInstallee = () => (typeof matchMedia === 'function'
  && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches))
  || navigator.standalone === true;
export const tactile = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
export const pleinEcranPossible = () => typeof document.documentElement.requestFullscreen === 'function';
export const enPleinEcran = () => Boolean(document.fullscreenElement);
export const estIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function entrerPleinEcran() {
  if (!pleinEcranPossible() || enPleinEcran()) return enPleinEcran();
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); return true; } catch { return false; }
}
export async function quitterPleinEcran() {
  if (!enPleinEcran()) return;
  try { await document.exitFullscreen(); } catch { /* déjà sorti */ }
}
export const basculerPleinEcran = () => (enPleinEcran() ? quitterPleinEcran() : entrerPleinEcran());

/** Faut-il passer en plein écran au lancement sur cet appareil ? */
export function pleinEcranSouhaite() {
  if (estInstallee() || !pleinEcranPossible()) return false;
  const reglage = reglagePleinEcran();
  return reglage === 'toujours' || (reglage === 'auto' && tactile());
}

/** Au premier geste après le lancement : plein écran, si souhaité. */
export function armerPleinEcranAuLancement() {
  if (!pleinEcranSouhaite()) return;
  const surGeste = () => {
    document.removeEventListener('pointerdown', surGeste, true);
    document.removeEventListener('keydown', surGeste, true);
    if (pleinEcranSouhaite() && !enPleinEcran()) entrerPleinEcran();
  };
  document.addEventListener('pointerdown', surGeste, true);
  document.addEventListener('keydown', surGeste, true);
}

/** Bouton ⛶ de l'en-tête : visible dès que le plein écran est possible et que l'application n'est pas installée. */
export function brancherBoutonPleinEcran(bouton) {
  if (!bouton) return;
  const rafraichir = () => {
    bouton.hidden = !pleinEcranPossible() || estInstallee();
    bouton.textContent = enPleinEcran() ? '⤢' : '⛶';
    bouton.title = enPleinEcran() ? 'Quitter le plein écran' : 'Plein écran';
  };
  bouton.onclick = () => basculerPleinEcran();
  document.addEventListener('fullscreenchange', rafraichir);
  rafraichir();
}

// ------------------------------------------------------------ installation

let evenementInstallation = null;
window.addEventListener('beforeinstallprompt', (evenement) => {
  evenement.preventDefault();
  evenementInstallation = evenement;
  document.dispatchEvent(new CustomEvent('lmnp-installable'));
});
window.addEventListener('appinstalled', () => { evenementInstallation = null; document.dispatchEvent(new CustomEvent('lmnp-installee')); });

export const installable = () => Boolean(evenementInstallation);
export async function proposerInstallation() {
  if (!evenementInstallation) return null;
  const evenement = evenementInstallation;
  evenementInstallation = null;
  evenement.prompt();
  const choix = await evenement.userChoice.catch(() => null);
  return choix?.outcome || null;
}

/** Enregistre le service worker (nécessaire pour l'installation ; ne met rien en cache). */
export function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('/sw.js').catch((erreur) => console.warn('Service worker :', erreur?.message || erreur));
}

/** Comment installer sur cet appareil, quand le navigateur ne propose pas de bouton. */
export function consigneInstallation() {
  if (estIOS()) return 'Sur iPad / iPhone (Safari) : bouton Partager (carré avec une flèche) → « Sur l’écran d’accueil » → Ajouter.';
  if (/Android/i.test(navigator.userAgent)) return 'Sur Android (Chrome) : menu ⋮ en haut à droite → « Ajouter à l’écran d’accueil » ou « Installer l’application ».';
  return 'Sur ordinateur (Chrome / Edge) : icône d’installation à droite de la barre d’adresse, ou menu ⋮ → « Installer Gestion LMNP ».';
}
