// Fichier généré par Application/construire-fonctions.mjs — ne pas modifier à la main.

// js/courriel-enveloppe.js
var TYPES_COPIE = [
  { cle: "appels", libelle: "Appels de loyer" },
  { cle: "depots", libelle: "Dépôts de garantie (appels, reçus)" },
  { cle: "documents", libelle: "Quittances, décomptes, bail, restitutions" },
  { cle: "justificatifs", libelle: "Rappels de justificatifs" },
  { cle: "contradictoire", libelle: "État des lieux contradictoire, signatures" },
  { cle: "bienvenue", libelle: "Bienvenue, accès à l’espace" }
];
var ADRESSE_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normaliserAdresses(liste) {
  const brut = Array.isArray(liste) ? liste : String(liste || "").split(/[,;\s]+/);
  const vues = /* @__PURE__ */ new Set();
  const resultat = [];
  for (const element of brut) {
    const adresse = String(element || "").trim().toLowerCase();
    if (!adresse || !ADRESSE_VALIDE.test(adresse) || vues.has(adresse)) continue;
    vues.add(adresse);
    resultat.push(adresse);
  }
  return resultat;
}
function decomposerExpediteur(texte) {
  const t = String(texte || "").trim();
  const m = t.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { nom: m[1].trim().replace(/^"|"$/g, ""), adresse: m[2].trim() };
  return { nom: "", adresse: t };
}
var formaterExpediteur = (nom, adresse) => adresse ? nom ? `${nom} <${adresse}>` : adresse : nom || "";
function composerEnveloppe({ reglage = {}, type = "", destinataires = [], expediteurParDefaut = "" } = {}) {
  const defaut = decomposerExpediteur(expediteurParDefaut);
  const nom = String(reglage?.expediteurNom || "").trim();
  const adresse = String(reglage?.expediteurAdresse || "").trim().toLowerCase();
  const from = adresse && ADRESSE_VALIDE.test(adresse) ? formaterExpediteur(nom || defaut.nom, adresse) : formaterExpediteur(nom || defaut.nom, defaut.adresse);
  const reponse = String(reglage?.reponseA || "").trim().toLowerCase();
  const replyTo = ADRESSE_VALIDE.test(reponse) ? reponse : "";
  const exclus = new Set(normaliserAdresses(destinataires));
  const copies = TYPES_COPIE.some((t) => t.cle === type) ? normaliserAdresses(reglage?.copies?.[type] || []) : [];
  return { from, replyTo, cc: copies.filter((a) => !exclus.has(a)) };
}
function securiserEnveloppe(enveloppe = {}, compte = "") {
  const compteNet = String(compte || "").trim().toLowerCase();
  const { nom, adresse } = decomposerExpediteur(enveloppe.from || "");
  if (!compteNet || !adresse || adresse.toLowerCase() === compteNet) return { ...enveloppe, remplace: "" };
  return {
    ...enveloppe,
    from: formaterExpediteur(nom, compteNet),
    replyTo: enveloppe.replyTo || adresse.toLowerCase(),
    remplace: adresse.toLowerCase()
  };
}
function expediteurCoherent(reglage = {}, compte = "") {
  const adresse = String(reglage?.expediteurAdresse || "").trim().toLowerCase();
  if (!adresse) return null;
  return adresse === String(compte || "").trim().toLowerCase();
}
export {
  ADRESSE_VALIDE,
  TYPES_COPIE,
  composerEnveloppe,
  decomposerExpediteur,
  expediteurCoherent,
  formaterExpediteur,
  normaliserAdresses,
  securiserEnveloppe
};
