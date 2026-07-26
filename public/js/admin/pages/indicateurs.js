import { api } from '../api.js';
import { h, champ, saisie, selection, modale, confirmer, notifier, erreur, tableau, vider } from '../ui.js';
import { constructeurRequete } from '../requete.js';
import { nombre } from '../../format.js';

const DIRECTIONS = [
  ['higher_better', 'Plus la valeur est haute, mieux c\'est'],
  ['lower_better', 'Plus la valeur est basse, mieux c\'est'],
];

function ouvrirIndicateur(indicateur, contexte) {
  const { etat, rafraichir } = contexte;
  const estNouveau = !indicateur.id;

  const valeurs = {
    name: indicateur.name || '',
    unit: indicateur.unit || '',
    decimals: indicateur.decimals ?? 0,
    target: indicateur.target ?? '',
    direction: indicateur.direction || 'higher_better',
    warn_at: indicateur.warn_at ?? '',
    alert_at: indicateur.alert_at ?? '',
  };

  const zoneResultat = h('div', { class: 'carte', style: { marginBottom: 0 } });

  let constructeur;
  let minuterie = null;

  async function testerRequete() {
    clearTimeout(minuterie);
    minuterie = setTimeout(async () => {
      const q = constructeur.lire();
      if (!q.dataset) {
        vider(zoneResultat).append(h('p', { class: 'aide', text: 'Choisissez un jeu de donnees.' }));
        return;
      }
      try {
        const r = await api.requeter(q);
        const valeur = r.total?.m0;
        vider(zoneResultat).append(
          h('div', { style: { fontSize: '2rem', fontWeight: '700' } },
            `${nombre(valeur, Number(valeurs.decimals) || 0)}${valeurs.unit ? ' ' + valeurs.unit : ''}`),
          h('p', { class: 'aide', text: `calcule sur ${nombre(r.rowCount)} ligne(s) retenues parmi ${nombre(r.sourceRowCount)}` }),
        );
      } catch (e) {
        vider(zoneResultat).append(h('p', { class: 'aide', style: { color: 'var(--alerte)' }, text: e.message }));
      }
    }, 250);
  }

  constructeur = constructeurRequete({
    query: indicateur.query || {},
    datasets: etat.datasets,
    meta: etat.meta,
    options: { metriques: 'unique', groupe: false },
    onChange: testerRequete,
  });

  const corps = h(
    'div',
    {},
    champ('Nom de l\'indicateur', saisie(valeurs.name, {
      placeholder: 'Taux de rebut',
      onInput: (e) => (valeurs.name = e.target.value),
    })),
    h('div', { class: 'sous-titre', text: 'Donnees' }),
    constructeur.element,
    h('div', { class: 'sous-titre', text: 'Resultat actuel' }),
    zoneResultat,
    h('div', { class: 'sous-titre', text: 'Presentation et seuils' }),
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Unite', saisie(valeurs.unit, { placeholder: '%, pieces, h…', onInput: (e) => { valeurs.unit = e.target.value; testerRequete(); } })),
      champ('Decimales', saisie(valeurs.decimals, { type: 'number', min: 0, max: 4, onInput: (e) => { valeurs.decimals = e.target.value; testerRequete(); } })),
      champ('Objectif', saisie(valeurs.target, { type: 'number', step: 'any', placeholder: 'aucun', onInput: (e) => (valeurs.target = e.target.value) })),
    ),
    champ('Sens de lecture', selection(valeurs.direction, DIRECTIONS, { onChange: (e) => (valeurs.direction = e.target.value) })),
    h(
      'div',
      { class: 'ligne-champs' },
      champ('Seuil orange', saisie(valeurs.warn_at, { type: 'number', step: 'any', placeholder: 'aucun', onInput: (e) => (valeurs.warn_at = e.target.value) }),
        'En-deca (ou au-dela) de cette valeur, la tuile passe en orange.'),
      champ('Seuil rouge', saisie(valeurs.alert_at, { type: 'number', step: 'any', placeholder: 'aucun', onInput: (e) => (valeurs.alert_at = e.target.value) })),
    ),
  );

  testerRequete();

  const enregistrer = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (!valeurs.name.trim()) return notifier('Le nom est obligatoire.', 'vigilance');
        const query = constructeur.lire();
        if (!query.dataset) return notifier('Choisissez un jeu de donnees.', 'vigilance');
        const corpsRequete = { ...valeurs, query, dataset_id: query.dataset };
        try {
          if (estNouveau) await api.creerIndicateur(corpsRequete);
          else await api.majIndicateur(indicateur.id, corpsRequete);
          notifier('Indicateur enregistre.');
          boite.fermer();
          await rafraichir();
        } catch (e) {
          erreur(e);
        }
      },
    },
    estNouveau ? 'Creer l\'indicateur' : 'Enregistrer',
  );

  const boite = modale({
    titre: estNouveau ? 'Nouvel indicateur' : `Indicateur « ${indicateur.name} »`,
    corps,
    large: true,
    actions: [h('button', { onClick: () => boite.fermer() }, 'Annuler'), enregistrer],
  });
}

export async function pageIndicateurs(contexte) {
  const { etat, rafraichir } = contexte;

  const lignes = etat.indicateurs.map((i) => {
    const courant = i.current || {};
    return [
      h(
        'div',
        {},
        h('div', { class: 'principal-cellule', text: i.name }),
        h('div', { class: 'secondaire mono', text: i.key }),
      ),
      h('span', { text: i.dataset_name || '—' }),
      h(
        'div',
        { class: `etat-${courant.status || 'neutre'}` },
        h('span', { class: 'pastille' }),
        h('strong', {
          text: courant.error
            ? '—'
            : `${nombre(courant.value, i.decimals)}${i.unit ? ' ' + i.unit : ''}`,
        }),
      ),
      h('span', { text: i.target === null || i.target === undefined ? '—' : `${nombre(i.target, i.decimals)} ${i.unit}` }),
      h('span', { class: 'secondaire', text: courant.error || `${nombre(courant.rowCount)} lignes` }),
      h(
        'td',
        { class: 'actions' },
        h('button', { class: 'discret', onClick: () => ouvrirIndicateur(i, contexte) }, 'Modifier'),
        h(
          'button',
          {
            class: 'discret danger',
            onClick: async () => {
              if (await confirmer(`Supprimer l'indicateur « ${i.name} » ? Les tuiles qui l'utilisent afficheront une erreur.`)) {
                await api.supprimerIndicateur(i.id);
                notifier('Indicateur supprime.');
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
        h('h1', { text: 'Indicateurs' }),
        h('p', {
          text: "Un indicateur est un calcul nomme (somme, moyenne, comptage…) assorti d'un objectif et de seuils de couleur. Enregistrez ici les valeurs que vous reutiliserez sur plusieurs ecrans.",
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'principal',
          onClick: () => {
            if (!etat.datasets.length) return notifier('Creez d\'abord un jeu de donnees.', 'vigilance');
            ouvrirIndicateur({}, contexte);
          },
        }, '+ Nouvel indicateur'),
      ),
    ),
    h(
      'div',
      { class: 'carte' },
      etat.indicateurs.length
        ? tableau(['Indicateur', 'Jeu de donnees', 'Valeur actuelle', 'Objectif', 'Detail', ''], lignes)
        : h('div', { class: 'vide', text: 'Aucun indicateur enregistre.' }),
    ),
  );
}
