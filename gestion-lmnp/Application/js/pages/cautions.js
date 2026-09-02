// Cautions (dépôts de garantie) : ce qui est attendu, reçu et restitué,
// colocataire par colocataire.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, formulaire, executer,
  notifier, ouvrirModale, fermerModale, signalerErreur } from '../ui.js';
import { montant, date, aujourdhui, centimes, nomFichierTelechargement } from '../format.js';
import { fluxDuBail } from '../calculs/loyers.js';
import { pdfRestitutionAnika, dateLongueFr, sirenDepuisSiret } from '../pdf-anika.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';

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
    const attenduParDefaut = flux.length
      ? centimes((Number(bail.depotGarantie) || 0) / flux.length) : 0;
    for (const payeur of flux) {
      const id = `${bail.id}-${String(payeur.locataireId).slice(0, 8)}`;
      const existante = enregistrees.get(id);
      enregistrees.delete(id);
      lignes.push({
        id,
        bailId: bail.id,
        locataireId: payeur.locataireId,
        attendu: attenduParDefaut,
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
  return badge('En attente', 'alerte');
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
  await executer(etat.enregistrer('cautions', {
    id: ligne.id,
    bailId: ligne.bailId,
    locataireId: ligne.locataireId,
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

    await executer(etat.enregistrer('cautions', {
      id: ligne.id, bailId: ligne.bailId, locataireId: ligne.locataireId,
      attendu: ligne.attendu || 0, recuLe: ligne.recuLe || '', montantRecu: ligne.montantRecu || 0,
      restitueLe: aujourdhui(), montantRestitue: restitue,
      retenues: propres, modeRestitution: selecteurMode.value, notes: ligne.notes || '',
    }), `Restitution enregistrée : ${montant(restitue)}.`);

    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    lien.download = nomFichierTelechargement(nomFichier);
    document.body.append(lien);
    lien.click();
    setTimeout(() => URL.revokeObjectURL(lien.href), 60000);

    if (publie && destinatairesDe(locataire).length) {
      await executer(api.envoyerCourriel({
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

    const detenu = centimes(lignes.reduce((s, l) => s
      + (Number(l.montantRecu) || 0) - (l.restitueLe ? (Number(l.montantRestitue) || 0) : 0), 0));
    const attendu = centimes(lignes.filter((l) => !l.restitueLe).reduce((s, l) => s + (Number(l.attendu) || 0), 0));

    conteneur.append(h('div', { class: 'grille grille-3', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Convenu (baux en cours)', valeur: montant(attendu, { rond: true }) }),
      tuile({ libelle: 'Détenu actuellement', valeur: montant(detenu, { rond: true }), ton: 'neutre',
        detail: 'à restituer en fin de bail' }),
      tuile({ libelle: 'Lignes en attente', valeur: String(lignes.filter((l) => !l.recuLe && !l.restitueLe).length) }),
    ]));

    conteneur.append(carte({
      titre: 'Dépôts de garantie',
      aide: 'Le dépôt de garantie n’est pas un loyer : il se suit ici, pas dans les recettes.',
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Colocataire', valeur: (l) => nomDe(donnees.locataires.find((x) => x.id === l.locataireId)) },
          { titre: 'Bail', valeur: (l) => (l.bail ? `${date(l.bail.dateDebut)} → ${l.bail.dateFin ? date(l.bail.dateFin) : 'en cours'}` : 'bail supprimé') },
          { titre: 'Convenu', nombre: true, valeur: (l) => montant(l.attendu || 0) },
          { titre: 'Reçue', nombre: true, valeur: (l) => (l.recuLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRecu || 0) }), h('div', { class: 'legende', texte: date(l.recuLe) })])
            : '—') },
          { titre: 'Restituée', nombre: true, valeur: (l) => (l.restitueLe
            ? h('div', {}, [h('div', { texte: montant(l.montantRestitue || 0) }), h('div', { class: 'legende', texte: date(l.restitueLe) })])
            : '—') },
          { titre: 'État', valeur: statutCaution },
          { titre: '', actions: true, valeur: (l) => h('div', { class: 'groupe-boutons' }, [
            !l.recuLe ? bouton('Reçue aujourd’hui', () => executer(etat.enregistrer('cautions', {
              id: l.id, bailId: l.bailId, locataireId: l.locataireId,
              attendu: l.attendu || 0, recuLe: aujourdhui(), montantRecu: l.attendu || 0,
              restitueLe: '', montantRestitue: 0, notes: l.notes || '',
            }), 'Caution marquée reçue.'), { petit: true, type: 'primaire' }) : null,
            l.recuLe ? bouton('Restituer', () => restituerCaution(donnees, l), {
              petit: true, titre: 'Décompte de restitution ANIKA : retenues, PDF, dépôt sur son espace, notification',
            }) : null,
            bouton('Modifier', () => modifierCaution(l), { petit: true }),
          ]) },
        ],
        lignes,
        cle: (l) => l.id,
        messageVide: 'Aucune caution à suivre — déclarez d’abord un bail dans « Bien & baux ».',
      }),
    }));

    return conteneur;
  },
};
