// Administration des questionnaires de satisfaction des journées d'études URBH.
// Application sans étape de build : rendu HTML + Firestore directement.

(function () {
  'use strict';

  const $app = document.getElementById('app');
  const ECHELLE4 = window.ECHELLE4_LIBELLES;
  const MODELES = window.MODELES_QUESTIONNAIRES;

  const TYPES_QUESTION = {
    echelle4: 'Échelle de satisfaction (1 à 4)',
    note5: 'Note de 1 à 5',
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

  // Période d'une journée d'études : « 07/10/2026 » ou « du 07/10/2026 au 09/10/2026 ».
  function fmtPeriode(j) {
    if (j.dateFin && j.dateFin !== j.date) {
      return `du ${fmtDate(j.date)} au ${fmtDate(j.dateFin)}`;
    }
    return fmtDate(j.date);
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

  function normaliserNumero(brut) {
    return String(brut == null ? '' : brut)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\//g, '-');
  }

  function urlPublique(questionnaireId) {
    return `${location.origin}${location.pathname.replace(/index\.html$/, '').replace(/\/$/, '')}/repondre.html?id=${questionnaireId}`;
  }

  // Moments de pointage (émargement) : ils conditionnent la participation à
  // la tombola de clôture — mêmes clés que sur le portail participants.
  const MOMENTS_POINTAGE = [
    { cle: 'ouverture', libelle: "Ouverture des journées — première conférence" },
    { cle: 'ag', libelle: 'Assemblée Générale' },
    { cle: 'tombola', libelle: 'Présence en salle au moment du tirage' },
  ];

  // Valeur d'un champ <input type="datetime-local"> pour un Timestamp Firestore.
  function versDatetimeLocal(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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

  // Anonymisation d'un participant (droit à l'effacement) : efface l'identité
  // dans toutes les collections, retire sa fiche de l'annuaire, puis marque la
  // demande « traitée » — le participant voit la confirmation dans son app.
  async function anonymiserParticipant(uidCible) {
    const vide = { nom: 'Anonymisé', prenom: '', organisme: '', email: '', mobile: '', numeroInscription: '' };
    const refProfil = db.collection('participants').doc(uidCible);
    const docProfil = await refProfil.get();
    const numero = docProfil.exists ? docProfil.data().numeroInscription || '' : '';

    const maj = [];
    for (const col of ['inscriptions', 'tirage', 'voeux', 'visites', 'pointages']) {
      const snap = await db.collection(col).where('participantId', '==', uidCible).get();
      snap.docs.forEach((d) => maj.push({ ref: d.ref, donnees: vide }));
    }
    // Gagnants annoncés sur les portails (tirage au sort et tombola).
    const snapPo = await db.collection('portails').get();
    snapPo.docs.forEach((d) => {
      const gagnants = (d.data().tirage || {}).gagnants || [];
      const gagnantsTombola = (d.data().tombola || {}).gagnants || [];
      const donnees = {};
      if (gagnants.some((g) => g.participantId === uidCible)) {
        donnees['tirage.gagnants'] = gagnants.map((g) =>
          g.participantId === uidCible ? { ...g, ...vide } : g,
        );
      }
      if (gagnantsTombola.some((g) => g.participantId === uidCible)) {
        donnees['tombola.gagnants'] = gagnantsTombola.map((g) =>
          g.participantId === uidCible ? { ...g, ...vide } : g,
        );
      }
      if (Object.keys(donnees).length) maj.push({ ref: d.ref, donnees });
    });
    // Retenus et listes d'attente des ateliers.
    const snapAt = await db.collection('ateliers').get();
    snapAt.docs.forEach((d) => {
      const a = d.data();
      const concerne = (l) => (l || []).some((r) => r.participantId === uidCible);
      if (concerne(a.retenus) || concerne(a.listeAttente)) {
        maj.push({
          ref: d.ref,
          donnees: {
            retenus: (a.retenus || []).map((r) => (r.participantId === uidCible ? { ...r, ...vide } : r)),
            listeAttente: (a.listeAttente || []).map((r) =>
              r.participantId === uidCible ? { ...r, ...vide } : r,
            ),
          },
        });
      }
    });

    for (let i = 0; i < maj.length; i += 400) {
      const lot = db.batch();
      maj.slice(i, i + 400).forEach((m) => lot.update(m.ref, m.donnees));
      await lot.commit();
    }
    if (docProfil.exists) {
      await refProfil.update({
        ...vide,
        consentementPartage: false,
        consentementLe: '',
        anonymiseLe: new Date().toISOString(),
      });
    }
    if (numero) {
      try {
        await db.collection('annuaire').doc(numero).delete();
      } catch (_) {
        /* fiche déjà absente */
      }
    }
    await db.collection('demandesAnonymisation').doc(uidCible).update({
      statut: 'traitee',
      traiteLe: new Date().toISOString(),
    });
  }

  async function vueListeJournees() {
    const journees = await chargerJournees();
    const snapDa = await db.collection('demandesAnonymisation').get();
    const demandes = snapDa.docs.map((d) => ({ id: d.id, ...d.data() }));
    demandes.sort((a, b) => String(b.demandeLe || '').localeCompare(String(a.demandeLe || '')));
    const demandesEnAttente = demandes.filter((d) => d.statut === 'en_attente');
    const snapAnnuaire = await db.collection('annuaire').get();
    const annuaire = snapAnnuaire.docs.map((d) => d.data());
    const nbAnnuaireVisiteurs = annuaire.filter((a) => a.type === 'visiteur').length;
    const nbAnnuaireExposants = annuaire.filter((a) => a.type === 'exposant').length;

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
                    <div class="muet">${fmtPeriode(j)}${j.lieu ? ' — ' + echapper(j.lieu) : ''}</div>
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
            <input id="j-titre" required placeholder="Ex. : 41es Journées d'études de l'URBH — Nantes">
          </label>
          <label class="champ">Date de début *
            <input id="j-date" type="date" required>
          </label>
          <label class="champ">Date de fin (si l'événement dure plusieurs jours)
            <input id="j-date-fin" type="date">
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
      </div>

      <div class="carte">
        <h2>🔐 Demandes d'anonymisation (RGPD)
          ${demandesEnAttente.length ? `<span class="badge brouillon">${demandesEnAttente.length} à traiter</span>` : ''}</h2>
        ${
          demandes.length
            ? `<ul class="liste">${demandes
                .map(
                  (d) => `<li>
                    <div>
                      <span class="titre-item">${echapper(d.prenom || '')} ${echapper(d.nom || '')}</span>
                      <div class="muet petit">demandé le ${d.demandeLe ? new Date(d.demandeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '?'}
                        ${d.statut === 'traitee' ? ` — traité le ${d.traiteLe ? new Date(d.traiteLe).toLocaleDateString('fr-FR') : ''}` : ''}</div>
                    </div>
                    <div class="pousse">
                      ${
                        d.statut === 'traitee'
                          ? '<span class="badge ouvert">✅ traitée</span>'
                          : `<button class="danger bouton-anonymiser" data-id="${attr(d.id)}">Anonymiser et confirmer</button>`
                      }
                    </div>
                  </li>`,
                )
                .join('')}</ul>
              <p class="muet petit">« Anonymiser et confirmer » efface l'identité du
              participant dans toute la base (profil, inscriptions, tirage,
              ateliers, passages sur les stands, annuaire) — ses réponses aux
              questionnaires sont conservées de façon anonyme — puis affiche la
              confirmation dans son application. Pensez à répercuter la
              suppression dans les exports CSV déjà transmis le cas échéant.</p>`
            : `<p class="muet">Aucune demande d'anonymisation.</p>`
        }
      </div>

      <div class="carte">
        <h2>Annuaire des inscrits attendus</h2>
        <p class="muet">Importez le fichier Excel des adhérents inscrits
        (visiteurs blanchisseurs), puis celui des représentants fournisseurs
        (exposants). Au portail, la saisie du N° d'inscription reconnaît alors
        automatiquement la personne et pré-remplit son identité.</p>
        <div class="tuiles">
          <div class="tuile"><div class="valeur">${nbAnnuaireVisiteurs}</div>
            <div class="legende">visiteurs attendus</div></div>
          <div class="tuile"><div class="valeur">${nbAnnuaireExposants}</div>
            <div class="legende">exposants attendus</div></div>
        </div>
        <label class="champ">Ces personnes sont des…
          <select id="an-type">
            <option value="visiteur">Visiteurs blanchisseurs (fichier des adhérents)</option>
            <option value="exposant">Exposants fournisseurs (fichier des représentants)</option>
          </select>
        </label>
        <label class="champ">Fichier Excel (.xlsx) ou CSV
          <input type="file" id="an-fichier" accept=".xlsx,.xls,.csv">
        </label>
        <div id="an-zone-mapping"></div>
        ${
          annuaire.length
            ? `<div class="ligne-boutons">
                <button id="an-vider" class="danger">Vider l'annuaire (${annuaire.length} fiches)</button>
              </div>`
            : ''
        }
      </div>`;

    document.getElementById('form-journee').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const titre = document.getElementById('j-titre').value.trim();
      const date = document.getElementById('j-date').value;
      const dateFin = document.getElementById('j-date-fin').value;
      const lieu = document.getElementById('j-lieu').value.trim();
      const doc = await db.collection('journees').add({
        titre,
        date,
        dateFin,
        lieu,
        nbParticipants: Number(document.getElementById('j-participants').value) || 0,
        description: document.getElementById('j-description').value.trim(),
        actions: [],
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Vitrine publique de la journée (portail + tirage), inactive par défaut.
      await db.collection('portails').doc(doc.id).set({
        titre,
        date: fmtPeriode({ date, dateFin }),
        lieu,
        actif: false,
        tirage: { ouvert: false, gagnants: [] },
        tombola: { lots: [], gagnants: [] },
        pointages: { ouverture: false, ag: false, tombola: false },
      });
      location.hash = '#/journee/' + doc.id;
    });

    document.querySelectorAll('.bouton-anonymiser').forEach((b) =>
      b.addEventListener('click', async () => {
        const d = demandes.find((x) => x.id === b.dataset.id);
        if (
          !confirm(
            `Anonymiser définitivement les données de ${d ? `${d.prenom} ${d.nom}` : 'ce participant'} ? ` +
              'Cette action est irréversible.',
          )
        ) {
          return;
        }
        b.disabled = true;
        b.textContent = 'Anonymisation…';
        try {
          await anonymiserParticipant(b.dataset.id);
          router();
        } catch (e) {
          alert("L'anonymisation a échoué : " + (e && e.message ? e.message : e));
          router();
        }
      }),
    );

    // --- import de l'annuaire (fichiers Excel des inscrits)

    let lignesFichier = [];

    function lettreColonne(i) {
      return String.fromCharCode(65 + (i % 26));
    }

    function detecterColonnes(lignes) {
      const nbCols = Math.max(...lignes.map((l) => l.length), 0);
      const stats = [];
      for (let c = 0; c < nbCols; c += 1) {
        const valeurs = lignes.map((l) => l[c]).filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
        const textes = valeurs.map(String);
        stats.push({
          index: c,
          remplissage: valeurs.length / Math.max(lignes.length, 1),
          numeros: textes.filter((t) => /^[A-Za-z]{1,6}\s?\d{2,4}\s?[-_]?\s?\d{1,4}$/.test(t.trim())).length / Math.max(textes.length, 1),
          emails: textes.filter((t) => t.includes('@')).length / Math.max(textes.length, 1),
          longueurMoy: textes.reduce((s, t) => s + t.length, 0) / Math.max(textes.length, 1),
        });
      }
      let colNumero = -1;
      let meilleur = 0;
      stats.forEach((s) => {
        if (s.numeros > 0.5 && s.numeros > meilleur) {
          meilleur = s.numeros;
          colNumero = s.index;
        }
      });
      const textuelles = stats.filter(
        (s) =>
          s.index !== colNumero &&
          s.remplissage >= 0.4 &&
          s.emails < 0.3 &&
          s.longueurMoy >= 2,
      );
      return {
        nbCols,
        numero: colNumero,
        nom: textuelles[0] ? textuelles[0].index : -1,
        prenom: textuelles[1] ? textuelles[1].index : -1,
        organisme: textuelles[2] ? textuelles[2].index : -1,
      };
    }

    function optionsColonnes(nbCols, selection) {
      let html = '<option value="-1">—</option>';
      for (let c = 0; c < nbCols; c += 1) {
        const exemple = (lignesFichier.find((l) => l[c]) || [])[c] || '';
        html += `<option value="${c}" ${c === selection ? 'selected' : ''}>Colonne ${lettreColonne(c)} — ex. « ${echapper(String(exemple).slice(0, 25))} »</option>`;
      }
      return html;
    }

    function afficherMapping() {
      const d = detecterColonnes(lignesFichier);
      document.getElementById('an-zone-mapping').innerHTML = `
        <h3>Correspondance des colonnes (${lignesFichier.length} lignes lues)</h3>
        <label class="champ">N° d'inscription
          <select id="anc-numero">${optionsColonnes(d.nbCols, d.numero)}</select></label>
        <label class="champ">Nom
          <select id="anc-nom">${optionsColonnes(d.nbCols, d.nom)}</select></label>
        <label class="champ">Prénom
          <select id="anc-prenom">${optionsColonnes(d.nbCols, d.prenom)}</select></label>
        <label class="champ">Établissement / société
          <select id="anc-organisme">${optionsColonnes(d.nbCols, d.organisme)}</select></label>
        <div id="an-apercu" class="muet petit"></div>
        <div class="ligne-boutons">
          <button id="an-importer">Importer dans l'annuaire</button>
        </div>
        <div id="an-resultat"></div>`;

      function lireFiches() {
        const cols = {
          numero: Number(document.getElementById('anc-numero').value),
          nom: Number(document.getElementById('anc-nom').value),
          prenom: Number(document.getElementById('anc-prenom').value),
          organisme: Number(document.getElementById('anc-organisme').value),
        };
        const fiches = [];
        lignesFichier.forEach((l) => {
          const numero = normaliserNumero(cols.numero >= 0 ? l[cols.numero] : '');
          if (!numero || !/^[A-Z]/.test(numero)) return;
          fiches.push({
            numero,
            nom: String(cols.nom >= 0 ? l[cols.nom] || '' : '').trim(),
            prenom: String(cols.prenom >= 0 ? l[cols.prenom] || '' : '').trim(),
            organisme: String(cols.organisme >= 0 ? l[cols.organisme] || '' : '').trim(),
          });
        });
        return fiches;
      }

      function apercu() {
        const fiches = lireFiches();
        document.getElementById('an-apercu').textContent = fiches.length
          ? `${fiches.length} fiches prêtes — ex. : ` +
            fiches
              .slice(0, 3)
              .map((f) => `${f.numero} ${f.prenom} ${f.nom} (${f.organisme})`)
              .join(' · ')
          : 'Aucune fiche exploitable avec cette correspondance.';
      }
      ['anc-numero', 'anc-nom', 'anc-prenom', 'anc-organisme'].forEach((id) =>
        document.getElementById(id).addEventListener('change', apercu),
      );
      apercu();

      document.getElementById('an-importer').addEventListener('click', async () => {
        const fiches = lireFiches();
        if (!fiches.length) return;
        const type = document.getElementById('an-type').value;
        const bouton = document.getElementById('an-importer');
        bouton.disabled = true;
        bouton.textContent = 'Import en cours…';
        for (let i = 0; i < fiches.length; i += 400) {
          const lot = db.batch();
          fiches.slice(i, i + 400).forEach((f) => {
            lot.set(db.collection('annuaire').doc(f.numero), {
              ...f,
              type,
              importeLe: new Date().toISOString(),
            });
          });
          await lot.commit();
        }
        document.getElementById('an-resultat').innerHTML =
          `<div class="info">✅ ${fiches.length} fiches importées (${type === 'exposant' ? 'exposants' : 'visiteurs'}).</div>`;
        setTimeout(router, 1200);
      });
    }

    const champFichier = document.getElementById('an-fichier');
    champFichier.addEventListener('change', async () => {
      const fichier = champFichier.files[0];
      if (!fichier) return;
      if (!window.XLSX) {
        alert('La bibliothèque de lecture Excel ne s’est pas chargée : vérifiez la connexion internet.');
        return;
      }
      const tampon = await fichier.arrayBuffer();
      const classeur = XLSX.read(tampon);
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      lignesFichier = XLSX.utils
        .sheet_to_json(feuille, { header: 1, raw: false, defval: '' })
        .filter((l) => l.some((v) => String(v).trim() !== ''));
      afficherMapping();
    });

    const boutonVider = document.getElementById('an-vider');
    if (boutonVider) {
      boutonVider.addEventListener('click', async () => {
        if (!confirm('Vider entièrement l’annuaire des inscrits attendus ?')) return;
        const docs = snapAnnuaire.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const lot = db.batch();
          docs.slice(i, i + 400).forEach((d) => lot.delete(d.ref));
          await lot.commit();
        }
        router();
      });
    }
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

    // Vitrine publique (portail) : créée à la volée pour les journées antérieures.
    const refPortail = db.collection('portails').doc(journeeId);
    let portailDoc = await refPortail.get();
    if (!portailDoc.exists) {
      await refPortail.set({
        titre: journee.titre,
        date: fmtDate(journee.date),
        lieu: journee.lieu || '',
        actif: false,
        tirage: { ouvert: false, gagnants: [] },
        tombola: { lots: [], gagnants: [] },
        pointages: { ouverture: false, ag: false, tombola: false },
      });
      portailDoc = await refPortail.get();
    }
    // Complète à la volée les portails créés avant la tombola / les pointages.
    if (!portailDoc.data().pointages || !portailDoc.data().tombola) {
      await refPortail.update({
        pointages: portailDoc.data().pointages || { ouverture: false, ag: false, tombola: false },
        tombola: portailDoc.data().tombola || { lots: [], gagnants: [] },
      });
      portailDoc = await refPortail.get();
    }
    const portail = portailDoc.data();
    const tirageInfo = portail.tirage || { ouvert: false, gagnants: [] };
    const gagnants = tirageInfo.gagnants || [];
    const tombolaInfo = portail.tombola || { lots: [], gagnants: [] };
    const lotsTombola = tombolaInfo.lots || [];
    const gagnantsTombola = tombolaInfo.gagnants || [];
    const pointagesOuverts = portail.pointages || {};
    const agInfo = portail.ag || null;

    const snapI = await db
      .collection('inscriptions')
      .where('journeeId', '==', journeeId)
      .get();
    const inscriptions = snapI.docs.map((d) => ({ id: d.id, ...d.data() }));
    inscriptions.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    const nbVisiteurs = inscriptions.filter((i) => i.type === 'visiteur').length;
    const nbExposants = inscriptions.filter((i) => i.type === 'exposant').length;

    const snapT = await db.collection('tirage').where('journeeId', '==', journeeId).get();
    const participationsTirage = snapT.docs.map((d) => ({ id: d.id, ...d.data() }));

    const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
    const ateliers = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));
    ateliers.sort(
      (a, b) =>
        String(a.horaire || '').localeCompare(String(b.horaire || '')) ||
        String(a.salle || '').localeCompare(String(b.salle || '')),
    );
    const snapV = await db.collection('voeux').where('journeeId', '==', journeeId).get();
    const voeuxParAtelier = {};
    snapV.docs.forEach((d) => {
      const v = { id: d.id, ...d.data() };
      (voeuxParAtelier[v.atelierId] = voeuxParAtelier[v.atelierId] || []).push(v);
    });
    // Nombre d'ateliers gagnés par personne (pour signaler les cumuls,
    // possibles uniquement sur des places restantes).
    const nbAteliersGagnes = {};
    ateliers.forEach((a) =>
      (a.retenus || []).forEach((r) => {
        nbAteliersGagnes[r.participantId] = (nbAteliersGagnes[r.participantId] || 0) + 1;
      }),
    );

    // Fournisseurs exposants et passages sur les stands.
    const snapFo = await db.collection('fournisseurs').where('journeeId', '==', journeeId).get();
    const fournisseursJ = snapFo.docs.map((d) => ({ id: d.id, ...d.data() }));
    fournisseursJ.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    const snapVis = await db.collection('visites').where('journeeId', '==', journeeId).get();
    const visitesJ = snapVis.docs.map((d) => ({ id: d.id, ...d.data() }));
    const visitesParFournisseur = {};
    visitesJ.forEach((v) => {
      (visitesParFournisseur[v.fournisseurId] = visitesParFournisseur[v.fournisseurId] || []).push(v);
    });

    // Pointages de présence (émargement) et éligibilité à la tombola :
    // visiteurs blanchisseurs ayant validé les trois points (ouverture, AG,
    // présence en salle au moment du tirage).
    const snapPt = await db.collection('pointages').where('journeeId', '==', journeeId).get();
    const pointagesJ = snapPt.docs.map((d) => ({ id: d.id, ...d.data() }));
    const parMoment = { ouverture: new Set(), ag: new Set(), tombola: new Set() };
    pointagesJ.forEach((p) => {
      if (parMoment[p.moment]) parMoment[p.moment].add(p.participantId);
    });
    const candidatsTombola = pointagesJ.filter(
      (p) =>
        p.moment === 'tombola' &&
        p.type === 'visiteur' &&
        p.nom !== 'Anonymisé' &&
        parMoment.ouverture.has(p.participantId) &&
        parMoment.ag.has(p.participantId),
    );

    const actions = Array.isArray(journee.actions) ? journee.actions : [];

    const base = location.origin + location.pathname.replace(/index\.html$/, '');
    const urlFlyer = base + 'portail.html';
    const urlDirecte = base + 'portail.html?e=' + journeeId;

    $app.innerHTML = `
      <div class="fil"><a href="#/journees">Journées d'études</a> › ${echapper(journee.titre)}</div>

      <div class="carte">
        <h2>${echapper(journee.titre)}</h2>
        <p class="muet">${fmtPeriode(journee)}${journee.lieu ? ' — ' + echapper(journee.lieu) : ''}
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
          <label class="champ">Date de début *
            <input id="jm-date" type="date" required value="${attr(journee.date)}"></label>
          <label class="champ">Date de fin (si plusieurs jours)
            <input id="jm-date-fin" type="date" value="${attr(journee.dateFin || '')}"></label>
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
        <h2>Portail participants &amp; QR code</h2>
        <p>Le QR code du flyer pointe vers l'adresse <strong>stable</strong> du
        portail — celle-ci affiche automatiquement la journée marquée
        « active ». Le flyer reste donc valable d'une année sur l'autre.</p>
        ${
          portail.actif
            ? `<div class="info">✅ Cette journée est <strong>active</strong> : c'est elle
                que le portail présente aux participants.</div>`
            : `<div class="erreur">Cette journée n'est pas active : le QR code du flyer
                ne la montrera pas tant que vous ne l'aurez pas activée.</div>
              <div class="ligne-boutons">
                <button id="bouton-activer">Définir comme journée active</button>
              </div>`
        }
        <div class="lien-public" style="margin-top:0.8rem">
          <div id="zone-qr"></div>
          <div style="flex:1">
            <p class="petit"><strong>Adresse du flyer (stable)</strong></p>
            <div class="url">${echapper(urlFlyer)}</div>
            <p class="petit" style="margin-bottom:0"><strong>Adresse directe de cette journée</strong></p>
            <div class="url">${echapper(urlDirecte)}</div>
            <div class="ligne-boutons">
              <button id="bouton-copier-portail" class="secondaire">Copier l'adresse du flyer</button>
              <button id="bouton-telecharger-qr" class="secondaire">Télécharger le QR pour impression (PNG)</button>
              <a class="btn secondaire" href="${attr(urlDirecte)}" target="_blank" rel="noopener">Voir le portail</a>
              <a class="btn secondaire" href="${attr(urlDirecte + '&simu=1')}" target="_blank" rel="noopener">🧪 Portail en simulation (◀ ▶ avant / pendant / après l'AG)</a>
            </div>
            <p class="muet petit">PNG 2048 × 2048, correction d'erreur élevée :
            adapté à l'impression sur flyer. Prévoir une marge blanche autour.</p>
          </div>
        </div>
      </div>

      <div class="carte">
        <h2>Inscrits (${inscriptions.length})</h2>
        <div class="tuiles">
          <div class="tuile"><div class="valeur">${nbVisiteurs}</div>
            <div class="legende">visiteurs blanchisseurs</div></div>
          <div class="tuile"><div class="valeur">${nbExposants}</div>
            <div class="legende">exposants fournisseurs</div></div>
        </div>
        ${
          inscriptions.length
            ? `<div class="ligne-boutons">
                <button id="bouton-csv-inscrits" class="secondaire">Exporter les inscrits (CSV — pour campagne SMS)</button>
                <button id="bouton-csv-annuaire" class="secondaire">Mises à jour pour l'annuaire de l'association (CSV)</button>
              </div>
              <ul class="liste">${inscriptions
                .map(
                  (i) => `
                <li>
                  <div>
                    <span class="titre-item">${echapper(i.prenom)} ${echapper(i.nom)}</span>
                    <span class="badge ${i.type === 'exposant' ? 'brouillon' : 'ouvert'}">${
                      i.type === 'exposant' ? 'Exposant' : 'Visiteur'
                    }</span>
                    ${i.accompagnementHandicap ? '<span class="badge ferme" title="Souhaite être accompagné(e) par le référent handicap URBH">♿ référent handicap</span>' : ''}
                    <div class="muet petit">${i.numeroInscription ? 'Carte n° ' + echapper(i.numeroInscription) + ' — ' : ''}${echapper(i.organisme || '')}
                      ${i.mobile ? ' — 📱 ' + echapper(i.mobile) : ''}
                      ${i.dernierAccesLe ? ' — dernier accès ' + new Date(i.dernierAccesLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                      ${i.nbAcces ? ` (${i.nbAcces} connexions)` : ''}</div>
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Personne ne s'est encore présenté sur le portail.</p>`
        }
      </div>

      <div class="carte">
        <h2>🎁 Tirage au sort</h2>
        <p class="muet">${participationsTirage.length} participation(s) enregistrée(s).
          Les participations sont <strong>${tirageInfo.ouvert ? 'ouvertes' : 'fermées'}</strong>.</p>
        <div class="ligne-boutons">
          <button id="bouton-basculer-tirage" class="${tirageInfo.ouvert ? 'danger' : ''}">
            ${tirageInfo.ouvert ? 'Fermer les participations' : 'Ouvrir les participations'}
          </button>
          <button id="bouton-tirer"
            ${participationsTirage.length > gagnants.length ? '' : 'disabled title="Aucun participant restant"'}>
            🎲 Tirer un gagnant
          </button>
        </div>
        ${
          gagnants.length
            ? `<h3>Gagnants (annoncés sur le portail)</h3>
              <ul class="liste">${gagnants
                .map(
                  (g2, i) => `
                <li>
                  <div>🏆 <span class="titre-item">${echapper(g2.prenom)} ${echapper(g2.nom)}</span>
                    <span class="muet petit">${g2.numeroInscription ? 'carte n° ' + echapper(g2.numeroInscription) + ' — ' : ''}${echapper(g2.organisme || '')}
                    ${g2.mobile ? ' — 📱 ' + echapper(g2.mobile) : ''}</span></div>
                  <div class="pousse">
                    <button class="discret bouton-retirer-gagnant" data-index="${i}">Annuler</button>
                  </div>
                </li>`,
                )
                .join('')}</ul>`
            : ''
        }
        <div id="resultat-tirage"></div>
      </div>

      <div class="carte">
        <h2>🎟️ Tombola de clôture</h2>
        <p class="muet petit">Trois lots offerts par trois fournisseurs, tirés
        au sort à la clôture. <strong>Conditions de participation</strong>
        (affichées aux participants) : être visiteur blanchisseur adhérent,
        être <strong>présent dans la salle lors du tirage</strong>, et avoir
        <strong>validé ses points de présence</strong> — présence à
        l'Assemblée Générale et pointage à l'ouverture des journées sur la
        première conférence. Ouvrez chaque pointage au moment voulu (le
        pointage « présence en salle » juste avant le tirage) ; le tirage ne
        retient que les visiteurs ayant les trois points.</p>
        <h3>Pointages de présence</h3>
        <ul class="liste">${MOMENTS_POINTAGE.map(
          (m) => `<li>
            <div>
              <span class="titre-item">${echapper(m.libelle)}</span>
              <span class="badge ${pointagesOuverts[m.cle] ? 'ouvert' : 'brouillon'}">${
                pointagesOuverts[m.cle] ? 'pointage ouvert' : 'pointage fermé'
              }</span>
              <div class="muet petit">${parMoment[m.cle] ? parMoment[m.cle].size : 0} pointage(s)</div>
            </div>
            <div class="pousse">
              <button class="bouton-basculer-pointage ${pointagesOuverts[m.cle] ? 'danger' : ''}"
                data-moment="${attr(m.cle)}">
                ${pointagesOuverts[m.cle] ? 'Fermer' : 'Ouvrir'} le pointage
              </button>
            </div>
          </li>`,
        ).join('')}</ul>
        <div class="ligne-boutons">
          <button id="bouton-csv-pointages" class="secondaire" ${pointagesJ.length ? '' : 'disabled'}>
            Feuille des pointages (CSV)
          </button>
        </div>
        <h3>Lots et tirage</h3>
        <p class="muet petit"><strong>${candidatsTombola.length}</strong>
        participant(s) éligible(s) actuellement (visiteurs blanchisseurs, trois
        points validés). Une même personne ne peut gagner qu'un seul lot.</p>
        ${
          lotsTombola.length
            ? `<ul class="liste">${lotsTombola
                .map((lot, i) => {
                  const g = gagnantsTombola.find((x) => x.lotIndex === i);
                  return `<li>
                    <div>
                      🎁 <span class="titre-item">${echapper(lot.libelle)}</span>
                      ${lot.fournisseurNom ? `<span class="muet petit"> — offert par ${echapper(lot.fournisseurNom)}</span>` : ''}
                      ${
                        g
                          ? `<div>🏆 ${echapper(g.prenom)} ${echapper(g.nom)}
                              <span class="muet petit">${g.numeroInscription ? 'carte n° ' + echapper(g.numeroInscription) + ' — ' : ''}${echapper(g.organisme || '')}
                              ${g.mobile ? ' — 📱 ' + echapper(g.mobile) : ''}</span></div>`
                          : ''
                      }
                    </div>
                    <div class="pousse">
                      ${
                        g
                          ? `<button class="discret bouton-annuler-gagnant-tombola" data-index="${i}">Annuler le gagnant</button>`
                          : `<button class="bouton-tirer-lot" data-index="${i}"
                              ${candidatsTombola.length ? '' : 'disabled title="Aucun participant éligible"'}>🎲 Tirer ce lot</button>
                            <button class="discret bouton-supprimer-lot" data-index="${i}">Supprimer</button>`
                      }
                    </div>
                  </li>`;
                })
                .join('')}</ul>`
            : `<p class="muet">Aucun lot enregistré pour le moment.</p>`
        }
        <form id="form-lot" class="ligne-boutons" style="align-items:flex-end">
          <label class="champ" style="margin:0;flex:1;min-width:180px">Lot
            <input id="lot-libelle" required placeholder="Ex. : un séjour thalasso"></label>
          <label class="champ" style="margin:0;flex:1;min-width:180px">Offert par (fournisseur)
            <input id="lot-fournisseur" list="liste-fournisseurs-lots" placeholder="Ex. : GIRBAU">
            <datalist id="liste-fournisseurs-lots">
              ${fournisseursJ.map((f) => `<option value="${attr(f.nom)}"></option>`).join('')}
            </datalist></label>
          <button type="submit">Ajouter le lot</button>
        </form>
      </div>

      <div class="carte">
        <h2>🛠️ Ateliers (inscription + tirage au sort)</h2>
        <p class="muet petit">Les inscriptions se font sur le portail,
        <strong>uniquement pendant l'Assemblée Générale</strong> (période
        ci-dessous) : une fois l'AG terminée, l'écran d'inscription disparaît
        du portail. Le tirage au sort de chaque atelier retient en priorité :
        1) les personnes qui n'ont encore gagné aucun atelier ET dont la
        blanchisserie n'est pas déjà représentée ici, 2) puis les autres
        personnes sans atelier, 3) et seulement s'il reste des places, celles
        déjà retenues dans un autre atelier (signalées ⚠️). Les autres sont en
        liste d'attente dans le même ordre de priorité. Tirez les ateliers un
        par un pour garder la main sur les places restantes.</p>
        <h3>Période d'inscription = durée de l'AG</h3>
        ${
          agInfo && agInfo.debut && agInfo.fin
            ? `<p class="muet petit">AG paramétrée du
                <strong>${fmtHorodatage(agInfo.debut)}</strong> au
                <strong>${fmtHorodatage(agInfo.fin)}</strong> —
                inscriptions ${
                  new Date() < agInfo.debut.toDate()
                    ? 'pas encore ouvertes'
                    : new Date() > agInfo.fin.toDate()
                      ? 'closes (AG terminée)'
                      : '<strong>ouvertes (AG en cours)</strong>'
                }.</p>`
            : `<p class="muet petit">⚠️ Période d'AG non paramétrée : les
                inscriptions aux ateliers restent fermées sur le portail.</p>`
        }
        <form id="form-ag" class="ligne-boutons" style="align-items:flex-end">
          <label class="champ" style="margin:0">Début de l'AG
            <input id="ag-debut" type="datetime-local" required
              value="${attr(versDatetimeLocal(agInfo && agInfo.debut))}"></label>
          <label class="champ" style="margin:0">Fin de l'AG
            <input id="ag-fin" type="datetime-local" required
              value="${attr(versDatetimeLocal(agInfo && agInfo.fin))}"></label>
          <button type="submit">Enregistrer la période</button>
        </form>
        <h3>Ateliers</h3>
        ${
          ateliers.length
            ? ateliers
                .map((a) => {
                  const voeux = voeuxParAtelier[a.id] || [];
                  const organismes = new Set(
                    voeux.map((v) => (v.organisme || '').trim().toLowerCase()).filter(Boolean),
                  );
                  const agOuverte =
                    agInfo &&
                    agInfo.debut &&
                    agInfo.fin &&
                    new Date() >= agInfo.debut.toDate() &&
                    new Date() <= agInfo.fin.toDate();
                  const badges = {
                    tire: '<span class="badge ferme">Tirage effectué</span>',
                  };
                  badges[a.statut] =
                    badges[a.statut] ||
                    (agOuverte
                      ? '<span class="badge ouvert">Inscriptions ouvertes (AG en cours)</span>'
                      : '<span class="badge brouillon">Inscriptions pendant l\'AG</span>');
                  return `<div class="q-item">
                    <div class="q-entete">
                      <span class="q-type">Salle ${echapper(a.salle)}</span>
                      <span class="muet petit">${echapper(a.horaire || '')} — ${a.capacite} places</span>
                      ${badges[a.statut] || ''}
                      <div class="pousse">
                        <button class="discret bouton-supprimer-atelier" data-id="${attr(a.id)}">Supprimer</button>
                      </div>
                    </div>
                    <div><strong>${echapper(a.nom)}</strong></div>
                    ${a.intervenants ? `<div class="muet petit">${echapper(a.intervenants)}</div>` : ''}
                    <div class="muet petit">${voeux.length} inscrit(s), ${organismes.size} établissement(s) distinct(s)</div>
                    <div class="ligne-boutons">
                      ${
                        a.statut !== 'tire'
                          ? `<button class="bouton-tirer-atelier" data-id="${attr(a.id)}" ${voeux.length ? '' : 'disabled title="Aucun inscrit"'}>🎲 Tirer au sort</button>`
                          : `<button class="secondaire bouton-csv-atelier" data-id="${attr(a.id)}">Feuille d'émargement (CSV)</button>
                            <button class="secondaire bouton-refaire-atelier" data-id="${attr(a.id)}">Refaire le tirage</button>`
                      }
                    </div>
                    ${
                      a.statut === 'tire'
                        ? `<div><strong>Retenus (${(a.retenus || []).length})</strong> :
                            ${(a.retenus || [])
                              .map(
                                (r) =>
                                  `${nbAteliersGagnes[r.participantId] > 1 ? '⚠️ ' : ''}${echapper(r.prenom)} ${echapper(r.nom)}${r.numeroInscription ? ' (n° ' + echapper(r.numeroInscription) + ')' : ''}${r.organisme ? ' — ' + echapper(r.organisme) : ''}`,
                              )
                              .join(' · ') || 'aucun'}
                          </div>
                          ${
                            (a.listeAttente || []).length
                              ? `<div class="muet petit"><strong>Liste d'attente</strong> :
                                  ${(a.listeAttente || [])
                                    .map(
                                      (r, i) =>
                                        `${i + 1}. ${echapper(r.prenom)} ${echapper(r.nom)}${r.organisme ? ' (' + echapper(r.organisme) + ')' : ''}`,
                                    )
                                    .join(' · ')}
                                </div>`
                              : ''
                          }`
                        : ''
                    }
                  </div>`;
                })
                .join('')
            : `<p class="muet">Aucun atelier pour cette journée.</p>
              <div class="ligne-boutons">
                <button id="bouton-seed-ateliers" class="secondaire">
                  Créer les 6 ateliers URBH types (salles B, C, D × 2 créneaux)
                </button>
              </div>`
        }
        <h3>Ajouter un atelier</h3>
        <form id="form-atelier">
          <label class="champ">Intitulé *
            <input id="at-nom" required placeholder="Ex. : L'Intelligence Artificielle au service des blanchisseries"></label>
          <label class="champ">Salle *
            <input id="at-salle" required placeholder="B" style="max-width:8rem"></label>
          <label class="champ">Créneau *
            <input id="at-horaire" required placeholder="Jeudi 15h00 – 16h00"></label>
          <label class="champ">Début précis (date et heure — sert au rappel envoyé
            10 minutes avant sur les téléphones)
            <input id="at-debut" type="datetime-local"></label>
          <label class="champ">Nombre de places *
            <input id="at-capacite" type="number" min="1" step="1" value="20" required style="max-width:8rem"></label>
          <label class="champ">Intervenants / description
            <input id="at-intervenants"></label>
          <div class="ligne-boutons">
            <button type="submit">Créer l'atelier</button>
          </div>
        </form>
      </div>

      <div class="carte">
        <h2>🏭 Fournisseurs &amp; passages sur les stands</h2>
        <p class="muet petit">Chaque stand affiche son QR code : le visiteur le
        scanne avec l'appareil photo de son téléphone, confirme son passage et
        consent au partage de ses coordonnées avec le fournisseur. Vous
        exportez ensuite la liste des visiteurs de chaque stand.</p>
        <div class="tuiles">
          <div class="tuile"><div class="valeur">${fournisseursJ.length}</div>
            <div class="legende">fournisseurs</div></div>
          <div class="tuile"><div class="valeur">${visitesJ.length}</div>
            <div class="legende">passages enregistrés</div></div>
        </div>
        ${
          fournisseursJ.length
            ? `<div class="ligne-boutons">
                <button id="bouton-imprimer-qr-stands" class="secondaire">🖨️ Imprimer les QR des stands</button>
                <button id="bouton-csv-visites" class="secondaire" ${visitesJ.length ? '' : 'disabled'}>Exporter tous les passages (CSV)</button>
              </div>
              <ul class="liste">${fournisseursJ
                .map(
                  (f) => `<li>
                    <div>
                      <span class="titre-item">${echapper(f.nom)}</span>
                      ${f.stand ? `<span class="muet petit"> — Stand ${echapper(f.stand)}</span>` : ''}
                      ${f.nouveau ? '<span class="badge brouillon">🆕 nouveau</span>' : ''}
                      <span class="badge ouvert">${(visitesParFournisseur[f.id] || []).length} passage(s)</span>
                      ${f.description ? `<div class="muet petit">${echapper(f.description)}</div>` : ''}
                    </div>
                    <div class="pousse">
                      <button class="discret bouton-basculer-nouveau" data-id="${attr(f.id)}">
                        ${f.nouveau ? 'Retirer « nouveau »' : 'Marquer 🆕 nouveau'}</button>
                      <button class="discret bouton-csv-fournisseur" data-id="${attr(f.id)}"
                        ${(visitesParFournisseur[f.id] || []).length ? '' : 'disabled'}>CSV visiteurs</button>
                      <button class="discret bouton-supprimer-fournisseur" data-id="${attr(f.id)}">Supprimer</button>
                    </div>
                  </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucun fournisseur enregistré pour cette journée.</p>`
        }
        <h3>Ajouter un fournisseur</h3>
        <form id="form-fournisseur">
          <label class="champ">Nom *
            <input id="fo-nom" required placeholder="Ex. : GIRBAU"></label>
          <label class="champ">N° de stand
            <input id="fo-stand" placeholder="Ex. : 12" style="max-width:8rem"></label>
          <label class="champ">Description / activité
            <input id="fo-description" placeholder="Ex. : matériel de blanchisserie"></label>
          <label class="champ" style="font-weight:normal">
            <input type="checkbox" id="fo-nouveau" style="display:inline;width:auto">
            🆕 Nouveau fournisseur — mis en avant sur le portail (avec son n° de stand)</label>
          <div class="ligne-boutons">
            <button type="submit">Ajouter le fournisseur</button>
          </div>
        </form>
        <h3>Importer une liste (Excel ou CSV)</h3>
        <p class="muet petit">Importez la liste des fournisseurs avec leur stand,
        puis la liste des <strong>nouveaux</strong> fournisseurs en cochant
        « marquer comme nouveaux » : un fournisseur déjà présent (même nom)
        est simplement mis à jour et mis en avant, pas créé en double.</p>
        <label class="champ">Fichier (.xlsx ou .csv)
          <input type="file" id="fo-fichier" accept=".xlsx,.xls,.csv"></label>
        <div id="fo-zone-mapping"></div>
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
                    <div class="muet">${(q.questions || []).length} questions —
                      ${q.audience === 'visiteur' ? 'visiteurs' : q.audience === 'exposant' ? 'exposants' : 'tous les inscrits'}</div>
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
          <label class="champ">Proposé à
            <select id="q-audience">
              <option value="tous">Tous les inscrits</option>
              <option value="visiteur">Visiteurs blanchisseurs uniquement</option>
              <option value="exposant">Exposants fournisseurs uniquement</option>
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

    // --- portail & QR

    if (window.QRCode) {
      new QRCode(document.getElementById('zone-qr'), {
        text: urlFlyer,
        width: 180,
        height: 180,
        correctLevel: QRCode.CorrectLevel.H,
      });
    } else {
      document.getElementById('zone-qr').innerHTML =
        '<p class="muet petit">QR code indisponible<br>(bibliothèque non chargée)</p>';
    }

    const boutonActiver = document.getElementById('bouton-activer');
    if (boutonActiver) {
      boutonActiver.addEventListener('click', async () => {
        // Une seule journée active à la fois.
        const tous = await db.collection('portails').get();
        const lot = db.batch();
        tous.docs.forEach((d) => lot.update(d.ref, { actif: d.id === journeeId }));
        await lot.commit();
        router();
      });
    }

    document.getElementById('bouton-copier-portail').addEventListener('click', async (evt) => {
      try {
        await navigator.clipboard.writeText(urlFlyer);
        evt.target.textContent = 'Adresse copiée ✓';
      } catch (_) {
        prompt("Copiez l'adresse :", urlFlyer);
      }
    });

    document.getElementById('bouton-telecharger-qr').addEventListener('click', () => {
      if (!window.QRCode) {
        alert('La bibliothèque QR code ne s’est pas chargée : vérifiez la connexion internet.');
        return;
      }
      // Rendu haute résolution hors écran, puis téléchargement du PNG.
      const conteneur = document.createElement('div');
      conteneur.style.position = 'fixed';
      conteneur.style.left = '-9999px';
      document.body.appendChild(conteneur);
      new QRCode(conteneur, {
        text: urlFlyer,
        width: 2048,
        height: 2048,
        correctLevel: QRCode.CorrectLevel.H,
      });
      setTimeout(() => {
        const canvas = conteneur.querySelector('canvas');
        const img = conteneur.querySelector('img');
        const donnees = canvas ? canvas.toDataURL('image/png') : img ? img.src : null;
        if (donnees) {
          const a = document.createElement('a');
          a.href = donnees;
          a.download = 'qr-portail-urbh.png';
          a.click();
        }
        conteneur.remove();
      }, 150);
    });

    // --- inscrits

    const boutonCsvInscrits = document.getElementById('bouton-csv-inscrits');
    if (boutonCsvInscrits) {
      boutonCsvInscrits.addEventListener('click', () => {
        const sep = ';';
        const cellule = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lignes = [
          ['N° inscription', 'Type', 'Prénom', 'Nom', 'Organisme', 'Mobile', 'E-mail', 'Accompagnement handicap', 'Première connexion', 'Dernier accès', 'Nb connexions']
            .map(cellule)
            .join(sep),
        ];
        inscriptions.forEach((i) => {
          lignes.push(
            [
              i.numeroInscription || '',
              i.type === 'exposant' ? 'Exposant fournisseur' : 'Visiteur blanchisseur',
              i.prenom,
              i.nom,
              i.organisme || '',
              i.mobile || '',
              i.email || '',
              i.accompagnementHandicap ? 'Oui' : '',
              i.creeLe ? new Date(i.creeLe).toLocaleString('fr-FR') : '',
              i.dernierAccesLe ? new Date(i.dernierAccesLe).toLocaleString('fr-FR') : '',
              i.nbAcces || '',
            ]
              .map(cellule)
              .join(sep),
          );
        });
        const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'inscrits-' + fmtDate(journee.date).replace(/\//g, '-') + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    // Mises à jour pour l'annuaire de l'association : compare la fiche
    // annuaire de chaque inscrit avec les informations qu'il a validées (ou
    // corrigées) sur le portail, et signale les différences.
    const boutonCsvAnnuaire = document.getElementById('bouton-csv-annuaire');
    if (boutonCsvAnnuaire) {
      boutonCsvAnnuaire.addEventListener('click', async () => {
        boutonCsvAnnuaire.disabled = true;
        const snapAn = await db.collection('annuaire').get();
        const parNumero = {};
        snapAn.docs.forEach((d) => {
          parNumero[d.id] = d.data();
        });
        const egal = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
        const sep = ';';
        const cellule = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lignes = [
          ['N° inscription', 'Statut', 'Nom (annuaire)', 'Nom (validé)', 'Prénom (annuaire)', 'Prénom (validé)',
           'Établissement (annuaire)', 'Établissement (validé)', 'Mobile (validé)', 'E-mail (validé)', 'À mettre à jour']
            .map(cellule)
            .join(sep),
        ];
        inscriptions
          .filter((i) => i.nom && i.nom !== 'Anonymisé')
          .forEach((i) => {
            const fiche = parNumero[normaliserNumero(i.numeroInscription)] || null;
            const different =
              !fiche ||
              !egal(fiche.nom, i.nom) ||
              !egal(fiche.prenom, i.prenom) ||
              !egal(fiche.organisme, i.organisme);
            lignes.push(
              [
                i.numeroInscription || '',
                fiche ? 'Connu de l\'annuaire' : 'NOUVEAU (absent de l\'annuaire)',
                fiche ? fiche.nom || '' : '',
                i.nom || '',
                fiche ? fiche.prenom || '' : '',
                i.prenom || '',
                fiche ? fiche.organisme || '' : '',
                i.organisme || '',
                i.mobile || '',
                i.email || '',
                different ? 'OUI' : '',
              ]
                .map(cellule)
                .join(sep),
            );
          });
        const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mises-a-jour-annuaire.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        boutonCsvAnnuaire.disabled = false;
      });
    }

    // --- tirage au sort

    document.getElementById('bouton-basculer-tirage').addEventListener('click', async () => {
      await refPortail.update({ 'tirage.ouvert': !tirageInfo.ouvert });
      router();
    });

    const boutonTirer = document.getElementById('bouton-tirer');
    boutonTirer.addEventListener('click', async () => {
      const dejaGagnants = new Set(gagnants.map((g2) => g2.participantId));
      const candidats = participationsTirage.filter((p) => !dejaGagnants.has(p.participantId));
      if (!candidats.length) return;
      const elu = candidats[Math.floor(Math.random() * candidats.length)];
      await refPortail.update({
        'tirage.gagnants': [
          ...gagnants,
          {
            participantId: elu.participantId,
            prenom: elu.prenom,
            nom: elu.nom,
            organisme: elu.organisme || '',
            mobile: elu.mobile || '',
            numeroInscription: elu.numeroInscription || '',
          },
        ],
      });
      router();
    });

    document.querySelectorAll('.bouton-retirer-gagnant').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        if (!confirm('Annuler ce gagnant ? Il redevient éligible au tirage.')) return;
        await refPortail.update({
          'tirage.gagnants': gagnants.filter((_, idx) => idx !== i),
        });
        router();
      }),
    );

    // --- tombola de clôture : pointages, lots, tirage

    document.querySelectorAll('.bouton-basculer-pointage').forEach((b) =>
      b.addEventListener('click', async () => {
        const cle = b.dataset.moment;
        await refPortail.update({ ['pointages.' + cle]: !pointagesOuverts[cle] });
        router();
      }),
    );

    const boutonCsvPointages = document.getElementById('bouton-csv-pointages');
    if (boutonCsvPointages) {
      boutonCsvPointages.addEventListener('click', () => {
        const libelles = {};
        MOMENTS_POINTAGE.forEach((m) => {
          libelles[m.cle] = m.libelle;
        });
        const sep = ';';
        const cellule = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lignes = [
          ['Moment', 'N° inscription', 'Prénom', 'Nom', 'Établissement', 'Profil', 'Mobile', 'Pointé le']
            .map(cellule)
            .join(sep),
        ];
        const tries = [...pointagesJ].sort(
          (a, b) =>
            String(a.moment).localeCompare(String(b.moment)) ||
            String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'),
        );
        tries.forEach((p) =>
          lignes.push(
            [
              libelles[p.moment] || p.moment,
              p.numeroInscription || '',
              p.prenom || '',
              p.nom || '',
              p.organisme || '',
              p.type === 'exposant' ? 'Exposant' : 'Visiteur',
              p.mobile || '',
              p.pointeLe ? new Date(p.pointeLe).toLocaleString('fr-FR') : '',
            ]
              .map(cellule)
              .join(sep),
          ),
        );
        const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pointages-presence.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    document.getElementById('form-lot').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const libelle = document.getElementById('lot-libelle').value.trim();
      if (!libelle) return;
      await refPortail.update({
        'tombola.lots': [
          ...lotsTombola,
          { libelle, fournisseurNom: document.getElementById('lot-fournisseur').value.trim() },
        ],
      });
      router();
    });

    document.querySelectorAll('.bouton-supprimer-lot').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        if (!confirm('Supprimer ce lot ?')) return;
        // Les gagnants des lots suivants glissent d'un rang avec leur lot.
        await refPortail.update({
          'tombola.lots': lotsTombola.filter((_, idx) => idx !== i),
          'tombola.gagnants': gagnantsTombola
            .filter((g) => g.lotIndex !== i)
            .map((g) => (g.lotIndex > i ? { ...g, lotIndex: g.lotIndex - 1 } : g)),
        });
        router();
      }),
    );

    document.querySelectorAll('.bouton-tirer-lot').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        const lot = lotsTombola[i];
        if (!lot) return;
        const dejaGagnantsT = new Set(gagnantsTombola.map((g) => g.participantId));
        const restants = candidatsTombola.filter((c) => !dejaGagnantsT.has(c.participantId));
        if (!restants.length) {
          alert('Aucun participant éligible restant (présence en salle + AG + ouverture, visiteurs uniquement).');
          return;
        }
        const elu = restants[Math.floor(Math.random() * restants.length)];
        await refPortail.update({
          'tombola.gagnants': [
            ...gagnantsTombola,
            {
              lotIndex: i,
              lotLibelle: lot.libelle,
              fournisseurNom: lot.fournisseurNom || '',
              participantId: elu.participantId,
              prenom: elu.prenom || '',
              nom: elu.nom || '',
              organisme: elu.organisme || '',
              mobile: elu.mobile || '',
              numeroInscription: elu.numeroInscription || '',
            },
          ],
        });
        router();
      }),
    );

    document.querySelectorAll('.bouton-annuler-gagnant-tombola').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        if (!confirm('Annuler le gagnant de ce lot ? Il redevient éligible.')) return;
        await refPortail.update({
          'tombola.gagnants': gagnantsTombola.filter((g) => g.lotIndex !== i),
        });
        router();
      }),
    );

    // --- ateliers

    async function creerAtelier(donnees) {
      await db.collection('ateliers').add({
        journeeId,
        statut: 'ferme',
        retenus: [],
        listeAttente: [],
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
        ...donnees,
      });
    }

    const boutonSeed = document.getElementById('bouton-seed-ateliers');
    if (boutonSeed) {
      boutonSeed.addEventListener('click', async () => {
        const types = [
          {
            salle: 'B',
            nom: "L'Intelligence Artificielle au service des blanchisseries",
            intervenants: 'La Rochelle : Vincent Pacton — Puy-en-Velay : Denis Bonnet — Toulouse',
          },
          {
            salle: 'C',
            nom: 'Des outils pour la gestion de la maintenance',
            intervenants: 'Tours : Jean-Pascal Testard — Poitiers : Lucas Monrousseau et Hervé Dumoulin',
          },
          {
            salle: 'D',
            nom: "Comment l'IA peut-elle nous aider dans la mise en place et le pilotage de la RABC ?",
            intervenants: 'Mickael Gilbrin, Frédéric Jourdan, Catherine Diallo',
          },
        ];
        // Le jeudi des journées (s'il existe) donne le début précis des
        // créneaux, utilisé pour le rappel 10 minutes avant sur les téléphones.
        let jeudi = null;
        if (journee.date) {
          const debutJ = new Date(journee.date + 'T00:00:00');
          const finJ = new Date((journee.dateFin || journee.date) + 'T00:00:00');
          for (let d = new Date(debutJ); d <= finJ; d.setDate(d.getDate() + 1)) {
            if (d.getDay() === 4) {
              jeudi = new Date(d);
              break;
            }
          }
        }
        const creneaux = [
          { horaire: 'Jeudi 15h00 – 16h00', heure: 15 },
          { horaire: 'Jeudi 16h00 – 17h00', heure: 16 },
        ];
        for (const c of creneaux) {
          let debutLe = null;
          if (jeudi) {
            const d = new Date(jeudi);
            d.setHours(c.heure, 0, 0, 0);
            debutLe = firebase.firestore.Timestamp.fromDate(d);
          }
          for (const t of types) {
            await creerAtelier({ ...t, horaire: c.horaire, debutLe, capacite: 20 });
          }
        }
        router();
      });
    }

    document.getElementById('form-atelier').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const debutBrut = document.getElementById('at-debut').value;
      const debut = debutBrut ? new Date(debutBrut) : null;
      await creerAtelier({
        nom: document.getElementById('at-nom').value.trim(),
        salle: document.getElementById('at-salle').value.trim(),
        horaire: document.getElementById('at-horaire').value.trim(),
        debutLe:
          debut && !Number.isNaN(debut.getTime())
            ? firebase.firestore.Timestamp.fromDate(debut)
            : null,
        capacite: Math.max(1, Number(document.getElementById('at-capacite').value) || 20),
        intervenants: document.getElementById('at-intervenants').value.trim(),
      });
      router();
    });

    // Période de l'AG = fenêtre d'inscription aux ateliers (portail + règles).
    document.getElementById('form-ag').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const debut = new Date(document.getElementById('ag-debut').value);
      const fin = new Date(document.getElementById('ag-fin').value);
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) return;
      if (fin <= debut) {
        alert("La fin de l'AG doit être après son début.");
        return;
      }
      await refPortail.update({
        ag: {
          debut: firebase.firestore.Timestamp.fromDate(debut),
          fin: firebase.firestore.Timestamp.fromDate(fin),
        },
      });
      router();
    });

    // Tirage au sort équitable, atelier par atelier, dans l'ordre aléatoire :
    //  1. priorité aux personnes non retenues dans un AUTRE atelier de la
    //     journée ET dont l'établissement n'est pas encore représenté ici ;
    //  2. puis, s'il reste des places, aux autres personnes non retenues
    //     ailleurs (même si leur établissement est déjà représenté) ;
    //  3. enfin, s'il reste encore des places, aux personnes déjà retenues
    //     dans un autre atelier (une personne ne cumule donc plusieurs
    //     ateliers que sur des places restantes).
    // La liste d'attente reprend le même ordre de priorité.
    function tirerEquitable(voeux, capacite, retenusAilleurs) {
      const melange = [...voeux];
      for (let i = melange.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [melange[i], melange[j]] = [melange[j], melange[i]];
      }
      const retenus = [];
      const pris = new Set();
      const etablissementsPris = new Set();
      const cleEtab = (v) =>
        (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;

      function passe(condition) {
        melange.forEach((v) => {
          if (retenus.length >= capacite || pris.has(v.participantId)) return;
          if (!condition(v)) return;
          retenus.push(v);
          pris.add(v.participantId);
          etablissementsPris.add(cleEtab(v));
        });
      }
      passe((v) => !retenusAilleurs.has(v.participantId) && !etablissementsPris.has(cleEtab(v)));
      passe((v) => !retenusAilleurs.has(v.participantId));
      passe(() => true);

      const restants = melange.filter((v) => !pris.has(v.participantId));
      const attente = [
        ...restants.filter((v) => !retenusAilleurs.has(v.participantId)),
        ...restants.filter((v) => retenusAilleurs.has(v.participantId)),
      ];
      return { retenus, attente };
    }

    function versPublic(v) {
      return {
        participantId: v.participantId,
        prenom: v.prenom || '',
        nom: v.nom || '',
        organisme: v.organisme || '',
        numeroInscription: v.numeroInscription || '',
        type: v.type || '',
      };
    }

    async function lancerTirageAtelier(atelierId) {
      const atelier = ateliers.find((x) => x.id === atelierId);
      const voeux = voeuxParAtelier[atelierId] || [];
      if (!atelier || !voeux.length) return;
      // Personnes déjà retenues dans un autre atelier de la journée : elles
      // ne repassent ici que sur des places restantes.
      const retenusAilleurs = new Set();
      ateliers.forEach((x) => {
        if (x.id !== atelierId) {
          (x.retenus || []).forEach((r) => retenusAilleurs.add(r.participantId));
        }
      });
      const { retenus, attente } = tirerEquitable(voeux, atelier.capacite || 20, retenusAilleurs);
      await db.collection('ateliers').doc(atelierId).update({
        statut: 'tire',
        retenus: retenus.map(versPublic),
        listeAttente: attente.map(versPublic),
        tireLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      router();
    }

    document.querySelectorAll('.bouton-tirer-atelier').forEach((b) =>
      b.addEventListener('click', () => lancerTirageAtelier(b.dataset.id)),
    );
    document.querySelectorAll('.bouton-refaire-atelier').forEach((b) =>
      b.addEventListener('click', () => {
        if (confirm('Refaire le tirage de cet atelier ? Le résultat actuel sera remplacé.')) {
          lancerTirageAtelier(b.dataset.id);
        }
      }),
    );

    document.querySelectorAll('.bouton-csv-atelier').forEach((b) =>
      b.addEventListener('click', () => {
        const atelier = ateliers.find((x) => x.id === b.dataset.id);
        if (!atelier) return;
        const voeux = voeuxParAtelier[atelier.id] || [];
        const mobiles = {};
        voeux.forEach((v) => {
          mobiles[v.participantId] = v.mobile || '';
        });
        const sep = ';';
        const cellule = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lignes = [
          ['Statut', 'N° inscription', 'Prénom', 'Nom', 'Établissement', 'Mobile', 'Émargement']
            .map(cellule)
            .join(sep),
        ];
        (atelier.retenus || []).forEach((r) =>
          lignes.push(
            ['Retenu', r.numeroInscription, r.prenom, r.nom, r.organisme, mobiles[r.participantId] || '', '']
              .map(cellule)
              .join(sep),
          ),
        );
        (atelier.listeAttente || []).forEach((r, i) =>
          lignes.push(
            [`Attente ${i + 1}`, r.numeroInscription, r.prenom, r.nom, r.organisme, mobiles[r.participantId] || '', '']
              .map(cellule)
              .join(sep),
          ),
        );
        const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download =
          'atelier-salle-' + (atelier.salle || 'x') + '-' + (atelier.horaire || '').replace(/[^\dh]+/g, '-') + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      }),
    );

    document.querySelectorAll('.bouton-supprimer-atelier').forEach((b) =>
      b.addEventListener('click', async () => {
        const voeux = voeuxParAtelier[b.dataset.id] || [];
        if (!confirm(`Supprimer cet atelier${voeux.length ? ` et ses ${voeux.length} inscriptions` : ''} ?`)) return;
        const lot = db.batch();
        voeux.forEach((v) => lot.delete(db.collection('voeux').doc(v.id)));
        lot.delete(db.collection('ateliers').doc(b.dataset.id));
        await lot.commit();
        router();
      }),
    );

    // --- fournisseurs & passages sur les stands

    document.getElementById('form-fournisseur').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      await db.collection('fournisseurs').add({
        journeeId,
        nom: document.getElementById('fo-nom').value.trim(),
        stand: document.getElementById('fo-stand').value.trim(),
        description: document.getElementById('fo-description').value.trim(),
        nouveau: document.getElementById('fo-nouveau').checked,
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      router();
    });

    document.querySelectorAll('.bouton-basculer-nouveau').forEach((b) =>
      b.addEventListener('click', async () => {
        const f = fournisseursJ.find((x) => x.id === b.dataset.id);
        if (!f) return;
        await db.collection('fournisseurs').doc(f.id).update({ nouveau: !f.nouveau });
        router();
      }),
    );

    // Import de la liste des fournisseurs (nom / stand / description) depuis
    // un fichier Excel ou CSV : les fournisseurs déjà présents (même nom)
    // sont mis à jour, pas dupliqués — pratique pour la liste des nouveaux.
    const champFichierFo = document.getElementById('fo-fichier');
    champFichierFo.addEventListener('change', async () => {
      const fichier = champFichierFo.files[0];
      if (!fichier) return;
      if (!window.XLSX) {
        alert('La bibliothèque de lecture Excel ne s’est pas chargée : vérifiez la connexion internet.');
        return;
      }
      const tampon = await fichier.arrayBuffer();
      const classeur = XLSX.read(tampon);
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      const lignes = XLSX.utils
        .sheet_to_json(feuille, { header: 1, raw: false, defval: '' })
        .filter((l) => l.some((v) => String(v).trim() !== ''));
      if (!lignes.length) return;

      const nbCols = Math.max(...lignes.map((l) => l.length));
      const lettre = (i) => String.fromCharCode(65 + (i % 26));
      // Pré-sélection d'après la ligne d'en-têtes si elle existe.
      const entetes = lignes[0].map((v) => String(v).trim().toLowerCase());
      const chercher = (mots) => entetes.findIndex((e) => mots.some((m) => e.includes(m)));
      const enTete = chercher(['nom', 'fournisseur', 'société', 'societe', 'stand']) >= 0;
      const preNom = chercher(['nom', 'fournisseur', 'société', 'societe']);
      const preStand = chercher(['stand', 'n°', 'numéro', 'numero', 'emplacement']);
      const preDesc = chercher(['description', 'activité', 'activite', 'produit']);

      const options = (selection, avecAucune) => {
        let html = avecAucune ? `<option value="-1">— aucune —</option>` : '';
        for (let c = 0; c < nbCols; c += 1) {
          const exemple = (lignes[enTete ? 1 : 0] || [])[c] || '';
          html += `<option value="${c}" ${c === selection ? 'selected' : ''}>Colonne ${lettre(c)} — ex. « ${echapper(String(exemple).slice(0, 25))} »</option>`;
        }
        return html;
      };

      document.getElementById('fo-zone-mapping').innerHTML = `
        <label class="champ">Colonne du nom *
          <select id="fo-col-nom">${options(preNom >= 0 ? preNom : 0, false)}</select></label>
        <label class="champ">Colonne du n° de stand
          <select id="fo-col-stand">${options(preStand, true)}</select></label>
        <label class="champ">Colonne de la description
          <select id="fo-col-desc">${options(preDesc, true)}</select></label>
        <label class="champ" style="font-weight:normal">
          <input type="checkbox" id="fo-entetes" style="display:inline;width:auto" ${enTete ? 'checked' : ''}>
          La première ligne contient les en-têtes (ignorée)</label>
        <label class="champ" style="font-weight:normal">
          <input type="checkbox" id="fo-import-nouveaux" style="display:inline;width:auto">
          🆕 Marquer ces fournisseurs comme <strong>nouveaux</strong> (mis en avant sur le portail)</label>
        <div class="ligne-boutons">
          <button type="button" id="fo-importer">Importer ${lignes.length - (enTete ? 1 : 0)} fournisseur(s)</button>
        </div>
        <div id="fo-resultat"></div>`;

      document.getElementById('fo-importer').addEventListener('click', async () => {
        const colNom = Number(document.getElementById('fo-col-nom').value);
        const colStand = Number(document.getElementById('fo-col-stand').value);
        const colDesc = Number(document.getElementById('fo-col-desc').value);
        const nouveaux = document.getElementById('fo-import-nouveaux').checked;
        const corps = document.getElementById('fo-entetes').checked ? lignes.slice(1) : lignes;
        const parNom = {};
        fournisseursJ.forEach((f) => {
          parNom[(f.nom || '').trim().toLowerCase()] = f;
        });
        let ajoutes = 0;
        let maj = 0;
        const dejaAjoutes = new Set();
        const lot = db.batch();
        corps.forEach((l) => {
          const nom = String(l[colNom] || '').trim();
          if (!nom) return;
          const cle = nom.toLowerCase();
          const stand = colStand >= 0 ? String(l[colStand] || '').trim() : '';
          const description = colDesc >= 0 ? String(l[colDesc] || '').trim() : '';
          const existant = parNom[cle];
          if (existant) {
            const donnees = {};
            if (stand) donnees.stand = stand;
            if (description) donnees.description = description;
            if (nouveaux) donnees.nouveau = true;
            if (Object.keys(donnees).length) {
              lot.update(db.collection('fournisseurs').doc(existant.id), donnees);
              maj += 1;
            }
          } else if (!dejaAjoutes.has(cle)) {
            lot.set(db.collection('fournisseurs').doc(), {
              journeeId,
              nom,
              stand,
              description,
              nouveau: nouveaux,
              creeLe: firebase.firestore.FieldValue.serverTimestamp(),
            });
            ajoutes += 1;
            dejaAjoutes.add(cle);
          }
        });
        await lot.commit();
        document.getElementById('fo-resultat').innerHTML =
          `<div class="info">✅ ${ajoutes} fournisseur(s) ajouté(s), ${maj} mis à jour${nouveaux ? ' — marqués 🆕 nouveaux' : ''}.</div>`;
        setTimeout(router, 1200);
      });
    });

    document.querySelectorAll('.bouton-supprimer-fournisseur').forEach((b) =>
      b.addEventListener('click', async () => {
        const visites = visitesParFournisseur[b.dataset.id] || [];
        if (!confirm(`Supprimer ce fournisseur${visites.length ? ` et ses ${visites.length} passages enregistrés` : ''} ?`)) return;
        const lot = db.batch();
        visites.forEach((v) => lot.delete(db.collection('visites').doc(v.id)));
        lot.delete(db.collection('fournisseurs').doc(b.dataset.id));
        await lot.commit();
        router();
      }),
    );

    function csvVisites(visites, fichier) {
      const sep = ';';
      const cellule = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lignes = [
        ['Fournisseur', 'Prénom', 'Nom', 'Établissement', 'Profil', 'N° inscription', 'Mobile', 'E-mail', 'Passage le']
          .map(cellule)
          .join(sep),
      ];
      visites.forEach((v) =>
        lignes.push(
          [
            v.fournisseurNom || '',
            v.prenom || '',
            v.nom || '',
            v.organisme || '',
            v.type === 'exposant' ? 'Exposant' : 'Visiteur',
            v.numeroInscription || '',
            v.mobile || '',
            v.email || '',
            v.viseLe ? new Date(v.viseLe).toLocaleString('fr-FR') : '',
          ]
            .map(cellule)
            .join(sep),
        ),
      );
      const blob = new Blob(['\uFEFF' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fichier;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    const boutonCsvVisites = document.getElementById('bouton-csv-visites');
    if (boutonCsvVisites) {
      boutonCsvVisites.addEventListener('click', () => csvVisites(visitesJ, 'passages-stands.csv'));
    }
    document.querySelectorAll('.bouton-csv-fournisseur').forEach((b) =>
      b.addEventListener('click', () => {
        const f = fournisseursJ.find((x) => x.id === b.dataset.id);
        csvVisites(
          visitesParFournisseur[b.dataset.id] || [],
          'visiteurs-' + (f && f.nom ? f.nom.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() : 'stand') + '.csv',
        );
      }),
    );

    const boutonImprimerQr = document.getElementById('bouton-imprimer-qr-stands');
    if (boutonImprimerQr) {
      boutonImprimerQr.addEventListener('click', () => {
        if (!window.QRCode) {
          alert('La bibliothèque QR code ne s’est pas chargée : vérifiez la connexion internet.');
          return;
        }
        const ancien = document.getElementById('impression-qr');
        if (ancien) ancien.remove();
        const zone = document.createElement('div');
        zone.id = 'impression-qr';
        document.body.appendChild(zone);
        fournisseursJ.forEach((f) => {
          const bloc = document.createElement('div');
          bloc.className = 'qr-stand';
          bloc.innerHTML = `
            <div class="qr-stand-titre">${echapper(f.nom)}</div>
            <div class="qr-stand-sous">${f.stand ? 'Stand ' + echapper(f.stand) : ''}</div>
            <div class="qr-stand-code"></div>
            <div class="qr-stand-legende">📲 Scannez avec l'appareil photo de votre téléphone<br>
            pour enregistrer votre passage et laisser vos coordonnées</div>`;
          zone.appendChild(bloc);
          new QRCode(bloc.querySelector('.qr-stand-code'), {
            text: base + 'portail.html?stand=' + f.id,
            width: 380,
            height: 380,
            correctLevel: QRCode.CorrectLevel.H,
          });
        });
        document.body.classList.add('mode-impression-qr');
        const fin = () => {
          document.body.classList.remove('mode-impression-qr');
          zone.remove();
          window.removeEventListener('afterprint', fin);
        };
        window.addEventListener('afterprint', fin);
        setTimeout(() => window.print(), 250);
      });
    }

    // --- journée : modification / suppression

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
        dateFin: document.getElementById('jm-date-fin').value,
        lieu: document.getElementById('jm-lieu').value.trim(),
        nbParticipants: Number(document.getElementById('jm-participants').value) || 0,
        description: document.getElementById('jm-description').value.trim(),
      };
      await db.collection('journees').doc(journeeId).update(maj);
      await refPortail.update({
        titre: maj.titre,
        date: fmtPeriode(maj),
        lieu: maj.lieu,
      });
      // Répercute le contexte affiché en tête des questionnaires publics.
      const lot = db.batch();
      questionnaires.forEach((q) => {
        lot.update(db.collection('questionnaires').doc(q.id), {
          journeeTitre: maj.titre,
          journeeDate: fmtPeriode(maj),
          journeeLieu: maj.lieu,
        });
      });
      await lot.commit();
      router();
    });

    document.getElementById('bouton-supprimer-journee').addEventListener('click', async () => {
      if (questionnaires.length) return;
      if (!confirm('Supprimer définitivement cette journée d’études (inscrits et tirage compris) ?')) return;
      const aSupprimer = [
        ...inscriptions.map((i) => db.collection('inscriptions').doc(i.id)),
        ...participationsTirage.map((p) => db.collection('tirage').doc(p.id)),
        ...ateliers.map((a) => db.collection('ateliers').doc(a.id)),
        ...snapV.docs.map((d) => d.ref),
        ...fournisseursJ.map((f) => db.collection('fournisseurs').doc(f.id)),
        ...visitesJ.map((v) => db.collection('visites').doc(v.id)),
        ...pointagesJ.map((p) => db.collection('pointages').doc(p.id)),
        refPortail,
        db.collection('journees').doc(journeeId),
      ];
      for (let i = 0; i < aSupprimer.length; i += 400) {
        const lot = db.batch();
        aSupprimer.slice(i, i + 400).forEach((ref) => lot.delete(ref));
        await lot.commit();
      }
      location.hash = '#/journees';
    });

    // --- questionnaires

    document.getElementById('form-questionnaire').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const modele = MODELES[document.getElementById('q-modele').value];
      const doc2 = await db.collection('questionnaires').add({
        journeeId,
        journeeTitre: journee.titre,
        journeeDate: fmtPeriode(journee),
        journeeLieu: journee.lieu || '',
        titre: modele.titre + ' — ' + journee.titre,
        statut: 'brouillon',
        audience: document.getElementById('q-audience').value,
        questions: JSON.parse(JSON.stringify(modele.questions)),
        creeLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      location.hash = '#/questionnaire/' + doc2.id;
    });

    // --- actions d'amélioration

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
    if (q.type === 'note5') {
      const comptes = [0, 0, 0, 0, 0];
      valeurs.forEach((v) => {
        const i = Number(v) - 1;
        if (i >= 0 && i < 5) comptes[i] += 1;
      });
      const somme = valeurs.reduce((s, v) => s + Number(v), 0);
      return {
        n,
        comptes,
        moyenne: n ? somme / n : null,
        satisfaits: comptes[3] + comptes[4],
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

    let noteSur = 10;
    let noteMoyenne5 = null;
    (questionnaire.questions || []).forEach((q) => {
      const s = statsQuestion(q, reponses);
      if (q.type === 'echelle4' || q.type === 'note5') {
        totalEchelle += s.n;
        totalSatisfaits += s.satisfaits;
      }
      if (q.type === 'note10' && noteMoyenne === null && s.moyenne !== null) {
        noteMoyenne = s.moyenne;
      }
      if (q.type === 'note5' && noteMoyenne5 === null && s.moyenne !== null) {
        noteMoyenne5 = s.moyenne;
      }
      if (q.type === 'ouinon' && recommandation === null && s.n) {
        recommandation = s.oui / s.n;
      }
    });
    if (noteMoyenne === null && noteMoyenne5 !== null) {
      noteMoyenne = noteMoyenne5;
      noteSur = 5;
    }

    return { totalEchelle, totalSatisfaits, noteMoyenne, noteSur, recommandation };
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
    } else if (q.type === 'note5') {
      resume = s.n
        ? `moyenne ${s.moyenne.toFixed(2)} / 5 — ${pourcent(s.satisfaits, s.n)} de notes 4 et 5`
        : 'aucune réponse';
      corps = htmlBarres(
        s.comptes.map((c, i) => [String(i + 1), c]),
        s.n,
        ['n1', 'n2', 'n2', 'n3', 'n4'],
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
    const entetes = ['Horodatage', 'Profil', ...questions.map((q) => q.libelle)];

    function cellule(v) {
      const texte = v == null ? '' : String(v);
      return '"' + texte.replace(/"/g, '""') + '"';
    }

    const lignes = [entetes.map(cellule).join(sep)];
    reponses.forEach((r) => {
      const valeurs = [
        fmtHorodatage(r.soumisLe),
        r.participantType === 'exposant' ? 'Exposant fournisseur' : 'Visiteur blanchisseur',
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
          ${questionnaire.journeeLieu ? ' — ' + echapper(questionnaire.journeeLieu) : ''}
          — proposé ${
            questionnaire.audience === 'visiteur'
              ? 'aux visiteurs blanchisseurs'
              : questionnaire.audience === 'exposant'
                ? 'aux exposants fournisseurs'
                : 'à tous les inscrits'
          }</p>
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
            <div class="legende">satisfaction globale (« satisfaisant » et plus, notes 4 et 5)</div></div>
          <div class="tuile"><div class="valeur">${g.noteMoyenne !== null ? g.noteMoyenne.toFixed(1) + ' / ' + g.noteSur : '—'}</div>
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

  // Sur Firebase Hosting, /__/firebase/init.js a déjà initialisé l'application
  // avec la configuration du projet ; en dehors (poste local), on se rabat sur
  // la configuration recopiée dans firebase-config.js.
  if (!firebase.apps.length) {
    if (!window.firebaseConfigEstRenseignee()) {
      vueConfigManquante();
      return;
    }
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  auth = firebase.auth();
  db = firebase.firestore();

  const $version = document.getElementById('version-app');
  if ($version && window.APP_BUILD) $version.textContent = 'v' + window.APP_BUILD;

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
