// Application des ecrans de l'atelier.
//
// Contraintes de terrain prises en compte :
//  - le poste est sans clavier : tout doit demarrer et se recuperer tout seul ;
//  - le wifi de l'usine peut tomber : on continue d'afficher la derniere version
//    connue des donnees en signalant qu'elles ne sont plus fraiches ;
//  - la page tourne des semaines sans etre rechargee : pas de fuite memoire
//    (les graphiques sont detruits a chaque changement de diapositive).

import { rendreVue } from './widgets.js';
import { heure, dateLongue, depuis } from './format.js';

const racine = document.getElementById('racine');

const chemin = window.location.pathname.split('/').filter(Boolean);
const mode = chemin[0] === 'vue' ? 'vue' : 'ecran';
const cle = decodeURIComponent(chemin[1] || '');
const params = new URLSearchParams(window.location.search);
const themeForce = params.get('theme'); // ?theme=clair

const STOCKAGE = `affichage:${mode}:${cle}`;

let charge = null; // derniere charge utile connue
let indexDiapo = 0;
let minuterieDiapo = null;
let minuterieRafraichi = null;
let vueCourante = null; // { liberer }
let debutDiapo = 0;
let dernierSucces = null;
let echecs = 0;

// --- Reseau ----------------------------------------------------------------

async function recuperer() {
  const url = mode === 'vue' ? `/api/display/view/${encodeURIComponent(cle)}` : `/api/display/screen/${encodeURIComponent(cle)}`;
  const reponse = await fetch(url, { cache: 'no-store' });
  if (!reponse.ok) {
    const detail = await reponse.json().catch(() => ({}));
    const erreur = new Error(detail.error || `Erreur HTTP ${reponse.status}`);
    erreur.status = reponse.status;
    throw erreur;
  }
  return reponse.json();
}

function memoriser(donnees) {
  try {
    localStorage.setItem(STOCKAGE, JSON.stringify(donnees));
  } catch {
    /* quota plein ou navigation privee : sans importance */
  }
}

function relire() {
  try {
    const brut = localStorage.getItem(STOCKAGE);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

// --- Rendu -----------------------------------------------------------------

function messagePlein(titre, texte) {
  racine.innerHTML = '';
  const bloc = document.createElement('div');
  bloc.className = 'message-plein';
  const h1 = document.createElement('h1');
  h1.textContent = titre;
  const p = document.createElement('p');
  p.textContent = texte;
  bloc.append(h1, p);
  racine.append(bloc);
}

function construireSquelette() {
  racine.innerHTML = '';
  const ecran = document.createElement('div');
  ecran.className = 'ecran';

  const entete = document.createElement('header');
  entete.className = 'ecran-entete';
  entete.innerHTML = `
    <div>
      <div class="ecran-titre" id="titre"></div>
      <div class="ecran-sous-titre" id="sous-titre"></div>
    </div>
    <div class="droite">
      <span id="date-jour"></span>
      <span class="horloge" id="horloge"></span>
    </div>`;

  const corps = document.createElement('main');
  corps.className = 'ecran-corps';
  corps.id = 'corps';

  const bandeau = document.createElement('footer');
  bandeau.className = 'bandeau';
  bandeau.innerHTML = `
    <span id="fraicheur"></span>
    <span id="connexion" class="alerte-connexion"></span>
    <span class="points" id="points"></span>`;

  ecran.append(entete, corps, bandeau);
  racine.append(ecran);
}

function majHorloge() {
  const h = document.getElementById('horloge');
  const d = document.getElementById('date-jour');
  if (h) h.textContent = heure();
  if (d) d.textContent = dateLongue();
}

function majBandeau() {
  const fraicheur = document.getElementById('fraicheur');
  const connexion = document.getElementById('connexion');
  if (!fraicheur) return;

  const diapo = charge?.slides?.[indexDiapo];
  const imports = (diapo?.view?.widgets || [])
    .map((w) => w.lastImportAt)
    .filter(Boolean)
    .sort();
  const dernier = imports[imports.length - 1];

  fraicheur.textContent = dernier
    ? `Donnees mises a jour ${depuis(dernier)}`
    : 'En attente du premier import';

  if (echecs > 0 && dernierSucces) {
    connexion.textContent = `⚠ Serveur injoignable — affichage fige depuis ${depuis(dernierSucces)}`;
  } else {
    connexion.textContent = '';
  }
}

function majPoints() {
  const points = document.getElementById('points');
  if (!points) return;
  points.innerHTML = '';
  const total = charge?.slides?.length || 0;
  if (total < 2) return;
  for (let i = 0; i < total; i += 1) {
    const s = document.createElement('span');
    if (i === indexDiapo) s.className = 'actif';
    points.append(s);
  }
}

function afficherDiapo(index, { conserverMinuterie = false } = {}) {
  const corps = document.getElementById('corps');
  if (!corps || !charge?.slides?.length) return;

  indexDiapo = ((index % charge.slides.length) + charge.slides.length) % charge.slides.length;
  const diapo = charge.slides[indexDiapo];

  if (vueCourante) vueCourante.liberer();
  corps.innerHTML = '';

  const conteneur = document.createElement('section');
  conteneur.className = 'diapo';
  vueCourante = rendreVue(diapo.view);
  conteneur.append(vueCourante.element);
  corps.append(conteneur);
  requestAnimationFrame(() => conteneur.classList.add('active'));

  document.getElementById('sous-titre').textContent = [charge.screen?.name, diapo.view.name]
    .filter(Boolean)
    .join(' — ');

  document.body.classList.toggle(
    'theme-clair',
    themeForce ? themeForce === 'clair' : diapo.view.theme === 'clair',
  );

  majPoints();
  majBandeau();

  // Un rafraichissement de donnees ne doit pas ecourter ni prolonger le temps
  // de lecture : on conserve le temps deja ecoule sur la diapositive.
  const duree = diapo.seconds * 1000;
  if (!conserverMinuterie) debutDiapo = Date.now();
  const restant = Math.max(1000, duree - (Date.now() - debutDiapo));

  clearTimeout(minuterieDiapo);
  if (charge.slides.length > 1) {
    minuterieDiapo = setTimeout(() => afficherDiapo(indexDiapo + 1), restant);
  }
}

function appliquer(donnees, { redemarrerRotation }) {
  const premiereFois = !charge;
  const memeStructure =
    !premiereFois &&
    charge.slides.length === donnees.slides.length &&
    charge.slides.every((s, i) => s.view.key === donnees.slides[i].view.key);

  charge = donnees;
  if (premiereFois) construireSquelette();
  document.getElementById('titre').textContent = donnees.title || 'Indicateurs';
  document.title = `${donnees.screen?.name || 'Affichage'} — Indicateurs`;
  majHorloge();

  if (premiereFois || redemarrerRotation || !memeStructure) {
    afficherDiapo(premiereFois || !memeStructure ? 0 : indexDiapo);
  } else {
    // Meme enchainement de vues : on redessine avec les donnees fraiches, mais
    // sans relancer le minuteur de la diapositive en cours.
    afficherDiapo(indexDiapo, { conserverMinuterie: true });
  }
}

// --- Boucle principale ------------------------------------------------------

async function rafraichir({ redemarrerRotation = false } = {}) {
  try {
    const donnees = await recuperer();
    echecs = 0;
    dernierSucces = new Date().toISOString();
    memoriser(donnees);

    if (!donnees.slides.length) {
      messagePlein(
        `Ecran « ${cle} »`,
        "Aucune vue n'est encore programmee sur cet ecran. Ajoutez-en depuis l'interface d'administration, rubrique « Ecrans ».",
      );
      charge = null;
      return;
    }
    appliquer(donnees, { redemarrerRotation });
  } catch (err) {
    echecs += 1;
    if (err.status === 404) {
      messagePlein(`Ecran « ${cle} » introuvable`, err.message);
      charge = null;
      return;
    }
    if (!charge) {
      const secours = relire();
      if (secours?.slides?.length) {
        appliquer(secours, { redemarrerRotation: true });
      } else {
        messagePlein(
          'Connexion au serveur impossible',
          `${err.message}. Nouvelle tentative dans quelques secondes.`,
        );
      }
    }
    majBandeau();
  }
}

function demarrer() {
  if (!cle) {
    messagePlein(
      'Adresse incomplete',
      "Utilisez une adresse de la forme http://serveur:8080/ecran/atelier-1 ou /vue/qualite.",
    );
    return;
  }

  rafraichir({ redemarrerRotation: true });

  const periode = () => Math.max(5, charge?.screen?.refreshSeconds || 30) * 1000;
  const programmer = () => {
    clearTimeout(minuterieRafraichi);
    minuterieRafraichi = setTimeout(async () => {
      await rafraichir();
      programmer();
    }, periode());
  };
  programmer();

  setInterval(majHorloge, 15000);
  setInterval(majBandeau, 30000);

  // Rechargement complet quotidien : purge les eventuelles derives d'un
  // navigateur reste ouvert plusieurs semaines.
  setTimeout(() => window.location.reload(), 24 * 3600 * 1000);
}

// Navigation manuelle depuis un clavier ou une telecommande, si besoin.
window.addEventListener('keydown', (e) => {
  if (!charge?.slides?.length) return;
  if (e.key === 'ArrowRight') afficherDiapo(indexDiapo + 1);
  if (e.key === 'ArrowLeft') afficherDiapo(indexDiapo - 1);
  if (e.key === 'r' || e.key === 'R') rafraichir({ redemarrerRotation: true });
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});

let minuterieRedim = null;
window.addEventListener('resize', () => {
  clearTimeout(minuterieRedim);
  minuterieRedim = setTimeout(() => {
    if (charge) afficherDiapo(indexDiapo, { conserverMinuterie: true });
  }, 400);
});

demarrer();
