// Construit la version hébergée (« nuage ») : un index.html autonome dans
// en-ligne/public/, où l'accès aux données passe par Firebase (api-nuage.js)
// au lieu du dossier partagé (api.js).
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ici = path.dirname(new URL(import.meta.url).pathname);
const racine = path.dirname(ici);

// 1. Regrouper le JavaScript, en remplaçant api.js par api-nuage.js.
const basculeApi = {
  name: 'bascule-api-nuage',
  setup(build) {
    build.onResolve({ filter: /api\.js$/ }, (args) => {
      if (path.basename(args.path) !== 'api.js') return null;
      return { path: path.join(ici, 'js', 'api-nuage.js') };
    });
  },
};

const resultat = await esbuild.build({
  entryPoints: [path.join(ici, 'js/app.js')],
  bundle: true,
  format: 'iife',
  charset: 'utf8',
  legalComments: 'none',
  minify: true,
  write: false,
  plugins: [basculeApi],
});
const bundle = resultat.outputFiles[0].text;
if (bundle.includes('</script')) throw new Error('Le code contient </script> : intégration impossible.');

// 2. Assembler le HTML autonome.
const css = fs.readFileSync(path.join(ici, 'css/app.css'), 'utf8');
let html = fs.readFileSync(path.join(ici, 'index.html'), 'utf8');
// Remplacement par fonction : un « $& » dans le code inséré serait sinon
// interprété par String.replace comme motif spécial et corromprait la page.
html = html.replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${bundle}\n</script>`);

// 3. Écrire dans le dossier de déploiement Firebase Hosting.
const dossierPublic = path.join(racine, 'en-ligne', 'public');
fs.mkdirSync(dossierPublic, { recursive: true });
const sortie = path.join(dossierPublic, 'index.html');
fs.writeFileSync(sortie, html, 'utf8');
console.log(`Écrit : ${sortie} (${(fs.statSync(sortie).size / 1024).toFixed(0)} Ko)`);
