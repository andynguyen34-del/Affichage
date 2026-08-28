// Pavé de signature : on signe au doigt ou à la souris dans une fenêtre,
// le résultat est une image PNG (data URL) à poser sur les documents.

import { h, ouvrirModale, fermerModale } from './ui.js';

/**
 * Ouvre le pavé et renvoie la signature en data URL PNG, ou null si annulé.
 */
export function demanderSignature({ titre = 'Signature', nom = '' } = {}) {
  return new Promise((resoudre) => {
    const canevas = h('canvas', {
      width: 560, height: 220,
      style: 'width:100%;max-width:560px;border:1px dashed var(--bordure-forte);border-radius:8px;'
        + 'background:#fff;touch-action:none;cursor:crosshair;display:block',
    });
    const contexte = canevas.getContext('2d');
    contexte.lineWidth = 2.4;
    contexte.lineCap = 'round';
    contexte.lineJoin = 'round';
    contexte.strokeStyle = '#16202b';
    let trace = false;
    let aDessine = false;

    const position = (evenement) => {
      const cadre = canevas.getBoundingClientRect();
      return {
        x: (evenement.clientX - cadre.left) * (canevas.width / cadre.width),
        y: (evenement.clientY - cadre.top) * (canevas.height / cadre.height),
      };
    };
    canevas.addEventListener('pointerdown', (evenement) => {
      evenement.preventDefault();
      canevas.setPointerCapture(evenement.pointerId);
      trace = true;
      const { x, y } = position(evenement);
      contexte.beginPath();
      contexte.moveTo(x, y);
    });
    canevas.addEventListener('pointermove', (evenement) => {
      if (!trace) return;
      evenement.preventDefault();
      const { x, y } = position(evenement);
      contexte.lineTo(x, y);
      contexte.stroke();
      aDessine = true;
    });
    const finir = () => { trace = false; };
    canevas.addEventListener('pointerup', finir);
    canevas.addEventListener('pointercancel', finir);

    let repondu = false;
    const repondre = (valeur) => {
      if (repondu) return;
      repondu = true;
      fermerModale();
      resoudre(valeur);
    };

    ouvrirModale({
      titre: nom ? `${titre} — ${nom}` : titre,
      large: true,
      corps: h('div', {}, [
        h('p', { class: 'legende', style: 'margin-bottom:.6rem',
          texte: 'Signez dans le cadre, au doigt (écran tactile) ou à la souris.' }),
        canevas,
      ]),
      pied: [
        h('button', { class: 'bouton', type: 'button', onclick: () => {
          contexte.clearRect(0, 0, canevas.width, canevas.height);
          aDessine = false;
        } }, 'Effacer'),
        h('button', { class: 'bouton', type: 'button', onclick: () => repondre(null) }, 'Annuler'),
        h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => {
          repondre(aDessine ? canevas.toDataURL('image/png') : null);
        } }, 'Valider la signature'),
      ],
      surFermeture: () => { if (!repondu) { repondu = true; resoudre(null); } },
    });
  });
}
