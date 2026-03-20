/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */
let allRequests = [];   // flat array de { groupPath, name, type, stats }
let pendingFile = null; // File object sélectionné mais pas encore chargé

// Sort state: { col: string, dir: 'asc'|'desc' }
let sortState = { col: 'name', dir: 'asc' };

// Labels des bandes group1..group4 (lus depuis le premier nœud du JSON)
let bandLabels = ['< 800 ms', '800–1200 ms', '≥ 1200 ms', 'Échec'];

// URL du stats.json en cours (pour générer les liens de détail)
let currentSrc = '';

// true quand la source est un fichier local (File API) — les liens naviguent dans la page
let isLocalFile = false;

// Groupe à afficher en mode détail (null = vue synthèse)
// Correspond au `name` d'un nœud de niveau 1 (ex: "SC06_TR01_Connexion:")
let detailGroup = null;

/* ════════════════════════════════════════════════════════════════
   TABS
   ════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  const tabs = ['tree', 'file', 'url'];
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('url-bar').classList.toggle('active', tab === 'url');
  document.getElementById('file-bar').classList.toggle('active', tab === 'file');
  document.getElementById('tree-bar').classList.toggle('active', tab === 'tree');
  // La liste des répertoires se masque/affiche avec l'onglet
  // mais #tree-nav-sticky reste visible en permanence s'il est chargé
  const treeContainer = document.getElementById('tree-container');
  if (tab === 'tree') {
    treeContainer.classList.add('active');
    // Charger l'arbre automatiquement à la 1ère ouverture de l'onglet
    if (!treeContainer.dataset.loaded) loadTree();
  } else {
    treeContainer.classList.remove('active');
  }
}

/* ════════════════════════════════════════════════════════════════
   ARBORESCENCE GATLING (requiert server.py)
   ════════════════════════════════════════════════════════════════ */

/**
 * Charge la liste des simulations depuis /api/tree et l'affiche.
 * Utilise le champ #tree-root-input comme root (vide = root par défaut du serveur).
 */
/**
 * Charge l'arborescence depuis /api/tree?root=<chemin> et l'affiche.
 * @param {string|null} rootOverride  Si fourni, navigue vers ce chemin sans lire le champ input.
 */
async function loadTree(rootOverride) {
  const input     = document.getElementById('tree-root-input');
  const container = document.getElementById('tree-container');
  container.classList.add('active');
  container.dataset.loaded = '1';

  const rootVal = rootOverride !== undefined
    ? (rootOverride || '')
    : (input ? input.value.trim() : '');

  const url = rootVal
    ? '/api/tree?root=' + encodeURIComponent(rootVal)
    : '/api/tree';

  container.innerHTML = '<p class="tree-empty" style="padding:1rem 0">Chargement…</p>';

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      container.innerHTML = `<p class="tree-error">Erreur : ${escHtml(err.error || resp.statusText)}</p>`;
      return;
    }
    const data = await resp.json();

    // Synchroniser le champ avec le root effectif retourné par le serveur
    if (input) input.value = data.root || '';

    renderTree(container, data);
  } catch (e) {
    container.innerHTML =
      `<p class="tree-error">Impossible de contacter le serveur.<br>` +
      `Lancez <code>python server.py</code> depuis le répertoire du projet.</p>`;
  }
}

/**
/**
 * Génère le HTML de la navigation + liste des simulations et l'injecte dans container.
 */
function renderTree(container, data) {
  const nodes  = data.nodes  || [];
  const crumbs = data.breadcrumb || [];

  // ── Fil d'Ariane : injecté dans #tree-nav-sticky (toujours visible) ──
  const crumbHtml = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    if (isLast) {
      return `<span class="bc-seg bc-current">${escHtml(c.name)}</span>`;
    }
    const arg = escHtml(JSON.stringify(c.path));
    return `<a class="bc-seg bc-link" href="javascript:void(0)"
               onclick="loadTree(${arg})">${escHtml(c.name)}</a>`;
  }).join('<span class="bc-sep">›</span>');

  // ── Bouton "Répertoire parent" ──
  const parentHtml = data.parent
    ? (() => {
        const arg = escHtml(JSON.stringify(data.parent));
        return `<button class="tree-nav-btn" onclick="loadTree(${arg})" title="Répertoire parent">
                  ⬆ Parent
                </button>`;
      })()
    : '';

  // Mettre à jour la barre permanente
  const navSticky = document.getElementById('tree-nav-sticky');
  navSticky.innerHTML = `<nav class="tree-breadcrumb">${crumbHtml}</nav>${parentHtml}`;
  navSticky.classList.add('active');

  // ── Liste des sous-répertoires : injectée dans container ──
  let listHtml;
  if (nodes.length === 0) {
    listHtml = '<p class="tree-empty">Aucun sous-répertoire dans ce dossier.</p>';
  } else {
    const statsCount = nodes.filter(n => n.hasStats).length;
    const summary = `${nodes.length} répertoire${nodes.length > 1 ? 's' : ''}`
      + (statsCount ? ` · <strong style="color:#2ecc71">${statsCount} simulation${statsCount > 1 ? 's' : ''} Gatling</strong>` : '');

    const rows = nodes.map(node => {
      const hasStats = node.hasStats;
      const argPath  = escHtml(JSON.stringify(node.path));

      // Date Gatling formatée en heure de Paris si disponible
      const dateHtml = node.gatlingDate
        ? ` <span class="tree-item-date">(${fmtGatlingDate(node.gatlingDate)})</span>`
        : '';

      // Le nom est cliquable pour naviguer dans le sous-répertoire
      const nameHtml = `<a class="tree-item-name ${hasStats ? 'has-stats' : ''}"
                           href="javascript:void(0)"
                           onclick="loadTree(${argPath})"
                           title="Explorer ${escHtml(node.name)}">${escHtml(node.name)}</a>${dateHtml}`;
      const badge    = hasStats ? '✅' : '<span style="color:#444;font-size:0.9em">📁</span>';

      // Bouton "Analyser les stats Gatling" → charger le stats.json
      const analyzeBtn = hasStats
        ? `<button class="tree-item-btn"
               onclick="loadFromTreeNode(${escHtml(JSON.stringify(node.statsPath))})"
               title="Analyser les stats Gatling de ${escHtml(node.name)}">
               Analyser les stats Gatling
             </button>`
        : '';

      return `<li class="tree-item">${badge} ${nameHtml} ${analyzeBtn}</li>`;
    }).join('');

    listHtml = `<p class="tree-summary">${summary}</p><ul class="tree-list">${rows}</ul>`;
  }

  container.innerHTML = listHtml;
}

/**
 * Formate une date ISO 8601 UTC (ex: "2026-03-17T15:46:25.883Z")
 * en chaîne lisible sur le fuseau Europe/Paris.
 * Ex: "17/03/2026 16:46:25"
 * @param {string} isoUtc
 * @returns {string}
 */
function fmtGatlingDate(isoUtc) {
  try {
    const d = new Date(isoUtc);
    return d.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoUtc;
  }
}

/**
 * Charge un stats.json via /api/stats?path=... et affiche les résultats.
 * Appelé depuis un bouton "Analyser" de l'arborescence.
 */
async function loadFromTreeNode(statsPath) {
  const url = '/api/stats?path=' + encodeURIComponent(statsPath);
  showStatus('Chargement de ' + statsPath + '…', 'info');
  clearMain();

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      showStatus('Erreur : ' + (err.error || resp.statusText), 'error');
      showEmpty();
      return;
    }
    const data = await resp.json();
    currentSrc  = url;
    isLocalFile = false;
    processData(data);
    // Scroller vers les résultats sans masquer l'arborescence
    document.getElementById('main-content').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    showStatus('Erreur réseau : ' + e.message, 'error');
    showEmpty();
  }
}

/* ════════════════════════════════════════════════════════════════
   DATA LOADING — URL
   ════════════════════════════════════════════════════════════════ */
async function loadFromUrl() {
  const url = document.getElementById('stats-url').value.trim();
  if (!url) { showStatus('Veuillez saisir une URL.', 'error'); return; }

  // Les URLs file:// ne peuvent pas être chargées via fetch() (politique de sécurité
  // du navigateur). On bascule automatiquement vers l'onglet "Fichier local".
  if (url.startsWith('file://') || url.startsWith('file:///')) {
    switchTab('file');
    showStatus(
      '⚠️ Les URLs file:// ne peuvent pas être chargées via le réseau. ' +
      'Utilisez l\'onglet 📂 Fichier local pour glisser-déposer ou sélectionner le fichier.',
      'error'
    );
    return;
  }

  const btn = document.getElementById('load-btn-url');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  showStatus('Chargement en cours…', 'info');
  clearMain();

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    currentSrc = url;  // doit être set AVANT processData pour que buildDetailHref fonctionne
    isLocalFile = false;
    processData(data);
  } catch (err) {
    // "Failed to fetch" sans détail = erreur réseau ou CORS
    const isNetworkError = err instanceof TypeError && err.message.toLowerCase().includes('fetch');
    if (isNetworkError) {
      showStatus(
        `Impossible d'accéder à l'URL. Causes possibles :\n` +
        `• Le serveur distant n'autorise pas les requêtes cross-origin (CORS). ` +
        `Ajoutez « Header set Access-Control-Allow-Origin "*" » dans la config Apache/.htaccess du serveur.\n` +
        `• L'URL est inaccessible depuis ce poste (réseau, pare-feu).\n` +
        `Alternative : utilisez l'onglet 📂 Fichier local.`,
        'error'
      );
    } else {
      showStatus(`Erreur : ${err.message}`, 'error');
    }
    showEmpty();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Charger';
  }
}

/* ════════════════════════════════════════════════════════════════
   DATA LOADING — LOCAL FILE
   ════════════════════════════════════════════════════════════════ */
function onFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  setDropZoneFile(file);
}

function setDropZoneFile(file) {
  pendingFile = file;
  const zone = document.getElementById('drop-zone');
  zone.textContent = `📄 ${escHtml(file.name)}`;
  zone.classList.add('has-file');
  document.getElementById('load-btn-file').disabled = false;
}

function loadFromFile() {
  if (!pendingFile) { showStatus('Veuillez sélectionner un fichier.', 'error'); return; }

  const btn = document.getElementById('load-btn-file');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  showStatus('Lecture du fichier…', 'info');
  clearMain();

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      isLocalFile = true;
      currentSrc  = pendingFile.name;  // nom du fichier (non utilisé pour fetch, mais rend buildDetailHref non-null)
      processData(data);
    } catch (err) {
      showStatus(`Erreur de parsing JSON : ${err.message}`, 'error');
      showEmpty();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Charger';
    }
  };
  reader.onerror = function () {
    showStatus('Impossible de lire le fichier.', 'error');
    showEmpty();
    btn.disabled = false;
    btn.textContent = 'Charger';
  };
  reader.readAsText(pendingFile);
}

/* ── Drag & drop handlers ── */
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drag-over');
}
function onDragLeave(e) {
  document.getElementById('drop-zone').classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    showStatus('Le fichier doit être un fichier JSON (.json).', 'error');
    return;
  }
  setDropZoneFile(file);
}

/* ── Common data processing ── */
function processData(data, keepDetailGroup) {
  allRequests = [];
  if (!keepDetailGroup) detailGroup = null;
  walkNode(data, []);
  // Extraire les libellés des bandes depuis le premier nœud disponible
  const first = allRequests.find(r => r.stats && r.stats.group1);
  if (first) {
    bandLabels = [
      first.stats.group1.name || '< 800 ms',
      first.stats.group2.name || '800–1200 ms',
      first.stats.group3.name || '≥ 1200 ms',
      first.stats.group4.name || 'Échec',
    ];
  }
  hideStatus();
  renderAll();
}

/**
 * Recursive walk: collect every node that has a `stats` block.
 * The group path is built from ancestor `name` fields.
 * We deliberately ignore `contents` beyond recursion (per spec).
 *
 * @param {object} node        - current JSON node
 * @param {string[]} groupPath - ancestor names (breadcrumb)
 */
function walkNode(node, groupPath) {
  if (!node || typeof node !== 'object') return;

  if (node.stats) {
    const myGroup = groupPath.length > 0 ? groupPath.join(' › ') : '(Racine)';
    allRequests.push({
      groupPath: myGroup,
      groupParts: [...groupPath],
      name: node.name || node.stats.name || '(sans nom)',
      type: node.type || 'REQUEST',
      stats: node.stats,
    });
  }

  // Recurse into contents (collect data, but won't *display* contents block)
  if (node.contents && typeof node.contents === 'object') {
    const childGroup = node.name
      ? [...groupPath, node.name]
      : groupPath;
    for (const child of Object.values(node.contents)) {
      walkNode(child, childGroup);
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   SORTING & FILTERING
   ════════════════════════════════════════════════════════════════ */

// Column definitions: { id, label, getValue(req) → number|string, fmt? }
const COLUMNS = [
  { id: 'detail', label: '',          getValue: r => r.name },  // lien détail (remplace Type)
  { id: 'name',   label: 'Nom',       getValue: r => r.name },
  { id: 'total',  label: 'Total',     getValue: r => numVal(r, 'numberOfRequests', 'total') },
  { id: 'ok',     label: 'OK',        getValue: r => numVal(r, 'numberOfRequests', 'ok') },
  { id: 'ko',     label: 'KO',        getValue: r => numVal(r, 'numberOfRequests', 'ko') },
  { id: 'min',    label: 'Min (ms)',   getValue: r => numVal(r, 'minResponseTime', 'total') },
  { id: 'max',    label: 'Max (ms)',   getValue: r => numVal(r, 'maxResponseTime', 'total') },
  { id: 'mean',   label: 'Moy (ms)',   getValue: r => numVal(r, 'meanResponseTime', 'total') },
  { id: 'stddev', label: '\u03c3 (ms)',getValue: r => numVal(r, 'standardDeviation', 'total') },
  { id: 'p50',    label: 'P50 (ms)',   getValue: r => numVal(r, 'percentiles1', 'total') },
  { id: 'p75',    label: 'P75 (ms)',   getValue: r => numVal(r, 'percentiles2', 'total') },
  { id: 'p95',    label: 'P95 (ms)',   getValue: r => numVal(r, 'percentiles3', 'total') },
  { id: 'p99',    label: 'P99 (ms)',   getValue: r => numVal(r, 'percentiles4', 'total') },
  { id: 'rps',    label: 'Req/s',      getValue: r => numVal(r, 'meanNumberOfRequestsPerSecond', 'total'),
                                        fmtCell: v => fmtFloat(v) },
  // Bandes de réponse (group1..group4) — libellés dynamiques
  { id: 'g1', label: () => bandLabels[0], getValue: r => r.stats?.group1?.count ?? 0,
              fmtCell: (v, r) => fmtBand(r.stats?.group1) },
  { id: 'g2', label: () => bandLabels[1], getValue: r => r.stats?.group2?.count ?? 0,
              fmtCell: (v, r) => fmtBand(r.stats?.group2) },
  { id: 'g3', label: () => bandLabels[2], getValue: r => r.stats?.group3?.count ?? 0,
              fmtCell: (v, r) => fmtBand(r.stats?.group3) },
  { id: 'g4', label: () => bandLabels[3], getValue: r => r.stats?.group4?.count ?? 0,
              fmtCell: (v, r) => fmtBand(r.stats?.group4) },
];

function setSort(col) {
  if (sortState.col === col) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.col = col;
    sortState.dir = col === 'name' || col === 'type' ? 'asc' : 'desc';
  }
  renderAll();
}

function getSortedRequests(list) {
  const source = list !== undefined ? list : allRequests;
  const colDef = COLUMNS.find(c => c.id === sortState.col) || COLUMNS[0];
  const dir = sortState.dir === 'asc' ? 1 : -1;
  return [...source].sort((a, b) => {
    const va = colDef.getValue(a);
    const vb = colDef.getValue(b);
    if (typeof va === 'string') return dir * cmpStr(va, vb);
    return dir * (va - vb);
  });
}

function filterCards() { renderAll(); }

function getFilteredRequests() {
  // On n'affiche que les deux niveaux : racine + enfants directs (All Requests)
  const visible = allRequests.filter(r =>
    r.groupPath === '(Racine)' || r.groupPath === 'All Requests'
  );
  const q = document.getElementById('search').value.trim().toLowerCase();
  if (!q) return visible;
  return visible.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.groupPath.toLowerCase().includes(q)
  );
}

/* ════════════════════════════════════════════════════════════════
   RENDERING
   ════════════════════════════════════════════════════════════════ */
function renderAll() {
  const main       = document.getElementById('main-content');
  const empty      = document.getElementById('empty');
  const toolbar    = document.getElementById('toolbar');
  const countLabel = document.getElementById('count-label');

  if (allRequests.length === 0) {
    main.innerHTML = '';
    empty.style.display = 'block';
    toolbar.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  toolbar.style.display = 'flex';

  // ── MODE DÉTAIL : afficher les requêtes enfants d'un groupe précis ──
  if (detailGroup) {
    // Les enfants du groupe G ont groupPath === 'All Requests › G'
    const childPath = 'All Requests \u203a ' + detailGroup;
    const children = allRequests.filter(r => r.groupPath === childPath);
    const q = document.getElementById('search').value.trim().toLowerCase();
    const filtered = q
      ? children.filter(r => r.name.toLowerCase().includes(q) || r.groupPath.toLowerCase().includes(q))
      : children;
    countLabel.textContent = `${filtered.length} requête${filtered.length !== 1 ? 's' : ''}`;

    // Fil d'Ariane (retour synthèse) en mode fichier local
    const breadcrumb = isLocalFile
      ? `<nav class="breadcrumb"><a href="javascript:void(0)" onclick="navigateTo(null)">&#x2190; Synthèse</a> › ${escHtml(detailGroup)}</nav>`
      : '';

    main.innerHTML = breadcrumb + (filtered.length > 0
      ? renderTableSection(detailGroup, filtered, /* showDetailLink */ false, null)
      : '<p style="padding:2rem;color:#666">Aucun résultat.</p>');
    return;
  }

  // ── MODE SYNTHÈSE : racine + groupes de niveau 1 ──
  const filtered   = getFilteredRequests();
  const displayCount = filtered.length;
  countLabel.textContent = `${displayCount} ligne${displayCount !== 1 ? 's' : ''}`;

  const rootReqs   = filtered.filter(r => r.groupPath === '(Racine)');
  const level1Reqs = filtered.filter(r => r.groupPath === 'All Requests');

  let html = '';
  if (rootReqs.length > 0)   html += renderTableSection('(Racine)', rootReqs,
    /* showDetailLink */ true, /* getDetailGroupName */ () => null);
  if (level1Reqs.length > 0) html += renderTableSection('All requests', level1Reqs,
    /* showDetailLink */ true, /* getDetailGroupName */ req => req.name);

  main.innerHTML = html;
}

/**
 * Navigation in-page pour le mode fichier local.
 * groupName = null → retour vue synthèse ; groupName = string → vue détail du groupe.
 */
function navigateTo(groupName) {
  detailGroup = groupName;
  renderAll();
}

/**
 * Renders a collapsible table section (one header row + data rows).
 * @param {string}   title              - section title
 * @param {Array}    reqs               - requests to display
 * @param {boolean}  showDetailLink     - whether to add a detail link column
 * @param {Function} getDetailGroupName - (req) => groupName string | null
 */
function renderTableSection(title, reqs, showDetailLink, getDetailGroupName) {
  const sorted = getSortedRequests(reqs);
  const sectionId = 'sec-' + title.replace(/\W+/g, '-');

  const headerCells = COLUMNS.map(col => {
    if (col.id === 'detail') {
      // En-tête de la colonne lien : pas de tri, largeur fixe
      return '<th class="th-detail"></th>';
    }
    const isActive = sortState.col === col.id;
    const arrow = isActive ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const cls = isActive ? 'th-sort active' : 'th-sort';
    const labelStr = typeof col.label === 'function' ? col.label() : col.label;
    return `<th class="${cls}" onclick="setSort('${col.id}')">${escHtml(labelStr)}${arrow}</th>`;
  }).join('');

  const dataRows = sorted.map((req, idx) => {
    const rowId    = `${sectionId}-row-${idx}`;
    const detailId = `${sectionId}-det-${idx}`;
    const ko = numVal(req, 'numberOfRequests', 'ko');
    const koClass = ko > 0 ? 'val-ko' : 'val-ok';
    const cells = COLUMNS.map(col => {
      const v = col.getValue(req);
      let display, cls;
      if (col.id === 'detail') {
        // Lien de détail dans la colonne
        if (showDetailLink) {
          const groupName = getDetailGroupName ? getDetailGroupName(req) : req.name;
          const href = buildDetailHref(groupName);
          const ttl = groupName === null
            ? 'Voir tous les groupes'
            : `Voir les sous-requ\u00eates de ${escHtml(req.name)}`;
          if (href && href.startsWith('local:')) {
            // Mode fichier local : navigation dans la page
            const arg = escHtml(JSON.stringify(groupName));
            display = `<a href="javascript:void(0)" title="${ttl}" onclick="event.stopPropagation();navigateTo(${arg})">&#x1F50D;</a>`;
          } else if (href) {
            // Mode URL : nouvel onglet
            display = `<a href="${escHtml(href)}" target="_blank" title="${ttl}" onclick="event.stopPropagation()">&#x1F50D;</a>`;
          } else {
            display = '\u2014';
          }
        } else {
          display = '';
        }
        cls = 'detail-link-cell';
      } else if (col.id === 'name') {
        display = escHtml(req.name); cls = 'col-name';
      } else if (col.id === 'ko') {
        display = fmt(v); cls = koClass;
      } else if (col.id === 'ok') {
        display = fmt(v); cls = 'val-ok';
      } else if (col.id === 'g4') {
        display = col.fmtCell ? col.fmtCell(v, req) : fmt(v);
        cls = (req.stats?.group4?.count ?? 0) > 0 ? 'val-ko' : '';
      } else if (col.fmtCell) {
        display = col.fmtCell(v, req); cls = '';
      } else {
        display = fmt(v); cls = '';
      }
      return `<td class="${cls}">${display}</td>`;
    }).join('');

    return `
      <tr class="data-row" onclick="toggleRow('${rowId}','${detailId}')">
        <td class="expand-cell">▶</td>
        ${cells}
      </tr>
      <tr class="detail-row" id="${detailId}" style="display:none">
        <td colspan="${COLUMNS.length + 1}" class="detail-cell">
          ${renderDetailPanel(req)}
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="tbl-section">
      <div class="tbl-section-title">
        📁 ${escHtml(title)}
        <span class="section-badge">${sorted.length}</span>
      </div>
      <div class="tbl-wrapper">
        <table class="compact-table">
          <thead>
            <tr>
              <th class="th-expand"></th>
              ${headerCells}
            </tr>
          </thead>
          <tbody id="${sectionId}">
            ${dataRows}
          </tbody>
        </table>
      </div>
    </section>`;
}

/**
 * Returns the expanded detail panel HTML for one request (full stats table).
 */
function renderDetailPanel(req) {
  const s = req.stats;
  if (!s) return '<p class="no-stats">Aucune statistique disponible.</p>';

  const metrics = [
    ['Nombre de requêtes',   s.numberOfRequests],
    ['Temps min',            s.minResponseTime],
    ['Temps max',            s.maxResponseTime],
    ['Temps moyen',          s.meanResponseTime],
    ['Écart-type',           s.standardDeviation],
    ['Percentile 50',        s.percentiles1],
    ['Percentile 75',        s.percentiles2],
    ['Percentile 95',        s.percentiles3],
    ['Percentile 99',        s.percentiles4],
    ['Requêtes/s (moyenne)', s.meanNumberOfRequestsPerSecond],
  ];

  const groupBands = [s.group1, s.group2, s.group3, s.group4]
    .filter(Boolean)
    .map(g => {
      const label = g.htmlName || g.name || '';
      return `<tr class="band-row"><td>${escHtml(label)}</td><td>${fmt(g.count)}</td><td colspan="2">${fmt(g.percentage)} %</td></tr>`;
    }).join('');

  const metricRows = metrics.filter(([, v]) => v != null).map(([label, val]) => `
    <tr>
      <td class="detail-metric">${escHtml(label)}</td>
      <td>${fmt(val.total)}</td>
      <td class="val-ok">${fmt(val.ok)}</td>
      <td class="val-ko">${fmt(val.ko)}</td>
    </tr>`).join('');

  return `
    <table class="detail-table">
      <thead>
        <tr><th>Métrique</th><th>Total</th><th>OK</th><th>KO</th></tr>
      </thead>
      <tbody>
        ${metricRows}
        ${groupBands}
      </tbody>
    </table>`;
}

/* ════════════════════════════════════════════════════════════════
   URL PARAMS — chargement automatique depuis ?src=...&group=...
   ════════════════════════════════════════════════════════════════ */

/**
 * Construit l'URL de détail pour un groupe donné.
 * - En mode URL : retourne ?src=...&group=<nom>  (nouvel onglet)
 * - En mode fichier local : retourne 'local:<groupName>' (navigation dans la page)
 * - groupName = null → vue synthèse (niveau 1)
 * Retourne null si aucune source disponible.
 */
function buildDetailHref(groupName) {
  if (!currentSrc) return null;
  if (isLocalFile) {
    // Pas d'URL réelle — on encode un marqueur pour la navigation in-page
    return 'local:' + (groupName === null ? '' : groupName);
  }
  if (groupName === null) {
    return '?src=' + encodeURIComponent(currentSrc);
  }
  const params = new URLSearchParams({ src: currentSrc, group: groupName });
  return '?' + params.toString();
}

/**
 * Lit les paramètres ?src= et ?group= dans l'URL courante.
 * Si présents, charge automatiquement le JSON et active le mode détail.
 */
async function initFromUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const src    = params.get('src');
  const group  = params.get('group');
  if (!src) return;

  currentSrc  = src;
  detailGroup = group || null;

  // Pré-remplir le champ URL et basculer sur l'onglet URL
  document.getElementById('stats-url').value = src;
  switchTab('url');

  // Afficher un bandeau de contexte si on est en mode détail
  if (detailGroup) {
    showStatus(`Détail du groupe : ${detailGroup}`, 'info');
  }

  const btn = document.getElementById('load-btn-url');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  if (!detailGroup) showStatus('Chargement en cours…', 'info');
  clearMain();

  try {
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    processData(data, /* keepDetailGroup */ true);
  } catch (err) {
    const isNetworkError = err instanceof TypeError && err.message.toLowerCase().includes('fetch');
    showStatus(
      isNetworkError
        ? `Impossible de charger la source. Vérifiez CORS ou utilisez l'onglet 📂 Fichier local.`
        : `Erreur : ${err.message}`,
      'error'
    );
    showEmpty();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Charger';
  }
}
function toggleRow(rowId, detailId) {
  const detailEl = document.getElementById(detailId);
  if (!detailEl) return;
  const isOpen = detailEl.style.display !== 'none';
  detailEl.style.display = isOpen ? 'none' : 'table-row';
  // Update expand arrow on the data row (previous sibling)
  const dataRows = detailEl.parentElement.querySelectorAll('.data-row');
  dataRows.forEach(tr => {
    const cell = tr.querySelector('.expand-cell');
    if (!cell) return;
    // Find corresponding detail row
    const next = tr.nextElementSibling;
    if (next && next.id === detailId) {
      cell.textContent = isOpen ? '▶' : '▼';
    }
  });
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
}
function hideStatus() {
  document.getElementById('status').style.display = 'none';
}
function clearMain() {
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('empty').style.display = 'none';
}
function showEmpty() {
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('empty').style.display = 'block';
  document.getElementById('toolbar').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════ */
function numVal(req, metric, sub) {
  return req?.stats?.[metric]?.[sub] ?? 0;
}
function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('fr-FR');
  return String(v);
}
function fmtFloat(v) {
  if (v == null || v === 0) return '—';
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBand(g) {
  if (!g || g.count == null) return '—';
  const pct = typeof g.percentage === 'number'
    ? g.percentage.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '0,0';
  return `${g.count.toLocaleString('fr-FR')} <span class="band-pct">(${pct} %)</span>`;
}
function fmtMs(v) {
  if (v == null || v === 0) return '—';
  return `${v.toLocaleString('fr-FR')} ms`;
}
function cmpStr(a, b) {
  return String(a).localeCompare(String(b), 'fr');
}
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUT: Enter in URL field → load
   ════════════════════════════════════════════════════════════════ */
document.getElementById('stats-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadFromUrl();
});

/* ════════════════════════════════════════════════════════════════
   INIT — lecture des paramètres URL au démarrage
   ════════════════════════════════════════════════════════════════ */
initFromUrlParams();

// Charger l'arborescence automatiquement au démarrage (onglet par défaut)
const _initParams = new URLSearchParams(window.location.search);
if (!_initParams.get('src')) {
  loadTree();
}
