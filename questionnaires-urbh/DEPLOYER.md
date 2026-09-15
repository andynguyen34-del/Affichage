# DÉPLOYER — Questionnaires URBH

## Le plus simple : double-cliquer sur `DEPLOYER.bat`

Le script se place tout seul dans le bon dossier, vérifie que l'outil
Firebase est installé, lance le déploiement complet (pages + règles de
sécurité) et affiche le résultat. C'est la méthode recommandée.

La suite de cette fiche décrit la méthode manuelle et les vérifications.

## La commande manuelle (équivalente au script)

Tout se lance **depuis ce dossier** (celui qui contient `firebase.json`),
dans un terminal (cmd ou PowerShell).

```
firebase deploy --only hosting,firestore --project questionnaires-urbh
```

- `hosting` publie les pages de l'application ;
- `firestore` publie les **règles de sécurité** — indispensable au premier
  déploiement et à chaque fois que `firestore.rules` a changé. L'inclure
  quand ce n'est pas nécessaire est **sans danger** : dans le doute,
  gardez toujours la commande complète.

Si le terminal n'est pas connecté : `firebase login` d'abord
(compte `andynguyen34@gmail.com`).

## Vérifier que le déploiement est bien passé

1. La commande se termine par **`Deploy complete!`** et affiche
   `Hosting URL: https://questionnaires-urbh.web.app`.
2. Ouvrez https://questionnaires-urbh.web.app/portail.html et faites
   **Ctrl+F5** : le numéro de version en bas de page (« — vNN ») doit
   correspondre à la livraison annoncée. S'il est en retard, vous avez
   probablement déployé depuis un ancien dossier.

## Les pièges connus

- **Mauvais dossier** : plusieurs zips décompressés traînent dans
  Téléchargements → vérifiez que vous êtes dans le dossier de la
  **dernière** livraison avant de lancer la commande.
- **Tirets** : `--only` et `--project` prennent deux tirets courts ;
  recopiés depuis Word ils deviennent parfois un tiret long et la
  commande échoue. Copiez-les depuis ce fichier.
- **Erreur `permission-denied` dans l'application** après une mise à
  jour : les règles n'ont pas suivi → relancez la commande complète
  (avec `firestore`).

## Adresses de l'application

| Adresse | Usage |
| --- | --- |
| https://questionnaires-urbh.web.app/ | Administration (connexion) |
| https://questionnaires-urbh.web.app/portail.html | Portail participants (QR des flyers) |

## SMS automatiques (plan Blaze) — mise en service une seule fois

1. Console Firebase → projet `questionnaires-urbh` → en bas à gauche,
   **passer au plan Blaze** (carte bancaire ; usage attendu : quelques euros).
2. Créer un compte **Brevo** (brevo.com), activer le **SMS transactionnel**
   (expéditeur « URBH ») et créditer quelques euros de SMS, puis copier une
   **clé API v3** (Paramètres → Clés API).
3. Dans ce dossier, en terminal : `firebase functions:secrets:set BREVO_API_KEY`
   puis coller la clé (elle est stockée chiffrée chez Google, jamais dans les fichiers).
4. Double-clic sur **`DEPLOYER-FONCTIONS.bat`**.

Ensuite, chaque désistement d'atelier envoie automatiquement le SMS à la
personne promue. `DEPLOYER.bat` reste inchangé pour les pages et les règles.
