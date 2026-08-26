// Mode d'emploi intégré.

import { h, carte } from '../ui.js';
import * as etat from '../etat.js';

const section = (titre, contenu) => [h('h3', { texte: titre }), ...contenu];
const p = (texte) => h('p', { texte });
const liste = (elements) => h('ul', {}, elements.map((e) => h('li', {}, e)));

export default {
  cle: 'aide',
  libelle: 'Aide',
  icone: '❓',
  titre: 'Mode d’emploi',
  sousTitre: 'Comment l’application fonctionne, et ce qu’elle ne fait pas.',
  rendre() {
    const infos = etat.infosServeur() || {};
    const conteneur = h('div');

    conteneur.append(carte({
      titre: 'Où vivent les données',
      corps: h('div', { class: 'aide-bloc' }, [
        p(`Tout est dans le dossier partagé : ${infos.dossier || ''}`),
        liste([
          [h('code', { texte: 'Données\\' }), ' — les fichiers de l’application (un fichier JSON par type de donnée).'],
          [h('code', { texte: 'Factures\\' }), ' — vous y déposez les factures ; elles sont lues puis rangées dans ',
            h('code', { texte: 'Traitées\\<année>' }), '.'],
          [h('code', { texte: 'Documents\\' }), ' — baux, états des lieux, diagnostics, courriers.'],
          [h('code', { texte: 'Sauvegardes\\' }), ' — une copie datée des données, faite automatiquement.'],
          [h('code', { texte: 'Corbeille\\' }), ' — les fichiers écartés depuis l’application, jamais supprimés définitivement.'],
        ]),
        p('Il n’y a ni base de données ni service en ligne : OneDrive synchronise ces fichiers, '
          + 'et l’application les lit et les écrit directement.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Travailler à deux',
      corps: h('div', { class: 'aide-bloc' }, [
        p('Chacun lance l’application depuis son propre poste. Les modifications sont écrites dans le dossier '
          + 'partagé et reprises par l’autre poste dans la minute.'),
        liste([
          'Si vous modifiez tous les deux en même temps deux lignes différentes, les deux saisies sont conservées.',
          'Si vous modifiez la même ligne, c’est la dernière enregistrée qui l’emporte.',
          'Le bouton « Actualiser » en haut à droite force la relecture du dossier.',
          ['Si OneDrive crée une copie de conflit dans ', h('code', { texte: 'Données\\' }),
            ', un bandeau orange vous le signale en haut de l’écran.'],
        ]),
        p('Conseil : évitez d’ouvrir l’application sur les deux postes pendant une longue séance de saisie. '
          + 'La synchronisation OneDrive prend parfois plusieurs minutes.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Le circuit d’une facture',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['Déposez le PDF dans le dossier ', h('code', { texte: 'Factures' }),
            ' (depuis l’explorateur Windows, ou par glisser-déposer dans la page « Factures »).'],
          'L’application lit la date, le montant, le fournisseur et devine la catégorie à partir du nom du fichier.',
          'Vous validez — ou vous corrigez — puis la dépense est créée et le fichier rangé dans « Traitées ».',
          'La dépense apparaît alors dans les charges de l’exercice et dans le résultat fiscal.',
        ]),
        p('Nommez vos fichiers ainsi pour une lecture complète : « 2026-03-15 EDF 84,20.pdf ». '
          + 'La date peut aussi s’écrire 15-03-2026 ou 20260315.'),
        p('L’option « Intégrer automatiquement à l’ouverture » traite sans confirmation toutes les factures '
          + 'dont la date, le montant et la catégorie ont été reconnus. Les autres restent en attente.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Comment le résultat fiscal est calculé',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Recettes : loyers et provisions pour charges. Le dépôt de garantie n’en fait pas partie.',
          'Charges : les dépenses déductibles de l’exercice, plus les intérêts et l’assurance du prêt, '
            + 'calculés depuis l’échéancier.',
          'Amortissements : chaque composant est amorti en linéaire, au prorata la première et la dernière année.',
          'Plafonnement : la déduction des amortissements ne peut pas créer ni aggraver un déficit '
            + '(article 39 C II 2° du CGI). L’excédent devient un amortissement réputé différé, '
            + 'reportable sans limite de durée.',
          'Déficit : celui qui provient des charges est imputable sur les bénéfices de même nature '
            + 'des dix exercices suivants.',
        ]),
        p('Le remboursement du capital de l’emprunt n’est pas une charge déductible : seuls les intérêts '
          + 'et l’assurance le sont.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Ce que l’application ne fait pas',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Elle ne télétransmet pas la liasse fiscale : le dépôt de la 2031-SD se fait en EDI-TDFC, '
            + 'via un expert-comptable ou un prestataire agréé.',
          'Elle ne suit pas le compte bancaire : les postes de trésorerie du bilan sont à compléter à la main.',
          'Elle ne lit pas l’intérieur des PDF : seul le nom du fichier est analysé.',
          'Elle ne remplace pas un conseil fiscal. Les taux, plafonds et numéros de case changent : '
            + 'vérifiez-les sur les formulaires de l’année.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Dépannage',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['L’application ne s’ouvre pas : vérifiez que la fenêtre noire « Gestion LMNP — serveur » est ouverte. '
            + 'Sinon, relancez ', h('code', { texte: 'Gestion LMNP.cmd' }), '.'],
          'La page affiche « Dossier inaccessible » : OneDrive est peut-être en train de synchroniser, ou la fenêtre du serveur a été fermée.',
          ['Une saisie a disparu : ouvrez le dossier ', h('code', { texte: 'Sauvegardes' }),
            ', repérez la journée voulue et recopiez le fichier voulu dans ', h('code', { texte: 'Données' }), '.'],
          'Pour fermer proprement : bouton « Quitter l’application » en bas à gauche.',
        ]),
      ]),
    }));

    return conteneur;
  },
};
