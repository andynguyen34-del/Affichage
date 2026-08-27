# Gestion LMNP — hébergement privé dédié (Firebase)

L'application est une page web hébergée sur Firebase Hosting, dans un projet
**dédié uniquement à la gestion personnelle** : `gestion-lmnp-anika`.
Rien n'est partagé avec les autres outils (Planning CTTH, projet `ctth-app`…) :
projet distinct, base distincte, adresse distincte — et le fichier
`.firebaserc` de ce dossier épingle le projet, si bien qu'un
`firebase deploy` lancé ici ne peut PAS toucher un autre projet.

Les données comptables vivent dans Firestore, les justificatifs (factures,
documents) dans Firebase Storage, et l'accès est protégé par un compte
e-mail + mot de passe. Plus aucun accès aux fichiers du poste : les blocages
de sécurité locaux ne s'appliquent plus.

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

## Les factures

Déposez les PDF directement dans la page **Factures** de l'application
(bouton ou glisser-déposer) : la date, le montant, le fournisseur et la
catégorie sont lus dans le nom du fichier, comme avant. Le dossier OneDrive
n'est plus surveillé.
