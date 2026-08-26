// Point d'entrée : navigation, exercice courant, rafraîchissement automatique.

import * as etat from './etat.js';
import * as api from './api.js';
import { h, vider, notifier, signalerErreur, bouton, confirmer } from './ui.js';
import * as fiscal from './calculs/fiscal.js';

import tableauDeBord from './pages/tableau-de-bord.js';
import bien from './pages/bien.js';
import pageLoyers from './pages/loyers.js';
import charges from './pages/charges.js';
import factures, { routineIntegration } from './pages/factures.js';
import pageAmortissements from './pages/amortissements.js';
import emprunt from './pages/emprunt.js';
import resultat from './pages/resultat.js';
import liasse from './pages/liasse.js';
import documents from './pages/documents.js';
import parametres from './pages/parametres.js';
import aide from './pages/aide.js';

const PAGES = [tableauDeBord, bien, pageLoyers, factures, charges, pageAmortissements,
  emprunt, resultat, liasse, documents, parametres, aide];

const contexte = {
  annee: new Date().getFullYear(),
  page: 'tableau-de-bord',
  allerA(cle, options = {}) {
    contexte.page = cle;
    if (options.annee) contexte.annee = options.annee;
    location.hash = cle;
    dessiner();
  },
  definirAnnee(annee) {
    contexte.annee = Number(annee);
    dessinerSelecteurAnnee();
    dessiner();
  },
};

// ------------------------------------------------------------------ rendu

function dessinerNavigation() {
  const navigation = vider(document.getElementById('navigation'));
  for (const page of PAGES) {
    const compteur = page.compteur ? page.compteur(contexte) : null;
    navigation.append(h('button', {
      class: page.cle === contexte.page ? 'actif' : '',
      type: 'button',
      onclick: () => contexte.allerA(page.cle),
    }, [
      h('span', { class: 'icone', texte: page.icone }),
      h('span', { texte: page.libelle }),
      compteur ? h('span', { class: 'compteur', texte: String(compteur) }) : null,
    ]));
  }
}

function dessinerSelecteurAnnee() {
  const selecteur = vider(document.getElementById('selecteur-annee'));
  const donnees = collecte();
  const debut = fiscal.premiereAnnee(donnees);
  const fin = Math.max(new Date().getFullYear() + 1, contexte.annee);
  for (let annee = fin; annee >= debut; annee -= 1) {
    selecteur.append(h('option', { value: annee, selected: annee === contexte.annee }, String(annee)));
  }
  selecteur.onchange = (evenement) => contexte.definirAnnee(evenement.target.value);
}

function dessinerSynchro() {
  const zone = document.getElementById('synchro');
  const valeur = etat.etatSynchro();
  zone.className = `synchro ${valeur === 'ok' ? '' : valeur}`.trim();
  zone.querySelector('.synchro-texte').textContent = {
    ok: 'Dossier à jour', occupe: 'Enregistrement…', erreur: 'Dossier inaccessible',
  }[valeur] || '';
}

function dessinerAlertes() {
  const zone = vider(document.getElementById('alertes'));
  const inattendus = etat.infosServeur()?.fichiersInattendus || [];
  if (inattendus.length) {
    zone.append(h('div', { class: 'alerte alerte-attention' }, [
      h('div', {}, [
        h('strong', { texte: 'Fichiers inattendus dans le dossier Données : ' }),
        inattendus.join(', '),
        h('div', { texte: 'OneDrive crée ce type de copie quand deux postes enregistrent en même temps. '
          + 'Ouvrez-les pour vérifier si une saisie s’y trouve, puis supprimez-les.' }),
      ]),
    ]));
  }
  const parametresActuels = etat.parametres();
  if (!etat.liste('biens').length) {
    zone.append(h('div', { class: 'alerte alerte-info' }, [
      h('div', {}, [
        h('strong', { texte: 'Première utilisation. ' }),
        'Commencez par déclarer le logement dans « Bien & baux », puis ses composants dans « Amortissements ».',
      ]),
      bouton('Déclarer le logement', () => contexte.allerA('bien'), { petit: true }),
    ]));
  } else if (!parametresActuels.bailleurs?.length) {
    zone.append(h('div', { class: 'alerte alerte-info' }, [
      h('div', { texte: 'Renseignez les bailleurs dans « Paramètres » pour pouvoir éditer les quittances.' }),
      bouton('Ouvrir les paramètres', () => contexte.allerA('parametres'), { petit: true }),
    ]));
  }
}

export function collecte() {
  return {
    parametres: etat.parametres(),
    biens: etat.liste('biens'),
    locataires: etat.liste('locataires'),
    baux: etat.liste('baux'),
    loyers: etat.liste('loyers'),
    charges: etat.liste('charges'),
    immobilisations: etat.liste('immobilisations'),
    emprunts: etat.liste('emprunts'),
    exercices: etat.liste('exercices'),
  };
}

function dessiner() {
  const page = PAGES.find((p) => p.cle === contexte.page) || PAGES[0];
  contexte.donnees = collecte();
  document.getElementById('titre-page').textContent = page.titre || page.libelle;
  document.getElementById('sous-titre-page').textContent =
    (typeof page.sousTitre === 'function' ? page.sousTitre(contexte) : page.sousTitre) || '';
  dessinerNavigation();
  dessinerSelecteurAnnee();
  dessinerAlertes();
  dessinerSynchro();
  const conteneur = vider(document.getElementById('contenu'));
  try {
    conteneur.append(page.rendre(contexte));
  } catch (erreur) {
    signalerErreur(erreur);
    conteneur.append(h('div', { class: 'alerte alerte-erreur', texte: `Affichage impossible : ${erreur.message}` }));
  }
  conteneur.scrollTop = 0;
}

// ------------------------------------------------------------- démarrage

function surHachage() {
  const cle = location.hash.replace('#', '');
  if (cle && PAGES.some((p) => p.cle === cle) && cle !== contexte.page) {
    contexte.page = cle;
    dessiner();
  }
}

async function demarrer() {
  try {
    await etat.chargerTout();
  } catch (erreur) {
    const ecran = document.getElementById('chargement');
    ecran.classList.add('erreur');
    ecran.querySelector('.chargement-texte').textContent =
      `${erreur.message} Vérifiez que la fenêtre noire « Gestion LMNP — serveur » est toujours ouverte, puis rechargez la page.`;
    return;
  }

  const infos = etat.infosServeur();
  const zoneDossier = document.getElementById('dossier-actuel');
  zoneDossier.textContent = infos.dossier;
  zoneDossier.title = infos.dossier;

  document.getElementById('bouton-rafraichir').onclick = async () => {
    try {
      const change = await etat.rafraichir();
      notifier(change ? 'Nouvelles données reprises du dossier partagé.' : 'Aucune modification depuis l’autre poste.');
      dessiner();
    } catch (erreur) { signalerErreur(erreur); }
  };

  document.getElementById('bouton-quitter').onclick = async () => {
    const confirme = await confirmer({
      titre: 'Quitter l’application',
      message: 'Le serveur local sera arrêté. Toutes vos saisies sont déjà enregistrées dans le dossier partagé.',
      libelleValider: 'Quitter',
    });
    if (!confirme) return;
    await api.arreter();
    document.body.innerHTML = '<div class="chargement"><div class="chargement-boite">'
      + '<div class="chargement-titre">Gestion LMNP</div>'
      + '<div class="chargement-texte">Application fermée. Vous pouvez fermer cette fenêtre.</div></div></div>';
  };

  const parametresActuels = etat.parametres();
  if (parametresActuels.exerciceParDefaut) contexte.annee = Number(parametresActuels.exerciceParDefaut);

  etat.abonner((raison) => {
    if (raison === 'synchro') { dessinerSynchro(); return; }
    dessiner();
  });

  window.addEventListener('hashchange', surHachage);
  surHachage();

  document.getElementById('chargement').hidden = true;
  document.getElementById('application').hidden = false;
  dessinerSelecteurAnnee();
  dessiner();

  // Routine d'intégration des factures déposées dans le dossier partagé.
  if (parametresActuels.integrationAutomatiqueFactures) {
    try { await routineIntegration(collecte(), { silencieux: true }); }
    catch (erreur) { console.error(erreur); }
  }

  // Reprise automatique des saisies faites sur l'autre poste.
  setInterval(async () => {
    if (!document.getElementById('fond-modale').hidden) return;
    try {
      const change = await etat.rafraichir({ silencieux: true });
      if (change) notifier('Le dossier partagé a été mis à jour.');
    } catch { /* silencieux */ }
  }, 45000);
}

demarrer();
