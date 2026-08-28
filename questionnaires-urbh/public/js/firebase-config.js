// Configuration de SECOURS du projet Firebase.
//
// En temps normal, il n'y a RIEN à renseigner ici : hébergée sur Firebase
// Hosting (questionnaires-urbh.web.app), l'application récupère sa
// configuration toute seule via l'adresse réservée /__/firebase/init.js.
// Ce fichier ne sert que si le site est ouvert en dehors de cet hébergement ;
// on peut alors y recopier le bloc « firebaseConfig » (console Firebase →
// Paramètres du projet → Vos applications → Application Web).
//
// Ces valeurs ne sont pas des secrets : elles identifient le projet, et la
// sécurité repose sur les règles Firestore (fichier firestore.rules).
window.FIREBASE_CONFIG = {
  apiKey: 'A_RENSEIGNER',
  authDomain: 'questionnaires-urbh.firebaseapp.com',
  projectId: 'questionnaires-urbh',
  storageBucket: 'questionnaires-urbh.appspot.com',
  messagingSenderId: 'A_RENSEIGNER',
  appId: 'A_RENSEIGNER',
};

window.firebaseConfigEstRenseignee = function () {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && c.apiKey !== 'A_RENSEIGNER';
};
