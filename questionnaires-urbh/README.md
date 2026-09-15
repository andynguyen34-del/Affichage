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
   sur l'**écran d'accueil plein écran** — bandeau « Bonjour » avec
   l'information **« réunions en temps réel »** (ce qui se déroule en ce
   moment ou le prochain rendez-vous du programme, mise à jour chaque
   minute) et grands boutons d'accès aux outils, le tout tenant sur un seul
   écran de téléphone : 📅 Programme pédagogique, 🗺️ Plan & recherche des
   stands, 🏭 Visite des stands (avec scanner de QR intégré), 🛠️ Inscription
   Atelier, 🎟️ Validation Tombola, 🎁 Tirage au sort, 📝 Questionnaires,
   plus le bouton 🚪 Quitter l'application.
   Le bloc « 🔐 Mes données » (consentement, demande d'anonymisation) se
   trouve dans l'écran « modifier » du bandeau. Chaque outil s'ouvre dans
   son propre écran :
   - 🎁 **participer au tirage au sort** (une seule participation par
     personne, garantie côté serveur) ;
   - 🎟️ **la tombola de clôture** : trois lots offerts par l'URBH, remis
     par les représentants des fournisseurs. Conditions affichées au participant : réservée aux
     visiteurs blanchisseurs adhérents, **présence dans la salle lors du
     tirage** requise, et **validation des points de présence** — présence à
     l'Assemblée Générale et pointage à l'ouverture des journées sur la
     première conférence. Le participant valide chaque point d'un geste
     (« 📍 Je pointe ») quand l'administration ouvre le pointage, sur place ;
   - 🛠️ **s'inscrire aux ateliers** à places limitées (salles B, C, D…) —
     une inscription par atelier et par personne, un seul atelier par
     créneau, **uniquement pendant l'Assemblée Générale** (période paramétrée
     par l'administration ; l'écran d'inscription disparaît ensuite) ;
     l'affectation se fait ensuite par tirage au sort équitable ; le résultat
     est **notifié sur le téléphone**, avec un **rappel 10 minutes avant le
     début de l'atelier** indiquant le numéro de salle (notifications à
     activer par le participant ; remises tant que l'application est ouverte) ;
   - 📝 **répondre aux questionnaires** ouverts qui le concernent (une seule
     réponse par personne et par questionnaire, garantie côté serveur). Les
     gagnants du tirage s'affichent sur le portail une fois le tirage fait.

## Ce que fait l'administration

**Journées d'études.** Titre, date, lieu, participants attendus (pour le taux
de réponse demandé en audit). Une journée se marque « **active** » : c'est
elle que présente le QR code du flyer.

**Programme pédagogique.** Saisi (ou pré-rempli d'un clic pour les 41es JE
de Nantes) dans la page de la journée : chaque événement porte un début, une
fin, un titre et un lieu. Le portail l'affiche par jour avec le fil « en ce
moment / à suivre » du bandeau d'accueil, mis à jour en temps réel.

**QR code pour impression.** La page de chaque journée fournit l'adresse
stable du portail, un aperçu du QR et un bouton **« Télécharger le QR pour
impression »** (PNG 2048 × 2048, correction d'erreur élevée) à remettre à
l'imprimeur du flyer.

**Annuaire des inscrits attendus.** Avant l'événement, importez les fichiers
Excel des inscrits : celui des adhérents (visiteurs blanchisseurs) puis celui
des représentants fournisseurs (exposants). La correspondance des colonnes
(N°, nom, prénom, établissement) est détectée automatiquement et se corrige
d'un clic. Au portail, la saisie du N° d'inscription reconnaît alors la
personne et pré-remplit son identité et son profil. Seules les colonnes
numéro / nom / prénom / établissement sont importées — jamais l'e-mail.

**Inscrits.** Compteurs visiteurs/exposants, liste nominative avec mobile,
traçage des connexions (première connexion, dernier accès, nombre d'accès) et
**export CSV** prêt pour une campagne SMS.

**Tirage au sort.** Ouverture/fermeture des participations, tirage d'un ou
plusieurs gagnants au hasard, annulation possible ; les gagnants s'affichent
sur le portail des participants.

**Tombola de clôture et pointages de présence.** Trois moments de pointage
(émargement) sont ouverts et fermés depuis l'administration : **ouverture des
journées (première conférence)**, **Assemblée Générale**, **présence en salle
au moment du tirage**. L'administration enregistre les **lots** (libellé +
fournisseur remettant — les lots sont offerts par l'URBH et remis par les
représentants des fournisseurs), suit le nombre de participants **éligibles** (visiteurs
blanchisseurs ayant validé les trois points) et **tire chaque lot** — une même
personne ne peut gagner qu'un seul lot ; un gagnant s'annule d'un clic. La
**feuille des pointages (CSV)** sert d'émargement (utile aussi au dossier
qualité). Les gagnants s'affichent sur le portail.

**Période d'AG = fenêtre d'inscription aux ateliers.** L'administration
paramètre le début et la fin de l'Assemblée Générale : les inscriptions aux
ateliers ne sont possibles que pendant cette période (contrôlée aussi par les
règles de sécurité côté serveur) ; une fois l'AG terminée, l'écran
d'inscription disparaît du portail. Un lien **« 🧪 Portail en simulation »**
(paramètre `?simu=1`) affiche un sélecteur ◀ ▶ qui simule l'évolution de la
journée (avant / pendant / après l'AG) pour vérifier les écrans pendant la
phase de mise au point — seul l'affichage est simulé, les enregistrements
restent contrôlés par l'heure réelle.

**Ateliers à inscription.** Pour les ateliers à places limitées (salles B, C
et D des journées d'études), l'administration crée les ateliers (un bouton
pré-remplit les 6 ateliers types : 3 salles × 2 créneaux, avec leur début
précis pour le rappel sur téléphone), puis lance le **tirage au sort
équitable**, atelier par atelier : sont retenues en priorité 1) les personnes n'ayant encore gagné
aucun atelier de la journée et dont la blanchisserie n'est pas déjà
représentée dans cet atelier, 2) puis les autres personnes sans atelier, 3)
et seulement s'il reste des places, celles déjà retenues ailleurs (une
personne ne cumule donc plusieurs ateliers que sur des places restantes,
gérées atelier par atelier). Les autres sont en liste d'attente ordonnée
selon les mêmes priorités. Chaque participant voit son résultat sur le
portail ; une **feuille d'émargement CSV** est exportable par atelier.

**Passages sur les stands.** Chaque fournisseur exposant reçoit son **QR code
de stand** (imprimable depuis l'administration, une page par stand) : le
visiteur le scanne avec l'appareil photo de son téléphone, l'application le
reconnaît, il **confirme son passage et consent** au partage de ses
coordonnées avec ce fournisseur. L'administration suit les passages par
stand et **exporte pour chaque fournisseur la liste de ses visiteurs**
(CSV : identité, établissement, mobile, e-mail). Le portail offre aussi la
**recherche d'exposants** (nom, stand, activité) avec le fil de ses propres
passages. La liste des fournisseurs s'**importe depuis un fichier Excel ou
CSV** (nom, n° de stand, description — correspondance des colonnes
pré-détectée) ; un second import de la liste des **nouveaux fournisseurs**
(case « marquer comme nouveaux ») les met en avant sur le portail — bandeau
« 🆕 Nouveaux exposants à découvrir » avec leur n° de stand, badge dans la
recherche — sans créer de doublons. Le **plan de l'exposition** (Cité des
Congrès de Nantes, stands numérotés) est publié avec le site
(`public/plan-exposition.png`) et s'affiche dans la carte Exposants du
portail — touchez le plan pour l'agrandir. Le fichier
`donnees/fournisseurs-stands-2026.xlsx` (87 fournisseurs et leurs stands,
tiré du tableau des partenaires) est prêt à importer telle quelle dans la
carte Fournisseurs.

**Questionnaires.** Créés par journée à partir de modèles :

- *Évaluation stagiaire (modèle URBH)* — reprend le questionnaire officiel
  des journées d'études : notation de 1 à 5, un bloc de cinq questions par
  conférence, organisation, bilan et intention de revenir ;
- *Évaluation partenaires techniques (modèle URBH)* — le questionnaire
  officiel des exposants : qualité/prix du stand, accompagnements,
  organisation, intention de réserver en 2027 (à proposer aux exposants
  uniquement) ;
- *Ateliers 2026 (modèles URBH)* — un questionnaire par atelier
  (« Développer ses applications métier avec l'IA », Maintenance,
  RABC & IA) : grille de connaissances posée avant puis en fin de session
  (preuve de progression), auto-évaluation, satisfaction sur l'échelle
  « Pas du tout satisfait … Très satisfait » et questions qualitatives —
  les corrigés restent dans les documents Word de l'animateur ;
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

## Affichage de la certification Qualiopi : prudence

L'usage de la marque et du logo Qualiopi est strictement encadré (décret
n° 2019-564 et charte d'usage) : mention obligatoire des catégories
d'actions certifiées accompagnant le logo, interdiction sur les
attestations remises aux stagiaires, pas d'usage laissant croire que les
contenus de formation seraient eux-mêmes certifiés. Par prudence,
l'application **ne mentionne pas Qualiopi dans les pages vues par les
participants** (portail, questionnaires) et n'affiche aucun logo. Les
références aux indicateurs du référentiel n'apparaissent que dans les
écrans internes d'administration et sur le bilan destiné au dossier
qualité — un usage documentaire, pas de la communication. Toute mention
publique (site, flyers, bilans diffusés) est à valider avec votre
certificateur et la charte d'usage en vigueur.

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
   Web** (un simple enregistrement suffit, inutile de cocher Hosting).
   **Rien à recopier** : hébergée sur Firebase Hosting, l'application
   récupère sa configuration toute seule (`/__/firebase/init.js`). Le
   fichier `public/js/firebase-config.js` ne sert que de secours hors de
   cet hébergement.

### 2. Déployer

```bash
npm install -g firebase-tools     # si nécessaire
cd questionnaires-urbh
firebase login
firebase deploy --only hosting,firestore --project questionnaires-urbh
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

1. Marquer la journée **active** (si ce n'est pas déjà fait) et vérifier la
   **période d'AG** (fenêtre d'inscription aux ateliers).
2. **Ouvrir les participations au tirage** ; les participants s'inscrivent en
   scannant le flyer. Ouvrir le **pointage « ouverture »** au début de la
   première conférence, le **pointage « AG »** pendant l'Assemblée Générale,
   puis les refermer ; à la clôture, ouvrir le **pointage « présence en
   salle »** juste avant de **tirer les lots de la tombola**.
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
publique d'une journée : titre, état du tirage, gagnants, lots et gagnants de
la tombola, période d'AG, état des pointages — aucune donnée personnelle),
`participants` (profil rattaché à l'appareil), `inscriptions` (présence à une
journée + traçage des connexions), `tirage` (participations), `pointages`
(émargement aux moments clés : ouverture, AG, présence en salle — un document
par personne et par moment, uniquement quand le pointage est ouvert),
`ateliers` et `voeux` (inscriptions pendant l'AG seulement), `fournisseurs`
et `visites` (passages sur les stands), `questionnaires` (questions incluses
dans le document), `reponses` (une par participant et par questionnaire).

**Notifications des ateliers** : sans serveur d'envoi (plan gratuit), les
notifications (résultat du tirage, rappel 10 minutes avant l'atelier avec la
salle) sont remises par l'application elle-même tant qu'elle est ouverte sur
le téléphone. Des notifications « push » reçues application fermée
demanderaient le plan Blaze (Cloud Functions + Firebase Cloud Messaging) —
possible dans un second temps.

Choix techniques : JavaScript natif sans étape de build (comme les autres
applications de ce dépôt), SDK Firebase « compat » et bibliothèque QR chargés
depuis les CDN officiels.
