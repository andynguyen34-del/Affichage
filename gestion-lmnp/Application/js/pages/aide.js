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
      titre: 'Travailler à deux : un seul poste à la fois',
      corps: h('div', { class: 'aide-bloc' }, [
        p('Pour qu’aucune saisie ne soit jamais écrasée, l’application ne s’utilise que depuis un poste à la '
          + 'fois. Quand vous l’ouvrez, elle pose un « verrou » dans le dossier partagé.'),
        liste([
          'Si l’autre poste l’utilise déjà, vous voyez un écran d’attente : dès qu’il ferme l’application, '
            + 'vous y entrez automatiquement, sans rien faire.',
          'Si l’autre poste a été fermé brutalement (ordinateur éteint, onglet fermé sans quitter), le verrou '
            + 'expire tout seul au bout d’une minute et demie, et vous reprenez la main.',
          ['Pour fermer proprement et libérer tout de suite le verrou : bouton ',
            h('strong', { texte: 'Quitter' }), ' en bas à gauche.'],
        ]),
        p('Le verrou passe par OneDrive, qui met quelques secondes à synchroniser : si vous ouvrez tous les '
          + 'deux exactement au même moment, mettez-vous simplement d’accord sur qui commence.'),
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
      titre: 'Comment l’application s’ouvre',
      corps: h('div', { class: 'aide-bloc' }, [
        p('L’application est une simple page web autonome ('
          , h('code', { texte: 'Gestion LMNP.html' }), '), ouverte dans Google Chrome ou Microsoft Edge. '
          + 'Il n’y a aucun programme installé, aucune fenêtre à laisser ouverte, aucun accès à Internet : '
          + 'la page lit et écrit directement dans le dossier que vous lui désignez au premier lancement.'),
        p('C’est pour cela qu’un antivirus n’a rien à y signaler.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Dépannage',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['« Cette application a besoin de Chrome ou Edge » : vous l’avez ouverte avec Firefox ou un autre '
            + 'navigateur. Faites un clic droit sur ', h('code', { texte: 'Gestion LMNP.html' }),
            ' → Ouvrir avec → Google Chrome.'],
          'L’application redemande le dossier à chaque ouverture : c’est normal si votre Chrome n’autorise pas '
            + 'la mémorisation pour les fichiers locaux. Cliquez « Choisir le dossier », rien de plus.',
          ['Une saisie a disparu : ouvrez le dossier ', h('code', { texte: 'Sauvegardes' }),
            ', repérez la journée voulue et recopiez le fichier voulu dans ', h('code', { texte: 'Données' }), '.'],
          'Écran d’attente qui ne se débloque pas : l’autre poste a peut-être laissé l’application ouverte. '
            + 'Le verrou se libère de lui-même une minute et demie après sa fermeture.',
          'Pour fermer proprement : bouton « Quitter l’application » en bas à gauche.',
        ]),
      ]),
    }));

    return conteneur;
  },
};
