// Paramètres : identité du bailleur, accès des colocataires à leur espace,
// sauvegarde et reprise des données.

import { ouvrirChangementMotDePasse } from '../compte.js';
import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier, journalErreurs, ouvrirModale, fermerModale } from '../ui.js';
import { date } from '../format.js';
import { VERSION_APP } from '../version.js';
import { REGLAGES_PLEIN_ECRAN, reglagePleinEcran, definirReglagePleinEcran, estInstallee, pleinEcranPossible, enPleinEcran,
  basculerPleinEcran, installable, consigneInstallation, tactile } from '../plein-ecran.js';
import { ENTREES, adresseEntree, installerEntree, telechargerRaccourci } from '../installation.js';
import { reglageAppel, apercuAppels, envoyerTest, envoyerAppels, lireJournalAppels, logementsAvecAppel } from '../appel-loyer-client.js';
import { moisVise, jourEnvoi, dejaEnvoye } from '../appel-loyer.js';
import { DEPOT_PAR_DEFAUT, reglageDepotDe } from '../depot-garantie.js';
import { nomLogement } from '../logements.js';
import { aujourdhui, nomMois, montant } from '../format.js';
import { TYPES_COPIE, normaliserAdresses, ADRESSE_VALIDE, expediteurCoherent, decomposerExpediteur, formaterExpediteur } from '../courriel-enveloppe.js';

const EXPLICATIONS_STOCKAGE = {
  'reseau/relais': 'Le serveur de stockage ne répond pas directement depuis ce poste (réseau qui bloque '
    + 'firebasestorage.googleapis.com), mais le relais par l’adresse de l’application fonctionne : les photos et documents '
    + 'passent par lui automatiquement. Rien à faire.',
  'reseau/bloque': 'Le serveur de stockage ne répond pas depuis ce poste et le relais par l’adresse de l’application non plus : '
    + 'vérifiez que la fonction « fichiers » est déployée (firebase deploy), puis réessayez. En attendant, les photos et documents '
    + 's’affichent depuis un autre réseau (tablette en 4G, connexion personnelle).',
  'storage/retry-limit-exceeded': 'Le serveur de stockage n’a pas répondu à temps (20 s) : réseau lent, coupé, ou qui bloque '
    + 'firebasestorage.googleapis.com. Réessayez depuis un autre réseau (tablette en 4G, connexion personnelle).',
  'storage/unauthorized': 'Refusé par les règles de sécurité du stockage. Soit ce compte n’est pas reconnu comme gérant '
    + '(Paramètres → Accès), soit l’autorisation croisée Storage → Firestore n’a pas été accordée au déploiement : '
    + 'relancez « firebase deploy --only storage --project gestion-lmnp-anika » et répondez Y à la question « Grant the new role? ».',
  'storage/unauthenticated': 'Session expirée : déconnectez-vous puis reconnectez-vous.',
  'storage/quota-exceeded': 'Quota de stockage dépassé (plan Firebase).',
  'storage/unknown': 'Erreur inconnue côté stockage : réessayez ; si elle persiste, envoyez le code ci-dessus.',
};

/**
 * Test grandeur nature du stockage (écriture, relecture) : c'est ce que font
 * les photos d'état des lieux et les documents du portail. Le résultat, avec
 * le code d'erreur éventuel, dit exactement ce qui bloque.
 */
async function testerStockage(zone) {
  zone.replaceChildren(h('p', { class: 'legende', texte: 'Test en cours…' }));
  const etapes = [];
  const contenu = new TextEncoder().encode(`test ${new Date().toISOString()}`);
  const chemin = 'diagnostic/test-stockage.txt';
  const essayer = async (libelle, action) => {
    try {
      const resultat = await action();
      etapes.push({ libelle, ok: true, detail: resultat || '' });
      return true;
    } catch (erreur) {
      etapes.push({ libelle, ok: false, detail: `${erreur?.message || erreur}`, code: erreur?.code || '' });
      return false;
    }
  };
  const joignable = await essayer('Serveur de stockage joignable directement depuis ce poste', () => api.sonderStockage());
  const relaisOk = await essayer('Relais par l’adresse de l’application (/api/fichiers)', () => api.sonderRelais());
  const mode = api.modeFichiers();
  const via = mode === 'relais' ? ' (via le relais)' : ' (accès direct)';
  const ecrit = (joignable || relaisOk) && await essayer(`Écriture d’un fichier de test${via}`, async () => { await api.deposerOctets('diagnostic', 'test-stockage.txt', contenu, 'text/plain'); });
  if (ecrit) {
    await essayer(`Relecture du fichier${via}`, async () => {
      const lu = await api.lireOctets('diagnostic', 'test-stockage.txt');
      if (lu.length !== contenu.length) throw new Error(`taille lue ${lu.length} ≠ ${contenu.length}`);
      return `${lu.length} octets`;
    });
    // Exactement le chemin des photos d'état des lieux : une image JPEG
    // fabriquée sur place, déposée comme une photo, puis relue et affichée.
    await essayer(`Dépôt puis affichage d’une image, comme une photo d’état des lieux${via}`, async () => {
      const canevas = document.createElement('canvas');
      canevas.width = 64; canevas.height = 48;
      const ctx = canevas.getContext('2d');
      ctx.fillStyle = '#1d6f5c'; ctx.fillRect(0, 0, 64, 48);
      ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 48, 32);
      const image = await new Promise((resoudre) => { canevas.toBlob(resoudre, 'image/jpeg', 0.8); });
      if (!image) throw new Error('le navigateur n’a pas pu produire l’image JPEG');
      const depose = await api.deposerFichier('diagnostic', 'test-photo.jpg', image);
      const octets = await api.lireOctets('diagnostic', depose.chemin);
      const url = URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' }));
      await new Promise((resoudre, rejeter) => {
        const img = new Image();
        img.onload = () => resoudre();
        img.onerror = () => rejeter(new Error('image relue mais illisible'));
        img.src = url;
      });
      return `${octets.length} octets, image affichable (${depose.chemin})`;
    });
  }
  const codes = etapes.filter((e) => !e.ok).map((e) => e.code).filter(Boolean);
  if (!joignable && relaisOk) codes.unshift('reseau/relais');
  else if (!joignable) codes.unshift('reseau/bloque');
  zone.replaceChildren(
    h('ul', { style: 'margin:.3rem 0 .5rem;padding-left:1.2rem' }, etapes.map((e) => h('li', {}, [
      h('span', { texte: `${e.ok ? '✓' : '✗'} ${e.libelle}` }),
      e.detail ? h('span', { class: 'legende', texte: ` — ${e.detail}${e.code ? ` [${e.code}]` : ''}` }) : null,
    ]))),
    codes.length
      ? h('div', { class: codes[0] === 'reseau/relais' ? 'alerte alerte-info' : 'alerte alerte-erreur', texte: EXPLICATIONS_STOCKAGE[codes[0]] || `Code d’erreur : ${codes[0]}.` })
      : h('div', { class: 'alerte alerte-info', texte: `✓ Le stockage fonctionne${via} : les photos et documents peuvent être enregistrés et relus depuis ce compte.` }),
    h('p', { class: 'legende', style: 'margin-top:.4rem' }, [
      h('span', { texte: `Mode d’accès aux fichiers : ${api.modeFichiers() === 'relais' ? `relais par l’adresse de l’application (${api.raisonModeFichiers() || 'automatique'})` : 'direct'}. ` }),
      api.modeFichiers() === 'relais' ? bouton('Revenir à l’accès direct', () => { api.reinitialiserModeFichiers(); notifier('Accès direct rétabli pour ce navigateur ; le relais reprendra tout seul si le serveur de stockage reste injoignable.', 'succes'); testerStockage(zone).catch(signalerErreur); }, { petit: true }) : null,
    ]),
    h('p', { class: 'legende', style: 'margin-top:.5rem', texte: `Compte : ${api.utilisateurEmail() || '—'} · Espace de stockage : ${api.nomStockage() || '—'} · Fichier de test : ${chemin} · Navigateur : ${navigator.userAgent.replace(/\).*$/, ')')}` }),
    blocJournal(),
  );
}

/** Les dernières erreurs affichées à l'écran depuis l'ouverture de la page. */
function blocJournal() {
  const lignes = journalErreurs();
  return h('div', { style: 'margin-top:.6rem' }, [
    h('div', { style: 'font-weight:600;font-size:.9rem', texte: `Dernières erreurs signalées (${lignes.length})` }),
    lignes.length
      ? h('ul', { style: 'margin:.3rem 0 0;padding-left:1.2rem;font-size:.85rem' }, lignes.map((l) => h('li', { texte: `${l.quand} — ${l.message}` })))
      : h('p', { class: 'legende', texte: 'Aucune erreur depuis l’ouverture de l’application.' }),
  ]);
}

async function modifierAppelLoyer(bien) {
  const actuel = reglageAppel(bien);
  const saisie = await formulaire({
    titre: `Appel de loyer — ${bien.nom}`,
    large: true,
    aide: 'Chaque colocataire de ce logement reçoit, au jour choisi, un e-mail avec le montant de sa part du mois, la date limite et vos coordonnées de paiement. '
      + 'Réglages propres à ce logement. Variables utilisables dans les textes : {prenom} {nom} {mois} {annee} {montant} {date} {logement}.',
    champs: [
      { cle: 'actif', libelle: 'Envoi automatique activé', type: 'case' },
      { cle: 'jour', libelle: 'Jour du mois de l’envoi (1 à 28)', type: 'entier', min: 1, max: 28, requis: true },
      { cle: 'cible', libelle: 'Loyer appelé', type: 'liste', options: [
        { valeur: 'courant', libelle: 'celui du mois de l’envoi (ex. : le 1er octobre pour octobre)' },
        { valeur: 'suivant', libelle: 'celui du mois suivant (ex. : le 25 septembre pour octobre)' },
      ] },
      { cle: 'objet', libelle: 'Objet de l’e-mail', type: 'texte', largeur: 'pleine' },
      { cle: 'paiement', libelle: 'Coordonnées de paiement (IBAN, libellé du virement…)', type: 'zone' },
      { cle: 'message', libelle: 'Message complémentaire (facultatif)', type: 'zone' },
      { cle: 'copieBailleur', libelle: 'M’envoyer une copie récapitulative à chaque envoi', type: 'case' },
    ],
    valeurs: actuel,
  });
  if (!saisie) return;
  const jour = Math.min(28, Math.max(1, Number(saisie.jour) || 1));
  const { id: _id, majLe: _majLe, majPar: _majPar, ...reglage } = { ...actuel, ...saisie, jour };
  await executer(etat.enregistrer('biens', { id: bien.id, appelLoyer: reglage }), null);
  if (saisie.actif) {
    const ref = aujourdhui();
    const d = new Date(`${ref}T12:00:00`);
    // Prochain envoi : le jour réglé, ce mois-ci s'il n'est pas passé (fenêtre de 7 jours), sinon le mois prochain.
    let prochain = new Date(d.getFullYear(), d.getMonth(), jourEnvoi({ jour }, d.getFullYear(), d.getMonth() + 1), 12);
    if (d.getDate() > prochain.getDate() + 7) prochain = new Date(d.getFullYear(), d.getMonth() + 1, jourEnvoi({ jour }, d.getFullYear(), d.getMonth() + 2), 12);
    notifier(`Appel de loyer activé pour ${bien.nom} : prochain envoi automatique le ${date(prochain.toISOString().slice(0, 10))} (loyer ${saisie.cible === 'suivant' ? 'du mois suivant' : 'du mois en cours'}).`, 'succes');
  } else notifier(`Appel de loyer de ${bien.nom} enregistré (envoi automatique désactivé).`, 'succes');
}

async function testerAppelLoyer(bien) {
  const saisie = await formulaire({
    titre: `Envoyer un e-mail de test — ${bien.nom}`,
    aide: 'L’exemplaire préparé pour le premier colocataire concerné de ce logement est envoyé à cette adresse, avec la mention [TEST].',
    champs: [{ cle: 'adresse', libelle: 'Adresse de réception', type: 'texte', requis: true, largeur: 'pleine' }],
    valeurs: { adresse: api.utilisateurEmail() || '' },
    libelleValider: 'Envoyer le test',
  });
  if (!saisie) return;
  const modele = await executer(envoyerTest(saisie.adresse.trim(), { bienId: bien.id }), null);
  if (modele) notifier(`E-mail de test (exemplaire de ${modele.nom}) déposé pour ${saisie.adresse.trim()} — il part dans les secondes qui suivent par la fonction d’envoi (envoiMail).`, 'succes');
}

async function envoyerAppelMaintenant(bien, rafraichir = () => {}) {
  const vise = moisVise(aujourdhui(), reglageAppel(bien).cible);
  const { courriels, ecartes } = apercuAppels({ bienId: bien.id, ...vise });
  const journal = await lireJournalAppels();
  const deja = dejaEnvoye(journal, bien.id, vise.annee, vise.mois);
  const ok = await confirmer({
    titre: `${deja ? 'Renvoyer' : 'Envoyer'} l’appel de loyer de ${nomMois(vise.mois)} ${vise.annee} — ${bien.nom}`,
    message: (deja ? `Cet appel a déjà été envoyé le ${date(deja.le?.slice(0, 10))} (${deja.origine || '?'}). Le renvoyer quand même ? ` : '')
      + (courriels.length
        ? `${courriels.length} e-mail(s) : ${courriels.map((c) => `${c.nom} — ${montant(c.montantDu)}`).join(' ; ')}.`
          + (ecartes.length ? ` Non concernés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.` : '')
        : `Aucun e-mail à envoyer (${ecartes.map((e) => `${e.nom} : ${e.raison}`).join(' ; ') || 'pas d’échéance ce mois-ci'}).`),
    libelleValider: deja ? 'Renvoyer quand même' : 'Envoyer maintenant',
    danger: Boolean(deja),
  });
  if (!ok || !courriels.length) return;
  const resultat = await executer(envoyerAppels({ bienId: bien.id, ...vise, origine: deja ? 'manuel (renvoi)' : 'manuel', force: Boolean(deja) }), null);
  if (resultat) notifier(`${resultat.envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(vise.mois)} ${vise.annee} (${bien.nom}).`, 'succes');
  rafraichir();
}

/** Bloc d'un logement dans la carte « Appel de loyer » : état, prochain appel, boutons. */
function blocAppelLogement(bien, plusieurs, chargerJournal) {
  const reglage = reglageAppel(bien);
  const vise = moisVise(aujourdhui(), reglage.cible);
  const { courriels, ecartes } = apercuAppels({ bienId: bien.id, ...vise });
  return h('div', { class: 'appel-logement', 'data-bien': bien.id, style: plusieurs ? 'margin-bottom:1rem;padding-bottom:.6rem;border-bottom:1px solid var(--bordure)' : '' }, [
    plusieurs ? h('h3', { style: 'margin-bottom:.3rem', texte: bien.nom }) : null,
    h('table', {}, h('tbody', {}, [
      ['Envoi automatique', reglage.actif ? badge('Activé', 'succes') : badge('Désactivé', 'attente')],
      ['Jour d’envoi', `le ${jourEnvoi(reglage, vise.annee, vise.mois)} de chaque mois, pour le loyer ${reglage.cible === 'suivant' ? 'du mois suivant' : 'du mois en cours'}`],
      ['Prochain appel', `${nomMois(vise.mois)} ${vise.annee} — ${courriels.length} colocataire(s) : ${courriels.map((c) => `${c.nom} ${montant(c.montantDu)}`).join(', ') || 'aucun'}`
        + (ecartes.length ? ` (non concernés : ${ecartes.map((e) => `${e.nom}, ${e.raison}`).join(' ; ')})` : '')],
    ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', {}, valeur)])))),
    h('div', { class: 'groupe-boutons', style: 'margin-top:.5rem' }, [
      bouton('Réglages', () => modifierAppelLoyer(bien).catch(signalerErreur), { petit: true }),
      bouton('E-mail de test…', () => testerAppelLoyer(bien).catch(signalerErreur), { petit: true }),
      bouton('Envoyer maintenant…', () => envoyerAppelMaintenant(bien, chargerJournal).catch(signalerErreur), { petit: true, type: 'primaire' }),
    ]),
  ]);
}

function carteAppelLoyer(donnees) {
  const logements = logementsAvecAppel();
  const courteDuree = (donnees.biens || []).filter((b) => b.typeLocation === 'courte');
  const zone = h('div');
  const chargerJournal = () => lireJournalAppels().then((journal) => {
    const envois = Object.entries(journal.envois || {})
      .map(([cle, e]) => ({ ...e, cle, mois: cle.includes(':') ? cle.split(':')[1] : cle }))
      .sort((a, b) => b.mois.localeCompare(a.mois) || String(b.le).localeCompare(String(a.le))).slice(0, 12);
    const bloc = zone.querySelector('.journal-appels');
    bloc.replaceChildren(
      h('div', { style: 'font-weight:600;font-size:.9rem', texte: 'Historique des envois' }),
      envois.length
        ? h('ul', { style: 'margin:.3rem 0 0;padding-left:1.2rem;font-size:.9rem' }, envois.map((e) => h('li', {
          texte: `${nomMois(Number(e.mois.slice(5, 7)))} ${e.mois.slice(0, 4)}${e.logement || e.bienId ? ` — ${e.logement || nomLogement(donnees.biens, e.bienId)}` : (logements.length > 1 ? ' — tous les logements' : '')} — envoyé le ${date(e.le?.slice(0, 10))} (${e.origine || '?'}) à ${e.nombre} colocataire(s)`
            + (e.ecartes?.length ? ` ; non concernés : ${e.ecartes.map((x) => `${x.nom} (${x.raison})`).join(', ')}` : ''),
        })))
        : h('p', { class: 'legende', texte: 'Aucun appel envoyé pour l’instant.' }),
    );
  }).catch((erreur) => { zone.querySelector('.journal-appels').replaceChildren(h('p', { class: 'legende', texte: `Historique illisible : ${erreur.message}` })); });
  zone.append(
    ...(logements.length
      ? logements.map((bien) => blocAppelLogement(bien, logements.length > 1, chargerJournal))
      : [h('p', { class: 'legende', texte: 'Déclarez d’abord un logement (Logements & baux) : les réglages d’appel de loyer se font logement par logement.' })]),
    courteDuree.length ? h('p', { class: 'legende', texte: `Sans appel de loyer (courte durée) : ${courteDuree.map((b) => b.nom).join(', ')}.` }) : null,
    h('div', { class: 'journal-appels', style: 'margin-top:.6rem' }, h('p', { class: 'legende', texte: 'Historique : chargement…' })),
  );
  chargerJournal();
  return carte({
    titre: 'Appel de loyer automatique',
    aide: 'Un e-mail à chaque colocataire avec sa part du mois, la date limite et vos coordonnées de paiement — réglages propres à chaque logement (jour, IBAN, textes). '
      + 'L’envoi part le jour réglé, par la fonction planifiée du serveur ou à la première ouverture de l’application ce jour-là.',
    corps: zone,
  });
}

/**
 * Dépôt de garantie (v46) : le texte de l'appel de dépôt envoyé depuis la
 * page Cautions — distinct de l'appel de loyer. Réglage commun à tous les
 * logements ; sans coordonnées de paiement propres, celles de l'appel de
 * loyer du logement sont reprises (libellé de virement adapté).
 */
async function modifierDepotGarantie(parametres) {
  const actuel = reglageDepotDe(parametres);
  const saisie = await formulaire({
    titre: 'Appel de dépôt de garantie',
    large: true,
    aide: 'E-mail envoyé depuis la page Cautions (« Appeler le dépôt »), avant la remise des clés : montant convenu, date limite, coordonnées de paiement. '
      + 'Variables utilisables : {prenom} {nom} {montant} {convenu} {date} {dateLongue} {logement} {adresse} {entree}.',
    champs: [
      { cle: 'objet', libelle: 'Objet de l’e-mail', type: 'texte', largeur: 'pleine', requis: true },
      { cle: 'delaiJours', libelle: 'Date limite proposée : jours avant l’entrée dans les lieux (0 : le jour même)', type: 'entier', min: 0, max: 90 },
      { cle: 'paiement', libelle: 'Coordonnées de paiement (vide : celles de l’appel de loyer du logement, libellé « Dépôt de garantie … »)', type: 'zone' },
      { cle: 'message', libelle: 'Message complémentaire (facultatif)', type: 'zone' },
    ],
    valeurs: actuel,
  });
  if (!saisie) return;
  await executer(etat.enregistrerParametres({ depotGarantie: {
    objet: String(saisie.objet || '').trim() || DEPOT_PAR_DEFAUT.objet,
    delaiJours: Math.min(90, Math.max(0, Number(saisie.delaiJours) || 0)),
    paiement: String(saisie.paiement || ''),
    message: String(saisie.message || ''),
  } }), 'Appel de dépôt de garantie enregistré.');
}

function carteDepotGarantie(parametres) {
  const reglage = reglageDepotDe(parametres);
  return carte({
    titre: 'Dépôt de garantie',
    aide: 'L’appel de dépôt (e-mail) et le reçu de dépôt (PDF ANIKA publié sur l’espace du colocataire) se pilotent depuis la page Cautions, séparément de l’appel de loyer et de la quittance.',
    actions: [bouton('Modifier le texte de l’appel', () => modifierDepotGarantie(parametres).catch(signalerErreur), { petit: true })],
    corps: h('div', { class: 'reglage-depot' }, [
      h('table', {}, h('tbody', {}, [
        h('tr', {}, [h('th', { texte: 'Objet' }), h('td', { texte: reglage.objet })]),
        h('tr', {}, [h('th', { texte: 'Date limite proposée' }), h('td', { texte: reglage.delaiJours ? `${reglage.delaiJours} jour(s) avant l’entrée dans les lieux` : 'le jour de l’entrée dans les lieux (modifiable à chaque appel)' })]),
        h('tr', {}, [h('th', { texte: 'Paiement' }), h('td', { texte: String(reglage.paiement || '').trim() || 'coordonnées de l’appel de loyer du logement, libellé « Dépôt de garantie Prénom NOM »' })]),
        reglage.message ? h('tr', {}, [h('th', { texte: 'Message' }), h('td', { texte: reglage.message })]) : null,
      ])),
      h('p', { class: 'legende', style: 'margin-top:.4rem', texte: 'Copies de ces e-mails : carte des adresses d’envoi ci-dessous, type « Dépôts de garantie (appels, reçus) ».' }),
    ]),
  });
}

/** Affichage : plein écran au lancement (réglage par appareil) et installation sur l'écran d'accueil. */
function carteAffichage() {
  const zone = h('div');
  const dessiner = () => {
    const selecteur = h('select', {
      style: 'min-width:16rem',
      onchange: (e) => { definirReglagePleinEcran(e.target.value); notifier('Réglage du plein écran enregistré pour cet appareil.', 'succes'); dessiner(); },
    }, REGLAGES_PLEIN_ECRAN.map((o) => h('option', { value: o.valeur, selected: o.valeur === reglagePleinEcran() }, o.libelle)));
    const etatActuel = estInstallee()
      ? 'Application installée sur cet appareil : elle s’ouvre déjà sans barre de navigateur.'
      : pleinEcranPossible()
        ? `Sur cet appareil (${tactile() ? 'écran tactile' : 'ordinateur'}), le plein écran ${reglagePleinEcran() === 'jamais' ? 'ne se déclenche pas tout seul' : reglagePleinEcran() === 'toujours' || tactile() ? 'se déclenche au premier toucher ou clic après le lancement' : 'ne se déclenche pas tout seul (ordinateur en mode automatique)'} ; le bouton ⛶ en haut à droite le bascule à tout moment.`
        : 'Ce navigateur ne permet pas le plein écran par l’application : installez-la (carte « Icônes de lancement » ci-dessous) pour l’ouvrir sans barre de navigateur.';
    zone.replaceChildren(
      h('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem' }, [
        h('span', { style: 'min-width:12rem', texte: 'Plein écran au lancement' }), selecteur,
        pleinEcranPossible() && !estInstallee() ? bouton(enPleinEcran() ? 'Quitter le plein écran' : 'Plein écran maintenant', () => basculerPleinEcran().then(() => setTimeout(dessiner, 300)), { petit: true }) : null,
      ]),
      h('p', { class: 'legende', texte: etatActuel }),
    );
  };
  dessiner();
  document.addEventListener('lmnp-installable', dessiner);
  document.addEventListener('lmnp-installee', dessiner);
  document.addEventListener('fullscreenchange', dessiner);
  return carte({ titre: 'Affichage sur cet appareil', corps: zone });
}

/**
 * Icônes de lancement : une application par entrée (propriétaires,
 * colocataires), à installer sur ce PC ou cette tablette ; raccourci .url
 * en repli ; adresse à transmettre aux colocataires.
 */
function carteIcones() {
  const zone = h('div');
  const dessiner = () => {
    const entrees = Object.entries(ENTREES).map(([espace, entree]) => {
      const courante = espace === 'proprietaire';
      const actions = [];
      if (courante) {
        actions.push(estInstallee()
          ? badge('✓ Installée sur cet appareil', 'succes')
          : bouton('Installer sur cet ordinateur', async () => {
            const resultat = await installerEntree(espace);
            if (resultat === 'accepted') notifier('Installation lancée : l’icône « LMNP » apparaît sur le Bureau, dans la barre des tâches ou sur l’écran d’accueil.', 'succes');
            else if (resultat === 'consigne') notifier(consigneInstallation());
            setTimeout(dessiner, 500);
          }, { type: 'primaire', petit: true, titre: 'Chrome ou Edge ouvre sa fenêtre d’installation : cochez « Épingler à la barre des tâches » et « Créer un raccourci sur le Bureau »' }));
      } else {
        actions.push(bouton('Ouvrir l’entrée colocataires ↗', () => { window.open(adresseEntree(espace), '_blank', 'noopener'); }, { type: 'primaire', petit: true, titre: 'Nouvel onglet, sans vous déconnecter : le bouton « Installer » y installe l’icône bleue' }));
        actions.push(bouton('Copier l’adresse', async () => {
          try { await navigator.clipboard.writeText(adresseEntree(espace)); notifier('Adresse copiée : à transmettre aux colocataires.', 'succes'); }
          catch { notifier(`Adresse : ${adresseEntree(espace)}`); }
        }, { petit: true }));
      }
      actions.push(bouton('Télécharger le raccourci (.url)', () => telechargerRaccourci(espace), { petit: true, titre: 'Fichier à poser sur le Bureau : ouvre l’adresse dans le navigateur (icône du navigateur)' }));
      return h('div', { class: 'entree', 'data-entree': espace }, [
        h('img', { src: entree.icone, alt: `Icône ${entree.nomAppli}` }),
        h('div', {}, [
          h('div', { class: 'nom' }, [`${entree.nomAppli} — ${entree.libelle} `, badge(courante ? 'vous' : 'à leur donner', courante ? 'succes' : 'info')]),
          h('code', { texte: adresseEntree(espace) }),
          h('div', { class: 'legende', texte: entree.description }),
        ]),
        h('div', { class: 'groupe-boutons' }, actions),
      ]);
    });
    zone.replaceChildren(
      h('div', { class: 'entrees' }, entrees),
      h('ol', { style: 'margin:.7rem 0 0;padding-left:1.2rem;font-size:.84rem;display:grid;gap:.25rem' }, [
        h('li', { texte: '« Installer sur cet ordinateur » : Chrome ou Edge ouvre sa fenêtre d’installation ; cochez « Épingler à la barre des tâches » et « Créer un raccourci sur le Bureau ». Sur tablette : l’icône va sur l’écran d’accueil.' }),
        h('li', { texte: 'Pour la version colocataires depuis votre PC : « Ouvrir l’entrée colocataires » (nouvel onglet, sans vous déconnecter), puis « Installer l’icône » sur cette page : l’application installée porte l’icône bleue « Résidence ANIKA ». Les colocataires ont ce même bouton sous « Se connecter ».' }),
        h('li', { texte: 'Le raccourci .url est la solution de repli : un fichier à poser sur le Bureau, qui ouvre l’adresse dans le navigateur (icône du navigateur, pas la nôtre). Le navigateur peut demander de confirmer le téléchargement (« Conserver »).' }),
      ]),
      installable() || estInstallee() ? null : h('p', { class: 'legende', style: 'margin-top:.5rem', texte: `Si le bouton d’installation ne fait rien : ${consigneInstallation()}` }),
    );
  };
  dessiner();
  document.addEventListener('lmnp-installable', dessiner);
  document.addEventListener('lmnp-installee', dessiner);
  return carte({
    titre: 'Icônes de lancement',
    aide: 'Une application par entrée, avec son icône et son nom : maison verte « LMNP » pour les propriétaires, silhouettes bleues « Résidence ANIKA » pour les colocataires.',
    corps: zone,
  });
}

function carteStockage() {
  const zone = h('div', {}, h('p', { class: 'legende', texte:
    'Si des photos d’état des lieux ou des documents ne s’affichent pas, ce test dit en quelques secondes si le stockage '
    + 'accepte l’écriture et la lecture depuis ce compte, et pourquoi sinon. Sur un réseau qui bloque le serveur de stockage, '
    + `l’application passe d’elle-même par son relais. Mode actuel : ${api.modeFichiers() === 'relais' ? 'relais' : 'direct'}.` }));
  return carte({
    titre: 'Stockage des photos et documents',
    actions: [bouton('Tester le stockage', () => testerStockage(zone).catch(signalerErreur), { petit: true, type: 'primaire' })],
    corps: zone,
  });
}

async function modifierIdentite(parametres) {
  const saisie = await formulaire({
    titre: 'Identité',
    champs: [
      { cle: 'nomActivite', libelle: 'Nom de l’activité', type: 'texte', largeur: 'pleine', exemple: 'LMNP ANIKA' },
      { cle: 'lieuSignature', libelle: 'Lieu de signature des quittances', type: 'texte' },
    ],
    valeurs: parametres,
  });
  if (saisie) await executer(etat.enregistrerParametres(saisie), 'Paramètres enregistrés.');
}

async function modifierBailleur(parametres, index) {
  const bailleurs = [...(parametres.bailleurs || [])];
  const saisie = await formulaire({
    titre: index === null ? 'Ajouter un bailleur' : 'Modifier le bailleur',
    champs: [
      { cle: 'nom', libelle: 'Nom et prénom', type: 'texte', requis: true, largeur: 'pleine' },
      { cle: 'adresse', libelle: 'Adresse', type: 'zone' },
      { cle: 'telephone', libelle: 'Téléphone', type: 'texte' },
      { cle: 'email', libelle: 'Courriel', type: 'texte' },
      { cle: 'feminin', libelle: 'Accorder au féminin dans les quittances (« je soussignée »)', type: 'case' },
    ],
    valeurs: index === null ? {} : bailleurs[index],
  });
  if (!saisie) return;
  if (index === null) bailleurs.push(saisie); else bailleurs[index] = saisie;
  await executer(etat.enregistrerParametres({ bailleurs }), 'Bailleur enregistré.');
}

function exporterSauvegarde(donnees) {
  const contenu = JSON.stringify({
    exporteLe: new Date().toISOString(),
    application: 'Gestion LMNP',
    donnees,
  }, null, 2);
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  lien.download = `sauvegarde-location-${new Date().toISOString().slice(0, 10)}.json`;
  lien.click();
  URL.revokeObjectURL(lien.href);
  notifier('Sauvegarde téléchargée.', 'succes');
}

async function importerSauvegarde() {
  const fichier = await choisirFichier({ accept: '.json,application/json' });
  if (!fichier) return;
  let lu;
  try { lu = JSON.parse(await fichier.text()); }
  catch { signalerErreur(new Error('Ce fichier n’est pas une sauvegarde lisible.')); return; }
  const donnees = lu?.donnees && typeof lu.donnees === 'object' ? lu.donnees : lu;
  const noms = etat.COLLECTIONS.filter((nom) => donnees && typeof donnees[nom] === 'object' && donnees[nom] !== null);
  if (!noms.length) {
    signalerErreur(new Error('Aucune donnée reconnue dans ce fichier (attendu : une sauvegarde « Gestion LMNP »).'));
    return;
  }
  const confirme = await confirmer({
    titre: 'Importer la sauvegarde',
    message: `Ce fichier contient : ${noms.join(', ')}. Les données actuelles de ces collections `
      + 'seront remplacées par celles du fichier. Continuer ?',
    libelleValider: 'Importer', danger: true,
  });
  if (!confirme) return;
  await executer((async () => {
    for (const nom of noms) {
      // eslint-disable-next-line no-await-in-loop
      await etat.remplacerCollection(nom, donnees[nom]);
    }
  })(), `Sauvegarde importée (${noms.length} collection${noms.length > 1 ? 's' : ''}).`);
}

// ------------------------------------------------- accès des colocataires

function carteAcces(donnees) {
  const zone = h('div', { class: 'legende', texte: 'Chargement des accès…' });

  const rafraichir = async () => {
    let roles;
    try { roles = await api.lireRoles(); }
    catch (erreur) {
      zone.replaceChildren(h('div', { class: 'alerte alerte-erreur', texte: `Accès illisibles : ${erreur.message}` }));
      return;
    }
    const colocataires = donnees.locataires.filter((l) => l.email && l.nom !== 'Voyageurs Airbnb');
    const parEmail = roles.colocataires || {};

    const lignesGerants = (roles.admins || []).map((email) => h('div', {
      style: 'display:flex;align-items:center;gap:.7rem;padding:.3rem 0',
    }, [
      h('span', { style: 'flex:1', texte: email }),
      badge('gérant', 'succes'),
      bouton('✕', async () => {
        if ((roles.admins || []).length <= 1) { notifier('Impossible de retirer le dernier gérant.', 'erreur'); return; }
        const ok = await confirmer({ titre: 'Retirer ce gérant', message: `${email} n’aura plus accès à la gestion.`, libelleValider: 'Retirer', danger: true });
        if (!ok) return;
        await executer(api.ecrireRoles({ ...roles, admins: roles.admins.filter((a) => a !== email) }), 'Gérant retiré.');
        rafraichir();
      }, { petit: true, type: 'danger' }),
    ]));

    const lignesColocataires = colocataires.map((locataire) => {
      const email = String(locataire.email).trim().toLowerCase();
      const aAcces = parEmail[email] === locataire.id;
      return h('div', { style: 'display:flex;align-items:center;gap:.7rem;padding:.3rem 0;flex-wrap:wrap' }, [
        h('span', { style: 'flex:1;min-width:12rem' }, [
          h('strong', { texte: `${locataire.prenom || ''} ${locataire.nom}`.trim() }),
          h('span', { class: 'legende', texte: ` — ${email}` }),
        ]),
        aAcces ? badge('accès ouvert', 'succes') : badge('pas d’accès', 'attente'),
        bouton(aAcces ? 'Fermer l’accès' : 'Ouvrir l’accès', async () => {
          const nouveaux = { ...parEmail };
          if (aAcces) delete nouveaux[email];
          else nouveaux[email] = locataire.id;
          await executer((async () => {
            await api.ecrireRoles({ ...roles, colocataires: nouveaux });
            if (!aAcces) {
              // Prépare son espace (même vide) pour qu'il voie une page propre.
              const existant = await api.lirePortail(email);
              if (!existant) {
                await api.publierPortail(email, {
                  nom: `${locataire.prenom || ''} ${locataire.nom}`.trim(),
                  locataireId: locataire.id,
                  documents: [],
                });
              }
            }
          })(), aAcces ? 'Accès fermé.' : 'Accès ouvert.');
          rafraichir();
        }, { petit: true, type: aAcces ? 'danger' : 'primaire' }),
      ]);
    });

    zone.replaceChildren(
      h('h3', { style: 'margin:.2rem 0 .3rem', texte: 'Gérants' }),
      ...lignesGerants,
      h('div', { style: 'margin:.4rem 0 1rem' }, [
        bouton('+ Gérant', async () => {
          const saisie = await formulaire({
            titre: 'Ajouter un gérant',
            aide: 'Le compte doit aussi exister dans Firebase (console → Authentication → Users).',
            champs: [{ cle: 'email', libelle: 'Adresse e-mail', type: 'texte', requis: true }],
          });
          if (!saisie?.email) return;
          const email = saisie.email.trim().toLowerCase();
          await executer(api.ecrireRoles({ ...roles, admins: [...new Set([...(roles.admins || []), email])] }), 'Gérant ajouté.');
          rafraichir();
        }, { petit: true }),
      ]),
      h('h3', { style: 'margin:.2rem 0 .3rem', texte: 'Colocataires' }),
      colocataires.length ? h('div', {}, lignesColocataires)
        : h('p', { class: 'legende', texte: 'Renseignez l’adresse e-mail des colocataires dans « Logements & baux » pour leur ouvrir un accès.' }),
      h('p', { class: 'legende', style: 'margin-top:.8rem', texte:
        'Pour qu’un colocataire puisse se connecter, créez aussi son compte dans la console Firebase : '
        + 'Authentication → Users → Add user (même adresse, mot de passe provisoire quelconque). À sa première '
        + 'connexion, il clique sur « Première connexion ou mot de passe oublié ? » et choisit lui-même son '
        + 'mot de passe — vous n’avez rien à lui transmettre. Il ne verra que ses propres documents.' }),
      h('div', { style: 'margin-top:.6rem' },
        bouton('Changer mon mot de passe', () => ouvrirChangementMotDePasse(), { petit: true })),
    );
  };
  rafraichir();

  return carte({
    titre: 'Accès à l’application',
    aide: 'Les gérants voient tout ; chaque colocataire ne voit que son espace documents.',
    corps: zone,
  });
}



/**
 * Adresses e-mail (v44) : expéditeur affiché, adresse de réponse, copies par
 * type d'envoi. Lu par la fonction d'expédition à chaque courriel : ce qui est
 * enregistré ici s'applique au prochain envoi, sans redéploiement.
 */
let infosEnvoi = null; // { compte, expediteurParDefaut } lus une fois par session
async function lireInfosEnvoi() {
  if (infosEnvoi) return infosEnvoi;
  try { const e = await api.etatCourriels(); infosEnvoi = { compte: e.compte || '', expediteurParDefaut: e.expediteurParDefaut || '', local: Boolean(e.local) }; }
  catch { infosEnvoi = { compte: '', expediteurParDefaut: '', local: false }; }
  return infosEnvoi;
}

async function modifierAdresses(parametres) {
  const infos = await lireInfosEnvoi();
  const reglage = parametres.courriel || {};
  const bailleurs = (parametres.bailleurs || []).map((b) => ({ nom: b.nom || '', email: String(b.email || '').trim().toLowerCase() })).filter((b) => ADRESSE_VALIDE.test(b.email));
  const defaut = decomposerExpediteur(infos.expediteurParDefaut);
  const champNom = h('input', { type: 'text', value: reglage.expediteurNom || '', placeholder: defaut.nom || 'Nom affiché', 'data-champ': 'expediteurNom' });
  const champAdresse = h('input', { type: 'email', value: reglage.expediteurAdresse || '', placeholder: infos.compte || defaut.adresse || 'adresse@gmail.com', 'data-champ': 'expediteurAdresse' });
  const champReponse = h('input', { type: 'email', value: reglage.reponseA || '', placeholder: 'vide = l’adresse d’expéditeur', 'data-champ': 'reponseA' });
  const avert = h('div', { class: 'alerte alerte-attention', style: 'font-size:.85rem', hidden: true, texte: '' });
  const verifierAdresse = () => {
    const a = champAdresse.value.trim().toLowerCase();
    if (!a || !infos.compte) { avert.hidden = true; return; }
    avert.hidden = a === infos.compte;
    avert.textContent = `« ${a} » n’est pas le compte qui expédie (${infos.compte}). Gmail remplacera l’expéditeur, ou le destinataire refusera le message, sauf si cette adresse est déclarée dans Gmail sous « Envoyer en tant que ». Vérifiez avec un e-mail de test.`;
  };
  champAdresse.addEventListener('input', verifierAdresse);
  verifierAdresse();
  const lignesCopies = TYPES_COPIE.map((t) => {
    const actuelles = normaliserAdresses(reglage.copies?.[t.cle] || []);
    const cases = bailleurs.map((b) => {
      const c = h('input', { type: 'checkbox', checked: actuelles.includes(b.email) ? true : null, 'data-bailleur': b.email });
      return h('label', { class: 'copie-bailleur' }, [c, `${b.nom || 'Bailleur'} (${b.email})`]);
    });
    const libres = actuelles.filter((a) => !bailleurs.some((b) => b.email === a));
    const champLibre = h('input', { type: 'text', value: libres.join(', '), placeholder: 'autres adresses, séparées par des virgules', 'data-copies': t.cle, style: 'width:100%' });
    return { type: t, cases, champLibre, element: h('div', { class: 'copie-type' }, [h('strong', { texte: t.libelle }), h('div', { class: 'copie-choix' }, [...cases, champLibre])]) };
  });
  await new Promise((resoudre) => {
    ouvrirModale({
      titre: 'Adresses e-mail',
      large: true,
      corps: h('div', { class: 'grille-champs' }, [
        h('label', { class: 'champ' }, ['Nom de l’expéditeur', champNom]),
        h('label', { class: 'champ' }, ['Adresse d’expéditeur', champAdresse]),
        h('div', { class: 'pleine-largeur' }, [avert]),
        h('label', { class: 'champ' }, ['Adresse de réponse', champReponse]),
        h('div', { class: 'champ legende', texte: infos.compte ? `Compte qui expédie : ${infos.compte} (réglé au déploiement).` : '' }),
        h('div', { class: 'pleine-largeur' }, [
          h('div', { style: 'font-weight:600;margin:.4rem 0 .2rem', texte: 'Copies par type d’envoi' }),
          h('p', { class: 'legende', texte: 'En plus des destinataires. Les codes de signature ne sont jamais copiés.' }),
          ...lignesCopies.map((l) => l.element),
        ]),
      ]),
      pied: [
        h('button', { class: 'bouton', type: 'button', onclick: () => { fermerModale(); resoudre(); } }, 'Annuler'),
        h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: async () => {
          const adresse = champAdresse.value.trim().toLowerCase();
          const reponse = champReponse.value.trim().toLowerCase();
          if (adresse && !ADRESSE_VALIDE.test(adresse)) { notifier('Adresse d’expéditeur invalide.', 'erreur'); return; }
          if (reponse && !ADRESSE_VALIDE.test(reponse)) { notifier('Adresse de réponse invalide.', 'erreur'); return; }
          const copies = {};
          for (const l of lignesCopies) {
            copies[l.type.cle] = normaliserAdresses([
              ...l.cases.filter((c) => c.querySelector('input').checked).map((c) => c.querySelector('input').dataset.bailleur),
              ...String(l.champLibre.value || '').split(/[,;\s]+/),
            ]);
          }
          fermerModale();
          await executer(etat.enregistrerParametres({ courriel: { expediteurNom: champNom.value.trim(), expediteurAdresse: adresse, reponseA: reponse, copies } }), 'Adresses e-mail enregistrées : elles s’appliquent au prochain envoi.');
          resoudre();
        } }, 'Enregistrer'),
      ],
      surFermeture: () => resoudre(),
    });
  });
}

function carteAdresses(parametres) {
  const reglage = parametres.courriel || {};
  const zone = h('div', { class: 'adresses-email' });
  const bailleurs = parametres.bailleurs || [];
  const nomBailleur = (a) => bailleurs.find((b) => String(b.email || '').trim().toLowerCase() === a)?.nom;
  const dessiner = (infos) => {
    const defaut = decomposerExpediteur(infos?.expediteurParDefaut || '');
    const nom = reglage.expediteurNom || defaut.nom || '—';
    const adresse = reglage.expediteurAdresse || defaut.adresse || (infos?.compte || '—');
    const coherent = expediteurCoherent(reglage, infos?.compte);
    zone.replaceChildren(
      h('table', {}, h('tbody', {}, [
        h('tr', {}, [h('td', { texte: 'Expéditeur affiché' }), h('td', {}, [
          h('strong', { texte: formaterExpediteur(nom, adresse) }), ' ',
          coherent === true ? badge('= compte d’envoi', 'succes') : (coherent === false ? badge('différent du compte d’envoi', 'attention') : (infos?.compte ? badge('expéditeur du déploiement', 'attente') : null)),
        ])]),
        h('tr', {}, [h('td', { texte: 'Adresse de réponse' }), h('td', { texte: reglage.reponseA || 'l’adresse d’expéditeur' })]),
        h('tr', {}, [h('td', { texte: 'Compte qui expédie' }), h('td', { class: 'legende', texte: infos?.compte ? `${infos.compte} — réglé au déploiement (mot de passe d’application dans le projet)` : (infos?.local ? 'Sans objet en mode dossier.' : 'inconnu (relais injoignable)') })]),
      ])),
      h('div', { style: 'font-weight:600;margin:.6rem 0 .3rem', texte: 'Copies par type d’envoi' }),
      h('table', {}, h('tbody', {}, TYPES_COPIE.map((t) => {
        const adresses = normaliserAdresses(reglage.copies?.[t.cle] || []);
        return h('tr', {}, [h('td', { texte: t.libelle }), h('td', { class: 'puces-adresses' }, adresses.length
          ? adresses.map((a) => h('span', { class: 'puce-adresse', texte: nomBailleur(a) ? `${nomBailleur(a)} (${a})` : a }))
          : [h('span', { class: 'legende', texte: 'aucune copie' })])]);
      }))),
    );
  };
  dessiner(null);
  lireInfosEnvoi().then(dessiner);
  return carte({
    titre: 'Adresses e-mail',
    aide: 'Qui apparaît comme expéditeur, où arrivent les réponses, qui reçoit une copie de chaque type d’envoi. Appliqué au prochain envoi, sans redéploiement.',
    actions: [bouton('Modifier', () => modifierAdresses(parametres).catch(signalerErreur), { petit: true })],
    corps: zone,
  });
}

/**
 * Envoi des e-mails (v42) : la file « mail » et l'état de chaque envoi
 * (fonction expedierCourriel), relance de ce qui est en attente, e-mail de test.
 */
function carteCourriels(parametres) {
  const zone = h('div', { class: 'courriels-etat' });
  const LIBELLES = {
    SUCCESS: ['Envoyé', 'succes'], ERROR: ['Échec', 'alerte'], PROCESSING: ['En cours', 'attente'], PENDING: ['En attente', 'attention'],
  };
  const charger = async () => {
    zone.replaceChildren(h('p', { class: 'legende', texte: 'Lecture de la file…' }));
    let etatFile;
    try { etatFile = await api.etatCourriels(); } catch (erreur) { zone.replaceChildren(h('p', { class: 'legende', style: 'color:var(--alerte)', texte: `File inaccessible : ${erreur.message}` })); return; }
    if (etatFile.local) { zone.replaceChildren(h('p', { class: 'legende', texte: 'En mode dossier, les e-mails ne partent pas : cette carte ne concerne que la version en ligne.' })); return; }
    const lignes = etatFile.courriels || [];
    zone.replaceChildren(
      h('p', { class: 'legende', texte: `${etatFile.total} courriel(s) dans la file · ${etatFile.enAttente} en attente ou en échec${etatFile.emulateur ? ' · émulateur : rien n’est réellement expédié' : ''}.` }),
      tableau({
        colonnes: [
          { titre: 'Quand', valeur: (c) => (c.le ? new Date(c.le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—') },
          { titre: 'Destinataires', valeur: (c) => c.to.join(', ') || '—' },
          { titre: 'Objet', valeur: (c) => c.sujet || '(sans objet)' },
          { titre: 'État · expéditeur', valeur: (c) => {
            const [libelle, ton] = LIBELLES[c.etat] || LIBELLES.PENDING;
            const par = c.par ? `${c.expediteur ? `${c.expediteur} · ` : ''}${c.par}` : (c.etat === 'SUCCESS' ? 'ancienne fonction envoiMail' : '');
            return h('div', {}, [badge(libelle, ton), par ? h('div', { class: 'legende', texte: par }) : null, c.erreur ? h('div', { class: 'legende', style: 'color:var(--alerte);max-width:22rem', texte: c.erreur }) : null, c.tentatives > 1 ? h('div', { class: 'legende', texte: `${c.tentatives} essais` }) : null]);
          } },
        ],
        lignes,
        messageVide: 'Aucun courriel dans la file pour l’instant.',
        cle: (c) => c.id,
      }),
    );
  };
  charger();
  const adresseTest = () => String(parametres.bailleurs?.[0]?.email || api.utilisateurEmail() || '').trim();
  return carte({
    titre: 'Envoi des e-mails',
    aide: 'Chaque e-mail de l’application (quittances, rappels, appels de loyer, codes de signature) est déposé dans la file « mail » puis expédié par la fonction du projet, par Gmail. L’état de chaque envoi est inscrit ici.',
    actions: [
      bouton('Rafraîchir', () => charger(), { petit: true }),
      bouton('Relancer les envois en attente', async () => {
        const resultat = await api.relancerCourriels();
        notifier(resultat.candidats ? `${resultat.envoyes} envoyé(s) sur ${resultat.candidats}${resultat.echecs?.length ? ` — échecs : ${resultat.echecs.join(' ; ')}` : ''}.` : 'Rien en attente.', resultat.echecs?.length ? 'erreur' : 'succes');
        charger();
      }, { petit: true, titre: 'Renvoie les courriels jamais partis ou en échec (3 essais au plus)' }),
      bouton('E-mail de test', async () => {
        const reponse = await formulaire({
          titre: 'E-mail de test', aide: 'Un e-mail est déposé dans la file et expédié aussitôt : vérifiez sa réception (et les indésirables).',
          champs: [{ cle: 'to', libelle: 'Adresse', type: 'texte', requis: true }],
          valeurs: { to: adresseTest() },
          libelleValider: 'Envoyer',
        });
        if (!reponse?.to) return;
        const resultat = await api.testerCourriel(reponse.to);
        notifier(resultat.ok ? `E-mail de test expédié à ${resultat.to}.` : `Échec de l’envoi : ${resultat.delivery?.error || 'voir la file'}.`, resultat.ok ? 'succes' : 'erreur');
        charger();
      }, { petit: true, type: 'primaire' }),
    ],
    corps: zone,
  });
}

export default {
  cle: 'parametres',
  libelle: 'Paramètres',
  icone: '⚙️',
  titre: 'Paramètres',
  sousTitre: 'Identité, accès des colocataires et sauvegarde.',
  rendre(contexte) {
    // Les paramètres, accès et sauvegardes portent sur tout le dossier, quel
    // que soit le logement choisi dans l'en-tête.
    const donnees = contexte.tout || contexte.donnees;
    const parametres = donnees.parametres;
    const conteneur = h('div');
    const infos = etat.infosServeur() || {};

    conteneur.append(carte({
      titre: 'Identité',
      actions: [bouton('Modifier', () => modifierIdentite(parametres), { petit: true })],
      corps: h('table', {}, h('tbody', {}, [
        ['Nom de l’activité', parametres.nomActivite || '—'],
        ['Lieu de signature', parametres.lieuSignature || '—'],
        ['Connecté en tant que', infos.dossier || '—'],
        ['Version de l’application', `v${VERSION_APP}`],
        ['Version du format des données', infos.version || '—'],
      ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', { texte: valeur })])))),
    }));

    conteneur.append(carte({
      titre: 'Bailleurs',
      aide: 'Le premier bailleur signe les quittances.',
      actions: [bouton('+ Bailleur', () => modifierBailleur(parametres, null), { petit: true })],
      serre: true,
      corps: tableau({
        colonnes: [
          { titre: 'Nom', valeur: (b) => b.nom },
          { titre: 'Adresse', valeur: (b) => (b.adresse || '—').replace(/\n/g, ', ') },
          { titre: 'Contact', valeur: (b) => [b.telephone, b.email].filter(Boolean).join(' · ') || '—' },
          { titre: '', actions: true, valeur: (b, index) => h('div', { class: 'groupe-boutons' }, [
            bouton('Modifier', () => modifierBailleur(parametres, index), { petit: true }),
            bouton('✕', async () => {
              const confirme = await confirmer({
                titre: 'Supprimer le bailleur', message: `Supprimer ${b.nom} ?`,
                libelleValider: 'Supprimer', danger: true,
              });
              if (!confirme) return;
              const bailleurs = (parametres.bailleurs || []).filter((_, i) => i !== index);
              await executer(etat.enregistrerParametres({ bailleurs }), 'Bailleur supprimé.');
            }, { petit: true, type: 'danger' }),
          ]) },
        ],
        lignes: parametres.bailleurs || [],
        messageVide: 'Aucun bailleur enregistré — les quittances ne pourront pas être éditées.',
      }),
    }));

    if (api.MODE === 'nuage') conteneur.append(carteAcces(donnees));
    conteneur.append(carteAffichage());
    if (api.MODE === 'nuage') conteneur.append(carteIcones());
    if (api.MODE === 'nuage') conteneur.append(carteAppelLoyer(donnees));
    if (api.MODE === 'nuage') conteneur.append(carteDepotGarantie(parametres));
    if (api.MODE === 'nuage') conteneur.append(carteStockage());

    conteneur.append(carte({
      titre: 'Sauvegarde',
      corps: h('div', {}, [
        h('p', { class: 'legende', texte:
          'Une copie de chaque collection est conservée automatiquement à la première modification de chaque journée. '
          + 'Vous pouvez aussi télécharger une sauvegarde complète, et la réimporter au besoin.' }),
        barreOutils([
          bouton('Télécharger une sauvegarde complète', () => exporterSauvegarde(donnees), { type: 'primaire' }),
          bouton('Importer une sauvegarde…', () => importerSauvegarde()),
        ]),
      ]),
    }));

    conteneur.append(carteAdresses(parametres));
    conteneur.append(carteCourriels(parametres));

    return conteneur;
  },
};
