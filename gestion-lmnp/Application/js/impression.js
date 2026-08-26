// Quittances de loyer et avis d'échéance, mis en page pour l'impression A4.

import { h, vider, notifier } from './ui.js';
import { montant, dateLongue, nomMois, isoDepuis, aujourdhui } from './format.js';

const dernierJour = (annee, mois) => new Date(annee, mois, 0).getDate();

function blocAdresse(titre, lignes) {
  return h('div', {}, [
    h('div', { style: 'font-size:9.5pt;color:#555;margin-bottom:2mm', texte: titre }),
    ...lignes.filter(Boolean).map((ligne) => h('div', { texte: ligne })),
  ]);
}

function tableauMontants(echeance) {
  const lignes = [
    ['Loyer hors charges', echeance.loyerHc],
    ['Provision pour charges', echeance.charges],
  ];
  if (echeance.autres) lignes.push(['Autres sommes dues', echeance.autres]);
  return h('table', { style: 'width:100%;margin:6mm 0' }, [
    h('tbody', {}, lignes.map(([libelle, valeur]) => h('tr', {}, [
      h('td', { style: 'padding:1.5mm 0', texte: libelle }),
      h('td', { style: 'padding:1.5mm 0;text-align:right', texte: montant(valeur || 0) }),
    ]))),
    h('tfoot', {}, h('tr', {}, [
      h('td', { style: 'padding:2mm 0;border-top:1px solid #000;font-weight:600', texte: 'Total' }),
      h('td', { style: 'padding:2mm 0;border-top:1px solid #000;text-align:right;font-weight:600', texte: montant(echeance.total || 0) }),
    ])),
  ]);
}

/** Période réellement couverte : bornée aux dates du bail pour un mois partiel. */
function periodeTexte(echeance, bail) {
  let debut = isoDepuis(echeance.annee, echeance.mois, 1);
  let fin = isoDepuis(echeance.annee, echeance.mois, dernierJour(echeance.annee, echeance.mois));
  const debutBail = String(bail?.dateDebut || '').slice(0, 10);
  const finBail = String(bail?.dateFin || '').slice(0, 10);
  if (debutBail && debutBail > debut) debut = debutBail;
  if (finBail && finBail < fin) fin = finBail;
  return `du ${dateLongue(debut)} au ${dateLongue(fin)}`;
}

function imprimer(noeud) {
  const zone = vider(document.getElementById('zone-impression'));
  zone.append(noeud);
  document.body.dataset.impression = 'document';
  const apres = () => {
    window.removeEventListener('afterprint', apres);
    delete document.body.dataset.impression;
    setTimeout(() => vider(zone), 500);
  };
  window.addEventListener('afterprint', apres);
  window.print();
}

function enteteDocument({ bailleur, locataire, bien }) {
  return h('div', { class: 'entete-doc' }, [
    blocAdresse('Bailleur', [
      bailleur?.nom,
      ...(bailleur?.adresse || '').split('\n'),
      bailleur?.telephone,
      bailleur?.email,
    ]),
    blocAdresse('Locataire', [
      locataire ? `${locataire.nom} ${locataire.prenom || ''}`.trim() : '—',
      ...((locataire?.adresse || bien?.adresse || '').split('\n')),
      locataire?.adresse ? null : [bien?.codePostal, bien?.ville].filter(Boolean).join(' '),
    ]),
  ]);
}

export function imprimerQuittance({ bailleur, locataire, bien, bail, echeance, dateReglement, lieu }) {
  if (!bailleur?.nom) {
    notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur');
    return;
  }
  const adresseLogement = [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const nomLocataire = locataire ? `${locataire.prenom || ''} ${locataire.nom}`.trim() : 'le locataire';
  const periode = periodeTexte(echeance, bail);

  imprimer(h('div', { class: 'document-imprime' }, [
    enteteDocument({ bailleur, locataire, bien }),
    h('h2', { texte: `Quittance de loyer — ${nomMois(echeance.mois)} ${echeance.annee}` }),
    h('p', { texte: `Logement loué : ${adresseLogement || '—'}` }),
    h('p', { texte: `Période : ${periode}` }),
    tableauMontants(echeance),
    h('p', {
      texte: `Je soussigné${bailleur.feminin ? 'e' : ''} ${bailleur.nom}, bailleur du logement désigné ci-dessus, `
        + `déclare avoir reçu de ${nomLocataire} la somme de ${montant(echeance.total || 0)} `
        + `au titre du loyer et des charges pour la période ${periode}, et lui en donne quittance, `
        + 'sous réserve de tous mes droits.',
    }),
    h('div', { class: 'mentions' }, [
      h('div', { texte: 'Cette quittance annule tous les reçus qui auraient pu être établis précédemment '
        + 'pour la même période. Elle est délivrée sous réserve d’encaissement définitif des sommes versées.' }),
    ]),
    h('div', { class: 'signature' }, [
      h('div', { texte: `${lieu || ''}${lieu ? ', le ' : 'Le '}${dateLongue(dateReglement || aujourdhui())}` }),
      h('div', { style: 'margin-top:2mm', texte: bailleur.nom }),
      h('div', { style: 'margin-top:14mm;font-size:9.5pt;color:#666', texte: 'Signature' }),
    ]),
  ]));
}

export function imprimerAvis({ bailleur, locataire, bien, bail, echeance, lieu }) {
  if (!bailleur?.nom) {
    notifier('Renseignez d’abord un bailleur dans les Paramètres.', 'erreur');
    return;
  }
  const adresseLogement = [bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  imprimer(h('div', { class: 'document-imprime' }, [
    enteteDocument({ bailleur, locataire, bien }),
    h('h2', { texte: `Avis d’échéance — ${nomMois(echeance.mois)} ${echeance.annee}` }),
    h('p', { texte: `Logement loué : ${adresseLogement || '—'}` }),
    h('p', { texte: `Période : ${periodeTexte(echeance, bail)}` }),
    tableauMontants(echeance),
    h('p', { texte: `Somme à régler avant le ${dateLongue(echeance.dateEcheance)}.` }),
    h('div', { class: 'mentions', texte: 'Le présent avis ne vaut pas quittance. '
      + 'Une quittance vous sera remise après encaissement du règlement.' }),
    h('div', { class: 'signature' }, [
      h('div', { texte: `${lieu || ''}${lieu ? ', le ' : 'Le '}${dateLongue(aujourdhui())}` }),
      h('div', { style: 'margin-top:2mm', texte: bailleur.nom }),
    ]),
  ]));
}

/** Relevé annuel de tous les encaissements d'un bail. */
export function imprimerReleve({ bailleur, locataire, bien, annee, echeances }) {
  const total = echeances.reduce((s, e) => s + (e.total || 0), 0);
  const encaisse = echeances.reduce((s, e) => s + (e.encaissements || []).reduce((x, v) => x + (Number(v.montant) || 0), 0), 0);
  imprimer(h('div', { class: 'document-imprime' }, [
    enteteDocument({ bailleur, locataire, bien }),
    h('h2', { texte: `Relevé locatif ${annee}` }),
    h('table', { style: 'width:100%' }, [
      h('thead', {}, h('tr', {}, [
        h('th', { style: 'text-align:left;border-bottom:1px solid #000', texte: 'Mois' }),
        h('th', { style: 'text-align:right;border-bottom:1px solid #000', texte: 'Dû' }),
        h('th', { style: 'text-align:right;border-bottom:1px solid #000', texte: 'Encaissé' }),
        h('th', { style: 'text-align:right;border-bottom:1px solid #000', texte: 'Solde' }),
      ])),
      h('tbody', {}, echeances.map((e) => {
        const recu = (e.encaissements || []).reduce((x, v) => x + (Number(v.montant) || 0), 0);
        return h('tr', {}, [
          h('td', { texte: nomMois(e.mois) }),
          h('td', { style: 'text-align:right', texte: montant(e.total || 0) }),
          h('td', { style: 'text-align:right', texte: montant(recu) }),
          h('td', { style: 'text-align:right', texte: montant((e.total || 0) - recu) }),
        ]);
      })),
      h('tfoot', {}, h('tr', {}, [
        h('td', { style: 'border-top:1px solid #000;font-weight:600', texte: 'Total' }),
        h('td', { style: 'border-top:1px solid #000;text-align:right;font-weight:600', texte: montant(total) }),
        h('td', { style: 'border-top:1px solid #000;text-align:right;font-weight:600', texte: montant(encaisse) }),
        h('td', { style: 'border-top:1px solid #000;text-align:right;font-weight:600', texte: montant(total - encaisse) }),
      ])),
    ]),
    h('div', { class: 'signature', texte: `Établi le ${dateLongue(aujourdhui())}` }),
  ]));
}
