// Explorateur des pièces rangées dans le dossier partagé.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, vider, carte, tableau, tuile, bouton, badge, vide, confirmer, barreOutils,
  champRecherche, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { montant, date, taille } from '../format.js';

let filtre = '';

async function deposer(espace, sousDossier) {
  const fichiers = await choisirFichier({ multiple: true });
  if (!fichiers?.length) return;
  try {
    for (const fichier of fichiers) {
      /* eslint-disable no-await-in-loop */
      await api.deposerFichier(espace, sousDossier ? `${sousDossier}/${fichier.name}` : fichier.name, fichier);
    }
    await etat.rechargerFichiers({ notifier: true });
    notifier(`${fichiers.length} fichier(s) déposé(s).`, 'succes');
  } catch (erreur) { signalerErreur(erreur); }
}

export default {
  cle: 'documents',
  libelle: 'Documents',
  icone: '📁',
  titre: 'Documents',
  sousTitre: 'Baux, états des lieux, diagnostics, courriers et justificatifs rangés dans le dossier partagé.',
  rendre(contexte) {
    const donnees = contexte.donnees;
    const conteneur = h('div');
    const zoneTableau = h('div');
    const annee = contexte.annee;

    const listeDocuments = etat.fichiers('documents');
    const listeFactures = etat.fichiers('factures');
    const rattachements = new Map();
    for (const charge of donnees.charges) {
      if (charge.documentChemin) {
        rattachements.set(`${charge.documentEspace || 'documents'}::${charge.documentChemin}`, charge);
      }
    }

    const tous = [...listeDocuments, ...listeFactures];
    const volume = tous.reduce((s, f) => s + (f.taille || 0), 0);

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Documents', valeur: String(listeDocuments.length) }),
      tuile({ libelle: 'Factures', valeur: String(listeFactures.length) }),
      tuile({ libelle: 'Rattachés à une dépense', valeur: String(rattachements.size) }),
      tuile({ libelle: 'Volume total', valeur: taille(volume) }),
    ]));

    conteneur.append(barreOutils([
      bouton('Déposer un document', () => deposer('documents', String(annee)), { type: 'primaire' }),
      champRecherche('Rechercher un fichier…', (valeur) => {
        filtre = valeur;
        vider(zoneTableau);
        zoneTableau.append(dessinerTableau());
      }, filtre),
    ]));

    const colonnes = [
      { titre: 'Fichier', valeur: (f) => h('div', {}, [
        h('a', { class: 'lien-doc', href: api.urlFichier(f.espace, f.chemin), target: '_blank' }, f.nom),
        h('div', { class: 'legende', texte: f.chemin.includes('/') ? f.chemin.slice(0, f.chemin.lastIndexOf('/')) : 'racine' }),
      ]) },
      { titre: 'Espace', valeur: (f) => badge(f.espace === 'factures' ? 'Factures' : 'Documents',
        f.espace === 'factures' ? 'info' : 'attente') },
      { titre: 'Taille', nombre: true, valeur: (f) => taille(f.taille) },
      { titre: 'Déposé le', valeur: (f) => date(f.modifie) },
      { titre: 'Rattaché à', valeur: (f) => {
        const charge = rattachements.get(`${f.espace}::${f.chemin}`);
        return charge ? h('div', {}, [
          h('div', { texte: charge.libelle }),
          h('div', { class: 'legende', texte: `${date(charge.date)} — ${montant(charge.montant)}` }),
        ]) : h('span', { class: 'legende', texte: '—' });
      } },
      { titre: '', actions: true, valeur: (f) => bouton('✕', async () => {
        const charge = rattachements.get(`${f.espace}::${f.chemin}`);
        const confirme = await confirmer({
          titre: 'Supprimer le fichier',
          message: charge
            ? `« ${f.nom} » est le justificatif de « ${charge.libelle} ». Il sera déplacé dans le dossier Corbeille et la dépense n’aura plus de pièce jointe.`
            : `« ${f.nom} » sera déplacé dans le dossier Corbeille du dossier partagé.`,
          libelleValider: 'Supprimer', danger: true,
        });
        if (!confirme) return;
        try {
          await api.supprimerFichier(f.espace, f.chemin);
          if (charge) await etat.enregistrer('charges', { ...charge, documentChemin: '', documentEspace: '' });
          await etat.rechargerFichiers({ notifier: true });
          notifier('Fichier déplacé dans la corbeille.');
        } catch (erreur) { signalerErreur(erreur); }
      }, { petit: true, type: 'danger' }) },
    ];

    function dessinerTableau() {
      const lignes = tous
        .filter((f) => !filtre || `${f.nom} ${f.chemin}`.toLowerCase().includes(filtre))
        .sort((a, b) => String(b.modifie).localeCompare(String(a.modifie)));
      return lignes.length
        ? tableau({ colonnes, lignes, cle: (f) => `${f.espace}::${f.chemin}`, messageVide: '' })
        : vide('Aucun fichier', 'Déposez ici les baux, états des lieux, diagnostics et attestations d’assurance.');
    }

    zoneTableau.append(dessinerTableau());
    conteneur.append(carte({
      titre: 'Tous les fichiers',
      aide: 'Vous pouvez aussi déposer directement les fichiers dans les dossiers « Documents » et « Factures » '
        + 'depuis l’explorateur Windows : ils apparaîtront ici.',
      serre: true,
      corps: zoneTableau,
    }));

    return conteneur;
  },
};
