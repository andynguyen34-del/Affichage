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

  let uid = null;
  let journeeId = null;
  let portail = null;
  let profil = null;
  let standDemande = null; // arrivée par le QR d'un stand (?stand=<id>)

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
          </div>
          <p class="muet petit">✔️ En validant, vous confirmez l'exactitude de
          ces informations : elles serviront à <strong>mettre à jour l'annuaire
          de l'association</strong> — corrigez-les si besoin avant de valider.
          Votre mobile sert à vous prévenir si vous gagnez au tirage au sort et
          à vous envoyer certains résultats par SMS. Hors consentement
          ci-dessus, ces informations restent internes à l'URBH.</p>
        </form>
      </div>`;

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

  // Enregistre (ou met à jour) la présence à la journée, en traçant chaque
  // passage sur le portail : dernier accès et nombre d'accès.
  async function enregistrerInscription() {
    const ref = db.collection('inscriptions').doc(journeeId + '_' + uid);
    let creeLe = new Date().toISOString();
    try {
      const existant = await ref.get();
      if (existant.exists && existant.data().creeLe) creeLe = existant.data().creeLe;
    } catch (_) {
      /* première visite */
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

  function retourMenu() {
    standDemande = null;
    try {
      history.replaceState(null, '', location.pathname);
    } catch (_) {
      /* sans gravité */
    }
    vueMenu();
  }

  // -------------------------------------------------------------------- menu

  async function vueMenu() {
    // État personnel : déjà inscrit au tirage ? questionnaires déjà remplis ?
    const tirageOuvert = !!(portail.tirage && portail.tirage.ouvert);
    const gagnants = (portail.tirage && portail.tirage.gagnants) || [];

    let participeTirage = false;
    if (tirageOuvert || gagnants.length) {
      try {
        const doc = await db.collection('tirage').doc(journeeId + '_' + uid).get();
        participeTirage = doc.exists;
      } catch (_) {
        /* pas encore de participation */
      }
    }

    // Ateliers soumis à inscription puis tirage au sort.
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

    function htmlAtelier(a) {
      const inscrit = mesVoeux[a.id];
      let etat = '';
      let action = '';

      if (a.statut === 'tire') {
        const retenu = (a.retenus || []).some((r) => r.participantId === uid);
        const posAttente = (a.listeAttente || []).findIndex((r) => r.participantId === uid);
        if (retenu) {
          etat = `<div class="info">🎉 Vous êtes retenu pour cet atelier — rendez-vous salle ${echapper(a.salle)}, ${echapper(a.horaire || '')}.</div>`;
        } else if (posAttente >= 0) {
          etat = `<div class="info">Vous êtes en liste d'attente (position ${posAttente + 1}) : présentez-vous à la salle, une place peut se libérer.</div>`;
        } else if (inscrit) {
          etat = `<div class="muet petit">Le tirage au sort n'a pas pu vous retenir cette fois-ci.</div>`;
        } else {
          etat = `<div class="muet petit">Tirage au sort effectué.</div>`;
        }
      } else if (a.statut === 'inscriptions_ouvertes') {
        if (inscrit) {
          etat = `<div class="info">✅ Inscription enregistrée — un tirage au sort départagera les inscrits.</div>`;
          action = `<button class="secondaire bouton-retrait-atelier" data-id="${attr(a.id)}">Me désinscrire</button>`;
        } else if (horairesInscrits.has(a.horaire || '')) {
          etat = `<div class="muet petit">Vous êtes déjà inscrit à un autre atelier sur ce créneau.</div>`;
        } else {
          action = `<button class="bouton-voeu-atelier" data-id="${attr(a.id)}">Je m'inscris à cet atelier</button>`;
        }
      } else {
        etat = inscrit
          ? `<div class="muet petit">Inscriptions closes — le tirage au sort aura lieu prochainement.</div>`
          : `<div class="muet petit">Les inscriptions ne sont pas ouvertes.</div>`;
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

    // Exposants et passages sur les stands.
    let fournisseurs = [];
    try {
      const snapF = await db
        .collection('fournisseurs')
        .where('journeeId', '==', journeeId)
        .get();
      fournisseurs = snapF.docs.map((d) => ({ id: d.id, ...d.data() }));
      fournisseurs.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    } catch (_) {
      fournisseurs = [];
    }
    let standsVisites = new Set();
    try {
      const snapMv = await db
        .collection('visites')
        .where('participantId', '==', uid)
        .get();
      standsVisites = new Set(
        snapMv.docs.map((d) => d.data()).filter((v) => v.journeeId === journeeId).map((v) => v.fournisseurId),
      );
    } catch (_) {
      standsVisites = new Set();
    }

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
      return (
        '<ul class="liste">' +
        retenus
          .map(
            (f) => `<li>
              <div>
                <span class="titre-item">${echapper(f.nom)}</span>
                ${f.stand ? `<span class="muet petit"> — Stand ${echapper(f.stand)}</span>` : ''}
                ${standsVisites.has(f.id) ? '<span class="badge ouvert">✓ visité</span>' : ''}
                ${f.description ? `<div class="muet petit">${echapper(f.description)}</div>` : ''}
              </div>
            </li>`,
          )
          .join('') +
        '</ul>'
      );
    }

    // Demande d'anonymisation éventuelle du participant.
    let demandeAnonymisation = null;
    try {
      const dm = await db.collection('demandesAnonymisation').doc(uid).get();
      if (dm.exists) demandeAnonymisation = dm.data();
    } catch (_) {
      demandeAnonymisation = null;
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

    $app.innerHTML = `
      <div class="carte">
        <h2>Bonjour ${echapper(profil.prenom)} !</h2>
        <p class="muet">${profil.type === 'exposant' ? 'Exposant fournisseur' : 'Visiteur blanchisseur'}${
          profil.organisme ? ' — ' + echapper(profil.organisme) : ''
        }
          <button id="bouton-profil" class="discret">modifier</button></p>
      </div>

      <div class="carte">
        <h2>🎁 Tirage au sort</h2>
        ${
          gagnants.length
            ? `<p><strong>Résultats du tirage :</strong></p>
              <ul class="verbatims">${gagnants
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
              ? `<p>Tentez votre chance : une seule participation par personne.</p>
                <div class="ligne-boutons">
                  <button id="bouton-tirage" class="btn-menu">🎁 Je participe au tirage au sort</button>
                </div>`
              : gagnants.length
                ? ''
                : `<p class="muet">Les participations ne sont pas encore ouvertes — repassez par ici pendant la journée !</p>`
        }
        <div id="erreur-tirage" class="erreur" hidden></div>
      </div>

      ${
        ateliers.length
          ? `<div class="carte">
              <h2>🛠️ Ateliers</h2>
              <p class="muet petit">Les places étant limitées, les inscriptions
              sont départagées par tirage au sort, en donnant leur chance à
              toutes les blanchisseries et à chacun : on ne peut être retenu
              dans plusieurs ateliers que s'il reste des places.</p>
              <div id="erreur-atelier" class="erreur" hidden></div>
              ${ateliers.map(htmlAtelier).join('')}
            </div>`
          : ''
      }

      ${
        fournisseurs.length
          ? `<div class="carte">
              <h2>🏭 Exposants${standsVisites.size ? ` <span class="badge ouvert">${standsVisites.size} stand${standsVisites.size > 1 ? 's' : ''} visité${standsVisites.size > 1 ? 's' : ''}</span>` : ''}</h2>
              <p class="muet petit">Scannez le QR code affiché sur un stand pour
              enregistrer votre passage et laisser vos coordonnées au fournisseur.</p>
              <input id="recherche-exposant" placeholder="🔍 Rechercher un fournisseur, un stand…"
                style="width:100%;font:inherit;padding:0.5rem 0.6rem;border:1px solid var(--bord);border-radius:8px;margin-bottom:0.6rem">
              <div id="liste-exposants">${htmlExposants('')}</div>
            </div>`
          : ''
      }

      <div class="carte">
        <h2>🔐 Mes données</h2>
        <p class="muet petit">
          Partage de mes coordonnées avec les fournisseurs visités :
          <strong>${profil.consentementPartage ? 'accepté' : 'refusé'}</strong>
          (modifiable via « modifier » en haut de page). Mes informations
          validées servent à mettre à jour l'annuaire de l'association.
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
      </div>

      <div id="carte-installation"></div>

      <div class="carte">
        <h2>📝 Questionnaires</h2>
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

    majCarteInstallation();

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
          vueMenu();
        } catch (e) {
          const erreur = document.getElementById('erreur-anonymisation');
          erreur.textContent = "La demande n'a pas pu être enregistrée." + detailErreur(e);
          erreur.hidden = false;
          boutonAnonymisation.disabled = false;
        }
      });
    }

    const champRecherche = document.getElementById('recherche-exposant');
    if (champRecherche) {
      champRecherche.addEventListener('input', () => {
        document.getElementById('liste-exposants').innerHTML = htmlExposants(champRecherche.value);
      });
    }

    document.getElementById('bouton-profil').addEventListener('click', () => {
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

    function erreurAtelier(texte) {
      const zone = document.getElementById('erreur-atelier');
      if (zone) {
        zone.textContent = texte;
        zone.hidden = false;
      }
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

  // --------------------------------------------------------------- démarrage

  // Après identification : passage sur un stand si on est arrivé par son QR,
  // sinon menu de choix.
  async function apresProfil() {
    await enregistrerInscription();
    if (standDemande) vueStand(standDemande);
    else vueMenu();
  }

  async function demarrer() {
    const params = new URLSearchParams(location.search);
    const demande = params.get('e');
    const stand = params.get('stand');
    if (stand && /^[A-Za-z0-9_-]+$/.test(stand)) standDemande = stand;

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

    $sousTitre.textContent = [portail.titre, portail.date, portail.lieu]
      .filter(Boolean)
      .join(' — ');

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* hors hébergement HTTPS : sans gravité */
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
