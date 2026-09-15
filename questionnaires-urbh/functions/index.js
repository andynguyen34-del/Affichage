// Fonctions serveur des Questionnaires URBH (plan Blaze requis).
//
// smsDesistement : dès qu'un retenu libère sa place d'atelier (document créé
// dans « desistements »), un SMS est envoyé automatiquement à la personne
// promue depuis la liste d'attente, via Brevo (SMS transactionnel).
//
// Mise en service (une seule fois) :
//   1. Console Firebase → projet questionnaires-urbh → passer au plan Blaze.
//   2. Compte Brevo (brevo.com) → SMS transactionnel activé → clé API v3.
//   3. Dans le dossier de l'application :
//        firebase functions:secrets:set BREVO_API_KEY
//      (coller la clé quand elle est demandée)
//   4. Double-clic sur DEPLOYER-FONCTIONS.bat.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
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
