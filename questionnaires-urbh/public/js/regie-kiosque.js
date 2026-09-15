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
    const aRepondu = (id) => questionnaires.every((q) => repondants[q.id].has(id));
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

  // Tirage équitable — même algorithme que la console d'administration :
  // priorité aux personnes non retenues ailleurs et aux établissements non
  // encore représentés, puis non retenues ailleurs, puis les autres.
  function tirerEquitable(voeux, capacite, retenusAilleurs) {
    const melange = [...voeux];
    for (let i = melange.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [melange[i], melange[j]] = [melange[j], melange[i]];
    }
    const retenus = [];
    const pris = new Set();
    const etablissementsPris = new Set();
    const cleEtab = (v) => (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;
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

  async function lancerTirageAtelier(journeeId, atelierId) {
    const snapA = await db.collection('ateliers').where('journeeId', '==', journeeId).get();
    const ateliers = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));
    const atelier = ateliers.find((x) => x.id === atelierId);
    if (!atelier) return;
    const snapV = await db.collection('voeux').where('atelierId', '==', atelierId).get();
    const voeux = snapV.docs.map((d) => d.data());
    if (!voeux.length) {
      alert('Aucun inscrit à cet atelier.');
      return;
    }
    const retenusAilleurs = new Set();
    ateliers.forEach((x) => {
      if (x.id !== atelierId) (x.retenus || []).forEach((r) => retenusAilleurs.add(r.participantId));
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
    ateliers.forEach((a) => {
      const inscrits = nbVoeux[a.id] || 0;
      const boutons = [];
      if (a.statut === 'tire') {
        boutons.push(
          bouton('🔁 Refaire', 'contour', async () => {
            if (!confirm(`Refaire le tirage de « ${a.nom} » ? Le résultat actuel sera remplacé.`)) return;
            await lancerTirageAtelier(journeeId, a.id);
          }),
        );
      } else {
        const b = bouton('🎲 Tirer', 'or', () => lancerTirageAtelier(journeeId, a.id));
        if (!inscrits) {
          b.disabled = true;
          b.title = 'Aucun inscrit';
        }
        boutons.push(b);
      }
      panneau.append(
        ligne(
          `${a.salle ? a.salle + ' — ' : ''}${a.nom || ''}`,
          `${a.horaire || ''} · ${inscrits} inscrit(s)${a.statut === 'tire' ? ' · déjà tiré' : ''}`,
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
