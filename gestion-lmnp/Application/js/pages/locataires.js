// Locataires : les personnes qui occupent les logements, leur bail en cours,
// leur espace en ligne et leurs justificatifs. Depuis la v40, cette page a sa
// propre entrée dans le menu (elle était une carte de « Logements & baux »).
//
// La page suit le sélecteur « Logement » de l'en-tête : sur un logement, ses
// locataires ; sur « Tous », un bandeau par logement. Les locataires sans bail
// en cours ni à venir sont repliés en bas (« Anciens locataires »).
//
// L'espace en ligne (documents publiés, dernière connexion) et les
// justificatifs déposés sont relevés dans le nuage : le relevé se fait en
// arrière-plan à l'affichage de la page et au lancement (pour la pastille du
// menu). Depuis la v41, les pièces communes du logement (entretien des
// climatiseurs, ramonage, assurance « pour tous ») sont relevées dans
// l'espace partage et présentées sur une ligne « Pièces communes » en tête
// de chaque colocation ; la pastille compte les personnes sans assurance et
// les logements auxquels il manque une pièce commune.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, confirmer, executer, barreOutils, notifier, signalerErreur } from '../ui.js';
import { date, montant, aujourdhui } from '../format.js';
import { CATEGORIES_DEMANDEES, classerParCategorie, bilanJustificatifs, prefixeCommun, libelleCategorie, estCommune } from '../justificatifs.js';
import { destinatairesDe, logementDe } from '../portail-publication.js';
import { bailEstActif, ouvrirLocataire } from './bien.js';
import { libelleTypeLocation } from '../logements.js';

// ------------------------------------------------------------- relevé nuage

/** Relevé par adresse e-mail : { portail, fichiers, parCategorie, le }. */
const releves = new Map();
/** Relevé par logement : { fichiers (espace partage), le }. */
const relevesLogement = new Map();
let releveEnCours = null;

const emailDe = (locataire) => String(locataire?.email || '').trim().toLowerCase();
export const nomDe = (l) => `${l.prenom || ''} ${l.nom || ''}`.trim();
const prenomDe = (l) => String(l?.prenom || l?.nom || '').trim();

async function releverUn(locataire) {
  const email = emailDe(locataire);
  if (!email) return null;
  let portail = null;
  let fichiers = [];
  try { portail = await api.lirePortail(email); } catch { /* pas d'espace ou hors ligne */ }
  try { fichiers = await api.listerFichiers('portail', `${email}/justificatifs`); } catch { /* rien déposé */ }
  fichiers = fichiers.filter((f) => String(f.chemin || '').startsWith(`${email}/justificatifs`));
  // Espace créé avant la v41 : on y inscrit l'identifiant du logement, dont
  // l'espace colocataire a besoin pour les pièces communes.
  if (portail && !portail.logement?.id) {
    const logement = logementDe(locataire);
    if (logement?.id) {
      try { await api.completerPortail(email, { logement }); portail = { ...portail, logement }; } catch { /* hors ligne */ }
    }
  }
  const releve = { portail, fichiers, parCategorie: classerParCategorie(fichiers), le: Date.now() };
  releves.set(email, releve);
  return releve;
}

async function releverLogement(bien) {
  let fichiers = [];
  try { fichiers = await api.listerFichiers('partage', prefixeCommun(bien.id)); } catch { /* rien déposé */ }
  fichiers = fichiers.filter((f) => String(f.chemin || '').startsWith(prefixeCommun(bien.id)));
  const releve = { fichiers, le: Date.now() };
  relevesLogement.set(bien.id, releve);
  return releve;
}

/**
 * Relève l'espace et les justificatifs de chaque locataire ayant une adresse,
 * et les pièces communes de chaque logement. Un seul relevé à la fois ;
 * `apres` est appelé quand tout est relevé.
 */
export function releverTous({ locataires = [], biens = [] } = {}, apres = () => {}) {
  if (releveEnCours) { releveEnCours.then(() => apres()); return releveEnCours; }
  releveEnCours = (async () => {
    for (const bien of biens) {
      // eslint-disable-next-line no-await-in-loop
      await releverLogement(bien);
    }
    for (const locataire of locataires) {
      // eslint-disable-next-line no-await-in-loop
      await releverUn(locataire);
    }
  })().catch((erreur) => console.warn('Relevé des locataires :', erreur))
    .finally(() => { releveEnCours = null; apres(); });
  return releveEnCours;
}

export const releveDe = (locataire) => releves.get(emailDe(locataire)) || null;
export const releveFait = () => releves.size > 0 || relevesLogement.size > 0;

// ------------------------------------------------------------ baux, parts

/** Les baux qui concernent un locataire (titulaire, co-titulaire ou colocataire). */
export const bauxDe = (baux, locataireId) => baux.filter((b) => b.locataireId === locataireId
  || b.coTitulaireId === locataireId || (b.colocataires || []).some((c) => c.locataireId === locataireId));

const bailAVenir = (bail) => Boolean(bail.dateDebut && bail.dateDebut > aujourdhui());

/** Le bail « courant » d'un locataire : en cours, sinon à venir, sinon aucun. */
export function bailCourant(baux, locataireId) {
  const siens = bauxDe(baux, locataireId).sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)));
  return siens.find((b) => bailEstActif(b)) || siens.find(bailAVenir) || null;
}

/** Part mensuelle (loyer + charges) d'un locataire sur un bail. */
function partMensuelle(bail, locataireId) {
  const part = (bail.colocataires || []).find((c) => c.locataireId === locataireId);
  if (part) return (Number(part.partLoyer) || 0) + (Number(part.partCharges) || 0);
  if ((bail.colocataires || []).length) return 0;
  return (Number(bail.loyerHc) || 0) + (Number(bail.provisionCharges) || 0);
}

/** Les justificatifs sont demandés aux colocataires d'un bail de colocation en cours ou à venir. */
export const justificatifsDemandes = (baux, locataireId) => {
  const bail = bailCourant(baux, locataireId);
  return Boolean(bail && (bail.colocataires || []).some((c) => c.locataireId === locataireId));
};

/** Les colocataires (justificatifs demandés) dont le bail courant est sur ce logement. */
const colocatairesDe = (tout, bienId) => tout.locataires.filter((l) => bailCourant(tout.baux, l.id)?.bienId === bienId && justificatifsDemandes(tout.baux, l.id));

/**
 * Bilan des justificatifs d'un logement (pièces communes + personnes), ou
 * null tant que rien n'est relevé. `colocataires` : ceux du logement.
 */
export function bilanLogement(tout, bien) {
  const colocataires = colocatairesDe(tout, bien.id);
  if (!colocataires.length) return null;
  const commun = relevesLogement.get(bien.id);
  const personnels = colocataires.map((l) => ({ id: l.id, nom: prenomDe(l), parCategorie: releveDe(l)?.parCategorie || new Map(), releve: Boolean(releveDe(l)) }));
  if (!commun && !personnels.some((p) => p.releve)) return null;
  return { colocataires, ...bilanJustificatifs({ communs: commun?.fichiers || [], personnels }) };
}

/** Les logements (colocations) auxquels il manque une pièce commune. */
export function logementsAvecManquants(tout) {
  return (tout?.biens || []).filter((b) => (bilanLogement(tout, b)?.logement.manquants.length || 0) > 0);
}

/** Les colocataires à qui il manque une pièce personnelle (assurance non couverte). */
export function locatairesAvecManquants(tout) {
  const resultat = [];
  for (const bien of tout?.biens || []) {
    const bilan = bilanLogement(tout, bien);
    if (!bilan) continue;
    for (const l of bilan.colocataires) {
      if ((bilan.parPersonne.get(l.id)?.manquants.length || 0) > 0 && emailDe(l)) resultat.push(l);
    }
  }
  return resultat;
}

// ------------------------------------------------------------------ rappels

const lienEspace = () => `${window.location.origin}/colocataire`;

async function envoyerRappel(locataire, manquants, bailleur) {
  await api.envoyerCourriel({
    destinataires: destinatairesDe(locataire),
    sujet: 'Justificatifs à déposer sur votre espace',
    html: `<p>Bonjour ${locataire.prenom || ''},</p>`
      + '<p>Merci de déposer sur votre espace les justificatifs suivants, prévus par le bail :</p>'
      + `<ul>${manquants.map((c) => `<li>${c.libelle}${c.periodicite ? ` (${c.periodicite})` : ''}</li>`).join('')}</ul>`
      + `<p><a href="${lienEspace()}">${lienEspace()}</a> — rubrique « Justificatifs ».</p>`
      + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
  });
}

/** Un seul e-mail à tous les colocataires du logement pour les pièces communes manquantes. */
async function envoyerRappelLogement(bien, colocataires, manquants, bailleur) {
  const destinataires = colocataires.map(emailDe).filter(Boolean);
  if (!destinataires.length) throw new Error('Aucun colocataire de ce logement n’a d’adresse e-mail.');
  await api.envoyerCourriel({
    destinataires,
    sujet: `Justificatifs de la résidence à déposer — ${bien.nom}`,
    html: '<p>Bonjour,</p>'
      + `<p>Il manque pour ${bien.nom} les justificatifs suivants, communs à tous les colocataires :</p>`
      + `<ul>${manquants.map((c) => `<li>${c.libelle}${c.periodicite ? ` (${c.periodicite})` : ''}</li>`).join('')}</ul>`
      + '<p>Un seul document suffit pour la maison : l’un d’entre vous peut le déposer depuis son espace, rubrique « Justificatifs ». Il apparaîtra alors chez chacun.</p>'
      + `<p><a href="${lienEspace()}">${lienEspace()}</a></p>`
      + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
  });
}

// -------------------------------------------------------------- cellules

const motCourt = (c) => c.libelle.split(' ')[0];
const quandParQui = (entree) => [entree.par, entree.le ? date(entree.le) : ''].filter(Boolean).join(', ');

function celluleContact(l) {
  return h('div', {}, [
    h('div', { texte: l.email || '—', style: l.email ? '' : 'color:var(--alerte)' }),
    h('div', { class: 'legende', texte: l.telephone || '' }),
    l.email2 ? h('div', { class: 'legende', texte: `2e destinataire : ${l.email2}` }) : null,
  ]);
}

function celluleBail(tout, l, bail) {
  if (!bail) {
    const anciens = bauxDe(tout.baux, l.id).length;
    return h('div', { class: 'legende', texte: anciens ? `Aucun bail en cours (${anciens} terminé${anciens > 1 ? 's' : ''})` : 'Aucun bail' });
  }
  const logement = tout.biens.find((b) => b.id === bail.bienId);
  const part = partMensuelle(bail, l.id);
  return h('div', {}, [
    h('div', {}, [
      bailEstActif(bail) ? badge('En cours', 'succes') : badge('À venir', 'attention'),
      ' ',
      h('span', { texte: `${bailAVenir(bail) ? 'dès le' : 'depuis le'} ${date(bail.dateDebut)}` }),
    ]),
    h('div', { class: 'legende', texte: `${logement?.nom || 'Logement ?'}${part ? ` · ${montant(part)} / mois` : ''}` }),
  ]);
}

function celluleEspace(l) {
  const email = emailDe(l);
  if (!email) return h('div', {}, [badge('Pas d’adresse e-mail', 'alerte'), h('div', { class: 'legende', texte: 'Renseignez-la (Modifier) pour lui ouvrir un espace.' })]);
  const releve = releveDe(l);
  if (!releve) return h('div', { class: 'legende', texte: 'Relevé en cours…' });
  const portail = releve.portail;
  if (!portail) return h('div', {}, [badge('Aucun document publié', 'attente'), h('div', { class: 'legende', texte: 'L’espace se crée au premier document publié.' })]);
  const nbDocs = (portail.documents || []).length;
  const acces = portail.dernierAcces ? String(portail.dernierAcces).slice(0, 10) : '';
  return h('div', {}, [
    acces ? badge('Activé', 'succes') : badge('Jamais connecté', 'attention'),
    h('div', { class: 'legende', texte: `${nbDocs} document${nbDocs > 1 ? 's' : ''} publié${nbDocs > 1 ? 's' : ''}${acces ? ` · connecté le ${date(acces)}` : ''}` }),
  ]);
}

/** Pièces personnelles d'un colocataire (assurance), d'après le bilan de son logement. */
function celluleJustificatifs(tout, l, bilan, bailleur) {
  if (!justificatifsDemandes(tout.baux, l.id)) return badge('Non demandés', 'attente');
  if (!emailDe(l)) return h('span', { class: 'legende', texte: 'Sans espace' });
  const personne = bilan?.parPersonne.get(l.id);
  if (!personne || !releveDe(l)) return h('span', { class: 'legende', texte: 'Relevé en cours…' });
  return h('div', { class: 'groupe-badges' }, [
    ...CATEGORIES_DEMANDEES.filter((c) => c.portee === 'personne').map((c) => {
      const nb = (personne.parCategorie.get(c.cle) || []).length;
      if (nb) return badge(`${motCourt(c)} ✓`, 'succes');
      if (personne.couvertPar) return badge(`${motCourt(c)} commune ✓ (${quandParQui(personne.couvertPar)})`, 'succes');
      return badge(`${motCourt(c)} manquante`, 'alerte');
    }),
    personne.manquants.length ? bouton('Rappel par e-mail', async () => {
      await envoyerRappel(l, personne.manquants, bailleur);
      notifier(`Rappel envoyé à ${emailDe(l)}.`, 'succes');
    }, { petit: true, titre: 'Lui rappeler par e-mail ce qui manque' }) : null,
  ]);
}

/** Ligne « Pièces communes » en tête d'une colocation. */
function lignePiecesCommunes(tout, bien, bailleur) {
  const colocataires = colocatairesDe(tout, bien.id);
  if (!colocataires.length) return null;
  const bilan = bilanLogement(tout, bien);
  const contenu = [h('span', { class: 'pieces-communes-titre', texte: `Pièces communes de ${bien.nom}` })];
  if (!bilan) {
    contenu.push(h('span', { class: 'legende', texte: 'Relevé en cours…' }));
  } else {
    for (const c of CATEGORIES_DEMANDEES.filter((x) => x.portee === 'logement')) {
      const dernier = (bilan.logement.parCategorie.get(c.cle) || [])[0];
      contenu.push(dernier ? badge(`${motCourt(c)} ✓ (${quandParQui(dernier)})`, 'succes') : badge(`${motCourt(c)} manquant`, 'alerte'));
    }
    const assurance = (bilan.logement.parCategorie.get('assurance') || [])[0];
    if (assurance) contenu.push(badge(`Assurance pour tous ✓ (${quandParQui(assurance)})`, 'succes'));
    if (bilan.logement.manquants.length) {
      contenu.push(bouton('Rappel à tous', async () => {
        await envoyerRappelLogement(bien, colocataires, bilan.logement.manquants, bailleur);
        notifier(`Rappel envoyé aux ${colocataires.length} colocataires de ${bien.nom}.`, 'succes');
      }, { petit: true, titre: 'Un seul e-mail à tous les colocataires du logement' }));
    }
  }
  return h('div', { class: 'pieces-communes', 'data-logement': bien.id }, contenu);
}

// ---------------------------------------------------------------- page

function tableLocataires(tout, lignes, bailleur, contexte) {
  const bilans = new Map(tout.biens.map((b) => [b.id, bilanLogement(tout, b)]));
  const bilanDe = (l) => bilans.get(bailCourant(tout.baux, l.id)?.bienId) || null;
  return tableau({
    colonnes: [
      { titre: 'Nom', valeur: (l) => h('div', { 'data-locataire': l.id }, [h('strong', { texte: `${l.nom} ${l.prenom || ''}`.trim() })]) },
      { titre: 'Contact', valeur: (l) => celluleContact(l) },
      { titre: 'Bail', valeur: (l) => celluleBail(tout, l, bailCourant(tout.baux, l.id)) },
      { titre: 'Espace en ligne', valeur: (l) => celluleEspace(l) },
      { titre: 'Justificatifs', valeur: (l) => celluleJustificatifs(tout, l, bilanDe(l), bailleur) },
      { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
        bouton('Modifier', () => ouvrirLocataire(l), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer le locataire', message: `Supprimer ${l.nom} ${l.prenom || ''} ? Ses baux et loyers restent dans le dossier.`,
            libelleValider: 'Supprimer', danger: true,
          });
          if (confirme) await executer(etat.supprimer('locataires', l.id), 'Locataire supprimé.');
        }, { petit: true, type: 'danger' }),
      ]) },
    ],
    lignes,
    messageVide: contexte.bienId ? 'Aucun locataire sur ce logement.' : 'Aucun locataire enregistré : commencez par « + Locataire ».',
    cle: (l) => l.id,
  });
}

function carteJustificatifs(tout, logements, bailleur) {
  const zone = h('div');
  const blocs = [];
  for (const bien of logements) {
    const colocataires = colocatairesDe(tout, bien.id);
    if (!colocataires.length) continue;
    const bilan = bilanLogement(tout, bien);
    const ouvrir = (entree) => bouton(entree.fichier.nom, () => api.ouvrirFichier(entree.personnel ? 'portail' : 'partage', entree.fichier.chemin).catch(signalerErreur), { petit: true, titre: entree.par ? `Déposé par ${entree.par}${entree.le ? ` le ${date(entree.le)}` : ''}` : '' });
    const bloc = h('div', { class: 'justificatifs-logement' }, [h('div', { class: 'justificatifs-logement-titre', texte: `🏠 ${bien.nom}` })]);
    if (!bilan) { bloc.append(h('p', { class: 'legende', texte: 'Relevé en cours…' })); blocs.push(bloc); continue; }
    // Pièces communes
    bloc.append(h('div', { style: 'display:flex;align-items:center;gap:.6rem;flex-wrap:wrap' }, [
      h('strong', { texte: 'Pièces communes' }),
      ...CATEGORIES_DEMANDEES.filter((c) => c.portee === 'logement').map((c) => {
        const nb = (bilan.logement.parCategorie.get(c.cle) || []).length;
        return badge(`${motCourt(c)} ${nb ? '✓' : '—'}`, nb ? 'succes' : 'attente');
      }),
    ]));
    for (const [cle, entrees] of bilan.logement.parCategorie.entries()) {
      bloc.append(h('div', { style: 'margin:.25rem 0 0 .2rem' }, [
        h('span', { class: 'legende', texte: `${libelleCategorie(cle)}${estCommune(cle) ? '' : ' (pour tous)'} : ` }),
        ...entrees.map(ouvrir),
      ]));
    }
    // Personnes
    for (const l of colocataires) {
      const personne = bilan.parPersonne.get(l.id);
      const email = emailDe(l);
      const nom = nomDe(l);
      if (!email) { bloc.append(h('div', { style: 'margin-top:.7rem' }, [h('strong', { texte: nom }), h('span', { class: 'legende', texte: ' — pas d’adresse e-mail, donc pas d’espace : à renseigner (Modifier).' })])); continue; }
      if (!releveDe(l)) { bloc.append(h('div', { style: 'margin-top:.7rem' }, [h('strong', { texte: nom }), h('span', { class: 'legende', texte: ' — relevé en cours…' })])); continue; }
      const perso = CATEGORIES_DEMANDEES.filter((c) => c.portee === 'personne');
      bloc.append(h('div', { style: 'margin-top:.7rem' }, [
        h('div', { style: 'display:flex;align-items:center;gap:.6rem;flex-wrap:wrap' }, [
          h('strong', { texte: nom }),
          ...perso.map((c) => {
            const nb = (personne.parCategorie.get(c.cle) || []).length;
            if (nb) return badge(`${motCourt(c)} ✓`, 'succes');
            if (personne.couvertPar) return badge(`${motCourt(c)} commune ✓`, 'succes');
            return badge(`${motCourt(c)} —`, 'attente');
          }),
          personne.manquants.length ? bouton('Rappel par e-mail', async () => {
            await envoyerRappel(l, personne.manquants, bailleur);
            notifier(`Rappel envoyé à ${email}.`, 'succes');
          }, { petit: true }) : null,
        ]),
        ...[...personne.parCategorie.entries()].filter(([cle]) => !estCommune(cle)).map(([cle, fichiers]) => h('div', { style: 'margin:.25rem 0 0 .2rem' }, [
          h('span', { class: 'legende', texte: `${libelleCategorie(cle)} : ` }),
          ...fichiers.map((f) => bouton(f.nom, () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur), { petit: true })),
        ])),
      ]));
    }
    blocs.push(bloc);
  }
  zone.append(
    h('p', { class: 'legende', texte: 'Chaque colocataire dépose depuis son espace son attestation d’assurance habitation (chaque année) ; '
      + 'l’entretien des climatiseurs et le ramonage sont communs à la maison : un seul document, déposé par n’importe lequel d’entre eux, vaut pour tous. '
      + 'Une attestation d’assurance peut aussi être déposée « pour tous les colocataires ». Les documents déposés ne sont ni modifiables ni supprimables par eux.' }),
    ...(blocs.length ? blocs : [h('p', { class: 'legende', texte: 'Aucun colocataire sur un bail de colocation en cours.' })]),
  );
  return carte({ titre: 'Justificatifs des colocataires', corps: zone });
}

export default {
  cle: 'locataires',
  libelle: 'Locataires',
  icone: '👥',
  titre: 'Locataires',
  sousTitre: (contexte) => (contexte.bienId
    ? 'Les personnes qui occupent le logement choisi dans l’en-tête, leur espace en ligne et leurs justificatifs.'
    : 'Les personnes qui occupent vos logements, leur espace en ligne et leurs justificatifs.'),
  /** Pastille : personnes sans assurance + logements auxquels il manque une pièce commune (d'après le dernier relevé). */
  compteur(contexte) {
    if (!contexte.tout?.locataires || !releveFait()) return null;
    return (locatairesAvecManquants(contexte.tout).length + logementsAvecManquants(contexte.tout).length) || null;
  },
  rendre(contexte) {
    const tout = contexte.tout || contexte.donnees;
    const bailleur = tout.parametres?.bailleurs?.[0];
    const conteneur = h('div');

    // Répartition : par logement du bail courant ; sans bail courant → anciens.
    const courants = new Map(tout.locataires.map((l) => [l.id, bailCourant(tout.baux, l.id)]));
    const surLogement = (l, bienId) => courants.get(l.id)?.bienId === bienId;
    const logements = contexte.bienId ? tout.biens.filter((b) => b.id === contexte.bienId) : tout.biens;
    const anciens = tout.locataires.filter((l) => !courants.get(l.id)
      && (!contexte.bienId || bauxDe(tout.baux, l.id).some((b) => b.bienId === contexte.bienId)));
    const sansLogement = contexte.bienId ? [] : tout.locataires.filter((l) => courants.get(l.id) && !tout.biens.some((b) => surLogement(l, b.id)));
    const visibles = [...logements.flatMap((b) => tout.locataires.filter((l) => surLogement(l, b.id))), ...sansLogement, ...anciens];

    const lancerReleve = () => releverTous({ locataires: visibles, biens: logements }, () => { contexte.redessinerNavigation?.(); contexte.redessiner?.({ conserverPosition: true }); });

    conteneur.append(barreOutils([
      bouton('+ Locataire', () => ouvrirLocataire(null), { type: 'primaire' }),
      bouton('Relever les justificatifs', () => { lancerReleve(); notifier('Relevé en cours…'); }, { titre: 'Relire les espaces et les justificatifs déposés' }),
      bouton('Rappel par e-mail', async () => {
        const retardataires = locatairesAvecManquants(tout).filter((l) => visibles.includes(l));
        const logementsIncomplets = logementsAvecManquants(tout).filter((b) => logements.includes(b));
        if (!retardataires.length && !logementsIncomplets.length) { notifier('Personne à relancer : rien ne manque (ou relevé pas encore fait).'); return; }
        const lignes = [
          ...retardataires.map((l) => `${nomDe(l)} (assurance)`),
          ...logementsIncomplets.map((b) => `tous les colocataires de ${b.nom} (${bilanLogement(tout, b).logement.manquants.map((c) => motCourt(c).toLowerCase()).join(', ')})`),
        ];
        const ok = await confirmer({ titre: 'Rappel par e-mail', message: `Envoyer un rappel à : ${lignes.join(' ; ')} ?`, libelleValider: 'Envoyer' });
        if (!ok) return;
        for (const l of retardataires) {
          // eslint-disable-next-line no-await-in-loop
          await envoyerRappel(l, bilanLogement(tout, tout.biens.find((b) => b.id === courants.get(l.id)?.bienId)).parPersonne.get(l.id).manquants, bailleur);
        }
        for (const b of logementsIncomplets) {
          // eslint-disable-next-line no-await-in-loop
          await envoyerRappelLogement(b, colocatairesDe(tout, b.id), bilanLogement(tout, b).logement.manquants, bailleur);
        }
        notifier(`Rappel envoyé (${retardataires.length} personne${retardataires.length > 1 ? 's' : ''}, ${logementsIncomplets.length} logement${logementsIncomplets.length > 1 ? 's' : ''}).`, 'succes');
      }, { titre: 'À tous ceux à qui il manque un justificatif, et à chaque logement incomplet' }),
    ]));

    const corps = h('div');
    if (contexte.bienId) {
      const bien = logements[0];
      if (bien) corps.append(lignePiecesCommunes(tout, bien, bailleur));
      corps.append(tableLocataires(tout, tout.locataires.filter((l) => surLogement(l, contexte.bienId)), bailleur, contexte));
    } else {
      for (const logement of logements) {
        const siens = tout.locataires.filter((l) => surLogement(l, logement.id));
        corps.append(h('div', { class: 'section-logement section-logement-serree' }, [
          h('span', { class: 'section-logement-nom', texte: `🏠 ${logement.nom}` }),
          h('span', { class: 'legende', texte: `${logement.ville ? `${logement.ville} · ` : ''}${libelleTypeLocation(logement)} · ${siens.length} ${siens.length > 1 ? 'personnes' : 'personne'}` }),
        ]));
        corps.append(lignePiecesCommunes(tout, logement, bailleur));
        corps.append(tableLocataires(tout, siens, bailleur, contexte));
      }
      if (sansLogement.length) {
        corps.append(h('div', { class: 'section-logement section-logement-serree' }, [h('span', { class: 'section-logement-nom', texte: 'Bail sans logement connu' })]));
        corps.append(tableLocataires(tout, sansLogement, bailleur, contexte));
      }
      if (!tout.biens.length) corps.append(tableLocataires(tout, tout.locataires.filter((l) => !anciens.includes(l)), bailleur, contexte));
    }
    conteneur.append(carte({ titre: 'Locataires', serre: true, corps }));

    if (anciens.length) {
      const details = h('details', { class: 'anciens-locataires' }, [
        h('summary', { texte: `Anciens locataires — sans bail en cours (${anciens.length})` }),
        tableLocataires(tout, anciens, bailleur, contexte),
      ]);
      conteneur.append(carte({ titre: '', serre: true, corps: details }));
    }

    conteneur.append(carteJustificatifs(tout, logements, bailleur));

    // Relevé en arrière-plan si rien n'est connu (ou relevé vieux de plus de 5 minutes).
    const vieux = (r) => !r || Date.now() - r.le > 5 * 60 * 1000;
    const perime = visibles.some((l) => emailDe(l) && vieux(releveDe(l))) || logements.some((b) => colocatairesDe(tout, b.id).length && vieux(relevesLogement.get(b.id)));
    if (perime) lancerReleve();

    // Arrivée depuis un lien « voir le locataire » : on met sa ligne en évidence.
    if (contexte.locataireId) {
      const id = contexte.locataireId;
      contexte.locataireId = '';
      setTimeout(() => {
        const cible = conteneur.querySelector(`[data-locataire="${CSS.escape(id)}"]`)?.closest('tr');
        if (!cible) return;
        cible.closest('details')?.setAttribute('open', '');
        cible.classList.add('ligne-cible');
        cible.scrollIntoView({ block: 'center' });
      }, 0);
    }
    return conteneur;
  },
};
