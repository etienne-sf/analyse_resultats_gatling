/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */
let allRequests = [];   // flat array of { groupPath, name, type, stats }
let pendingFile = null; // File object selected but not yet loaded

// Sort state: { col: string, dir: 'asc'|'desc' }
let sortState = { col: 'name', dir: 'asc' };

// Labels des bandes group1..group4 (lus depuis le premier nœud du JSON)
let bandLabels = ['< 800 ms', '800–1200 ms', '≥ 1200 ms', 'Échec'];

/* ════════════════════════════════════════════════════════════════
   TABS
   ════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0) === (tab === 'url'));
  });
  document.getElementById('url-bar').classList.toggle('active', tab === 'url');
  document.getElementById('file-bar').classList.toggle('active', tab === 'file');
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
function processData(data) {
  allRequests = [];
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
  { id: 'name',   label: 'Nom',       getValue: r => r.name },
  { id: 'type',   label: 'Type',      getValue: r => r.type },
  { id: 'total',  label: 'Total',     getValue: r => numVal(r, 'numberOfRequests', 'total') },
  { id: 'ok',     label: 'OK',        getValue: r => numVal(r, 'numberOfRequests', 'ok') },
  { id: 'ko',     label: 'KO',        getValue: r => numVal(r, 'numberOfRequests', 'ko') },
  { id: 'min',    label: 'Min (ms)',   getValue: r => numVal(r, 'minResponseTime', 'total') },
  { id: 'max',    label: 'Max (ms)',   getValue: r => numVal(r, 'maxResponseTime', 'total') },
  { id: 'mean',   label: 'Moy (ms)',   getValue: r => numVal(r, 'meanResponseTime', 'total') },
  { id: 'stddev', label: 'σ (ms)',     getValue: r => numVal(r, 'standardDeviation', 'total') },
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
  const main      = document.getElementById('main-content');
  const empty     = document.getElementById('empty');
  const toolbar   = document.getElementById('toolbar');
  const countLabel = document.getElementById('count-label');

  if (allRequests.length === 0) {
    main.innerHTML = '';
    empty.style.display = 'block';
    toolbar.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  toolbar.style.display = 'flex';

  const filtered = getFilteredRequests();
  const displayCount = filtered.length;
  countLabel.textContent = `${displayCount} ligne${displayCount !== 1 ? 's' : ''}`;

  // Niveau 0 : nœud racine  (groupPath === '(Racine)')
  // Niveau 1 : enfants directs de la racine (groupPath === 'All Requests')
  //            Ce sont les groupes de premier niveau, avec leurs propres stats.
  const rootReqs   = filtered.filter(r => r.groupPath === '(Racine)');
  const level1Reqs = filtered.filter(r => r.groupPath === 'All Requests');

  let html = '';
  if (rootReqs.length > 0) {
    html += renderTableSection('(Racine)', rootReqs);
  }
  if (level1Reqs.length > 0) {
    html += renderTableSection('All requests', level1Reqs);
  }

  main.innerHTML = html;
}

/**
 * Renders a collapsible table section (one header row + data rows).
 */
function renderTableSection(title, reqs) {
  const sorted = getSortedRequests(reqs);
  const sectionId = 'sec-' + title.replace(/\W+/g, '-');

  const headerCells = COLUMNS.map(col => {
    const isActive = sortState.col === col.id;
    const arrow = isActive ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const cls = isActive ? 'th-sort active' : 'th-sort';
    const labelStr = typeof col.label === 'function' ? col.label() : col.label;
    return `<th class="${cls}" onclick="setSort('${col.id}')">${escHtml(labelStr)}${arrow}</th>`;
  }).join('');

  const dataRows = sorted.map((req, idx) => {
    const rowId = `${sectionId}-row-${idx}`;
    const detailId = `${sectionId}-det-${idx}`;
    const ko = numVal(req, 'numberOfRequests', 'ko');
    const koClass = ko > 0 ? 'val-ko' : 'val-ok';
    const cells = COLUMNS.map(col => {
      const v = col.getValue(req);
      let display, cls;
      if (col.id === 'name') {
        display = escHtml(req.name); cls = 'col-name';
      } else if (col.id === 'type') {
        display = `<span class="type-badge ${escHtml(req.type)}">${escHtml(req.type)}</span>`; cls = '';
      } else if (col.id === 'ko') {
        display = fmt(v); cls = koClass;
      } else if (col.id === 'ok') {
        display = fmt(v); cls = 'val-ok';
      } else if (col.id === 'g4') {
        // Échecs : colorier en rouge si > 0
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
   UI HELPERS
   ════════════════════════════════════════════════════════════════ */
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
