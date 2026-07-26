import { api } from '../api.js';
import { h, champ, saisie, selection, modale, confirmer, notifier, erreur, tableau, vider } from '../ui.js';
import { horodatage, depuis } from '../../format.js';

/** Explorateur du partage reseau, pour choisir un dossier sans se tromper. */
function explorateur(dossierInitial, onChoisir) {
  const conteneur = h('div');
  const chemin = h('div', { class: 'mono', style: { marginBottom: '0.5rem', fontSize: '0.85rem' } });
  const liste = h('div', { class: 'explorateur' });
  let dossier = dossierInitial || '';

  async function charger() {
    vider(liste).append(h('div', { class: 'vide', text: 'Chargement…' }));
    try {
      const donnees = await api.parcourir(dossier);
      chemin.textContent = `${donnees.root}/${dossier}`.replace(/\/+$/, '') || donnees.root;
      vider(liste);

      if (dossier) {
        liste.append(
          h(
            'div',
            {
              class: 'entree',
              onClick: () => {
                dossier = dossier.split('/').slice(0, -1).join('/');
                charger();
              },
            },
            '📁 ..',
          ),
        );
      }
      for (const nom of donnees.folders) {
        liste.append(
          h(
            'div',
            {
              class: 'entree',
              onClick: () => {
                dossier = dossier ? `${dossier}/${nom}` : nom;
                charger();
                onChoisir(dossier);
              },
            },
            `📁 ${nom}`,
          ),
        );
      }
      for (const f of donnees.files) {
        liste.append(
          h(
            'div',
            { class: 'entree' },
            `📄 ${f.name}`,
            h('span', { class: 'meta', text: `${Math.round(f.size / 1024)} ko · ${horodatage(f.modifiedAt)}` }),
          ),
        );
      }
      if (!donnees.folders.length && !donnees.files.length) {
        liste.append(h('div', { class: 'vide', text: 'Dossier vide (aucun fichier Excel ou CSV).' }));
      }
      onChoisir(dossier);
    } catch (e) {
      vider(liste).append(h('div', { class: 'vide', style: { color: 'var(--alerte)' }, text: e.message }));
    }
  }

  charger();
  conteneur.append(chemin, liste);
  return conteneur;
}

function formulaireSource(source) {
  const valeurs = {
    name: source.name || '',
    folder: source.folder || '',
    pattern: source.pattern || '*.xlsx',
    pick: source.pick || 'latest',
    refresh_minutes: source.refresh_minutes || 15,
    enabled: source.enabled === undefined ? true : !!source.enabled,
  };

  const inputNom = saisie(valeurs.name, { placeholder: 'Production ligne 1', onInput: (e) => (valeurs.name = e.target.value) });
  const inputDossier = saisie(valeurs.folder, {
    class: 'mono',
    placeholder: 'Qualite/Indicateurs',
    onInput: (e) => (valeurs.folder = e.target.value),
  });
  const inputMotif = saisie(valeurs.pattern, {
    class: 'mono',
    onInput: (e) => (valeurs.pattern = e.target.value),
  });
  const selChoix = selection(valeurs.pick, [
    ['latest', 'Le fichier modifie le plus recemment'],
    ['name_desc', 'Le dernier par ordre alphabetique (Z → A)'],
    ['name_asc', 'Le premier par ordre alphabetique (A → Z)'],
  ], { onChange: (e) => (valeurs.pick = e.target.value) });
  const inputFrequence = saisie(valeurs.refresh_minutes, {
    type: 'number',
    min: 1,
    onInput: (e) => (valeurs.refresh_minutes = e.target.value),
  });
  const caseActive = h('input', { type: 'checkbox', id: 'src-active', checked: valeurs.enabled, onChange: (e) => (valeurs.enabled = e.target.checked) });

  const zoneApercu = h('div');

  async function testerApercu() {
    vider(zoneApercu).append(h('p', { class: 'aide', text: 'Recherche du fichier…' }));
    try {
      const donnees = await api.apercuFichier({
        folder: valeurs.folder,
        pattern: valeurs.pattern,
        pick: valeurs.pick,
      });
      vider(zoneApercu).append(
        h(
          'div',
          { class: 'carte', style: { marginBottom: 0 } },
          h('p', {}, h('strong', { text: donnees.file.name }), ` — ${Math.round(donnees.file.size / 1024)} ko, modifie le ${horodatage(donnees.file.modifiedAt)}`),
          donnees.sheets.length
            ? h('p', { class: 'aide', text: `Feuilles : ${donnees.sheets.join(', ')}` })
            : null,
          h('p', { class: 'aide', text: `${donnees.headers.length} colonne(s) detectee(s) : ${donnees.headers.slice(0, 8).join(', ')}${donnees.headers.length > 8 ? '…' : ''}` }),
        ),
      );
    } catch (e) {
      vider(zoneApercu).append(h('p', { class: 'aide', style: { color: 'var(--alerte)' }, text: e.message }));
    }
  }

  const corps = h(
    'div',
    {},
    champ('Nom de la source', inputNom, 'Un intitule parlant, par exemple « Suivi qualite hebdomadaire ».'),
    champ('Dossier sur le partage', inputDossier, 'Chemin relatif au partage reseau. Utilisez l\'explorateur ci-dessous.'),
    h('details', {}, h('summary', { style: { cursor: 'pointer', marginBottom: '0.6rem', color: 'var(--texte-doux)' }, text: 'Parcourir le partage reseau' }),
      explorateur(valeurs.folder, (d) => { inputDossier.value = d; valeurs.folder = d; })),
    h(
      'div',
      { class: 'ligne-champs', style: { marginTop: '1rem' } },
      champ('Motif du nom de fichier', inputMotif, 'Exemples : *.xlsx, Production_*.xlsx, Suivi.xlsm'),
      champ('Fichier retenu', selChoix, 'Utile quand un nouveau fichier est depose chaque semaine.'),
      champ('Verifier toutes les (minutes)', inputFrequence, 'Le fichier n\'est relu que s\'il a change.'),
    ),
    h('div', { class: 'case', style: { marginBottom: '1rem' } }, caseActive, h('label', { for: 'src-active', text: 'Source active' })),
    h('button', { onClick: testerApercu }, 'Tester : trouver le fichier'),
    zoneApercu,
  );

  return { corps, valeurs };
}

function ouvrirSource(source, contexte) {
  const { corps, valeurs } = formulaireSource(source);
  const estNouveau = !source.id;

  const enregistrer = h(
    'button',
    {
      class: 'principal',
      onClick: async () => {
        if (!valeurs.name.trim()) return notifier('Le nom est obligatoire.', 'vigilance');
        try {
          if (estNouveau) {
            await api.creerSource(valeurs);
            notifier(
              'Source creee. Ajoutez maintenant un jeu de donnees pour choisir la feuille et les colonnes.',
            );
            boite.fermer();
            await contexte.rafraichir();
            contexte.naviguer('jeux-de-donnees');
          } else {
            await api.majSource(source.id, valeurs);
            notifier('Source enregistree.');
            boite.fermer();
            await contexte.rafraichir();
          }
        } catch (e) {
          erreur(e);
        }
      },
    },
    estNouveau ? 'Creer la source' : 'Enregistrer',
  );

  const boite = modale({
    titre: estNouveau ? 'Nouvelle source Excel' : `Source « ${source.name} »`,
    corps,
    large: true,
    actions: [h('button', { onClick: () => boite.fermer() }, 'Annuler'), enregistrer],
  });
}

export async function pageSources(contexte) {
  const { etat, rafraichir, naviguer } = contexte;
  const ctx = { ...contexte, naviguer };

  const lignes = etat.sources.map((s) => {
    const boutonImport = h(
      'button',
      {
        class: 'discret',
        title: 'Relire le fichier maintenant',
        onClick: async () => {
          boutonImport.disabled = true;
          boutonImport.textContent = '…';
          try {
            const r = await api.importerSource(s.id);
            if (r.ok) notifier(r.message || 'Import termine.');
            else erreur(r.error || 'Import en echec.');
            await rafraichir();
          } catch (e) {
            erreur(e);
            boutonImport.disabled = false;
            boutonImport.textContent = '⟳';
          }
        },
      },
      '⟳',
    );

    return [
      h(
        'div',
        {},
        h('div', { class: 'principal-cellule', text: s.name }),
        h('div', { class: 'secondaire mono', text: `${s.folder || '/'} · ${s.pattern}` }),
      ),
      h(
        'div',
        {},
        h('span', { class: `badge ${s.last_status || ''}`, text: s.last_status || 'jamais importe' }),
        h('div', { class: 'secondaire', text: s.last_run_at ? depuis(s.last_run_at) : '' }),
      ),
      h(
        'div',
        {},
        h('div', { text: s.last_file || '—' }),
        h('div', { class: 'secondaire', text: s.last_message || '' }),
      ),
      h('span', { text: `${s.datasetCount} jeu(x)` }),
      h('span', { text: `${s.refresh_minutes} min` }),
      h(
        'td',
        { class: 'actions' },
        boutonImport,
        h('button', { class: 'discret', onClick: () => ouvrirSource(s, ctx) }, 'Modifier'),
        h(
          'button',
          {
            class: 'discret danger',
            onClick: async () => {
              if (
                await confirmer(
                  `Supprimer la source « ${s.name} » ? Les ${s.datasetCount} jeu(x) de donnees rattaches et leurs lignes seront egalement supprimes.`,
                )
              ) {
                await api.supprimerSource(s.id);
                notifier('Source supprimee.');
                await rafraichir();
              }
            },
          },
          'Supprimer',
        ),
      ),
    ];
  });

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'entete-page' },
      h(
        'div',
        {},
        h('h1', { text: 'Sources Excel' }),
        h('p', {
          text: `Chaque source designe un emplacement de fichier sur le partage reseau (${etat.meta.sourceRoot}). Le serveur verifie regulierement si le fichier a change et ne le relit que dans ce cas.`,
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'principal', onClick: () => ouvrirSource({}, ctx) }, '+ Nouvelle source'),
      ),
    ),
    h(
      'div',
      { class: 'carte' },
      etat.sources.length
        ? tableau(['Source', 'Etat', 'Dernier fichier', 'Jeux', 'Frequence', ''], lignes)
        : h(
            'div',
            { class: 'vide' },
            "Aucune source pour le moment. Commencez par declarer l'emplacement d'un fichier Excel.",
          ),
    ),
  );
}
