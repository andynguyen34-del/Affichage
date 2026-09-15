// Mise à jour des échéances et des dépôts de garantie (v43) : fenêtre et
// bandeau partagés par les pages Loyers et Cautions. Le calcul est dans
// calculs/maj-echeances.js ; ici l'interface et l'application des choix.

import * as etat from '../etat.js';
import { h, bouton, badge, confirmer, executer, notifier, ouvrirModale, fermerModale, signalerErreur } from '../ui.js';
import { nomMois } from '../format.js';
import { analyserEcheances, analyserCautions, grouperPropositions, resumerPropositions } from '../calculs/maj-echeances.js';

// ------------------------------------------------- mise à jour des échéances

/**
 * Les échéances enregistrées ne suivent pas les modifications du bail
 * (colocataire retiré, bail supprimé, part changée) : cette fenêtre propose
 * de supprimer les orphelines, de réaligner les montants, et de conserver
 * celles qui portent un virement ou une quittance — sauf si l'on coche
 * « supprimer quand même » (double confirmation).
 */
export async function ouvrirMiseAJour(donnees) {
  const propositions = [...analyserEcheances({ baux: donnees.baux, loyers: donnees.loyers }), ...analyserCautions({ baux: donnees.baux, cautions: donnees.cautions || [] })];
  const groupes = grouperPropositions(propositions);
  const nomDuLocataire = (id) => { const l = donnees.locataires.find((x) => x.id === id); return l ? `${l.nom} ${l.prenom || ''}`.trim() : 'Locataire inconnu'; };
  const logementDuBail = (bailId) => { const b = donnees.baux.find((x) => x.id === bailId); const bien = b && donnees.biens.find((x) => x.id === b.bienId); return bien?.nom || (b ? 'Bail' : 'Bail supprimé'); };
  const periode = (elements) => {
    if (elements[0]?.nature === 'caution') return `dépôt de garantie${elements.length > 1 ? ` (${elements.length})` : ''}`;
    const tri = [...elements].sort((a, b) => (a.annee - b.annee) || (a.mois - b.mois));
    const premier = tri[0];
    const dernier = tri[tri.length - 1];
    if (tri.length === 1) return `${nomMois(premier.mois)} ${premier.annee}`;
    return `${nomMois(premier.mois)}${premier.annee !== dernier.annee ? ` ${premier.annee}` : ''} → ${nomMois(dernier.mois)} ${dernier.annee} (${tri.length})`;
  };
  if (!groupes.length) {
    ouvrirModale({
      titre: 'Mettre à jour les échéances',
      corps: h('p', { texte: 'Rien à corriger : toutes les échéances et dépôts de garantie enregistrés correspondent aux baux.' }),
      pied: [h('button', { class: 'bouton bouton-primaire', type: 'button', onclick: () => fermerModale() }, 'Fermer')],
    });
    return;
  }
  const cases = new Map();
  const libelleAction = { supprimer: ['Supprimer', 'alerte'], realigner: ['Réaligner le montant', 'attente'], conserver: ['Conserver', 'attention'] };
  const lignes = groupes.map((g) => {
    const [libelle, ton] = libelleAction[g.action];
    const caseACocher = h('input', { type: 'checkbox', checked: g.action !== 'conserver' ? true : null, 'data-groupe': g.cle });
    cases.set(g.cle, caseACocher);
    return h('tr', {}, [
      h('td', {}, [h('label', {}, [caseACocher, h('span', { texte: g.action === 'conserver' ? 'supprimer quand même' : 'appliquer' })])]),
      h('td', {}, [h('strong', { texte: nomDuLocataire(g.locataireId) }), h('div', { class: 'legende', texte: `${logementDuBail(g.bailId)} · ${periode(g.elements)}` })]),
      h('td', { texte: g.raison }),
      h('td', {}, [badge(libelle, ton), h('div', { class: 'legende', texte: g.protege ? `${g.protege} : reste visible « ${g.nature === 'caution' ? 'bail supprimé' : 'hors bail'} » si conservé(e)` : (g.action === 'realigner' ? 'aucun virement ni quittance' : 'aucun virement, aucune quittance') })]),
    ]);
  });
  const boutonAppliquer = h('button', { class: 'bouton bouton-primaire', type: 'button' }, 'Appliquer');
  const compter = () => {
    let suppressions = 0; let realignements = 0;
    for (const g of groupes) {
      if (!cases.get(g.cle).checked) continue;
      if (g.action === 'realigner') realignements += g.elements.length; else suppressions += g.elements.length;
    }
    boutonAppliquer.textContent = `Appliquer (${suppressions} suppression${suppressions > 1 ? 's' : ''}, ${realignements} réalignement${realignements > 1 ? 's' : ''})`;
    boutonAppliquer.disabled = !suppressions && !realignements;
  };
  for (const c of cases.values()) c.addEventListener('change', compter);
  compter();
  boutonAppliquer.onclick = async () => {
    const choisis = groupes.filter((g) => cases.get(g.cle).checked);
    const proteges = choisis.filter((g) => g.protege);
    fermerModale();
    if (proteges.length) {
      const n = proteges.reduce((s, g) => s + g.elements.length, 0);
      const ok = await confirmer({
        titre: 'Supprimer des échéances avec virement ou quittance',
        message: `${n} échéance(s) portent un virement enregistré ou une quittance émise. Les virements enregistrés seront perdus et les quittances déjà envoyées ne seront pas rappelées. Supprimer quand même ?`,
        libelleValider: 'Supprimer quand même', danger: true,
      });
      if (!ok) return;
    }
    const echeances = choisis.filter((g) => g.nature !== 'caution');
    const cautions = choisis.filter((g) => g.nature === 'caution');
    const aSupprimer = new Set(echeances.filter((g) => g.action !== 'realigner').flatMap((g) => g.elements.map((e) => e.id)));
    const aRealigner = new Map(echeances.filter((g) => g.action === 'realigner').flatMap((g) => g.elements.map((e) => [e.id, e.nouveau])));
    const cautionsASupprimer = new Set(cautions.flatMap((g) => g.elements.map((e) => e.id)));
    if (aSupprimer.size || aRealigner.size) {
      const tous = etat.liste('loyers');
      const nouvelle = tous.filter((l) => !aSupprimer.has(l.id)).map((l) => (aRealigner.has(l.id) ? { ...l, ...aRealigner.get(l.id) } : l));
      await etat.remplacerCollection('loyers', nouvelle);
    }
    if (cautionsASupprimer.size) {
      await etat.remplacerCollection('cautions', etat.liste('cautions').filter((c) => !cautionsASupprimer.has(c.id)));
    }
    notifier(`Mise à jour faite : ${aSupprimer.size} échéance(s) supprimée(s), ${aRealigner.size} réalignée(s), ${cautionsASupprimer.size} dépôt(s) de garantie supprimé(s).`, 'succes');
  };
  ouvrirModale({
    titre: 'Mettre à jour les échéances',
    large: true,
    corps: h('div', { class: 'maj-echeances' }, [
      h('p', { class: 'legende', texte: 'Les échéances enregistrées (quittance, virement, montant ajusté, appel de loyer) ne suivent pas les modifications d’un bail. Voici celles qui ne correspondent plus : cochez ce qui doit être appliqué.' }),
      h('table', {}, [
        h('thead', {}, h('tr', {}, ['', 'Échéance', 'Pourquoi', 'Proposition'].map((t) => h('th', { texte: t })))),
        h('tbody', {}, lignes),
      ]),
    ]),
    pied: [h('button', { class: 'bouton', type: 'button', onclick: () => fermerModale() }, 'Annuler'), boutonAppliquer],
  });
}

/** Bandeau de la page Loyers quand des échéances ne correspondent plus aux baux. */
export function bandeauMiseAJour(donnees) {
  const propositions = [...analyserEcheances({ baux: donnees.baux, loyers: donnees.loyers }), ...analyserCautions({ baux: donnees.baux, cautions: donnees.cautions || [] })];
  if (!propositions.length) return null;
  const compte = resumerPropositions(propositions);
  const noms = [...new Set(propositions.map((p) => donnees.locataires.find((l) => l.id === p.locataireId)?.nom || 'Locataire inconnu'))];
  const detail = [
    compte.supprimer ? `${compte.supprimer} à supprimer` : '',
    compte.realigner ? `${compte.realigner} à réaligner` : '',
    compte.conserver ? `${compte.conserver} avec virement, quittance ou dépôt détenu` : '',
  ].filter(Boolean).join(', ');
  return h('div', { class: 'alerte alerte-attention alerte-echeances' }, [
    h('div', {}, [
      h('strong', { texte: `${propositions.length} ${propositions.some((p) => p.nature === 'caution') ? 'ligne' : 'échéance'}${propositions.length > 1 ? 's' : ''} ne correspond${propositions.length > 1 ? 'ent' : ''} plus aux baux` }),
      h('div', { class: 'legende', texte: `${noms.join(', ')} — ${detail}.` }),
    ]),
    bouton('Mettre à jour…', () => ouvrirMiseAJour(donnees).catch(signalerErreur), { petit: true, type: 'primaire' }),
  ]);
}

