// Paramètres : identité du bailleur, accès des colocataires à leur espace,
// sauvegarde et reprise des données.

import { ouvrirChangementMotDePasse } from '../compte.js';
import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier, journalErreurs } from '../ui.js';
import { date } from '../format.js';
import { VERSION_APP } from '../version.js';

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
