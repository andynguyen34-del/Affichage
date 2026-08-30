// Paramètres : identité du bailleur, accès des colocataires à leur espace,
// sauvegarde et reprise des données.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, carte, tableau, bouton, badge, formulaire, confirmer, executer,
  barreOutils, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { date } from '../format.js';

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
        'Pour qu’un colocataire puisse se connecter, créez aussi son compte (même adresse + mot de passe) dans la '
        + 'console Firebase : Authentication → Users → Add user. Il ne verra que ses propres documents.' }),
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
        ['Version de l’application', infos.version || '—'],
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
