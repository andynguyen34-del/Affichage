// Prépare node_modules/ de la fonction pour être livré tel quel (zip
// extrait sous Windows) : npm y crée des liens symboliques dans les dossiers
// .bin, qu'un zip transforme en copies dont les require() relatifs ne
// résolvent plus. Chaque lien est remplacé par un petit lanceur JavaScript
// qui charge la cible depuis son emplacement d'origine (plus un .cmd pour
// un usage manuel sous Windows).
import fs from 'node:fs';
import path from 'node:path';

const ici = path.dirname(new URL(import.meta.url).pathname);
const racine = path.join(path.dirname(ici), 'en-ligne', 'functions-appel-loyer', 'node_modules');

let corriges = 0;
const parcourir = (dossier) => {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isSymbolicLink()) {
      const cible = fs.readlinkSync(chemin).replace(/\\/g, '/');
      if (!cible.startsWith('.')) continue; // lien absolu : hors sujet
      fs.unlinkSync(chemin);
      fs.writeFileSync(chemin, `#!/usr/bin/env node\nrequire(${JSON.stringify(cible)});\n`, { mode: 0o755 });
      fs.writeFileSync(`${chemin}.cmd`, `@node "%~dp0\\${cible.replace(/\//g, '\\')}" %*\r\n`);
      corriges += 1;
    } else if (entree.isDirectory()) {
      parcourir(chemin);
    }
  }
};
if (fs.existsSync(racine)) parcourir(racine);
console.log(`Liens remplacés par des lanceurs : ${corriges}`);
