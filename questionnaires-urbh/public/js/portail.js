// Portail public des journées d'études URBH.
//
// C'est la page pointée par le QR code imprimé sur les flyers :
//   https://<projet>.web.app/portail.html          → journée marquée « active »
//   https://<projet>.web.app/portail.html?e=<id>   → journée précise
//
// Le participant est authentifié de façon anonyme (Firebase Auth) : son
// téléphone conserve son identifiant, il est donc reconnu à chaque retour et
// retombe directement sur le menu de choix (tirage au sort / questionnaires).

(function () {
  'use strict';

  const $app = document.getElementById('app-portail');
  const $sousTitre = document.getElementById('sous-titre-journee');

  function echapper(texte) {
    const div = document.createElement('div');
    div.textContent = texte == null ? '' : String(texte);
    return div.innerHTML;
  }

  function attr(texte) {
    return echapper(texte).replace(/"/g, '&quot;');
  }

  function message(html) {
    $app.innerHTML = `<div class="carte">${html}</div>`;
  }

  // Détail technique d'une erreur Firebase, ajouté aux messages pour
  // diagnostiquer précisément (permission-denied = règles en retard, etc.).
  function detailErreur(e) {
    if (!e) return '';
    const code = e.code || '';
    if (code === 'permission-denied') {
      return ' [permission-denied : les règles de sécurité déployées sont probablement en retard — redéployer avec firebase deploy --only firestore]';
    }
    return code ? ` [${code}]` : e.message ? ` [${e.message}]` : '';
  }

  function normaliserNumero(brut) {
    return String(brut == null ? '' : brut)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\//g, '-');
  }

  // Sur Firebase Hosting, /__/firebase/init.js a déjà initialisé l'application
  // avec la configuration du projet ; sinon, repli sur firebase-config.js.
  if (!firebase.apps.length) {
    if (!window.firebaseConfigEstRenseignee()) {
      message(
        "<h2>Portail en préparation</h2><p>Le site n'est pas encore configuré. Revenez un peu plus tard !</p>",
      );
      return;
    }
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  document.body.classList.add('page-portail');

  let uid = null;
  let journeeId = null;
  let portail = null;
  let profil = null;
  let standDemande = null; // arrivée par le QR d'un stand (?stand=<id>)

  // Moments de pointage (émargement) de la journée : ils conditionnent la
  // participation à la tombola de clôture.
  const MOMENTS_POINTAGE = [
    { cle: 'ouverture', libelle: "Ouverture des journées — première conférence" },
    { cle: 'ag', libelle: 'Assemblée Générale' },
    { cle: 'tombola', libelle: 'Présence en salle au moment du tirage' },
  ];

  // Mode simulation (?simu=1, phase de développement) : un sélecteur ◀ ▶
  // décale l'heure prise en compte par l'écran pour simuler l'évolution de
  // la journée (avant / pendant / après l'AG). L'affichage seul est simulé :
  // les enregistrements restent contrôlés par l'heure réelle du serveur.
  let modeSimu = false;
  let decalageSimu = 0; // millisecondes ajoutées à l'heure réelle

  function maintenant() {
    return new Date(Date.now() + decalageSimu);
  }

  // Période de l'Assemblée Générale (paramétrée par l'administrateur) :
  // c'est elle qui ouvre et ferme les inscriptions aux ateliers.
  function periodeAG() {
    const ag = portail && portail.ag;
    if (!ag || !ag.debut || !ag.fin) return null;
    try {
      return { debut: ag.debut.toDate(), fin: ag.fin.toDate() };
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------- inscription

  function vueInscription(erreur) {
    $app.innerHTML = `
      <div class="carte">
        <h2>Bienvenue !</h2>
        <p>Pour participer au tirage au sort et répondre aux questionnaires,
        présentez-vous une seule fois : votre téléphone sera ensuite reconnu
        automatiquement.</p>
        ${erreur ? `<div class="erreur">${echapper(erreur)}</div>` : ''}
        <form id="form-profil">
          <div class="question">
            <div class="libelle">Vous êtes… <span class="obligatoire">*</span></div>
            <div class="ouinon">
              <label><input type="radio" name="p-type" value="visiteur" required>
                Visiteur<br><span class="petit">blanchisseur</span></label>
              <label><input type="radio" name="p-type" value="exposant">
                Exposant<br><span class="petit">fournisseur</span></label>
            </div>
          </div>
          <label class="champ">Prénom *
            <input id="p-prenom" required autocomplete="given-name"></label>
          <label class="champ">Nom *
            <input id="p-nom" required autocomplete="family-name"></label>
          <label class="champ">Établissement / société
            <input id="p-organisme" autocomplete="organization"></label>
          <label class="champ">N° d'inscription *
            <input id="p-numero" required maxlength="20" autocomplete="off"
              placeholder="Sur la carte remise à l'accueil"></label>
          <div id="p-numero-etat" class="muet petit" style="margin:-0.5rem 0 0.8rem"></div>
          <label class="champ">Mobile *
            <input id="p-mobile" type="tel" required autocomplete="tel"
              placeholder="06 12 34 56 78"
              pattern="[0-9+][0-9 .-]{8,16}"></label>
          <label class="champ">E-mail (facultatif)
            <input id="p-email" type="email" autocomplete="email"></label>
          <label class="champ" style="font-weight:normal">
            <input type="checkbox" id="p-handicap" style="display:inline;width:auto">
            ♿ Je souhaite être accompagné(e) par le référent handicap URBH</label>
          <label class="champ" style="font-weight:normal">
            <input type="checkbox" id="p-consentement" style="display:inline;width:auto">
            🤝 J'accepte que mes coordonnées (prénom, nom, établissement,
            mobile, e-mail) soient transmises aux <strong>fournisseurs dont je
            scanne le stand</strong>, afin qu'ils puissent me recontacter.
            <span class="muet petit">(facultatif — modifiable à tout moment)</span></label>
          <div class="ligne-boutons">
            <button type="submit" id="p-valider">Je valide mes informations</button>
            ${profil ? '<button type="button" id="p-annuler" class="secondaire">Annuler</button>' : ''}
          </div>
          <p class="muet petit">✔️ En validant, vous confirmez l'exactitude de
          ces informations : elles serviront à <strong>mettre à jour l'annuaire
          de l'association</strong> — corrigez-les si besoin avant de valider.
          Votre mobile sert à vous prévenir si vous gagnez au tirage au sort et
          à vous envoyer certains résultats par SMS. Hors consentement
          ci-dessus, ces informations restent internes à l'URBH.</p>
        </form>
      </div>
      <div id="zone-mes-donnees"></div>`;

    const boutonAnnuler = document.getElementById('p-annuler');
    if (boutonAnnuler) boutonAnnuler.addEventListener('click', () => vueMenu());
    if (profil) chargerMesDonnees();

    // Reconnaissance dans l'annuaire des inscrits : la saisie du numéro de la
    // carte pré-remplit l'identité (et le profil visiteur / exposant).
    const champNumero = document.getElementById('p-numero');
    champNumero.addEventListener('change', async () => {
      const etat = document.getElementById('p-numero-etat');
      const numero = normaliserNumero(champNumero.value);
      if (!numero) {
        etat.textContent = '';
        return;
      }
      etat.textContent = 'Vérification…';
      try {
        const fiche = await db.collection('annuaire').doc(numero).get();
        if (fiche.exists) {
          const f = fiche.data();
          const champPrenom = document.getElementById('p-prenom');
          const champNom = document.getElementById('p-nom');
          const champOrganisme = document.getElementById('p-organisme');
          if (!champPrenom.value) champPrenom.value = f.prenom || '';
          if (!champNom.value) champNom.value = f.nom || '';
          if (!champOrganisme.value) champOrganisme.value = f.organisme || '';
          const radio = document.querySelector(`input[name="p-type"][value="${f.type}"]`);
          if (radio) radio.checked = true;
          etat.textContent = `✓ Reconnu : ${f.prenom || ''} ${f.nom || ''}${f.organisme ? ' — ' + f.organisme : ''}`;
          etat.style.color = '#2e8b57';
        } else {
          etat.textContent =
            'Numéro inconnu de la liste des inscrits — vérifiez la carte remise à l\'accueil (vous pouvez tout de même continuer).';
          etat.style.color = '#d97706';
        }
      } catch (_) {
        etat.textContent = '';
      }
    });

    document.getElementById('form-profil').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const type = (document.querySelector('input[name="p-type"]:checked') || {}).value;
      const nouveau = {
        type,
        prenom: document.getElementById('p-prenom').value.trim(),
        nom: document.getElementById('p-nom').value.trim(),
        organisme: document.getElementById('p-organisme').value.trim(),
        numeroInscription: normaliserNumero(document.getElementById('p-numero').value),
        mobile: document.getElementById('p-mobile').value.trim(),
        email: document.getElementById('p-email').value.trim(),
        accompagnementHandicap: document.getElementById('p-handicap').checked,
        consentementPartage: document.getElementById('p-consentement').checked,
        consentementLe: document.getElementById('p-consentement').checked
          ? (profil && profil.consentementPartage && profil.consentementLe) || new Date().toISOString()
          : '',
        creeLe: profil && profil.creeLe ? profil.creeLe : new Date().toISOString(),
        majLe: new Date().toISOString(),
      };
      const bouton = document.getElementById('p-valider');
      bouton.disabled = true;
      try {
        await db.collection('participants').doc(uid).set(nouveau);
        profil = nouveau;
        await apresProfil();
      } catch (e) {
        vueInscription(
          "L'enregistrement a échoué. Vérifiez votre connexion puis réessayez." + detailErreur(e),
        );
      }
    });
  }

  // Bloc « 🔐 Mes données » de l'écran de modification du profil : état du
  // consentement de partage et demande d'anonymisation (droit à l'effacement).
  async function chargerMesDonnees() {
    const zone = document.getElementById('zone-mes-donnees');
    if (!zone || !profil) return;

    let demandeAnonymisation = null;
    try {
      const dm = await db.collection('demandesAnonymisation').doc(uid).get();
      if (dm.exists) demandeAnonymisation = dm.data();
    } catch (_) {
      demandeAnonymisation = null;
    }

    zone.innerHTML = `
      <div class="carte">
        <h2>🔐 Mes données</h2>
        <p class="muet petit">
          Partage de mes coordonnées avec les fournisseurs visités :
          <strong>${profil.consentementPartage ? 'accepté' : 'refusé'}</strong>
          (case 🤝 du formulaire ci-dessus). Mes informations validées servent
          à mettre à jour l'annuaire de l'association.
        </p>
        ${
          demandeAnonymisation
            ? demandeAnonymisation.statut === 'traitee'
              ? `<div class="info">✅ Votre demande d'anonymisation a été traitée
                  le ${echapper(new Date(demandeAnonymisation.traiteLe || Date.now()).toLocaleDateString('fr-FR'))} :
                  vos données personnelles ont été supprimées de l'application.</div>`
              : `<div class="info">⏳ Votre demande d'anonymisation est enregistrée
                  (${echapper(new Date(demandeAnonymisation.demandeLe).toLocaleDateString('fr-FR'))}).
                  Une confirmation s'affichera ici dès son traitement par l'URBH.</div>`
            : `<p class="muet petit">À l'issue des journées d'études, vous pouvez
                demander la suppression de vos données personnelles (droit à
                l'effacement) : vos réponses aux questionnaires seront conservées
                de façon anonyme, tout le reste sera effacé.</p>
              <div class="ligne-boutons">
                <button id="bouton-anonymisation" class="danger">🗑️ Demander l'anonymisation de mes données</button>
              </div>
              <div id="erreur-anonymisation" class="erreur" hidden></div>`
        }
      </div>`;

    const boutonAnonymisation = document.getElementById('bouton-anonymisation');
    if (boutonAnonymisation) {
      boutonAnonymisation.addEventListener('click', async () => {
        if (
          !confirm(
            'Demander la suppression de vos données personnelles ? ' +
              'Vous ne pourrez plus participer au tirage ni être recontacté par les fournisseurs.',
          )
        ) {
          return;
        }
        boutonAnonymisation.disabled = true;
        try {
          await db.collection('demandesAnonymisation').doc(uid).set({
            participantId: uid,
            nom: profil.nom || '',
            prenom: profil.prenom || '',
            demandeLe: new Date().toISOString(),
            statut: 'en_attente',
          });
          chargerMesDonnees();
        } catch (e) {
          const erreur = document.getElementById('erreur-anonymisation');
          erreur.textContent = "La demande n'a pas pu être enregistrée." + detailErreur(e);
          erreur.hidden = false;
          boutonAnonymisation.disabled = false;
        }
      });
    }
  }

  // Enregistre (ou met à jour) la présence à la journée, en traçant chaque
  // passage sur le portail : dernier accès et nombre d'accès.
  //
  // La fiche est identifiée par le N° DE CARTE (et non par la session du
  // navigateur) : la même personne qui revient depuis un autre appareil, ou
  // après avoir purgé son téléphone, retrouve et met à jour SA fiche au lieu
  // d'en créer une nouvelle — un numéro de carte = un seul inscrit.
  async function enregistrerInscription() {
    const numero = normaliserNumero(profil.numeroInscription);
    const ref = db.collection('inscriptions').doc(journeeId + '_' + (numero || uid));
    let creeLe = new Date().toISOString();
    try {
      const existant = await ref.get();
      if (existant.exists && existant.data().creeLe) creeLe = existant.data().creeLe;
    } catch (_) {
      /* première visite, ou fiche créée depuis un autre appareil */
    }
    await ref.set({
      journeeId,
      participantId: uid,
      type: profil.type,
      nom: profil.nom,
      prenom: profil.prenom,
      organisme: profil.organisme || '',
      email: profil.email || '',
      mobile: profil.mobile || '',
      numeroInscription: profil.numeroInscription || '',
      accompagnementHandicap: !!profil.accompagnementHandicap,
      creeLe,
      dernierAccesLe: new Date().toISOString(),
      nbAcces: firebase.firestore.FieldValue.increment(1),
    });
    // Ménage : les versions précédentes créaient une fiche PAR SESSION de
    // navigateur (d'où des doublons au même nom) — on efface la nôtre.
    if (numero) {
      db.collection('inscriptions')
        .doc(journeeId + '_' + uid)
        .delete()
        .catch(() => {});
    }
  }

  // ------------------------------------------------------------------- stand
  // Arrivée par le QR code d'un stand : on propose d'enregistrer le passage,
  // avec partage consenti des coordonnées au fournisseur.

  async function vueStand(fournisseurId) {
    let fournisseur = null;
    try {
      const doc = await db.collection('fournisseurs').doc(fournisseurId).get();
      if (doc.exists) fournisseur = doc.data();
    } catch (_) {
      /* traité ci-dessous */
    }
    if (!fournisseur) {
      message(
        `<h2>Stand introuvable</h2>
        <p>Ce QR code ne correspond à aucun stand connu.</p>
        <div class="ligne-boutons"><button id="bouton-retour-menu">Retour au menu</button></div>`,
      );
      document.getElementById('bouton-retour-menu').addEventListener('click', retourMenu);
      return;
    }

    let dejaVisite = false;
    try {
      const v = await db.collection('visites').doc(fournisseurId + '_' + uid).get();
      dejaVisite = v.exists;
    } catch (_) {
      /* pas encore de passage */
    }

    $app.innerHTML = `
      <div class="carte">
        <h2>🏭 ${echapper(fournisseur.nom)}</h2>
        <p class="muet">${fournisseur.stand ? 'Stand ' + echapper(fournisseur.stand) : ''}</p>
        ${fournisseur.description ? `<p>${echapper(fournisseur.description)}</p>` : ''}
        ${
          dejaVisite
            ? `<div class="info">✅ Votre passage sur ce stand est déjà enregistré.
                Merci de votre visite !</div>`
            : profil.consentementPartage
              ? `<p>Enregistrer votre passage sur ce stand ?</p>
                <p class="muet petit">Conformément au consentement donné à votre
                inscription, vos coordonnées seront transmises à
                <strong>${echapper(fournisseur.nom)}</strong>.</p>
                <div id="erreur-stand" class="erreur" hidden></div>
                <div class="ligne-boutons">
                  <button id="bouton-confirmer-visite">✅ Je confirme mon passage</button>
                </div>`
              : `<p>Enregistrer votre passage sur ce stand ?</p>
                <p class="muet petit">Vous n'avez pas encore consenti au partage de
                vos coordonnées avec les fournisseurs. Pour que
                <strong>${echapper(fournisseur.nom)}</strong> puisse vous recontacter,
                acceptez le partage (prénom, nom, établissement, mobile, e-mail) —
                modifiable à tout moment depuis votre profil.</p>
                <div id="erreur-stand" class="erreur" hidden></div>
                <div class="ligne-boutons">
                  <button id="bouton-confirmer-visite">🤝 J'accepte le partage et je confirme mon passage</button>
                </div>`
        }
        <div class="ligne-boutons">
          <button id="bouton-retour-menu" class="secondaire">Retour au menu</button>
        </div>
      </div>`;

    document.getElementById('bouton-retour-menu').addEventListener('click', retourMenu);

    const boutonConfirmer = document.getElementById('bouton-confirmer-visite');
    if (boutonConfirmer) {
      boutonConfirmer.addEventListener('click', async () => {
        boutonConfirmer.disabled = true;
        try {
          if (!profil.consentementPartage) {
            // Consentement donné à l'instant : enregistré au profil.
            profil.consentementPartage = true;
            profil.consentementLe = new Date().toISOString();
            await db.collection('participants').doc(uid).update({
              consentementPartage: true,
              consentementLe: profil.consentementLe,
            });
          }
          await db
            .collection('visites')
            .doc(fournisseurId + '_' + uid)
            .set({
              fournisseurId,
              fournisseurNom: fournisseur.nom || '',
              journeeId: journeeId || '',
              participantId: uid,
              type: profil.type,
              nom: profil.nom,
              prenom: profil.prenom,
              organisme: profil.organisme || '',
              email: profil.email || '',
              mobile: profil.mobile || '',
              numeroInscription: profil.numeroInscription || '',
              viseLe: new Date().toISOString(),
            });
          vueStand(fournisseurId);
        } catch (e) {
          const erreur = document.getElementById('erreur-stand');
          erreur.textContent =
            "L'enregistrement du passage a échoué. Réessayez." + detailErreur(e);
          erreur.hidden = false;
          boutonConfirmer.disabled = false;
        }
      });
    }
  }

  // ------------------------------------------- notifications des ateliers
  // Meilleur effort sans serveur : tant que l'application est ouverte sur le
  // téléphone (même en arrière-plan récent), elle prévient du résultat du
  // tirage au sort des ateliers et rappelle 10 minutes avant le début de
  // l'atelier, avec le numéro de la salle.

  const rappelsProgrammes = new Set();
  let ecouteAteliers = false;

  function notifier(titre, corps, cle) {
    try {
      if (cle && localStorage.getItem(cle)) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (cle) localStorage.setItem(cle, '1');
      const options = { body: corps, icon: 'icons/icone-192.png', badge: 'icons/icone-192.png' };
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (reg && reg.showNotification) reg.showNotification(titre, options);
          else new Notification(titre, options);
        })
        .catch(() => new Notification(titre, options));
    } catch (_) {
      /* notifications indisponibles : le menu affiche de toute façon le résultat */
    }
  }

  function programmerRappel(a) {
    if (!a.debutLe || rappelsProgrammes.has(a.id)) return;
    let debut;
    try {
      debut = a.debutLe.toDate();
    } catch (_) {
      return;
    }
    const delai = debut.getTime() - 10 * 60000 - Date.now();
    if (delai <= 0 || delai > 48 * 3600000) return;
    rappelsProgrammes.add(a.id);
    setTimeout(
      () =>
        notifier(
          '⏰ Votre atelier commence dans 10 minutes',
          `${a.nom} — salle ${a.salle}${a.horaire ? ' (' + a.horaire + ')' : ''}`,
          'urbh_rappel_' + a.id,
        ),
      delai,
    );
  }

  function surveillerAteliers() {
    if (ecouteAteliers || !journeeId) return;
    ecouteAteliers = true;
    try {
      db.collection('ateliers')
        .where('journeeId', '==', journeeId)
        .onSnapshot(
          (snap) => {
            snap.docs.forEach((d) => {
              const a = { id: d.id, ...d.data() };
              if (a.statut !== 'tire') return;
              if (!(a.retenus || []).some((r) => r.participantId === uid)) return;
              notifier(
                '🎉 Tirage au sort des ateliers',
                `Vous êtes retenu : ${a.nom} — salle ${a.salle}${a.horaire ? ', ' + a.horaire : ''}.`,
                'urbh_notif_tirage_' + a.id,
              );
              programmerRappel(a);
            });
          },
          () => {
            /* écoute interrompue : sans gravité */
          },
        );
    } catch (_) {
      ecouteAteliers = false;
    }
  }

  function retourMenu() {
    if (arreterScanner) arreterScanner();
    standDemande = null;
    try {
      history.replaceState(null, '', location.pathname);
    } catch (_) {
      /* sans gravité */
    }
    vueMenu();
  }

  // ------------------------------------------------------------------ écrans
  // L'écran d'accueil présente en plein écran les grands boutons d'accès aux
  // outils ; chaque outil s'ouvre ensuite dans son propre écran, avec un
  // retour à l'accueil. vueMenu() réaffiche l'écran courant : les actions
  // (pointage, inscription atelier…) l'appellent pour se rafraîchir en place.

  let vueCourante = 'accueil';

  function vueMenu() {
    const vues = {
      accueil: vueAccueil,
      programme: vueProgramme,
      plan: vuePlan,
      exposants: vuePlan, // la recherche a rejoint l'écran du plan
      visites: vueVisites,
      ateliers: vueAteliers,
      tombola: vueTombola,
      tirage: vueTombola, // le tirage au sort a rejoint l'écran Tombola
      questionnaires: vueQuestionnaires,
    };
    return (vues[vueCourante] || vueAccueil)();
  }

  // Caméra du scanner de QR de stand : coupée dès qu'on change d'écran.
  let arreterScanner = null;

  function aller(vue) {
    if (arreterScanner) arreterScanner();
    vueCourante = vue;
    window.scrollTo(0, 0);
    vueMenu();
  }

  // Bandeau de retour affiché en tête de chaque écran outil.
  function barreRetour(titre) {
    return `<div class="carte carte-outil">
      <button class="retour-accueil discret">← Accueil</button>
      <h2>${titre}</h2>`;
  }

  function brancherNavigation() {
    document.querySelectorAll('.retour-accueil').forEach((b) =>
      b.addEventListener('click', () => aller('accueil')),
    );
    document.querySelectorAll('.bouton-outil, .lien-vue').forEach((b) =>
      b.addEventListener('click', () => aller(b.dataset.vue)),
    );
    const boutonProfil = document.getElementById('bouton-profil');
    if (boutonProfil) {
      boutonProfil.addEventListener('click', () => {
        vueInscription();
        // Pré-remplit avec le profil existant.
        document.querySelector(`input[name="p-type"][value="${attr(profil.type)}"]`).checked = true;
        document.getElementById('p-prenom').value = profil.prenom || '';
        document.getElementById('p-nom').value = profil.nom || '';
        document.getElementById('p-organisme').value = profil.organisme || '';
        document.getElementById('p-numero').value = profil.numeroInscription || '';
        document.getElementById('p-mobile').value = profil.mobile || '';
        document.getElementById('p-email').value = profil.email || '';
        document.getElementById('p-handicap').checked = !!profil.accompagnementHandicap;
        document.getElementById('p-consentement').checked = !!profil.consentementPartage;
      });
    }
  }

  // ----------------------------------------------- programme & temps réel

  // Programme pédagogique publié par l'administration sur la vitrine de la
  // journée (portails/<id>.programme) : liste d'événements datés.
  function programmeTrie() {
    const brut = (portail && portail.programme) || [];
    const evenements = [];
    brut.forEach((e) => {
      try {
        evenements.push({
          debut: e.debut.toDate(),
          fin: e.fin ? e.fin.toDate() : null,
          titre: e.titre || '',
          lieu: e.lieu || '',
        });
      } catch (_) {
        /* entrée mal formée : ignorée */
      }
    });
    evenements.sort((a, b) => a.debut - b.debut);
    return evenements;
  }

  const fmtHeureCourte = (d) =>
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtJour = (d) => {
    const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  // Information « réunions en temps réel » du bandeau d'accueil : ce qui se
  // déroule en ce moment, sinon le prochain rendez-vous du programme.
  function infoReunion() {
    const prog = programmeTrie();
    if (!prog.length) return '';
    const t = maintenant();
    const enCours = prog.filter((e) => e.debut <= t && e.fin && t < e.fin);
    if (enCours.length) {
      const visibles = enCours.slice(0, 2);
      const texte = visibles
        .map((e) => `<strong>${echapper(e.titre)}</strong>${e.lieu ? ' — ' + echapper(e.lieu) : ''}`)
        .join(' · ');
      const reste = enCours.length - visibles.length;
      const fin = enCours[0].fin;
      return `🔴 En ce moment : ${texte}${reste > 0 ? ` (+${reste})` : ''}
        <span class="muet petit">jusqu'à ${echapper(fmtHeureCourte(fin))}</span>`;
    }
    const suivant = prog.find((e) => e.debut > t);
    if (suivant) {
      const memeJour = suivant.debut.toDateString() === t.toDateString();
      const quand = memeJour
        ? `à ${fmtHeureCourte(suivant.debut)}`
        : `${fmtJour(suivant.debut)} à ${fmtHeureCourte(suivant.debut)}`;
      return `🕒 À suivre ${echapper(quand)} : <strong>${echapper(suivant.titre)}</strong>${
        suivant.lieu ? ' — ' + echapper(suivant.lieu) : ''
      }`;
    }
    return '🏁 Les journées d’études sont terminées — merci de votre participation !';
  }

  // Le bandeau se rafraîchit tout seul tant que l'accueil est affiché.
  setInterval(() => {
    const zone = document.getElementById('info-reunion');
    if (zone && profil) zone.innerHTML = infoReunion();
  }, 60000);

  function enTeteBonjour() {
    const info = infoReunion();
    return `<div class="carte carte-bonjour">
        <h2>Bonjour ${echapper(profil.prenom)} !</h2>
        <p class="muet">${profil.type === 'exposant' ? 'Exposant fournisseur' : 'Visiteur blanchisseur'}${
          profil.organisme ? ' — ' + echapper(profil.organisme) : ''
        }
          <button id="bouton-profil" class="discret">modifier</button></p>
        ${info ? `<div id="info-reunion" class="info-reunion">${info}</div>` : ''}
      </div>`;
  }

  // ----------------------------------------------------------------- accueil

  async function vueAccueil() {
    // Rafraîchit la vitrine : état du tirage, des pointages, programme.
    try {
      const doc = await db.collection('portails').doc(journeeId).get();
      if (doc.exists) portail = doc.data();
    } catch (_) {
      /* on garde la version connue */
    }
    const tirageOuvert = !!(portail.tirage && portail.tirage.ouvert);
    const pointagesOuverts = portail.pointages || {};
    const pointageOuvert = MOMENTS_POINTAGE.some((m) => pointagesOuverts[m.cle]);

    const OUTILS = [
      { vue: 'programme', icone: '📅', libelle: 'Programme pédagogique' },
      { vue: 'plan', icone: '🗺️', libelle: 'Plan & recherche des stands' },
      { vue: 'visites', icone: '🏭', libelle: 'Visite des stands' },
      { vue: 'ateliers', icone: '🛠️', libelle: 'Inscription Atelier' },
      {
        vue: 'tombola',
        icone: '🎟️',
        libelle: 'Tombola & tirage au sort',
        pastille: tirageOuvert ? 'tirage ouvert' : pointageOuvert ? 'pointage ouvert' : '',
      },
      { vue: 'questionnaires', icone: '📝', libelle: 'Questionnaires' },
    ];

    $app.innerHTML = `
      ${enTeteBonjour()}
      <div class="grille-outils">
        ${OUTILS.map(
          (o) => `<button class="bouton-outil" data-vue="${attr(o.vue)}">
            <span class="outil-icone">${o.icone}</span>
            <span class="outil-libelle">${echapper(o.libelle)}</span>
            ${o.pastille ? `<span class="badge ouvert">${echapper(o.pastille)}</span>` : ''}
          </button>`,
        ).join('')}
      </div>
      <div id="carte-installation"></div>
      <div class="ligne-boutons" style="justify-content:center;margin-bottom:0.5rem">
        <button id="bouton-quitter" class="secondaire">🚪 Quitter l'application</button>
      </div>
      <p id="note-quitter" class="muet petit" style="text-align:center" hidden>
        Votre téléphone ne permet pas la fermeture automatique : fermez
        l'application comme les autres (balayage vers le haut depuis la liste
        des applications). Vous serez reconnu automatiquement au retour.
      </p>`;

    majCarteInstallation();
    brancherNavigation();

    document.getElementById('bouton-quitter').addEventListener('click', () => {
      // Fermeture de la fenêtre quand la plateforme l'autorise (application
      // installée sur Android notamment) ; sinon, mode d'emploi. La session
      // reste conservée : aucun risque de perdre la reconnaissance.
      window.close();
      setTimeout(() => {
        const note = document.getElementById('note-quitter');
        if (note) note.hidden = false;
      }, 400);
    });
  }

  // --------------------------------------------------------------- programme

  async function vueProgramme() {
    try {
      const doc = await db.collection('portails').doc(journeeId).get();
      if (doc.exists) portail = doc.data();
    } catch (_) {
      /* on garde la version connue */
    }
    const prog = programmeTrie();
    const t = maintenant();

    let corps;
    if (!prog.length) {
      corps = `<p class="muet">Le programme sera publié ici très prochainement.</p>`;
    } else {
      const parJour = new Map();
      prog.forEach((e) => {
        const cle = fmtJour(e.debut);
        if (!parJour.has(cle)) parJour.set(cle, []);
        parJour.get(cle).push(e);
      });
      corps = [...parJour.entries()]
        .map(
          ([jour, evenements]) => `<h3>${echapper(jour)}</h3>
            ${evenements
              .map((e) => {
                const enCours = e.debut <= t && e.fin && t < e.fin;
                const passe = e.fin ? t >= e.fin : t > e.debut;
                return `<div class="prog-ligne ${enCours ? 'prog-en-cours' : passe ? 'prog-passe' : ''}">
                  <div class="prog-heure">${echapper(fmtHeureCourte(e.debut))}${e.fin ? '<br><span class="muet petit">' + echapper(fmtHeureCourte(e.fin)) + '</span>' : ''}</div>
                  <div>
                    <div>${enCours ? '🔴 ' : ''}<strong>${echapper(e.titre)}</strong></div>
                    ${e.lieu ? `<div class="muet petit">📍 ${echapper(e.lieu)}</div>` : ''}
                  </div>
                </div>`;
              })
              .join('')}`,
        )
        .join('');
    }

    $app.innerHTML = `${barreRetour('📅 Programme pédagogique')}
        ${corps}
      </div>`;
    brancherNavigation();
  }

  // ---------------------------------- plan des stands & recherche fournisseur

  async function vuePlan() {
    let fournisseurs = [];
    try {
      const snapF = await db.collection('fournisseurs').where('journeeId', '==', journeeId).get();
      fournisseurs = snapF.docs.map((d) => ({ id: d.id, ...d.data() }));
      fournisseurs.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    } catch (_) {
      fournisseurs = [];
    }
    let standsVisites = new Set();
    try {
      const snapMv = await db.collection('visites').where('participantId', '==', uid).get();
      standsVisites = new Set(
        snapMv.docs
          .map((d) => d.data())
          .filter((v) => v.journeeId === journeeId)
          .map((v) => v.fournisseurId),
      );
    } catch (_) {
      standsVisites = new Set();
    }
    const nouveauxFournisseurs = fournisseurs.filter((f) => f.nouveau);

    function htmlExposants(filtre) {
      const texte = (filtre || '').trim().toLowerCase();
      const retenus = fournisseurs.filter(
        (f) =>
          !texte ||
          (f.nom || '').toLowerCase().includes(texte) ||
          (f.description || '').toLowerCase().includes(texte) ||
          (f.stand || '').toLowerCase().includes(texte),
      );
      if (!retenus.length) return '<p class="muet petit">Aucun exposant trouvé.</p>';
      // Logo du fournisseur s'il est publié avec le site : fichier
      // public/logos/stand-<n°>.png (rien ne s'affiche sinon).
      const cleStand = (f) =>
        String(f.stand || '')
          .split('/')[0]
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');
      return (
        '<ul class="liste">' +
        retenus
          .map(
            (f) => `<li>
              ${cleStand(f) ? `<img class="logo-expo" src="logos/stand-${attr(cleStand(f))}.png" alt="" onerror="this.remove()">` : ''}
              <div>
                <span class="titre-item">${echapper(f.nom)}</span>
                ${f.stand ? `<span class="muet petit"> — Stand ${echapper(f.stand)}</span>` : ''}
                ${f.nouveau ? '<span class="badge brouillon">🆕 nouveau</span>' : ''}
                ${standsVisites.has(f.id) ? '<span class="badge ouvert">✓ visité</span>' : ''}
                ${f.description ? `<div class="muet petit">${echapper(f.description)}</div>` : ''}
              </div>
            </li>`,
          )
          .join('') +
        '</ul>'
      );
    }

    $app.innerHTML = `${barreRetour('🗺️ Plan des stands & recherche')}
        <div id="zone-plan-expo">
          <a href="plan-exposition.png" target="_blank" rel="noopener">
            <img id="img-plan-expo" src="plan-exposition.png" alt="Plan de l'exposition"
              style="width:100%;border:1px solid var(--bord);border-radius:8px"></a>
          <p class="muet petit" style="margin:0.2rem 0 0">Touchez le plan pour
          l'agrandir (zoom possible une fois ouvert).</p>
        </div>
        <p id="plan-absent" class="muet" hidden>Le plan de l'exposition sera
        affiché ici très prochainement.</p>
        ${
          nouveauxFournisseurs.length
            ? `<div class="info" style="margin-top:0.8rem">🆕 <strong>Nouveaux exposants à découvrir :</strong>
                ${nouveauxFournisseurs
                  .map((f) => `${echapper(f.nom)}${f.stand ? ' (stand ' + echapper(f.stand) + ')' : ''}`)
                  .join(' · ')}</div>`
            : ''
        }
        <h3>Rechercher un fournisseur</h3>
        ${
          fournisseurs.length
            ? `<input id="recherche-exposant" placeholder="🔍 Nom, n° de stand, activité…"
                style="width:100%;font:inherit;padding:0.5rem 0.6rem;border:1px solid var(--bord);border-radius:8px;margin-bottom:0.6rem">
              <div id="liste-exposants">${htmlExposants('')}</div>`
            : `<p class="muet">La liste des exposants sera publiée ici très prochainement.</p>`
        }
      </div>`;
    brancherNavigation();

    const imgPlan = document.getElementById('img-plan-expo');
    const zonePlan = document.getElementById('zone-plan-expo');
    const planAbsent = document.getElementById('plan-absent');
    const planEnEchec = () => {
      zonePlan.hidden = true;
      planAbsent.hidden = false;
    };
    if (!(imgPlan.complete && imgPlan.naturalWidth > 0)) {
      imgPlan.addEventListener('error', planEnEchec);
      if (imgPlan.complete) planEnEchec();
    }

    const champRecherche = document.getElementById('recherche-exposant');
    if (champRecherche) {
      champRecherche.addEventListener('input', () => {
        document.getElementById('liste-exposants').innerHTML = htmlExposants(champRecherche.value);
      });
    }
  }

  // --------------------------------------------------------- visite des stands

  async function vueVisites() {
    let visites = [];
    try {
      const snapMv = await db.collection('visites').where('participantId', '==', uid).get();
      visites = snapMv.docs
        .map((d) => d.data())
        .filter((v) => v.journeeId === journeeId);
      visites.sort((a, b) => String(b.viseLe || '').localeCompare(String(a.viseLe || '')));
    } catch (_) {
      visites = [];
    }

    // Scanner intégré : décodage par la bibliothèque jsQR (fonctionne sur
    // Android ET iPhone), avec l'API native BarcodeDetector en secours si la
    // bibliothèque n'a pas pu se charger. Il faut au minimum une caméra.
    const scannerDispo =
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      (window.jsQR || 'BarcodeDetector' in window);

    $app.innerHTML = `${barreRetour('🏭 Visite des stands')}
        <p class="muet petit">Sur chaque stand, un QR code permet d'enregistrer
        votre passage et, avec votre consentement, de laisser vos coordonnées
        au fournisseur pour qu'il vous recontacte.</p>
        ${
          scannerDispo
            ? `<div class="ligne-boutons">
                <button id="bouton-scanner">📷 Scanner le QR du stand</button>
              </div>
              <div id="zone-scanner" hidden style="margin:0.6rem 0">
                <video id="video-scanner" playsinline muted
                  style="width:100%;border-radius:10px;border:1px solid var(--bord)"></video>
                <div class="ligne-boutons">
                  <button id="bouton-stop-scanner" class="secondaire">Arrêter le scanner</button>
                </div>
              </div>
              <div id="erreur-scanner" class="erreur" hidden></div>
              <p class="muet petit">L'appareil photo du téléphone fonctionne
              aussi : visez le QR du stand, le portail s'ouvre directement.</p>`
            : `<p class="muet petit">📷 Ouvrez l'<strong>appareil photo</strong> du
                téléphone et visez le QR du stand : le portail s'ouvre sur la
                confirmation du passage.</p>`
        }
        <h3>Mes passages${visites.length ? ` (${visites.length})` : ''}</h3>
        ${
          visites.length
            ? `<ul class="liste">${visites
                .map(
                  (v) => `<li>
                    <div>
                      <span class="titre-item">${echapper(v.fournisseurNom || '')}</span>
                      <div class="muet petit">${v.viseLe ? new Date(v.viseLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
                    </div>
                  </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucun passage enregistré pour le moment.</p>`
        }
        <p class="muet petit">Retrouvez les exposants avec le
          <button class="discret lien-vue" data-vue="plan">plan des stands et la recherche</button>.</p>
      </div>`;
    brancherNavigation();

    if (!scannerDispo) return;

    let flux = null;
    let boucle = null;
    const arreter = () => {
      if (boucle) clearInterval(boucle);
      boucle = null;
      if (flux) flux.getTracks().forEach((t) => t.stop());
      flux = null;
      const zone = document.getElementById('zone-scanner');
      if (zone) zone.hidden = true;
      arreterScanner = null;
    };

    // Décode l'image de la caméra : jsQR sur une copie réduite de l'image
    // (rapide et fiable partout), sinon BarcodeDetector natif en secours.
    const tampon = document.createElement('canvas');
    const ctxTampon = tampon.getContext('2d', { willReadFrequently: true });
    let detecteurNatif = null;

    async function decoderImage(video) {
      if (window.jsQR) {
        const largeur = 640;
        const echelle = largeur / (video.videoWidth || largeur);
        tampon.width = largeur;
        tampon.height = Math.max(1, Math.round((video.videoHeight || largeur) * echelle));
        ctxTampon.drawImage(video, 0, 0, tampon.width, tampon.height);
        const image = ctxTampon.getImageData(0, 0, tampon.width, tampon.height);
        const code = window.jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });
        return code ? code.data : null;
      }
      if ('BarcodeDetector' in window) {
        if (!detecteurNatif) detecteurNatif = new BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detecteurNatif.detect(video);
        return codes.length ? codes[0].rawValue || null : null;
      }
      return null;
    }

    document.getElementById('bouton-stop-scanner').addEventListener('click', arreter);
    document.getElementById('bouton-scanner').addEventListener('click', async () => {
      const erreur = document.getElementById('erreur-scanner');
      erreur.hidden = true;
      try {
        flux = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        arreterScanner = arreter;
        const video = document.getElementById('video-scanner');
        video.srcObject = flux;
        await video.play();
        document.getElementById('zone-scanner').hidden = false;
        boucle = setInterval(async () => {
          try {
            if (video.readyState < 2) return;
            const brut = await decoderImage(video);
            if (!brut) return;
            let standId = null;
            try {
              standId = new URL(brut).searchParams.get('stand');
            } catch (_) {
              if (/^[A-Za-z0-9_-]+$/.test(brut)) standId = brut;
            }
            if (standId && /^[A-Za-z0-9_-]+$/.test(standId)) {
              arreter();
              vueStand(standId);
            }
          } catch (_) {
            /* image pas encore prête : on réessaie */
          }
        }, 350);
      } catch (_) {
        arreter();
        erreur.textContent =
          "L'accès à la caméra a été refusé ou est indisponible — utilisez l'appareil photo du téléphone sur le QR du stand.";
        erreur.hidden = false;
      }
    });
  }

  // ---------------------------------------------------------------- ateliers

  async function vueAteliers() {
    let ateliers = [];
    try {
      const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
      ateliers = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));
      ateliers.sort(
        (a, b) =>
          String(a.horaire || '').localeCompare(String(b.horaire || '')) ||
          String(a.salle || '').localeCompare(String(b.salle || '')),
      );
    } catch (_) {
      ateliers = [];
    }
    const mesVoeux = {};
    await Promise.all(
      ateliers.map(async (a) => {
        try {
          const d = await db.collection('voeux').doc(a.id + '_' + uid).get();
          mesVoeux[a.id] = d.exists;
        } catch (_) {
          mesVoeux[a.id] = false;
        }
      }),
    );
    const horairesInscrits = new Set(
      ateliers.filter((a) => mesVoeux[a.id]).map((a) => a.horaire || ''),
    );

    // Les inscriptions ne sont ouvertes que pendant l'Assemblée Générale.
    const ag = periodeAG();
    const pendantAG = !!ag && maintenant() >= ag.debut && maintenant() <= ag.fin;
    const apresAG = !!ag && maintenant() > ag.fin;
    const fmtHeure = (d) =>
      d.toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

    function htmlAtelier(a) {
      const inscrit = mesVoeux[a.id];
      let etat = '';
      let action = '';

      if (a.statut === 'tire') {
        const retenu = (a.retenus || []).some((r) => r.participantId === uid);
        const posAttente = (a.listeAttente || []).findIndex((r) => r.participantId === uid);
        if (retenu) {
          etat = `<div class="info">🎉 Vous êtes retenu pour cet atelier — rendez-vous salle ${echapper(a.salle)}, ${echapper(a.horaire || '')}.
            <span class="muet petit">Empêché ? Libérez votre place : elle sera
            aussitôt proposée à la personne suivante de la liste d'attente.</span></div>`;
          action = `<button class="secondaire bouton-liberer-place" data-id="${attr(a.id)}">Je libère ma place</button>`;
        } else if (posAttente >= 0) {
          etat = `<div class="info">Vous êtes en liste d'attente (position ${posAttente + 1}) : présentez-vous à la salle, une place peut se libérer.</div>`;
        } else if (inscrit) {
          etat = `<div class="muet petit">Le tirage au sort n'a pas pu vous retenir cette fois-ci.</div>`;
        } else {
          etat = `<div class="muet petit">Tirage au sort effectué.</div>`;
        }
      } else if (pendantAG) {
        if (inscrit) {
          etat = `<div class="info">✅ Inscription enregistrée — un tirage au sort départagera les inscrits.</div>`;
          action = `<button class="secondaire bouton-retrait-atelier" data-id="${attr(a.id)}">Me désinscrire</button>`;
        } else if (horairesInscrits.has(a.horaire || '')) {
          etat = `<div class="muet petit">Vous êtes déjà inscrit à un autre atelier sur ce créneau.</div>`;
        } else {
          action = `<button class="bouton-voeu-atelier" data-id="${attr(a.id)}">Je m'inscris à cet atelier</button>`;
        }
      } else if (apresAG) {
        // Après l'AG, l'écran d'inscription disparaît : seuls restent le
        // résultat du tirage et l'attente du tirage pour les inscrits.
        if (!inscrit) return '';
        etat = `<div class="muet petit">Inscriptions closes — le tirage au sort aura lieu prochainement.</div>`;
      } else {
        etat = `<div class="muet petit">Les inscriptions se feront pendant l'Assemblée
          Générale${ag ? ` (${echapper(fmtHeure(ag.debut))})` : ''}.</div>`;
      }

      return `<div class="q-item">
        <div class="q-entete">
          <span class="q-type">Salle ${echapper(a.salle)}</span>
          <span class="muet petit">${echapper(a.horaire || '')}</span>
        </div>
        <div><strong>${echapper(a.nom)}</strong></div>
        ${a.intervenants ? `<div class="muet petit">${echapper(a.intervenants)}</div>` : ''}
        ${etat}
        ${action ? `<div class="ligne-boutons">${action}</div>` : ''}
      </div>`;
    }

    const blocs = ateliers.map(htmlAtelier).join('');
    $app.innerHTML = `${barreRetour('🛠️ Inscription Atelier')}
        ${
          !ateliers.length
            ? `<p class="muet">Les ateliers seront présentés ici très prochainement.</p>`
            : `<p class="muet petit">Les inscriptions sont ouvertes
              <strong>pendant l'Assemblée Générale</strong>${
                ag ? ` (${echapper(fmtHeure(ag.debut))} — ${echapper(fmtHeure(ag.fin))})` : ''
              }. Les places étant limitées, elles
              sont départagées par tirage au sort, en donnant leur chance à
              toutes les blanchisseries et à chacun : on ne peut être retenu
              dans plusieurs ateliers que s'il reste des places.</p>
              ${
                'Notification' in window && Notification.permission === 'default'
                  ? `<div class="ligne-boutons">
                      <button id="bouton-notifs" class="secondaire">🔔 Activer les notifications</button>
                    </div>
                    <p class="muet petit">Soyez prévenu du résultat du tirage au
                    sort et recevez un rappel 10 minutes avant le début de votre
                    atelier, avec le numéro de la salle (tant que l'application
                    reste ouverte sur votre téléphone).</p>`
                  : ''
              }
              <div id="erreur-atelier" class="erreur" hidden></div>
              ${
                blocs.trim()
                  ? blocs
                  : `<p class="muet">Les inscriptions sont closes (l'Assemblée Générale
                      est terminée) — les résultats du tirage au sort s'afficheront ici.</p>`
              }`
        }
      </div>`;
    brancherNavigation();

    function erreurAtelier(texte) {
      const zone = document.getElementById('erreur-atelier');
      if (zone) {
        zone.textContent = texte;
        zone.hidden = false;
      }
    }

    const boutonNotifs = document.getElementById('bouton-notifs');
    if (boutonNotifs) {
      boutonNotifs.addEventListener('click', async () => {
        try {
          await Notification.requestPermission();
        } catch (_) {
          /* refusée ou indisponible */
        }
        vueMenu();
      });
    }

    document.querySelectorAll('.bouton-voeu-atelier').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await db
            .collection('voeux')
            .doc(b.dataset.id + '_' + uid)
            .set({
              atelierId: b.dataset.id,
              journeeId,
              participantId: uid,
              type: profil.type,
              nom: profil.nom,
              prenom: profil.prenom,
              organisme: profil.organisme || '',
              mobile: profil.mobile || '',
              numeroInscription: profil.numeroInscription || '',
              creeLe: new Date().toISOString(),
            });
          vueMenu();
        } catch (e) {
          erreurAtelier(
            "L'inscription n'a pas pu être enregistrée (inscriptions closes ou connexion instable). Réessayez." +
              detailErreur(e),
          );
          b.disabled = false;
        }
      }),
    );

    document.querySelectorAll('.bouton-retrait-atelier').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await db.collection('voeux').doc(b.dataset.id + '_' + uid).delete();
          vueMenu();
        } catch (_) {
          erreurAtelier('La désinscription a échoué (inscriptions closes ?).');
          b.disabled = false;
        }
      }),
    );

    // Un retenu libère sa place : il sort de la liste des retenus et le
    // premier de la liste d'attente est promu à sa place (il en est averti
    // par la notification de l'application, et l'administration reçoit son
    // mobile pour le prévenir par SMS). Définitif : pas de reprise de place.
    document.querySelectorAll('.bouton-liberer-place').forEach((b) =>
      b.addEventListener('click', async () => {
        if (
          !confirm(
            'Libérer votre place à cet atelier ? Elle sera aussitôt proposée à ' +
              'la personne suivante sur la liste d’attente — vous ne pourrez pas la reprendre.',
          )
        ) {
          return;
        }
        b.disabled = true;
        try {
          const ref = db.collection('ateliers').doc(b.dataset.id);
          const doc = await ref.get();
          if (!doc.exists) throw new Error('atelier introuvable');
          const a = doc.data();
          const retenusActuels = a.retenus || [];
          if (!retenusActuels.some((r) => r.participantId === uid)) {
            vueMenu();
            return;
          }
          const nouveauxRetenus = retenusActuels.filter((r) => r.participantId !== uid);
          const attente = [...(a.listeAttente || [])];
          const promu = attente.shift() || null;
          if (promu) nouveauxRetenus.push(promu);
          await ref.update({ retenus: nouveauxRetenus, listeAttente: attente });
          try {
            await db.collection('desistements').doc(b.dataset.id + '_' + uid).set({
              atelierId: b.dataset.id,
              journeeId,
              participantId: uid,
              nom: profil.nom,
              prenom: profil.prenom,
              organisme: profil.organisme || '',
              promuId: promu ? promu.participantId : '',
              promuNom: promu ? promu.nom || '' : '',
              promuPrenom: promu ? promu.prenom || '' : '',
              creeLe: new Date().toISOString(),
            });
          } catch (_) {
            /* trace facultative : la place est déjà libérée */
          }
          vueMenu();
        } catch (e) {
          erreurAtelier('La libération de la place a échoué. Réessayez.' + detailErreur(e));
          b.disabled = false;
        }
      }),
    );
  }

  // ----------------------------------------------------------------- tombola

  async function vueTombola() {
    try {
      const doc = await db.collection('portails').doc(journeeId).get();
      if (doc.exists) portail = doc.data();
    } catch (_) {
      /* on garde la version connue */
    }
    const tombolaInfo = portail.tombola || {};
    const lotsTombola = tombolaInfo.lots || [];
    const gagnantsTombola = tombolaInfo.gagnants || [];
    const pointagesOuverts = portail.pointages || {};
    // Tirage au sort de la journée, présenté sur le même écran.
    const tirageOuvert = !!(portail.tirage && portail.tirage.ouvert);
    const gagnantsTirage = (portail.tirage && portail.tirage.gagnants) || [];
    let participeTirage = false;
    try {
      const doc = await db.collection('tirage').doc(journeeId + '_' + uid).get();
      participeTirage = doc.exists;
    } catch (_) {
      /* pas encore de participation */
    }
    const mesPointages = {};
    await Promise.all(
      MOMENTS_POINTAGE.map(async (m) => {
        try {
          const d = await db
            .collection('pointages')
            .doc(journeeId + '_' + m.cle + '_' + uid)
            .get();
          mesPointages[m.cle] = d.exists ? d.data() : null;
        } catch (_) {
          mesPointages[m.cle] = null;
        }
      }),
    );

    // Condition supplémentaire : avoir répondu aux questionnaires de
    // satisfaction ouverts qui concernent le participant.
    let questionnairesAttendus = [];
    try {
      const snapQ = await db
        .collection('questionnaires')
        .where('journeeId', '==', journeeId)
        .where('statut', '==', 'ouvert')
        .get();
      questionnairesAttendus = snapQ.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((q) => !q.audience || q.audience === 'tous' || q.audience === profil.type);
    } catch (_) {
      questionnairesAttendus = [];
    }
    let nbRepondus = 0;
    await Promise.all(
      questionnairesAttendus.map(async (q) => {
        try {
          const doc = await db.collection('reponses').doc(q.id + '_' + uid).get();
          if (doc.exists) nbRepondus += 1;
        } catch (_) {
          /* pas encore de réponse */
        }
      }),
    );
    const questionnairesOk =
      questionnairesAttendus.length > 0 && nbRepondus === questionnairesAttendus.length;

    // Les membres du Conseil d'Administration ne participent pas à la
    // tombola (liste des N° d'inscription tenue par l'administration).
    const exclusCA = new Set((tombolaInfo.exclusCA || []).map(normaliserNumero));
    const membreCA = exclusCA.has(normaliserNumero(profil.numeroInscription));

    function htmlPoint(m) {
      const p = mesPointages[m.cle];
      if (p) {
        const quand = p.pointeLe
          ? ' — pointé le ' +
            new Date(p.pointeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
          : '';
        return `<li>✅ <strong>${echapper(m.libelle)}</strong><span class="muet petit">${echapper(quand)}</span></li>`;
      }
      if (pointagesOuverts[m.cle]) {
        return `<li>🟢 <strong>${echapper(m.libelle)}</strong>
          <div class="ligne-boutons"><button class="bouton-pointage" data-moment="${attr(m.cle)}">📍 Je pointe ma présence</button></div></li>`;
      }
      return `<li>⬜ <strong>${echapper(m.libelle)}</strong>
        <span class="muet petit"> — le pointage sera ouvert sur place, le moment venu.</span></li>`;
    }

    $app.innerHTML = `${barreRetour('🎟️ Tombola & tirage au sort')}
        ${
          lotsTombola.length
            ? `<ul class="verbatims">${lotsTombola
                .map((lot, i) => {
                  const g = gagnantsTombola.find((x) => x.lotIndex === i && !x.raye);
                  const rayes = gagnantsTombola.filter((x) => x.lotIndex === i && x.raye);
                  return `<li>🎁 <strong>${echapper(lot.libelle)}</strong>${
                    lot.fournisseurNom ? ` <span class="muet petit">— remis par ${echapper(lot.fournisseurNom)}</span>` : ''
                  }${rayes
                    .map((r) => `<br><s class="muet">🚫 ${echapper(r.prenom)} ${echapper(r.nom)} — absent, rayé</s>`)
                    .join('')}${
                    g
                      ? `<br>🏆 ${echapper(g.prenom)} ${echapper(g.nom)}${g.numeroInscription ? ' (carte n° ' + echapper(g.numeroInscription) + ')' : ''}${g.organisme ? ' — ' + echapper(g.organisme) : ''}`
                      : ''
                  }</li>`;
                })
                .join('')}</ul>`
            : `<p class="muet petit">Trois lots offerts par l'URBH, remis par les
                représentants des fournisseurs, seront tirés au sort à la
                clôture des journées.</p>`
        }
        <p class="muet petit"><strong>Pour participer :</strong> la tombola est
        réservée aux <strong>visiteurs blanchisseurs adhérents</strong> (les
        membres du Conseil d'Administration n'y participent pas). La
        <strong>présence dans la salle lors du tirage au sort</strong> est
        requise, la <strong>validation des points de présence</strong> est
        nécessaire — présence à l'Assemblée Générale et pointage à l'ouverture
        des journées sur la première conférence — et il faut avoir
        <strong>répondu aux questionnaires de satisfaction</strong> proposés.</p>
        ${
          membreCA
            ? `<div class="info">👥 Membre du Conseil d'Administration : vous ne
                participez pas à la tombola. Vos pointages restent utiles pour
                l'émargement, et les ateliers vous sont ouverts normalement.</div>`
            : profil.type === 'exposant'
              ? `<p class="muet petit">Vous êtes enregistré comme exposant
                  fournisseur : vos pointages servent d'émargement, mais la
                  tombola est réservée aux visiteurs blanchisseurs.</p>`
              : ''
        }
        <h3 style="margin-bottom:0.3rem">Mes points de présence</h3>
        <ul class="verbatims">${MOMENTS_POINTAGE.map(htmlPoint).join('')}
          ${
            questionnairesAttendus.length
              ? questionnairesOk
                ? `<li>✅ <strong>Questionnaire${questionnairesAttendus.length > 1 ? 's' : ''} de satisfaction</strong>
                    <span class="muet petit"> — répondu${questionnairesAttendus.length > 1 ? `s (${nbRepondus}/${questionnairesAttendus.length})` : ''}</span></li>`
                : `<li>🟠 <strong>Questionnaire${questionnairesAttendus.length > 1 ? 's' : ''} de satisfaction</strong>
                    <span class="muet petit"> — ${nbRepondus}/${questionnairesAttendus.length} répondu(s)</span>
                    <div class="ligne-boutons"><button class="lien-vue" data-vue="questionnaires">📝 Répondre maintenant</button></div></li>`
              : `<li>⬜ <strong>Questionnaire de satisfaction</strong>
                  <span class="muet petit"> — il sera proposé en fin de journées.</span></li>`
          }
        </ul>
        ${
          !membreCA &&
          profil.type !== 'exposant' &&
          mesPointages.ouverture &&
          mesPointages.ag &&
          mesPointages.tombola &&
          questionnairesOk
            ? `<div class="info">✅ Tous vos points sont validés et vos questionnaires
                sont remplis : vous participez à la tombola. Bonne chance !</div>`
            : ''
        }
        <div id="erreur-pointage" class="erreur" hidden></div>
        <h3>🎁 Tirage au sort de la journée</h3>
        ${
          gagnantsTirage.length
            ? `<p><strong>Résultats du tirage :</strong></p>
              <ul class="verbatims">${gagnantsTirage
                .map(
                  (gg) =>
                    `<li>🏆 ${echapper(gg.prenom)} ${echapper(gg.nom)}${gg.numeroInscription ? ' (carte n° ' + echapper(gg.numeroInscription) + ')' : ''}${gg.organisme ? ' — ' + echapper(gg.organisme) : ''}</li>`,
                )
                .join('')}</ul>`
            : ''
        }
        ${
          participeTirage
            ? `<div class="info">✅ Votre participation au tirage est enregistrée. Bonne chance !</div>`
            : tirageOuvert
              ? `<p class="muet petit">Tentez votre chance : une seule participation par personne.</p>
                <div class="ligne-boutons">
                  <button id="bouton-tirage">🎁 Je m'inscris au tirage au sort</button>
                </div>`
              : gagnantsTirage.length
                ? ''
                : `<p class="muet petit">Les inscriptions au tirage ne sont pas encore
                    ouvertes — repassez par ici pendant la journée !</p>`
        }
        <div id="erreur-tirage" class="erreur" hidden></div>
      </div>`;
    brancherNavigation();

    document.querySelectorAll('.bouton-pointage').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await db
            .collection('pointages')
            .doc(journeeId + '_' + b.dataset.moment + '_' + uid)
            .set({
              journeeId,
              moment: b.dataset.moment,
              participantId: uid,
              type: profil.type,
              nom: profil.nom,
              prenom: profil.prenom,
              organisme: profil.organisme || '',
              mobile: profil.mobile || '',
              numeroInscription: profil.numeroInscription || '',
              pointeLe: new Date().toISOString(),
            });
          vueMenu();
        } catch (e) {
          const erreur = document.getElementById('erreur-pointage');
          erreur.textContent =
            "Le pointage n'a pas pu être enregistré (pointage fermé ou connexion instable). Réessayez." +
            detailErreur(e);
          erreur.hidden = false;
          b.disabled = false;
        }
      }),
    );

    const boutonTirage = document.getElementById('bouton-tirage');
    if (boutonTirage) {
      boutonTirage.addEventListener('click', async () => {
        boutonTirage.disabled = true;
        try {
          await db
            .collection('tirage')
            .doc(journeeId + '_' + uid)
            .set({
              journeeId,
              participantId: uid,
              type: profil.type,
              nom: profil.nom,
              prenom: profil.prenom,
              organisme: profil.organisme || '',
              mobile: profil.mobile || '',
              numeroInscription: profil.numeroInscription || '',
              creeLe: new Date().toISOString(),
            });
          vueMenu();
        } catch (e) {
          const erreur = document.getElementById('erreur-tirage');
          erreur.textContent =
            "La participation n'a pas pu être enregistrée (tirage fermé ou connexion instable). Réessayez." +
            detailErreur(e);
          erreur.hidden = false;
          boutonTirage.disabled = false;
        }
      });
    }
  }

  // ---------------------------------------------------------- questionnaires

  async function vueQuestionnaires() {
    let questionnaires = [];
    try {
      const snap = await db
        .collection('questionnaires')
        .where('journeeId', '==', journeeId)
        .where('statut', '==', 'ouvert')
        .get();
      questionnaires = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((q) => !q.audience || q.audience === 'tous' || q.audience === profil.type);
    } catch (_) {
      questionnaires = [];
    }
    const dejaRepondu = {};
    await Promise.all(
      questionnaires.map(async (q) => {
        try {
          const doc = await db.collection('reponses').doc(q.id + '_' + uid).get();
          dejaRepondu[q.id] = doc.exists;
        } catch (_) {
          dejaRepondu[q.id] = false;
        }
      }),
    );

    $app.innerHTML = `${barreRetour('📝 Questionnaires')}
        ${
          questionnaires.length
            ? `<ul class="liste">${questionnaires
                .map(
                  (q) => `
                <li>
                  <div class="titre-item">${echapper(q.titre)}</div>
                  <div class="pousse">
                    ${
                      dejaRepondu[q.id]
                        ? '<span class="badge ouvert">✓ répondu</span>'
                        : `<a class="btn" href="repondre.html?id=${q.id}">Répondre</a>`
                    }
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucun questionnaire ouvert pour le moment — repassez par ici, notamment en fin de journée pour le questionnaire de satisfaction.</p>`
        }
      </div>`;
    brancherNavigation();
  }

  // --------------------------------------------------------------- démarrage

  // Après identification : passage sur un stand si on est arrivé par son QR,
  // sinon menu de choix.
  async function apresProfil() {
    await enregistrerInscription();
    surveillerAteliers();
    if (standDemande) vueStand(standDemande);
    else vueMenu();
  }

  // Barre de simulation (?simu=1) : ◀ ▶ fait défiler les phases de la
  // journée par rapport à la période d'AG paramétrée. Réservée à la mise au
  // point : seul l'affichage est décalé, pas l'heure des enregistrements.
  const PHASES_SIMU = ['⏱️ Temps réel', "Avant l'AG", "Pendant l'AG", "Après l'AG"];
  let phaseSimu = 0;

  function appliquerPhaseSimu() {
    const ag = periodeAG();
    let cible = null;
    if (ag) {
      if (phaseSimu === 1) cible = ag.debut.getTime() - 30 * 60000;
      if (phaseSimu === 2) cible = (ag.debut.getTime() + ag.fin.getTime()) / 2;
      if (phaseSimu === 3) cible = ag.fin.getTime() + 30 * 60000;
    }
    decalageSimu = cible == null ? 0 : cible - Date.now();
    const zone = document.getElementById('simu-phase');
    if (zone) {
      zone.textContent =
        PHASES_SIMU[phaseSimu] +
        (phaseSimu && !ag ? " (période d'AG non paramétrée)" : '');
    }
    if (profil && !standDemande) vueMenu();
  }

  function installerBarreSimu() {
    if (document.getElementById('barre-simu')) return;
    const barre = document.createElement('div');
    barre.id = 'barre-simu';
    barre.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;align-items:center;' +
      'justify-content:center;gap:0.6rem;padding:0.45rem 0.6rem;background:#1d4e89;color:#fff;' +
      'font-size:0.85rem;box-shadow:0 -2px 8px rgba(0,0,0,0.25)';
    barre.innerHTML = `
      <span>🧪 Simulation</span>
      <button id="simu-prec" style="font:inherit;padding:0.15rem 0.7rem;border-radius:6px;border:none;cursor:pointer">◀</button>
      <strong id="simu-phase" style="min-width:11rem;text-align:center">${PHASES_SIMU[0]}</strong>
      <button id="simu-suiv" style="font:inherit;padding:0.15rem 0.7rem;border-radius:6px;border:none;cursor:pointer">▶</button>`;
    document.body.appendChild(barre);
    document.body.style.paddingBottom = '3.2rem';
    document.getElementById('simu-prec').addEventListener('click', () => {
      phaseSimu = (phaseSimu + PHASES_SIMU.length - 1) % PHASES_SIMU.length;
      appliquerPhaseSimu();
    });
    document.getElementById('simu-suiv').addEventListener('click', () => {
      phaseSimu = (phaseSimu + 1) % PHASES_SIMU.length;
      appliquerPhaseSimu();
    });
  }

  async function demarrer() {
    const params = new URLSearchParams(location.search);
    const demande = params.get('e');
    const stand = params.get('stand');
    if (stand && /^[A-Za-z0-9_-]+$/.test(stand)) standDemande = stand;
    modeSimu = params.get('simu') === '1';

    try {
      if (demande && /^[A-Za-z0-9_-]+$/.test(demande)) {
        const doc = await db.collection('portails').doc(demande).get();
        if (doc.exists) {
          journeeId = doc.id;
          portail = doc.data();
        }
      } else {
        const snap = await db
          .collection('portails')
          .where('actif', '==', true)
          .limit(1)
          .get();
        if (!snap.empty) {
          journeeId = snap.docs[0].id;
          portail = snap.docs[0].data();
        }
      }
    } catch (_) {
      /* traité ci-dessous */
    }

    if (!portail) {
      message(
        `<h2>À très bientôt !</h2>
        <p>Aucune journée d'études n'est en cours pour le moment. Ce lien
        s'activera automatiquement le jour J — conservez-le !</p>`,
      );
      return;
    }

    // Bandeau sans redites : titre court (modifiable dans l'administration,
    // champ « Titre court du portail »), dates seules en dessous.
    const h1 = document.querySelector('header.appbar h1');
    if (h1) h1.textContent = portail.titreCourt || 'URBH — 41ème JE NANTES';
    $sousTitre.textContent = portail.date || '';

    if (modeSimu) installerBarreSimu();

    try {
      const doc = await db.collection('participants').doc(uid).get();
      if (doc.exists && doc.data().anonymiseLe) {
        // Données anonymisées : confirmation du traitement de la demande.
        profil = null;
        let traiteLe = doc.data().anonymiseLe;
        try {
          const dm = await db.collection('demandesAnonymisation').doc(uid).get();
          if (dm.exists && dm.data().traiteLe) traiteLe = dm.data().traiteLe;
        } catch (_) {
          /* sans gravité */
        }
        message(
          `<h2>✅ Données anonymisées</h2>
          <p>Votre demande a été traitée le
          <strong>${echapper(new Date(traiteLe).toLocaleDateString('fr-FR'))}</strong> :
          vos données personnelles ont été supprimées de l'application. Vos
          réponses aux questionnaires sont conservées de façon anonyme.</p>
          <div class="ligne-boutons">
            <button id="bouton-reinscription" class="secondaire">Me réinscrire</button>
          </div>`,
        );
        document.getElementById('bouton-reinscription').addEventListener('click', () => vueInscription());
        return;
      }
      if (doc.exists) {
        profil = doc.data();
        await apresProfil();
      } else {
        vueInscription();
      }
    } catch (_) {
      vueInscription();
    }
  }

  const piedVersion = document.getElementById('pied-version');
  if (piedVersion && window.APP_BUILD) piedVersion.textContent = ' — v' + window.APP_BUILD;

  // ------------------------------------------------- installation (PWA)
  // L'application s'installe sur l'écran d'accueil : bouton natif sur
  // Android/Chrome, mode d'emploi sur iPhone (Safari impose le geste manuel).

  // Sonde de version : interroge le serveur en contournant TOUS les caches
  // (argument t= unique + no-store). Si une version plus récente est en
  // ligne, la page se recharge une seule fois — le service worker, lui aussi
  // remis à neuf, resservira alors les fichiers frais.
  async function verifierVersion() {
    try {
      const rep = await fetch('js/firebase-config.js?t=' + Date.now(), { cache: 'no-store' });
      const texte = await rep.text();
      const m = texte.match(/APP_BUILD\s*=\s*(\d+)/);
      if (m && Number(m[1]) > (window.APP_BUILD || 0)) {
        const cle = 'urbh_rechargement_v' + m[1];
        if (!sessionStorage.getItem(cle)) {
          sessionStorage.setItem(cle, '1');
          if ('serviceWorker' in navigator) {
            try {
              const reg = await navigator.serviceWorker.getRegistration();
              if (reg) await reg.update();
            } catch (_) {
              /* sans gravité */
            }
          }
          location.reload();
        }
      }
    } catch (_) {
      /* hors ligne : sans gravité */
    }
  }
  verifierVersion();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {
      /* hors hébergement HTTPS : sans gravité */
    });
    // Dès qu'une nouvelle version de l'application prend la main (nouveau
    // service worker activé), la page se recharge toute seule : le téléphone
    // ne reste jamais bloqué sur une ancienne version.
    let dejaControle = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (dejaControle) location.reload();
      dejaControle = true;
    });
    // Au retour au premier plan (application rouverte depuis la mémoire du
    // téléphone), on vérifie qu'une mise à jour n'attend pas.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
        verifierVersion();
      }
    });
  }

  let promptInstallation = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstallation = e;
    majCarteInstallation();
  });

  function estInstallee() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function installationMasquee() {
    try {
      return localStorage.getItem('urbh_installation_masquee') === '1';
    } catch (_) {
      return false;
    }
  }

  function majCarteInstallation() {
    const zone = document.getElementById('carte-installation');
    if (!zone) return;
    if (estInstallee() || installationMasquee()) {
      zone.innerHTML = '';
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let corps;
    if (promptInstallation) {
      corps = `<div class="ligne-boutons">
        <button id="bouton-installer">📲 Installer l'application</button>
        <button id="bouton-masquer-installation" class="discret">plus tard</button>
      </div>`;
    } else if (ios) {
      corps = `<p class="muet petit">Sur iPhone : touchez <strong>Partager</strong>
        (carré avec une flèche) puis <strong>« Sur l'écran d'accueil »</strong>.
        <button id="bouton-masquer-installation" class="discret">masquer</button></p>`;
    } else {
      corps = `<p class="muet petit">Dans le menu du navigateur (⋮), choisissez
        <strong>« Installer l'application »</strong>.
        <button id="bouton-masquer-installation" class="discret">masquer</button></p>`;
    }
    zone.innerHTML = `<div class="carte">
      <h2>📲 Gardez l'application sous la main</h2>
      <p class="muet petit">Installez « JE URBH » sur votre écran d'accueil pour
      retrouver en un geste le programme, les ateliers et les questionnaires.</p>
      ${corps}
    </div>`;

    const boutonInstaller = document.getElementById('bouton-installer');
    if (boutonInstaller) {
      boutonInstaller.addEventListener('click', async () => {
        if (!promptInstallation) return;
        promptInstallation.prompt();
        await promptInstallation.userChoice;
        promptInstallation = null;
        majCarteInstallation();
      });
    }
    const boutonMasquer = document.getElementById('bouton-masquer-installation');
    if (boutonMasquer) {
      boutonMasquer.addEventListener('click', () => {
        try {
          localStorage.setItem('urbh_installation_masquee', '1');
        } catch (_) {
          /* sans gravité */
        }
        majCarteInstallation();
      });
    }
  }

  // Réutilise la session existante (participant déjà connu, ou administrateur
  // qui teste le portail) ; sinon crée une session anonyme liée à l'appareil.
  let demarre = false;
  auth.onAuthStateChanged((user) => {
    if (demarre) return;
    if (user) {
      demarre = true;
      uid = user.uid;
      demarrer();
    } else {
      auth.signInAnonymously().catch(() => {
        message(
          `<h2>Connexion impossible</h2>
          <p>Le portail n'a pas réussi à se connecter. Vérifiez votre connexion
          internet puis rechargez la page.</p>`,
        );
      });
    }
  });
})();
