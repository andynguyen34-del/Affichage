import { api } from '../api.js';
import { h, champ, saisie, notifier, erreur } from '../ui.js';

export async function pageParametres({ etat }) {
  const parametres = await api.parametres();

  const inputTitre = saisie(parametres.site_title || '', { placeholder: "Indicateurs de l'usine" });

  const enregistrerTitre = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        try {
          await api.majParametres({ site_title: inputTitre.value });
          notifier('Parametres enregistres. Rechargez la page pour voir le nouveau titre.');
        } catch (e) {
          erreur(e);
        }
      },
    },
    'Enregistrer',
  );

  const actuel = saisie('', { type: 'password', autocomplete: 'current-password' });
  const nouveau = saisie('', { type: 'password', autocomplete: 'new-password' });
  const confirmation = saisie('', { type: 'password', autocomplete: 'new-password' });

  const changerMotDePasse = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (nouveau.value !== confirmation.value) {
          return notifier('Les deux nouveaux mots de passe different.', 'vigilance');
        }
        try {
          await api.motDePasse(actuel.value, nouveau.value);
          notifier('Mot de passe modifie. Reconnectez-vous.');
          setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
          erreur(e);
        }
      },
    },
    'Changer le mot de passe',
  );

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'entete-page' },
      h('div', {}, h('h1', { text: 'Parametres' })),
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Affichage' }),
      champ('Titre affiche en haut des ecrans', inputTitre),
      enregistrerTitre,
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Mot de passe administrateur' }),
      h('p', { class: 'aide', style: { marginBottom: '1rem' } },
        "Les pages d'affichage restent accessibles sans mot de passe : seul l'acces a cette interface est protege."),
      champ('Mot de passe actuel', actuel),
      champ('Nouveau mot de passe', nouveau, 'Six caracteres minimum.'),
      champ('Confirmer le nouveau mot de passe', confirmation),
      changerMotDePasse,
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Configuration du serveur' }),
      h('table', { class: 'liste' },
        h('tbody', {},
          h('tr', {}, h('td', { text: 'Dossier surveille' }), h('td', { class: 'mono', text: parametres.sourceRoot })),
          h('tr', {}, h('td', { text: 'Fuseau horaire' }), h('td', { text: parametres.timezone })),
          h('tr', {}, h('td', { text: 'Verification des sources' }), h('td', { text: `toutes les ${parametres.schedulerTickSeconds} secondes` })),
          h('tr', {}, h('td', { text: 'Sources / jeux de donnees' }), h('td', { text: `${etat.sources.length} / ${etat.datasets.length}` })),
        ),
      ),
      h('p', { class: 'aide' },
        'Ces valeurs se modifient dans le fichier ',
        h('span', { class: 'mono', text: '.env' }),
        ' puis avec ',
        h('span', { class: 'mono', text: 'docker compose up -d --build' }),
        '.'),
    ),

    h(
      'div',
      { class: 'carte' },
      h('h2', { text: 'Sauvegarde' }),
      h('p', { class: 'aide', style: { marginBottom: '1rem' } },
        "Exporte la configuration complete (sources, jeux de donnees, indicateurs, vues, ecrans) dans un fichier JSON, utile pour conserver une trace avant une modification importante."),
      h('a', { class: 'bouton', href: '/api/admin/export' }, '⬇ Telecharger la configuration'),
    ),
  );
}
