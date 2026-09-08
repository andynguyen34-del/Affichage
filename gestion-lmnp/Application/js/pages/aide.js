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
          'Les échéances de chaque colocataire se créent toutes seules à partir du bail et de la répartition des parts (bouton « Répartir » dans « Logements & baux »).',
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
      titre: 'Plusieurs logements',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Déclarez chaque logement dans « Logements & baux » (bouton « + Logement »), avec son type de location : '
            + 'colocation (un bail, plusieurs colocataires avec leur part), location entière (un bail, un locataire), '
            + 'ou courte durée (Airbnb, Booking… : des séjours, sans bail ni appel de loyer).',
          ['Le sélecteur ', h('strong', { texte: 'Logement' }),
            ' en haut de l’écran, à côté de l’exercice, choisit le logement affiché dans toutes les pages (Loyers, Cautions, Charges, '
            + 'États des lieux, Logements & baux, Locataires). Le choix est mémorisé sur l’appareil. « Tous les logements » montre tout, '
            + 'logement par logement, avec un sous-total sous chacun dans « Loyers ».'],
          'Les baux, loyers, cautions, régularisations et états des lieux sont rattachés au logement de leur bail : rien à ressaisir '
            + 'pour les données existantes.',
          'Courte durée : dans « Loyers », la carte « Séjours » du logement liste chaque séjour (arrivée, départ, voyageur, plateforme, '
            + 'montant perçu) et son encaissement ; les recettes s’ajoutent aux tuiles de l’année. Un état des lieux peut se rattacher '
            + 'à un logement de courte durée sans bail.',
          'L’appel de loyer automatique se règle logement par logement (Paramètres → « Appel de loyer automatique » : jour, coordonnées '
            + 'de paiement, textes) ; l’historique indique le logement de chaque envoi.',
          'La page « Locataires » réunit les personnes : contact, bail en cours (logement, part de loyer), espace en ligne (documents publiés, '
            + 'dernière connexion) et justificatifs. Sur « Tous les logements », un bandeau par logement ; les anciens locataires sans bail en cours sont repliés en bas. '
            + 'Dans « Logements & baux », le nom d’un locataire sur un bail ouvre sa ligne.',
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
            + '(« Logements & baux » → Bail signé).',
          'Le rapport PDF (en-tête sur deux blocs, plan réduit, une bande par pièce avec tableaux des postes et du mobilier, photos sur trois colonnes, signatures, annexe contradictoire, pages numérotées) se télécharge et est déposé sur l’espace de chaque colocataire.',
          'Les photos et documents sont stockés dans l’espace Firebase Storage du projet (Google Cloud, Europe) : '
            + 'dossier « etats-des-lieux » pour les photos, « documents » pour les PDF, « portail » pour ce qui est remis aux colocataires. '
            + 'Depuis un réseau qui bloque ce serveur (poste professionnel), l’application les fait transiter par sa propre adresse, sans rien changer pour vous ; '
            + 'Paramètres → « Tester le stockage » l’indique.',
          ['Enfin, ouvrez la ', h('strong', { texte: 'fenêtre contradictoire' }),
            ' (onglet « Contradictoire ») : l’état des lieux est publié sur l’espace de chaque colocataire, qui y répond point par point '
            + '(« D’accord » ou « Remarque » sur chaque poste, chaque meuble, les relevés) et dépose ses propres photos, datées et non modifiables. '
            + 'La durée se règle à l’ouverture (21 jours par défaut) et la date de fin reste modifiable ensuite. '
            + '« Relever les réponses » les affiche côté gérant, « Rappel par e-mail » relance ceux qui n’ont pas répondu, '
            + '« Rapport PDF avec annexe contradictoire » regénère le rapport avec les réponses et photos de chacun et le republie.'],
          ['Les colocataires ', h('strong', { texte: 'signent depuis leur espace' }),
            ', une fois leurs réponses complètes : signature au doigt, puis code à 6 chiffres reçu par e-mail (valable 15 minutes). '
            + 'La signature, sa date et la preuve du code sont enregistrées par le serveur ; l’onglet « Signatures » la montre « signée à distance », '
            + 'avec un rappel par e-mail pour ceux qui n’ont pas signé, et le rapport PDF l’indique. Le colocataire peut encore compléter ses remarques jusqu’à la fin de la fenêtre. '
            + 'Vous pouvez toujours le faire signer sur la tablette.'],
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Le bail signé dans l’application',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          ['Page « Logements & baux », bouton ', h('strong', { texte: 'Bail signé' }),
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
          'Renseignez l’adresse e-mail du colocataire dans « Locataires », puis ouvrez son accès dans '
            + '« Paramètres → Accès à l’application ».',
          'Donnez-lui l’adresse de son espace : https://gestion-lmnp-anika.web.app/colocataire — la page de connexion '
            + 's’ouvre directement sur « Colocataires » (le sélecteur Propriétaires / Colocataires en haut de la page permet de changer). '
            + 'Quel que soit le bouton choisi, c’est le rôle du compte qui décide de l’écran ouvert : un colocataire ne voit jamais l’espace propriétaires.',
          'Créez aussi son compte de connexion dans la console Firebase (Authentication → Users → Add user).',
          'Sur son espace, chaque état des lieux publié (entrée, sortie, plusieurs logements) est un bloc repliable, replié par défaut ; les pièces le sont aussi. '
            + '« Continuer » depuis l’accueil déplie directement l’état des lieux à compléter.',
          'Son espace est organisé en rubriques : Accueil (ce qu’il a à faire, la prochaine échéance de loyer publiée par l’appel de loyer, le dernier document), '
            + 'État des lieux (le contradictoire), Quittances et Bail & documents (rangés par année), Justificatifs, Mon compte (mot de passe, icône, adresse).',
          'L’e-mail de mise à disposition (bouton « Notifier par e-mail ») le prévient qu’un nouveau document l’attend.',
          'Dans l’autre sens, il DÉPOSE ses justificatifs (assurance habitation, entretien des climatiseurs, '
            + 'ramonage) : rubrique « Vos justificatifs à fournir » sur son espace. Côté gérant : '
            + 'page « Locataires » : un badge par pièce demandée pour chaque colocataire, « Rappel par e-mail » à ceux à qui il manque quelque chose ; '
            + 'la pastille du menu compte ces retardataires.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Connexion et fermeture',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Fermer la fenêtre, l’onglet ou l’application (balayage sur tablette) déconnecte : à la prochaine ouverture, la page de connexion s’affiche. Le verrou « un seul poste » est libéré aussitôt. Cela vaut pour les bailleurs et les colocataires.',
          'Un nouvel onglet ouvert à la main demande aussi une connexion : la session ne vaut que pour la fenêtre où elle a été ouverte.',
        ]),
      ]),
    }));

    conteneur.append(carte({
      titre: 'Plein écran et installation sur la tablette',
      corps: h('div', { class: 'aide-bloc' }, [
        liste([
          'Sur tablette ou téléphone, l’application passe en plein écran au premier toucher après le lancement (réglable dans Paramètres → « Affichage sur cet appareil ») ; le bouton ⛶ en haut à droite le bascule à tout moment.',
          'Mieux : installez-la sur l’écran d’accueil (Paramètres → « Installer l’application », ou menu du navigateur → « Ajouter à l’écran d’accueil ») : elle a alors son icône et s’ouvre sans barre d’adresse, comme une application.',
          'Deux icônes existent, une par entrée : la maison verte « LMNP » (espace propriétaires, adresse …/proprietaire) et les silhouettes bleues « Résidence ANIKA » (espace colocataires, adresse …/colocataire). Sur la page de connexion, le bouton « Installer l’icône… » sous « Se connecter » installe l’entrée affichée ; Paramètres → « Icônes de lancement » regroupe les deux entrées (installation sur ce PC, ouverture de l’entrée colocataires, adresse à copier, raccourci .url de repli). Sur PC (Chrome, Edge), la fenêtre d’installation propose « Épingler à la barre des tâches » et « Créer un raccourci sur le Bureau » ; les deux applications peuvent cohabiter sur un même appareil.',
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
