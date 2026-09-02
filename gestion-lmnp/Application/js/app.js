// Point d'entrée : navigation, exercice courant, rafraîchissement automatique.

import * as etat from './etat.js';
import * as api from './api.js';
import { h, vider, notifier, signalerErreur, bouton, confirmer, formulaire } from './ui.js';

import pageLoyers from './pages/loyers.js';
import cautions from './pages/cautions.js';
import regularisation from './pages/regularisation.js';
import etatDesLieux from './pages/etat-des-lieux.js';
import bien from './pages/bien.js';
import parametres from './pages/parametres.js';
import aide from './pages/aide.js';
import { rendrePortail } from './pages/portail.js';

// Numéro affiché sur l'écran de connexion, pour vérifier d'un coup d'œil que
// le fichier ouvert est bien la dernière version livrée.
const VERSION_APP = '16 — 2 septembre';

const PAGES = [pageLoyers, cautions, regularisation, etatDesLieux, bien, parametres, aide];

const contexte = {
  annee: new Date().getFullYear(),
  page: 'loyers',
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

/** Première année utile : début du plus ancien bail, ou l'année courante. */
function premiereAnnee(donnees) {
  const dates = [
    ...donnees.baux.map((b) => b.dateDebut),
    ...donnees.loyers.map((l) => (l.annee ? `${l.annee}-01-01` : null)),
  ].filter(Boolean).sort();
  const annee = Number(String(dates[0] || '').slice(0, 4));
  return Number.isFinite(annee) && annee > 2000 ? annee : new Date().getFullYear();
}

function dessinerSelecteurAnnee() {
  const selecteur = vider(document.getElementById('selecteur-annee'));
  const donnees = collecte();
  const debut = premiereAnnee(donnees);
  const fin = Math.max(new Date().getFullYear() + 1, contexte.annee);
  // On recadre l'exercice courant sur l'intervalle proposé : sans quoi une
  // suppression qui fait remonter la première année désynchronise le sélecteur
  // et les pages calculent sur une année sans option.
  contexte.annee = Math.min(fin, Math.max(debut, contexte.annee));
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
        'Commencez par déclarer le logement, les colocataires et le bail dans « Bien & baux ».',
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
    cautions: etat.liste('cautions'),
    etatsDesLieux: etat.liste('etatsDesLieux'),
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

function messageErreurConnexion(erreur) {
  console.error('Connexion au dossier :', erreur);
  const zone = document.getElementById('connexion-erreur');
  zone.hidden = false;
  const nom = erreur?.name || '';
  let texte;
  if (nom === 'AbortError') {
    texte = 'Chrome a refusé ce dossier après votre choix. Réessayez en choisissant d’abord un '
      + 'dossier tout simple (le Bureau, par exemple) : si le refus revient même là, c’est qu’une '
      + 'règle de sécurité de votre ordinateur interdit aux pages locales d’accéder aux fichiers '
      + '— dites-le moi, je changerai de méthode.';
  } else if (/refus/i.test(erreur?.message || '')) {
    texte = 'Juste après votre choix, Chrome demande « Modifier les fichiers ? » : cliquez sur '
      + '« Modifier les fichiers » (surtout pas « Annuler »).';
  } else {
    texte = erreur?.message || String(erreur);
  }
  // Le code technique entre crochets aide au diagnostic si le problème persiste.
  zone.textContent = nom ? `${texte}  [${nom}]` : texte;
}

/** Version en ligne : connexion par e-mail et mot de passe (Firebase). */
async function demarrerNuage() {
  const chargement = document.getElementById('chargement');
  const connexion = document.getElementById('connexion');
  const message = document.getElementById('connexion-message');
  const formulaireConnexion = document.getElementById('connexion-formulaire');
  const erreur = document.getElementById('connexion-erreur');

  document.getElementById('bouton-connexion').hidden = true;
  document.getElementById('bouton-connexion-autre').hidden = true;
  document.getElementById('connexion-version').textContent = `Version ${VERSION_APP}`;

  try {
    await api.initialiser();
  } catch (e) {
    chargement.hidden = true;
    connexion.hidden = false;
    message.textContent = e.message;
    return;
  }

  // Déjà connecté (session mémorisée) : on entre directement.
  if (await api.attendreConnexion()) { await entrerSelonRole(); return; }

  chargement.hidden = true;
  connexion.hidden = false;
  formulaireConnexion.hidden = false;
  message.innerHTML = 'Connectez-vous avec votre adresse e-mail et votre mot de passe.';

  formulaireConnexion.onsubmit = async (evenement) => {
    evenement.preventDefault();
    erreur.hidden = true;
    const boutonEnvoi = formulaireConnexion.querySelector('button');
    boutonEnvoi.disabled = true;
    try {
      await api.seConnecter(
        document.getElementById('connexion-email').value,
        document.getElementById('connexion-mdp').value,
      );
      formulaireConnexion.hidden = true;
      await entrerSelonRole();
    } catch (e) {
      erreur.hidden = false;
      erreur.textContent = e.message;
    } finally { boutonEnvoi.disabled = false; }
  };
}

/**
 * Après connexion : gérant (Andy, Karine) → application complète ;
 * colocataire → portail de consultation de ses documents.
 */
async function entrerSelonRole() {
  const role = await api.detecterRole();
  if (role === 'colocataire') {
    document.getElementById('connexion').hidden = true;
    document.getElementById('chargement').hidden = true;
    await rendrePortail({
      seDeconnecter: async () => { await api.seDeconnecter(); location.reload(); },
    });
    return;
  }
  await demarrerAvecDossier();
}

/** Écran de connexion : on désigne (ou reconnecte) le dossier partagé avant tout. */
async function demarrer() {
  if (api.MODE === 'nuage') { await demarrerNuage(); return; }

  const chargement = document.getElementById('chargement');
  const connexion = document.getElementById('connexion');
  const bouton = document.getElementById('bouton-connexion');
  const message = document.getElementById('connexion-message');

  if (!api.apiDisponible()) {
    chargement.hidden = true;
    connexion.hidden = false;
    bouton.hidden = true;
    message.innerHTML = 'Cette application a besoin de <strong>Google Chrome</strong> ou de '
      + '<strong>Microsoft Edge</strong> pour accéder au dossier partagé. '
      + 'Ouvrez le fichier <code>Gestion LMNP.html</code> avec l’un de ces deux navigateurs.';
    return;
  }

  // Un seul écran, un seul geste : on désigne le dossier à chaque ouverture.
  // Aucune « reconnexion » mémorisée : sur les postes verrouillés, rouvrir un
  // ancien dossier mémorisé se bloquait. Choisir le dossier fonctionne, lui,
  // à tous les coups (c'est ce que fait le fichier de diagnostic).
  chargement.hidden = true;
  connexion.hidden = false;
  document.getElementById('bouton-connexion-autre').hidden = true;
  document.getElementById('connexion-version').textContent = `Version ${VERSION_APP}`;

  message.innerHTML = '<strong>Faites glisser votre dossier partagé</strong> depuis l’explorateur '
    + 'Windows et déposez-le n’importe où sur cette fenêtre — ou cliquez sur le bouton pour le '
    + 'choisir dans une liste.<br>'
    + 'Prenez un dossier <strong>déjà présent sur le disque</strong> : s’il est marqué '
    + '« disponible en ligne uniquement » (nuage), faites d’abord un clic droit dessus dans '
    + 'l’explorateur → <em>Toujours conserver sur cet appareil</em>.';
  bouton.textContent = 'Choisir le dossier partagé';
  bouton.onclick = async () => {
    document.getElementById('connexion-erreur').hidden = true;
    try { await api.choisirDossier(); await demarrerAvecDossier(); }
    catch (erreur) { messageErreurConnexion(erreur); }
  };

  // Voie alternative, sans sélecteur : glisser-déposer le dossier sur la page.
  window.addEventListener('dragover', (evenement) => { evenement.preventDefault(); });
  window.addEventListener('drop', async (evenement) => {
    evenement.preventDefault();
    if (connexion.hidden) return; // l'application est déjà ouverte : ignorer
    document.getElementById('connexion-erreur').hidden = true;
    const element = [...(evenement.dataTransfer?.items || [])].find((i) => i.kind === 'file');
    if (!element) return;
    try {
      if (typeof element.getAsFileSystemHandle !== 'function') {
        messageErreurConnexion(new Error('Ce navigateur ne permet pas le dépôt de dossier — utilisez le bouton.'));
        return;
      }
      const handle = await element.getAsFileSystemHandle();
      if (!handle || handle.kind !== 'directory') {
        messageErreurConnexion(new Error('Déposez un dossier (pas un fichier).'));
        return;
      }
      if (!(await api.connecterHandle(handle))) {
        messageErreurConnexion(new Error(`L’écriture dans « ${handle.name} » a été refusée.`));
        return;
      }
      await demarrerAvecDossier();
    } catch (erreur) { messageErreurConnexion(erreur); }
  });
}

// --------------------------------------------------------------- verrou poste

const VERROU_PERIME_MS = 90000;   // un verrou plus vieux que 90 s = poste fermé
const VERROU_BATTEMENT_MS = 30000; // on rafraîchit notre verrou toutes les 30 s
const VERROU_DELAI_MS = 8000;      // au-delà, on considère l'opération de verrou en échec

// Borne une opération : si elle ne répond pas à temps, on renvoie une valeur de
// repli au lieu de laisser le démarrage figé indéfiniment.
function avecDelai(promesse, millisecondes, valeurSecours) {
  return Promise.race([
    Promise.resolve(promesse).catch(() => valeurSecours),
    new Promise((resoudre) => { setTimeout(() => resoudre(valeurSecours), millisecondes); }),
  ]);
}

function idPoste() {
  let id = localStorage.getItem('lmnp-poste-id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('lmnp-poste-id', id); }
  return id;
}

function verrouPerime(verrou) {
  const age = Date.now() - new Date(verrou.battement || verrou.depuis || 0).getTime();
  return !Number.isFinite(age) || age > VERROU_PERIME_MS;
}

async function poserVerrou() {
  const identite = {
    idPoste: idPoste(),
    utilisateur: localStorage.getItem('lmnp-utilisateur') || '',
    depuis: new Date().toISOString(),
    battement: new Date().toISOString(),
  };
  // Écriture du verrou bornée et NON bloquante : si le dossier tarde à répondre,
  // on n'empêche pas l'application de s'ouvrir (le verrou n'est qu'une sécurité
  // contre l'écriture simultanée à deux postes, pas une condition d'accès).
  await avecDelai(api.ecrireVerrou(identite), VERROU_DELAI_MS, null);
  // Battement de cœur : tant que l'onglet est ouvert, on prouve qu'on est là.
  clearInterval(contexte._battement);
  contexte._battement = setInterval(async () => {
    try { await api.ecrireVerrou({ ...identite, battement: new Date().toISOString() }); }
    catch { /* la synchro reviendra */ }
  }, VERROU_BATTEMENT_MS);
  // Libération à la fermeture (au mieux : l'expiration de 90 s couvre le reste).
  window.addEventListener('pagehide', () => { api.libererVerrou(idPoste()); });
}

/**
 * Un seul poste à la fois. Si le dossier est libre, on pose le verrou et on
 * entre. S'il est occupé, on affiche un écran d'attente et on ré-essaie
 * régulièrement : dès que l'autre poste ferme (ou après expiration s'il a
 * planté), on entre automatiquement.
 */
function gererVerrou() {
  return new Promise((resoudre) => {
    const chargement = document.getElementById('chargement');
    const connexion = document.getElementById('connexion');
    const message = document.getElementById('connexion-message');
    const bouton = document.getElementById('bouton-connexion');

    const tenter = async () => {
      const verrou = await avecDelai(api.lireVerrou(), VERROU_DELAI_MS, null);
      const libre = !verrou || verrou.idPoste === idPoste() || verrouPerime(verrou);
      if (libre) {
        clearInterval(contexte._attente);
        connexion.hidden = true;
        chargement.hidden = false;
        await poserVerrou();
        resoudre(true);
        return;
      }
      // Occupé : écran d'attente (pas de bouton, on entre tout seul).
      chargement.hidden = true;
      connexion.hidden = false;
      bouton.hidden = true;
      const depuis = new Date(verrou.depuis).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const qui = verrou.utilisateur ? `<strong>${verrou.utilisateur}</strong> utilise` : 'Un autre poste utilise';
      message.innerHTML = `${qui} l’application (depuis ${depuis}).<br>`
        + 'Un seul poste à la fois : vous y accéderez automatiquement dès qu’il l’aura fermée. '
        + '<span class="attente-point">Patientez…</span>';
    };

    tenter();
    contexte._attente = setInterval(tenter, 4000);
  });
}

async function demarrerAvecDossier() {
  document.getElementById('connexion').hidden = true;
  const chargement = document.getElementById('chargement');
  chargement.hidden = false;
  const etape = (texte) => { const z = chargement.querySelector('.chargement-texte'); if (z) z.textContent = texte; };
  const echouer = (erreur, ou) => {
    console.error('Démarrage —', ou, erreur);
    chargement.classList.add('erreur');
    const z = chargement.querySelector('.chargement-texte');
    if (z) {
      z.textContent = erreur?.abime
        ? erreur.message
        : `Blocage à l’étape « ${ou} » : ${erreur?.message || erreur}`
          + (erreur?.name ? ` [${erreur.name}]` : '')
          + '. Rechargez la page (F5) ; si cela persiste, envoyez-moi cet écran.';
    }
  };

  etape('Lecture des données du dossier partagé…');
  try {
    await etat.chargerTout(etape);
  } catch (erreur) { echouer(erreur, 'lecture des données'); return; }

  // Verrou « un seul poste à la fois » : si l'autre poste l'utilise, on
  // affiche un écran d'attente et on entre dès qu'il ferme l'application.
  etape('Vérification de l’accès (un seul poste à la fois)…');
  try {
    if (!(await gererVerrou())) return;
  } catch (erreur) { echouer(erreur, 'pose du verrou'); return; }
  etape('Ouverture…');

  try {
    await ouvrirApplication();
  } catch (erreur) { echouer(erreur, 'ouverture de l’application'); }
}

async function ouvrirApplication() {

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
      titre: 'Fermer l’application',
      message: 'Toutes vos saisies sont déjà enregistrées dans le dossier partagé. Vous pouvez fermer cet onglet.',
      libelleValider: 'Fermer',
    });
    if (!confirme) return;
    clearInterval(contexte._battement);
    try { await api.libererVerrou(idPoste()); } catch { /* expiration couvre */ }
    if (api.MODE === 'nuage') { try { await api.seDeconnecter(); } catch { /* déjà déconnecté */ } }
    document.body.innerHTML = '<div class="chargement"><div class="chargement-boite">'
      + '<div class="chargement-titre">Gestion LMNP</div>'
      + '<div class="chargement-texte">Vous pouvez fermer cet onglet. À bientôt.</div></div></div>';
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

  // Qui utilise ce poste ? On le demande une fois, pour tracer « modifié par ».
  if (!localStorage.getItem('lmnp-utilisateur')) {
    const reponse = await formulaire({
      titre: 'Qui êtes-vous ?',
      aide: 'Votre prénom sert à savoir qui a saisi quoi quand vous travaillez à deux. Il reste sur ce poste.',
      champs: [{ cle: 'nom', libelle: 'Prénom', type: 'texte', requis: true }],
    });
    if (reponse?.nom) {
      localStorage.setItem('lmnp-utilisateur', reponse.nom);
      localStorage.setItem('lmnp-poste', reponse.nom);
    }
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
