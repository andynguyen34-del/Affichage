// Kiosque de projection des tirages au sort (grand écran de la salle).
//
//   https://<projet>.web.app/kiosque.html          → journée « active »
//   https://<projet>.web.app/kiosque.html?e=<id>   → journée précise
//
// L'écran est branché en direct sur la vitrine publique de la journée
// (document portails/<id>, lecture publique, aucune connexion requise) :
// dès que l'administration tire un gagnant — tirage au sort ou lot de la
// tombola — il est annoncé ici avec suspense, révélation et confettis.

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
  const db = firebase.firestore();

  const $ = (id) => document.getElementById(id);
  const $nom = $('nom');

  // ------------------------------------------------------------- confettis

  const canvas = $('confettis');
  const ctx = canvas.getContext('2d');
  let particules = [];
  const COULEURS = ['#f0b23e', '#7fb3ff', '#f2f6fc', '#58d0a2', '#e8618c'];

  function redimensionner() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', redimensionner);
  redimensionner();

  function lancerConfettis() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 180; i += 1) {
      particules.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.35,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 13 - 3,
        taille: 5 + Math.random() * 7,
        angle: Math.random() * Math.PI,
        vitAngle: (Math.random() - 0.5) * 0.3,
        couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)],
        vie: 240,
      });
    }
  }

  (function animerConfettis() {
    requestAnimationFrame(animerConfettis);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!particules.length) return;
    particules.forEach((p) => {
      p.vy += 0.22;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.angle += p.vitAngle;
      p.vie -= 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.couleur;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.vie / 80));
      ctx.fillRect(-p.taille / 2, -p.taille / 3, p.taille, p.taille * 0.66);
      ctx.restore();
    });
    particules = particules.filter((p) => p.vie > 0 && p.y < canvas.height + 40);
  })();

  // ------------------------------------------- suspense (machine à lettres)

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function melangerVers(texte, duree) {
    return new Promise((resoudre) => {
      const debut = performance.now();
      const brouiller = () => {
        const avancement = Math.min(1, (performance.now() - debut) / duree);
        const nbFixes = Math.floor(texte.length * avancement);
        let affiche = '';
        for (let i = 0; i < texte.length; i += 1) {
          const c = texte[i];
          if (i < nbFixes || c === ' ' || c === '-') affiche += c;
          else affiche += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        }
        $nom.textContent = affiche;
        if (avancement < 1) requestAnimationFrame(brouiller);
        else resoudre();
      };
      brouiller();
    });
  }

  // ---------------------------------------------------- file des annonces

  let fileAnnonces = [];
  let annonceEnCours = false;

  function nomComplet(g) {
    const prenom = g.prenom || '';
    const nom = (g.nom || '').toUpperCase();
    return `${prenom} ${nom}`.trim() || 'Gagnant';
  }

  function sousTexte(g) {
    const morceaux = [];
    if (g.numeroInscription) morceaux.push(`carte n° ${g.numeroInscription}`);
    if (g.organisme) morceaux.push(g.organisme);
    return morceaux.join(' — ');
  }

  async function annoncer(annonce) {
    annonceEnCours = true;
    const g = annonce.gagnant;
    $('contexte').textContent =
      annonce.type === 'tombola' ? '🎟️ Tombola — tirage du lot' : '🎁 Tirage au sort';
    $('lot').textContent =
      annonce.type === 'tombola'
        ? `${g.lotLibelle || 'Lot'}${g.fournisseurNom ? ' — remis par ' + g.fournisseurNom : ''}`
        : '';
    $('sous-nom').textContent = '';
    $nom.classList.remove('attente', 'revele');

    const texte = nomComplet(g);
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduit) await melangerVers(texte, 2600);
    $nom.textContent = texte;
    $nom.classList.add('revele');
    $('sous-nom').textContent = sousTexte(g);
    lancerConfettis();

    // L'annonce reste affichée, puis on passe à la suivante s'il y en a une.
    await new Promise((r) => setTimeout(r, 6500));
    annonceEnCours = false;
    suivant();
  }

  function suivant() {
    if (annonceEnCours) return;
    const annonce = fileAnnonces.shift();
    if (annonce) annoncer(annonce);
  }

  // ------------------------------------------------------- écoute en direct

  let nbTirageConnus = null; // null = premier instantané (pas d'animation)
  let nbTombolaConnus = null;

  // Palmarès du bas d'écran, construit en DOM (textes passés par textContent).
  function majPalmares(portail) {
    const gagnantsT = (portail.tirage && portail.tirage.gagnants) || [];
    const gagnantsL = (portail.tombola && portail.tombola.gagnants) || [];
    $('palmares').innerHTML = '';
    [
      ...gagnantsL.map((g) => ({ g, icone: '🎟️', prefixe: g.lotLibelle ? g.lotLibelle + ' : ' : '' })),
      ...gagnantsT.map((g) => ({ g, icone: '🎁', prefixe: '' })),
    ].forEach((entree) => {
      const puce = document.createElement('span');
      puce.className = 'gagnant';
      const fort = document.createElement('strong');
      fort.textContent = nomComplet(entree.g);
      puce.append(`${entree.icone} ${entree.prefixe}`, fort);
      $('palmares').append(puce);
    });
  }

  function surPortail(portail) {
    $('titre').textContent = portail.titreCourt || portail.titre || 'URBH';
    $('surtitre').textContent = portail.date || "Journées d'études";

    const gagnantsT = (portail.tirage && portail.tirage.gagnants) || [];
    const gagnantsL = (portail.tombola && portail.tombola.gagnants) || [];

    if (nbTirageConnus === null) {
      // Premier chargement : on affiche l'existant sans le rejouer.
      nbTirageConnus = gagnantsT.length;
      nbTombolaConnus = gagnantsL.length;
    } else {
      gagnantsT.slice(nbTirageConnus).forEach((g) => fileAnnonces.push({ type: 'tirage', gagnant: g }));
      gagnantsL.slice(nbTombolaConnus).forEach((g) => fileAnnonces.push({ type: 'tombola', gagnant: g }));
      nbTirageConnus = gagnantsT.length;
      nbTombolaConnus = gagnantsL.length;
      suivant();
    }
    majPalmares(portail);
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
    } catch (_) {
      /* traité ci-dessous */
    }
    if (!journeeId) {
      $nom.textContent = "Aucune journée d'études active";
      return;
    }
    db.collection('portails')
      .doc(journeeId)
      .onSnapshot(
        (doc) => {
          if (doc.exists) surPortail(doc.data());
        },
        () => {
          $nom.textContent = 'Connexion interrompue — rechargez la page';
        },
      );
  }

  // Double-clic (ou touche F) : plein écran pour la projection.
  function basculerPleinEcran() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  document.addEventListener('dblclick', basculerPleinEcran);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') basculerPleinEcran();
  });

  demarrer();
})();
