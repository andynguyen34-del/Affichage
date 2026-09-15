// Logement géré par une agence (v58) : relevés de gérance mensuels (loyer
// encaissé par l'agence, honoraires, autres retenues, net versé), sans appel
// de loyer, quittance ni espace colocataire. Module PUR.
//
// Sur le logement : typeLocation 'agence', agenceNom, agenceEmail,
// agenceTelephone, agenceHonoraires (%), agenceLoyer (loyer mensuel charges
// comprises), agenceJourVersement (1-28), agenceLocataire (texte),
// agenceDepuis (date, facultatif).
// Élément de la collection « relevesGerance » :
//   { id, bienId, annee, mois, loyer, honoraires, autres, natureAutres, net,
//     verseLe, documentId (document du logement : relevé PDF) }

import { centimes, nomMois } from './format.js';

/** Honoraires proposés : loyer × taux de la fiche. */
export const honorairesProposes = (bien, loyer) => centimes((Number(loyer) || 0) * ((Number(bien?.agenceHonoraires) || 0) / 100));

/** Net proposé : loyer − honoraires − autres retenues. */
export const netDe = ({ loyer, honoraires, autres }) => centimes((Number(loyer) || 0) - (Number(honoraires) || 0) - (Number(autres) || 0));

/** Le relevé d'un mois, ou null. */
export const releveDuMois = (releves, bienId, annee, mois) => (releves || [])
  .find((r) => r.bienId === bienId && Number(r.annee) === Number(annee) && Number(r.mois) === Number(mois)) || null;

/** Les relevés d'un logement pour une année, par mois croissant. */
export const relevesAnnee = (releves, bienId, annee) => (releves || [])
  .filter((r) => r.bienId === bienId && Number(r.annee) === Number(annee))
  .sort((a, b) => Number(a.mois) - Number(b.mois));

/** Date de versement attendue d'un mois : le jour réglé (1-28) du mois. */
export function dateVersementAttendue(bien, annee, mois) {
  const jour = Math.min(28, Math.max(1, Number(bien?.agenceJourVersement) || 10));
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** Les mois de l'année concernés : depuis « agenceDepuis » (si renseigné), sinon les douze. */
export function moisGeres(bien, annee) {
  const depuis = String(bien?.agenceDepuis || '').slice(0, 7);
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => !depuis || `${annee}-${String(m).padStart(2, '0')}` >= depuis);
}

/**
 * État d'un mois : 'recu' (relevé enregistré), 'manquant' (date de versement
 * attendue passée sans relevé), 'avenir' (pas encore dû).
 */
export function etatMois(releve, bien, annee, mois, dateJour) {
  if (releve) return 'recu';
  return dateVersementAttendue(bien, annee, mois) < String(dateJour || '').slice(0, 10) ? 'manquant' : 'avenir';
}

export const LIBELLES_ETAT_MOIS = {
  recu: { texte: 'Reçu', ton: 'succes' },
  manquant: { texte: 'Relevé manquant', ton: 'alerte' },
  avenir: { texte: 'À venir', ton: 'attente' },
};

/**
 * Les lignes de l'année d'un logement en gestion : un mois par ligne, avec
 * le relevé s'il existe, l'état et le net attendu (loyer − honoraires réglés).
 */
export function lignesAnnee(bien, releves, annee, dateJour) {
  const loyer = Number(bien?.agenceLoyer) || 0;
  return moisGeres(bien, annee).map((mois) => {
    const releve = releveDuMois(releves, bien.id, annee, mois);
    return {
      annee: Number(annee), mois, libelle: `${nomMois(mois)} ${annee}`, releve,
      etat: etatMois(releve, bien, annee, mois, dateJour),
      attenduLe: dateVersementAttendue(bien, annee, mois),
      netAttendu: releve ? centimes(Number(releve.net) || 0) : netDe({ loyer, honoraires: honorairesProposes(bien, loyer), autres: 0 }),
    };
  });
}

/** Totaux de l'année : loyers bruts, honoraires, autres retenues, net versé, relevés reçus / attendus, manquants. */
export function totauxAnnee(lignes) {
  const recus = lignes.filter((l) => l.releve);
  const somme = (cle) => centimes(recus.reduce((s, l) => s + (Number(l.releve[cle]) || 0), 0));
  return {
    loyers: somme('loyer'), honoraires: somme('honoraires'), autres: somme('autres'), net: somme('net'),
    netAttendu: centimes(lignes.reduce((s, l) => s + l.netAttendu, 0)),
    recus: recus.length, attendus: lignes.length,
    manquants: lignes.filter((l) => l.etat === 'manquant').map((l) => l.mois),
  };
}

/** Résumé pour le titre : « Foncia · 680,00 € / mois · honoraires 7,5 % ». */
export function resumeGerance(bien, formaterMontant) {
  const morceaux = [];
  if (bien?.agenceNom) morceaux.push(bien.agenceNom);
  if (Number(bien?.agenceLoyer) > 0) morceaux.push(`${formaterMontant(Number(bien.agenceLoyer))} / mois`);
  if (Number(bien?.agenceHonoraires) > 0) morceaux.push(`honoraires ${String(bien.agenceHonoraires).replace('.', ',')} %`);
  return morceaux.join(' · ');
}
