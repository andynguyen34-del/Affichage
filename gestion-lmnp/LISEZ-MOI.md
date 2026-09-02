# Gestion LMNP

Application de gestion locative meublée, entièrement contenue dans un dossier
OneDrive partagé. **Aucune installation, aucun programme à lancer** : c'est une
page web que vous ouvrez dans Google Chrome (ou Microsoft Edge), et qui lit et
écrit directement dans le dossier. Rien n'est envoyé sur Internet.

## Installation

1. Copiez **le contenu de ce dossier** dans le dossier partagé, par exemple :

   ```
   C:\Users\…\OneDrive\Dossier de partage\Location maison SML\LMNP ANIKA\Gestion LMNP ANIKA
   ```

   Vous devez y retrouver le fichier **`Gestion LMNP.html`** et les dossiers
   `Données`, `Factures`, `Documents`.

2. Faites un clic droit sur **`Gestion LMNP.html`** → *Ouvrir avec* →
   **Google Chrome** (ou Microsoft Edge).

   > Astuce : pour ouvrir d'un simple double-clic la prochaine fois, choisissez
   > *Ouvrir avec → Choisir une autre application → Google Chrome → Toujours*.

3. Au premier lancement, cliquez sur **« Choisir le dossier partagé »** et
   désignez le dossier `Gestion LMNP ANIKA` (celui qui contient ce fichier).
   Chrome vous demande d'autoriser l'accès : acceptez. **Vous ne le ferez
   qu'une fois** ; ensuite un simple clic « Reconnecter » suffit.

4. Karine fait de même sur son poste, avec le même dossier partagé.

### Pourquoi Chrome ou Edge ?

Ces deux navigateurs savent lire et écrire dans un dossier local avec votre
autorisation. Firefox ne le permet pas encore. Si vous ouvrez le fichier avec
Firefox, l'application vous le signalera.

## Ce que contient le dossier

| Élément | Contenu |
| --- | --- |
| `Gestion LMNP.html` | L'application. C'est le seul fichier à ouvrir. |
| `Données\` | Les données de l'application (un fichier JSON par type). |
| `Factures\` | **Déposez ici vos factures.** Elles sont lues et intégrées en comptabilité, puis rangées dans `Traitées\<année>`. |
| `Documents\` | Baux, états des lieux, diagnostics, courriers. |
| `Sauvegardes\` | Copie datée des données, faite automatiquement. |
| `Corbeille\` | Fichiers écartés depuis l'application. Rien n'est supprimé définitivement. |
| `Application\` | Le code source (lisible). Sert à reconstruire le fichier HTML ; inutile au quotidien. |

## Le circuit d'une facture

Déposez le PDF (ou la photo) dans `Factures`, depuis l'explorateur Windows ou
par glisser-déposer dans l'application. La date, le montant, le fournisseur et
la catégorie sont lus dans le **nom du fichier** :

```
2026-03-15 EDF 84,20.pdf
2026-02-01 Taxe fonciere 1250.pdf
```

La page **Factures** propose alors la dépense : vous validez, ou vous corrigez.
Le fichier est ensuite rangé et rattaché.

## Travailler à deux

Les modifications sont écrites dans le dossier partagé et reprises par l'autre
poste dans la minute. Si vous modifiez chacun une donnée différente, les deux
saisies sont conservées. Évitez de saisir au même instant la même chose sur les
deux postes : OneDrive créerait alors une copie de conflit, que l'application
signale par un bandeau.

## Dépannage

| Symptôme | Que faire |
| --- | --- |
| « Cette application a besoin de Chrome ou Edge » | Vous l'avez ouverte avec Firefox ou un autre navigateur. Rouvrez `Gestion LMNP.html` avec Chrome. |
| L'application redemande le dossier à chaque fois | Normal si votre Chrome n'autorise pas la mémorisation pour les fichiers locaux : cliquez « Choisir le dossier », c'est tout. |
| Une saisie a disparu | Ouvrez `Sauvegardes\<date>`, repérez le fichier voulu et recopiez-le dans `Données`. |

## Fonctionnement technique

C'est une page web autonome (`Gestion LMNP.html`) : tout le code — HTML, style
et JavaScript — est réuni dans ce seul fichier, sans dépendance externe. Elle
utilise l'API « File System Access » de Chrome/Edge pour lire et écrire dans le
dossier que vous désignez. **Il n'y a aucun serveur, aucun programme installé,
aucun port réseau** — ce qui évite toute alerte d'antivirus.

Les écritures sont atomiques et protégées par empreinte : si l'autre poste a
écrit entre-temps, la modification est rejouée sur la version fraîche plutôt
qu'écrasée.

### Reconstruire le fichier HTML

Le code source lisible est dans `Application\`. Pour régénérer
`Gestion LMNP.html` après une modification (nécessite Node.js) :

```
cd Application
node construire.mjs
```

Ce qu'elle ne fait pas : elle ne télétransmet pas la liasse (dépôt en
EDI-TDFC), ne suit pas le compte bancaire, et ne lit pas l'intérieur des PDF
(seul le nom du fichier est analysé). Les taux, plafonds et repères de case
sont modifiables dans les Paramètres.
