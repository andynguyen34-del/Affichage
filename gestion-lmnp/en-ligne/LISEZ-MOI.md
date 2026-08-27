# Gestion LMNP — version en ligne (Firebase)

L'application est une page web hébergée sur Firebase Hosting. Les données
comptables vivent dans Firestore, les justificatifs (factures, documents)
dans Firebase Storage, et l'accès est protégé par un compte e-mail + mot de
passe. Plus aucun accès aux fichiers du poste : les blocages de sécurité
locaux ne s'appliquent plus.

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

## Mise en place (une seule fois, ~10 minutes)

1. **Créer le projet** — sur https://console.firebase.google.com :
   « Ajouter un projet », nom par exemple `gestion-lmnp-anika`
   (Google Analytics inutile : décochez).

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
   firebase login          (si ce n'est pas déjà fait)
   firebase use --add      (choisir le projet créé à l'étape 1)
   firebase deploy
   ```

8. **Reprendre la comptabilité** — ouvrez `https://<projet>.web.app`,
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
fichier, puis relancer `firebase deploy` dans ce dossier. L'adresse ne
change pas.

## Les factures

Déposez les PDF directement dans la page **Factures** de l'application
(bouton ou glisser-déposer) : la date, le montant, le fournisseur et la
catégorie sont lus dans le nom du fichier, comme avant. Le dossier OneDrive
n'est plus surveillé.
