/**
 * Reinitialise le mot de passe administrateur depuis le serveur, quand il a ete
 * oublie.
 *
 *   node scripts/reset-password.js "NouveauMotDePasse"
 *   docker compose exec affichage node scripts/reset-password.js "NouveauMotDePasse"
 */
import bcrypt from 'bcryptjs';
import { db, setSetting } from '../src/db.js';

const motDePasse = process.argv[2];

if (!motDePasse || motDePasse.length < 6) {
  console.error('Usage : node scripts/reset-password.js "<nouveau mot de passe>"');
  console.error('Le mot de passe doit faire au moins 6 caracteres.');
  process.exit(1);
}

setSetting('admin_password_hash', bcrypt.hashSync(motDePasse, 10));
setSetting('admin_password_is_default', '0');
db.prepare('DELETE FROM sessions').run();

console.log('Mot de passe administrateur reinitialise. Toutes les sessions ouvertes ont ete fermees.');
