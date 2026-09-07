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
          'Les quittances, décomptes de régularisation et restitutions de dépôt sont édités à l’identité '
            + 'visuelle ANIKA (polices, cachet). Chaque colocataire peut avoir un second destinataire '
            + '(parent, garant…) qui reçoit copie des notifications — champ « Courriel — 2e destinataire ».',
          ['Un ', h('strong', { texte: 'appel de loyer' }),
            ' part automatiquement par e-mail à chaque colocataire au jour choisi (Paramètres → « Appel de loyer automatique ») : '
            + 'sa part du mois, la date limite, vos coordonnées de paiement. « E-mail de test… » vous en envoie un exemplaire ; '
            + '« Envoyer maintenant… » déclenche l’appel du mois à la main. L’historique évite tout doublon.'],
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
          'Créez-le depuis la page « États des lieux » (entrée ou sortie) : un onglet par pièce (tout son détail sur un écran), puis les onglets Plan, Relevés & clés, Signatures et Photos contradictoires. Photographiez chaque pièce — '
            + 'bouton « 📷 Caméra » pour l’appareil photo de la tablette, « + Photos » pour la galerie '
            + '(compression automatique). Chaque pièce présente d’office six postes à évaluer — murs, plafond, sol, '
            + 'prises et interrupteurs, fenêtres et volets, porte — avec un état et une observation, repris dans le rapport ; '
            + 'plus l’état général, les observations libres, les compteurs et les clés.',
          'Dans chaque pièce, « + Meuble » constitue l’inventaire du mobilier (nom, quantité, état, observation) : '
            + 'c’est l’annexe obligatoire du bail meublé, reprise dans le rapport PDF. Chaque meuble reçoit '
            + 'ses propres photos (bouton « 📷 » de sa ligne, ou « + Photos » depuis la galerie) : elles '
            + 'apparaissent sous sa ligne d’inventaire, à l’écran comme dans le rapport. Sous chaque vignette, '
            + 'une légende facultative (« rayure côté gauche »…) est reprise dans le rapport ; sans légende, la photo '
            + 'porte le nom de la pièce ou du meuble et son numéro. Un clic sur une vignette l’agrandit en plein écran (flèches ou balayage pour passer à la suivante) ; '
            + 'le bouton « Enregistrer dans Google Photos… » y envoie la photo vers l’application Google Photos de la tablette.',
          'Pour retrouver automatiquement toutes les photos dans Google Photos : prenez-les avec l’appareil photo de la tablette '
            + '(elles s’y enregistrent et se sauvegardent toutes seules), puis, dans chaque pièce ou meuble, « + Photos » → '
            + 'sélectionnez-les en une fois dans la galerie. Le bouton « 📷 Caméra » de l’application, lui, envoie la photo '
            + 'directement dans l’état des lieux sans la garder sur la tablette.',
          'Ajoutez le plan du logement (photo ou croquis) et posez d’un clic le numéro de chaque pièce dessus : '
            + 'le rapport PDF reprend le plan et ses repères.',
          'Chaque partie signe l’état des lieux à la main sur l’écran de la tablette (les deux bailleurs, '
            + 'Andy et Karine, puis chaque colocataire) — et faites signer le bail dans la foulée '
            + '(« Bien & baux » → Bail signé).',
          'Le rapport PDF (plan, photos, signatures) se télécharge et est déposé sur l’espace de chaque colocataire.',
          'Les photos et documents sont stockés dans l’espace Firebase Storage du projet (Google Cloud, Europe) : '
            + 'dossier « etats-des-lieux » pour les photos, « documents » pour les PDF, « portail » pour ce qui est remis aux colocataires. '
            + 'Depuis un réseau qui bloque ce serveur (poste professionnel), l’application les fait transiter par sa propre adresse, sans rien changer pour vous ; '
            + 'Paramètres → « Tester le stockage » l’indique.',
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
          'Donnez-lui l’adresse de son espace : https://gestion-lmnp-anika.web.app/colocataire — la page de connexion '
            + 's’ouvre directement sur « Colocataires » (le sélecteur Propriétaires / Colocataires en haut de la page permet de changer). '
            + 'Quel que soit le bouton choisi, c’est le rôle du compte qui décide de l’écran ouvert : un colocataire ne voit jamais l’espace propriétaires.',
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
      titre: 'Plein écran et installation sur la tablette',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Sur tablette ou téléphone, l’application passe en plein écran au premier toucher après le lancement (réglable dans Paramètres → « Affichage sur cet appareil ») ; le bouton ⛶ en haut à droite le bascule à tout moment.',
          'Mieux : installez-la sur l’écran d’accueil (Paramètres → « Installer l’application », ou menu du navigateur → « Ajouter à l’écran d’accueil ») : elle a alors son icône et s’ouvre sans barre d’adresse, comme une application.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'L’envoi des e-mails',
      corps: h('div', { class: 'aide-bloc' }, [
        p('L’application dépose chaque e-mail (quittance, décompte, bail, état des lieux, rappels, appels de loyer) '
          + 'dans la file « mail » de la base ; la fonction d’envoi du projet (envoiMail, via Gmail, expéditeur a-nguyen@sfr.fr) '
          + 'le fait partir dans les secondes qui suivent et inscrit le résultat (delivery : SUCCESS ou ERROR). '
          + 'Tant que cette fonction n’est pas déployée, les envois restent en file — rien n’est perdu.'),
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
