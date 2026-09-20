// Fonctions serveur des Questionnaires URBH (plan Blaze requis).
//
// smsDesistement : dès qu'un retenu libère sa place d'atelier (document créé
// dans « desistements »), un SMS est envoyé automatiquement à la personne
// promue depuis la liste d'attente, via Brevo (SMS transactionnel).
//
// tiragesAteliersAutomatiques : chaque minute, les ateliers dont l'heure de
// tirage programmée (champ « tirageAutoLe », paramétré dans
// l'administration — typiquement la fin de l'AG, jeudi 8h45) est atteinte
// sont tirés au sort automatiquement, avec EXACTEMENT les mêmes règles
// d'équité que le tirage manuel de l'administration.
//
// Mise en service (une seule fois) :
//   1. Console Firebase → projet questionnaires-urbh → passer au plan Blaze.
//   2. Compte Brevo (brevo.com) → SMS transactionnel activé → clé API v3.
//   3. Dans le dossier de l'application :
//        firebase functions:secrets:set BREVO_API_KEY
//      (coller la clé quand elle est demandée)
//   4. Double-clic sur DEPLOYER-FONCTIONS.bat.

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const BREVO_API_KEY = defineSecret('BREVO_API_KEY');

// « 06 12 34 56 78 » → « +33612345678 » (format international attendu).
function numeroInternational(brut) {
  const chiffres = String(brut || '').replace(/[^\d+]/g, '');
  if (chiffres.startsWith('+')) return chiffres;
  if (chiffres.startsWith('00')) return '+' + chiffres.slice(2);
  if (/^0\d{9}$/.test(chiffres)) return '+33' + chiffres.slice(1);
  return chiffres ? '+' + chiffres : '';
}

// Envoi d'un SMS transactionnel via Brevo. Renvoie 'envoye', 'echec-<code>'
// ou 'echec-reseau' — jamais d'exception.
async function envoyerSMS(mobile, contenu) {
  try {
    const reponse = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY.value(),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        type: 'transactional',
        unicodeEnabled: false,
        sender: 'URBH',
        recipient: mobile,
        content: contenu,
      }),
    });
    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error('Brevo a refusé le SMS :', reponse.status, detail);
      return `echec-${reponse.status}`;
    }
    return 'envoye';
  } catch (e) {
    console.error("Échec d'envoi du SMS :", e);
    return 'echec-reseau';
  }
}

exports.smsDesistement = onDocumentCreated(
  { document: 'desistements/{desistementId}', secrets: [BREVO_API_KEY] },
  async (event) => {
    const desistement = event.data ? event.data.data() : null;
    if (!desistement || !desistement.promuId) return;

    const db = admin.firestore();
    // Le mobile du promu se trouve dans son vœu d'inscription à l'atelier.
    const voeu = await db
      .collection('voeux')
      .doc(`${desistement.atelierId}_${desistement.promuId}`)
      .get();
    const mobile = numeroInternational(voeu.exists ? voeu.data().mobile : '');
    if (!mobile) {
      await event.data.ref.update({ sms: 'pas-de-mobile' });
      return;
    }

    const atelierDoc = await db.collection('ateliers').doc(desistement.atelierId).get();
    const atelier = atelierDoc.exists ? atelierDoc.data() : {};
    const contenu =
      `URBH : une place s'est liberee ! Vous etes retenu pour l'atelier ` +
      `"${atelier.nom || 'atelier'}", salle ${atelier.salle || '?'}` +
      `${atelier.horaire ? ', ' + atelier.horaire : ''}. ` +
      `Ouvrez l'application pour voir votre place (ou la liberer a votre tour).`;

    const resultat = await envoyerSMS(mobile, contenu);
    await event.data.ref.update({ sms: resultat });
    if (resultat === 'envoye') {
      console.log(`SMS de promotion envoyé à ${mobile} (atelier ${desistement.atelierId}).`);
    }
  },
);

// ------------------------------------------------------------------------
// SMS aux référents handicap.
//
// Dès qu'une personne coche « Je souhaite être accompagné(e) par le
// référent handicap URBH » sur son profil (fiche d'inscription), les
// référents handicap de l'association — jusqu'à trois numéros de mobile,
// saisis dans la console d'administration (document config/referentsHandicap,
// champ « numeros ») — reçoivent chacun un SMS avec les coordonnées de la
// personne à accompagner.

exports.smsReferentHandicap = onDocumentWritten(
  { document: 'inscriptions/{inscriptionId}', secrets: [BREVO_API_KEY] },
  async (event) => {
    const avant = event.data && event.data.before.exists ? event.data.before.data() : null;
    const apres = event.data && event.data.after.exists ? event.data.after.data() : null;
    // Seule la TRANSITION vers « demande cochée » déclenche l'envoi : pas de
    // SMS répété à chaque passage de la personne dans l'application.
    if (!apres || !apres.accompagnementHandicap) return;
    if (avant && avant.accompagnementHandicap) return;

    const db = admin.firestore();
    const config = await db.collection('config').doc('referentsHandicap').get();
    const numeros = ((config.exists && config.data().numeros) || [])
      .map(numeroInternational)
      .filter(Boolean)
      .slice(0, 3);
    if (!numeros.length) {
      console.log('Demande référent handicap reçue, mais aucun numéro de référent configuré.');
      return;
    }

    const nom = `${apres.prenom || ''} ${apres.nom || ''}`.trim() || 'Un participant';
    const contenu =
      `URBH referent handicap : ${nom}` +
      `${apres.organisme ? ' (' + apres.organisme + ')' : ''}` +
      `${apres.numeroInscription ? ', carte ' + apres.numeroInscription : ''}` +
      ` souhaite etre accompagne(e) pendant les JE.` +
      `${apres.mobile ? ' Mobile : ' + apres.mobile + '.' : ''}`;

    for (const mobile of numeros) {
      const resultat = await envoyerSMS(mobile, contenu);
      console.log(`SMS référent handicap vers ${mobile} : ${resultat}.`);
    }
  },
);

// ------------------------------------------------------------------------
// Tirage au sort automatique des ateliers à l'heure programmée.
//
// Mêmes règles que le tirage manuel (administration / régie) : tirage
// GLOBAL par vœux classés — voir tirageParVoeux ci-dessous.

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

// Tirage au sort GLOBAL par vœux classés (choix 1, 2, 3) — v66.
//
// UN SEUL ordre de tirage aléatoire sert à tous les tours (résultat unique
// et traçable), puis les tours se renouvellent « en serpentin » (l'ordre
// s'inverse à chaque tour : la malchance ne se cumule pas) jusqu'à remplir
// si possible les ateliers :
//  - phase 1 : UNE place par personne, sur son vœu le mieux classé qui a
//    encore de la place, avec la préférence à la répartition des
//    blanchisseries (1 par établissement, puis marge de 2, puis sans
//    limite) et jamais deux ateliers sur le même créneau ;
//  - phase 2 : les places encore vides sont offertes en SECONDE place aux
//    moins servis d'abord, toujours sans conflit de créneau ;
//  - listes d'attente : les inscrits non retenus de chaque atelier, par
//    rang de vœu puis ordre de tirage (promotion en cas de désistement).
//
// cibles = ateliers tirés MAINTENANT ; tousAteliers = tous ceux de la
// journée (les retenus des tirages déjà faits comptent comme des places
// acquises) ; voeuxParAtelier = { atelierId: [vœux] }.
function tirageParVoeux(cibles, tousAteliers, voeuxParAtelier) {
  const creneauDe = (a) => a.creneau || a.horaire || '';
  const cibleIds = new Set(cibles.map((a) => a.id));
  const parAtelier = {};
  cibles.forEach((a) => {
    parAtelier[a.id] = { retenus: [], attente: [] };
  });

  // Une personne = un numéro de carte (déduplication des sessions multiples).
  const clePersonne = (v) => normaliserNumero(v.numeroInscription) || '~' + v.participantId;
  const personnes = new Map();
  cibles.forEach((a) => {
    dedupeParNumero(voeuxParAtelier[a.id] || []).forEach((v) => {
      const cle = clePersonne(v);
      if (!personnes.has(cle)) {
        personnes.set(cle, { voeux: [], obtenus: new Set(), creneauxPris: new Set(), nbPlaces: 0 });
      }
      const p = personnes.get(cle);
      if (!p.voeux.some((x) => x.atelier.id === a.id)) {
        p.voeux.push({ atelier: a, voeu: v, rang: Number(v.rang) || 9 });
      }
    });
  });
  personnes.forEach((p) =>
    p.voeux.sort(
      (x, y) => x.rang - y.rang || String(x.voeu.creeLe || '').localeCompare(String(y.voeu.creeLe || '')),
    ),
  );

  // Places déjà acquises lors de tirages précédents : la personne ne
  // repasse ici qu'en phase 2, et ses créneaux sont occupés.
  tousAteliers.forEach((a) => {
    if (cibleIds.has(a.id)) return;
    (a.retenus || []).forEach((r) => {
      const p = personnes.get(clePersonne(r));
      if (p) {
        p.nbPlaces += 1;
        if (creneauDe(a)) p.creneauxPris.add(creneauDe(a));
      }
    });
  });

  // L'ordre de tirage, tiré une seule fois.
  const ordre = [...personnes.values()];
  for (let i = ordre.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  }
  const position = new Map();
  ordre.forEach((p, i) => position.set(p, i));

  const nbParEtab = new Map(); // « atelier|établissement » → retenus
  const cleEtab = (v) => (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;
  const placesRestantes = (a) => (a.capacite || 20) - parAtelier[a.id].retenus.length;

  // Attribue à la personne son vœu le mieux classé encore possible.
  function essayer(p, plafondEtab) {
    for (const chx of p.voeux) {
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

  // Phase 1 — une place par personne, en serpentin, la contrainte
  // d'établissement se relâchant à chaque tour (1, puis 2, puis libre).
  let sens = ordre;
  for (const plafond of [1, 2, 0]) {
    sens.forEach((p) => {
      if (p.nbPlaces === 0) essayer(p, plafond);
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
      if (essayer(p, 0)) attribue = true;
    }
  }

  // Listes d'attente : par rang de vœu, puis ordre de tirage.
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

exports.tiragesAteliersAutomatiques = onSchedule('every 1 minutes', async () => {
  const db = admin.firestore();
  const maintenant = admin.firestore.Timestamp.now();

  const snap = await db
    .collection('ateliers')
    .where('tirageAutoLe', '<=', maintenant)
    .get();
  const dus = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((a) => a.statut !== 'tire')
    .sort(
      (a, b) => (a.tirageAutoLe ? a.tirageAutoLe.toMillis() : 0) - (b.tirageAutoLe ? b.tirageAutoLe.toMillis() : 0),
    );
  if (!dus.length) return;

  // Tirés EN LOT, journée par journée : les vœux classés (choix 1, 2, 3)
  // de tous les ateliers dus sont arbitrés ensemble par le tirage global.
  const parJournee = {};
  dus.forEach((a) => {
    (parJournee[a.journeeId || ''] = parJournee[a.journeeId || ''] || []).push(a);
  });

  for (const journeeId of Object.keys(parJournee)) {
    const snapTous = await db
      .collection('ateliers')
      .where('journeeId', '==', journeeId)
      .get();
    const tousAteliers = snapTous.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snapV = await db.collection('voeux').where('journeeId', '==', journeeId).get();
    const voeuxParAtelier = {};
    snapV.docs.forEach((d) => {
      const v = d.data();
      (voeuxParAtelier[v.atelierId] = voeuxParAtelier[v.atelierId] || []).push(v);
    });

    const lot = parJournee[journeeId];
    // Personne d'inscrit : on ferme simplement les inscriptions et on
    // efface la programmation pour ne pas repasser chaque minute.
    const sansInscrit = lot.filter((a) => !(voeuxParAtelier[a.id] || []).length);
    for (const atelier of sansInscrit) {
      await atelier.ref.update({ statut: 'ferme', tirageAutoLe: null });
      console.log(`Atelier ${atelier.id} (« ${atelier.nom} ») : aucun inscrit, tirage annulé.`);
    }

    const cibles = lot.filter((a) => (voeuxParAtelier[a.id] || []).length);
    if (!cibles.length) continue;
    const resultat = tirageParVoeux(cibles, tousAteliers, voeuxParAtelier);
    for (const atelier of cibles) {
      const r = resultat[atelier.id];
      await atelier.ref.update({
        statut: 'tire',
        retenus: r.retenus.map(versPublic),
        listeAttente: r.attente.map(versPublic),
        tireLe: admin.firestore.FieldValue.serverTimestamp(),
        tirageAutoLe: null,
      });
      console.log(
        `Tirage automatique : atelier ${atelier.id} (« ${atelier.nom} »), ` +
          `${r.retenus.length} retenu(s), ${r.attente.length} en attente.`,
      );
    }
  }
});

// ------------------------------------------------------------------------
// Reprise d'identité par le numéro de carte.
//
// L'identité d'un participant est la session anonyme de son navigateur : en
// changeant d'appareil, en purgeant Safari, ou en installant l'application
// sur l'écran d'accueil d'un iPhone (conteneur de stockage séparé), il
// repart avec une NOUVELLE session. Sa fiche d'inscription (identifiée par
// le n° de carte) est bien reprise, mais ses vœux, pointages, réponses,
// participations et visites restaient accrochés à l'ancienne session.
//
// Dès que la fiche d'inscription change de session (participantId), cette
// fonction rattache TOUT l'historique de l'ancienne session à la nouvelle.

exports.repriseIdentite = onDocumentWritten('inscriptions/{inscriptionId}', async (event) => {
  const avant = event.data && event.data.before.exists ? event.data.before.data() : null;
  const apres = event.data && event.data.after.exists ? event.data.after.data() : null;
  if (!avant || !apres) return;
  const ancienUid = avant.participantId;
  const nouveauUid = apres.participantId;
  if (!ancienUid || !nouveauUid || ancienUid === nouveauUid) return;

  const db = admin.firestore();
  console.log(
    `Reprise d'identité : ${apres.numeroInscription || event.params.inscriptionId} ` +
      `passe de ${ancienUid} à ${nouveauUid}.`,
  );

  // Documents à identifiant composé « <cible>_<uid> » : recréés sous la
  // nouvelle session (sauf s'ils y existent déjà), puis anciens supprimés.
  const COMPOSES = [
    ['tirage', (d) => `${d.journeeId}_`],
    ['pointages', (d) => `${d.journeeId}_${d.moment}_`],
    ['voeux', (d) => `${d.atelierId}_`],
    ['reponses', (d) => `${d.questionnaireId}_`],
    ['visites', (d) => `${d.fournisseurId}_`],
    ['evaluationsDirect', (d) => `${d.questionId}_`],
    ['desistements', (d) => `${d.atelierId}_`],
  ];
  for (const [collection, prefixe] of COMPOSES) {
    const snap = await db.collection(collection).where('participantId', '==', ancienUid).get();
    for (const doc of snap.docs) {
      const donnees = doc.data();
      const nouvelId = prefixe(donnees) + nouveauUid;
      const cibleRef = db.collection(collection).doc(nouvelId);
      const cible = await cibleRef.get();
      if (!cible.exists) {
        await cibleRef.set({ ...donnees, participantId: nouveauUid });
      }
      await doc.ref.delete();
    }
  }

  // Désistements où l'ancienne session apparaît comme promue.
  const snapPromu = await db.collection('desistements').where('promuId', '==', ancienUid).get();
  for (const doc of snapPromu.docs) {
    await doc.ref.update({ promuId: nouveauUid });
  }

  // Listes des ateliers (retenus, liste d'attente).
  const snapAteliers = await db
    .collection('ateliers')
    .where('journeeId', '==', apres.journeeId || '')
    .get();
  for (const doc of snapAteliers.docs) {
    const a = doc.data();
    const remap = (liste) =>
      (liste || []).map((r) =>
        r.participantId === ancienUid ? { ...r, participantId: nouveauUid } : r,
      );
    const concerne = (liste) => (liste || []).some((r) => r.participantId === ancienUid);
    if (concerne(a.retenus) || concerne(a.listeAttente)) {
      await doc.ref.update({
        retenus: remap(a.retenus),
        listeAttente: remap(a.listeAttente),
      });
    }
  }

  // Gagnants annoncés (tirage au sort et tombola) sur la vitrine publique.
  if (apres.journeeId) {
    const refPortail = db.collection('portails').doc(apres.journeeId);
    const portail = await refPortail.get();
    if (portail.exists) {
      const p = portail.data();
      const remap = (liste) =>
        (liste || []).map((g) =>
          g.participantId === ancienUid ? { ...g, participantId: nouveauUid } : g,
        );
      const concerne = (liste) => (liste || []).some((g) => g.participantId === ancienUid);
      const maj = {};
      if (p.tirage && concerne(p.tirage.gagnants)) maj['tirage.gagnants'] = remap(p.tirage.gagnants);
      if (p.tombola && concerne(p.tombola.gagnants)) maj['tombola.gagnants'] = remap(p.tombola.gagnants);
      if (Object.keys(maj).length) await refPortail.update(maj);
    }
  }

  // Ancien profil d'appareil : supprimé (le nouveau vient d'être écrit).
  try {
    await db.collection('participants').doc(ancienUid).delete();
  } catch (_) {
    /* déjà absent */
  }
  console.log(`Reprise d'identité terminée pour ${nouveauUid}.`);
});
