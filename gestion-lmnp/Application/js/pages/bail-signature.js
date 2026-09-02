// Bail signé dans l'application : le PDF du bail est joint au dossier, les
// parties signent à l'écran (tablette, doigt ou souris), et le bail signé est
// déposé sur l'espace de chaque colocataire avec e-mail de mise à disposition.

import * as etat from '../etat.js';
import { h, bouton, badge, notifier, executer, ouvrirModale, fermerModale, choisirFichier, confirmer } from '../ui.js';
import { date, dateLongue, aujourdhui } from '../format.js';
import { demanderSignature } from '../signature.js';
import { pdfBailSigne } from '../pdf.js';
import { publierDocument, destinatairesDe } from '../portail-publication.js';
import * as api from '../api.js';

const nomLocataire = (donnees, id) => {
  const locataire = donnees.locataires.find((l) => l.id === id);
  return locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Locataire';
};

/** Les signataires attendus : les bailleurs, puis chaque colocataire. */
function signatairesAttendus(donnees, bail) {
  const parties = (donnees.parametres.bailleurs || [])
    .filter((b) => b.nom)
    .map((b) => ({ cle: `bailleur-${b.nom}`, nom: b.nom, role: 'Bailleur' }));
  const ids = (bail.colocataires || []).length
    ? bail.colocataires.map((c) => c.locataireId).filter(Boolean)
    : [bail.locataireId, bail.coTitulaireId].filter(Boolean);
  for (const id of ids) {
    parties.push({ cle: `locataire-${id}`, nom: nomLocataire(donnees, id), role: 'Colocataire', locataireId: id });
  }
  return parties;
}

const cheminOriginal = (bail) => `baux/${bail.id}/bail-original.pdf`;
const cheminSigne = (bail) => `baux/${bail.id}/bail-signe.pdf`;

async function joindreBail(bail) {
  const fichier = await choisirFichier({ accept: 'application/pdf' });
  if (!fichier) return false;
  if (fichier.type && fichier.type !== 'application/pdf') { notifier('Choisissez un fichier PDF.', 'erreur'); return false; }
  const octets = new Uint8Array(await fichier.arrayBuffer());
  await api.deposerOctets('documents', cheminOriginal(bail), octets, 'application/pdf');
  await etat.modifierElement('baux', bail.id, (b) => {
    b.documentBail = { nom: fichier.name, deposeLe: aujourdhui() };
    // Un nouveau document met à zéro l'exemplaire signé précédent.
    delete b.bailSigneLe;
  });
  notifier('Bail joint au dossier.', 'succes');
  return true;
}

async function signer(bail, partie) {
  const image = await demanderSignature({ titre: 'Signature du bail', nom: `${partie.nom} — ${partie.role}` });
  if (!image) return;
  await executer(etat.modifierElement('baux', bail.id, (b) => {
    const liste = (b.signaturesBail || []).filter((s) => s.cle !== partie.cle);
    liste.push({ cle: partie.cle, nom: partie.nom, role: partie.role, image, date: aujourdhui() });
    b.signaturesBail = liste;
  }), `Signature de ${partie.nom} enregistrée.`);
}

async function genererBailSigne(donnees, bail) {
  const signatures = bail.signaturesBail || [];
  if (!bail.documentBail) { notifier('Joignez d’abord le PDF du bail.', 'erreur'); return; }
  if (!signatures.length) { notifier('Aucune signature recueillie pour l’instant.', 'erreur'); return; }
  const attendus = signatairesAttendus(donnees, bail);
  const manquants = attendus.filter((p) => !signatures.some((s) => s.cle === p.cle));
  if (manquants.length) {
    const ok = await confirmer({
      titre: 'Signatures incomplètes',
      message: `${manquants.map((p) => p.nom).join(', ')} n'${manquants.length > 1 ? 'ont' : 'a'} pas encore signé. `
        + 'Générer quand même le document avec les signatures déjà recueillies ?',
      libelleValider: 'Générer',
    });
    if (!ok) return;
  }
  const original = await api.lireOctets('documents', cheminOriginal(bail));
  const octets = await pdfBailSigne({
    octetsOriginal: original,
    signatures,
    lieu: donnees.parametres.lieuSignature || '',
  });
  await api.deposerOctets('documents', cheminSigne(bail), octets, 'application/pdf');
  await etat.modifierElement('baux', bail.id, (b) => { b.bailSigneLe = aujourdhui(); });
  notifier('Bail signé généré : la page des signatures a été ajoutée au PDF.', 'succes');
  return octets;
}

/**
 * Dépose le bail (signé s'il existe, sinon l'original) sur l'espace de chaque
 * colocataire disposant d'une adresse e-mail. Renvoie les publiés/écartés.
 */
async function publierAuxColocataires(donnees, bail) {
  const chemin = bail.bailSigneLe ? cheminSigne(bail) : cheminOriginal(bail);
  if (!bail.documentBail) { notifier('Joignez d’abord le PDF du bail.', 'erreur'); return null; }
  const octets = await api.lireOctets('documents', chemin);
  const ids = (bail.colocataires || []).length
    ? bail.colocataires.map((c) => c.locataireId).filter(Boolean)
    : [bail.locataireId].filter(Boolean);
  const publies = [];
  const sansEmail = [];
  for (const id of ids) {
    const locataire = donnees.locataires.find((l) => l.id === id);
    if (!locataire) continue;
    if (!locataire.email) { sansEmail.push(nomLocataire(donnees, id)); continue; }
    // eslint-disable-next-line no-await-in-loop
    await publierDocument({
      locataire, type: 'bail',
      titre: bail.bailSigneLe ? 'Bail de colocation signé' : 'Bail de colocation',
      nomFichier: bail.bailSigneLe ? 'Bail colocation signe.pdf' : 'Bail colocation.pdf',
      octets,
    });
    publies.push(locataire);
  }
  if (publies.length) notifier(`Bail déposé sur ${publies.length} espace(s) colocataire(s).`, 'succes');
  if (sansEmail.length) {
    notifier(`Sans adresse e-mail, donc sans espace : ${sansEmail.join(', ')} (à renseigner dans « Bien & baux »).`, 'erreur');
  }
  return publies;
}

async function notifierColocataires(donnees, bail, publies) {
  const bailleur = donnees.parametres.bailleurs?.[0];
  for (const locataire of publies) {
    // eslint-disable-next-line no-await-in-loop
    await api.envoyerCourriel({
      destinataires: destinatairesDe(locataire),
      sujet: 'Votre bail de colocation est disponible',
      html: `<p>Bonjour ${locataire.prenom || ''},</p>`
        + '<p>Votre bail de colocation est disponible sur votre espace, où vous pouvez le consulter et le télécharger :</p>'
        + `<p><a href="${window.location.origin}">${window.location.origin}</a></p>`
        + `<p>Bien cordialement,<br>${bailleur?.nom || ''}</p>`,
    });
  }
  if (publies.length) notifier(`Notification envoyée à ${publies.length} colocataire(s).`, 'succes');
}

/** Fenêtre « Bail & signatures » d'un bail. */
export function ouvrirBailSignatures(donnees, bailInitial) {
  // Toujours la version fraîche du magasin : le rendu de la page peut être
  // antérieur aux signatures et dépôts qui viennent d'être enregistrés.
  const frais = () => etat.trouver('baux', bailInitial.id) || bailInitial;
  const dessiner = () => {
    const bail = frais();
    const signatures = bail.signaturesBail || [];
    const parties = signatairesAttendus(donnees, bail);

    const lignes = parties.map((partie) => {
      const faite = signatures.find((s) => s.cle === partie.cle);
      return h('div', { style: 'display:flex;align-items:center;gap:.7rem;margin-bottom:.5rem;flex-wrap:wrap' }, [
        h('div', { style: 'flex:2;min-width:10rem' }, [
          h('div', { style: 'font-weight:600', texte: partie.nom }),
          h('div', { class: 'legende', texte: partie.role }),
        ]),
        faite ? badge(`Signé le ${date(faite.date)}`, 'succes') : badge('À signer', 'attente'),
        bouton(faite ? 'Signer à nouveau' : 'Signer', async () => {
          await signer(bail, partie);
          dessiner();
        }, { petit: true, type: faite ? 'discret' : 'primaire' }),
      ]);
    });

    const telecharger = async () => {
      const chemin = bail.bailSigneLe ? cheminSigne(bail) : cheminOriginal(bail);
      await executer(api.telechargerFichier('documents', chemin,
        bail.bailSigneLe ? 'Bail colocation signe.pdf' : (bail.documentBail?.nom || 'Bail.pdf')));
    };

    ouvrirModale({
      titre: 'Bail & signatures',
      large: true,
      corps: h('div', {}, [
        h('p', { class: 'legende', texte: bail.documentBail
          ? `Document joint : ${bail.documentBail.nom} (déposé le ${date(bail.documentBail.deposeLe)})`
            + (bail.bailSigneLe ? ` — exemplaire signé généré le ${date(bail.bailSigneLe)}.` : '.')
          : 'Aucun document joint : commencez par joindre le PDF du bail.' }),
        h('div', { class: 'groupe-boutons', style: 'margin-bottom:1rem;flex-wrap:wrap' }, [
          bouton(bail.documentBail ? 'Remplacer le PDF du bail…' : 'Joindre le PDF du bail…', async () => {
            if (await joindreBail(bail)) dessiner();
          }, { petit: true }),
          bail.documentBail ? bouton('Télécharger', telecharger, { petit: true }) : null,
        ]),
        h('h3', { texte: 'Signatures à l’écran', style: 'margin:.2rem 0 .6rem' }),
        h('p', { class: 'legende', texte: 'Chaque partie signe au doigt ou au stylet, idéalement sur place, sur la tablette. '
          + 'Les signatures sont ajoutées au PDF sur une page dédiée, datée.' }),
        ...lignes,
        h('p', { class: 'legende', style: 'margin-top:.8rem', texte:
          'Signature simple au sens du règlement eIDAS : suffisante entre parties de bonne foi (annexes, avenants, '
          + 'états des lieux). Pour une valeur probante renforcée du bail lui-même, un service de signature certifié '
          + 'reste préférable.' }),
      ]),
      pied: [
        bouton('Générer le bail signé', async () => {
          await executer(genererBailSigne(donnees, frais()));
          dessiner();
        }, {}),
        bouton('Déposer sur les espaces + notifier', async () => {
          const publies = await executer(publierAuxColocataires(donnees, frais()));
          if (publies && publies.length) await executer(notifierColocataires(donnees, frais(), publies));
        }, { type: 'primaire' }),
        bouton('Fermer', () => fermerModale(), { type: 'discret' }),
      ],
    });
  };
  dessiner();
}
