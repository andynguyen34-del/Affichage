// Fichier généré par Application/construire-fonctions.mjs — ne pas modifier à la main.

// js/format.js
var MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre"
];
var nomMois = (mois) => MOIS[mois - 1] || "";
var euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
var eurosRonds = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
var nombres = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
function montant(valeur, options = {}) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return "—";
  if (options.rond) return eurosRonds.format(n);
  return euros.format(n);
}
function dateLongue(iso) {
  if (!iso) return "—";
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  if (!a || !m || !j) return String(iso);
  return `${Number(j)} ${nomMois(Number(m))} ${a}`;
}
function isoDepuis(annee, mois, jour) {
  const dernierJour = new Date(annee, mois, 0).getDate();
  const j = Math.min(Math.max(1, jour || 1), dernierJour);
  return `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}
function centimes(valeur) {
  return Math.round((Number(valeur) + Number.EPSILON) * 100) / 100;
}

// js/calculs/loyers.js
var dernierJourDuMois = (annee, mois) => new Date(annee, mois, 0).getDate();
function proportionDuMois(bail, annee, mois) {
  const jours = dernierJourDuMois(annee, mois);
  const debutMois = isoDepuis(annee, mois, 1);
  const finMois = isoDepuis(annee, mois, jours);
  const debutBail = String(bail.dateDebut || "").slice(0, 10);
  const finBail = String(bail.dateFin || "").slice(0, 10);
  if (!debutBail || debutBail > finMois) return 0;
  if (finBail && finBail < debutMois) return 0;
  const premier = debutBail > debutMois ? Number(debutBail.slice(8, 10)) : 1;
  const dernier = finBail && finBail < finMois ? Number(finBail.slice(8, 10)) : jours;
  const couverts = dernier - premier + 1;
  if (couverts <= 0) return 0;
  return couverts / jours;
}
function fluxDuBail(bail) {
  const colocataires = Array.isArray(bail.colocataires) ? bail.colocataires.filter((c) => c && c.locataireId) : [];
  if (colocataires.length) {
    return colocataires.map((c) => ({
      locataireId: c.locataireId,
      loyerHc: Number(c.partLoyer) || 0,
      charges: Number(c.partCharges) || 0,
      // Le suffixe rend l'identifiant d'échéance propre à chaque colocataire.
      suffixe: `-${String(c.locataireId).slice(0, 8)}`
    }));
  }
  return [{
    locataireId: bail.locataireId || "",
    loyerHc: Number(bail.loyerHc) || 0,
    charges: Number(bail.provisionCharges) || 0,
    suffixe: ""
  }];
}
function echeancesTheoriques(bail, annee) {
  const lignes = [];
  const flux = fluxDuBail(bail);
  for (let mois = 1; mois <= 12; mois += 1) {
    const proportion = proportionDuMois(bail, annee, mois);
    if (proportion <= 0) continue;
    let dateEcheance = isoDepuis(annee, mois, Number(bail.jourEcheance) || 1);
    const debutBail = String(bail.dateDebut || "").slice(0, 10);
    const finBail = String(bail.dateFin || "").slice(0, 10);
    if (debutBail && dateEcheance < debutBail) dateEcheance = debutBail;
    if (finBail && dateEcheance > finBail) dateEcheance = finBail;
    for (const payeur of flux) {
      const loyerHc = centimes(payeur.loyerHc * proportion);
      const charges = centimes(payeur.charges * proportion);
      lignes.push({
        // Identifiant déterministe : deux postes qui « créent » le même mois
        // visent le même enregistrement, jamais deux doublons.
        id: `${bail.id}-${annee}-${String(mois).padStart(2, "0")}${payeur.suffixe}`,
        bailId: bail.id,
        locataireId: payeur.locataireId,
        annee,
        mois,
        proportion,
        partiel: proportion < 1,
        dateEcheance,
        loyerHc,
        charges,
        autres: 0,
        total: centimes(loyerHc + charges)
      });
    }
  }
  return lignes;
}
var totalEncaisse = (echeance) => centimes((echeance?.encaissements || []).reduce((somme, e) => somme + (Number(e.montant) || 0), 0));
function echeancesAnnee(bail, annee, loyersEnregistres) {
  const parId = /* @__PURE__ */ new Map();
  for (const loyer of loyersEnregistres) {
    if (loyer.bailId === bail.id && Number(loyer.annee) === Number(annee)) parId.set(loyer.id, loyer);
  }
  const lignes = echeancesTheoriques(bail, annee).map((theorique) => {
    const reel = parId.get(theorique.id);
    if (!reel) return { ...theorique, encaissements: [], enregistre: false };
    parId.delete(theorique.id);
    const loyerHc = reel.loyerHc ?? theorique.loyerHc;
    const charges = reel.charges ?? theorique.charges;
    const autres = reel.autres ?? 0;
    return {
      ...theorique,
      ...reel,
      loyerHc,
      charges,
      autres,
      total: centimes(loyerHc + charges + autres),
      enregistre: true
    };
  });
  for (const reste of parId.values()) {
    const loyerHc = reste.loyerHc ?? 0;
    const charges = reste.charges ?? 0;
    const autres = reste.autres ?? 0;
    lignes.push({
      ...reste,
      proportion: 1,
      partiel: false,
      horsBail: true,
      enregistre: true,
      total: centimes(loyerHc + charges + autres)
    });
  }
  return lignes.sort((a, b) => a.mois - b.mois);
}
function echeancesGlobales(baux, annee, loyersEnregistres) {
  return baux.flatMap((bail) => echeancesAnnee(bail, annee, loyersEnregistres));
}

// js/appel-loyer.js
var APPEL_PAR_DEFAUT = {
  actif: false,
  jour: 1,
  // jour du mois de l'envoi (1 à 28)
  cible: "courant",
  // 'courant' : le loyer du mois de l'envoi ; 'suivant' : celui du mois d'après
  objet: "Appel de loyer — {mois} {annee}",
  message: "",
  paiement: "",
  copieBailleur: true
};
var cleMois = (annee, mois) => `${annee}-${String(mois).padStart(2, "0")}`;
function moisVise(dateIso, cible = "courant") {
  let annee = Number(dateIso.slice(0, 4));
  let mois = Number(dateIso.slice(5, 7));
  if (cible === "suivant") {
    mois += 1;
    if (mois > 12) {
      mois = 1;
      annee += 1;
    }
  }
  return { annee, mois };
}
function jourEnvoi(reglage, annee, mois) {
  const dernier = new Date(annee, mois, 0).getDate();
  return Math.min(Math.max(1, Number(reglage.jour) || 1), dernier);
}
var JOURS_RATTRAPAGE = 7;
function doitEnvoyer(reglage, dateIso, historique = {}) {
  const r = { ...APPEL_PAR_DEFAUT, ...reglage || {} };
  if (!r.actif) return false;
  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  const jour = Number(dateIso.slice(8, 10));
  const cible = jourEnvoi(r, annee, mois);
  if (jour < cible || jour > cible + JOURS_RATTRAPAGE) return false;
  const vise = moisVise(dateIso, r.cible);
  return !(historique?.envois || {})[cleMois(vise.annee, vise.mois)];
}
var echapper = (texte) => String(texte ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var remplir = (gabarit, valeurs) => String(gabarit || "").replace(/\{(\w+)\}/g, (tout, cle) => valeurs[cle] !== void 0 ? valeurs[cle] : tout);
var nomComplet = (l) => `${l?.prenom || ""} ${l?.nom || ""}`.trim();
var adresseBien = (bien) => [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
function preparerAppels({ baux = [], locataires = [], loyers = [], biens = [], parametres = {}, annee, mois }) {
  const reglage = { ...APPEL_PAR_DEFAUT, ...parametres.appelLoyer || {} };
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  const signature = bailleurs.map((b) => b.nom).join(" et ") || parametres.nomActivite || "Le bailleur";
  const courriels = [];
  const ecartes = [];
  const echeances = echeancesGlobales(baux, annee, loyers).filter((e) => Number(e.mois) === Number(mois) && (Number(e.total) || 0) > 0);
  for (const echeance of echeances) {
    const locataire = locataires.find((l) => l.id === echeance.locataireId);
    const nom = nomComplet(locataire) || "colocataire";
    const reste = centimes((Number(echeance.total) || 0) - totalEncaisse(echeance));
    if (reste <= 5e-3) {
      ecartes.push({ nom, raison: "déjà réglé" });
      continue;
    }
    const destinataires = [locataire?.email, locataire?.email2].map((e) => String(e || "").trim()).filter(Boolean);
    if (!destinataires.length) {
      ecartes.push({ nom, raison: "aucune adresse e-mail" });
      continue;
    }
    const bail = baux.find((b) => b.id === echeance.bailId);
    const bien = biens.find((b) => b.id === bail?.bienId);
    const valeurs = {
      prenom: locataire?.prenom || nom,
      nom,
      mois: nomMois(mois),
      annee,
      montant: montant(reste),
      total: montant(echeance.total),
      date: dateLongue(echeance.dateEcheance),
      logement: adresseBien(bien) || bien?.nom || "le logement",
      activite: parametres.nomActivite || ""
    };
    const sujet = remplir(reglage.objet || APPEL_PAR_DEFAUT.objet, valeurs);
    const partiel = totalEncaisse(echeance) > 5e-3;
    const lignes = [
      `<p>Bonjour ${echapper(valeurs.prenom)},</p>`,
      `<p>Voici l’appel de loyer pour <strong>${echapper(valeurs.mois)} ${annee}</strong>, pour le logement situé ${echapper(valeurs.logement)}${echeance.partiel ? " (mois partiel, calculé au prorata)" : ""} :</p>`,
      '<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ccd">',
      `<tr><td>Loyer hors charges</td><td align="right">${echapper(montant(echeance.loyerHc))}</td></tr>`,
      `<tr><td>Provision pour charges (eau, ordures ménagères)</td><td align="right">${echapper(montant(echeance.charges))}</td></tr>`,
      echeance.autres ? `<tr><td>Autres sommes</td><td align="right">${echapper(montant(echeance.autres))}</td></tr>` : "",
      `<tr><td><strong>Total du mois</strong></td><td align="right"><strong>${echapper(montant(echeance.total))}</strong></td></tr>`,
      partiel ? `<tr><td>Déjà reçu</td><td align="right">${echapper(montant(totalEncaisse(echeance)))}</td></tr><tr><td><strong>Reste à régler</strong></td><td align="right"><strong>${echapper(montant(reste))}</strong></td></tr>` : "",
      "</table>",
      `<p>Montant à régler : <strong>${echapper(montant(reste))}</strong>, au plus tard le <strong>${echapper(valeurs.date)}</strong>.</p>`,
      reglage.paiement ? `<p>${echapper(remplir(reglage.paiement, valeurs)).replace(/\n/g, "<br>")}</p>` : "",
      reglage.message ? `<p>${echapper(remplir(reglage.message, valeurs)).replace(/\n/g, "<br>")}</p>` : "",
      "<p>Si le règlement a déjà été fait, merci de ne pas tenir compte de ce message.</p>",
      `<p>Cordialement,<br>${echapper(signature)}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ""}</p>`
    ];
    courriels.push({
      locataireId: echeance.locataireId,
      nom,
      destinataires,
      sujet,
      html: lignes.filter(Boolean).join("\n"),
      montantDu: reste,
      dateLimite: echeance.dateEcheance
    });
  }
  return { courriels, ecartes, reglage };
}
export { nomMois, 
  APPEL_PAR_DEFAUT,
  JOURS_RATTRAPAGE,
  cleMois,
  doitEnvoyer,
  jourEnvoi,
  moisVise,
  preparerAppels
};
