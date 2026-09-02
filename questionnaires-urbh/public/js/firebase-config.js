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
  apiKey: 'AIzaSyC42TBqpPkRNCxObbordeisc9UPzX6irA4',
  authDomain: 'questionnaires-urbh.firebaseapp.com',
  projectId: 'questionnaires-urbh',
  storageBucket: 'questionnaires-urbh.firebasestorage.app',
  messagingSenderId: '446021992730',
  appId: '1:446021992730:web:a691020b8628be2339eca3',
};

// Numéro de version de l'application, affiché en pied de page : permet de
// vérifier que le site déployé correspond bien à la dernière livraison.
window.APP_BUILD = 8;

window.firebaseConfigEstRenseignee = function () {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && c.apiKey !== 'A_RENSEIGNER';
};
