// Boîte de réception des factures : lecture du dossier « Factures »,
// intégration en comptabilité et rangement automatique.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer,
  barreOutils, notifier, signalerErreur, choisirFichier, ouvrirModale } from '../ui.js';
import { montant, date, taille, anneeDe, centimes, aujourdhui } from '../format.js';
import * as lecture from '../calculs/factures.js';

const TONS_CONFIANCE = { haute: 'succes', moyenne: 'attention', faible: 'alerte' };
const LIBELLES_CONFIANCE = { haute: 'Complète', moyenne: 'À compléter', faible: 'À saisir' };

/**
 * Crée la charge, range la facture, relie les deux — dans cet ordre, pour
 * qu'un échec du rangement laisse une dépense correcte pointant sur le fichier
 * encore en boîte de réception (situation rattrapable), plutôt qu'une facture
 * rangée sans dépense (perdue).
 */
async function integrer(fichier, valeurs) {
  const annee = anneeDe(valeurs.date) || new Date().getFullYear();
  // Clé stable indépendante du chemin : empêche qu'une même facture,
  // intégrée en même temps depuis les deux postes, crée deux dépenses.
  const cleFacture = `facture:${fichier.nom}:${fichier.taille}`;
  const dejaFaite = etat.liste('charges').some((c) => c.cleFacture === cleFacture);
  if (dejaFaite) return false;

  const charge = await etat.enregistrer('charges', {
    date: valeurs.date,
    dateReglement: valeurs.dateReglement || valeurs.date,
    categorie: valeurs.categorie,
    libelle: valeurs.libelle,
    fournisseur: valeurs.fournisseur || '',
    montant: Number(valeurs.montant) || 0,
    bienId: valeurs.bienId || '',
    deductible: valeurs.deductible !== false,
    tauxDeduction: valeurs.tauxDeduction ?? 100,
    immobilise: !!valeurs.immobilise,
    documentEspace: 'factures',
    documentChemin: fichier.chemin,
    origine: 'facture-automatique',
    cleFacture,
    notes: valeurs.notes || '',
  });

  try {
    const range = await api.deplacerFichier('factures', fichier.chemin, 'factures',
      lecture.cheminRangement(fichier.nom, annee));
    await etat.enregistrer('charges', { id: charge.id, documentChemin: range.chemin });
  } catch (erreur) {
    // La dépense existe et pointe sur le fichier resté en boîte : on prévient
    // sans perdre la saisie.
    notifier('Dépense créée, mais le rangement du fichier a échoué : il reste dans « Factures ».', 'erreur');
    console.error(erreur);
  }
  await etat.rechargerFichiers({ notifier: true });
  return true;
}

async function integrerAvecFormulaire(donnees, entree) {
  const { fichier, analyse } = entree;
  const saisie = await formulaire({
    titre: 'Intégrer la facture',
    aide: `Fichier : ${fichier.nom}`,
    large: true,
    champs: [
      { cle: 'date', libelle: 'Date de la facture', type: 'date', requis: true },
      { cle: 'dateReglement', libelle: 'Date de règlement', type: 'date' },
      { cle: 'montant', libelle: 'Montant TTC (€)', type: 'montant', requis: true },
      { cle: 'categorie', libelle: 'Catégorie', type: 'liste', requis: true,
        options: etat.CATEGORIES_CHARGES.map((c) => ({ valeur: c.code, libelle: c.libelle })) },
      { cle: 'libelle', libelle: 'Libellé', type: 'texte', requis: true, largeur: 'pleine' },
      { cle: 'fournisseur', libelle: 'Fournisseur', type: 'texte' },
      { cle: 'bienId', libelle: 'Logement', type: 'liste',
        options: [{ valeur: '', libelle: '—' }, ...donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }))] },
      { cle: 'deductible', libelle: 'Charge déductible du résultat', type: 'case' },
      { cle: 'immobilise', libelle: 'À immobiliser et amortir plutôt que déduire', type: 'case' },
      { cle: 'notes', libelle: 'Notes', type: 'zone' },
    ],
    valeurs: {
      date: analyse.date || aujourdhui(),
      dateReglement: analyse.date || aujourdhui(),
      montant: analyse.montant ?? '',
      categorie: analyse.categorie || 'entretien',
      libelle: analyse.libelle,
      fournisseur: analyse.fournisseur || '',
      bienId: donnees.biens[0]?.id || '',
      deductible: true,
      immobilise: false,
    },
  });
  if (!saisie) return;
  try {
    const faite = await integrer(fichier, saisie);
    if (faite) notifier(`Facture intégrée et rangée dans Factures\\Traitées\\${anneeDe(saisie.date)}.`, 'succes');
    else notifier('Cette facture avait déjà été intégrée.');
  } catch (erreur) { signalerErreur(erreur); }
}

/**
 * Routine d'intégration : toutes les factures lues sans ambiguïté sont
 * passées en comptabilité et rangées.
 */
export async function routineIntegration(donnees, { silencieux = false } = {}) {
  const candidats = lecture.aTraiter(etat.fichiers('factures'), donnees.charges)
    .filter((entree) => entree.analyse.confiance === 'haute' && entree.analyse.categorie);
  if (!candidats.length) return 0;

  let reussies = 0;
  let echecs = 0;
  for (const entree of candidats) {
    try {
      /* eslint-disable no-await-in-loop */
      const faite = await integrer(entree.fichier, {
        date: entree.analyse.date,
        dateReglement: entree.analyse.date,
        montant: entree.analyse.montant,
        categorie: entree.analyse.categorie,
        libelle: entree.analyse.libelle,
        fournisseur: entree.analyse.fournisseur,
        bienId: donnees.biens[0]?.id || '',
        deductible: true,
      });
      if (faite) reussies += 1;
    } catch (erreur) {
      echecs += 1;
      console.error(erreur);
    }
  }
  if (reussies) notifier(`${reussies} facture(s) intégrée(s) automatiquement.`, 'succes');
  // Les échecs sont exactement le cas où l'utilisateur doit être prévenu,
  // même en démarrage silencieux.
  if (echecs) notifier(`${echecs} facture(s) n’ont pas pu être intégrées.`, 'erreur');
  return reussies;
}

async function deposerFactures() {
  const fichiers = await choisirFichier({ accept: '.pdf,.jpg,.jpeg,.png,.webp', multiple: true });
  if (!fichiers?.length) return;
  try {
    for (const fichier of fichiers) {
      /* eslint-disable no-await-in-loop */
      await api.deposerFichier('factures', fichier.name, fichier);
    }
    await etat.rechargerFichiers({ notifier: true });
    notifier(`${fichiers.length} facture(s) déposée(s).`, 'succes');
  } catch (erreur) { signalerErreur(erreur); }
}

function zoneDepot() {
  const zone = h('div', { class: 'zone-depot' },
    'Glissez ici vos factures (PDF, photo ou scan), ou utilisez le bouton « Déposer des factures ».');
  const stop = (evenement) => { evenement.preventDefault(); evenement.stopPropagation(); };
  zone.addEventListener('dragover', (e) => { stop(e); zone.classList.add('survol'); });
  zone.addEventListener('dragleave', (e) => { stop(e); zone.classList.remove('survol'); });
  zone.addEventListener('drop', async (evenement) => {
    stop(evenement);
    zone.classList.remove('survol');
    const fichiers = Array.from(evenement.dataTransfer?.files || []);
    if (!fichiers.length) return;
    try {
      for (const fichier of fichiers) {
        /* eslint-disable no-await-in-loop */
        await api.deposerFichier('factures', fichier.name, fichier);
      }
      await etat.rechargerFichiers({ notifier: true });
      notifier(`${fichiers.length} facture(s) déposée(s).`, 'succes');
    } catch (erreur) { signalerErreur(erreur); }
  });
  return zone;
}

export default {
  cle: 'factures',
  libelle: 'Factures',
  icone: '📥',
  titre: 'Factures à intégrer',
  sousTitre: 'Déposez vos factures dans le dossier « Factures » : elles sont lues et passées en comptabilité.',
  compteur(contexte) {
    if (!contexte.donnees?.charges) return null;
    return lecture.aTraiter(etat.fichiers('factures'), contexte.donnees.charges).length || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');
    const entrees = lecture.aTraiter(etat.fichiers('factures'), donnees.charges);
    const pretes = entrees.filter((e) => e.analyse.confiance === 'haute' && e.analyse.categorie);

    const integrees = donnees.charges.filter((c) => c.origine === 'facture-automatique');
    const integreesAnnee = integrees.filter((c) => anneeDe(c.date) === contexte.annee);

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'À intégrer', valeur: String(entrees.length), ton: entrees.length ? 'negatif' : 'positif' }),
      tuile({ libelle: 'Lues sans ambiguïté', valeur: String(pretes.length), detail: 'intégrables en un clic' }),
      tuile({ libelle: `Intégrées en ${contexte.annee}`, valeur: String(integreesAnnee.length) }),
      tuile({ libelle: 'Montant intégré', valeur: montant(centimes(integreesAnnee.reduce((s, c) => s + (Number(c.montant) || 0), 0)), { rond: true }) }),
    ]));

    conteneur.append(barreOutils([
      bouton('Déposer des factures', deposerFactures, { type: 'primaire' }),
      bouton(`Tout intégrer (${pretes.length})`, async () => {
        if (!pretes.length) { notifier('Aucune facture lisible sans ambiguïté.'); return; }
        const apercu = tableau({
          colonnes: [
            { titre: 'Fichier', valeur: (e) => e.fichier.nom },
            { titre: 'Date', valeur: (e) => date(e.analyse.date) },
            { titre: 'Catégorie', valeur: (e) => etat.libelleCategorieCharge(e.analyse.categorie) },
            { titre: 'Montant', nombre: true, valeur: (e) => montant(e.analyse.montant) },
          ],
          lignes: pretes,
          messageVide: '',
        });
        const fermer = ouvrirModale({
          titre: 'Intégrer ces factures en comptabilité',
          large: true,
          corps: [h('p', { class: 'legende', texte: 'Les fichiers seront rangés dans Factures\\Traitées, par année.' }), apercu],
          pied: [
            bouton('Annuler', () => fermer()),
            bouton('Intégrer', async () => { fermer(); await routineIntegration(donnees); }, { type: 'primaire' }),
          ],
        });
      }, { desactive: !pretes.length }),
      h('div', { class: 'espace' }),
      h('label', { class: 'selecteur-exercice' }, [
        h('input', {
          type: 'checkbox',
          checked: donnees.parametres.integrationAutomatiqueFactures === true,
          onchange: async (evenement) => {
            await etat.enregistrerParametres({ integrationAutomatiqueFactures: evenement.target.checked });
            notifier(evenement.target.checked
              ? 'Les factures lisibles seront intégrées dès l’ouverture de l’application.'
              : 'Intégration automatique désactivée.');
          },
        }),
        h('span', { texte: 'Intégrer automatiquement à l’ouverture' }),
      ]),
    ]));

    conteneur.append(carte({
      titre: 'Dépôt',
      aide: `Dossier surveillé : ${etat.infosServeur()?.dossierFactures || 'Factures'}`,
      corps: zoneDepot(),
    }));

    const colonnes = [
      { titre: 'Fichier', valeur: (e) => h('div', {}, [
        h('a', { class: 'lien-doc', href: '#', onclick: (ev) => { ev.preventDefault(); api.ouvrirFichier('factures', e.fichier.chemin).catch(signalerErreur); } }, e.fichier.nom),
        h('div', { class: 'legende', texte: `${taille(e.fichier.taille)} — déposé le ${date(e.fichier.modifie)}` }),
      ]) },
      { titre: 'Date lue', valeur: (e) => (e.analyse.date ? date(e.analyse.date) : '—') },
      { titre: 'Fournisseur', valeur: (e) => e.analyse.fournisseur || '—' },
      { titre: 'Catégorie', valeur: (e) => (e.analyse.categorie ? etat.libelleCategorieCharge(e.analyse.categorie) : '—') },
      { titre: 'Montant', nombre: true, valeur: (e) => (e.analyse.montant === null ? '—' : montant(e.analyse.montant)) },
      { titre: 'Lecture', valeur: (e) => badge(LIBELLES_CONFIANCE[e.analyse.confiance], TONS_CONFIANCE[e.analyse.confiance]) },
      { titre: '', actions: true, valeur: (e) => h('div', { class: 'groupe-boutons' }, [
        bouton('Intégrer', () => integrerAvecFormulaire(donnees, e), { petit: true, type: 'primaire' }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Écarter la facture',
            message: `« ${e.fichier.nom} » sera déplacé dans le dossier Corbeille du dossier partagé.`,
            libelleValider: 'Écarter', danger: true,
          });
          if (!confirme) return;
          try {
            await api.supprimerFichier('factures', e.fichier.chemin);
            await etat.rechargerFichiers({ notifier: true });
            notifier('Facture écartée.');
          } catch (erreur) { signalerErreur(erreur); }
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    conteneur.append(carte({
      titre: 'En attente d’intégration',
      aide: 'La date, le montant et le fournisseur sont lus dans le nom du fichier.',
      serre: true,
      corps: entrees.length
        ? tableau({ colonnes, lignes: entrees, cle: (e) => e.fichier.chemin, messageVide: '' })
        : vide('Aucune facture en attente',
          'Déposez vos justificatifs dans le dossier « Factures » du dossier partagé : ils apparaîtront ici. '
          + 'Nommez-les « 2026-03-15 EDF 84,20.pdf » pour une lecture automatique complète.'),
    }));

    if (integrees.length) {
      conteneur.append(carte({
        titre: 'Factures déjà intégrées',
        aide: 'Rangées dans Factures\\Traitées et rattachées à une dépense.',
        serre: true,
        corps: tableau({
          colonnes: [
            { titre: 'Date', valeur: (c) => date(c.date) },
            { titre: 'Libellé', valeur: (c) => c.libelle },
            { titre: 'Catégorie', valeur: (c) => etat.libelleCategorieCharge(c.categorie) },
            { titre: 'Montant', nombre: true, valeur: (c) => montant(c.montant) },
            { titre: 'Justificatif', valeur: (c) => h('a', {
              class: 'lien-doc',
              href: '#',
              onclick: (ev) => { ev.preventDefault(); api.ouvrirFichier(c.documentEspace || 'documents', c.documentChemin).catch(signalerErreur); },
            }, '📎 ouvrir') },
          ],
          lignes: [...integrees].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 25),
          messageVide: '',
        }),
      }));
    }

    return conteneur;
  },
};
