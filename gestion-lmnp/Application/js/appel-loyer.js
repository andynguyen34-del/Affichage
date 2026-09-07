// Appel de loyer : le courriel envoyé à chaque colocataire pour l'échéance du
// mois (montant de sa part, reste dû, date limite, moyens de paiement).
// Module PUR, partagé entre l'application (test, envoi manuel, envoi à
// l'ouverture) et la fonction planifiée côté serveur : même calcul, même texte.

import { echeancesGlobales, totalEncaisse } from './calculs/loyers.js';
import { montant, nomMois, dateLongue, centimes } from './format.js';

export const APPEL_PAR_DEFAUT = {
  actif: false,
  jour: 1, // jour du mois de l'envoi (1 à 28)
  cible: 'courant', // 'courant' : le loyer du mois de l'envoi ; 'suivant' : celui du mois d'après
  objet: 'Appel de loyer — {mois} {annee}',
  message: '',
  paiement: '',
  copieBailleur: true,
};

export const cleMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}`;

/** Le mois dont on appelle le loyer, pour un envoi à cette date. */
export function moisVise(dateIso, cible = 'courant') {
  let annee = Number(dateIso.slice(0, 4));
  let mois = Number(dateIso.slice(5, 7));
  if (cible === 'suivant') { mois += 1; if (mois > 12) { mois = 1; annee += 1; } }
  return { annee, mois };
}

/** Le jour d'envoi, ramené au dernier jour du mois s'il n'existe pas (30 février…). */
export function jourEnvoi(reglage, annee, mois) {
  const dernier = new Date(annee, mois, 0).getDate();
  return Math.min(Math.max(1, Number(reglage.jour) || 1), dernier);
}

/** Fenêtre de rattrapage : l'appel part encore jusqu'à 7 jours après le jour réglé. */
export const JOURS_RATTRAPAGE = 7;

/**
 * Faut-il envoyer aujourd'hui ? Oui si l'appel est actif, si l'on est au jour
 * réglé ou dans les 7 jours qui suivent (l'envoi n'est pas perdu si le poste
 * était éteint ce jour-là — mais activer la fonction en fin de mois n'envoie
 * pas l'appel du mois en retard), et si le mois visé n'a pas déjà été appelé.
 */
export function doitEnvoyer(reglage, dateIso, historique = {}) {
  const r = { ...APPEL_PAR_DEFAUT, ...(reglage || {}) };
  if (!r.actif) return false;
  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  const jour = Number(dateIso.slice(8, 10));
  const cible = jourEnvoi(r, annee, mois);
  if (jour < cible || jour > cible + JOURS_RATTRAPAGE) return false;
  const vise = moisVise(dateIso, r.cible);
  return !(historique?.envois || {})[cleMois(vise.annee, vise.mois)];
}

const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const remplir = (gabarit, valeurs) => String(gabarit || '')
  .replace(/\{(\w+)\}/g, (tout, cle) => (valeurs[cle] !== undefined ? valeurs[cle] : tout));

const nomComplet = (l) => `${l?.prenom || ''} ${l?.nom || ''}`.trim();
const adresseBien = (bien) => [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/**
 * Prépare les courriels d'appel de loyer d'un mois : un par colocataire ayant
 * une échéance non soldée. Renvoie aussi les colocataires laissés de côté
 * (déjà réglé, sans adresse) pour le compte rendu.
 */
export function preparerAppels({ baux = [], locataires = [], loyers = [], biens = [], parametres = {}, annee, mois }) {
  const reglage = { ...APPEL_PAR_DEFAUT, ...(parametres.appelLoyer || {}) };
  const bailleurs = (parametres.bailleurs || []).filter((b) => b?.nom);
  const signature = bailleurs.map((b) => b.nom).join(' et ') || parametres.nomActivite || 'Le bailleur';
  const courriels = [];
  const ecartes = [];
  const echeances = echeancesGlobales(baux, annee, loyers).filter((e) => Number(e.mois) === Number(mois) && (Number(e.total) || 0) > 0);
  for (const echeance of echeances) {
    const locataire = locataires.find((l) => l.id === echeance.locataireId);
    const nom = nomComplet(locataire) || 'colocataire';
    const reste = centimes((Number(echeance.total) || 0) - totalEncaisse(echeance));
    if (reste <= 0.005) { ecartes.push({ nom, raison: 'déjà réglé' }); continue; }
    const destinataires = [locataire?.email, locataire?.email2].map((e) => String(e || '').trim()).filter(Boolean);
    if (!destinataires.length) { ecartes.push({ nom, raison: 'aucune adresse e-mail' }); continue; }
    const bail = baux.find((b) => b.id === echeance.bailId);
    const bien = biens.find((b) => b.id === bail?.bienId);
    const valeurs = {
      prenom: locataire?.prenom || nom, nom, mois: nomMois(mois), annee,
      montant: montant(reste), total: montant(echeance.total), date: dateLongue(echeance.dateEcheance),
      logement: adresseBien(bien) || bien?.nom || 'le logement', activite: parametres.nomActivite || '',
    };
    const sujet = remplir(reglage.objet || APPEL_PAR_DEFAUT.objet, valeurs);
    const partiel = totalEncaisse(echeance) > 0.005;
    const lignes = [
      `<p>Bonjour ${echapper(valeurs.prenom)},</p>`,
      `<p>Voici l’appel de loyer pour <strong>${echapper(valeurs.mois)} ${annee}</strong>, `
        + `pour le logement situé ${echapper(valeurs.logement)}${echeance.partiel ? ' (mois partiel, calculé au prorata)' : ''} :</p>`,
      '<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ccd">',
      `<tr><td>Loyer hors charges</td><td align="right">${echapper(montant(echeance.loyerHc))}</td></tr>`,
      `<tr><td>Provision pour charges (eau, ordures ménagères)</td><td align="right">${echapper(montant(echeance.charges))}</td></tr>`,
      echeance.autres ? `<tr><td>Autres sommes</td><td align="right">${echapper(montant(echeance.autres))}</td></tr>` : '',
      `<tr><td><strong>Total du mois</strong></td><td align="right"><strong>${echapper(montant(echeance.total))}</strong></td></tr>`,
      partiel ? `<tr><td>Déjà reçu</td><td align="right">${echapper(montant(totalEncaisse(echeance)))}</td></tr>`
        + `<tr><td><strong>Reste à régler</strong></td><td align="right"><strong>${echapper(montant(reste))}</strong></td></tr>` : '',
      '</table>',
      `<p>Montant à régler : <strong>${echapper(montant(reste))}</strong>, au plus tard le <strong>${echapper(valeurs.date)}</strong>.</p>`,
      reglage.paiement ? `<p>${echapper(remplir(reglage.paiement, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
      reglage.message ? `<p>${echapper(remplir(reglage.message, valeurs)).replace(/\n/g, '<br>')}</p>` : '',
      '<p>Si le règlement a déjà été fait, merci de ne pas tenir compte de ce message.</p>',
      `<p>Cordialement,<br>${echapper(signature)}${parametres.nomActivite ? `<br>${echapper(parametres.nomActivite)}` : ''}</p>`,
    ];
    courriels.push({
      locataireId: echeance.locataireId, nom, destinataires, sujet,
      html: lignes.filter(Boolean).join('\n'),
      montantDu: reste, dateLimite: echeance.dateEcheance,
    });
  }
  return { courriels, ecartes, reglage };
}
