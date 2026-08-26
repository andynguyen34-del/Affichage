// Prêts immobiliers : échéancier, intérêts et assurance déductibles.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, vide, formulaire, confirmer, executer,
  barreOutils, ouvrirModale } from '../ui.js';
import { montant, date, nombre, centimes } from '../format.js';
import * as calcul from '../calculs/emprunt.js';

const champsEmprunt = (donnees) => [
  { cle: 'banque', libelle: 'Établissement prêteur', type: 'texte', requis: true },
  { cle: 'bienId', libelle: 'Logement financé', type: 'liste',
    options: [{ valeur: '', libelle: '—' }, ...donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }))] },
  { cle: 'capital', libelle: 'Capital emprunté (€)', type: 'montant', requis: true },
  { cle: 'tauxAnnuel', libelle: 'Taux nominal annuel (%)', type: 'nombre', requis: true, pas: '0.001' },
  { cle: 'dureeMois', libelle: 'Durée (mois)', type: 'entier', requis: true, min: 1, max: 480 },
  { cle: 'datePremiereEcheance', libelle: 'Première échéance', type: 'date', requis: true },
  { cle: 'assuranceMensuelle', libelle: 'Assurance emprunteur (€/mois)', type: 'montant' },
  { cle: 'fraisDossier', libelle: 'Frais de dossier (€)', type: 'montant',
    aide: 'À saisir aussi en charge si vous les déduisez l’année de leur paiement.' },
  { cle: 'notes', libelle: 'Notes', type: 'zone' },
];

async function ouvrirEmprunt(donnees, existant) {
  const saisie = await formulaire({
    titre: existant ? 'Modifier le prêt' : 'Nouveau prêt',
    champs: champsEmprunt(donnees),
    valeurs: existant || { bienId: donnees.biens[0]?.id || '', dureeMois: 240, assuranceMensuelle: 0 },
    large: true,
  });
  if (saisie) await executer(etat.enregistrer('emprunts', saisie), 'Prêt enregistré.');
}

function echeancierComplet(emprunt) {
  const lignes = calcul.echeancier(emprunt);
  ouvrirModale({
    titre: `Échéancier — ${emprunt.banque}`,
    large: true,
    corps: h('div', { style: 'max-height:60vh;overflow:auto' }, tableau({
      colonnes: [
        { titre: 'N°', nombre: true, valeur: (l) => String(l.numero) },
        { titre: 'Date', valeur: (l) => date(l.date) },
        { titre: 'Capital', nombre: true, valeur: (l) => montant(l.capital) },
        { titre: 'Intérêts', nombre: true, valeur: (l) => montant(l.interets) },
        { titre: 'Assurance', nombre: true, valeur: (l) => montant(l.assurance) },
        { titre: 'Mensualité', nombre: true, valeur: (l) => montant(l.total) },
        { titre: 'Restant dû', nombre: true, valeur: (l) => montant(l.restantDu) },
      ],
      lignes,
      messageVide: 'Renseignez le capital, le taux et la durée.',
    })),
  });
}

export default {
  cle: 'emprunt',
  libelle: 'Emprunt',
  icone: '🏦',
  titre: 'Prêts immobiliers',
  sousTitre: (contexte) => `Intérêts et assurance déductibles en ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const conteneur = h('div');

    const global = calcul.syntheseAnneeTousEmprunts(donnees.emprunts, annee);
    const restantDu = centimes(donnees.emprunts.reduce((s, e) => s + calcul.capitalRestantDu(e, annee), 0));

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Intérêts ${annee}`, valeur: montant(global.interets, { rond: true }), detail: 'déductibles' }),
      tuile({ libelle: 'Assurance emprunteur', valeur: montant(global.assurance, { rond: true }), detail: 'déductible' }),
      tuile({ libelle: 'Capital remboursé', valeur: montant(global.capital, { rond: true }), detail: 'non déductible' }),
      tuile({ libelle: 'Capital restant dû', valeur: montant(restantDu, { rond: true }), detail: `au 31/12/${annee}` }),
    ]));

    conteneur.append(barreOutils([bouton('+ Prêt', () => ouvrirEmprunt(donnees, null), { type: 'primaire' })]));

    if (!donnees.emprunts.length) {
      conteneur.append(carte({
        titre: 'Aucun prêt enregistré',
        corps: vide('Rien à déclarer ici si l’achat s’est fait sans crédit',
          'Sinon, saisissez le prêt : les intérêts et l’assurance de chaque exercice sont alors calculés '
          + 'et repris automatiquement dans le résultat fiscal, sans double saisie.'),
      }));
      return conteneur;
    }

    for (const emprunt of donnees.emprunts) {
      const synthese = calcul.syntheseAnnee(emprunt, annee);
      const lignesAnnee = calcul.echeancier(emprunt).filter((l) => l.annee === annee);
      conteneur.append(carte({
        titre: `${emprunt.banque} — ${montant(emprunt.capital, { rond: true })} sur ${emprunt.dureeMois} mois`,
        aide: `Taux ${nombre(emprunt.tauxAnnuel, 3)} % · mensualité ${montant(calcul.mensualite(emprunt))}`
          + (emprunt.assuranceMensuelle ? ` + ${montant(emprunt.assuranceMensuelle)} d’assurance` : ''),
        actions: [
          bouton('Échéancier complet', () => echeancierComplet(emprunt), { petit: true }),
          bouton('Modifier', () => ouvrirEmprunt(donnees, emprunt), { petit: true }),
          bouton('✕', async () => {
            const confirme = await confirmer({
              titre: 'Supprimer le prêt', message: `Supprimer le prêt ${emprunt.banque} ?`,
              libelleValider: 'Supprimer', danger: true,
            });
            if (confirme) await executer(etat.supprimer('emprunts', emprunt.id), 'Prêt supprimé.');
          }, { petit: true, type: 'danger' }),
        ],
        serre: true,
        corps: lignesAnnee.length ? tableau({
          colonnes: [
            { titre: 'Échéance', valeur: (l) => date(l.date) },
            { titre: 'Capital', nombre: true, valeur: (l) => montant(l.capital) },
            { titre: 'Intérêts', nombre: true, valeur: (l) => montant(l.interets) },
            { titre: 'Assurance', nombre: true, valeur: (l) => montant(l.assurance) },
            { titre: 'Total', nombre: true, valeur: (l) => montant(l.total) },
            { titre: 'Restant dû', nombre: true, valeur: (l) => montant(l.restantDu) },
          ],
          lignes: lignesAnnee,
          messageVide: '',
          pied: h('tr', {}, [
            h('td', { texte: `Total ${annee}` }),
            h('td', { class: 'nombre', texte: montant(synthese.capital) }),
            h('td', { class: 'nombre', texte: montant(synthese.interets) }),
            h('td', { class: 'nombre', texte: montant(synthese.assurance) }),
            h('td', { class: 'nombre', texte: montant(centimes(synthese.capital + synthese.interets + synthese.assurance)) }),
            h('td', {}),
          ]),
        }) : h('div', { class: 'vide', texte: `Aucune échéance en ${annee}.` }),
      }));
    }

    if (donnees.parametres.interetsAutomatiques === false) {
      conteneur.append(h('div', { class: 'alerte alerte-attention', texte:
        'La reprise automatique des intérêts dans le résultat fiscal est désactivée dans les Paramètres : '
        + 'pensez à saisir les intérêts et l’assurance en charges, sinon ils ne seront pas déduits.' }));
    } else {
      conteneur.append(h('p', { class: 'legende', texte:
        'Les intérêts et l’assurance ci-dessus sont repris automatiquement dans le résultat fiscal. '
        + 'Ne les saisissez pas une seconde fois en charges.' }));
    }

    return conteneur;
  },
};
