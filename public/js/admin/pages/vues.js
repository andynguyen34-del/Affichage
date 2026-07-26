import { api } from '../api.js';
import { h, champ, saisie, selection, modale, confirmer, notifier, erreur, tableau, vider } from '../ui.js';
import { constructeurRequete } from '../requete.js';
import { rendreVue, TYPES_WIDGET, PALETTE } from '../../widgets.js';

const TYPES_AVEC_REQUETE = new Set(['kpi', 'gauge', 'bar', 'line', 'pie', 'pareto', 'table']);
const TYPES_GRAPHIQUE = new Set(['bar', 'line', 'pie', 'pareto']);

let compteurId = 0;
const nouvelId = () => `w${Date.now().toString(36)}${(compteurId += 1)}`;

// --- Resolution des donnees pour l'apercu ----------------------------------

function statut(valeur, { direction = 'higher_better', warn_at, alert_at }) {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return 'neutre';
  const warn = warn_at === '' || warn_at === null || warn_at === undefined ? null : Number(warn_at);
  const alerte = alert_at === '' || alert_at === null || alert_at === undefined ? null : Number(alert_at);
  if (warn === null && alerte === null) return 'neutre';
  if (direction === 'lower_better') {
    if (alerte !== null && v >= alerte) return 'alerte';
    if (warn !== null && v >= warn) return 'vigilance';
    return 'bon';
  }
  if (alerte !== null && v <= alerte) return 'alerte';
  if (warn !== null && v <= warn) return 'vigilance';
  return 'bon';
}

async function resoudreWidget(widget, etat) {
  const out = { ...widget };
  try {
    if (widget.type === 'kpi' || widget.type === 'gauge') {
      if (widget.indicator) {
        const ind = etat.indicateurs.find((i) => String(i.id) === String(widget.indicator));
        if (!ind) throw new Error('Indicateur introuvable');
        out.title = widget.title || ind.name;
        out.value = ind.current?.value ?? null;
        out.unit = widget.unit ?? ind.unit;
        out.decimals = widget.decimals ?? ind.decimals;
        out.target = widget.target ?? ind.target;
        out.status = statut(out.value, {
          direction: widget.direction || ind.direction,
          warn_at: widget.warn_at ?? ind.warn_at,
          alert_at: widget.alert_at ?? ind.alert_at,
        });
      } else if (widget.query?.dataset) {
        const r = await api.requeter({ ...widget.query, groupBy: null });
        out.value = r.total?.m0 ?? null;
        out.status = statut(out.value, widget);
      } else {
        out.error = 'Aucune donnee configuree';
      }
      return out;
    }

    if (TYPES_GRAPHIQUE.has(widget.type)) {
      if (!widget.query?.dataset) {
        out.error = 'Aucune donnee configuree';
        return out;
      }
      const q = { ...widget.query };
      if (widget.type === 'pareto') {
        q.cumulative = true;
        q.sort = { by: 'value', dir: 'desc' };
      }
      const r = await api.requeter(q);
      out.series = r.metrics;
      out.points = r.rows;
      if (r.error) out.error = r.error;
      return out;
    }

    if (widget.type === 'table') {
      if (!widget.query?.dataset) {
        out.error = 'Aucune donnee configuree';
        return out;
      }
      const r = await api.requeter(widget.query, true);
      out.columns = r.columns;
      out.rows = r.rows;
      if (r.error) out.error = r.error;
      return out;
    }

    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  }
}

// --- Editeur d'une tuile ---------------------------------------------------

function ouvrirWidget(widget, etat, onValider) {
  const modele = {
    id: widget.id || nouvelId(),
    type: widget.type || 'kpi',
    title: widget.title || '',
    subtitle: widget.subtitle || '',
    w: widget.w || 4,
    h: widget.h || 2,
    indicator: widget.indicator || '',
    query: widget.query || {},
    unit: widget.unit ?? '',
    decimals: widget.decimals ?? 0,
    target: widget.target ?? '',
    direction: widget.direction || 'higher_better',
    warn_at: widget.warn_at ?? '',
    alert_at: widget.alert_at ?? '',
    min: widget.min ?? 0,
    max: widget.max ?? '',
    color: widget.color || PALETTE[0],
    stacked: !!widget.stacked,
    horizontal: !!widget.horizontal,
    text: widget.text || '',
  };

  const zoneSpecifique = h('div');
  let constructeur = null;

  const selType = selection(modele.type, Object.entries(TYPES_WIDGET), {
    onChange: (e) => {
      modele.type = e.target.value;
      dessinerSpecifique();
    },
  });

  function blocSource() {
    const bloc = h('div');
    const utiliseIndicateur = h('input', {
      type: 'radio',
      name: 'origine',
      id: 'origine-ind',
      checked: !!modele.indicator,
      onChange: () => {
        modele.indicator = etat.indicateurs[0]?.id || '';
        dessinerSpecifique();
      },
    });
    const utiliseRequete = h('input', {
      type: 'radio',
      name: 'origine',
      id: 'origine-req',
      checked: !modele.indicator,
      onChange: () => {
        modele.indicator = '';
        dessinerSpecifique();
      },
    });

    bloc.append(
      h(
        'div',
        { style: { display: 'flex', gap: '1.5rem', marginBottom: '0.8rem' } },
        h('div', { class: 'case' }, utiliseIndicateur, h('label', { for: 'origine-ind', text: 'Indicateur enregistre' })),
        h('div', { class: 'case' }, utiliseRequete, h('label', { for: 'origine-req', text: 'Calcul specifique a cette tuile' })),
      ),
    );

    if (modele.indicator) {
      if (!etat.indicateurs.length) {
        bloc.append(h('p', { class: 'aide', text: 'Aucun indicateur enregistre pour le moment.' }));
      } else {
        bloc.append(
          champ(
            'Indicateur',
            selection(
              modele.indicator,
              etat.indicateurs.map((i) => [i.id, i.name]),
              { onChange: (e) => (modele.indicator = e.target.value) },
            ),
            "L'unite, l'objectif et les seuils de l'indicateur sont repris automatiquement.",
          ),
        );
      }
    } else {
      constructeur = constructeurRequete({
        query: modele.query,
        datasets: etat.datasets,
        meta: etat.meta,
        options: { metriques: 'unique', groupe: false },
      });
      bloc.append(constructeur.element);
    }
    return bloc;
  }

  function dessinerSpecifique() {
    vider(zoneSpecifique);
    constructeur = null;

    if (modele.type === 'kpi' || modele.type === 'gauge') {
      zoneSpecifique.append(h('div', { class: 'sous-titre', text: 'Donnees' }), blocSource());

      if (!modele.indicator) {
        zoneSpecifique.append(
          h('div', { class: 'sous-titre', text: 'Presentation' }),
          h(
            'div',
            { class: 'ligne-champs' },
            champ('Unite', saisie(modele.unit, { onInput: (e) => (modele.unit = e.target.value) })),
            champ('Decimales', saisie(modele.decimals, { type: 'number', min: 0, max: 4, onInput: (e) => (modele.decimals = e.target.value) })),
            champ('Objectif', saisie(modele.target, { type: 'number', step: 'any', placeholder: 'aucun', onInput: (e) => (modele.target = e.target.value) })),
          ),
          h(
            'div',
            { class: 'ligne-champs' },
            champ('Sens de lecture', selection(modele.direction, [
              ['higher_better', 'Haut = bon'],
              ['lower_better', 'Bas = bon'],
            ], { onChange: (e) => (modele.direction = e.target.value) })),
            champ('Seuil orange', saisie(modele.warn_at, { type: 'number', step: 'any', onInput: (e) => (modele.warn_at = e.target.value) })),
            champ('Seuil rouge', saisie(modele.alert_at, { type: 'number', step: 'any', onInput: (e) => (modele.alert_at = e.target.value) })),
          ),
        );
      }

      if (modele.type === 'gauge') {
        zoneSpecifique.append(
          h(
            'div',
            { class: 'ligne-champs' },
            champ('Minimum de la jauge', saisie(modele.min, { type: 'number', step: 'any', onInput: (e) => (modele.min = e.target.value) })),
            champ('Maximum de la jauge', saisie(modele.max, { type: 'number', step: 'any', placeholder: "objectif de l'indicateur", onInput: (e) => (modele.max = e.target.value) })),
          ),
        );
      } else {
        zoneSpecifique.append(
          champ('Sous-titre', saisie(modele.subtitle, { placeholder: 'affiche sous la valeur', onInput: (e) => (modele.subtitle = e.target.value) })),
        );
      }
      return;
    }

    if (TYPES_GRAPHIQUE.has(modele.type)) {
      constructeur = constructeurRequete({
        query: modele.query,
        datasets: etat.datasets,
        meta: etat.meta,
        options: {
          metriques: modele.type === 'bar' || modele.type === 'line' ? 'multiple' : 'unique',
          groupe: true,
          tri: modele.type !== 'pareto',
          limite: true,
        },
      });
      zoneSpecifique.append(h('div', { class: 'sous-titre', text: 'Donnees' }), constructeur.element);

      const options = [
        champ('Couleur principale', selection(modele.color, PALETTE.map((c) => [c, c]), {
          onChange: (e) => (modele.color = e.target.value),
        })),
      ];
      if (modele.type === 'bar') {
        options.push(
          champ('Orientation', selection(modele.horizontal ? '1' : '0', [['0', 'Barres verticales'], ['1', 'Barres horizontales']], {
            onChange: (e) => (modele.horizontal = e.target.value === '1'),
          })),
          champ('Empilement', selection(modele.stacked ? '1' : '0', [['0', 'Series cote a cote'], ['1', 'Series empilees']], {
            onChange: (e) => (modele.stacked = e.target.value === '1'),
          })),
        );
      }
      zoneSpecifique.append(h('div', { class: 'sous-titre', text: 'Presentation' }), h('div', { class: 'ligne-champs' }, options));
      return;
    }

    if (modele.type === 'table') {
      constructeur = constructeurRequete({
        query: modele.query,
        datasets: etat.datasets,
        meta: etat.meta,
        options: { colonnes: true },
      });
      zoneSpecifique.append(h('div', { class: 'sous-titre', text: 'Donnees' }), constructeur.element);
      return;
    }

    if (modele.type === 'text') {
      zoneSpecifique.append(
        champ('Texte affiche', h('textarea', { onInput: (e) => (modele.text = e.target.value) }, modele.text),
          'Consignes, message de securite, rappel de reunion…'),
      );
    }
  }

  const corps = h(
    'div',
    {},
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Type de tuile', selType),
      champ('Titre', saisie(modele.title, { placeholder: 'laisser vide pour aucun titre', onInput: (e) => (modele.title = e.target.value) })),
    ),
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Largeur (sur 12 colonnes)', saisie(modele.w, { type: 'number', min: 1, max: 12, onInput: (e) => (modele.w = Number(e.target.value) || 4) })),
      champ('Hauteur (en rangees)', saisie(modele.h, { type: 'number', min: 1, max: 8, onInput: (e) => (modele.h = Number(e.target.value) || 1) })),
    ),
    zoneSpecifique,
  );

  dessinerSpecifique();

  const valider = h(
    'button',
    {
      class: 'principal',
      onClick: () => {
        if (constructeur && TYPES_AVEC_REQUETE.has(modele.type)) modele.query = constructeur.lire();
        if (modele.indicator) modele.query = {};
        onValider(modele);
        boite.fermer();
      },
    },
    'Valider',
  );

  const boite = modale({
    titre: widget.id ? 'Modifier la tuile' : 'Ajouter une tuile',
    corps,
    large: true,
    actions: [h('button', { onClick: () => boite.fermer() }, 'Annuler'), valider],
  });
}

// --- Editeur d'une vue -----------------------------------------------------

function editeurVue(vue, contexte, retour) {
  const { etat, rafraichir } = contexte;
  const modele = {
    name: vue.name || '',
    theme: vue.theme || 'sombre',
    enabled: vue.enabled === undefined ? true : !!vue.enabled,
    widgets: JSON.parse(JSON.stringify(vue.widgets || [])),
  };

  const conteneur = h('div');
  const zoneListe = h('div', { class: 'liste-widgets' });
  const zoneApercu = h('div', { class: 'cadre' });
  let vueRendue = null;
  let jetonApercu = 0;

  async function rafraichirApercu() {
    const jeton = (jetonApercu += 1);
    const resolus = await Promise.all(modele.widgets.map((w) => resoudreWidget(w, etat)));
    if (jeton !== jetonApercu) return; // une demande plus recente a pris le relais
    if (vueRendue) vueRendue.liberer();
    vider(zoneApercu);
    vueRendue = rendreVue({ widgets: resolus });
    zoneApercu.append(vueRendue.element);
    zoneApercu.classList.toggle('theme-clair', modele.theme === 'clair');
  }

  function dessinerListe() {
    vider(zoneListe);
    if (!modele.widgets.length) {
      zoneListe.append(h('p', { class: 'aide', text: 'Aucune tuile. Ajoutez-en une pour commencer.' }));
    }

    modele.widgets.forEach((w, index) => {
      const deplacer = (delta) => {
        const cible = index + delta;
        if (cible < 0 || cible >= modele.widgets.length) return;
        const [item] = modele.widgets.splice(index, 1);
        modele.widgets.splice(cible, 0, item);
        dessinerListe();
        rafraichirApercu();
      };

      zoneListe.append(
        h(
          'div',
          { class: 'puce-widget' },
          h('span', { text: '⠿', style: { color: 'var(--texte-doux)' } }),
          h(
            'div',
            { style: { minWidth: '0' } },
            h('div', { class: 'titre', text: w.title || TYPES_WIDGET[w.type] || w.type }),
            h('div', { class: 'meta', text: `${TYPES_WIDGET[w.type] || w.type} · ${w.w}×${w.h}` }),
          ),
          h(
            'div',
            { class: 'droite' },
            h('button', { class: 'discret', title: 'Monter', onClick: () => deplacer(-1) }, '↑'),
            h('button', { class: 'discret', title: 'Descendre', onClick: () => deplacer(1) }, '↓'),
            h('button', {
              class: 'discret',
              title: 'Dupliquer',
              onClick: () => {
                modele.widgets.splice(index + 1, 0, { ...JSON.parse(JSON.stringify(w)), id: nouvelId() });
                dessinerListe();
                rafraichirApercu();
              },
            }, '⧉'),
            h('button', {
              class: 'discret',
              onClick: () =>
                ouvrirWidget(w, etat, (maj) => {
                  modele.widgets[index] = maj;
                  dessinerListe();
                  rafraichirApercu();
                }),
            }, 'Modifier'),
            h('button', {
              class: 'discret danger',
              title: 'Supprimer',
              onClick: () => {
                modele.widgets.splice(index, 1);
                dessinerListe();
                rafraichirApercu();
              },
            }, '✕'),
          ),
        ),
      );
    });
  }

  const enregistrer = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (!modele.name.trim()) return notifier('Le nom de la vue est obligatoire.', 'vigilance');
        try {
          if (vue.id) await api.majVue(vue.id, modele);
          else await api.creerVue(modele);
          notifier('Vue enregistree.');
          await rafraichir();
          retour();
        } catch (e) {
          erreur(e);
        }
      },
    },
    'Enregistrer la vue',
  );

  conteneur.append(
    h(
      'div',
      { class: 'entete-page' },
      h(
        'div',
        {},
        h('h1', { text: vue.id ? `Vue « ${vue.name} »` : 'Nouvelle vue' }),
        h('p', { text: "Composez la page telle qu'elle apparaitra sur l'ecran. L'apercu de droite utilise les donnees reelles." }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          onClick: () => {
              retour();
          },
        }, '← Retour'),
        enregistrer,
      ),
    ),
    h(
      'div',
      { class: 'editeur-vue' },
      h(
        'div',
        {},
        h(
          'div',
          { class: 'carte' },
          h(
            'div',
            { class: 'ligne-champs' },
            champ('Nom de la vue', saisie(modele.name, { onInput: (e) => (modele.name = e.target.value) })),
            champ('Theme', selection(modele.theme, [['sombre', 'Sombre'], ['clair', 'Clair']], {
              onChange: (e) => {
                modele.theme = e.target.value;
                rafraichirApercu();
              },
            }), 'Le theme clair convient aux ecrans exposes en pleine lumiere.'),
          ),
        ),
        h(
          'div',
          { class: 'carte' },
          h('h2', { text: 'Tuiles' }),
          zoneListe,
          h(
            'button',
            {
              style: { marginTop: '0.8rem' },
              onClick: () =>
                ouvrirWidget({}, etat, (maj) => {
                  modele.widgets.push(maj);
                  dessinerListe();
                  rafraichirApercu();
                }),
            },
            '+ Ajouter une tuile',
          ),
          h('p', { class: 'aide', style: { marginTop: '0.8rem' } },
            "Les tuiles se placent de gauche a droite puis ligne par ligne, sur une grille de 12 colonnes. Une tuile de largeur 6 occupe donc la moitie de l'ecran."),
        ),
      ),
      h(
        'div',
        { class: 'apercu-vue' },
        h(
          'div',
          { class: 'apercu-entete' },
          h('span', { text: 'Apercu (16:9)' }),
          h('div', { class: 'droite' }, h('button', { class: 'discret', onClick: rafraichirApercu }, '⟳ Actualiser')),
        ),
        zoneApercu,
      ),
    ),
  );

  dessinerListe();
  rafraichirApercu();

  return {
    element: conteneur,
    nettoyer: () => {
      if (vueRendue) vueRendue.liberer();
    },
  };
}

// --- Page ------------------------------------------------------------------

export async function pageVues(contexte) {
  const { etat, rafraichir } = contexte;
  const conteneur = h('div');
  let nettoyageCourant = null;

  function afficher(noeud) {
    if (nettoyageCourant) {
      nettoyageCourant();
      nettoyageCourant = null;
    }
    vider(conteneur).append(noeud.element ?? noeud);
    if (noeud.nettoyer) nettoyageCourant = noeud.nettoyer;
  }

  function ouvrirEditeur(vue) {
    afficher(editeurVue(vue, contexte, () => afficher(liste())));
  }

  function liste() {
    const lignes = etat.vues.map((v) => [
      h(
        'div',
        {},
        h('div', { class: 'principal-cellule', text: v.name }),
        h('div', { class: 'secondaire mono', text: `/vue/${v.key}` }),
      ),
      h('span', { text: `${v.widgets.length} tuile(s)` }),
      h('span', { text: v.theme === 'clair' ? 'Clair' : 'Sombre' }),
      h('span', {
        text: etat.ecrans.filter((e) => e.playlist.some((p) => p.view_id === v.id)).length
          ? `${etat.ecrans.filter((e) => e.playlist.some((p) => p.view_id === v.id)).length} ecran(s)`
          : 'aucun ecran',
      }),
      v.enabled ? h('span', { class: 'badge ok', text: 'active' }) : h('span', { class: 'badge', text: 'inactive' }),
      h(
        'td',
        { class: 'actions' },
        h('a', { class: 'bouton discret', href: `/vue/${v.key}`, target: '_blank' }, 'Ouvrir ↗'),
        h('button', { class: 'discret', onClick: () => ouvrirEditeur(v) }, 'Modifier'),
        h(
          'button',
          {
            class: 'discret',
            title: 'Dupliquer',
            onClick: async () => {
              await api.creerVue({ name: `${v.name} (copie)`, widgets: v.widgets, theme: v.theme });
              notifier('Vue dupliquee.');
              await rafraichir();
            },
          },
          '⧉',
        ),
        h(
          'button',
          {
            class: 'discret danger',
            onClick: async () => {
              if (await confirmer(`Supprimer la vue « ${v.name} » ? Elle sera retiree des diaporamas des ecrans.`)) {
                await api.supprimerVue(v.id);
                notifier('Vue supprimee.');
                await rafraichir();
              }
            },
          },
          'Supprimer',
        ),
      ),
    ]);

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'entete-page' },
        h(
          'div',
          {},
          h('h1', { text: 'Vues' }),
          h('p', { text: "Une vue est une page d'ecran composee de tuiles : indicateurs, graphiques, tableaux. Un ecran enchaine ensuite plusieurs vues." }),
        ),
        h('div', { class: 'actions' }, h('button', { class: 'principal', onClick: () => ouvrirEditeur({}) }, '+ Nouvelle vue')),
      ),
      h(
        'div',
        { class: 'carte' },
        etat.vues.length
          ? tableau(['Vue', 'Tuiles', 'Theme', 'Utilisation', 'Etat', ''], lignes)
          : h('div', { class: 'vide', text: 'Aucune vue. Creez-en une pour composer un ecran.' }),
      ),
    );
  }

  afficher(liste());
  return { element: conteneur, nettoyer: () => nettoyageCourant?.() };
}
