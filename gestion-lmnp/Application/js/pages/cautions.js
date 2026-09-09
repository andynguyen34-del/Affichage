// Cautions (dépôts de garantie) : ce qui est attendu, appelé, reçu et
// restitué, colocataire par colocataire. Depuis la v46, l'appel de dépôt
// (e-mail) et le reçu de dépôt (PDF ANIKA publié sur l'espace) sont des
// documents à part, distincts de l'appel de loyer et de la quittance.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, formulaire, executer,
  notifier, ouvrirModale, fermerModale, confirmer, signalerErreur, barreOutils,
} from '../ui.js';
import { montant, date, aujourdhui, centimes, nomFichierTelechargement } from '../format.js';
import { fluxDuBail } from '../calculs/loyers.js';
import { pdfRestitutionAnika, pdfRecuDepotAnika, dateLongueFr, sirenDepuisSiret } from '../pdf-anika.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';
import { bienDuBail } from '../logements.js';
import { ouvrirMiseAJour, bandeauMiseAJour } from './maj-ui.js';
import { preparerAppelDepot, courrielRecuDepot, montantEnLettres, dateLimiteDepot, reglageDepotDe } from '../depot-garantie.js';

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

/**
 * Une ligne de caution par payeur de chaque bail : ce qui est enregistré,
 * complété par les payeurs du bail qui n'ont pas encore de ligne.
 */
function lignesCautions(donnees) {
  const enregistrees = new Map(donnees.cautions.map((c) => [c.id, c]));
  const lignes = [];
  for (const bail of donnees.baux) {
    if (bail.type === 'saisonnier') continue; // pas de caution en saisonnier
    const flux = fluxDuBail(bail);
    // Convenu par défaut (v45) : un mois de loyer hors charges de chaque
    // colocataire (sa part) ; pour un locataire seul, le dépôt du bail s'il est
    // renseigné, sinon son loyer. Modifiable ligne par ligne (« Modifier »).
    const colocation = (bail.colocataires || []).some((c) => c && c.locataireId);
    const attenduDe = (payeur) => (colocation
      ? centimes(Number(payeur.loyerHc) || 0)
      : centimes(Number(bail.depotGarantie) || Number(payeur.loyerHc) || 0));
    for (const payeur of flux) {
      const id = `${bail.id}-${String(payeur.locataireId).slice(0, 8)}`;
      const existante = enregistrees.get(id);
      enregistrees.delete(id);
      lignes.push({
        id,
        bailId: bail.id,
        locataireId: payeur.locataireId,
        attendu: attenduDe(payeur),
        ...existante,
        bail,
      });
    }
  }
  // Lignes enregistrées dont le bail a disparu : on les garde visibles.
  for (const reste of enregistrees.values()) lignes.push({ ...reste, bail: null });
  return lignes;
}

function statutCaution(ligne) {
  if (ligne.restitueLe) return badge('Restituée', 'attente');
  if ((Number(ligne.montantRecu) || 0) >= (Number(ligne.attendu) || 0) - 0.01 && ligne.recuLe) return badge('Reçue', 'succes');
  if (ligne.recuLe) return badge('Partielle', 'attention');
  if (ligne.appeleLe) return badge(`Appelée le ${date(ligne.appeleLe)}`, 'attention');
  return badge('À appeler', 'alerte');
}

/** Le statut et, dessous, ce qui s'est passé (relance, reçu publié). */
function celluleEtat(ligne) {
  const details = [];
  if (!ligne.recuLe && ligne.relanceLe) details.push(`relancée le ${date(ligne.relanceLe)}`);
  if (ligne.recuLe && ligne.appeleLe) details.push(`appelée le ${date(ligne.appeleLe)}`);
  if (ligne.recuLe && ligne.recuPublieLe) details.push(`reçu publié le ${date(ligne.recuPublieLe)}`);
  return h('div', {}, [statutCaution(ligne), ...details.map((d) => h('div', { class: 'legende', texte: d }))]);
}

/** Enregistre une ligne de caution en conservant tous ses champs (sauf le bail rattaché). */
function sauverCaution(ligne, modifications = {}) {
  const { bail: _bail, ...champs } = ligne;
  return etat.enregistrer('cautions', {
    ...champs,
    attendu: Number(champs.attendu) || 0,
    recuLe: champs.recuLe || '',
    montantRecu: Number(champs.montantRecu) || 0,
    restitueLe: champs.restitueLe || '',
    montantRestitue: Number(champs.montantRestitue) || 0,
    notes: champs.notes || '',
    ...modifications,
  });
}

const contexteLigne = (donnees, ligne) => {
  const locataire = donnees.locataires.find((l) => l.id === ligne.locataireId) || null;
  const bail = ligne.bail;
  const bien = donnees.biens.find((b) => b.id === bail?.bienId) || null;
  return { locataire, bail, bien };
};

/**
 * Appel de dépôt de garantie (v46) : l'e-mail qui demande le dépôt avant la
 * remise des clés — jamais mêlé à l'appel de loyer. `relance` : nouvel envoi
 * après un premier appel resté sans versement.
 */
async function appelerDepot(donnees, ligne, { relance = false } = {}) {
  const { locataire, bail, bien } = contexteLigne(donnees, ligne);
  if (!locataire) { notifier('Locataire introuvable pour cette ligne.', 'erreur'); return; }
  if (!bail) { notifier('Le bail de cette ligne a été supprimé : rien à appeler.', 'erreur'); return; }
  const courriel = preparerAppelDepot({ ligne, locataire, bail, bien, parametres: donnees.parametres, relance });
  if (!courriel) { notifier('Ce dépôt est déjà entièrement reçu.', 'erreur'); return; }
  if (!courriel.destinataires.length) { notifier(`${nomDe(locataire)} n’a pas d’adresse e-mail : renseignez-la dans « Locataires ».`, 'erreur'); return; }
  const champDate = h('input', { type: 'date', value: courriel.dateLimite || aujourdhui(), id: 'depot-date-limite' });
  const apercu = h('div', { class: 'apercu-courriel', style: 'border:1px solid var(--bordure);border-radius:6px;padding:.4rem .8rem;margin-top:.6rem;max-height:22rem;overflow:auto;background:var(--fond-carte)' });
  const dessinerApercu = () => {
    const c = preparerAppelDepot({ ligne, locataire, bail, bien, parametres: donnees.parametres, relance, dateLimite: champDate.value });
    apercu.replaceChildren(h('div', { class: 'legende', style: 'margin:.3rem 0', texte: `Objet : ${c.sujet}` }));
    const corps = h('div');
    corps.innerHTML = c.html;
    apercu.append(corps);
    return c;
  };
  champDate.addEventListener('change', dessinerApercu);
  dessinerApercu();
  await new Promise((resoudre) => {
    const fermer = ouvrirModale({
      titre: `${relance ? 'Relancer' : 'Appeler'} le dépôt de garantie — ${nomDe(locataire)}`,
      large: true,
      surFermeture: () => resoudre(),
      corps: h('div', {}, [
        h('p', { class: 'legende', texte: `E-mail à ${courriel.destinataires.join(', ')} : ${montant(courriel.montant)} à verser avant la remise des clés. `
          + 'Le texte se règle dans Paramètres → « Dépôt de garantie » ; les copies dans « Adresses e-mail » (type Dépôts de garantie).' }),
        h('label', {}, ['À verser avant le ', champDate]),
        apercu,
      ]),
      pied: [
        bouton('Annuler', () => { fermer(); resoudre(); }),
        bouton(relance ? 'Envoyer la relance' : 'Envoyer l’appel', async () => {
          if (!champDate.value) { notifier('Indiquez la date limite.', 'erreur'); return; }
          const final = dessinerApercu();
          fermer({ valide: true });
          try {
            const envoye = await executer(api.envoyerCourriel({ type: 'depots', destinataires: final.destinataires, sujet: final.sujet, html: final.html }), null);
            if (envoye !== null) {
              await executer(sauverCaution(ligne, relance
                ? { relanceLe: aujourdhui(), dateLimite: champDate.value }
                : { appeleLe: aujourdhui(), dateLimite: champDate.value }), `${relance ? 'Relance' : 'Appel de dépôt'} envoyé à ${nomDe(locataire)}.`);
            }
          } catch (erreur) { signalerErreur(erreur); }
          resoudre();
        }, { type: 'primaire' }),
      ],
    });
  });
}

/** Appelle en une fois tous les dépôts pas encore appelés ni reçus (du logement choisi). */
async function appelerTousLesDepots(donnees, lignes) {
  const candidats = lignes.filter((l) => l.bail && !l.recuLe && !l.appeleLe && !l.restitueLe
    && (Number(l.attendu) || 0) > 0.005);
  const prets = [];
  const ecartes = [];
  for (const ligne of candidats) {
    const { locataire, bail, bien } = contexteLigne(donnees, ligne);
    const courriel = locataire ? preparerAppelDepot({ ligne, locataire, bail, bien, parametres: donnees.parametres }) : null;
    if (courriel && courriel.destinataires.length) prets.push({ ligne, locataire, courriel });
    else ecartes.push(`${nomDe(locataire)} (${locataire ? 'aucune adresse e-mail' : 'locataire introuvable'})`);
  }
  if (!prets.length) { notifier(`Aucun dépôt à appeler${ecartes.length ? ` — non concernés : ${ecartes.join(', ')}` : ''}.`); return; }
  const ok = await confirmer({
    titre: `Appeler ${prets.length} dépôt(s) de garantie`,
    message: `${prets.map((p) => `${nomDe(p.locataire)} — ${montant(p.courriel.montant)} avant le ${date(p.courriel.dateLimite)}`).join(' ; ')}.`
      + (ecartes.length ? ` Non concernés : ${ecartes.join(', ')}.` : ''),
    libelleValider: 'Envoyer les appels',
  });
  if (!ok) return;
  let envoyes = 0;
  for (const p of prets) {
    // eslint-disable-next-line no-await-in-loop
    const envoye = await executer(api.envoyerCourriel({ type: 'depots', destinataires: p.courriel.destinataires, sujet: p.courriel.sujet, html: p.courriel.html }), null);
    if (envoye === null) continue;
    // eslint-disable-next-line no-await-in-loop
    await sauverCaution(p.ligne, { appeleLe: aujourdhui(), dateLimite: p.courriel.dateLimite });
    envoyes += 1;
  }
  notifier(`${envoyes} appel(s) de dépôt de garantie envoyé(s).`, envoyes ? 'succes' : 'erreur');
}

/**
 * Le reçu de dépôt de garantie (v46) : PDF ANIKA déposé sur l'espace du
 * colocataire, e-mail de mise à disposition, ligne marquée « reçu publié ».
 * `telecharger` : ouvre aussi le PDF sur ce poste.
 */
async function publierRecuDepot(donnees, ligne, { telecharger = true, notifierLocataire = true } = {}) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return null; }
  const { locataire, bail, bien } = contexteLigne(donnees, ligne);
  if (!locataire) { notifier('Locataire introuvable pour cette ligne.', 'erreur'); return null; }
  const montantRecu = centimes(Number(ligne.montantRecu) || 0);
  if (montantRecu <= 0.005 || !ligne.recuLe) { notifier('Enregistrez d’abord la réception (date et montant).', 'erreur'); return null; }
  const colocation = (bail?.colocataires || []).some((c) => c && c.locataireId);
  const octets = await pdfRecuDepotAnika({
    bailleur: { nom: bailleur.nom, adresse: bailleur.adresse || '', email: bailleur.email || '', siren: sirenDepuisSiret(donnees.parametres.siret) },
    locataireNom: nomDe(locataire),
    logement: { adresse: bien?.adresse || '', codePostal: bien?.codePostal || '', ville: bien?.ville || '' },
    montantRecu, montantConvenu: Number(ligne.attendu) || montantRecu, montantEnLettres: montantEnLettres(montantRecu),
    recuLe: dateLongueFr(ligne.recuLe), modeVersement: ligne.modeVersement || '',
    bailDebut: bail?.dateDebut ? dateLongueFr(bail.dateDebut) : '', colocation,
    lieu: donnees.parametres.lieuSignature || '', dateSignature: dateLongueFr(aujourdhui()),
  });
  const nomFichier = `ANIKA_recu_depot_garantie_${(locataire.prenom || locataire.nom || '').toLowerCase()}_${ligne.recuLe}.pdf`;
  let publie = null;
  try {
    publie = await publierDocument({ locataire, type: 'depot', titre: 'Reçu de dépôt de garantie', nomFichier, octets });
  } catch (erreur) { notifier(erreur.message, 'erreur'); }

  if (telecharger) {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
  }
  if (publie) {
    await sauverCaution(ligne, { recuPublieLe: aujourdhui() });
    if (notifierLocataire && destinatairesDe(locataire).length) {
      const courriel = courrielRecuDepot({ locataire, montantRecu, recuLe: ligne.recuLe, modeVersement: ligne.modeVersement || '', parametres: donnees.parametres, origine: window.location.origin });
      await executer(api.envoyerCourriel({ type: 'depots', destinataires: courriel.destinataires, sujet: courriel.sujet, html: courriel.html }), 'Reçu publié sur son espace et e-mail envoyé.');
    } else notifier('Reçu publié sur son espace.', 'succes');
  }
  return octets;
}

/** Réception du dépôt : date, montant, mode de versement — puis le reçu est généré et publié. */
async function enregistrerReception(donnees, ligne) {
  const { locataire } = contexteLigne(donnees, ligne);
  const saisie = await formulaire({
    titre: `Dépôt reçu — ${nomDe(locataire)}`,
    aide: 'Le reçu de dépôt de garantie (PDF ANIKA) est généré, déposé sur l’espace du colocataire et annoncé par e-mail.',
    champs: [
      { cle: 'recuLe', libelle: 'Reçu le', type: 'date', requis: true },
      { cle: 'montantRecu', libelle: 'Montant reçu (€)', type: 'montant', requis: true },
      { cle: 'modeVersement', libelle: 'Mode de versement', type: 'liste', options: ['virement bancaire', 'chèque', 'espèces'].map((m) => ({ valeur: m, libelle: m })) },
      { cle: 'publier', libelle: 'Générer le reçu, le publier sur son espace et l’envoyer par e-mail', type: 'case' },
    ],
    valeurs: { recuLe: ligne.recuLe || aujourdhui(), montantRecu: ligne.montantRecu || ligne.attendu || 0, modeVersement: ligne.modeVersement || 'virement bancaire', publier: true },
    libelleValider: 'Enregistrer',
  });
  if (!saisie) return;
  const modifications = { recuLe: saisie.recuLe, montantRecu: Number(saisie.montantRecu) || 0, modeVersement: saisie.modeVersement || '' };
  await executer(sauverCaution(ligne, modifications), 'Dépôt marqué reçu.');
  if (saisie.publier) await publierRecuDepot(donnees, { ...ligne, ...modifications });
}

async function modifierCaution(ligne) {
  const saisie = await formulaire({
    titre: 'Caution',
    aide: 'Renseignez ce qui a été convenu et ce qui a réellement été versé. '
      + 'À la fin du bail, notez la restitution (déduction faite des éventuelles retenues).',
    champs: [
      { cle: 'attendu', libelle: 'Montant convenu (€)', type: 'montant', requis: true },
      { cle: 'recuLe', libelle: 'Reçue le', type: 'date' },
      { cle: 'montantRecu', libelle: 'Montant reçu (€)', type: 'montant' },
      { cle: 'restitueLe', libelle: 'Restituée le', type: 'date' },
      { cle: 'montantRestitue', libelle: 'Montant restitué (€)', type: 'montant' },
      { cle: 'notes', libelle: 'Notes (retenues, mode de versement…)', type: 'zone' },
    ],
    valeurs: {
      attendu: ligne.attendu || 0,
      recuLe: ligne.recuLe || '',
      montantRecu: ligne.montantRecu || 0,
      restitueLe: ligne.restitueLe || '',
      montantRestitue: ligne.montantRestitue || 0,
      notes: ligne.notes || '',
    },
  });
  if (!saisie) return;
  await executer(sauverCaution(ligne, {
    attendu: Number(saisie.attendu) || 0,
    recuLe: saisie.recuLe || '',
    montantRecu: Number(saisie.montantRecu) || 0,
    restitueLe: saisie.restitueLe || '',
    montantRestitue: Number(saisie.montantRestitue) || 0,
    notes: saisie.notes || '',
  }), 'Caution enregistrée.');
}

/**
 * Restitution du dépôt de garantie : saisie des retenues éventuelles, puis
 * document ANIKA généré, déposé sur l'espace du colocataire et notifié.
 */
async function restituerCaution(donnees, ligne) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  if (!bailleur?.nom) { notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur'); return; }
  const locataire = donnees.locataires.find((l) => l.id === ligne.locataireId);
  if (!locataire) { notifier('Locataire introuvable pour cette ligne.', 'erreur'); return; }
  const bail = ligne.bail;
  const bien = donnees.biens.find((b) => b.id === bail?.bienId);
  const edlSortie = (donnees.etatsDesLieux || [])
    .filter((e) => e.type === 'sortie' && (!bail || e.bailId === bail.id))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  const retenues = (ligne.retenues || []).map((r) => ({ ...r }));
  const zone = h('div');
  const dessinerRetenues = () => {
    zone.replaceChildren();
    retenues.forEach((retenue, index) => {
      zone.append(h('div', { style: 'display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem;flex-wrap:wrap' }, [
        h('input', {
          value: retenue.libelle || '', placeholder: 'ex. : remplacement d’une vitre (facture)',
          style: 'flex:3;min-width:12rem', oninput: (e) => { retenue.libelle = e.target.value; },
        }),
        h('input', {
          type: 'number', step: '0.01', min: '0', value: retenue.montant || '',
          style: 'width:7rem', title: 'Montant retenu (€)',
          oninput: (e) => { retenue.montant = Number(e.target.value) || 0; },
        }),
        h('button', { class: 'bouton bouton-petit bouton-danger', type: 'button', onclick: () => {
          retenues.splice(index, 1); dessinerRetenues();
        } }, '✕'),
      ]));
    });
  };
  dessinerRetenues();

  const selecteurMode = h('select', {}, ['virement bancaire', 'chèque', 'espèces']
    .map((m) => h('option', { value: m, selected: m === (ligne.modeRestitution || 'virement bancaire') }, m)));
  const champDateEdl = h('input', { type: 'date', value: edlSortie?.date || aujourdhui() });

  const valider = async () => {
    const propres = retenues.filter((r) => r.libelle && (Number(r.montant) || 0) > 0);
    const depotVerse = Number(ligne.montantRecu) || Number(ligne.attendu) || 0;
    const totalRetenues = centimes(propres.reduce((s, r) => s + r.montant, 0));
    const restitue = centimes(depotVerse - totalRetenues);
    if (restitue < 0) { notifier('Les retenues dépassent le dépôt versé.', 'erreur'); return; }
    fermerModale();

    const octets = await pdfRestitutionAnika({
      bailleur: {
        nom: bailleur.nom,
        adresse: bailleur.adresse || '',
        email: bailleur.email || '',
        siren: sirenDepuisSiret(donnees.parametres.siret),
      },
      locataireNom: nomDe(locataire),
      logement: { adresse: bien?.adresse || '', codePostal: bien?.codePostal || '', ville: bien?.ville || '' },
      entreeLe: dateLongueFr(bail?.dateDebut || ''),
      edlSortieLe: dateLongueFr(champDateEdl.value),
      depotVerse,
      retenues: propres,
      modeRestitution: selecteurMode.value,
      lieu: donnees.parametres.lieuSignature || '',
      dateSignature: dateLongueFr(aujourdhui()),
    });
    const nomFichier = `ANIKA_restitution_depot_garantie_${(locataire.prenom || locataire.nom || '').toLowerCase()}.pdf`;

    let publie = null;
    try {
      publie = await publierDocument({
        locataire, type: 'restitution',
        titre: 'Restitution du dépôt de garantie',
        nomFichier, octets,
      });
    } catch (erreur) { notifier(erreur.message, 'erreur'); }

    await executer(sauverCaution(ligne, {
      restitueLe: aujourdhui(), montantRestitue: restitue,
      retenues: propres, modeRestitution: selecteurMode.value,
    }), `Restitution enregistrée : ${montant(restitue)}.`);

    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);

    if (publie && destinatairesDe(locataire).length) {
      await executer(api.envoyerCourriel({ type: 'documents',
        destinataires: destinatairesDe(locataire),
        sujet: 'Restitution de votre dépôt de garantie',
        html: `<p>Bonjour ${locataire.prenom || ''},</p>`
          + `<p>Le décompte de restitution de votre dépôt de garantie est disponible sur votre espace : `
          + `<strong>${montant(restitue)}</strong> vous ${propres.length ? 'seront restitués après déduction des retenues justifiées' : 'seront intégralement restitués'} `
          + `par ${selecteurMode.value}.</p>`
          + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
          + `<p>Bien cordialement,<br>${bailleur.nom}</p>`,
      }), 'Notification envoyée.');
    }
  };

  ouvrirModale({
    titre: `Restitution — ${nomDe(locataire)}`,
    large: true,
    corps: h('div', {}, [
      h('p', { class: 'legende', texte:
        `Dépôt versé : ${montant(Number(ligne.montantRecu) || Number(ligne.attendu) || 0)}. `
        + 'Listez les retenues justifiées par l’état des lieux de sortie (aucune : restitution intégrale, '
        + 'délai légal d’un mois ; avec retenues : deux mois). Le document ANIKA est déposé sur son espace.' }),
      h('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.8rem' }, [
        h('label', {}, ['Date de l’état des lieux de sortie ', champDateEdl]),
        h('label', {}, ['Mode de restitution ', selecteurMode]),
      ]),
      zone,
      bouton('+ Retenue', () => { retenues.push({ libelle: '', montant: 0 }); dessinerRetenues(); }, { petit: true }),
    ]),
    pied: [
      bouton('Annuler', () => fermerModale()),
      bouton('Générer la restitution', () => valider().catch(signalerErreur), { type: 'primaire' }),
    ],
  });
}

export default {
  cle: 'cautions',
  libelle: 'Cautions',
  icone: '🛡️',
  titre: 'Cautions',
  sousTitre: 'Les dépôts de garantie : convenus, reçus, restitués.',
  compteur(contexte) {
    if (!contexte.donnees?.baux) return null;
    const enAttente = lignesCautions(contexte.donnees)
      .filter((l) => !l.restitueLe && (Number(l.montantRecu) || 0) < (Number(l.attendu) || 0) - 0.01).length;
    return enAttente || null;
  },
  rendre(contexte) {
    const donnees = contexte.donnees;
    const lignes = lignesCautions(donnees);
    const conteneur = h('div');
    const plusieursLogements = !contexte.bienId && donnees.biens.length > 1;

    const detenu = centimes(lignes.reduce((s, l) => s
      + (Number(l.montantRecu) || 0) - (l.restitueLe ? (Number(l.montantRestitue) || 0) : 0), 0));
    const attendu = centimes(lignes.filter((l) => !l.restitueLe).reduce((s, l) => s + (Number(l.attendu) || 0), 0));

    conteneur.append(h('div', { class: 'grille grille-3', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Convenu (baux en cours)', valeur: montant(attendu, { rond: true }) }),
      tuile({ libelle: 'Détenu actuellement', valeur: montant(detenu, { rond: true }), ton: 'neutre',
        detail: 'à restituer en fin de bail' }),
      tuile({ libelle: 'À appeler', valeur: String(lignes.filter((l) => l.bail && !l.recuLe && !l.appeleLe && !l.restitueLe).length),
        detail: `${lignes.filter((l) => !l.recuLe && l.appeleLe && !l.restitueLe).length} appelée(s), en attente du versement` }),
    ]));

    // Dépôts enregistrés dont le bail a disparu ou dont le colocataire n'est plus sur le bail (v44).
    const bandeau = bandeauMiseAJour(donnees);
    if (bandeau) conteneur.append(bandeau);
    const aAppeler = lignes.filter((l) => l.bail && !l.recuLe && !l.appeleLe && !l.restitueLe && (Number(l.attendu) || 0) > 0.005).length;
    conteneur.append(barreOutils([
      bouton(`Appeler les dépôts non appelés${aAppeler ? ` (${aAppeler})` : ''}`, () => appelerTousLesDepots(donnees, lignes).catch(signalerErreur), {
        type: aAppeler ? 'primaire' : undefined, titre: 'Un e-mail d’appel de dépôt de garantie à chaque colocataire pas encore appelé (logement choisi en haut)',
      }),
      bouton('Mettre à jour les dépôts', () => ouvrirMiseAJour(donnees).catch(signalerErreur), { titre: 'Compare les dépôts de garantie et échéances enregistrés aux baux' }),
    ]));

    conteneur.append(carte({
      titre: 'Dépôts de garantie',
      aide: 'Le dépôt de garantie n’est pas un loyer : il se suit ici, pas dans les recettes, avec ses propres documents — l’appel de dépôt (e-mail) puis le reçu (PDF ANIKA sur l’espace du colocataire). '
        + 'Convenu par défaut : un mois de loyer hors charges de chaque colocataire (sa part), modifiable ligne par ligne.',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Colocataire', valeur: (l) => nomDe(donnees.locataires.find((x) => x.id === l.locataireId)) },
          ...(plusieursLogements ? [{ titre: 'Logement', valeur: (l) => bienDuBail(donnees, l.bail)?.nom || '—' }] : []),
          { titre: 'Bail', valeur: (l) => (l.bail ? `${date(l.bail.dateDebut)} → ${l.bail.dateFin ? date(l.bail.dateFin) : 'en cours'}` : 'bail supprimé') },
          { titre: 'Convenu', nombre: true, valeur: (l) => montant(l.attendu || 0) },
          { titre: 'Reçue', nombre: true, valeur: (l) => (l.recuLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRecu || 0) }), h('div', { class: 'legende', texte: date(l.recuLe) })])
            : '—') },
          { titre: 'Restituée', nombre: true, valeur: (l) => (l.restitueLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRestitue || 0) }), h('div', { class: 'legende', texte: date(l.restitueLe) })])
            : '—') },
          { titre: 'État', valeur: celluleEtat },
          { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
            !l.recuLe && l.bail && !l.appeleLe ? bouton('Appeler le dépôt', () => appelerDepot(donnees, l).catch(signalerErreur), {
              petit: true, type: 'primaire', titre: 'E-mail d’appel de dépôt de garantie, distinct de l’appel de loyer',
            }) : null,
            !l.recuLe && l.bail && l.appeleLe ? bouton('Relancer', () => appelerDepot(donnees, l, { relance: true }).catch(signalerErreur), {
              petit: true, titre: 'Nouvel e-mail rappelant l’appel de dépôt',
            }) : null,
            !l.recuLe ? bouton('Dépôt reçu…', () => enregistrerReception(donnees, l).catch(signalerErreur), {
              petit: true, type: l.appeleLe ? 'primaire' : undefined, titre: 'Date, montant, mode de versement — puis reçu PDF publié sur son espace',
            }) : null,
            l.recuLe && !l.restitueLe ? bouton('Reçu PDF', () => publierRecuDepot(donnees, l, { notifierLocataire: !l.recuPublieLe }).catch(signalerErreur), {
              petit: true, titre: l.recuPublieLe ? 'Rouvrir ou régénérer le reçu (republié sur son espace, sans nouvel e-mail)' : 'Générer le reçu, le publier sur son espace et l’envoyer par e-mail',
            }) : null,
            l.recuLe ? bouton('Restituer', () => restituerCaution(donnees, l), {
              petit: true, titre: 'Décompte de restitution ANIKA : retenues, PDF, dépôt sur son espace, notification',
            }) : null,
            bouton('Modifier', () => modifierCaution(l), { petit: true }),
          ]) },
        ],
        lignes,
        cle: (l) => l.id,
        messageVide: 'Aucune caution à suivre — déclarez d’abord un bail dans « Logements & baux ».',
      }),
    }));

    return conteneur;
  },
};
