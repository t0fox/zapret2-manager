import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const PROXYCFG = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc';
const PROVIDER = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const CSS = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css';

function loadProfilePresets() {
  const start = CORE_SOURCE.indexOf('function object(value)');
  const end = CORE_SOURCE.indexOf('// The canonical Recommended DC set');
  return vm.runInNewContext(`(function () {\n${CORE_SOURCE.slice(start, end)}\nreturn profilePresets;\n})()`);
}

const CORE_SOURCE = fs.readFileSync(CORE, 'utf8');

test('Backend defines upstream-faithful recommended/direct presets and exposes them', () => {
  const cfg = fs.readFileSync(PROXYCFG, 'utf8');
  // Rust upstream defaults: port 1443, pool 4, built-in CF domain list.
  assert.match(cfg, /function recommended_profile_settings/);
  assert.match(cfg, /function direct_profile_settings/);
  assert.match(cfg, /port:\s*1443/);
  assert.match(cfg, /defaultDomains:\s*true/);
  assert.match(cfg, /cfPriority:\s*true/);
  assert.match(cfg, /poolSize:\s*4/);
  // Custom CF/worker/MTProto/outbound stay empty until the user sets them.
  assert.match(cfg, /cfDomains:\s*\[\],\s*cfWorkerDomains:\s*\[\]/);
  // Presets travel with proxy_config_get; no new RPC surface needed.
  assert.match(cfg, /presets:\s*config_presets_block\(appliedSan\)/);
  assert.match(cfg, /function detect_config_profile/);
  // Routing signature decides the profile — listener toggles never demote it.
  assert.match(cfg, /profile_routing_is_default\(c\)/);
});

test('First initialization materializes a working recommended config (clean install)', () => {
  const provider = fs.readFileSync(PROVIDER, 'utf8');
  const cfg = fs.readFileSync(PROXYCFG, 'utf8');
  // The manager-owned default body IS the recommended preset; the listener
  // binds the router LAN address so LAN clients can actually connect.
  assert.match(provider, /'ENABLED=1\\nHOST=' \+ host \+ '\\nPORT=1443\\nLINK_IP=\\n'/);
  assert.match(provider, /DEFAULT_DOMAINS=1\\n/);
  assert.match(provider, /CF_PRIORITY=1\\n/);
  assert.match(provider, /function lan_address/);
  // Written ONLY when config.conf is missing — upgrades/reinstalls keep
  // the existing user config untouched.
  assert.match(provider, /stat\(CONFIG_DIR \+ '\/config.conf'\) == null/);
  assert.match(provider, /first-run RECOMMENDED preset|Recommended profile/);
  assert.match(cfg, /presets apply on first initialization or via explicit restore/);
});

test('Settings UI leads with a connection profile, compact routing summary and hidden advanced', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /Профиль подключения/);
  assert.match(ui, /Рекомендуемый/);
  assert.match(ui, /Прямой/);
  assert.match(ui, /Пользовательский/);
  // Human explanation, no architecture/device-capability junk.
  assert.match(ui, /Использует резервные маршруты Cloudflare при проблемах/);
  assert.doesNotMatch(ui, /aarch64|implementation ready|readiness/i);
  // Compact routing summary instead of raw expert fields — chips, not table.
  assert.match(ui, /function routingSummaryCard/);
  assert.match(ui, /z2m-tg-routing-chips/);
  assert.match(ui, /Fallback включён|Cloudflare fallback/);
  assert.match(ui, /Flowseal/);
  assert.doesNotMatch(ui, /z2m-proxy-routing-summary/);
  assert.match(ui, /Дополнительные настройки/);
  // Exactly one entry — duplicate button removed.
  assert.equal((ui.match(/Дополнительные настройки/g) || []).length, 1, 'exactly one Дополнительные настройки');
  // Advanced collapsed by default. LuCI E() stringifies attributes
  // (open:false -> open="false" => open), so the DOM property must be set.
  assert.match(ui, /tgSettingsAdvanced: false/);
  assert.match(ui, /node\.open = state\.tgSettingsAdvanced === true/);
  // No stretched CBI as top-level Basic layout.
  assert.doesNotMatch(ui, /z2m-cbi z2m-proxy-form-grid/);
  assert.match(ui, /z2m-tg-settings/);
});

test('Settings hydrate canonical state and never invent dirty drafts', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  // autostart truth = rc.d symlink state from the backend, not stale snapshot
  assert.match(ui, /rcDEnabled === true/);
  // New compact Settings uses local unsaved state, not global draft.
  assert.match(ui, /state\.tgSettingsLocal/);
  assert.match(ui, /isSettingsDirty/);
  assert.match(ui, /Несохранённые изменения/);
  assert.match(ui, /Сохранить изменения/);
  assert.doesNotMatch(ui, /координатор/i);
});

test('Settings keeps fallback profiles when config RPC has no value', () => {
  const presets = loadProfilePresets()({ config: { error: { code: 'frontend-timeout' } } });
  assert.equal(presets.recommended.port, 1443);
  assert.equal(presets.direct.defaultDomains, false);
});

test('LAN access is a first-class toggle with an advertised address line', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /Доступ из локальной сети/);
  assert.match(ui, /Адрес и порт/);
  assert.match(ui, /Этот адрес используется в ссылке и QR/);
  assert.match(ui, /function setLanAccess/);
  // loopback-only bind is the endless-connecting root cause; LAN bind default
  assert.match(ui, /lanAddress/);
  // Backend first-init binds the LAN address, not loopback
  const provider = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(provider, /function lan_address/);
  assert.match(provider, /'ENABLED=1\\nHOST=' \+ host \+ '\\nPORT=1443\\nLINK_IP=\\n'/);
  // Manager init refuses to raise a disabled config (state consistency) —
  // the canonical init validates ENABLED and refuses to start (single source
  // of truth: tg-canonical-init.sh, read by canonical_init_body()).
  const canonical = fs.readFileSync('zapret2-manager/files/usr/share/zapret2-manager/tg-canonical-init.sh', 'utf8');
  assert.match(canonical, /ENABLED.*=.*"1".*\|\|.*log_refuse/, 'canonical init must refuse ENABLED != 1');
});

test('Operation progress is a real backend-backed model, not a fake spinner', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /function operationTitle/);
  assert.match(ui, /Этап: /);
  assert.match(ui, /Причина: /);
  assert.match(ui, /Предыдущая версия восстановлена ✓/);
  assert.match(ui, /watchAttachedTgOperation/);
  // Live progress opens BEFORE the blocking RPC
  assert.match(ui, /renderTgOperationModal\(ctx, state\.tgOperation\)/);
  const backend = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(backend, /proxy-provider-operation\.v1/);
  assert.match(backend, /operation_stage\('DOWNLOAD', 40/);
  assert.match(backend, /operation_stage\('HEALTHCHECK', 90/);
  assert.match(backend, /export const proxy_provider_operation_status/);
  const product = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc', 'utf8');
  assert.match(product, /proxy_provider_operation_status\(type\(input\)/);
});

test('Component page has no readiness theater and offers manual update check', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.doesNotMatch(ui, /Проверка готовности/);
  assert.doesNotMatch(ui, /Проверка перед установкой/);
  assert.doesNotMatch(ui, /Можно установить на это устройство/);
  assert.match(ui, /Проверить обновления/);
  assert.match(ui, /Проверено только что/);
  assert.match(ui, /Установить и переключиться/);
  assert.match(ui, /function versionOptionLabel/);
  assert.match(ui, /_\('последняя'\)/);
  assert.match(ui, /_\('установлена'\)/);
  assert.match(ui, /_\('предварительная'\)/);
});

test('Overview status is truthful: green only with confirmed Telegram reachability', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /Работает с ограничениями/);
  assert.match(ui, /Подключение подтверждено/);
  assert.match(ui, /var upstreamOk = normalized\.outbound === true/);
  // No meaningless «Provider Готов» chain row
  assert.doesNotMatch(ui, /\['provider', _\('Провайдер'\)/);
  // Link/QR exposes Open Telegram and the advertised address contract
  assert.match(ui, /Открыть Telegram/);
});

test('Advanced keeps every technical capability without losing functionality', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  for (const id of ['linkIp', 'faketlsDomain', 'dcIps', 'cfDomains', 'cfWorkerDomains',
    'defaultDomains', 'cfPriority', 'cfBalance', 'outboundProxy', 'noProxy',
    'poolSize', 'bufKb', 'maxConnections', 'quiet', 'verbose']) {
    assert.ok(ui.includes("'" + id + "'"), 'advanced surface must keep ' + id);
  }
});

test('Restore Recommended shows a diff first and never touches the secret', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /function restoreRecommended/);
  assert.match(ui, /Восстановить рекомендуемые/);
  assert.match(ui, /Применить рекомендуемые/);
  assert.match(ui, /function presetDiffRows/);
  assert.match(ui, /Secret не сбрасывается и не меняется\./);
  // Connection facts survive profile restore.
  assert.match(ui, /CONNECTION_FACT_KEYS/);
  assert.match(ui, /\['enabled',\s*'autostart',\s*'host',\s*'linkIp'\]/);
});
