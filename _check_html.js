const s = require('fs').readFileSync('X:/git/analyse_resultats_gatling/index.html', 'utf8');
const accentsOk = s.includes('R\u00e9sultats') && s.includes('g\u00e9n\u00e9r\u00e9') && s.includes('Glisser-d\u00e9poser');
const emptyBeforeMain = s.indexOf('id="empty"') < s.indexOf('id="main-content"');
console.log('Accents OK          :', accentsOk);
console.log('#empty avant <main> :', emptyBeforeMain);
console.log('Lignes              :', s.split('\n').length);
