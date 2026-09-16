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

  // Une même personne connectée depuis plusieurs appareils (ou après une
  // purge de navigateur) possède plusieurs identités anonymes : les tirages
  // ne gardent qu'une chance par N° de carte.
  function dedupeParNumero(liste) {
    const vus = new Set();
    const resultat = [];
    (liste || []).forEach((p) => {
      const cle = normaliserNumero(p.numeroInscription) || '~' + p.participantId;
      if (vus.has(cle)) return;
      vus.add(cle);
      resultat.push(p);
    });
    return resultat;
  }

  // Questionnaires d'atelier « réservés aux retenus » : chaque modèle porte
  // un motif recherché dans le NOM des ateliers — seuls les participants
  // retenus pour un atelier correspondant sont questionnés (et comptés dans
  // la condition « questionnaires répondus » de la tombola).
  const MOTIFS_ATELIERS = {
    atelier_ia: 'au service des blanchisseries',
    atelier_maintenance: 'gestion de la maintenance',
    atelier_rabc: 'RABC',
  };

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
  //
  // Le N° DE CARTE est volontairement CONSERVÉ : seul son détenteur le
  // connaît, et c'est lui qui valide la fiche — si la personne revient
  // volontairement s'inscrire avec sa carte, elle retrouve sa fiche
  // (l'inscription étant identifiée par le numéro). Sans ce retour, le
  // numéro seul ne permet plus de l'identifier : le nom est retiré de
  // l'annuaire de l'application au passage.
  async function anonymiserParticipant(uidCible) {
    const vide = { nom: 'Anonymisé', prenom: '', organisme: '', email: '', mobile: '' };
    const refProfil = db.collection('participants').doc(uidCible);
    const docProfil = await refProfil.get();
    const numero = docProfil.exists ? docProfil.data().numeroInscription || '' : '';

    const maj = [];
    for (const col of ['inscriptions', 'tirage', 'voeux', 'visites', 'pointages', 'desistements']) {
      const snap = await db.collection(col).where('participantId', '==', uidCible).get();
      snap.docs.forEach((d) => maj.push({ ref: d.ref, donnees: vide }));
    }
    // Désistements où la personne apparaît comme promue.
    const snapPromu = await db.collection('desistements').where('promuId', '==', uidCible).get();
    snapPromu.docs.forEach((d) =>
      maj.push({ ref: d.ref, donnees: { promuNom: 'Anonymisé', promuPrenom: '' } }),
    );
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
    // La demande elle-même est anonymisée : le nom n'était nécessaire que
    // pour la traiter — une fois l'effacement fait, il ne doit pas subsister.
    await db.collection('demandesAnonymisation').doc(uidCible).update({
      statut: 'traitee',
      traiteLe: new Date().toISOString(),
      nom: 'Anonymisé',
      prenom: '',
    });
  }

  async function vueListeJournees() {
    const journees = await chargerJournees();
    const snapDa = await db.collection('demandesAnonymisation').get();
    const demandes = snapDa.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Rattrapages : les demandes traitées par une ancienne version gardaient
    // le nom du demandeur (anonymisé ici au passage), et les demandes créées
    // avant la v42 ne portaient pas le n° de carte (récupéré sur le profil).
    for (const d of demandes) {
      if (!d.numeroInscription) {
        try {
          const p = await db.collection('participants').doc(d.id).get();
          const numero = p.exists ? p.data().numeroInscription || '' : '';
          if (numero) {
            await db
              .collection('demandesAnonymisation')
              .doc(d.id)
              .update({ numeroInscription: numero });
            d.numeroInscription = numero;
          }
        } catch (_) {
          /* profil absent : la ligne s'affiche sans numéro */
        }
      }
      if (d.statut === 'traitee' && d.nom && d.nom !== 'Anonymisé') {
        try {
          await db
            .collection('demandesAnonymisation')
            .doc(d.id)
            .update({ nom: 'Anonymisé', prenom: '' });
          d.nom = 'Anonymisé';
          d.prenom = '';
        } catch (_) {
          /* règles en retard : sans gravité, retenté à la prochaine ouverture */
        }
      }
    }
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
                      <div class="muet petit">${d.numeroInscription ? `Carte n° ${echapper(d.numeroInscription)} — ` : ''}demandé le ${d.demandeLe ? new Date(d.demandeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '?'}
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
              confirmation dans son application. Le <strong>n° de carte est
              conservé</strong> : seul son détenteur le connaît, et s'il
              revient volontairement s'inscrire avec sa carte, il retrouve sa
              fiche. Pensez à répercuter la suppression dans les exports CSV
              déjà transmis le cas échéant.</p>`
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
        <h3>Ajouter une carte manquante (accueil)</h3>
        <p class="muet petit">Seuls les numéros présents dans l'annuaire
        peuvent s'inscrire sur le portail : si une carte distribuée à
        l'accueil n'y figure pas, ajoutez-la ici.</p>
        <form id="form-annuaire-ajout" class="ligne-boutons" style="align-items:flex-end">
          <label class="champ" style="margin:0">N° de carte *
            <input id="aj-numero" required maxlength="20" placeholder="JE2026-999" style="max-width:10rem"></label>
          <label class="champ" style="margin:0">Prénom *
            <input id="aj-prenom" required style="max-width:10rem"></label>
          <label class="champ" style="margin:0">Nom *
            <input id="aj-nom" required style="max-width:10rem"></label>
          <label class="champ" style="margin:0;flex:1;min-width:160px">Établissement
            <input id="aj-organisme"></label>
          <label class="champ" style="margin:0">Profil
            <select id="aj-type">
              <option value="visiteur">Visiteur</option>
              <option value="exposant">Exposant</option>
            </select></label>
          <button type="submit">Ajouter à l'annuaire</button>
        </form>
        ${
          annuaire.length
            ? `<div class="ligne-boutons">
                <button id="an-vider" class="danger">Vider l'annuaire (${annuaire.length} fiches)</button>
              </div>`
            : ''
        }
      </div>`;

    document.getElementById('form-annuaire-ajout').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const numero = normaliserNumero(document.getElementById('aj-numero').value);
      if (!numero) return;
      await db.collection('annuaire').doc(numero).set({
        numero,
        prenom: document.getElementById('aj-prenom').value.trim(),
        nom: document.getElementById('aj-nom').value.trim(),
        organisme: document.getElementById('aj-organisme').value.trim(),
        type: document.getElementById('aj-type').value,
      });
      alert(`Carte ${numero} ajoutée à l'annuaire : la personne peut maintenant s'inscrire.`);
      router();
    });

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

    // Complétion automatique : les questionnaires d'atelier créés avant que
    // la restriction « réservé aux retenus » existe reçoivent leur motif.
    for (const [cle, motif] of Object.entries(MOTIFS_ATELIERS)) {
      const modele = window.MODELES && MODELES[cle];
      if (!modele) continue;
      for (const q of questionnaires) {
        if (q.titre && q.titre.startsWith(modele.titre) && q.reserveAtelier !== motif) {
          try {
            await db.collection('questionnaires').doc(q.id).update({ reserveAtelier: motif });
            q.reserveAtelier = motif;
          } catch (_) {
            /* sans gravité : retenté à la prochaine ouverture */
          }
        }
      }
    }

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

    // Heure par défaut du tirage automatique des ateliers : la FIN DE L'AG
    // si elle est paramétrée, sinon le jeudi des journées à 8h45.
    const finAGparDefaut = (() => {
      if (agInfo && agInfo.fin) return agInfo.fin;
      if (journee.date) {
        const debutJ = new Date(journee.date + 'T00:00:00');
        const finJ = new Date((journee.dateFin || journee.date) + 'T00:00:00');
        for (let d = new Date(debutJ); d <= finJ; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === 4) {
            d.setHours(8, 45, 0, 0);
            return firebase.firestore.Timestamp.fromDate(d);
          }
        }
      }
      return null;
    })();

    const snapI = await db
      .collection('inscriptions')
      .where('journeeId', '==', journeeId)
      .get();
    let inscriptions = snapI.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Correction automatique des doublons : les anciennes versions du portail
    // créaient une fiche PAR SESSION de navigateur (même personne inscrite
    // plusieurs fois). À chaque ouverture de cette page, les fiches d'un même
    // n° de carte sont fusionnées (première venue conservée, accès
    // additionnés, dernier accès le plus récent) et les fiches en trop
    // supprimées — seul l'administrateur a le droit de faire ce ménage.
    const fichesParNumero = new Map();
    inscriptions.forEach((i) => {
      const cle = normaliserNumero(i.numeroInscription);
      if (!cle) return;
      if (!fichesParNumero.has(cle)) fichesParNumero.set(cle, []);
      fichesParNumero.get(cle).push(i);
    });
    for (const [cle, groupe] of fichesParNumero) {
      if (groupe.length < 2) continue;
      // On garde en priorité la fiche « officielle » (identifiée par le
      // numéro de carte), sinon la plus récemment utilisée.
      groupe.sort((a, b) =>
        String(b.dernierAccesLe || '').localeCompare(String(a.dernierAccesLe || '')),
      );
      const garde = groupe.find((i) => i.id === journeeId + '_' + cle) || groupe[0];
      const fusion = {
        creeLe: groupe.map((i) => i.creeLe).filter(Boolean).sort()[0] || garde.creeLe || '',
        dernierAccesLe: groupe.map((i) => i.dernierAccesLe).filter(Boolean).sort().pop() || '',
        nbAcces: groupe.reduce((somme, i) => somme + (Number(i.nbAcces) || 0), 0),
      };
      try {
        await db.collection('inscriptions').doc(garde.id).update(fusion);
        for (const i of groupe) {
          if (i.id !== garde.id) await db.collection('inscriptions').doc(i.id).delete();
        }
        Object.assign(garde, fusion);
        inscriptions = inscriptions.filter((i) => i === garde || !groupe.includes(i));
      } catch (_) {
        /* règles déployées en retard : l'affichage reste inchangé */
      }
    }

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

    // Désistements d'ateliers (place libérée → promu depuis la liste
    // d'attente, à prévenir par SMS).
    const snapDe2 = await db.collection('desistements').where('journeeId', '==', journeeId).get();
    const desistementsJ = snapDe2.docs.map((d) => ({ id: d.id, ...d.data() }));
    const desistementsParAtelier = {};
    desistementsJ.forEach((d) => {
      (desistementsParAtelier[d.atelierId] = desistementsParAtelier[d.atelierId] || []).push(d);
    });
    const parMoment = { ouverture: new Set(), ag: new Set(), tombola: new Set() };
    pointagesJ.forEach((p) => {
      if (parMoment[p.moment]) parMoment[p.moment].add(p.participantId);
    });
    // Condition supplémentaire de la tombola : avoir répondu à tous les
    // questionnaires ouverts qui concernent les visiteurs.
    const questionnairesTombola = questionnaires.filter(
      (q) => q.statut === 'ouvert' && (!q.audience || q.audience === 'tous' || q.audience === 'visiteur'),
    );
    const repondantsParQuestionnaire = {};
    for (const q of questionnairesTombola) {
      const snapR = await db.collection('reponses').where('questionnaireId', '==', q.id).get();
      repondantsParQuestionnaire[q.id] = new Set(snapR.docs.map((d) => d.data().participantId));
    }
    // Un questionnaire d'atelier (reserveAtelier) n'est exigé que des
    // participants RETENUS pour un atelier correspondant.
    const retenusParQuestionnaire = {};
    questionnairesTombola.forEach((q) => {
      if (!q.reserveAtelier) return;
      const motif = String(q.reserveAtelier).toLowerCase();
      const ids = new Set();
      ateliers.forEach((a) => {
        if ((a.nom || '').toLowerCase().includes(motif)) {
          (a.retenus || []).forEach((r) => ids.add(r.participantId));
        }
      });
      retenusParQuestionnaire[q.id] = ids;
    });
    const aRepondu = (participantId) =>
      questionnairesTombola.every((q) => {
        if (q.reserveAtelier && !retenusParQuestionnaire[q.id].has(participantId)) return true;
        return repondantsParQuestionnaire[q.id].has(participantId);
      });
    // Les membres du Conseil d'Administration (liste des N° d'inscription
    // tenue dans la carte Tombola) ne peuvent pas gagner à la tombola.
    const exclusCA = new Set(
      ((portail.tombola && portail.tombola.exclusCA) || []).map(normaliserNumero),
    );
    const candidatsTombola = dedupeParNumero(pointagesJ.filter(
      (p) =>
        p.moment === 'tombola' &&
        p.type === 'visiteur' &&
        p.nom !== 'Anonymisé' &&
        !exclusCA.has(normaliserNumero(p.numeroInscription)) &&
        parMoment.ouverture.has(p.participantId) &&
        parMoment.ag.has(p.participantId) &&
        aRepondu(p.participantId),
    ));

    // Évaluations en direct : chaque événement du programme devient
    // évaluable (5 ★ + commentaire) sur l'accueil des participants dès
    // qu'il est terminé. Même identifiant que le portail (début + titre).
    const idEvaluationProgramme = (e) => {
      const slug = String(e.titre || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      return 'ev' + Math.floor(e.debut.getTime() / 1000) + '_' + slug;
    };
    const evenementsEval = (portail.programme || [])
      .map((e) => {
        try {
          return {
            titre: e.titre || '',
            debut: e.debut.toDate(),
            fin: e.fin ? e.fin.toDate() : null,
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      // Les lignes génériques « Ateliers … » du programme sont remplacées
      // par une évaluation PAR ATELIER, réservée à ses retenus (ci-dessous).
      .filter((e) => !/^ateliers?\b/i.test(e.titre))
      .map((e) => ({ ...e, id: idEvaluationProgramme(e) }));
    ateliers.forEach((a) => {
      if (!a.debutLe) return;
      const debut = a.debutLe.toDate();
      evenementsEval.push({
        id: 'evat_' + a.id,
        titre: `Atelier${a.salle ? ' ' + a.salle : ''} — ${a.nom || ''}`,
        debut,
        fin: new Date(debut.getTime() + 45 * 60000),
        reserveRetenus: (a.retenus || []).length,
      });
    });
    evenementsEval.sort((a, b) => a.debut - b.debut);
    const snapEval = await db
      .collection('evaluationsDirect')
      .where('journeeId', '==', journeeId)
      .get();
    const evalsParQuestion = {};
    snapEval.docs.forEach((d) => {
      const v = d.data();
      (evalsParQuestion[v.questionId] = evalsParQuestion[v.questionId] || []).push(v);
    });
    const evaluationsExclues = new Set(portail.evaluationsExclues || []);

    const actions = Array.isArray(journee.actions) ? journee.actions : [];

    const base = location.origin + location.pathname.replace(/index\.html$/, '');
    const urlFlyer = base + 'portail.html';
    const urlDirecte = base + 'portail.html?e=' + journeeId;

    $app.innerHTML = `
      <div class="fil">
        <a class="btn secondaire" href="#/journees">← Accueil administration</a>
        <span class="fil-chemin"><a href="#/journees">Journées d'études</a> › ${echapper(journee.titre)}</span>
      </div>

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
          <label class="champ">Titre court du portail (bandeau bleu des participants)
            <input id="jm-titre-court" value="${attr(portail.titreCourt || '')}"
              placeholder="Ex. : URBH — 41ème JE NANTES"></label>
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
        <h2>📅 Programme pédagogique (affiché sur le portail)</h2>
        <p class="muet petit">Le portail affiche ce programme aux participants,
        avec en tête d'écran l'information « en ce moment / à suivre » mise à
        jour en temps réel.</p>
        ${
          (portail.programme || []).length
            ? `<ul class="liste">${(portail.programme || [])
                .map(
                  (e, i) => `<li>
                    <div>
                      <span class="titre-item">${echapper(e.titre || '')}</span>
                      <div class="muet petit">${fmtHorodatage(e.debut)}${e.fin ? ' → ' + fmtHorodatage(e.fin) : ''}${e.lieu ? ' — 📍 ' + echapper(e.lieu) : ''}</div>
                    </div>
                    <div class="pousse">
                      <button class="discret bouton-supprimer-evenement" data-index="${i}">Supprimer</button>
                    </div>
                  </li>`,
                )
                .join('')}</ul>`
            : `<p class="muet">Aucun événement au programme.</p>
              <div class="ligne-boutons">
                <button id="bouton-seed-programme" class="secondaire">
                  Créer le programme des 41es JE (Nantes 2026)
                </button>
              </div>`
        }
        <h3>Ajouter un événement</h3>
        <form id="form-evenement" class="ligne-boutons" style="align-items:flex-end">
          <label class="champ" style="margin:0">Début
            <input id="ev-debut" type="datetime-local" required></label>
          <label class="champ" style="margin:0">Fin
            <input id="ev-fin" type="datetime-local"></label>
          <label class="champ" style="margin:0;flex:1;min-width:200px">Titre *
            <input id="ev-titre" required placeholder="Ex. : Conférence — Les économies d'eau"></label>
          <label class="champ" style="margin:0">Lieu
            <input id="ev-lieu" placeholder="Ex. : Amphithéâtre"></label>
          <button type="submit">Ajouter</button>
        </form>
      </div>

      <div class="carte">
        <h2>⭐ Évaluations en direct (au fil du programme)</h2>
        <p class="muet petit">Chaque événement du programme devient évaluable
        sur l'accueil des participants <strong>dès qu'il est terminé</strong> :
        5 étoiles obligatoires + commentaire facultatif, une question à la
        fois — il faut répondre pour passer à la suivante. Les
        <strong>ateliers sont évalués individuellement, uniquement par leurs
        retenus</strong>, 45 minutes après le début de la séance. Excluez ici
        les événements à ne pas évaluer (pauses, repas…). Le questionnaire de
        satisfaction reste en place pour les questions générales.</p>
        ${
          evenementsEval.length
            ? `<ul class="liste">${evenementsEval
                .map((e) => {
                  const reponses = evalsParQuestion[e.id] || [];
                  const notes = reponses.map((r) => Number(r.etoiles) || 0).filter(Boolean);
                  const moyenne = notes.length
                    ? notes.reduce((s, n2) => s + n2, 0) / notes.length
                    : null;
                  const commentaires = reponses
                    .map((r) => (r.commentaire || '').trim())
                    .filter(Boolean);
                  const exclu = evaluationsExclues.has(e.id);
                  const fini = (e.fin || e.debut) <= new Date();
                  return `<li>
                    <div style="min-width:0">
                      <span class="titre-item">${echapper(e.titre)}</span>
                      ${
                        exclu
                          ? '<span class="badge ferme">exclu de l\'évaluation</span>'
                          : fini
                            ? '<span class="badge ouvert">évaluable</span>'
                            : '<span class="badge brouillon">à venir</span>'
                      }
                      <div class="muet petit">${fmtHorodatage(e.debut)} —
                        ${
                          e.reserveRetenus !== undefined
                            ? `réservé aux retenus de l'atelier (${e.reserveRetenus}) — `
                            : ''
                        }${reponses.length} avis${
                          moyenne !== null ? ` — moyenne <strong>${moyenne.toFixed(1)} ★</strong>` : ''
                        }</div>
                      ${
                        commentaires.length
                          ? `<ul class="verbatims">${commentaires
                              .map((c) => `<li>💬 ${echapper(c)}</li>`)
                              .join('')}</ul>`
                          : ''
                      }
                    </div>
                    <div class="pousse">
                      <button class="discret bouton-basculer-eval" data-id="${attr(e.id)}">
                        ${exclu ? 'Réinclure' : 'Exclure'}
                      </button>
                    </div>
                  </li>`;
                })
                .join('')}</ul>`
            : `<p class="muet">Le programme est vide : créez-le ci-dessus, les
                évaluations en direct suivront automatiquement.</p>`
        }
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
                  <div class="pousse">
                    <button class="discret bouton-supprimer-inscrit" data-id="${attr(i.id)}">Supprimer</button>
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
          <a class="btn secondaire" href="kiosque.html?e=${journeeId}" target="_blank" rel="noopener">
            📽️ Écran de projection (kiosque)
          </a>
          <a class="btn secondaire" href="kiosque.html?e=${journeeId}&amp;regie=1" target="_blank" rel="noopener">
            🎛 Kiosque + régie (tirer depuis l'écran)
          </a>
        </div>
        <p class="muet petit">Le kiosque se projette en salle (double-clic =
        plein écran) : il annonce chaque gagnant en direct — suspense,
        révélation, confettis — dès que vous tirez ici, tirage au sort comme
        lots de la tombola. Avec la <strong>régie</strong> (pastille 🎛 en bas
        à gauche de l'écran, connexion administrateur demandée), les tirages
        se déclenchent directement depuis le kiosque, en amphithéâtre.</p>
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
        <p class="muet petit">Trois lots offerts par l'URBH, remis par les
        représentants de trois fournisseurs, tirés au sort à la clôture. <strong>Conditions de participation</strong>
        (affichées aux participants) : être visiteur blanchisseur adhérent,
        être <strong>présent dans la salle lors du tirage</strong>, avoir
        <strong>validé ses points de présence</strong> — présence à
        l'Assemblée Générale et pointage à l'ouverture des journées sur la
        première conférence — et avoir <strong>répondu aux questionnaires
        ouverts</strong> concernant les visiteurs. Ouvrez chaque pointage au
        moment voulu (le pointage « présence en salle » juste avant le
        tirage) ; le tirage ne retient que les visiteurs remplissant toutes
        ces conditions.</p>
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
          <a class="btn secondaire" href="kiosque.html?e=${journeeId}" target="_blank" rel="noopener">
            📽️ Écran de projection (kiosque)
          </a>
          <a class="btn secondaire" href="kiosque.html?e=${journeeId}&amp;regie=1" target="_blank" rel="noopener">
            🎛 Kiosque + régie (tirer depuis l'écran)
          </a>
        </div>
        <h3>Membres du Conseil d'Administration (exclus de la tombola)</h3>
        <p class="muet petit">Les N° d'inscription listés ici ne peuvent pas
        gagner à la tombola. Ils participent normalement au reste (ateliers,
        pointages — utiles pour l'émargement).</p>
        <label class="champ">N° d'inscription des membres du CA (séparés par des virgules)
          <textarea id="ca-numeros" rows="2"
            placeholder="Ex. : JE2026-001, JE2026-015…">${(tombolaInfo.exclusCA || []).join(', ')}</textarea></label>
        <div class="ligne-boutons">
          <button type="button" id="bouton-enregistrer-ca">Enregistrer la liste du CA</button>
          <button type="button" id="bouton-prefill-ca" class="secondaire">Pré-remplir avec le CA des 41es JE</button>
        </div>
        <h3>Lots et tirage</h3>
        <p class="muet petit"><strong>${candidatsTombola.length}</strong>
        participant(s) éligible(s) actuellement (visiteurs blanchisseurs hors
        membres du CA${(tombolaInfo.exclusCA || []).length ? ` — ${(tombolaInfo.exclusCA || []).length} exclus` : ' — liste du CA non renseignée'},
        trois points validés, questionnaires répondus${questionnairesTombola.length ? ` — ${questionnairesTombola.length} questionnaire(s) ouvert(s) pris en compte` : ' — aucun questionnaire ouvert pour le moment'}).
        Une même personne ne peut gagner qu'un seul lot.</p>
        ${
          lotsTombola.length
            ? `<ul class="liste">${lotsTombola
                .map((lot, i) => {
                  const g = gagnantsTombola.find((x) => x.lotIndex === i && !x.raye);
                  const rayes = gagnantsTombola.filter((x) => x.lotIndex === i && x.raye);
                  return `<li>
                    <div>
                      🎁 <span class="titre-item">${echapper(lot.libelle)}</span>
                      ${lot.fournisseurNom ? `<span class="muet petit"> — remis par ${echapper(lot.fournisseurNom)}</span>` : ''}
                      ${rayes
                        .map(
                          (r) =>
                            `<div class="muet petit"><s>🚫 ${echapper(r.prenom)} ${echapper(r.nom)}</s> — absent de la salle, rayé</div>`,
                        )
                        .join('')}
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
                          ? `<button class="danger bouton-rayer-gagnant" data-index="${i}">🚫 Absent — rayer et retirer</button>
                            <button class="discret bouton-annuler-gagnant-tombola" data-index="${i}">Annuler le gagnant</button>`
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
          <label class="champ" style="margin:0;flex:1;min-width:180px">Remis par (représentant du fournisseur)
            <input id="lot-fournisseur" list="liste-fournisseurs-lots" placeholder="Ex. : GIRBAU">
            <datalist id="liste-fournisseurs-lots">
              ${fournisseursJ.map((f) => `<option value="${attr(f.nom)}"></option>`).join('')}
            </datalist></label>
          <button type="submit">Ajouter le lot</button>
        </form>
      </div>

      <div class="carte">
        <h2>🛠️ Ateliers (inscription + tirage au sort)</h2>
        <p class="muet petit">Les inscriptions se font sur le portail :
        <strong>vous les ouvrez et les fermez atelier par atelier</strong>
        (boutons ci-dessous, ou tous d'un coup). Tant que les inscriptions
        d'un atelier sont ouvertes, chacun coche et décoche librement son
        inscription — <strong>jusqu'au tirage au sort</strong>, qui fige les
        listes. Le tirage retient en priorité : 1) les personnes qui n'ont
        encore gagné aucun atelier ET dont la blanchisserie n'a personne ici,
        2) même chose avec une marge de deux par blanchisserie, 3) puis les
        autres personnes sans atelier, 4) et seulement s'il reste des places,
        celles déjà retenues ailleurs (signalées ⚠️). Les autres sont en
        liste d'attente dans le même ordre. Tirez les ateliers un par un pour
        garder la main sur les places restantes.</p>
        <h3>Période de l'Assemblée Générale (information affichée sur le portail)</h3>
        ${
          agInfo && agInfo.debut && agInfo.fin
            ? `<p class="muet petit">AG paramétrée du
                <strong>${fmtHorodatage(agInfo.debut)}</strong> au
                <strong>${fmtHorodatage(agInfo.fin)}</strong>. Elle sert de
                repère aux participants — l'ouverture réelle des inscriptions
                se fait par les boutons de chaque atelier.</p>`
            : `<p class="muet petit">Période d'AG non paramétrée (elle sert
                de repère affiché aux participants).</p>`
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
        <div class="ligne-boutons">
          <a class="btn secondaire" href="kiosque-ateliers.html?e=${journeeId}" target="_blank" rel="noopener">
            📽️ Écran des ateliers (kiosque)
          </a>
          <a class="btn secondaire" href="kiosque-ateliers.html?e=${journeeId}&amp;regie=1" target="_blank" rel="noopener">
            🎛 Kiosque + régie (tirer depuis l'écran)
          </a>
          <a class="btn secondaire" href="kiosque-ateliers.html?e=${journeeId}&amp;grille=1" target="_blank" rel="noopener">
            🗓️ Tableau des créneaux (à projeter pendant l'AG)
          </a>
        </div>
        <p class="muet petit">À projeter devant les salles : les listes des
        retenus et les listes d'attente s'affichent en direct, nom par nom,
        dès que vous tirez un atelier au sort ci-dessous. Avec la
        <strong>régie</strong> (pastille 🎛 en bas à gauche de l'écran,
        connexion administrateur demandée), les tirages des ateliers se
        déclenchent directement depuis le kiosque.</p>
        <h3>Ateliers</h3>
        ${
          ateliers.length
            ? ateliers
                .map((a) => {
                  const voeux = voeuxParAtelier[a.id] || [];
                  const organismes = new Set(
                    voeux.map((v) => (v.organisme || '').trim().toLowerCase()).filter(Boolean),
                  );
                  // Les inscriptions s'ouvrent et se ferment ATELIER PAR
                  // ATELIER : tant qu'elles sont ouvertes, les participants
                  // s'inscrivent et se désinscrivent librement — jusqu'au
                  // tirage au sort.
                  const badges = {
                    tire: '<span class="badge ferme">Tirage effectué</span>',
                    ouvert: '<span class="badge ouvert">Inscriptions ouvertes</span>',
                  };
                  badges[a.statut] =
                    badges[a.statut] || '<span class="badge brouillon">Inscriptions fermées</span>';
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
                          ? `<button class="secondaire bouton-basculer-atelier" data-id="${attr(a.id)}"
                              data-vers="${a.statut === 'ouvert' ? 'ferme' : 'ouvert'}">
                              ${a.statut === 'ouvert' ? '⛔ Fermer les inscriptions' : '✅ Ouvrir les inscriptions'}
                            </button>
                            <button class="bouton-tirer-atelier" data-id="${attr(a.id)}" ${voeux.length ? '' : 'disabled title="Aucun inscrit"'}>🎲 Tirer au sort</button>`
                          : `<button class="secondaire bouton-csv-atelier" data-id="${attr(a.id)}">Feuille d'émargement (CSV)</button>
                            <button class="secondaire bouton-refaire-atelier" data-id="${attr(a.id)}">Refaire le tirage</button>`
                      }
                    </div>
                    ${
                      a.statut !== 'tire'
                        ? a.tirageAutoLe
                          ? `<div class="muet petit">🕗 <strong>Tirage automatique programmé :
                              ${fmtHorodatage(a.tirageAutoLe)}</strong>
                              <button class="discret bouton-annuler-prog-tirage" data-id="${attr(a.id)}">Annuler la programmation</button></div>`
                          : `<div class="ligne-boutons" style="align-items:flex-end">
                              <label class="champ petit" style="margin:0">Tirage automatique à
                                <input type="datetime-local" class="prog-tirage-heure" data-id="${attr(a.id)}"
                                  value="${attr(versDatetimeLocal(finAGparDefaut))}"></label>
                              <button class="secondaire bouton-programmer-tirage" data-id="${attr(a.id)}">🕗 Programmer</button>
                            </div>`
                        : ''
                    }
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
                          }
                          ${(desistementsParAtelier[a.id] || [])
                            .map((de) => {
                              const voeuPromu = voeux.find((v) => v.participantId === de.promuId);
                              const mobilePromu = voeuPromu ? voeuPromu.mobile || '' : '';
                              const sms = mobilePromu
                                ? `sms:${attr(mobilePromu)}?body=${encodeURIComponent(
                                    `URBH : une place s'est libérée, vous êtes retenu pour l'atelier « ${a.nom} », salle ${a.salle}, ${a.horaire || ''}. Ouvrez l'application pour voir votre place (ou la libérer à votre tour).`,
                                  )}`
                                : '';
                              return `<div class="muet petit">🔄 <s>${echapper(de.prenom)} ${echapper(de.nom)}</s>
                                s'est désisté${de.promuNom ? ` → promu : <strong>${echapper(de.promuPrenom)} ${echapper(de.promuNom)}</strong>` : ' — liste d’attente épuisée, place vacante'}
                                ${mobilePromu ? ` — 📱 <a href="${sms}">${echapper(mobilePromu)}</a> <span class="badge brouillon">SMS à envoyer</span>` : ''}</div>`;
                            })
                            .join('')}`
                        : ''
                    }
                  </div>`;
                })
                .join('')
            : `<p class="muet">Aucun atelier pour cette journée.</p>`
        }
        ${
          ateliers.some((a) => a.statut !== 'tire')
            ? `<div class="ligne-boutons">
                <button id="bouton-ouvrir-tous-ateliers" class="secondaire">✅ Ouvrir les inscriptions de tous les ateliers</button>
                <button id="bouton-fermer-tous-ateliers" class="secondaire">⛔ Fermer toutes les inscriptions</button>
                <button id="bouton-programmer-tous-tirages" class="secondaire"
                  ${finAGparDefaut ? '' : 'disabled title="Paramétrez la période de l’AG ou la date de la journée"'}>
                  🕗 Programmer tous les tirages à la fin de l'AG${finAGparDefaut ? ` (${fmtHorodatage(finAGparDefaut)})` : ''}
                </button>
              </div>
              <p class="muet petit">Les participants s'inscrivent et se
              désinscrivent librement tant que les inscriptions d'un atelier
              sont ouvertes — le tirage au sort les fige. Chaque atelier
              s'ouvre ou se ferme aussi individuellement ci-dessus, et son
              tirage peut être <strong>programmé à une heure précise</strong> :
              il se déclenche alors tout seul sur le serveur (à la minute
              près), même si l'administration est fermée. Nécessite le
              déploiement des fonctions (DEPLOYER-FONCTIONS).</p>`
            : ''
        }
        <div class="ligne-boutons">
          <button id="bouton-seed-ateliers" class="secondaire">
            Créer les ateliers du tableau du jeudi (URBH B/C/D ×2 + partenaires E/F/Auditorium)
          </button>
        </div>
        <p class="muet petit">Bouton ré-exécutable sans risque : seuls les
        ateliers manquants (même salle, même créneau) sont ajoutés.</p>
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
                <button id="bouton-rz-visites" class="danger" ${visitesJ.length ? '' : 'disabled'}>
                  🧹 Remettre à zéro les passages (${visitesJ.length})
                </button>
              </div>
              <p class="muet petit">« Remettre à zéro » efface tous les
              passages enregistrés — à faire une fois avant l'ouverture des
              JE pour repartir sans les essais. Pensez à exporter le CSV
              d'abord si vous voulez en garder une trace.</p>
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
                      ${q.audience === 'visiteur' ? 'visiteurs' : q.audience === 'exposant' ? 'exposants' : 'tous les inscrits'}${
                        q.reserveAtelier
                          ? ' — <strong>réservé aux retenus de l\'atelier</strong> (« ' + echapper(q.reserveAtelier) + ' »)'
                          : ''
                      }</div>
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
            <button type="button" id="bouton-seed-questionnaires" class="secondaire">
              Créer les 5 questionnaires officiels des 41es JE
            </button>
          </div>
          <p class="muet petit">« Les 5 officiels » : évaluation stagiaires
          (visiteurs), évaluation partenaires techniques (exposants) et les
          3 ateliers (IA, Maintenance, RABC — visiteurs). Créés en
          <strong>brouillon</strong> : ouvrez chacun au moment voulu pour le
          faire apparaître sur le portail ; ceux qui existent déjà ne sont
          pas dupliqués.</p>
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

    // --- programme pédagogique (affiché sur le portail)

    const programmeJ = portail.programme || [];

    async function enregistrerProgramme(nouveau) {
      nouveau.sort((a, b) => a.debut.toMillis() - b.debut.toMillis());
      await refPortail.update({ programme: nouveau });
      router();
    }

    document.getElementById('form-evenement').addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const debut = new Date(document.getElementById('ev-debut').value);
      if (Number.isNaN(debut.getTime())) return;
      const finBrut = document.getElementById('ev-fin').value;
      const fin = finBrut ? new Date(finBrut) : null;
      await enregistrerProgramme([
        ...programmeJ,
        {
          debut: firebase.firestore.Timestamp.fromDate(debut),
          fin: fin && !Number.isNaN(fin.getTime()) ? firebase.firestore.Timestamp.fromDate(fin) : null,
          titre: document.getElementById('ev-titre').value.trim(),
          lieu: document.getElementById('ev-lieu').value.trim(),
        },
      ]);
    });

    document.querySelectorAll('.bouton-supprimer-evenement').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        if (!confirm('Supprimer cet événement du programme ?')) return;
        await enregistrerProgramme(programmeJ.filter((_, idx) => idx !== i));
      }),
    );

    // Exclure / réinclure un événement de l'évaluation en direct.
    document.querySelectorAll('.bouton-basculer-eval').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const nouvelles = evaluationsExclues.has(id)
          ? [...evaluationsExclues].filter((x) => x !== id)
          : [...evaluationsExclues, id];
        await refPortail.update({ evaluationsExclues: nouvelles });
        router();
      }),
    );

    const boutonSeedProgramme = document.getElementById('bouton-seed-programme');
    if (boutonSeedProgramme) {
      boutonSeedProgramme.addEventListener('click', async () => {
        // Programme officiel des 41es JE (Nantes, 7-9 octobre 2026), repris
        // du fichier d'organisation. Format : [jour, début, fin, titre, lieu].
        const AMPHI = 'Amphithéâtre';
        const HALL = 'Hall des stands';
        const SEED = [
          ['2026-10-07', '14:00', '18:00', 'Accueil des participants', 'Entrée du palais des congrès'],
          ['2026-10-07', '16:30', '18:00', 'Réunion des présidents des comités régionaux', ''],
          ['2026-10-07', '18:00', '18:30', 'Accueil des nouveaux adhérents', ''],
          ['2026-10-07', '19:30', '20:30', "Apéritif d'ouverture", HALL],
          ['2026-10-07', '20:30', '23:00', 'Dîner — nocturne des stands', HALL],
          ['2026-10-08', '07:45', '08:00', 'Accueil café — ouverture des stands', AMPHI],
          ['2026-10-08', '08:00', '08:45', 'Assemblée Générale', AMPHI],
          ['2026-10-08', '08:45', '09:00', "Discours d'ouverture", AMPHI],
          ['2026-10-08', '09:00', '09:35', 'Présentation des nouveaux partenaires techniques', AMPHI],
          ['2026-10-08', '09:35', '10:50', 'Conférence — Les rénovations en blanchisserie hospitalière', AMPHI],
          ['2026-10-08', '10:50', '11:15', 'Pause / Visite des stands', HALL],
          ['2026-10-08', '11:15', '12:00', 'Conférence — Maintenance industrielle : anticiper, maîtriser', AMPHI],
          ['2026-10-08', '12:00', '13:30', 'Repas', HALL],
          ['2026-10-08', '13:30', '14:00', "Conférence — L'intelligence artificielle et retours d'expérience", AMPHI],
          ['2026-10-08', '14:00', '14:30', 'Conférence — La chaleur dans les blanchisseries', AMPHI],
          ['2026-10-08', '14:30', '15:00', "Conférence — Les économies d'eau (retour d'expérience de Colmar)", AMPHI],
          ['2026-10-08', '15:00', '16:00', 'Ateliers URBH — 1er créneau (IA · Maintenance · RABC)', 'Salles B, C, D'],
          ['2026-10-08', '15:15', '15:45', 'Ateliers partenaires techniques', 'Salles E, F et amphithéâtre'],
          ['2026-10-08', '16:00', '17:00', 'Ateliers URBH — 2e créneau (IA · Maintenance · RABC)', 'Salles B, C, D'],
          ['2026-10-08', '16:15', '16:45', 'Ateliers partenaires techniques', 'Salles B, E, F'],
          ['2026-10-08', '17:00', '17:30', 'Ateliers partenaires techniques', 'Salles C, D, E et amphithéâtre'],
          ['2026-10-08', '17:30', '18:00', 'Pause / Visite des stands', HALL],
          ['2026-10-08', '18:00', '18:15', 'Fermeture des stands', HALL],
          ['2026-10-09', '08:30', '10:00', 'Accueil café — ouverture des stands', HALL],
          ['2026-10-09', '10:00', '10:20', 'Restitution des ateliers URBH', AMPHI],
          ['2026-10-09', '10:20', '10:40', 'La parole aux comités de région', AMPHI],
          ['2026-10-09', '10:40', '11:10', 'Conférence — Six Sigma : améliorer durablement', AMPHI],
          ['2026-10-09', '11:10', '11:30', 'Boîte à astuces — la table miroir de tri', AMPHI],
          ['2026-10-09', '11:30', '11:50', 'Remise des trophées certifications RABC', AMPHI],
          ['2026-10-09', '11:50', '12:00', "Remise du don à l'association Make-A-Wish", AMPHI],
          ['2026-10-09', '12:00', '12:15', 'Tombola', AMPHI],
          ['2026-10-09', '12:15', '12:30', 'Discours de clôture — relais à Biarritz', AMPHI],
          ['2026-10-09', '12:30', '14:00', 'Repas et fin des journées d’études', 'Salle R0'],
        ];
        await enregistrerProgramme(
          SEED.map(([jour, hDebut, hFin, titre, lieu]) => ({
            debut: firebase.firestore.Timestamp.fromDate(new Date(`${jour}T${hDebut}:00`)),
            fin: firebase.firestore.Timestamp.fromDate(new Date(`${jour}T${hFin}:00`)),
            titre,
            lieu,
          })),
        );
      });
    }

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

    // Suppression d'une entrée d'inscrit (doublon de test : la même personne
    // depuis plusieurs navigateurs). Le profil de l'appareil n'est pas touché.
    document.querySelectorAll('.bouton-supprimer-inscrit').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = inscriptions.find((x) => x.id === b.dataset.id);
        if (
          !confirm(
            `Supprimer l'entrée « ${i ? i.prenom + ' ' + i.nom : ''} » de la liste des inscrits ?\n\n` +
              'Le profil enregistré sur son appareil est aussi effacé : la personne ' +
              'devra se représenter, avec un numéro de carte reconnu dans l’annuaire.',
          )
        ) {
          return;
        }
        await db.collection('inscriptions').doc(b.dataset.id).delete();
        // Sans cette purge, l'appareil recréait la fiche à sa prochaine
        // ouverture du portail à partir du profil conservé localement.
        if (i && i.participantId) {
          try {
            await db.collection('participants').doc(i.participantId).delete();
          } catch (_) {
            /* profil déjà absent */
          }
        }
        router();
      }),
    );

    // --- tirage au sort

    document.getElementById('bouton-basculer-tirage').addEventListener('click', async () => {
      await refPortail.update({ 'tirage.ouvert': !tirageInfo.ouvert });
      router();
    });

    const boutonTirer = document.getElementById('bouton-tirer');
    boutonTirer.addEventListener('click', async () => {
      const dejaGagnants = new Set(gagnants.map((g2) => g2.participantId));
      const dejaGagnantsNumero = new Set(
        gagnants.map((g2) => normaliserNumero(g2.numeroInscription)).filter(Boolean),
      );
      const candidats = dedupeParNumero(participationsTirage).filter(
        (p) =>
          !dejaGagnants.has(p.participantId) &&
          !dejaGagnantsNumero.has(normaliserNumero(p.numeroInscription)),
      );
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

    // Liste des membres du CA (N° d'inscription) exclus de la tombola.
    document.getElementById('bouton-enregistrer-ca').addEventListener('click', async () => {
      const numeros = [
        ...new Set(
          document
            .getElementById('ca-numeros')
            .value.split(/[\s,;]+/)
            .map(normaliserNumero)
            .filter(Boolean),
        ),
      ];
      await refPortail.update({ 'tombola.exclusCA': numeros });
      router();
    });

    document.getElementById('bouton-prefill-ca').addEventListener('click', () => {
      // CA des 41es JE, retrouvé dans le fichier des participants ; Evelyne
      // THIERRY (présidente) n'y figure pas encore : ajoutez son numéro.
      document.getElementById('ca-numeros').value = [
        'JE2026-001', 'JE2026-015', 'JE2026-016', 'JE2026-020', 'JE2026-022',
        'JE2026-029', 'JE2026-030', 'JE2026-031', 'JE2026-032', 'JE2026-034',
        'JE2026-035', 'JE2026-037', 'JE2026-039', 'JE2026-041', 'JE2026-150',
      ].join(', ');
      alert(
        '15 numéros du CA pré-remplis (fichier des participants). ' +
          "Evelyne THIERRY n'y figure pas encore : ajoutez son numéro, " +
          'puis « Enregistrer la liste du CA ».',
      );
    });

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
        const dejaGagnantsTNumero = new Set(
          gagnantsTombola.map((g) => normaliserNumero(g.numeroInscription)).filter(Boolean),
        );
        const restants = candidatsTombola.filter(
          (c) =>
            !dejaGagnantsT.has(c.participantId) &&
            !dejaGagnantsTNumero.has(normaliserNumero(c.numeroInscription)),
        );
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

    // Gagnant absent de la salle : rayé en direct (il reste affiché barré au
    // kiosque, ne peut plus être retiré) et remplacé aussitôt par un nouveau
    // tirage parmi les éligibles restants — le kiosque enchaîne l'annonce.
    document.querySelectorAll('.bouton-rayer-gagnant').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        const actif = gagnantsTombola.find((g) => g.lotIndex === i && !g.raye);
        const lot = lotsTombola[i];
        if (!actif || !lot) return;
        if (
          !confirm(
            `Rayer ${actif.prenom} ${actif.nom} (absent de la salle) et tirer immédiatement un remplaçant ?`,
          )
        ) {
          return;
        }
        const nouveaux = gagnantsTombola.map((g) => (g === actif ? { ...g, raye: true } : g));
        const dejaGagnantsT = new Set(nouveaux.map((g) => g.participantId));
        const dejaGagnantsTNumero = new Set(
          nouveaux.map((g) => normaliserNumero(g.numeroInscription)).filter(Boolean),
        );
        const restants = candidatsTombola.filter(
          (c) =>
            !dejaGagnantsT.has(c.participantId) &&
            !dejaGagnantsTNumero.has(normaliserNumero(c.numeroInscription)),
        );
        if (restants.length) {
          const elu = restants[Math.floor(Math.random() * restants.length)];
          nouveaux.push({
            lotIndex: i,
            lotLibelle: lot.libelle,
            fournisseurNom: lot.fournisseurNom || '',
            participantId: elu.participantId,
            prenom: elu.prenom || '',
            nom: elu.nom || '',
            organisme: elu.organisme || '',
            mobile: elu.mobile || '',
            numeroInscription: elu.numeroInscription || '',
          });
        } else {
          alert('Gagnant rayé — plus aucun participant éligible pour le remplacer : retirez ce lot plus tard.');
        }
        await refPortail.update({ 'tombola.gagnants': nouveaux });
        router();
      }),
    );

    document.querySelectorAll('.bouton-annuler-gagnant-tombola').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.index);
        const actif = gagnantsTombola.find((g) => g.lotIndex === i && !g.raye);
        if (!actif) return;
        if (!confirm('Annuler ce gagnant (erreur de manipulation) ? Il redevient éligible.')) return;
        // On ne retire que le gagnant actif : les rayés restent dans l'historique.
        await refPortail.update({
          'tombola.gagnants': gagnantsTombola.filter((g) => g !== actif),
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
        // Tableau officiel du JEUDI APRÈS-MIDI (tiré à part des 41es JE) :
        // ateliers URBH (B, C, D — deux sessions) et ateliers partenaires
        // techniques (E, F, Auditorium). Le champ « creneau » regroupe les
        // horaires qui se chevauchent : une seule inscription possible par
        // créneau. Bouton ré-exécutable : les ateliers déjà présents
        // (même salle, même créneau) ne sont pas recréés.
        const TABLE = [
          // Créneau 15h
          { creneau: 'Jeudi 15h', salle: 'B', heure: 15, minute: 0, horaire: 'Jeudi 15h00 – 15h45',
            nom: "L'Intelligence Artificielle au service des blanchisseries (1re session)",
            intervenants: 'Vincent Pacton, Denis Bonnet, Éric Tisserand — animatrice : Agnès Souvignet' },
          { creneau: 'Jeudi 15h', salle: 'C', heure: 15, minute: 0, horaire: 'Jeudi 15h00 – 15h45',
            nom: 'Des outils pour la gestion de la maintenance (1re session)',
            intervenants: 'Jean-Pascal Testard, Lucas Monrousseau, Hervé Dumoulin — animateurs : Jean-Pierre Bretagnon et Vincent Pacton' },
          { creneau: 'Jeudi 15h', salle: 'D', heure: 15, minute: 0, horaire: 'Jeudi 15h00 – 15h45',
            nom: "Comment l'IA peut-elle nous aider dans la mise en place et le pilotage de la démarche RABC ? (1re session)",
            intervenants: 'Mikael Gilbrin, Frédéric Jourdan — animateurs : Catherine Diallo et Frédéric Jourdan' },
          { creneau: 'Jeudi 15h', salle: 'Auditorium', heure: 15, minute: 15, horaire: 'Jeudi 15h15',
            nom: 'Décret tertiaire',
            intervenants: "Optim'Expertise — Hélène Ducarre" },
          { creneau: 'Jeudi 15h', salle: 'E', heure: 15, minute: 15, horaire: 'Jeudi 15h15',
            nom: 'Le textile au service du développement durable de votre établissement',
            intervenants: "Cloro'fil Concept — Caroline L'Huillier" },
          { creneau: 'Jeudi 15h', salle: 'F', heure: 15, minute: 15, horaire: 'Jeudi 15h15',
            nom: "L'écosystème connectivité / IA sous-jacente",
            intervenants: 'Primus — Fabrice Bosco' },
          // Créneau 16h
          { creneau: 'Jeudi 16h', salle: 'B', heure: 16, minute: 0, horaire: 'Jeudi 16h00 – 16h45',
            nom: "L'Intelligence Artificielle au service des blanchisseries (2e session)",
            intervenants: 'Vincent Pacton, Denis Bonnet, Éric Tisserand — animatrice : Agnès Souvignet' },
          { creneau: 'Jeudi 16h', salle: 'C', heure: 16, minute: 0, horaire: 'Jeudi 16h00 – 16h45',
            nom: 'Des outils pour la gestion de la maintenance (2e session)',
            intervenants: 'Jean-Pascal Testard, Lucas Monrousseau, Hervé Dumoulin — animateurs : Jean-Pierre Bretagnon et Vincent Pacton' },
          { creneau: 'Jeudi 16h', salle: 'D', heure: 16, minute: 0, horaire: 'Jeudi 16h00 – 16h45',
            nom: "Comment l'IA peut-elle nous aider dans la mise en place et le pilotage de la démarche RABC ? (2e session)",
            intervenants: 'Mikael Gilbrin, Frédéric Jourdan — animateurs : Catherine Diallo et Frédéric Jourdan' },
          { creneau: 'Jeudi 16h', salle: 'E', heure: 16, minute: 15, horaire: 'Jeudi 16h15',
            nom: 'Nouvelle version du logiciel de gestion textile',
            intervenants: 'ActiPrint — Sébastien Bremec' },
          { creneau: 'Jeudi 16h', salle: 'F', heure: 16, minute: 15, horaire: 'Jeudi 16h15',
            nom: 'Un robot de nettoyage des sols',
            intervenants: 'Nilfisk — François-Xavier Coudray' },
          // Créneau 17h
          { creneau: 'Jeudi 17h', salle: 'B', heure: 17, minute: 0, horaire: 'Jeudi 17h00',
            nom: "Simplifier le suivi des levées de réserves grâce à l'IA associé à votre logiciel GMAO",
            intervenants: 'Tribofilm — Alexis Chaillet' },
          { creneau: 'Jeudi 17h', salle: 'C', heure: 17, minute: 0, horaire: 'Jeudi 17h00',
            nom: 'Formation gestionnaire de la fonction linge',
            intervenants: 'CCI des Vosges — Cécile Poirot, Stéphane Fié (Saumur)' },
          { creneau: 'Jeudi 17h', salle: 'D', heure: 17, minute: 0, horaire: 'Jeudi 17h00',
            nom: "L'Intelligence Artificielle au service du tri du linge sale",
            intervenants: 'Girbau — Thierry Sénevat et Toni Dominguez' },
          { creneau: 'Jeudi 17h', salle: 'E', heure: 17, minute: 0, horaire: 'Jeudi 17h00',
            nom: "Les économies d'eau",
            intervenants: 'Christeyns — Stéphane Sanquer' },
          { creneau: 'Jeudi 17h', salle: 'Auditorium', heure: 17, minute: 0, horaire: 'Jeudi 17h00',
            nom: "Décret tertiaire, c'est pour demain !",
            intervenants: "Optim'Expertise — Hélène Ducarre" },
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
        // Clé anti-doublon : salle + première heure trouvée dans l'horaire
        // (couvre aussi les ateliers créés par les anciennes versions).
        const cleAtelier = (salle, texte) => {
          const h = String(texte || '').match(/(\d{1,2})\s*h/i);
          return String(salle || '').toUpperCase() + '|' + (h ? h[1] : '');
        };
        const dejaLa = new Set(ateliers.map((a) => cleAtelier(a.salle, a.creneau || a.horaire)));
        let crees = 0;
        for (const t of TABLE) {
          if (dejaLa.has(cleAtelier(t.salle, t.creneau))) continue;
          let debutLe = null;
          if (jeudi) {
            const d = new Date(jeudi);
            d.setHours(t.heure, t.minute, 0, 0);
            debutLe = firebase.firestore.Timestamp.fromDate(d);
          }
          await creerAtelier({
            nom: t.nom,
            salle: t.salle,
            horaire: t.horaire,
            creneau: t.creneau,
            intervenants: t.intervenants,
            debutLe,
            capacite: 20,
          });
          crees += 1;
        }
        alert(crees ? `${crees} atelier(s) créé(s) d'après le tableau du jeudi.` : 'Tous les ateliers du tableau existent déjà.');
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
      const nbParEtab = new Map(); // retenus de cet atelier, par blanchisserie
      const cleEtab = (v) =>
        (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;

      function passe(condition) {
        melange.forEach((v) => {
          if (retenus.length >= capacite || pris.has(v.participantId)) return;
          if (!condition(v)) return;
          retenus.push(v);
          pris.add(v.participantId);
          nbParEtab.set(cleEtab(v), (nbParEtab.get(cleEtab(v)) || 0) + 1);
        });
      }
      // Préférence à la RÉPARTITION d'une même blanchisserie sur plusieurs
      // ateliers : d'abord une personne par établissement, puis une marge de
      // DEUX par atelier (pour permettre à deux collègues de débattre entre
      // eux), avant d'ouvrir plus largement.
      passe((v) => !retenusAilleurs.has(v.participantId) && !(nbParEtab.get(cleEtab(v)) >= 1));
      passe((v) => !retenusAilleurs.has(v.participantId) && !(nbParEtab.get(cleEtab(v)) >= 2));
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
      const { retenus, attente } = tirerEquitable(
        dedupeParNumero(voeux),
        atelier.capacite || 20,
        retenusAilleurs,
      );
      await db.collection('ateliers').doc(atelierId).update({
        statut: 'tire',
        retenus: retenus.map(versPublic),
        listeAttente: attente.map(versPublic),
        tireLe: firebase.firestore.FieldValue.serverTimestamp(),
      });
      router();
    }

    document.querySelectorAll('.bouton-basculer-atelier').forEach((b) =>
      b.addEventListener('click', async () => {
        await db.collection('ateliers').doc(b.dataset.id).update({ statut: b.dataset.vers });
        router();
      }),
    );
    const boutonOuvrirTous = document.getElementById('bouton-ouvrir-tous-ateliers');
    if (boutonOuvrirTous) {
      boutonOuvrirTous.addEventListener('click', async () => {
        for (const a of ateliers) {
          if (a.statut !== 'tire' && a.statut !== 'ouvert') {
            await db.collection('ateliers').doc(a.id).update({ statut: 'ouvert' });
          }
        }
        router();
      });
    }
    const boutonFermerTous = document.getElementById('bouton-fermer-tous-ateliers');
    if (boutonFermerTous) {
      boutonFermerTous.addEventListener('click', async () => {
        for (const a of ateliers) {
          if (a.statut === 'ouvert') {
            await db.collection('ateliers').doc(a.id).update({ statut: 'ferme' });
          }
        }
        router();
      });
    }

    // Programmation du tirage automatique (exécuté chaque minute par la
    // fonction serveur tiragesAteliersAutomatiques).
    document.querySelectorAll('.bouton-programmer-tirage').forEach((b) =>
      b.addEventListener('click', async () => {
        const champ = document.querySelector(`.prog-tirage-heure[data-id="${b.dataset.id}"]`);
        const d = champ ? new Date(champ.value) : null;
        if (!d || Number.isNaN(d.getTime())) {
          alert("Choisissez la date et l'heure du tirage automatique.");
          return;
        }
        await db.collection('ateliers').doc(b.dataset.id).update({
          tirageAutoLe: firebase.firestore.Timestamp.fromDate(d),
        });
        router();
      }),
    );
    document.querySelectorAll('.bouton-annuler-prog-tirage').forEach((b) =>
      b.addEventListener('click', async () => {
        await db.collection('ateliers').doc(b.dataset.id).update({ tirageAutoLe: null });
        router();
      }),
    );
    const boutonProgrammerTous = document.getElementById('bouton-programmer-tous-tirages');
    if (boutonProgrammerTous) {
      boutonProgrammerTous.addEventListener('click', async () => {
        if (!finAGparDefaut) return;
        for (const a of ateliers) {
          if (a.statut !== 'tire') {
            await db.collection('ateliers').doc(a.id).update({ tirageAutoLe: finAGparDefaut });
          }
        }
        router();
      });
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

    // Remise à zéro des passages sur les stands (avant l'ouverture des JE :
    // efface les essais pour repartir d'un compteur propre).
    const boutonRzVisites = document.getElementById('bouton-rz-visites');
    if (boutonRzVisites) {
      boutonRzVisites.addEventListener('click', async () => {
        if (
          !confirm(
            `Effacer définitivement les ${visitesJ.length} passage(s) enregistré(s) sur les stands ?\n\n` +
              'À faire avant l’ouverture des JE pour repartir de zéro. ' +
              'Exportez le CSV d’abord si vous voulez en garder une trace.',
          )
        ) {
          return;
        }
        boutonRzVisites.disabled = true;
        for (let i = 0; i < visitesJ.length; i += 400) {
          const lot = db.batch();
          visitesJ.slice(i, i + 400).forEach((v) => lot.delete(db.collection('visites').doc(v.id)));
          await lot.commit();
        }
        router();
      });
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
        titreCourt: document.getElementById('jm-titre-court').value.trim(),
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
        ...desistementsJ.map((d) => db.collection('desistements').doc(d.id)),
        ...snapEval.docs.map((d) => d.ref),
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

    document.getElementById('bouton-seed-questionnaires').addEventListener('click', async () => {
      const OFFICIELS = [
        ['stagiaires', 'visiteur'],
        ['partenaires', 'exposant'],
        ['atelier_ia', 'visiteur'],
        ['atelier_maintenance', 'visiteur'],
        ['atelier_rabc', 'visiteur'],
      ];
      let crees = 0;
      for (const [cle, audience] of OFFICIELS) {
        const modele = MODELES[cle];
        if (!modele) continue;
        // Pas de doublon : un questionnaire issu du même modèle existe déjà ?
        if (questionnaires.some((q) => q.titre && q.titre.startsWith(modele.titre))) continue;
        await db.collection('questionnaires').add({
          journeeId,
          journeeTitre: journee.titre,
          journeeDate: fmtPeriode(journee),
          journeeLieu: journee.lieu || '',
          titre: modele.titre + ' — ' + journee.titre,
          statut: 'brouillon',
          audience,
          // Questionnaire d'atelier : réservé aux retenus de cet atelier.
          reserveAtelier: MOTIFS_ATELIERS[cle] || '',
          questions: JSON.parse(JSON.stringify(modele.questions)),
          creeLe: firebase.firestore.FieldValue.serverTimestamp(),
        });
        crees += 1;
      }
      alert(
        crees
          ? `${crees} questionnaire(s) créé(s) en brouillon — ouvrez chacun au moment voulu.`
          : 'Les 5 questionnaires officiels existent déjà pour cette journée.',
      );
      router();
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

  // Commentaires ciblés laissés sous une question (clé
  // « <question>__commentaire » dans la carte de réponses du participant).
  function commentairesQuestion(q, reponses) {
    return reponses
      .map((r) => (r.reponses || {})[q.id + '__commentaire'])
      .filter(Boolean)
      .map(String);
  }

  function htmlStatsQuestion(q, s, commentaires) {
    let resume = '';
    let corps = '';

    if (q.type === 'echelle4') {
      resume = s.n
        ? `moyenne ${s.moyenne.toFixed(2)} / 4 — ${pourcent(s.satisfaits, s.n)} satisfaits`
        : 'aucune réponse';
      // Certaines questions portent leurs propres libellés d'échelle
      // (« Pas du tout satisfait … Très satisfait » des ateliers).
      const libellesEchelle =
        Array.isArray(q.libelles) && q.libelles.length === 4 ? q.libelles : ECHELLE4;
      corps = htmlBarres(
        libellesEchelle.map((lib, i) => [lib, s.comptes[i]]),
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

    const blocCommentaires =
      commentaires && commentaires.length
        ? `<div class="muet petit" style="margin-top:0.5rem">💬 Commentaires sur cette question :</div>
          <ul class="verbatims">${commentaires.map((v) => `<li>${echapper(v)}</li>`).join('')}</ul>`
        : '';

    return `<div class="stat-question">
      <div class="entete">
        <div class="libelle">${echapper(q.libelle)}</div>
        <div class="resume">${resume}</div>
      </div>
      ${corps}
      ${blocCommentaires}
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
        <a class="btn secondaire" href="#/journee/${attr(questionnaire.journeeId)}">← Retour à la journée</a>
        <span class="fil-chemin">
        <a href="#/journees">Journées d'études</a> ›
        <a href="#/journee/${attr(questionnaire.journeeId)}">${echapper(questionnaire.journeeTitre || 'Journée')}</a> ›
        Questionnaire</span>
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
                    html += htmlStatsQuestion(
                      q,
                      statsQuestion(q, reponses),
                      commentairesQuestion(q, reponses),
                    );
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

  // -------------------------------------------------------- cartes repliables
  // Un clic sur le titre d'un cadre le replie/déplie en entier ; les longues
  // listes (fournisseurs, inscrits…) ont en plus leur propre repli partiel.
  // L'état est mémorisé sur ce navigateur et survit aux rafraîchissements.

  function cleRepli(texte) {
    return (
      'urbh_repli_' +
      String(texte)
        .toLowerCase()
        .replace(/\d+/g, '') // les compteurs (« Inscrits (12) ») varient
        .replace(/[^a-z]+/g, '-')
        .slice(0, 60)
    );
  }

  function rendreCartesRepliables() {
    document.querySelectorAll('#app .carte').forEach((carte) => {
      const h2 = carte.querySelector(':scope > h2');
      if (!h2 || h2.dataset.repliable) return;
      h2.dataset.repliable = '1';
      const cle = cleRepli(h2.textContent);
      const chevron = document.createElement('span');
      chevron.className = 'chevron-carte';
      h2.prepend(chevron);
      const appliquer = () => {
        // REPLIÉ par défaut à l'ouverture de l'application ; chaque carte
        // dépliée ou repliée est mémorisée sur l'appareil (téléphone ou
        // ordinateur), et retrouvée telle quelle à la prochaine ouverture.
        let replie = true;
        try {
          replie = localStorage.getItem(cle) !== '0';
        } catch (_) {
          /* stockage indisponible */
        }
        carte.classList.toggle('repliee', replie);
        chevron.textContent = replie ? '▸ ' : '▾ ';
      };
      appliquer();
      h2.addEventListener('click', (evt) => {
        if (evt.target.closest('button, a, input, select')) return;
        try {
          localStorage.setItem(cle, carte.classList.contains('repliee') ? '0' : '1');
        } catch (_) {
          /* stockage indisponible */
        }
        appliquer();
      });
    });

    // Repli partiel : uniquement la liste, le reste du cadre reste visible.
    document.querySelectorAll('#app .carte ul.liste').forEach((liste, i) => {
      if (liste.dataset.repliable) return;
      const nb = liste.children.length;
      if (nb < 6) return;
      liste.dataset.repliable = '1';
      const carte = liste.closest('.carte');
      const h2 = carte ? carte.querySelector(':scope > h2') : null;
      const cle = cleRepli((h2 ? h2.textContent : 'liste') + '-liste-' + i);
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'discret repli-liste';
      liste.parentNode.insertBefore(bouton, liste);
      const appliquer = () => {
        // Longues listes : repliées par défaut elles aussi, position
        // mémorisée sur l'appareil.
        let replie = true;
        try {
          replie = localStorage.getItem(cle) !== '0';
        } catch (_) {
          /* stockage indisponible */
        }
        liste.hidden = replie;
        bouton.textContent = replie
          ? `▸ Afficher la liste (${nb})`
          : `▾ Replier la liste (${nb})`;
      };
      appliquer();
      bouton.addEventListener('click', () => {
        try {
          localStorage.setItem(cle, liste.hidden ? '0' : '1');
        } catch (_) {
          /* stockage indisponible */
        }
        appliquer();
      });
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
    rendreCartesRepliables();
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

  // ------------------------------------------------- installation (PWA)
  // La console d'administration s'installe comme une application à part
  // (icône ROUGE « URBH ADMIN », manifest-admin.webmanifest), distincte de
  // l'application bleue des participants — sur téléphone comme sur PC.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {
      /* hors https ou navigateur ancien : sans conséquence */
    });
  }
  const $installer = document.getElementById('bouton-installer-admin');
  if ($installer) {
    let promptInstallation = null;
    // En mode « application » sur l'adresse jumelle (…firebaseapp.com), on
    // est DANS la console rouge installée : le bouton n'a plus d'objet. En
    // mode « application » sur …web.app, c'est la fenêtre de l'application
    // BLEUE qui affiche la page d'administration : le bouton reste visible
    // pour proposer la bascule vers l'adresse jumelle installable.
    const estConsoleInstallee = () =>
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) &&
      !location.hostname.endsWith('.web.app');

    // Le bouton reste TOUJOURS visible (il est affiché d'office dans la
    // page) : dans la console installée il devient simplement « ✓ Installée »
    // au lieu de disparaître — un bouton qui s'évapore déroute.
    function majBoutonInstallation() {
      if (estConsoleInstallee()) {
        $installer.textContent = '✓ Installée';
        $installer.disabled = true;
        $installer.title = "La console est déjà installée sur cet appareil.";
      }
    }
    majBoutonInstallation();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      promptInstallation = e;
    });
    // Panneau d'aide affiché DANS la page : contrairement à alert()/confirm(),
    // il ne peut pas être bloqué par le navigateur (Safari coupe les alertes
    // répétées), et il reste lisible et cliquable sur téléphone.
    function afficherGuide(titre, corpsHtml, boutons) {
      const ancien = document.getElementById('guide-installation');
      if (ancien) ancien.remove();
      const voile = document.createElement('div');
      voile.id = 'guide-installation';
      voile.style.cssText =
        'position:fixed;inset:0;z-index:100;background:rgba(15,23,42,0.55);' +
        'display:flex;align-items:flex-end;justify-content:center;';
      const panneau = document.createElement('div');
      panneau.style.cssText =
        'background:#fff;color:#1f2937;border-radius:16px 16px 0 0;' +
        'padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom,0px));' +
        'max-width:460px;width:100%;box-shadow:0 -8px 30px rgba(0,0,0,0.3);' +
        'max-height:80vh;overflow:auto';
      panneau.innerHTML =
        `<h3 style="margin:0 0 0.6rem;font-size:1.05rem">${titre}</h3>` + corpsHtml;
      const ligne = document.createElement('div');
      ligne.style.cssText = 'display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.9rem';
      (boutons || [{ libelle: "J'ai compris" }]).forEach((b) => {
        const bouton = document.createElement('button');
        bouton.textContent = b.libelle;
        bouton.style.cssText = 'flex:1;min-width:9rem' + (b.secondaire ? ';background:#fff;color:#1d4e89' : '');
        if (b.secondaire) bouton.className = 'secondaire';
        bouton.addEventListener('click', () => {
          voile.remove();
          if (b.action) b.action();
        });
        ligne.append(bouton);
      });
      panneau.append(ligne);
      voile.append(panneau);
      voile.addEventListener('click', (e2) => {
        if (e2.target === voile) voile.remove();
      });
      document.body.append(voile);
    }

    $installer.addEventListener('click', async () => {
      if (promptInstallation) {
        promptInstallation.prompt();
        try {
          const choix = await promptInstallation.userChoice;
          if (choix && choix.outcome === 'accepted') {
            $installer.textContent = '✓ Installée';
            $installer.disabled = true;
          }
        } catch (_) {
          /* fenêtre fermée : le bouton reste disponible */
        }
        promptInstallation = null;
        return;
      }

      // iPhone et iPad (l'iPad se présente comme un Mac, on le repère au
      // tactile) : l'ajout à l'écran d'accueil marche depuis N'IMPORTE
      // QUELLE adresse — pas besoin de la bascule vers l'adresse jumelle.
      const surIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (surIOS) {
        afficherGuide(
          'Installer sur iPhone / iPad',
          `<p style="margin:0 0 0.8rem;font-size:0.88rem;color:#4b5563">Apple ne
            permet pas l'installation automatique — trois gestes suffisent,
            depuis Safari :</p>
          <ol style="margin:0;padding-left:1.3rem;font-size:0.95rem;line-height:1.65">
            <li>Touchez <strong>Partager</strong>
              <span style="display:inline-block;border:1.5px solid #1d4e89;color:#1d4e89;
                border-radius:6px;padding:0 0.4em;font-weight:700">&#x2191;</span>
              — barre du bas de Safari (en haut à droite sur iPad) ;</li>
            <li>faites défiler la liste — ou touchez <strong>« En voir
              plus »</strong> — puis <strong>« Sur l'écran d'accueil »</strong> ;</li>
            <li><strong>Ajouter</strong> : l'icône rouge <strong>URBH ADMIN</strong>
              apparaît sur l'écran d'accueil.</li>
          </ol>
          <p style="margin:0.8rem 0 0;font-size:0.8rem;color:#6b7280">Si « Sur
            l'écran d'accueil » n'apparaît pas, ouvrez d'abord cette page dans
            Safari lui-même (pas dans le navigateur intégré d'une autre
            application).</p>
          <div style="text-align:center;font-size:1.5rem;margin-top:0.4rem">⬇️</div>`,
        );
        return;
      }

      // Ailleurs, quand rien n'est proposé automatiquement : la cause la
      // plus fréquente est l'application BLEUE déjà installée, qui couvre
      // tout le site web.app. L'adresse jumelle …firebaseapp.com est vue
      // comme un site distinct : l'installation y redevient possible.
      const hote = location.hostname;
      if (hote.endsWith('.web.app')) {
        const jumelle = hote.replace(/\.web\.app$/, '.firebaseapp.com');
        afficherGuide(
          "Installer la console d'administration",
          `<p style="margin:0;font-size:0.9rem;color:#4b5563">Le navigateur ne
            propose pas l'installation sur cette adresse — l'application bleue
            des participants couvre déjà ce site. La console s'installe depuis
            son adresse jumelle <strong>${jumelle}</strong> (même
            administration, mêmes données — reconnectez-vous une fois sur
            place).</p>`,
          [
            { libelle: "Ouvrir l'adresse jumelle", action: () => { location.href = 'https://' + jumelle + '/index.html'; } },
            { libelle: 'Annuler', secondaire: true },
          ],
        );
        return;
      }

      // Déjà sur l'adresse jumelle : marche à suivre selon le navigateur.
      const surAndroid = /Android/.test(navigator.userAgent);
      const surSafariMac =
        /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) &&
        !/Chrome|Chromium|Edg/.test(navigator.userAgent);
      let corps;
      if (surAndroid) {
        corps = `<ol style="margin:0;padding-left:1.3rem;font-size:0.95rem;line-height:1.65">
            <li>Ouvrez le menu <strong>⋮</strong> en haut à droite de Chrome ;</li>
            <li>choisissez <strong>« Installer l'application »</strong>
              (ou « Ajouter à l'écran d'accueil ») ;</li>
            <li>validez : l'icône rouge <strong>URBH ADMIN</strong> est ajoutée.</li>
          </ol>`;
      } else if (surSafariMac) {
        corps = `<ol style="margin:0;padding-left:1.3rem;font-size:0.95rem;line-height:1.65">
            <li>Menu <strong>Fichier</strong> de Safari ;</li>
            <li>choisissez <strong>« Ajouter au Dock… »</strong> ;</li>
            <li>validez : la console s'ouvre depuis le Dock comme une application.</li>
          </ol>
          <p style="margin:0.8rem 0 0;font-size:0.8rem;color:#6b7280">« Ajouter au
            Dock » demande macOS Sonoma ou plus récent ; sinon, utilisez Chrome
            ou Edge pour installer la console.</p>`;
      } else {
        corps = `<ol style="margin:0;padding-left:1.3rem;font-size:0.95rem;line-height:1.65">
            <li>Regardez à droite de la barre d'adresse : une petite icône
              d'installation apparaît — cliquez-la ;</li>
            <li>sinon : menu ⋮ (ou …) → « Caster, enregistrer et partager » →
              <strong>« Installer la page »</strong> (Chrome), ou
              « Applications » → <strong>« Installer ce site en tant
              qu'application »</strong> (Edge).</li>
          </ol>
          <p style="margin:0.8rem 0 0;font-size:0.8rem;color:#6b7280">Si rien
            n'est proposé, rechargez la page puis réessayez.</p>`;
      }
      afficherGuide("Installer la console d'administration", corps);
    });
    window.addEventListener('appinstalled', () => {
      $installer.textContent = '✓ Installée';
      $installer.disabled = true;
    });
  }
})();
