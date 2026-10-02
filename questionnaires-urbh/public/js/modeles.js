// Modèles de questionnaires conformes aux attentes QUALIOPI.
//
// Types de questions :
//   echelle4 : Très insatisfaisant / Insatisfaisant / Satisfaisant / Très satisfaisant
//   note5    : note de 1 à 5 (1 la plus basse, 5 la meilleure)
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

  // Questionnaire officiel « Évaluation Stagiaire » des 41es journées
  // d'études (Nantes 2026), repris du document Word de l'URBH : notation de
  // 1 à 5, un bloc de cinq questions par conférence avec l'objectif annoncé
  // de chacune. À dupliquer et adapter pour les éditions suivantes.
  stagiaires: {
    libelle: 'Évaluation stagiaire — 41es JE Nantes 2026 (document officiel)',
    titre: 'Évaluation Stagiaire',
    questions: [
      {
        id: 'je_enrichissantes',
        section: 'Appréciation générale',
        libelle: 'Les JE 2026 ont-elles été enrichissantes ?',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'conf_renovations_attentes',
        section: 'Les rénovations dans les blanchisseries',
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_renovations_objectifs',
        section: 'Les rénovations dans les blanchisseries',
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des pistes et moyens pour préparer la restructuration d'une blanchisserie)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_renovations_exemples',
        section: 'Les rénovations dans les blanchisseries',
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_renovations_utilisable',
        section: 'Les rénovations dans les blanchisseries',
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_renovations_competences',
        section: 'Les rénovations dans les blanchisseries',
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_maintenance_attentes',
        section: 'La maintenance industrielle (continuité de service, fiabilité, entraide et formation)',
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_maintenance_objectifs',
        section: 'La maintenance industrielle (continuité de service, fiabilité, entraide et formation)',
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des échanges précieux entre collègues pour l'entretien du parc machines et des outils pour la gestion de la maintenance)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_maintenance_exemples',
        section: 'La maintenance industrielle (continuité de service, fiabilité, entraide et formation)',
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_maintenance_utilisable',
        section: 'La maintenance industrielle (continuité de service, fiabilité, entraide et formation)',
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_maintenance_competences',
        section: 'La maintenance industrielle (continuité de service, fiabilité, entraide et formation)',
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_ia_attentes',
        section: "L'intelligence artificielle et retours d'expériences en blanchisserie industrielle (comment l'IA vient nous aider)",
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_ia_objectifs',
        section: "L'intelligence artificielle et retours d'expériences en blanchisserie industrielle (comment l'IA vient nous aider)",
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des inspirations pour se servir de l'IA par des exemples transposables)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_ia_exemples',
        section: "L'intelligence artificielle et retours d'expériences en blanchisserie industrielle (comment l'IA vient nous aider)",
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_ia_utilisable',
        section: "L'intelligence artificielle et retours d'expériences en blanchisserie industrielle (comment l'IA vient nous aider)",
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_ia_competences',
        section: "L'intelligence artificielle et retours d'expériences en blanchisserie industrielle (comment l'IA vient nous aider)",
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_eau_attentes',
        section: "Les économies d'eau (retours d'expériences, performance environnementale)",
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_eau_objectifs',
        section: "Les économies d'eau (retours d'expériences, performance environnementale)",
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des moyens pour économiser l'eau à travers une expérience)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_eau_exemples',
        section: "Les économies d'eau (retours d'expériences, performance environnementale)",
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_eau_utilisable',
        section: "Les économies d'eau (retours d'expériences, performance environnementale)",
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_eau_competences',
        section: "Les économies d'eau (retours d'expériences, performance environnementale)",
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_sixsigma_attentes',
        section: 'Le management SIX SIGMA',
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_sixsigma_objectifs',
        section: 'Le management SIX SIGMA',
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des pistes de conduite pour augmenter la satisfaction des clients en améliorant la qualité des processus de production des produits et donc la qualité des produits)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_sixsigma_exemples',
        section: 'Le management SIX SIGMA',
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_sixsigma_utilisable',
        section: 'Le management SIX SIGMA',
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_sixsigma_competences',
        section: 'Le management SIX SIGMA',
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_chaleur_attentes',
        section: 'Protéger ses agents de la chaleur : une obligation en blanchisserie industrielle (nouveau décret, différents moyens)',
        libelle: 'Le contenu de cette intervention correspondait-il à vos attentes ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_chaleur_objectifs',
        section: 'Protéger ses agents de la chaleur : une obligation en blanchisserie industrielle (nouveau décret, différents moyens)',
        libelle: "Les objectifs et/ou apports de l'intervention étaient-ils clairement présentés ? (Des informations sur la nouvelle réglementation des exigences liées aux conditions de travail à la chaleur et des exemples de moyens mis en place)",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_chaleur_exemples',
        section: 'Protéger ses agents de la chaleur : une obligation en blanchisserie industrielle (nouveau décret, différents moyens)',
        libelle: "Les exemples, retours d'expérience et explications étaient-ils adaptés à votre activité professionnelle ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_chaleur_utilisable',
        section: 'Protéger ses agents de la chaleur : une obligation en blanchisserie industrielle (nouveau décret, différents moyens)',
        libelle: 'Cette intervention vous apporte-t-elle des éléments que vous pourrez utiliser dans votre établissement ?',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'conf_chaleur_competences',
        section: 'Protéger ses agents de la chaleur : une obligation en blanchisserie industrielle (nouveau décret, différents moyens)',
        libelle: "À l'issue de cette intervention, estimez-vous avoir développé vos connaissances ou compétences sur le sujet abordé ?",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'boite_astuces',
        section: 'La boîte à astuces',
        libelle: 'Votre appréciation de la boîte à astuces',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'orga_themes',
        section: 'Organisation des JE',
        libelle: 'Le choix des thèmes de conférences',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'orga_besoin',
        section: 'Organisation des JE',
        libelle: 'Aviez-vous identifié, avant les journées, un besoin ou une problématique particulière que vous souhaitiez approfondir ?',
        type: 'ouinon',
        obligatoire: false,
      },
      {
        id: 'orga_besoin_detail',
        section: 'Organisation des JE',
        libelle: 'Si oui, laquelle ? Avez-vous trouvé des réponses ?',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'orga_hotellerie',
        section: 'Organisation des JE',
        libelle: "La qualité de l'hôtellerie",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'orga_repas',
        section: 'Organisation des JE',
        libelle: 'La qualité des repas',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'je_global',
        section: 'Bilan',
        libelle: 'En général, ma participation aux JE 2026',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'je_prochaine',
        section: 'Bilan',
        libelle: "J'ai l'intention de participer aux JE de 2027 à BIARRITZ",
        type: 'ouinon',
        obligatoire: true,
      },
      {
        id: 'je_remarques',
        section: 'Bilan',
        libelle: "N'hésitez pas à nous faire part de vos remarques, autres commentaires, suggestions et sujets que vous souhaiteriez traiter lors des prochaines JE, en ateliers ou en conférences",
        type: 'texte',
        obligatoire: false,
      },
    ],
  },

  // Questionnaire officiel « Évaluation Partenaires techniques » des 41es
  // journées d'études (Nantes 2026), repris du document Word de l'URBH.
  // À proposer aux exposants fournisseurs uniquement.
  partenaires: {
    libelle: 'Évaluation partenaires techniques — 41es JE Nantes 2026 (document officiel)',
    titre: 'Évaluation Partenaires techniques',
    questions: [
      {
        id: 'pt_stand_numero',
        section: 'Votre stand',
        libelle: 'Numéro de stand',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'pt_qualite_prix_stand',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: 'Le rapport qualité/prix du stand',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'pt_locaux',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: 'Les locaux du centre des congrès',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'pt_tarifs_centre',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: 'Le rapport qualité/prix des tarifs proposés par le centre des congrès',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_accompagnement_urbh',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: "L'accompagnement de l'URBH à votre installation",
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'pt_accompagnement_centre',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: "L'accompagnement du centre des congrès",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_nouvelle_orga',
        section: 'Votre participation (notez de 1 à 5)',
        libelle:
          'La nouvelle organisation permettant des temps plus longs et plus nombreux (la nocturne du mercredi, la journée du jeudi / temps de pause du matin, ateliers en parallèle de la visite des stands et démarrage de la journée du vendredi en conférence à partir de 9h30)',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_choix_conferences',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: 'Le choix des conférences et des ateliers / la nouvelle organisation des ateliers',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_commentaire_conferences',
        section: 'Votre participation (notez de 1 à 5)',
        libelle: 'Commentaire éventuel — par exemple, avez-vous participé aux conférences ?',
        type: 'texte',
        obligatoire: false,
      },
      {
        id: 'pt_hotellerie',
        section: 'Organisation des JE',
        libelle: "La qualité de l'hôtellerie",
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_repas',
        section: 'Organisation des JE',
        libelle: 'La qualité des repas',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_gala',
        section: 'Organisation des JE',
        libelle: 'La soirée de gala',
        type: 'note5',
        obligatoire: false,
      },
      {
        id: 'pt_global',
        section: 'Bilan',
        libelle: 'En général, ma participation aux JE 2026',
        type: 'note5',
        obligatoire: true,
      },
      {
        id: 'pt_2027',
        section: 'Bilan',
        libelle: "J'ai l'intention de réserver un stand aux JE de 2027 à BIARRITZ",
        type: 'ouinon',
        obligatoire: true,
      },
      {
        id: 'pt_remarques',
        section: 'Bilan',
        libelle:
          "N'hésitez pas à nous faire part de vos remarques, autres commentaires et suggestions, sujets que vous souhaiteriez voir traiter lors des prochaines JE",
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

// ---------------------------------------------------------------------------
// Questionnaires officiels des ateliers 2026 (documents Word de l'URBH) :
// grille d'évaluation des connaissances posée AVANT puis EN FIN de session
// (preuve de progression attendue par Qualiopi), auto-évaluation, questions
// de satisfaction sur l'échelle « Pas du tout satisfait … Très satisfait »
// et questions qualitatives. Les corrigés restent dans les documents Word
// de l'animateur — ils ne sont volontairement pas embarqués ici.
(function () {
  const SATISFACTION = ['Pas du tout satisfait', 'Peu satisfait', 'Satisfait', 'Très satisfait'];
  const CAPACITE = ['Pas du tout', 'Plutôt pas', 'Plutôt oui', 'Tout à fait'];
  const RECOMMANDATION = ['Oui, tout à fait', 'Oui, plutôt', 'Plutôt non', 'Non, pas du tout'];

  // La même grille de connaissances est posée deux fois : avant la session
  // puis en fin de session, comme sur le document papier.
  function grilleAvantFin(prefixe, grille) {
    const blocs = [
      ['avant', 'Grille de connaissances — AVANT la session'],
      ['fin', 'Grille de connaissances — EN FIN de session'],
    ];
    const questions = [];
    blocs.forEach(([suffixe, section]) => {
      grille.forEach((q, i) => {
        questions.push({
          id: `${prefixe}_${suffixe}_q${i + 1}`,
          section,
          libelle: q[0],
          type: 'choix',
          options: q.slice(1),
          obligatoire: false,
        });
      });
    });
    return questions;
  }

  function autoEvaluation(prefixe, libelle) {
    return {
      id: `${prefixe}_auto_evaluation`,
      section: 'Auto-évaluation en fin de session',
      libelle,
      type: 'choix',
      options: CAPACITE,
      obligatoire: true,
    };
  }

  function satisfaction(prefixe, libelles) {
    return libelles.map((libelle, i) => ({
      id: `${prefixe}_satisfaction_q${i + 1}`,
      section: "Satisfaction de l'atelier",
      libelle,
      type: 'echelle4',
      libelles: SATISFACTION,
      obligatoire: true,
    }));
  }

  function qualitatives(prefixe, libellesTexte) {
    const questions = libellesTexte.map((libelle, i) => ({
      id: `${prefixe}_qualitative_q${i + 1}`,
      section: 'Vos remarques',
      libelle,
      type: 'texte',
      obligatoire: false,
    }));
    questions.push({
      id: `${prefixe}_recommandation`,
      section: 'Vos remarques',
      libelle:
        "À l'issue de cet atelier, recommanderiez-vous ce type d'intervention à un collègue ou à une autre blanchisserie ?",
      type: 'choix',
      options: RECOMMANDATION,
      obligatoire: true,
    });
    return questions;
  }

  window.MODELES_QUESTIONNAIRES.atelier_ia = {
    libelle: "Atelier « Développer ses applications métier avec l'IA » (document officiel)",
    titre: "Atelier « Développer ses applications métier avec l'IA » — Évaluation & progression",
    questions: [
      ...grilleAvantFin('ia', [
        [
          "Quel est le rôle principal de l'IA dans la création d'applications métier en blanchisserie ?",
          "Remplacer l'expertise métier et la direction",
          'Écrire le code rapidement selon les consignes fournies',
          "Gérer seule la sécurité et l'hébergement des données",
        ],
        [
          "Quelle est la première étape indispensable pour réussir la transformation d'un fichier Excel ou d'un besoin terrain en application ?",
          "Laisser l'IA tout concevoir en autonomie",
          'Avoir une bonne connaissance métier et définir clairement son besoin',
          'Acheter des licences informatiques coûteuses',
        ],
        [
          "Lors de la création d'une application (ex. calcul de prix de revient ou planning), quelle est la bonne méthode de travail avec l'IA ?",
          'Tout développer en un seul bloc',
          "Avancer par petites étapes, tester à chaque fois et piloter l'IA",
          'Ne jamais vérifier le code produit',
        ],
        [
          "Vous souhaitez faire générer par l'IA un outil de suivi de production. Parmi ces trois demandes, laquelle donnera le résultat le plus proche de votre besoin réel dès la première version ?",
          '« Fais-moi une application de suivi de production pour une blanchisserie hospitalière, moderne et facile à utiliser »',
          "« Crée un écran où le responsable de secteur saisit chaque jour, par ligne de lavage, le tonnage traité et la durée des arrêts machine ; affiche ensuite un tableau hebdomadaire par ligne avec le total et l'écart par rapport à un objectif que je pourrai modifier »",
          '« Reproduis exactement mon fichier Excel de production, avec toutes ses feuilles et ses macros »',
        ],
        [
          'Quel type de besoin terrain peut être numérisé via une application générée par IA ?',
          'Uniquement les fichiers Excel de comptabilité',
          'Divers besoins : planning mobile, suivi de production, contrôle qualité, logistique…',
          "Aucun, l'IA ne s'applique pas au terrain",
        ],
        [
          'En matière de données sensibles (RH, paie, santé), quelle vigilance doit-on conserver ?',
          "L'IA garantit la conformité sans intervention humaine",
          "L'humain doit définir et verrouiller les droits d'accès et la sécurité des bases de données",
          "Il n'y a aucun risque avec les données cloud",
        ],
        [
          "Pourquoi l'expérimentation du Benchmark URBH (prix de revient) repose-t-elle sur l'IA ?",
          'Pour remplacer les directeurs de blanchisserie',
          'Pour convertir un calcul Excel métier en une application web standardisée et comparable entre adhérents',
          'Pour automatiser les achats de linge',
        ],
        [
          "L'IA a converti votre fichier Excel de prix de revient en application web. Sur deux sites, l'application affiche un coût au kilo différent de celui de votre fichier. Quelle est la bonne réaction ?",
          "Faire confiance à l'application : l'IA a probablement corrigé une erreur de formule présente dans le fichier Excel",
          "Isoler un cas d'écart précis, vérifier à la main la règle de calcul attendue, puis demander à l'IA de corriger et retester ce cas avant d'aller plus loin",
          "Demander à l'IA de « recommencer tout le calcul » jusqu'à ce que les chiffres correspondent",
        ],
      ]),
      autoEvaluation(
        'ia',
        "À l'issue de cette session, je me sens capable d'envisager l'utilisation de l'IA ou de développer une application métier dans mon activité professionnelle",
      ),
      ...satisfaction('ia', [
        "Le contenu de l'atelier correspondait-il à vos attentes ?",
        'Les objectifs et le déroulement de la présentation étaient-ils clairs ?',
        "Les retours d'expérience et démonstrations vous ont-ils permis de mieux comprendre le potentiel de l'IA ?",
        'Les exemples présentés (Benchmark URBH, applications de gestion…) étaient-ils adaptés au secteur hospitalier/blanchisserie ?',
        "L'atelier vous a-t-il permis de prendre conscience qu'il est possible de numériser vos besoins sans compétences avancées en codage ?",
        'Le rythme et les échanges de la session étaient-ils adaptés ?',
        'Les supports présentés étaient-ils clairs et inspirants ?',
        'Globalement, êtes-vous satisfait(e) de cet atelier ?',
      ]),
      ...qualitatives('ia', [
        "Quel est le principal enseignement que vous retenez de cet atelier (par exemple : rôle de l'IA, rigueur, faisabilité…) ?",
        "Quel projet ou fichier (par exemple : calcul Excel, suivi de production, planning…) envisageriez-vous de faire évoluer grâce à l'IA dans votre établissement ?",
      ]),
    ],
  };

  window.MODELES_QUESTIONNAIRES.atelier_maintenance = {
    libelle: 'Atelier Maintenance — levier stratégique de performance (document officiel)',
    titre: 'Atelier Maintenance — Évaluation & progression',
    questions: [
      ...grilleAvantFin('maint', [
        [
          "Quel est l'enjeu principal de la maintenance en blanchisserie hospitalière ?",
          "Garantir la continuité d'activité et la qualité microbiologique (RABC)",
          "Uniquement réduire le coût d'achat du matériel",
          "Remplacer totalement les équipes d'exploitation",
        ],
        [
          'Quelle est la différence majeure entre la maintenance corrective et la maintenance préventive ?',
          "La corrective intervient après une panne, la préventive cherche à l'éviter avant qu'elle ne survienne",
          "Les deux interventions se font uniquement sur équipement à l'arrêt complet",
          'La préventive est réservée aux prestataires extérieurs',
        ],
        [
          'Dans le cadre de la démarche RABC, quel rôle joue la maintenance ?',
          'Assurer la maîtrise sanitaire en garantissant les températures, cycles et paramètres microbiologiques',
          'Aucun rôle, la démarche RABC concerne uniquement le tri du linge',
          'Rédiger le manuel qualité sans intervenir sur les machines',
        ],
        [
          "Quel outil est indispensable pour gérer la planification, l'historique des pannes et les coûts de maintenance ?",
          'Une GMAO (Gestion de Maintenance Assistée par Ordinateur)',
          "Uniquement un cahier papier à l'accueil",
          'Une boîte mail partagée',
        ],
        [
          'Parmi les propositions suivantes, laquelle relève de la maintenance de 1er niveau ?',
          'Nettoyage des filtres, graissage de base et contrôles visuels par les opérateurs/agents',
          "Refonte complète de la carte électronique d'un tunnel de lavage",
          'Audit externe de certification',
        ],
        [
          'Pourquoi la traçabilité et le suivi des vérifications réglementaires sont-ils cruciaux ?',
          'Pour répondre aux obligations du Code du Travail et assurer la sécurité des agents',
          'Pour augmenter le poids du linge traité',
          'Uniquement pour faire plaisir aux fournisseurs',
        ],
        [
          "Parmi ces indicateurs, lesquels permettent d'évaluer la performance de la maintenance ?",
          'Le taux de disponibilité des équipements, le coût de maintenance et le taux de pannes',
          'Le nombre de visiteurs dans la blanchisserie',
          "Uniquement la consommation de café de l'équipe",
        ],
        [
          "Comment la maintenance peut-elle optimiser sa gestion lors d'une panne majeure (ex. : tunnel de lavage) ?",
          "En s'appuyant sur des procédures de dégradé, un plan d'actions préétabli et la communication avec l'exploitation",
          "En arrêtant immédiatement toute l'activité de l'hôpital sans prévenir",
          'En commandant systématiquement une machine neuve',
        ],
        [
          "Vrai ou faux : les fiches d'intervention et le suivi par GMAO permettent d'alimenter la démarche d'amélioration continue.",
          'Vrai',
          'Faux',
          'Je ne sais pas',
        ],
        [
          'Quelle est la meilleure approche pour renforcer la synergie entre la maintenance et les équipes de production ?',
          "Former les agents à la maintenance de 1er niveau et favoriser des réunions d'exploitation régulières",
          "Interdire l'accès des ateliers de maintenance aux équipes de production",
          "Externaliser 100 % de la maintenance auprès d'un prestataire unique",
        ],
      ]),
      autoEvaluation(
        'maint',
        "À l'issue de cette session, je me sens capable d'appliquer la démarche d'organisation et de suivi de la maintenance dans ma blanchisserie",
      ),
      ...satisfaction('maint', [
        "Le contenu de l'atelier correspondait-il à vos attentes ?",
        "Les objectifs et le contenu de l'atelier étaient-ils clairs ?",
        "Les explications et retours d'expérience vous ont-ils permis de mieux comprendre les enjeux de la maintenance ?",
        'Les exemples présentés (GMAO, plans préventifs, cas pratiques) étaient-ils adaptés aux problématiques de votre blanchisserie ?',
        "L'atelier vous a-t-il permis d'identifier des pistes d'amélioration concrètes pour l'organisation de votre maintenance ?",
        "Le rythme et la durée de l'atelier étaient-ils adaptés ?",
        'Les supports utilisés étaient-ils adaptés et suffisamment clairs ?',
        'Globalement, êtes-vous satisfait(e) de cet atelier ?',
      ]),
      ...qualitatives('maint', [
        'Quel est le principal enseignement que vous retenez de cet atelier ?',
        'Quelle action ou outil (par exemple : GMAO, maintenance 1er niveau, plan préventif) envisagez-vous de mettre en pratique à la suite de cet atelier ?',
        "Quelles améliorations ou quels sujets souhaiteriez-vous voir abordés lors d'une prochaine session ?",
      ]),
    ],
  };

  window.MODELES_QUESTIONNAIRES.atelier_rabc = {
    libelle: 'Atelier RABC & IA (document officiel)',
    titre: 'Atelier RABC & IA — Évaluation & progression',
    questions: [
      ...grilleAvantFin('rabc', [
        [
          "Quel est le principal intérêt de l'IA dans une démarche qualité en blanchisserie ?",
          "Gagner du temps dans la recherche et la production d'informations",
          'Remplacer les procédures qualité',
          'Supprimer les contrôles qualité',
        ],
        [
          'Quelle est la différence principale entre ChatGPT et NotebookLM ?',
          'ChatGPT est principalement un outil de création et de génération ; NotebookLM travaille à partir des documents qui lui sont fournis',
          'Les deux outils fonctionnent exactement de la même manière',
          'NotebookLM sert uniquement à créer des affiches',
        ],
        [
          'Pour retrouver rapidement une information dans un ensemble de documents RABC, quel outil est particulièrement adapté ?',
          'NotebookLM',
          'ChatGPT uniquement',
          "Aucun outil d'IA",
        ],
        [
          'Quel type de documents peut-on intégrer dans NotebookLM pour travailler sur son système documentaire ?',
          "Manuel qualité, procédures, modes opératoires, plans de maîtrise, comptes rendus d'audits…",
          'Uniquement des photos',
          "Uniquement des documents créés par l'IA",
        ],
        ["L'IA peut-elle aider à préparer un audit RABC ?", 'Oui', 'Non', 'Uniquement pour rédiger le compte rendu'],
        [
          "Parmi les propositions suivantes, laquelle correspond à un usage de l'IA pour un audit ?",
          'Préparer des grilles de contrôle et vérifier des exigences documentaires',
          'Décider seule de la conformité de la blanchisserie',
          "Remplacer l'auditeur",
        ],
        [
          "Comment l'IA peut-elle contribuer à la formation des nouveaux agents ?",
          'Transformer des procédures complexes en supports pédagogiques, guides de révision ou évaluations',
          'Remplacer systématiquement le formateur',
          'Supprimer les procédures',
        ],
        [
          "Comment l'IA peut-elle aider à communiquer les exigences qualité auprès des agents ?",
          'Adapter le langage et créer des supports visuels ou des messages adaptés au terrain',
          'Rendre les procédures plus complexes',
          'Supprimer les informations réglementaires',
        ],
        [
          'Vrai ou faux : ChatGPT et NotebookLM peuvent être utilisés de manière complémentaire dans une démarche qualité.',
          'Vrai',
          'Faux',
          'Je ne sais pas',
        ],
        [
          "Pour créer une affiche de sensibilisation ou transformer une non-conformité en plan d'action, quel outil peut être particulièrement utile ?",
          'ChatGPT',
          'NotebookLM uniquement',
          "Aucun outil d'IA",
        ],
      ]),
      autoEvaluation(
        'rabc',
        "À l'issue de cette session, je me sens capable d'utiliser l'IA dans mon activité professionnelle",
      ),
      ...satisfaction('rabc', [
        "Le contenu de l'atelier correspondait-il à vos attentes ?",
        "Les objectifs et le contenu de l'atelier étaient-ils clairs ?",
        "Les explications et démonstrations vous ont-elles permis de mieux comprendre les possibilités offertes par l'IA ?",
        'Les exemples présentés étaient-ils adaptés aux problématiques rencontrées en blanchisserie ?',
        "L'atelier vous a-t-il permis d'identifier des applications concrètes de l'IA dans votre activité professionnelle ?",
        "Le rythme et la durée de l'atelier étaient-ils adaptés ?",
        'Les supports utilisés étaient-ils adaptés et suffisamment clairs ?',
        'Globalement, êtes-vous satisfait(e) de cet atelier ?',
      ]),
      ...qualitatives('rabc', [
        'Quel est le principal enseignement que vous retenez de cet atelier ?',
        "Quelle utilisation de l'IA envisagez-vous de mettre en pratique à la suite de cet atelier ?",
        "Quelles améliorations ou quels sujets souhaiteriez-vous voir abordés lors d'une prochaine session ?",
      ]),
    ],
  };
})();
