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
« Logements & baux → Justificatifs des colocataires ».

**À partir de la v40 — un seul zip, un seul clic.** La livraison devient un
zip unique `deploiement-LMNP-vNN.zip` (environ 1 Mo, sans `node_modules`)
contenant `DEPLOYER.cmd`, qui enchaîne : contrôle des fichiers (quarantaine),
installation des bibliothèques de la fonction si le dossier ne les a pas
encore (`npm install`, une fois par dossier), puis `firebase deploy`. Extraire
le zip dans le dossier de déploiement habituel (en écrasant : les
bibliothèques déjà installées sont conservées) et double-cliquer
`DEPLOYER.cmd`. Les fichiers VERIFIER.cmd / INSTALLER.cmd et le zip « complet »
disparaissent. Le zip se fabrique avec `en-ligne/livraison/emballer.sh NN`.

**Nouveau en v48 — expéditeur toujours égal au compte d'envoi.** Les
messages partaient au nom de l'adresse réglée dans « Adresses e-mail »
(a-nguyen@sfr.fr) : Gmail, Hotmail et Orange les rejetaient (« Unauthenticated
email from sfr.fr is not accepted due to domain's DMARC policy », 550
5.7.26), et le rejet n'arrivait que dans la boîte du compte Gmail. La
fonction d'envoi force désormais le « from » sur le compte Gmail qui expédie
(nom affiché conservé) ; une autre adresse réglée devient l'adresse de
réponse, et la file « Envoi des e-mails » note l'adresse remplacée. Après
déploiement, renvoyez ce qui a été rejeté : appels de loyer (« Renvoyer »),
appels de dépôt (« Relancer »), bienvenue (« Renvoyer la bienvenue »).

**Nouveau en v47 — e-mail « Bienvenue sur votre espace ».** Page
Locataires : « Bienvenue ✉ » (par personne) ou « Bienvenue aux nouveaux »
crée le compte de connexion du colocataire (opération `compte-creer` de la
fonction relais, réservée aux gérants), déclenche l'e-mail Firebase de
choix du mot de passe, ouvre son espace (document portail, avec
`bienvenueLe` / `compteCreeLe`) et envoie la bienvenue : adresse de
l'espace, identifiant, quatre étapes de première connexion, icône sur PC
et tablette, ce qu'on trouve sur l'espace, justificatifs manquants,
raccourci « Résidence ANIKA.url » joint. La colonne « Espace en ligne »
affiche « bienvenue envoyée le … · compte créé ». Paramètres : carte
« Bienvenue sur l'espace » (objet, message d'accueil, exemple à
soi-même) ; type de copie « Bienvenue, accès à l'espace ». Cette version
redéploie la fonction `fichiers` (commande habituelle, DEPLOYER.cmd).

**Nouveau en v46 — appel et reçu de dépôt de garantie.** Le dépôt a ses
propres documents, distincts de l'appel de loyer et de la quittance (l'appel
de loyer n'en parle jamais) :
- **Appel de dépôt** (page Cautions, « Appeler le dépôt » ligne par ligne ou
  « Appeler les dépôts non appelés » pour tout le logement choisi) : e-mail
  au colocataire avec le montant convenu, la date limite (l'entrée dans les
  lieux, modifiable dans la fenêtre avant l'envoi), les coordonnées de
  paiement de l'appel de loyer du logement avec le libellé « Dépôt de
  garantie Prénom NOM », et l'annonce du reçu. La ligne passe « Appelée
  le … » ; « Relancer » renvoie un rappel (objet « Relance — … »).
- **Reçu de dépôt** : « Dépôt reçu… » enregistre la date, le montant et le
  mode de versement, puis génère le reçu PDF ANIKA (montant en lettres,
  référence au bail, article 22 de la loi de 1989), le dépose sur l'espace
  du colocataire (rubrique Bail & documents, « Reçu de dépôt de garantie »)
  et l'annonce par e-mail. « Reçu PDF » le rouvre ou le régénère.
- **Paramètres → « Dépôt de garantie »** : objet, délai proposé avant
  l'entrée, coordonnées de paiement propres et message complémentaire de
  l'appel (variables {prenom} {nom} {montant} {convenu} {date} {dateLongue}
  {logement} {adresse} {entree}). Copies : nouveau type « Dépôts de garantie
  (appels, reçus) » dans « Adresses e-mail ».
Les cautions déjà enregistrées gardent leurs dates ; une caution reçue sans
reçu publié propose « Reçu PDF ».

**Nouveau en v45 — dépôt de garantie aligné sur le loyer.** Le montant
convenu de chaque colocataire est par défaut un mois de son loyer hors
charges (sa part sur le bail), au lieu du dépôt du bail divisé à parts
égales ; pour un locataire seul, le dépôt du bail s'il est renseigné, sinon
son loyer. « Modifier » sur la ligne fixe un autre montant, conservé.

**Nouveau en v44 — dépôts de garantie fantômes.** La mise à jour de la page
Loyers couvre aussi les dépôts de garantie : un dépôt enregistré dont le bail
a été supprimé ou dont le colocataire n'est plus sur le bail est proposé à la
suppression (conservé s'il détient de l'argent, sauf « supprimer quand
même ») ; la page Cautions a son bandeau et son bouton « Mettre à jour les
dépôts ».

**Nouveau en v44 — adresses e-mail dans Paramètres.** La carte « Adresses
e-mail » règle l'expéditeur affiché (nom et adresse, avec avertissement si
l'adresse n'est pas le compte qui expédie), l'adresse de réponse et les copies
par type d'envoi (appels de loyer, documents, rappels de justificatifs,
contradictoire et signatures), bailleurs cochables ou adresses libres. La
fonction d'expédition lit ces réglages à chaque courriel : appliqué au
prochain envoi, sans redéploiement. Le compte qui expédie et son mot de passe
d'application restent réglés au déploiement.

**Nouveau en v44 — déploiement depuis GitHub.** Plus de zip ni de PC : un
bouton « Run workflow » dans l'onglet Actions du dépôt (ou la fusion d'une
pull request dans `main`) construit et déploie tout. Réglage unique décrit
plus bas, section « Déploiement depuis GitHub ».

**Nouveau en v43 — photos par meuble, mise à jour des échéances.** Sur son
espace, le colocataire joint des photos à chaque meuble de l'état des lieux
contradictoire (« Photo du meuble » sur la ligne du meuble) ; le relevé côté
gérant et l'annexe du rapport les rangent sous le meuble. Un second clic sur
« D'accord » ou « Remarque » décoche la réponse. Page Loyers : « Mettre à
jour les échéances » compare les échéances enregistrées aux baux (colocataire
retiré, bail supprimé, part modifiée) et propose de supprimer, réaligner ou
conserver ; un bandeau apparaît dès qu'un écart existe ; une échéance qui
porte un virement ou une quittance n'est supprimée que si l'on coche
« supprimer quand même » (double confirmation). Paramètres → « Envoi des
e-mails » indique l'expéditeur et la fonction de chaque envoi. À déployer :
hébergement et fonctions (commande habituelle).

**Nouveau en v42 — l'envoi des e-mails fait partie de la livraison.** La
fonction `expedierCourriel` (dossier `functions-appel-loyer/`) expédie les
courriels de la file « mail » par Gmail et note le résultat de chaque envoi ;
Paramètres → « Envoi des e-mails » l'affiche, relance ce qui est en attente
et envoie un e-mail de test. Au premier déploiement, le terminal demande
l'adresse Gmail qui expédie (`GMAIL_COMPTE`). Voir « L'envoi des e-mails »
plus bas.

**Nouveau en v41 — justificatifs communs à la résidence.** L'entretien des
climatiseurs et le ramonage concernent la maison : un seul document, déposé
depuis son espace par n'importe quel colocataire, vaut pour tous (il apparaît
chez chacun avec le prénom du déposant et la date). L'assurance habitation
reste par personne, mais une attestation peut être déposée « pour tous les
colocataires » (case à cocher) et couvre alors chacun. Les documents communs
vivent dans l'espace de stockage `partage/justificatifs/{logement}/`, lisible
par les colocataires du logement (leur espace porte l'identifiant du logement,
inscrit automatiquement au lancement de l'application). Côté gérant, la page
« Locataires » montre une ligne « Pièces communes » par colocation, « Rappel à
tous » envoie un seul e-mail aux colocataires du logement ; la pastille du
menu compte les personnes sans assurance et les logements incomplets. Les
documents d'entretien ou de ramonage déposés avant cette version dans un
espace personnel comptent pour la maison. À déployer : hébergement, règles de
stockage (Storage) et la fonction `fichiers` (relais) — la commande habituelle.

**Nouveau en v40 — page « Locataires ».** Les locataires ont leur entrée dans
le menu : contact, bail en cours (logement, part de loyer), espace en ligne
(documents publiés, dernière connexion) et justificatifs (un badge par pièce
demandée, rappel par e-mail individuel ou groupé). La page suit le sélecteur
« Logement » ; sur « Tous », un bandeau par logement ; les anciens locataires
sans bail en cours sont repliés en bas. La pastille du menu compte les
colocataires à qui il manque un justificatif. « Logements & baux » ne garde
que les logements, les baux et les révisions ; le nom d'un locataire sur un
bail ouvre sa ligne. Le titre des états des lieux publiés sur les espaces
porte le nom du logement. Les règles Firestore changent (le colocataire note
la date de sa visite) : déployer l'hébergement et les règles ; les fonctions
sont inchangées.

**Nouveau en v39 — plusieurs états des lieux par espace, blocs repliables.**
Chaque espace colocataire conserve désormais tous les états des lieux publiés
(entrée, sortie, plusieurs logements) au lieu du seul dernier : la rubrique
« État des lieux » les présente en blocs repliables, repliés par défaut, et
les pièces sont repliées par défaut. Correctif : republier un état des lieux
n'efface plus celui d'un autre logement. À déployer : hébergement, règles
Firestore, fonctions.

**Nouveau en v38 — signature des colocataires depuis leur espace, rapport
PDF recomposé, déconnexion à la fermeture.** Après ses réponses
contradictoires, le colocataire signe au doigt sur son espace et confirme
avec un code à 6 chiffres reçu par e-mail (15 minutes) ; la signature est
enregistrée par la fonction serveur (`/api/fichiers?op=signature-…`, dans la
fonction `fichiers` existante) et reprise dans l'onglet « Signatures » et le
rapport. Le rapport PDF est plus dense (en-tête sur deux blocs, plan réduit,
tableaux par pièce, photos sur trois colonnes, pages numérotées). Fermer la
fenêtre ou l'application déconnecte. À déployer : hébergement, règles
Firestore, fonctions (commande habituelle).

**Nouveau en v37 — état des lieux contradictoire sur l'espace colocataire,
espace réorganisé.** À l'ouverture de la fenêtre contradictoire (durée
réglable, 21 jours par défaut), l'état des lieux complet est publié sur
l'espace de chaque colocataire : il répond point par point (d'accord ou
remarque), dépose ses photos, et ses réponses sont relevées côté gérant puis
jointes au rapport en annexe. L'espace colocataire est organisé en rubriques
(Accueil « À faire », État des lieux, Quittances, Bail & documents,
Justificatifs, Mon compte) et affiche la prochaine échéance de loyer.
**À déployer : hébergement, règles Firestore et Storage, fonctions** (la
commande habituelle déploie tout) — les règles autorisent le colocataire à
écrire ses réponses et à lire les photos partagées.

**Nouveau en v36 — icônes de lancement.** Chaque entrée s'installe comme
une application avec son icône : « LMNP » (propriétaires, …/proprietaire) et
« Résidence ANIKA » (colocataires, …/colocataire). Bouton « Installer
l'icône… » sous « Se connecter » sur la page de connexion ; carte
Paramètres → « Icônes de lancement » (installation sur ce PC, ouverture de
l'entrée colocataires, adresse à copier, raccourci .url de repli). Sur PC,
Chrome ou Edge propose « Épingler à la barre des tâches » et « Créer un
raccourci sur le Bureau ». Les manifestes changent de nom : redéployez
l'hébergement (commande habituelle).

**Nouveau en v35 — plusieurs logements.** L'application gère désormais
plusieurs logements (voir la section « Plusieurs logements » plus bas) :
sélecteur « Logement » dans l'en-tête, vue « Tous les logements » groupée
avec sous-totaux, réglages d'appel de loyer propres à chaque logement,
types de location (colocation, location entière, courte durée / Airbnb).
Les données existantes (maison SML, bail, loyers, cautions, états des
lieux) restent rattachées à la maison : rien à ressaisir. La liste des
états d'un état des lieux gagne « Très bon état » (entre Neuf et Bon état).
Le dossier `functions-appel-loyer/` est à redéployer (la fonction planifiée
traite maintenant chaque logement séparément).

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

## L'état des lieux contradictoire sur l'espace colocataire (v37)

1. Après la visite et les signatures, onglet « Contradictoire » de l'état des
   lieux → **« Ouvrir la fenêtre contradictoire… »** : choisissez la durée
   (21 jours par défaut ; la date de fin, calculée, reste modifiable) et si
   chaque colocataire est prévenu par e-mail. Les photos de l'état des lieux
   sont copiées dans l'espace `partage/` du stockage (lisible par les comptes
   colocataires de la résidence, jamais modifiable par eux), et l'état des
   lieux (postes, observations, mobilier, relevés) est publié sur l'espace de
   chaque colocataire.
2. Le colocataire ouvre la rubrique « État des lieux » de son espace : pièce
   par pièce, chaque point (état général, murs, plafond… chaque meuble, les
   relevés) avec l'état et l'observation du bailleur, et pour chacun
   « ✓ D'accord » ou « ✗ Remarque » + texte. Ses photos par pièce restent
   datées et non modifiables. Enregistrement automatique ; réponses modifiables
   jusqu'à la date de fin incluse, figées ensuite ; « Tout est d'accord pour le
   reste » complète d'un coup. Un point sans réponse vaut accord.
3. Côté gérant : « Relever les réponses » (répondu / pas encore, remarques et
   photos de chacun), « Rappel par e-mail » aux retardataires, « Modifier la
   date de fin », « Republier l'état des lieux » (après une correction),
   « Rapport PDF avec annexe contradictoire » : le rapport est regénéré avec
   une annexe par colocataire (date de réponse, points d'accord, remarques,
   photos) et republié sur les espaces.
4. **Signature à distance (v38)** : une fois ses réponses complètes, le
   colocataire signe au doigt sur son espace, reçoit un code à 6 chiffres à
   son adresse (valable 15 minutes, 5 essais) et le saisit. La fonction
   serveur vérifie le code et écrit `portail/{email}/signatures/{edlId}`
   (image, date et heure, mode « e-mail », adresse masquée, empreinte du
   code) — le navigateur du colocataire ne peut ni antidater ni modifier.
   Il peut encore compléter ses remarques et photos jusqu'à la fin de la
   fenêtre. Côté gérant, l'onglet « Signatures » affiche « signé à distance »
   avec date, heure et adresse masquée, propose « Rappel par e-mail » aux
   colocataires qui n'ont pas signé, et le compteur du bandeau en tient
   compte ; le rapport PDF indique le mode de chaque signature. Les
   bailleurs signent toujours sur la tablette, et un colocataire peut aussi
   signer sur la tablette.
5. Sécurité : le colocataire n'écrit que dans ses propres réponses
   (`portail/{email}/reponses/{edlId}`), uniquement pendant la fenêtre (règle
   Firestore) ; il ne lit que son espace et les photos partagées.

## L'espace colocataire (v37)

Rubriques en haut de l'espace : **Accueil** (« À faire » : état des lieux à
compléter, justificatif manquant, dernier document ; « Prochaine échéance » :
le loyer du mois publié par l'appel de loyer, avec le libellé du virement,
marqué « réglé » dès que la quittance est publiée), **État des lieux**
(contradictoire), **Quittances** et **Bail & documents** (rangés par année),
**Justificatifs**, **Mon compte** (mot de passe, icône « Résidence ANIKA »,
adresse de connexion, déconnexion). Une pastille signale ce qui attend.

## Le rapport PDF d'état des lieux (v38)

En-tête sur deux blocs (Logement | Parties), ligne de résumé (pièces, postes,
meubles, photos, relevés, clés), plan réduit à droite avec sa légende et les
observations générales à gauche ; une bande de titre par pièce avec l'état
général, tableau Poste / État / Observation, photos de la pièce sur trois
colonnes, tableau Mobilier / Qté / État / Observation puis photos du
mobilier ; pièce sans évaluation ni photo : « Rien à signaler » ; signatures
sur trois colonnes (mode et date) ; annexe contradictoire en tableau par
colocataire ; pied de page « page n / N » avec le titre du document.

## Connexion et fermeture (v38)

La session ne vaut que pour la fenêtre : fermer l'onglet, la fenêtre ou
l'application installée déconnecte (bailleurs et colocataires), et le verrou
« un seul poste » est libéré. Un nouvel onglet ouvert à la main demande une
connexion.

## Icônes de lancement, une par entrée (v36)

- **Propriétaires, sur votre PC** : page de connexion (entrée Propriétaires)
  → « 📲 Installer l'icône « LMNP » sur cet appareil », ou Paramètres →
  « Icônes de lancement » → « Installer sur cet ordinateur ». Chrome ou Edge
  ouvre sa fenêtre : cochez « Épingler à la barre des tâches » et « Créer un
  raccourci sur le Bureau ». L'application s'ouvre ensuite dans sa propre
  fenêtre, sans barre d'adresse.
- **Colocataires** : donnez-leur l'adresse …/colocataire (bouton « Copier
  l'adresse ») ; la page de connexion « Colocataires » a le même bouton
  « Installer l'icône « Résidence ANIKA » ». Pour l'installer vous-même sur
  votre PC : « Ouvrir l'entrée colocataires » (nouvel onglet, sans vous
  déconnecter) puis « Installer ».
- Le bouton installe l'application décrite par le manifeste chargé avec la
  page : si vous changez d'entrée sur la page de connexion, il propose
  d'abord d'ouvrir l'adresse de l'entrée voulue, puis d'installer.
- **Repli** : « Télécharger le raccourci (.url) » donne un fichier à poser
  sur le Bureau qui ouvre l'adresse dans le navigateur (icône du navigateur) ;
  le navigateur peut demander de confirmer (« Conserver »). Utile si
  l'installation d'applications est bloquée sur un poste professionnel.
- Tablette et téléphone : le même bouton ajoute l'icône à l'écran d'accueil
  (sur iPad : Partager → « Sur l'écran d'accueil »).

## Les comptes des colocataires

1. Renseignez l'adresse e-mail du colocataire dans l'application
   (« Locataires » → Modifier).
2. Ouvrez son accès dans « Paramètres → Accès à l'application ».
3. Page Locataires → **« Bienvenue ✉ »** (ou « Bienvenue aux nouveaux »,
   v47) : l'application crée son compte de connexion (fonction serveur,
   mot de passe aléatoire jamais communiqué), Firebase lui envoie
   « Réinitialisez votre mot de passe » pour qu'il choisisse le sien, son
   espace est ouvert et il reçoit l'e-mail de bienvenue : adresse de
   l'espace, identifiant, les quatre étapes de première connexion, l'icône
   « Résidence ANIKA » (PC, tablette), les justificatifs à déposer, avec le
   raccourci « Résidence ANIKA.url » en pièce jointe. « Renvoyer la
   bienvenue » renvoie la procédure. Texte réglable dans Paramètres →
   « Bienvenue sur l'espace » (« M'envoyer un exemple »).

L'adresse de son espace :

```
https://gestion-lmnp-anika.web.app/colocataire
```

(Avant la v47, le compte se créait à la main dans la console Firebase :
Authentication → Users → « Add user ». Cela reste possible ; la bienvenue
détecte un compte existant.)

La page de connexion s'ouvre alors directement sur « Colocataires »
(titre « Résidence ANIKA — Espace colocataires », consignes de première
connexion). Le sélecteur Propriétaires / Colocataires en haut de la page
permet de changer d'entrée, et l'espace utilisé est mémorisé sur
l'appareil. Quel que soit le bouton choisi, le rôle du compte décide de
l'écran ouvert : un colocataire ne voit que son espace (quittances, bail,
état des lieux, dépôts), les règles de sécurité lui interdisent tout le
reste.

## Déploiement depuis GitHub (v44) — sans zip ni PC

Le dépôt contient `.github/workflows/deployer-lmnp.yml` : GitHub construit
l'application et déploie hébergement, règles et fonctions sur
`gestion-lmnp-anika`. Deux façons de le lancer :
- **à la main** : GitHub → onglet Actions → « Déployer LMNP » → « Run
  workflow » (choix de la branche, « tout » ou « hosting-seul ») ;
- **automatiquement** : à chaque mise à jour de la branche `main` qui touche
  `gestion-lmnp/` (par exemple quand une pull request est fusionnée).

Réglage unique, à faire une fois :
1. Console Google Cloud du projet → IAM et administration → Comptes de
   service → Créer : nom `deploiement-github`, rôles **Éditeur**,
   **Utilisateur du compte de service** et **Administrateur Firebase**.
   Puis onglet Clés → Ajouter une clé → JSON : un fichier se télécharge.
2. GitHub → dépôt → Settings → Secrets and variables → Actions :
   - Secrets → New repository secret : `FIREBASE_SERVICE_ACCOUNT`, valeur =
     tout le contenu du fichier JSON ;
   - Variables → New repository variable : `GMAIL_COMPTE` (adresse Gmail qui
     expédie) et `COURRIEL_EXPEDITEUR` (ex. `Andy Nguyen <adresse@gmail.com>`).
3. Supprimez le fichier JSON de votre PC : GitHub en a une copie chiffrée,
   personne d'autre.

Le mot de passe d'application Gmail reste dans le Secret Manager du projet ;
il ne passe ni par GitHub ni par le dépôt. Le zip et `DEPLOYER.cmd` restent
disponibles en secours.

## L'envoi des e-mails (fonction `expedierCourriel`, v42)

L'application dépose chaque e-mail (quittances, décomptes, bail, état des
lieux, rappels, appels de loyer, codes de signature) dans la collection
Firestore « mail », au format `{ to, message: { subject, html, attachments } }`.
Depuis la v42, c'est la fonction **`expedierCourriel`** de cette livraison
(dossier `functions-appel-loyer/`, fichier `courriel.js`, région
europe-west1) qui l'expédie par Gmail, à la création du document, et inscrit
le résultat dans son champ `delivery` (`state` : PROCESSING → SUCCESS ou
ERROR avec le message d'erreur, `attempts`, dates).

Réglages, demandés une fois au premier déploiement de la v42 :
- le secret `GMAIL_APP_PASSWORD` (mot de passe d'application Google) existe
  déjà dans le projet — la CLI le réutilise ; sinon elle demande sa valeur ;
- le paramètre `GMAIL_COMPTE` : l'adresse Gmail du compte qui expédie (celui
  du mot de passe d'application). La CLI le demande dans le terminal et le
  conserve dans `functions-appel-loyer/.env.gestion-lmnp-anika` (modifiable au Bloc-notes) ;
- le paramètre `COURRIEL_EXPEDITEUR` (par défaut « Andy Nguyen
  <a-nguyen@sfr.fr> ») : l'expéditeur affiché ; l'adresse doit être autorisée
  en « Envoyer en tant que » dans Gmail.

Dans l'application, **Paramètres → « Envoi des e-mails »** montre la file :
date, destinataires, objet, état (Envoyé / Échec avec l'erreur / En attente),
avec « Relancer les envois en attente » (courriels jamais partis ou en échec,
3 essais au plus) et « E-mail de test ».

**Ancienne fonction `envoiMail`** (codebase « default », europe-west9,
déployée à part jusqu'à la v41) : supprimée le 8 septembre 2026. L'extension
« Trigger Email » n'est pas utilisée : ne l'installez pas.

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

## Plusieurs logements (v35)

- **Déclarer un logement** : « Logements & baux » → « + Logement » : nom,
  adresse et **type de location** —
  *colocation* (un bail, plusieurs colocataires avec leur part),
  *location entière* (un bail, un locataire ou un couple),
  *courte durée* (Airbnb, Booking… : des séjours, sans bail ni appel de loyer).
  Les logements existants sont des colocations.
- **Le sélecteur « Logement »** en haut de l'écran, à côté de l'exercice,
  choisit le logement affiché dans toutes les pages (Loyers, Cautions, Charges,
  États des lieux, Logements & baux). Il est mémorisé sur l'appareil.
  « Tous les logements » montre tout, logement par logement : dans « Loyers »,
  un bandeau par logement (bouton « Ce logement seul ») et un sous-total
  (attendu, encaissé, reste) sous chacun ; les tuiles du haut cumulent tout.
- **Rattachement** : baux, loyers, cautions, régularisations et états des lieux
  suivent le logement de leur bail. Un état des lieux peut aussi se rattacher
  directement à un logement de courte durée (« sans bail »).
- **Courte durée** : dans « Loyers », la carte « Séjours » du logement liste
  chaque séjour (arrivée, départ, nombre de nuits, voyageur, plateforme, montant
  perçu net des frais de plateforme) et son encaissement (« Encaissé »). Les
  recettes des séjours s'ajoutent aux tuiles de l'année. Pas de caution ni de
  régularisation de charges pour ces logements.
- **Appel de loyer** : réglé logement par logement (voir la section suivante).
- **Espace colocataire** : l'en-tête indique le logement du colocataire.
- Le sélecteur n'apparaît qu'une fois au moins un logement déclaré ; avec un
  seul logement, il propose « Tous » et ce logement.

## L'appel de loyer automatique (v26, par logement depuis la v35, dossier `functions-appel-loyer/`)

Dans l'application : Paramètres → **Appel de loyer automatique** : un bloc
par logement (sauf courte durée) avec ses boutons « Réglages »,
« E-mail de test… » et « Envoyer maintenant… ». « Réglages » : activez l'envoi,
choisissez le jour du mois (par exemple le 1er), le loyer appelé (celui du
mois de l'envoi, ou du mois suivant), l'objet, vos coordonnées de paiement
(IBAN…) et un message facultatif — **propres à ce logement**. Les réglages
faits avant la v35 (communs) servent de valeurs par défaut à tout logement
qui n'a pas encore les siens ; l'historique indique le logement de chaque
envoi, et les envois d'avant la v35 restent pris en compte (pas de doublon).
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
   serveur chaque jour à 8 h 10 (heure de Paris), qui envoie, logement par
   logement, si c'est le jour — sans qu'il soit besoin d'ouvrir l'application ;
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
