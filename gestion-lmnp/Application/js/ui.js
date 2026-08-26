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

export function carte({ titre, aide, actions = [], corps, serre = false }) {
  const entete = (titre || actions.length)
    ? h('div', { class: 'carte-entete' }, [
      h('div', {}, [titre ? h('h2', { texte: titre }) : null, aide ? h('div', { class: 'aide', texte: aide }) : null]),
      actions.length ? h('div', { class: 'groupe-boutons' }, actions) : null,
    ])
    : null;
  return h('section', { class: 'carte' }, [entete, h('div', { class: `carte-corps${serre ? ' serre' : ''}` }, corps)]);
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

export function notifier(message, ton = '') {
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
  notifier(erreur?.message || String(erreur), 'erreur');
};

// ---------------------------------------------------------------- modales

let fermerModaleCourante = null;

export function ouvrirModale({ titre, corps, pied, large = false }) {
  const fond = document.getElementById('fond-modale');
  vider(fond);
  const fermer = () => {
    fond.hidden = true;
    vider(fond);
    fermerModaleCourante = null;
    document.removeEventListener('keydown', surTouche);
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
    const fermer = ouvrirModale({
      titre,
      corps: h('p', { texte: message }),
      pied: [
        bouton('Annuler', () => { fermer(); resoudre(false); }),
        bouton(libelleValider, () => { fermer(); resoudre(true); }, { type: danger ? 'danger' : 'primaire' }),
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
      vider(conteneur);
      for (const champ of champs) {
        if (champ.quand && !champ.quand(etat)) continue;
        conteneur.append(rendreChamp(champ, etat, dessiner));
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
      fermer();
      resoudre(etat);
    };

    dessiner();
    fermer = ouvrirModale({
      titre,
      large,
      corps: [aide ? h('p', { class: 'legende', texte: aide }) : null, conteneur],
      pied: [
        bouton('Annuler', () => { fermer(); resoudre(null); }),
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
    case 'liste':
      controle = h('select', {
        id: identifiant,
        onchange: surSaisie((c) => (champ.numerique ? Number(c.value) : c.value)),
      }, (champ.options || []).map((o) => h('option', {
        value: o.valeur,
        selected: String(o.valeur) === String(valeur ?? ''),
      }, o.libelle)));
      break;
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
        oninput: surSaisie((c) => (c.value === '' ? '' : Number(c.value))),
      });
      break;
    case 'date':
      controle = h('input', { id: identifiant, type: 'date', value: valeur ?? '', oninput: surSaisie((c) => c.value) });
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

export function champRecherche(placeholder, surChangement) {
  return h('input', {
    class: 'recherche', type: 'search', placeholder,
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

/** Ouvre le sélecteur de fichiers du système et renvoie le fichier choisi. */
export function choisirFichier({ accept = '', multiple = false } = {}) {
  return new Promise((resoudre) => {
    const entree = h('input', { type: 'file', accept, multiple, style: 'display:none' });
    entree.addEventListener('change', () => {
      const fichiers = Array.from(entree.files || []);
      entree.remove();
      resoudre(multiple ? fichiers : (fichiers[0] || null));
    });
    document.body.append(entree);
    entree.click();
  });
}
