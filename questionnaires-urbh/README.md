# Questionnaires URBH

Application de gestion des questionnaires de satisfaction des journées
d'études de l'URBH, conçue pour répondre aux exigences de la certification
**Qualiopi** des organismes de formation.

Application autonome, hébergée sur **Firebase** (Hosting + Firestore + Auth),
sans serveur à maintenir : un site statique et une base de données gérée.

## Ce que fait l'application

**Journées d'études.** Vous déclarez chaque journée (titre, date, lieu,
nombre de participants attendus). Le nombre d'attendus sert au calcul du taux
de réponse, demandé lors des audits.

**Questionnaires.** Pour chaque journée, vous créez un questionnaire à partir
d'un modèle prêt à l'emploi :

- *Évaluation à chaud* — remise en fin de journée : organisation, contenu,
  intervenants, appréciation globale (note /10, recommandation), remarques
  libres ;
- *Évaluation à froid* — quelques mois après : mise en pratique, utilité
  perçue, besoins complémentaires ;
- *Questionnaire vierge* — à composer librement.

Les questions sont modifiables (intitulé, type de réponse, section, caractère
obligatoire, ordre) tant qu'aucune réponse n'a été collectée ; ensuite la
structure est verrouillée pour garantir la cohérence des résultats.

**Collecte.** Un questionnaire *ouvert* est accessible par un simple lien et
un **QR code** à projeter en fin de journée ou à envoyer par e-mail. Les
réponses sont **anonymes** ; un garde-fou local évite les doubles envois
depuis un même appareil. La clôture du questionnaire arrête la collecte.

**Résultats.** Nombre de réponses, taux de réponse, taux de satisfaction
global, note moyenne, taux de recommandation, détail question par question
(répartitions en barres), verbatims. Deux sorties : **export CSV** (Excel
français : séparateur point-virgule, accents corrects) et **bilan
imprimable** (bouton « Imprimer le bilan », vers papier ou PDF).

**Amélioration continue.** Chaque journée porte sa liste d'« actions
d'amélioration » (à faire / réalisée), alimentée à partir des retours des
participants.

## Correspondance Qualiopi

| Exigence | Réponse de l'application |
| --- | --- |
| Ind. 2 — diffusion d'indicateurs de résultats | Taux de satisfaction, note moyenne et taux de recommandation calculés par journée, exportables |
| Ind. 30 — recueil des appréciations des bénéficiaires | Questionnaires à chaud et à froid, taux de réponse, bilan daté imprimable |
| Ind. 31 — traitement des réclamations et difficultés | Questions libres « points à améliorer », verbatims conservés |
| Ind. 32 — mise en œuvre d'améliorations | Registre d'actions d'amélioration par journée, avec suivi de réalisation |

L'application produit les **preuves** (questionnaires, bilans, registre
d'actions) ; leur archivage dans votre système qualité reste à votre main via
les exports.

## Mise en service (une seule fois)

### 1. Créer le projet Firebase

1. <https://console.firebase.google.com> → **Ajouter un projet** (par exemple
   `questionnaires-urbh`). Google Analytics est inutile ici.
2. **Build → Authentication → Get started** → activer le fournisseur
   **E-mail/mot de passe**. Dans l'onglet *Users*, créer votre compte
   administrateur (votre adresse + un mot de passe solide).
3. **Build → Firestore Database → Créer une base** en mode *production*,
   région `europe-west1` (ou une autre région européenne, pour le RGPD).
4. Dans Firestore, créer le document qui liste les administrateurs :
   collection `config`, document `admins`, champ `emails` de type **tableau**
   contenant votre adresse e-mail. Seules les adresses de ce tableau ont
   accès à l'administration — la liste n'est modifiable que depuis la
   console, jamais depuis l'application.
5. **Paramètres du projet → Vos applications → Ajouter une application →
   Web** ; recopier les valeurs de `firebaseConfig` dans
   `public/js/firebase-config.js`. (Ces valeurs identifient le projet et ne
   sont pas des secrets : la sécurité repose sur les règles Firestore.)

### 2. Déployer

```bash
npm install -g firebase-tools     # si nécessaire
cd questionnaires-urbh
firebase login
firebase use --add                # choisir le projet créé, alias "default"
firebase deploy --only hosting,firestore
```

`firestore` déploie les règles de sécurité (`firestore.rules`) — **ne pas
l'omettre au premier déploiement**, sinon la base reste fermée à tout le
monde. Les déploiements suivants d'une simple retouche d'interface peuvent se
limiter à `firebase deploy --only hosting`.

L'application est alors disponible sur
`https://<projet>.web.app` :

| Adresse | Usage |
| --- | --- |
| `https://<projet>.web.app/` | Administration (connexion requise) |
| `https://<projet>.web.app/repondre.html?id=…` | Formulaire public d'un questionnaire (lien fourni par l'administration) |

## Utilisation courante

1. **Créer la journée** d'études (titre, date, lieu, participants attendus).
2. **Créer le questionnaire** depuis le modèle « à chaud », l'ajuster si
   besoin, puis **Ouvrir aux réponses**.
3. Diffuser le **QR code** (le projeter en fin de journée) ou le lien.
4. Suivre les réponses en direct depuis la page du questionnaire, puis
   **Clôturer** une fois la collecte terminée.
5. **Exporter le CSV** et **imprimer le bilan** (PDF) pour le dossier
   qualité ; consigner les **actions d'amélioration** décidées.
6. Quelques mois plus tard, créer sur la même journée le questionnaire
   « à froid » et recommencer au point 3.

## Tenue en charge : 300 participants simultanés

Oui, sans difficulté — l'architecture a été choisie pour cela :

- **Firebase Hosting** sert des fichiers statiques depuis un CDN mondial ;
  300 (ou 3 000) chargements simultanés du formulaire sont insignifiants à
  cette échelle.
- **Cloud Firestore** encaisse environ 10 000 écritures par seconde et par
  base. Chaque participant ne produit qu'**une seule écriture** (sa réponse,
  un document unique) : 300 personnes qui valident dans la même minute font
  ~5 écritures/seconde.
- La limite des « 100 connexions simultanées » parfois citée concerne la
  *Realtime Database* du plan gratuit — l'application utilise **Firestore**,
  qui n'a pas cette limite.
- Même le plan gratuit (Spark : 50 000 lectures et 20 000 écritures par
  jour) couvre une journée d'études à 300 participants avec une marge
  confortable. Le plan Blaze n'est nécessaire que si vos volumes explosent.

## Sécurité et RGPD

- Les réponses sont **anonymes** : aucun nom, e-mail ou adresse IP n'est
  enregistré, seule l'heure de dépôt l'est.
- Un participant ne peut que **lire un questionnaire ouvert** et **déposer
  une réponse** dont la structure est contrôlée par les règles Firestore ;
  il ne peut ni lire, ni modifier, ni supprimer quoi que ce soit d'autre.
- L'administration est réservée aux comptes listés dans `config/admins` ;
  cette liste n'est modifiable que depuis la console Firebase.
- Choisir une **région européenne** pour Firestore lors de la création de la
  base (étape 1.3).

## Architecture

```
questionnaires-urbh/
  firebase.json            configuration Hosting + Firestore
  .firebaserc              projet Firebase par défaut
  firestore.rules          règles de sécurité (le cœur de la sécurité)
  firestore.indexes.json   index (aucun index composite nécessaire)
  public/
    index.html             administration (connexion requise)
    repondre.html          formulaire public des participants
    css/style.css          styles communs + mise en page du bilan imprimé
    js/firebase-config.js  configuration du projet (à renseigner)
    js/modeles.js          modèles de questionnaires Qualiopi
    js/admin.js            application d'administration
    js/repondre.js         formulaire public
```

Choix techniques : JavaScript natif sans étape de build (comme les autres
applications de ce dépôt), SDK Firebase « compat » chargé depuis les CDN
officiels de Google, QR code généré dans le navigateur. Les données sont
organisées en trois collections Firestore : `journees`, `questionnaires`
(questions incluses dans le document, une seule lecture pour afficher le
formulaire) et `reponses` (un document par participant).
