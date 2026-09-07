// Construit la bibliothèque partagée de la fonction planifiée (appel de
// loyer) : le module appel-loyer.js et ses dépendances (calculs, formats)
// regroupés en un seul fichier ESM pour Node, dans en-ligne/functions-appel-loyer/lib/.
import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const ici = path.dirname(new URL(import.meta.url).pathname);
const sortie = path.join(path.dirname(ici), 'en-ligne', 'functions-appel-loyer', 'lib', 'appel-loyer.js');
fs.mkdirSync(path.dirname(sortie), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(ici, 'js/appel-loyer.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  charset: 'utf8',
  outfile: sortie,
  banner: { js: '// Fichier généré par Application/construire-fonctions.mjs — ne pas modifier à la main.' },
});
// La fonction a aussi besoin de nomMois pour la copie récapitulative.
let code = fs.readFileSync(sortie, 'utf8');
if (!/export\s*\{[^}]*\bnomMois\b/.test(code)) {
  code = code.replace(/export\s*\{/, 'export { nomMois, ');
  fs.writeFileSync(sortie, code, 'utf8');
}
console.log(`Écrit : ${sortie} (${(fs.statSync(sortie).size / 1024).toFixed(0)} Ko)`);
