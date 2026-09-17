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

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
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
        await event.data.ref.update({ sms: `echec-${reponse.status}` });
        return;
      }
      await event.data.ref.update({ sms: 'envoye' });
      console.log(`SMS de promotion envoyé à ${mobile} (atelier ${desistement.atelierId}).`);
    } catch (e) {
      console.error("Échec d'envoi du SMS :", e);
      await event.data.ref.update({ sms: 'echec-reseau' });
    }
  },
);

// ------------------------------------------------------------------------
// Tirage au sort automatique des ateliers à l'heure programmée.
//
// Mêmes règles que le tirage manuel (administration / régie) :
//  - une chance par numéro de carte (déduplication des sessions multiples) ;
//  - priorité à la répartition d'une même blanchisserie sur plusieurs
//    ateliers (une personne par établissement, puis marge de deux), puis
//    aux personnes non retenues ailleurs, puis aux autres ;
//  - liste d'attente dans le même ordre de priorité.

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

function tirerEquitable(voeux, capacite, retenusAilleurs) {
  const melange = [...voeux];
  for (let i = melange.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [melange[i], melange[j]] = [melange[j], melange[i]];
  }
  const retenus = [];
  const pris = new Set();
  const nbParEtab = new Map();
  const cleEtab = (v) => (v.organisme || '').trim().toLowerCase() || '~' + v.participantId;
  function passe(condition) {
    melange.forEach((v) => {
      if (retenus.length >= capacite || pris.has(v.participantId)) return;
      if (!condition(v)) return;
      retenus.push(v);
      pris.add(v.participantId);
      nbParEtab.set(cleEtab(v), (nbParEtab.get(cleEtab(v)) || 0) + 1);
    });
  }
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

  // Tirés UN PAR UN, dans l'ordre programmé : les retenus d'un atelier
  // comptent comme « retenus ailleurs » pour les suivants (équité).
  for (const atelier of dus) {
    const snapTous = await db
      .collection('ateliers')
      .where('journeeId', '==', atelier.journeeId)
      .get();
    const retenusAilleurs = new Set();
    snapTous.docs.forEach((d) => {
      if (d.id !== atelier.id) {
        (d.data().retenus || []).forEach((r) => retenusAilleurs.add(r.participantId));
      }
    });
    const snapV = await db.collection('voeux').where('atelierId', '==', atelier.id).get();
    const voeux = snapV.docs.map((d) => d.data());
    if (!voeux.length) {
      // Personne d'inscrit : on ferme simplement les inscriptions et on
      // efface la programmation pour ne pas repasser chaque minute.
      await atelier.ref.update({ statut: 'ferme', tirageAutoLe: null });
      console.log(`Atelier ${atelier.id} (« ${atelier.nom} ») : aucun inscrit, tirage annulé.`);
      continue;
    }
    const { retenus, attente } = tirerEquitable(
      dedupeParNumero(voeux),
      atelier.capacite || 20,
      retenusAilleurs,
    );
    await atelier.ref.update({
      statut: 'tire',
      retenus: retenus.map(versPublic),
      listeAttente: attente.map(versPublic),
      tireLe: admin.firestore.FieldValue.serverTimestamp(),
      tirageAutoLe: null,
    });
    console.log(
      `Tirage automatique : atelier ${atelier.id} (« ${atelier.nom} »), ` +
        `${retenus.length} retenu(s), ${attente.length} en attente.`,
    );
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

const { onDocumentWritten } = require('firebase-functions/v2/firestore');

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
