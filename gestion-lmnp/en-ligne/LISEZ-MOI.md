# Gestion LMNP — gestion locative de la colocation (Firebase)

L'application gère la location, rien d'autre : virements de loyer des
colocataires, cautions (dépôts de garantie reçus/restitués), régularisation
annuelle des charges (provisions prélevées sur les loyers comparées aux
dépenses réelles d'eau et de taxe d'enlèvement des ordures ménagères, solde
par colocataire), quittances et décomptes PDF déposés sur l'espace de chaque
colocataire avec e-mail de mise à disposition, bail joint au dossier et
signé à l'écran (tablette) puis mis à disposition de chaque colocataire,
états des lieux avec reportage photo (chaque meuble de l'inventaire porte
aussi ses propres photos), plan du logement à repères numérotés
et signatures — suivis d'une fenêtre de 3 semaines pendant laquelle chaque
colocataire dépose ses photos contradictoires depuis son espace. La
comptabilité, elle, se fait dans votre outil comptable en ligne.

Les documents remis aux colocataires (quittance de loyer, décompte de
régularisation des charges, restitution du dépôt de garantie) sont édités à
l'identité visuelle ANIKA (polices Italiana et Jura, cachet). Chaque
colocataire peut avoir un « 2e destinataire » (parent, garant…) qui reçoit
copie de toutes les notifications.

Chaque colocataire dépose aussi ses justificatifs depuis son espace
(attestation d'assurance habitation, entretien des climatiseurs, ramonage
de la cheminée) ; le relevé et les rappels par e-mail se font depuis
« Bien & baux → Justificatifs des colocataires ».

**Important pour cette mise à jour (v33)** : la livraison contient un
dossier `functions-appel-loyer/` (fonction planifiée d'appel de loyer et
relais de fichiers, voir plus bas), déclaré dans `firebase.json` sous le codebase `appel-loyer`,
**avec ses bibliothèques déjà installées** (`node_modules/`, 5 500 petits
fichiers : c'est normal, et c'est indispensable — la CLI Firebase charge le
code de la fonction sur votre PC pour l'analyser avant de l'envoyer ; sans
ce dossier elle s'arrête sur « Couldn't find firebase-functions package »).
Les lanceurs du dossier `node_modules/.bin` sont préparés pour Windows par
`Application/corriger-bin-fonctions.mjs` (les liens créés par npm ne
survivent pas à un zip).
La commande de déploiement habituelle publie tout ; au premier déploiement,
le terminal demande d'activer quelques services Google (Cloud Functions,
Cloud Build, Artifact Registry, Cloud Scheduler, Eventarc) : répondez **Y**
à chaque question. Comptez 3 à 5 minutes de plus. Si jamais le message
« Couldn't find firebase-functions package » apparaissait quand même,
exécutez `npm install` dans le dossier `functions-appel-loyer` puis
relancez le déploiement.

La page est désormais servie avec une consigne de revalidation : après un
déploiement, la nouvelle version apparaît dès le rechargement suivant, sans
Ctrl+F5.

Cette fonction **cohabite** avec toute autre fonction déjà déployée dans le
projet (par exemple `envoiMail`, la fonction d'envoi des courriels par
Gmail) : chaque codebase est déployé et nettoyé séparément, déployer ce
dossier ne touche pas aux autres. Si malgré tout le terminal proposait de
supprimer une fonction que vous n'avez pas dans ce dossier, répondez **N**.
Si vous venez d'une version antérieure à la v15, les règles de sécurité du
Storage changent (dépôt des photos contradictoires et des justificatifs
par les colocataires). La commande de déploiement habituelle les publie
en même temps que l'application — rien de plus à faire.

Elle est hébergée sur Firebase Hosting, dans un projet **dédié uniquement à
la gestion personnelle** : `gestion-lmnp-anika`.
Rien n'est partagé avec les autres outils (Planning CTTH, projet `ctth-app`…) :
projet distinct, base distincte, adresse distincte — et le fichier
`.firebaserc` de ce dossier épingle le projet, si bien qu'un
`firebase deploy` lancé ici ne peut PAS toucher un autre projet.

Les données vivent dans Firestore, les documents (quittances, rapports
d'état des lieux, photos) dans Firebase Storage, et l'accès est protégé par
un compte e-mail + mot de passe. La mise en place initiale (projet,
Authentication, base, Storage, premier déploiement) est déjà faite : pour
cette mise à jour, il suffit de remplacer le dossier `public/` et de relancer
`firebase deploy` (voir « Mise à jour de l'application »).

## Sécurité

- Adresse en **https**, servie par Firebase Hosting.
- **Connexion obligatoire** : seuls les comptes créés à la main dans la
  console Firebase peuvent entrer ; l'inscription libre est désactivée.
- Les règles Firestore et Storage (`firestore.rules`, `storage.rules`)
  refusent toute lecture ou écriture sans compte connecté.
- Données hébergées en **Europe** si vous choisissez la région `eur3`
  (recommandé) à la création de la base.
- Un seul poste à la fois : le verrou de l'application fonctionne comme
  avant (écran d'attente, expiration après une minute et demie).

## Garder le personnel séparé du professionnel

Créez ce projet avec votre **compte Google personnel**
(andynguyen34@gmail.com), pas avec le compte qui porte les outils du
travail. Si le terminal `firebase` est déjà connecté au compte du travail,
ajoutez le compte personnel sans rien casser :

```
firebase login:add andynguyen34@gmail.com
```

puis utilisez `--account andynguyen34@gmail.com` dans les commandes
ci-dessous. Les deux comptes cohabitent dans le même terminal, chaque
dossier utilisant le sien.

## Mise en place (une seule fois, ~10 minutes)

1. **Créer le projet** — sur https://console.firebase.google.com, connecté
   au compte personnel : « Ajouter un projet », nom `gestion-lmnp-anika`.
   Sous le nom, cliquez sur l'identifiant proposé et fixez-le à
   `gestion-lmnp-anika` (s'il est déjà pris, prenez par exemple
   `gestion-lmnp-anika-2026` et reportez-le dans `.firebaserc`).
   Google Analytics : inutile, décochez.

2. **Activer la connexion** — menu Créer → **Authentication** →
   Commencer → onglet « Sign-in method » → activer **E-mail/Mot de passe**.

3. **Interdire les inscriptions** — Authentication → **Settings** →
   « User actions » : décochez la création de compte (« Enable create »).
   Ainsi, personne ne peut s'inscrire tout seul.

4. **Créer les deux comptes** — Authentication → **Users** →
   « Add user » : votre adresse + un mot de passe ; puis celle de Karine.

5. **Créer la base** — menu Créer → **Firestore Database** →
   « Créer une base de données » → mode **production** → région **eur3
   (europe-west)**.

6. **Activer le stockage des justificatifs** — menu Créer → **Storage** →
   « Commencer », même région. Si la console demande le passage au plan
   **Blaze** (paiement à l'usage) : c'est une exigence de Google pour tout
   nouveau bucket ; au volume d'un LMNP, l'usage reste dans les quotas
   gratuits (0 €/mois en pratique).

7. **Déployer** — dans un terminal, placé dans ce dossier `en-ligne` :

   ```
   firebase deploy --account andynguyen34@gmail.com
   ```

   (le projet est déjà épinglé par `.firebaserc` ; ajoutez
   `--project <identifiant>` seulement si vous avez dû prendre un autre
   identifiant à l'étape 1)

8. **Reprendre la comptabilité** — ouvrez `https://gestion-lmnp-anika.web.app`,
   connectez-vous, puis Paramètres → **Importer une sauvegarde…** →
   choisissez le fichier `sauvegarde-donnees.json` fourni dans la
   livraison. Toutes les écritures (loyers, charges, amortissements,
   emprunt…) sont reprises. Supprimez ensuite ce fichier de votre poste
   si vous ne voulez pas le garder : l'application permet à tout moment
   de télécharger une sauvegarde à jour.

9. **Mettre l'adresse en favori** — c'est la nouvelle porte d'entrée,
   pour vous comme pour Karine, depuis n'importe quel navigateur.

## Mise à jour de l'application

Quand une nouvelle version est livrée : remplacer le dossier `public/`
(depuis la v31 il contient `index.html`, `manifest.webmanifest`, `sw.js` et
`icones/` — le terminal indique « found 5 files in public »), puis relancer
`firebase deploy --account andynguyen34@gmail.com` dans ce dossier.
L'adresse ne change pas.

## Plein écran et installation sur la tablette (v31)

Deux icônes d'installation, une par entrée : la maison verte « LMNP »
(espace propriétaires, `manifest.webmanifest`, ouvre la page d'accueil) et
les silhouettes bleues « ANIKA » (espace colocataires,
`manifest-colocataire.webmanifest`, ouvre `/colocataire`). La page choisit
le manifeste selon l'entrée affichée (adresse, sélecteur, rôle du compte) ;
les deux applications cohabitent sur un même écran d'accueil.

L'application est **installable** : sur la tablette, menu du navigateur →
« Ajouter à l'écran d'accueil » (ou Paramètres → « Affichage sur cet
appareil » → « Installer l'application »). Elle a alors son icône et
s'ouvre sans barre d'adresse, en plein écran. Sans installation, elle
demande le plein écran au premier toucher après le lancement (réglable :
automatique sur écran tactile, toujours, jamais) ; le bouton ⛶ de
l'en-tête le bascule à tout moment. Un navigateur n'accorde le plein
écran qu'à la suite d'un geste de l'utilisateur, jamais tout seul au
chargement : c'est pourquoi l'installation reste la solution la plus
confortable.

## Les comptes des colocataires

1. Renseignez l'adresse e-mail du colocataire dans l'application
   (« Bien & baux » → Locataires → Modifier).
2. Ouvrez son accès dans « Paramètres → Accès à l'application ».
3. Créez son compte de connexion dans la console Firebase :
   Authentication → Users → « Add user » (même adresse + un mot de passe
   que vous lui communiquez).

Donnez-lui l'adresse de son espace :

```
https://gestion-lmnp-anika.web.app/colocataire
```

La page de connexion s'ouvre alors directement sur « Colocataires »
(titre « Résidence ANIKA — Espace colocataires », consignes de première
connexion). Le sélecteur Propriétaires / Colocataires en haut de la page
permet de changer d'entrée, et l'espace utilisé est mémorisé sur
l'appareil. Quel que soit le bouton choisi, le rôle du compte décide de
l'écran ouvert : un colocataire ne voit que son espace (quittances, bail,
état des lieux, dépôts), les règles de sécurité lui interdisent tout le
reste.

## L'envoi des e-mails (fonction `envoiMail`)

L'application dépose chaque e-mail (quittances, décomptes, bail, état des
lieux, rappels, appels de loyer) dans la collection Firestore « mail », au
format `{ to, message: { subject, html, attachments } }`. C'est la fonction
**`envoiMail`** du projet — déployée séparément, depuis le dossier
`deploiementLMNPv23/functions/` (codebase « default », Node 22, région
europe-west9) — qui l'expédie par Gmail (expéditeur « Andy Nguyen
<a-nguyen@sfr.fr> », mot de passe d'application dans le secret
`GMAIL_APP_PASSWORD`) et inscrit le résultat dans le champ `delivery` du
document (`state` : SUCCESS ou ERROR, avec le détail).

L'extension « Trigger Email » n'est plus utilisée : ne l'installez pas, les
courriels partiraient en double.

Cette livraison ne contient pas `envoiMail` et ne la modifie pas : son
`firebase.json` ne déclare que le codebase `appel-loyer` (voir ci-dessous),
et la CLI Firebase ne supprime jamais une fonction d'un autre codebase.
Il n'est donc pas nécessaire de recopier le dossier `functions/` de la v23
dans les livraisons suivantes ; si vous le faites quand même, il est ignoré.
Pour mettre à jour `envoiMail`, déployez depuis son propre dossier avec
`firebase deploy --only functions`.

## Où sont les photos et documents, et le relais de fichiers (v30)

Les photos d'état des lieux, les PDF (quittances, rapports, bail signé) et
les dépôts des colocataires vivent dans **Firebase Storage** (espace Google
Cloud du projet, région Europe) :
`etats-des-lieux/{état des lieux}/{pièce}/…` pour les photos,
`documents/…` pour les PDF, `portail/{e-mail}/…` pour ce qui est remis à
chaque colocataire. Ils se consultent aussi depuis la console :
https://console.firebase.google.com/project/gestion-lmnp-anika/storage

Certains réseaux d'entreprise bloquent le serveur de stockage
(`firebasestorage.googleapis.com`) tout en laissant passer l'adresse de
l'application : les vignettes restaient alors vides (« Photo indisponible
(retry-limit-exceeded) »). Depuis la v30, la fonction **`fichiers`**, servie
derrière `https://gestion-lmnp-anika.web.app/api/fichiers`, fait transiter
les fichiers par l'adresse de l'application. L'application l'utilise
d'elle-même dès qu'elle constate que le serveur de stockage ne répond pas,
et le mémorise pour ce navigateur (Paramètres → « Tester le stockage »
l'indique et permet de revenir à l'accès direct). Le relais applique
exactement les mêmes droits que les règles de sécurité du stockage.

## L'appel de loyer automatique (v26, dossier `functions-appel-loyer/`)

Dans l'application : Paramètres → **Appel de loyer automatique** →
« Réglages » : activez l'envoi, choisissez le jour du mois (par exemple
le 1er), le loyer appelé (celui du mois de l'envoi, ou du mois suivant),
l'objet, vos coordonnées de paiement (IBAN…) et un message facultatif.
Chaque colocataire reçoit alors, ce jour-là, un e-mail avec sa part du
mois (loyer + charges, au prorata si le bail commence en cours de mois),
le reste à régler s'il a déjà versé une partie, la date limite et vos
coordonnées de paiement. Le second destinataire (garant, parent) reçoit
copie, et vous recevez un récapitulatif.

- **« E-mail de test… »** envoie un exemplaire à l'adresse de votre choix,
  tout de suite, sans toucher aux colocataires.
- **« Envoyer maintenant… »** déclenche l'appel du mois à la main.
- L'**historique** évite tout doublon : un mois appelé ne l'est jamais deux
  fois, quel que soit le poste ou le mécanisme qui l'a fait.

Deux mécanismes d'envoi se complètent :
1. la **fonction planifiée** du dossier `functions-appel-loyer/`, exécutée sur le
   serveur chaque jour à 8 h 10 (heure de Paris), qui envoie si c'est le jour
   — sans qu'il soit besoin d'ouvrir l'application ;
2. à défaut (fonction non déployée, ou coupure), l'application envoie
   elle-même à sa **première ouverture** à partir du jour réglé.

Les e-mails sont déposés dans la collection Firestore `mail`, comme
toutes les notifications de l'application : la fonction `envoiMail` les
expédie (voir la section précédente).

Coût : la fonction tourne quelques secondes par jour ; avec Cloud Scheduler
(3 tâches gratuites) cela reste à 0 €/mois sur le plan Blaze.

## Reprendre les données après cette mise à jour

Le fichier `sauvegarde-donnees.json` de cette livraison contient vos données
avec la répartition du bail entre les trois colocataires
(Nicolas 800 €, Léa 350 €, Ludovic 350 €, plus 200 € de charges à parts
égales — 1 700 €/mois au total). Importez-le : Paramètres → « Importer une sauvegarde… ».
