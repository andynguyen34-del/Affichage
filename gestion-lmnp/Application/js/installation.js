// Icônes de lancement : une application installable par entrée.
// - « LMNP » (maison verte) : l'espace propriétaires, adresse …/proprietaire ;
// - « Résidence ANIKA » (silhouettes bleues) : l'espace colocataires, adresse …/colocataire.
// Sur PC (Chrome, Edge), « Installer » crée l'application avec son icône ;
// Windows propose alors « Épingler à la barre des tâches » et « Créer un
// raccourci sur le Bureau ». Sur tablette et téléphone, l'icône va sur
// l'écran d'accueil. En repli, un raccourci Internet (.url) à poser sur le
// Bureau ouvre l'adresse dans le navigateur.

import { estInstallee, installable, proposerInstallation, consigneInstallation } from './plein-ecran.js';
import { espaceDuManifesteCharge } from './espace.js';

export const ENTREES = {
  proprietaire: {
    nomAppli: 'LMNP',
    libelle: 'espace propriétaires',
    chemin: '/proprietaire',
    icone: '/icones/icone-192.png',
    description: 'Ouvre la page d’accueil de gestion (Loyers).',
  },
  colocataire: {
    nomAppli: 'Résidence ANIKA',
    libelle: 'espace colocataires',
    chemin: '/colocataire',
    icone: '/icones/icone-colocataire-192.png',
    description: 'Ouvre directement la connexion « Colocataires ».',
  },
};

/** Adresse complète d'une entrée (sur l'hébergement en cours). */
export const adresseEntree = (espace) => `${location.origin}${ENTREES[espace]?.chemin || '/'}`;

/** Contenu d'un raccourci Internet Windows (.url) vers une entrée. */
export const contenuRaccourci = (espace) => `[InternetShortcut]\r\nURL=${adresseEntree(espace)}\r\n`;

/** Télécharge le raccourci .url d'une entrée (repli : icône du navigateur). */
export function telechargerRaccourci(espace) {
  const entree = ENTREES[espace] || ENTREES.proprietaire;
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenuRaccourci(espace)], { type: 'application/internet-shortcut' }));
  // Nom sans accent : Chrome remplace par « download » un nom accentué de ce type de fichier.
  lien.download = `${entree.nomAppli.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.url`;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
}

/**
 * Installe l'application d'une entrée depuis la page en cours.
 * Le navigateur installe l'application décrite par le manifeste chargé avec
 * la page : si ce n'est pas celui de l'entrée voulue, on ouvre d'abord son
 * adresse (la page se recharge avec la bonne icône), puis on réinstalle.
 * Renvoie : 'accepted' | 'dismissed' | 'redirige' | 'consigne' | 'installee'.
 */
export async function installerEntree(espace) {
  if (espaceDuManifesteCharge() !== espace) {
    location.assign(`${ENTREES[espace].chemin}?installer=1`);
    return 'redirige';
  }
  if (estInstallee()) return 'installee';
  if (installable()) return (await proposerInstallation()) || 'dismissed';
  return 'consigne';
}

/** La page a-t-elle été ouverte pour installer une entrée (bouton « Installer » depuis l'autre entrée) ? */
export const ouverteViaInstallation = () => /(^|[?&])installer=1/.test(location.search);

/**
 * Bloc « Installer l'icône » de la page de connexion : icône, bouton et
 * consigne, mis à jour à chaque changement d'entrée (événement lmnp-espace).
 */
export function brancherInstallationConnexion() {
  const bloc = document.getElementById('connexion-installation');
  const icone = document.getElementById('installation-icone');
  const bouton = document.getElementById('bouton-installer-connexion');
  const consigne = document.getElementById('installation-consigne');
  if (!bloc || !bouton) return;
  let espaceCourant = espaceDuManifesteCharge();

  const dessiner = () => {
    const entree = ENTREES[espaceCourant] || ENTREES.proprietaire;
    bloc.hidden = estInstallee();
    if (icone) { icone.src = entree.icone; icone.alt = `Icône ${entree.nomAppli}`; }
    const memeManifeste = espaceDuManifesteCharge() === espaceCourant;
    bouton.textContent = memeManifeste
      ? `📲 Installer l’icône « ${entree.nomAppli} » sur cet appareil`
      : `📲 Ouvrir l’entrée « ${entree.nomAppli} » pour l’installer`;
    if (consigne) {
      consigne.textContent = !memeManifeste
        ? `La page s’ouvrira à l’adresse ${entree.chemin} avec l’icône « ${entree.nomAppli} » ; cliquez alors sur « Installer ».`
        : installable()
          ? 'Sur PC : icône sur le Bureau et dans la barre des tâches (cochez les cases proposées). Sur tablette : écran d’accueil.'
          : (ouverteViaInstallation() ? 'Si le navigateur ne propose rien : ' : '') + consigneInstallation();
    }
  };

  bouton.onclick = async () => {
    const resultat = await installerEntree(espaceCourant);
    if (resultat === 'consigne' && consigne) consigne.textContent = consigneInstallation();
    if (resultat === 'accepted' && consigne) consigne.textContent = 'Installation lancée : l’icône apparaît sur le Bureau, dans la barre des tâches ou sur l’écran d’accueil.';
    dessiner();
  };
  document.addEventListener('lmnp-espace', (evenement) => { espaceCourant = evenement.detail || espaceCourant; dessiner(); });
  document.addEventListener('lmnp-installable', dessiner);
  document.addEventListener('lmnp-installee', dessiner);
  dessiner();
}
