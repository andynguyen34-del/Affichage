// Construit « Gestion LMNP.html » : un fichier HTML autonome (CSS + JavaScript
// intégrés), sans aucun fichier externe à charger — indispensable pour que
// l'application s'ouvre directement par double-clic (file://) dans Chrome.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ici = path.dirname(new URL(import.meta.url).pathname);
const racine = path.dirname(ici);

// 1. Regrouper tout le JavaScript en un seul bloc.
const bundle = execSync(
  'npx --yes esbuild@0.24.0 js/app.js --bundle --format=iife --charset=utf8 --legal-comments=none',
  { cwd: ici, maxBuffer: 32 * 1024 * 1024 },
).toString();

if (bundle.includes('</script')) throw new Error('Le code contient </script> : intégration impossible sans échappement.');

// 2. Lire le CSS et le HTML.
const css = fs.readFileSync(path.join(ici, 'css/app.css'), 'utf8');
let html = fs.readFileSync(path.join(ici, 'index.html'), 'utf8');

// 3. Remplacer les références externes par le contenu intégré.
html = html.replace('<link rel="stylesheet" href="css/app.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/app.js"></script>', `<script>\n${bundle}\n</script>`);

// 4. Écrire le fichier autonome à la racine du dossier partagé.
const sortie = path.join(racine, 'Gestion LMNP.html');
fs.writeFileSync(sortie, html, 'utf8');
const taille = (fs.statSync(sortie).size / 1024).toFixed(0);
console.log(`Écrit : ${sortie} (${taille} Ko, autonome)`);
