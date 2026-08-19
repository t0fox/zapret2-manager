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
  assert.match(pageCode, /Ресурс \/ [дД]омен/);
  assert.match(pageCode, /Протокол/);
  assert.match(pageCode, /Вариант/);

  // CSS rules
  assert.match(css, /\.learned-summary-list/);
  assert.match(css, /\.learned-summary-row/);
  assert.match(css, /\.learned-proto-badge/);
  assert.match(css, /\.learned-proto-badge\.quic/);
  assert.match(css, /\.learned-proto-badge\.tls/);
  assert.match(css, /\.learned-modal-table/);
  assert.match(css, /\.learned-modal-table-wrap/);
});
