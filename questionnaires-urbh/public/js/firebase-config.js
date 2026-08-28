// Configuration du projet Firebase de l'application.
//
// À renseigner une seule fois, lors de la mise en service :
// console Firebase → Paramètres du projet → Vos applications → Application Web,
// puis recopier ici les valeurs de « firebaseConfig ».
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
