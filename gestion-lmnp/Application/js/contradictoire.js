// État des lieux contradictoire : ce que le colocataire voit de l'état des
// lieux sur son espace (aperçu publié par le bailleur), les points auxquels
// il répond (d'accord / remarque), le bilan de ses réponses et l'annexe du
// rapport. Module PUR, partagé entre l'application du gérant et l'espace
// colocataire.

export const DUREE_PAR_DEFAUT = 21; // jours

export const LIBELLES_ETAT = {
  neuf: 'Neuf', 'tres-bon': 'Très bon état', bon: 'Bon état', usage: 'État d’usage', mauvais: 'Mauvais état',
};
export const libelleEtat = (etat) => LIBELLES_ETAT[etat] || (etat ? String(etat) : 'non évalué');

/** Date de fin d'une fenêtre : date de l'état des lieux + durée en jours. */
export function finDeFenetre(dateEdl, dureeJours = DUREE_PAR_DEFAUT) {
  const d = new Date(`${String(dateEdl).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + (Number(dureeJours) || DUREE_PAR_DEFAUT));
  return d.toISOString().slice(0, 10);
}

/** Fin de fenêtre en millisecondes : le jour de fin est inclus (jusqu'à minuit, heure de Paris à peu près). */
export const finEnMillisecondes = (finLe) => Date.parse(`${String(finLe).slice(0, 10)}T23:59:59+02:00`);

/** Chemin, dans l'espace « partage », de la copie d'une photo de l'état des lieux. */
export const cheminPartage = (chemin) => `etats-des-lieux/${chemin}`;

/**
 * Aperçu de l'état des lieux publié sur l'espace du colocataire : pièces,
 * postes, mobilier, photos (copiées dans l'espace « partage »), relevés.
 */
export function apercuPourColocataire(edl) {
  const photos = (liste) => (liste || []).map((p) => ({ chemin: cheminPartage(p.chemin), legende: p.legende || '' }));
  return {
    pieces: (edl.pieces || []).map((piece, index) => ({
      id: piece.id,
      numero: index + 1,
      nom: piece.nom || 'Pièce',
      etatGeneral: piece.etatGeneral || '',
      commentaire: piece.commentaire || '',
      elements: (piece.elements || []).filter((e) => e.etat || e.commentaire).map((e) => ({
        cle: e.cle, nom: e.nom, etat: e.etat || '', commentaire: e.commentaire || '',
      })),
      meubles: (piece.meubles || []).filter((m) => m.nom).map((m) => ({
        id: m.id, nom: m.nom, quantite: m.quantite || 1, etat: m.etat || '', commentaire: m.commentaire || '', photos: photos(m.photos),
      })),
      photos: photos(piece.photos),
    })),
    compteurs: (edl.compteurs || []).filter((c) => c.valeur).map((c) => ({ nom: c.nom, valeur: c.valeur, unite: c.unite || '' })),
    cles: edl.cles || '',
    observations: edl.observations || '',
  };
}

/**
 * Les points auxquels le colocataire répond : état général et postes de
 * chaque pièce, chaque meuble, et les relevés (compteurs, clés).
 * Chaque point a une clé stable, utilisée dans ses réponses.
 */
export function pointsDe(apercu) {
  const points = [];
  for (const piece of apercu?.pieces || []) {
    if (piece.etatGeneral || piece.commentaire) {
      points.push({ cle: `p:${piece.id}:general`, pieceId: piece.id, piece: piece.nom, libelle: 'État général', etat: piece.etatGeneral, observation: piece.commentaire });
    }
    for (const element of piece.elements || []) {
      points.push({ cle: `p:${piece.id}:e:${element.cle}`, pieceId: piece.id, piece: piece.nom, libelle: element.nom, etat: element.etat, observation: element.commentaire });
    }
    for (const meuble of piece.meubles || []) {
      points.push({ cle: `p:${piece.id}:m:${meuble.id}`, pieceId: piece.id, piece: piece.nom, libelle: `${meuble.nom}${(meuble.quantite || 1) > 1 ? ` (x ${meuble.quantite})` : ''}`, etat: meuble.etat, observation: meuble.commentaire, meuble: true });
    }
  }
  if ((apercu?.compteurs || []).length || apercu?.cles) {
    points.push({ cle: 'releves', pieceId: '', piece: 'Relevés et clés', libelle: 'Compteurs et clés remises', etat: '', observation: [
      ...(apercu.compteurs || []).map((c) => `${c.nom} : ${c.valeur}${c.unite ? ` ${c.unite}` : ''}`),
      apercu.cles ? `Clés : ${apercu.cles}` : '',
    ].filter(Boolean).join(' · ') });
  }
  return points;
}

/** Une réponse est « d'accord » (accord: true) ou une « remarque » (accord: false, texte). */
export const estRepondu = (reponse) => reponse && (reponse.accord === true || reponse.accord === false);

/** Bilan des réponses d'un colocataire sur l'aperçu. */
export function bilanReponses(apercu, reponses = {}) {
  const points = pointsDe(apercu);
  const parPiece = new Map();
  let repondus = 0;
  let remarques = 0;
  for (const point of points) {
    const r = reponses?.[point.cle];
    const cle = point.pieceId || 'releves';
    if (!parPiece.has(cle)) parPiece.set(cle, { total: 0, repondus: 0, remarques: 0 });
    const ligne = parPiece.get(cle);
    ligne.total += 1;
    if (estRepondu(r)) { repondus += 1; ligne.repondus += 1; }
    if (r && r.accord === false) { remarques += 1; ligne.remarques += 1; }
  }
  return { total: points.length, repondus, remarques, accords: repondus - remarques, complet: points.length > 0 && repondus === points.length, parPiece };
}

/** Les réponses complétées : tout point sans réponse devient « d'accord ». */
export function toutDaccord(apercu, reponses = {}) {
  const resultat = { ...reponses };
  for (const point of pointsDe(apercu)) {
    if (!estRepondu(resultat[point.cle])) resultat[point.cle] = { accord: true, texte: '' };
  }
  return resultat;
}

/**
 * Annexe du rapport : pour chaque colocataire, la date de réponse, le nombre
 * de points d'accord et la liste des remarques (pièce, point, texte).
 */
export function annexeContradictoire(apercu, reponsesParLocataire = []) {
  const points = pointsDe(apercu);
  return reponsesParLocataire.map(({ nom, reponses, majLe, photos = [] }) => {
    const bilan = bilanReponses(apercu, reponses || {});
    const remarques = points
      .filter((p) => reponses?.[p.cle]?.accord === false)
      .map((p) => ({ cle: p.cle, pieceId: p.pieceId, piece: p.piece, libelle: p.libelle, etat: p.etat, texte: String(reponses[p.cle].texte || '').trim() }));
    return { nom, repondLe: majLe ? String(majLe).slice(0, 10) : '', bilan, remarques, photos };
  });
}
