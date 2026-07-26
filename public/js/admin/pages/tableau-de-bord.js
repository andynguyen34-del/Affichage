import { api } from '../api.js';
import { h, notifier, erreur, tableau } from '../ui.js';
import { horodatage, depuis, nombre } from '../../format.js';

function stat(valeur, libelle, etat = 'neutre') {
  return h(
    'div',
    { class: `stat etat-${etat}` },
    h('div', { class: 'valeur', text: String(valeur) }),
    h('div', { class: 'libelle', text: libelle }),
  );
}

export async function pageTableauDeBord({ etat, rafraichir, naviguer }) {
  const journal = await api.journal(20).catch(() => []);

  const enErreur = etat.sources.filter((s) => s.last_status === 'erreur');
  const lignesTotal = etat.datasets.reduce((a, d) => a + (d.row_count || 0), 0);

  const boutonTout = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        boutonTout.disabled = true;
        boutonTout.textContent = 'Import en cours…';
        try {
          const r = await api.toutRafraichir();
          const echecs = r.results.filter((x) => !x.ok);
          if (echecs.length) notifier(`${echecs.length} source(s) en erreur, voir le journal.`, 'vigilance');
          else notifier('Toutes les sources ont ete reimportees.');
          await rafraichir();
        } catch (e) {
          erreur(e);
          boutonTout.disabled = false;
          boutonTout.textContent = 'Tout reimporter';
        }
      },
    },
    'Tout reimporter',
  );

  const lignesSources = etat.sources.map((s) => [
    h(
      'div',
      {},
      h('div', { class: 'principal-cellule', text: s.name }),
      h('div', { class: 'secondaire mono', text: `${s.folder || '/'} · ${s.pattern}` }),
    ),
    h('span', { class: `badge ${s.last_status || ''}`, text: s.last_status || 'jamais importe' }),
    h(
      'div',
      {},
      h('div', { text: s.last_file || '—' }),
      h('div', { class: 'secondaire', text: s.last_run_at ? depuis(s.last_run_at) : '—' }),
    ),
    h('div', { class: 'secondaire', text: s.last_message || '' }),
  ]);

  const lignesEcrans = etat.ecrans.map((e) => [
    h(
      'div',
      {},
      h('div', { class: 'principal-cellule', text: e.name }),
      h('div', { class: 'secondaire mono', text: `/ecran/${e.key}` }),
    ),
    h('span', { text: e.location || '—' }),
    h('span', { text: `${e.playlist.length} vue(s)` }),
    e.last_seen_at
      ? h(
          'span',
          { class: 'badge ok' },
          `vu ${depuis(e.last_seen_at)}${e.last_ip ? ` · ${e.last_ip}` : ''}`,
        )
      : h('span', { class: 'badge', text: 'jamais connecte' }),
  ]);

  const lignesJournal = journal.slice(0, 8).map((j) => [
    h('span', { class: `badge ${j.status}`, text: j.status }),
    h('span', { text: j.label || '—' }),
    h('span', { class: 'secondaire', text: horodatage(j.started_at) }),
    h('span', { class: 'secondaire', text: j.message || (j.row_count !== null ? `${nombre(j.row_count)} lignes` : '') }),
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
        h('h1', { text: 'Tableau de bord' }),
        h('p', {
          text: "Etat de la collecte des fichiers Excel et des ecrans de l'usine.",
        }),
      ),
      h('div', { class: 'actions' }, boutonTout),
    ),

    h(
      'div',
      { class: 'grille-stats' },
      stat(etat.sources.length, 'sources Excel', enErreur.length ? 'alerte' : 'bon'),
      stat(etat.datasets.length, 'jeux de donnees'),
      stat(nombre(lignesTotal), 'lignes collectees'),
      stat(etat.indicateurs.length, 'indicateurs'),
      stat(etat.ecrans.length, 'ecrans'),
    ),

    enErreur.length
      ? h(
          'div',
          { class: 'carte etat-alerte', style: { borderLeft: '4px solid var(--alerte)' } },
          h('h2', { text: `${enErreur.length} source(s) en erreur` }),
          h('ul', {}, enErreur.map((s) => h('li', { text: `${s.name} — ${s.last_message || 'erreur inconnue'}` }))),
        )
      : null,

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Sources Excel' }),
      etat.sources.length
        ? tableau(['Source', 'Etat', 'Dernier fichier', 'Detail'], lignesSources)
        : h(
            'div',
            { class: 'vide' },
            'Aucune source configuree. ',
            h('button', { class: 'discret', onClick: () => naviguer('sources') }, 'Ajouter une source Excel →'),
          ),
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Ecrans' }),
      etat.ecrans.length
        ? tableau(['Ecran', 'Emplacement', 'Diaporama', 'Derniere connexion'], lignesEcrans)
        : h(
            'div',
            { class: 'vide' },
            'Aucun ecran configure. ',
            h('button', { class: 'discret', onClick: () => naviguer('ecrans') }, 'Creer un ecran →'),
          ),
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Derniers imports' }),
      lignesJournal.length
        ? tableau(['Etat', 'Element', 'Date', 'Detail'], lignesJournal)
        : h('div', { class: 'vide', text: 'Aucun import enregistre pour le moment.' }),
    ),
  );
}
