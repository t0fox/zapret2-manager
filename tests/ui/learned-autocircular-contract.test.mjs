import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const BACKEND_ROOT = 'zapret2-manager/files/usr/libexec/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');
const readBackend = (name) => fs.readFileSync(`${BACKEND_ROOT}/${name}`, 'utf8');

test('Hard Gate AUTO_CIRCULAR_FILTER & SHOW_CIRCULAR_ACTION: circular strategies identified without empty result', () => {
  const modelCode = read('z2m-strategies-model.js');
  const pageCode = read('z2m-strategies.js');
  const backendModel = readBackend('strategy-model.uc');

  // 1. Model circular detection
  assert.match(modelCode, /isCircularStrategy/);
  assert.match(modelCode, /circular:\s*isCircularStrategy/);
  assert.match(modelCode, /--lua-desync=circular/);
  assert.match(modelCode, /autocircular/);

  // 2. Backend sets circular on catalog items
  assert.match(backendModel, /isCircular/);
  assert.match(backendModel, /circular:\s*isCircular/);

  // 3. Filter test in ListUI
  assert.match(pageCode, /id:\s*'circular',\s*label:\s*'Авто \(circular\)'/);
  assert.match(pageCode, /function\s*showCircular\(\)/);
  assert.match(pageCode, /data-filter-id="circular"/);
});

test('Hard Gate LEARNED_DEFAULT_ROWS_RENDERED: summary card renders <= 5 rows with human labels', () => {
  const pageCode = read('z2m-strategies.js');
  const modelCode = read('z2m-strategies-model.js');

  // Renders max 4 rows in summary
  assert.match(pageCode, /allEntries\.slice\(0,\s*4\)/);

  // Model humanize helper maps keys and strategy numbers to human labels
  assert.match(modelCode, /function humanizeLearnedEntry\(entry\)/);
  assert.match(modelCode, /humanizeLearnedEntry:\s*humanizeLearnedEntry/);
  assert.match(modelCode, /Вариант/);
  assert.match(modelCode, /protocol/);

  // Summary list structure
  assert.match(pageCode, /learned-summary-list/);
  assert.match(pageCode, /learned-summary-row/);
  assert.match(pageCode, /learned-summary-domain/);
  assert.match(pageCode, /learned-summary-label/);
  assert.match(pageCode, /learned-proto-badge/);
});

test('Hard Gate RAW_LEARNED_KEYS_IN_PRIMARY_UI & REPEATED_RESET_BUTTONS_IN_SUMMARY: 0 raw keys and 0 row reset buttons in summary', () => {
  const pageCode = read('z2m-strategies.js');

  // Summary row template has no reset button and no code element with raw key
  assert.doesNotMatch(pageCode, /learned-summary-row[^}]*resetLearned/);
  assert.doesNotMatch(pageCode, /learned-summary-row[^}]*<code>/);

  // Card has main action buttons
  assert.match(pageCode, /data-action="openLearnedModal"/);
  assert.match(pageCode, /data-action="showCircular"/);
  assert.match(pageCode, /data-action="resetLearned"/);
});

test('Hard Gate LEARNED_FULL_VIEW_SEARCH & GRAPHITE_THEME_CONSISTENCY: full modal table with search, human columns, and graphite styling', () => {
  const pageCode = read('z2m-strategies.js');
  const css = read('z2m-ui.css');

  // Modal functions
  assert.match(pageCode, /function openLearnedModal\(\)/);
  assert.match(pageCode, /function closeLearnedModal\(\)/);
  assert.match(pageCode, /function renderLearnedModal\(\)/);
  assert.match(pageCode, /learned-modal-search/);
  assert.match(pageCode, /learned-modal-table/);
  assert.match(pageCode, /<span>Ресурс<\/span>/);
  assert.match(pageCode, /Протокол/);
  assert.match(pageCode, /Стратегия/);
  assert.match(pageCode, /Вариант/);
  assert.match(pageCode, /Режим/);
  assert.match(pageCode, /Действия/);

  // CSS rules
  assert.match(css, /\.learned-summary-list/);
  assert.match(css, /\.learned-summary-row/);
  assert.match(css, /\.learned-proto-badge/);
  assert.match(css, /\.learned-proto-badge\.quic/);
  assert.match(css, /\.learned-proto-badge\.tls/);
  assert.match(css, /\.learned-modal-table/);
  assert.match(css, /\.learned-modal-table-wrap/);
});

test('LEARNED_TABLE_LAYOUT: desktop uses a compact six-column table and mobile gets a responsive fallback', () => {
  const page = read('z2m-strategies.js');
  const shell = read('z2m-shell.js');
  const css = read('z2m-ui.css');
  assert.match(css, /learned-modal-table-wrap[^}]*overflow-y:auto[^}]*overflow-x:auto/);
  assert.match(css, /learned-modal-table[^}]*table-layout:fixed/);
  assert.match(css, /learned-modal-table th:nth-child\(6\)/);
  assert.doesNotMatch(css, /@media\(max-width:1600px\)[\s\S]*learned-modal-table tr[^}]*display:grid/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*learned-modal-table[^}]*display:block/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*learned-modal-table-wrap[^}]*overflow-x:visible/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*learned-modal-table td:nth-child\(n\)[^}]*width:auto !important/);
  assert.match(css, /learned-col-domain/);
  assert.match(css, /learned-col-actions/);
  assert.match(css, /learned-row-actions/);
  assert.match(css, /learned-mode-badge/);
  assert.match(css, /learned-variant-badge/);
  assert.match(shell, /learned-table-9/);
  assert.match(page, /data-sort-field="protocol"/);
  assert.match(page, /data-sort-field="strategy"/);
  assert.match(page, /data-sort-field="mode"/);
  assert.match(page, /Показано <b>' \+ shown\.length \+ '<\/b> из/);
  assert.match(page, /Всего <b>' \+ allEntries\.length/);
  assert.match(page, /aria-label="Включить обратно"/);
  assert.match(page, /aria-label="Исключить ресурс"/);
});

test('CATALOG_PRIMARY_SUMMARY: catalog identity stays out of the primary strategy card', () => {
  const page = read('z2m-strategies.js');
  assert.doesNotMatch(page, /catalog-summary-provenance/);
  assert.doesNotMatch(page, /Управляемый snapshot/);
  assert.doesNotMatch(page, /Пакетный baseline/);
});

test('DISCORD_RUNTIME_STATUS: live Discord status uses the current runtime signature', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /function discordRuntimeActive\(data\)/);
  assert.match(page, /serviceState/);
  assert.match(page, /runtime\.present/);
  assert.match(page, /50000-50100/);
  assert.match(page, /--filter-l7=discord,stun/);
  assert.match(page, /discord_\(\?:udp\|voice\)/);
  assert.match(page, /discordRuntimeActive\(state\.data\)/);
  assert.doesNotMatch(page, /--filter-udp=19294-19344,50000-50100/);
  assert.doesNotMatch(page, /blob_stressozz_stun/);
  assert.doesNotMatch(page, /state\.discordApplied/);
});

test('DISCORD_RUNTIME_STATUS: detector rejects stale config and stopped runtime evidence', () => {
  const page = read('z2m-strategies.js');
  const start = page.indexOf('function discordRuntimeActive');
  const end = page.indexOf('\nfunction strategyProvenance', start);
  const detector = new Function('statusValue', 'object', 'array', 'text', `${page.slice(start, end)}\nreturn discordRuntimeActive;`)(
    (data) => data && data.status ? data.status.value || data.status : {},
    (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    (value) => Array.isArray(value) ? value : [],
    (value) => value === null || value === undefined ? '' : String(value),
  );
  const cmdline = '--filter-udp=50000-50100,1400 --filter-l7=discord,stun --lua-desync=circular:foo,key=discord_udp,hostkey=z2k_nohost_key';
  const current = { status: { serviceState: 'running', runtime: { present: true, instances: [{ cmdline }] } } };
  assert.equal(detector(current), true);
  assert.equal(detector({ status: { serviceState: 'stopped', runtime: { present: true, instances: [{ cmdline }] } } }), false);
  assert.equal(detector({ status: { serviceState: 'running', runtime: { present: true, instances: [{ cmdline: '--filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --blob=blob_stressozz_stun:@/opt/zapret2/files/fake/stun.bin' }] } } }), false);
});
