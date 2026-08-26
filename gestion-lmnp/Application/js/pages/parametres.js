// Paramètres de l'activité, reports antérieurs et sauvegarde.

import * as etat from '../etat.js';
import { h, carte, tableau, bouton, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur } from '../ui.js';
import { montant, date, nombre, anneeDe } from '../format.js';

async function modifierIdentite(parametres) {
  const saisie = await formulaire({
    titre: 'Identité de l’activité',
    champs: [
      { cle: 'nomActivite', libelle: 'Nom de l’activité', type: 'texte', largeur: 'pleine', exemple: 'LMNP ANIKA' },
      { cle: 'siret', libelle: 'SIRET', type: 'texte', aide: 'Délivré après immatriculation (formulaire P0i).' },
      { cle: 'debutActivite', libelle: 'Début d’activité', type: 'date' },
      { cle: 'lieuSignature', libelle: 'Lieu de signature des quittances', type: 'texte' },
      { cle: 'adherentOga', libelle: 'Adhérent d’un organisme de gestion agréé', type: 'case' },
    ],
    valeurs: parametres,
  });
  if (saisie) await executer(etat.enregistrerParametres(saisie), 'Paramètres enregistrés.');
}

async function modifierRegles(parametres) {
  const saisie = await formulaire({
    titre: 'Règles de calcul',
    champs: [
      { cle: 'methodeComptable', libelle: 'Méthode retenue', type: 'liste', options: [
        { valeur: 'encaissement', libelle: 'Trésorerie — loyers encaissés, charges payées' },
        { valeur: 'engagement', libelle: 'Engagement — loyers dus, charges engagées' },
      ], aide: 'Le BIC relève en principe des créances acquises et des dettes engagées ; '
        + 'beaucoup de petits LMNP retiennent la trésorerie. Choisissez et gardez la même méthode.' },
      { cle: 'interetsAutomatiques', libelle: 'Reprendre automatiquement les intérêts d’emprunt', type: 'case' },
      { cle: 'microAbattement', libelle: 'Abattement micro-BIC (%)', type: 'nombre',
        aide: 'Utilisé seulement pour la comparaison entre régimes. Taux légal à vérifier chaque année.' },
      { cle: 'microPlafond', libelle: 'Plafond de recettes du micro-BIC (€)', type: 'montant' },
    ],
    valeurs: parametres,
  });
  if (saisie) await executer(etat.enregistrerParametres(saisie), 'Règles enregistrées.');
}

async function modifierCases(parametres) {
  const saisie = await formulaire({
    titre: 'Cases de la 2042-C-PRO',
    aide: 'Locations meublées non professionnelles au régime réel. Vérifiez ces repères sur la notice '
      + 'du millésime : ils dépendent du rang du déclarant et de l’adhésion à un organisme agréé.',
    champs: [
      { cle: 'beneficeAvecOga', libelle: 'Bénéfice — adhérent d’un organisme agréé', type: 'texte' },
      { cle: 'beneficeSansOga', libelle: 'Bénéfice — sans organisme agréé', type: 'texte' },
      { cle: 'deficit', libelle: 'Déficit', type: 'texte' },
    ],
    valeurs: parametres.casesDeclaration || {},
  });
  if (saisie) await executer(etat.enregistrerParametres({ casesDeclaration: saisie }), 'Cases enregistrées.');
}

async function modifierBailleur(parametres, index) {
  const bailleurs = [...(parametres.bailleurs || [])];
  const saisie = await formulaire({
    titre: index === null ? 'Ajouter un bailleur' : 'Modifier le bailleur',
    champs: [
      { cle: 'nom', libelle: 'Nom et prénom', type: 'texte', requis: true, largeur: 'pleine' },
      { cle: 'adresse', libelle: 'Adresse', type: 'zone' },
      { cle: 'telephone', libelle: 'Téléphone', type: 'texte' },
      { cle: 'email', libelle: 'Courriel', type: 'texte' },
      { cle: 'feminin', libelle: 'Accorder au féminin dans les quittances (« je soussignée »)', type: 'case' },
    ],
    valeurs: index === null ? {} : bailleurs[index],
  });
  if (!saisie) return;
  if (index === null) bailleurs.push(saisie); else bailleurs[index] = saisie;
  await executer(etat.enregistrerParametres({ bailleurs }), 'Bailleur enregistré.');
}

async function modifierReports(parametres) {
  const reports = parametres.reports || {};
  const saisie = await formulaire({
    titre: 'Reports des exercices antérieurs',
    aide: 'À renseigner une seule fois, si l’activité existait avant l’utilisation de cette application. '
      + 'Reprenez les montants figurant sur la dernière liasse fiscale déposée.',
    champs: [
      { cle: 'amortissementsDifferes', libelle: 'Amortissements réputés différés reportés (€)', type: 'montant' },
    ],
    valeurs: { amortissementsDifferes: reports.amortissementsDifferes || 0 },
  });
  if (!saisie) return;
  await executer(etat.enregistrerParametres({
    reports: { ...reports, amortissementsDifferes: Number(saisie.amortissementsDifferes) || 0 },
  }), 'Reports enregistrés.');
}

async function ajouterDeficitAnterieur(parametres) {
  const reports = parametres.reports || {};
  const saisie = await formulaire({
    titre: 'Déficit antérieur reportable',
    champs: [
      { cle: 'annee', libelle: 'Exercice d’origine', type: 'entier', requis: true, min: 2000, max: 2100 },
      { cle: 'montant', libelle: 'Montant restant à imputer (€)', type: 'montant', requis: true },
    ],
    valeurs: { annee: new Date().getFullYear() - 1 },
  });
  if (!saisie) return;
  const deficits = [...(reports.deficits || []), { annee: Number(saisie.annee), montant: Number(saisie.montant) }];
  await executer(etat.enregistrerParametres({ reports: { ...reports, deficits } }), 'Déficit enregistré.');
}

function exporterSauvegarde(donnees) {
  const contenu = JSON.stringify({
    exporteLe: new Date().toISOString(),
    application: 'Gestion LMNP',
    donnees,
  }, null, 2);
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  lien.download = `sauvegarde-lmnp-${new Date().toISOString().slice(0, 10)}.json`;
  lien.click();
  URL.revokeObjectURL(lien.href);
  notifier('Sauvegarde téléchargée.', 'succes');
}

export default {
  cle: 'parametres',
  libelle: 'Paramètres',
  icone: '⚙️',
  titre: 'Paramètres',
  sousTitre: 'Identité de l’activité, règles de calcul et sauvegarde.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const parametres = donnees.parametres;
    const conteneur = h('div');
    const infos = etat.infosServeur() || {};

    conteneur.append(carte({
      titre: 'Identité de l’activité',
      actions: [bouton('Modifier', () => modifierIdentite(parametres), { petit: true })],
      corps: h('table', {}, h('tbody', {}, [
        ['Nom de l’activité', parametres.nomActivite || '—'],
        ['SIRET', parametres.siret || 'non renseigné'],
        ['Début d’activité', parametres.debutActivite ? date(parametres.debutActivite) : '—'],
        ['Lieu de signature', parametres.lieuSignature || '—'],
        ['Organisme de gestion agréé', parametres.adherentOga ? 'adhérent' : 'non adhérent'],
      ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', { texte: valeur })])))),
    }));

    conteneur.append(carte({
      titre: 'Bailleurs',
      aide: 'Le premier bailleur figure sur les quittances.',
      actions: [bouton('+ Bailleur', () => modifierBailleur(parametres, null), { petit: true })],
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Nom', valeur: (b) => b.nom },
          { titre: 'Adresse', valeur: (b) => (b.adresse || '—').replace(/\n/g, ', ') },
          { titre: 'Contact', valeur: (b) => [b.telephone, b.email].filter(Boolean).join(' · ') || '—' },
          { titre: '', actions: true, valeur: (b, index) => h('div', { class: 'groupe-boutons' }, [
            bouton('Modifier', () => modifierBailleur(parametres, index), { petit: true }),
            bouton('✕', async () => {
              const confirme = await confirmer({
                titre: 'Supprimer le bailleur', message: `Supprimer ${b.nom} ?`,
                libelleValider: 'Supprimer', danger: true,
              });
              if (!confirme) return;
              const bailleurs = (parametres.bailleurs || []).filter((_, i) => i !== index);
              await executer(etat.enregistrerParametres({ bailleurs }), 'Bailleur supprimé.');
            }, { petit: true, type: 'danger' }),
          ]) },
        ],
        lignes: parametres.bailleurs || [],
        messageVide: 'Aucun bailleur enregistré — les quittances ne pourront pas être éditées.',
      }),
    }));

    conteneur.append(carte({
      titre: 'Règles de calcul',
      actions: [bouton('Modifier', () => modifierRegles(parametres), { petit: true })],
      corps: h('table', {}, h('tbody', {}, [
        ['Méthode comptable', parametres.methodeComptable === 'engagement'
          ? 'Engagement — loyers dus et charges engagées'
          : 'Trésorerie — loyers encaissés et charges payées'],
        ['Intérêts d’emprunt', parametres.interetsAutomatiques === false
          ? 'saisis manuellement en charges'
          : 'calculés automatiquement depuis l’échéancier'],
        ['Intégration automatique des factures', parametres.integrationAutomatiqueFactures
          ? 'activée à l’ouverture de l’application' : 'désactivée'],
        ['Abattement micro-BIC (comparaison)', `${nombre(parametres.microAbattement, 0)} %`],
        ['Plafond micro-BIC (comparaison)', montant(parametres.microPlafond, { rond: true })],
      ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', { texte: valeur })])))),
    }));

    const reports = parametres.reports || {};
    conteneur.append(carte({
      titre: 'Reports des exercices antérieurs',
      aide: 'Utile seulement si l’activité a commencé avant l’utilisation de cette application.',
      actions: [
        bouton('Amortissements différés', () => modifierReports(parametres), { petit: true }),
        bouton('+ Déficit antérieur', () => ajouterDeficitAnterieur(parametres), { petit: true }),
      ],
      serre: true,
      corps: h('div', {}, [
        h('div', { style: 'padding:1rem 1rem 0' }, [
          h('strong', { texte: `Amortissements réputés différés reportés : ${montant(reports.amortissementsDifferes || 0)}` }),
        ]),
        tableau({
          colonnes: [
            { titre: 'Exercice d’origine', valeur: (d) => String(d.annee) },
            { titre: 'Montant', nombre: true, valeur: (d) => montant(d.montant) },
            { titre: '', actions: true, valeur: (d, index) => bouton('✕', async () => {
              const deficits = (reports.deficits || []).filter((_, i) => i !== index);
              await executer(etat.enregistrerParametres({ reports: { ...reports, deficits } }), 'Déficit retiré.');
            }, { petit: true, type: 'danger' }) },
          ],
          lignes: reports.deficits || [],
          messageVide: 'Aucun déficit antérieur enregistré.',
        }),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Cases de la déclaration',
      actions: [bouton('Modifier', () => modifierCases(parametres), { petit: true })],
      corps: h('table', {}, h('tbody', {}, [
        ['Bénéfice — adhérent OGA', parametres.casesDeclaration?.beneficeAvecOga || '—'],
        ['Bénéfice — sans OGA', parametres.casesDeclaration?.beneficeSansOga || '—'],
        ['Déficit', parametres.casesDeclaration?.deficit || '—'],
      ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', { texte: valeur })])))),
    }));

    conteneur.append(carte({
      titre: 'Dossier et sauvegarde',
      corps: h('div', {}, [
        h('table', {}, h('tbody', {}, [
          ['Dossier partagé', infos.dossier || '—'],
          ['Dossier des factures', infos.dossierFactures || '—'],
          ['Poste', `${infos.utilisateur || '—'} sur ${infos.poste || '—'}`],
          ['Version de l’application', infos.version || '—'],
        ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', { texte: valeur })])))),
        h('p', { class: 'legende', style: 'margin-top:1rem', texte:
          'Une copie de chaque fichier de données est déposée dans le sous-dossier « Sauvegardes », '
          + 'à la première modification de chaque journée. Les sauvegardes de plus de six mois sont supprimées.' }),
        barreOutils([bouton('Télécharger une sauvegarde complète', () => exporterSauvegarde(donnees), { type: 'primaire' })]),
      ]),
    }));

    return conteneur;
  },
};
