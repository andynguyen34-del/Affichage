import { db } from '../db.js';
import { runQuery, runRawQuery } from './query.js';

/**
 * Determine l'etat (vert / orange / rouge) d'une valeur par rapport a ses seuils.
 * `direction` indique si une valeur haute est bonne (production) ou mauvaise (rebuts).
 */
export function statusOf(value, { direction = 'higher_better', warn_at, alert_at } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'neutre';
  const v = Number(value);
  const warn = warn_at === null || warn_at === undefined || warn_at === '' ? null : Number(warn_at);
  const alert =
    alert_at === null || alert_at === undefined || alert_at === '' ? null : Number(alert_at);
  if (warn === null && alert === null) return 'neutre';

  if (direction === 'lower_better') {
    if (alert !== null && v >= alert) return 'alerte';
    if (warn !== null && v >= warn) return 'vigilance';
    return 'bon';
  }
  if (alert !== null && v <= alert) return 'alerte';
  if (warn !== null && v <= warn) return 'vigilance';
  return 'bon';
}

function indicatorById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM indicators WHERE id = ?').get(Number(id)) || null;
}

/** Calcule la valeur d'un indicateur enregistre. */
export function evaluateIndicator(indicator) {
  const query = JSON.parse(indicator.query || '{}');
  if (!query.dataset) query.dataset = indicator.dataset_id;
  const result = runQuery({ ...query, groupBy: null });
  const value = result.total?.m0 ?? null;
  return {
    id: indicator.id,
    key: indicator.key,
    name: indicator.name,
    value,
    unit: indicator.unit,
    decimals: indicator.decimals,
    target: indicator.target,
    direction: indicator.direction,
    status: statusOf(value, indicator),
    rowCount: result.rowCount,
    lastImportAt: result.lastImportAt,
    error: result.error || null,
  };
}

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'pareto']);

/** Attache a un widget les donnees necessaires a son affichage. */
export function resolveWidget(widget) {
  const out = { ...widget };
  try {
    if (widget.type === 'kpi' || widget.type === 'gauge') {
      if (widget.indicator) {
        const indicator = indicatorById(widget.indicator);
        if (!indicator) throw new Error('Indicateur introuvable');
        const evaluated = evaluateIndicator(indicator);
        out.title = widget.title || indicator.name;
        out.value = evaluated.value;
        out.unit = widget.unit ?? indicator.unit;
        out.decimals = widget.decimals ?? indicator.decimals;
        out.target = widget.target ?? indicator.target;
        out.direction = widget.direction || indicator.direction;
        out.status = statusOf(out.value, {
          direction: out.direction,
          warn_at: widget.warn_at ?? indicator.warn_at,
          alert_at: widget.alert_at ?? indicator.alert_at,
        });
        out.lastImportAt = evaluated.lastImportAt;
        out.error = evaluated.error;
      } else {
        const result = runQuery({ ...(widget.query || {}), groupBy: null });
        out.value = result.total?.m0 ?? null;
        out.status = statusOf(out.value, widget);
        out.lastImportAt = result.lastImportAt;
        out.error = result.error || null;
      }
      return out;
    }

    if (CHART_TYPES.has(widget.type)) {
      const query = { ...(widget.query || {}) };
      if (widget.type === 'pareto') {
        query.cumulative = true;
        query.sort = { by: 'value', dir: 'desc' };
      }
      const result = runQuery(query);
      out.series = result.metrics;
      out.points = result.rows;
      out.total = result.total;
      out.lastImportAt = result.lastImportAt;
      out.error = result.error || null;
      return out;
    }

    if (widget.type === 'table') {
      const result = runRawQuery(widget.query || {});
      out.columns = result.columns;
      out.rows = result.rows;
      out.rowCount = result.rowCount;
      out.lastImportAt = result.lastImportAt;
      out.error = result.error || null;
      return out;
    }

    // texte, horloge, image : rien a calculer
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

export function resolveView(view) {
  const widgets = JSON.parse(view.widgets || '[]');
  return {
    id: view.id,
    key: view.key,
    name: view.name,
    theme: view.theme,
    widgets: widgets.map(resolveWidget),
  };
}

/** Construit la charge utile complete envoyee a un ecran. */
export function buildScreenPayload(screen) {
  const playlist = JSON.parse(screen.playlist || '[]');
  const slides = [];

  for (const item of playlist) {
    const view = db.prepare('SELECT * FROM views WHERE id = ? AND enabled = 1').get(item.view_id);
    if (!view) continue;
    slides.push({
      seconds: Math.max(3, Number(item.seconds) || 20),
      view: resolveView(view),
    });
  }

  return {
    screen: {
      key: screen.key,
      name: screen.name,
      location: screen.location,
      refreshSeconds: Math.max(5, Number(screen.refresh_seconds) || 30),
    },
    slides,
    generatedAt: new Date().toISOString(),
  };
}
