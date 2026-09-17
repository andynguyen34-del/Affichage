// Formulaire de réponse à un questionnaire.
//
// Le participant arrive depuis le portail (portail.html), où il s'est
// présenté une fois : son téléphone porte une session anonyme Firebase.
// L'identifiant du document de réponse « <questionnaireId>_<uid> » garantit
// une seule réponse par personne et par questionnaire (règle serveur).
// Les réponses ne comportent ni nom ni e-mail : seulement le profil
// (visiteur / exposant) pour l'analyse des résultats.

(function () {
  'use strict';

  // Même règle que le portail : les participants vivent sur …web.app —
  // l'adresse jumelle …firebaseapp.com porte un stockage séparé.
  if (/^([A-Za-z0-9-]+)\.firebaseapp\.com$/.test(location.hostname)) {
    location.replace(
      'https://' +
        location.hostname.replace(/\.firebaseapp\.com$/, '.web.app') +
        location.pathname +
        location.search +
        location.hash,
    );
    return;
  }

  const ECHELLE4 = [
    'Très insatisfaisant',
    'Insatisfaisant',
    'Satisfaisant',
    'Très satisfaisant',
  ];

  const $ = (id) => document.getElementById(id);

  function montrer(id) {
    ['chargement', 'indisponible', 'deja-repondu', 'formulaire', 'merci'].forEach((x) => {
      $(x).hidden = x !== id;
    });
  }

  function echapper(texte) {
    const div = document.createElement('div');
    div.textContent = texte == null ? '' : String(texte);
    return div.innerHTML;
  }

  const params = new URLSearchParams(location.search);
  const questionnaireId = params.get('id');

  if (!questionnaireId || !/^[A-Za-z0-9_-]+$/.test(questionnaireId)) {
    montrer('indisponible');
    return;
  }

  // Sur Firebase Hosting, /__/firebase/init.js a déjà initialisé l'application
  // avec la configuration du projet ; sinon, repli sur firebase-config.js.
  if (!firebase.apps.length) {
    if (!window.firebaseConfigEstRenseignee()) {
      montrer('indisponible');
      return;
    }
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  let uid = null;
  let profil = null;
  let questionnaire = null;

  function htmlQuestion(q, index) {
    const nom = 'q_' + q.id;
    const etoile = q.obligatoire ? ' <span class="obligatoire">*</span>' : '';
    let corps = '';

    if (q.type === 'echelle4') {
      // Échelle officielle à 4 niveaux (documents Qualiopi), présentée en
      // 4 étoiles : le libellé du niveau choisi s'affiche sous les étoiles.
      const libelles = Array.isArray(q.libelles) && q.libelles.length === 4 ? q.libelles : ECHELLE4;
      corps =
        '<div class="note-etoiles" data-emojis="😞😕🙂🤩">' +
        libelles
          .map(
            (lib, i) =>
              `<label title="${echapper(lib)}"><input type="radio" name="${nom}"
                value="${i + 1}" data-libelle="${echapper(lib)}"><span>★</span></label>`,
          )
          .join('') +
        '<span class="emoji-note" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="libelle-note muet petit"></div>';
    } else if (q.type === 'note5') {
      // Note de 1 à 5, en 5 étoiles.
      corps =
        '<div class="note-etoiles" data-emojis="😞😕🙂😃🤩">' +
        Array.from(
          { length: 5 },
          (_, i) =>
            `<label title="${i + 1} / 5"><input type="radio" name="${nom}"
              value="${i + 1}" data-libelle="${i + 1} / 5"><span>★</span></label>`,
        ).join('') +
        '<span class="emoji-note" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="libelle-note muet petit"></div>';
    } else if (q.type === 'note10') {
      corps =
        '<div class="note10">' +
        Array.from({ length: 11 }, (_, i) =>
          `<label><input type="radio" name="${nom}" value="${i}">${i}</label>`,
        ).join('') +
        '</div>';
    } else if (q.type === 'ouinon') {
      corps =
        '<div class="ouinon">' +
        ['Oui', 'Non']
          .map((lib) => `<label><input type="radio" name="${nom}" value="${lib}">${lib}</label>`)
          .join('') +
        '</div>';
    } else if (q.type === 'choix') {
      corps =
        '<div class="choix-liste">' +
        (q.options || [])
          .map(
            (opt) =>
              `<label><input type="radio" name="${nom}" value="${echapper(opt)}">${echapper(opt)}</label>`,
          )
          .join('') +
        '</div>';
    } else {
      corps = `<textarea name="${nom}" maxlength="2000" placeholder="Votre réponse…"></textarea>`;
    }

    // Sous chaque question à cocher : possibilité d'ouvrir un champ pour
    // laisser un commentaire CIBLÉ sur la question posée (facultatif).
    const commentaire =
      q.type === 'texte'
        ? ''
        : `<div class="commentaire-question">
            <button type="button" class="discret ouvrir-commentaire">💬 Ajouter un commentaire sur cette question</button>
            <textarea class="texte-commentaire" maxlength="1000" hidden
              placeholder="Votre commentaire (facultatif) — astuce : le micro 🎤 du clavier de votre smartphone permet de le dicter."></textarea>
          </div>`;

    return (
      `<div class="question" data-qid="${echapper(q.id)}" data-obligatoire="${q.obligatoire ? '1' : '0'}" data-type="${echapper(q.type)}">` +
      `<div class="libelle">${index}. ${echapper(q.libelle)}${etoile}</div>` +
      corps +
      commentaire +
      '<div class="question-erreur">Merci de répondre à cette question.</div>' +
      '</div>'
    );
  }

  function afficherFormulaire(data) {
    questionnaire = data;
    $('titre-questionnaire').textContent = data.titre || 'Questionnaire de satisfaction';
    const contexte = [data.journeeTitre, data.journeeDate, data.journeeLieu]
      .filter(Boolean)
      .join(' — ');
    $('contexte-journee').textContent = contexte;

    const zone = $('zone-questions');
    let html = `<div class="info">💬 N'hésitez pas à laisser vos commentaires
      sous les questions — <strong>ASTUCE</strong> : activez la fonction
      dictaphone (micro 🎤 du clavier) de votre smartphone pour les dicter 😊</div>`;
    let sectionCourante = null;
    let numero = 0;
    (data.questions || []).forEach((q) => {
      if (q.section && q.section !== sectionCourante) {
        sectionCourante = q.section;
        html += `<div class="section-titre">${echapper(q.section)}</div>`;
      }
      numero += 1;
      html += htmlQuestion(q, numero);
    });
    zone.innerHTML = html;
    zone.querySelectorAll('.ouvrir-commentaire').forEach((b) =>
      b.addEventListener('click', () => {
        const champ = b.parentElement.querySelector('.texte-commentaire');
        champ.hidden = false;
        b.hidden = true;
        champ.focus();
      }),
    );

    // Étoiles : émoji de réaction et libellé du niveau choisi.
    zone.querySelectorAll('.note-etoiles').forEach((blocEtoiles) => {
      const emojis = [...(blocEtoiles.dataset.emojis || '')];
      blocEtoiles.querySelectorAll('input').forEach((entree, i) =>
        entree.addEventListener('change', () => {
          const emoji = blocEtoiles.querySelector('.emoji-note');
          if (emoji) {
            emoji.textContent = emojis[i] || '';
            emoji.classList.remove('pop');
            void emoji.offsetWidth; // relance l'animation
            emoji.classList.add('pop');
          }
          const libelle = blocEtoiles.parentElement.querySelector('.libelle-note');
          if (libelle) libelle.textContent = entree.dataset.libelle || '';
        }),
      );
    });

    // Barre de progression ludique : suit les réponses en temps réel.
    const progression = document.createElement('div');
    progression.id = 'progression-questions';
    progression.innerHTML =
      '<div class="jauge"><div class="remplie"></div></div><span class="etat"></span>';
    zone.prepend(progression);
    const blocsQuestions = [...zone.querySelectorAll('.question')];
    function majProgression() {
      const repondu = blocsQuestions.filter((bloc) => {
        const champTexte = bloc.dataset.type === 'texte' ? bloc.querySelector('textarea') : null;
        if (champTexte) return champTexte.value.trim() !== '';
        return !!bloc.querySelector('input:checked');
      }).length;
      const total = blocsQuestions.length;
      progression.querySelector('.remplie').style.width =
        (total ? Math.round((repondu / total) * 100) : 0) + '%';
      progression.querySelector('.etat').textContent =
        repondu === total && total ? `🎉 ${repondu}/${total}` : `🌟 ${repondu}/${total}`;
    }
    zone.addEventListener('change', majProgression);
    zone.addEventListener('input', majProgression);
    majProgression();

    montrer('formulaire');
  }

  function lireReponses() {
    const valeurs = {};
    let premierInvalide = null;

    document.querySelectorAll('#zone-questions .question').forEach((bloc) => {
      const qid = bloc.dataset.qid;
      const obligatoire = bloc.dataset.obligatoire === '1';
      const type = bloc.dataset.type;
      let valeur = null;

      if (type === 'texte') {
        const texte = bloc.querySelector('textarea').value.trim();
        if (texte) valeur = texte.slice(0, 2000);
      } else {
        const coche = bloc.querySelector('input:checked');
        if (coche) {
          valeur =
            type === 'echelle4' || type === 'note5' || type === 'note10'
              ? Number(coche.value)
              : coche.value;
        }
      }

      const manquant = obligatoire && valeur === null;
      bloc.classList.toggle('invalide', manquant);
      if (manquant && !premierInvalide) premierInvalide = bloc;
      if (valeur !== null) valeurs[qid] = valeur;

      // Commentaire ciblé sur la question (facultatif), rangé sous la clé
      // « <question>__commentaire » de la même carte de réponses.
      const champCommentaire = bloc.querySelector('.texte-commentaire');
      if (champCommentaire) {
        const commentaire = champCommentaire.value.trim();
        if (commentaire) valeurs[qid + '__commentaire'] = commentaire.slice(0, 1000);
      }
    });

    return { valeurs, premierInvalide };
  }

  $('formulaire').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const { valeurs, premierInvalide } = lireReponses();
    const erreur = $('erreur-envoi');
    erreur.hidden = true;

    if (premierInvalide) {
      premierInvalide.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const bouton = $('bouton-envoyer');
    bouton.disabled = true;
    bouton.textContent = 'Envoi en cours…';

    try {
      await db
        .collection('reponses')
        .doc(questionnaireId + '_' + uid)
        .set({
          questionnaireId,
          journeeId: questionnaire.journeeId || '',
          participantId: uid,
          participantType: (profil && profil.type) || 'visiteur',
          soumisLe: firebase.firestore.FieldValue.serverTimestamp(),
          reponses: valeurs,
        });
      montrer('merci');
      window.scrollTo(0, 0);
    } catch (e) {
      erreur.textContent =
        "L'envoi a échoué. Vérifiez votre connexion internet puis réessayez. " +
        'Si le problème persiste, le questionnaire est peut-être clôturé.';
      erreur.hidden = false;
      bouton.disabled = false;
      bouton.textContent = 'Envoyer mes réponses';
    }
  });

  async function demarrer() {
    // Le participant doit s'être présenté sur le portail au préalable.
    let profilDoc = null;
    try {
      profilDoc = await db.collection('participants').doc(uid).get();
    } catch (_) {
      /* traité ci-dessous */
    }
    if (!profilDoc || !profilDoc.exists) {
      location.replace('portail.html');
      return;
    }
    profil = profilDoc.data();

    // Déjà répondu ? (le document de réponse porte un identifiant prévisible)
    try {
      const dejaDoc = await db.collection('reponses').doc(questionnaireId + '_' + uid).get();
      if (dejaDoc.exists) {
        montrer('deja-repondu');
        return;
      }
    } catch (_) {
      /* pas encore de réponse */
    }

    try {
      const doc = await db.collection('questionnaires').doc(questionnaireId).get();
      if (!doc.exists || doc.data().statut !== 'ouvert') {
        montrer('indisponible');
        return;
      }
      const donnees = doc.data();
      // Questionnaire « Administrateurs uniquement » : réservé aux comptes
      // de l'équipe d'organisation (mêmes comptes que le sélecteur de
      // vision 🧪 du portail), même pendant la phase de test.
      if (donnees.audience === 'admin') {
        const nom = String(profil.nom || '').trim().toUpperCase();
        const prenom = String(profil.prenom || '').trim().toUpperCase();
        const equipe =
          ['NGUYEN', 'GIMBRE', 'TROUVAIN', 'JOURDAN', 'DIALLO'].includes(nom) ||
          prenom === 'YVES';
        if (!equipe) {
          const zone = $('indisponible');
          if (zone) {
            zone.innerHTML =
              '<h2>Questionnaire réservé</h2><p>Ce questionnaire est en cours de ' +
              "préparation par l'équipe d'organisation.</p>";
          }
          montrer('indisponible');
          return;
        }
      }
      // Questionnaire d'atelier : réservé aux personnes RETENUES pour un
      // atelier dont le nom contient le motif — inutile de questionner les
      // autres.
      // Phase de test : l'administration peut ouvrir tous les
      // questionnaires à tout le monde (interrupteur sur le portail).
      let pourTous = false;
      try {
        if (donnees.journeeId) {
          const p = await db.collection('portails').doc(donnees.journeeId).get();
          pourTous = !!(p.exists && p.data().questionnairesPourTous);
        }
      } catch (_) {
        pourTous = false;
      }
      if (donnees.reserveAtelier && !pourTous) {
        let retenu = false;
        try {
          const snapA = await db
            .collection('ateliers')
            .where('journeeId', '==', donnees.journeeId || '')
            .get();
          const motif = String(donnees.reserveAtelier).toLowerCase();
          retenu = snapA.docs.some((d) => {
            const a = d.data();
            return (
              (a.nom || '').toLowerCase().includes(motif) &&
              (a.retenus || []).some((r) => r.participantId === uid)
            );
          });
        } catch (_) {
          retenu = false;
        }
        if (!retenu) {
          const zone = $('indisponible');
          if (zone) {
            zone.innerHTML =
              '<h2>Questionnaire réservé</h2><p>Ce questionnaire concerne uniquement ' +
              "les participants retenus pour l'atelier correspondant.</p>";
          }
          montrer('indisponible');
          return;
        }
      }
      afficherFormulaire(donnees);
    } catch (_) {
      montrer('indisponible');
    }
  }

  let demarre = false;
  auth.onAuthStateChanged((user) => {
    if (demarre) return;
    if (user) {
      demarre = true;
      uid = user.uid;
      demarrer();
    } else {
      auth.signInAnonymously().catch(() => montrer('indisponible'));
    }
  });
})();
