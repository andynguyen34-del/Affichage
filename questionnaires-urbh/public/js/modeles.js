// Modèles de questionnaires conformes aux attentes QUALIOPI.
//
// Types de questions :
//   echelle4 : Très insatisfaisant / Insatisfaisant / Satisfaisant / Très satisfaisant
//   note10   : note de 0 à 10
//   ouinon   : Oui / Non
//   choix    : liste de choix (champ options)
//   texte    : réponse libre
//
// Chaque question porte un identifiant stable (id) : il sert de clé dans les
// réponses enregistrées et dans les exports. Ne pas le modifier une fois des
// réponses collectées.

window.ECHELLE4_LIBELLES = [
  'Très insatisfaisant',
  'Insatisfaisant',
  'Satisfaisant',
  'Très satisfaisant',
];

window.MODELES_QUESTIONNAIRES = {
  chaud: {
    libelle: 'Évaluation à chaud (fin de journée)',
    titre: 'Questionnaire de satisfaction',
    questions: [
      {
        id: 'profil_fonction',
        section: 'Votre profil',
        libelle: 'Votre fonction',
        type: 'choix',
        options: [
          'Responsable de blanchisserie',
          'Adjoint / encadrement',
          'Agent de blanchisserie',
          'Cadre de santé / direction',
          'Fournisseur / partenaire',
          'Autre',
        ],
        obligatoire: false,
      },
      {
        id: 'org_information',
        section: 'Organisation',
        libelle: 'Information et communication avant la journée (programme, convocation, accès)',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'org_accueil',
        section: 'Organisation',
        libelle: 'Accueil et organisation générale de la journée',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'org_locaux',
        section: 'Organisation',
        libelle: 'Qualité des locaux et des conditions matérielles',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'org_restauration',
        section: 'Organisation',
        libelle: 'Restauration et pauses',
        type: 'echelle4',
        obligatoire: false,
      },
      {
        id: 'contenu_programme',
        section: 'Contenu',
        libelle: 'Conformité du contenu au programme annoncé',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'contenu_interet',
        section: 'Contenu',
        libelle: 'Intérêt et pertinence des thèmes abordés pour votre pratique professionnelle',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'contenu_supports',
        section: 'Contenu',
        libelle: 'Qualité des supports et des documents remis',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'contenu_echanges',
        section: 'Contenu',
        libelle: 'Équilibre entre les présentations et les temps d\'échange',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'interv_clarte',
        section: 'Intervenants',
        libelle: 'Clarté des présentations',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'interv_maitrise',
        section: 'Intervenants',
        libelle: 'Maîtrise des sujets par les intervenants',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'interv_reponses',
        section: 'Intervenants',
        libelle: 'Qualité des réponses apportées aux questions',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'global_attentes',
        section: 'Appréciation globale',
        libelle: 'Cette journée a-t-elle répondu à vos attentes ?',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'global_note',
        section: 'Appréciation globale',
        libelle: 'Quelle note globale donnez-vous à cette journée ?',
        type: 'note10',
        obligatoire: true,
      },
      {
        id: 'global_recommandation',
        section: 'Appréciation globale',
        libelle: 'Recommanderiez-vous cette journée d\'études à un collègue ?',
        type: 'ouinon',
        obligatoire: true,
      },
      {
        id: 'libre_points_forts',
        section: 'Vos remarques',
        libelle: 'Quels sont, selon vous, les points forts de cette journée ?',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'libre_ameliorations',
        section: 'Vos remarques',
        libelle: 'Quels points mériteraient d\'être améliorés ?',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'libre_themes',
        section: 'Vos remarques',
        libelle: 'Quels thèmes souhaiteriez-vous voir abordés lors des prochaines journées d\'études ?',
        type: 'texte',
        obligatoire: false,
      },
    ],
  },

  froid: {
    libelle: 'Évaluation à froid (quelques mois après)',
    titre: 'Questionnaire d\'évaluation à froid',
    questions: [
      {
        id: 'froid_pratique',
        section: 'Mise en pratique',
        libelle: 'Avez-vous pu mettre en pratique des connaissances acquises lors de cette journée ?',
        type: 'ouinon',
        obligatoire: true,
      },
      {
        id: 'froid_utilite',
        section: 'Mise en pratique',
        libelle: 'Dans quelle mesure les apports de cette journée vous sont-ils utiles dans votre pratique professionnelle ?',
        type: 'echelle4',
        obligatoire: true,
      },
      {
        id: 'froid_exemples',
        section: 'Mise en pratique',
        libelle: 'Donnez un ou plusieurs exemples concrets d\'application dans votre établissement',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'froid_note',
        section: 'Bilan',
        libelle: 'Avec le recul, quelle note globale donnez-vous à cette journée ?',
        type: 'note10',
        obligatoire: true,
      },
      {
        id: 'froid_besoins',
        section: 'Bilan',
        libelle: 'Quels besoins de formation complémentaires identifiez-vous ?',
        type: 'texte',
        obligatoire: false,
      },
    ],
  },

  vierge: {
    libelle: 'Questionnaire vierge (à composer)',
    titre: 'Nouveau questionnaire',
    questions: [],
  },
};
