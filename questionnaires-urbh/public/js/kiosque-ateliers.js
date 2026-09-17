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

  // Décor : l'affiche officielle des JE, en fond estompé, dès que le fichier
  // affiche-2026.jpg est publié avec le site (rien sinon).
  (function () {
    const affiche = new Image();
    affiche.onload = () => {
      const decor = document.createElement('div');
      decor.className = 'decor-affiche';
      decor.style.backgroundImage = "url('affiche-2026.jpg')";
      document.body.prepend(decor);
    };
    affiche.src = 'affiche-2026.jpg';
  })();

  if (!firebase.apps.length) {
    if (!window.firebaseConfigEstRenseignee()) return;
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  const $grille = document.getElementById('grille');
  const $bandeau = document.getElementById('bandeau-creneau');
  const dejaTires = new Set(); // ateliers déjà affichés « tirés » (pas de re-animation)
  let premierAffichage = true;
  let groupes = []; // un groupe par créneau horaire : [{ horaire, ateliers }]
  let indexGroupe = 0;
  let tousAteliers = [];
  // Mode « tableau » (?grille=1, ou touche G) : la grille horaires × salles
  // complète, comme le tableau Excel — à projeter pendant l'Assemblée
  // Générale pour visualiser les ateliers qui se chevauchent.
  let modeTableau = new URLSearchParams(location.search).get('grille') === '1';

  // Avec 20 places par atelier, tout ne tient pas sur un seul écran : le
  // kiosque affiche UN créneau à la fois (ses salles côte à côte, noms sur
  // deux colonnes) et fait tourner les créneaux toutes les 12 secondes.
  // Un tirage qui tombe bascule immédiatement sur son créneau.

  function grouper(ateliers) {
    const parHoraire = new Map();
    ateliers.forEach((a) => {
      const cle = a.horaire || '';
      if (!parHoraire.has(cle)) parHoraire.set(cle, []);
      parHoraire.get(cle).push(a);
    });
    return [...parHoraire.entries()].map(([horaire, liste]) => ({ horaire, ateliers: liste }));
  }

  function carteAtelier(a, nouveauTirage) {
    const carte = document.createElement('div');
    carte.className = 'atelier';
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
    bloc.append(nom);
    haut.append(salle, bloc);
    carte.append(haut);

    if (a.statut === 'tire') {
      const retenus = a.retenus || [];
      const liste = document.createElement('ol');
      liste.className = 'retenus' + (retenus.length > 8 ? ' colonnes' : '');
      retenus.forEach((r, i) => {
        const li = document.createElement('li');
        // Cascade d'apparition uniquement pour un tirage qui vient d'arriver.
        li.style.animationDelay = nouveauTirage ? `${0.3 + i * 0.25}s` : '0s';
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
      const attente = a.listeAttente || [];
      if (attente.length) {
        const bloc2 = document.createElement('div');
        bloc2.className = 'attente-liste';
        const visibles = attente.slice(0, 8);
        bloc2.textContent =
          "Liste d'attente : " +
          visibles
            .map((r, i) => `${i + 1}. ${r.prenom || ''} ${(r.nom || '').toUpperCase()}`.trim())
            .join(' · ') +
          (attente.length > visibles.length ? ` · +${attente.length - visibles.length} autres` : '');
        carte.append(bloc2);
      }
    } else {
      const etat = document.createElement('div');
      etat.className = 'etat';
      etat.textContent =
        a.statut === 'ouvert'
          ? "🟢 Inscriptions ouvertes — inscrivez-vous sur l'application !"
          : '⏳ Tirage au sort à venir — résultats affichés ici en direct.';
      carte.append(etat);
    }
    return carte;
  }

  // Tableau complet horaires × salles (une seule inscription possible par
  // créneau : les stagiaires visualisent les ateliers simultanés).
  function rendreTableau() {
    $grille.innerHTML = '';
    $bandeau.textContent = 'Ateliers du jeudi après-midi — une inscription par créneau horaire';
    const creneauDe = (a) => a.creneau || a.horaire || '';
    const creneaux = [...new Set(tousAteliers.map(creneauDe))].sort((a, b) =>
      String(a).localeCompare(String(b)),
    );
    const salles = [...new Set(tousAteliers.map((a) => a.salle || '?'))].sort((a, b) =>
      String(a).localeCompare(String(b)),
    );
    const table = document.createElement('table');
    table.className = 'tableau-ateliers';
    const entete = document.createElement('tr');
    entete.append(document.createElement('th'));
    salles.forEach((s) => {
      const th = document.createElement('th');
      th.textContent = s.length > 1 ? s : 'Salle ' + s;
      entete.append(th);
    });
    table.append(entete);
    creneaux.forEach((c) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'creneau';
      th.textContent = c;
      tr.append(th);
      salles.forEach((s) => {
        const td = document.createElement('td');
        const a = tousAteliers.find((x) => creneauDe(x) === c && (x.salle || '?') === s);
        if (a) {
          td.className = 'occupe' + (a.statut === 'tire' ? ' tire' : '');
          const nom = document.createElement('div');
          nom.className = 'nom-cellule';
          nom.textContent = a.nom || '';
          td.append(nom);
          const detail = document.createElement('div');
          detail.className = 'detail-cellule';
          detail.textContent =
            (a.horaire || '') +
            (a.statut === 'tire'
              ? ' · tirage effectué'
              : a.statut === 'ouvert'
                ? ' · inscriptions ouvertes'
                : '');
          td.append(detail);
        }
        tr.append(td);
      });
      table.append(tr);
    });
    $grille.append(table);
  }

  function rendre(nouveaux) {
    nouveaux = nouveaux || new Set();
    if (modeTableau) {
      rendreTableau();
      return;
    }
    $grille.innerHTML = '';
    $bandeau.innerHTML = '';
    if (!groupes.length) {
      $grille.innerHTML = '<div class="vide">Les ateliers seront affichés ici.</div>';
      return;
    }
    if (indexGroupe >= groupes.length) indexGroupe = 0;
    const groupe = groupes[indexGroupe];

    const titre = document.createElement('span');
    titre.textContent = groupe.horaire || 'Ateliers';
    $bandeau.append(titre);
    if (groupes.length > 1) {
      const points = document.createElement('span');
      points.className = 'points';
      groupes.forEach((g, i) => {
        const point = document.createElement('button');
        point.className = 'point' + (i === indexGroupe ? ' actif' : '');
        point.title = g.horaire;
        point.addEventListener('click', () => {
          indexGroupe = i;
          rendre();
        });
        points.append(point);
      });
      $bandeau.append(points);
    }

    groupe.ateliers.forEach((a) => $grille.append(carteAtelier(a, nouveaux.has(a.id))));
  }

  function afficher(ateliers) {
    tousAteliers = ateliers;
    ateliers.sort(
      (a, b) =>
        String(a.horaire || '').localeCompare(String(b.horaire || '')) ||
        String(a.salle || '').localeCompare(String(b.salle || '')),
    );
    const nouveaux = new Set();
    ateliers.forEach((a) => {
      if (a.statut === 'tire' && !dejaTires.has(a.id) && !premierAffichage) nouveaux.add(a.id);
      if (a.statut === 'tire') dejaTires.add(a.id);
    });
    groupes = grouper(ateliers);
    if (nouveaux.size) {
      const idx = groupes.findIndex((g) => g.ateliers.some((a) => nouveaux.has(a.id)));
      if (idx >= 0) indexGroupe = idx;
    }
    premierAffichage = false;
    rendre(nouveaux);
  }

  // Rotation automatique entre les créneaux ; ◀ ▶ au clavier pour la main.
  setInterval(() => {
    if (!modeTableau && groupes.length > 1) {
      indexGroupe = (indexGroupe + 1) % groupes.length;
      rendre();
    }
  }, 12000);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
      modeTableau = !modeTableau;
      rendre();
      return;
    }
    if (!groupes.length || modeTableau) return;
    if (e.key === 'ArrowRight') {
      indexGroupe = (indexGroupe + 1) % groupes.length;
      rendre();
    }
    if (e.key === 'ArrowLeft') {
      indexGroupe = (indexGroupe + groupes.length - 1) % groupes.length;
      rendre();
    }
  });

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
