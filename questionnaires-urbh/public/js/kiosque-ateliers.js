// Kiosque de projection des ateliers (devant les salles B, C, D…).
//
//   https://<projet>.web.app/kiosque-ateliers.html          → journée active
//   https://<projet>.web.app/kiosque-ateliers.html?e=<id>   → journée précise
//
// Branché en direct sur les ateliers de la journée : dès qu'un tirage au
// sort est lancé dans l'administration, la liste des retenus de l'atelier
// apparaît ici, nom par nom, avec la liste d'attente en dessous. La lecture
// des ateliers demande une connexion : le kiosque ouvre une session anonyme
// (comme le portail des participants).

(function () {
  'use strict';

  if (!firebase.apps.length) {
    if (!window.firebaseConfigEstRenseignee()) return;
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  const $grille = document.getElementById('grille');
  const dejaTires = new Set(); // ateliers déjà affichés « tirés » (pas de re-animation)
  let premierAffichage = true;

  function afficher(ateliers) {
    ateliers.sort(
      (a, b) =>
        String(a.horaire || '').localeCompare(String(b.horaire || '')) ||
        String(a.salle || '').localeCompare(String(b.salle || '')),
    );
    $grille.innerHTML = '';
    if (!ateliers.length) {
      $grille.innerHTML = '<div class="vide">Les ateliers seront affichés ici.</div>';
      return;
    }

    ateliers.forEach((a) => {
      const carte = document.createElement('div');
      carte.className = 'atelier';
      const nouveauTirage = a.statut === 'tire' && !dejaTires.has(a.id) && !premierAffichage;
      if (a.statut === 'tire') dejaTires.add(a.id);
      if (nouveauTirage) carte.classList.add('vient-d-etre-tire');

      const haut = document.createElement('div');
      haut.className = 'haut';
      const salle = document.createElement('span');
      salle.className = 'salle';
      salle.textContent = a.salle || '?';
      const bloc = document.createElement('div');
      const nom = document.createElement('div');
      nom.className = 'nom';
      nom.textContent = a.nom || '';
      const horaire = document.createElement('div');
      horaire.className = 'horaire';
      horaire.textContent = a.horaire || '';
      bloc.append(nom, horaire);
      haut.append(salle, bloc);
      carte.append(haut);

      if (a.statut === 'tire') {
        const liste = document.createElement('ol');
        liste.className = 'retenus';
        (a.retenus || []).forEach((r, i) => {
          const li = document.createElement('li');
          // Cascade d'apparition uniquement pour un tirage qui vient d'arriver.
          li.style.animationDelay = nouveauTirage ? `${0.3 + i * 0.35}s` : '0s';
          const fort = document.createElement('strong');
          fort.textContent = `${r.prenom || ''} ${(r.nom || '').toUpperCase()}`.trim();
          li.append(fort);
          if (r.organisme) {
            const org = document.createElement('span');
            org.className = 'org';
            org.textContent = ` — ${r.organisme}`;
            li.append(org);
          }
          liste.append(li);
        });
        carte.append(liste);
        if ((a.listeAttente || []).length) {
          const attente = document.createElement('div');
          attente.className = 'attente-liste';
          attente.textContent =
            "Liste d'attente : " +
            (a.listeAttente || [])
              .map((r, i) => `${i + 1}. ${r.prenom || ''} ${(r.nom || '').toUpperCase()}`.trim())
              .join(' · ');
          carte.append(attente);
        }
      } else {
        const etat = document.createElement('div');
        etat.className = 'etat';
        etat.textContent = '⏳ Tirage au sort à venir — résultats affichés ici en direct.';
        carte.append(etat);
      }
      $grille.append(carte);
    });
    premierAffichage = false;
  }

  async function demarrer() {
    const params = new URLSearchParams(location.search);
    const demande = params.get('e');
    let journeeId = null;
    try {
      if (demande && /^[A-Za-z0-9_-]+$/.test(demande)) {
        journeeId = demande;
      } else {
        const snap = await db.collection('portails').where('actif', '==', true).limit(1).get();
        if (!snap.empty) journeeId = snap.docs[0].id;
      }
      if (journeeId) {
        const doc = await db.collection('portails').doc(journeeId).get();
        if (doc.exists) {
          const p = doc.data();
          document.getElementById('surtitre').textContent =
            [p.titreCourt || p.titre, p.date].filter(Boolean).join(' — ');
        }
      }
    } catch (_) {
      /* traité ci-dessous */
    }
    if (!journeeId) {
      $grille.innerHTML = '<div class="vide">Aucune journée d’études active.</div>';
      return;
    }
    db.collection('ateliers')
      .where('journeeId', '==', journeeId)
      .onSnapshot(
        (snap) => afficher(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => {
          $grille.innerHTML = '<div class="vide">Connexion interrompue — rechargez la page.</div>';
        },
      );
  }

  function basculerPleinEcran() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  document.addEventListener('dblclick', basculerPleinEcran);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') basculerPleinEcran();
  });

  // Session anonyme (ou session existante) puis écoute en direct.
  let demarre = false;
  auth.onAuthStateChanged((user) => {
    if (demarre) return;
    if (user) {
      demarre = true;
      demarrer();
    } else {
      auth.signInAnonymously().catch(() => {
        $grille.innerHTML = '<div class="vide">Connexion impossible — vérifiez le réseau puis rechargez.</div>';
      });
    }
  });
})();
