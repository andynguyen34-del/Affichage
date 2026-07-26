/**
 * Jeu de demonstration : fabrique un classeur Excel d'exemple dans le dossier
 * surveille, puis configure une source, deux jeux de donnees, des indicateurs,
 * deux vues et un ecran. Sert a valider l'installation avant de brancher les
 * vrais fichiers de l'usine.
 *
 *   npm run seed
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { config } from '../src/config.js';
import { db, ensureAdminPassword } from '../src/db.js';
import { importSource } from '../src/lib/importer.js';

const DOSSIER = 'Demonstration';
const dossierAbsolu = path.join(config.sourceRoot, DOSSIER);

const LIGNES = ['Ligne 1', 'Ligne 2', 'Ligne 3'];
const EQUIPES = ['Matin', 'Apres-midi', 'Nuit'];
const DEFAUTS = ['Rayure', 'Cote hors tolerance', 'Manque matiere', 'Bavure', 'Assemblage', 'Peinture'];

function alea(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

async function ecrireClasseur() {
  fs.mkdirSync(dossierAbsolu, { recursive: true });

  const classeur = new ExcelJS.Workbook();

  const production = classeur.addWorksheet('Production');
  production.addRow(['Date', 'Ligne', 'Equipe', 'Quantite produite', 'Quantite rebutee', 'Temps arret (min)']);
  const aujourdhui = new Date();
  for (let j = 29; j >= 0; j -= 1) {
    const jour = new Date(aujourdhui.getTime() - j * 86400000);
    if (jour.getDay() === 0 || jour.getDay() === 6) continue;
    for (const ligne of LIGNES) {
      for (const equipe of EQUIPES) {
        const produit = alea(380, 620);
        production.addRow([jour, ligne, equipe, produit, alea(2, 28), alea(0, 75)]);
      }
    }
  }
  production.getColumn(1).numFmt = 'dd/mm/yyyy';

  const qualite = classeur.addWorksheet('Defauts');
  qualite.addRow(['Semaine', 'Type de defaut', 'Ligne', 'Nombre']);
  for (let s = 1; s <= 8; s += 1) {
    for (const defaut of DEFAUTS) {
      qualite.addRow([`S${String(s).padStart(2, '0')}`, defaut, LIGNES[alea(0, 2)], alea(1, 40)]);
    }
  }

  const chemin = path.join(dossierAbsolu, 'Suivi_production.xlsx');
  await classeur.xlsx.writeFile(chemin);
  return chemin;
}

function creerConfiguration() {
  const source = db
    .prepare(
      `INSERT INTO sources (name, folder, pattern, pick, refresh_minutes)
       VALUES (?, ?, ?, 'latest', 5)`,
    )
    .run('Suivi de production (demonstration)', DOSSIER, 'Suivi_production.xlsx');
  const sourceId = Number(source.lastInsertRowid);

  const dsProduction = db
    .prepare(
      `INSERT INTO datasets (source_id, key, name, sheet, header_row)
       VALUES (?, 'production', 'Production journaliere', 'Production', 1)`,
    )
    .run(sourceId);
  const dsDefauts = db
    .prepare(
      `INSERT INTO datasets (source_id, key, name, sheet, header_row)
       VALUES (?, 'defauts', 'Defauts qualite', 'Defauts', 1)`,
    )
    .run(sourceId);

  return {
    sourceId,
    productionId: Number(dsProduction.lastInsertRowid),
    defautsId: Number(dsDefauts.lastInsertRowid),
  };
}

function creerIndicateurs(ids) {
  const inserer = db.prepare(
    `INSERT INTO indicators (key, name, dataset_id, query, unit, decimals, target, direction, warn_at, alert_at)
     VALUES (@key, @name, @dataset_id, @query, @unit, @decimals, @target, @direction, @warn_at, @alert_at)`,
  );

  const liste = [
    {
      key: 'production_du_jour',
      name: 'Production des 7 derniers jours',
      dataset_id: ids.productionId,
      query: JSON.stringify({
        dataset: ids.productionId,
        filters: [{ field: 'date', op: 'last_days', value: 7 }],
        metrics: [{ agg: 'sum', field: 'quantite_produite' }],
      }),
      unit: 'pieces',
      decimals: 0,
      target: 22000,
      direction: 'higher_better',
      warn_at: 21000,
      alert_at: 19000,
    },
    {
      key: 'arrets_semaine',
      name: 'Temps d arret (7 jours)',
      dataset_id: ids.productionId,
      query: JSON.stringify({
        dataset: ids.productionId,
        filters: [{ field: 'date', op: 'last_days', value: 7 }],
        metrics: [{ agg: 'sum', field: 'temps_arret_min' }],
      }),
      unit: 'min',
      decimals: 0,
      target: 1500,
      direction: 'lower_better',
      warn_at: 1800,
      alert_at: 2400,
    },
    {
      key: 'rebuts_semaine',
      name: 'Rebuts (7 jours)',
      dataset_id: ids.productionId,
      query: JSON.stringify({
        dataset: ids.productionId,
        filters: [{ field: 'date', op: 'last_days', value: 7 }],
        metrics: [{ agg: 'sum', field: 'quantite_rebutee' }],
      }),
      unit: 'pieces',
      decimals: 0,
      target: 600,
      direction: 'lower_better',
      warn_at: 700,
      alert_at: 900,
    },
  ];

  const parCle = {};
  for (const ind of liste) parCle[ind.key] = Number(inserer.run(ind).lastInsertRowid);
  return parCle;
}

function creerVues(ids, indicateurs) {
  const vueProduction = {
    key: 'production',
    name: 'Production',
    theme: 'sombre',
    widgets: [
      { id: 'w1', type: 'kpi', w: 4, h: 2, indicator: indicateurs.production_du_jour },
      { id: 'w2', type: 'kpi', w: 4, h: 2, indicator: indicateurs.rebuts_semaine },
      { id: 'w3', type: 'gauge', w: 4, h: 2, indicator: indicateurs.arrets_semaine, title: 'Temps d arret' },
      {
        id: 'w4',
        type: 'bar',
        w: 8,
        h: 3,
        title: 'Production par ligne (7 derniers jours)',
        query: {
          dataset: ids.productionId,
          filters: [{ field: 'date', op: 'last_days', value: 7 }],
          groupBy: 'ligne',
          metrics: [{ agg: 'sum', field: 'quantite_produite', label: 'Produit' }],
          sort: { by: 'label', dir: 'asc' },
        },
      },
      {
        id: 'w5',
        type: 'pie',
        w: 4,
        h: 3,
        title: 'Repartition par equipe',
        query: {
          dataset: ids.productionId,
          filters: [{ field: 'date', op: 'last_days', value: 7 }],
          groupBy: 'equipe',
          metrics: [{ agg: 'sum', field: 'quantite_produite' }],
        },
      },
    ],
  };

  const vueQualite = {
    key: 'qualite',
    name: 'Qualite',
    theme: 'sombre',
    widgets: [
      {
        id: 'q1',
        type: 'pareto',
        w: 8,
        h: 4,
        title: 'Pareto des defauts',
        query: {
          dataset: ids.defautsId,
          groupBy: 'type_de_defaut',
          metrics: [{ agg: 'sum', field: 'nombre', label: 'Defauts' }],
          limit: 8,
        },
      },
      {
        id: 'q2',
        type: 'table',
        w: 4,
        h: 4,
        title: 'Derniers releves',
        query: {
          dataset: ids.defautsId,
          columns: ['semaine', 'type_de_defaut', 'nombre'],
          sortField: 'nombre',
          sortDir: 'desc',
          limit: 12,
        },
      },
      {
        id: 'q3',
        type: 'line',
        w: 8,
        h: 2,
        title: 'Defauts par semaine',
        query: {
          dataset: ids.defautsId,
          groupBy: 'semaine',
          metrics: [{ agg: 'sum', field: 'nombre', label: 'Defauts' }],
          sort: { by: 'label', dir: 'asc' },
        },
      },
      { id: 'q4', type: 'clock', w: 4, h: 2, title: 'Heure' },
    ],
  };

  const inserer = db.prepare('INSERT INTO views (key, name, widgets, theme) VALUES (?, ?, ?, ?)');
  return [vueProduction, vueQualite].map(
    (v) => Number(inserer.run(v.key, v.name, JSON.stringify(v.widgets), v.theme).lastInsertRowid),
  );
}

async function principal() {
  ensureAdminPassword();

  if (db.prepare('SELECT COUNT(*) AS n FROM sources').get().n > 0) {
    console.log('La base contient deja des sources : rien n a ete modifie.');
    console.log('Pour repartir de zero, supprimez le fichier data/affichage.db puis relancez.');
    return;
  }

  let chemin;
  try {
    chemin = await ecrireClasseur();
  } catch (err) {
    console.error(`Impossible d ecrire le classeur de demonstration dans ${dossierAbsolu} :`);
    console.error(`  ${err.message}`);
    console.error('Le partage reseau est probablement monte en lecture seule, ce qui est normal.');
    console.error('Definissez SOURCE_ROOT sur un dossier accessible en ecriture pour la demonstration.');
    process.exitCode = 1;
    return;
  }
  console.log(`Classeur de demonstration ecrit : ${chemin}`);

  const ids = creerConfiguration();
  const resultat = await importSource(ids.sourceId, { force: true });
  console.log(`Import : ${resultat.message || resultat.error}`);

  const indicateurs = creerIndicateurs(ids);
  const vues = creerVues(ids, indicateurs);

  db.prepare(
    `INSERT INTO screens (key, name, location, playlist, refresh_seconds)
     VALUES ('atelier', 'Atelier (demonstration)', 'Exemple', ?, 30)`,
  ).run(JSON.stringify(vues.map((id) => ({ view_id: id, seconds: 20 }))));

  console.log('');
  console.log('Demonstration installee.');
  console.log('  Administration : http://localhost:8080/admin');
  console.log('  Ecran          : http://localhost:8080/ecran/atelier');
}

principal().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
