// Virements des colocataires, échéances mensuelles et quittances.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer, groupeRepliable,
  barreOutils, notifier, ouvrirModale, fermerModale, signalerErreur, ligneTotal, choisirFichier } from '../ui.js';
import { montant, date, nomMois, dateLongue, aujourdhui, centimes, isoDepuis, nomFichierTelechargement } from '../format.js';
import * as calcul from '../calculs/loyers.js';
import { ouvrirMiseAJour, bandeauMiseAJour } from './maj-ui.js';
import { imprimerQuittance, imprimerAvis, imprimerReleve, imprimerReleveMois, imprimerReleveGerance } from '../impression.js';
import { pdfQuittanceAnika, dateLongueFr, sirenDepuisSiret, formaterSiret } from '../pdf-anika.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';
import { estCourteDuree, estGracieux, estAgence, teinteLogement, libelleTypeLocation, sejoursDe, gabaritSejour, nuitsEntre, phaseSejour, PLATEFORMES } from '../logements.js';
import { lignesAnnee, totauxAnnee, honorairesProposes, netDe, resumeGerance, LIBELLES_ETAT_MOIS } from '../gerance.js';
import { cheminDocument, nomDuChemin } from '../documents-logement.js';
import { apercuAppels, apercuAppelEcheance, envoyerAppelEcheance, envoyerAppels, lireJournalAppels, reglageAppel, logementsAvecAppel } from '../appel-loyer-client.js';
import { resumeAppels, moisVise, sansAppel } from '../appel-loyer.js';
import { numeroQuittance, soldeAnterieur, dernierReglement } from '../quittance.js';

// ------------------------------------------------ appels de loyer (v49)
// Le journal des appels (systeme/appels-loyer) est lu à l'affichage de la
// page ; la page est redessinée dès qu'il arrive.
let journalAppels = null;
let journalDemande = 0;

function chargerJournalAppels(contexte) {
  const demande = Date.now();
  journalDemande = demande;
  lireJournalAppels().then((journal) => {
    if (journalDemande !== demande) return;
    journalAppels = journal || { envois: {}, personnes: {} };
    contexte.redessiner?.({ conserverPosition: true });
  }).catch((erreur) => console.warn('Journal des appels illisible :', erreur));
}

/** Sous le mois : « ✉ appelé le … · relancé le … ». */
function traceAppels(echeance) {
  const resume = resumeAppels(journalAppels, echeance.id);
  if (!resume) return null;
  const morceaux = [`✉ appelé le ${date(String(resume.premier.le).slice(0, 10))}`];
  if (resume.derniereRelance) morceaux.push(`relancé le ${date(String(resume.derniereRelance.le).slice(0, 10))}`);
  return h('div', { class: 'legende trace-appels', texte: morceaux.join(' · ') });
}

/**
 * Appel ou relance d'une échéance depuis la page (v49) : aperçu de l'e-mail,
 * envoi, journal par personne, échéance sur l'espace du colocataire.
 */
async function appelerEcheance(contexte, echeance, { relance = false } = {}) {
  const journal = journalAppels || await lireJournalAppels();
  const courriel = apercuAppelEcheance({ echeance, relance, journal });
  if (!courriel) { notifier('Rien à appeler : échéance soldée ou colocataire sans adresse e-mail (Locataires → Modifier).', 'erreur'); return; }
  const apercu = h('div', { class: 'apercu-courriel', style: 'border:1px solid var(--bordure);border-radius:6px;padding:.4rem .8rem;margin-top:.6rem;max-height:24rem;overflow:auto;background:var(--fond-carte)' });
  apercu.append(h('div', { class: 'legende', style: 'margin:.3rem 0', texte: `Objet : ${courriel.sujet}` }));
  const corps = h('div');
  corps.innerHTML = courriel.html;
  apercu.append(corps);
  await new Promise((resoudre) => {
    const fermer = ouvrirModale({
      titre: `${relance ? 'Relancer l’appel de loyer' : 'Appel de loyer'} — ${courriel.nom} — ${nomMois(echeance.mois)} ${echeance.annee}`,
      large: true,
      surFermeture: () => resoudre(),
      corps: h('div', {}, [
        h('p', { class: 'legende', texte: `E-mail à ${courriel.destinataires.join(', ')} : reste à régler ${montant(courriel.montantDu)}, échéance du ${date(echeance.dateEcheance)}. `
          + 'Texte et coordonnées de paiement : Paramètres → Appel de loyer du logement.' }),
        apercu,
      ]),
      pied: [
        bouton('Annuler', () => { fermer(); resoudre(); }),
        bouton(relance ? 'Envoyer la relance' : 'Envoyer l’appel', async () => {
          fermer({ valide: true });
          try {
            await envoyerAppelEcheance({ echeance, relance });
            notifier(`${relance ? 'Relance' : 'Appel de loyer'} envoyé à ${courriel.nom} (${nomMois(echeance.mois)} ${echeance.annee}).`, 'succes');
            chargerJournalAppels(contexte);
          } catch (erreur) { signalerErreur(erreur); }
          resoudre();
        }, { type: 'primaire' }),
      ],
    });
  });
}

/**
 * Régénère les quittances déjà émises de l'année affichée (v51) au format
 * enrichi : PDF refait et redéposé sur l'espace du colocataire, même nom de
 * fichier (le précédent est remplacé), sans nouvel e-mail.
 */
function boutonRegenererQuittances(contexte, donnees, toutes) {
  if (api.MODE !== 'nuage') return null;
  const emises = toutes.filter((e) => e.quittanceEmiseLe && !e.horsBail);
  if (!emises.length) return null;
  return bouton(`Régénérer les quittances émises (${emises.length})`, async () => {
    const ok = await confirmer({
      titre: `Régénérer ${emises.length} quittance(s)`,
      message: `Les quittances déjà émises en ${contexte.annee} sont refaites au format actuel (numéro, bail, périodes, règlement) et redéposées sur l’espace de chaque colocataire, sans nouvel e-mail. `
        + `Concernées : ${emises.map((e) => `${nomDe(locataireDe(donnees, e, donnees.baux.find((b) => b.id === e.bailId)))} — ${nomMois(e.mois)} ${e.annee}`).join(' ; ')}.`,
      libelleValider: 'Régénérer',
    });
    if (!ok) return;
    let faites = 0;
    let rang = 0;
    for (const echeance of emises) {
      rang += 1;
      const bail = donnees.baux.find((b) => b.id === echeance.bailId);
      notifier(`Quittance ${rang}/${emises.length} : ${nomMois(echeance.mois)} ${echeance.annee}…`);
      // Un dépôt qui ne répond plus (stockage) ne doit pas bloquer la suite : 90 s au plus par quittance.
      const garde = new Promise((_, rejeter) => { setTimeout(() => rejeter(new Error(`Quittance de ${nomMois(echeance.mois)} ${echeance.annee} : le dépôt sur l’espace ne répond pas (90 s). Réessayez plus tard.`)), 90000); });
      // eslint-disable-next-line no-await-in-loop
      const resultat = await Promise.race([genererQuittance(donnees, bail, echeance), garde]).catch((erreur) => { signalerErreur(erreur); return null; });
      if (resultat?.publie) faites += 1;
    }
    notifier(`${faites} quittance(s) régénérée(s) et redéposée(s) sur les espaces.`, faites ? 'succes' : 'erreur');
  }, { titre: 'Refait les PDF des quittances déjà émises au format actuel et les redépose sur les espaces, sans e-mail' });
}

/** Le bouton « Appeler le loyer de {mois} (n) » : tous les colocataires pas encore appelés, logement choisi ou tous. */
function boutonAppelDuMois(contexte, donnees) {
  if (api.MODE !== 'nuage') return null;
  const logements = (contexte.bienId ? donnees.biens.filter((b) => b.id === contexte.bienId) : donnees.biens).filter((b) => !sansAppel(b));
  if (!logements.length) return null;
  const journal = journalAppels || { envois: {}, personnes: {} };
  const plans = logements.map((bien) => {
    const vise = moisVise(aujourdhui(), reglageAppel(bien).cible);
    return { bien, vise, ...apercuAppels({ bienId: bien.id, ...vise, journal }) };
  });
  const total = plans.reduce((s, p) => s + p.courriels.length, 0);
  const mois = plans[0].vise;
  return bouton(`Appeler le loyer de ${nomMois(mois.mois)} (${total})`, async () => {
    if (!journalAppels) await new Promise((r) => { lireJournalAppels().then((j) => { journalAppels = j || { envois: {}, personnes: {} }; r(); }).catch(r); });
    if (!total) { notifier(`Personne à appeler pour ${nomMois(mois.mois)} ${mois.annee} : chacun a déjà reçu son appel, a réglé, ou n’a pas d’adresse.`); return; }
    const lignes = plans.flatMap((p) => p.courriels.map((c) => `${c.nom} — ${montant(c.montantDu)}${logements.length > 1 ? ` (${p.bien.nom})` : ''}`));
    const ecartes = plans.flatMap((p) => p.ecartes.map((e) => `${e.nom} (${e.raison})`));
    const ok = await confirmer({
      titre: `Appeler le loyer de ${nomMois(mois.mois)} ${mois.annee}`,
      message: `${total} e-mail(s) : ${lignes.join(' ; ')}.${ecartes.length ? ` Non concernés : ${ecartes.join(', ')}.` : ''}`,
      libelleValider: 'Envoyer les appels',
    });
    if (!ok) return;
    let envoyes = 0;
    for (const p of plans) {
      if (!p.courriels.length) continue;
      // eslint-disable-next-line no-await-in-loop
      const resultat = await executer(envoyerAppels({ bienId: p.bien.id, ...p.vise, origine: 'manuel (page Loyers)', force: true }), null);
      if (resultat) envoyes += resultat.envoyes;
    }
    notifier(`${envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(mois.mois)} ${mois.annee}.`, envoyes ? 'succes' : 'erreur');
    chargerJournalAppels(contexte);
  }, { type: total ? 'primaire' : undefined, titre: 'Un e-mail d’appel de loyer à chaque colocataire du logement pas encore appelé pour ce mois' });
}

const locataireDe = (donnees, echeance, bail) =>
  donnees.locataires.find((l) => l.id === (echeance?.locataireId || bail?.locataireId)) || null;

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

const gabaritEcheance = (echeance) => ({
  id: echeance.id,
  bailId: echeance.bailId,
  locataireId: echeance.locataireId || '',
  annee: echeance.annee,
  mois: echeance.mois,
  dateEcheance: echeance.dateEcheance,
  loyerHc: echeance.loyerHc,
  charges: echeance.charges,
  autres: echeance.autres || 0,
  encaissements: echeance.encaissements || [],
  quittanceEmiseLe: echeance.quittanceEmiseLe || null,
  notes: echeance.notes || '',
});

/** Bornes de la période couverte par une échéance, limitées au bail. */
function periodeBornes(echeance, bail) {
  const dernierJour = new Date(echeance.annee, echeance.mois, 0).getDate();
  let debut = isoDepuis(echeance.annee, echeance.mois, 1);
  let fin = isoDepuis(echeance.annee, echeance.mois, dernierJour);
  const debutBail = String(bail?.dateDebut || '').slice(0, 10);
  const finBail = String(bail?.dateFin || '').slice(0, 10);
  if (debutBail && debutBail > debut) debut = debutBail;
  if (finBail && finBail < fin) fin = finBail;
  return { debut, fin };
}

const periodeTexte = (echeance, bail) => {
  const { debut, fin } = periodeBornes(echeance, bail);
  return `du ${dateLongue(debut)} au ${dateLongue(fin)}`;
};

/**
 * Génère la quittance PDF d'une échéance intégralement payée : dépôt sur
 * l'espace du colocataire, téléchargement, et e-mail de mise à disposition
 * (le colocataire retire le PDF sur son espace).
 */
/**
 * Génère la quittance ANIKA d'une échéance (v51 : enrichie — numéro, bail,
 * périodes, règlement, solde antérieur), la dépose sur l'espace du
 * colocataire et note l'émission. Renvoie { octets, nomFichier, publie,
 * erreurPublication, locataire, bailleur } ou null (message affiché).
 */
async function genererQuittance(donnees, bail, echeance) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return null; }
  const locataire = locataireDe(donnees, echeance, bail);
  if (!locataire) { notifier('Locataire introuvable pour cette échéance.', 'erreur'); return null; }
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
  const bornes = periodeBornes(echeance, bail);
  const reglement = dernierReglement(echeance);
  const toutes = calcul.echeancesGlobales(donnees.baux, echeance.annee, donnees.loyers);
  const anneePrecedente = calcul.echeancesGlobales(donnees.baux, Number(echeance.annee) - 1, donnees.loyers);

  const octets = await pdfQuittanceAnika({
    bailleur: {
      nom: bailleur.nom,
      adresse: bailleur.adresse || '',
      email: bailleur.email || '',
      telephone: bailleur.telephone || '',
      siren: sirenDepuisSiret(donnees.parametres.siret), siret: formaterSiret(donnees.parametres.siret),
    },
    locataireNom: nomDe(locataire),
    logement: { adresse: bien?.adresse || '', codePostal: bien?.codePostal || '', ville: bien?.ville || '' },
    periodeLibelle: `${nomMois(echeance.mois)} ${echeance.annee}`,
    periodeDebut: dateLongueFr(bornes.debut),
    periodeFin: dateLongueFr(bornes.fin),
    loyerHc: echeance.loyerHc || 0,
    charges: echeance.charges || 0,
    autres: echeance.autres || 0,
    lieu: donnees.parametres.lieuSignature || '',
    dateSignature: dateLongueFr(reglement?.date || aujourdhui()),
    enrichie: true,
    numero: numeroQuittance({ annee: echeance.annee, mois: echeance.mois, bien, locataire }),
    editeeLe: dateLongueFr(aujourdhui()),
    bailDebut: bail?.dateDebut ? dateLongueFr(bail.dateDebut) : '',
    colocation: (bail?.colocataires || []).some((c) => c && c.locataireId),
    reglement: reglement ? { date: reglement.date ? dateLongueFr(reglement.date) : '', mode: reglement.mode, reference: reglement.reference } : null,
    soldeAnterieur: soldeAnterieur([...anneePrecedente, ...toutes], echeance),
  });
  const nomFichier = `ANIKA_quittance_loyer_${nomMois(echeance.mois)}_${echeance.annee}_${(locataire.prenom || locataire.nom || '').toLowerCase()}.pdf`;

  // Mise à disposition sur l'espace du colocataire.
  let publie = null;
  let erreurPublication = null;
  try { publie = await publierDocument({
    locataire, type: 'quittance',
    titre: `Quittance de loyer — ${nomMois(echeance.mois)} ${echeance.annee}`,
    nomFichier, octets,
  }); } catch (erreur) { erreurPublication = erreur; }

  if (!echeance.quittanceEmiseLe) {
    etat.enregistrer('loyers', { ...gabaritEcheance(echeance), quittanceEmiseLe: aujourdhui() }).catch(() => {});
  }
  return { octets, nomFichier, publie, erreurPublication, locataire, bailleur };
}

const telechargerOctets = (octets, nomFichier) => {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
  lien.download = nomFichierTelechargement(nomFichier);
  document.body.append(lien);
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
};

/** L'e-mail de mise à disposition d'une quittance publiée. */
async function notifierQuittance(echeance, { locataire, bailleur, publie }, { silencieux = false } = {}) {
  if (!locataire.email) { if (!silencieux) notifier('Ce colocataire n’a pas d’adresse e-mail (à renseigner dans « Locataires »).', 'erreur'); return false; }
  if (!publie) { if (!silencieux) notifier('La quittance n’a pas pu être déposée sur son espace — corrigez d’abord ce point.', 'erreur'); return false; }
  const resultat = await executer(api.envoyerCourriel({ type: 'documents',
    destinataires: destinatairesDe(locataire),
    sujet: `Votre quittance de loyer — ${nomMois(echeance.mois)} ${echeance.annee}`,
    html: `<p>Bonjour ${locataire.prenom || ''},</p>`
      + `<p>Votre quittance de loyer pour <strong>${nomMois(echeance.mois)} ${echeance.annee}</strong> `
      + `(${montant(echeance.total || 0)}) est disponible sur votre espace :</p>`
      + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
      + '<p>Connectez-vous avec votre adresse e-mail pour la consulter et la télécharger.</p>'
      + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
  }), silencieux ? null : `Notification de mise à disposition envoyée à ${locataire.email}.`);
  return resultat !== null;
}

/** Bouton « Quittance » : génération, fenêtre avec téléchargement et envoi de l'e-mail. */
async function quittancePdfEtEnvoi(donnees, bail, echeance) {
  const resultat = await genererQuittance(donnees, bail, echeance);
  if (!resultat) return;
  const { octets, nomFichier, publie, erreurPublication, locataire } = resultat;
  ouvrirModale({
    titre: 'Quittance générée',
    corps: h('div', {}, [
      h('p', { texte: `Quittance de ${nomDe(locataire)} pour ${nomMois(echeance.mois)} ${echeance.annee} (${montant(echeance.total || 0)}).` }),
      publie
        ? h('p', { class: 'legende', texte: 'Déposée sur son espace : il peut la consulter et la télécharger en PDF.' })
        : h('p', { class: 'legende', style: 'color:var(--alerte)', texte:
          `Non déposée sur son espace : ${erreurPublication?.message || 'erreur inconnue'}` }),
    ]),
    pied: [
      h('button', { class: 'bouton', type: 'button', onclick: () => telechargerOctets(octets, nomFichier) }, 'Télécharger le PDF'),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => notifierQuittance(echeance, resultat) }, 'Notifier par e-mail'),
    ],
  });
}

/**
 * Quittance en un geste (v51, E1) : générée, déposée sur l'espace et
 * annoncée par e-mail, sans fenêtre. Renvoie true si tout est parti.
 */
async function quittanceEnUnGeste(donnees, bail, echeance) {
  const resultat = await genererQuittance(donnees, bail, echeance);
  if (!resultat) return false;
  const envoye = await notifierQuittance(echeance, resultat, { silencieux: true });
  if (envoye) notifier(`Quittance de ${nomMois(echeance.mois)} ${echeance.annee} générée, déposée sur l’espace de ${nomDe(resultat.locataire)} et envoyée par e-mail.`, 'succes');
  else notifier(`Quittance de ${nomMois(echeance.mois)} ${echeance.annee} générée${resultat.publie ? ' et déposée sur son espace' : ''}, mais l’e-mail n’a pas pu partir (${resultat.locataire.email ? 'dépôt sur l’espace impossible' : 'pas d’adresse e-mail'}).`, 'erreur');
  return envoye;
}

/**
 * Dès qu'un virement solde le mois (v51, E1) : fenêtre « Générer et envoyer »
 * / « Plus tard », avec la case « toujours faire ainsi » (parametres.quittanceAuto).
 * Si le réglage est déjà activé, tout part sans fenêtre.
 */
async function proposerQuittance(donnees, bail, echeance, montantVerse) {
  if (api.MODE !== 'nuage') return;
  const locataire = locataireDe(donnees, echeance, bail);
  if (!locataire) return;
  // L'échéance telle qu'elle vient d'être enregistrée (avec le nouvel encaissement).
  const majEcheance = etat.liste('loyers').find((l) => l.id === echeance.id);
  const aJour = majEcheance ? { ...echeance, ...majEcheance } : echeance;
  const fraiches = { ...donnees, parametres: etat.parametres(), loyers: etat.liste('loyers') };
  if (fraiches.parametres.quittanceAuto) { await quittanceEnUnGeste(fraiches, bail, aJour); return; }
  const caseToujours = h('input', { type: 'checkbox', id: 'quittance-toujours' });
  await new Promise((resoudre) => {
    const fermer = ouvrirModale({
      titre: `Quittance de ${nomMois(echeance.mois)} ${echeance.annee} — ${nomDe(locataire)}`,
      surFermeture: () => resoudre(),
      corps: h('div', { class: 'proposition-quittance' }, [
        h('p', { texte: `Le virement de ${montant(montantVerse)} solde le mois. La quittance PDF ANIKA va être générée, déposée sur son espace`
          + `${locataire.email ? ` et annoncée par e-mail à ${destinatairesDe(locataire).join(', ')}` : ' (pas d’adresse e-mail : pas d’envoi)'}.` }),
        h('label', { class: 'legende', style: 'display:flex;gap:.4rem;align-items:center' }, [caseToujours, 'Toujours faire ainsi, sans me demander (réglable dans Paramètres → Quittances)']),
      ]),
      pied: [
        bouton('Plus tard', () => { fermer(); resoudre(); }, { titre: 'Le bouton « Quittance » de la ligne reste disponible' }),
        bouton('Générer et envoyer', async () => {
          fermer({ valide: true });
          try {
            if (caseToujours.checked) await etat.enregistrerParametres({ quittanceAuto: true });
            await quittanceEnUnGeste(fraiches, bail, aJour);
          } catch (erreur) { signalerErreur(erreur); }
          resoudre();
        }, { type: 'primaire' }),
      ],
    });
  });
}

/** Enregistre une échéance (création si elle n'existait pas encore). */
async function enregistrerEcheance(echeance, modifications) {
  return etat.enregistrer('loyers', { ...gabaritEcheance(echeance), ...modifications });
}

async function saisirEncaissement(donnees, bail, echeance) {
  const recu = calcul.totalEncaisse(echeance);
  const reste = centimes((echeance.total || 0) - recu);
  const dejaSoldee = reste <= 0.005 && recu > 0;
  const saisie = await formulaire({
    titre: `Encaissement — ${nomDe(locataireDe(donnees, echeance, bail))} — ${nomMois(echeance.mois)} ${echeance.annee}`,
    // v56 : une échéance déjà soldée ne propose plus son montant total (source de doublons).
    aide: dejaSoldee
      ? `Cette échéance est déjà intégralement encaissée (${montant(recu)} reçus sur ${montant(echeance.total || 0)}). Un versement supplémentaire créerait un trop-perçu : vérifiez d’abord ses encaissements (montant souligné dans la colonne « Encaissé »).`
      : undefined,
    champs: [
      { cle: 'date', libelle: 'Date de l’encaissement', type: 'date', requis: true },
      { cle: 'montant', libelle: 'Montant reçu (€)', type: 'montant', requis: true },
      { cle: 'mode', libelle: 'Mode de règlement', type: 'liste', options: etat.MODES_REGLEMENT.map((m) => ({ valeur: m, libelle: m })) },
      { cle: 'reference', libelle: 'Référence (facultatif)', type: 'texte', largeur: 'pleine' },
    ],
    valeurs: { date: aujourdhui(), montant: reste > 0 ? reste : 0, mode: 'Virement' },
  });
  if (!saisie) return;
  if (!(Number(saisie.montant) > 0)) { notifier('Aucun montant saisi : rien n’a été enregistré.'); return; }
  if (dejaSoldee) {
    const ok = await confirmer({
      titre: 'Échéance déjà soldée',
      message: `${nomMois(echeance.mois)} ${echeance.annee} est déjà encaissé en totalité (${montant(recu)}). Enregistrer quand même ce versement de ${montant(Number(saisie.montant))} ? Il apparaîtra en trop-perçu.`,
      libelleValider: 'Enregistrer le trop-perçu', danger: true,
    });
    if (!ok) return;
  }
  const nouvel = {
    id: crypto.randomUUID(),
    date: saisie.date,
    montant: Number(saisie.montant) || 0,
    mode: saisie.mode,
    reference: saisie.reference || '',
  };
  // Ajout additif sur la version fraîche : un encaissement saisi en même temps
  // depuis l'autre poste n'est jamais écrasé.
  const enregistre = await executer(
    etat.modifierElement('loyers', echeance.id, (e) => {
      e.encaissements = [...(e.encaissements || []), nouvel];
    }, gabaritEcheance(echeance)),
    'Encaissement enregistré.',
  );
  // v51 : le virement solde le mois → quittance en un geste (fenêtre, ou directement si réglé).
  if (enregistre !== null && !echeance.horsBail && centimes(reste - nouvel.montant) <= 0.005 && !echeance.quittanceEmiseLe) {
    await proposerQuittance(donnees, bail, echeance, nouvel.montant);
  }
}

async function ajusterEcheance(echeance, nom = '') {
  const saisie = await formulaire({
    titre: `Échéance de ${nomMois(echeance.mois)} ${echeance.annee}${nom ? ` — ${nom}` : ''}`,
    aide: 'Les montants proposés viennent du bail. Modifiez-les en cas de prorata, de régularisation ou de franchise.',
    champs: [
      { cle: 'loyerHc', libelle: 'Loyer hors charges (€)', type: 'montant', requis: true },
      { cle: 'charges', libelle: 'Provision pour charges (€)', type: 'montant' },
      { cle: 'autres', libelle: 'Autres sommes dues (€)', type: 'montant', aide: 'Régularisation, indemnité…' },
      { cle: 'dateEcheance', libelle: 'Date d’échéance', type: 'date' },
      { cle: 'notes', libelle: 'Notes', type: 'zone' },
    ],
    valeurs: {
      loyerHc: echeance.loyerHc,
      charges: echeance.charges,
      autres: echeance.autres || 0,
      dateEcheance: echeance.dateEcheance,
      notes: echeance.notes || '',
    },
  });
  if (!saisie) return;
  await executer(enregistrerEcheance(echeance, {
    loyerHc: Number(saisie.loyerHc) || 0,
    charges: Number(saisie.charges) || 0,
    autres: Number(saisie.autres) || 0,
    dateEcheance: saisie.dateEcheance,
    notes: saisie.notes,
  }), 'Échéance mise à jour.');
}

function voirEncaissements(echeance, nom = '') {
  const encaissements = echeance.encaissements || [];
  if (!encaissements.length) { notifier('Aucun encaissement sur cette échéance.'); return; }
  // v56 : même date, même montant, même mode → probablement saisi deux fois.
  const cleDoublon = (e) => `${e.date}|${centimes(Number(e.montant) || 0)}|${e.mode || ''}|${e.reference || ''}`;
  const occurrences = new Map();
  for (const e of encaissements) occurrences.set(cleDoublon(e), (occurrences.get(cleDoublon(e)) || 0) + 1);
  const doublons = encaissements.filter((e) => occurrences.get(cleDoublon(e)) > 1).length;
  const recu = calcul.totalEncaisse(echeance);
  const tropPercu = centimes(recu - (echeance.total || 0));
  const avertissement = doublons || tropPercu > 0.005
    ? h('p', { class: 'alerte alerte-attention', style: 'margin:0 0 .6rem', texte: `${tropPercu > 0.005 ? `Trop-perçu de ${montant(tropPercu)} : ${montant(recu)} reçus pour ${montant(echeance.total || 0)} dus. ` : ''}${doublons ? `${doublons} encaissements identiques (même date, même montant) : s’il s’agit d’une double saisie, supprimez les lignes en trop avec ✕.` : ''}` })
    : null;
  const corps = tableau({
    colonnes: [
      { titre: 'Date', valeur: (e) => date(e.date) },
      { titre: 'Montant', nombre: true, valeur: (e) => h('span', {}, [montant(e.montant), occurrences.get(cleDoublon(e)) > 1 ? [' ', badge('doublon ?', 'attention')] : null].flat()) },
      // La quittance imprime le dernier encaissement de la liste (date, mode, référence) : on le repère.
      { titre: 'Quittance', valeur: (e) => (echeance.quittanceEmiseLe && e.id === encaissements[encaissements.length - 1]?.id
        ? badge(`retenu sur la quittance du ${date(echeance.quittanceEmiseLe)}`, 'info') : '') },
      { titre: 'Mode', valeur: (e) => e.mode || '—' },
      { titre: 'Référence', valeur: (e) => e.reference || '—' },
      { titre: '', actions: true, valeur: (e) => bouton('✕', async () => {
        const confirme = await confirmer({
          titre: 'Supprimer l’encaissement',
          message: `Retirer l’encaissement de ${montant(e.montant)} du ${date(e.date)} ?`,
          libelleValider: 'Supprimer', danger: true,
        });
        if (!confirme) return;
        await executer(
          etat.modifierElement('loyers', echeance.id, (ech) => {
            ech.encaissements = (ech.encaissements || []).filter((x) => x.id !== e.id);
          }, gabaritEcheance(echeance)),
          'Encaissement supprimé.',
        );
      }, { petit: true, type: 'danger' }) },
    ],
    lignes: encaissements,
    messageVide: '',
  });
  const note = echeance.quittanceEmiseLe
    ? h('p', { class: 'legende', style: 'margin:.6rem 0 0', texte: 'La quittance n’est pas liée à une ligne : elle reprend la date, le mode et la référence du dernier encaissement. Supprimer une ligne en trop ne l’invalide pas ; « Régénérer les quittances émises » la refait avec les lignes restantes.' })
    : null;
  ouvrirModale({ titre: `Encaissements — ${nom ? `${nom} — ` : ''}${nomMois(echeance.mois)} ${echeance.annee}`, corps: [avertissement, corps, note] });
}

function documentsQuittance(donnees, bail, echeance, quittance) {
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
  const locataire = locataireDe(donnees, echeance, bail);
  const bailleur = donnees.parametres.bailleurs?.[0];
  const lieu = donnees.parametres.lieuSignature || '';
  if (!quittance) {
    imprimerAvis({ bailleur, locataire, bien, bail, echeance, lieu });
    return;
  }
  const dernier = (echeance.encaissements || []).slice(-1)[0];
  imprimerQuittance({ bailleur, locataire, bien, bail, echeance, dateReglement: dernier?.date, lieu });
  if (!echeance.quittanceEmiseLe) {
    enregistrerEcheance(echeance, { quittanceEmiseLe: aujourdhui() }).catch(() => {});
  }
}

/** Menu « ⋯ » d'une échéance : les actions moins fréquentes, hors du tableau. */
function menuEcheance(donnees, bail, echeance) {
  const action = (libelle, fonction, aide) => h('button', {
    class: 'bouton', type: 'button', style: 'width:100%;justify-content:flex-start;margin-bottom:.45rem;display:flex;gap:.5rem',
    title: aide || null,
    onclick: () => { fermerModale(); fonction(); },
  }, libelle);
  ouvrirModale({
    titre: `${nomDe(locataireDe(donnees, echeance, bail))} — ${nomMois(echeance.mois)} ${echeance.annee} — autres actions`,
    corps: h('div', {}, [
      action('🖨 Imprimer', () => documentsQuittance(donnees, bail, echeance, calcul.statut(echeance) === 'paye'),
        'Quittance si payée, sinon avis d’échéance'),
      action('✎ Ajuster les montants', () => ajusterEcheance(echeance, nomDe(locataireDe(donnees, echeance, bail)))),
      action('📄 Voir les encaissements', () => voirEncaissements(echeance, nomDe(locataireDe(donnees, echeance, bail)))),
    ]),
  });
}

// ------------------------------------------------ présentation (v55)
// La page se présente par mois (une carte par mois, une ligne par
// colocataire — par défaut) ou par locataire (une carte par payeur, ses douze
// mois). Le choix est mémorisé sur l'appareil.
const CLE_PRESENTATION = 'lmnp-loyers-presentation';
const lirePresentation = () => { try { return localStorage.getItem(CLE_PRESENTATION) === 'locataire' ? 'locataire' : 'mois'; } catch { return 'mois'; } };
const ecrirePresentation = (valeur) => { try { localStorage.setItem(CLE_PRESENTATION, valeur); } catch { /* sans mémoire */ } };

function selecteurPresentation(contexte, presentation) {
  const choix = (valeur, libelle) => h('button', {
    type: 'button', class: `segment-choix${presentation === valeur ? ' actif' : ''}`, 'data-presentation': valeur,
    'aria-pressed': presentation === valeur ? 'true' : 'false',
    onclick: () => { if (presentation !== valeur) { ecrirePresentation(valeur); contexte.redessiner?.({ conserverPosition: true }); } },
  }, libelle);
  return h('div', { class: 'segment', role: 'group', 'aria-label': 'Présentation' }, [
    h('span', { class: 'segment-libelle', texte: 'Présentation' }),
    choix('mois', 'Par mois'),
    choix('locataire', 'Par locataire'),
  ]);
}

const legendeEcheance = (e) => `échéance ${date(e.dateEcheance)}${e.partiel ? ' · mois partiel' : ''}${e.horsBail ? ' · hors bail' : ''}${e.quittanceEmiseLe ? ` · quittance émise le ${date(e.quittanceEmiseLe)}` : ''}`;

/**
 * Les colonnes d'un tableau d'échéances, communes aux deux présentations :
 * la première est le mois (par locataire) ou le colocataire (par mois).
 *   bailDe(echeance) : le bail de la ligne
 */
function colonnesEcheances({ contexte, donnees, bailDe, parMois }) {
  const premiere = parMois
    ? { titre: 'Colocataire', valeur: (e) => h('div', {}, [
      h('div', { texte: nomDe(locataireDe(donnees, e, bailDe(e))) }),
      h('div', { class: 'legende', texte: legendeEcheance(e) }),
      traceAppels(e),
    ]) }
    : { titre: 'Mois', valeur: (e) => h('div', {}, [
      h('div', { texte: nomMois(e.mois) }),
      h('div', { class: 'legende', texte: legendeEcheance(e) }),
      traceAppels(e),
    ]) };
  return [
    premiere,
    { titre: 'Loyer + charges', nombre: true, valeur: (e) => `${montant(e.loyerHc)} + ${montant(e.charges)}` },
    { titre: 'Total dû', nombre: true, valeur: (e) => montant(e.total) },
    { titre: 'Encaissé', nombre: true, valeur: (e) => {
      const recu = calcul.totalEncaisse(e);
      return recu ? h('button', { class: 'bouton-lien', style: 'color:inherit', onclick: () => voirEncaissements(e, nomDe(locataireDe(donnees, e, bailDe(e)))) }, montant(recu)) : '—';
    } },
    { titre: 'Reste', nombre: true, valeur: (e) => {
      const reste = centimes(e.total - calcul.totalEncaisse(e));
      if (reste > 0.005) return h('span', { style: 'color:var(--alerte)', texte: montant(reste) });
      // v56 : un encaissement en double se voit tout de suite.
      if (reste < -0.005) return badge(`trop-perçu ${montant(-reste)}`, 'attention');
      return '—';
    } },
    { titre: 'État', valeur: ligneStatut },
    { titre: '', actions: true, valeur: (e) => {
      const bail = bailDe(e);
      const locataire = locataireDe(donnees, e, bail);
      return h('div', { class: 'groupe-boutons' }, [
        bouton('Virement reçu', () => saisirEncaissement(donnees, bail, e).catch(signalerErreur), { petit: true, type: 'primaire' }),
        bouton('Quittance', () => quittancePdfEtEnvoi(donnees, bail, e), {
          petit: true,
          titre: calcul.statut(e) === 'paye'
            ? 'Générer la quittance PDF (téléchargement, envoi par e-mail)'
            : 'Quittance possible seulement quand l’échéance est intégralement payée',
          desactive: calcul.statut(e) !== 'paye',
        }),
        api.MODE === 'nuage' && !e.horsBail && centimes(e.total - calcul.totalEncaisse(e)) > 0.005 && locataire?.email
          ? (resumeAppels(journalAppels, e.id)
            ? bouton('Relancer ✉', () => appelerEcheance(contexte, e, { relance: true }).catch(signalerErreur), { petit: true, titre: 'Relance de l’appel de loyer de ce mois (objet « Relance — … »)' })
            : bouton('Appel ✉', () => appelerEcheance(contexte, e).catch(signalerErreur), { petit: true, titre: 'Appel de loyer de ce mois à ce colocataire' }))
          : null,
        bouton('⋯', () => menuEcheance(donnees, bail, e), { petit: true, titre: 'Imprimer, ajuster, encaissements…' }),
      ]);
    } },
  ];
}

/** « Pointer les impayés » : les échéances en retard ou partielles de `lignes` sont encaissées à aujourd'hui ; quittances en un geste (v51). */
async function pointerImpayes(donnees, lignes, { vide: messageVide = 'Aucun impayé.' } = {}) {
  const aRegler = lignes.filter(({ echeance }) => ['retard', 'partiel'].includes(calcul.statut(echeance)));
  if (!aRegler.length) { notifier(messageVide); return; }
  const confirme = await confirmer({
    titre: 'Encaisser les impayés',
    message: `${aRegler.length} échéance(s) seront marquées encaissées à la date d’aujourd’hui, `
      + `pour un total de ${montant(centimes(aRegler.reduce((s, { echeance: e }) => s + e.total - calcul.totalEncaisse(e), 0)))}.`,
    libelleValider: 'Encaisser',
  });
  if (!confirme) return;
  let faits = 0;
  let echoues = 0;
  const soldees = [];
  for (const { echeance, bail } of aRegler) {
    const reste = centimes(echeance.total - calcul.totalEncaisse(echeance));
    if (reste <= 0) continue;
    try {
      /* eslint-disable no-await-in-loop */
      await etat.modifierElement('loyers', echeance.id, (e) => {
        e.encaissements = [...(e.encaissements || []), {
          id: crypto.randomUUID(), date: aujourdhui(), montant: reste, mode: 'Virement', reference: '',
        }];
      }, gabaritEcheance(echeance));
      faits += 1;
      if (!echeance.quittanceEmiseLe && !echeance.horsBail) soldees.push({ echeance, bail });
    } catch (erreur) { echoues += 1; console.error(erreur); }
  }
  if (faits) notifier(`${faits} impayé(s) encaissé(s).`, 'succes');
  if (echoues) notifier(`${echoues} échéance(s) n’ont pas pu être enregistrées.`, 'erreur');
  // v51 : les quittances des mois soldés, en un geste (réglage) ou après confirmation.
  if (soldees.length && api.MODE === 'nuage') {
    const tout = { ...donnees, parametres: etat.parametres(), loyers: etat.liste('loyers') };
    const ok = tout.parametres.quittanceAuto || await confirmer({
      titre: `${soldees.length} quittance(s) à générer`,
      message: `Générer, déposer sur les espaces et envoyer par e-mail les quittances de ${soldees.map(({ echeance: e, bail }) => `${nomDe(locataireDe(donnees, e, bail))} — ${nomMois(e.mois)} ${e.annee}`).join(', ')} ?`,
      libelleValider: 'Générer et envoyer',
    });
    if (ok) {
      for (const { echeance, bail } of soldees) {
        const aJour = { ...echeance, ...(tout.loyers.find((l) => l.id === echeance.id) || {}) };
        // eslint-disable-next-line no-await-in-loop
        await quittanceEnUnGeste(tout, bail, aJour).catch(signalerErreur);
      }
    }
  }
}

/** Présentation par locataire : une carte par payeur du logement (ses mois de l'année). Renvoie le nombre de cartes. */
function cartesParLocataire({ contexte, donnees, bien, annee, lignes, cible }) {
  const bailDe = new Map(lignes.map(({ echeance, bail }) => [echeance.id, bail]));
  const parLocataire = new Map();
  for (const { echeance, bail } of lignes) {
    const cle = echeance.locataireId || bail.locataireId || '';
    if (!parLocataire.has(cle)) parLocataire.set(cle, []);
    parLocataire.get(cle).push({ echeance, bail });
  }
  let cartes = 0;
  for (const [locataireId, siennes] of parLocataire) {
    const locataireCourant = donnees.locataires.find((l) => l.id === locataireId) || null;
    const echeances = siennes.map((x) => x.echeance);
    const totalBail = centimes(echeances.reduce((s, e) => s + (e.total || 0), 0));
    const recuBail = centimes(echeances.reduce((s, e) => s + calcul.totalEncaisse(e), 0));
    cartes += 1;
    cible.append(carte({
      titre: `${nomDe(locataireCourant)} — ${bien?.nom || 'logement inconnu'}`,
      teinte: bien ? teinteLogement(bien, (contexte.tout || donnees).biens) : '',
      aide: `${montant(recuBail)} reçus sur ${montant(totalBail)} attendus en ${annee}`
        + (locataireCourant?.email ? '' : ' · pas d’adresse e-mail renseignée'),
      actions: [
        bouton('Pointer les impayés', () => pointerImpayes(donnees, siennes, { vide: 'Aucun impayé pour ce colocataire.' }).catch(signalerErreur), { petit: true }),
        bouton('Relevé annuel', () => imprimerReleve({
          bailleur: donnees.parametres.bailleurs?.[0],
          locataire: locataireCourant,
          bien, annee, echeances,
        }), { petit: true }),
      ],
      serre: true,
      corps: tableau({ colonnes: colonnesEcheances({ contexte, donnees, bailDe: (e) => bailDe.get(e.id), parMois: false }), lignes: echeances, cle: (e) => e.id, messageVide: 'Aucune échéance.' }),
    }));
  }
  return cartes;
}

/** Le bouton du mois : « Appel du mois ✉ (n) » pour les colocataires pas encore appelés, sinon « Relancer les impayés ✉ (n) ». */
function boutonAppelMois(contexte, donnees, bien, annee, mois, lignes) {
  if (api.MODE !== 'nuage' || !bien || sansAppel(bien)) return null;
  const journal = journalAppels || { envois: {}, personnes: {} };
  const impayes = lignes.filter(({ echeance: e, bail }) => !e.horsBail && centimes(e.total - calcul.totalEncaisse(e)) > 0.005 && locataireDe(donnees, e, bail)?.email);
  if (!impayes.length) return null;
  const apercu = apercuAppels({ bienId: bien.id, annee, mois, journal });
  if (apercu.courriels.length) {
    return bouton(`Appel du mois ✉ (${apercu.courriels.length})`, async () => {
      const ok = await confirmer({
        titre: `Appeler le loyer de ${nomMois(mois)} ${annee}`,
        message: `${apercu.courriels.length} e-mail(s) : ${apercu.courriels.map((c) => `${c.nom} — ${montant(c.montantDu)}`).join(' ; ')}.${apercu.ecartes.length ? ` Non concernés : ${apercu.ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.` : ''}`,
        libelleValider: 'Envoyer les appels',
      });
      if (!ok) return;
      const resultat = await executer(envoyerAppels({ bienId: bien.id, annee, mois, origine: 'manuel (page Loyers)', force: true }), null);
      if (resultat) notifier(`${resultat.envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(mois)} ${annee}.`, resultat.envoyes ? 'succes' : 'erreur');
      chargerJournalAppels(contexte);
    }, { petit: true, type: 'primaire', titre: 'Un e-mail d’appel de loyer à chaque colocataire du mois pas encore appelé' });
  }
  const aRelancer = impayes.filter(({ echeance: e }) => resumeAppels(journal, e.id));
  if (!aRelancer.length) return null;
  return bouton(`Relancer les impayés ✉ (${aRelancer.length})`, async () => {
    const ok = await confirmer({
      titre: `Relancer les impayés de ${nomMois(mois)} ${annee}`,
      message: `Relance de l’appel de loyer à : ${aRelancer.map(({ echeance: e, bail }) => `${nomDe(locataireDe(donnees, e, bail))} — ${montant(centimes(e.total - calcul.totalEncaisse(e)))}`).join(' ; ')} (objet « Relance — … »).`,
      libelleValider: 'Envoyer les relances',
    });
    if (!ok) return;
    let envoyees = 0;
    for (const { echeance } of aRelancer) {
      // eslint-disable-next-line no-await-in-loop
      try { await envoyerAppelEcheance({ echeance, relance: true }); envoyees += 1; } catch (erreur) { notifier(erreur.message, 'erreur'); }
    }
    notifier(`${envoyees} relance(s) envoyée(s) pour ${nomMois(mois)} ${annee}.`, envoyees ? 'succes' : 'erreur');
    chargerJournalAppels(contexte);
  }, { petit: true, titre: 'Relance de l’appel de loyer aux colocataires du mois qui n’ont pas réglé' });
}

/** Présentation par mois : une carte repliable par mois de l'année, une ligne par colocataire. Renvoie le nombre de cartes. */
function cartesParMois({ contexte, donnees, bien, annee, lignes, cible }) {
  const bailDe = new Map(lignes.map(({ echeance, bail }) => [echeance.id, bail]));
  const parMois = new Map();
  for (const ligne of lignes) {
    const mois = Number(ligne.echeance.mois);
    if (!parMois.has(mois)) parMois.set(mois, []);
    parMois.get(mois).push(ligne);
  }
  const jour = aujourdhui();
  const moisCourant = Number(jour.slice(5, 7));
  const anneeCourante = Number(jour.slice(0, 4));
  const colonnes = colonnesEcheances({ contexte, donnees, bailDe: (e) => bailDe.get(e.id), parMois: true });
  let cartes = 0;
  for (const mois of [...parMois.keys()].sort((a, b) => a - b)) {
    const siennes = parMois.get(mois).sort((a, b) => nomDe(locataireDe(donnees, a.echeance, a.bail)).localeCompare(nomDe(locataireDe(donnees, b.echeance, b.bail))));
    const echeances = siennes.map((x) => x.echeance);
    const total = centimes(echeances.reduce((s, e) => s + (e.total || 0), 0));
    const recu = centimes(echeances.reduce((s, e) => s + calcul.totalEncaisse(e), 0));
    const reste = centimes(total - recu);
    const statuts = echeances.map((e) => calcul.statut(e));
    const nbRetard = statuts.filter((x) => x === 'retard').length;
    const nbPartiel = statuts.filter((x) => x === 'partiel').length;
    const nbAVenir = statuts.filter((x) => x === 'attente').length;
    const nbPayes = statuts.filter((x) => x === 'paye').length;
    const dateEcheance = echeances.map((e) => e.dateEcheance).filter(Boolean).sort()[0];
    const etatMois = nbRetard || nbPartiel ? badge(`${nbRetard + nbPartiel} impayé${nbRetard + nbPartiel > 1 ? 's' : ''}`, 'alerte')
      : (nbAVenir ? badge(`${nbAVenir} à venir`, 'attente') : badge('tout encaissé', 'succes'));
    const resume = `${dateEcheance ? `échéance le ${date(dateEcheance)} · ` : ''}${montant(recu)} reçus sur ${montant(total)} · ${etatMois.textContent}`;
    const enCours = Number(annee) === anneeCourante && mois === moisCourant;
    cartes += 1;
    cible.append(carte({
      titre: `${nomMois(mois)[0].toUpperCase()}${nomMois(mois).slice(1)} ${annee}`,
      teinte: bien ? teinteLogement(bien, (contexte.tout || donnees).biens) : '',
      cle: `mois:${bien?.id || 'sans-logement'}:${annee}-${String(mois).padStart(2, '0')}`,
      aide: resume,
      resume,
      // C1 : le mois en cours et les mois avec un impayé sont dépliés ; les autres repliés.
      repliParDefaut: !(enCours || nbRetard || nbPartiel),
      actions: [
        boutonAppelMois(contexte, donnees, bien, Number(annee), mois, siennes),
        bouton('Pointer les impayés', () => pointerImpayes(donnees, siennes, { vide: `Aucun impayé en ${nomMois(mois)} ${annee}.` }).catch(signalerErreur), { petit: true, titre: 'Encaisse à aujourd’hui les échéances en retard ou partielles du mois' }),
        bouton('Relevé du mois', () => imprimerReleveMois({
          bailleur: donnees.parametres.bailleurs?.[0], bien, annee, mois,
          lignes: siennes.map(({ echeance, bail }) => ({ nom: nomDe(locataireDe(donnees, echeance, bail)), echeance })),
        }), { petit: true, titre: 'Imprime le relevé du mois : une ligne par colocataire' }),
      ],
      serre: true,
      corps: tableau({
        colonnes, lignes: echeances, cle: (e) => e.id, messageVide: 'Aucune échéance.',
        pied: ligneTotal(colonnes, [
          h('strong', { texte: 'Total du mois' }),
          `${montant(centimes(echeances.reduce((s, e) => s + (e.loyerHc || 0), 0)))} + ${montant(centimes(echeances.reduce((s, e) => s + (e.charges || 0), 0)))}`,
          h('strong', { texte: montant(total) }),
          montant(recu),
          reste > 0.005 ? h('span', { style: 'color:var(--alerte)', texte: montant(reste) }) : (reste < -0.005 ? badge(`trop-perçu ${montant(-reste)}`, 'attention') : '—'),
          badge(`${nbPayes} / ${echeances.length} encaissé${nbPayes > 1 ? 's' : ''}`, nbPayes === echeances.length ? 'succes' : (nbRetard || nbPartiel ? 'alerte' : 'attente')),
          '',
        ]),
      }),
    }));
  }
  return cartes;
}

function ligneStatut(echeance) {
  const info = calcul.LIBELLES_STATUT[calcul.statut(echeance)];
  return badge(info.texte, info.ton);
}

// ------------------------------------------------------------------ séjours
// Location de courte durée (Airbnb, Booking…) : pas de bail ni d'échéance
// mensuelle, mais des séjours — chacun avec son montant et son encaissement.

async function saisirSejour(bien, existant = null) {
  const saisie = await formulaire({
    titre: existant ? `Séjour — ${bien.nom}` : `Nouveau séjour — ${bien.nom}`,
    aide: 'Le montant est ce que vous percevez pour le séjour (net des frais retenus par la plateforme).',
    champs: [
      { cle: 'plateforme', libelle: 'Plateforme', type: 'liste', options: PLATEFORMES.map((v) => ({ valeur: v, libelle: v })) },
      { cle: 'voyageur', libelle: 'Voyageur (nom ou prénom)', type: 'texte' },
      { cle: 'arrivee', libelle: 'Arrivée', type: 'date', requis: true },
      { cle: 'depart', libelle: 'Départ', type: 'date', requis: true },
      { cle: 'montant', libelle: 'Montant perçu (€)', type: 'montant', requis: true },
      { cle: 'notes', libelle: 'Notes (référence de réservation…)', type: 'zone' },
    ],
    valeurs: existant ? {
      plateforme: existant.plateforme, voyageur: existant.voyageur || '', arrivee: existant.arrivee, depart: existant.depart,
      montant: existant.montant || 0, notes: existant.notes || '',
    } : { plateforme: PLATEFORMES[0], voyageur: '', arrivee: aujourdhui(), depart: '', montant: 0, notes: '' },
  });
  if (!saisie) return;
  if (saisie.depart <= saisie.arrivee) { notifier('Le départ doit être postérieur à l’arrivée.', 'erreur'); return; }
  await executer(etat.enregistrer('loyers', gabaritSejour(bien.id, saisie, existant || {})), existant ? 'Séjour mis à jour.' : 'Séjour enregistré.');
}

async function encaisserSejour(sejour) {
  const reste = centimes((Number(sejour.montant) || 0) - calcul.totalEncaisse(sejour));
  const saisie = await formulaire({
    titre: `Encaissement du séjour du ${date(sejour.arrivee)}`,
    champs: [
      { cle: 'date', libelle: 'Date de l’encaissement', type: 'date', requis: true },
      { cle: 'montant', libelle: 'Montant reçu (€)', type: 'montant', requis: true },
      { cle: 'mode', libelle: 'Mode de règlement', type: 'liste', options: [`Virement ${sejour.plateforme || ''}`.trim(), ...etat.MODES_REGLEMENT].map((m) => ({ valeur: m, libelle: m })) },
      { cle: 'reference', libelle: 'Référence (facultatif)', type: 'texte', largeur: 'pleine' },
    ],
    valeurs: { date: aujourdhui(), montant: reste > 0 ? reste : sejour.montant, mode: `Virement ${sejour.plateforme || ''}`.trim() },
  });
  if (!saisie) return;
  const nouvel = { id: crypto.randomUUID(), date: saisie.date, montant: Number(saisie.montant) || 0, mode: saisie.mode, reference: saisie.reference || '' };
  await executer(
    etat.modifierElement('loyers', sejour.id, (e) => { e.encaissements = [...(e.encaissements || []), nouvel]; }, gabaritSejour(sejour.bienId, {}, sejour)),
    'Encaissement enregistré.',
  );
}

const LIBELLES_PHASE = { 'a-venir': ['À venir', 'attente'], 'en-cours': ['En cours', 'info'], termine: ['Terminé', 'attente'] };

/** Carte des séjours d'un logement de courte durée sur l'année. */
function carteSejours(donnees, bien, annee) {
  const sejours = sejoursDe(donnees.loyers, bien.id, annee);
  const total = centimes(sejours.reduce((s, x) => s + (Number(x.montant) || 0), 0));
  const recu = centimes(sejours.reduce((s, x) => s + calcul.totalEncaisse(x), 0));
  const nuits = sejours.reduce((s, x) => s + nuitsEntre(x.arrivee, x.depart), 0);
  const colonnes = [
    { titre: 'Séjour', valeur: (x) => h('div', {}, [
      h('div', { texte: `${date(x.arrivee)} → ${date(x.depart)}` }),
      h('div', { class: 'legende', texte: `${nuitsEntre(x.arrivee, x.depart)} nuit(s)${x.notes ? ` · ${x.notes}` : ''}` }),
    ]) },
    { titre: 'Voyageur', valeur: (x) => x.voyageur || '—' },
    { titre: 'Plateforme', valeur: (x) => x.plateforme || '—' },
    { titre: 'Montant', nombre: true, valeur: (x) => montant(x.montant || 0) },
    { titre: 'Encaissé', nombre: true, valeur: (x) => {
      const r = calcul.totalEncaisse(x);
      return r ? h('button', { class: 'bouton-lien', style: 'color:inherit', onclick: () => voirEncaissements(x) }, montant(r)) : '—';
    } },
    { titre: 'État', valeur: (x) => {
      const [texte, ton] = LIBELLES_PHASE[phaseSejour(x, aujourdhui())];
      const paye = calcul.statut(x) === 'paye';
      return h('div', { class: 'groupe-boutons' }, [badge(texte, ton), paye ? badge('Encaissé', 'succes') : (calcul.totalEncaisse(x) > 0 ? badge('Partiel', 'attention') : null)]);
    } },
    { titre: '', actions: true, valeur: (x) => h('div', { class: 'groupe-boutons' }, [
      calcul.statut(x) !== 'paye' ? bouton('Encaissé', () => encaisserSejour(x), { petit: true, type: 'primaire', titre: 'Enregistrer le versement de la plateforme ou du voyageur' }) : null,
      bouton('Modifier', () => saisirSejour(bien, x), { petit: true }),
      bouton('✕', async () => {
        const ok = await confirmer({ titre: 'Supprimer le séjour', message: `Supprimer le séjour du ${date(x.arrivee)} au ${date(x.depart)} ?`, libelleValider: 'Supprimer', danger: true });
        if (ok) await executer(etat.supprimer('loyers', x.id), 'Séjour supprimé.');
      }, { petit: true, type: 'danger' }),
    ]) },
  ];
  return carte({
    titre: `Séjours ${annee} — ${bien.nom}`,
    aide: sejours.length
      ? `${sejours.length} séjour(s), ${nuits} nuit(s) : ${montant(recu)} encaissés sur ${montant(total)}`
      : 'Courte durée : enregistrez chaque séjour (dates, voyageur, montant perçu) puis son encaissement.',
    actions: [bouton('+ Séjour', () => saisirSejour(bien), { petit: true, type: 'primaire' })],
    serre: true,
    corps: tableau({ colonnes, lignes: sejours, cle: (x) => x.id, messageVide: `Aucun séjour en ${annee}.` }),
  });
}

// ------------------------------------------------ gestion par une agence (v58)
// Un logement géré par une agence n'a ni bail ni échéance : un relevé de
// gérance par mois (loyer encaissé par l'agence, honoraires, autres retenues,
// net versé), le PDF de l'agence joint et rangé dans les documents du logement
// (masqué aux colocataires), et un relevé annuel pour la déclaration.

const nomFichierSur = (nom) => String(nom || 'releve.pdf').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

async function saisirReleve(bien, ligne, existant = null) {
  const loyer = existant ? existant.loyer : (Number(bien.agenceLoyer) || 0);
  const saisie = await formulaire({
    titre: `Relevé de gérance — ${bien.nom} — ${ligne.libelle}`,
    aide: 'Ce que l’agence a encaissé et retenu ce mois-ci, et ce qu’elle vous a versé. Le net est calculé : loyer − honoraires − autres retenues.',
    champs: [
      { cle: 'loyer', libelle: 'Loyer encaissé par l’agence (€)', type: 'montant', requis: true },
      { cle: 'honoraires', libelle: 'Honoraires retenus (€)', type: 'montant', aide: Number(bien.agenceHonoraires) > 0 ? `${String(bien.agenceHonoraires).replace('.', ',')} % proposés d’après la fiche ; corrigez selon le relevé.` : 'Renseignez le taux dans la fiche du logement pour une proposition automatique.' },
      { cle: 'autres', libelle: 'Autres retenues (€)', type: 'montant', aide: 'Travaux, assurance loyers impayés, frais divers retenus par l’agence.' },
      { cle: 'natureAutres', libelle: 'Nature des autres retenues (facultatif)', type: 'texte' },
      { cle: 'verseLe', libelle: 'Versé le', type: 'date', requis: true },
    ],
    valeurs: existant
      ? { loyer: existant.loyer, honoraires: existant.honoraires, autres: existant.autres || 0, natureAutres: existant.natureAutres || '', verseLe: existant.verseLe }
      : { loyer, honoraires: honorairesProposes(bien, loyer), autres: 0, natureAutres: '', verseLe: aujourdhui() },
    libelleValider: 'Enregistrer',
  });
  if (!saisie) return null;
  const releve = await executer(etat.enregistrer('relevesGerance', {
    id: existant?.id, bienId: bien.id, annee: ligne.annee, mois: ligne.mois,
    loyer: Number(saisie.loyer) || 0, honoraires: Number(saisie.honoraires) || 0, autres: Number(saisie.autres) || 0, natureAutres: saisie.natureAutres || '',
    net: netDe(saisie), verseLe: saisie.verseLe, documentId: existant?.documentId || '',
  }), `Relevé de ${ligne.libelle} enregistré : net versé ${montant(netDe(saisie))}.`);
  if (releve && !existant && !releve.documentId) {
    const joindre = await confirmer({ titre: 'Relevé PDF de l’agence', message: 'Joindre maintenant le relevé de gérance envoyé par l’agence (PDF ou image) ? Il sera rangé dans les documents du logement, masqué aux colocataires.', libelleValider: 'Joindre le relevé' });
    if (joindre) await joindreReleve(bien, ligne, releve).catch(signalerErreur);
  }
  return releve;
}

/** Joint le PDF du relevé : document du logement (masqué), rattaché au relevé. */
async function joindreReleve(bien, ligne, releve) {
  const fichier = await choisirFichier({ accept: 'application/pdf,image/*' });
  if (!fichier) return;
  if (fichier.size > 10 * 1024 * 1024) { notifier('Fichier trop lourd : 10 Mo au plus.', 'erreur'); return; }
  const nom = `releve-gerance-${ligne.annee}-${String(ligne.mois).padStart(2, '0')}-${nomFichierSur(fichier.name)}`;
  const depot = await api.deposerFichier('partage', cheminDocument(bien.id, nom), fichier);
  const document_ = await etat.enregistrer('documentsLogement', {
    bienId: bien.id, categorie: 'autre', titre: `Relevé de gérance — ${ligne.libelle}`,
    nomFichier: nomDuChemin(depot.chemin), chemin: depot.chemin, taille: fichier.size, deposeLe: aujourdhui(), deposeA: new Date().toISOString(),
    valableJusquau: '', visible: false, notifieLe: '',
  });
  await executer(etat.modifierElement('relevesGerance', releve.id, (r) => { r.documentId = document_.id; }), `Relevé PDF de ${ligne.libelle} joint.`);
}

async function retirerReleve(bien, ligne) {
  const ok = await confirmer({ titre: 'Retirer le relevé', message: `Retirer le relevé de ${ligne.libelle} ? Le PDF éventuellement joint reste dans les documents du logement.`, libelleValider: 'Retirer', danger: true });
  if (!ok) return;
  await executer(etat.supprimer('relevesGerance', ligne.releve.id), 'Relevé retiré.');
}

/**
 * La carte d'un logement géré par une agence : les mois de l'année, le relevé
 * de chacun, les totaux. Renvoie { carte, attendu, encaisse } (en net, D1).
 */
function carteGerance(donnees, bien, annee, contexte) {
  const releves = donnees.relevesGerance || etat.liste('relevesGerance');
  const documents = etat.liste('documentsLogement');
  const lignes = lignesAnnee(bien, releves, annee, aujourdhui());
  const totaux = totauxAnnee(lignes);
  const bailleur = donnees.parametres.bailleurs?.[0];
  const colonnes = [
    { titre: 'Mois', valeur: (l) => h('div', {}, [h('div', { texte: l.libelle }), l.releve ? null : h('div', { class: 'legende', texte: `versement attendu le ${date(l.attenduLe)}` })]) },
    { titre: 'Loyer encaissé', nombre: true, valeur: (l) => (l.releve ? montant(l.releve.loyer || 0) : '—') },
    { titre: 'Honoraires', nombre: true, valeur: (l) => (l.releve ? montant(l.releve.honoraires || 0) : '—') },
    { titre: 'Autres retenues', nombre: true, valeur: (l) => (l.releve && Number(l.releve.autres) > 0 ? h('span', { title: l.releve.natureAutres || '' }, [montant(l.releve.autres), l.releve.natureAutres ? h('div', { class: 'legende', texte: l.releve.natureAutres }) : null]) : (l.releve ? '—' : '—')) },
    { titre: 'Net versé', nombre: true, valeur: (l) => (l.releve ? h('strong', { texte: montant(l.releve.net || 0) }) : '—') },
    { titre: 'Versé le', valeur: (l) => (l.releve?.verseLe ? date(l.releve.verseLe) : '—') },
    { titre: 'Relevé', valeur: (l) => {
      if (!l.releve) return h('span', { class: 'legende', texte: '—' });
      const document_ = documents.find((d) => d.id === l.releve.documentId);
      return document_
        ? bouton(`📄 ${document_.nomFichier}`, () => api.ouvrirFichier('partage', document_.chemin).catch(signalerErreur), { petit: true, titre: 'Ouvrir le relevé de l’agence' })
        : bouton('Joindre le PDF', () => joindreReleve(bien, l, l.releve).catch(signalerErreur), { petit: true, titre: 'Joindre le relevé de gérance envoyé par l’agence' });
    } },
    { titre: 'État', valeur: (l) => badge(LIBELLES_ETAT_MOIS[l.etat].texte, LIBELLES_ETAT_MOIS[l.etat].ton) },
    { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
      l.releve
        ? bouton('Modifier', () => saisirReleve(bien, l, l.releve).catch(signalerErreur), { petit: true })
        : bouton('Relevé reçu', () => saisirReleve(bien, l).catch(signalerErreur), { petit: true, type: l.etat === 'manquant' ? 'primaire' : undefined, titre: 'Enregistrer le relevé de gérance de ce mois' }),
      l.releve ? bouton('✕', () => retirerReleve(bien, l).catch(signalerErreur), { petit: true, type: 'danger', titre: 'Retirer le relevé' }) : null,
    ]) },
  ];
  const carteElement = carte({
    titre: bien.nom,
    teinte: teinteLogement(bien, (contexte.tout || donnees).biens),
    aide: resumeGerance(bien, montant) || 'Complétez la fiche du logement (agence, loyer, honoraires).',
    resume: `${montant(totaux.net)} nets versés · ${totaux.recus} / ${totaux.attendus} relevés${totaux.manquants.length ? ` · ${totaux.manquants.length} manquant${totaux.manquants.length > 1 ? 's' : ''}` : ''}`,
    actions: [
      badge('Géré par une agence', 'info'),
      bouton('Relevé annuel', () => imprimerReleveGerance({ bailleur, bien, annee, lignes, totaux }), { petit: true, titre: 'Mois par mois, avec les éléments pour la déclaration de revenus (loyers bruts, honoraires, net)' }),
      !contexte.bienId ? bouton('Ce logement seul', () => contexte.definirLogement(bien.id), { petit: true, type: 'discret' }) : null,
    ],
    corps: [
      h('div', { class: 'grille grille-4', style: 'margin-bottom:.8rem' }, [
        tuile({ libelle: `Loyers encaissés par l’agence ${annee}`, valeur: montant(totaux.loyers, { rond: true }), detail: 'recettes brutes' }),
        tuile({ libelle: 'Honoraires retenus', valeur: montant(totaux.honoraires, { rond: true }), detail: totaux.autres > 0.005 ? `+ ${montant(totaux.autres)} d’autres retenues` : 'charges déductibles' }),
        tuile({ libelle: 'Net versé', valeur: montant(totaux.net, { rond: true }), ton: 'positif', detail: `${totaux.recus} / ${totaux.attendus} relevés reçus` }),
        tuile({ libelle: 'Relevés manquants', valeur: String(totaux.manquants.length), ton: totaux.manquants.length ? 'negatif' : 'neutre', detail: totaux.manquants.length ? totaux.manquants.map((m) => nomMois(m)).join(', ') : 'à jour' }),
      ]),
      tableau({
        colonnes, lignes, cle: (l) => `${l.annee}-${l.mois}`, messageVide: 'Aucun mois : vérifiez la date « géré depuis » de la fiche.',
        pied: ligneTotal(colonnes, [h('strong', { texte: `Total ${annee}` }), montant(totaux.loyers), montant(totaux.honoraires), montant(totaux.autres), h('strong', { texte: montant(totaux.net) }), '', '', badge(`${totaux.recus} / ${totaux.attendus} relevés`, totaux.manquants.length ? 'alerte' : (totaux.recus === totaux.attendus ? 'succes' : 'attente')), '']),
      }),
    ],
  });
  return { carte: carteElement, attendu: totaux.netAttendu, encaisse: totaux.net, manquants: totaux.manquants.length };
}

/** Bandeau d'un logement dans la vue « Tous les logements ». */
const enteteLogement = (bien, contexte) => h('div', { class: 'section-logement' }, [
  h('h2', { texte: bien.nom }),
  badge(libelleTypeLocation(bien), estCourteDuree(bien) ? 'info' : (estGracieux(bien) ? 'attente' : 'succes')),
  h('span', { class: 'legende', texte: [bien.adresse, bien.ville].filter(Boolean).join(', ') }),
  bouton('Ce logement seul', () => contexte.definirLogement(bien.id), { petit: true, type: 'discret', titre: 'Afficher uniquement ce logement dans toutes les pages' }),
]);

const sousTotalLogement = (attendu, encaisse) => h('div', { class: 'sous-total-logement' }, [
  h('span', {}, ['Sous-total : attendu ', h('strong', { texte: montant(attendu) })]),
  h('span', {}, ['encaissé ', h('strong', { texte: montant(encaisse) })]),
  h('span', {}, ['reste ', h('strong', { texte: montant(centimes(attendu - encaisse)) })]),
]);


export default {
  cle: 'loyers',
  libelle: 'Loyers',
  icone: '📅',
  titre: 'Virements et quittances',
  sousTitre: (contexte) => `Les loyers attendus et reçus de chaque colocataire en ${contexte.annee}, et leurs quittances.`,
  compteur(contexte) {
    const donnees = contexte.donnees || {};
    if (!donnees.baux) return null;
    const sejours = (donnees.loyers || []).filter((l) => l.sejour && Number(l.annee) === Number(contexte.annee) && l.depart && l.depart <= aujourdhui());
    const retards = [...calcul.echeancesGlobales(donnees.baux, contexte.annee, donnees.loyers), ...sejours]
      .filter((e) => calcul.statut(e) === 'retard' || calcul.statut(e) === 'partiel').length;
    return retards || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const conteneur = h('div');
    const logementsCourteDuree = donnees.biens.filter(estCourteDuree);
    const logementsAgence = donnees.biens.filter(estAgence);

    if (!donnees.baux.length && !logementsCourteDuree.length && !logementsAgence.length) {
      return carte({
        titre: 'Aucun bail',
        corps: vide('Rien à quittancer pour l’instant',
          'Enregistrez d’abord un bail dans « Logements & baux » : les échéances mensuelles en découlent automatiquement.'),
      });
    }

    const toutes = calcul.echeancesGlobales(donnees.baux, annee, donnees.loyers);
    const sejoursAnnee = logementsCourteDuree.flatMap((bien) => sejoursDe(donnees.loyers, bien.id, annee));
    // v58 (D1) : un logement géré par une agence compte en net versé.
    const gerance = logementsAgence.map((bien) => totauxAnnee(lignesAnnee(bien, donnees.relevesGerance || [], annee, aujourdhui())));
    const attendu = centimes([...toutes, ...sejoursAnnee].reduce((s, e) => s + (e.total || 0), 0) + gerance.reduce((s, g) => s + g.netAttendu, 0));
    const encaisse = centimes([...toutes, ...sejoursAnnee].reduce((s, e) => s + calcul.totalEncaisse(e), 0) + gerance.reduce((s, g) => s + g.net, 0));
    const impayes = [...toutes, ...sejoursAnnee.filter((x) => x.depart && x.depart <= aujourdhui())]
      .filter((e) => ['retard', 'partiel'].includes(calcul.statut(e)));
    const relevesManquants = gerance.reduce((s, g) => s + g.manquants.length, 0);
    const resteDu = centimes(impayes.reduce((s, e) => s + (e.total - calcul.totalEncaisse(e)), 0));

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Attendu ${annee}`, valeur: montant(attendu, { rond: true }), detail: `${toutes.length} échéance(s)${sejoursAnnee.length ? `, ${sejoursAnnee.length} séjour(s)` : ''}` }),
      tuile({ libelle: 'Encaissé', valeur: montant(encaisse, { rond: true }), ton: 'positif' }),
      tuile({ libelle: 'Reste dû', valeur: montant(resteDu, { rond: true }), ton: resteDu > 0 ? 'negatif' : 'neutre', detail: `${impayes.length} échéance(s)${relevesManquants ? ` · ${relevesManquants} relevé(s) d’agence manquant(s)` : ''}` }),
      tuile({
        libelle: 'Taux de recouvrement',
        valeur: attendu ? `${Math.round((encaisse / attendu) * 100)} %` : '—',
      }),
    ]));

    // Échéances (et dépôts de garantie) enregistrés qui ne correspondent plus aux baux (v43).
    const bandeau = bandeauMiseAJour(donnees);
    if (bandeau) conteneur.append(bandeau);
    // v49 : appels de loyer depuis cette page — journal lu à l'affichage.
    if (!journalAppels) chargerJournalAppels(contexte);
    const presentation = lirePresentation();
    conteneur.append(barreOutils([
      bouton('Mettre à jour les échéances', () => ouvrirMiseAJour(donnees).catch(signalerErreur), { titre: 'Compare les échéances et dépôts enregistrés aux baux : orphelins, montants modifiés' }),
      boutonAppelDuMois(contexte, donnees),
      boutonRegenererQuittances(contexte, donnees, toutes),
      h('span', { class: 'espace' }),
      selecteurPresentation(contexte, presentation),
    ]));

    // Vue « Tous les logements » : un bandeau par logement, ses cartes, puis
    // son sous-total. Avec un seul logement affiché, les cartes seules.
    const grouper = !contexte.bienId && donnees.biens.length > 1;
    // Un bail dont le logement a été supprimé reste visible, en fin de page.
    const logements = [...donnees.biens, ...(donnees.baux.some((b) => !donnees.biens.some((x) => x.id === b.bienId)) ? [null] : [])];
    for (const bien of logements) {
    // v50 : en vue « Tous les logements », le bandeau d'un logement replie ses cartes.
    let cible = conteneur;
    if (grouper) {
      const groupe = groupeRepliable({ entete: bien ? enteteLogement(bien, contexte) : h('div', { class: 'section-logement' }, [h('h2', { texte: 'Baux sans logement' })]), cle: bien?.id || 'sans-logement', teinte: bien ? teinteLogement(bien, (contexte.tout || donnees).biens) : '' });
      conteneur.append(groupe.element);
      cible = groupe.corps;
    }
    let attenduLogement = 0;
    let encaisseLogement = 0;
    if (bien && estAgence(bien)) {
      const g = carteGerance(donnees, bien, annee, contexte);
      cible.append(g.carte);
      if (grouper) cible.append(sousTotalLogement(centimes(g.attendu), centimes(g.encaisse)));
      continue;
    }
    if (bien && estGracieux(bien)) {
      cible.append(carte({ titre: bien.nom, teinte: teinteLogement(bien, (contexte.tout || donnees).biens), serre: true, corps: vide('Occupation à titre gracieux', 'Ce logement est occupé par un bailleur ou un proche : aucun loyer n’est attendu, aucun appel n’est envoyé.') }));
      continue;
    }
    if (bien && estCourteDuree(bien)) {
      const sejours = sejoursDe(donnees.loyers, bien.id, annee);
      attenduLogement = sejours.reduce((s, x) => s + (x.total || 0), 0);
      encaisseLogement = sejours.reduce((s, x) => s + calcul.totalEncaisse(x), 0);
      cible.append(carteSejours(donnees, bien, annee));
      if (grouper) cible.append(sousTotalLogement(centimes(attenduLogement), centimes(encaisseLogement)));
      continue;
    }
    const bauxDuLogement = donnees.baux.filter((b) => (bien ? b.bienId === bien.id : !donnees.biens.some((x) => x.id === b.bienId)));
    // v55 : toutes les échéances de l'année du logement, chacune avec son bail,
    // présentées par mois (une carte par mois) ou par locataire (une carte par payeur).
    const lignesLogement = [];
    for (const bail of bauxDuLogement) {
      for (const echeance of calcul.echeancesAnnee(bail, annee, donnees.loyers)) lignesLogement.push({ echeance, bail });
    }
    attenduLogement += lignesLogement.reduce((s, x) => s + (x.echeance.total || 0), 0);
    encaisseLogement += lignesLogement.reduce((s, x) => s + calcul.totalEncaisse(x.echeance), 0);
    const cartes = presentation === 'mois'
      ? cartesParMois({ contexte, donnees, bien, annee, lignes: lignesLogement, cible })
      : cartesParLocataire({ contexte, donnees, bien, annee, lignes: lignesLogement, cible });
    if (!cartes) {
      cible.append(carte({
        titre: bien ? bien.nom : 'Baux sans logement',
        corps: vide(`Aucune échéance en ${annee}`, bauxDuLogement.length
          ? 'Aucun bail de ce logement ne couvre cette année.'
          : 'Aucun bail pour ce logement : enregistrez-en un dans « Logements & baux ».'),
        serre: true,
      }));
    }
    if (grouper) cible.append(sousTotalLogement(centimes(attenduLogement), centimes(encaisseLogement)));
    }

    return conteneur;
  },
};
