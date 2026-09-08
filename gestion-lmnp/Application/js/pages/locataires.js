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
// menu : nombre de colocataires à qui il manque un justificatif).

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, confirmer, executer, barreOutils, notifier, signalerErreur } from '../ui.js';
import { date, montant, aujourdhui } from '../format.js';
import { CATEGORIES_JUSTIFICATIFS, categorieDuChemin } from '../justificatifs.js';
import { destinatairesDe } from '../portail-publication.js';
import { bailEstActif, ouvrirLocataire } from './bien.js';
import { libelleTypeLocation } from '../logements.js';

const CATEGORIES_DEMANDEES = CATEGORIES_JUSTIFICATIFS.filter((c) => c.cle !== 'autre');

// ------------------------------------------------------------- relevé nuage

/** Relevé par adresse e-mail : { portail, fichiers, parCategorie, manquants, le }. */
const releves = new Map();
let releveEnCours = null;

const emailDe = (locataire) => String(locataire?.email || '').trim().toLowerCase();
export const nomDe = (l) => `${l.prenom || ''} ${l.nom || ''}`.trim();

function classer(fichiers) {
  const parCategorie = new Map();
  for (const fichier of fichiers || []) {
    const cle = categorieDuChemin(fichier.chemin);
    if (!parCategorie.has(cle)) parCategorie.set(cle, []);
    parCategorie.get(cle).push(fichier);
  }
  return parCategorie;
}

async function releverUn(locataire) {
  const email = emailDe(locataire);
  if (!email) return null;
  let portail = null;
  let fichiers = [];
  try { portail = await api.lirePortail(email); } catch { /* pas d'espace ou hors ligne */ }
  try { fichiers = await api.listerFichiers('portail', `${email}/justificatifs`); } catch { /* rien déposé */ }
  fichiers = fichiers.filter((f) => String(f.chemin || '').startsWith(`${email}/justificatifs`));
  const parCategorie = classer(fichiers);
  const releve = {
    portail, fichiers, parCategorie,
    manquants: CATEGORIES_DEMANDEES.filter((c) => !(parCategorie.get(c.cle) || []).length),
    le: Date.now(),
  };
  releves.set(email, releve);
  return releve;
}

/**
 * Relève l'espace et les justificatifs de chaque locataire ayant une adresse.
 * Un seul relevé à la fois ; `apres` est appelé quand tout est relevé.
 */
export function releverTous(locataires, apres = () => {}) {
  if (releveEnCours) return releveEnCours;
  releveEnCours = (async () => {
    for (const locataire of locataires) {
      // eslint-disable-next-line no-await-in-loop
      await releverUn(locataire);
    }
  })().catch((erreur) => console.warn('Relevé des locataires :', erreur))
    .finally(() => { releveEnCours = null; apres(); });
  return releveEnCours;
}

export const releveDe = (locataire) => releves.get(emailDe(locataire)) || null;
export const releveFait = () => releves.size > 0;

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

/** Les locataires à qui il manque au moins un justificatif (d'après le relevé). */
export function locatairesAvecManquants(tout) {
  return (tout?.locataires || []).filter((l) => justificatifsDemandes(tout.baux, l.id) && (releveDe(l)?.manquants?.length || 0) > 0);
}

// ------------------------------------------------------------------ rappels

async function envoyerRappel(locataire, manquants, bailleur) {
  await api.envoyerCourriel({
    destinataires: destinatairesDe(locataire),
    sujet: 'Justificatifs à déposer sur votre espace',
    html: `<p>Bonjour ${locataire.prenom || ''},</p>`
      + '<p>Merci de déposer sur votre espace les justificatifs suivants, prévus par le bail :</p>'
      + `<ul>${manquants.map((c) => `<li>${c.libelle}${c.periodicite ? ` (${c.periodicite})` : ''}</li>`).join('')}</ul>`
      + `<p><a href="${window.location.origin}/colocataire">${window.location.origin}/colocataire</a> — rubrique « Justificatifs ».</p>`
      + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
  });
}

// -------------------------------------------------------------- cellules

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

function celluleJustificatifs(tout, l, bailleur) {
  if (!justificatifsDemandes(tout.baux, l.id)) return badge('Non demandés', 'attente');
  const releve = releveDe(l);
  if (!emailDe(l)) return h('span', { class: 'legende', texte: 'Sans espace' });
  if (!releve) return h('span', { class: 'legende', texte: 'Relevé en cours…' });
  return h('div', { class: 'groupe-badges' }, [
    ...CATEGORIES_DEMANDEES.map((c) => {
      const nb = (releve.parCategorie.get(c.cle) || []).length;
      const mot = c.libelle.split(' ')[0];
      return badge(nb ? `${mot} ✓` : `${mot} manquant${c.cle === 'assurance' ? 'e' : ''}`, nb ? 'succes' : 'alerte');
    }),
    releve.manquants.length ? bouton('Rappel par e-mail', async () => {
      await envoyerRappel(l, releve.manquants, bailleur);
      notifier(`Rappel envoyé à ${emailDe(l)}.`, 'succes');
    }, { petit: true, titre: 'Lui rappeler par e-mail ce qui manque' }) : null,
  ]);
}

// ---------------------------------------------------------------- page

function tableLocataires(tout, lignes, bailleur, contexte) {
  return tableau({
    colonnes: [
      { titre: 'Nom', valeur: (l) => h('div', { 'data-locataire': l.id }, [h('strong', { texte: `${l.nom} ${l.prenom || ''}`.trim() })]) },
      { titre: 'Contact', valeur: (l) => celluleContact(l) },
      { titre: 'Bail', valeur: (l) => celluleBail(tout, l, bailCourant(tout.baux, l.id)) },
      { titre: 'Espace en ligne', valeur: (l) => celluleEspace(l) },
      { titre: 'Justificatifs', valeur: (l) => celluleJustificatifs(tout, l, bailleur) },
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

function carteJustificatifs(tout, locataires, bailleur) {
  const zone = h('div');
  const concernes = locataires.filter((l) => justificatifsDemandes(tout.baux, l.id));
  const dessinerReleve = () => {
    const blocs = concernes.map((l) => {
      const releve = releveDe(l);
      const nom = nomDe(l);
      if (!emailDe(l)) {
        return h('div', { style: 'margin-bottom:.7rem' }, [h('strong', { texte: nom }), h('span', { class: 'legende', texte: ' — pas d’adresse e-mail, donc pas d’espace : à renseigner (Modifier).' })]);
      }
      if (!releve) return h('div', { style: 'margin-bottom:.7rem' }, [h('strong', { texte: nom }), h('span', { class: 'legende', texte: ' — relevé en cours…' })]);
      return h('div', { style: 'margin-bottom: .9rem' }, [
        h('div', { style: 'display:flex;align-items:center;gap:.6rem;flex-wrap:wrap' }, [
          h('strong', { texte: nom }),
          ...CATEGORIES_DEMANDEES.map((c) => {
            const nb = (releve.parCategorie.get(c.cle) || []).length;
            return badge(`${c.libelle.split(' ')[0]} ${nb ? '✓' : '—'}`, nb ? 'succes' : 'attente');
          }),
          releve.manquants.length ? bouton('Rappel par e-mail', async () => {
            await envoyerRappel(l, releve.manquants, bailleur);
            notifier(`Rappel envoyé à ${emailDe(l)}.`, 'succes');
          }, { petit: true }) : null,
        ]),
        ...[...releve.parCategorie.entries()].map(([cle, listeFichiers]) => h('div', { style: 'margin:.25rem 0 0 .2rem' }, [
          h('span', { class: 'legende', texte: `${CATEGORIES_JUSTIFICATIFS.find((c) => c.cle === cle)?.libelle || cle} : ` }),
          ...listeFichiers.map((f) => bouton(f.nom, () => api.ouvrirFichier('portail', f.chemin).catch(signalerErreur), { petit: true })),
        ])),
      ]);
    });
    zone.replaceChildren(
      h('p', { class: 'legende', texte: 'Chaque colocataire dépose depuis son espace : attestation d’assurance habitation '
        + '(chaque année), entretien des climatiseurs, ramonage de la cheminée. Les documents déposés ne sont ni '
        + 'modifiables ni supprimables par lui.' }),
      ...(blocs.length ? blocs : [h('p', { class: 'legende', texte: 'Aucun colocataire sur un bail de colocation en cours.' })]),
    );
  };
  dessinerReleve();
  return { carte: carte({ titre: 'Justificatifs des colocataires', corps: zone }), redessiner: dessinerReleve };
}

export default {
  cle: 'locataires',
  libelle: 'Locataires',
  icone: '👥',
  titre: 'Locataires',
  sousTitre: (contexte) => (contexte.bienId
    ? 'Les personnes qui occupent le logement choisi dans l’en-tête, leur espace en ligne et leurs justificatifs.'
    : 'Les personnes qui occupent vos logements, leur espace en ligne et leurs justificatifs.'),
  /** Pastille : colocataires à qui il manque au moins un justificatif (d'après le dernier relevé). */
  compteur(contexte) {
    if (!contexte.tout?.locataires || !releveFait()) return null;
    return locatairesAvecManquants(contexte.tout).length || null;
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

    const lancerReleve = () => releverTous(visibles, () => { contexte.redessinerNavigation?.(); contexte.redessiner?.({ conserverPosition: true }); });

    conteneur.append(barreOutils([
      bouton('+ Locataire', () => ouvrirLocataire(null), { type: 'primaire' }),
      bouton('Relever les justificatifs', () => { lancerReleve(); notifier('Relevé en cours…'); }, { titre: 'Relire les espaces et les justificatifs déposés' }),
      bouton('Rappel par e-mail', async () => {
        const retardataires = locatairesAvecManquants(tout).filter((l) => visibles.includes(l) && emailDe(l));
        if (!retardataires.length) { notifier('Personne à relancer : rien ne manque (ou relevé pas encore fait).'); return; }
        const ok = await confirmer({ titre: 'Rappel par e-mail', message: `Envoyer un rappel des justificatifs manquants à : ${retardataires.map(nomDe).join(', ')} ?`, libelleValider: 'Envoyer' });
        if (!ok) return;
        for (const l of retardataires) {
          // eslint-disable-next-line no-await-in-loop
          await envoyerRappel(l, releveDe(l).manquants, bailleur);
        }
        notifier(`Rappel envoyé à ${retardataires.length} colocataire${retardataires.length > 1 ? 's' : ''}.`, 'succes');
      }, { titre: 'À tous ceux à qui il manque un justificatif' }),
    ]));

    const corps = h('div');
    if (contexte.bienId) {
      corps.append(tableLocataires(tout, tout.locataires.filter((l) => surLogement(l, contexte.bienId)), bailleur, contexte));
    } else {
      for (const logement of logements) {
        const siens = tout.locataires.filter((l) => surLogement(l, logement.id));
        corps.append(h('div', { class: 'section-logement section-logement-serree' }, [
          h('span', { class: 'section-logement-nom', texte: `🏠 ${logement.nom}` }),
          h('span', { class: 'legende', texte: `${logement.ville ? `${logement.ville} · ` : ''}${libelleTypeLocation(logement)} · ${siens.length} ${siens.length > 1 ? 'personnes' : 'personne'}` }),
        ]));
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

    const justificatifs = carteJustificatifs(tout, visibles.filter((l) => !anciens.includes(l)), bailleur);
    conteneur.append(justificatifs.carte);

    // Relevé en arrière-plan si rien n'est connu (ou relevé vieux de plus de 5 minutes).
    const perime = visibles.some((l) => emailDe(l) && (!releveDe(l) || Date.now() - releveDe(l).le > 5 * 60 * 1000));
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
