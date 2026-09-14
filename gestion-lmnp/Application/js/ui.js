// Briques d'interface : création d'éléments, tableaux, modales, formulaires.

import { montant as fMontant } from './format.js';

export function h(balise, attributs = {}, enfants = []) {
  const element = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (cle === 'class') element.className = valeur;
    else if (cle === 'html') element.innerHTML = valeur;
    else if (cle === 'texte') element.textContent = valeur;
    else if (cle.startsWith('on') && typeof valeur === 'function') {
      element.addEventListener(cle.slice(2).toLowerCase(), valeur);
    } else if (cle === 'valeur') element.value = valeur;
    else if (valeur === true) element.setAttribute(cle, '');
    else element.setAttribute(cle, valeur);
  }
  for (const enfant of [].concat(enfants)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    element.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return element;
}

export function vider(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

// ------------------------------------------------ cadres repliables (v50)
// Chaque carte se replie d'un clic sur son titre ; l'état est mémorisé sur
// l'appareil, page par page (clé « page|titre »). Par défaut, la page
// Paramètres est repliée sauf « Identité » ; ailleurs tout est déplié.

const CLE_REPLIS = 'lmnp-replis';
let pageRepli = '';

const lireReplis = () => { try { return JSON.parse(localStorage.getItem(CLE_REPLIS) || '{}') || {}; } catch { return {}; } };
const ecrireRepli = (cle, replie) => {
  try {
    const replis = lireReplis();
    replis[cle] = Boolean(replie);
    localStorage.setItem(CLE_REPLIS, JSON.stringify(replis));
  } catch { /* stockage indisponible : l'état ne survit pas au redessin */ }
};

/** La page en cours de rendu (app.js), pour distinguer les cartes de même titre. */
export function definirPageRepli(cle) { pageRepli = String(cle || ''); }
export const pageRepliCourante = () => pageRepli;

/** Replié par défaut ? Paramètres : tout sauf « Identité » ; ailleurs : rien. */
const repliParDefaut = (page, titre) => page === 'parametres' && titre !== 'Identité';

export function estReplie(cle, titre = '', defaut = null) {
  const replis = lireReplis();
  if (Object.prototype.hasOwnProperty.call(replis, cle)) return Boolean(replis[cle]);
  return defaut === null ? repliParDefaut(pageRepli, titre) : Boolean(defaut);
}

/** Applique l'état replié à une carte déjà construite. */
function appliquerRepli(section, replie, { memoriser = true } = {}) {
  section.classList.toggle('repliee', replie);
  const chevron = section.querySelector(':scope > .carte-entete .carte-chevron');
  if (chevron) { chevron.textContent = replie ? '▸' : '▾'; chevron.setAttribute('aria-expanded', replie ? 'false' : 'true'); chevron.title = replie ? 'Déplier' : 'Replier'; }
  if (memoriser && section.dataset.repli) ecrireRepli(section.dataset.repli, replie);
}

/**
 * Une carte : titre, aide, boutons d'action, corps.
 *   resume    : texte affiché sur la ligne du titre quand la carte est repliée (à défaut, l'aide)
 *   repliable : false pour une carte toujours ouverte (sans titre : jamais repliable)
 *   cle       : identifiant de mémoire (à défaut le titre)
 */
/**
 *   repliParDefaut : true/false pour imposer l'état initial de cette carte
 *                    (tant que l'utilisateur ne l'a pas repliée ou dépliée lui-même)
 */
export function carte({ titre, aide, actions = [], corps, serre = false, resume = '', repliable = true, cle = '', repliParDefaut: defaut = null }) {
  const peutReplier = Boolean(repliable && titre);
  const cleRepli = peutReplier ? `${pageRepli}|${cle || titre}` : '';
  const chevron = peutReplier ? h('button', { class: 'carte-chevron', type: 'button', 'aria-label': 'Replier ou déplier' }, '▾') : null;
  const bloc = h('div', { class: 'carte-titre' }, [
    chevron,
    h('div', { class: 'carte-titre-textes' }, [
      titre ? h('h2', { texte: titre }) : null,
      aide ? h('div', { class: 'aide', texte: aide }) : null,
      peutReplier ? h('div', { class: 'carte-resume', texte: resume || aide || '' }) : null,
    ]),
  ]);
  const entete = (titre || actions.length)
    ? h('div', { class: 'carte-entete' }, [bloc, actions.length ? h('div', { class: 'groupe-boutons' }, actions) : null])
    : null;
  const section = h('section', { class: 'carte' }, [entete, h('div', { class: `carte-corps${serre ? ' serre' : ''}` }, corps)]);
  if (peutReplier) {
    section.dataset.repli = cleRepli;
    const basculer = () => appliquerRepli(section, !section.classList.contains('repliee'));
    bloc.classList.add('cliquable');
    bloc.addEventListener('click', (evenement) => {
      if (evenement.target.closest('a, input, select, textarea, .bouton, .groupe-boutons')) return;
      basculer();
    });
    appliquerRepli(section, estReplie(cleRepli, titre, defaut), { memoriser: false });
  }
  return section;
}

/** Replie ou déplie toutes les cartes repliables d'un conteneur (barre « Tout replier / Tout déplier »). */
export function replierToutes(conteneur, replie) {
  for (const section of conteneur.querySelectorAll('section.carte[data-repli]')) appliquerRepli(section, replie);
  for (const groupe of conteneur.querySelectorAll('.groupe-repliable[data-repli]')) appliquerGroupe(groupe, replie);
}

/** Barre « Tout replier / Tout déplier » (pages d'au moins trois cartes). */
export function barreReplis(conteneur) {
  return h('div', { class: 'barre-replis' }, [
    bouton('Tout replier', () => replierToutes(conteneur, true), { petit: true, type: 'discret', titre: 'Replie tous les cadres de la page' }),
    bouton('Tout déplier', () => replierToutes(conteneur, false), { petit: true, type: 'discret', titre: 'Déplie tous les cadres de la page' }),
  ]);
}

function appliquerGroupe(groupe, replie, { memoriser = true } = {}) {
  groupe.classList.toggle('repliee', replie);
  const chevron = groupe.querySelector(':scope > .groupe-entete .carte-chevron');
  if (chevron) { chevron.textContent = replie ? '▸' : '▾'; chevron.setAttribute('aria-expanded', replie ? 'false' : 'true'); }
  if (memoriser && groupe.dataset.repli) ecrireRepli(groupe.dataset.repli, replie);
}

/**
 * Un groupe repliable (bandeau d'un logement et ses cartes) : `entete` est le
 * bandeau (un chevron y est ajouté), `cle` l'identifiant de mémoire.
 * Renvoie { element, corps } : ajoutez les cartes dans `corps`.
 */
export function groupeRepliable({ entete, cle }) {
  const cleRepli = `${pageRepli}|groupe:${cle}`;
  const chevron = h('button', { class: 'carte-chevron', type: 'button', 'aria-label': 'Replier ou déplier' }, '▾');
  entete.prepend(chevron);
  entete.classList.add('groupe-entete', 'cliquable');
  const corps = h('div', { class: 'groupe-corps' });
  const element = h('div', { class: 'groupe-repliable', 'data-repli': cleRepli }, [entete, corps]);
  entete.addEventListener('click', (evenement) => {
    if (evenement.target.closest('a, input, select, textarea, .bouton, .groupe-boutons')) return;
    appliquerGroupe(element, !element.classList.contains('repliee'));
  });
  appliquerGroupe(element, estReplie(cleRepli, ''), { memoriser: false });
  return { element, corps };
}

export function tuile({ libelle, valeur, detail, ton = 'neutre' }) {
  return h('div', { class: `tuile ${ton}` }, [
    h('div', { class: 'tuile-libelle', texte: libelle }),
    h('div', { class: 'tuile-valeur', texte: valeur }),
    detail ? h('div', { class: 'tuile-detail', texte: detail }) : null,
  ]);
}

export function bouton(libelle, action, options = {}) {
  const classes = ['bouton'];
  if (options.type === 'primaire') classes.push('bouton-primaire');
  if (options.type === 'danger') classes.push('bouton-danger');
  if (options.type === 'discret') classes.push('bouton-discret');
  if (options.petit) classes.push('bouton-petit');
  return h('button', {
    class: classes.join(' '),
    type: 'button',
    title: options.titre,
    disabled: options.desactive,
    onclick: action,
  }, libelle);
}

export function badge(texte, ton = 'attente') {
  return h('span', { class: `badge badge-${ton}`, texte });
}

export function vide(titre, texte) {
  return h('div', { class: 'vide' }, [h('strong', { texte: titre }), texte || null]);
}

/**
 * Tableau générique.
 * colonnes : [{ titre, valeur(ligne), nombre?, classe?, largeur? }]
 */
export function tableau({ colonnes, lignes, pied, messageVide = 'Aucune donnée.', cle }) {
  if (!lignes.length) return vide(messageVide, null);
  const enTete = h('tr', {}, colonnes.map((c) => h('th', {
    class: [c.nombre ? 'nombre' : '', c.actions ? 'actions' : ''].filter(Boolean).join(' ') || null,
    texte: c.titre,
  })));
  const corps = lignes.map((ligne, index) => {
    const tr = h('tr', { class: ligne.__classe || null, 'data-cle': cle ? cle(ligne) : index }, colonnes.map((c) => {
      const contenu = c.valeur(ligne, index);
      return h('td', {
        class: [c.nombre ? 'nombre' : '', c.actions ? 'actions' : '', c.classe?.(ligne) || ''].filter(Boolean).join(' ') || null,
      }, contenu instanceof Node || Array.isArray(contenu) ? contenu : String(contenu ?? ''));
    }));
    return tr;
  });
  return h('div', { class: 'tableau-defilant' }, [
    h('table', {}, [
      h('thead', {}, enTete),
      h('tbody', {}, corps),
      pied ? h('tfoot', {}, pied) : null,
    ]),
  ]);
}

export function ligneTotal(colonnes, valeurs) {
  return h('tr', {}, colonnes.map((c, i) => h('td', {
    class: c.nombre ? 'nombre' : (c.actions ? 'actions' : null),
  }, valeurs[i] ?? '')));
}

// ---------------------------------------------------------------- messages

// Journal des dernières erreurs (les notifications disparaissent vite ; le
// journal reste consultable dans Paramètres → Stockage).
const journal = [];
export const journalErreurs = () => journal.slice().reverse();
const consigner = (message, code = '') => {
  journal.push({ quand: new Date().toISOString().slice(11, 19), message: String(message), code });
  if (journal.length > 30) journal.shift();
};

export function notifier(message, ton = '') {
  if (ton === 'erreur') consigner(message);
  const zone = document.getElementById('notifications');
  const element = h('div', { class: `notification ${ton}`.trim(), texte: message });
  zone.append(element);
  setTimeout(() => {
    element.style.transition = 'opacity .3s';
    element.style.opacity = '0';
    setTimeout(() => element.remove(), 320);
  }, ton === 'erreur' ? 6500 : 3200);
}

export const signalerErreur = (erreur) => {
  console.error(erreur);
  const code = erreur?.code ? ` [${erreur.code}]` : '';
  notifier(`${erreur?.message || String(erreur)}${code}`, 'erreur');
};

// ---------------------------------------------------------------- modales

let fermerModaleCourante = null;

export function ouvrirModale({ titre, corps, pied, large = false, surFermeture }) {
  const fond = document.getElementById('fond-modale');
  vider(fond);
  let ferme = false;
  const fermer = ({ valide = false } = {}) => {
    if (ferme) return;
    ferme = true;
    fond.hidden = true;
    vider(fond);
    fermerModaleCourante = null;
    document.removeEventListener('keydown', surTouche);
    // Fermeture par ✕, Échap ou clic hors modale : prévenir l'appelant pour
    // qu'il résolve sa promesse (annulation), sans quoi elle resterait pendante.
    if (!valide && surFermeture) surFermeture();
  };
  const surTouche = (evenement) => { if (evenement.key === 'Escape') fermer(); };
  fermerModaleCourante = fermer;

  const modale = h('div', { class: `modale${large ? ' large' : ''}` }, [
    h('div', { class: 'modale-entete' }, [
      h('h2', { texte: titre }),
      bouton('✕', fermer, { type: 'discret', petit: true }),
    ]),
    h('div', { class: 'modale-corps' }, corps),
    pied ? h('div', { class: 'modale-pied' }, pied) : null,
  ]);
  fond.append(modale);
  fond.hidden = false;
  document.addEventListener('keydown', surTouche);
  fond.onclick = (evenement) => { if (evenement.target === fond) fermer(); };
  return fermer;
}

export function fermerModale() { if (fermerModaleCourante) fermerModaleCourante(); }

export function confirmer({ titre, message, libelleValider = 'Confirmer', danger = false }) {
  return new Promise((resoudre) => {
    let repondu = false;
    const repondre = (valeur) => { if (!repondu) { repondu = true; resoudre(valeur); } };
    const fermer = ouvrirModale({
      titre,
      corps: h('p', { texte: message }),
      surFermeture: () => repondre(false),
      pied: [
        bouton('Annuler', () => { fermer(); repondre(false); }),
        bouton(libelleValider, () => { fermer({ valide: true }); repondre(true); }, { type: danger ? 'danger' : 'primaire' }),
      ],
    });
  });
}

// ------------------------------------------------------------- formulaires

/**
 * Formulaire en modale.
 * champs : [{ cle, libelle, type, options, requis, aide, largeur:'pleine', pas, min, max, quand(valeurs) }]
 * types : texte, zone, nombre, montant, pourcentage, date, mois, annee, liste, case, entier
 * Résout avec l'objet de valeurs, ou null si annulation.
 */
export function formulaire({ titre, champs, valeurs = {}, libelleValider = 'Enregistrer', large = false, aide }) {
  return new Promise((resoudre) => {
    const etat = { ...valeurs };
    const conteneur = h('div', { class: 'grille-champs' });
    let fermer = null;

    const dessiner = () => {
      // On mémorise le champ actif et la position du curseur : le redessin
      // recrée les contrôles, il faut rendre le focus sinon la saisie au
      // clavier est interrompue à chaque champ « rafraichit ».
      const actif = document.activeElement;
      const idActif = actif && actif.id;
      let curseur = null;
      try { curseur = actif ? actif.selectionStart : null; } catch { curseur = null; }
      vider(conteneur);
      for (const champ of champs) {
        if (champ.quand && !champ.quand(etat)) continue;
        conteneur.append(rendreChamp(champ, etat, dessiner));
      }
      if (idActif) {
        const repris = conteneur.querySelector(`#${(window.CSS && CSS.escape) ? CSS.escape(idActif) : idActif}`);
        if (repris) {
          repris.focus();
          try { if (curseur !== null) repris.setSelectionRange(curseur, curseur); } catch { /* type sans sélection */ }
        }
      }
    };

    const valider = () => {
      let valide = true;
      for (const champ of champs) {
        if (champ.quand && !champ.quand(etat)) continue;
        const valeur = etat[champ.cle];
        const manquant = valeur === '' || valeur === null || valeur === undefined || (typeof valeur === 'number' && Number.isNaN(valeur));
        if (champ.requis && manquant) {
          valide = false;
          const bloc = conteneur.querySelector(`[data-champ="${champ.cle}"]`);
          if (bloc) {
            bloc.classList.add('invalide');
            if (!bloc.querySelector('.champ-erreur')) bloc.append(h('div', { class: 'champ-erreur', texte: 'Ce champ est obligatoire.' }));
          }
        }
      }
      if (!valide) { notifier('Complétez les champs obligatoires.', 'erreur'); return; }
      fermer({ valide: true });
      repondre(etat);
    };

    let repondu = false;
    const repondre = (valeur) => { if (!repondu) { repondu = true; resoudre(valeur); } };

    dessiner();
    fermer = ouvrirModale({
      titre,
      large,
      corps: [aide ? h('p', { class: 'legende', texte: aide }) : null, conteneur],
      surFermeture: () => repondre(null),
      pied: [
        bouton('Annuler', () => { fermer(); repondre(null); }),
        bouton(libelleValider, valider, { type: 'primaire' }),
      ],
    });
  });
}

function rendreChamp(champ, etat, redessiner) {
  const valeur = etat[champ.cle];
  const classes = ['champ'];
  if (champ.largeur === 'pleine' || champ.type === 'zone') classes.push('pleine-largeur');
  if (champ.type === 'case') classes.push('champ-case', 'pleine-largeur');

  const identifiant = `champ-${champ.cle}`;
  let controle;

  const surSaisie = (convertir) => (evenement) => {
    etat[champ.cle] = convertir(evenement.target);
    const bloc = evenement.target.closest('.champ');
    bloc?.classList.remove('invalide');
    bloc?.querySelector('.champ-erreur')?.remove();
    if (champ.apres) champ.apres(etat);
    if (champ.rafraichit) redessiner();
  };

  switch (champ.type) {
    case 'zone':
      controle = h('textarea', { id: identifiant, oninput: surSaisie((c) => c.value) }, valeur ?? '');
      break;
    case 'liste': {
      const options = champ.options || [];
      // Si la valeur courante ne correspond à aucune option, le navigateur
      // affiche la première : on aligne l'état dessus, sinon un formulaire à
      // une seule option (« change » jamais émis) reste bloqué à la validation.
      if (options.length && !options.some((o) => String(o.valeur) === String(valeur ?? ''))) {
        etat[champ.cle] = champ.numerique ? Number(options[0].valeur) : options[0].valeur;
      }
      controle = h('select', {
        id: identifiant,
        onchange: surSaisie((c) => (champ.numerique ? Number(c.value) : c.value)),
      }, options.map((o) => h('option', {
        value: o.valeur,
        selected: String(o.valeur) === String(etat[champ.cle] ?? ''),
      }, o.libelle)));
      break;
    }
    case 'case':
      controle = h('input', {
        id: identifiant, type: 'checkbox', checked: !!valeur,
        onchange: surSaisie((c) => c.checked),
      });
      break;
    case 'nombre':
    case 'montant':
    case 'pourcentage':
    case 'entier':
      controle = h('input', {
        id: identifiant, type: 'number',
        step: champ.pas ?? (champ.type === 'entier' ? '1' : '0.01'),
        min: champ.min, max: champ.max,
        value: valeur ?? '',
        oninput: surSaisie((c) => (c.value === '' ? null : Number(c.value))),
      });
      break;
    case 'date':
      controle = h('input', { id: identifiant, type: 'date', value: valeur ?? '', oninput: surSaisie((c) => c.value) });
      break;
    case 'motdepasse':
      controle = h('input', {
        id: identifiant, type: 'password', value: valeur ?? '',
        autocomplete: 'new-password', oninput: surSaisie((c) => c.value),
      });
      break;
    case 'mois':
      controle = h('input', { id: identifiant, type: 'month', value: valeur ?? '', oninput: surSaisie((c) => c.value) });
      break;
    default:
      controle = h('input', {
        id: identifiant, type: 'text', value: valeur ?? '',
        placeholder: champ.exemple, oninput: surSaisie((c) => c.value),
      });
  }

  if (champ.type === 'case') {
    return h('div', { class: classes.join(' '), 'data-champ': champ.cle }, [
      controle, h('label', { for: identifiant, texte: champ.libelle }),
    ]);
  }
  return h('div', { class: classes.join(' '), 'data-champ': champ.cle }, [
    h('label', { for: identifiant, texte: champ.libelle + (champ.requis ? ' *' : '') }),
    controle,
    champ.aide ? h('div', { class: 'champ-aide', texte: champ.aide }) : null,
  ]);
}

// ------------------------------------------------------------------ divers

export function barreOutils(elements) {
  return h('div', { class: 'barre-outils' }, elements);
}

export function champRecherche(placeholder, surChangement, valeurInitiale = '') {
  // La valeur courante est réappliquée : sinon, à chaque redessin, le champ
  // réapparaît vide alors que le filtre reste actif — les lignes semblent
  // avoir disparu.
  return h('input', {
    class: 'recherche', type: 'search', placeholder, value: valeurInitiale,
    oninput: (e) => surChangement(e.target.value.toLowerCase().trim()),
  });
}

export const cellMontant = (valeur) => fMontant(valeur);

/** Exécute une action d'enregistrement en signalant le succès ou l'échec. */
export async function executer(promesse, messageSucces) {
  try {
    const resultat = await promesse;
    if (messageSucces) notifier(messageSucces, 'succes');
    return resultat;
  } catch (erreur) {
    signalerErreur(erreur);
    return null;
  }
}

/**
 * Ouvre le sélecteur de fichiers du système et renvoie le fichier choisi.
 * `camera: true` ouvre directement l'appareil photo sur tablette et téléphone.
 */
export function choisirFichier({ accept = '', multiple = false, camera = false } = {}) {
  return new Promise((resoudre) => {
    const entree = h('input', { type: 'file', accept, multiple, capture: camera ? 'environment' : null, style: 'display:none' });
    entree.addEventListener('change', () => {
      const fichiers = Array.from(entree.files || []);
      entree.remove();
      resoudre(multiple ? fichiers : (fichiers[0] || null));
    });
    document.body.append(entree);
    entree.click();
  });
}
