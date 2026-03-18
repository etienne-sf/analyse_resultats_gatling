// Script utilitaire — réécrit index.html en UTF-8 propre
// Usage : node _write_html.js
const fs = require('fs');
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Analyse R\u00e9sultats Gatling</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e0e0e0; min-height: 100vh; }

    /* \u2500\u2500 Header \u2500\u2500 */
    header { background: #1a1d2e; border-bottom: 2px solid #ff6b35; padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
    header h1 { font-size: 1.4rem; color: #ff6b35; font-weight: 700; letter-spacing: 0.03em; }
    header .subtitle { font-size: 0.85rem; color: #888; }

    /* \u2500\u2500 Source bar \u2500\u2500 */
    #source-bar { background: #141622; border-bottom: 1px solid #2a2d3e; }
    .tab-strip { display: flex; padding: 0 2rem; border-bottom: 1px solid #2a2d3e; }
    .tab-btn { padding: 0.6rem 1.2rem; font-size: 0.88rem; font-weight: 600; color: #666; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: color 0.15s, border-color 0.15s; margin-bottom: -1px; }
    .tab-btn:hover { color: #aaa; }
    .tab-btn.active { color: #ff6b35; border-bottom-color: #ff6b35; }
    .tab-panel { display: none; padding: 1rem 2rem; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .tab-panel.active { display: flex; }
    #url-bar label, #file-bar label { font-size: 0.9rem; color: #aaa; white-space: nowrap; }
    #stats-url { flex: 1; min-width: 260px; padding: 0.5rem 0.8rem; border-radius: 6px; border: 1px solid #3a3d50; background: #1e2135; color: #e0e0e0; font-size: 0.95rem; }
    #stats-url:focus { outline: none; border-color: #ff6b35; }
    #drop-zone { flex: 1; min-width: 260px; min-height: 64px; border: 2px dashed #3a3d50; border-radius: 8px; background: #1e2135; color: #777; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; padding: 0.5rem 1rem; text-align: center; }
    #drop-zone:hover, #drop-zone.drag-over { border-color: #ff6b35; background: #1e2135ee; color: #ccc; }
    #drop-zone.has-file { border-color: #2ecc71; color: #2ecc71; }
    #file-input { display: none; }
    .load-btn { padding: 0.5rem 1.4rem; border-radius: 6px; border: none; background: #ff6b35; color: #fff; font-weight: 600; font-size: 0.95rem; cursor: pointer; transition: background 0.15s; }
    .load-btn:hover { background: #e05520; }
    .load-btn:disabled { background: #555; cursor: not-allowed; }

    /* \u2500\u2500 Status \u2500\u2500 */
    #status { display: none; margin: 1rem 2rem 0; padding: 0.7rem 1rem; border-radius: 6px; font-size: 0.9rem; }
    #status.error { background: #2e1515; border: 1px solid #c0392b; color: #e74c3c; }
    #status.info  { background: #12232e; border: 1px solid #2980b9; color: #5dade2; }

    /* \u2500\u2500 Toolbar \u2500\u2500 */
    #toolbar { display: none; padding: 1rem 2rem; gap: 1rem; align-items: center; flex-wrap: wrap; background: #141622; border-bottom: 1px solid #2a2d3e; }
    #search { padding: 0.45rem 0.8rem; border-radius: 6px; border: 1px solid #3a3d50; background: #1e2135; color: #e0e0e0; font-size: 0.9rem; width: 240px; }
    #search:focus { outline: none; border-color: #ff6b35; }
    .toolbar-label { font-size: 0.85rem; color: #888; margin-left: auto; }
    #sort-select { padding: 0.45rem 0.7rem; border-radius: 6px; border: 1px solid #3a3d50; background: #1e2135; color: #e0e0e0; font-size: 0.9rem; cursor: pointer; }
    #sort-select:focus { outline: none; border-color: #ff6b35; }
    #count-label { font-size: 0.85rem; color: #666; }

    /* \u2500\u2500 Main content \u2500\u2500 */
    main { padding: 1.5rem 2rem; }
    .group-section { margin-bottom: 2.5rem; }
    .group-title { font-size: 1.1rem; font-weight: 700; color: #ff6b35; padding: 0.4rem 0; border-bottom: 1px solid #2a2d3e; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .group-title .group-badge { font-size: 0.75rem; background: #ff6b3533; color: #ff6b35; border-radius: 4px; padding: 0.1rem 0.45rem; }
    .request-card { background: #1a1d2e; border: 1px solid #2a2d3e; border-radius: 10px; margin-bottom: 1rem; overflow: hidden; transition: border-color 0.15s; }
    .request-card:hover { border-color: #ff6b3566; }
    .request-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; cursor: pointer; user-select: none; background: #1e2135; gap: 1rem; }
    .request-name { font-weight: 600; font-size: 0.95rem; color: #c8d0e0; flex: 1; word-break: break-all; }
    .request-type-badge { font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .request-type-badge.REQUEST { background: #1a3a2a; color: #2ecc71; border: 1px solid #27ae60; }
    .request-type-badge.GROUP   { background: #2a1a3a; color: #9b59b6; border: 1px solid #8e44ad; }
    .summary-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 1rem; border-bottom: 1px solid #2a2d3e; }
    .pill { font-size: 0.78rem; padding: 0.2rem 0.6rem; border-radius: 20px; font-weight: 600; white-space: nowrap; }
    .pill.total   { background: #1e2135; color: #aaa; border: 1px solid #3a3d50; }
    .pill.ok      { background: #1a3a2a; color: #2ecc71; }
    .pill.ko      { background: #3a1a1a; color: #e74c3c; }
    .pill.ko.zero { background: #1a3a2a; color: #2ecc71; }
    .pill.p50     { background: #1e2a3a; color: #5dade2; }
    .pill.p95     { background: #1e2a3a; color: #f39c12; }
    .pill.p99     { background: #1e2a3a; color: #e67e22; }
    .stats-detail { overflow: hidden; max-height: 0; transition: max-height 0.25s ease; }
    .stats-detail.open { max-height: 2000px; }
    .toggle-icon { font-size: 0.75rem; color: #555; transition: transform 0.2s; flex-shrink: 0; }
    .request-header.expanded .toggle-icon { transform: rotate(180deg); }
    .stats-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .stats-table th { text-align: left; padding: 0.45rem 1rem; color: #888; font-weight: 500; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; background: #12141f; border-bottom: 1px solid #2a2d3e; }
    .stats-table td { padding: 0.45rem 1rem; border-bottom: 1px solid #1e2135; color: #c8d0e0; }
    .stats-table tr:last-child td { border-bottom: none; }
    .stats-table tr:hover td { background: #1e2135; }
    .stats-table td.metric-name { color: #8899bb; font-size: 0.82rem; width: 38%; }
    .stats-table td.val-total { color: #c8d0e0; font-weight: 500; }
    .stats-table td.val-ok { color: #2ecc71; }
    .stats-table td.val-ko { color: #e74c3c; }
    .group-band-row td { color: #b0b8c8; font-style: italic; }

    /* \u2500\u2500 Empty state \u2500\u2500 */
    #empty { display: none; text-align: center; padding: 4rem 2rem; color: #555; }
    #empty svg { opacity: 0.25; margin-bottom: 1rem; display: block; margin-left: auto; margin-right: auto; }

    /* \u2500\u2500 Footer \u2500\u2500 */
    footer { text-align: center; font-size: 0.78rem; color: #444; padding: 2rem; border-top: 1px solid #1e2135; margin-top: 2rem; }

    @media (max-width: 640px) {
      header, .tab-strip, .tab-panel, #toolbar, main { padding-left: 1rem; padding-right: 1rem; }
      .request-header { flex-wrap: wrap; }
      .summary-pills { padding: 0.4rem 0.75rem; }
    }
  </style>
</head>
<body>

<header>
  <div>
    <h1>\u26a1 Analyse R\u00e9sultats Gatling</h1>
    <span class="subtitle">Visualisation des statistiques de performance</span>
  </div>
</header>

<div id="source-bar">
  <div class="tab-strip">
    <button class="tab-btn active" onclick="switchTab('url')">\uD83C\uDF10 URL</button>
    <button class="tab-btn" onclick="switchTab('file')">\uD83D\uDCC2 Fichier local</button>
  </div>
  <div class="tab-panel active" id="url-bar">
    <label for="stats-url">URL du fichier stats.json\u00a0:</label>
    <input type="text" id="stats-url"
      placeholder="http://localhost:8080/results/simulation/js/stats.json"
      value="" autocomplete="off" spellcheck="false" />
    <button class="load-btn" id="load-btn-url" onclick="loadFromUrl()">Charger</button>
  </div>
  <div class="tab-panel" id="file-bar">
    <label>Fichier stats.json local\u00a0:</label>
    <div id="drop-zone"
         onclick="document.getElementById('file-input').click()"
         ondragover="onDragOver(event)"
         ondragleave="onDragLeave(event)"
         ondrop="onDrop(event)">
      \uD83D\uDCC1 Glisser-d\u00e9poser un fichier ici, ou cliquer pour parcourir
    </div>
    <input type="file" id="file-input" accept=".json,application/json" onchange="onFileSelected(event)" />
    <button class="load-btn" id="load-btn-file" onclick="loadFromFile()" disabled>Charger</button>
  </div>
</div>

<div id="status"></div>

<div id="toolbar">
  <input type="text" id="search" placeholder="\uD83D\uDD0D Filtrer par nom\u2026" oninput="filterCards()" />
  <span class="toolbar-label">Trier par\u00a0:</span>
  <select id="sort-select" onchange="renderAll()">
    <option value="group-asc">Groupe \u2191</option>
    <option value="group-desc">Groupe \u2193</option>
    <option value="name-asc">Nom \u2191</option>
    <option value="name-desc">Nom \u2193</option>
    <option value="total-desc">Total requ\u00eates \u2193</option>
    <option value="ko-desc">KO \u2193</option>
    <option value="mean-desc">Temps moyen \u2193</option>
    <option value="p95-desc">P95 \u2193</option>
  </select>
  <span id="count-label"></span>
</div>

<!-- #empty est en dehors de <main> : il ne sera jamais efface par innerHTML='' -->
<div id="empty">
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>
  </svg>
  <p>Aucun r\u00e9sultat. Saisissez l\u2019URL d\u2019un fichier <code>stats.json</code> Gatling et cliquez sur \u00ab\u00a0Charger\u00a0\u00bb.</p>
</div>

<main id="main-content"></main>

<footer>
  Analyse R\u00e9sultats Gatling &mdash; JSON g\u00e9n\u00e9r\u00e9 par
  <a href="https://gatling.io" style="color:#ff6b35;text-decoration:none">Gatling</a>
</footer>

<script src="app.js"></script>
</body>
</html>`;

fs.writeFileSync('X:/git/analyse_resultats_gatling/index.html', html, 'utf8');
console.log('OK — index.html écrit (' + html.length + ' caractères, UTF-8)');
