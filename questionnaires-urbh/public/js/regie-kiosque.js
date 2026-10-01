// Régie des kiosques : boutons de déclenchement des tirages DIRECTEMENT sur
// l'écran de projection, pour animer les tirages en direct en amphithéâtre
// sans jongler avec la console d'administration.
//
// Activation : ajouter « ?regie=1 » à l'adresse du kiosque —
//   kiosque.html?regie=1            → tirage au sort + lots de la tombola
//   kiosque-ateliers.html?regie=1   → tirages au sort des ateliers
// (cumulable avec la journée : kiosque.html?e=<id>&regie=1)
//
// Une pastille 🎛 discrète apparaît en bas à gauche. Le premier clic demande
// la connexion ADMINISTRATEUR (même e-mail / mot de passe que la console) :
// les règles de sécurité Firestore n'autorisent que les admins à écrire les
// résultats — sans cette connexion, les boutons ne peuvent rien tirer.
//
// La régie applique EXACTEMENT les mêmes règles d'éligibilité que la console
// d'administration (une chance par n° de carte, conditions de la tombola,
// tirage équitable des ateliers), recalculées sur données fraîches à chaque
// clic. Le kiosque, branché en direct sur la base, enchaîne l'animation.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.get('regie') !== '1') return;
  if (!window.firebase || !firebase.apps) return;

  const modeAteliers = /kiosque-ateliers/.test(location.pathname);

  // L'initialisation Firebase est faite par le script du kiosque lui-même.
  const pret = () => firebase.apps.length && firebase.auth && firebase.firestore;
  if (!pret()) return;
  const auth = firebase.auth();
  const db = firebase.firestore();

  // ----------------------------------------------------------- utilitaires
  // (mêmes règles que la console d'administration — admin.js)

  function normaliserNumero(brut) {
    return String(brut == null ? '' : brut)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\//g, '-');
  }

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

  function auHasard(liste) {
    return liste[Math.floor(Math.random() * liste.length)];
  }

  // ------------------------------------------------------------- apparence

  const style = document.createElement('style');
  style.textContent = `
    #regie-pastille {
      position: fixed; left: 0.8rem; bottom: 0.6rem; z-index: 60;
      background: rgba(11, 28, 51, 0.75); color: #f2f6fc;
      border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 999px;
      padding: 0.35rem 0.85rem; font: 600 0.85rem 'Archivo', system-ui, sans-serif;
      cursor: pointer; opacity: 0.35; transition: opacity 0.2s;
    }
    #regie-pastille:hover, #regie-pastille.ouvert { opacity: 1; }
    #regie-panneau {
      position: fixed; left: 0.8rem; bottom: 3rem; z-index: 60;
      width: min(430px, calc(100vw - 1.6rem)); max-height: 70vh; overflow: auto;
      background: rgba(11, 28, 51, 0.96); color: #f2f6fc;
      border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 14px;
      padding: 1rem 1.1rem; font: 0.9rem/1.4 'Archivo', system-ui, sans-serif;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    #regie-panneau h3 {
      margin: 0.9rem 0 0.4rem; font-size: 0.78rem; text-transform: uppercase;
      letter-spacing: 0.14em; color: #7fb3ff;
    }
    #regie-panneau h3:first-child { margin-top: 0; }
    #regie-panneau .regie-ligne {
      display: flex; align-items: center; gap: 0.6rem; margin: 0.35rem 0;
    }
    #regie-panneau .regie-ligne .info { flex: 1; min-width: 0; }
    #regie-panneau .regie-ligne .info .qui { color: #f0b23e; font-weight: 700; }
    #regie-panneau .regie-ligne .info .detail { opacity: 0.65; font-size: 0.8rem; }
    #regie-panneau button {
      font: 600 0.85rem 'Archivo', system-ui, sans-serif; cursor: pointer;
      border-radius: 9px; border: 1px solid transparent;
      padding: 0.45rem 0.75rem; white-space: nowrap;
    }
    #regie-panneau button.or { background: #f0b23e; color: #0b1c33; }
    #regie-panneau button.contour {
      background: transparent; color: #f2f6fc;
      border-color: rgba(255, 255, 255, 0.35);
    }
    #regie-panneau button:disabled { opacity: 0.45; cursor: default; }
    #regie-panneau input {
      width: 100%; box-sizing: border-box; margin: 0.25rem 0 0.6rem;
      padding: 0.5rem 0.6rem; border-radius: 9px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.08); color: #f2f6fc; font-size: 0.9rem;
    }
    #regie-panneau .regie-erreur { color: #ff9d9d; font-size: 0.82rem; margin: 0.4rem 0; }
    #regie-panneau .regie-muet { opacity: 0.6; font-size: 0.82rem; }
  `;
  document.head.append(style);

  const pastille = document.createElement('button');
  pastille.id = 'regie-pastille';
  pastille.textContent = '🎛 Régie';
  document.body.append(pastille);

  const panneau = document.createElement('div');
  panneau.id = 'regie-panneau';
  panneau.hidden = true;
  document.body.append(panneau);

  pastille.addEventListener('click', () => {
    panneau.hidden = !panneau.hidden;
    pastille.classList.toggle('ouvert', !panneau.hidden);
    if (!panneau.hidden) rafraichir();
  });

  function ligne(texteQui, texteDetail, boutons) {
    const l = document.createElement('div');
    l.className = 'regie-ligne';
    const info = document.createElement('div');
    info.className = 'info';
    const qui = document.createElement('div');
    qui.className = 'qui';
    qui.textContent = texteQui;
    info.append(qui);
    if (texteDetail) {
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = texteDetail;
      info.append(detail);
    }
    l.append(info, ...(boutons || []));
    return l;
  }

  function bouton(libelle, classe, action) {
    const b = document.createElement('button');
    b.className = classe;
    b.textContent = libelle;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await action();
        await rafraichir();
      } catch (e) {
        alert(
          'Action refusée — ' +
            (e && e.code === 'permission-denied'
              ? 'ce compte n’est pas administrateur (ou les règles déployées sont en retard).'
              : (e && e.message) || 'erreur inconnue') ,
        );
        b.disabled = false;
      }
    });
    return b;
  }

  function titreSection(texte) {
    const h = document.createElement('h3');
    h.textContent = texte;
    return h;
  }

  function muet(texte) {
    const p = document.createElement('div');
    p.className = 'regie-muet';
    p.textContent = texte;
    return p;
  }

  // ------------------------------------------------------------ la journée

  async function trouverJournee() {
    const demande = params.get('e');
    if (demande && /^[A-Za-z0-9_-]+$/.test(demande)) return demande;
    const snap = await db.collection('portails').where('actif', '==', true).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
  }

  // ------------------------------------------------------------- connexion

  function vueConnexion(erreur) {
    panneau.innerHTML = '';
    panneau.append(titreSection('Régie — connexion administrateur'));
    const explication = muet(
      'Les tirages ne peuvent être déclenchés que par un administrateur ' +
        '(même e-mail / mot de passe que la console d’administration).',
    );
    panneau.append(explication);
    const champEmail = document.createElement('input');
    champEmail.type = 'email';
    champEmail.placeholder = 'E-mail administrateur';
    champEmail.autocomplete = 'username';
    const champMdp = document.createElement('input');
    champMdp.type = 'password';
    champMdp.placeholder = 'Mot de passe';
    champMdp.autocomplete = 'current-password';
    panneau.append(champEmail, champMdp);
    if (erreur) {
      const div = document.createElement('div');
      div.className = 'regie-erreur';
      div.textContent = erreur;
      panneau.append(div);
    }
    const valider = document.createElement('button');
    valider.className = 'or';
    valider.textContent = 'Se connecter';
    valider.addEventListener('click', async () => {
      valider.disabled = true;
      try {
        await auth.signInWithEmailAndPassword(champEmail.value.trim(), champMdp.value);
        await rafraichir();
      } catch (_) {
        vueConnexion('Connexion refusée : vérifiez l’e-mail et le mot de passe.');
      }
    });
    champMdp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') valider.click();
    });
    panneau.append(valider);
  }

  async function estAdmin(user) {
    if (!user || !user.email) return false;
    try {
      const doc = await db.collection('config').doc('admins').get();
      return ((doc.data() || {}).emails || []).includes(user.email);
    } catch (_) {
      return false;
    }
  }

  // -------------------------------------- éligibilité tombola (comme admin)

  async function candidatsTombolaFrais(journeeId, portail) {
    const snapPt = await db.collection('pointages').where('journeeId', '==', journeeId).get();
    const pointages = snapPt.docs.map((d) => d.data());
    const parMoment = { ouverture: new Set(), ag: new Set(), tombola: new Set() };
    pointages.forEach((p) => {
      if (parMoment[p.moment]) parMoment[p.moment].add(p.participantId);
    });
    const snapQ = await db.collection('questionnaires').where('journeeId', '==', journeeId).get();
    const questionnaires = snapQ.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (q) =>
          q.statut === 'ouvert' &&
          (!q.audience || q.audience === 'tous' || q.audience === 'visiteur'),
      );
    const repondants = {};
    for (const q of questionnaires) {
      const snapR = await db.collection('reponses').where('questionnaireId', '==', q.id).get();
      repondants[q.id] = new Set(snapR.docs.map((d) => d.data().participantId));
    }
    // Questionnaires d'atelier : exigés seulement des retenus (même règle
    // que l'administration).
    const retenusParQuestionnaire = {};
    if (questionnaires.some((q) => q.reserveAtelier)) {
      const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
      const ateliers = snapA.docs.map((d) => d.data());
      questionnaires.forEach((q) => {
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
    }
    const aRepondu = (id) =>
      questionnaires.every((q) => {
        if (q.reserveAtelier && !retenusParQuestionnaire[q.id].has(id)) return true;
        return repondants[q.id].has(id);
      });
    const exclusCA = new Set(
      ((portail.tombola && portail.tombola.exclusCA) || []).map(normaliserNumero),
    );
    return dedupeParNumero(
      pointages.filter(
        (p) =>
          p.moment === 'tombola' &&
          p.type === 'visiteur' &&
          p.nom !== 'Anonymisé' &&
          !exclusCA.has(normaliserNumero(p.numeroInscription)) &&
          parMoment.ouverture.has(p.participantId) &&
          parMoment.ag.has(p.participantId) &&
          aRepondu(p.participantId),
      ),
    );
  }

  function sansDejaGagnants(candidats, gagnants) {
    const dejaIds = new Set(gagnants.map((g) => g.participantId));
    const dejaNumeros = new Set(
      gagnants.map((g) => normaliserNumero(g.numeroInscription)).filter(Boolean),
    );
    return candidats.filter(
      (c) => !dejaIds.has(c.participantId) && !dejaNumeros.has(normaliserNumero(c.numeroInscription)),
    );
  }

  function versGagnantTombola(lotIndex, lot, elu) {
    return {
      lotIndex,
      lotLibelle: lot.libelle,
      fournisseurNom: lot.fournisseurNom || '',
      participantId: elu.participantId,
      prenom: elu.prenom || '',
      nom: elu.nom || '',
      organisme: elu.organisme || '',
      mobile: elu.mobile || '',
      numeroInscription: elu.numeroInscription || '',
    };
  }

  // ------------------------------------------ panneau « tirages & tombola »

  async function vueTirages(journeeId) {
    const refPortail = db.collection('portails').doc(journeeId);
    const doc = await refPortail.get();
    const portail = doc.data() || {};
    const lots = (portail.tombola && portail.tombola.lots) || [];
    const gagnantsL = (portail.tombola && portail.tombola.gagnants) || [];
    const gagnantsT = (portail.tirage && portail.tirage.gagnants) || [];

    panneau.innerHTML = '';
    panneau.append(titreSection('🎟️ Tombola — lots'));
    if (!lots.length) {
      panneau.append(muet('Aucun lot défini (carte Tombola de l’administration).'));
    }
    lots.forEach((lot, i) => {
      const actif = gagnantsL.find((g) => g.lotIndex === i && !g.raye);
      if (!actif) {
        panneau.append(
          ligne(lot.libelle, lot.fournisseurNom ? 'remis par ' + lot.fournisseurNom : '', [
            bouton('🎲 Tirer', 'or', async () => {
              const frais = (await refPortail.get()).data() || {};
              const dejaL = (frais.tombola && frais.tombola.gagnants) || [];
              if (dejaL.some((g) => g.lotIndex === i && !g.raye)) return; // déjà tiré ailleurs
              const candidats = sansDejaGagnants(
                await candidatsTombolaFrais(journeeId, frais),
                dejaL,
              );
              if (!candidats.length) {
                alert('Aucun participant éligible restant (présence en salle + AG + ouverture + questionnaires, visiteurs hors CA).');
                return;
              }
              await refPortail.update({
                'tombola.gagnants': [...dejaL, versGagnantTombola(i, lot, auHasard(candidats))],
              });
            }),
          ]),
        );
      } else {
        panneau.append(
          ligne(
            `${actif.prenom || ''} ${actif.nom || ''}`.trim(),
            `${lot.libelle}${actif.numeroInscription ? ' — carte ' + actif.numeroInscription : ''}`,
            [
              bouton('🚫 Absent : remplacer', 'contour', async () => {
                if (
                  !confirm(
                    `Rayer ${actif.prenom} ${actif.nom} (absent de la salle) et tirer immédiatement un remplaçant ?`,
                  )
                ) {
                  return;
                }
                const frais = (await refPortail.get()).data() || {};
                const dejaL = (frais.tombola && frais.tombola.gagnants) || [];
                const cible = dejaL.find(
                  (g) => g.lotIndex === i && !g.raye && g.participantId === actif.participantId,
                );
                if (!cible) return;
                const nouveaux = dejaL.map((g) => (g === cible ? { ...g, raye: true } : g));
                const candidats = sansDejaGagnants(
                  await candidatsTombolaFrais(journeeId, frais),
                  nouveaux,
                );
                if (candidats.length) {
                  nouveaux.push(versGagnantTombola(i, lot, auHasard(candidats)));
                } else {
                  alert('Gagnant rayé — plus aucun éligible pour le remplacer.');
                }
                await refPortail.update({ 'tombola.gagnants': nouveaux });
              }),
            ],
          ),
        );
      }
    });

    panneau.append(titreSection('🎁 Tirage au sort'));
    if (gagnantsT.length) {
      panneau.append(muet(`${gagnantsT.length} gagnant(s) déjà tiré(s).`));
    }
    panneau.append(
      ligne('Tirage au sort général', 'parmi les participations enregistrées', [
        bouton('🎲 Tirer un gagnant', 'or', async () => {
          const frais = (await refPortail.get()).data() || {};
          const dejaT = (frais.tirage && frais.tirage.gagnants) || [];
          const snap = await db.collection('tirage').where('journeeId', '==', journeeId).get();
          const candidats = sansDejaGagnants(
            dedupeParNumero(snap.docs.map((d) => d.data())),
            dejaT,
          );
          if (!candidats.length) {
            alert('Aucune participation restante au tirage au sort.');
            return;
          }
          const elu = auHasard(candidats);
          await refPortail.update({
            'tirage.gagnants': [
              ...dejaT,
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
        }),
      ]),
    );
    panneau.append(
      muet('Le kiosque annonce chaque tirage automatiquement (suspense + confettis). ' +
        'Annulations et réglages fins : console d’administration.'),
    );
  }

  // ------------------------------------------------- panneau « ateliers »

  // Tirage au sort GLOBAL par vœux classés (choix 1, 2, 3) — MÊME
  // algorithme que la console d'administration et que le tirage automatique
  // serveur (functions/index.js) : un seul ordre de tirage aléatoire, tours
  // en serpentin, une place par personne d'abord (répartition des
  // blanchisseries : 1 par établissement, puis marge de 2, puis libre, et
  // jamais deux ateliers sur le même créneau), puis les places restantes en
  // seconde place aux moins servis ; listes d'attente par rang de vœu puis
  // ordre de tirage.
  function tirageParVoeux(cibles, tousAteliers, voeuxParAtelier) {
    const creneauDe = (a) => a.creneau || a.horaire || '';
    // Deux classements indépendants : salles B/C/D = ateliers URBH,
    // le reste = ateliers des partenaires techniques.
    const groupeDe = (a) =>
      ['B', 'C', 'D'].includes(String(a.salle || '').trim().toUpperCase())
        ? 'urbh'
        : 'partenaires';
    const cibleIds = new Set(cibles.map((a) => a.id));
    const parAtelier = {};
    cibles.forEach((a) => {
      parAtelier[a.id] = { retenus: [], attente: [] };
    });

    const clePersonne = (v) => normaliserNumero(v.numeroInscription) || '~' + v.participantId;
    const personnes = new Map();
    cibles.forEach((a) => {
      dedupeParNumero(voeuxParAtelier[a.id] || []).forEach((v) => {
        const cle = clePersonne(v);
        if (!personnes.has(cle)) {
          personnes.set(cle, { voeux: [], obtenus: new Set(), creneauxPris: new Set(), servisGroupes: new Set(), nbPlaces: 0 });
        }
        const p = personnes.get(cle);
        if (!p.voeux.some((x) => x.atelier.id === a.id)) {
          p.voeux.push({ atelier: a, voeu: v, rang: Number(v.rang) || 9 });
        }
      });
    });
    personnes.forEach((p) =>
      p.voeux.sort(
        (x, y) =>
          x.rang - y.rang || String(x.voeu.creeLe || '').localeCompare(String(y.voeu.creeLe || '')),
      ),
    );

    tousAteliers.forEach((a) => {
      if (cibleIds.has(a.id)) return;
      (a.retenus || []).forEach((r) => {
        const p = personnes.get(clePersonne(r));
        if (p) {
          p.nbPlaces += 1;
          if (creneauDe(a)) p.creneauxPris.add(creneauDe(a));
          p.servisGroupes.add(groupeDe(a));
        }
      });
    });

    const ordre = [...personnes.values()];
    for (let i = ordre.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    }
    const position = new Map();
    ordre.forEach((p, i) => position.set(p, i));

    const nbParEtab = new Map();
    const cleEtab = (v) => (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;
    const placesRestantes = (a) => (a.capacite || 20) - parAtelier[a.id].retenus.length;

    function essayer(p, liste, plafondEtab) {
      for (const chx of liste) {
        const a = chx.atelier;
        if (p.obtenus.has(a.id) || placesRestantes(a) <= 0) continue;
        if (creneauDe(a) && p.creneauxPris.has(creneauDe(a))) continue;
        const kEtab = a.id + '|' + cleEtab(chx.voeu);
        if (plafondEtab && (nbParEtab.get(kEtab) || 0) >= plafondEtab) continue;
        parAtelier[a.id].retenus.push(chx.voeu);
        p.obtenus.add(a.id);
        p.nbPlaces += 1;
        if (creneauDe(a)) p.creneauxPris.add(creneauDe(a));
        nbParEtab.set(kEtab, (nbParEtab.get(kEtab) || 0) + 1);
        return true;
      }
      return false;
    }

    // Les DEUX classements sont arbitrés l'un après l'autre (ateliers URBH
    // puis partenaires techniques), en partageant créneaux occupés et
    // places déjà reçues.
    for (const groupe of ['urbh', 'partenaires']) {
      const listeDe = (p) => p.voeux.filter((x) => groupeDe(x.atelier) === groupe);
      // Phase 1 — une place par personne DANS CE GROUPE, en serpentin, la
      // contrainte d'établissement se relâchant (1, puis 2, puis libre).
      const servis = new Set();
      let sens = ordre;
      for (const plafond of [1, 2, 0]) {
        sens.forEach((p) => {
          if (!servis.has(p) && !p.servisGroupes.has(groupe) && essayer(p, listeDe(p), plafond)) {
            servis.add(p);
          }
        });
        sens = [...sens].reverse();
      }
      // Phase 2 — remplir les places restantes : tours supplémentaires, une
      // place de plus par tour et par personne, les moins servis d'abord.
      let attribue = true;
      while (attribue) {
        attribue = false;
        const parNbPlaces = [...ordre].sort(
          (a, b) => a.nbPlaces - b.nbPlaces || position.get(a) - position.get(b),
        );
        for (const p of parNbPlaces) {
          if (essayer(p, listeDe(p), 0)) attribue = true;
        }
      }
    }

    cibles.forEach((a) => {
      const candidats = [];
      personnes.forEach((p) => {
        const chx = p.voeux.find((x) => x.atelier.id === a.id);
        if (chx && !p.obtenus.has(a.id)) candidats.push({ p, chx });
      });
      candidats.sort(
        (x, y) => x.chx.rang - y.chx.rang || position.get(x.p) - position.get(y.p),
      );
      parAtelier[a.id].attente = candidats.map((c) => c.chx.voeu);
    });

    return parAtelier;
  }

  function versPublic(v) {
    return {
      participantId: v.participantId,
      prenom: v.prenom || '',
      nom: v.nom || '',
      organisme: v.organisme || '',
      numeroInscription: v.numeroInscription || '',
      type: v.type || '',
      rang: Number(v.rang) || 0,
    };
  }

  async function lancerTirageAteliers(journeeId, atelierIds) {
    const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
    const ateliers = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snapV = await db.collection('voeux').where('journeeId', '==', journeeId).get();
    const voeuxParAtelier = {};
    snapV.docs.forEach((d) => {
      const v = d.data();
      (voeuxParAtelier[v.atelierId] = voeuxParAtelier[v.atelierId] || []).push(v);
    });
    const cibles = ateliers.filter(
      (a) => atelierIds.includes(a.id) && (voeuxParAtelier[a.id] || []).length,
    );
    if (!cibles.length) {
      alert('Aucun inscrit sur les ateliers à tirer.');
      return;
    }
    const resultat = tirageParVoeux(cibles, ateliers, voeuxParAtelier);
    for (const a of cibles) {
      const r = resultat[a.id];
      await db.collection('ateliers').doc(a.id).update({
        statut: 'tire',
        retenus: r.retenus.map(versPublic),
        listeAttente: r.attente.map(versPublic),
        tireLe: firebase.firestore.FieldValue.serverTimestamp(),
        tirageAutoLe: null,
      });
    }
  }

  async function vueAteliers(journeeId) {
    const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
    const ateliers = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));
    ateliers.sort(
      (a, b) =>
        String(a.horaire || '').localeCompare(String(b.horaire || '')) ||
        String(a.salle || '').localeCompare(String(b.salle || '')),
    );
    // Nombre d'inscrits par atelier (une chance par n° de carte).
    const snapV = await db.collection('voeux').where('journeeId', '==', journeeId).get();
    const nbVoeux = {};
    const parAtelier = {};
    snapV.docs.forEach((d) => {
      const v = d.data();
      (parAtelier[v.atelierId] = parAtelier[v.atelierId] || []).push(v);
    });
    Object.keys(parAtelier).forEach((id) => {
      nbVoeux[id] = dedupeParNumero(parAtelier[id]).length;
    });

    panneau.innerHTML = '';
    panneau.append(titreSection('🎲 Tirages des ateliers'));
    if (!ateliers.length) panneau.append(muet('Aucun atelier pour cette journée.'));
    const idsRestants = ateliers.filter((a) => a.statut !== 'tire').map((a) => a.id);
    if (idsRestants.length) {
      panneau.append(
        ligne(
          'Tirage général (vœux classés)',
          `les ${idsRestants.length} atelier(s) non tirés, arbitrés ensemble — recommandé`,
          [
            bouton('🎲 Tirer tous les ateliers restants', 'or', async () => {
              if (
                !confirm(
                  `Tirer au sort maintenant les ${idsRestants.length} atelier(s) restants ? ` +
                    'Les vœux classés (choix 1, 2, 3) sont arbitrés ensemble.',
                )
              ) {
                return;
              }
              await lancerTirageAteliers(journeeId, idsRestants);
            }),
          ],
        ),
      );
    }
    ateliers.forEach((a) => {
      const inscrits = nbVoeux[a.id] || 0;
      const boutons = [];
      if (a.statut === 'tire') {
        boutons.push(
          bouton('🔁 Refaire', 'contour', async () => {
            if (!confirm(`Refaire le tirage de « ${a.nom} » ? Le résultat actuel sera remplacé.`)) return;
            await lancerTirageAteliers(journeeId, [a.id]);
          }),
        );
      } else {
        // Ouverture / fermeture des inscriptions, atelier par atelier —
        // même commande que la carte Ateliers de l'administration.
        boutons.push(
          bouton(a.statut === 'ouvert' ? '⛔ Fermer' : '✅ Ouvrir', 'contour', async () => {
            await db
              .collection('ateliers')
              .doc(a.id)
              .update({ statut: a.statut === 'ouvert' ? 'ferme' : 'ouvert' });
          }),
        );
        const b = bouton('🎲 Tirer', 'or', () => lancerTirageAteliers(journeeId, [a.id]));
        if (!inscrits) {
          b.disabled = true;
          b.title = 'Aucun inscrit';
        }
        boutons.push(b);
      }
      panneau.append(
        ligne(
          `${a.salle ? a.salle + ' — ' : ''}${a.nom || ''}`,
          `${a.horaire || ''} · ${inscrits} inscrit(s)` +
            (a.statut === 'tire'
              ? ' · déjà tiré'
              : a.statut === 'ouvert'
                ? ' · inscriptions ouvertes'
                : ' · inscriptions fermées') +
            (a.tirageAutoLe && a.statut !== 'tire'
              ? ` · 🕗 tirage auto ${a.tirageAutoLe.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : ''),
          boutons,
        ),
      );
    });
    panneau.append(
      muet('Le kiosque affiche la liste des retenus dès le tirage. ' +
        'Réglages fins : console d’administration.'),
    );
  }

  // -------------------------------------------------------------- assemblage

  let journeeId = null;

  async function rafraichir() {
    if (panneau.hidden) return;
    const user = auth.currentUser;
    if (!user || !user.email) {
      vueConnexion();
      return;
    }
    panneau.innerHTML = '';
    panneau.append(muet('Chargement…'));
    if (!(await estAdmin(user))) {
      vueConnexion('Ce compte n’est pas dans la liste des administrateurs.');
      return;
    }
    try {
      if (!journeeId) journeeId = await trouverJournee();
      if (!journeeId) {
        panneau.innerHTML = '';
        panneau.append(muet('Aucune journée d’études active.'));
        return;
      }
      if (modeAteliers) await vueAteliers(journeeId);
      else await vueTirages(journeeId);
    } catch (e) {
      panneau.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'regie-erreur';
      div.textContent = 'Chargement impossible : ' + ((e && e.message) || 'erreur inconnue');
      panneau.append(div);
    }
  }
})();
