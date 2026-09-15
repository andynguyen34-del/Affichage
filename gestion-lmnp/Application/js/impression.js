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
/**
 * Relevé de gérance annuel (v58) : un logement géré par une agence, mois par
 * mois, avec les éléments pour la déclaration de revenus (loyers bruts,
 * honoraires, autres retenues, net perçu).
 */
export function imprimerReleveGerance({ bailleur, bien, annee, lignes, totaux }) {
  const cellule = (texte, droite = false, gras = false) => h('td', { style: `${droite ? 'text-align:right;' : ''}${gras ? 'border-top:1px solid #000;font-weight:600;' : ''}`, texte });
  const natures = [...new Set(lignes.filter((l) => l.releve && Number(l.releve.autres) > 0).map((l) => l.releve.natureAutres).filter(Boolean))];
  imprimer(h('div', { class: 'document-imprime' }, [
    h('div', { class: 'entete-doc' }, [
      blocAdresse('Bailleur', [bailleur?.nom, ...(bailleur?.adresse || '').split('\n'), bailleur?.telephone, bailleur?.email]),
      blocAdresse('Logement géré par une agence', [bien?.nom, bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' '), bien?.agenceNom ? `Agence : ${bien.agenceNom}` : null, bien?.agenceLocataire ? `Locataire : ${bien.agenceLocataire}` : null]),
    ]),
    h('h2', { texte: `Relevé de gérance ${annee}` }),
    h('table', { style: 'width:100%' }, [
      h('thead', {}, h('tr', {}, ['Mois', 'Loyer encaissé', 'Honoraires', 'Autres retenues', 'Net versé', 'Versé le'].map((t, i) => h('th', { style: `text-align:${i >= 1 && i <= 4 ? 'right' : 'left'};border-bottom:1px solid #000`, texte: t })))),
      h('tbody', {}, lignes.map((l) => (l.releve
        ? h('tr', {}, [cellule(nomMois(l.mois)), cellule(montant(l.releve.loyer || 0), true), cellule(montant(l.releve.honoraires || 0), true), cellule(montant(l.releve.autres || 0), true), cellule(montant(l.releve.net || 0), true), cellule(l.releve.verseLe ? dateLongue(l.releve.verseLe) : '—')])
        : h('tr', {}, [cellule(nomMois(l.mois)), cellule('—', true), cellule('—', true), cellule('—', true), cellule('—', true), cellule(l.etat === 'manquant' ? 'relevé manquant' : 'à venir')])))),
      h('tfoot', {}, h('tr', {}, [cellule(`Total ${annee}`, false, true), cellule(montant(totaux.loyers), true, true), cellule(montant(totaux.honoraires), true, true), cellule(montant(totaux.autres), true, true), cellule(montant(totaux.net), true, true), cellule(`${totaux.recus} / ${totaux.attendus} relevés`, false, true)])),
    ]),
    h('h2', { texte: `Éléments pour la déclaration de revenus ${annee}`, style: 'margin-top:8mm' }),
    h('table', { style: 'width:70%' }, [
      h('tbody', {}, [
        h('tr', {}, [cellule('Loyers bruts encaissés par l’agence (recettes)'), cellule(montant(totaux.loyers), true)]),
        h('tr', {}, [cellule('Honoraires de gestion (charges déductibles)'), cellule(montant(totaux.honoraires), true)]),
        h('tr', {}, [cellule(`Autres retenues de l’agence${natures.length ? ` (${natures.join(', ')})` : ''}`), cellule(montant(totaux.autres), true)]),
        h('tr', {}, [cellule('Net perçu sur votre compte', false, true), cellule(montant(totaux.net), true, true)]),
      ]),
    ]),
    totaux.manquants.length ? h('p', { style: 'margin-top:4mm', texte: `Relevés manquants : ${totaux.manquants.map((m) => nomMois(m)).join(', ')} — à réclamer à l’agence avant la déclaration.` }) : null,
    h('p', { style: 'margin-top:4mm;font-size:9.5pt;color:#555', texte: 'Les relevés de gérance de l’agence (PDF) joints mois par mois dans l’application sont les justificatifs de ces montants.' }),
    h('div', { class: 'signature', texte: `Établi le ${dateLongue(aujourdhui())}` }),
  ]));
}

/** Relevé d'un mois (v55) : une ligne par colocataire du logement. */
export function imprimerReleveMois({ bailleur, bien, annee, mois, lignes }) {
  const recuDe = (e) => (e.encaissements || []).reduce((x, v) => x + (Number(v.montant) || 0), 0);
  const total = lignes.reduce((s, x) => s + (x.echeance.total || 0), 0);
  const encaisse = lignes.reduce((s, x) => s + recuDe(x.echeance), 0);
  const cellule = (texte, droite = false, gras = false) => h('td', { style: `${droite ? 'text-align:right;' : ''}${gras ? 'border-top:1px solid #000;font-weight:600;' : ''}`, texte });
  imprimer(h('div', { class: 'document-imprime' }, [
    h('div', { class: 'entete-doc' }, [
      blocAdresse('Bailleur', [bailleur?.nom, ...(bailleur?.adresse || '').split('\n'), bailleur?.telephone, bailleur?.email]),
      blocAdresse('Logement', [bien?.nom, bien?.adresse, [bien?.codePostal, bien?.ville].filter(Boolean).join(' ')]),
    ]),
    h('h2', { texte: `Relevé de ${nomMois(mois)} ${annee}` }),
    h('table', { style: 'width:100%' }, [
      h('thead', {}, h('tr', {}, ['Colocataire', 'Échéance', 'Dû', 'Encaissé', 'Solde', 'Réglé le'].map((t, i) => h('th', { style: `text-align:${i >= 2 && i <= 4 ? 'right' : 'left'};border-bottom:1px solid #000`, texte: t })))),
      h('tbody', {}, lignes.map(({ nom, echeance: e }) => {
        const recu = recuDe(e);
        const dernier = (e.encaissements || []).slice(-1)[0];
        return h('tr', {}, [cellule(nom), cellule(e.dateEcheance ? dateLongue(e.dateEcheance) : '—'), cellule(montant(e.total || 0), true), cellule(montant(recu), true), cellule(montant((e.total || 0) - recu), true), cellule(dernier?.date ? dateLongue(dernier.date) : '—')]);
      })),
      h('tfoot', {}, h('tr', {}, [cellule('Total du mois', false, true), cellule('', false, true), cellule(montant(total), true, true), cellule(montant(encaisse), true, true), cellule(montant(total - encaisse), true, true), cellule('', false, true)])),
    ]),
    h('div', { class: 'signature', texte: `Établi le ${dateLongue(aujourdhui())}` }),
  ]));
}

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
