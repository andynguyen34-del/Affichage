# Questionnaires URBH

Application des journées d'études de l'URBH : porte d'entrée unique par
**QR code** (imprimé sur les flyers), reconnaissance des participants,
**tirage au sort**, et **questionnaires de satisfaction** répondant aux
exigences de la certification **Qualiopi** des organismes de formation.

Application autonome, hébergée sur **Firebase** (Hosting + Firestore + Auth),
sans serveur à maintenir : un site statique et une base de données gérée.

## Le parcours participant

1. **Un seul QR code**, imprimé sur les flyers, pointe vers l'adresse stable
   `https://<projet>.web.app/portail.html`. Le portail affiche automatiquement
   la journée d'études marquée « active » dans l'administration — le flyer
   reste donc valable d'une année sur l'autre.
2. À la **première connexion**, le participant se présente : visiteur
   blanchisseur ou exposant fournisseur, prénom, nom, établissement/société,
   **N° d'inscription** (imprimé sur la carte remise à l'accueil),
   **mobile** (pour l'envoi de résultats par SMS) et e-mail facultatif.
3. Son téléphone est ensuite **reconnu automatiquement** (session anonyme
   Firebase conservée par l'appareil) : aux visites suivantes il retombe
   directement sur le **menu de choix** :
   - 🎁 **participer au tirage au sort** (une seule participation par
     personne, garantie côté serveur) ;
   - 📝 **répondre aux questionnaires** ouverts qui le concernent (une seule
     réponse par personne et par questionnaire, garantie côté serveur). Les
     gagnants du tirage s'affichent sur le portail une fois le tirage fait.

## Ce que fait l'administration

**Journées d'études.** Titre, date, lieu, participants attendus (pour le taux
de réponse demandé en audit). Une journée se marque « **active** » : c'est
elle que présente le QR code du flyer.

**QR code pour impression.** La page de chaque journée fournit l'adresse
stable du portail, un aperçu du QR et un bouton **« Télécharger le QR pour
impression »** (PNG 2048 × 2048, correction d'erreur élevée) à remettre à
l'imprimeur du flyer.

**Inscrits.** Compteurs visiteurs/exposants, liste nominative avec mobile,
traçage des connexions (première connexion, dernier accès, nombre d'accès) et
**export CSV** prêt pour une campagne SMS.

**Tirage au sort.** Ouverture/fermeture des participations, tirage d'un ou
plusieurs gagnants au hasard, annulation possible ; les gagnants s'affichent
sur le portail des participants.

**Questionnaires.** Créés par journée à partir de modèles Qualiopi :

- *Évaluation à chaud* — organisation, contenu, intervenants, note /10,
  recommandation, remarques libres ;
- *Évaluation à froid* — mise en pratique, utilité, besoins complémentaires ;
- *Questionnaire vierge* — à composer librement.

Chaque questionnaire vise **tous les inscrits, les visiteurs seulement ou les
exposants seulement**. Questions modifiables (intitulé, type, section, ordre,
obligatoire) tant qu'aucune réponse n'est collectée ; ensuite la structure est
verrouillée pour garantir la cohérence des résultats.

**Résultats.** Nombre de réponses, taux de réponse, satisfaction globale,
note moyenne, taux de recommandation, détail par question, verbatims ;
**export CSV** (Excel français) avec le profil du répondant, et **bilan
imprimable** (papier ou PDF).

**Amélioration continue.** Registre d'« actions d'amélioration » par journée
(à faire / réalisée), alimenté par les retours des participants.

## Correspondance Qualiopi

| Exigence | Réponse de l'application |
| --- | --- |
| Ind. 2 — diffusion d'indicateurs de résultats | Taux de satisfaction, note moyenne, taux de recommandation par journée, exportables |
| Ind. 30 — recueil des appréciations des bénéficiaires | Questionnaires à chaud et à froid, taux de réponse, bilan daté imprimable |
| Ind. 31 — traitement des réclamations et difficultés | Questions libres « points à améliorer », verbatims conservés |
| Ind. 32 — mise en œuvre d'améliorations | Registre d'actions d'amélioration par journée, avec suivi de réalisation |

## Mise en service (une seule fois)

### 1. Créer le projet Firebase

1. <https://console.firebase.google.com> → **Ajouter un projet** (par exemple
   `questionnaires-urbh`). Google Analytics est inutile ici.
   ⚠️ L'identifiant du projet fixe l'adresse définitive du site
   (`https://<projet>.web.app`) — **c'est elle qu'encode le QR code des
   flyers**, choisissez-le donc définitivement.
2. **Build → Authentication → Get started** → activer DEUX fournisseurs :
   - **E-mail/mot de passe** (comptes administrateurs) — créer votre compte
     dans l'onglet *Users* ;
   - **Anonyme** (reconnaissance des participants par leur téléphone).
3. **Build → Firestore Database → Créer une base** en mode *production*,
   région `europe-west1` (ou une autre région européenne, pour le RGPD).
4. Dans Firestore, créer le document des administrateurs : collection
   `config`, document `admins`, champ `emails` de type **tableau** contenant
   votre adresse e-mail. Cette liste n'est modifiable que depuis la console.
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
l'omettre au premier déploiement** ni après toute modification des règles.
Une simple retouche d'interface peut ensuite se déployer avec
`firebase deploy --only hosting`.

| Adresse | Usage |
| --- | --- |
| `https://<projet>.web.app/` | Administration (connexion requise) |
| `https://<projet>.web.app/portail.html` | **Portail participants — adresse du QR code des flyers** |
| `https://<projet>.web.app/portail.html?e=<id>` | Portail d'une journée précise (sans passer par « active ») |
| `https://<projet>.web.app/repondre.html?id=<id>` | Formulaire d'un questionnaire (lien donné par le portail) |

### 3. Produire le QR code du flyer

Dès le projet créé (même avant d'avoir tout configuré), l'adresse
`https://<projet>.web.app/portail.html` est définitive : le QR code peut
partir à l'impression. Ouvrez la journée dans l'administration → carte
« Portail participants & QR code » → **Télécharger le QR pour impression**.
Tant qu'aucune journée n'est active, le portail affiche « À très bientôt ! ».

## Utilisation le jour J

1. Marquer la journée **active** (si ce n'est pas déjà fait).
2. **Ouvrir les participations au tirage** ; les participants s'inscrivent en
   scannant le flyer.
3. En fin de journée, **ouvrir le questionnaire** de satisfaction (créé à
   l'avance depuis le modèle « à chaud ») : il apparaît aussitôt dans le menu
   des participants.
4. **Fermer le tirage**, **tirer le(s) gagnant(s)** — annoncés en salle et
   affichés sur le portail (le mobile du gagnant est visible côté
   administration pour le prévenir).
5. **Clôturer** le questionnaire, exporter **CSV + bilan imprimable** pour le
   dossier qualité, consigner les **actions d'amélioration**.
6. Quelques mois après : questionnaire « à froid » sur la même journée, et
   export des inscrits (CSV avec mobiles) pour la campagne SMS de résultats.

## Envoi de SMS

L'application collecte et exporte les mobiles ; l'envoi lui-même passe par
votre outil de campagnes SMS (Brevo, etc.) en important le CSV des inscrits.
Une intégration directe (envoi automatique des résultats) est possible dans
un second temps via une Cloud Function Firebase reliée à l'API du prestataire.

## Tenue en charge : 300 participants simultanés

Oui, sans difficulté :

- **Firebase Hosting** sert des fichiers statiques depuis un CDN mondial ;
  300 (ou 3 000) chargements simultanés sont insignifiants à cette échelle.
- **Cloud Firestore** encaisse ~10 000 écritures/seconde ; un participant ne
  produit que quelques écritures dans toute la journée (inscription,
  participation au tirage, réponses).
- La limite « 100 connexions simultanées » parfois citée concerne la
  *Realtime Database* du plan gratuit — l'application utilise **Firestore**,
  qui n'a pas cette limite.
- Le plan gratuit (Spark : 50 000 lectures et 20 000 écritures par jour)
  couvre une journée à 300 participants avec de la marge.

## Sécurité et RGPD

- Identification **nominative déclarée par le participant** (prénom, nom,
  organisme, mobile, e-mail facultatif), utilisée pour l'organisation de la
  journée, le tirage au sort et l'envoi de résultats — jamais transmise à des
  tiers ; le formulaire l'annonce clairement.
- Chaque participant ne peut lire et modifier que **ses propres** données
  (profil, participation, réponses) ; identifiants de documents imposés par
  les règles Firestore → une participation au tirage et une réponse par
  questionnaire et par personne.
- L'administration est réservée aux comptes listés dans `config/admins`.
- Choisir une **région européenne** pour Firestore (étape 1.3). Penser à
  purger les données personnelles (inscrits, tirage) une fois la journée
  archivée — la suppression d'une journée efface ses inscrits et son tirage.

## Architecture

```
questionnaires-urbh/
  firebase.json            configuration Hosting + Firestore
  .firebaserc              projet Firebase par défaut
  firestore.rules          règles de sécurité (le cœur de la sécurité)
  firestore.indexes.json   index (aucun index composite nécessaire)
  public/
    index.html             administration (connexion requise)
    portail.html           porte d'entrée des participants (cible du QR code)
    repondre.html          formulaire de réponse à un questionnaire
    css/style.css          styles communs + mise en page du bilan imprimé
    js/firebase-config.js  configuration du projet (à renseigner)
    js/modeles.js          modèles de questionnaires Qualiopi
    js/admin.js            application d'administration
    js/portail.js          portail : inscription, reconnaissance, menu, tirage
    js/repondre.js         formulaire de réponse
```

Collections Firestore : `journees` (administration), `portails` (vitrine
publique d'une journée : titre, état du tirage, gagnants — aucune donnée
personnelle), `participants` (profil rattaché à l'appareil), `inscriptions`
(présence à une journée + traçage des connexions), `tirage` (participations),
`questionnaires` (questions incluses dans le document), `reponses` (une par
participant et par questionnaire).

Choix techniques : JavaScript natif sans étape de build (comme les autres
applications de ce dépôt), SDK Firebase « compat » et bibliothèque QR chargés
depuis les CDN officiels.
