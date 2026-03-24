/**
 * Test headless de app.js sur le vrai stats.json Gatling.
 * Simule walkNode, getSortedRequests, renderDetailPanel, escHtml
 * sans navigateur ni DOM.
 */
const fs = require('fs');

/* ── Stub DOM minimal ── */
global.document = {
  getElementById: (id) => {
    if (id === 'search') return { value: '' };
    return { value: '', textContent: '', className: '', style: {}, disabled: false,
             classList: { toggle: () => {}, add: () => {}, remove: () => {} },
             addEventListener: () => {} };
  },
  querySelectorAll: () => [],
};

/* ── Charger app.js ── */
const appCode = fs.readFileSync('X:/git/analyse_resultats_gatling/app.js', 'utf8')
  // Retirer le listener DOM de fin de fichier (inutile hors navigateur)
  .replace(/document\.getElementById\('stats-url'\)\.addEventListener[\s\S]*$/, '');

// Exécuter dans le contexte global pour que les fonctions et variables soient accessibles
const vm = require('vm');
vm.runInThisContext(appCode);

/* ── Charger le JSON de test ── */
const data = JSON.parse(
  fs.readFileSync(
    'X:/git/tests-de-charge/target/gatling/testunitaire-20260324064013701/js/stats.json',
    'utf8'
  )
);

/* ════ TEST 1 : walkNode ════ */
processData(data);
console.log('✅ TEST 1 — walkNode');
console.log('   Noeuds collectés :', allRequests.length);
const groupNames = [...new Set(allRequests.map(r => r.groupPath))];
console.log('   Groupes distincts :', groupNames.length);
groupNames.forEach(g => {
  const n = allRequests.filter(r => r.groupPath === g).length;
  console.log(`     ${n.toString().padStart(4)}  ${g}`);
});

/* ════ TEST 2 : tri / filtre ════ */
console.log('\n✅ TEST 2 — tri name-asc (défaut)');
sortState.col = 'name'; sortState.dir = 'asc';
const sorted = getSortedRequests();
console.log('   Premier :', sorted[0].name);
console.log('   Dernier :', sorted[sorted.length-1].name);

sortState.col = 'p95'; sortState.dir = 'desc';
const byP95 = getSortedRequests();
console.log('\n✅ TEST 2b — tri p95-desc');
console.log('   P95 max :', byP95[0].stats.percentiles3?.total, 'ms —', byP95[0].name);

document.getElementById = (id) => {
  if (id === 'search') return { value: 'connexion' };
  return { value: '', textContent: '', style: {}, disabled: false, classList: { toggle:()=>{}, add:()=>{}, remove:()=>{} }, addEventListener:()=>{} };
};
const filtered = getFilteredRequests();
console.log('\n✅ TEST 2c — filtre "connexion"');
console.log('   Résultats :', filtered.length);

/* ════ TEST 3 : rendu HTML ════ */
document.getElementById = (id) => {
  if (id === 'search') return { value: '' };
  return { value: '', textContent: '', style: {}, disabled: false, classList: { toggle:()=>{}, add:()=>{}, remove:()=>{} }, addEventListener:()=>{} };
};
console.log('\n✅ TEST 3 — renderDetailPanel');
let errors = 0;
for (const req of allRequests) {
  try {
    const html = renderDetailPanel(req);
    if (req.stats && !html.includes('Nombre de requêtes')) {
      console.error('   ❌ Table stats absente pour :', req.name);
      errors++;
    }
  } catch (e) {
    console.error('   ❌ Erreur renderDetailPanel pour', req.name, ':', e.message);
    errors++;
  }
}
if (errors === 0) console.log('   Tous les panneaux rendus sans erreur (' + allRequests.length + ')');

/* ════ TEST 4 : escHtml ════ */
console.log('\n✅ TEST 4 — escHtml');
const xss = '<script>alert("xss")</script>';
const escaped = escHtml(xss);
console.log('   Entrée  :', xss);
console.log('   Sortie  :', escaped);
console.assert(!escaped.includes('<script>'), 'escHtml doit échapper <');

/* ════ TEST 5 : loupe (modale stats) et triangle (enfants inline) ════ */
isLocalFile = true;
currentSrc  = 'stats.json';
detailGroup = null;
processData(data);
const level1 = allRequests.filter(r => r.groupPath === 'All Requests');
const htmlSection = renderTableSection('All requests', level1);
// La loupe doit appeler openStatsModal (stats détaillées) — une par ligne visible + enfants inline
const loupeCount  = (htmlSection.match(/&#x1F50D;/g) || []).length;
const modalCount  = (htmlSection.match(/openStatsModal\(/g) || []).length;
// Le triangle doit appeler toggleRow (enfants du groupe)
const toggleCount = (htmlSection.match(/toggleRow\(/g) || []).length;
// Les lignes ayant des enfants dans allRequests
const withChildren = level1.filter(req => {
  const childPath = 'All Requests \u203a ' + req.name;
  return allRequests.some(r => r.groupPath === childPath);
}).length;
// Total des lignes rendues (level1 + leurs enfants directs)
const totalRendered = level1.reduce((acc, req) => {
  const childPath = 'All Requests \u203a ' + req.name;
  const kids = allRequests.filter(r => r.groupPath === childPath).length;
  return acc + 1 + kids;
}, 0);
console.log('\n✅ TEST 5 — loupe (modale) et triangle (enfants inline)');
console.log('   Lignes All requests :', level1.length, '— total rendu (avec enfants) :', totalRendered);
console.log('   Loupes (openStatsModal) :', loupeCount, '/', modalCount);
console.log('   Triangles (toggleRow) :', toggleCount, '— groupes avec enfants :', withChildren);
let t5errors = 0;
if (loupeCount !== totalRendered) {
  console.error('   ❌ Nombre de loupes incorrect :', loupeCount, '!==', totalRendered);
  t5errors++;
}
if (modalCount !== totalRendered) {
  console.error('   ❌ Nombre de openStatsModal incorrect :', modalCount, '!==', totalRendered);
  t5errors++;
}
if (toggleCount !== withChildren) {
  console.error('   ❌ Nombre de toggleRow incorrect :', toggleCount, '!==', withChildren);
  t5errors++;
}
if (t5errors === 0) {
  console.log('   Loupe → modale stats, triangle → enfants inline ✅');
} else {
  errors += t5errors;
}

/* ════ TEST 6 : jsArg — attribut onclick valide ════ */
console.log('\n✅ TEST 6 — jsArg');
const pathWin   = 'X:\\git\\gatling\\results';
const pathUnix  = '/home/user/gatling/résultats & tests';
const pathQuote = 'dir with "quotes"';

let t6errors = 0;
for (const [label, val] of [['chemin Windows', pathWin], ['chemin Unix+accents+&', pathUnix], ['guillemets', pathQuote]]) {
  const arg = jsArg(val);
  // 1) Ne doit pas contenir de " brut (casserait l'attribut HTML)
  if (arg.includes('"')) {
    console.error(`   ❌ jsArg(${label}) contient des guillemets bruts : ${arg}`);
    t6errors++;
  }
  // 2) &quot; doit être présent (délimite la chaîne JSON)
  if (!arg.includes('&quot;')) {
    console.error(`   ❌ jsArg(${label}) ne contient pas &quot; : ${arg}`);
    t6errors++;
  }
  // 3) Simuler le décodage HTML (comme le ferait le parser du navigateur) → doit être du JSON valide
  const decoded = arg.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try {
    const parsed = JSON.parse(decoded);
    if (parsed !== val) {
      console.error(`   ❌ jsArg(${label}) : valeur après décodage HTML != valeur originale`);
      t6errors++;
    }
  } catch (e) {
    console.error(`   ❌ jsArg(${label}) : JSON invalide après décodage HTML : ${decoded}`);
    t6errors++;
  }
  console.log(`   jsArg(${label}) = ${arg}`);
}
if (t6errors === 0) {
  console.log('   Tous les jsArg sont valides ✅');
} else {
  errors += t6errors;
}

/* ════ RÉSUMÉ ════ */
console.log('\n══════════════════════════════');
if (errors === 0) {
  console.log('✅ Tous les tests sont PASSÉS');
} else {
  console.log('❌', errors, 'erreur(s) détectée(s)');
  process.exit(1);
}
