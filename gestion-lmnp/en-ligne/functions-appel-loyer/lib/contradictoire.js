// Fichier généré par Application/construire-fonctions.mjs — ne pas modifier à la main.

// js/contradictoire.js
var DUREE_PAR_DEFAUT = 21;
var LIBELLES_ETAT = {
  neuf: "Neuf",
  "tres-bon": "Très bon état",
  bon: "Bon état",
  usage: "État d’usage",
  mauvais: "Mauvais état"
};
var libelleEtat = (etat) => LIBELLES_ETAT[etat] || (etat ? String(etat) : "non évalué");
function finDeFenetre(dateEdl, dureeJours = DUREE_PAR_DEFAUT) {
  const d = /* @__PURE__ */ new Date(`${String(dateEdl).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + (Number(dureeJours) || DUREE_PAR_DEFAUT));
  return d.toISOString().slice(0, 10);
}
var finEnMillisecondes = (finLe) => Date.parse(`${String(finLe).slice(0, 10)}T23:59:59+02:00`);
var cheminPartage = (chemin) => `etats-des-lieux/${chemin}`;
function apercuPourColocataire(edl) {
  const photos = (liste) => (liste || []).map((p) => ({ chemin: cheminPartage(p.chemin), legende: p.legende || "" }));
  return {
    pieces: (edl.pieces || []).map((piece, index) => ({
      id: piece.id,
      numero: index + 1,
      nom: piece.nom || "Pièce",
      etatGeneral: piece.etatGeneral || "",
      commentaire: piece.commentaire || "",
      elements: (piece.elements || []).filter((e) => e.etat || e.commentaire).map((e) => ({
        cle: e.cle,
        nom: e.nom,
        etat: e.etat || "",
        commentaire: e.commentaire || ""
      })),
      meubles: (piece.meubles || []).filter((m) => m.nom).map((m) => ({
        id: m.id,
        nom: m.nom,
        quantite: m.quantite || 1,
        etat: m.etat || "",
        commentaire: m.commentaire || "",
        photos: photos(m.photos)
      })),
      photos: photos(piece.photos)
    })),
    compteurs: (edl.compteurs || []).filter((c) => c.valeur).map((c) => ({ nom: c.nom, valeur: c.valeur, unite: c.unite || "" })),
    cles: edl.cles || "",
    observations: edl.observations || ""
  };
}
function pointsDe(apercu) {
  const points = [];
  for (const piece of apercu?.pieces || []) {
    if (piece.etatGeneral || piece.commentaire) {
      points.push({ cle: `p:${piece.id}:general`, pieceId: piece.id, piece: piece.nom, libelle: "État général", etat: piece.etatGeneral, observation: piece.commentaire });
    }
    for (const element of piece.elements || []) {
      points.push({ cle: `p:${piece.id}:e:${element.cle}`, pieceId: piece.id, piece: piece.nom, libelle: element.nom, etat: element.etat, observation: element.commentaire });
    }
    for (const meuble of piece.meubles || []) {
      points.push({ cle: `p:${piece.id}:m:${meuble.id}`, pieceId: piece.id, piece: piece.nom, libelle: `${meuble.nom}${(meuble.quantite || 1) > 1 ? ` (x ${meuble.quantite})` : ""}`, etat: meuble.etat, observation: meuble.commentaire, meuble: true });
    }
  }
  if ((apercu?.compteurs || []).length || apercu?.cles) {
    points.push({ cle: "releves", pieceId: "", piece: "Relevés et clés", libelle: "Compteurs et clés remises", etat: "", observation: [
      ...(apercu.compteurs || []).map((c) => `${c.nom} : ${c.valeur}${c.unite ? ` ${c.unite}` : ""}`),
      apercu.cles ? `Clés : ${apercu.cles}` : ""
    ].filter(Boolean).join(" · ") });
  }
  return points;
}
var estRepondu = (reponse) => reponse && (reponse.accord === true || reponse.accord === false);
function bilanReponses(apercu, reponses = {}) {
  const points = pointsDe(apercu);
  const parPiece = /* @__PURE__ */ new Map();
  let repondus = 0;
  let remarques = 0;
  for (const point of points) {
    const r = reponses?.[point.cle];
    const cle = point.pieceId || "releves";
    if (!parPiece.has(cle)) parPiece.set(cle, { total: 0, repondus: 0, remarques: 0 });
    const ligne = parPiece.get(cle);
    ligne.total += 1;
    if (estRepondu(r)) {
      repondus += 1;
      ligne.repondus += 1;
    }
    if (r && r.accord === false) {
      remarques += 1;
      ligne.remarques += 1;
    }
  }
  return { total: points.length, repondus, remarques, accords: repondus - remarques, complet: points.length > 0 && repondus === points.length, parPiece };
}
function toutDaccord(apercu, reponses = {}) {
  const resultat = { ...reponses };
  for (const point of pointsDe(apercu)) {
    if (!estRepondu(resultat[point.cle])) resultat[point.cle] = { accord: true, texte: "" };
  }
  return resultat;
}
function annexeContradictoire(apercu, reponsesParLocataire = []) {
  const points = pointsDe(apercu);
  return reponsesParLocataire.map(({ nom, reponses, majLe, photos = [] }) => {
    const bilan = bilanReponses(apercu, reponses || {});
    const remarques = points.filter((p) => reponses?.[p.cle]?.accord === false).map((p) => ({ cle: p.cle, pieceId: p.pieceId, piece: p.piece, libelle: p.libelle, etat: p.etat, texte: String(reponses[p.cle].texte || "").trim() }));
    return { nom, repondLe: majLe ? String(majLe).slice(0, 10) : "", bilan, remarques, photos };
  });
}
export {
  DUREE_PAR_DEFAUT,
  LIBELLES_ETAT,
  annexeContradictoire,
  apercuPourColocataire,
  bilanReponses,
  cheminPartage,
  estRepondu,
  finDeFenetre,
  finEnMillisecondes,
  libelleEtat,
  pointsDe,
  toutDaccord
};
