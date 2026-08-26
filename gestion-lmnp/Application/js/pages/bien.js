// Logement, locataires et baux.

import * as etat from '../etat.js';
import { h, carte, tableau, bouton, badge, vide, formulaire, confirmer, executer, barreOutils } from '../ui.js';
import { montant, date, nombre, isoDepuis, aujourdhui, anneeDe } from '../format.js';
import { loyerIndexe } from '../calculs/loyers.js';

const TYPES_BIEN = ['Appartement', 'Maison', 'Studio', 'Chambre', 'Local'].map((v) => ({ valeur: v, libelle: v }));
const TYPES_BAIL = [
  { valeur: 'meuble', libelle: 'Meublé — 1 an renouvelable' },
  { valeur: 'etudiant', libelle: 'Meublé étudiant — 9 mois' },
  { valeur: 'mobilite', libelle: 'Bail mobilité — 1 à 10 mois' },
  { valeur: 'saisonnier', libelle: 'Location saisonnière' },
  { valeur: 'autre', libelle: 'Autre' },
];

const champsBien = () => [
  { cle: 'nom', libelle: 'Nom du logement', type: 'texte', requis: true, exemple: 'Maison SML — Anika', largeur: 'pleine' },
  { cle: 'type', libelle: 'Type', type: 'liste', options: TYPES_BIEN },
  { cle: 'surface', libelle: 'Surface (m²)', type: 'nombre' },
  { cle: 'adresse', libelle: 'Adresse', type: 'texte', requis: true, largeur: 'pleine' },
  { cle: 'codePostal', libelle: 'Code postal', type: 'texte' },
  { cle: 'ville', libelle: 'Ville', type: 'texte' },
  { cle: 'dateAcquisition', libelle: 'Date d’acquisition', type: 'date', requis: true },
  { cle: 'dateMiseEnLocation', libelle: 'Date de mise en location', type: 'date', aide: 'Point de départ des amortissements.' },
  { cle: 'prixAcquisition', libelle: 'Prix d’acquisition (€)', type: 'montant' },
  { cle: 'partTerrain', libelle: 'Part du terrain (%)', type: 'nombre', aide: 'Non amortissable. Souvent 10 à 20 %.' },
  { cle: 'fraisNotaire', libelle: 'Frais de notaire (€)', type: 'montant' },
  { cle: 'fraisAgence', libelle: 'Frais d’agence (€)', type: 'montant' },
  { cle: 'notes', libelle: 'Notes', type: 'zone' },
];

const champsLocataire = () => [
  { cle: 'nom', libelle: 'Nom', type: 'texte', requis: true },
  { cle: 'prenom', libelle: 'Prénom', type: 'texte' },
  { cle: 'email', libelle: 'Courriel', type: 'texte' },
  { cle: 'telephone', libelle: 'Téléphone', type: 'texte' },
  { cle: 'adresse', libelle: 'Adresse de correspondance', type: 'texte', largeur: 'pleine' },
  { cle: 'notes', libelle: 'Notes', type: 'zone' },
];

function champsBail(donnees) {
  const biens = donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }));
  const locataires = donnees.locataires.map((l) => ({ valeur: l.id, libelle: `${l.nom} ${l.prenom || ''}`.trim() }));
  return [
    { cle: 'bienId', libelle: 'Logement', type: 'liste', options: biens, requis: true },
    { cle: 'type', libelle: 'Type de bail', type: 'liste', options: TYPES_BAIL, requis: true },
    { cle: 'locataireId', libelle: 'Locataire', type: 'liste', options: locataires, requis: true },
    { cle: 'coTitulaireId', libelle: 'Co-titulaire (facultatif)', type: 'liste', options: [{ valeur: '', libelle: '—' }, ...locataires] },
    { cle: 'dateDebut', libelle: 'Début du bail', type: 'date', requis: true },
    { cle: 'dateFin', libelle: 'Fin du bail (si connue)', type: 'date' },
    { cle: 'loyerHc', libelle: 'Loyer hors charges (€/mois)', type: 'montant', requis: true },
    { cle: 'provisionCharges', libelle: 'Provision pour charges (€/mois)', type: 'montant' },
    { cle: 'depotGarantie', libelle: 'Dépôt de garantie (€)', type: 'montant', aide: 'N’est pas une recette imposable.' },
    { cle: 'jourEcheance', libelle: 'Jour d’échéance', type: 'entier', min: 1, max: 28 },
    { cle: 'moisRevision', libelle: 'Mois de révision du loyer', type: 'entier', min: 1, max: 12 },
    { cle: 'irlReference', libelle: 'Indice IRL de référence', type: 'nombre', aide: 'Valeur de l’IRL inscrite au bail.' },
    { cle: 'notes', libelle: 'Notes', type: 'zone' },
  ];
}

const nomLocataire = (donnees, id) => {
  const locataire = donnees.locataires.find((l) => l.id === id);
  return locataire ? `${locataire.nom} ${locataire.prenom || ''}`.trim() : '—';
};

export function bailEstActif(bail, dateReference = aujourdhui()) {
  if (!bail.dateDebut || bail.dateDebut > dateReference) return false;
  return !bail.dateFin || bail.dateFin >= dateReference;
}

async function ouvrirBien(donnees, bienExistant) {
  const valeurs = bienExistant || { type: 'Maison', partTerrain: 15, dateAcquisition: '' };
  const saisie = await formulaire({
    titre: bienExistant ? 'Modifier le logement' : 'Déclarer un logement',
    champs: champsBien(),
    valeurs,
    large: true,
  });
  if (saisie) await executer(etat.enregistrer('biens', saisie), 'Logement enregistré.');
}

async function ouvrirLocataire(locataireExistant) {
  const saisie = await formulaire({
    titre: locataireExistant ? 'Modifier le locataire' : 'Nouveau locataire',
    champs: champsLocataire(),
    valeurs: locataireExistant || {},
  });
  if (saisie) await executer(etat.enregistrer('locataires', saisie), 'Locataire enregistré.');
}

async function ouvrirBail(donnees, bailExistant) {
  if (!donnees.biens.length) { await ouvrirBien(donnees, null); return; }
  if (!donnees.locataires.length) { await ouvrirLocataire(null); return; }
  const valeurs = bailExistant || {
    bienId: donnees.biens[0].id,
    type: 'meuble',
    jourEcheance: 1,
    moisRevision: 1,
    provisionCharges: 0,
  };
  const saisie = await formulaire({
    titre: bailExistant ? 'Modifier le bail' : 'Nouveau bail',
    champs: champsBail(donnees),
    valeurs,
    large: true,
  });
  if (saisie) await executer(etat.enregistrer('baux', saisie), 'Bail enregistré.');
}

async function reviserLoyer(bail) {
  const saisie = await formulaire({
    titre: 'Réviser le loyer selon l’IRL',
    aide: 'Le nouveau loyer est calculé ainsi : loyer actuel × (nouvel indice ÷ indice de référence).',
    champs: [
      { cle: 'irlReference', libelle: 'Indice de référence du bail', type: 'nombre', requis: true },
      { cle: 'irlNouveau', libelle: 'Nouvel indice IRL', type: 'nombre', requis: true },
      { cle: 'dateEffet', libelle: 'Date d’effet', type: 'date', requis: true },
    ],
    valeurs: { irlReference: bail.irlReference, dateEffet: isoDepuis(new Date().getFullYear(), bail.moisRevision || 1, 1) },
  });
  if (!saisie) return;
  const nouveau = loyerIndexe(bail.loyerHc, saisie.irlReference, saisie.irlNouveau);
  if (nouveau === null) return;
  const confirme = await confirmer({
    titre: 'Confirmer la révision',
    message: `Le loyer passe de ${montant(bail.loyerHc)} à ${montant(nouveau)} par mois à compter du ${date(saisie.dateEffet)}.`,
    libelleValider: 'Appliquer',
  });
  if (!confirme) return;
  const revisions = [...(bail.revisions || []), {
    dateEffet: saisie.dateEffet,
    ancienLoyer: bail.loyerHc,
    nouveauLoyer: nouveau,
    irlReference: saisie.irlReference,
    irlNouveau: saisie.irlNouveau,
  }];
  await executer(
    etat.enregistrer('baux', { ...bail, loyerHc: nouveau, irlReference: saisie.irlNouveau, revisions }),
    'Loyer révisé.',
  );
}

function carteBien(donnees, bien) {
  const bauxDuBien = donnees.baux.filter((b) => b.bienId === bien.id);
  const actif = bauxDuBien.find((b) => bailEstActif(b));
  const prixTotal = (Number(bien.prixAcquisition) || 0) + (Number(bien.fraisNotaire) || 0) + (Number(bien.fraisAgence) || 0);
  const rendement = (actif && prixTotal)
    ? ((Number(actif.loyerHc) || 0) * 12 * 100) / prixTotal
    : null;

  return carte({
    titre: bien.nom,
    aide: [bien.adresse, [bien.codePostal, bien.ville].filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    actions: [
      bouton('Modifier', () => ouvrirBien(donnees, bien), { petit: true }),
      bouton('Supprimer', async () => {
        const confirme = await confirmer({
          titre: 'Supprimer le logement',
          message: `« ${bien.nom} » sera retiré. Les baux, charges et amortissements rattachés resteront enregistrés mais ne seront plus reliés à un logement.`,
          libelleValider: 'Supprimer', danger: true,
        });
        if (confirme) await executer(etat.supprimer('biens', bien.id), 'Logement supprimé.');
      }, { petit: true, type: 'danger' }),
    ],
    corps: h('div', { class: 'grille grille-4' }, [
      infoBloc('Acquis le', date(bien.dateAcquisition)),
      infoBloc('Prix de revient', montant(prixTotal, { rond: true })),
      infoBloc('Surface', bien.surface ? `${nombre(bien.surface, 0)} m²` : '—'),
      infoBloc('Loyer en cours', actif ? `${montant(actif.loyerHc)} + ${montant(actif.provisionCharges || 0)}` : '—'),
      infoBloc('Rendement brut', rendement ? `${nombre(rendement, 2)} %` : '—'),
      infoBloc('Part du terrain', bien.partTerrain ? `${nombre(bien.partTerrain, 0)} %` : '—'),
      infoBloc('Mise en location', date(bien.dateMiseEnLocation)),
      infoBloc('Baux enregistrés', String(bauxDuBien.length)),
    ]),
  });
}

const infoBloc = (libelle, valeur) => h('div', {}, [
  h('div', { class: 'tuile-libelle', texte: libelle }),
  h('div', { style: 'font-weight:600', texte: valeur }),
]);

export default {
  cle: 'bien',
  libelle: 'Bien & baux',
  icone: '🏠',
  titre: 'Bien, locataires et baux',
  sousTitre: 'Le logement, les personnes qui l’occupent et les conditions de location.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');

    conteneur.append(barreOutils([
      bouton('+ Logement', () => ouvrirBien(donnees, null), { type: 'primaire' }),
      bouton('+ Locataire', () => ouvrirLocataire(null)),
      bouton('+ Bail', () => ouvrirBail(donnees, null)),
    ]));

    if (!donnees.biens.length) {
      conteneur.append(carte({
        titre: 'Aucun logement déclaré',
        corps: vide('Commencez ici', 'Déclarez le logement loué : son adresse, sa date d’acquisition et son prix de revient. '
          + 'Ces informations servent ensuite au calcul des amortissements et du rendement.'),
      }));
      return conteneur;
    }

    donnees.biens.forEach((bien) => conteneur.append(carteBien(donnees, bien)));

    // ------------------------------------------------------------- baux
    const colonnesBaux = [
      { titre: 'Locataire', valeur: (b) => h('div', {}, [
        h('div', { texte: nomLocataire(donnees, b.locataireId) }),
        b.coTitulaireId ? h('div', { class: 'legende', texte: `et ${nomLocataire(donnees, b.coTitulaireId)}` }) : null,
      ]) },
      { titre: 'Logement', valeur: (b) => donnees.biens.find((x) => x.id === b.bienId)?.nom || '—' },
      { titre: 'Période', valeur: (b) => `${date(b.dateDebut)} → ${b.dateFin ? date(b.dateFin) : 'en cours'}` },
      { titre: 'Loyer HC', nombre: true, valeur: (b) => montant(b.loyerHc) },
      { titre: 'Charges', nombre: true, valeur: (b) => montant(b.provisionCharges || 0) },
      { titre: 'Dépôt', nombre: true, valeur: (b) => montant(b.depotGarantie || 0) },
      { titre: 'État', valeur: (b) => (bailEstActif(b) ? badge('En cours', 'succes') : badge('Terminé', 'attente')) },
      { titre: '', actions: true, valeur: (b) => h('div', { class: 'groupe-boutons' }, [
        bouton('Réviser', () => reviserLoyer(b), { petit: true, titre: 'Réviser le loyer selon l’indice IRL' }),
        bouton('Modifier', () => ouvrirBail(donnees, b), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer le bail',
            message: 'Les loyers déjà enregistrés pour ce bail resteront dans le dossier mais ne seront plus rattachés.',
            libelleValider: 'Supprimer', danger: true,
          });
          if (confirme) await executer(etat.supprimer('baux', b.id), 'Bail supprimé.');
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    conteneur.append(carte({
      titre: 'Baux',
      aide: 'Le bail détermine les échéances de loyer attendues chaque mois.',
      serre: true,
      corps: tableau({
        colonnes: colonnesBaux,
        lignes: [...donnees.baux].sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut))),
        messageVide: 'Aucun bail enregistré.',
        cle: (b) => b.id,
      }),
    }));

    // -------------------------------------------------------- locataires
    conteneur.append(carte({
      titre: 'Locataires',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Nom', valeur: (l) => `${l.nom} ${l.prenom || ''}`.trim() },
          { titre: 'Courriel', valeur: (l) => l.email || '—' },
          { titre: 'Téléphone', valeur: (l) => l.telephone || '—' },
          { titre: 'Baux', nombre: true, valeur: (l) => String(donnees.baux.filter((b) => b.locataireId === l.id || b.coTitulaireId === l.id).length) },
          { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
            bouton('Modifier', () => ouvrirLocataire(l), { petit: true }),
            bouton('✕', async () => {
              const confirme = await confirmer({
                titre: 'Supprimer le locataire', message: `Supprimer ${l.nom} ${l.prenom || ''} ?`,
                libelleValider: 'Supprimer', danger: true,
              });
              if (confirme) await executer(etat.supprimer('locataires', l.id), 'Locataire supprimé.');
            }, { petit: true, type: 'danger' }),
          ]) },
        ],
        lignes: donnees.locataires,
        messageVide: 'Aucun locataire enregistré.',
        cle: (l) => l.id,
      }),
    }));

    const revisions = donnees.baux.flatMap((b) => (b.revisions || []).map((r) => ({ ...r, bail: b })));
    if (revisions.length) {
      conteneur.append(carte({
        titre: 'Historique des révisions de loyer',
        serre: true,
        corps: tableau({
          colonnes: [
            { titre: 'Date d’effet', valeur: (r) => date(r.dateEffet) },
            { titre: 'Locataire', valeur: (r) => nomLocataire(donnees, r.bail.locataireId) },
            { titre: 'Ancien loyer', nombre: true, valeur: (r) => montant(r.ancienLoyer) },
            { titre: 'Nouveau loyer', nombre: true, valeur: (r) => montant(r.nouveauLoyer) },
            { titre: 'IRL', valeur: (r) => `${nombre(r.irlReference, 2)} → ${nombre(r.irlNouveau, 2)}` },
          ],
          lignes: revisions.sort((a, b) => String(b.dateEffet).localeCompare(String(a.dateEffet))),
          messageVide: '',
        }),
      }));
    }

    return conteneur;
  },
};
