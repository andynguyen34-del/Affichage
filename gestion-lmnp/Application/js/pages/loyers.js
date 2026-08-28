// Virements des colocataires, échéances mensuelles et quittances.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, ouvrirModale } from '../ui.js';
import { montant, date, nomMois, dateLongue, aujourdhui, centimes, isoDepuis } from '../format.js';
import * as calcul from '../calculs/loyers.js';
import { imprimerQuittance, imprimerAvis, imprimerReleve } from '../impression.js';
import { pdfQuittance, octetsEnBase64 } from '../pdf.js';
import { publierDocument } from '../portail-publication.js';
import * as api from '../api.js';

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

/** Période couverte par une échéance, bornée aux dates du bail. */
function periodeTexte(echeance, bail) {
  const dernierJour = new Date(echeance.annee, echeance.mois, 0).getDate();
  let debut = isoDepuis(echeance.annee, echeance.mois, 1);
  let fin = isoDepuis(echeance.annee, echeance.mois, dernierJour);
  const debutBail = String(bail?.dateDebut || '').slice(0, 10);
  const finBail = String(bail?.dateFin || '').slice(0, 10);
  if (debutBail && debutBail > debut) debut = debutBail;
  if (finBail && finBail < fin) fin = finBail;
  return `du ${dateLongue(debut)} au ${dateLongue(fin)}`;
}

/**
 * Génère la quittance PDF d'une échéance intégralement payée, la publie sur le
 * portail du colocataire, propose le téléchargement et l'envoi par e-mail.
 */
async function quittancePdfEtEnvoi(donnees, bail, echeance) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return; }
  const locataire = locataireDe(donnees, echeance, bail);
  if (!locataire) { notifier('Locataire introuvable pour cette échéance.', 'erreur'); return; }
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
  const periode = periodeTexte(echeance, bail);
  const dernier = (echeance.encaissements || []).slice(-1)[0];

  const octets = await pdfQuittance({
    bailleur, locataire, bien, echeance, periode,
    dateReglement: dernier?.date || aujourdhui(),
    lieu: donnees.parametres.lieuSignature || '',
  });
  const nomFichier = `Quittance ${echeance.annee}-${String(echeance.mois).padStart(2, '0')} ${nomDe(locataire)}.pdf`;

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
    lien.download = nomFichier;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  };

  const envoyer = async () => {
    if (!locataire.email) { notifier('Ce colocataire n’a pas d’adresse e-mail (à renseigner dans « Bien & baux »).', 'erreur'); return; }
    await executer(api.envoyerCourriel({
      destinataires: [locataire.email],
      sujet: `Quittance de loyer — ${nomMois(echeance.mois)} ${echeance.annee}`,
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Veuillez trouver ci-joint votre quittance de loyer pour ${nomMois(echeance.mois)} ${echeance.annee} `
        + `(${montant(echeance.total || 0)}).</p>`
        + '<p>Elle reste aussi disponible à tout moment sur votre espace colocataire.</p>'
        + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
      piecesJointes: [{ nom: nomFichier, base64: octetsEnBase64(octets) }],
    }), `Quittance mise en file d’envoi vers ${locataire.email}.`);
  };

  ouvrirModale({
    titre: 'Quittance générée',
    corps: h('div', {}, [
      h('p', { texte: `Quittance de ${nomDe(locataire)} pour ${nomMois(echeance.mois)} ${echeance.annee} (${montant(echeance.total || 0)}).` }),
      publie
        ? h('p', { class: 'legende', texte: 'Déposée sur son espace colocataire : il peut la consulter et la télécharger.' })
        : h('p', { class: 'legende', style: 'color:var(--alerte)', texte: `Non publiée sur le portail : ${erreurPublication?.message || 'erreur inconnue'}` }),
    ]),
    pied: [
      h('button', { class: 'bouton', type: 'button', onclick: telecharger }, 'Télécharger le PDF'),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: envoyer }, 'Envoyer par e-mail'),
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

function ligneStatut(echeance) {
  const info = calcul.LIBELLES_STATUT[calcul.statut(echeance)];
  return badge(info.texte, info.ton);
}

export default {
  cle: 'loyers',
  libelle: 'Loyers',
  icone: '📅',
  titre: 'Virements et quittances',
  sousTitre: (contexte) => `Les loyers attendus et reçus de chaque colocataire en ${contexte.annee}, et leurs quittances.`,
  compteur(contexte) {
    const donnees = contexte.donnees || {};
    if (!donnees.baux) return null;
    const retards = calcul.echeancesGlobales(donnees.baux, contexte.annee, donnees.loyers)
      .filter((e) => calcul.statut(e) === 'retard' || calcul.statut(e) === 'partiel').length;
    return retards || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const conteneur = h('div');

    if (!donnees.baux.length) {
      return carte({
        titre: 'Aucun bail',
        corps: vide('Rien à quittancer pour l’instant',
          'Enregistrez d’abord un bail dans « Bien & baux » : les échéances mensuelles en découlent automatiquement.'),
      });
    }

    const toutes = calcul.echeancesGlobales(donnees.baux, annee, donnees.loyers);
    const attendu = centimes(toutes.reduce((s, e) => s + (e.total || 0), 0));
    const encaisse = centimes(toutes.reduce((s, e) => s + calcul.totalEncaisse(e), 0));
    const impayes = toutes.filter((e) => ['retard', 'partiel'].includes(calcul.statut(e)));
    const resteDu = centimes(impayes.reduce((s, e) => s + (e.total - calcul.totalEncaisse(e)), 0));

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Attendu ${annee}`, valeur: montant(attendu, { rond: true }), detail: `${toutes.length} échéances` }),
      tuile({ libelle: 'Encaissé', valeur: montant(encaisse, { rond: true }), ton: 'positif' }),
      tuile({ libelle: 'Reste dû', valeur: montant(resteDu, { rond: true }), ton: resteDu > 0 ? 'negatif' : 'neutre', detail: `${impayes.length} échéance(s)` }),
      tuile({
        libelle: 'Taux de recouvrement',
        valeur: attendu ? `${Math.round((encaisse / attendu) * 100)} %` : '—',
      }),
    ]));

    for (const bail of donnees.baux) {
      const toutesEcheances = calcul.echeancesAnnee(bail, annee, donnees.loyers);
      if (!toutesEcheances.length) continue;
      const bien = donnees.biens.find((b) => b.id === bail.bienId);

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
          e.partiel ? h('div', { class: 'legende', texte: 'mois partiel' }) : null,
          e.horsBail ? h('div', { class: 'legende', texte: 'hors période du bail' }) : null,
        ]) },
        { titre: 'Échéance', valeur: (e) => date(e.dateEcheance) },
        { titre: 'Loyer', nombre: true, valeur: (e) => montant(e.loyerHc) },
        { titre: 'Charges', nombre: true, valeur: (e) => montant(e.charges) },
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
              ? 'Générer la quittance PDF, la publier sur l’espace colocataire et l’envoyer par e-mail'
              : 'Quittance possible seulement quand l’échéance est intégralement payée',
            desactive: calcul.statut(e) !== 'paye',
          }),
          bouton('Imprimer', () => documentsQuittance(donnees, bail, e, calcul.statut(e) === 'paye'), {
            petit: true, titre: 'Imprimer (quittance si payée, sinon avis d’échéance)',
          }),
          bouton('⋯', () => ajusterEcheance(e), { petit: true, titre: 'Ajuster les montants' }),
        ]) },
      ];

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

    return conteneur;
  },
};
