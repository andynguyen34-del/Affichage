// Service worker de l'application JE URBH.
//
// Stratégie volontairement simple et sûre :
//  - « réseau d'abord, cache en secours » pour les fichiers du site : les
//    participants ont toujours la dernière version en ligne, et l'application
//    s'ouvre quand même (dernier état connu) si le réseau du palais des
//    congrès flanche un instant ;
//  - aucune interception des requêtes vers Firebase (autre domaine) : les
//    données restent toujours en direct.
//
// Le numéro de version doit suivre APP_BUILD (firebase-config.js) : le
// changer invalide l'ancien cache au déploiement suivant.

const CACHE = 'urbh-v16';

const COQUILLE = [
  '/portail.html',
  '/repondre.html',
  '/css/style.css',
  '/js/firebase-config.js',
  '/js/modeles.js',
  '/js/portail.js',
  '/js/repondre.js',
  '/icons/icone-192.png',
  '/icons/icone-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(COQUILLE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evt) => {
  const requete = evt.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return; // Firebase & CDN : toujours en direct
  if (url.pathname.startsWith('/__/')) return; // adresses réservées Firebase Hosting

  evt.respondWith(
    fetch(requete)
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(CACHE).then((cache) => cache.put(requete, copie));
        return reponse;
      })
      .catch(() => caches.match(requete, { ignoreSearch: url.pathname.endsWith('.html') })),
  );
});
