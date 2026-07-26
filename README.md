# Affichage Usine

Application d'affichage d'indicateurs sur les écrans de l'usine, alimentée
automatiquement par les fichiers Excel déjà présents sur le partage réseau de
l'entreprise.

Le serveur relit périodiquement les classeurs, en extrait les données, calcule
les indicateurs et les diffuse aux téléviseurs connectés au wifi. Aucune saisie
manuelle, aucun changement d'habitude pour les personnes qui tiennent les
fichiers Excel.

## Ce que fait l'application

**Collecte.** Vous déclarez l'emplacement d'un fichier sur le partage (dossier,
motif du nom, feuille, ligne des en-têtes). Le serveur vérifie à intervalle
régulier si le fichier a changé et ne le relit que dans ce cas. Les colonnes
sont détectées automatiquement, avec leur type (nombre, date, texte), et les
écritures françaises sont comprises : `1 234,56`, `45 %`, `12/05/2026`.

**Indicateurs.** Sur ces données, vous définissez des calculs nommés (somme,
moyenne, comptage, min, max, dernière valeur) avec filtres, objectif et seuils
de couleur. Une valeur au-delà du seuil fait passer la tuile en orange puis en
rouge, dans le bon sens selon qu'une valeur haute est bonne (production) ou
mauvaise (rebuts).

**Affichage.** Une *vue* est une page composée de tuiles : indicateurs chiffrés,
jauges, barres, courbes, camemberts, Pareto, tableaux, horloge, texte libre. Un
*écran* enchaîne plusieurs vues en boucle, avec une durée par vue.

**Exploitation.** Chaque écran est une simple adresse à ouvrir en plein écran
sur le poste relié au téléviseur. La page se met à jour seule, survit aux
coupures réseau (elle continue d'afficher les dernières données connues en le
signalant) et se recharge une fois par jour.

## Installation

### Prérequis

Une machine sur le réseau de l'entreprise avec Docker et Docker Compose, et un
accès en lecture au partage contenant les fichiers Excel.

### Mise en route

```bash
git clone <url-du-depot> affichage
cd affichage
cp .env.example .env
# renseigner SMB_SHARE, SMB_USER, SMB_PASSWORD, ADMIN_PASSWORD, SESSION_SECRET
docker compose up -d --build
```

L'application écoute sur le port 8080 :

| Adresse | Usage |
| --- | --- |
| `http://<serveur>:8080/` | Page d'accueil, liste des écrans |
| `http://<serveur>:8080/admin` | Administration (mot de passe) |
| `http://<serveur>:8080/ecran/<clé>` | Un écran de l'atelier |
| `http://<serveur>:8080/vue/<clé>` | Une vue seule, sans rotation |

Connectez-vous à l'administration avec le mot de passe défini dans
`ADMIN_PASSWORD`, puis changez-le immédiatement depuis **Paramètres**.

### Accès au partage réseau

`docker-compose.yml` propose deux méthodes, au choix.

**A — Docker monte le partage lui-même** (par défaut). Renseignez dans `.env` :

```
SMB_SHARE=serveur-fichiers/Qualite/Indicateurs   # sans les antislashs
SMB_USER=lecture_indicateurs
SMB_PASSWORD=…
SMB_DOMAIN=WORKGROUP
```

Utilisez de préférence un compte de service en lecture seule, dédié à cet usage.

**B — Le partage est déjà monté sur la machine hôte.** Remplacez dans le service
la ligne `- partage:/partage:ro` par un montage direct, par exemple
`- /mnt/qualite:/partage:ro`, et supprimez le volume `partage` en bas du
fichier.

Dans les deux cas, le partage est monté **en lecture seule** : l'application ne
peut ni modifier ni supprimer vos fichiers Excel.

### Démonstration

Pour valider l'installation avant de brancher les vrais fichiers, un jeu de
démonstration crée un classeur d'exemple et toute la configuration associée
(deux vues, un écran). Il a besoin d'un dossier accessible en écriture :

```bash
SOURCE_ROOT=/tmp/partage-demo npm install
SOURCE_ROOT=/tmp/partage-demo npm run seed
SOURCE_ROOT=/tmp/partage-demo npm start
```

Puis ouvrez `http://localhost:8080/ecran/atelier`.

## Configuration pas à pas

1. **Sources Excel** — déclarez où se trouve le fichier. L'explorateur intégré
   permet de parcourir le partage sans risque d'erreur de frappe, et le bouton
   « Tester » affiche le fichier retenu, ses feuilles et ses colonnes.
   Si un nouveau classeur est déposé chaque semaine, mettez un motif
   (`Production_*.xlsx`) et laissez « le fichier modifié le plus récemment ».

2. **Jeux de données** — pour chaque feuille utile, indiquez la ligne des
   en-têtes et les colonnes à conserver. L'aperçu montre en direct ce que le
   serveur lira.

3. **Indicateurs** — les calculs que vous réutiliserez sur plusieurs écrans, avec
   objectif et seuils. Le résultat s'affiche pendant la saisie.

4. **Vues** — composez la page. La grille fait 12 colonnes : une tuile de
   largeur 6 occupe la moitié de l'écran, une tuile de largeur 4 un tiers.
   L'aperçu à droite utilise les données réelles.

5. **Écrans** — assemblez les vues en diaporama et relevez l'adresse à ouvrir
   sur le poste.

## Mise en service d'un poste

1. Reliez le mini-PC ou la clé Android au téléviseur et au wifi de l'entreprise.
2. Ouvrez le navigateur à l'adresse de l'écran, puis passez en plein écran
   (`F11`).
3. Désactivez la mise en veille de l'écran et de la machine.
4. Configurez le navigateur pour rouvrir cette page au démarrage, afin que
   l'affichage reprenne seul après une coupure de courant.

Ajoutez `?theme=clair` à l'adresse pour un écran exposé en pleine lumière.

Un clavier branché sur le poste permet quelques raccourcis : `←` et `→` pour
changer de vue, `R` pour forcer un rafraîchissement, `F` pour le plein écran.

## Exploitation courante

**Un indicateur n'est plus à jour ?** Le **Journal d'import** dit pourquoi :
fichier introuvable, feuille renommée, colonne disparue. La rubrique **Sources**
affiche l'état de chaque source et un bouton pour forcer un import.

**Formats acceptés :** `.xlsx`, `.xlsm`, `.csv`, `.txt`. Un fichier `.xls`
(ancien format Excel) doit être réenregistré en `.xlsx`. Les fichiers temporaires
d'Excel (`~$Classeur.xlsx`) sont ignorés — un classeur ouvert par un collègue ne
perturbe donc pas la collecte.

**Sauvegarde.** Toute la configuration et les données collectées tiennent dans le
volume Docker `affichage-data`. C'est lui qu'il faut sauvegarder :

```bash
docker run --rm -v affichage-data:/data -v "$PWD:/sauvegarde" alpine \
  tar czf /sauvegarde/affichage-$(date +%F).tar.gz -C /data .
```

Le bouton « Télécharger la configuration » de la page **Paramètres** exporte en
plus un fichier JSON lisible, utile pour garder une trace avant une modification
importante.

**Mot de passe oublié :**

```bash
docker compose exec affichage node scripts/reset-password.js "NouveauMotDePasse"
```

## Sécurité

Les pages d'affichage sont volontairement accessibles sans authentification : un
écran mural n'a personne pour saisir un mot de passe. Elles sont strictement en
lecture seule. Seule l'interface d'administration est protégée par mot de passe.

L'application est prévue pour un réseau interne et n'a pas vocation à être
exposée sur Internet. Si vous devez y accéder de l'extérieur, passez par le VPN
de l'entreprise.

Toute lecture de fichier est confinée sous `SOURCE_ROOT` : une saisie du type
`../../etc` est refusée.

## Architecture

```
src/
  server.js            serveur HTTP et service des pages
  config.js            variables d'environnement
  db.js                schéma SQLite et accès base
  lib/
    paths.js           résolution des chemins, confinée sous SOURCE_ROOT
    excel.js           lecture des classeurs et des CSV
    values.js          conversion des valeurs (nombres, dates françaises)
    importer.js        mapping des colonnes et écriture en base
    query.js           moteur de requêtes (filtres, regroupements, agrégats)
    render.js          résolution des tuiles et de la charge utile d'un écran
    scheduler.js       planificateur d'import
    auth.js            sessions et mot de passe administrateur
  routes/              auth.js, admin.js, display.js
public/
  index.html           page d'accueil
  admin.html           interface d'administration
  affichage.html       page plein écran des téléviseurs
  js/widgets.js        rendu des tuiles, partagé entre écran et aperçu
  js/admin/            interface d'administration (JavaScript natif, sans build)
```

Choix techniques : Node.js et SQLite, sans étape de compilation côté client.
Chart.js est servi depuis le serveur, jamais depuis Internet — indispensable sur
un réseau d'usine cloisonné. Le rendu d'une tuile est écrit une seule fois et
utilisé aussi bien par les écrans que par l'aperçu de l'administration, ce qui
garantit que ce qu'on voit en configurant est exactement ce qui s'affichera.

### Note sur les dépendances

`npm audit` signale des alertes provenant d'`exceljs`, toutes situées dans sa
chaîne d'*écriture* de fichiers (compression zip). L'application ne fait que
lire des classeurs ; seul le script de démonstration écrit. La correction
proposée par `npm audit fix --force` rétrograderait `exceljs` de trois versions
majeures et casserait la lecture — elle n'a donc pas été appliquée.
