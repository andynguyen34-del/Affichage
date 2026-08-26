// Vue d'ensemble de l'exercice.

import * as etat from '../etat.js';
import { h, carte, tableau, tuile, bouton, badge, vide } from '../ui.js';
import { montant, date, nomMoisAbrege, centimes, aujourdhui } from '../format.js';
import * as fiscal from '../calculs/fiscal.js';
import * as calculLoyers from '../calculs/loyers.js';
import * as calculEmprunt from '../calculs/emprunt.js';
import * as lectureFactures from '../calculs/factures.js';

function bandeauMois(echeances) {
  const parMois = new Map(echeances.map((e) => [e.mois, e]));
  return h('div', { class: 'puce-mois' }, Array.from({ length: 12 }, (_, index) => {
    const mois = index + 1;
    const echeance = parMois.get(mois);
    const statut = echeance ? calculLoyers.statut(echeance) : null;
    const classe = { paye: 'paye', partiel: 'partiel', retard: 'retard' }[statut] || '';
    return h('div', { class: classe, title: echeance ? `${montant(calculLoyers.totalEncaisse(echeance))} / ${montant(echeance.total)}` : 'hors bail' },
      nomMoisAbrege(mois));
  }));
}

function barresCategories(exercice) {
  const entrees = [...exercice.charges.groupes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (exercice.charges.emprunt.deductible) {
    entrees.push(['__emprunt', exercice.charges.emprunt.deductible]);
    entrees.sort((a, b) => b[1] - a[1]);
  }
  if (!entrees.length) return vide('Aucune charge saisie', 'Les dépenses de l’exercice apparaîtront ici.');
  const maximum = Math.max(...entrees.map((e) => e[1]));
  return h('div', {}, entrees.map(([code, valeur]) => h('div', { style: 'margin-bottom:.6rem' }, [
    h('div', { style: 'display:flex;justify-content:space-between;font-size:.84rem;margin-bottom:.15rem' }, [
      h('span', { texte: code === '__emprunt' ? 'Intérêts et assurance d’emprunt' : etat.libelleCategorieCharge(code) }),
      h('strong', { texte: montant(valeur) }),
    ]),
    h('div', { class: 'barre-progression' }, h('span', { style: `width:${Math.max(2, (valeur / maximum) * 100)}%` })),
  ])));
}

export default {
  cle: 'tableau-de-bord',
  libelle: 'Tableau de bord',
  icone: '◈',
  titre: 'Tableau de bord',
  sousTitre: (contexte) => `Exercice ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const exercice = fiscal.exercice(donnees, annee);
    const conteneur = h('div');

    const echeances = calculLoyers.echeancesGlobales(donnees.baux, annee, donnees.loyers);
    const attendu = centimes(echeances.reduce((s, e) => s + (e.total || 0), 0));
    const encaisse = centimes(echeances.reduce((s, e) => s + calculLoyers.totalEncaisse(e), 0));
    const impayes = echeances.filter((e) => ['retard', 'partiel'].includes(calculLoyers.statut(e)));
    const resteDu = centimes(impayes.reduce((s, e) => s + (e.total - calculLoyers.totalEncaisse(e)), 0));
    const emprunt = calculEmprunt.syntheseAnneeTousEmprunts(donnees.emprunts, annee);
    const tresorerie = centimes(encaisse - exercice.charges.horsEmprunt - emprunt.deductible - emprunt.capital);

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Loyers encaissés', valeur: montant(encaisse, { rond: true }),
        detail: `sur ${montant(attendu, { rond: true })} attendus`, ton: 'positif' }),
      tuile({ libelle: 'Impayés', valeur: montant(resteDu, { rond: true }),
        detail: `${impayes.length} échéance(s)`, ton: resteDu > 0 ? 'negatif' : 'neutre' }),
      tuile({ libelle: 'Charges payées', valeur: montant(centimes(exercice.charges.total), { rond: true }) }),
      tuile({ libelle: 'Trésorerie nette', valeur: montant(tresorerie, { rond: true }),
        detail: 'loyers moins charges et mensualités', ton: tresorerie >= 0 ? 'positif' : 'negatif' }),
    ]));

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: 'Amortissements imputés', valeur: montant(exercice.amortissements.impute, { rond: true }) }),
      tuile({ libelle: 'Amortissements en report', valeur: montant(exercice.amortissements.differes, { rond: true }),
        detail: 'sans limite de durée' }),
      tuile({ libelle: 'Déficits reportables',
        valeur: montant(centimes((exercice.reportSortant.deficits || []).reduce((s, d) => s + d.montant, 0)), { rond: true }),
        detail: `imputables ${fiscal.DUREE_REPORT_DEFICIT} ans` }),
      tuile({ libelle: 'Résultat imposable', valeur: montant(exercice.resultatImposable, { rond: true }),
        ton: exercice.resultatImposable > 0 ? 'negatif' : 'positif' }),
    ]));

    // ---------------------------------------------------------- à faire
    const aFaire = [];
    const facturesEnAttente = lectureFactures.aTraiter(etat.fichiers('factures'), donnees.charges);
    if (facturesEnAttente.length) {
      aFaire.push({ texte: `${facturesEnAttente.length} facture(s) déposée(s) attendent d’être intégrées.`, page: 'factures', libelle: 'Voir' });
    }
    if (impayes.length) {
      aFaire.push({ texte: `${impayes.length} échéance(s) de loyer non soldée(s), soit ${montant(resteDu)}.`, page: 'loyers', libelle: 'Pointer' });
    }
    const sansJustificatif = donnees.charges.filter((c) => !c.documentChemin).length;
    if (sansJustificatif) {
      aFaire.push({ texte: `${sansJustificatif} dépense(s) sans justificatif rattaché.`, page: 'charges', libelle: 'Compléter' });
    }
    const quittancesADelivrer = echeances.filter((e) => calculLoyers.statut(e) === 'paye' && !e.quittanceEmiseLe).length;
    if (quittancesADelivrer) {
      aFaire.push({ texte: `${quittancesADelivrer} quittance(s) à délivrer.`, page: 'loyers', libelle: 'Éditer' });
    }
    if (!donnees.immobilisations.length && donnees.biens.length) {
      aFaire.push({ texte: 'Aucun amortissement n’est enregistré : c’est le principal levier du régime réel.', page: 'amortissements', libelle: 'Décomposer' });
    }

    if (aFaire.length) {
      conteneur.append(carte({
        titre: 'À faire',
        corps: h('div', {}, aFaire.map((item) => h('div', {
          style: 'display:flex;align-items:center;gap:.6rem;padding:.45rem 0;border-bottom:1px solid #eef1f4',
        }, [
          h('span', { texte: '•' }),
          h('div', { style: 'flex:1', texte: item.texte }),
          bouton(item.libelle, () => contexte.allerA(item.page), { petit: true }),
        ]))),
      }));
    }

    // ------------------------------------------------------------ loyers
    const cartesLoyers = donnees.baux.map((bail) => {
      const echeancesBail = calculLoyers.echeancesAnnee(bail, annee, donnees.loyers);
      if (!echeancesBail.length) return null;
      const locataire = donnees.locataires.find((l) => l.id === bail.locataireId);
      const recu = centimes(echeancesBail.reduce((s, e) => s + calculLoyers.totalEncaisse(e), 0));
      const du = centimes(echeancesBail.reduce((s, e) => s + (e.total || 0), 0));
      return h('div', { style: 'margin-bottom:1rem' }, [
        h('div', { style: 'display:flex;justify-content:space-between;margin-bottom:.35rem' }, [
          h('strong', { texte: locataire ? `${locataire.nom} ${locataire.prenom || ''}`.trim() : 'Bail sans locataire' }),
          h('span', { class: 'legende', texte: `${montant(recu)} / ${montant(du)}` }),
        ]),
        bandeauMois(echeancesBail),
      ]);
    }).filter(Boolean);

    conteneur.append(h('div', { class: 'grille grille-2' }, [
      carte({
        titre: `Encaissements ${annee}`,
        aide: 'Un carré par mois : vert encaissé, orange partiel, rouge en retard.',
        corps: cartesLoyers.length ? cartesLoyers : vide('Aucun bail actif', 'Enregistrez un bail pour suivre les loyers.'),
      }),
      carte({
        titre: `Répartition des charges ${annee}`,
        corps: barresCategories(exercice),
      }),
    ]));

    // -------------------------------------------------------- patrimoine
    if (donnees.biens.length) {
      conteneur.append(carte({
        titre: 'Le bien',
        serre: true,
        corps: tableau({
          colonnes: [
            { titre: 'Logement', valeur: (b) => b.nom },
            { titre: 'Adresse', valeur: (b) => [b.adresse, b.ville].filter(Boolean).join(', ') },
            { titre: 'Acquis le', valeur: (b) => date(b.dateAcquisition) },
            { titre: 'Prix de revient', nombre: true, valeur: (b) => montant(centimes(
              (Number(b.prixAcquisition) || 0) + (Number(b.fraisNotaire) || 0) + (Number(b.fraisAgence) || 0)), { rond: true }) },
            { titre: 'Occupation', valeur: (b) => {
              const actif = donnees.baux.find((bail) => bail.bienId === b.id
                && bail.dateDebut <= aujourdhui() && (!bail.dateFin || bail.dateFin >= aujourdhui()));
              return actif ? badge('Loué', 'succes') : badge('Vacant', 'attention');
            } },
          ],
          lignes: donnees.biens,
          cle: (b) => b.id,
          messageVide: '',
        }),
      }));
    }

    return conteneur;
  },
};
