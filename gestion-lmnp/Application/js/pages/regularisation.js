// Régularisation annuelle des charges : cumul des provisions prélevées sur
// les loyers, dépenses réelles récupérables (eau, ordures ménagères), et
// solde de chaque colocataire — décompte PDF déposé sur son espace.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, notifier, ouvrirModale } from '../ui.js';
import { montant, date, dateLongue, aujourdhui, centimes, nomFichierTelechargement } from '../format.js';
import { provisionsPeriode, decompteRegularisation } from '../calculs/loyers.js';
import { pdfRegularisation } from '../pdf.js';
import { publierDocument } from '../portail-publication.js';
import * as api from '../api.js';

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

/** Les dépenses réelles d'une régularisation, sous forme de lignes libellées. */
function depensesDe(regularisation) {
  return [
    { libelle: 'Eau (consommation et abonnement)', montant: Number(regularisation.eau) || 0 },
    { libelle: 'Taxe d\'enlèvement des ordures ménagères (TEOM)', montant: Number(regularisation.teom) || 0 },
    { libelle: regularisation.notes ? `Autres charges récupérables — ${regularisation.notes}` : 'Autres charges récupérables', montant: Number(regularisation.autres) || 0 },
  ].filter((d) => d.montant > 0);
}

function badgeSolde(solde) {
  if (solde > 0.005) return badge('À rembourser', 'attention');
  if (solde < -0.005) return badge('À réclamer', 'alerte');
  return badge('Équilibré', 'succes');
}

async function saisirRegularisation(donnees, contexte, existante = null) {
  // Par défaut : le bail de colocation en cours (les provisions à régulariser
  // viennent de là), à défaut le bail en cours, à défaut le premier.
  const bailParDefaut = donnees.baux.find((b) => (b.colocataires || []).length && (!b.dateFin || b.dateFin >= aujourdhui()))
    || donnees.baux.find((b) => !b.dateFin || b.dateFin >= aujourdhui())
    || donnees.baux[0];
  const saisie = await formulaire({
    titre: existante ? 'Régularisation' : 'Nouvelle régularisation',
    aide: 'Les dépenses réelles de la période sont réparties entre colocataires au prorata de leurs '
      + 'provisions, puis comparées à ce que chacun a réellement versé.',
    champs: [
      { cle: 'bailId', libelle: 'Bail', type: 'liste', options: donnees.baux.map((b) => ({
        valeur: b.id,
        libelle: `Bail du ${date(b.dateDebut)}${b.dateFin ? ` au ${date(b.dateFin)}` : ' (en cours)'}`,
      })) },
      { cle: 'debut', libelle: 'Début de la période', type: 'date', requis: true },
      { cle: 'fin', libelle: 'Fin de la période', type: 'date', requis: true },
      { cle: 'eau', libelle: 'Eau — dépense réelle (€)', type: 'montant',
        aide: 'Factures du service des eaux sur la période (consommation + abonnement).' },
      { cle: 'teom', libelle: 'Ordures ménagères — TEOM (€)', type: 'montant',
        aide: 'Ligne « TEOM » du détail des cotisations de l\'avis de taxe foncière (hors frais de gestion).' },
      { cle: 'autres', libelle: 'Autres charges récupérables (€)', type: 'montant' },
      { cle: 'notes', libelle: 'Nature des autres charges (facultatif)', type: 'texte', largeur: 'pleine' },
    ],
    valeurs: existante ? {
      bailId: existante.bailId,
      debut: existante.debut,
      fin: existante.fin,
      eau: existante.eau || 0,
      teom: existante.teom || 0,
      autres: existante.autres || 0,
      notes: existante.notes || '',
    } : {
      bailId: bailParDefaut?.id,
      debut: `${contexte.annee}-01-01`,
      fin: `${contexte.annee}-12-31`,
      eau: 0, teom: 0, autres: 0, notes: '',
    },
  });
  if (!saisie) return;
  if (saisie.fin < saisie.debut) { notifier('La fin de période précède son début.', 'erreur'); return; }
  await executer(etat.enregistrer('regularisations', {
    id: existante?.id,
    bailId: saisie.bailId,
    debut: saisie.debut,
    fin: saisie.fin,
    eau: Number(saisie.eau) || 0,
    teom: Number(saisie.teom) || 0,
    autres: Number(saisie.autres) || 0,
    notes: saisie.notes || '',
  }), 'Régularisation enregistrée.');
}

/**
 * Décompte PDF d'un colocataire : téléchargement, dépôt sur son espace et
 * e-mail de mise à disposition — même circuit que la quittance.
 */
async function decomptePdfEtEnvoi(donnees, regularisation, decompte, ligne) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return; }
  const locataire = donnees.locataires.find((l) => l.id === ligne.locataireId) || null;
  if (!locataire) { notifier('Locataire introuvable pour cette ligne.', 'erreur'); return; }
  const bail = donnees.baux.find((b) => b.id === regularisation.bailId);
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);

  const octets = await pdfRegularisation({
    bailleur, locataire, bien,
    debut: regularisation.debut,
    fin: regularisation.fin,
    depenses: depensesDe(regularisation),
    totalReel: decompte.totalReel,
    ligne,
    lieu: donnees.parametres.lieuSignature || '',
  });
  const nomFichier = `Regularisation charges ${regularisation.debut} ${nomDe(locataire)}.pdf`;

  let publie = null;
  let erreurPublication = null;
  try { publie = await publierDocument({
    locataire, type: 'regularisation',
    titre: `Régularisation des charges — ${dateLongue(regularisation.debut)} au ${dateLongue(regularisation.fin)}`,
    nomFichier, octets,
  }); } catch (erreur) { erreurPublication = erreur; }

  const telecharger = () => {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  };

  const notifierParEmail = async () => {
    if (!locataire.email) { notifier('Ce colocataire n’a pas d’adresse e-mail (à renseigner dans « Bien & baux »).', 'erreur'); return; }
    if (!publie) { notifier('Le décompte n’a pas pu être déposé sur son espace — corrigez d’abord ce point.', 'erreur'); return; }
    const solde = ligne.solde;
    const phrase = solde > 0.005
      ? `Le décompte fait apparaître un trop-perçu de <strong>${montant(solde)}</strong> en votre faveur.`
      : (solde < -0.005
        ? `Le décompte fait apparaître un complément de <strong>${montant(-solde)}</strong> à régler.`
        : 'Le décompte est équilibré : rien à régler de part ni d’autre.');
    await executer(api.envoyerCourriel({
      destinataires: [locataire.email],
      sujet: 'Votre décompte de régularisation des charges',
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Votre décompte de régularisation des charges pour la période du `
        + `<strong>${dateLongue(regularisation.debut)}</strong> au <strong>${dateLongue(regularisation.fin)}</strong> `
        + 'est disponible sur votre espace :</p>'
        + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
        + `<p>${phrase}</p>`
        + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
    }), `Notification de mise à disposition envoyée à ${locataire.email}.`);
  };

  ouvrirModale({
    titre: 'Décompte généré',
    corps: h('div', {}, [
      h('p', { texte: `Décompte de ${nomDe(locataire)} — solde de ${montant(ligne.solde)} `
        + `(${ligne.solde > 0.005 ? 'à lui rembourser' : (ligne.solde < -0.005 ? 'à lui réclamer' : 'équilibré')}).` }),
      publie
        ? h('p', { class: 'legende', texte: 'Déposé sur son espace : il peut le consulter et le télécharger en PDF.' })
        : h('p', { class: 'legende', style: 'color:var(--alerte)', texte:
          `Non déposé sur son espace : ${erreurPublication?.message || 'erreur inconnue'}` }),
    ]),
    pied: [
      h('button', { class: 'bouton', type: 'button', onclick: telecharger }, 'Télécharger le PDF'),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: notifierParEmail }, 'Notifier par e-mail'),
    ],
  });
}

function carteRegularisation(donnees, regularisation) {
  const bail = donnees.baux.find((b) => b.id === regularisation.bailId);
  if (!bail) {
    return carte({
      titre: `Régularisation du ${date(regularisation.debut)} au ${date(regularisation.fin)}`,
      corps: vide('Bail introuvable', 'Le bail de cette régularisation a été supprimé.'),
      actions: [bouton('Supprimer', () => supprimerRegularisation(regularisation), { petit: true, type: 'danger' })],
    });
  }
  const decompte = decompteRegularisation(
    bail, donnees.loyers, regularisation.debut, regularisation.fin, depensesDe(regularisation),
  );

  const colonnes = [
    { titre: 'Colocataire', valeur: (l) => nomDe(donnees.locataires.find((x) => x.id === l.locataireId)) },
    { titre: 'Provisions prévues', nombre: true, valeur: (l) => montant(l.prevu) },
    { titre: 'Provisions encaissées', nombre: true, valeur: (l) => montant(l.encaisse) },
    { titre: 'Quote-part réelle', nombre: true, valeur: (l) => montant(l.part) },
    { titre: 'Solde', nombre: true, valeur: (l) => h('span', {
      style: l.solde < -0.005 ? 'color:var(--alerte)' : undefined, texte: montant(l.solde),
    }) },
    { titre: 'État', valeur: (l) => badgeSolde(l.solde) },
    { titre: '', actions: true, valeur: (l) => bouton('Décompte', () =>
      decomptePdfEtEnvoi(donnees, regularisation, decompte, l), {
      petit: true, type: 'primaire',
      titre: 'Décompte PDF : téléchargement, dépôt sur son espace, e-mail de mise à disposition',
    }) },
  ];

  const detailDepenses = depensesDe(regularisation).map((d) => `${d.libelle} : ${montant(d.montant)}`).join(' · ');

  return carte({
    titre: `Du ${date(regularisation.debut)} au ${date(regularisation.fin)}`,
    aide: detailDepenses
      ? `Dépenses réelles : ${detailDepenses} — total ${montant(decompte.totalReel)}`
      : 'Aucune dépense réelle saisie pour l’instant : le décompte rembourserait toutes les provisions.',
    actions: [
      bouton('Modifier', () => saisirRegularisation(donnees, null, regularisation), { petit: true }),
      bouton('Supprimer', () => supprimerRegularisation(regularisation), { petit: true, type: 'danger' }),
    ],
    serre: true,
    corps: tableau({
      colonnes,
      lignes: decompte.lignes,
      cle: (l) => l.locataireId,
      pied: h('tr', {}, [
        h('td', {}, h('strong', { texte: 'Total' })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalPrevu) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalEncaisse) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalReel) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(centimes(decompte.totalEncaisse - decompte.totalReel)) })),
        h('td', {}), h('td', {}),
      ]),
      messageVide: 'Aucune provision sur cette période : vérifiez le bail et les dates.',
    }),
  });
}

async function supprimerRegularisation(regularisation) {
  const confirme = await confirmer({
    titre: 'Supprimer la régularisation',
    message: `Supprimer la régularisation du ${date(regularisation.debut)} au ${date(regularisation.fin)} ? `
      + 'Les décomptes déjà déposés sur les espaces colocataires ne seront pas retirés.',
    libelleValider: 'Supprimer', danger: true,
  });
  if (!confirme) return;
  await executer(etat.supprimer('regularisations', regularisation.id), 'Régularisation supprimée.');
}

export default {
  cle: 'regularisation',
  libelle: 'Charges',
  icone: '💧',
  titre: 'Régularisation des charges',
  sousTitre: 'Provisions prélevées sur les loyers, dépenses réelles (eau, ordures ménagères), solde de chacun.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');

    if (!donnees.baux.length) {
      return carte({
        titre: 'Aucun bail',
        corps: vide('Rien à régulariser pour l’instant',
          'Enregistrez d’abord un bail dans « Bien & baux » : les provisions sur charges en découlent.'),
      });
    }

    // Cumul de l'année affichée, tous baux confondus : ce qui était prévu au
    // titre des provisions et ce qui a réellement été encaissé.
    const debutAnnee = `${contexte.annee}-01-01`;
    const finAnnee = `${contexte.annee}-12-31`;
    let prevuAnnee = 0;
    let encaisseAnnee = 0;
    for (const bail of donnees.baux) {
      for (const ligne of provisionsPeriode(bail, donnees.loyers, debutAnnee, finAnnee)) {
        prevuAnnee += ligne.prevu;
        encaisseAnnee += ligne.encaisse;
      }
    }

    const regularisations = [...etat.liste('regularisations')]
      .sort((a, b) => String(b.debut).localeCompare(String(a.debut)));

    conteneur.append(h('div', { class: 'grille grille-3', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Provisions prévues ${contexte.annee}`, valeur: montant(centimes(prevuAnnee), { rond: true }),
        detail: 'd’après les baux' }),
      tuile({ libelle: `Provisions encaissées ${contexte.annee}`, valeur: montant(centimes(encaisseAnnee), { rond: true }),
        ton: 'positif', detail: 'part « charges » des virements reçus' }),
      tuile({ libelle: 'Régularisations', valeur: String(regularisations.length),
        detail: 'décomptes établis, toutes périodes' }),
    ]));

    conteneur.append(barreOutils([
      bouton('+ Régularisation', () => saisirRegularisation(donnees, contexte), { type: 'primaire' }),
    ]));

    if (!regularisations.length) {
      conteneur.append(carte({
        titre: 'Comment ça marche',
        corps: h('div', { class: 'aide-bloc' }, [
          h('p', { texte: 'Une fois par an (ou en fin de bail), créez une régularisation : '
            + 'saisissez la période et les dépenses réellement payées — la consommation d’eau d’après '
            + 'les factures du service des eaux, et la taxe d’enlèvement des ordures ménagères qui figure '
            + 'sur l’avis de taxe foncière.' }),
          h('p', { texte: 'L’application répartit ces dépenses entre colocataires au prorata de leurs '
            + 'provisions, les compare à ce que chacun a réellement versé avec ses loyers, et établit le '
            + 'solde : trop-perçu à rembourser, ou complément à réclamer. Le décompte PDF de chacun se '
            + 'dépose sur son espace, avec e-mail de mise à disposition.' }),
        ]),
      }));
    }

    for (const regularisation of regularisations) {
      conteneur.append(carteRegularisation(donnees, regularisation));
    }

    return conteneur;
  },
};
