# Gestion LMNP

Application de gestion locative meublée, entièrement contenue dans un dossier
OneDrive partagé. Aucune installation, aucun compte, aucun service en ligne :
les données sont des fichiers du dossier, et OneDrive les synchronise entre les
personnes qui y ont accès.

## Installation

1. Copiez **le contenu de ce dossier** dans le dossier partagé, par exemple :

   ```
   C:\Users\…\OneDrive\Dossier de partage\Location maison SML\LMNP ANIKA\Gestion LMNP ANIKA
   ```

   Vous devez y retrouver, côte à côte, `Gestion LMNP.cmd` et le dossier
   `Application`.

2. Double-cliquez sur **`Gestion LMNP.cmd`**.

   Une fenêtre noire s'ouvre — c'est le moteur de l'application, laissez-la
   ouverte — puis l'application s'affiche dans le navigateur.

3. Faites de même sur le second poste. Chacun lance l'application depuis le
   dossier partagé ; les données sont communes.

Windows peut afficher un avertissement au premier lancement si les fichiers ont
été téléchargés depuis Internet : **Informations complémentaires → Exécuter
quand même**. Pour l'éviter, faites un clic droit sur `Gestion LMNP.cmd` →
*Propriétés* → cochez *Débloquer*.

**Astuce :** clic droit sur `Gestion LMNP.cmd` → *Envoyer vers* → *Bureau (créer
un raccourci)*.

## Ce que contient le dossier

| Dossier | Contenu |
| --- | --- |
| `Gestion LMNP.cmd` | Le lanceur. C'est le seul fichier à ouvrir. |
| `Application\` | Le code de l'application. Ne pas modifier. |
| `Factures\` | **Déposez ici vos factures.** Elles sont lues et intégrées en comptabilité, puis rangées dans `Traitées\<année>`. |
| `Documents\` | Baux, états des lieux, diagnostics, courriers. |
| `Données\` | Les données de l'application, un fichier JSON par type. Créé au premier lancement. |
| `Sauvegardes\` | Copie datée des données, faite automatiquement à la première modification de chaque journée. Conservée six mois. |
| `Corbeille\` | Les fichiers écartés depuis l'application. Rien n'est supprimé définitivement. |

## Le circuit d'une facture

Déposez le PDF (ou la photo) dans `Factures`, depuis l'explorateur Windows ou
par glisser-déposer dans l'application. La date, le montant, le fournisseur et
la catégorie sont lus dans le **nom du fichier** :

```
2026-03-15 EDF 84,20.pdf
2026-02-01 Taxe fonciere 1250.pdf
2026-04-22 Leroy Merlin 137,90 robinetterie.pdf
```

La page **Factures** propose alors la dépense correspondante : vous validez, ou
vous corrigez. Le fichier est ensuite rangé et rattaché à la dépense. L'option
« Intégrer automatiquement à l'ouverture » traite sans confirmation toutes les
factures lues sans ambiguïté.

La date peut aussi s'écrire `15-03-2026` ou `20260315`. Un nom incomplet n'est
pas un problème : la facture reste en attente et vous la complétez à la main.

## Ce que fait l'application

- **Loyers** — échéances mensuelles déduites des baux, encaissements, impayés,
  quittances et avis d'échéance imprimables, révision du loyer selon l'IRL.
- **Charges** — dépenses par catégorie, part déductible, justificatif rattaché.
- **Amortissements** — décomposition du prix de revient en composants (gros
  œuvre, façade, installations, agencements, mobilier), amortissement linéaire
  au prorata temporis, plan pluriannuel.
- **Emprunt** — échéancier calculé, intérêts et assurance repris
  automatiquement dans le résultat.
- **Résultat fiscal** — recettes, charges, plafonnement des amortissements
  (article 39 C II 2° du CGI), amortissements réputés différés, report des
  déficits sur dix ans, et une page d'optimisation qui signale ce qui reste à
  faire.
- **Liasse fiscale** — les montants à reporter sur la 2031-SD, les annexes
  2033-A à 2033-D et la 2042-C-PRO, avec des contrôles avant dépôt.

Ce qu'elle ne fait pas : la télétransmission de la liasse (dépôt en EDI-TDFC),
le suivi du compte bancaire, la lecture du contenu des PDF. Elle ne remplace pas
un conseil fiscal : les taux, plafonds et numéros de case changent d'une année
sur l'autre et restent à vérifier.

## Travailler à deux

Les modifications sont écrites dans le dossier partagé et reprises par l'autre
poste dans la minute. Si vous modifiez chacun une ligne différente, les deux
saisies sont conservées ; sur une même ligne, la dernière enregistrée l'emporte.

Le bouton **Actualiser** force la relecture du dossier. Si OneDrive crée une
copie de conflit dans `Données`, un bandeau orange le signale en haut de
l'écran.

Évitez les longues séances de saisie simultanée sur les deux postes : la
synchronisation OneDrive prend parfois quelques minutes.

## Dépannage

| Symptôme | Que faire |
| --- | --- |
| L'application ne s'ouvre pas | Vérifiez que la fenêtre noire « Gestion LMNP — serveur » est ouverte. Sinon relancez `Gestion LMNP.cmd`. |
| « Dossier inaccessible » | OneDrive synchronise, ou la fenêtre du serveur a été fermée. Relancez le lanceur. |
| Une saisie a disparu | Ouvrez `Sauvegardes\<date>`, repérez le fichier voulu et recopiez-le dans `Données`. |
| Fermer proprement | Bouton « Quitter l'application » en bas à gauche, ou fermez la fenêtre noire. |

## Fonctionnement technique

Le lanceur démarre un petit serveur écrit en PowerShell (présent sur tout
Windows) qui n'écoute que sur `127.0.0.1` : rien n'est exposé sur le réseau, et
aucun droit administrateur n'est nécessaire. L'interface est du HTML, du CSS et
du JavaScript natif, sans dépendance externe et sans étape de compilation — elle
fonctionne donc hors ligne, sur Edge, Chrome ou Firefox.

Les écritures sont atomiques et protégées par un contrôle de version : si le
fichier a changé entre-temps sur l'autre poste, la modification est rejouée sur
la version fraîche plutôt qu'écrasée.
