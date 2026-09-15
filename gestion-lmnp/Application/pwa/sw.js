// Service worker minimal : il rend l'application installable (icône sur
// l'écran d'accueil, ouverture plein écran) sans rien mettre en cache — la
// page est toujours relue depuis l'hébergement, donc toujours à jour.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evenement) => evenement.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* réseau uniquement */ });
