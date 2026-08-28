// Mode d'emploi intégré.

import { h, carte } from '../ui.js';

const p = (texte) => h('p', { texte });
const liste = (elements) => h('ul', {}, elements.map((e) => h('li', {}, e)));

export default {
  cle: 'aide',
  libelle: 'Aide',
  icone: '❓',
  titre: 'Mode d’emploi',
  sousTitre: 'Comment l’application fonctionne, et ce qu’elle ne fait pas.',
  rendre() {
    const conteneur = h('div');

    conteneur.append(carte({
      titre: 'Ce que fait l’application',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['Suivre les ', h('strong', { texte: 'virements de loyer' }),
            ' de chaque colocataire, mois par mois : attendu, reçu, en retard.'],
          ['Générer les ', h('strong', { texte: 'quittances de loyer' }),
            ' en PDF, les publier sur l’espace de chaque colocataire et les envoyer par e-mail.'],
          ['Établir les ', h('strong', { texte: 'états des lieux' }),
            ' avec reportage photo pièce par pièce et signature des parties à l’écran, puis produire le rapport PDF.'],
          ['Offrir à chaque colocataire un ', h('strong', { texte: 'espace personnel' }),
            ' où consulter et télécharger ses documents.'],
        ]),
        p('La comptabilité (charges, amortissements, déclaration fiscale) ne se fait pas ici : '
          + 'elle est tenue dans votre outil comptable en ligne.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Le mois type',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Les échéances de chaque colocataire se créent toutes seules à partir du bail et de la répartition des parts.',
          ['À réception d’un virement : page « Loyers » → ', h('strong', { texte: 'Virement reçu' }),
            ' sur la ligne du colocataire et du mois.'],
          ['Quand le mois est soldé : bouton ', h('strong', { texte: 'Quittance' }),
            ' — le PDF est généré, déposé sur son espace, et vous pouvez l’envoyer par e-mail dans la foulée.'],
          'Le tableau de bord signale les retards et les quittances restant à émettre.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’état des lieux',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Créez-le depuis la page « États des lieux » (entrée ou sortie).',
          'Dans chaque pièce : photos (depuis le téléphone ou l’ordinateur — elles sont compressées automatiquement), '
            + 'état général et observations.',
          'Relevez les compteurs et les clés remises.',
          'Faites signer chaque partie à l’écran, au doigt ou à la souris, de préférence sur place.',
          'Générez le rapport PDF : photos et signatures incluses, rangé dans « Documents » et publié sur '
            + 'l’espace de chaque colocataire.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’espace colocataire',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['Renseignez l’adresse e-mail du colocataire dans « Bien & baux », puis ouvrez son accès dans ',
            h('strong', { texte: 'Paramètres → Accès à l’application' }), '.'],
          'Créez aussi son compte (même adresse + mot de passe) dans la console Firebase : '
            + 'Authentication → Users → Add user.',
          'Il se connecte à la même adresse que vous, mais ne voit que ses propres documents : '
            + 'quittances, état des lieux, bail.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’envoi des quittances par e-mail',
      corps: h('div', { class: 'aide-bloc' }, [
        p('Les e-mails partent par l’extension Firebase « Trigger Email » : l’application dépose le message '
          + '(avec la quittance en pièce jointe) dans une file, l’extension l’expédie via votre compte d’envoi.'),
        liste([
          'Installation (une fois) : console Firebase → Extensions → « Trigger Email from Firestore » → Installer.',
          'Collection à surveiller : « mail ». Compte d’envoi : l’identifiant SMTP de votre choix '
            + '(Brevo gratuit, Gmail avec mot de passe d’application…).',
          'Tant que l’extension n’est pas installée, les envois restent en file — rien n’est perdu.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Ce que l’application ne fait pas',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Pas de comptabilité : charges, amortissements et liasse fiscale se font dans votre outil comptable.',
          'Pas de prélèvement automatique des loyers : elle constate les virements, elle ne les initie pas.',
          'Elle ne remplace pas un conseil juridique pour les baux et les états des lieux.',
        ]),
      ]),
    }));

    return conteneur;
  },
};
