// Administration des questionnaires de satisfaction des journées d'études URBH.
// Application sans étape de build : rendu HTML + Firestore directement.

(function () {
  'use strict';

  const $app = document.getElementById('app');
  const ECHELLE4 = window.ECHELLE4_LIBELLES;
  const MODELES = window.MODELES_QUESTIONNAIRES;

  const TYPES_QUESTION = {
    echelle4: 'Échelle de satisfaction (1 à 4)',
    note10: 'Note de 0 à 10',
    ouinon: 'Oui / Non',
    choix: 'Choix dans une liste',
    texte: 'Réponse libre',
  };

  let db = null;
  let auth = null;
  let utilisateur = null;
  let estAdmin = false;

  // ---------------------------------------------------------------- utilitaires

  function echapper(texte) {
    const div = document.createElement('div');
    div.textContent = texte == null ? '' : String(texte);
    return div.innerHTML;
  }

  function attr(texte) {
    return echapper(texte).replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [a, m, j] = String(iso).split('-');
    if (!a || !m || !j) return String(iso);
    return `${j}/${m}/${a}`;
  }

  function fmtHorodatage(ts) {
    const d = ts && ts.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function idAleatoire() {
    return 'q_' + Math.random().toString(36).slice(2, 10);
  }

  function pourcent(part, total) {
    if (!total) return '—';
    return Math.round((part / total) * 100) + ' %';
  }

  function badgeStatut(statut) {
    const libelles = { brouillon: 'Brouillon', ouvert: 'Ouvert', ferme: 'Clôturé' };
    return `<span class="badge ${attr(statut)}">${libelles[statut] || statut}</span>`;
  }

  function urlPublique(questionnaireId) {
    return `${location.origin}${location.pathname.replace(/index\.html$/, '').replace(/\/$/, '')}/repondre.html?id=${questionnaireId}`;
  }

  // ------------------------------------------------------------------ écrans fixes

  function vueConfigManquante() {
    $app.innerHTML = `
      <div class="carte">
        <h2>Configuration Firebase manquante</h2>
        <p>Le fichier <code>public/js/firebase-config.js</code> contient encore les
        valeurs d'exemple. Renseignez-y la configuration de votre projet Firebase
        (console Firebase → Paramètres du projet → Vos applications), puis
        redéployez le site. La marche à suivre complète est dans le
        <code>README.md</code> de l'application.</p>
      </div>`;
  }

  function vueConnexion(message) {
    $app.innerHTML = `
      <div class="carte boite-connexion">
        <h2>Connexion</h2>
        <p class="muet">Accès réservé aux organisateurs des journées d'études URBH.</p>
        ${message ? `<div class="erreur">${echapper(message)}</div>` : ''}
        <form id="form-connexion">
          <label class="champ">Adresse e-mail
            <input type="email" id="connexion-email" autocomplete="username" required>
          </label>
          <label class="champ">Mot de passe
            <input type="password" id="connexion-mdp" autocomplete="current-password" required>
          </label>
          <div class="ligne-boutons">
            <button type="submit">Se connecter</button>
          </div>
        </form>
      </div>`;

    document.getElementById('form-connexion').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      try {
        await auth.signInWithEmailAndPassword(
          document.getElementById('connexion-email').value.trim(),
          document.getElementById('connexion-mdp').value,
        );
      } catch (e) {
        vueConnexion('Connexion refusée : identifiants incorrects.');
      }
    });
  }

  function vueNonAutorise() {
    $app.innerHTML = `
      <div class="carte boite-connexion">
        <h2>Accès non autorisé</h2>
        <p>Le compte <strong>${echapper(utilisateur.email)}</strong> n'est pas dans la
        liste des administrateurs (document <code>config/admins</code> de Firestore).</p>
        <p class="muet">Un administrateur existant — ou vous-même depuis la console
        Firebase — peut ajouter cette adresse au champ <code>emails</code> de ce
        document.</p>
      </div>`;
  }

  function vueErreur(e) {
    $app.innerHTML = `
      <div class="carte">
        <h2>Erreur</h2>
        <p>${echapper(e && e.message ? e.message : e)}</p>
        <p><a href="#/journees">Retour aux journées d'études</a></p>
      </div>`;
  }

  // ------------------------------------------------------------------ journées

  async function chargerJournees() {
    const snap = await db.collection('journees').get();
    const journees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    journees.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return journees;
  }

  async function vueListeJournees() {
    const journees = await chargerJournees();

    $app.innerHTML = `
      <div class="carte">
        <h2>Journées d'études</h2>
        ${
          journees.length
            ? `<ul class="liste">${journees
                .map(
                  (j) => `
                <li>
                  <div>
                    <a class="titre-item" href="#/journee/${j.id}">${echapper(j.titre)}</a>
                    <div class="muet">${fmtDate(j.date)}${j.lieu ? ' — ' + echapper(j.lieu) : ''}</div>
                  </div>
                  <div class="pousse">
                    <a class="btn secondaire" href="#/journee/${j.id}">Ouvrir</a>
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucune journée d'études pour le moment. Créez la première ci-dessous.</p>`
        }
      </div>

      <div class="carte">
        <h2>Nouvelle journée d'études</h2>
        <form id="form-journee">
          <label class="champ">Titre *
            <input id="j-titre" required placeholder="Ex. : 34es Journées d'études de l'URBH">
          </label>
          <label class="champ">Date *
            <input id="j-date" type="date" required>
          </label>
          <label class="champ">Lieu
            <input id="j-lieu" placeholder="Ville, établissement…">
          </label>
          <label class="champ">Nombre de participants attendus
            <input id="j-participants" type="number" min="0" step="1"
              placeholder="Sert au calcul du taux de réponse">
          </label>
          <label class="champ">Description / programme (facultatif)
            <textarea id="j-description"></textarea>
          </label>
          <div class="ligne-boutons">
            <button type="submit">Créer la journée</button>
          </div>
        </form>
      </div>`;

    document.getElementById('form-journee').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const doc = await db.collection('journees').add({
        titre: document.getElementById('j-titre').value.trim(),
        date: document.getElementById('j-date').value,
        lieu: document.getElementById('j-lieu').value.trim(),
        nbParticipants: Number(document.getElementById('j-participants').value) || 0,
        description: document.getElementById('j-description').value.trim(),
        actions: [],
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      location.hash = '#/journee/' + doc.id;
    });
  }

  async function vueJournee(journeeId) {
    const doc = await db.collection('journees').doc(journeeId).get();
    if (!doc.exists) throw new Error("Cette journée d'études n'existe plus.");
    const journee = { id: doc.id, ...doc.data() };

    const snapQ = await db
      .collection('questionnaires')
      .where('journeeId', '==', journeeId)
      .get();
    const questionnaires = snapQ.docs.map((d) => ({ id: d.id, ...d.data() }));
    questionnaires.sort((a, b) => (a.creeLe && b.creeLe ? a.creeLe.seconds - b.creeLe.seconds : 0));

    const actions = Array.isArray(journee.actions) ? journee.actions : [];

    $app.innerHTML = `
      <div class="fil"><a href="#/journees">Journées d'études</a> › ${echapper(journee.titre)}</div>

      <div class="carte">
        <h2>${echapper(journee.titre)}</h2>
        <p class="muet">${fmtDate(journee.date)}${journee.lieu ? ' — ' + echapper(journee.lieu) : ''}
          ${journee.nbParticipants ? ` — ${journee.nbParticipants} participants attendus` : ''}</p>
        ${journee.description ? `<p>${echapper(journee.description)}</p>` : ''}
        <div class="ligne-boutons">
          <button id="bouton-modifier-journee" class="secondaire">Modifier la journée</button>
          <button id="bouton-supprimer-journee" class="danger"
            ${questionnaires.length ? 'disabled title="Supprimez d’abord ses questionnaires"' : ''}>
            Supprimer la journée
          </button>
        </div>
        <form id="form-modif-journee" hidden style="margin-top:1rem">
          <label class="champ">Titre *
            <input id="jm-titre" required value="${attr(journee.titre)}"></label>
          <label class="champ">Date *
            <input id="jm-date" type="date" required value="${attr(journee.date)}"></label>
          <label class="champ">Lieu
            <input id="jm-lieu" value="${attr(journee.lieu || '')}"></label>
          <label class="champ">Nombre de participants attendus
            <input id="jm-participants" type="number" min="0" step="1"
              value="${journee.nbParticipants || ''}"></label>
          <label class="champ">Description / programme
            <textarea id="jm-description">${echapper(journee.description || '')}</textarea></label>
          <div class="ligne-boutons">
            <button type="submit">Enregistrer</button>
            <button type="button" id="bouton-annuler-modif" class="secondaire">Annuler</button>
          </div>
        </form>
      </div>

      <div class="carte">
        <h2>Questionnaires</h2>
        ${
          questionnaires.length
            ? `<ul class="liste">${questionnaires
                .map(
                  (q) => `
                <li>
                  <div>
                    <a class="titre-item" href="#/questionnaire/${q.id}">${echapper(q.titre)}</a>
                    ${badgeStatut(q.statut)}
                    <div class="muet">${(q.questions || []).length} questions</div>
                  </div>
                  <div class="pousse">
                    <a class="btn secondaire" href="#/questionnaire/${q.id}">Ouvrir</a>
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucun questionnaire pour cette journée.</p>`
        }
        <h3>Créer un questionnaire</h3>
        <form id="form-questionnaire">
          <label class="champ">À partir du modèle
            <select id="q-modele">
              ${Object.entries(MODELES)
                .map(([cle, m]) => `<option value="${cle}">${echapper(m.libelle)}</option>`)
                .join('')}
            </select>
          </label>
          <div class="ligne-boutons">
            <button type="submit">Créer le questionnaire</button>
          </div>
        </form>
      </div>

      <div class="carte">
        <h2>Actions d'amélioration</h2>
        <p class="muet">Suivi des améliorations décidées à partir des retours des
        participants — preuve d'exploitation des appréciations attendue par
        Qualiopi (indicateur 32).</p>
        ${
          actions.length
            ? `<ul class="liste">${actions
                .map(
                  (a, i) => `
                <li>
                  <div class="${a.statut === 'fait' ? 'action-faite' : ''}">${echapper(a.texte)}</div>
                  <div class="pousse">
                    <button class="discret bouton-basculer-action" data-index="${i}">
                      ${a.statut === 'fait' ? 'Rouvrir' : 'Marquer comme réalisée'}
                    </button>
                    <button class="discret bouton-supprimer-action" data-index="${i}">Supprimer</button>
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucune action enregistrée.</p>`
        }
        <form id="form-action" class="ligne-boutons">
          <input id="a-texte" required placeholder="Ex. : revoir la sonorisation de la salle plénière"
            style="flex:1;min-width:240px;font:inherit;padding:0.5rem 0.6rem;border:1px solid var(--bord);border-radius:8px">
          <button type="submit">Ajouter</button>
        </form>
      </div>`;

    // --- interactions

    document.getElementById('bouton-modifier-journee').addEventListener('click', () => {
      document.getElementById('form-modif-journee').hidden = false;
    });
    document.getElementById('bouton-annuler-modif').addEventListener('click', () => {
      document.getElementById('form-modif-journee').hidden = true;
    });

    document.getElementById('form-modif-journee').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const maj = {
        titre: document.getElementById('jm-titre').value.trim(),
        date: document.getElementById('jm-date').value,
        lieu: document.getElementById('jm-lieu').value.trim(),
        nbParticipants: Number(document.getElementById('jm-participants').value) || 0,
        description: document.getElementById('jm-description').value.trim(),
      };
      await db.collection('journees').doc(journeeId).update(maj);
      // Répercute le contexte affiché en tête des questionnaires publics.
      const lot = db.batch();
      questionnaires.forEach((q) => {
        lot.update(db.collection('questionnaires').doc(q.id), {
          journeeTitre: maj.titre,
          journeeDate: fmtDate(maj.date),
          journeeLieu: maj.lieu,
        });
      });
      await lot.commit();
      router();
    });

    document.getElementById('bouton-supprimer-journee').addEventListener('click', async () => {
      if (questionnaires.length) return;
      if (!confirm('Supprimer définitivement cette journée d’études ?')) return;
      await db.collection('journees').doc(journeeId).delete();
      location.hash = '#/journees';
    });

    document.getElementById('form-questionnaire').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const modele = MODELES[document.getElementById('q-modele').value];
      const doc = await db.collection('questionnaires').add({
        journeeId,
        journeeTitre: journee.titre,
        journeeDate: fmtDate(journee.date),
        journeeLieu: journee.lieu || '',
        titre: modele.titre + ' — ' + journee.titre,
        statut: 'brouillon',
        questions: JSON.parse(JSON.stringify(modele.questions)),
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      location.hash = '#/questionnaire/' + doc.id;
    });

    async function enregistrerActions(nouvelles) {
      await db.collection('journees').doc(journeeId).update({ actions: nouvelles });
      router();
    }

    document.getElementById('form-action').addEventListener('submit', (evt) => {
      evt.preventDefault();
      const texte = document.getElementById('a-texte').value.trim();
      if (!texte) return;
      enregistrerActions([
        ...actions,
        { texte, statut: 'a_faire', creeLe: new Date().toISOString() },
      ]);
    });

    document.querySelectorAll('.bouton-basculer-action').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.index);
        const copie = actions.map((a, idx) =>
          idx === i ? { ...a, statut: a.statut === 'fait' ? 'a_faire' : 'fait' } : a,
        );
        enregistrerActions(copie);
      }),
    );

    document.querySelectorAll('.bouton-supprimer-action').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.index);
        enregistrerActions(actions.filter((_, idx) => idx !== i));
      }),
    );
  }

  // ------------------------------------------------------------------ statistiques

  function statsQuestion(q, reponses) {
    const valeurs = reponses
      .map((r) => (r.reponses ? r.reponses[q.id] : undefined))
      .filter((v) => v !== undefined && v !== null && v !== '');
    const n = valeurs.length;

    if (q.type === 'echelle4') {
      const comptes = [0, 0, 0, 0];
      valeurs.forEach((v) => {
        const i = Number(v) - 1;
        if (i >= 0 && i < 4) comptes[i] += 1;
      });
      const somme = valeurs.reduce((s, v) => s + Number(v), 0);
      return {
        n,
        comptes,
        moyenne: n ? somme / n : null,
        satisfaits: comptes[2] + comptes[3],
      };
    }
    if (q.type === 'note10') {
      const somme = valeurs.reduce((s, v) => s + Number(v), 0);
      const comptes = Array(11).fill(0);
      valeurs.forEach((v) => {
        const i = Number(v);
        if (i >= 0 && i <= 10) comptes[i] += 1;
      });
      return { n, comptes, moyenne: n ? somme / n : null };
    }
    if (q.type === 'ouinon') {
      const oui = valeurs.filter((v) => v === 'Oui').length;
      return { n, oui, non: n - oui };
    }
    if (q.type === 'choix') {
      const comptes = {};
      valeurs.forEach((v) => {
        comptes[v] = (comptes[v] || 0) + 1;
      });
      return { n, comptes };
    }
    return { n, verbatims: valeurs.map(String) };
  }

  function statsGlobales(questionnaire, reponses) {
    let totalEchelle = 0;
    let totalSatisfaits = 0;
    let noteMoyenne = null;
    let recommandation = null;

    (questionnaire.questions || []).forEach((q) => {
      const s = statsQuestion(q, reponses);
      if (q.type === 'echelle4') {
        totalEchelle += s.n;
        totalSatisfaits += s.satisfaits;
      }
      if (q.type === 'note10' && noteMoyenne === null && s.moyenne !== null) {
        noteMoyenne = s.moyenne;
      }
      if (q.type === 'ouinon' && recommandation === null && s.n) {
        recommandation = s.oui / s.n;
      }
    });

    return { totalEchelle, totalSatisfaits, noteMoyenne, recommandation };
  }

  function htmlBarres(lignes, total, classes) {
    return (
      '<div class="barres">' +
      lignes
        .map(([etiquette, compte], i) => {
          const largeur = total ? Math.round((compte / total) * 100) : 0;
          return `<div class="barre-ligne">
            <div class="etiquette" title="${attr(etiquette)}">${echapper(etiquette)}</div>
            <div class="barre-fond"><div class="barre-remplie ${classes ? classes[i] || '' : ''}"
              style="width:${largeur}%"></div></div>
            <div>${compte}</div>
          </div>`;
        })
        .join('') +
      '</div>'
    );
  }

  function htmlStatsQuestion(q, s) {
    let resume = '';
    let corps = '';

    if (q.type === 'echelle4') {
      resume = s.n
        ? `moyenne ${s.moyenne.toFixed(2)} / 4 — ${pourcent(s.satisfaits, s.n)} satisfaits`
        : 'aucune réponse';
      corps = htmlBarres(
        ECHELLE4.map((lib, i) => [lib, s.comptes[i]]),
        s.n,
        ['n1', 'n2', 'n3', 'n4'],
      );
    } else if (q.type === 'note10') {
      resume = s.n ? `moyenne ${s.moyenne.toFixed(1)} / 10` : 'aucune réponse';
      corps = htmlBarres(
        s.comptes.map((c, i) => [String(i), c]).filter(([, c]) => c > 0),
        s.n,
      );
    } else if (q.type === 'ouinon') {
      resume = s.n ? `${pourcent(s.oui, s.n)} de oui` : 'aucune réponse';
      corps = htmlBarres(
        [
          ['Oui', s.oui],
          ['Non', s.non],
        ],
        s.n,
        ['n4', 'n1'],
      );
    } else if (q.type === 'choix') {
      resume = s.n ? `${s.n} réponses` : 'aucune réponse';
      corps = htmlBarres(
        Object.entries(s.comptes).sort((a, b) => b[1] - a[1]),
        s.n,
      );
    } else {
      resume = s.n ? `${s.n} réponses` : 'aucune réponse';
      corps = s.verbatims && s.verbatims.length
        ? `<ul class="verbatims">${s.verbatims.map((v) => `<li>${echapper(v)}</li>`).join('')}</ul>`
        : '';
    }

    return `<div class="stat-question">
      <div class="entete">
        <div class="libelle">${echapper(q.libelle)}</div>
        <div class="resume">${resume}</div>
      </div>
      ${corps}
    </div>`;
  }

  // ------------------------------------------------------------------ export CSV

  function exporterCsv(questionnaire, reponses) {
    const sep = ';';
    const questions = questionnaire.questions || [];
    const entetes = ['Horodatage', ...questions.map((q) => q.libelle)];

    function cellule(v) {
      const texte = v == null ? '' : String(v);
      return '"' + texte.replace(/"/g, '""') + '"';
    }

    const lignes = [entetes.map(cellule).join(sep)];
    reponses.forEach((r) => {
      const valeurs = [
        fmtHorodatage(r.soumisLe),
        ...questions.map((q) => {
          const v = r.reponses ? r.reponses[q.id] : '';
          if (q.type === 'echelle4' && v) return `${v} - ${ECHELLE4[Number(v) - 1] || ''}`;
          return v == null ? '' : v;
        }),
      ];
      lignes.push(valeurs.map(cellule).join(sep));
    });

    // Le BOM UTF-8 permet à Excel (français) d'ouvrir le fichier avec les accents.
    const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download =
      'reponses-' +
      (questionnaire.journeeTitre || 'questionnaire').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() +
      '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------------ questionnaire

  async function vueQuestionnaire(questionnaireId) {
    const doc = await db.collection('questionnaires').doc(questionnaireId).get();
    if (!doc.exists) throw new Error("Ce questionnaire n'existe plus.");
    const questionnaire = { id: doc.id, ...doc.data() };

    const snapR = await db
      .collection('reponses')
      .where('questionnaireId', '==', questionnaireId)
      .get();
    const reponses = snapR.docs.map((d) => ({ id: d.id, ...d.data() }));
    reponses.sort((a, b) =>
      a.soumisLe && b.soumisLe ? a.soumisLe.seconds - b.soumisLe.seconds : 0,
    );

    const verrouille = reponses.length > 0;
    const questions = questionnaire.questions || [];
    const url = urlPublique(questionnaireId);
    const g = statsGlobales(questionnaire, reponses);

    let nbAttendus = 0;
    try {
      const jDoc = await db.collection('journees').doc(questionnaire.journeeId).get();
      if (jDoc.exists) nbAttendus = jDoc.data().nbParticipants || 0;
    } catch (_) {
      /* la journée a pu être supprimée */
    }

    const sections = [...new Set(questions.map((q) => q.section).filter(Boolean))];

    $app.innerHTML = `
      <div class="fil pas-impression">
        <a href="#/journees">Journées d'études</a> ›
        <a href="#/journee/${attr(questionnaire.journeeId)}">${echapper(questionnaire.journeeTitre || 'Journée')}</a> ›
        Questionnaire
      </div>

      <div class="carte">
        <h2>${echapper(questionnaire.titre)} ${badgeStatut(questionnaire.statut)}</h2>
        <p class="muet">${echapper(questionnaire.journeeTitre || '')}
          ${questionnaire.journeeDate ? ' — ' + echapper(questionnaire.journeeDate) : ''}
          ${questionnaire.journeeLieu ? ' — ' + echapper(questionnaire.journeeLieu) : ''}</p>
        <p class="muet petit">Bilan édité le ${new Date().toLocaleDateString('fr-FR')} —
          document conservé au titre de la démarche qualité (Qualiopi, indicateur 30).</p>
      </div>

      <div class="carte pas-impression">
        <h2>Diffusion</h2>
        ${
          questionnaire.statut === 'ouvert'
            ? `<div class="lien-public">
                <div>
                  <div id="zone-qr"></div>
                </div>
                <div style="flex:1">
                  <p>Les participants répondent à cette adresse (à projeter en fin de
                  journée, ou à envoyer par e-mail) :</p>
                  <div class="url" id="url-publique">${echapper(url)}</div>
                  <div class="ligne-boutons">
                    <button id="bouton-copier" class="secondaire">Copier le lien</button>
                    <a class="btn secondaire" href="${attr(url)}" target="_blank" rel="noopener">Voir le formulaire</a>
                    <button id="bouton-fermer" class="danger">Clôturer le questionnaire</button>
                  </div>
                </div>
              </div>`
            : questionnaire.statut === 'brouillon'
              ? `<p class="muet">Le questionnaire est en préparation : il n'est pas
                  visible des participants. Ouvrez-le quand il est prêt.</p>
                <div class="ligne-boutons">
                  <button id="bouton-ouvrir" ${questions.length ? '' : 'disabled title="Ajoutez d’abord des questions"'}>
                    Ouvrir aux réponses</button>
                </div>`
              : `<p class="muet">Le questionnaire est clôturé : les participants ne
                  peuvent plus répondre.</p>
                <div class="ligne-boutons">
                  <button id="bouton-rouvrir" class="secondaire">Rouvrir aux réponses</button>
                </div>`
        }
      </div>

      <div class="carte">
        <h2>Résultats</h2>
        <div class="tuiles">
          <div class="tuile"><div class="valeur">${reponses.length}</div>
            <div class="legende">réponses reçues</div></div>
          <div class="tuile"><div class="valeur">${nbAttendus ? pourcent(reponses.length, nbAttendus) : '—'}</div>
            <div class="legende">taux de réponse${nbAttendus ? ` (${nbAttendus} attendus)` : ''}</div></div>
          <div class="tuile"><div class="valeur">${g.totalEchelle ? pourcent(g.totalSatisfaits, g.totalEchelle) : '—'}</div>
            <div class="legende">satisfaction globale (réponses « satisfaisant » et plus)</div></div>
          <div class="tuile"><div class="valeur">${g.noteMoyenne !== null ? g.noteMoyenne.toFixed(1) + ' / 10' : '—'}</div>
            <div class="legende">note moyenne</div></div>
          <div class="tuile"><div class="valeur">${g.recommandation !== null ? Math.round(g.recommandation * 100) + ' %' : '—'}</div>
            <div class="legende">recommanderaient la journée</div></div>
        </div>
        ${
          reponses.length
            ? `<div class="ligne-boutons pas-impression">
                <button id="bouton-csv" class="secondaire">Exporter les réponses (CSV)</button>
                <button id="bouton-imprimer" class="secondaire">Imprimer le bilan</button>
              </div>
              <div id="zone-stats">
                ${(() => {
                  let html = '';
                  let sectionCourante = null;
                  questions.forEach((q) => {
                    if (q.section && q.section !== sectionCourante) {
                      sectionCourante = q.section;
                      html += `<div class="section-titre">${echapper(q.section)}</div>`;
                    }
                    html += htmlStatsQuestion(q, statsQuestion(q, reponses));
                  });
                  return html;
                })()}
              </div>`
            : `<p class="muet">Aucune réponse pour le moment.</p>`
        }
      </div>

      <div class="carte pas-impression">
        <h2>Questions (${questions.length})</h2>
        ${
          verrouille
            ? `<div class="info">Des réponses ont été collectées : la structure du
                questionnaire est verrouillée pour garantir la cohérence des
                résultats.</div>`
            : ''
        }
        <div id="liste-questions">
          ${questions
            .map(
              (q, i) => `
            <div class="q-item">
              <div class="q-entete">
                <span class="q-type">${TYPES_QUESTION[q.type] || q.type}</span>
                ${q.section ? `<span class="muet petit">${echapper(q.section)}</span>` : ''}
                ${q.obligatoire ? '<span class="muet petit">obligatoire</span>' : ''}
                <div class="pousse">
                  ${
                    verrouille
                      ? ''
                      : `<button class="discret bouton-monter" data-index="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button class="discret bouton-descendre" data-index="${i}" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="discret bouton-editer" data-index="${i}">Modifier</button>
                        <button class="discret bouton-supprimer-q" data-index="${i}">Supprimer</button>`
                  }
                </div>
              </div>
              <div>${echapper(q.libelle)}</div>
              ${q.type === 'choix' ? `<div class="muet petit">${(q.options || []).map(echapper).join(' · ')}</div>` : ''}
            </div>`,
            )
            .join('')}
        </div>
        ${
          verrouille
            ? ''
            : `<h3 id="titre-form-question">Ajouter une question</h3>
              <form id="form-question">
                <input type="hidden" id="fq-index" value="">
                <label class="champ">Intitulé *
                  <input id="fq-libelle" required></label>
                <label class="champ">Section (regroupe les questions sur le formulaire)
                  <input id="fq-section" list="sections-existantes">
                  <datalist id="sections-existantes">
                    ${sections.map((s) => `<option value="${attr(s)}">`).join('')}
                  </datalist></label>
                <label class="champ">Type de réponse
                  <select id="fq-type">
                    ${Object.entries(TYPES_QUESTION)
                      .map(([cle, lib]) => `<option value="${cle}">${lib}</option>`)
                      .join('')}
                  </select></label>
                <label class="champ" id="fq-bloc-options" hidden>Choix possibles (un par ligne)
                  <textarea id="fq-options"></textarea></label>
                <label class="champ" style="font-weight:normal">
                  <input type="checkbox" id="fq-obligatoire" style="display:inline;width:auto"> Réponse obligatoire</label>
                <div class="ligne-boutons">
                  <button type="submit" id="fq-valider">Ajouter la question</button>
                  <button type="button" id="fq-annuler" class="secondaire" hidden>Annuler la modification</button>
                </div>
              </form>`
        }
      </div>

      <div class="carte pas-impression">
        <h2>Zone dangereuse</h2>
        <div class="ligne-boutons">
          <button id="bouton-supprimer-questionnaire" class="danger">
            Supprimer le questionnaire${reponses.length ? ` et ses ${reponses.length} réponses` : ''}
          </button>
        </div>
      </div>`;

    // --- diffusion

    if (questionnaire.statut === 'ouvert') {
      if (window.QRCode) {
        new QRCode(document.getElementById('zone-qr'), {
          text: url,
          width: 160,
          height: 160,
          correctLevel: QRCode.CorrectLevel.M,
        });
      } else {
        document.getElementById('zone-qr').innerHTML =
          '<p class="muet petit">QR code indisponible<br>(bibliothèque non chargée)</p>';
      }
      document.getElementById('bouton-copier').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          document.getElementById('bouton-copier').textContent = 'Lien copié ✓';
        } catch (_) {
          prompt('Copiez le lien :', url);
        }
      });
      document.getElementById('bouton-fermer').addEventListener('click', async () => {
        await db.collection('questionnaires').doc(questionnaireId).update({
          statut: 'ferme',
          fermeLe: firebase.firestore.FieldValue.serverTimestamp(),
        });
        router();
      });
    }
    const boutonOuvrir = document.getElementById('bouton-ouvrir');
    if (boutonOuvrir) {
      boutonOuvrir.addEventListener('click', async () => {
        await db.collection('questionnaires').doc(questionnaireId).update({
          statut: 'ouvert',
          ouvertLe: firebase.firestore.FieldValue.serverTimestamp(),
        });
        router();
      });
    }
    const boutonRouvrir = document.getElementById('bouton-rouvrir');
    if (boutonRouvrir) {
      boutonRouvrir.addEventListener('click', async () => {
        await db.collection('questionnaires').doc(questionnaireId).update({ statut: 'ouvert' });
        router();
      });
    }

    // --- résultats

    const boutonCsv = document.getElementById('bouton-csv');
    if (boutonCsv) boutonCsv.addEventListener('click', () => exporterCsv(questionnaire, reponses));
    const boutonImprimer = document.getElementById('bouton-imprimer');
    if (boutonImprimer) boutonImprimer.addEventListener('click', () => window.print());

    // --- édition des questions

    async function enregistrerQuestions(nouvelles) {
      await db.collection('questionnaires').doc(questionnaireId).update({ questions: nouvelles });
      router();
    }

    if (!verrouille) {
      const blocOptions = document.getElementById('fq-bloc-options');
      const selectType = document.getElementById('fq-type');
      selectType.addEventListener('change', () => {
        blocOptions.hidden = selectType.value !== 'choix';
      });

      document.querySelectorAll('.bouton-monter').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.index);
          const copie = [...questions];
          [copie[i - 1], copie[i]] = [copie[i], copie[i - 1]];
          enregistrerQuestions(copie);
        }),
      );
      document.querySelectorAll('.bouton-descendre').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.index);
          const copie = [...questions];
          [copie[i], copie[i + 1]] = [copie[i + 1], copie[i]];
          enregistrerQuestions(copie);
        }),
      );
      document.querySelectorAll('.bouton-supprimer-q').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.index);
          if (!confirm('Supprimer cette question ?')) return;
          enregistrerQuestions(questions.filter((_, idx) => idx !== i));
        }),
      );
      document.querySelectorAll('.bouton-editer').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.index);
          const q = questions[i];
          document.getElementById('fq-index').value = String(i);
          document.getElementById('fq-libelle').value = q.libelle;
          document.getElementById('fq-section').value = q.section || '';
          selectType.value = q.type;
          blocOptions.hidden = q.type !== 'choix';
          document.getElementById('fq-options').value = (q.options || []).join('\n');
          document.getElementById('fq-obligatoire').checked = !!q.obligatoire;
          document.getElementById('titre-form-question').textContent = 'Modifier la question';
          document.getElementById('fq-valider').textContent = 'Enregistrer la question';
          document.getElementById('fq-annuler').hidden = false;
          document.getElementById('form-question').scrollIntoView({ behavior: 'smooth' });
        }),
      );

      document.getElementById('fq-annuler').addEventListener('click', () => router());

      document.getElementById('form-question').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const indexBrut = document.getElementById('fq-index').value;
        const type = selectType.value;
        const question = {
          id: indexBrut === '' ? idAleatoire() : questions[Number(indexBrut)].id,
          libelle: document.getElementById('fq-libelle').value.trim(),
          section: document.getElementById('fq-section').value.trim(),
          type,
          obligatoire: document.getElementById('fq-obligatoire').checked,
        };
        if (type === 'choix') {
          question.options = document
            .getElementById('fq-options')
            .value.split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          if (!question.options.length) {
            alert('Indiquez au moins un choix possible.');
            return;
          }
        }
        const copie = [...questions];
        if (indexBrut === '') copie.push(question);
        else copie[Number(indexBrut)] = question;
        enregistrerQuestions(copie);
      });
    }

    // --- suppression

    document
      .getElementById('bouton-supprimer-questionnaire')
      .addEventListener('click', async () => {
        const message = reponses.length
          ? `Supprimer définitivement ce questionnaire ET ses ${reponses.length} réponses ? ` +
            'Pensez à exporter le CSV et le bilan avant : ils font partie des preuves Qualiopi.'
          : 'Supprimer définitivement ce questionnaire ?';
        if (!confirm(message)) return;
        // Suppression par lots de 400 (limite Firestore : 500 opérations par lot).
        for (let i = 0; i < reponses.length; i += 400) {
          const lot = db.batch();
          reponses.slice(i, i + 400).forEach((r) => lot.delete(db.collection('reponses').doc(r.id)));
          await lot.commit();
        }
        await db.collection('questionnaires').doc(questionnaireId).delete();
        location.hash = '#/journee/' + questionnaire.journeeId;
      });
  }

  // ------------------------------------------------------------------ routeur

  async function router() {
    if (!estAdmin) return;
    const hash = location.hash || '#/journees';
    try {
      const mJournee = hash.match(/^#\/journee\/([A-Za-z0-9_-]+)$/);
      const mQuestionnaire = hash.match(/^#\/questionnaire\/([A-Za-z0-9_-]+)$/);
      if (mJournee) await vueJournee(mJournee[1]);
      else if (mQuestionnaire) await vueQuestionnaire(mQuestionnaire[1]);
      else await vueListeJournees();
    } catch (e) {
      vueErreur(e);
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);

  // ------------------------------------------------------------------ démarrage

  if (!window.firebaseConfigEstRenseignee()) {
    vueConfigManquante();
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();

  const $deconnexion = document.getElementById('bouton-deconnexion');
  $deconnexion.addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged(async (user) => {
    utilisateur = user;
    estAdmin = false;
    document.getElementById('utilisateur-courant').textContent = user ? user.email : '';
    $deconnexion.hidden = !user;

    if (!user) {
      vueConnexion();
      return;
    }

    try {
      const adminsDoc = await db.collection('config').doc('admins').get();
      const emails = adminsDoc.exists ? adminsDoc.data().emails || [] : [];
      estAdmin = emails.includes(user.email);
    } catch (_) {
      estAdmin = false;
    }

    if (!estAdmin) {
      vueNonAutorise();
      return;
    }
    router();
  });
})();
