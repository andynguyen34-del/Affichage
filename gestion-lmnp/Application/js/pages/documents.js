// Explorateur des documents de la location : baux, états des lieux,
// diagnostics, courriers.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, vider, carte, tableau, tuile, bouton, vide, confirmer, barreOutils,
  champRecherche, notifier, signalerErreur, choisirFichier } from '../ui.js';
import { date, taille } from '../format.js';

let filtre = '';

async function deposer(sousDossier) {
  const fichiers = await choisirFichier({ multiple: true });
  if (!fichiers?.length) return;
  try {
    for (const fichier of fichiers) {
      /* eslint-disable no-await-in-loop */
      await api.deposerFichier('documents', sousDossier ? `${sousDossier}/${fichier.name}` : fichier.name, fichier);
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
  sousTitre: 'Baux, états des lieux, diagnostics et courriers de la location.',
  rendre(contexte) {
    const conteneur = h('div');
    const zoneTableau = h('div');
    const annee = contexte.annee;

    const listeDocuments = etat.fichiers('documents');
    const volume = listeDocuments.reduce((s, f) => s + (f.taille || 0), 0);

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Documents', valeur: String(listeDocuments.length) }),
      tuile({ libelle: 'Volume total', valeur: taille(volume) }),
    ]));

    conteneur.append(barreOutils([
      bouton('Déposer un document', () => deposer(String(annee)), { type: 'primaire' }),
      champRecherche('Rechercher un fichier…', (valeur) => {
        filtre = valeur;
        vider(zoneTableau);
        zoneTableau.append(dessinerTableau());
      }, filtre),
    ]));

    const colonnes = [
      { titre: 'Fichier', valeur: (f) => h('div', {}, [
        h('a', { class: 'lien-doc', href: '#', onclick: (ev) => { ev.preventDefault(); api.ouvrirFichier(f.espace, f.chemin).catch(signalerErreur); } }, f.nom),
        h('div', { class: 'legende', texte: f.chemin.includes('/') ? f.chemin.slice(0, f.chemin.lastIndexOf('/')) : 'racine' }),
      ]) },
      { titre: 'Taille', nombre: true, valeur: (f) => taille(f.taille) },
      { titre: 'Déposé le', valeur: (f) => date(f.modifie) },
      { titre: '', actions: true, valeur: (f) => h('div', { class: 'groupe-boutons' }, [
        bouton('Télécharger', () => api.telechargerFichier(f.espace, f.chemin, f.nom).catch(signalerErreur), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer le fichier',
            message: `« ${f.nom} » sera déplacé dans la corbeille.`,
            libelleValider: 'Supprimer', danger: true,
          });
          if (!confirme) return;
          try {
            await api.supprimerFichier(f.espace, f.chemin);
            await etat.rechargerFichiers({ notifier: true });
            notifier('Fichier déplacé dans la corbeille.');
          } catch (erreur) { signalerErreur(erreur); }
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    function dessinerTableau() {
      const lignes = listeDocuments
        .filter((f) => !filtre || `${f.nom} ${f.chemin}`.toLowerCase().includes(filtre))
        .sort((a, b) => String(b.modifie).localeCompare(String(a.modifie)));
      return lignes.length
        ? tableau({ colonnes, lignes, cle: (f) => `${f.espace}::${f.chemin}`, messageVide: '' })
        : vide('Aucun fichier', 'Déposez ici les baux, diagnostics et courriers. Les rapports d’état des lieux s’y rangent automatiquement.');
    }

    zoneTableau.append(dessinerTableau());
    conteneur.append(carte({
      titre: 'Tous les fichiers',
      serre: true,
      corps: zoneTableau,
    }));

    return conteneur;
  },
};
