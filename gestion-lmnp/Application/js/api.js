// Accès au serveur local : lecture et écriture des fichiers du dossier partagé.

async function json(reponse) {
  const texte = await reponse.text();
  if (!texte) return null;
  try { return JSON.parse(texte); }
  catch { throw new Error('Réponse illisible du serveur.'); }
}

export async function lireEtat() {
  const reponse = await fetch('/api/etat');
  if (!reponse.ok) throw new Error('Le serveur local ne répond pas.');
  return json(reponse);
}

export async function lireCollection(nom) {
  const reponse = await fetch(`/api/donnees/${nom}`);
  if (!reponse.ok) throw new Error(`Lecture de ${nom}.json impossible.`);
  return json(reponse);
}

/**
 * Écrit une collection si personne ne l'a modifiée entre-temps.
 * Renvoie { ok: true, version } ou { conflit: true, version, contenu }.
 */
export async function ecrireCollection(nom, version, contenu) {
  const reponse = await fetch(`/api/donnees/${nom}?version=${encodeURIComponent(version || '')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contenu, null, 2),
  });
  const corps = await json(reponse);
  if (reponse.status === 409) {
    return { conflit: true, version: corps.version, contenu: corps.contenu };
  }
  if (!reponse.ok) throw new Error(corps?.erreur || `Écriture de ${nom}.json impossible.`);
  return { ok: true, version: corps.version };
}

export async function listerFichiers(espace) {
  const reponse = await fetch(`/api/fichiers?espace=${encodeURIComponent(espace)}`);
  if (!reponse.ok) throw new Error(`Lecture du dossier ${espace} impossible.`);
  return (await json(reponse)).elements;
}

export async function deposerFichier(espace, chemin, fichier) {
  const reponse = await fetch(`/api/fichiers?espace=${encodeURIComponent(espace)}&chemin=${encodeURIComponent(chemin)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fichier,
  });
  const corps = await json(reponse);
  if (!reponse.ok) throw new Error(corps?.erreur || 'Dépôt du fichier impossible.');
  return corps;
}

/** Déplace un fichier (rangement automatique des factures traitées). */
export async function deplacerFichier(espace, chemin, espaceCible, cible) {
  const requete = new URLSearchParams({ espace, chemin, espaceCible, cible });
  const reponse = await fetch(`/api/fichiers/deplacer?${requete}`, { method: 'POST' });
  const corps = await json(reponse);
  if (!reponse.ok) throw new Error(corps?.erreur || 'Déplacement impossible.');
  return corps;
}

export async function supprimerFichier(espace, chemin) {
  const requete = new URLSearchParams({ espace, chemin });
  const reponse = await fetch(`/api/fichiers?${requete}`, { method: 'DELETE' });
  if (!reponse.ok) {
    const corps = await json(reponse);
    throw new Error(corps?.erreur || 'Suppression impossible.');
  }
}

/** Adresse de consultation d'un fichier rangé dans l'application. */
export function urlFichier(espace, chemin) {
  const morceaux = String(chemin).split('/').map(encodeURIComponent).join('/');
  return `/fichier/${encodeURIComponent(espace)}/${morceaux}`;
}

export async function arreter() {
  try { await fetch('/api/arret', { method: 'POST' }); } catch { /* le serveur se ferme */ }
}
