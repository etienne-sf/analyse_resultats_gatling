/**
 * Test headless de app.js sur le vrai stats.json Gatling.
 * Simule walkNode, getSortedRequests, renderCard, renderStatsTable
 * sans navigateur ni DOM.
 */
const fs = require('fs');

/* ── Stub DOM minimal ── */
const _state = { sortValue: 'group-asc', searchValue: '' };
global.document = {
  getElementById: (id) => {
    if (id === 'sort-select') return { value: _state.sortValue };
    if (id === 'search')      return { value: _state.searchValue };
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
    'X:/git/tests-de-charge/target/gatling/testunitaire-20260317165913824/js/stats.json',
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
console.log('\n✅ TEST 2 — tri group-asc');
const sorted = getSortedRequests();
console.log('   Premier :', sorted[0].groupPath, '/', sorted[0].name);
console.log('   Dernier :', sorted[sorted.length-1].groupPath, '/', sorted[sorted.length-1].name);

_state.sortValue = 'p95-desc';
const byP95 = getSortedRequests();
console.log('\n✅ TEST 2b — tri p95-desc');
console.log('   P95 max :', byP95[0].stats.percentiles3?.total, 'ms —', byP95[0].name);

_state.searchValue = 'connexion';
const filtered = getFilteredRequests();
console.log('\n✅ TEST 2c — filtre "connexion"');
console.log('   Résultats :', filtered.length);

/* ════ TEST 3 : rendu HTML ════ */
_state.searchValue = '';
_state.sortValue = 'group-asc';
console.log('\n✅ TEST 3 — renderCard / renderStatsTable');
let errors = 0;
for (const req of allRequests) {
  try {
    const html = renderCard(req);
    if (!html.includes(escHtml(req.name))) {
      console.error('   ❌ Nom absent dans la carte :', req.name);
      errors++;
    }
    if (req.stats && !html.includes('Nombre de requêtes')) {
      console.error('   ❌ Table stats absente pour :', req.name);
      errors++;
    }
  } catch (e) {
    console.error('   ❌ Erreur renderCard pour', req.name, ':', e.message);
    errors++;
  }
}
if (errors === 0) console.log('   Toutes les cartes rendues sans erreur (' + allRequests.length + ')');

/* ════ TEST 4 : escHtml ════ */
console.log('\n✅ TEST 4 — escHtml');
const xss = '<script>alert("xss")</script>';
const escaped = escHtml(xss);
console.log('   Entrée  :', xss);
console.log('   Sortie  :', escaped);
console.assert(!escaped.includes('<script>'), 'escHtml doit échapper <');

/* ════ RÉSUMÉ ════ */
console.log('\n══════════════════════════════');
if (errors === 0) {
  console.log('✅ Tous les tests sont PASSÉS');
} else {
  console.log('❌', errors, 'erreur(s) détectée(s)');
  process.exit(1);
}
