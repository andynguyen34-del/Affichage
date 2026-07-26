import { api } from '../api.js';
import { h, tableau, vider } from '../ui.js';
import { horodatage, nombre } from '../../format.js';

export async function pageJournal() {
  const conteneur = h('div');
  const zone = h('div', { class: 'carte' });
  let minuterie = null;

  async function charger(limite) {
    vider(zone).append(h('p', { class: 'aide', text: 'Chargement…' }));
    const entrees = await api.journal(limite);
    const lignes = entrees.map((j) => [
      h('span', { class: `badge ${j.status}`, text: j.status }),
      h('span', { text: j.label || '—' }),
      h('span', { class: 'secondaire', text: j.file_name || '' }),
      h('span', { class: 'secondaire', text: horodatage(j.started_at) }),
      h('span', { text: j.row_count === null ? '' : nombre(j.row_count) }),
      h('span', { class: 'secondaire', text: j.duration_ms === null ? '' : `${nombre(j.duration_ms)} ms` }),
      h('span', { class: 'secondaire', text: j.message || '' }),
    ]);
    vider(zone).append(
      lignes.length
        ? tableau(['Etat', 'Element', 'Fichier', 'Date', 'Lignes', 'Duree', 'Detail'], lignes)
        : h('div', { class: 'vide', text: 'Aucun import enregistre.' }),
    );
  }

  const selLimite = h('select', { onChange: () => charger(Number(selLimite.value)) });
  for (const n of [50, 100, 250, 500]) {
    selLimite.append(h('option', { value: n, selected: n === 100 }, `${n} dernieres lignes`));
  }

  conteneur.append(
    h(
      'div',
      { class: 'entete-page' },
      h(
        'div',
        {},
        h('h1', { text: "Journal d'import" }),
        h('p', { text: "Historique des lectures de fichiers. C'est ici qu'on voit pourquoi un indicateur n'est plus a jour : fichier introuvable, feuille renommee, colonne disparue." }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('div', { style: { width: '12rem' } }, selLimite),
        h('button', { onClick: () => charger(Number(selLimite.value)) }, '⟳ Actualiser'),
      ),
    ),
    zone,
  );

  charger(100);
  minuterie = setInterval(() => charger(Number(selLimite.value)), 30000);

  return { element: conteneur, nettoyer: () => clearInterval(minuterie) };
}
