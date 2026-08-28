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

  if (!window.firebaseConfigEstRenseignee()) {
    message(
      "<h2>Portail en préparation</h2><p>Le site n'est pas encore configuré. Revenez un peu plus tard !</p>",
    );
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let uid = null;
  let journeeId = null;
  let portail = null;
  let profil = null;

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
          <label class="champ">Mobile *
            <input id="p-mobile" type="tel" required autocomplete="tel"
              placeholder="06 12 34 56 78"
              pattern="[0-9+][0-9 .-]{8,16}"></label>
          <label class="champ">E-mail (facultatif)
            <input id="p-email" type="email" autocomplete="email"></label>
          <div class="ligne-boutons">
            <button type="submit" id="p-valider">C'est parti !</button>
          </div>
          <p class="muet petit">Votre mobile sert à vous prévenir si vous gagnez
          au tirage au sort et à vous envoyer certains résultats par SMS. Ces
          informations restent internes à l'URBH et ne sont jamais transmises à
          des tiers.</p>
        </form>
      </div>`;

    document.getElementById('form-profil').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const type = (document.querySelector('input[name="p-type"]:checked') || {}).value;
      const nouveau = {
        type,
        prenom: document.getElementById('p-prenom').value.trim(),
        nom: document.getElementById('p-nom').value.trim(),
        organisme: document.getElementById('p-organisme').value.trim(),
        numeroInscription: document.getElementById('p-numero').value.trim(),
        mobile: document.getElementById('p-mobile').value.trim(),
        email: document.getElementById('p-email').value.trim(),
        creeLe: profil && profil.creeLe ? profil.creeLe : new Date().toISOString(),
        majLe: new Date().toISOString(),
      };
      const bouton = document.getElementById('p-valider');
      bouton.disabled = true;
      try {
        await db.collection('participants').doc(uid).set(nouveau);
        profil = nouveau;
        await enregistrerInscription();
        vueMenu();
      } catch (e) {
        vueInscription("L'enregistrement a échoué. Vérifiez votre connexion puis réessayez.");
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
      creeLe,
      dernierAccesLe: new Date().toISOString(),
      nbAcces: firebase.firestore.FieldValue.increment(1),
    });
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
              toutes les blanchisseries.</p>
              <div id="erreur-atelier" class="erreur" hidden></div>
              ${ateliers.map(htmlAtelier).join('')}
            </div>`
          : ''
      }

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
        } catch (_) {
          erreurAtelier(
            "L'inscription n'a pas pu être enregistrée (inscriptions closes ou connexion instable). Réessayez.",
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
            "La participation n'a pas pu être enregistrée (tirage fermé ou connexion instable). Réessayez.";
          erreur.hidden = false;
          boutonTirage.disabled = false;
        }
      });
    }
  }

  // --------------------------------------------------------------- démarrage

  async function demarrer() {
    const params = new URLSearchParams(location.search);
    const demande = params.get('e');

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
      if (doc.exists) {
        profil = doc.data();
        await enregistrerInscription();
        vueMenu();
      } else {
        vueInscription();
      }
    } catch (_) {
      vueInscription();
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
