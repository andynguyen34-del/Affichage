// Paramètres : identité du bailleur, accès des colocataires à leur espace,
// sauvegarde et reprise des données.

import { ouvrirChangementMotDePasse } from '../compte.js';
import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier, journalErreurs } from '../ui.js';
import { date } from '../format.js';
import { VERSION_APP } from '../version.js';
import { reglageAppel, apercuAppels, envoyerTest, envoyerAppels, lireJournalAppels } from '../appel-loyer-client.js';
import { moisVise, jourEnvoi } from '../appel-loyer.js';
import { aujourdhui, nomMois, montant } from '../format.js';

const EXPLICATIONS_STOCKAGE = {
  'reseau/bloque': 'Le serveur de stockage ne répond pas depuis ce poste, alors que la base de données répond : le réseau '
    + '(pare-feu ou proxy d’entreprise) bloque firebasestorage.googleapis.com. Les photos et documents s’affichent depuis un '
    + 'autre réseau (tablette en 4G, connexion personnelle). Si ce poste doit absolument y accéder, demandez l’autorisation '
    + 'de ce domaine, ou signalez-le pour qu’un relais par l’adresse de l’application soit mis en place.',
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
  const joignable = await essayer('Serveur de stockage joignable depuis ce poste', () => api.sonderStockage());
  const ecrit = joignable && await essayer('Écriture d’un fichier de test', async () => { await api.deposerOctets('diagnostic', 'test-stockage.txt', contenu, 'text/plain'); });
  if (ecrit) {
    await essayer('Relecture du fichier', async () => {
      const lu = await api.lireOctets('diagnostic', 'test-stockage.txt');
      if (lu.length !== contenu.length) throw new Error(`taille lue ${lu.length} ≠ ${contenu.length}`);
      return `${lu.length} octets`;
    });
    // Exactement le chemin des photos d'état des lieux : une image JPEG
    // fabriquée sur place, déposée comme une photo, puis relue et affichée.
    await essayer('Dépôt puis affichage d’une image (comme une photo d’état des lieux)', async () => {
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
  if (!joignable) codes.unshift('reseau/bloque');
  zone.replaceChildren(
    h('ul', { style: 'margin:.3rem 0 .5rem;padding-left:1.2rem' }, etapes.map((e) => h('li', {}, [
      h('span', { texte: `${e.ok ? '✓' : '✗'} ${e.libelle}` }),
      e.detail ? h('span', { class: 'legende', texte: ` — ${e.detail}${e.code ? ` [${e.code}]` : ''}` }) : null,
    ]))),
    codes.length
      ? h('div', { class: 'alerte alerte-erreur', texte: EXPLICATIONS_STOCKAGE[codes[0]] || `Code d’erreur : ${codes[0]}.` })
      : h('div', { class: 'alerte alerte-info', texte: '✓ Le stockage fonctionne : les photos et documents peuvent être enregistrés et relus depuis ce compte.' }),
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

async function modifierAppelLoyer() {
  const actuel = reglageAppel();
  const saisie = await formulaire({
    titre: 'Appel de loyer automatique',
    large: true,
    aide: 'Chaque colocataire reçoit, au jour choisi, un e-mail avec le montant de sa part du mois, la date limite et vos coordonnées de paiement. '
      + 'Variables utilisables dans les textes : {prenom} {nom} {mois} {annee} {montant} {date} {logement}.',
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
  await executer(etat.enregistrerParametres({ appelLoyer: { ...actuel, ...saisie, jour } }), null);
  if (saisie.actif) {
    const ref = aujourdhui();
    const vise = moisVise(ref, saisie.cible);
    const d = new Date(`${ref}T12:00:00`);
    // Prochain envoi : le jour réglé, ce mois-ci s'il n'est pas passé (fenêtre de 7 jours), sinon le mois prochain.
    let prochain = new Date(d.getFullYear(), d.getMonth(), jourEnvoi({ jour }, d.getFullYear(), d.getMonth() + 1), 12);
    if (d.getDate() > prochain.getDate() + 7) prochain = new Date(d.getFullYear(), d.getMonth() + 1, jourEnvoi({ jour }, d.getFullYear(), d.getMonth() + 2), 12);
    notifier(`Appel de loyer activé : prochain envoi automatique le ${date(prochain.toISOString().slice(0, 10))} (loyer ${saisie.cible === 'suivant' ? 'du mois suivant' : 'du mois en cours'}).`, 'succes');
  } else notifier('Appel de loyer enregistré (envoi automatique désactivé).', 'succes');
}

async function testerAppelLoyer() {
  const saisie = await formulaire({
    titre: 'Envoyer un e-mail de test',
    aide: 'L’exemplaire préparé pour le premier colocataire concerné est envoyé à cette adresse, avec la mention [TEST].',
    champs: [{ cle: 'adresse', libelle: 'Adresse de réception', type: 'texte', requis: true, largeur: 'pleine' }],
    valeurs: { adresse: api.utilisateurEmail() || '' },
    libelleValider: 'Envoyer le test',
  });
  if (!saisie) return;
  const modele = await executer(envoyerTest(saisie.adresse.trim()), null);
  if (modele) notifier(`E-mail de test (exemplaire de ${modele.nom}) déposé pour ${saisie.adresse.trim()} — il part dès que l’extension d’envoi le prend en charge.`, 'succes');
}

async function envoyerAppelMaintenant(rafraichir = () => {}) {
  const vise = moisVise(aujourdhui(), reglageAppel().cible);
  const { courriels, ecartes } = apercuAppels(vise);
  const journal = await lireJournalAppels();
  const deja = journal.envois?.[`${vise.annee}-${String(vise.mois).padStart(2, '0')}`];
  const ok = await confirmer({
    titre: `${deja ? 'Renvoyer' : 'Envoyer'} l’appel de loyer de ${nomMois(vise.mois)} ${vise.annee}`,
    message: (deja ? `Cet appel a déjà été envoyé le ${date(deja.le?.slice(0, 10))} (${deja.origine || '?'}). Le renvoyer quand même ? ` : '')
      + (courriels.length
        ? `${courriels.length} e-mail(s) : ${courriels.map((c) => `${c.nom} — ${montant(c.montantDu)}`).join(' ; ')}.`
          + (ecartes.length ? ` Non concernés : ${ecartes.map((e) => `${e.nom} (${e.raison})`).join(', ')}.` : '')
        : `Aucun e-mail à envoyer (${ecartes.map((e) => `${e.nom} : ${e.raison}`).join(' ; ') || 'pas d’échéance ce mois-ci'}).`),
    libelleValider: deja ? 'Renvoyer quand même' : 'Envoyer maintenant',
    danger: Boolean(deja),
  });
  if (!ok || !courriels.length) return;
  const resultat = await executer(envoyerAppels({ ...vise, origine: deja ? 'manuel (renvoi)' : 'manuel', force: Boolean(deja) }), null);
  if (resultat) notifier(`${resultat.envoyes} appel(s) de loyer envoyé(s) pour ${nomMois(vise.mois)} ${vise.annee}.`, 'succes');
  rafraichir();
}

function carteAppelLoyer() {
  const reglage = reglageAppel();
  const vise = moisVise(aujourdhui(), reglage.cible);
  const zone = h('div');
  const { courriels, ecartes } = apercuAppels(vise);
  zone.append(
    h('table', {}, h('tbody', {}, [
      ['Envoi automatique', reglage.actif ? badge('Activé', 'succes') : badge('Désactivé', 'attente')],
      ['Jour d’envoi', `le ${jourEnvoi(reglage, vise.annee, vise.mois)} de chaque mois, pour le loyer ${reglage.cible === 'suivant' ? 'du mois suivant' : 'du mois en cours'}`],
      ['Prochain appel', `${nomMois(vise.mois)} ${vise.annee} — ${courriels.length} colocataire(s) : ${courriels.map((c) => `${c.nom} ${montant(c.montantDu)}`).join(', ') || 'aucun'}`
        + (ecartes.length ? ` (non concernés : ${ecartes.map((e) => `${e.nom}, ${e.raison}`).join(' ; ')})` : '')],
    ].map(([libelle, valeur]) => h('tr', {}, [h('td', { texte: libelle }), h('td', {}, valeur)])))),
    h('div', { class: 'journal-appels', style: 'margin-top:.6rem' }, h('p', { class: 'legende', texte: 'Historique : chargement…' })),
  );
  const chargerJournal = () => lireJournalAppels().then((journal) => {
    const envois = Object.entries(journal.envois || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
    const bloc = zone.querySelector('.journal-appels');
    bloc.replaceChildren(
      h('div', { style: 'font-weight:600;font-size:.9rem', texte: 'Historique des envois' }),
      envois.length
        ? h('ul', { style: 'margin:.3rem 0 0;padding-left:1.2rem;font-size:.9rem' }, envois.map(([cle, e]) => h('li', {
          texte: `${nomMois(Number(cle.slice(5, 7)))} ${cle.slice(0, 4)} — envoyé le ${date(e.le?.slice(0, 10))} (${e.origine || '?'}) à ${e.nombre} colocataire(s)`
            + (e.ecartes?.length ? ` ; non concernés : ${e.ecartes.map((x) => `${x.nom} (${x.raison})`).join(', ')}` : ''),
        })))
        : h('p', { class: 'legende', texte: 'Aucun appel envoyé pour l’instant.' }),
    );
  }).catch((erreur) => { zone.querySelector('.journal-appels').replaceChildren(h('p', { class: 'legende', texte: `Historique illisible : ${erreur.message}` })); });
  chargerJournal();
  return carte({
    titre: 'Appel de loyer automatique',
    aide: 'Un e-mail à chaque colocataire avec sa part du mois, la date limite et vos coordonnées de paiement. '
      + 'L’envoi part le jour réglé, par la fonction planifiée du serveur ou à la première ouverture de l’application ce jour-là.',
    actions: [
      bouton('Réglages', () => modifierAppelLoyer().catch(signalerErreur), { petit: true }),
      bouton('E-mail de test…', () => testerAppelLoyer().catch(signalerErreur), { petit: true }),
      bouton('Envoyer maintenant…', () => envoyerAppelMaintenant(chargerJournal).catch(signalerErreur), { petit: true, type: 'primaire' }),
    ],
    corps: zone,
  });
}

function carteStockage() {
  const zone = h('div', {}, h('p', { class: 'legende', texte:
    'Si des photos d’état des lieux ou des documents ne s’affichent pas, ce test dit en quelques secondes si le stockage '
    + 'accepte l’écriture et la lecture depuis ce compte, et pourquoi sinon.' }));
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
        : h('p', { class: 'legende', texte: 'Renseignez l’adresse e-mail des colocataires dans « Bien & baux » pour leur ouvrir un accès.' }),
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

export default {
  cle: 'parametres',
  libelle: 'Paramètres',
  icone: '⚙️',
  titre: 'Paramètres',
  sousTitre: 'Identité, accès des colocataires et sauvegarde.',
  rendre(contexte) {
    const donnees = contexte.donnees;
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
    if (api.MODE === 'nuage') conteneur.append(carteAppelLoyer());
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

    return conteneur;
  },
};
