#!/usr/bin/env bash
# Fabrique le zip unique de livraison : deploiement-LMNP-vNN.zip
#   usage : livraison/emballer.sh NN [dossier-de-sortie] [sauvegarde-donnees.json]
# À lancer après `node construire-en-ligne.mjs` et `node construire-fonctions.mjs`
# (dossier Application). Le zip ne contient pas node_modules : DEPLOYER.cmd
# installe les bibliothèques à la première exécution dans le dossier.
set -euo pipefail
VERSION="${1:?numéro de version attendu (ex. 40)}"
SORTIE="${2:-.}"
SAUVEGARDE="${3:-}"
ICI="$(cd "$(dirname "$0")/.." && pwd)"
TRAVAIL="$(mktemp -d)"
Z="$TRAVAIL/z"
mkdir -p "$Z/functions-appel-loyer/lib"
cd "$ICI"
cp firebase.json .firebaserc firestore.rules storage.rules LISEZ-MOI.md "$Z/"
cp -r public "$Z/"
cp functions-appel-loyer/{index.js,relais-fichiers.js,signature-distante.js,package.json,package-lock.json} "$Z/functions-appel-loyer/"
cp functions-appel-loyer/lib/{appel-loyer.js,contradictoire.js} "$Z/functions-appel-loyer/lib/"
cp livraison/DEPLOYER.cmd "$Z/"
[ -n "$SAUVEGARDE" ] && cp "$SAUVEGARDE" "$Z/sauvegarde-donnees.json"
grep -q "$VERSION — " public/index.html || { echo "public/index.html n'est pas construit en v$VERSION" >&2; exit 1; }
mkdir -p "$SORTIE"
ZIP="$(cd "$SORTIE" && pwd)/deploiement-LMNP-v$VERSION.zip"
rm -f "$ZIP"
(cd "$Z" && zip -qr "$ZIP" .)
rm -rf "$TRAVAIL"
echo "$ZIP"
