# Gestion LMNP — gestion locative de la colocation (Firebase)

L'application gère la location, rien d'autre : virements de loyer des
colocataires, cautions (dépôts de garantie reçus/restitués), régularisation
annuelle des charges (provisions prélevées sur les loyers comparées aux
dépenses réelles d'eau et de taxe d'enlèvement des ordures ménagères, solde
par colocataire), quittances et décomptes PDF déposés sur l'espace de chaque
colocataire avec e-mail de mise à disposition, bail joint au dossier et
signé à l'écran (tablette) puis mis à disposition de chaque colocataire,
états des lieux avec reportage photo, plan du logement à repères numérotés
et signatures — suivis d'une fenêtre de 3 semaines pendant laquelle chaque
colocataire dépose ses photos contradictoires depuis son espace. La
comptabilité, elle, se fait dans votre outil comptable en ligne.

**Important pour cette mise à jour (v13)** : les règles de sécurité du
Storage changent (dépôt des photos contradictoires par les colocataires).
La commande de déploiement habituelle les publie en même temps que
l'application — rien de plus à faire.

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
cette mise à jour, il suffit de remplacer `public/index.html` et de relancer
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

Quand une nouvelle version de `public/index.html` est livrée : remplacer le
fichier, puis relancer `firebase deploy --account andynguyen34@gmail.com`
dans ce dossier. L'adresse ne change pas.

## Les comptes des colocataires

1. Renseignez l'adresse e-mail du colocataire dans l'application
   (« Bien & baux » → Locataires → Modifier).
2. Ouvrez son accès dans « Paramètres → Accès à l'application ».
3. Créez son compte de connexion dans la console Firebase :
   Authentication → Users → « Add user » (même adresse + un mot de passe
   que vous lui communiquez).

Il se connecte alors à la même adresse que vous et ne voit que son espace :
ses quittances, l'état des lieux, son bail. Les règles de sécurité lui
interdisent tout le reste.

## L'envoi des quittances par e-mail (une fois)

L'application dépose chaque notification de mise à disposition (avec le
lien vers l'espace colocataire) dans la collection Firestore « mail ». Pour que l'envoi parte réellement, installez
l'extension officielle **Trigger Email from Firestore** :

1. Console Firebase → Extensions → rechercher « Trigger Email » → Installer.
2. « Email documents collection » : `mail`.
3. « SMTP connection URI » : votre compte d'envoi. Le plus simple :
   un compte gratuit Brevo (300 courriels/jour) — l'URI est de la forme
   `smtps://IDENTIFIANT:CLE@smtp-relay.brevo.com:465`.
4. Laissez le reste par défaut et validez.

Tant que l'extension n'est pas installée, les courriels restent en file :
rien n'est perdu, ils partiront après l'installation.

## Reprendre les données après cette mise à jour

Le fichier `sauvegarde-donnees.json` de cette livraison contient vos données
avec la répartition du bail entre les trois colocataires
(Nicolas 800 €, Léa 350 €, Ludovic 350 €, plus 200 € de charges à parts
égales — 1 700 €/mois au total). Importez-le : Paramètres → « Importer une sauvegarde… ».
