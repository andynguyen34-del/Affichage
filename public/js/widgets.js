// Rendu des tuiles. Ce module est partage par les ecrans de l'atelier et par
// l'apercu de l'interface d'administration : une tuile s'affiche donc de facon
// strictement identique des deux cotes.

import { nombre, nombreCompact, dateLongue, heure, valeurCellule, estNombre } from './format.js';

export const PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

export const TYPES_WIDGET = {
  kpi: 'Indicateur chiffre',
  gauge: 'Jauge',
  bar: 'Graphique en barres',
  line: 'Courbe',
  pie: 'Camembert',
  pareto: 'Pareto',
  table: 'Tableau',
  text: 'Texte libre',
  clock: 'Horloge',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function couleurEtat(statut) {
  return `etat-${statut || 'neutre'}`;
}

// --- Placement dans la grille 12 colonnes -----------------------------------

/**
 * Reproduit le placement automatique de CSS Grid pour connaitre le nombre exact
 * de lignes necessaires : la grille peut ainsi remplir la hauteur de l'ecran
 * sans laisser de bande vide en bas.
 */
export function placer(widgets) {
  const occupe = [];
  const ligne = (r) => {
    while (occupe.length <= r) occupe.push(new Array(12).fill(false));
    return occupe[r];
  };

  const places = [];
  let curLigne = 0;
  let curCol = 0;

  for (const widget of widgets) {
    const largeur = Math.min(12, Math.max(1, Number(widget.w) || 4));
    const hauteur = Math.max(1, Number(widget.h) || 1);
    let r = curLigne;
    let c = curCol;

    for (;;) {
      if (c + largeur > 12) {
        c = 0;
        r += 1;
        continue;
      }
      let libre = true;
      for (let dr = 0; dr < hauteur && libre; dr += 1) {
        for (let dc = 0; dc < largeur; dc += 1) {
          if (ligne(r + dr)[c + dc]) {
            libre = false;
            break;
          }
        }
      }
      if (libre) break;
      c += 1;
    }

    for (let dr = 0; dr < hauteur; dr += 1) {
      for (let dc = 0; dc < largeur; dc += 1) ligne(r + dr)[c + dc] = true;
    }

    places.push({ widget, row: r, col: c, w: largeur, h: hauteur });
    curLigne = r;
    curCol = c + largeur;
    if (curCol >= 12) {
      curCol = 0;
      curLigne = r + 1;
    }
  }

  return { places, lignes: Math.max(1, occupe.length) };
}

// --- Tuiles ------------------------------------------------------------------

function tailleTexte(base) {
  return Math.max(10, Math.round((window.innerHeight / 900) * base));
}

/** Graduations d'axe au format francais : 8 000 et non 8,000. */
function graduation(valeur) {
  return nombre(valeur, Number.isInteger(valeur) ? 0 : 1);
}

/**
 * Reduit la police d'un texte jusqu'a ce qu'il tienne dans sa tuile.
 * Les tailles en `vh` ne connaissent pas la taille de la tuile : sans cet
 * ajustement, un grand nombre deborde des que la vue contient beaucoup de
 * tuiles ou que l'apercu de l'administration est reduit.
 */
function ajusterAuConteneur(noeud) {
  const parent = noeud.parentElement;
  if (!parent || !parent.clientWidth) return;
  noeud.style.fontSize = '';
  let taille = Number.parseFloat(getComputedStyle(noeud).fontSize);
  let garde = 0;
  while (
    garde < 24 &&
    taille > 9 &&
    (noeud.scrollWidth > parent.clientWidth || noeud.scrollHeight > parent.clientHeight)
  ) {
    taille *= 0.9;
    noeud.style.fontSize = `${taille}px`;
    garde += 1;
  }
}

function rendreKpi(widget) {
  const bloc = el('div', 'kpi');
  const valeur = el('div', 'kpi-valeur');
  const decimals = Number(widget.decimals) || 0;
  const brut = widget.value;

  valeur.append(document.createTextNode(brut === null || brut === undefined ? '—' : nombreCompact(brut, decimals)));
  if (widget.unit) valeur.append(el('span', 'kpi-unite', widget.unit));
  bloc.append(valeur);

  const cible = widget.target;
  if (cible !== null && cible !== undefined && cible !== '' && Number.isFinite(Number(brut))) {
    const ecart = Number(brut) - Number(cible);
    const signe = ecart > 0 ? '+' : '';
    const ligne = el('div', 'kpi-objectif');
    ligne.append(document.createTextNode(`Objectif ${nombre(cible, decimals)}${widget.unit ? ' ' + widget.unit : ''} · `));
    ligne.append(el('span', 'kpi-ecart', `${signe}${nombre(ecart, decimals)}`));
    bloc.append(ligne);
  } else if (widget.subtitle) {
    bloc.append(el('div', 'kpi-objectif', widget.subtitle));
  }

  return bloc;
}

function rendreJauge(widget) {
  const bloc = el('div', 'jauge');
  const valeur = Number(widget.value);
  const max = Number(widget.max ?? widget.target ?? 100) || 100;
  const min = Number(widget.min ?? 0) || 0;
  const ratio = Math.max(0, Math.min(1, (valeur - min) / (max - min || 1)));

  // Demi-cercle de rayon 80 centre en (100, 100).
  const rayon = 80;
  const longueur = Math.PI * rayon;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 128');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const chemin = 'M 20 100 A 80 80 0 0 1 180 100';
  const piste = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  piste.setAttribute('d', chemin);
  piste.setAttribute('fill', 'none');
  piste.setAttribute('stroke-width', '18');
  piste.setAttribute('stroke-linecap', 'round');
  piste.setAttribute('class', 'jauge-piste');

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('d', chemin);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke-width', '18');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('class', 'jauge-valeur-arc');
  arc.setAttribute('stroke-dasharray', `${longueur * ratio} ${longueur}`);

  // Seul le nombre est inscrit dans l'arc ; l'unite et l'objectif passent en
  // legende, sinon un libelle long deborde du demi-cercle.
  const libelle = Number.isFinite(valeur)
    ? nombreCompact(valeur, Number(widget.decimals) || 0)
    : '—';

  const texte = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  texte.setAttribute('x', '100');
  texte.setAttribute('y', '92');
  texte.setAttribute('font-size', String(Math.min(34, 118 / Math.max(1, libelle.length * 0.6))));
  texte.setAttribute('class', 'jauge-texte');
  texte.textContent = libelle;

  const objectif =
    widget.target !== null && widget.target !== undefined && widget.target !== ''
      ? `objectif ${nombre(widget.target, Number(widget.decimals) || 0)}`
      : `${nombre(min)} – ${nombre(max)}`;

  const legende = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  legende.setAttribute('x', '100');
  legende.setAttribute('y', '118');
  legende.setAttribute('font-size', '13');
  legende.setAttribute('class', 'jauge-legende');
  legende.textContent = [widget.unit, objectif].filter(Boolean).join(' · ');

  svg.append(piste, arc, texte, legende);
  bloc.append(svg);
  return bloc;
}

function optionsGraphique(widget, extra = {}) {
  const police = tailleTexte(16);
  const doux = getComputedStyle(document.body).getPropertyValue('--texte-doux').trim() || '#93a1b1';
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    layout: { padding: 4 },
    plugins: {
      legend: {
        display: extra.legende ?? false,
        labels: { color: doux, font: { size: police }, boxWidth: police },
      },
      tooltip: { enabled: false },
    },
    ...extra.racine,
    scales: extra.scales,
  };
}

function rendreGraphique(widget, charts) {
  const zone = el('div', 'zone-graphique');
  const canvas = el('canvas');
  zone.append(canvas);

  const points = widget.points || [];
  const series = widget.series || [];
  const labels = points.map((p) => p.label);
  const police = tailleTexte(16);
  const doux = getComputedStyle(document.body).getPropertyValue('--texte-doux').trim() || '#93a1b1';
  const grille = 'rgba(148,163,184,0.18)';
  const couleur = widget.color || PALETTE[0];

  // Chart.js est instancie apres insertion dans le document (il a besoin de la
  // taille reelle du conteneur).
  queueMicrotask(() => {
    if (!window.Chart || !canvas.isConnected) return;

    let config;
    if (widget.type === 'pie') {
      config = {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            {
              data: points.map((p) => p.values.m0),
              backgroundColor: points.map((_, i) => PALETTE[i % PALETTE.length]),
              borderWidth: 0,
            },
          ],
        },
        options: optionsGraphique(widget, {
          legende: true,
          racine: { cutout: '55%' },
        }),
      };
    } else if (widget.type === 'pareto') {
      config = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: series[0]?.label || 'Valeur',
              data: points.map((p) => p.values.m0),
              backgroundColor: couleur,
              borderRadius: 4,
              order: 2,
            },
            {
              type: 'line',
              label: 'Cumul',
              data: points.map((p) => Math.round((p.cumulative || 0) * 1000) / 10),
              borderColor: PALETTE[2],
              backgroundColor: PALETTE[2],
              borderWidth: 3,
              pointRadius: 3,
              yAxisID: 'y2',
              order: 1,
            },
          ],
        },
        options: optionsGraphique(widget, {
          legende: false,
          scales: {
            x: { ticks: { color: doux, font: { size: police } }, grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: { color: doux, font: { size: police }, callback: graduation },
              grid: { color: grille },
            },
            y2: {
              position: 'right',
              min: 0,
              max: 100,
              ticks: { color: PALETTE[2], font: { size: police }, callback: (v) => `${v} %` },
              grid: { display: false },
            },
          },
        }),
      };
    } else {
      const horizontal = widget.type === 'bar' && widget.horizontal;
      config = {
        type: widget.type === 'line' ? 'line' : 'bar',
        data: {
          labels,
          datasets: series.map((s, i) => ({
            label: s.label,
            data: points.map((p) => p.values[s.key]),
            backgroundColor: series.length > 1 ? PALETTE[i % PALETTE.length] : couleur,
            borderColor: series.length > 1 ? PALETTE[i % PALETTE.length] : couleur,
            borderWidth: widget.type === 'line' ? 3 : 0,
            borderRadius: widget.type === 'line' ? 0 : 4,
            tension: 0.25,
            pointRadius: widget.type === 'line' ? 3 : 0,
            fill: false,
          })),
        },
        options: optionsGraphique(widget, {
          legende: series.length > 1,
          racine: { indexAxis: horizontal ? 'y' : 'x' },
          scales: {
            x: {
              stacked: !!widget.stacked,
              ticks: { color: doux, font: { size: police }, autoSkip: true, maxRotation: 40 },
              grid: { display: false },
            },
            y: {
              stacked: !!widget.stacked,
              beginAtZero: true,
              ticks: { color: doux, font: { size: police }, callback: graduation },
              grid: { color: grille },
            },
          },
        }),
      };
    }

    charts.push(new window.Chart(canvas, config));
  });

  return zone;
}

function rendreTableau(widget) {
  const enveloppe = el('div', 'table-defilante');
  const table = el('table');
  const thead = el('thead');
  const trh = el('tr');
  for (const col of widget.columns || []) trh.append(el('th', null, col.label));
  thead.append(trh);

  const tbody = el('tbody');
  for (const ligne of widget.rows || []) {
    const tr = el('tr');
    (widget.columns || []).forEach((col, i) => {
      const valeur = ligne[i];
      const td = el('td', estNombre(valeur) ? 'nombre' : null, valeurCellule(valeur, col.type));
      tr.append(td);
    });
    tbody.append(tr);
  }

  table.append(thead, tbody);
  enveloppe.append(table);
  return enveloppe;
}

function rendreHorloge(widget) {
  const bloc = el('div', 'grande-horloge');
  const h = el('div', 'heure');
  const d = el('div', 'date');
  const maj = () => {
    const maintenant = new Date();
    h.textContent = heure(maintenant);
    d.textContent = dateLongue(maintenant);
  };
  maj();
  const id = setInterval(maj, 10000);
  bloc.dataset.interval = String(id);
  bloc.append(h, d);
  return bloc;
}

/** Construit une tuile complete a partir d'un widget deja resolu par le serveur. */
export function rendreWidget(widget, charts) {
  const avecEtat = widget.type === 'kpi' || widget.type === 'gauge';
  const tuile = el('div', `tuile ${avecEtat ? 'avec-etat ' + couleurEtat(widget.status) : ''}`.trim());

  if (widget.title) tuile.append(el('div', 'tuile-titre', widget.title));

  const contenu = el('div', 'tuile-contenu');

  if (widget.error) {
    contenu.append(el('div', 'tuile-erreur', `⚠ ${widget.error}`));
  } else {
    switch (widget.type) {
      case 'kpi':
        contenu.append(rendreKpi(widget));
        break;
      case 'gauge':
        contenu.append(rendreJauge(widget));
        break;
      case 'bar':
      case 'line':
      case 'pie':
      case 'pareto':
        contenu.append(rendreGraphique(widget, charts));
        break;
      case 'table':
        contenu.append(rendreTableau(widget));
        break;
      case 'clock':
        contenu.append(rendreHorloge(widget));
        break;
      case 'text':
        contenu.append(el('div', 'texte-libre', widget.text || ''));
        break;
      default:
        contenu.append(el('div', 'tuile-erreur', `Type de tuile inconnu : ${widget.type}`));
    }
  }

  tuile.append(contenu);
  return tuile;
}

/**
 * Construit la grille d'une vue.
 * @returns {{element: HTMLElement, charts: Array, liberer: Function}}
 */
export function rendreVue(view) {
  const grille = el('div', 'grille');
  const widgets = view.widgets || [];
  const { places, lignes } = placer(widgets);
  grille.style.gridTemplateRows = `repeat(${lignes}, minmax(0, 1fr))`;

  const charts = [];
  for (const p of places) {
    const tuile = rendreWidget(p.widget, charts);
    tuile.style.gridColumn = `${p.col + 1} / span ${p.w}`;
    tuile.style.gridRow = `${p.row + 1} / span ${p.h}`;
    grille.append(tuile);
  }

  if (!widgets.length) {
    grille.append(el('div', 'tuile-erreur', 'Cette vue ne contient aucune tuile.'));
  }

  // Les valeurs en tres gros caractere sont recalibrees des que la grille est
  // dimensionnee, puis a chaque redimensionnement de l'ecran.
  const aAjuster = grille.querySelectorAll('.kpi-valeur, .grande-horloge .heure');
  const observateur = new ResizeObserver(() => {
    for (const noeud of aAjuster) ajusterAuConteneur(noeud);
  });
  observateur.observe(grille);

  const liberer = () => {
    observateur.disconnect();
    for (const c of charts) c.destroy();
    charts.length = 0;
    for (const node of grille.querySelectorAll('[data-interval]')) {
      clearInterval(Number(node.dataset.interval));
    }
  };

  return { element: grille, charts, liberer };
}
