// Dépenses déductibles et justificatifs.

import * as etat from '../etat.js';
import * as api from '../api.js';
import { h, vider, carte, tableau, tuile, bouton, badge, vide, formulaire, confirmer, executer,
  barreOutils, champRecherche, notifier, choisirFichier, signalerErreur } from '../ui.js';
import { montant, date, anneeDe, centimes, aujourdhui } from '../format.js';
import { chargesAnnee } from '../calculs/fiscal.js';

let filtreTexte = '';
let filtreCategorie = '';

function champsCharge(donnees) {
  return [
    { cle: 'date', libelle: 'Date de la dépense', type: 'date', requis: true },
    { cle: 'dateReglement', libelle: 'Date de règlement', type: 'date', aide: 'Retenue si vous êtes en comptabilité de trésorerie.' },
    { cle: 'categorie', libelle: 'Catégorie', type: 'liste', requis: true,
      options: etat.CATEGORIES_CHARGES.map((c) => ({ valeur: c.code, libelle: c.libelle })) },
    { cle: 'montant', libelle: 'Montant TTC (€)', type: 'montant', requis: true },
    { cle: 'libelle', libelle: 'Libellé', type: 'texte', requis: true, largeur: 'pleine', exemple: 'Taxe foncière 2026' },
    { cle: 'fournisseur', libelle: 'Fournisseur', type: 'texte' },
    { cle: 'bienId', libelle: 'Logement', type: 'liste',
      options: [{ valeur: '', libelle: '—' }, ...donnees.biens.map((b) => ({ valeur: b.id, libelle: b.nom }))] },
    { cle: 'deductible', libelle: 'Charge déductible du résultat', type: 'case', rafraichit: true },
    { cle: 'tauxDeduction', libelle: 'Part déductible (%)', type: 'nombre', min: 0, max: 100,
      aide: 'Mettez moins de 100 % si la dépense est partiellement affectée à la location.',
      quand: (v) => v.deductible !== false },
    { cle: 'immobilise', libelle: 'Dépense à immobiliser et amortir (pas de déduction immédiate)', type: 'case', rafraichit: true },
    { cle: 'notes', libelle: 'Notes', type: 'zone' },
  ];
}

async function ouvrirCharge(donnees, chargeExistante, anneeParDefaut) {
  const valeurs = chargeExistante || {
    date: `${anneeParDefaut}-01-01`,
    deductible: true,
    tauxDeduction: 100,
    immobilise: false,
    bienId: donnees.biens[0]?.id || '',
    categorie: 'entretien',
  };
  const saisie = await formulaire({
    titre: chargeExistante ? 'Modifier la dépense' : 'Nouvelle dépense',
    champs: champsCharge(donnees),
    valeurs,
    large: true,
  });
  if (!saisie) return;
  if (saisie.immobilise) {
    notifier('Dépense enregistrée comme immobilisation : créez le composant correspondant dans « Amortissements ».');
  }
  await executer(etat.enregistrer('charges', saisie), 'Dépense enregistrée.');
}

async function joindreJustificatif(charge) {
  const fichier = await choisirFichier({ accept: '.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv' });
  if (!fichier) return;
  try {
    const annee = anneeDe(charge.date) || new Date().getFullYear();
    const depose = await api.deposerFichier('documents', `${annee}/${fichier.name}`, fichier);
    await etat.enregistrer('charges', { ...charge, documentEspace: 'documents', documentChemin: depose.chemin });
    await etat.rechargerFichiers({ notifier: true });
    notifier('Justificatif rattaché.', 'succes');
  } catch (erreur) { signalerErreur(erreur); }
}

export default {
  cle: 'charges',
  libelle: 'Charges',
  icone: '🧾',
  titre: 'Charges et justificatifs',
  sousTitre: (contexte) => `Dépenses de l’exercice ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const methode = donnees.parametres.methodeComptable === 'engagement' ? 'engagement' : 'encaissement';
    const conteneur = h('div');

    const deLAnnee = donnees.charges.filter((charge) => {
      const reference = methode === 'engagement' ? (charge.date || charge.dateReglement) : (charge.dateReglement || charge.date);
      return anneeDe(reference) === annee;
    });

    const detail = chargesAnnee({ charges: donnees.charges }, annee, methode);
    const nonDeductible = centimes(deLAnnee
      .filter((c) => c.deductible === false && !c.immobilise)
      .reduce((s, c) => s + (Number(c.montant) || 0), 0));
    const immobilisees = centimes(deLAnnee.filter((c) => c.immobilise).reduce((s, c) => s + (Number(c.montant) || 0), 0));
    const sansJustificatif = deLAnnee.filter((c) => !c.documentChemin).length;

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Charges déduites ${annee}`, valeur: montant(detail.total, { rond: true }), detail: `${deLAnnee.length} dépenses saisies` }),
      tuile({ libelle: 'Non déductible', valeur: montant(nonDeductible, { rond: true }) }),
      tuile({ libelle: 'À amortir', valeur: montant(immobilisees, { rond: true }), detail: 'saisi en immobilisation' }),
      tuile({ libelle: 'Sans justificatif', valeur: String(sansJustificatif), ton: sansJustificatif ? 'negatif' : 'positif' }),
    ]));

    const zoneTableau = h('div');
    const rafraichirTableau = () => { vider(zoneTableau); zoneTableau.append(dessinerTableau()); };

    conteneur.append(barreOutils([
      bouton('+ Dépense', () => ouvrirCharge(donnees, null, annee), { type: 'primaire' }),
      champRecherche('Rechercher un libellé, un fournisseur…', (valeur) => { filtreTexte = valeur; rafraichirTableau(); }, filtreTexte),
      h('select', {
        style: 'max-width:280px',
        onchange: (e) => { filtreCategorie = e.target.value; rafraichirTableau(); },
      }, [
        h('option', { value: '', selected: filtreCategorie === '' }, 'Toutes les catégories'),
        ...etat.CATEGORIES_CHARGES.map((c) => h('option', { value: c.code, selected: filtreCategorie === c.code }, c.libelle)),
      ]),
      h('div', { class: 'espace' }),
      bouton('Exporter en CSV', () => exporterCsv(deLAnnee, annee)),
    ]));

    const colonnes = [
      { titre: 'Date', valeur: (c) => date(c.date) },
      { titre: 'Catégorie', valeur: (c) => etat.libelleCategorieCharge(c.categorie) },
      { titre: 'Libellé', valeur: (c) => h('div', {}, [
        h('div', { texte: c.libelle }),
        c.fournisseur ? h('div', { class: 'legende', texte: c.fournisseur }) : null,
      ]) },
      { titre: 'Montant', nombre: true, valeur: (c) => montant(c.montant) },
      { titre: 'Déduit', nombre: true, valeur: (c) => {
        if (c.immobilise) return badge('Amorti', 'info');
        if (c.deductible === false) return badge('Non', 'attente');
        const taux = c.tauxDeduction === undefined ? 100 : Number(c.tauxDeduction);
        return taux === 100 ? montant(c.montant) : montant((Number(c.montant) || 0) * taux / 100);
      } },
      { titre: 'Justificatif', valeur: (c) => (c.documentChemin
        ? h('a', {
          class: 'lien-doc',
          href: '#',
          onclick: (ev) => { ev.preventDefault(); api.ouvrirFichier(c.documentEspace || 'documents', c.documentChemin).catch(signalerErreur); },
        }, '📎 ouvrir')
        : bouton('Joindre', () => joindreJustificatif(c), { petit: true, type: 'discret' })) },
      { titre: '', actions: true, valeur: (c) => h('div', { class: 'groupe-boutons' }, [
        bouton('Modifier', () => ouvrirCharge(donnees, c, annee), { petit: true }),
        bouton('✕', async () => {
          const confirme = await confirmer({
            titre: 'Supprimer la dépense',
            message: `Supprimer « ${c.libelle} » du ${date(c.date)} ?`,
            libelleValider: 'Supprimer', danger: true,
          });
          if (confirme) await executer(etat.supprimer('charges', c.id), 'Dépense supprimée.');
        }, { petit: true, type: 'danger' }),
      ]) },
    ];

    function dessinerTableau() {
      const lignes = deLAnnee
        .filter((c) => !filtreCategorie || c.categorie === filtreCategorie)
        .filter((c) => !filtreTexte
          || `${c.libelle} ${c.fournisseur || ''} ${etat.libelleCategorieCharge(c.categorie)}`.toLowerCase().includes(filtreTexte))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return tableau({
        colonnes, lignes, cle: (c) => c.id,
        messageVide: 'Aucune dépense enregistrée pour cet exercice.',
      });
    }

    zoneTableau.append(dessinerTableau());
    conteneur.append(carte({
      titre: `Dépenses ${annee}`,
      aide: methode === 'engagement'
        ? 'Classées à la date de la dépense (comptabilité d’engagement).'
        : 'Classées à la date de règlement (comptabilité de trésorerie).',
      serre: true,
      corps: zoneTableau,
    }));

    if (detail.groupes.size) {
      conteneur.append(carte({
        titre: 'Récapitulatif par catégorie',
        serre: true,
        corps: tableau({
          colonnes: [
            { titre: 'Catégorie', valeur: (l) => etat.libelleCategorieCharge(l[0]) },
            { titre: 'Montant déduit', nombre: true, valeur: (l) => montant(l[1]) },
            { titre: 'Part', nombre: true, valeur: (l) => (detail.total ? `${Math.round((l[1] / detail.total) * 100)} %` : '—') },
          ],
          lignes: [...detail.groupes.entries()].sort((a, b) => b[1] - a[1]),
          messageVide: '',
        }),
      }));
    }

    return conteneur;
  },
};

function exporterCsv(charges, annee) {
  const entetes = ['Date', 'Date de règlement', 'Catégorie', 'Libellé', 'Fournisseur', 'Montant', 'Déductible', 'Part déductible', 'Justificatif'];
  const lignes = charges.map((c) => [
    c.date, c.dateReglement || '', etat.libelleCategorieCharge(c.categorie), c.libelle, c.fournisseur || '',
    String(c.montant ?? '').replace('.', ','),
    c.immobilise ? 'Immobilisée' : (c.deductible === false ? 'Non' : 'Oui'),
    c.tauxDeduction ?? 100, c.documentChemin || '',
  ]);
  const contenu = [entetes, ...lignes]
    .map((ligne) => ligne.map((cellule) => `"${String(cellule).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([`﻿${contenu}`], { type: 'text/csv;charset=utf-8' }));
  lien.download = `charges-${annee}.csv`;
  lien.click();
  URL.revokeObjectURL(lien.href);
  notifier('Export CSV téléchargé.', 'succes');
}
