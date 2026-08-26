// Résultat fiscal de l'exercice et pistes d'optimisation.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, barreOutils, notifier } from '../ui.js';
import { montant, nombre, centimes } from '../format.js';
import * as fiscal from '../calculs/fiscal.js';

function ligne(libelle, valeur, options = {}) {
  return h('tr', { class: options.fort ? 'total-partiel' : null }, [
    h('td', { style: options.retrait ? 'padding-left:2rem' : null }, [
      h('span', { texte: libelle }),
      options.aide ? h('div', { class: 'legende', texte: options.aide }) : null,
    ]),
    h('td', { class: 'nombre', style: options.couleur ? `color:${options.couleur}` : null,
      texte: typeof valeur === 'string' ? valeur : montant(valeur) }),
  ]);
}

function compteDeResultat(exercice) {
  const lignes = [
    ligne('Loyers perçus', exercice.recettes.loyers),
    ligne('Provisions pour charges perçues', exercice.recettes.charges),
  ];
  if (exercice.recettes.autres) lignes.push(ligne('Autres produits', exercice.recettes.autres));
  lignes.push(ligne('Total des recettes', exercice.recettes.total, { fort: true }));

  for (const [categorie, valeur] of [...exercice.charges.groupes.entries()].sort((a, b) => b[1] - a[1])) {
    lignes.push(ligne(etat.libelleCategorieCharge(categorie), -valeur, { retrait: true }));
  }
  if (exercice.charges.emprunt.deductible) {
    lignes.push(ligne('Intérêts et assurance d’emprunt', -exercice.charges.emprunt.deductible,
      { retrait: true, aide: 'calculés à partir de l’échéancier du prêt' }));
  }
  lignes.push(ligne('Total des charges', -exercice.charges.total, { fort: true }));
  lignes.push(ligne('Résultat avant amortissement', exercice.resultatAvantAmortissement, {
    fort: true,
    couleur: exercice.resultatAvantAmortissement < 0 ? 'var(--alerte)' : 'var(--succes)',
  }));
  lignes.push(ligne('Amortissements imputés', -exercice.amortissements.impute, {
    aide: exercice.amortissements.brides
      ? 'plafonné au résultat avant amortissement (article 39 C du CGI)'
      : null,
  }));
  lignes.push(ligne('Résultat après amortissement', exercice.resultatApresAmortissement, { fort: true }));
  if (exercice.deficits.imputes) {
    lignes.push(ligne('Déficits antérieurs imputés', -exercice.deficits.imputes, { retrait: true }));
  }
  lignes.push(ligne('Résultat imposable', exercice.resultatImposable, {
    fort: true,
    couleur: exercice.resultatImposable > 0 ? 'var(--alerte)' : 'var(--succes)',
  }));
  return h('table', {}, h('tbody', {}, lignes));
}

function conseils(donnees, exercice, contexte) {
  const items = [];
  const annee = exercice.annee;

  if (!donnees.immobilisations.length) {
    items.push({
      ton: 'alerte',
      titre: 'Aucun amortissement enregistré',
      texte: 'C’est le principal levier du régime réel : la décomposition du bien en composants '
        + 'crée une charge annuelle sans sortie de trésorerie. Sans elle, vous êtes imposé sur le résultat brut.',
      action: ['Décomposer le bien', 'amortissements'],
    });
  }

  if (exercice.amortissements.differes > 0) {
    items.push({
      ton: 'info',
      titre: `${montant(exercice.amortissements.differes)} d’amortissements en report`,
      texte: 'Ces amortissements n’ont pas pu être déduits cette année (le résultat ne le permettait pas). '
        + 'Ils sont conservés sans limite de durée et viendront réduire les résultats bénéficiaires à venir. Rien n’est perdu.',
    });
  }

  const deficitsProches = (exercice.reportSortant.deficits || [])
    .filter((d) => fiscal.DUREE_REPORT_DEFICIT - (annee - d.annee) <= 3 && d.montant > 0);
  if (deficitsProches.length) {
    const total = centimes(deficitsProches.reduce((s, d) => s + d.montant, 0));
    items.push({
      ton: 'attention',
      titre: `${montant(total)} de déficit arrivant à échéance`,
      texte: `Un déficit BIC non professionnel se perd s’il n’est pas imputé dans les ${fiscal.DUREE_REPORT_DEFICIT} ans. `
        + `Concerné : ${deficitsProches.map((d) => `${montant(d.montant)} de ${d.annee} (dernier exercice utile : ${d.annee + fiscal.DUREE_REPORT_DEFICIT})`).join(', ')}.`,
    });
  }

  if (exercice.deficits.perimes > 0) {
    items.push({
      ton: 'alerte',
      titre: `${montant(exercice.deficits.perimes)} de déficit périmé`,
      texte: `Ce déficit a dépassé le délai de report de ${fiscal.DUREE_REPORT_DEFICIT} ans et ne peut plus être imputé.`,
    });
  }

  if (exercice.resultatImposable > 0) {
    const sansJustificatif = donnees.charges.filter((c) => !c.documentChemin).length;
    items.push({
      ton: 'attention',
      titre: `Résultat imposable de ${montant(exercice.resultatImposable)}`,
      texte: 'Avant de clôturer : vérifiez que toutes les dépenses de l’année sont saisies '
        + (sansJustificatif ? `(${sansJustificatif} dépenses sont sans justificatif) ` : '')
        + '— taxe foncière, CFE, assurances, copropriété, frais de comptabilité, petit équipement, '
        + 'et que le mobilier acheté figure bien en amortissement.',
      action: ['Voir les factures à intégrer', 'factures'],
    });
  }

  const chargesAImmobiliser = donnees.charges.filter((c) => c.immobilise
    && !donnees.immobilisations.some((i) => i.libelle === c.libelle));
  if (chargesAImmobiliser.length) {
    items.push({
      ton: 'attention',
      titre: `${chargesAImmobiliser.length} dépense(s) marquée(s) « à amortir » sans composant associé`,
      texte: `Créez le composant correspondant, sinon ces montants ne sont ni déduits ni amortis : `
        + chargesAImmobiliser.map((c) => c.libelle).join(', '),
      action: ['Créer le composant', 'amortissements'],
    });
  }

  if (donnees.parametres.interetsAutomatiques !== false) {
    const doublon = donnees.charges.some((c) => ['interets-emprunt', 'assurance-emprunteur'].includes(c.categorie)
      && c.deductible !== false);
    if (doublon && donnees.emprunts.length) {
      items.push({
        ton: 'alerte',
        titre: 'Intérêts d’emprunt comptés deux fois ?',
        texte: 'Les intérêts sont déjà calculés depuis l’échéancier du prêt. '
          + 'Des dépenses saisies dans les catégories « Intérêts d’emprunt » ou « Assurance emprunteur » '
          + 'viennent s’y ajouter. Supprimez-les, ou désactivez le calcul automatique dans les Paramètres.',
        action: ['Voir les charges', 'charges'],
      });
    }
  }

  const micro = fiscal.comparaisonMicroBic(donnees, annee, exercice.recettes.total);
  if (micro.eligible && exercice.recettes.total > 0) {
    const ecart = centimes(micro.base - exercice.resultatImposable);
    items.push({
      ton: ecart >= 0 ? 'info' : 'attention',
      titre: `Comparaison avec le micro-BIC : ${montant(micro.base)} de base imposable`,
      texte: ecart >= 0
        ? `Le régime réel vous fait déclarer ${montant(ecart)} de moins que le micro-BIC `
          + `(abattement de ${nombre(micro.abattement, 0)} %). Le réel reste le bon choix.`
        : `Cette année, le micro-BIC donnerait ${montant(-ecart)} de moins. `
          + 'Attention : quitter le réel fait perdre les amortissements en report et les déficits. '
          + 'Le comparatif se juge sur la durée, pas sur un exercice.',
    });
  }

  return items.map((item) => h('div', { class: `alerte alerte-${item.ton === 'alerte' ? 'erreur' : item.ton}` }, [
    h('div', {}, [
      h('strong', { texte: item.titre }),
      h('div', { texte: item.texte }),
    ]),
    item.action ? bouton(item.action[0], () => contexte.allerA(item.action[1]), { petit: true }) : null,
  ]));
}

export default {
  cle: 'resultat',
  libelle: 'Résultat fiscal',
  icone: '📊',
  titre: 'Résultat fiscal',
  sousTitre: (contexte) => `Exercice ${contexte.annee} — régime réel, BIC non professionnel.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const serie = fiscal.calculerSerie(donnees, annee);
    const exercice = serie.get(annee);
    const conteneur = h('div');

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Recettes', valeur: montant(exercice.recettes.total, { rond: true }) }),
      tuile({ libelle: 'Charges', valeur: montant(exercice.charges.total, { rond: true }) }),
      tuile({ libelle: 'Amortissements imputés', valeur: montant(exercice.amortissements.impute, { rond: true }),
        detail: exercice.amortissements.differes ? `${montant(exercice.amortissements.differes, { rond: true })} en report` : null }),
      tuile({
        libelle: 'Résultat imposable',
        valeur: montant(exercice.resultatImposable, { rond: true }),
        ton: exercice.resultatImposable > 0 ? 'negatif' : 'positif',
        detail: exercice.resultatImposable === 0 ? 'aucune imposition sur ces revenus' : null,
      }),
    ]));

    conteneur.append(barreOutils([
      bouton('Imprimer', () => window.print()),
      bouton('Voir la liasse fiscale', () => contexte.allerA('liasse'), { type: 'primaire' }),
    ]));

    conteneur.append(carte({
      titre: `Compte de résultat ${annee}`,
      aide: exercice.methode === 'engagement'
        ? 'Comptabilité d’engagement : loyers dus et charges engagées.'
        : 'Comptabilité de trésorerie : loyers encaissés et charges payées.',
      corps: compteDeResultat(exercice),
    }));

    const items = conseils(donnees, exercice, contexte);
    if (items.length) {
      conteneur.append(carte({
        titre: 'Optimisation',
        aide: 'Ce qu’il reste à vérifier pour réduire l’impact fiscal, sans sortir des règles.',
        corps: items,
      }));
    }

    conteneur.append(carte({
      titre: 'Amortissements de l’exercice',
      serre: true,
      corps: h('table', {}, h('tbody', {}, [
        ligne('Dotation de l’exercice', exercice.amortissements.dotation),
        ligne('Amortissements différés antérieurs', exercice.amortissements.stockAnterieur),
        ligne('Plafond d’imputation', exercice.amortissements.plafond, {
          aide: 'recettes diminuées des autres charges (article 39 C II 2° du CGI)',
        }),
        ligne('Amortissements imputés', exercice.amortissements.impute, { fort: true }),
        ligne('Amortissements différés au 31/12', exercice.amortissements.differes, {
          fort: true, aide: 'reportables sans limite de durée',
        }),
      ])),
    }));

    const deficits = exercice.reportSortant.deficits || [];
    conteneur.append(carte({
      titre: 'Déficits reportables',
      aide: `Imputables sur les bénéfices BIC non professionnels des ${fiscal.DUREE_REPORT_DEFICIT} exercices suivants.`,
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Exercice d’origine', valeur: (d) => String(d.annee) },
          { titre: 'Montant restant', nombre: true, valeur: (d) => montant(d.montant) },
          { titre: 'Dernier exercice d’imputation', valeur: (d) => String(d.annee + fiscal.DUREE_REPORT_DEFICIT) },
          { titre: 'État', valeur: (d) => {
            const restant = d.annee + fiscal.DUREE_REPORT_DEFICIT - annee;
            if (restant <= 1) return badge(`${restant <= 0 ? 'Dernière année' : '1 an restant'}`, 'alerte');
            if (restant <= 3) return badge(`${restant} ans restants`, 'attention');
            return badge(`${restant} ans restants`, 'attente');
          } },
        ],
        lignes: deficits,
        messageVide: 'Aucun déficit en report.',
      }),
    }));

    const historique = [...serie.values()];
    conteneur.append(carte({
      titre: 'Historique des exercices',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Exercice', valeur: (e) => String(e.annee) },
          { titre: 'Recettes', nombre: true, valeur: (e) => montant(e.recettes.total) },
          { titre: 'Charges', nombre: true, valeur: (e) => montant(e.charges.total) },
          { titre: 'Dotation', nombre: true, valeur: (e) => montant(e.amortissements.dotation) },
          { titre: 'Amort. imputés', nombre: true, valeur: (e) => montant(e.amortissements.impute) },
          { titre: 'Amort. différés', nombre: true, valeur: (e) => montant(e.amortissements.differes) },
          { titre: 'Résultat imposable', nombre: true, valeur: (e) => montant(e.resultatImposable) },
        ],
        lignes: historique,
        cle: (e) => e.annee,
        messageVide: '',
      }),
    }));

    return conteneur;
  },
};
