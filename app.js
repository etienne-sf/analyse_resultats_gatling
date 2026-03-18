/* ════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════ */
let allRequests = [];   // flat array of { groupPath, name, type, stats }
let pendingFile = null; // File object selected but not yet loaded

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
    showStatus(`Erreur : ${err.message}`, 'error');
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
function getSortedRequests() {
  const sort = document.getElementById('sort-select').value;
  const arr = [...allRequests];
  arr.sort((a, b) => {
    switch (sort) {
      case 'group-asc':  return cmpStr(a.groupPath, b.groupPath) || cmpStr(a.name, b.name);
      case 'group-desc': return cmpStr(b.groupPath, a.groupPath) || cmpStr(a.name, b.name);
      case 'name-asc':   return cmpStr(a.name, b.name);
      case 'name-desc':  return cmpStr(b.name, a.name);
      case 'total-desc': return numVal(b, 'numberOfRequests', 'total') - numVal(a, 'numberOfRequests', 'total');
      case 'ko-desc':    return numVal(b, 'numberOfRequests', 'ko')    - numVal(a, 'numberOfRequests', 'ko');
      case 'mean-desc':  return numVal(b, 'meanResponseTime', 'total') - numVal(a, 'meanResponseTime', 'total');
      case 'p95-desc':   return numVal(b, 'percentiles3', 'total')     - numVal(a, 'percentiles3', 'total');
      default: return 0;
    }
  });
  return arr;
}

function filterCards() { renderAll(); }

function getFilteredRequests() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  if (!q) return getSortedRequests();
  return getSortedRequests().filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.groupPath.toLowerCase().includes(q)
  );
}

/* ════════════════════════════════════════════════════════════════
   RENDERING
   ════════════════════════════════════════════════════════════════ */
function renderAll() {
  const main    = document.getElementById('main-content');
  const empty   = document.getElementById('empty');
  const toolbar = document.getElementById('toolbar');
  const countLabel = document.getElementById('count-label');

  if (allRequests.length === 0) {
    main.innerHTML = '';
    empty.style.display = 'block';
    toolbar.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  toolbar.style.display = 'flex';

  const requests = getFilteredRequests();
  countLabel.textContent = `${requests.length} requête${requests.length !== 1 ? 's' : ''}`;

  // Group by groupPath
  const groups = new Map();
  for (const req of requests) {
    if (!groups.has(req.groupPath)) groups.set(req.groupPath, []);
    groups.get(req.groupPath).push(req);
  }

  // Build HTML
  let html = '';
  for (const [groupPath, reqs] of groups) {
    html += `
      <section class="group-section">
        <div class="group-title">
          📁 ${escHtml(groupPath)}
          <span class="group-badge">${reqs.length}</span>
        </div>
        ${reqs.map(r => renderCard(r)).join('')}
      </section>`;
  }

  main.innerHTML = html;
}

function renderCard(req) {
  const s = req.stats;
  const total = numVal(req, 'numberOfRequests', 'total');
  const ok    = numVal(req, 'numberOfRequests', 'ok');
  const ko    = numVal(req, 'numberOfRequests', 'ko');
  const koClass = ko === 0 ? 'ko zero' : 'ko';
  const p50  = numVal(req, 'percentiles1', 'total');
  const p95  = numVal(req, 'percentiles3', 'total');
  const p99  = numVal(req, 'percentiles4', 'total');
  const cardId = 'card-' + Math.random().toString(36).slice(2);

  return `
    <div class="request-card">
      <div class="request-header" onclick="toggleCard(this)" id="${cardId}-hdr">
        <span class="request-name">${escHtml(req.name)}</span>
        <span class="request-type-badge ${req.type}">${escHtml(req.type)}</span>
        <span class="toggle-icon">▼</span>
      </div>
      <div class="summary-pills">
        <span class="pill total">Total : ${fmt(total)}</span>
        <span class="pill ok">✓ OK : ${fmt(ok)}</span>
        <span class="pill ${koClass}">✗ KO : ${fmt(ko)}</span>
        <span class="pill p50">P50 : ${fmtMs(p50)}</span>
        <span class="pill p95">P95 : ${fmtMs(p95)}</span>
        <span class="pill p99">P99 : ${fmtMs(p99)}</span>
      </div>
      <div class="stats-detail" id="${cardId}-detail">
        ${renderStatsTable(s)}
      </div>
    </div>`;
}

function renderStatsTable(s) {
  if (!s) return '<p style="padding:1rem;color:#555">Aucune statistique disponible.</p>';

  const rows = [
    ['Nombre de requêtes',         s.numberOfRequests],
    ['Temps min (ms)',              s.minResponseTime],
    ['Temps max (ms)',              s.maxResponseTime],
    ['Temps moyen (ms)',            s.meanResponseTime],
    ['Écart-type (ms)',             s.standardDeviation],
    ['Percentile 50 (ms)',          s.percentiles1],
    ['Percentile 75 (ms)',          s.percentiles2],
    ['Percentile 95 (ms)',          s.percentiles3],
    ['Percentile 99 (ms)',          s.percentiles4],
    ['Requêtes/s (moyenne)',        s.meanNumberOfRequestsPerSecond],
  ];

  const groupBands = [
    ['Groupe 1 ' + bandLabel(s.group1), s.group1],
    ['Groupe 2 ' + bandLabel(s.group2), s.group2],
    ['Groupe 3 ' + bandLabel(s.group3), s.group3],
    ['Groupe 4 ' + bandLabel(s.group4), s.group4],
  ].filter(([, v]) => v != null);

  let html = `
    <table class="stats-table">
      <thead><tr>
        <th>Métrique</th>
        <th>Total</th>
        <th>OK</th>
        <th>KO</th>
      </tr></thead>
      <tbody>`;

  for (const [label, val] of rows) {
    if (!val) continue;
    html += `
        <tr>
          <td class="metric-name">${escHtml(label)}</td>
          <td class="val-total">${fmt(val.total)}</td>
          <td class="val-ok">${fmt(val.ok)}</td>
          <td class="val-ko">${fmt(val.ko)}</td>
        </tr>`;
  }

  for (const [label, val] of groupBands) {
    if (!val) continue;
    html += `
        <tr class="group-band-row">
          <td class="metric-name">${escHtml(label)}</td>
          <td class="val-total" colspan="3">${fmt(val.count)} (${fmt(val.percentage)} %)</td>
        </tr>`;
  }

  html += '</tbody></table>';
  return html;
}

function bandLabel(g) {
  if (!g) return '';
  return g.htmlName ? `— ${g.htmlName}` : (g.name ? `— ${g.name}` : '');
}

/* ════════════════════════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════════════════════════ */
function toggleCard(hdr) {
  hdr.classList.toggle('expanded');
  const cardEl = hdr.closest('.request-card');
  const detail = cardEl.querySelector('.stats-detail');
  detail.classList.toggle('open');
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
