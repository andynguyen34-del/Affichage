// Mode d'emploi intégré.

import { h, carte } from '../ui.js';

const p = (texte) => h('p', { texte });
const liste = (elements) => h('ul', {}, elements.map((e) => h('li', {}, e)));

export default {
  cle: 'aide',
  libelle: 'Aide',
  icone: '❓',
  titre: 'Mode d’emploi',
  sousTitre: 'Loyers, cautions, régularisation des charges, quittances et états des lieux — rien d’autre.',
  rendre() {
    const conteneur = h('div');

    conteneur.append(carte({
      titre: 'Le mois type',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Les échéances de chaque colocataire se créent toutes seules à partir du bail et de la répartition des parts (bouton « Répartir » dans « Bien & baux »).',
          ['À réception d’un virement : page « Loyers » → ', h('strong', { texte: 'Virement reçu' }),
            ' sur la ligne du colocataire et du mois.'],
          ['Quand le mois est soldé : bouton ', h('strong', { texte: 'Quittance' }),
            ' — le PDF est déposé sur l’espace du colocataire, téléchargeable, et un clic envoie '
            + 'l’e-mail de mise à disposition. « Imprimer » édite la version papier.'],
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Les cautions',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'La page « Cautions » liste le dépôt de garantie de chaque colocataire : convenu, reçu, restitué.',
          ['À l’encaissement : ', h('strong', { texte: 'Reçue aujourd’hui' }),
            ' (ou « Modifier » pour une date ou un montant différents).'],
          'À la fin du bail : « Modifier » → renseignez la restitution, déduction faite des éventuelles retenues.',
          'Le dépôt de garantie n’est pas un loyer : il ne compte pas dans les recettes.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'La régularisation des charges',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'La page « Charges » cumule les provisions prélevées avec les loyers : prévues d’après le bail, '
            + 'encaissées d’après les virements pointés.',
          ['Une fois par an (ou en fin de bail) : ', h('strong', { texte: '+ Régularisation' }),
            ' — saisissez la période, la dépense d’eau réelle (factures du service des eaux) et la taxe '
            + 'd’enlèvement des ordures ménagères (ligne « TEOM » de l’avis de taxe foncière).'],
          'L’application répartit les dépenses au prorata des provisions de chacun et calcule le solde : '
            + 'trop-perçu à rembourser ou complément à réclamer.',
          ['Le bouton ', h('strong', { texte: 'Décompte' }),
            ' génère le PDF du colocataire, le dépose sur son espace et propose l’e-mail de mise à disposition.'],
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’état des lieux — le déroulé de la visite',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Créez-le depuis la page « États des lieux » (entrée ou sortie), puis photographiez chaque pièce — '
            + 'bouton « 📷 Caméra » pour l’appareil photo de la tablette, « + Photos » pour la galerie '
            + '(compression automatique) : état général, observations, compteurs, clés.',
          'Dans chaque pièce, « + Meuble » constitue l’inventaire du mobilier (nom, quantité, état) : '
            + 'c’est l’annexe obligatoire du bail meublé, reprise dans le rapport PDF.',
          'Ajoutez le plan du logement (photo ou croquis) et posez d’un clic le numéro de chaque pièce dessus : '
            + 'le rapport PDF reprend le plan et ses repères.',
          'Chaque partie signe l’état des lieux à la main sur l’écran de la tablette (les deux bailleurs, '
            + 'Andy et Karine, puis chaque colocataire) — et faites signer le bail dans la foulée '
            + '(« Bien & baux » → Bail signé).',
          'Le rapport PDF (plan, photos, signatures) se télécharge et est déposé sur l’espace de chaque colocataire.',
          ['Enfin, ouvrez la ', h('strong', { texte: 'fenêtre contradictoire' }),
            ' : chaque colocataire a 3 semaines pour déposer ses propres photos depuis son espace '
            + '(datées, non modifiables) ; « Relever les photos » les affiche côté gérant.'],
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Le bail signé dans l’application',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['Page « Bien & baux », bouton ', h('strong', { texte: 'Bail signé' }),
            ' sur la ligne du bail : joignez le PDF du bail, puis chaque partie signe à l’écran '
            + '(tablette, doigt ou stylet).'],
          '« Générer le bail signé » ajoute au PDF une page datée avec toutes les signatures.',
          '« Déposer sur les espaces + notifier » met le bail à disposition de chaque colocataire '
            + '(adresse e-mail requise) et lui envoie l’e-mail de mise à disposition.',
          'Il s’agit d’une signature simple : suffisante pour les annexes, avenants et états des lieux ; '
            + 'pour une valeur probante renforcée du bail, un service certifié reste préférable.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’espace colocataire',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Renseignez l’adresse e-mail du colocataire dans « Bien & baux », puis ouvrez son accès dans '
            + '« Paramètres → Accès à l’application ».',
          'Créez aussi son compte de connexion dans la console Firebase (Authentication → Users → Add user).',
          'À la même adresse que vous, il n’accède qu’à ses documents : quittances et états des lieux, '
            + 'à consulter ou télécharger en PDF.',
          'L’e-mail de mise à disposition (bouton « Notifier par e-mail ») le prévient qu’un nouveau document l’attend.',
          'Dans l’autre sens, il DÉPOSE ses justificatifs (assurance habitation, entretien des climatiseurs, '
            + 'ramonage) : rubrique « Vos justificatifs à fournir » sur son espace. Côté gérant : '
            + '« Bien & baux » → « Justificatifs des colocataires » → Relever, avec rappel par e-mail de ce qui manque.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’envoi des e-mails',
      corps: h('div', { class: 'aide-bloc' }, [
        p('Les notifications partent par l’extension Firebase « Trigger Email » (installation en 4 clics, '
          + 'voir le guide de livraison). Tant qu’elle n’est pas installée, les envois restent en file — rien n’est perdu.'),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Ce que l’application ne fait pas',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Pas de comptabilité : elle se tient dans votre outil comptable en ligne.',
          'Pas de prélèvement automatique : l’application constate les virements, elle ne les initie pas.',
          'En cas de doute juridique sur un bail, un état des lieux ou une retenue de caution, demandez conseil.',
        ]),
      ]),
    }));

    return conteneur;
  },
};
