// Régularisation annuelle des charges : cumul des provisions prélevées sur
// les loyers, dépenses réelles récupérables (eau, ordures ménagères), et
// solde de chaque colocataire — décompte PDF déposé sur son espace.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer, groupeRepliable,
  barreOutils, notifier, ouvrirModale, choisirFichier, signalerErreur } from '../ui.js';
import { montant, date, dateLongue, aujourdhui, centimes, nomFichierTelechargement } from '../format.js';
import { provisionsPeriode, decompteRegularisation } from '../calculs/loyers.js';
import { pdfRegularisationAnika, dateLongueFr, sirenDepuisSiret, formaterSiret, nbMoisEntre } from '../pdf-anika.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';
import { bienDuBail, filtrerDonnees, teinteLogement, libelleTypeLocation, sansBail } from '../logements.js';

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

/** Les dépenses réelles d'une régularisation, sous forme de lignes libellées. */
function depensesDe(regularisation) {
  return [
    { libelle: 'Eau (consommation et abonnement)', montant: Number(regularisation.eau) || 0 },
    { libelle: 'Taxe d\'enlèvement des ordures ménagères (TEOM)', montant: Number(regularisation.teom) || 0 },
    // Autres charges, une ligne par nature (entretien chaudière, espaces verts, électricité des communs…).
    ...(regularisation.autresLignes || []).map((l) => ({ libelle: l.libelle || 'Autre charge récupérable', montant: Number(l.montant) || 0 })),
    // Ancien champ unique « Autres charges » (avant les lignes détaillées).
    { libelle: regularisation.notes ? `Autres charges récupérables — ${regularisation.notes}` : 'Autres charges récupérables', montant: Number(regularisation.autres) || 0 },
  ].filter((d) => d.montant > 0);
}

/** Ajoute ou modifie une ligne « autre charge » d'une régularisation. */
async function saisirAutreCharge(regularisation, ligne = null) {
  const saisie = await formulaire({
    titre: ligne ? 'Modifier la charge' : 'Ajouter une charge récupérable',
    aide: 'Une ligne par nature de dépense : entretien de la chaudière, espaces verts, électricité des parties communes… Elle est répartie comme l’eau et la TEOM, au prorata des provisions.',
    champs: [
      { cle: 'libelle', libelle: 'Nature de la charge', type: 'texte', requis: true, largeur: 'pleine', exemple: 'Entretien de la chaudière' },
      { cle: 'montant', libelle: 'Montant réel sur la période (€)', type: 'montant', requis: true },
    ],
    valeurs: ligne ? { libelle: ligne.libelle, montant: ligne.montant } : { montant: 0 },
    libelleValider: ligne ? 'Enregistrer' : 'Ajouter',
  });
  if (!saisie) return;
  if (!(Number(saisie.montant) > 0)) { notifier('Indiquez un montant supérieur à zéro.', 'erreur'); return; }
  await executer(etat.modifierElement('regularisations', regularisation.id, (r) => {
    const lignes = r.autresLignes || [];
    const nouvelle = { id: ligne?.id || crypto.randomUUID(), libelle: String(saisie.libelle || '').trim(), montant: Number(saisie.montant) || 0 };
    r.autresLignes = ligne ? lignes.map((l) => (l.id === ligne.id ? nouvelle : l)) : [...lignes, nouvelle];
  }), ligne ? 'Charge modifiée.' : 'Charge ajoutée.');
}

async function retirerAutreCharge(regularisation, ligne) {
  const ok = await confirmer({ titre: 'Retirer la charge', message: `Retirer « ${ligne.libelle} » (${montant(ligne.montant)}) de la régularisation ?`, libelleValider: 'Retirer', danger: true });
  if (!ok) return;
  await executer(etat.modifierElement('regularisations', regularisation.id, (r) => { r.autresLignes = (r.autresLignes || []).filter((l) => l.id !== ligne.id); }), 'Charge retirée.');
}

/** Résumé d'un logement (vue « Tous les logements ») : provisions de l'année et dépenses réelles de ses régularisations, détail et total. */
function resumeLogement(siennes, regs, annee) {
  let prevu = 0;
  let encaisse = 0;
  for (const bail of siennes.baux) {
    for (const ligne of provisionsPeriode(bail, siennes.loyers, `${annee}-01-01`, `${annee}-12-31`)) { prevu += ligne.prevu; encaisse += ligne.encaisse; }
  }
  const parNature = new Map();
  for (const r of regs) for (const d of depensesDe(r)) parNature.set(d.libelle, (parNature.get(d.libelle) || 0) + d.montant);
  const totalReel = centimes([...parNature.values()].reduce((s, x) => s + x, 0));
  return h('div', { class: 'resume-logement-charges' }, [
    h('div', { class: 'grille grille-3', style: 'margin:.2rem 0 .6rem' }, [
      tuile({ libelle: `Provisions prévues ${annee}`, valeur: montant(centimes(prevu), { rond: true }), detail: `${siennes.baux.length} bail${siennes.baux.length > 1 ? 'x' : ''}` }),
      tuile({ libelle: `Provisions encaissées ${annee}`, valeur: montant(centimes(encaisse), { rond: true }), ton: 'positif' }),
      tuile({ libelle: 'Dépenses réelles régularisées', valeur: montant(totalReel, { rond: true }), ton: totalReel > encaisse ? 'negatif' : 'neutre', detail: regs.length ? `${regs.length} régularisation${regs.length > 1 ? 's' : ''}` : 'aucune régularisation' }),
    ]),
    parNature.size ? h('p', { class: 'legende', style: 'margin:0 0 .6rem .2rem', texte: `Détail des dépenses : ${[...parNature.entries()].map(([l, m]) => `${l} ${montant(centimes(m))}`).join(' · ')} — total ${montant(totalReel)}` }) : null,
  ]);
}

/** Le bloc « Autres charges récupérables » d'une carte de régularisation. */
function blocAutresCharges(regularisation) {
  const lignes = regularisation.autresLignes || [];
  const ancien = (Number(regularisation.autres) || 0) > 0 ? { libelle: regularisation.notes ? `Autres charges récupérables — ${regularisation.notes}` : 'Autres charges récupérables (ancien champ)', montant: Number(regularisation.autres) } : null;
  return h('div', { class: 'autres-charges' }, [
    h('div', { class: 'doc-logement-entete' }, [
      h('span', { class: 'doc-logement-entete-titre', texte: `Autres charges récupérables (${lignes.length + (ancien ? 1 : 0)})` }),
      h('span', { class: 'legende', texte: 'En plus de l’eau et de la TEOM : une ligne par nature de dépense, réparties de la même façon.' }),
      bouton('+ Ajouter une charge', () => saisirAutreCharge(regularisation).catch(signalerErreur), { petit: true }),
    ]),
    lignes.length || ancien ? h('div', { class: 'doc-logement-liste' }, [
      ...lignes.map((l) => h('div', { class: 'doc-logement', 'data-charge': l.id }, [
        h('span', { class: 'doc-logement-icone', texte: '🧾' }),
        h('div', { class: 'doc-logement-details' }, [h('div', { class: 'doc-logement-titre', texte: l.libelle }), h('div', { class: 'legende', texte: montant(l.montant) })]),
        h('div', { class: 'groupe-boutons' }, [
          bouton('Modifier', () => saisirAutreCharge(regularisation, l).catch(signalerErreur), { petit: true }),
          bouton('Retirer', () => retirerAutreCharge(regularisation, l).catch(signalerErreur), { petit: true, type: 'danger' }),
        ]),
      ])),
      ancien ? h('div', { class: 'doc-logement' }, [
        h('span', { class: 'doc-logement-icone', texte: '🧾' }),
        h('div', { class: 'doc-logement-details' }, [h('div', { class: 'doc-logement-titre', texte: ancien.libelle }), h('div', { class: 'legende', texte: `${montant(ancien.montant)} · saisi dans l’ancien champ « Autres charges » (Modifier la régularisation pour le corriger)` })]),
      ]) : null,
    ]) : null,
  ]);
}

// ------------------------------------------------ pièces justificatives
// Les factures (eau, TEOM, autres) sont jointes à la régularisation : elles
// vivent dans le dossier Documents du gérant (regularisations/{id}/…) et sont
// déposées sur l'espace de chaque colocataire avec son décompte.
const CATEGORIES_PIECES = [
  { cle: 'eau', libelle: 'Facture d’eau', icone: '💧' },
  { cle: 'teom', libelle: 'Avis de TEOM (taxe foncière)', icone: '🗑️' },
  { cle: 'autre', libelle: 'Autre justificatif', icone: '📄' },
];
const categoriePiece = (cle) => CATEGORIES_PIECES.find((c) => c.cle === cle) || CATEGORIES_PIECES[2];
const TAILLE_MAX_PIECE = 10 * 1024 * 1024;
const nettoyerNom = (nom) => String(nom || 'piece').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

/** Les justificatifs qui manquent : eau saisie sans facture, TEOM saisie sans avis. */
function piecesManquantes(regularisation) {
  const pieces = regularisation.pieces || [];
  const manque = [];
  if ((Number(regularisation.eau) || 0) > 0 && !pieces.some((p) => p.categorie === 'eau')) manque.push('facture d’eau');
  if ((Number(regularisation.teom) || 0) > 0 && !pieces.some((p) => p.categorie === 'teom')) manque.push('avis de TEOM');
  return manque;
}

async function joindrePiece(regularisation, categorie = 'eau') {
  const fichier = await choisirFichier({ accept: 'application/pdf,image/*' });
  if (!fichier) return;
  if (fichier.size > TAILLE_MAX_PIECE) { notifier('Fichier trop lourd : 10 Mo au plus.', 'erreur'); return; }
  const saisie = await formulaire({
    titre: 'Joindre un justificatif',
    aide: `Fichier : ${fichier.name}. Il sera déposé sur l’espace de chaque colocataire avec son décompte.`,
    champs: [
      { cle: 'categorie', libelle: 'Nature', type: 'liste', requis: true, largeur: 'pleine', options: CATEGORIES_PIECES.map((c) => ({ valeur: c.cle, libelle: c.libelle })) },
      { cle: 'libelle', libelle: 'Libellé (affiché au colocataire)', type: 'texte', requis: true, largeur: 'pleine' },
    ],
    valeurs: { categorie, libelle: `${categoriePiece(categorie).libelle} — ${date(regularisation.debut)} au ${date(regularisation.fin)}` },
    libelleValider: 'Joindre',
  });
  if (!saisie) return;
  const depot = await api.deposerFichier('documents', `regularisations/${regularisation.id}/${nettoyerNom(fichier.name)}`, fichier);
  await executer(etat.modifierElement('regularisations', regularisation.id, (r) => {
    r.pieces = [...(r.pieces || []), {
      id: crypto.randomUUID(), categorie: saisie.categorie, libelle: String(saisie.libelle || '').trim() || categoriePiece(saisie.categorie).libelle,
      nom: depot.chemin.split('/').pop(), chemin: depot.chemin, taille: fichier.size, typeMime: fichier.type || 'application/pdf', deposeLe: aujourdhui(),
    }];
  }), `Justificatif joint : ${fichier.name}.`);
}

async function retirerPiece(regularisation, piece) {
  const ok = await confirmer({ titre: 'Retirer le justificatif', message: `« ${piece.libelle} » sera retiré de la régularisation et déposé dans la Corbeille. Les copies déjà déposées sur les espaces ne sont pas retirées.`, libelleValider: 'Retirer', danger: true });
  if (!ok) return;
  try { await api.supprimerFichier('documents', piece.chemin); } catch (erreur) { notifier(`Fichier non retiré du nuage : ${erreur.message}`, 'erreur'); }
  await executer(etat.modifierElement('regularisations', regularisation.id, (r) => { r.pieces = (r.pieces || []).filter((p) => p.id !== piece.id); }), 'Justificatif retiré.');
}

/** Le bloc « Pièces justificatives » d'une carte de régularisation. */
function blocPieces(regularisation) {
  const pieces = regularisation.pieces || [];
  const manque = piecesManquantes(regularisation);
  return h('div', { class: 'pieces-regularisation' }, [
    h('div', { class: 'doc-logement-entete' }, [
      h('span', { class: 'doc-logement-entete-titre', texte: `Pièces justificatives (${pieces.length})` }),
      manque.length ? badge(`manque : ${manque.join(', ')}`, 'alerte') : (pieces.length ? badge('complet', 'succes') : null),
      h('span', { class: 'legende', texte: 'Facture d’eau, avis de TEOM, autres factures : jointes ici, déposées sur l’espace de chaque colocataire avec son décompte.' }),
    ]),
    h('div', { class: 'groupe-boutons', style: 'margin:.3rem 0 .4rem' }, [
      bouton('Joindre la facture d’eau', () => joindrePiece(regularisation, 'eau').catch(signalerErreur), { petit: true, type: manque.includes('facture d’eau') ? 'primaire' : undefined }),
      bouton('Joindre l’avis de TEOM', () => joindrePiece(regularisation, 'teom').catch(signalerErreur), { petit: true, type: manque.includes('avis de TEOM') ? 'primaire' : undefined }),
      bouton('Joindre un autre justificatif', () => joindrePiece(regularisation, 'autre').catch(signalerErreur), { petit: true }),
    ]),
    pieces.length ? h('div', { class: 'doc-logement-liste' }, pieces.map((p) => h('div', { class: 'doc-logement', 'data-piece': p.id }, [
      h('span', { class: 'doc-logement-icone', texte: categoriePiece(p.categorie).icone }),
      h('div', { class: 'doc-logement-details' }, [
        h('div', { class: 'doc-logement-titre', texte: p.libelle }),
        h('div', { class: 'legende', texte: `${categoriePiece(p.categorie).libelle} · ${p.nom} · joint le ${date(p.deposeLe)}` }),
      ]),
      h('div', { class: 'groupe-boutons' }, [
        bouton('Consulter', () => api.ouvrirFichier('documents', p.chemin).catch(signalerErreur), { petit: true }),
        bouton('Retirer', () => retirerPiece(regularisation, p).catch(signalerErreur), { petit: true, type: 'danger' }),
      ]),
    ]))) : null,
  ]);
}

function badgeSolde(solde) {
  if (solde > 0.005) return badge('À rembourser', 'attention');
  if (solde < -0.005) return badge('À réclamer', 'alerte');
  return badge('Équilibré', 'succes');
}

async function saisirRegularisation(donnees, contexte, existante = null, bien = null) {
  // Limitée aux baux du logement quand elle est lancée depuis son cadre.
  const baux = bien ? donnees.baux.filter((b) => b.bienId === bien.id) : donnees.baux;
  if (!baux.length) { notifier(`Aucun bail sur ${bien?.nom || 'ce logement'} : rien à régulariser.`, 'erreur'); return; }
  // Par défaut : le bail de colocation en cours (les provisions à régulariser
  // viennent de là), à défaut le bail en cours, à défaut le premier.
  const bailParDefaut = baux.find((b) => (b.colocataires || []).length && (!b.dateFin || b.dateFin >= aujourdhui()))
    || baux.find((b) => !b.dateFin || b.dateFin >= aujourdhui())
    || baux[0];
  const saisie = await formulaire({
    titre: `${existante ? 'Régularisation' : 'Nouvelle régularisation'}${bien ? ` — ${bien.nom}` : ''}`,
    aide: 'Les dépenses réelles de la période sont réparties entre colocataires au prorata de leurs '
      + 'provisions, puis comparées à ce que chacun a réellement versé. Joignez ensuite les justificatifs (facture d’eau, avis de TEOM) sur la carte de la régularisation : ils accompagnent chaque décompte.',
    champs: [
      { cle: 'bailId', libelle: 'Bail', type: 'liste', options: baux.map((b) => ({
        valeur: b.id,
        libelle: `${bienDuBail(donnees, b)?.nom || 'Logement ?'} — bail du ${date(b.dateDebut)}${b.dateFin ? ` au ${date(b.dateFin)}` : ' (en cours)'}`,
      })) },
      { cle: 'debut', libelle: 'Début de la période', type: 'date', requis: true },
      { cle: 'fin', libelle: 'Fin de la période', type: 'date', requis: true },
      { cle: 'eau', libelle: 'Eau — dépense réelle (€)', type: 'montant',
        aide: 'Factures du service des eaux sur la période (consommation + abonnement).' },
      { cle: 'teom', libelle: 'Ordures ménagères — TEOM (€)', type: 'montant',
        aide: 'Ligne « TEOM » du détail des cotisations de l\'avis de taxe foncière (hors frais de gestion).' },
      { cle: 'autres', libelle: 'Autres charges (ancien champ, €)', type: 'montant', quand: () => (Number(existante?.autres) || 0) > 0, aide: 'Préférez désormais « + Ajouter une charge » sur la carte : une ligne par nature.' },
      { cle: 'notes', libelle: 'Nature des autres charges (ancien champ)', type: 'texte', largeur: 'pleine', quand: () => (Number(existante?.autres) || 0) > 0 },
    ],
    valeurs: existante ? {
      bailId: existante.bailId,
      debut: existante.debut,
      fin: existante.fin,
      eau: existante.eau || 0,
      teom: existante.teom || 0,
      autres: existante.autres || 0,
      notes: existante.notes || '',
    } : {
      bailId: bailParDefaut?.id,
      debut: `${contexte.annee}-01-01`,
      fin: `${contexte.annee}-12-31`,
      eau: 0, teom: 0, autres: 0, notes: '',
    },
  });
  if (!saisie) return;
  if (saisie.fin < saisie.debut) { notifier('La fin de période précède son début.', 'erreur'); return; }
  await executer(etat.enregistrer('regularisations', {
    id: existante?.id,
    bailId: saisie.bailId,
    debut: saisie.debut,
    fin: saisie.fin,
    eau: Number(saisie.eau) || 0,
    teom: Number(saisie.teom) || 0,
    autres: Number(saisie.autres) || 0,
    notes: saisie.notes || '',
    autresLignes: existante?.autresLignes || [],
    pieces: existante?.pieces || [],
  }), 'Régularisation enregistrée.');
}

/**
 * Décompte PDF d'un colocataire : téléchargement, dépôt sur son espace et
 * e-mail de mise à disposition — même circuit que la quittance.
 */
async function decomptePdfEtEnvoi(donnees, regularisation, decompte, ligne) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return; }
  const locataire = donnees.locataires.find((l) => l.id === ligne.locataireId) || null;
  if (!locataire) { notifier('Locataire introuvable pour cette ligne.', 'erreur'); return; }
  const bail = donnees.baux.find((b) => b.id === regularisation.bailId);
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);

  // Quote-part du colocataire, poste par poste (au prorata de sa part totale),
  // le dernier poste absorbant l'arrondi pour retomber exactement sur sa part.
  const depenses = depensesDe(regularisation);
  const ratio = decompte.totalReel > 0 ? (ligne.part / decompte.totalReel) : 0;
  const postes = depenses.map((d) => ({ libelle: d.libelle, montant: centimes(d.montant * ratio) }));
  if (postes.length) {
    const somme = centimes(postes.reduce((s, p) => s + p.montant, 0));
    postes[postes.length - 1].montant = centimes(postes[postes.length - 1].montant + ligne.part - somme);
  }
  const anneeDebut = String(regularisation.debut).slice(0, 4);
  const anneeFin = String(regularisation.fin).slice(0, 4);

  const octets = await pdfRegularisationAnika({
    bailleur: {
      nom: bailleur.nom,
      adresse: bailleur.adresse || '',
      email: bailleur.email || '',
      siren: sirenDepuisSiret(donnees.parametres.siret), siret: formaterSiret(donnees.parametres.siret),
    },
    locataireNom: nomDe(locataire),
    logement: { adresse: bien?.adresse || '', codePostal: bien?.codePostal || '', ville: bien?.ville || '' },
    anneeLibelle: anneeDebut === anneeFin ? `Année ${anneeDebut}` : `Période ${anneeDebut}-${anneeFin}`,
    periodeDebut: dateLongueFr(regularisation.debut),
    periodeFin: dateLongueFr(regularisation.fin),
    nbMois: nbMoisEntre(regularisation.debut, regularisation.fin),
    provisionsVersees: ligne.encaisse || 0,
    charges: postes,
    lieu: donnees.parametres.lieuSignature || '',
    dateSignature: dateLongueFr(aujourdhui()),
  });
  const nomFichier = `ANIKA_regularisation_charges_${anneeDebut === anneeFin ? anneeDebut : `${anneeDebut}-${anneeFin}`}_${(locataire.prenom || locataire.nom || '').toLowerCase()}.pdf`;

  let publie = null;
  let erreurPublication = null;
  try { publie = await publierDocument({
    locataire, type: 'regularisation',
    titre: `Régularisation des charges — ${dateLongue(regularisation.debut)} au ${dateLongue(regularisation.fin)}`,
    nomFichier, octets,
  }); } catch (erreur) { erreurPublication = erreur; }
  // Les justificatifs (factures) accompagnent le décompte sur l'espace.
  const pieces = regularisation.pieces || [];
  let piecesPubliees = 0;
  if (publie) {
    for (const piece of pieces) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const contenu = await api.lireOctets('documents', piece.chemin);
        // eslint-disable-next-line no-await-in-loop
        await publierDocument({ locataire, type: 'regularisation', titre: `Justificatif — ${piece.libelle}`, nomFichier: `justificatif_${nettoyerNom(piece.nom)}`, octets: contenu, typeMime: piece.typeMime || 'application/pdf' });
        piecesPubliees += 1;
      } catch (erreur) { notifier(`Justificatif « ${piece.libelle} » non déposé : ${erreur.message}`, 'erreur'); }
    }
  }
  const manque = piecesManquantes(regularisation);

  const telecharger = () => {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  };

  const notifierParEmail = async () => {
    if (!locataire.email) { notifier('Ce colocataire n’a pas d’adresse e-mail (à renseigner dans « Logements & baux »).', 'erreur'); return; }
    if (!publie) { notifier('Le décompte n’a pas pu être déposé sur son espace — corrigez d’abord ce point.', 'erreur'); return; }
    const solde = ligne.solde;
    const phrase = solde > 0.005
      ? `Le décompte fait apparaître un trop-perçu de <strong>${montant(solde)}</strong> en votre faveur.`
      : (solde < -0.005
        ? `Le décompte fait apparaître un complément de <strong>${montant(-solde)}</strong> à régler.`
        : 'Le décompte est équilibré : rien à régler de part ni d’autre.');
    await executer(api.envoyerCourriel({ type: 'documents',
      destinataires: destinatairesDe(locataire),
      sujet: 'Votre décompte de régularisation des charges',
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + `<p>Votre décompte de régularisation des charges pour la période du `
        + `<strong>${dateLongue(regularisation.debut)}</strong> au <strong>${dateLongue(regularisation.fin)}</strong> `
        + 'est disponible sur votre espace :</p>'
        + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
        + `<p>${phrase}</p>`
        + (piecesPubliees ? `<p>Les justificatifs des dépenses (${pieces.map((p) => p.libelle).join(', ')}) sont déposés sur votre espace avec le décompte.</p>` : '')
        + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
    }), `Notification de mise à disposition envoyée à ${locataire.email}.`);
  };

  ouvrirModale({
    titre: 'Décompte généré',
    corps: h('div', {}, [
      h('p', { texte: `Décompte de ${nomDe(locataire)} — solde de ${montant(ligne.solde)} `
        + `(${ligne.solde > 0.005 ? 'à lui rembourser' : (ligne.solde < -0.005 ? 'à lui réclamer' : 'équilibré')}).` }),
      publie
        ? h('p', { class: 'legende', texte: `Déposé sur son espace : il peut le consulter et le télécharger en PDF${piecesPubliees ? `, avec ${piecesPubliees} justificatif${piecesPubliees > 1 ? 's' : ''}` : ''}.` })
        : null,
      manque.length ? h('p', { class: 'legende', style: 'color:var(--alerte)', texte: `Justificatifs manquants sur cette régularisation : ${manque.join(', ')}. Joignez-les (carte de la régularisation) puis regénérez le décompte.` }) : null,
      !publie
        ? h('p', { class: 'legende', style: 'color:var(--alerte)', texte:
          `Non déposé sur son espace : ${erreurPublication?.message || 'erreur inconnue'}` }) : null,
    ]),
    pied: [
      h('button', { class: 'bouton', type: 'button', onclick: telecharger }, 'Télécharger le PDF'),
      h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: notifierParEmail }, 'Notifier par e-mail'),
    ],
  });
}

function carteRegularisation(donnees, regularisation, teinte = '') {
  const bail = donnees.baux.find((b) => b.id === regularisation.bailId);
  if (!bail) {
    return carte({
      titre: `Régularisation du ${date(regularisation.debut)} au ${date(regularisation.fin)}`,
      teinte,
      corps: vide('Bail introuvable', 'Le bail de cette régularisation a été supprimé.'),
      actions: [bouton('Supprimer', () => supprimerRegularisation(regularisation), { petit: true, type: 'danger' })],
    });
  }
  const decompte = decompteRegularisation(
    bail, donnees.loyers, regularisation.debut, regularisation.fin, depensesDe(regularisation),
  );

  const colonnes = [
    { titre: 'Colocataire', valeur: (l) => nomDe(donnees.locataires.find((x) => x.id === l.locataireId)) },
    { titre: 'Provisions prévues', nombre: true, valeur: (l) => montant(l.prevu) },
    { titre: 'Provisions encaissées', nombre: true, valeur: (l) => montant(l.encaisse) },
    { titre: 'Quote-part réelle', nombre: true, valeur: (l) => montant(l.part) },
    { titre: 'Solde', nombre: true, valeur: (l) => h('span', {
      style: l.solde < -0.005 ? 'color:var(--alerte)' : undefined, texte: montant(l.solde),
    }) },
    { titre: 'État', valeur: (l) => badgeSolde(l.solde) },
    { titre: '', actions: true, valeur: (l) => bouton('Décompte', () =>
      decomptePdfEtEnvoi(donnees, regularisation, decompte, l), {
      petit: true, type: 'primaire',
      titre: 'Décompte PDF : téléchargement, dépôt sur son espace, e-mail de mise à disposition',
    }) },
  ];

  const detailDepenses = depensesDe(regularisation).map((d) => `${d.libelle} : ${montant(d.montant)}`).join(' · ');

  return carte({
    teinte,
    titre: `${bienDuBail(donnees, bail)?.nom ? `${bienDuBail(donnees, bail).nom} — ` : ''}du ${date(regularisation.debut)} au ${date(regularisation.fin)}`,
    aide: detailDepenses
      ? `Dépenses réelles : ${detailDepenses} — total ${montant(decompte.totalReel)}`
      : 'Aucune dépense réelle saisie pour l’instant : le décompte rembourserait toutes les provisions.',
    actions: [
      bouton('Modifier', () => saisirRegularisation(donnees, null, regularisation), { petit: true }),
      bouton('Supprimer', () => supprimerRegularisation(regularisation), { petit: true, type: 'danger' }),
    ],
    serre: true,
    corps: [tableau({
      colonnes,
      lignes: decompte.lignes,
      cle: (l) => l.locataireId,
      pied: h('tr', {}, [
        h('td', {}, h('strong', { texte: 'Total' })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalPrevu) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalEncaisse) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(decompte.totalReel) })),
        h('td', { class: 'nombre' }, h('strong', { texte: montant(centimes(decompte.totalEncaisse - decompte.totalReel)) })),
        h('td', {}), h('td', {}),
      ]),
      messageVide: 'Aucune provision sur cette période : vérifiez le bail et les dates.',
    }), blocAutresCharges(regularisation), blocPieces(regularisation)],
  });
}

async function supprimerRegularisation(regularisation) {
  const confirme = await confirmer({
    titre: 'Supprimer la régularisation',
    message: `Supprimer la régularisation du ${date(regularisation.debut)} au ${date(regularisation.fin)} ? `
      + 'Les décomptes déjà déposés sur les espaces colocataires ne seront pas retirés.',
    libelleValider: 'Supprimer', danger: true,
  });
  if (!confirme) return;
  await executer(etat.supprimer('regularisations', regularisation.id), 'Régularisation supprimée.');
}

export default {
  cle: 'regularisation',
  libelle: 'Charges',
  icone: '💧',
  titre: 'Régularisation des charges',
  sousTitre: 'Provisions prélevées sur les loyers, dépenses réelles (eau, ordures ménagères), solde de chacun.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');

    if (!donnees.baux.length) {
      return carte({
        titre: 'Aucun bail',
        corps: vide('Rien à régulariser pour l’instant',
          donnees.biens.some((b) => b.typeLocation === 'courte') && donnees.biens.every((b) => b.typeLocation === 'courte')
            ? 'Un logement de courte durée n’a ni provisions sur charges ni régularisation.'
            : 'Enregistrez d’abord un bail dans « Logements & baux » : les provisions sur charges en découlent.'),
      });
    }

    // Cumul de l'année affichée, tous baux confondus : ce qui était prévu au
    // titre des provisions et ce qui a réellement été encaissé.
    const debutAnnee = `${contexte.annee}-01-01`;
    const finAnnee = `${contexte.annee}-12-31`;
    let prevuAnnee = 0;
    let encaisseAnnee = 0;
    for (const bail of donnees.baux) {
      for (const ligne of provisionsPeriode(bail, donnees.loyers, debutAnnee, finAnnee)) {
        prevuAnnee += ligne.prevu;
        encaisseAnnee += ligne.encaisse;
      }
    }

    const regularisations = [...(donnees.regularisations || etat.liste('regularisations'))]
      .sort((a, b) => String(b.debut).localeCompare(String(a.debut)));

    conteneur.append(h('div', { class: 'grille grille-3', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Provisions prévues ${contexte.annee}`, valeur: montant(centimes(prevuAnnee), { rond: true }),
        detail: 'd’après les baux' }),
      tuile({ libelle: `Provisions encaissées ${contexte.annee}`, valeur: montant(centimes(encaisseAnnee), { rond: true }),
        ton: 'positif', detail: 'part « charges » des virements reçus' }),
      tuile({ libelle: 'Régularisations', valeur: String(regularisations.length),
        detail: 'décomptes établis, toutes périodes' }),
    ]));

    // Vue « Tous les logements » : un cadre par logement (bandeau coloré),
    // avec son bouton « + Régularisation » et ses décomptes. Logement choisi :
    // les données sont déjà les siennes.
    const tout = contexte.tout || donnees;
    const logements = donnees.biens.filter((b) => !sansBail(b));
    const grouper = !contexte.bienId && logements.length > 1;
    if (grouper) {
      for (const bien of logements) {
        const siennes = filtrerDonnees(donnees, bien.id);
        const regs = regularisations.filter((r) => siennes.baux.some((b) => b.id === r.bailId));
        const teinte = teinteLogement(bien, tout.biens);
        const groupe = groupeRepliable({ cle: `regul:${bien.id}`, teinte, entete: h('div', { class: 'section-logement' }, [
          h('h2', { texte: bien.nom }),
          badge(libelleTypeLocation(bien), 'succes'),
          h('span', { class: 'legende', texte: `${[bien.adresse, bien.ville].filter(Boolean).join(', ')} · ${regs.length ? `${regs.length} régularisation${regs.length > 1 ? 's' : ''}` : 'aucune régularisation'}` }),
          bouton('+ Régularisation', () => saisirRegularisation(siennes, contexte, null, bien), { petit: true, type: 'primaire', titre: `Nouvelle régularisation pour ${bien.nom}` }),
        ]) });
        if (siennes.baux.length) groupe.corps.append(resumeLogement(siennes, regs, contexte.annee));
        if (!regs.length) groupe.corps.append(h('p', { class: 'legende', style: 'margin:0 0 .8rem .4rem', texte: siennes.baux.length ? 'Aucune régularisation pour ce logement : « + Régularisation » pour établir le décompte d’une période.' : 'Aucun bail sur ce logement : rien à régulariser.' }));
        for (const regularisation of regs) groupe.corps.append(carteRegularisation(siennes, regularisation, teinte));
        conteneur.append(groupe.element);
      }
      const orphelines = regularisations.filter((r) => !donnees.baux.some((b) => b.id === r.bailId));
      for (const regularisation of orphelines) conteneur.append(carteRegularisation(donnees, regularisation));
      return conteneur;
    }
    const bienSeul = contexte.bienId ? donnees.biens.find((b) => b.id === contexte.bienId) || null : (logements[0] || null);
    const teinteSeule = bienSeul ? teinteLogement(bienSeul, tout.biens) : '';

    conteneur.append(barreOutils([
      bouton('+ Régularisation', () => saisirRegularisation(donnees, contexte, null, bienSeul), { type: 'primaire' }),
    ]));

    if (!regularisations.length) {
      conteneur.append(carte({
        titre: 'Comment ça marche',
        teinte: teinteSeule,
        corps: h('div', { class: 'aide-bloc' }, [
          h('p', { texte: 'Une fois par an (ou en fin de bail), créez une régularisation : '
            + 'saisissez la période et les dépenses réellement payées — la consommation d’eau d’après '
            + 'les factures du service des eaux, et la taxe d’enlèvement des ordures ménagères qui figure '
            + 'sur l’avis de taxe foncière.' }),
          h('p', { texte: 'L’application répartit ces dépenses entre colocataires au prorata de leurs '
            + 'provisions, les compare à ce que chacun a réellement versé avec ses loyers, et établit le '
            + 'solde : trop-perçu à rembourser, ou complément à réclamer. Le décompte PDF de chacun se '
            + 'dépose sur son espace, avec e-mail de mise à disposition.' }),
        ]),
      }));
    }

    for (const regularisation of regularisations) {
      conteneur.append(carteRegularisation(donnees, regularisation, teinteSeule));
    }

    return conteneur;
  },
};
