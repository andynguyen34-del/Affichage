// Cautions (dépôts de garantie) : ce qui est attendu, reçu et restitué,
// colocataire par colocataire.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, formulaire, executer } from '../ui.js';
import { montant, date, aujourdhui, centimes } from '../format.js';
import { fluxDuBail } from '../calculs/loyers.js';

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

/**
 * Une ligne de caution par payeur de chaque bail : ce qui est enregistré,
 * complété par les payeurs du bail qui n'ont pas encore de ligne.
 */
function lignesCautions(donnees) {
  const enregistrees = new Map(donnees.cautions.map((c) => [c.id, c]));
  const lignes = [];
  for (const bail of donnees.baux) {
    if (bail.type === 'saisonnier') continue; // pas de caution en saisonnier
    const flux = fluxDuBail(bail);
    const attenduParDefaut = flux.length
      ? centimes((Number(bail.depotGarantie) || 0) / flux.length) : 0;
    for (const payeur of flux) {
      const id = `${bail.id}-${String(payeur.locataireId).slice(0, 8)}`;
      const existante = enregistrees.get(id);
      enregistrees.delete(id);
      lignes.push({
        id,
        bailId: bail.id,
        locataireId: payeur.locataireId,
        attendu: attenduParDefaut,
        ...existante,
        bail,
      });
    }
  }
  // Lignes enregistrées dont le bail a disparu : on les garde visibles.
  for (const reste of enregistrees.values()) lignes.push({ ...reste, bail: null });
  return lignes;
}

function statutCaution(ligne) {
  if (ligne.restitueLe) return badge('Restituée', 'attente');
  if ((Number(ligne.montantRecu) || 0) >= (Number(ligne.attendu) || 0) - 0.01 && ligne.recuLe) return badge('Reçue', 'succes');
  if (ligne.recuLe) return badge('Partielle', 'attention');
  return badge('En attente', 'alerte');
}

async function modifierCaution(ligne) {
  const saisie = await formulaire({
    titre: 'Caution',
    aide: 'Renseignez ce qui a été convenu et ce qui a réellement été versé. '
      + 'À la fin du bail, notez la restitution (déduction faite des éventuelles retenues).',
    champs: [
      { cle: 'attendu', libelle: 'Montant convenu (€)', type: 'montant', requis: true },
      { cle: 'recuLe', libelle: 'Reçue le', type: 'date' },
      { cle: 'montantRecu', libelle: 'Montant reçu (€)', type: 'montant' },
      { cle: 'restitueLe', libelle: 'Restituée le', type: 'date' },
      { cle: 'montantRestitue', libelle: 'Montant restitué (€)', type: 'montant' },
      { cle: 'notes', libelle: 'Notes (retenues, mode de versement…)', type: 'zone' },
    ],
    valeurs: {
      attendu: ligne.attendu || 0,
      recuLe: ligne.recuLe || '',
      montantRecu: ligne.montantRecu || 0,
      restitueLe: ligne.restitueLe || '',
      montantRestitue: ligne.montantRestitue || 0,
      notes: ligne.notes || '',
    },
  });
  if (!saisie) return;
  await executer(etat.enregistrer('cautions', {
    id: ligne.id,
    bailId: ligne.bailId,
    locataireId: ligne.locataireId,
    attendu: Number(saisie.attendu) || 0,
    recuLe: saisie.recuLe || '',
    montantRecu: Number(saisie.montantRecu) || 0,
    restitueLe: saisie.restitueLe || '',
    montantRestitue: Number(saisie.montantRestitue) || 0,
    notes: saisie.notes || '',
  }), 'Caution enregistrée.');
}

export default {
  cle: 'cautions',
  libelle: 'Cautions',
  icone: '🛡️',
  titre: 'Cautions',
  sousTitre: 'Les dépôts de garantie : convenus, reçus, restitués.',
  compteur(contexte) {
    if (!contexte.donnees?.baux) return null;
    const enAttente = lignesCautions(contexte.donnees)
      .filter((l) => !l.restitueLe && (Number(l.montantRecu) || 0) < (Number(l.attendu) || 0) - 0.01).length;
    return enAttente || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const lignes = lignesCautions(donnees);
    const conteneur = h('div');

    const detenu = centimes(lignes.reduce((s, l) => s
      + (Number(l.montantRecu) || 0) - (l.restitueLe ? (Number(l.montantRestitue) || 0) : 0), 0));
    const attendu = centimes(lignes.filter((l) => !l.restitueLe).reduce((s, l) => s + (Number(l.attendu) || 0), 0));

    conteneur.append(h('div', { class: 'grille grille-3', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Convenu (baux en cours)', valeur: montant(attendu, { rond: true }) }),
      tuile({ libelle: 'Détenu actuellement', valeur: montant(detenu, { rond: true }), ton: 'neutre',
        detail: 'à restituer en fin de bail' }),
      tuile({ libelle: 'Lignes en attente', valeur: String(lignes.filter((l) => !l.recuLe && !l.restitueLe).length) }),
    ]));

    conteneur.append(carte({
      titre: 'Dépôts de garantie',
      aide: 'Le dépôt de garantie n’est pas un loyer : il se suit ici, pas dans les recettes.',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Colocataire', valeur: (l) => nomDe(donnees.locataires.find((x) => x.id === l.locataireId)) },
          { titre: 'Bail', valeur: (l) => (l.bail ? `${date(l.bail.dateDebut)} → ${l.bail.dateFin ? date(l.bail.dateFin) : 'en cours'}` : 'bail supprimé') },
          { titre: 'Convenu', nombre: true, valeur: (l) => montant(l.attendu || 0) },
          { titre: 'Reçue', nombre: true, valeur: (l) => (l.recuLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRecu || 0) }), h('div', { class: 'legende', texte: date(l.recuLe) })])
            : '—') },
          { titre: 'Restituée', nombre: true, valeur: (l) => (l.restitueLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRestitue || 0) }), h('div', { class: 'legende', texte: date(l.restitueLe) })])
            : '—') },
          { titre: 'État', valeur: statutCaution },
          { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
            !l.recuLe ? bouton('Reçue aujourd’hui', () => executer(etat.enregistrer('cautions', {
              id: l.id, bailId: l.bailId, locataireId: l.locataireId,
              attendu: l.attendu || 0, recuLe: aujourdhui(), montantRecu: l.attendu || 0,
              restitueLe: '', montantRestitue: 0, notes: l.notes || '',
            }), 'Caution marquée reçue.'), { petit: true, type: 'primaire' }) : null,
            bouton('Modifier', () => modifierCaution(l), { petit: true }),
          ]) },
        ],
        lignes,
        cle: (l) => l.id,
        messageVide: 'Aucune caution à suivre — déclarez d’abord un bail dans « Bien & baux ».',
      }),
    }));

    return conteneur;
  },
};
