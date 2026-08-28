// Formulaire public de réponse à un questionnaire.
// Anonyme : aucune donnée d'identification n'est collectée ni envoyée.

(function () {
  'use strict';

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
  const cleLocale = questionnaireId ? 'urbh_repondu_' + questionnaireId : null;

  if (!questionnaireId || !window.firebaseConfigEstRenseignee()) {
    montrer('indisponible');
    return;
  }

  let dejaRepondu = false;
  try {
    dejaRepondu = !!localStorage.getItem(cleLocale);
  } catch (_) {
    /* stockage local inaccessible (navigation privée) : on laisse répondre */
  }
  if (dejaRepondu) {
    montrer('deja-repondu');
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const db = firebase.firestore();

  let questionnaire = null;

  function htmlQuestion(q, index) {
    const nom = 'q_' + q.id;
    const etoile = q.obligatoire ? ' <span class="obligatoire">*</span>' : '';
    let corps = '';

    if (q.type === 'echelle4') {
      corps =
        '<div class="echelle">' +
        ECHELLE4.map(
          (lib, i) =>
            `<label><input type="radio" name="${nom}" value="${i + 1}">${echapper(lib)}</label>`,
        ).join('') +
        '</div>';
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

    return (
      `<div class="question" data-qid="${echapper(q.id)}" data-obligatoire="${q.obligatoire ? '1' : '0'}" data-type="${echapper(q.type)}">` +
      `<div class="libelle">${index}. ${echapper(q.libelle)}${etoile}</div>` +
      corps +
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
    let html = '';
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
            type === 'echelle4' || type === 'note10' ? Number(coche.value) : coche.value;
        }
      }

      const manquant = obligatoire && valeur === null;
      bloc.classList.toggle('invalide', manquant);
      if (manquant && !premierInvalide) premierInvalide = bloc;
      if (valeur !== null) valeurs[qid] = valeur;
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
      await db.collection('reponses').add({
        questionnaireId,
        journeeId: questionnaire.journeeId || '',
        soumisLe: firebase.firestore.FieldValue.serverTimestamp(),
        reponses: valeurs,
      });
      try {
        localStorage.setItem(cleLocale, new Date().toISOString());
      } catch (_) {
        /* stockage local indisponible : sans gravité */
      }
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

  db.collection('questionnaires')
    .doc(questionnaireId)
    .get()
    .then((doc) => {
      if (!doc.exists || doc.data().statut !== 'ouvert') {
        montrer('indisponible');
      } else {
        afficherFormulaire(doc.data());
      }
    })
    .catch(() => montrer('indisponible'));
})();
