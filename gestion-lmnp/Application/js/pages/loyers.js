// Virements des colocataires, échéances mensuelles et quittances.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, ouvrirModale, fermerModale, signalerErreur } from '../ui.js';
import { montant, date, nomMois, dateLongue, aujourdhui, centimes, isoDepuis, nomFichierTelechargement } from '../format.js';
import * as calcul from '../calculs/loyers.js';
import { ouvrirMiseAJour, bandeauMiseAJour } from './maj-ui.js';
import { imprimerQuittance, imprimerAvis, imprimerReleve } from '../impression.js';
import { pdfQuittanceAnika, dateLongueFr, sirenDepuisSiret } from '../pdf-anika.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';
import { estCourteDuree, libelleTypeLocation, sejoursDe, gabaritSejour, nuitsEntre, phaseSejour, PLATEFORMES } from '../logements.js';
import { apercuAppels, apercuAppelEcheance, envoyerAppelEcheance, envoyerAppels, lireJournalAppels, reglageAppel, logementsAvecAppel } from '../appel-loyer-client.js';
import { resumeAppels, moisVise, sansAppel } from '../appel-loyer.js';

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
async function quittancePdfEtEnvoi(donnees, bail, echeance) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return; }
  const locataire = locataireDe(donnees, echeance, bail);
  if (!locataire) { notifier('Locataire introuvable pour cette échéance.', 'erreur'); return; }
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
  const bornes = periodeBornes(echeance, bail);
  const dernier = (echeance.encaissements || []).slice(-1)[0];

  const octets = await pdfQuittanceAnika({
    bailleur: {
      nom: bailleur.nom,
      adresse: bailleur.adresse || '',
      email: bailleur.email || '',
      siren: sirenDepuisSiret(donnees.parametres.siret),
    },
    locataireNom: nomDe(locataire),
    logement: { adresse: bien?.adresse || '', codePostal: bien?.codePostal || '', ville: bien?.ville || '' },
    periodeLibelle: `${nomMois(echeance.mois)} ${echeance.annee}`,
    periodeDebut: dateLongueFr(bornes.debut),
    periodeFin: dateLongueFr(bornes.fin),
    loyerHc: echeance.loyerHc || 0,
    charges: echeance.charges || 0,
    lieu: donnees.parametres.lieuSignature || '',
    dateSignature: dateLongueFr(dernier?.date || aujourdhui()),
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

  const telecharger = () => {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  };

  const notifierParEmail = async () => {
    if (!locataire.email) { notifier('Ce colocataire n’a pas d’adresse e-mail (à renseigner dans « Logements & baux »).', 'erreur'); return; }
    if (!publie) { notifier('La quittance n’a pas pu être déposée sur son espace — corrigez d’abord ce point.', 'erreur'); return; }
    await executer(api.envoyerCourriel({ type: 'documents',
      destinataires: destinatairesDe(locataire),
      sujet: `Votre quittance de loyer — ${nomMois(echeance.mois)} ${echeance.annee}`,
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Votre quittance de loyer pour <strong>${nomMois(echeance.mois)} ${echeance.annee}</strong> `
        + `(${montant(echeance.total || 0)}) est disponible sur votre espace :</p>`
        + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
        + '<p>Connectez-vous avec votre adresse e-mail pour la consulter et la télécharger.</p>'
        + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
    }), `Notification de mise à disposition envoyée à ${locataire.email}.`);
  };

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
      h('button', { class: 'bouton', type: 'button', onclick: telecharger }, 'Télécharger le PDF'),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: notifierParEmail }, 'Notifier par e-mail'),
    ],
  });
}

/** Enregistre une échéance (création si elle n'existait pas encore). */
async function enregistrerEcheance(echeance, modifications) {
  return etat.enregistrer('loyers', { ...gabaritEcheance(echeance), ...modifications });
}

async function saisirEncaissement(echeance) {
  const reste = centimes((echeance.total || 0) - calcul.totalEncaisse(echeance));
  const saisie = await formulaire({
    titre: `Encaissement — ${nomMois(echeance.mois)} ${echeance.annee}`,
    champs: [
      { cle: 'date', libelle: 'Date de l’encaissement', type: 'date', requis: true },
      { cle: 'montant', libelle: 'Montant reçu (€)', type: 'montant', requis: true },
      { cle: 'mode', libelle: 'Mode de règlement', type: 'liste', options: etat.MODES_REGLEMENT.map((m) => ({ valeur: m, libelle: m })) },
      { cle: 'reference', libelle: 'Référence (facultatif)', type: 'texte', largeur: 'pleine' },
    ],
    valeurs: { date: aujourdhui(), montant: reste > 0 ? reste : echeance.total, mode: 'Virement' },
  });
  if (!saisie) return;
  const nouvel = {
    id: crypto.randomUUID(),
    date: saisie.date,
    montant: Number(saisie.montant) || 0,
    mode: saisie.mode,
    reference: saisie.reference || '',
  };
  // Ajout additif sur la version fraîche : un encaissement saisi en même temps
  // depuis l'autre poste n'est jamais écrasé.
  await executer(
    etat.modifierElement('loyers', echeance.id, (e) => {
      e.encaissements = [...(e.encaissements || []), nouvel];
    }, gabaritEcheance(echeance)),
    'Encaissement enregistré.',
  );
}

async function ajusterEcheance(echeance) {
  const saisie = await formulaire({
    titre: `Échéance de ${nomMois(echeance.mois)} ${echeance.annee}`,
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

function voirEncaissements(echeance) {
  const encaissements = echeance.encaissements || [];
  if (!encaissements.length) { notifier('Aucun encaissement sur cette échéance.'); return; }
  const corps = tableau({
    colonnes: [
      { titre: 'Date', valeur: (e) => date(e.date) },
      { titre: 'Montant', nombre: true, valeur: (e) => montant(e.montant) },
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
  ouvrirModale({ titre: `Encaissements — ${nomMois(echeance.mois)} ${echeance.annee}`, corps });
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
    titre: `${nomMois(echeance.mois)} ${echeance.annee} — autres actions`,
    corps: h('div', {}, [
      action('🖨 Imprimer', () => documentsQuittance(donnees, bail, echeance, calcul.statut(echeance) === 'paye'),
        'Quittance si payée, sinon avis d’échéance'),
      action('✎ Ajuster les montants', () => ajusterEcheance(echeance)),
      action('📄 Voir les encaissements', () => voirEncaissements(echeance)),
    ]),
  });
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

/** Bandeau d'un logement dans la vue « Tous les logements ». */
const enteteLogement = (bien, contexte) => h('div', { class: 'section-logement' }, [
  h('h2', { texte: bien.nom }),
  badge(libelleTypeLocation(bien), estCourteDuree(bien) ? 'info' : 'succes'),
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

    if (!donnees.baux.length && !logementsCourteDuree.length) {
      return carte({
        titre: 'Aucun bail',
        corps: vide('Rien à quittancer pour l’instant',
          'Enregistrez d’abord un bail dans « Logements & baux » : les échéances mensuelles en découlent automatiquement.'),
      });
    }

    const toutes = calcul.echeancesGlobales(donnees.baux, annee, donnees.loyers);
    const sejoursAnnee = logementsCourteDuree.flatMap((bien) => sejoursDe(donnees.loyers, bien.id, annee));
    const attendu = centimes([...toutes, ...sejoursAnnee].reduce((s, e) => s + (e.total || 0), 0));
    const encaisse = centimes([...toutes, ...sejoursAnnee].reduce((s, e) => s + calcul.totalEncaisse(e), 0));
    const impayes = [...toutes, ...sejoursAnnee.filter((x) => x.depart && x.depart <= aujourdhui())]
      .filter((e) => ['retard', 'partiel'].includes(calcul.statut(e)));
    const resteDu = centimes(impayes.reduce((s, e) => s + (e.total - calcul.totalEncaisse(e)), 0));

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Attendu ${annee}`, valeur: montant(attendu, { rond: true }), detail: `${toutes.length} échéance(s)${sejoursAnnee.length ? `, ${sejoursAnnee.length} séjour(s)` : ''}` }),
      tuile({ libelle: 'Encaissé', valeur: montant(encaisse, { rond: true }), ton: 'positif' }),
      tuile({ libelle: 'Reste dû', valeur: montant(resteDu, { rond: true }), ton: resteDu > 0 ? 'negatif' : 'neutre', detail: `${impayes.length} échéance(s)` }),
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
    conteneur.append(barreOutils([
      bouton('Mettre à jour les échéances', () => ouvrirMiseAJour(donnees).catch(signalerErreur), { titre: 'Compare les échéances et dépôts enregistrés aux baux : orphelins, montants modifiés' }),
      boutonAppelDuMois(contexte, donnees),
    ]));

    // Vue « Tous les logements » : un bandeau par logement, ses cartes, puis
    // son sous-total. Avec un seul logement affiché, les cartes seules.
    const grouper = !contexte.bienId && donnees.biens.length > 1;
    // Un bail dont le logement a été supprimé reste visible, en fin de page.
    const logements = [...donnees.biens, ...(donnees.baux.some((b) => !donnees.biens.some((x) => x.id === b.bienId)) ? [null] : [])];
    for (const bien of logements) {
    if (grouper) conteneur.append(bien ? enteteLogement(bien, contexte) : h('div', { class: 'section-logement' }, [h('h2', { texte: 'Baux sans logement' })]));
    let attenduLogement = 0;
    let encaisseLogement = 0;
    if (bien && estCourteDuree(bien)) {
      const sejours = sejoursDe(donnees.loyers, bien.id, annee);
      attenduLogement = sejours.reduce((s, x) => s + (x.total || 0), 0);
      encaisseLogement = sejours.reduce((s, x) => s + calcul.totalEncaisse(x), 0);
      conteneur.append(carteSejours(donnees, bien, annee));
      if (grouper) conteneur.append(sousTotalLogement(centimes(attenduLogement), centimes(encaisseLogement)));
      continue;
    }
    const bauxDuLogement = donnees.baux.filter((b) => (bien ? b.bienId === bien.id : !donnees.biens.some((x) => x.id === b.bienId)));
    let cartes = 0;
    for (const bail of bauxDuLogement) {
      const toutesEcheances = calcul.echeancesAnnee(bail, annee, donnees.loyers);
      if (!toutesEcheances.length) continue;
      attenduLogement += toutesEcheances.reduce((s, e) => s + (e.total || 0), 0);
      encaisseLogement += toutesEcheances.reduce((s, e) => s + calcul.totalEncaisse(e), 0);

      // Une carte par payeur : chaque colocataire suit ses propres virements.
      const parLocataire = new Map();
      for (const echeance of toutesEcheances) {
        const cle = echeance.locataireId || bail.locataireId || '';
        if (!parLocataire.has(cle)) parLocataire.set(cle, []);
        parLocataire.get(cle).push(echeance);
      }

      for (const [locataireId, echeances] of parLocataire) {
      const locataireCourant = donnees.locataires.find((l) => l.id === locataireId) || null;
      const totalBail = centimes(echeances.reduce((s, e) => s + (e.total || 0), 0));
      const recuBail = centimes(echeances.reduce((s, e) => s + calcul.totalEncaisse(e), 0));

      const colonnes = [
        { titre: 'Mois', valeur: (e) => h('div', {}, [
          h('div', { texte: nomMois(e.mois) }),
          h('div', { class: 'legende', texte: `échéance ${date(e.dateEcheance)}${e.partiel ? ' · mois partiel' : ''}${e.horsBail ? ' · hors bail' : ''}` }),
          traceAppels(e),
        ]) },
        { titre: 'Loyer + charges', nombre: true, valeur: (e) => `${montant(e.loyerHc)} + ${montant(e.charges)}` },
        { titre: 'Total dû', nombre: true, valeur: (e) => montant(e.total) },
        { titre: 'Encaissé', nombre: true, valeur: (e) => {
          const recu = calcul.totalEncaisse(e);
          return recu ? h('button', { class: 'bouton-lien', style: 'color:inherit', onclick: () => voirEncaissements(e) }, montant(recu)) : '—';
        } },
        { titre: 'Reste', nombre: true, valeur: (e) => {
          const reste = centimes(e.total - calcul.totalEncaisse(e));
          return reste > 0.005 ? h('span', { style: 'color:var(--alerte)', texte: montant(reste) }) : '—';
        } },
        { titre: 'État', valeur: ligneStatut },
        { titre: '', actions: true, valeur: (e) => h('div', { class: 'groupe-boutons' }, [
          bouton('Virement reçu', () => saisirEncaissement(e), { petit: true, type: 'primaire' }),
          bouton('Quittance', () => quittancePdfEtEnvoi(donnees, bail, e), {
            petit: true,
            titre: calcul.statut(e) === 'paye'
              ? 'Générer la quittance PDF (téléchargement, envoi par e-mail)'
              : 'Quittance possible seulement quand l’échéance est intégralement payée',
            desactive: calcul.statut(e) !== 'paye',
          }),
          api.MODE === 'nuage' && !e.horsBail && centimes(e.total - calcul.totalEncaisse(e)) > 0.005 && locataireCourant?.email
            ? (resumeAppels(journalAppels, e.id)
              ? bouton('Relancer ✉', () => appelerEcheance(contexte, e, { relance: true }).catch(signalerErreur), { petit: true, titre: 'Relance de l’appel de loyer de ce mois (objet « Relance — … »)' })
              : bouton('Appel ✉', () => appelerEcheance(contexte, e).catch(signalerErreur), { petit: true, titre: 'Appel de loyer de ce mois à ce colocataire' }))
            : null,
          bouton('⋯', () => menuEcheance(donnees, bail, e), { petit: true, titre: 'Imprimer, ajuster, encaissements…' }),
        ]) },
      ];

      cartes += 1;
      conteneur.append(carte({
        titre: `${nomDe(locataireCourant)} — ${bien?.nom || 'logement inconnu'}`,
        aide: `${montant(recuBail)} reçus sur ${montant(totalBail)} attendus en ${annee}`
          + (locataireCourant?.email ? '' : ' · pas d’adresse e-mail renseignée'),
        actions: [
          bouton('Pointer les impayés', async () => {
            const aRegler = echeances.filter((e) => ['retard', 'partiel'].includes(calcul.statut(e)));
            if (!aRegler.length) { notifier('Aucun impayé pour ce colocataire.'); return; }
            const confirme = await confirmer({
              titre: 'Encaisser les impayés',
              message: `${aRegler.length} échéance(s) seront marquées encaissées à la date d’aujourd’hui, `
                + `pour un total de ${montant(centimes(aRegler.reduce((s, e) => s + e.total - calcul.totalEncaisse(e), 0)))}.`,
              libelleValider: 'Encaisser',
            });
            if (!confirme) return;
            let faits = 0;
            let echoues = 0;
            for (const echeance of aRegler) {
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
              } catch (erreur) { echoues += 1; console.error(erreur); }
            }
            if (faits) notifier(`${faits} impayé(s) encaissé(s).`, 'succes');
            if (echoues) notifier(`${echoues} échéance(s) n’ont pas pu être enregistrées.`, 'erreur');
          }, { petit: true }),
          bouton('Relevé annuel', () => imprimerReleve({
            bailleur: donnees.parametres.bailleurs?.[0],
            locataire: locataireCourant,
            bien, annee, echeances,
          }), { petit: true }),
        ],
        serre: true,
        corps: tableau({ colonnes, lignes: echeances, cle: (e) => e.id, messageVide: 'Aucune échéance.' }),
      }));
      }
    }
    if (!cartes) {
      conteneur.append(carte({
        titre: bien ? bien.nom : 'Baux sans logement',
        corps: vide(`Aucune échéance en ${annee}`, bauxDuLogement.length
          ? 'Aucun bail de ce logement ne couvre cette année.'
          : 'Aucun bail pour ce logement : enregistrez-en un dans « Logements & baux ».'),
        serre: true,
      }));
    }
    if (grouper) conteneur.append(sousTotalLogement(centimes(attenduLogement), centimes(encaisseLogement)));
    }

    return conteneur;
  },
};
