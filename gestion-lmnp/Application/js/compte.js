// Changement de mot de passe du compte connecté (gérant comme colocataire).

import * as api from './api.js';
import { formulaire, notifier } from './ui.js';

export async function ouvrirChangementMotDePasse() {
  const saisie = await formulaire({
    titre: 'Changer mon mot de passe',
    aide: 'Le mot de passe actuel est demandé par sécurité. Le nouveau doit compter au moins 6 caractères.',
    champs: [
      { cle: 'actuel', libelle: 'Mot de passe actuel', type: 'motdepasse', requis: true },
      { cle: 'nouveau', libelle: 'Nouveau mot de passe', type: 'motdepasse', requis: true },
      { cle: 'confirmation', libelle: 'Confirmez le nouveau mot de passe', type: 'motdepasse', requis: true },
    ],
    libelleValider: 'Changer',
  });
  if (!saisie) return;
  if (saisie.nouveau !== saisie.confirmation) { notifier('La confirmation ne correspond pas au nouveau mot de passe.', 'erreur'); return; }
  if (String(saisie.nouveau).length < 6) { notifier('Le nouveau mot de passe doit compter au moins 6 caractères.', 'erreur'); return; }
  try {
    await api.changerMotDePasse(saisie.actuel, saisie.nouveau);
    notifier('Mot de passe changé.', 'succes');
  } catch (erreur) { notifier(erreur.message, 'erreur'); }
}
