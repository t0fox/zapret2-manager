import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8');
const control = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const diagnostics = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-diagnostics-page.js'), 'utf8');
const maintenanceModel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js'), 'utf8');
const avatarLog = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');
const maintenanceBackend = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/maintenance.uc'), 'utf8');

test('Dashboard log window is a bounded semantic event view', () => {
  assert.match(page, /eventsTail, \{ limit: 8 \}/);
  for (const label of ['ОТЛАДКА', 'ИНФО', 'УСПЕХ', 'ПРЕДУПР\.', 'ОШИБКА', 'КРИТИЧНО'])
    assert.match(avatarLog, new RegExp(label));
  assert.match(avatarLog, /raw\.source \|\| raw\.component/);
  assert.match(avatarLog, /class': 'log-source'/);
  assert.match(avatarLog, /class': 'log-message'/);
  assert.match(avatarLog, /slice\(-\(limit \|\| 100\)\)/);
  assert.doesNotMatch(page, /function eventSeverity\s*\(/);
});

test('Dashboard log window exposes loading, empty, error and smart autoscroll states', () => {
  assert.match(page, /Загрузка событий/);
  assert.match(page, /Событий пока нет/);
  assert.match(page, /Не удалось загрузить события/);
  assert.match(page, /runtime\.events\.follow/);
  assert.match(page, /runtime\.events\.unread/);
  assert.match(page, /refreshLogStylesheet/);
  assert.match(page, /data-z2m-revision/);
  assert.match(page, /Перейти к новым событиям/);
  assert.match(page, /scrollHeight/);
  assert.match(css, /\.log-row,\s*\.log-entry\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.log-time/);
  assert.match(css, /\.log-source/);
  assert.match(css, /\.log-message/);
  assert.match(css, /\.severity-badge/);
  assert.match(avatarLog, /log-row log-entry/);
});

test('full event history keeps the same Russian semantic columns', () => {
  assert.match(diagnostics, /AvatarLog\.load\(ctx\)/);
  assert.match(diagnostics, /AvatarLog\.render\(ctx\)/);
  assert.match(avatarLog, /Единый журнал событий/);
  assert.match(avatarLog, /eventId/);
  assert.match(avatarLog, /severity-badge/);
  assert.match(maintenanceModel, /source: text\(event\.source \|\| event\.component\)/);
  assert.match(maintenanceModel, /Date\.parse/);
  assert.match(maintenanceModel, /slice\(-Math\.floor\(limit\)\)/);
  assert.match(avatarLog, /function messageLabel/);
  assert.match(avatarLog, /Параметр NFQWS2_ENABLE=/);
  assert.match(avatarLog, /function timestamp/);
  assert.match(avatarLog, /function normalizeRows/);
});

test('Logs page is a dedicated full-fidelity route wired to AvatarLog', () => {
  assert.match(diagnostics, /require view\.zapret2-manager\.z2m-avatar-log as AvatarLog/);
  assert.match(app, /logs:\s*Diagnostics/);
  assert.match(app, /diagnostics:\s*Diagnostics/);
  assert.doesNotMatch(app, /logs:\s*Monitor/);
  assert.match(nav, /id:\s*'logs',\s*label:\s*_\('Журналы'\)/);
  assert.match(avatarLog, /id:\s*'logs'/);
  assert.match(avatarLog, /title:\s*_\('Журнал'\)/);
  assert.match(avatarLog, /function load\(ctx\)/);
  assert.match(avatarLog, /function renderPage\(ctx\)/);
  assert.match(avatarLog, /function mount\(ctx\)/);
  assert.match(avatarLog, /function unmount\(\)/);
});

test('Donor fidelity: exactly 11 donor functions mapped with 0 partial and 0 missing', () => {
  const donorFunctions = [
    { donor: 'render', z2m: 'renderPage' },
    { donor: 'destroy', z2m: 'unmount' },
    { donor: 'setLevel', z2m: 'setPageLevel' },
    { donor: 'onSearch', z2m: 'onPageSearch' },
    { donor: 'clearSearch', z2m: 'clearPageSearch' },
    { donor: 'toggleAutoScroll', z2m: 'togglePageAutoScroll' },
    { donor: 'togglePause', z2m: 'togglePagePause' },
    { donor: 'scrollToBottom', z2m: 'scrollToBottomDOM' },
    { donor: 'copyAll', z2m: 'copyPageLogs' },
    { donor: 'clearLogs', z2m: 'clearPageView' },
    { donor: 'updateConnectionStatus', z2m: 'updateConnectionStatusDOM' }
  ];

  assert.equal(donorFunctions.length, 11, 'DONOR_LOG_FUNCTIONS_TOTAL must be 11');

  for (const fn of donorFunctions) {
    assert.match(avatarLog, new RegExp(`function ${fn.z2m}\\b`), `Missing Z2M implementation for donor ${fn.donor}`);
  }
});

test('Logs page implements complete toolbar with level counters, source filter, debounced search, autoscroll, pause/resume, copy, clear', () => {
  assert.match(avatarLog, /logs-toolbar/);
  assert.match(avatarLog, /logs-level-filters/);
  assert.match(avatarLog, /logs-source-select/);
  assert.match(avatarLog, /logs-search-wrap/);
  assert.match(avatarLog, /logs-search-input/);
  assert.match(avatarLog, /logs-search-clear/);
  assert.match(avatarLog, /z2m-btn/);
  assert.match(avatarLog, /logs-action-btn/);
  assert.doesNotMatch(avatarLog, /btn-ghost/);
  assert.doesNotMatch(avatarLog, /var\(--error\)/);
  assert.match(avatarLog, /logs-btn-autoscroll/);
  assert.match(avatarLog, /btn-pause/);
  assert.match(avatarLog, /btn-copy/);
  assert.match(avatarLog, /btn-clear/);
  assert.match(avatarLog, /logs-paused-overlay/);
  assert.match(avatarLog, /logs-scroll-bottom/);
  assert.match(avatarLog, /logs-connection-status/);
  assert.match(css, /\.logs-toolbar/);
  assert.match(css, /\.logs-level-filters/);
  assert.match(css, /\.logs-level-btn/);
  assert.match(css, /\.logs-search-wrap/);
  assert.match(css, /\.logs-paused-overlay/);
  assert.match(css, /\.logs-scroll-bottom/);
  assert.match(css, /\.logs-toolbar-right \.z2m-btn|\.logs-action-btn/);
  assert.match(css, /\.logs-btn-autoscroll\.active/);
  assert.match(css, /\.logs-btn-pause\.paused/);
  assert.match(css, /\.logs-btn-clear/);
  assert.match(css, /\.logs-conn-polling \.logs-conn-dot[^{]*\{[^}]*animation:[^;]*z2m-dot-pulse/);
  assert.match(css, /@keyframes z2m-dot-pulse/);
});

test('Logs page maintains bounded memory and single visibility-aware poller without leaks', () => {
  assert.match(avatarLog, /MAX_ENTRIES_MEMORY\s*=\s*2000/);
  assert.match(avatarLog, /MAX_DISPLAY_ENTRIES\s*=\s*500/);
  assert.match(avatarLog, /POLL_INTERVAL_MS\s*=\s*4000/);
  assert.match(avatarLog, /document\.addEventListener\('visibilitychange'/);
  assert.match(avatarLog, /document\.removeEventListener\('visibilitychange'/);
  assert.match(avatarLog, /window\.setInterval/);
  assert.match(avatarLog, /window\.clearInterval/);
  assert.match(avatarLog, /document\.hidden/);
  assert.match(avatarLog, /pageState\.inflight/);
  assert.match(avatarLog, /mountToken/);
  assert.match(avatarLog, /pageState\.lastSeq\s*=\s*0/);
});

test('Logs page search and combined filtering highlight text and support technical details', () => {
  assert.match(avatarLog, /function matchesFilter/);
  assert.match(avatarLog, /function highlightSearch/);
  assert.match(avatarLog, /log-highlight/);
  assert.match(css, /\.log-highlight/);
  assert.match(avatarLog, /function copyPageLogs/);
  assert.match(avatarLog, /Скопировано/);
  assert.match(avatarLog, /function clearPageView/);
  assert.match(avatarLog, /Очистить текущий просмотр журнала\?/);
  assert.match(avatarLog, /Просмотр журнала очищен/);
});

test('Backend maintenance events_tail supports limit up to 500, numeric types, and sequence cursor', () => {
  assert.match(maintenanceBackend, /export const events_tail = function\(input\)/);
  assert.match(maintenanceBackend, /type\(input\.n\) == 'int'/);
  assert.match(maintenanceBackend, /type\(input\.limit\) == 'int'/);
  assert.match(maintenanceBackend, /type\(input\.since_seq\) == 'int'/);
  assert.match(maintenanceBackend, /ev\.seq\s*=\s*i\s*\+\s*1/);
  assert.match(maintenanceBackend, /last_seq:\s*length\(nonEmpty\)/);
  assert.match(maintenanceBackend, /limit > 500/);
  assert.match(maintenanceBackend, /PATHS\.events_ndjson/);
});

test('Canonical event journal is single authoritative producer and shared across all views', () => {
  // 1. Single backend event file in RAM
  assert.match(maintenanceBackend, /PATHS\.events_ndjson/);
  // 2. Consumed by Logs page
  assert.match(avatarLog, /eventsTail/);
  // 3. Consumed by Dashboard Recent Events
  assert.match(page, /eventsTail/);
  // 4. Consumed by Control journal
  assert.match(control, /eventsTail/);
  // 5. Diagnostics owns the route; AvatarLog owns the canonical consumer and poller.
  assert.match(diagnostics, /AvatarLog\.load\(ctx\)/);
  assert.match(diagnostics, /AvatarLog\.render\(ctx\)/);
  assert.match(diagnostics, /AvatarLog\.mount\(ctx\)/);
});

test('Logs view uses Graphite page-header reset without gray gradient and keeps flex layout', () => {
  assert.match(css, /#z2m-view-logs \.page-header/);
  assert.match(css, /#z2m-view-logs \.page-header[^}]*background:\s*transparent/);
  assert.match(css, /#z2m-view-logs \.page-header[^}]*box-shadow:\s*none/);
  assert.match(css, /#z2m-view-logs \.page-header[^}]*display:\s*flex/);
  assert.match(css, /#z2m-view-logs \.logs-header-actions\.sp[^}]*margin-left:\s*auto/);
});

test('Graphite token integrity: zero undefined CSS variables and canonical orange token used', () => {
  const defs = new Set([...css.matchAll(/--([a-zA-Z0-9_-]+):/g)].map(m => m[1]));
  const uses = new Set([...css.matchAll(/var\(--([a-zA-Z0-9_-]+)\)/g)].map(m => m[1]));
  const undefinedVars = [...uses].filter(v => !defs.has(v));
  assert.equal(undefinedVars.length, 0, `Undefined CSS variables: ${undefinedVars.join(', ')}`);
  assert.doesNotMatch(css, /var\(--amber\)/);
});

test('Russian product event presentation translates structured event codes and backend patterns', () => {
  assert.match(avatarLog, /function formatEventMessage/);
  assert.match(avatarLog, /Перезапуск nfqws2: запрос успешно выполнен/);
  assert.match(avatarLog, /Проверка завершена: изменений в обученном состоянии не требуется/);
  assert.match(avatarLog, /Применён черновик профилей/);
  assert.match(avatarLog, /Проверка доступности завершена/);
  assert.match(avatarLog, /rawMessage/);
});

test('Canonical event cursor contract: sequence-based cursor with no timestamp cursor dependency', () => {
  assert.match(avatarLog, /pageState\.lastSeq/);
  assert.match(avatarLog, /params\.since_seq\s*=\s*pageState\.lastSeq/);
  assert.doesNotMatch(avatarLog, /params\.since\s*=\s*pageState\.lastTs/);
});

test('Standalone Logs row has explicit flex layout styling with aligned columns and proper spacing', () => {
  assert.match(css, /\.log-row[^{]*\{[^}]*display:\s*flex/);
  assert.match(css, /\.log-row[^{]*\{[^}]*gap:\s*(?:8px|10px|12px)/);
  assert.match(css, /\.log-time\s*\{[^}]*min-width:\s*(?:5[0-9]|6[0-9]|7[0-9])px/);
  assert.match(css, /\.log-badge[^{]*\{[^}]*min-width:\s*(?:4[0-9]|5[0-9]|6[0-9])px/);
  assert.match(css, /\.log-message\s*\{[^}]*flex:\s*1/);
});

test('Log viewer has Graphite-native custom scrollbar styles and subtle row separators', () => {
  assert.match(css, /\.logs-viewer|\.log-viewer/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /::-webkit-scrollbar/);
  assert.match(css, /\.log-row[^{]*\{[^}]*border-bottom:\s*1px solid/);
});

test('Universal Event Journal Unification Contract: single renderer, single CSS authority, zero duplicate overrides', () => {
  // 1. CANONICAL_LOG_ROW_RENDERER_COUNT: 1
  assert.match(avatarLog, /function createEntryElement\(entry, options\)/);
  assert.match(avatarLog, /createEntryElement: createEntryElement/);
  assert.match(avatarLog, /renderNormalized: renderNormalized/);
  assert.match(page, /AvatarLog\.renderNormalized/);
  assert.match(control, /AvatarLog\.renderNormalized/);

  // 2. CANONICAL_LOG_ROW_STYLE_AUTHORITY_COUNT: 1
  assert.match(css, /\.log-row,\s*\.log-entry\s*\{[^}]*display:\s*flex/);

  // 3. PAGE_SPECIFIC_DUPLICATE_LOG_ROW_CSS: 0
  assert.doesNotMatch(css, /\.z2m-view#z2m-view-overview\s+\.log-entry\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(css, /\.z2m-view#z2m-view-control\s+\.log-entry\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(css, /\.z2m-view#z2m-view-maintenance\s+\.log-entry\s*\{[^}]*display:\s*grid/);

  // 4. DUPLICATE_EVENT_AUTHORITY_COUNT: 0
  assert.match(avatarLog, /function normalizeRows\(envelope, limit\)/);
  assert.match(avatarLog, /normalizeRows: normalizeRows/);
  assert.doesNotMatch(page, /function normalizeLogs|function normalizeRows/);
  assert.doesNotMatch(control, /function normalizeLogs|function normalizeRows/);

  // 5. Shared LogViewer structure: time | severity | source | message
  assert.match(avatarLog, /'class': 'log-row log-entry log-level-' \+ severity \+ ' severity-' \+ severity/);
  assert.match(avatarLog, /'class': 'log-time'/);
  assert.match(avatarLog, /'class': 'log-badge log-level severity-badge severity-' \+ severity/);
  assert.match(avatarLog, /'class': 'log-source'/);
  assert.match(avatarLog, /'class': 'log-message'/);
});
