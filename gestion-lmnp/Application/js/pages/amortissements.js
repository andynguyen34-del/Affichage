// Composants amortissables et plans d'amortissement.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, vide, formulaire, confirmer, executer,
  barreOutils, ouvrirModale, notifier } from '../ui.js';
import { montant, date, nombre, anneeDe, centimes } from '../format.js';
import * as amortissements from '../calculs/amortissements.js';

function champsImmobilisation(donnees) {
  return [
    { cle: 'libelle', libelle: 'Libellé', type: 'texte', requis: true, largeur: 'pleine', exemple: 'Gros œuvre — maison SML' },
    { cle: 'categorie',
      libelle: 'Catégorie',
      type: 'liste',
      requis: true,
      rafraichit: true,
      apres: (valeurs) => {
        const reference = etat.CATEGORIES_IMMOBILISATIONS.find((c) => c.code === valeurs.categorie);
        if (reference) valeurs.dureeAnnees = reference.duree;
      },
      options: etat.CATEGORIES_IMMOBILISATIONS.map((c) => ({ valeur: c.code, libelle: `${c.libelle} (${c.duree} ans)` })) },
    { cle: 'bienId', libelle: 'Logement', type: 'liste',
      options: [{ valeur: '', libelle: '—' }, ...donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }))] },
    { cle: 'base', libelle: 'Base amortissable (€)', type: 'montant', requis: true },
    { cle: 'dureeAnnees', libelle: 'Durée (années)', type: 'entier', requis: true, min: 1, max: 100 },
    { cle: 'dateMiseEnService', libelle: 'Date de mise en service', type: 'date', requis: true,
      aide: 'Date de mise en location, ou date d’achat du meuble.' },
    { cle: 'sortieLe', libelle: 'Sortie de l’actif (facultatif)', type: 'date', aide: 'Vente ou mise au rebut.' },
    { cle: 'notes', libelle: 'Notes', type: 'zone' },
  ];
}

async function ouvrirImmobilisation(donnees, existante) {
  const valeurs = existante || {
    categorie: 'gros-oeuvre',
    dureeAnnees: 50,
    bienId: donnees.biens[0]?.id || '',
    dateMiseEnService: donnees.biens[0]?.dateMiseEnLocation || donnees.biens[0]?.dateAcquisition || '',
  };
  const saisie = await formulaire({
    titre: existante ? 'Modifier le composant' : 'Nouveau composant amortissable',
    champs: champsImmobilisation(donnees),
    valeurs,
    large: true,
  });
  if (!saisie) return;
  await executer(etat.enregistrer('immobilisations', saisie), 'Composant enregistré.');
}

/** Décomposition automatique du prix de revient en composants. */
async function decomposer(donnees) {
  const bien = donnees.biens[0];
  if (!bien) { notifier('Déclarez d’abord le logement.', 'erreur'); return; }
  const prixTotal = (Number(bien.prixAcquisition) || 0) + (Number(bien.fraisNotaire) || 0) + (Number(bien.fraisAgence) || 0);

  const saisie = await formulaire({
    titre: 'Décomposer le prix de revient',
    aide: 'Le terrain n’est pas amortissable : il est retiré avant la répartition. '
      + 'Les pourcentages proposés sont des usages courants ; ajustez-les selon votre situation.',
    champs: [
      { cle: 'bienId', libelle: 'Logement', type: 'liste', requis: true,
        options: donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom })) },
      { cle: 'prixRevient', libelle: 'Prix de revient total (€)', type: 'montant', requis: true,
        aide: 'Prix d’acquisition, frais de notaire et d’agence compris.' },
      { cle: 'partTerrain', libelle: 'Part du terrain (%)', type: 'nombre', requis: true },
      { cle: 'dateMiseEnService', libelle: 'Date de mise en service', type: 'date', requis: true },
      ...etat.CATEGORIES_IMMOBILISATIONS.filter((c) => c.partIndicative > 0).map((c) => ({
        cle: `part-${c.code}`,
        libelle: `${c.libelle} — part (%)`,
        type: 'nombre',
      })),
    ],
    valeurs: {
      bienId: bien.id,
      prixRevient: prixTotal,
      partTerrain: bien.partTerrain ?? 15,
      dateMiseEnService: bien.dateMiseEnLocation || bien.dateAcquisition || '',
      ...Object.fromEntries(etat.CATEGORIES_IMMOBILISATIONS
        .filter((c) => c.partIndicative > 0)
        .map((c) => [`part-${c.code}`, c.partIndicative])),
    },
    large: true,
  });
  if (!saisie) return;

  const baseAmortissable = centimes((Number(saisie.prixRevient) || 0) * (1 - (Number(saisie.partTerrain) || 0) / 100));
  const composants = etat.CATEGORIES_IMMOBILISATIONS
    .filter((c) => c.partIndicative > 0)
    .map((c) => ({ categorie: c, part: Number(saisie[`part-${c.code}`]) || 0 }))
    .filter((c) => c.part > 0);
  const sommeParts = composants.reduce((s, c) => s + c.part, 0);

  if (Math.abs(sommeParts - 100) > 0.5) {
    const continuer = await confirmer({
      titre: 'Répartition incomplète',
      message: `Le total des parts vaut ${nombre(sommeParts, 1)} % au lieu de 100 %. Continuer quand même ?`,
      libelleValider: 'Continuer',
    });
    if (!continuer) return;
  }

  const resume = composants.map((c) => ({
    libelle: `${c.categorie.libelle} — ${donnees.biens.find((b) => b.id === saisie.bienId)?.nom || ''}`.trim(),
    categorie: c.categorie.code,
    bienId: saisie.bienId,
    base: centimes(baseAmortissable * (c.part / 100)),
    dureeAnnees: c.categorie.duree,
    dateMiseEnService: saisie.dateMiseEnService,
  }));

  const apercu = tableau({
    colonnes: [
      { titre: 'Composant', valeur: (l) => l.libelle },
      { titre: 'Base', nombre: true, valeur: (l) => montant(l.base) },
      { titre: 'Durée', nombre: true, valeur: (l) => `${l.dureeAnnees} ans` },
      { titre: 'Dotation annuelle', nombre: true, valeur: (l) => montant(l.base / l.dureeAnnees) },
    ],
    lignes: resume,
    messageVide: '',
  });

  const fermer = ouvrirModale({
    titre: 'Composants à créer',
    large: true,
    corps: [
      h('p', { class: 'legende', texte: `Base amortissable : ${montant(baseAmortissable)} `
        + `(prix de revient ${montant(saisie.prixRevient)} moins ${nombre(saisie.partTerrain, 0)} % de terrain).` }),
      apercu,
    ],
    pied: [
      bouton('Annuler', () => fermer()),
      bouton('Créer les composants', async () => {
        fermer();
        for (const composant of resume) {
          /* eslint-disable no-await-in-loop */
          await etat.enregistrer('immobilisations', composant);
        }
        notifier(`${resume.length} composants créés.`, 'succes');
      }, { type: 'primaire' }),
    ],
  });
}

function planDetaille(immobilisation) {
  const lignes = amortissements.plan(immobilisation);
  ouvrirModale({
    titre: `Plan d’amortissement — ${immobilisation.libelle}`,
    large: true,
    corps: tableau({
      colonnes: [
        { titre: 'Exercice', valeur: (l) => String(l.annee) },
        { titre: 'Dotation', nombre: true, valeur: (l) => montant(l.dotation) },
        { titre: 'Cumul', nombre: true, valeur: (l) => montant(l.cumul) },
        { titre: 'Valeur nette', nombre: true, valeur: (l) => montant(l.valeurNette) },
      ],
      lignes,
      messageVide: 'Renseignez une base, une durée et une date de mise en service.',
    }),
  });
}

export default {
  cle: 'amortissements',
  libelle: 'Amortissements',
  icone: '📉',
  titre: 'Composants et amortissements',
  sousTitre: (contexte) => `Plan d’amortissement et dotation de l’exercice ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const conteneur = h('div');

    const dotations = amortissements.dotationsAnnee(donnees.immobilisations, annee);
    const baseTotale = centimes(donnees.immobilisations.reduce((s, i) => s + (Number(i.base) || 0), 0));
    const cumul = amortissements.cumulGlobal(donnees.immobilisations, annee);

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Base amortissable', valeur: montant(baseTotale, { rond: true }), detail: `${donnees.immobilisations.length} composants` }),
      tuile({ libelle: `Dotation ${annee}`, valeur: montant(dotations.total, { rond: true }) }),
      tuile({ libelle: 'Cumul amorti', valeur: montant(cumul, { rond: true }),
        detail: baseTotale ? `${Math.round((cumul / baseTotale) * 100)} % de la base` : '' }),
      tuile({ libelle: 'Valeur nette', valeur: montant(centimes(baseTotale - cumul), { rond: true }) }),
    ]));

    conteneur.append(barreOutils([
      bouton('+ Composant', () => ouvrirImmobilisation(donnees, null), { type: 'primaire' }),
      bouton('Décomposer le prix de revient', () => decomposer(donnees),
        { titre: 'Créer d’un coup les composants du bâti à partir du prix d’acquisition' }),
    ]));

    if (!donnees.immobilisations.length) {
      conteneur.append(carte({
        titre: 'Aucun composant',
        corps: vide('L’amortissement, c’est le cœur du LMNP au réel',
          'Utilisez « Décomposer le prix de revient » : le prix du logement est réparti entre gros œuvre, façade, '
          + 'installations et agencements, chacun avec sa durée. Ajoutez ensuite le mobilier.'),
      }));
      return conteneur;
    }

    const colonnes = [
      { titre: 'Composant', valeur: (i) => h('div', {}, [
        h('div', { texte: i.libelle }),
        h('div', { class: 'legende', texte: etat.libelleCategorieImmobilisation(i.categorie) }),
      ]) },
      { titre: 'Mise en service', valeur: (i) => date(i.dateMiseEnService) },
      { titre: 'Base', nombre: true, valeur: (i) => montant(i.base) },
      { titre: 'Durée', nombre: true, valeur: (i) => `${i.dureeAnnees} ans` },
      { titre: `Dotation ${annee}`, nombre: true, valeur: (i) => montant(amortissements.dotation(i, annee)) },
      { titre: 'Cumul', nombre: true, valeur: (i) => montant(amortissements.cumulFinAnnee(i, annee)) },
      { titre: 'Valeur nette', nombre: true, valeur: (i) => montant(amortissements.valeurNetteComptable(i, annee)) },
      { titre: '', actions: true, valeur: (i) => h('div', { class: 'groupe-boutons' }, [
        bouton('Plan', () => planDetaille(i), { petit: true }),
        bouton('Modifier', () => ouvrirImmobilisation(donnees, i), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer le composant',
            message: `Supprimer « ${i.libelle} » ? Les dotations passées seront recalculées sans lui.`,
            libelleValider: 'Supprimer', danger: true,
          });
          if (confirme) await executer(etat.supprimer('immobilisations', i.id), 'Composant supprimé.');
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    conteneur.append(carte({
      titre: 'Composants amortissables',
      aide: 'Amortissement linéaire, prorata temporis la première et la dernière année.',
      serre: true,
      corps: tableau({
        colonnes,
        lignes: [...donnees.immobilisations].sort((a, b) => (b.base || 0) - (a.base || 0)),
        cle: (i) => i.id,
        messageVide: '',
        pied: h('tr', {}, [
          h('td', { texte: 'Total' }),
          h('td', {}),
          h('td', { class: 'nombre', texte: montant(baseTotale) }),
          h('td', {}),
          h('td', { class: 'nombre', texte: montant(dotations.total) }),
          h('td', { class: 'nombre', texte: montant(cumul) }),
          h('td', { class: 'nombre', texte: montant(centimes(baseTotale - cumul)) }),
          h('td', {}),
        ]),
      }),
    }));

    // Vue pluriannuelle
    const anneeDebut = Math.min(...donnees.immobilisations
      .map((i) => anneeDe(i.dateMiseEnService))
      .filter(Boolean).concat(annee));
    const anneesAffichees = [];
    for (let a = Math.min(anneeDebut, annee - 2); a <= annee + 5; a += 1) anneesAffichees.push(a);

    conteneur.append(carte({
      titre: 'Dotations à venir',
      aide: 'Ce que vous pourrez déduire chaque année, à composants constants.',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Exercice', valeur: (a) => String(a), classe: (a) => (a === annee ? 'total-partiel' : '') },
          { titre: 'Dotation', nombre: true, valeur: (a) => montant(amortissements.dotationsAnnee(donnees.immobilisations, a).total) },
          { titre: 'Cumul fin d’exercice', nombre: true, valeur: (a) => montant(amortissements.cumulGlobal(donnees.immobilisations, a)) },
          { titre: 'Valeur nette', nombre: true, valeur: (a) => montant(centimes(baseTotale - amortissements.cumulGlobal(donnees.immobilisations, a))) },
        ],
        lignes: anneesAffichees,
        messageVide: '',
      }),
    }));

    conteneur.append(h('p', { class: 'legende', texte:
      'Rappel : depuis la loi de finances pour 2025, les amortissements déduits sont réintégrés dans le calcul '
      + 'de la plus-value lors de la revente du logement (sauf exceptions). Le cumul amorti ci-dessus donne l’ordre de grandeur concerné.' }));

    return conteneur;
  },
};
