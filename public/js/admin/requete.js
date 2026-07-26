// Constructeur de requete reutilise par les indicateurs et par l'editeur de
// tuiles : choix du jeu de donnees, filtres, regroupement, agregations.

import { h, champ, selection, saisie } from './ui.js';

const OPS_SANS_VALEUR = new Set(['empty', 'not_empty', 'this_month', 'this_year']);

function champsDe(dataset) {
  if (!dataset) return [];
  const fields = Array.isArray(dataset.fields) ? dataset.fields : [];
  return fields;
}

function optionsChamps(dataset, { vide = '' } = {}) {
  const options = vide === false ? [] : [['', vide || '— choisir —']];
  for (const f of champsDe(dataset)) {
    options.push([f.key, `${f.label}${f.type === 'number' ? ' (nombre)' : f.type === 'date' ? ' (date)' : ''}`]);
  }
  return options;
}

/**
 * @param {object} opts
 * @param {object} opts.query      requete initiale
 * @param {Array}  opts.datasets   jeux de donnees disponibles
 * @param {object} opts.meta       { aggregations, filterOps }
 * @param {object} [opts.options]  { metriques:'unique'|'multiple', groupe:bool, tri:bool, limite:bool, colonnes:bool }
 * @param {Function} [opts.onChange]
 */
export function constructeurRequete({ query = {}, datasets, meta, options = {}, onChange }) {
  const conf = {
    metriques: 'unique',
    groupe: false,
    tri: false,
    limite: false,
    colonnes: false,
    ...options,
  };

  const etatRequete = {
    dataset: query.dataset ?? '',
    filters: JSON.parse(JSON.stringify(query.filters || [])),
    groupBy: query.groupBy ?? '',
    metrics: JSON.parse(JSON.stringify(query.metrics || [{ agg: 'sum', field: '', label: '' }])),
    sort: { by: query.sort?.by || 'value', dir: query.sort?.dir || 'desc' },
    limit: query.limit ?? '',
    others: !!query.others,
    columns: query.columns || [],
    sortField: query.sortField || '',
    sortDir: query.sortDir || 'desc',
  };

  const conteneur = h('div');
  const zoneDynamique = h('div');

  const declencher = () => onChange?.(lire());

  const datasetCourant = () =>
    datasets.find((d) => String(d.id) === String(etatRequete.dataset)) || null;

  const selectDataset = selection(
    etatRequete.dataset,
    [['', '— choisir un jeu de donnees —'], ...datasets.map((d) => [d.id, `${d.name} (${d.row_count} lignes)`])],
    {
      onChange: (e) => {
        etatRequete.dataset = e.target.value;
        // Les champs changent : on repart d'une configuration propre.
        etatRequete.filters = [];
        etatRequete.groupBy = '';
        etatRequete.metrics = [{ agg: 'sum', field: '', label: '' }];
        etatRequete.columns = [];
        etatRequete.sortField = '';
        dessiner();
        declencher();
      },
    },
  );

  // --- Filtres -------------------------------------------------------------

  function ligneFiltre(filtre, index) {
    const dataset = datasetCourant();
    const selChamp = selection(filtre.field, optionsChamps(dataset), {
      onChange: (e) => {
        filtre.field = e.target.value;
        declencher();
      },
    });
    const selOp = selection(
      filtre.op || 'eq',
      Object.entries(meta.filterOps || {}).map(([v, l]) => [v, l]),
      {
        onChange: (e) => {
          filtre.op = e.target.value;
          dessiner();
          declencher();
        },
      },
    );
    const inputValeur = saisie(filtre.value ?? '', {
      placeholder: filtre.op === 'in' || filtre.op === 'not_in' ? 'valeur1 ; valeur2' : 'valeur',
      disabled: OPS_SANS_VALEUR.has(filtre.op),
      onInput: (e) => {
        filtre.value = e.target.value;
        declencher();
      },
    });
    return h(
      'div',
      { class: 'filtre' },
      selChamp,
      selOp,
      inputValeur,
      h(
        'button',
        {
          class: 'discret',
          title: 'Retirer ce filtre',
          onClick: () => {
            etatRequete.filters.splice(index, 1);
            dessiner();
            declencher();
          },
        },
        '✕',
      ),
    );
  }

  // --- Metriques -----------------------------------------------------------

  function ligneMetrique(metrique, index) {
    const dataset = datasetCourant();
    const besoinChamp = metrique.agg !== 'count';
    const selAgg = selection(
      metrique.agg || 'sum',
      Object.entries(meta.aggregations || {}).map(([v, l]) => [v, l]),
      {
        onChange: (e) => {
          metrique.agg = e.target.value;
          dessiner();
          declencher();
        },
      },
    );
    const selChamp = selection(metrique.field, optionsChamps(dataset), {
      disabled: !besoinChamp,
      onChange: (e) => {
        metrique.field = e.target.value;
        declencher();
      },
    });
    const inputLibelle = saisie(metrique.label ?? '', {
      placeholder: 'Libelle (optionnel)',
      onInput: (e) => {
        metrique.label = e.target.value;
        declencher();
      },
    });

    return h(
      'div',
      { class: 'filtre' },
      selAgg,
      selChamp,
      inputLibelle,
      conf.metriques === 'multiple' && etatRequete.metrics.length > 1
        ? h(
            'button',
            {
              class: 'discret',
              onClick: () => {
                etatRequete.metrics.splice(index, 1);
                dessiner();
                declencher();
              },
            },
            '✕',
          )
        : h('span'),
    );
  }

  // --- Colonnes (widget tableau) -------------------------------------------

  function blocColonnes() {
    const dataset = datasetCourant();
    const champs = champsDe(dataset);
    if (!champs.length) return null;
    const liste = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem' } });
    for (const f of champs) {
      const id = `col-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
      const coche = !etatRequete.columns.length || etatRequete.columns.includes(f.key);
      liste.append(
        h(
          'div',
          { class: 'case' },
          h('input', {
            type: 'checkbox',
            id,
            checked: coche,
            onChange: (e) => {
              const actuelles = etatRequete.columns.length
                ? [...etatRequete.columns]
                : champs.map((x) => x.key);
              etatRequete.columns = e.target.checked
                ? [...new Set([...actuelles, f.key])].sort(
                    (a, b) => champs.findIndex((x) => x.key === a) - champs.findIndex((x) => x.key === b),
                  )
                : actuelles.filter((k) => k !== f.key);
              declencher();
            },
          }),
          h('label', { for: id, text: f.label }),
        ),
      );
    }
    return champ('Colonnes affichees', liste, 'Decochez pour masquer une colonne.');
  }

  // --- Assemblage ----------------------------------------------------------

  function dessiner() {
    zoneDynamique.replaceChildren();
    const dataset = datasetCourant();
    if (!dataset) {
      zoneDynamique.append(
        h('p', { class: 'aide', text: "Choisissez d'abord un jeu de donnees pour configurer la requete." }),
      );
      return;
    }

    zoneDynamique.append(h('div', { class: 'sous-titre', text: 'Filtres' }));
    if (!etatRequete.filters.length) {
      zoneDynamique.append(h('p', { class: 'aide', text: 'Aucun filtre : toutes les lignes sont prises en compte.' }));
    }
    etatRequete.filters.forEach((f, i) => zoneDynamique.append(ligneFiltre(f, i)));
    zoneDynamique.append(
      h(
        'button',
        {
          onClick: () => {
            etatRequete.filters.push({ field: '', op: 'eq', value: '' });
            dessiner();
          },
        },
        '+ Ajouter un filtre',
      ),
    );

    if (conf.colonnes) {
      zoneDynamique.append(h('div', { class: 'sous-titre', text: 'Colonnes' }));
      const bloc = blocColonnes();
      if (bloc) zoneDynamique.append(bloc);
      zoneDynamique.append(
        h(
          'div',
          { class: 'ligne-champs' },
          champ(
            'Trier par',
            selection(etatRequete.sortField, optionsChamps(dataset, { vide: '— ordre du fichier —' }), {
              onChange: (e) => {
                etatRequete.sortField = e.target.value;
                declencher();
              },
            }),
          ),
          champ(
            'Sens',
            selection(etatRequete.sortDir, [['desc', 'Decroissant'], ['asc', 'Croissant']], {
              onChange: (e) => {
                etatRequete.sortDir = e.target.value;
                declencher();
              },
            }),
          ),
          champ(
            'Nombre de lignes',
            saisie(etatRequete.limit || 10, {
              type: 'number',
              min: 1,
              max: 200,
              onInput: (e) => {
                etatRequete.limit = e.target.value;
                declencher();
              },
            }),
          ),
        ),
      );
      return;
    }

    zoneDynamique.append(h('div', { class: 'sous-titre', text: 'Calcul' }));
    etatRequete.metrics.forEach((m, i) => zoneDynamique.append(ligneMetrique(m, i)));
    if (conf.metriques === 'multiple') {
      zoneDynamique.append(
        h(
          'button',
          {
            onClick: () => {
              etatRequete.metrics.push({ agg: 'sum', field: '', label: '' });
              dessiner();
            },
          },
          '+ Ajouter une serie',
        ),
      );
    }

    if (conf.groupe) {
      zoneDynamique.append(h('div', { class: 'sous-titre', text: 'Regroupement' }));
      zoneDynamique.append(
        champ(
          'Regrouper par',
          selection(etatRequete.groupBy, optionsChamps(dataset, { vide: '— aucun regroupement —' }), {
            onChange: (e) => {
              etatRequete.groupBy = e.target.value;
              declencher();
            },
          }),
          'Definit les categories affichees en abscisse (ligne de production, defaut, semaine...).',
        ),
      );

      if (conf.tri || conf.limite) {
        zoneDynamique.append(
          h(
            'div',
            { class: 'ligne-champs' },
            conf.tri
              ? champ(
                  'Ordre',
                  selection(
                    `${etatRequete.sort.by}:${etatRequete.sort.dir}`,
                    [
                      ['value:desc', 'Valeur decroissante'],
                      ['value:asc', 'Valeur croissante'],
                      ['label:asc', 'Categorie A → Z'],
                      ['label:desc', 'Categorie Z → A'],
                    ],
                    {
                      onChange: (e) => {
                        const [by, dir] = e.target.value.split(':');
                        etatRequete.sort = { by, dir };
                        declencher();
                      },
                    },
                  ),
                )
              : null,
            conf.limite
              ? champ(
                  'Limiter a',
                  saisie(etatRequete.limit ?? '', {
                    type: 'number',
                    min: 0,
                    placeholder: 'toutes',
                    onInput: (e) => {
                      etatRequete.limit = e.target.value;
                      declencher();
                    },
                  }),
                  'Laisser vide pour tout afficher.',
                )
              : null,
            conf.limite
              ? champ(
                  'Reste',
                  selection(etatRequete.others ? '1' : '0', [['0', 'Ignorer le reste'], ['1', 'Regrouper dans « Autres »']], {
                    onChange: (e) => {
                      etatRequete.others = e.target.value === '1';
                      declencher();
                    },
                  }),
                )
              : null,
          ),
        );
      }
    }
  }

  function lire() {
    const q = {
      dataset: etatRequete.dataset ? Number(etatRequete.dataset) : '',
      filters: etatRequete.filters.filter((f) => f.field),
    };
    if (conf.colonnes) {
      q.columns = etatRequete.columns;
      q.sortField = etatRequete.sortField;
      q.sortDir = etatRequete.sortDir;
      q.limit = Number(etatRequete.limit) || 10;
      return q;
    }
    q.metrics = etatRequete.metrics
      .filter((m) => m.agg === 'count' || m.field)
      .map((m) => ({ agg: m.agg, field: m.field, label: m.label || undefined }));
    if (!q.metrics.length) q.metrics = [{ agg: 'count', field: '' }];
    if (conf.groupe && etatRequete.groupBy) {
      q.groupBy = etatRequete.groupBy;
      q.sort = etatRequete.sort;
      if (etatRequete.limit) q.limit = Number(etatRequete.limit);
      q.others = etatRequete.others;
    }
    return q;
  }

  conteneur.append(champ('Jeu de donnees', selectDataset), zoneDynamique);
  dessiner();

  return { element: conteneur, lire, etat: etatRequete };
}
