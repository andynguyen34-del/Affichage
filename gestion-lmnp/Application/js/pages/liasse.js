// Récapitulatif pour la liasse fiscale : 2031-SD, annexes 2033 et report 2042-C-PRO.

import * as etat from '../etat.js';
import { h, carte, tableau, bouton, badge, barreOutils, notifier } from '../ui.js';
import { montant, date, centimes, aujourdhui } from '../format.js';
import * as fiscal from '../calculs/fiscal.js';
import * as amortissements from '../calculs/amortissements.js';
import * as calculEmprunt from '../calculs/emprunt.js';
import * as calculLoyers from '../calculs/loyers.js';

const aCompleter = () => h('span', { class: 'legende', texte: 'à compléter' });

function tableauLignes(lignes) {
  return h('table', {}, h('tbody', {}, lignes.map((l) => h('tr', { class: l.fort ? 'total-partiel' : null }, [
    h('td', {}, [
      h('span', { texte: l.libelle }),
      l.aide ? h('div', { class: 'legende', texte: l.aide }) : null,
    ]),
    h('td', { class: 'nombre' }, l.valeur === null ? aCompleter() : montant(l.valeur)),
  ]))));
}

function controles(donnees, exercice, annee) {
  const points = [];
  const ajouter = (ok, libelle, detail) => points.push({ ok, libelle, detail });

  ajouter(donnees.biens.length > 0, 'Logement déclaré', donnees.biens.map((b) => b.nom).join(', '));
  ajouter(donnees.immobilisations.length > 0, 'Composants amortissables saisis',
    `${donnees.immobilisations.length} composants, ${montant(exercice.amortissements.dotation)} de dotation`);
  ajouter(exercice.recettes.total > 0, 'Recettes de l’exercice', montant(exercice.recettes.total));

  const sansJustificatif = donnees.charges.filter((c) => !c.documentChemin
    && (c.deductible !== false)).length;
  ajouter(sansJustificatif === 0, 'Justificatifs rattachés',
    sansJustificatif ? `${sansJustificatif} dépenses sans justificatif` : 'toutes les dépenses ont une pièce');

  const impayes = calculLoyers.echeancesGlobales(donnees.baux, annee, donnees.loyers)
    .filter((e) => ['retard', 'partiel'].includes(calculLoyers.statut(e)));
  ajouter(impayes.length === 0, 'Loyers de l’exercice pointés',
    impayes.length ? `${impayes.length} échéance(s) non soldée(s)` : 'aucun impayé');

  ajouter(Boolean(donnees.parametres.siret), 'Numéro SIRET renseigné',
    donnees.parametres.siret || 'obligatoire pour la déclaration');
  ajouter((donnees.parametres.bailleurs || []).length > 0, 'Bailleurs renseignés',
    (donnees.parametres.bailleurs || []).map((b) => b.nom).join(', '));

  return h('div', {}, points.map((point) => h('div', {
    style: 'display:flex;gap:.6rem;align-items:flex-start;padding:.35rem 0;border-bottom:1px solid #eef1f4',
  }, [
    h('span', { texte: point.ok ? '✓' : '!', style: `font-weight:700;color:${point.ok ? 'var(--succes)' : 'var(--attention)'}` }),
    h('div', {}, [
      h('div', { texte: point.libelle }),
      h('div', { class: 'legende', texte: point.detail }),
    ]),
  ])));
}

export default {
  cle: 'liasse',
  libelle: 'Liasse fiscale',
  icone: '📄',
  titre: 'Liasse fiscale',
  sousTitre: (contexte) => `Éléments à reporter sur la déclaration de résultats ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const exercice = fiscal.exercice(donnees, annee);
    const conteneur = h('div');

    // Bilan : seuls les composants encore inscrits (cessions exclues).
    const brut = amortissements.baseInscrite(donnees.immobilisations, annee);
    const cumulAmortissements = amortissements.cumulInscrit(donnees.immobilisations, annee);
    const capitalRestant = centimes(donnees.emprunts.reduce((s, e) => s + calculEmprunt.capitalRestantDu(e, annee), 0));
    const depots = centimes(donnees.baux
      .filter((b) => !b.dateFin || b.dateFin >= `${annee}-12-31`)
      .reduce((s, b) => s + (Number(b.depotGarantie) || 0), 0));
    const impayes = calculLoyers.echeancesGlobales(donnees.baux, annee, donnees.loyers)
      .reduce((s, e) => s + Math.max(0, (e.total || 0) - calculLoyers.totalEncaisse(e)), 0);

    conteneur.append(h('div', { class: 'alerte alerte-info' }, h('div', {}, [
      h('strong', { texte: 'Comment utiliser cette page. ' }),
      'Les montants ci-dessous sont ceux calculés par l’application, présentés sous les intitulés des '
      + 'formulaires. Reportez-les sur la déclaration de l’année concernée : les numéros de case changent '
      + 'd’un millésime à l’autre, vérifiez-les toujours sur le formulaire officiel avant dépôt.',
    ])));

    conteneur.append(barreOutils([
      bouton('Imprimer cette page', () => window.print(), { type: 'primaire' }),
      bouton('Exporter en CSV', () => exporter(donnees, exercice, annee, { brut, cumulAmortissements, capitalRestant, depots, impayes })),
    ]));

    conteneur.append(carte({
      titre: 'Contrôles avant dépôt',
      corps: controles(donnees, exercice, annee),
    }));

    conteneur.append(carte({
      titre: '2031-SD — Déclaration de résultats',
      aide: 'Régime réel simplifié, bénéfices industriels et commerciaux non professionnels.',
      corps: h('div', {}, [
        tableauLignes([
          { libelle: 'Résultat fiscal avant imputation des déficits antérieurs', valeur: exercice.resultatApresAmortissement },
          { libelle: 'Déficits antérieurs imputés', valeur: exercice.deficits.imputes },
          { libelle: exercice.resultatImposable > 0 ? 'Bénéfice imposable' : 'Déficit de l’exercice',
            valeur: exercice.resultatImposable > 0 ? exercice.resultatImposable : exercice.deficits.nouveau,
            fort: true },
        ]),
        h('p', { class: 'legende', style: 'margin-top:.8rem', texte:
          `Identification : ${(donnees.parametres.bailleurs || []).map((b) => b.nom).join(' et ') || '—'}`
          + ` · SIRET ${donnees.parametres.siret || '—'}`
          + ` · exercice du 01/01/${annee} au 31/12/${annee}`
          + ` · adhérent d’un organisme de gestion agréé : ${donnees.parametres.adherentOga ? 'oui' : 'non'}` }),
      ]),
    }));

    conteneur.append(carte({
      titre: '2033-B — Compte de résultat simplifié',
      corps: tableauLignes([
        { libelle: 'Produits d’exploitation — loyers', valeur: exercice.recettes.loyers },
        { libelle: 'Produits d’exploitation — charges locatives récupérées', valeur: exercice.recettes.charges },
        { libelle: 'Autres produits', valeur: exercice.recettes.autres },
        { libelle: 'Total des produits', valeur: exercice.recettes.total, fort: true },
        { libelle: 'Autres charges externes', valeur: centimes(exercice.charges.horsEmprunt) },
        { libelle: 'Charges financières (intérêts et assurance d’emprunt)', valeur: exercice.charges.emprunt.deductible },
        { libelle: 'Dotations aux amortissements', valeur: exercice.amortissements.impute,
          aide: exercice.amortissements.differes
            ? `dotation comptable ${montant(exercice.amortissements.dotation)}, dont ${montant(exercice.amortissements.differes)} différés`
            : null },
        { libelle: 'Total des charges', valeur: centimes(exercice.charges.total + exercice.amortissements.impute), fort: true },
        { libelle: 'Résultat de l’exercice', valeur: exercice.resultatApresAmortissement, fort: true },
      ]),
    }));

    conteneur.append(carte({
      titre: '2033-A — Bilan simplifié',
      aide: 'Les postes de trésorerie ne sont pas suivis par l’application : complétez-les d’après vos relevés.',
      corps: h('div', { class: 'grille grille-2' }, [
        h('div', {}, [
          h('div', { class: 'section-titre', texte: 'Actif' }),
          tableauLignes([
            { libelle: 'Immobilisations corporelles — valeur brute', valeur: brut },
            { libelle: 'Amortissements cumulés', valeur: cumulAmortissements },
            { libelle: 'Immobilisations — valeur nette', valeur: centimes(brut - cumulAmortissements), fort: true },
            { libelle: 'Créances clients (loyers restant dus)', valeur: centimes(impayes) },
            { libelle: 'Disponibilités (compte bancaire au 31/12)', valeur: null },
          ]),
        ]),
        h('div', {}, [
          h('div', { class: 'section-titre', texte: 'Passif' }),
          tableauLignes([
            { libelle: 'Compte de l’exploitant', valeur: null, aide: 'apports diminués des prélèvements' },
            { libelle: 'Résultat de l’exercice', valeur: exercice.resultatApresAmortissement },
            { libelle: 'Emprunts — capital restant dû', valeur: capitalRestant },
            { libelle: 'Dépôts de garantie reçus', valeur: depots },
          ]),
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: '2033-C — Immobilisations et amortissements',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Composant', valeur: (i) => i.libelle },
          { titre: 'Mise en service', valeur: (i) => date(i.dateMiseEnService) },
          { titre: 'Valeur brute', nombre: true, valeur: (i) => montant(i.base) },
          { titre: 'Durée', nombre: true, valeur: (i) => `${i.dureeAnnees} ans` },
          { titre: `Dotation ${annee}`, nombre: true, valeur: (i) => montant(amortissements.dotation(i, annee)) },
          { titre: 'Cumul au 31/12', nombre: true, valeur: (i) => montant(amortissements.cumulFinAnnee(i, annee)) },
          { titre: 'Valeur nette', nombre: true, valeur: (i) => montant(amortissements.valeurNetteComptable(i, annee)) },
        ],
        lignes: donnees.immobilisations,
        cle: (i) => i.id,
        messageVide: 'Aucune immobilisation.',
        pied: h('tr', {}, [
          h('td', { texte: 'Total' }), h('td', {}),
          h('td', { class: 'nombre', texte: montant(centimes(donnees.immobilisations.reduce((s, i) => s + (Number(i.base) || 0), 0))) }), h('td', {}),
          h('td', { class: 'nombre', texte: montant(exercice.amortissements.dotation) }),
          h('td', { class: 'nombre', texte: montant(amortissements.cumulGlobal(donnees.immobilisations, annee)) }),
          h('td', { class: 'nombre', texte: montant(centimes(donnees.immobilisations.reduce((s, i) => s + amortissements.valeurNetteComptable(i, annee), 0))) }),
        ]),
      }),
    }));

    conteneur.append(carte({
      titre: '2033-D — Déficits et amortissements différés',
      corps: h('div', {}, [
        tableauLignes([
          { libelle: 'Amortissements réputés différés au 31/12', valeur: exercice.amortissements.differes,
            aide: 'reportables sans limite de durée (article 39 C II 2° du CGI)', fort: true },
        ]),
        tableau({
          colonnes: [
            { titre: 'Déficit d’origine', valeur: (d) => String(d.annee) },
            { titre: 'Montant restant à imputer', nombre: true, valeur: (d) => montant(d.montant) },
            { titre: 'Dernier exercice d’imputation', valeur: (d) => String(d.annee + fiscal.DUREE_REPORT_DEFICIT) },
          ],
          lignes: exercice.reportSortant.deficits || [],
          messageVide: 'Aucun déficit reportable.',
        }),
      ]),
    }));

    const caseDeclaration = exercice.resultatImposable > 0
      ? (donnees.parametres.adherentOga
        ? donnees.parametres.casesDeclaration?.beneficeAvecOga
        : donnees.parametres.casesDeclaration?.beneficeSansOga)
      : donnees.parametres.casesDeclaration?.deficit;
    const montantDeclare = exercice.resultatImposable > 0 ? exercice.resultatImposable : exercice.deficits.nouveau;

    conteneur.append(carte({
      titre: '2042-C-PRO — Report sur la déclaration de revenus',
      aide: 'Locations meublées non professionnelles, régime du bénéfice réel.',
      corps: h('div', {}, [
        h('div', { style: 'display:flex;gap:1rem;align-items:center;flex-wrap:wrap' }, [
          badge(caseDeclaration || '—', 'info'),
          h('div', { style: 'font-size:1.4rem;font-weight:600', texte: montant(montantDeclare) }),
          h('div', { class: 'legende', texte: exercice.resultatImposable > 0 ? 'bénéfice' : 'déficit' }),
        ]),
        h('p', { class: 'legende', style: 'margin-top:.8rem', texte:
          'Les repères de case sont modifiables dans les Paramètres. Vérifiez-les sur la notice de la '
          + '2042-C-PRO du millésime concerné : ils dépendent du rang du déclarant et de l’adhésion '
          + 'à un organisme de gestion agréé.' }),
      ]),
    }));

    conteneur.append(h('p', { class: 'legende', texte:
      'Cette page est une aide à la préparation, pas une télédéclaration. Le dépôt de la 2031-SD et de ses '
      + 'annexes se fait par voie dématérialisée (EDI-TDFC), généralement via un expert-comptable ou un '
      + 'prestataire agréé.' }));

    return conteneur;
  },
};

function exporter(donnees, exercice, annee, extra) {
  const lignes = [
    ['Rubrique', 'Libellé', 'Montant'],
    ['2031-SD', 'Résultat avant imputation des déficits antérieurs', exercice.resultatApresAmortissement],
    ['2031-SD', 'Déficits antérieurs imputés', exercice.deficits.imputes],
    ['2031-SD', 'Résultat imposable', exercice.resultatImposable],
    ['2033-B', 'Loyers', exercice.recettes.loyers],
    ['2033-B', 'Charges locatives récupérées', exercice.recettes.charges],
    ['2033-B', 'Autres produits', exercice.recettes.autres],
    ['2033-B', 'Total des produits', exercice.recettes.total],
    ['2033-B', 'Autres charges externes', exercice.charges.horsEmprunt],
    ['2033-B', 'Charges financières', exercice.charges.emprunt.deductible],
    ['2033-B', 'Dotations aux amortissements', exercice.amortissements.impute],
    ['2033-A', 'Immobilisations brutes', extra.brut],
    ['2033-A', 'Amortissements cumulés', extra.cumulAmortissements],
    ['2033-A', 'Créances (loyers restant dus)', centimes(extra.impayes)],
    ['2033-A', 'Emprunts — capital restant dû', extra.capitalRestant],
    ['2033-A', 'Dépôts de garantie reçus', extra.depots],
    ['2033-D', 'Amortissements réputés différés', exercice.amortissements.differes],
    ...(exercice.reportSortant.deficits || []).map((d) => ['2033-D', `Déficit ${d.annee} restant`, d.montant]),
  ];
  const contenu = lignes
    .map((ligne) => ligne.map((cellule) => `"${String(cellule).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([`﻿${contenu}`], { type: 'text/csv;charset=utf-8' }));
  lien.download = `liasse-lmnp-${annee}.csv`;
  lien.click();
  URL.revokeObjectURL(lien.href);
  notifier('Export CSV téléchargé.', 'succes');
}
