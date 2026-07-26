import { api } from '../api.js';
import { h, champ, saisie, selection, modale, confirmer, notifier, erreur, tableau, vider } from '../ui.js';
import { horodatage, depuis, nombre, valeurCellule, estNombre } from '../../format.js';

const TYPES = [
  ['auto', 'Automatique'],
  ['number', 'Nombre'],
  ['text', 'Texte'],
  ['date', 'Date'],
];

function tableApercu(colonnes, lignes) {
  const table = h('table');
  table.append(h('thead', {}, h('tr', {}, colonnes.map((c) => h('th', { text: c.label })))));
  const tbody = h('tbody');
  for (const ligne of lignes) {
    tbody.append(
      h(
        'tr',
        {},
        colonnes.map((c) => {
          const v = ligne[c.key];
          return h('td', { class: estNombre(v) ? 'nombre' : null, text: valeurCellule(v, c.type) });
        }),
      ),
    );
  }
  table.append(tbody);
  return h('div', { class: 'apercu-donnees' }, table);
}

/**
 * Formulaire d'un jeu de donnees. L'apercu se recharge a chaque changement de
 * feuille ou de ligne d'en-tete : on voit immediatement ce que le serveur lira.
 */
function formulaireDataset(dataset, etat) {
  const valeurs = {
    source_id: dataset.source_id || etat.sources[0]?.id || '',
    name: dataset.name || '',
    sheet: dataset.sheet || '',
    header_row: dataset.header_row || 1,
    skip_rows: dataset.skip_rows || 0,
    mapping: Array.isArray(dataset.mapping) ? [...dataset.mapping] : [],
    filters: Array.isArray(dataset.filters) ? [...dataset.filters] : [],
    enabled: dataset.enabled === undefined ? true : !!dataset.enabled,
  };

  const zoneApercu = h('div');
  const zoneMapping = h('div');
  const selFeuille = selection('', [['', '— premiere feuille —']], {
    onChange: (e) => {
      valeurs.sheet = e.target.value;
      chargerApercu();
    },
  });

  const selSource = selection(
    valeurs.source_id,
    etat.sources.map((s) => [s.id, `${s.name} — ${s.folder || '/'}/${s.pattern}`]),
    {
      onChange: (e) => {
        valeurs.source_id = e.target.value;
        valeurs.mapping = [];
        chargerApercu();
      },
    },
  );

  const inputEntete = saisie(valeurs.header_row, {
    type: 'number',
    min: 1,
    onChange: (e) => {
      valeurs.header_row = Number(e.target.value) || 1;
      valeurs.mapping = [];
      chargerApercu();
    },
  });
  const inputIgnorer = saisie(valeurs.skip_rows, {
    type: 'number',
    min: 0,
    onChange: (e) => {
      valeurs.skip_rows = Number(e.target.value) || 0;
      chargerApercu();
    },
  });

  function dessinerMapping(mappingDetecte) {
    vider(zoneMapping);
    const courant = valeurs.mapping.length ? valeurs.mapping : mappingDetecte;

    zoneMapping.append(
      h('p', { class: 'aide', text: 'Decochez les colonnes inutiles et corrigez le type si la detection automatique se trompe.' }),
    );

    const table = h('table', { class: 'liste' });
    table.append(
      h('thead', {}, h('tr', {}, [h('th', { text: '' }), h('th', { text: 'Colonne du fichier' }), h('th', { text: 'Libelle affiche' }), h('th', { text: 'Type' })])),
    );
    const tbody = h('tbody');

    for (const detecte of mappingDetecte) {
      const existant = courant.find((m) => m.source === detecte.source);
      const actif = !valeurs.mapping.length || !!existant;
      const entree = {
        source: detecte.source,
        key: existant?.key || detecte.key,
        label: existant?.label || detecte.label,
        type: existant?.type || detecte.type,
      };

      const caseColonne = h('input', {
        type: 'checkbox',
        checked: actif,
        onChange: (e) => appliquer(e.target.checked, entree),
      });
      const inputLibelle = saisie(entree.label, {
        onInput: (e) => {
          entree.label = e.target.value;
          appliquer(caseColonne.checked, entree);
        },
      });
      const selType = selection(entree.type, TYPES, {
        onChange: (e) => {
          entree.type = e.target.value;
          appliquer(caseColonne.checked, entree);
        },
      });

      tbody.append(
        h('tr', {}, [
          h('td', {}, caseColonne),
          h('td', { class: 'mono', text: detecte.source }),
          h('td', {}, inputLibelle),
          h('td', {}, selType),
        ]),
      );
    }

    function appliquer(actif, entree) {
      // A la premiere modification, on fige la liste complete puis on l'ajuste.
      if (!valeurs.mapping.length) {
        valeurs.mapping = mappingDetecte.map((m) => ({ source: m.source, key: m.key, label: m.label, type: m.type }));
      }
      const index = valeurs.mapping.findIndex((m) => m.source === entree.source);
      if (actif) {
        if (index === -1) valeurs.mapping.push({ ...entree });
        else valeurs.mapping[index] = { ...entree };
      } else if (index !== -1) {
        valeurs.mapping.splice(index, 1);
      }
    }

    table.append(tbody);
    zoneMapping.append(table);
  }

  async function chargerApercu() {
    vider(zoneApercu).append(h('p', { class: 'aide', text: 'Lecture du fichier…' }));
    vider(zoneMapping);
    const source = etat.sources.find((s) => String(s.id) === String(valeurs.source_id));
    if (!source) {
      vider(zoneApercu).append(h('p', { class: 'aide', text: 'Choisissez une source.' }));
      return;
    }
    try {
      const donnees = await api.apercuFichier({
        folder: source.folder,
        pattern: source.pattern,
        pick: source.pick,
        sheet: valeurs.sheet,
        headerRow: valeurs.header_row,
        skipRows: valeurs.skip_rows,
      });

      // Feuilles disponibles
      vider(selFeuille);
      selFeuille.append(h('option', { value: '' }, '— premiere feuille —'));
      for (const nom of donnees.sheets) selFeuille.append(h('option', { value: nom }, nom));
      selFeuille.value = valeurs.sheet || '';

      const colonnes = donnees.mapping.map((m) => ({ key: m.key, label: m.label, type: m.type }));
      const lignes = donnees.rows.slice(0, 12).map((cells) => {
        const o = {};
        donnees.mapping.forEach((m) => {
          o[m.key] = cells[m.index];
        });
        return o;
      });

      vider(zoneApercu).append(
        h('p', { class: 'aide' }, h('strong', { text: donnees.file.name }), ` — modifie le ${horodatage(donnees.file.modifiedAt)}`),
        tableApercu(colonnes, lignes),
      );
      dessinerMapping(donnees.mapping);
    } catch (e) {
      vider(zoneApercu).append(h('p', { class: 'aide', style: { color: 'var(--alerte)' }, text: e.message }));
    }
  }

  const inputNom = saisie(valeurs.name, {
    placeholder: 'Production journaliere',
    onInput: (e) => (valeurs.name = e.target.value),
  });
  const caseActive = h('input', {
    type: 'checkbox',
    id: 'ds-active',
    checked: valeurs.enabled,
    onChange: (e) => (valeurs.enabled = e.target.checked),
  });

  const corps = h(
    'div',
    {},
    champ('Nom', inputNom),
    champ('Source', selSource),
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Feuille', selFeuille, 'Laisser vide pour prendre la premiere feuille du classeur.'),
      champ("Ligne des en-tetes", inputEntete, 'Numero de la ligne contenant les titres de colonnes.'),
      champ('Lignes a ignorer ensuite', inputIgnorer, 'Utile si une ligne d\'unites suit les en-tetes.'),
    ),
    h('div', { class: 'case', style: { marginBottom: '1rem' } }, caseActive, h('label', { for: 'ds-active', text: 'Jeu de donnees actif' })),
    h('div', { class: 'sous-titre', text: 'Apercu du fichier' }),
    zoneApercu,
    h('div', { class: 'sous-titre', text: 'Colonnes importees' }),
    zoneMapping,
  );

  chargerApercu();
  return { corps, valeurs };
}

function ouvrirDataset(dataset, contexte) {
  const { etat, rafraichir } = contexte;
  if (!etat.sources.length) {
    notifier('Creez d\'abord une source Excel.', 'vigilance');
    return;
  }
  const { corps, valeurs } = formulaireDataset(dataset, etat);
  const estNouveau = !dataset.id;

  const enregistrer = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (!valeurs.name.trim()) return notifier('Le nom est obligatoire.', 'vigilance');
        try {
          const enregistre = estNouveau
            ? await api.creerDataset(valeurs)
            : await api.majDataset(dataset.id, valeurs);
          const resultat = await api.importerDataset(enregistre.id);
          if (resultat.ok) notifier(`${nombre(resultat.rowCount)} ligne(s) importee(s) depuis ${resultat.file}.`);
          else erreur(resultat.error);
          boite.fermer();
          await rafraichir();
        } catch (e) {
          erreur(e);
        }
      },
    },
    estNouveau ? 'Creer et importer' : 'Enregistrer et reimporter',
  );

  const boite = modale({
    titre: estNouveau ? 'Nouveau jeu de donnees' : `Jeu de donnees « ${dataset.name} »`,
    corps,
    large: true,
    actions: [h('button', { onClick: () => boite.fermer() }, 'Annuler'), enregistrer],
  });
}

async function voirDonnees(dataset) {
  const corps = h('div', {}, h('p', { class: 'aide', text: 'Chargement…' }));
  modale({ titre: `Donnees importees — ${dataset.name}`, corps, large: true });
  try {
    const resultat = await api.requeter({ dataset: dataset.id, limit: 200 }, true);
    vider(corps).append(
      h('p', { class: 'aide', text: `${nombre(resultat.rowCount)} ligne(s), dernier import ${horodatage(resultat.lastImportAt)}` }),
      (() => {
        const table = h('table');
        table.append(h('thead', {}, h('tr', {}, resultat.columns.map((c) => h('th', { text: c.label })))));
        const tbody = h('tbody');
        for (const ligne of resultat.rows) {
          tbody.append(
            h('tr', {}, ligne.map((v, i) => h('td', { class: estNombre(v) ? 'nombre' : null, text: valeurCellule(v, resultat.columns[i]?.type) }))),
          );
        }
        table.append(tbody);
        return h('div', { class: 'apercu-donnees', style: { maxHeight: '55vh' } }, table);
      })(),
    );
  } catch (e) {
    vider(corps).append(h('p', { style: { color: 'var(--alerte)' }, text: e.message }));
  }
}

export async function pageDatasets(contexte) {
  const { etat, rafraichir } = contexte;

  const lignes = etat.datasets.map((d) => {
    const boutonImport = h(
      'button',
      {
        class: 'discret',
        title: 'Reimporter maintenant',
        onClick: async () => {
          boutonImport.disabled = true;
          try {
            const r = await api.importerDataset(d.id);
            if (r.ok) notifier(`${nombre(r.rowCount)} ligne(s) importee(s).`);
            else erreur(r.error);
            await rafraichir();
          } catch (e) {
            erreur(e);
            boutonImport.disabled = false;
          }
        },
      },
      '⟳',
    );

    return [
      h(
        'div',
        {},
        h('div', { class: 'principal-cellule', text: d.name }),
        h('div', { class: 'secondaire mono', text: d.key }),
      ),
      h(
        'div',
        {},
        h('div', { text: d.source_name || '—' }),
        h('div', { class: 'secondaire', text: d.sheet ? `feuille « ${d.sheet} »` : 'premiere feuille' }),
      ),
      h('span', { text: `${d.fields.length} champ(s)` }),
      h(
        'div',
        {},
        h('div', { text: nombre(d.row_count) }),
        h('div', { class: 'secondaire', text: d.last_import_at ? depuis(d.last_import_at) : 'jamais' }),
      ),
      d.enabled ? h('span', { class: 'badge ok', text: 'actif' }) : h('span', { class: 'badge', text: 'inactif' }),
      h(
        'td',
        { class: 'actions' },
        boutonImport,
        h('button', { class: 'discret', onClick: () => voirDonnees(d) }, 'Voir'),
        h('button', { class: 'discret', onClick: () => ouvrirDataset(d, contexte) }, 'Modifier'),
        h(
          'button',
          {
            class: 'discret danger',
            onClick: async () => {
              if (await confirmer(`Supprimer le jeu de donnees « ${d.name} » et ses ${nombre(d.row_count)} lignes ?`)) {
                await api.supprimerDataset(d.id);
                notifier('Jeu de donnees supprime.');
                await rafraichir();
              }
            },
          },
          'Supprimer',
        ),
      ),
    ];
  });

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'entete-page' },
      h(
        'div',
        {},
        h('h1', { text: 'Jeux de donnees' }),
        h('p', {
          text: "Un jeu de donnees decrit une feuille d'un classeur : quelle ligne contient les en-tetes, quelles colonnes conserver et comment les interpreter. C'est la matiere premiere des indicateurs.",
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'principal', onClick: () => ouvrirDataset({}, contexte) }, '+ Nouveau jeu de donnees'),
      ),
    ),
    h(
      'div',
      { class: 'carte' },
      etat.datasets.length
        ? tableau(['Jeu de donnees', 'Source', 'Champs', 'Lignes', 'Etat', ''], lignes)
        : h('div', { class: 'vide', text: 'Aucun jeu de donnees. Creez-en un a partir d\'une source Excel.' }),
    ),
  );
}
