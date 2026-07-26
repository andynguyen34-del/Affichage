// Petits utilitaires d'interface : creation de noeuds, formulaires, modales,
// notifications. Volontairement sans dependance externe.

export function h(tag, attrs = {}, ...enfants) {
  const node = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attrs || {})) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (cle === 'class') node.className = valeur;
    else if (cle === 'html') node.innerHTML = valeur;
    else if (cle === 'text') node.textContent = valeur;
    else if (cle === 'dataset') Object.assign(node.dataset, valeur);
    else if (cle === 'style') Object.assign(node.style, valeur);
    else if (cle.startsWith('on') && typeof valeur === 'function') {
      node.addEventListener(cle.slice(2).toLowerCase(), valeur);
    } else if (valeur === true) node.setAttribute(cle, '');
    else node.setAttribute(cle, valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    node.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return node;
}

export function vider(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// --- Notifications ---------------------------------------------------------

export function notifier(message, statut = 'bon') {
  const zone = document.getElementById('notifications');
  const note = h('div', { class: `notification etat-${statut}`, text: message });
  zone.append(note);
  setTimeout(() => {
    note.style.opacity = '0';
    note.style.transition = 'opacity 300ms';
    setTimeout(() => note.remove(), 320);
  }, statut === 'alerte' ? 8000 : 4000);
}

export function erreur(e) {
  notifier(e instanceof Error ? e.message : String(e), 'alerte');
}

// --- Champs de formulaire --------------------------------------------------

export function champ(label, controle, aide) {
  return h('div', { class: 'champ' }, h('label', { text: label }), controle, aide ? h('div', { class: 'aide', text: aide }) : null);
}

export function saisie(valeur, attrs = {}) {
  return h('input', { value: valeur ?? '', ...attrs });
}

export function selection(valeur, options, attrs = {}) {
  const select = h('select', attrs);
  for (const opt of options) {
    const [v, libelle] = Array.isArray(opt) ? opt : [opt.value, opt.label];
    select.append(h('option', { value: v, selected: String(v) === String(valeur ?? '') }, libelle));
  }
  select.value = valeur ?? '';
  return select;
}

export function caseACocher(id, label, coche) {
  return h(
    'div',
    { class: 'case' },
    h('input', { type: 'checkbox', id, checked: !!coche }),
    h('label', { for: id, text: label }),
  );
}

/** Lit les valeurs d'un formulaire a partir des attributs `name`. */
export function lireFormulaire(racine) {
  const valeurs = {};
  for (const el of racine.querySelectorAll('[name]')) {
    valeurs[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return valeurs;
}

// --- Modale ----------------------------------------------------------------

/**
 * Ouvre une fenetre modale.
 * @param {object} options
 * @param {string} options.titre
 * @param {Node}   options.corps
 * @param {Array}  [options.actions] boutons du pied (Node)
 * @param {boolean}[options.large]
 * @returns {{fermer: Function, element: HTMLElement}}
 */
export function modale({ titre, corps, actions = [], large = false }) {
  const voile = h('div', { class: 'voile' });
  const fermer = () => {
    voile.remove();
    document.removeEventListener('keydown', surTouche);
  };
  const surTouche = (e) => {
    if (e.key === 'Escape') fermer();
  };
  document.addEventListener('keydown', surTouche);

  const fenetre = h(
    'div',
    { class: `modale${large ? ' large' : ''}` },
    h(
      'header',
      {},
      h('h2', { text: titre }),
      h('button', { class: 'discret', onClick: fermer, title: 'Fermer' }, '✕'),
    ),
    h('div', { class: 'corps' }, corps),
    actions.length ? h('footer', {}, actions) : null,
  );

  voile.addEventListener('click', (e) => {
    if (e.target === voile) fermer();
  });
  voile.append(fenetre);
  document.body.append(voile);

  const premier = fenetre.querySelector('input, select, textarea');
  if (premier) premier.focus();

  return { fermer, element: fenetre };
}

export function confirmer(message, { titreBouton = 'Supprimer', danger = true } = {}) {
  return new Promise((resolve) => {
    const boiteRef = {};
    const annuler = h('button', { onClick: () => { boiteRef.fermer(); resolve(false); } }, 'Annuler');
    const valider = h(
      'button',
      {
        class: danger ? 'danger' : 'principal',
        onClick: () => { boiteRef.fermer(); resolve(true); },
      },
      titreBouton,
    );
    const boite = modale({
      titre: 'Confirmation',
      corps: h('p', { text: message }),
      actions: [annuler, valider],
    });
    boiteRef.fermer = boite.fermer;
    valider.focus();
  });
}

// --- Tableaux --------------------------------------------------------------

export function tableau(colonnes, lignes, { messageVide = 'Aucun element.' } = {}) {
  if (!lignes.length) return h('div', { class: 'vide', text: messageVide });
  const table = h('table', { class: 'liste' });
  table.append(h('thead', {}, h('tr', {}, colonnes.map((c) => h('th', { text: c })))));
  table.append(h('tbody', {}, lignes.map((cellules) => h('tr', {}, cellules.map((c) => (c instanceof HTMLTableCellElement ? c : h('td', {}, c)))))));
  return table;
}

export function cellule(contenu, attrs = {}) {
  return h('td', attrs, contenu);
}
