// Tableau de bord : les loyers de l'année en un coup d'œil, et ce qu'il
// reste à faire (virements à pointer, quittances à émettre, états des lieux).

import { h, carte, tuile, bouton } from '../ui.js';
import { montant, nomMoisCourt, centimes, date } from '../format.js';
import * as calcul from '../calculs/loyers.js';

const nomDe = (locataire) => (locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'Sans locataire');

function grilleMois(echeances) {
  return h('div', { style: 'display:flex;gap:.35rem;flex-wrap:wrap' },
    echeances.sort((a, b) => a.mois - b.mois).map((echeance) => {
      const statut = calcul.statut(echeance);
      const couleurs = {
        paye: 'var(--succes)', partiel: 'var(--attention)', retard: 'var(--alerte)',
        attente: 'var(--bordure-forte)', 'sans-objet': 'var(--bordure)',
      };
      return h('span', {
        title: `${nomMoisCourt(echeance.mois)} — ${montant(echeance.total || 0)} (${calcul.LIBELLES_STATUT[statut].texte})`,
        style: `display:inline-flex;align-items:center;justify-content:center;width:2.35rem;height:1.55rem;`
          + `border-radius:5px;font-size:.68rem;font-weight:600;color:#fff;background:${couleurs[statut]}`,
      }, nomMoisCourt(echeance.mois));
    }));
}

export default {
  cle: 'tableau-de-bord',
  libelle: 'Tableau de bord',
  icone: '📊',
  titre: 'Tableau de bord',
  sousTitre: (contexte) => `Les loyers de la colocation en ${contexte.annee}.`,
  rendre(contexte) {
    const donnees = contexte.donnees;
    const annee = contexte.annee;
    const conteneur = h('div');

    const toutes = calcul.echeancesGlobales(donnees.baux, annee, donnees.loyers);
    const attendu = centimes(toutes.reduce((s, e) => s + (e.total || 0), 0));
    const recu = centimes(toutes.reduce((s, e) => s + calcul.totalEncaisse(e), 0));
    const impayes = toutes.filter((e) => ['retard', 'partiel'].includes(calcul.statut(e)));
    const resteDu = centimes(impayes.reduce((s, e) => s + (e.total - calcul.totalEncaisse(e)), 0));
    const prochaine = toutes
      .filter((e) => calcul.statut(e) === 'attente')
      .sort((a, b) => String(a.dateEcheance).localeCompare(String(b.dateEcheance)))[0];

    conteneur.append(h('div', { class: 'grille grille-4', style: 'margin-bottom:1rem' }, [
      tuile({ libelle: `Attendu ${annee}`, valeur: montant(attendu, { rond: true }), detail: `${toutes.length} échéance(s)` }),
      tuile({ libelle: 'Reçu', valeur: montant(recu, { rond: true }), ton: 'positif' }),
      tuile({ libelle: 'Reste dû', valeur: montant(resteDu, { rond: true }), ton: resteDu > 0 ? 'negatif' : 'neutre',
        detail: impayes.length ? `${impayes.length} échéance(s)` : 'tout est à jour' }),
      tuile({ libelle: 'Prochaine échéance', valeur: prochaine ? montant(prochaine.total, { rond: true }) : '—',
        detail: prochaine ? `le ${date(prochaine.dateEcheance)}` : '' }),
    ]));

    // ------------------------------------------------------------- à faire
    const aFaire = [];
    if (impayes.length) {
      aFaire.push({ texte: `${impayes.length} échéance(s) non soldée(s), soit ${montant(resteDu)}.`, page: 'loyers', libelle: 'Pointer' });
    }
    const quittancesAEmettre = toutes.filter((e) => calcul.statut(e) === 'paye' && !e.quittanceEmiseLe);
    if (quittancesAEmettre.length) {
      aFaire.push({ texte: `${quittancesAEmettre.length} quittance(s) à émettre pour des loyers déjà payés.`, page: 'loyers', libelle: 'Éditer' });
    }
    const brouillonsEdl = (donnees.etatsDesLieux || []).filter((e) => e.statut !== 'finalise');
    if (brouillonsEdl.length) {
      aFaire.push({ texte: `${brouillonsEdl.length} état(s) des lieux en brouillon (photos ou signatures à compléter).`, page: 'etat-des-lieux', libelle: 'Ouvrir' });
    }
    const sansEmail = donnees.baux
      .flatMap((b) => calcul.fluxDuBail(b).map((f) => f.locataireId))
      .map((id) => donnees.locataires.find((l) => l.id === id))
      .filter((l) => l && !l.email && l.nom !== 'Voyageurs Airbnb');
    if (sansEmail.length) {
      aFaire.push({ texte: `Adresse e-mail manquante pour : ${[...new Set(sansEmail.map(nomDe))].join(', ')} — `
        + 'nécessaire aux quittances par e-mail et à l’espace colocataire.', page: 'bien', libelle: 'Compléter' });
    }
    if (aFaire.length) {
      conteneur.append(carte({
        titre: 'À faire',
        corps: h('div', {}, aFaire.map((element) => h('div', {
          style: 'display:flex;align-items:center;gap:.8rem;padding:.45rem 0;border-bottom:1px solid var(--bordure)',
        }, [
          h('span', { style: 'flex:1', texte: `• ${element.texte}` }),
          bouton(element.libelle, () => contexte.allerA(element.page), { petit: true }),
        ]))),
      }));
    }

    // ------------------------------------- suivi mensuel par colocataire
    const blocs = [];
    for (const bail of donnees.baux) {
      const echeances = calcul.echeancesAnnee(bail, annee, donnees.loyers);
      if (!echeances.length) continue;
      const parLocataire = new Map();
      for (const echeance of echeances) {
        const cle = echeance.locataireId || bail.locataireId || '';
        if (!parLocataire.has(cle)) parLocataire.set(cle, []);
        parLocataire.get(cle).push(echeance);
      }
      for (const [locataireId, lignes] of parLocataire) {
        const locataire = donnees.locataires.find((l) => l.id === locataireId);
        const total = centimes(lignes.reduce((s, e) => s + (e.total || 0), 0));
        const percu = centimes(lignes.reduce((s, e) => s + calcul.totalEncaisse(e), 0));
        blocs.push(h('div', { style: 'margin-bottom:1rem' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.35rem;gap:1rem;flex-wrap:wrap' }, [
            h('strong', { texte: nomDe(locataire) }),
            h('span', { class: 'legende', texte: `${montant(percu)} / ${montant(total)}` }),
          ]),
          grilleMois(lignes),
        ]));
      }
    }
    conteneur.append(carte({
      titre: `Loyers ${annee} par colocataire`,
      aide: 'Un carré par mois : vert reçu, orange partiel, rouge en retard, gris à venir.',
      corps: blocs.length ? h('div', {}, blocs)
        : h('p', { class: 'legende', texte: 'Aucune échéance cette année. Déclarez un bail dans « Bien & baux ».' }),
    }));

    return conteneur;
  },
};
