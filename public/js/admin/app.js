// Point d'entree de l'administration : authentification, navigation, chargement
// des donnees partagees entre les differentes rubriques.

import { api } from './api.js';
import { h, vider, champ, saisie, notifier, erreur } from './ui.js';
import { pageTableauDeBord } from './pages/tableau-de-bord.js';
import { pageSources } from './pages/sources.js';
import { pageDatasets } from './pages/datasets.js';
import { pageIndicateurs } from './pages/indicateurs.js';
import { pageVues } from './pages/vues.js';
import { pageEcrans } from './pages/ecrans.js';
import { pageJournal } from './pages/journal.js';
import { pageParametres } from './pages/parametres.js';

const racine = document.getElementById('racine');

export const etat = {
  meta: { aggregations: {}, filterOps: {}, sourceRoot: '' },
  sources: [],
  datasets: [],
  indicateurs: [],
  vues: [],
  ecrans: [],
};

const PAGES = [
  { cle: 'tableau-de-bord', libelle: 'Tableau de bord', icone: '▦', rendre: pageTableauDeBord },
  { cle: 'sources', libelle: 'Sources Excel', icone: '📁', rendre: pageSources, compteur: () => etat.sources.length },
  { cle: 'jeux-de-donnees', libelle: 'Jeux de donnees', icone: '▤', rendre: pageDatasets, compteur: () => etat.datasets.length },
  { cle: 'indicateurs', libelle: 'Indicateurs', icone: '◎', rendre: pageIndicateurs, compteur: () => etat.indicateurs.length },
  { cle: 'vues', libelle: 'Vues', icone: '▣', rendre: pageVues, compteur: () => etat.vues.length },
  { cle: 'ecrans', libelle: 'Ecrans', icone: '🖵', rendre: pageEcrans, compteur: () => etat.ecrans.length },
  { cle: 'journal', libelle: "Journal d'import", icone: '≡', rendre: pageJournal },
  { cle: 'parametres', libelle: 'Parametres', icone: '⚙', rendre: pageParametres },
];

let pageCourante = null;
let nettoyagePage = null;

// --- Chargement des donnees partagees --------------------------------------

export async function chargerEtat() {
  const [meta, sources, datasets, indicateurs, vues, ecrans] = await Promise.all([
    api.meta(),
    api.sources(),
    api.datasets(),
    api.indicateurs(),
    api.vues(),
    api.ecrans(),
  ]);
  Object.assign(etat, { meta, sources, datasets, indicateurs, vues, ecrans });
}

/** Recharge les donnees puis redessine la rubrique affichee. */
export async function rafraichir() {
  await chargerEtat();
  await afficherPage(pageCourante, { silencieux: true });
}

// --- Navigation -------------------------------------------------------------

function cleDepuisUrl() {
  const cle = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.cle === cle) ? cle : PAGES[0].cle;
}

export function naviguer(cle) {
  window.location.hash = `#/${cle}`;
}

async function afficherPage(cle, { silencieux = false } = {}) {
  const page = PAGES.find((p) => p.cle === cle) || PAGES[0];
  pageCourante = page.cle;

  for (const bouton of document.querySelectorAll('.onglet')) {
    bouton.classList.toggle('actif', bouton.dataset.cle === page.cle);
  }
  majCompteurs();

  const conteneur = document.getElementById('contenu');
  if (!conteneur) return;

  if (nettoyagePage) {
    nettoyagePage();
    nettoyagePage = null;
  }

  if (!silencieux) conteneur.style.opacity = '0.5';
  try {
    const resultat = await page.rendre({ etat, rafraichir, naviguer });
    vider(conteneur).append(resultat.element ?? resultat);
    if (resultat.nettoyer) nettoyagePage = resultat.nettoyer;
    if (!silencieux) window.scrollTo(0, 0);
  } catch (e) {
    vider(conteneur).append(h('div', { class: 'carte' }, h('p', { class: 'vide', text: e.message })));
  } finally {
    conteneur.style.opacity = '1';
  }
}

function majCompteurs() {
  for (const page of PAGES) {
    const el = document.querySelector(`.onglet[data-cle="${page.cle}"] .compteur`);
    if (el) el.textContent = page.compteur ? String(page.compteur()) : '';
  }
}

// --- Coquille de l'application ---------------------------------------------

function construireCoquille(titreSite) {
  document.body.classList.add('admin');
  vider(racine);

  const barre = h(
    'nav',
    { class: 'barre-laterale' },
    h('div', { class: 'marque' }, titreSite || 'Indicateurs', h('small', { text: 'Administration' })),
    PAGES.map((page) =>
      h(
        'button',
        {
          class: 'onglet',
          dataset: { cle: page.cle },
          onClick: () => naviguer(page.cle),
        },
        h('span', { text: page.icone }),
        h('span', { text: page.libelle }),
        h('span', { class: 'compteur' }),
      ),
    ),
    h(
      'div',
      { class: 'pied-laterale' },
      h('a', { href: '/', target: '_blank' }, "Page d'accueil ↗"),
      h('br'),
      h(
        'button',
        {
          class: 'discret',
          style: { paddingLeft: 0 },
          onClick: async () => {
            await api.deconnexion();
            window.location.reload();
          },
        },
        'Se deconnecter',
      ),
    ),
  );

  racine.append(barre, h('main', { class: 'contenu', id: 'contenu' }));
}

// --- Connexion --------------------------------------------------------------

function pageConnexion() {
  document.body.classList.remove('admin');
  vider(racine);

  const motDePasse = saisie('', { type: 'password', name: 'password', autofocus: true });
  const message = h('p', { class: 'aide', style: { color: 'var(--alerte)' } });

  const formulaire = h(
    'form',
    {
      onSubmit: async (e) => {
        e.preventDefault();
        try {
          await api.connexion(motDePasse.value);
          await demarrer();
        } catch (err) {
          message.textContent = err.message;
          motDePasse.select();
        }
      },
    },
    champ('Mot de passe administrateur', motDePasse),
    message,
    h('button', { class: 'principal', type: 'submit', style: { width: '100%', justifyContent: 'center' } }, 'Se connecter'),
  );

  racine.append(
    h(
      'div',
      { class: 'page-connexion' },
      h(
        'div',
        { class: 'carte' },
        h('h2', { text: 'Administration des indicateurs' }),
        h('p', { class: 'aide', style: { marginBottom: '1.2rem' } }, "L'affichage sur les ecrans reste accessible sans mot de passe."),
        formulaire,
      ),
    ),
  );
}

// --- Demarrage --------------------------------------------------------------

async function demarrer() {
  const session = await api.session();
  if (!session.authenticated) return pageConnexion();

  await chargerEtat();
  const parametres = await api.parametres().catch(() => ({}));
  construireCoquille(parametres.site_title);

  window.addEventListener('hashchange', () => afficherPage(cleDepuisUrl()));
  await afficherPage(cleDepuisUrl());

  if (session.passwordIsDefault) {
    notifier(
      "Le mot de passe administrateur est encore celui d'origine. Changez-le dans « Parametres ».",
      'vigilance',
    );
  }
}

window.addEventListener('session-expiree', () => {
  pageConnexion();
});

demarrer().catch((e) => {
  erreur(e);
  racine.append(h('div', { class: 'carte' }, h('p', { text: e.message })));
});
