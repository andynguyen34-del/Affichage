// Acces aux routes du serveur.

async function requete(methode, url, corps) {
  const reponse = await fetch(url, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });

  if (reponse.status === 401) {
    window.dispatchEvent(new CustomEvent('session-expiree'));
    throw new Error('Session expiree, reconnectez-vous.');
  }

  const type = reponse.headers.get('content-type') || '';
  const donnees = type.includes('application/json') ? await reponse.json() : await reponse.text();
  if (!reponse.ok) throw new Error(donnees?.error || `Erreur ${reponse.status}`);
  return donnees;
}

const get = (url) => requete('GET', url);
const post = (url, corps) => requete('POST', url, corps);
const put = (url, corps) => requete('PUT', url, corps);
const del = (url) => requete('DELETE', url);

const qs = (params) =>
  new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ),
  ).toString();

export const api = {
  // Session
  session: () => get('/api/auth/session'),
  connexion: (password) => post('/api/auth/login', { password }),
  deconnexion: () => post('/api/auth/logout'),
  motDePasse: (current, next) => post('/api/auth/password', { current, next }),

  // Explorateur / apercu
  meta: () => get('/api/admin/meta'),
  parcourir: (folder) => get(`/api/admin/browse?${qs({ folder })}`),
  apercuFichier: (params) => get(`/api/admin/preview?${qs(params)}`),

  // Sources
  sources: () => get('/api/admin/sources'),
  creerSource: (corps) => post('/api/admin/sources', corps),
  majSource: (id, corps) => put(`/api/admin/sources/${id}`, corps),
  supprimerSource: (id) => del(`/api/admin/sources/${id}`),
  importerSource: (id) => post(`/api/admin/sources/${id}/import`),
  fichiersSource: (id) => get(`/api/admin/sources/${id}/files`),

  // Jeux de donnees
  datasets: () => get('/api/admin/datasets'),
  dataset: (id) => get(`/api/admin/datasets/${id}`),
  creerDataset: (corps) => post('/api/admin/datasets', corps),
  majDataset: (id, corps) => put(`/api/admin/datasets/${id}`, corps),
  supprimerDataset: (id) => del(`/api/admin/datasets/${id}`),
  importerDataset: (id) => post(`/api/admin/datasets/${id}/import`),
  apercuDataset: (id) => get(`/api/admin/datasets/${id}/preview`),
  valeursDistinctes: (id, field) => get(`/api/admin/datasets/${id}/distinct?${qs({ field })}`),

  // Requetes
  requeter: (query, raw = false) => post('/api/admin/query', { query, raw }),

  // Indicateurs
  indicateurs: () => get('/api/admin/indicators'),
  creerIndicateur: (corps) => post('/api/admin/indicators', corps),
  majIndicateur: (id, corps) => put(`/api/admin/indicators/${id}`, corps),
  supprimerIndicateur: (id) => del(`/api/admin/indicators/${id}`),

  // Vues
  vues: () => get('/api/admin/views'),
  vue: (id) => get(`/api/admin/views/${id}`),
  creerVue: (corps) => post('/api/admin/views', corps),
  majVue: (id, corps) => put(`/api/admin/views/${id}`, corps),
  supprimerVue: (id) => del(`/api/admin/views/${id}`),
  vueResolue: (id) => get(`/api/admin/views/${id}/resolved`),

  // Ecrans
  ecrans: () => get('/api/admin/screens'),
  creerEcran: (corps) => post('/api/admin/screens', corps),
  majEcran: (id, corps) => put(`/api/admin/screens/${id}`, corps),
  supprimerEcran: (id) => del(`/api/admin/screens/${id}`),

  // Journal et maintenance
  journal: (limit = 100) => get(`/api/admin/imports?${qs({ limit })}`),
  toutRafraichir: () => post('/api/admin/refresh-all'),
  parametres: () => get('/api/admin/settings'),
  majParametres: (corps) => post('/api/admin/settings', corps),
};
