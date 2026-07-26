import { api } from '../api.js';
import { h, champ, saisie, selection, modale, confirmer, notifier, erreur, tableau, vider } from '../ui.js';
import { depuis } from '../../format.js';

function ouvrirEcran(ecran, contexte) {
  const { etat, rafraichir } = contexte;
  const estNouveau = !ecran.id;

  const modele = {
    name: ecran.name || '',
    key: ecran.key || '',
    location: ecran.location || '',
    refresh_seconds: ecran.refresh_seconds || 30,
    enabled: ecran.enabled === undefined ? true : !!ecran.enabled,
    playlist: JSON.parse(JSON.stringify(ecran.playlist || [])),
  };

  const zonePlaylist = h('div', { class: 'liste-widgets' });

  function dessinerPlaylist() {
    vider(zonePlaylist);
    if (!modele.playlist.length) {
      zonePlaylist.append(h('p', { class: 'aide', text: 'Aucune vue programmee : l\'ecran affichera un message d\'attente.' }));
    }

    modele.playlist.forEach((item, index) => {
      const vue = etat.vues.find((v) => v.id === item.view_id);
      const deplacer = (delta) => {
        const cible = index + delta;
        if (cible < 0 || cible >= modele.playlist.length) return;
        const [x] = modele.playlist.splice(index, 1);
        modele.playlist.splice(cible, 0, x);
        dessinerPlaylist();
      };

      zonePlaylist.append(
        h(
          'div',
          { class: 'puce-widget' },
          h('span', { text: `${index + 1}.`, style: { color: 'var(--texte-doux)' } }),
          h(
            'div',
            { style: { minWidth: 0, flex: '1' } },
            h('div', { class: 'titre', text: vue ? vue.name : `Vue supprimee (#${item.view_id})` }),
            h('div', { class: 'meta', text: vue ? `${vue.widgets.length} tuile(s)` : 'a retirer du diaporama' }),
          ),
          h(
            'div',
            { style: { width: '7rem' } },
            saisie(item.seconds, {
              type: 'number',
              min: 3,
              max: 600,
              onInput: (e) => (item.seconds = Number(e.target.value) || 20),
            }),
          ),
          h('span', { class: 'meta', text: 'sec.' }),
          h(
            'div',
            { class: 'droite' },
            h('button', { class: 'discret', onClick: () => deplacer(-1) }, '↑'),
            h('button', { class: 'discret', onClick: () => deplacer(1) }, '↓'),
            h('button', {
              class: 'discret danger',
              onClick: () => {
                modele.playlist.splice(index, 1);
                dessinerPlaylist();
              },
            }, '✕'),
          ),
        ),
      );
    });
  }

  const selAjout = selection('', [['', '— choisir une vue —'], ...etat.vues.map((v) => [v.id, v.name])]);
  const boutonAjout = h(
    'button',
    {
      onClick: () => {
        const id = Number(selAjout.value);
        if (!id) return;
        modele.playlist.push({ view_id: id, seconds: 20 });
        selAjout.value = '';
        dessinerPlaylist();
      },
    },
    '+ Ajouter au diaporama',
  );

  const corps = h(
    'div',
    {},
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Nom de l\'ecran', saisie(modele.name, { placeholder: 'Atelier assemblage', onInput: (e) => (modele.name = e.target.value) })),
      champ('Emplacement', saisie(modele.location, { placeholder: 'Hall 2, pres du vestiaire', onInput: (e) => (modele.location = e.target.value) })),
    ),
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Adresse (cle)', saisie(modele.key, {
        class: 'mono',
        placeholder: 'genere automatiquement',
        onInput: (e) => (modele.key = e.target.value),
      }), estNouveau ? 'Laisser vide pour la deduire du nom.' : "Attention : modifier la cle change l'adresse de l'ecran."),
      champ('Rafraichissement des donnees (sec.)', saisie(modele.refresh_seconds, {
        type: 'number',
        min: 5,
        max: 3600,
        onInput: (e) => (modele.refresh_seconds = Number(e.target.value) || 30),
      }), "Frequence a laquelle l'ecran redemande les donnees au serveur."),
    ),
    h('div', { class: 'case', style: { marginBottom: '1rem' } },
      h('input', { type: 'checkbox', id: 'ecr-actif', checked: modele.enabled, onChange: (e) => (modele.enabled = e.target.checked) }),
      h('label', { for: 'ecr-actif', text: 'Ecran actif' })),
    h('div', { class: 'sous-titre', text: 'Diaporama' }),
    zonePlaylist,
    h('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.8rem' } }, selAjout, boutonAjout),
    h('p', { class: 'aide', style: { marginTop: '0.8rem' } },
      "Avec une seule vue, l'affichage reste fixe. Avec plusieurs, l'ecran enchaine les vues selon la duree indiquee, en boucle."),
  );

  const enregistrer = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (!modele.name.trim()) return notifier('Le nom est obligatoire.', 'vigilance');
        const charge = { ...modele };
        if (!charge.key) delete charge.key;
        try {
          const resultat = estNouveau ? await api.creerEcran(charge) : await api.majEcran(ecran.id, charge);
          notifier(`Ecran enregistre — adresse : /ecran/${resultat.key}`);
          boite.fermer();
          await rafraichir();
        } catch (e) {
          erreur(e);
        }
      },
    },
    estNouveau ? "Creer l'ecran" : 'Enregistrer',
  );

  dessinerPlaylist();

  const boite = modale({
    titre: estNouveau ? 'Nouvel ecran' : `Ecran « ${ecran.name} »`,
    corps,
    large: true,
    actions: [h('button', { onClick: () => boite.fermer() }, 'Annuler'), enregistrer],
  });
}

export async function pageEcrans(contexte) {
  const { etat, rafraichir } = contexte;
  const base = window.location.origin;

  const lignes = etat.ecrans.map((e) => {
    const url = `${base}/ecran/${e.key}`;
    return [
      h(
        'div',
        {},
        h('div', { class: 'principal-cellule', text: e.name }),
        h('div', { class: 'secondaire', text: e.location || '' }),
      ),
      h(
        'div',
        {},
        h('a', { class: 'mono', href: `/ecran/${e.key}`, target: '_blank', text: `/ecran/${e.key}` }),
        h(
          'button',
          {
            class: 'discret',
            title: "Copier l'adresse complete",
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(url);
                notifier('Adresse copiee dans le presse-papiers.');
              } catch {
                notifier(url, 'vigilance');
              }
            },
          },
          '⧉',
        ),
      ),
      h(
        'div',
        {},
        h('div', { text: `${e.playlist.length} vue(s)` }),
        h('div', {
          class: 'secondaire',
          text: e.playlist.length
            ? `cycle de ${e.playlist.reduce((a, p) => a + (Number(p.seconds) || 20), 0)} sec.`
            : '',
        }),
      ),
      e.last_seen_at
        ? h('span', { class: 'badge ok', text: `vu ${depuis(e.last_seen_at)}` })
        : h('span', { class: 'badge', text: 'jamais connecte' }),
      e.enabled ? h('span', { class: 'badge ok', text: 'actif' }) : h('span', { class: 'badge', text: 'inactif' }),
      h(
        'td',
        { class: 'actions' },
        h('button', { class: 'discret', onClick: () => ouvrirEcran(e, contexte) }, 'Modifier'),
        h(
          'button',
          {
            class: 'discret danger',
            onClick: async () => {
              if (await confirmer(`Supprimer l'ecran « ${e.name} » ? Le poste qui affiche cette adresse verra une page d'erreur.`)) {
                await api.supprimerEcran(e.id);
                notifier('Ecran supprime.');
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
        h('h1', { text: 'Ecrans' }),
        h('p', { text: "Chaque ecran de l'usine correspond a une adresse a ouvrir dans le navigateur du poste, en plein ecran. Il enchaine les vues du diaporama et se met a jour tout seul." }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'principal',
          onClick: () => {
            if (!etat.vues.length) return notifier('Creez d\'abord une vue.', 'vigilance');
            ouvrirEcran({}, contexte);
          },
        }, '+ Nouvel ecran'),
      ),
    ),
    h(
      'div',
      { class: 'carte' },
      etat.ecrans.length
        ? tableau(['Ecran', 'Adresse', 'Diaporama', 'Derniere connexion', 'Etat', ''], lignes)
        : h('div', { class: 'vide', text: 'Aucun ecran. Creez-en un puis ouvrez son adresse sur le poste relie au televiseur.' }),
    ),
    h(
      'div',
      { class: 'carte' },
      h('h2', { text: "Mise en service d'un poste" }),
      h('ol', { style: { lineHeight: '1.8', color: 'var(--texte-doux)' } },
        h('li', { text: 'Relier le mini-PC ou la cle Android au televiseur et au wifi de l\'entreprise.' }),
        h('li', {}, "Ouvrir le navigateur a l'adresse de l'ecran, par exemple ", h('span', { class: 'mono', text: `${base}/ecran/…` }), '.'),
        h('li', { text: 'Passer en plein ecran (touche F11) et desactiver la mise en veille de l\'ecran.' }),
        h('li', { text: 'Configurer le navigateur pour rouvrir cette page au demarrage, afin que l\'affichage reprenne seul apres une coupure.' }),
      ),
      h('p', { class: 'aide' }, 'Ajouter ', h('span', { class: 'mono', text: '?theme=clair' }), " a l'adresse force le theme clair, plus lisible sur un ecran expose au soleil."),
    ),
  );
}
