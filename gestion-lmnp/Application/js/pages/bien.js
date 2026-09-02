// Logement, locataires et baux.

import * as etat from '../etat.js';
import { h, carte, tableau, bouton, badge, vide, formulaire, confirmer, executer, barreOutils,
  ouvrirModale, fermerModale } from '../ui.js';
import { montant, date, nombre, isoDepuis, aujourdhui, anneeDe } from '../format.js';
import { loyerIndexe } from '../calculs/loyers.js';
import { ouvrirBailSignatures } from './bail-signature.js';
import { CATEGORIES_JUSTIFICATIFS, categorieDuChemin } from '../justificatifs.js';
import * as api from '../api.js';
import { notifier, signalerErreur } from '../ui.js';

const TYPES_BIEN = ['Appartement', 'Maison', 'Studio', 'Chambre', 'Local'].map((v) => ({ valeur: v, libelle: v }));
const TYPES_BAIL = [
  { valeur: 'meuble', libelle: 'Meublé — 1 an renouvelable' },
  { valeur: 'etudiant', libelle: 'Meublé étudiant — 9 mois' },
  { valeur: 'mobilite', libelle: 'Bail mobilité — 1 à 10 mois' },
  { valeur: 'saisonnier', libelle: 'Location saisonnière' },
  { valeur: 'autre', libelle: 'Autre' },
];

const champsBien = () => [
  { cle: 'nom', libelle: 'Nom du logement', type: 'texte', requis: true, exemple: 'Maison SML — Anika', largeur: 'pleine' },
  { cle: 'type', libelle: 'Type', type: 'liste', options: TYPES_BIEN },
  { cle: 'surface', libelle: 'Surface (m²)', type: 'nombre' },
  { cle: 'adresse', libelle: 'Adresse', type: 'texte', requis: true, largeur: 'pleine' },
  { cle: 'codePostal', libelle: 'Code postal', type: 'texte' },
  { cle: 'ville', libelle: 'Ville', type: 'texte' },
  { cle: 'notes', libelle: 'Notes', type: 'zone' },
];

const champsLocataire = () => [
  { cle: 'nom', libelle: 'Nom', type: 'texte', requis: true },
  { cle: 'prenom', libelle: 'Prénom', type: 'texte' },
  { cle: 'email', libelle: 'Courriel', type: 'texte' },
  { cle: 'telephone', libelle: 'Téléphone', type: 'texte' },
  { cle: 'adresse', libelle: 'Adresse de correspondance', type: 'texte', largeur: 'pleine' },
  { cle: 'notes', libelle: 'Notes', type: 'zone' },
];

function champsBail(donnees) {
  const biens = donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }));
  const locataires = donnees.locataires.map((l) => ({ valeur: l.id, libelle: `${l.nom} ${l.prenom || ''}`.trim() }));
  return [
    { cle: 'bienId', libelle: 'Logement', type: 'liste', options: biens, requis: true },
    { cle: 'type', libelle: 'Type de bail', type: 'liste', options: TYPES_BAIL, requis: true },
    { cle: 'locataireId', libelle: 'Locataire', type: 'liste', options: locataires, requis: true },
    { cle: 'coTitulaireId', libelle: 'Co-titulaire (facultatif)', type: 'liste', options: [{ valeur: '', libelle: '—' }, ...locataires] },
    { cle: 'dateDebut', libelle: 'Début du bail', type: 'date', requis: true },
    { cle: 'dateFin', libelle: 'Fin du bail (si connue)', type: 'date' },
    { cle: 'loyerHc', libelle: 'Loyer hors charges (€/mois)', type: 'montant', requis: true },
    { cle: 'provisionCharges', libelle: 'Provision pour charges (€/mois)', type: 'montant' },
    { cle: 'depotGarantie', libelle: 'Dépôt de garantie (€)', type: 'montant', aide: 'N’est pas une recette imposable.' },
    { cle: 'jourEcheance', libelle: 'Jour d’échéance', type: 'entier', min: 1, max: 28 },
    { cle: 'moisRevision', libelle: 'Mois de révision du loyer', type: 'entier', min: 1, max: 12 },
    { cle: 'irlReference', libelle: 'Indice IRL de référence', type: 'nombre', aide: 'Valeur de l’IRL inscrite au bail.' },
    { cle: 'notes', libelle: 'Notes', type: 'zone' },
  ];
}

const nomLocataire = (donnees, id) => {
  const locataire = donnees.locataires.find((l) => l.id === id);
  return locataire ? `${locataire.nom} ${locataire.prenom || ''}`.trim() : '—';
};

export function bailEstActif(bail, dateReference = aujourdhui()) {
  if (!bail.dateDebut || bail.dateDebut > dateReference) return false;
  return !bail.dateFin || bail.dateFin >= dateReference;
}

async function ouvrirBien(donnees, bienExistant) {
  const valeurs = bienExistant || { type: 'Maison', partTerrain: 15, dateAcquisition: '' };
  const saisie = await formulaire({
    titre: bienExistant ? 'Modifier le logement' : 'Déclarer un logement',
    champs: champsBien(),
    valeurs,
    large: true,
  });
  if (saisie) await executer(etat.enregistrer('biens', saisie), 'Logement enregistré.');
}

async function ouvrirLocataire(locataireExistant) {
  const saisie = await formulaire({
    titre: locataireExistant ? 'Modifier le locataire' : 'Nouveau locataire',
    champs: champsLocataire(),
    valeurs: locataireExistant || {},
  });
  if (saisie) await executer(etat.enregistrer('locataires', saisie), 'Locataire enregistré.');
}

async function ouvrirBail(donnees, bailExistant) {
  if (!donnees.biens.length) { await ouvrirBien(donnees, null); return; }
  if (!donnees.locataires.length) { await ouvrirLocataire(null); return; }
  const valeurs = bailExistant || {
    bienId: donnees.biens[0].id,
    type: 'meuble',
    jourEcheance: 1,
    moisRevision: 1,
    provisionCharges: 0,
  };
  const saisie = await formulaire({
    titre: bailExistant ? 'Modifier le bail' : 'Nouveau bail',
    champs: champsBail(donnees),
    valeurs,
    large: true,
  });
  if (saisie) await executer(etat.enregistrer('baux', saisie), 'Bail enregistré.');
}

async function reviserLoyer(bail) {
  const saisie = await formulaire({
    titre: 'Réviser le loyer selon l’IRL',
    aide: 'Le nouveau loyer est calculé ainsi : loyer actuel × (nouvel indice ÷ indice de référence).',
    champs: [
      { cle: 'irlReference', libelle: 'Indice de référence du bail', type: 'nombre', requis: true },
      { cle: 'irlNouveau', libelle: 'Nouvel indice IRL', type: 'nombre', requis: true },
      { cle: 'dateEffet', libelle: 'Date d’effet', type: 'date', requis: true },
    ],
    valeurs: { irlReference: bail.irlReference, dateEffet: isoDepuis(new Date().getFullYear(), bail.moisRevision || 1, 1) },
  });
  if (!saisie) return;
  const nouveau = loyerIndexe(bail.loyerHc, saisie.irlReference, saisie.irlNouveau);
  if (nouveau === null) return;
  const confirme = await confirmer({
    titre: 'Confirmer la révision',
    message: `Le loyer passe de ${montant(bail.loyerHc)} à ${montant(nouveau)} par mois à compter du ${date(saisie.dateEffet)}.`,
    libelleValider: 'Appliquer',
  });
  if (!confirme) return;
  const revisions = [...(bail.revisions || []), {
    dateEffet: saisie.dateEffet,
    ancienLoyer: bail.loyerHc,
    nouveauLoyer: nouveau,
    irlReference: saisie.irlReference,
    irlNouveau: saisie.irlNouveau,
  }];
  await executer(
    etat.enregistrer('baux', { ...bail, loyerHc: nouveau, irlReference: saisie.irlNouveau, revisions }),
    'Loyer révisé.',
  );
}

function carteBien(donnees, bien) {
  const bauxDuBien = donnees.baux.filter((b) => b.bienId === bien.id);
  const actif = bauxDuBien.find((b) => bailEstActif(b));

  return carte({
    titre: bien.nom,
    aide: [bien.adresse, [bien.codePostal, bien.ville].filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    actions: [
      bouton('Modifier', () => ouvrirBien(donnees, bien), { petit: true }),
      bouton('Supprimer', async () => {
        const confirme = await confirmer({
          titre: 'Supprimer le logement',
          message: `« ${bien.nom} » sera retiré. Les baux rattachés resteront enregistrés mais ne seront plus reliés à un logement.`,
          libelleValider: 'Supprimer', danger: true,
        });
        if (confirme) await executer(etat.supprimer('biens', bien.id), 'Logement supprimé.');
      }, { petit: true, type: 'danger' }),
    ],
    corps: h('div', { class: 'grille grille-4' }, [
      infoBloc('Surface', bien.surface ? `${nombre(bien.surface, 0)} m²` : '—'),
      infoBloc('Loyer en cours', actif ? `${montant(actif.loyerHc)} + ${montant(actif.provisionCharges || 0)}` : '—'),
      infoBloc('Baux enregistrés', String(bauxDuBien.length)),
      infoBloc('Colocataires du bail actif', actif ? String((actif.colocataires || []).length || 1) : '—'),
    ]),
  });
}

/**
 * Répartition du loyer entre colocataires : chacun a sa part de loyer et de
 * charges — elle détermine ses échéances mensuelles et ses quittances.
 */
async function repartirColocataires(donnees, bail) {
  const lignes = (bail.colocataires && bail.colocataires.length)
    ? bail.colocataires.map((c) => ({ ...c }))
    : [bail.locataireId, bail.coTitulaireId].filter(Boolean)
      .map((id) => ({ locataireId: id, partLoyer: 0, partCharges: 0 }));
  const zone = h('div');
  const totalAttendu = `${montant(bail.loyerHc)} + ${montant(bail.provisionCharges || 0)} de charges`;

  const dessinerLignes = () => {
    zone.replaceChildren();
    lignes.forEach((ligne, index) => {
      const options = donnees.locataires.map((l) => h('option', {
        value: l.id, selected: l.id === ligne.locataireId,
      }, `${l.prenom || ''} ${l.nom}`.trim()));
      zone.append(h('div', { style: 'display:flex;gap:.6rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap' }, [
        h('select', { style: 'flex:2;min-width:10rem', onchange: (e) => { ligne.locataireId = e.target.value; } }, options),
        h('input', {
          type: 'number', step: '0.01', min: '0', value: ligne.partLoyer || 0,
          style: 'flex:1;min-width:6rem', title: 'Part de loyer (€/mois)',
          oninput: (e) => { ligne.partLoyer = Number(e.target.value) || 0; },
        }),
        h('input', {
          type: 'number', step: '0.01', min: '0', value: ligne.partCharges || 0,
          style: 'flex:1;min-width:6rem', title: 'Part de charges (€/mois)',
          oninput: (e) => { ligne.partCharges = Number(e.target.value) || 0; },
        }),
        h('button', { class: 'bouton bouton-petit bouton-danger', type: 'button', onclick: () => {
          lignes.splice(index, 1); dessinerLignes();
        } }, '✕'),
      ]));
    });
  };
  dessinerLignes();

  await new Promise((resoudre) => {
    ouvrirModale({
      titre: 'Répartition entre colocataires',
      large: true,
      corps: h('div', {}, [
        h('p', { class: 'legende', texte: `Bail : ${totalAttendu} par mois. Colonnes : colocataire, part de loyer (€), part de charges (€).` }),
        zone,
        h('button', { class: 'bouton bouton-petit', type: 'button', style: 'margin-top:.4rem', onclick: () => {
          const dejaPris = new Set(lignes.map((l) => l.locataireId));
          const libre = donnees.locataires.find((l) => !dejaPris.has(l.id));
          lignes.push({ locataireId: libre?.id || donnees.locataires[0]?.id || '', partLoyer: 0, partCharges: 0 });
          dessinerLignes();
        } }, '+ Ajouter un colocataire'),
      ]),
      pied: [
        h('button', { class: 'bouton', type: 'button', onclick: () => { fermerModale(); resoudre(); } }, 'Annuler'),
        h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: async () => {
          const propres = lignes.filter((l) => l.locataireId);
          const sommeLoyer = propres.reduce((s, l) => s + (Number(l.partLoyer) || 0), 0);
          const sommeCharges = propres.reduce((s, l) => s + (Number(l.partCharges) || 0), 0);
          const attendu = (Number(bail.loyerHc) || 0) + (Number(bail.provisionCharges) || 0);
          fermerModale();
          if (Math.abs(sommeLoyer + sommeCharges - attendu) > 0.02 && attendu > 0) {
            const ok = await confirmer({
              titre: 'Sommes différentes du bail',
              message: `Les parts saisies totalisent ${montant(sommeLoyer + sommeCharges)} alors que le bail prévoit ${montant(attendu)} par mois. Enregistrer quand même ?`,
              libelleValider: 'Enregistrer',
            });
            if (!ok) { resoudre(); return; }
          }
          await executer(etat.enregistrer('baux', { ...bail, colocataires: propres }), 'Répartition enregistrée.');
          resoudre();
        } }, 'Enregistrer'),
      ],
      surFermeture: () => resoudre(),
    });
  });
}

/**
 * Justificatifs fournis par les colocataires depuis leur espace (assurance,
 * entretien des climatiseurs, ramonage…) : relevé par colocataire, avec
 * rappel par e-mail de ce qui manque.
 */
function carteJustificatifs(donnees) {
  // Bail de référence : le bail de colocation actif, sinon le plus récent
  // (un bail signé qui démarre bientôt compte déjà — les justificatifs sont
  // à fournir dès la remise des clés).
  const bauxColoc = donnees.baux.filter((b) => (b.colocataires || []).length)
    .sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)));
  const bailRef = bauxColoc.find((b) => bailEstActif(b)) || bauxColoc[0];
  const ids = bailRef ? bailRef.colocataires.map((c) => c.locataireId).filter(Boolean) : [];
  const locataires = ids.map((id) => donnees.locataires.find((l) => l.id === id)).filter(Boolean);
  const zone = h('div');

  const relever = async () => {
    zone.replaceChildren(h('p', { class: 'legende', texte: 'Relevé en cours…' }));
    const blocs = [];
    for (const locataire of locataires) {
      const email = String(locataire.email || '').trim().toLowerCase();
      const nom = `${locataire.prenom || ''} ${locataire.nom}`.trim();
      if (!email) {
        blocs.push(h('div', { style: 'margin-bottom:.7rem' }, [
          h('strong', { texte: nom }),
          h('span', { class: 'legende', texte: ' — pas d’adresse e-mail, donc pas d’espace : à renseigner (Modifier).' }),
        ]));
        continue;
      }
      let fichiers = [];
      /* eslint-disable no-await-in-loop */
      try { fichiers = await api.listerFichiers('portail', `${email}/justificatifs`); } catch { /* rien */ }
      const parCategorie = new Map();
      for (const fichier of fichiers) {
        const cle = categorieDuChemin(fichier.chemin);
        if (!parCategorie.has(cle)) parCategorie.set(cle, []);
        parCategorie.get(cle).push(fichier);
      }
      const manquants = CATEGORIES_JUSTIFICATIFS.filter((c) => c.cle !== 'autre' && !(parCategorie.get(c.cle) || []).length);
      blocs.push(h('div', { style: 'margin-bottom: .9rem' }, [
        h('div', { style: 'display:flex;align-items:center;gap:.6rem;flex-wrap:wrap' }, [
          h('strong', { texte: nom }),
          ...CATEGORIES_JUSTIFICATIFS.filter((c) => c.cle !== 'autre').map((c) => {
            const nb = (parCategorie.get(c.cle) || []).length;
            return badge(`${c.libelle.split(' ')[0]} ${nb ? '✓' : '—'}`, nb ? 'succes' : 'attente');
          }),
          manquants.length ? bouton('Rappel par e-mail', async () => {
            const bailleur = donnees.parametres.bailleurs?.[0];
            await api.envoyerCourriel({
              destinataires: [email],
              sujet: 'Justificatifs à déposer sur votre espace',
              html: `<p>Bonjour ${locataire.prenom || ''},</p>`
                + '<p>Merci de déposer sur votre espace les justificatifs suivants, prévus par le bail :</p>'
                + `<ul>${manquants.map((c) => `<li>${c.libelle}${c.periodicite ? ` (${c.periodicite})` : ''}</li>`).join('')}</ul>`
                + `<p><a href="${window.location.origin}">${window.location.origin}</a> — rubrique « Vos justificatifs à fournir ».</p>`
                + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
            });
            notifier(`Rappel envoyé à ${email}.`, 'succes');
          }, { petit: true }) : null,
        ]),
        ...[...parCategorie.entries()].map(([cle, listeFichiers]) => h('div', { style: 'margin:.25rem 0 0 .2rem' }, [
          h('span', { class: 'legende', texte: `${CATEGORIES_JUSTIFICATIFS.find((c) => c.cle === cle)?.libelle || cle} : ` }),
          ...listeFichiers.map((f) => bouton(f.nom, () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur), { petit: true })),
        ])),
      ]));
    }
    zone.replaceChildren(...(blocs.length ? blocs : [h('p', { class: 'legende', texte: 'Aucun colocataire sur le bail en cours.' })]));
  };

  zone.append(
    h('p', { class: 'legende', texte: 'Chaque colocataire dépose depuis son espace : attestation d’assurance habitation '
      + '(chaque année), entretien des climatiseurs, ramonage de la cheminée. Les documents déposés ne sont ni '
      + 'modifiables ni supprimables par lui.' }),
    bouton('Relever les justificatifs', () => relever().catch(signalerErreur), { type: 'primaire', petit: true }),
  );

  return carte({ titre: 'Justificatifs des colocataires', corps: zone });
}

const infoBloc = (libelle, valeur) => h('div', {}, [
  h('div', { class: 'tuile-libelle', texte: libelle }),
  h('div', { style: 'font-weight:600', texte: valeur }),
]);

export default {
  cle: 'bien',
  libelle: 'Bien & baux',
  icone: '🏠',
  titre: 'Bien, locataires et baux',
  sousTitre: 'Le logement, les personnes qui l’occupent et les conditions de location.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');

    conteneur.append(barreOutils([
      bouton('+ Logement', () => ouvrirBien(donnees, null), { type: 'primaire' }),
      bouton('+ Locataire', () => ouvrirLocataire(null)),
      bouton('+ Bail', () => ouvrirBail(donnees, null)),
    ]));

    if (!donnees.biens.length) {
      conteneur.append(carte({
        titre: 'Aucun logement déclaré',
        corps: vide('Commencez ici', 'Déclarez le logement loué : son adresse, sa date d’acquisition et son prix de revient. '
          + 'Ces informations servent ensuite au calcul des amortissements et du rendement.'),
      }));
      return conteneur;
    }

    donnees.biens.forEach((bien) => conteneur.append(carteBien(donnees, bien)));

    // ------------------------------------------------------------- baux
    const colonnesBaux = [
      { titre: 'Locataires', valeur: (b) => {
        const colocataires = (b.colocataires || []).filter((c) => c.locataireId);
        if (colocataires.length) {
          return h('div', {}, colocataires.map((c) => h('div', { class: colocataires.indexOf(c) ? 'legende' : '', texte:
            `${nomLocataire(donnees, c.locataireId)} — ${montant((Number(c.partLoyer) || 0) + (Number(c.partCharges) || 0))}` })));
        }
        return h('div', {}, [
          h('div', { texte: nomLocataire(donnees, b.locataireId) }),
          b.coTitulaireId ? h('div', { class: 'legende', texte: `et ${nomLocataire(donnees, b.coTitulaireId)}` }) : null,
        ]);
      } },
      { titre: 'Logement', valeur: (b) => donnees.biens.find((x) => x.id === b.bienId)?.nom || '—' },
      { titre: 'Période', valeur: (b) => `${date(b.dateDebut)} → ${b.dateFin ? date(b.dateFin) : 'en cours'}` },
      { titre: 'Loyer HC', nombre: true, valeur: (b) => montant(b.loyerHc) },
      { titre: 'Charges', nombre: true, valeur: (b) => montant(b.provisionCharges || 0) },
      { titre: 'Dépôt', nombre: true, valeur: (b) => montant(b.depotGarantie || 0) },
      { titre: 'État', valeur: (b) => (bailEstActif(b) ? badge('En cours', 'succes') : badge('Terminé', 'attente')) },
      { titre: '', actions: true, valeur: (b) => h('div', { class: 'groupe-boutons' }, [
        bouton('Répartir', () => repartirColocataires(donnees, b), {
          petit: true, titre: 'Répartir le loyer entre les colocataires (parts individuelles)',
        }),
        bouton('Réviser', () => reviserLoyer(b), { petit: true, titre: 'Réviser le loyer selon l’indice IRL' }),
        bouton('Bail signé', () => ouvrirBailSignatures(donnees, b), {
          petit: true, titre: 'Joindre le PDF du bail, recueillir les signatures à l’écran et le déposer sur les espaces colocataires',
        }),
        bouton('Modifier', () => ouvrirBail(donnees, b), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer le bail',
            message: 'Les loyers déjà enregistrés pour ce bail resteront dans le dossier mais ne seront plus rattachés.',
            libelleValider: 'Supprimer', danger: true,
          });
          if (confirme) await executer(etat.supprimer('baux', b.id), 'Bail supprimé.');
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    conteneur.append(carte({
      titre: 'Baux',
      aide: 'Le bail détermine les échéances de loyer attendues chaque mois.',
      serre: true,
      corps: tableau({
        colonnes: colonnesBaux,
        lignes: [...donnees.baux].sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut))),
        messageVide: 'Aucun bail enregistré.',
        cle: (b) => b.id,
      }),
    }));

    // -------------------------------------------------------- locataires
    conteneur.append(carte({
      titre: 'Locataires',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Nom', valeur: (l) => `${l.nom} ${l.prenom || ''}`.trim() },
          { titre: 'Courriel', valeur: (l) => l.email || '—' },
          { titre: 'Téléphone', valeur: (l) => l.telephone || '—' },
          { titre: 'Baux', nombre: true, valeur: (l) => String(donnees.baux.filter((b) => b.locataireId === l.id
            || b.coTitulaireId === l.id || (b.colocataires || []).some((c) => c.locataireId === l.id)).length) },
          { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
            bouton('Modifier', () => ouvrirLocataire(l), { petit: true }),
            bouton('✕', async () => {
              const confirme = await confirmer({
                titre: 'Supprimer le locataire', message: `Supprimer ${l.nom} ${l.prenom || ''} ?`,
                libelleValider: 'Supprimer', danger: true,
              });
              if (confirme) await executer(etat.supprimer('locataires', l.id), 'Locataire supprimé.');
            }, { petit: true, type: 'danger' }),
          ]) },
        ],
        lignes: donnees.locataires,
        messageVide: 'Aucun locataire enregistré.',
        cle: (l) => l.id,
      }),
    }));

    conteneur.append(carteJustificatifs(donnees));

    const revisions = donnees.baux.flatMap((b) => (b.revisions || []).map((r) => ({ ...r, bail: b })));
    if (revisions.length) {
      conteneur.append(carte({
        titre: 'Historique des révisions de loyer',
        serre: true,
        corps: tableau({
          colonnes: [
            { titre: 'Date d’effet', valeur: (r) => date(r.dateEffet) },
            { titre: 'Locataire', valeur: (r) => nomLocataire(donnees, r.bail.locataireId) },
            { titre: 'Ancien loyer', nombre: true, valeur: (r) => montant(r.ancienLoyer) },
            { titre: 'Nouveau loyer', nombre: true, valeur: (r) => montant(r.nouveauLoyer) },
            { titre: 'IRL', valeur: (r) => `${nombre(r.irlReference, 2)} → ${nombre(r.irlNouveau, 2)}` },
          ],
          lignes: revisions.sort((a, b) => String(b.dateEffet).localeCompare(String(a.dateEffet))),
          messageVide: '',
        }),
      }));
    }

    return conteneur;
  },
};
