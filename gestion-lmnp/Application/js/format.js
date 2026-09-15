// Mise en forme française des nombres, montants et dates.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const MOIS_TRES_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun',
  'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

export const nomMois = (mois) => MOIS[mois - 1] || '';
export const nomMoisAbrege = (mois) => MOIS_TRES_COURT[mois - 1] || '';
export const nomMoisCourt = (mois) => MOIS_COURT[mois - 1] || '';
export const listeMois = () => MOIS.map((nom, i) => ({ valeur: i + 1, libelle: nom }));

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const eurosRonds = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const nombres = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function montant(valeur, options = {}) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  if (options.rond) return eurosRonds.format(n);
  return euros.format(n);
}

export function nombre(valeur, decimales = 2) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(n);
}

export function pourcentage(valeur, decimales = 2) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  return `${nombres.format(Number(n.toFixed(decimales)))} %`;
}

/** Date ISO (AAAA-MM-JJ) → 12/05/2026 */
export function date(iso) {
  if (!iso) return '—';
  const [a, m, j] = String(iso).slice(0, 10).split('-');
  if (!a || !m || !j) return String(iso);
  return `${j}/${m}/${a}`;
}

/** Date ISO → 12 mai 2026 */
export function dateLongue(iso) {
  if (!iso) return '—';
  const [a, m, j] = String(iso).slice(0, 10).split('-');
  if (!a || !m || !j) return String(iso);
  return `${Number(j)} ${nomMois(Number(m))} ${a}`;
}

export function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function anneeDe(iso) { return Number(String(iso || '').slice(0, 4)) || null; }
export function moisDe(iso) { return Number(String(iso || '').slice(5, 7)) || null; }

export function isoDepuis(annee, mois, jour) {
  const dernierJour = new Date(annee, mois, 0).getDate();
  const j = Math.min(Math.max(1, jour || 1), dernierJour);
  return `${annee}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

export function ajouterMois(iso, nombreDeMois) {
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number);
  const total = (a * 12) + (m - 1) + nombreDeMois;
  return isoDepuis(Math.floor(total / 12), (total % 12) + 1, j);
}

/** Nombre de mois entiers entre deux dates ISO (bornes incluses côté début). */
export function differenceMois(debut, fin) {
  const [a1, m1] = String(debut).slice(0, 10).split('-').map(Number);
  const [a2, m2] = String(fin).slice(0, 10).split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export function taille(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${nombre(octets / 1024, 0)} Ko`;
  return `${nombre(octets / (1024 * 1024), 1)} Mo`;
}

/** Arrondi comptable au centime. */
export function centimes(valeur) {
  return Math.round((Number(valeur) + Number.EPSILON) * 100) / 100;
}

/**
 * Nom de fichier sûr pour un téléchargement : Chrome perd le nom demandé
 * (« download ») quand il contient des accents sur une URL blob — on les
 * translittère (É→E, é→e…) et on écarte tout caractère hors ASCII.
 */
export const nomFichierTelechargement = (nom) => String(nom || 'document')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’‘]/g, "'").replace(/[«»“”]/g, '')
  .replace(/[^\x20-\x7E]/g, '-')
  .replace(/[\\/:*?"<>|]/g, '-').trim() || 'document';
