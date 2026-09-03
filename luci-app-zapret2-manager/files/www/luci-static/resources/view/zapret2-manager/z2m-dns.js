'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-product-ux-model as ProductUX';

var PANES = [
  ['setup', _('Настройка')],
  ['check', _('Проверка и выбор')],
  ['routing', _('Маршрутизация')],
  ['access', _('Для сервисов')],
  ['adv', _('Дополнительно')],
  ['hist', _('История')]
];
var SERVICE_TERMINAL = ['completed','applied','failed','rolled-back','cancelled','canceled','stopped'];
var DNS_MODES = { system: _('Системный DNS — без изменений'), doh: _('DoH через https-dns-proxy'), dot: _('DoT через stubby'), udp: _('Свой DNS по UDP/53') };
var PROVIDER_CATEGORIES = ['Популярные', 'Безопасные', 'Для ИИ', 'Пользовательские'];
var GLOBAL_FIELDS = ['mode','primary','secondary','hijack','cache','cacheSize','edns','minTtl','strictOrder','blockAaaa','customRules'];
var state = {
  pane: 'setup',
  manual: null, manualBaseline: null, manualBaselineRevision: null,
  selections: null, serviceBaseline: null, serviceBaselineRevision: null, serviceLabels: {},
  serviceApplyBusy: false, manualApplyBusy: false, globalApplyBusy: false,
  globalDraft: null, globalBaseline: null, globalProviders: [],
  providerBusy: {}, providerResults: {}, providerErrors: {},
  providerEditor: null, providerEditorBusy: false, providerEditorDirty: false, providerEditorError: null, providerEditorFieldErrors: {},
  providerBatch: { total: 0, completed: 0, working: 0, failed: 0 },
  allProvidersBusy: false, benchRunning: false,
  dnsCheck: null,
  operation: null, lastOperation: null,
  tiktokAuto: null, tiktokAutoBusy: false, tiktokAutoTimer: null,
  serviceOperationTimer: null, serviceOperationInFlight: false,
  openPane: null, disposed: false
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function display(value) { return value == null || value === '' ? '—' : String(value); }
function componentState(item) {
  if (item.ok === true || item.running === true) return { label: _('работает'), kind: 'g' };
  if (item.ok === false) return { label: _('ошибка'), kind: 'r' };
  if (item.initPresent === false) return { label: _('не установлен'), kind: 'o' };
  if (item.running === false) return { label: _('остановлен'), kind: 'r' };
  return { label: _('неизвестно'), kind: 'o' };
}

/* ---- page-local unsaved state ---- */
function dnsEntries(value) {
  value = object(value);
  return asArray(value.entries || value.manualEntries || value.overrides || value.applied || value.draft && value.draft.entries).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function sameEntries(left, right) {
  var actual = Array.isArray(right) ? { entries: right } : right;
  return JSON.stringify(dnsEntries({ entries: left })) === JSON.stringify(dnsEntries(actual));
}
function cloneEntries(dns) {
  var source = dns && (dns.entries || dns.manualEntries || dns.overrides || dns.applied || dns.draft && dns.draft.entries) || [];
  return asArray(source).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function sameSelections(left, right) {
  return JSON.stringify(object(left)) === JSON.stringify(object(right));
}
function changesLabel(count) {
  var mod10 = count % 10, mod100 = count % 100;
  var word = mod10 === 1 && mod100 !== 11 ? _('несохранённое изменение') :
    (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? _('несохранённых изменения') :
    _('несохранённых изменений');
  return count + ' ' + word;
}
function discardServiceSelections() {
  state.selections = null;
  state.serviceBaseline = null;
  state.serviceBaselineRevision = null;
}
function discardManualRules() {
  state.manual = null;
  state.manualBaseline = null;
  state.manualBaselineRevision = null;
}
function discardGlobalForm() {
  state.globalDraft = null;
  state.globalBaseline = null;
}
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }

function providerRows(value) {
  var source = value && (value.providers || value.items || value.available) || value || [];
  if (Array.isArray(source)) return source;
  return Object.keys(source || {}).map(function (id) {
    var item = source[id];
    return typeof item === 'object' ? Object.assign({ id: id }, item) : { id: id, name: String(item) };
  });
}
function serviceCatalogRows(value, profileValue) {
  var profiles = asArray((profileValue || value || {}).profiles);
  var services = asArray((value || {}).services);
  var profilesByService = {};
  profiles.forEach(function (profile) {
    var serviceId = profile && (profile.serviceId || profile.service);
    if (!serviceId) return;
    (profilesByService[serviceId] || (profilesByService[serviceId] = [])).push(profile);
  });
  if (!services.length) Object.keys(profilesByService).forEach(function (id) { services.push({ id: id, name: id }); });
  var seen = {}, items = [];
  services.forEach(function (service) {
    var id = service && (service.id || service.serviceId || service.key);
    if (!id || seen[id]) return;
    seen[id] = true;
    var domains = [];
    (profilesByService[id] || []).forEach(function (profile) {
      asArray(profile.requiredDomains).forEach(function (domain) {
        if (domains.indexOf(domain) < 0) domains.push(domain);
      });
    });
    items.push({
      id: id,
      name: service.name || service.label || service.displayName || id,
      category: service.category || 'other',
      description: service.description || service.limitations || '',
      domainCount: service.domainCount,
      domains: domains,
      profiles: profilesByService[id] || []
    });
  });
  return {
    ids: items.map(function (item) { return item.id; }),
    labels: items.reduce(function (out, item) { out[item.id] = item.name; return out; }, {}),
    items: items
  };
}
function serviceCategoryLabel(category) {
  return ({ AI: _('ИИ'), social: _('Соцсети'), messaging: _('Мессенджеры'), video: _('Видео'), music: _('Музыка'), games: _('Игры'), developer: _('Разработка'), media: _('Медиа'), other: _('Другое') })[category] || category;
}
function serviceIconData(item) {
  var id = String(item && item.id || '').toLowerCase();
  var aliases = { 'flowseal-discord': 'discord', 'x-twitter': 'x-twitter', 'chatgpt-openai': 'chatgpt-openai', 'google-gemini': 'gemini', 'microsoft-copilot': 'microsoft', 'meta-ai': 'meta', 'trae-ai': 'trae' };
  var colors = { tiktok: '#ff0050', spotify: '#1db954', twitch: '#9146ff', instagram: '#e4405f', youtube: '#ff0000', discord: '#5865f2', github: '#8b949e', whatsapp: '#25d366', 'x-twitter': '#e7e9ea', 'chatgpt-openai': '#10a37f', claude: '#cc9b7a', gemini: '#4285f4', grok: '#111111', manus: '#6c63ff', meta: '#0866ff', microsoft: '#5e5ce6', elevenlabs: '#111111', trae: '#0b7cff', windsurf: '#1b9aaa', parsec: '#7d5cff', supercell: '#f3a21b', jetbrains: '#ff318c', mangalib: '#e96a9a', canva: '#00c4cc', deepl: '#0f2b46', notion: '#e7e7e7', 'ntc-party': '#f1b23e', rutor: '#39a9db', square: '#00a650' };
  return { name: 'service:' + (aliases[id] || id), color: colors[id] || '#4b9fd5' };
}
function normalizeServiceSelections(selections, items) {
  var out = Object.assign({}, selections || {});
  Object.keys(out).forEach(function (serviceId) {
    var item = items.filter(function (candidate) { return candidate.id === serviceId; })[0];
    if (!item || !out[serviceId]) return;
    var exact = item.profiles.filter(function (profile) { return profile.id === out[serviceId]; })[0];
    if (exact && exact.providerId) out[serviceId] = exact.providerId;
  });
  return out;
}
function providerId(provider) { return String(provider && (provider.id || provider.providerId || provider.key) || ''); }
function providerName(provider) { return provider && (provider.name || provider.label || provider.displayName || providerId(provider)) || '—'; }
function providerIconData(provider) {
  var id = providerId(provider).toLowerCase().replace(/[_.]/g, '-');
  var label = String(provider && (provider.name || provider.label || provider.displayName) || '').toLowerCase();
  var aliases = { '1-1-1-1': 'cloudflare', cloudflare: 'cloudflare', 'google-dns': 'google', google: 'google', dnssb: 'dns-sb', 'dns-sb': 'dns-sb', 'comss-dns': 'comss', comss: 'comss', adguard: 'adguard', quad9: 'quad9', nextdns: 'nextdns', opendns: 'opendns', 'opendns-cisco': 'opendns', 'dnsdoh-art': 'dnsdoh', 'xbox-dns': 'xbox', xboxdns: 'xbox', 'xbox-dns-v2': 'xbox', 'xboxdns-v2': 'xbox', 'xbox-dns-old': 'xbox', 'xboxdns-old': 'xbox', 'malw-link': 'malw-link', 'dns-malw-link': 'malw-link' };
  var byLabel = label.indexOf('opendns') >= 0 ? 'opendns' : label.indexOf('dnsdoh') >= 0 ? 'dnsdoh' : label.indexOf('xbox') >= 0 ? 'xbox' : label.indexOf('malw.link') >= 0 ? 'malw-link' : '';
  var name = aliases[id] || byLabel || id;
  var colors = { cloudflare: '#f38020', google: '#4285f4', 'dns-sb': '#4ba3c7', comss: '#21a179', adguard: '#67b279', quad9: '#f04b35', nextdns: '#ef3f5a', opendns: '#f15a24', dnsdoh: '#2f80ed', xbox: '#107c10', 'malw-link': '#f1b23e' };
  return { name: 'provider:' + name, color: provider && provider.color || colors[name] || '#4b9fd5' };
}
function tiktokAutoStateLabel(value) {
  var stateValue = value && typeof value === 'object' ? value.state : value;
  if (value && typeof value === 'object' && value.enabled === true && (value.selectedIp || value.managed === true) && String(stateValue || '').toLowerCase() === 'healthy') return _('Исправление активно');
  return ({
    healthy: _('Работает штатно'),
    active: _('Исправление активно'), failover: _('Исправление активно'),
    checking: _('Ищем рабочий CDN…'), searching: _('Ищем рабочий CDN…'), probing: _('Ищем рабочий CDN…'),
    degraded: _('Не удалось найти рабочий CDN'), 'no-candidates': _('Не удалось найти рабочий CDN'),
    error: _('Проверка TikTok завершилась ошибкой'),
    off: _('Автоисправление выключено'), disabled: _('Автоисправление выключено')
  })[String(stateValue || 'off').toLowerCase()] || _('Состояние TikTok недоступно');
}
function tiktokSelectedCandidate(auto) {
  var selected = auto && auto.selectedCandidate;
  if (selected && typeof selected === 'object' && selected.ip) return selected;
  return auto && auto.selectedIp ? { ip: auto.selectedIp, sourceDomain: null, mode: 'legacy' } : null;
}
function tiktokResolutionSummary(auto) {
  var resolutions = asArray(auto && auto.resolutions), domains = [], addresses = asArray(auto && auto.resolvedCandidates);
  resolutions.forEach(function (item) {
    if (item && item.status === 'resolved' && item.domain && domains.indexOf(item.domain) < 0) domains.push(item.domain);
  });
  return { domains: domains, addressCount: addresses.length, domainCount: domains.length };
}
function tiktokModeLabel(mode) {
  return ({ cla: _('CLA'), ies: _('IES'), generic: _('общий CDN'), legacy: _('legacy') })[String(mode || '').toLowerCase()] || display(mode);
}
function selectedProviderId(dns, providers) {
  var selected = dns && (dns.selectedProviderId || dns.providerId || dns.selectedProvider || dns.provider && (dns.provider.id || dns.provider.providerId));
  if (selected && typeof selected === 'object') selected = selected.id || selected.providerId;
  if (selected) return String(selected);
  var row = providers.filter(function (provider) { return provider && (provider.selected === true || provider.active === true || provider.current === true); })[0];
  if (row) return providerId(row);
  var resolver = dns && (dns.resolver || dns);
  var upstream = resolver && (resolver.upstreamNameservers || resolver.nameservers || resolver.upstream);
  if (!Array.isArray(upstream) || !upstream.length) return '';
  var normalized = upstream.map(function (address) { return String(address); });
  var matched = providers.filter(function (provider) {
    var addresses = asArray(provider && provider.ipv4).map(function (address) { return String(address); });
    return addresses.length === normalized.length && addresses.every(function (address, index) { return address === normalized[index]; });
  })[0];
  return matched ? providerId(matched) : '';
}
function selectionMap(status) {
  var source = status && (status.selections || status.mappings || status.services) || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.providerId || item.provider || item.dns || '';
  });
  else Object.keys(source || {}).forEach(function (id) {
    var item = source[id];
    result[id] = typeof item === 'string' ? item : item && (item.providerId || item.provider || item.dns) || '';
  });
  return result;
}
function serviceLabelMap(status) {
  var source = status && (status.services || status.mappings || status.availableServices) || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.name || item.label || item.displayName || id;
  });
  else Object.keys(source || {}).forEach(function (id) {
    var item = source[id];
    result[id] = item && typeof item === 'object' ? item.name || item.label || item.displayName || id : id;
  });
  return result;
}
function serviceDnsChanges() {
  var changes = {};
  var seen = {};
  Object.keys(state.serviceBaseline || {}).concat(Object.keys(state.selections || {})).forEach(function (id) {
    if (seen[id]) return;
    seen[id] = true;
    var before = state.serviceBaseline && state.serviceBaseline[id] || '';
    var after = state.selections && state.selections[id] || '';
    if (before !== after) changes[id] = {
      label: state.serviceLabels[id] || id, before: before, after: after
    };
  });
  return changes;
}
function scheduleTiktokAutoCheck(ctx) {
  if (state.tiktokAutoTimer) window.clearTimeout(state.tiktokAutoTimer);
  state.tiktokAutoTimer = null;
  if (!state.tiktokAuto || state.tiktokAuto.enabled !== true || !ctx.api.dns.serviceTiktokCheck) return;
  state.tiktokAutoTimer = window.setTimeout(function () {
    state.tiktokAutoTimer = null;
    ctx.api.dns.serviceTiktokCheck().then(function () { return ctx.refresh('dns'); }).catch(function () {}).then(function () { scheduleTiktokAutoCheck(ctx); });
  }, 60000);
}
function collectMessages(value, out, depth) {
  if (depth > 5 || value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach(function (item) { collectMessages(item, out, depth + 1); }); return out; }
  if (typeof value === 'object') Object.keys(value).forEach(function (key) { collectMessages(value[key], out, depth + 1); });
  return out;
}
function terminalServiceOperation(operation) {
  var phase = String(operation && (operation.phase || operation.status || operation.state) || '').toLowerCase();
  return SERVICE_TERMINAL.indexOf(phase) >= 0 || operation && operation.done === true;
}
function serviceOperationSucceeded(operation) {
  var phase = String(operation && (operation.phase || operation.status || operation.state) || '').toLowerCase();
  return operation && operation.ok !== false && (phase === 'completed' || phase === 'applied' || operation.success === true);
}
function providerProtocol(provider) {
  if (provider.doh) return 'DoH';
  if (provider.dot) return 'DoT';
  return 'UDP/53';
}
function providerAddress(provider) {
  if (provider.doh) return provider.doh;
  if (provider.dot) return provider.dot;
  if (Array.isArray(provider.ipv4) && provider.ipv4.length) return provider.ipv4[0];
  return '—';
}
function routingAddress(provider) {
  var addresses = provider && (provider.ipv4 || provider.addresses);
  return Array.isArray(addresses) && addresses.length ? String(addresses[0]) : '';
}

/* ---- load ---- */
function globalRead(api, productRead) {
  if (api.dns && api.dns.global && api.dns.global.get)
    return api.dns.global.get();
  return (productRead || api.dns.product.get()).then(function (answer) {
    var desired = answer && answer.desired && answer.desired.global || {};
    var applied = answer && answer.applied && answer.applied.global || {};
    var revision = answer && answer.revision && answer.revision.global != null ? answer.revision.global : 0;
    return Object.assign({}, applied, { draft: desired, revision: revision });
  });
}
function load(ctx) {
  var productRead = ctx.api.dns.product.get();
  return Promise.allSettled([
    productRead, ctx.api.dns.product.providers(), ctx.api.dns.product.status(),
    ctx.api.dns.get(), ctx.api.dns.serviceStatus(), ctx.api.dns.serviceProviders(),
    ctx.api.dns.components(), ctx.api.dns.providers(), globalRead(ctx.api, productRead), ctx.api.services.catalogList(), ctx.api.dns.serviceTiktokStatus()
  ]).then(function (results) {
    return {
      product: settled(results[0], ctx.api), productProviders: settled(results[1], ctx.api), productStatus: settled(results[2], ctx.api),
      dns: settled(results[3], ctx.api), service: settled(results[4], ctx.api), serviceProviders: settled(results[5], ctx.api),
      components: settled(results[6], ctx.api), providers: settled(results[7], ctx.api), global: settled(results[8], ctx.api),
      serviceCatalog: settled(results[9], ctx.api), tiktok: settled(results[10], ctx.api)
    };
  });
}

/* ---- render ---- */
function render(ctx) {
  state.disposed = false;
  var shell = ctx.shell;
  var data = ctx.data || {};
  var product = data.product && data.product.value || {};
  var dns = data.dns && data.dns.value || {};
  var serviceStatus = data.service && data.service.value || {};
  var providerCatalog = data.productProviders && data.productProviders.value || {};
  var providers = providerRows(providerCatalog.providers || data.providers && data.providers.value || {});
  var serviceProfileCatalog = data.serviceProviders && data.serviceProviders.value || {};
  var serviceCatalog = data.serviceCatalog && data.serviceCatalog.value || {};
  var serviceProviders = providerRows(serviceProfileCatalog);
  var serviceCatalogData = serviceCatalogRows(serviceCatalog, serviceProfileCatalog);
  if (!serviceCatalogData.items.length) serviceCatalogData = serviceCatalogRows(serviceProfileCatalog, serviceProfileCatalog);
  var currentProviderId = selectedProviderId(dns, providers);
  var loadedSelections = selectionMap(serviceStatus);
  var global = data.global && data.global.value || {};
  var globalApplied = global || {};
  var productOverrides = product.applied && product.applied.overrides;
  state.tiktokAuto = data.tiktok && data.tiktok.value ? data.tiktok.value : { enabled: false, state: 'error', unavailable: true };
  if (!state.operation && serviceStatus.pending && serviceStatus.pending.operationId) state.operation = serviceStatus.pending;
  scheduleTiktokAutoCheck(ctx);

  if (state.manual == null) {
    state.manualBaseline = cloneEntries({ entries: Array.isArray(productOverrides) ? productOverrides : dns });
    state.manual = cloneEntries({ entries: state.manualBaseline });
    state.manualBaselineRevision = product.revision && product.revision.overrides != null ?
      String(product.revision.overrides) : null;
  }
  if (state.serviceBaseline == null) {
    state.serviceBaseline = Object.assign({}, loadedSelections);
    var freshDraftRevision = serviceStatus.draftRevision != null ? serviceStatus.draftRevision :
      product.revision && product.revision.service_dns;
    state.serviceBaselineRevision = freshDraftRevision != null ? String(freshDraftRevision) : null;
  }
  if (state.selections == null) state.selections = Object.assign({}, state.serviceBaseline);
  if (!Object.keys(state.serviceLabels).length) state.serviceLabels = serviceLabelMap(serviceStatus);
  Object.keys(serviceCatalogData.labels).forEach(function (id) {
    if (!state.serviceLabels[id]) state.serviceLabels[id] = serviceCatalogData.labels[id];
  });
  state.serviceBaseline = normalizeServiceSelections(state.serviceBaseline, serviceCatalogData.items);
  state.selections = normalizeServiceSelections(state.selections, serviceCatalogData.items);
  // dns-global state init
  if (state.globalBaseline == null) {
    var draft = global.draft || global;
    state.globalBaseline = {
      mode: draft.mode || global.mode || 'system',
      primary: draft.primary || global.primary || '',
      secondary: draft.secondary || global.secondary || '',
      hijack: draft.hijack === true || global.hijack === true,
      cache: draft.cache !== false && global.cache !== false,
      cacheSize: draft.cacheSize || global.cacheSize || 1500,
      edns: draft.edns === true,
      minTtl: draft.minTtl || global.minTtl || 60,
      strictOrder: draft.strictOrder !== false,
      blockAaaa: draft.blockAaaa === true,
      customRules: draft.customRules || global.customRules || '',
      revision: product.revision && product.revision.global != null ?
        String(product.revision.global) : String(draft.revision || 0)
    };
    state.globalDraft = Object.assign({}, state.globalBaseline);
  }
  if (!state.globalProviders.length)
    state.globalProviders = providerRows(global.providers || data.providers && data.providers.value || {});

  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-dns' });
  var host = E('div', { id: 'z2m-dns-pane' });
  var tabs = ctx.shell.subTabs(PANES.map(function (item) {
    return { id: item[0], label: item[1] };
  }), state.pane, function (id) { setPane(id); }, { id: 'z2m-dns-subtabs', 'aria-label': _('Разделы DNS') });

  var productStatus = data.productStatus && data.productStatus.value || {};
  var serviceHealth = data.service && data.service.value || {};
  var productState = ProductUX.state(productStatus);
  var serviceState = ProductUX.state(serviceHealth);
  var dnsmasqEvidence = object(productStatus.dnsmasq || serviceHealth.dnsmasq || dns.dnsmasq);
  var dnsmasqState = ProductUX.state(dnsmasqEvidence);
  var dnsState = productState === 'error' || serviceState === 'error' ? 'error' :
    productState === 'unknown' || serviceState === 'unknown' ? 'unknown' :
    productState === 'degraded' || serviceState === 'degraded' ? 'degraded' :
    productState === 'off' || serviceState === 'off' ? 'off' : 'ok';
  var activeProvider = providers.filter(function (provider) { return providerId(provider) === currentProviderId; })[0];
  var lastApplied = object(productStatus.lastOperation || serviceHealth.lastOperation || dns.lastOperation || product.lastOperation);
  var lastAppliedRevision = lastApplied.revision !== undefined ? lastApplied.revision :
    productStatus.appliedRevision !== undefined ? productStatus.appliedRevision : serviceHealth.appliedRevision;
  var ownership = object(serviceHealth.ownership || dns.ownership || product.ownership);
  var dnsHealth = ProductUX.statusLabel(dnsState);
  var healthKind = ProductUX.kind(dnsState);
  var taskSummary = E('div', { 'class': 'z2m-dns-task-summary-line' }, [
    shell.chip(dnsHealth, healthKind, true),
    E('span', {}, providerName(activeProvider)), E('span', { 'class': 'z2m-dns-summary-separator' }, '·'),
    E('span', {}, _('dnsmasq ') + ProductUX.statusLabel(dnsmasqState)), E('span', { 'class': 'z2m-dns-summary-separator' }, '·'),
    E('span', {}, String(state.manual.length) + ' ' + _('правил')), lastAppliedRevision == null ? null : E('span', { 'class': 'z2m-dns-summary-revision' }, 'rev ' + String(lastAppliedRevision))
  ]);

  function showError(error) {
    var mapped = ProductUX.errorMessage(ctx.api.normalizeError(error));
    shell.showToast(mapped.message, 'err');
  }

  /* ---- page-local apply lifecycle ---- */
  function revisionMismatch(expected, actual) {
    return expected != null && actual != null && String(expected) !== String(actual);
  }
  function conflictMessage() {
    return _('Настройки DNS изменились в другой сессии. Обновите страницу и повторите изменение.');
  }
  function applyError(error) {
    var normalized = ctx.api.normalizeError(error);
    var mapped = ProductUX.errorMessage(normalized, _('Не удалось применить настройки DNS.'));
    if (window.console && window.console.warn) window.console.warn('[z2m-dns] apply failed:', normalized.code || '', mapped.technical || normalized.message);
    shell.showToast(_('Не удалось применить настройки DNS.') + ' ' + mapped.message, 'err');
  }
  function localActions(dirtyCount, busy, onCancel, onApply) {
    var cancel = shell.button(_('Отменить'), 'sm', onCancel, !dirtyCount || busy);
    var apply = shell.button(_('Применить'), 'primary sm', function () {
      apply.disabled = true;
      onApply(apply);
    }, !dirtyCount || busy);
    apply.setAttribute('data-testid', 'z2m-local-apply');
    return E('div', { 'class': 'z2m-local-actions', 'data-testid': 'z2m-local-actions' }, [
      dirtyCount ? E('span', { 'class': 'z2m-local-dirty', 'data-testid': 'z2m-local-dirty' }, changesLabel(dirtyCount)) : E('span'),
      cancel,
      apply
    ]);
  }

  function cancelServiceDns() {
    state.selections = Object.assign({}, state.serviceBaseline);
    renderPane();
  }
  function applyServiceDns(button) {
    if (state.serviceApplyBusy) return;
    var desired = Object.assign({}, state.selections);
    if (!Object.keys(serviceDnsChanges()).length) return;
    state.serviceApplyBusy = true;
    if (button) button.disabled = true;
    var finish = function () {
      state.serviceApplyBusy = false;
      if (button) button.disabled = false;
    };
    var stagedSet = null;
    ctx.api.dns.serviceStatus().then(function (status) {
      if (revisionMismatch(state.serviceBaselineRevision, status && status.draftRevision))
        throw { code: 'E_REVISION_CONFLICT', message: conflictMessage() };
      return edit(ctx.api.dns.product.validate, {
        scope: 'service_dns',
        value: { selections: desired },
        revision: status && status.draftRevision
      });
    }).then(function (answer) {
      if (!answer || answer.ok === false || answer.error)
        throw answer && answer.error || answer || new Error('service_dns validation failed');
      return edit(ctx.api.dns.serviceSet, { selections: desired });
    }).then(function (saved) {
      if (!saved || saved.ok !== true)
        throw saved && saved.error || saved || new Error('service_dns set failed');
      stagedSet = saved;
      // Track the accepted write so a retry after a failed apply is not
      // mistaken for an external revision conflict.
      if (saved.draftRevision != null) state.serviceBaselineRevision = String(saved.draftRevision);
      return edit(ctx.api.dns.serviceApply, { revision: saved.draftRevision }).then(undefined, function (error) {
        var normalized = ctx.api.normalizeError(error);
        if (normalized.code === 'EAPPLYTIMEOUT') {
          // Long-running apply: hand over to the existing async operation poller.
          state.operation = { operationId: stagedSet.operationId || normalized.operationId };
          scheduleServiceOperationPoll();
          throw { handled: true };
        }
        throw error;
      });
    }).then(function () {
      return ctx.api.dns.serviceStatus();
    }).then(function (status) {
      var appliedSelections = selectionMap(status);
      if (!sameSelections(appliedSelections, desired))
        throw { code: 'E_VERIFY', message: _('Backend не подтвердил применённые назначения.') };
      state.serviceBaseline = appliedSelections;
      state.serviceBaselineRevision = status && status.draftRevision != null ? String(status.draftRevision) : null;
      state.selections = Object.assign({}, state.serviceBaseline);
      finish();
      shell.showToast(_('Настройки DNS применены.'), 'ok');
      renderPane();
    }).catch(function (error) {
      finish();
      if (error && error.handled) { renderPane(); return; }
      if (error && error.code === 'E_REVISION_CONFLICT') {
        // Local edits stay in place; user re-bases by updating the page.
        shell.showToast(conflictMessage(), 'err');
        return;
      }
      applyError(error);
    });
  }

  function manualChangedCount() {
    var before = {}, after = {};
    dnsEntries({ entries: state.manualBaseline || [] }).forEach(function (entry) { before[entry.domain] = JSON.stringify(entry); });
    dnsEntries({ entries: state.manual || [] }).forEach(function (entry) { after[entry.domain] = JSON.stringify(entry); });
    var ids = {};
    Object.keys(before).forEach(function (key) { ids[key] = true; });
    Object.keys(after).forEach(function (key) { ids[key] = true; });
    return Object.keys(ids).filter(function (key) { return before[key] !== after[key]; }).length;
  }
  function cancelManualRules() {
    state.manual = cloneEntries({ entries: state.manualBaseline });
    renderPane();
  }
  function applyManualRules(button) {
    if (state.manualApplyBusy) return;
    var desired = cloneEntries({ entries: state.manual || [] });
    if (!manualChangedCount()) return;
    state.manualApplyBusy = true;
    if (button) button.disabled = true;
    var finish = function () {
      state.manualApplyBusy = false;
      if (button) button.disabled = false;
    };
    ctx.api.dns.product.get().then(function (answer) {
      var revision = answer && answer.revision && answer.revision.overrides;
      if (revisionMismatch(state.manualBaselineRevision, revision))
        throw { code: 'E_REVISION_CONFLICT', message: conflictMessage() };
      return edit(ctx.api.dns.product.validate, {
        scope: 'overrides', value: { entries: desired }, revision: revision
      }).then(function (validated) {
        if (!validated || validated.ok === false || validated.error)
          throw validated && validated.error || validated || new Error('overrides validation failed');
        return edit(ctx.api.dns.set, { entries: desired, revision: revision });
      }).then(function (saved) {
        if (!saved || saved.ok !== true)
          throw saved && saved.error || saved || new Error('overrides set failed');
        if (saved.revision != null) state.manualBaselineRevision = String(saved.revision);
        return edit(ctx.api.dns.apply, {});
      });
    }).then(function (applied) {
      if (!applied || applied.ok === false || applied.error)
        throw applied && applied.error || applied || new Error('overrides apply failed');
      return ctx.api.dns.product.get();
    }).then(function (answer) {
      if (!sameEntries(answer && answer.applied && answer.applied.overrides, desired))
        throw { code: 'E_VERIFY', message: _('Backend не подтвердил применённые правила.') };
      state.manualBaseline = cloneEntries({ entries: answer.applied.overrides });
      state.manualBaselineRevision = answer.revision && answer.revision.overrides != null ?
        String(answer.revision.overrides) : null;
      state.manual = cloneEntries({ entries: state.manualBaseline });
      finish();
      shell.showToast(_('Настройки DNS применены.'), 'ok');
      renderPane();
    }).catch(function (error) {
      finish();
      if (error && error.code === 'E_REVISION_CONFLICT') {
        shell.showToast(conflictMessage(), 'err');
        return;
      }
      applyError(error);
    });
  }

  function globalChangedCount() {
    var baseline = state.globalBaseline || {}, current = state.globalDraft || {};
    return GLOBAL_FIELDS.filter(function (field) {
      return String(baseline[field]) !== String(current[field]);
    }).length;
  }
  function cancelGlobalForm() {
    state.globalDraft = Object.assign({}, state.globalBaseline);
    renderPane();
  }
  function applyGlobalForm(button) {
    if (state.globalApplyBusy) return;
    var payloadValue = {};
    GLOBAL_FIELDS.forEach(function (field) { payloadValue[field] = state.globalDraft[field]; });
    if (!globalChangedCount()) return;
    state.globalApplyBusy = true;
    if (button) button.disabled = true;
    var finish = function () {
      state.globalApplyBusy = false;
      if (button) button.disabled = false;
    };
    function readCanonical() {
      return globalRead(ctx.api, function () { return ctx.api.dns.product.get(); });
    }
    readCanonical().then(function (canonical) {
      if (revisionMismatch(state.globalBaseline && state.globalBaseline.revision, canonical.revision))
        throw { code: 'E_REVISION_CONFLICT', message: conflictMessage() };
      return edit(ctx.api.dns.product.validate, {
        scope: 'global', value: payloadValue, revision: canonical.revision
      }).then(function (validated) {
        if (!validated || validated.ok === false || validated.error)
          throw validated && validated.error || validated || new Error('global validation failed');
        return edit(ctx.api.dns.global.set, Object.assign({}, payloadValue, { revision: canonical.revision }));
      }).then(function (saved) {
        if (!saved || saved.ok === false || saved.error)
          throw saved && saved.error || saved || new Error('global set failed');
        if (saved.revision != null && state.globalBaseline) state.globalBaseline.revision = String(saved.revision);
        return ctx.api.dns.global.apply();
      });
    }).then(function (applied) {
      if (!applied || applied.ok === false || applied.error)
        throw applied && applied.error || applied || new Error('global apply failed');
      return readCanonical();
    }).then(function (canonical) {
      var mismatch = GLOBAL_FIELDS.filter(function (field) {
        return String(canonical[field]) !== String(payloadValue[field]);
      }).length;
      if (mismatch) throw { code: 'E_VERIFY', message: _('Backend не подтвердил применённые настройки.') };
      state.globalBaseline = { revision: String(canonical.revision || 0) };
      GLOBAL_FIELDS.forEach(function (field) { state.globalBaseline[field] = canonical[field]; });
      state.globalDraft = Object.assign({}, state.globalBaseline);
      finish();
      shell.showToast(_('Настройки DNS применены.'), 'ok');
      renderPane();
    }).catch(function (error) {
      finish();
      if (error && error.code === 'E_REVISION_CONFLICT') {
        shell.showToast(conflictMessage(), 'err');
        return;
      }
      applyError(error);
    });
  }
  function setPane(id) {
    state.pane = id;
    renderPane();
  }
  state.openPane = setPane;

  /* ---- setup pane ---- */
  function renderSetup() {
    var dg = state.globalDraft;
    var systemMode = dg.mode === 'system';
    var modeSelect = E('select', { id: 'z2m-dns-mode', 'class': 'z2m-select', 'aria-label': _('Режим разрешения имён') });
    ['system','doh','dot','udp'].forEach(function (m) {
      modeSelect.appendChild(E('option', { value: m, selected: dg.mode === m ? 'selected' : undefined }, DNS_MODES[m]));
    });
    modeSelect.addEventListener('change', function () {
      state.globalDraft.mode = modeSelect.value;
      renderPane();
    });

    var primSelect = E('select', { id: 'z2m-dns-primary', 'class': 'z2m-select', 'aria-label': _('Основной провайдер'), disabled: systemMode ? 'disabled' : undefined });
    primSelect.appendChild(E('option', { value: '' }, _('— выберите —')));
    state.globalProviders.forEach(function (p) {
      primSelect.appendChild(E('option', { value: p.id, selected: dg.primary === p.id ? 'selected' : undefined }, p.name || p.id));
    });
    primSelect.addEventListener('change', function () {
      state.globalDraft.primary = primSelect.value;
      renderPane();
    });

    var secSelect = E('select', { id: 'z2m-dns-secondary', 'class': 'z2m-select', 'aria-label': _('Запасной провайдер'), disabled: systemMode ? 'disabled' : undefined });
    secSelect.appendChild(E('option', { value: '' }, _('Нет')));
    state.globalProviders.forEach(function (p) {
      secSelect.appendChild(E('option', { value: p.id, selected: dg.secondary === p.id ? 'selected' : undefined }, p.name || p.id));
    });
    secSelect.addEventListener('change', function () {
      state.globalDraft.secondary = secSelect.value;
      renderPane();
    });

    var hijackSw = E('span', { 'class': 'z2m-sw' + (dg.hijack ? ' on' : ''), 'data-set': 'dnsHijack', role: 'switch', 'aria-checked': dg.hijack ? 'true' : 'false', tabindex: '0', 'aria-label': _('Запрещать сторонний DNS в сети') }, [E('i')]);
    hijackSw.addEventListener('click', function () {
      state.globalDraft.hijack = !state.globalDraft.hijack;
      renderPane();
    });

    var cacheSw = E('span', { 'class': 'z2m-sw' + (dg.cache ? ' on' : ''), 'data-set': 'dnsCache', role: 'switch', 'aria-checked': dg.cache ? 'true' : 'false', tabindex: '0', 'aria-label': _('Кэшировать ответы') }, [E('i')]);
    cacheSw.addEventListener('click', function () {
      state.globalDraft.cache = !state.globalDraft.cache;
      renderPane();
    });

    // system card
    var sysCard;
    if (systemMode) {
      sysCard = E('div', { 'class': 'z2m-dns-system-card z2m-dns-active-status' }, [
        E('div', {}, [E('b', {}, _('Системный DNS')), E('span', { 'class': 'z2m-dns-active-description' }, _('dnsmasq продолжает использовать текущие настройки OpenWrt/DHCP. Менеджер ничего не заменяет.'))]),
        E('span', { 'class': 'chip g z2m-dns-active-badge' }, _('активен'))
      ]);
    }

    // status table
    function responseText(provider) {
      var result = provider && state.providerResults[providerId(provider)];
      if (!result) return _('не измерялся');
      var ms = result.latencyMs != null ? result.latencyMs : result.responseMs != null ? result.responseMs : result.elapsedMs;
      if (ms != null) return String(ms) + ' мс';
      return result.ok === true || result.dnsAnswered === true ? _('отвечает') : _('нет ответа');
    }
    function renderStatusTable() {
      var rows = [];
      if (systemMode) {
        rows.push(E('tr', {}, [E('td', {}, _('Системный DNS')), E('td', { 'class': 'mono dim' }, _('из настроек dnsmasq / DHCP')), E('td', {}, _('наследуется')), E('td', { 'class': 'num' }, _('не измерялся')), E('td', {}, E('span', { 'class': 'chip g' }, _('используется')))]));
      } else {
        if (dg.primary) {
          var pp = state.globalProviders.filter(function (p) { return p.id === dg.primary; })[0];
          rows.push(E('tr', {}, [E('td', {}, (pp ? pp.name : dg.primary)), E('td', { 'class': 'mono dim' }, pp ? providerAddress(pp) : '—'), E('td', {}, providerProtocol(pp || {})), E('td', { 'class': 'num' }, responseText(pp)), E('td', {}, E('span', { 'class': 'chip g' }, _('основной')))]));
        }
        if (dg.secondary && dg.secondary !== '') {
          var sp = state.globalProviders.filter(function (p) { return p.id === dg.secondary; })[0];
          rows.push(E('tr', {}, [E('td', {}, (sp ? sp.name : dg.secondary)), E('td', { 'class': 'mono dim' }, sp ? providerAddress(sp) : '—'), E('td', {}, providerProtocol(sp || {})), E('td', { 'class': 'num' }, responseText(sp)), E('td', {}, E('span', { 'class': 'chip' }, _('запасной')))]));
        }
        // show current WAN upstream if available
        if (globalApplied.wanDns && globalApplied.wanDns !== '') {
          rows.push(E('tr', {}, [E('td', {}, _('Провайдер (DHCP)')), E('td', { 'class': 'mono dim' }, globalApplied.wanDns), E('td', {}, 'UDP/53'), E('td', { 'class': 'num' }, _('не измерялся')), E('td', {}, E('span', { 'class': 'chip o' }, _('не используется')))]));
        }
      }
      if (!rows.length) rows.push(E('tr', {}, [E('td', { colspan: '5', 'class': 'dim' }, _('Нет данных о DNS-провайдерах.'))]));
      return E('table', { 'class': 't' }, [
        E('thead', {}, [E('tr', {}, [E('th', {}, _('Провайдер')), E('th', {}, _('Адрес')), E('th', {}, _('Протокол')), E('th', {}, _('Отклик')), E('th', {}, _('Статус'))])]),
        E('tbody', {}, rows)
      ]);
    }

    // collect dns check result
    var checkResult = E('div', { 'class': 'z2m-dns-check-result' }, state.dnsCheck ? renderDnsCheck(state.dnsCheck) : E('div', { 'class': 'z2m-dim' }, _('DNS ещё не проверялся.')));

    function renderDnsCheck(answer) {
      var messages = collectMessages(answer, [], 0).filter(Boolean).slice(0, 12);
      var ok = answer && answer.ok === true;
      return E('div', { 'class': ok ? 'z2m-provider-result-success' : 'z2m-provider-result-fail' }, [
        shell.chip(ok ? _('DNS отвечает') : _('Требуется проверка'), ok ? 'g' : 'o'),
        messages.length ? E('div', { 'class': 'z2m-dim' }, messages.join(' · ')) : E('span')
      ]);
    }

    function checkDns(button, resultHost) {
      button.disabled = true;
      edit(ctx.api.dns.check, {}).then(function (answer) {
        if (!answer || answer.ok === false) throw answer || new Error('dns_check failed');
        state.dnsCheck = answer;
        resultHost.replaceChildren(renderDnsCheck(answer));
        shell.showToast(_('DNS проверен.'), 'ok');
      }).catch(function (error) {
        resultHost.replaceChildren(E('div', { 'class': 'warnbar' }, ctx.api.normalizeError(error).message));
        showError(error);
      }).then(function () { button.disabled = false; });
    }
    var checkButton = shell.button(_('Проверить DNS'), 'sm', function () { checkDns(checkButton, checkResult); });

    return E('div', {}, [
      sysCard ? sysCard : E('span'),
      shell.panel(_('Глобальный DNS'), E('div', {}, [
        E('p', { 'class': 'z2m-dim' }, _('Менять DNS не обязательно. По умолчанию менеджер оставляет текущую схему OpenWrt/dnsmasq без изменений. Свой DoH, DoT или UDP-сервер включается только явно.')),
        E('div', { 'class': 'z2m-global-dns-form' }, [
          E('div', { 'class': 'z2m-dns-form-row' }, [E('label', {}, _('Режим разрешения имён')), modeSelect, E('span', { 'class': 'z2m-hint' }, _('Определяет, кто обрабатывает DNS-запросы.'))]),
          E('div', { 'class': 'z2m-dns-form-row' }, [E('label', {}, _('Основной провайдер')), primSelect, E('span', { 'class': 'z2m-hint' }, systemMode ? _('Доступно для DoH, DoT и UDP.') : _('Основной DNS-сервер для выбранного режима.'))]),
          E('div', { 'class': 'z2m-dns-form-row' }, [E('label', {}, _('Запасной провайдер')), secSelect, E('span', { 'class': 'z2m-hint' }, systemMode ? _('Доступно для DoH, DoT и UDP.') : _('Используется при недоступности основного.'))]),
          E('div', { 'class': 'z2m-dns-form-row' }, [E('label', {}, _('Запрещать сторонний DNS в сети')), E('div', { 'class': 'z2m-dns-toggle-control' }, [hijackSw]), E('span', { 'class': 'z2m-hint' }, _('Перехват UDP/TCP-запросов на порт 53.'))]),
          E('div', { 'class': 'z2m-dns-form-row' }, [E('label', {}, _('Кэшировать ответы')), E('div', { 'class': 'z2m-dns-toggle-control' }, [cacheSw]), E('span', { 'class': 'z2m-hint' }, dg.cacheSize + ' ' + _('записей'))])
        ])
      ]), _('Используется всеми клиентами сети'), localActions(globalChangedCount(), state.globalApplyBusy, cancelGlobalForm, applyGlobalForm)),
      shell.panel(_('Состояние'), E('div', { 'class': 'bd tight' }, [renderStatusTable()])),
      shell.panel(_('Проверка DNS'), E('div', {}, [checkResult, E('div', { 'class': 'btnrow', style: 'margin-top:8px' }, [checkButton])]))
    ]);
  }

  /* ---- check pane ---- */
  function renderCheck() {
    var wrapper = E('div');
    var categoryOrder = ['Популярные', 'Безопасные', 'Для ИИ'];
    var catalogRevision = providerCatalog.revision != null ? providerCatalog.revision : 0;
    function providerText(value) {
      return String(value == null ? '' : value).split(/[\n,]+/).map(function (item) { return item.trim(); }).filter(Boolean).join('\n');
    }
    function validProviderIPv4(value) {
      var parts = String(value || '').split('.');
      return parts.length === 4 && parts.every(function (part) {
        return /^[0-9]+$/.test(part) && part.length > 0 && part.length <= 3 && (part.length === 1 || part.charAt(0) !== '0') && Number(part) <= 255;
      });
    }
    function validProviderIPv6(value) {
      value = String(value || '');
      if (value.length < 2 || value.length > 45 || value.indexOf('.') >= 0 || !/^[0-9a-f:]+$/i.test(value)) return false;
      var marker = value.indexOf('::');
      if (marker >= 0) {
        if (value.indexOf('::', marker + 2) >= 0) return false;
        var left = value.slice(0, marker), right = value.slice(marker + 2), count = 0;
        if (left) {
          var leftParts = left.split(':');
          if (leftParts.some(function (part) { return !/^[0-9a-f]{1,4}$/i.test(part); })) return false;
          count += leftParts.length;
        }
        if (right) {
          var rightParts = right.split(':');
          if (rightParts.some(function (part) { return !/^[0-9a-f]{1,4}$/i.test(part); })) return false;
          count += rightParts.length;
        }
        return count < 8;
      }
      var parts = value.split(':');
      return parts.length === 8 && parts.every(function (part) { return /^[0-9a-f]{1,4}$/i.test(part); });
    }
    function providerClientFieldError(field, value) {
      if (field === 'ipv4') {
        var ipv4 = providerText(value).split('\n').filter(Boolean);
        if (!ipv4.length) return _('Добавьте хотя бы один IPv4-адрес.');
        for (var i = 0; i < ipv4.length; i++) if (!validProviderIPv4(ipv4[i])) return _('Некорректный IPv4-адрес: ') + ipv4[i];
      }
      if (field === 'ipv6') {
        var ipv6 = providerText(value).split('\n').filter(Boolean);
        for (var j = 0; j < ipv6.length; j++) if (!validProviderIPv6(ipv6[j])) return _('Некорректный IPv6-адрес: ') + ipv6[j];
      }
      if (field === 'doh' && String(value || '').trim() && !/^https:\/\//i.test(String(value).trim())) return _('DoH endpoint должен начинаться с https://.');
      return '';
    }
    function providerField(label, control, hint, field) {
      var fieldError = field && state.providerEditorFieldErrors[field];
      if (fieldError && control.setAttribute) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', 'z2m-provider-field-error-' + field);
      }
      return E('label', { 'class': 'z2m-provider-editor-field' + (fieldError ? ' has-error' : '') }, [
        E('span', {}, label), control,
        hint ? E('small', { 'class': 'z2m-hint' }, hint) : null,
        fieldError ? E('small', { 'class': 'z2m-provider-field-error', id: 'z2m-provider-field-error-' + field, role: 'alert' }, fieldError) : null
      ]);
    }
    function providerIssueText(value) {
      var raw = String(value == null ? '' : value), lower = raw.toLowerCase();
      if (lower.indexOf('name is required') >= 0) return _('Укажите название провайдера.');
      if (lower.indexOf('category is invalid') >= 0) return _('Выберите корректную категорию.');
      if (lower.indexOf('ipv4 must contain') >= 0) return _('Добавьте от 1 до 8 IPv4-адресов.');
      if (lower.indexOf('invalid ipv4 address:') >= 0) return _('Некорректный IPv4-адрес: ') + raw.split(':').slice(1).join(':').trim();
      if (lower.indexOf('ipv6 must be') >= 0) return _('IPv6-адреса должны быть массивом до 8 значений.');
      if (lower.indexOf('invalid ipv6 address:') >= 0) return _('Некорректный IPv6-адрес: ') + raw.split(':').slice(1).join(':').trim();
      if (lower.indexOf('doh must be') >= 0) return _('DoH endpoint должен начинаться с https://.');
      if (lower.indexOf('notes are required') >= 0) return _('Добавьте заметку о провайдере.');
      if (lower.indexOf('stable provider id') >= 0 || lower.indexOf('user:<slug>') >= 0) return _('ID должен быть стабильным и начинаться с user:.');
      return raw;
    }
    function providerIssueField(value) {
      var lower = String(value == null ? '' : value).toLowerCase();
      if (lower.indexOf('name ') === 0) return 'name';
      if (lower.indexOf('category ') === 0) return 'category';
      if (lower.indexOf('ipv4 ') === 0 || lower.indexOf('invalid ipv4') === 0) return 'ipv4';
      if (lower.indexOf('ipv6 ') === 0 || lower.indexOf('invalid ipv6') === 0) return 'ipv6';
      if (lower.indexOf('doh ') === 0) return 'doh';
      if (lower.indexOf('notes ') === 0) return 'notes';
      if (lower.indexOf('id ') === 0) return 'id';
      return null;
    }
    function providerErrorInfo(error) {
      var outer = object(error), nested = object(outer.error) ? outer.error : outer;
      var normalized = ctx.api.normalizeError(error), rawErrors = asArray(outer.errors || nested.errors), fieldErrors = {};
      rawErrors.forEach(function (item) {
        var message = providerIssueText(item), field = providerIssueField(item);
        if (field && !fieldErrors[field]) fieldErrors[field] = message;
      });
      var title = normalized.kind === 'rpc_unavailable' ? _('RPC недоступен') :
        normalized.kind === 'revision_conflict' ? _('Каталог устарел') :
        normalized.kind === 'dependency_blocked' ? _('Удаление заблокировано') :
        normalized.kind === 'backend_io' ? _('Overlay не записан') :
        normalized.kind === 'request_rejected' ? _('Данные не приняты') : _('Действие не выполнено');
      return {
        title: title,
        message: normalized.message,
        errors: rawErrors.map(providerIssueText),
        dependencies: asArray(outer.dependencies || nested.dependencies),
        details: normalized.details || normalized.technical,
        normalized: normalized,
        fieldErrors: fieldErrors
      };
    }
    function providerErrorNode() {
      var issue = state.providerEditorError;
      if (!issue) return null;
      var detail = issue.dependencies.length ? issue.dependencies : issue.details;
      return E('div', { 'class': 'warnbar z2m-provider-editor-error', role: 'alert', 'aria-live': 'polite' }, [
        E('strong', {}, issue.title),
        E('span', {}, issue.message),
        issue.errors.length ? E('ul', { 'class': 'z2m-provider-error-list' }, issue.errors.map(function (item) { return E('li', {}, item); })) : null,
        detail ? E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Подробнее')), E('code', {}, typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2))]) : null
      ]);
    }
    function providerEditorPanel() {
      var editor = state.providerEditor;
      if (!editor) return null;
      var provider = editor.provider || {}, isCustom = provider.origin === 'custom' || editor.mode === 'new';
      var nameInput = E('input', { type: 'text', name: 'name', autocomplete: 'off', 'class': 'z2m-input', value: provider.name || '', maxlength: '160', 'aria-label': _('Название провайдера') });
      var categoryInput = E('select', { name: 'category', 'class': 'z2m-select', 'aria-label': _('Категория провайдера') });
      PROVIDER_CATEGORIES.forEach(function (category) { categoryInput.appendChild(E('option', { value: category, selected: (provider.category || (isCustom ? 'Пользовательские' : 'Популярные')) === category ? 'selected' : undefined }, category)); });
      var ipv4Input = E('textarea', { name: 'ipv4', 'class': 'z2m-input z2m-provider-editor-textarea', rows: '3', placeholder: '1.1.1.1\n1.0.0.1', 'aria-label': _('IPv4-адреса') }, providerText(asArray(provider.ipv4)));
      var ipv6Input = E('textarea', { name: 'ipv6', 'class': 'z2m-input z2m-provider-editor-textarea', rows: '3', placeholder: '2606:4700:4700::1111', 'aria-label': _('IPv6-адреса') }, providerText(asArray(provider.ipv6)));
      var dohInput = E('input', { type: 'url', name: 'doh', autocomplete: 'url', 'class': 'z2m-input', value: provider.doh || '', placeholder: 'https://resolver.example/dns-query', 'aria-label': _('DoH endpoint') });
      var notesInput = E('textarea', { name: 'notes', 'class': 'z2m-input z2m-provider-editor-textarea', rows: '2', maxlength: '4096', placeholder: _('Короткая заметка о провайдере'), 'aria-label': _('Заметки') }, provider.notes || '');
      var dirtyStatus = E('span', { 'class': 'z2m-provider-editor-status', 'aria-live': 'polite' }, state.providerEditorDirty ? shell.chip(_('Есть несохранённые изменения'), 'o', true) : null);
      function markDirty() {
        state.providerEditorDirty = true;
        dirtyStatus.replaceChildren(shell.chip(_('Есть несохранённые изменения'), 'o', true));
      }
      function syncEditorProvider() {
        state.providerEditor.provider = Object.assign({}, state.providerEditor.provider || {}, {
          id: editor.mode === 'new' ? '' : providerId(provider),
          name: nameInput.value.trim(),
          category: categoryInput.value,
          ipv4: providerText(ipv4Input.value).split('\n').filter(Boolean),
          ipv6: providerText(ipv6Input.value).split('\n').filter(Boolean),
          doh: dohInput.value.trim() || null,
          notes: notesInput.value.trim()
        });
      }
      [nameInput, categoryInput, ipv4Input, ipv6Input, dohInput, notesInput].forEach(function (control) {
        control.addEventListener('input', markDirty);
        control.addEventListener('change', markDirty);
      });
      [[ipv4Input, 'ipv4'], [ipv6Input, 'ipv6'], [dohInput, 'doh']].forEach(function (entry) {
        entry[0].addEventListener('blur', function () {
          var field = entry[1], message = providerClientFieldError(field, entry[0].value);
          syncEditorProvider();
          if (message) {
            state.providerEditorFieldErrors[field] = message;
            state.providerEditorError = { title: _('Проверьте форму'), message: _('Исправьте отмеченные поля и повторите сохранение.'), errors: [], dependencies: [], details: null };
          } else {
            delete state.providerEditorFieldErrors[field];
            if (!Object.keys(state.providerEditorFieldErrors).length) state.providerEditorError = null;
          }
          redraw();
        });
      });
      var close = shell.button(_('Отмена'), 'sm', function () { state.providerEditor = null; state.providerEditorDirty = false; state.providerEditorError = null; state.providerEditorFieldErrors = {}; redraw(); });
      var save = shell.button(_('Сохранить'), 'primary sm', function () {
        if (state.providerEditorBusy) return;
        var payload = {
          id: editor.mode === 'new' ? '' : providerId(provider), revision: catalogRevision, name: nameInput.value.trim(), category: categoryInput.value,
          ipv4: providerText(ipv4Input.value).split('\n').filter(Boolean), ipv6: providerText(ipv6Input.value).split('\n').filter(Boolean),
          doh: dohInput.value.trim() || null, notes: notesInput.value.trim()
        };
        if (!payload.id) delete payload.id;
        var clientErrors = {};
        if (!payload.name) clientErrors.name = _('Укажите название провайдера.');
        clientErrors.ipv4 = providerClientFieldError('ipv4', payload.ipv4.join('\n'));
        if (!clientErrors.ipv4) delete clientErrors.ipv4;
        clientErrors.ipv6 = providerClientFieldError('ipv6', payload.ipv6.join('\n'));
        if (!clientErrors.ipv6) delete clientErrors.ipv6;
        clientErrors.doh = providerClientFieldError('doh', payload.doh || '');
        if (!clientErrors.doh) delete clientErrors.doh;
        if (!payload.notes) clientErrors.notes = _('Добавьте заметку о провайдере.');
        if (Object.keys(clientErrors).length) {
          syncEditorProvider();
          state.providerEditorDirty = true;
          state.providerEditorFieldErrors = clientErrors;
          state.providerEditorError = { title: _('Проверьте форму'), message: _('Исправьте отмеченные поля и повторите сохранение.'), errors: [], dependencies: [], details: null };
          redraw();
          setTimeout(function () { var first = wrapper.querySelector('[name="' + Object.keys(clientErrors)[0] + '"]'); if (first && first.focus) first.focus(); }, 0);
          return;
        }
        state.providerEditorBusy = true;
        state.providerEditorError = null;
        state.providerEditorFieldErrors = {};
        save.disabled = true;
        save.textContent = _('Сохраняем…');
        edit(ctx.api.dns.product.providerSave, payload).then(function (answer) {
          if (!answer || answer.ok === false) throw answer;
          state.providerEditor = null;
          state.providerEditorBusy = false;
          state.providerEditorDirty = false;
          state.providerEditorFieldErrors = {};
          shell.showToast(_('Провайдер сохранён.'), 'ok');
          return ctx.refresh('dns');
        }).catch(function (error) {
          state.providerEditorBusy = false;
          var issue = providerErrorInfo(error);
          state.providerEditorError = issue;
          state.providerEditorFieldErrors = issue.fieldErrors;
          state.providerEditor.provider = Object.assign({}, state.providerEditor.provider || {}, {
            id: payload.id || providerId(provider),
            name: payload.name,
            category: payload.category,
            ipv4: payload.ipv4,
            ipv6: payload.ipv6,
            doh: payload.doh,
            notes: payload.notes
          });
          save.disabled = false;
          shell.showToast(issue.message, 'err');
          redraw();
        });
      });
      var reset = !isCustom && provider.overridden === true ? shell.button(_('Сбросить изменения'), 'danger sm', function () { resetProvider(provider); }, state.providerEditorBusy) : null;
      var remove = isCustom && editor.mode !== 'new' ? shell.button(_('Удалить'), 'danger sm', function () { deleteProvider(provider); }, state.providerEditorBusy) : null;
      function editorSection(title, fields) {
        return E('section', { 'class': 'z2m-provider-editor-section' }, [E('h3', {}, title), E('div', { 'class': 'z2m-provider-editor-grid' }, fields)]);
      }
      var stableId = providerId(provider);
      var origin = provider.origin === 'custom' || editor.mode === 'new' ? _('Пользовательский') : _('Пакетный');
      var technical = E('details', { 'class': 'z2m-provider-editor-technical' }, [
        E('summary', {}, _('Технические сведения')),
        E('dl', { 'class': 'z2m-provider-technical-grid' }, [
          E('div', {}, [E('dt', {}, _('Stable ID')), E('dd', {}, stableId ? E('code', {}, stableId) : _('Будет создан автоматически'))]),
          E('div', {}, [E('dt', {}, _('Источник')), E('dd', {}, origin)]),
          E('div', {}, [E('dt', {}, _('Revision каталога')), E('dd', {}, E('code', {}, String(catalogRevision)))])
        ])
      ]);
      return E('div', { 'class': 'z2m-provider-editor', 'data-testid': 'dns-provider-editor' }, [
        E('div', { 'class': 'z2m-provider-editor-head' }, [E('div', {}, [E('strong', {}, editor.mode === 'new' ? _('Новый DNS-провайдер') : _('Редактирование провайдера')), E('small', { 'class': 'z2m-dim' }, isCustom ? _('Пользовательский профиль. Выбор DNS и применение — отдельное действие.') : _('Встроенный профиль остаётся неизменным. Здесь сохраняются только ваши изменения.')), dirtyStatus]), E('span')]),
        providerErrorNode(),
        editorSection(_('Основное'), [
          providerField(_('Название'), nameInput, null, 'name'),
          providerField(_('Категория'), categoryInput, null, 'category')
        ]),
        editorSection(_('Адреса'), [
          providerField(_('IPv4-адреса'), ipv4Input, _('По одному адресу в строке.'), 'ipv4'),
          providerField(_('IPv6-адреса'), ipv6Input, _('По одному адресу в строке.'), 'ipv6')
        ]),
        editorSection(_('Подключение'), [
          providerField(_('DoH endpoint'), dohInput, _('Оставьте пустым, если провайдер не использует DoH.'), 'doh')
        ]),
        editorSection(_('Дополнительно'), [
          providerField(_('Заметки'), notesInput, null, 'notes')
        ]),
        technical,
        E('div', { 'class': 'z2m-provider-editor-actions' }, [close, save, reset, remove])
      ]);
    }
    function openProviderEditor(provider) {
      state.providerEditor = { mode: provider ? 'edit' : 'new', provider: provider ? Object.assign({}, provider) : {} };
      state.providerEditorDirty = false;
      state.providerEditorError = null;
      state.providerEditorFieldErrors = {};
      redraw();
    }
    function resetProvider(provider) {
      if (!ctx.api.dns.product.providerReset || state.providerEditorBusy) return;
      ctx.shell.avatar.confirm({ title: _('Сбросить изменения?'), message: _('Вернуть встроенные значения ' + providerName(provider) + '?'), okLabel: _('Сбросить'), className: 'danger' }).then(function (confirmed) {
        if (!confirmed) return;
        state.providerEditorBusy = true;
        return edit(ctx.api.dns.product.providerReset, { id: providerId(provider), revision: catalogRevision }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer;
          state.providerEditorBusy = false;
          state.providerEditor = null;
          state.providerEditorDirty = false;
          return ctx.refresh('dns');
        }).catch(function (error) {
          state.providerEditorBusy = false;
          showError(error);
          redraw();
        });
      });
    }
    function deleteProvider(provider) {
      if (!ctx.api.dns.product.providerDelete || state.providerEditorBusy) return;
      ctx.shell.avatar.confirm({ title: _('Удалить DNS-провайдера?'), message: _('Если провайдер используется, удаление остановится и покажет его зависимости.'), okLabel: _('Удалить'), className: 'danger' }).then(function (confirmed) {
        if (!confirmed) return;
        state.providerEditorBusy = true;
        return edit(ctx.api.dns.product.providerDelete, { id: providerId(provider), revision: catalogRevision }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer;
          state.providerEditorBusy = false;
          state.providerEditor = null;
          state.providerEditorDirty = false;
          return ctx.refresh('dns');
        }).catch(function (error) {
          state.providerEditorBusy = false;
          showError(error);
          redraw();
        });
      });
    }
    function catalogManagementPanel() {
      var customCount = providers.filter(function (provider) { return provider.origin === 'custom'; }).length;
      var overriddenCount = providers.filter(function (provider) { return provider.overridden === true; }).length;
      var add = shell.button(_('Добавить провайдера'), 'primary sm', function () { openProviderEditor(null); }, state.providerEditorBusy);
      return shell.panel(_('Каталог DNS-провайдеров'), E('div', { 'class': 'z2m-provider-catalog', 'data-testid': 'dns-provider-catalog' }, [
        E('div', { 'class': 'z2m-provider-catalog-summary' }, [
          E('span', { 'class': 'z2m-provider-catalog-count' }, String(providers.length) + ' ' + _('провайдеров')),
          E('span', { 'class': 'z2m-provider-catalog-count' }, String(customCount) + ' ' + _('пользовательских')),
          E('span', { 'class': 'z2m-provider-catalog-count' }, String(overriddenCount) + ' ' + _('изменённых')),
          add
        ]),
        E('p', { 'class': 'z2m-dim z2m-provider-catalog-note' }, _('Встроенные профили сохраняются как есть. Ваши изменения, проверка и применение DNS — отдельные действия.')),
        E('details', { 'class': 'z2m-provider-catalog-details' }, [E('summary', {}, _('Подробнее')), E('div', { 'class': 'z2m-dim' }, [_('Revision каталога: '), E('code', {}, String(catalogRevision)), E('br'), _('Единый ID используется в глобальном DNS, правилах сервисов и диагностике.')])]),
        providerEditorPanel()
      ]));
    }
    function redraw() {
      var groups = {};
      providers.forEach(function (provider) { var category = provider.category || 'Другие'; (groups[category] || (groups[category] = [])).push(provider); });
      var list = E('div', { 'class': 'z2m-provider-groups' });
      Object.keys(groups).sort(function (a, b) { return (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)); }).forEach(function (category) {
        var body = E('div', { 'class': 'z2m-provider-group-body' });
        var group = E('section', { 'class': 'z2m-provider-group' }, [E('div', { 'class': 'z2m-provider-group-head' }, [E('h3', {}, category), E('span', { 'class': 'z2m-service-dns-count' }, String(groups[category].length) + ' ' + _('провайдера'))]), body]);
        groups[category].forEach(function (provider) {
          var id = providerId(provider), busy = state.providerBusy[id] === true, selected = id && id === currentProviderId;
          var iconData = providerIconData(provider);
          var icon = Icons.wrappedNode(iconData.name, { size: 18, fallback: 'network' });
          var diagnose = shell.button(busy ? _('Проверяется…') : _('Проверить'), 'sm', function () { diagnoseProvider(provider, redraw); }, busy || state.allProvidersBusy);
          var select = shell.button(selected ? _('Выбран') : _('Выбрать'), selected ? 'sm' : 'primary sm', function () { selectProvider(provider); }, busy || selected);
          var editProviderButton = shell.button(_('Настроить'), 'sm', function () { openProviderEditor(provider); }, state.providerEditorBusy);
          var reset = provider.overridden === true ? shell.button(_('Сбросить'), 'sm', function () { resetProvider(provider); }, state.providerEditorBusy) : null;
          var remove = provider.origin === 'custom' ? shell.button(_('Удалить'), 'danger sm', function () { deleteProvider(provider); }, state.providerEditorBusy) : null;
          var originLabel = provider.origin === 'custom' ? _('Пользовательский') : provider.overridden === true ? _('Пакетный · Изменён') : _('Пакетный');
          var metadata = E('div', { 'class': 'z2m-provider-meta' }, [shell.chip(originLabel, provider.origin === 'custom' || provider.overridden === true ? 'o' : 'g'), selected ? shell.chip(_('Используется'), 'g', true) : null]);
          body.appendChild(E('div', { 'class': 'z2m-provider-row' + (selected ? ' selected' : '') }, [
            E('span', { 'class': 'z2m-provider-icon', style: 'color:' + iconData.color }, [icon]),
            E('div', { 'class': 'z2m-provider-main' }, [E('strong', { 'class': 'z2m-provider-name' }, providerName(provider)), E('small', { 'class': 'z2m-provider-addresses' }, asArray(provider.ipv4 || provider.addresses).join(' · ') || _('Адрес не указан')), metadata]),
            E('div', { 'class': 'z2m-provider-result-cell' }, [providerResultNode(provider)]),
            E('div', { 'class': 'z2m-provider-actions' }, [diagnose, select, editProviderButton, reset, remove])
          ]));
        });
        list.appendChild(group);
      });
      if (!providers.length) list.appendChild(shell.empty(_('Провайдеры недоступны.')));
      var benchBtn = shell.button(state.allProvidersBusy ? _('Проверка выполняется…') : _('Проверить все'), 'sm', function () { checkAllProviders(redraw); }, state.allProvidersBusy || !providers.length);
      var batch = state.providerBatch && state.providerBatch.total ? state.providerBatch : { total: providers.length, completed: Object.keys(state.providerResults).length, working: 0, failed: 0 };
      var checked = state.allProvidersBusy ? batch.completed : (batch.total ? batch.completed : Object.keys(state.providerResults).length);
      var chosen = currentProviderId ? providerName(providers.filter(function (provider) { return providerId(provider) === currentProviderId; })[0]) : '—';
      var batchLabel = state.allProvidersBusy ? _('Проверяем ') + Math.min(batch.completed + 1, batch.total) + _(' из ') + batch.total + '…' :
        batch.total && batch.completed < batch.total ? _('Проверено ') + batch.completed + _(' из ') + batch.total :
        batch.total ? _('Работает: ') + batch.working + ' · ' + _('Недоступно: ') + batch.failed : _('Проверено 0 из 0');
      wrapper.replaceChildren(catalogManagementPanel(), shell.panel(_('Проверка и выбор провайдера'), E('div', {}, [
        E('div', { 'class': 'z2m-providers-summary' }, [E('span', { 'class': 'z2m-providers-progress' }, batchLabel), E('span', { 'class': 'z2m-providers-chosen' }, _('Выбран: ') + chosen), benchBtn]),
        state.allProvidersBusy ? E('div', { 'class': 'bar', style: 'margin:12px 0' }, [E('i', { class: 'g', style: 'width:100%', id: 'benchBar' })]) : E('span'),
        list
      ]), _('Проверка измеряет только фактически полученный ответ DNS.')));
    }
    redraw();
    return wrapper;
  }

  function providerResultClass(id) {
    if (state.providerErrors[id]) return 'z2m-provider-result-error';
    var result = state.providerResults[id];
    if (!result) return '';
    var probe = providerProbe(result, id);
    var ok = probe ? probe.working === true || probe.partial === true || probe.outcome === 'working' || probe.outcome === 'partial' : result.ok === true || result.dnsAnswered === true || result.status === 'ready' || result.status === 'success' || result.status === 'ok';
    return ok ? 'z2m-provider-result-success' : 'z2m-provider-result-fail';
  }
  function providerProbe(result, id) {
    return asArray(result && result.probes).filter(function (probe) { return !id || probe.provider === id; })[0] || asArray(result && result.probes)[0] || null;
  }
  function providerLatency(result, id) {
    var probe = providerProbe(result, id);
    var values = asArray(probe && probe.attempts).filter(function (attempt) {
      return attempt && attempt.dnsAnswered === true && attempt.timedOut !== true &&
        attempt.durationMeasured === true && attempt.durationSource === 'dns-query-monotonic';
    }).map(function (attempt) { return Number(attempt.durationMs); }).filter(function (value) { return isFinite(value) && value >= 0; });
    return values.length ? Math.min.apply(Math, values) : null;
  }
  function formatLatency(value) {
    if (value == null) return _('не измерялась');
    return value >= 1000 ? (value / 1000).toFixed(2) + ' с' : String(value) + ' мс';
  }
  function providerResultNode(provider) {
    var id = providerId(provider);
    var error = state.providerErrors[id];
    var result = state.providerResults[id];
    if (state.providerBusy[id] === true)
      return E('div', { 'class': 'z2m-provider-result z2m-provider-result-pending' }, [shell.chip(_('Проверяется…'), 'b', true)]);
    if (error) {
      var mapped = ProductUX.errorMessage(error, _('Проверка провайдера не выполнена.'));
      return E('div', { 'class': 'z2m-provider-result z2m-provider-result-error' }, [
        shell.chip(_('Проблема'), 'r', true),
        E('span', {}, mapped.message),
        E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Технические детали')), E('code', {}, mapped.technical)])
      ]);
    }
    if (!result) return E('div', { 'class': 'z2m-provider-result z2m-dim' }, _('Не проверен'));
    var ok = providerResultClass(id) === 'z2m-provider-result-success';
    var probe = providerProbe(result, id);
    var attempts = asArray(probe && probe.attempts);
    var answered = attempts.filter(function (attempt) { return attempt.dnsAnswered === true; }).length;
    var partial = probe && (probe.partial === true || probe.outcome === 'partial');
    var latency = providerLatency(result, id);
    var detailRows = attempts.map(function (attempt) {
      var measured = attempt && attempt.dnsAnswered === true && attempt.timedOut !== true && attempt.durationMeasured === true && attempt.durationSource === 'dns-query-monotonic';
      var timing = measured ? formatLatency(attempt.durationMs) : attempt && attempt.timedOut === true ? _('тайм-аут') : _('не измерено');
      return E('div', { 'class': 'z2m-provider-detail-row' }, [E('code', {}, display(attempt && attempt.resolverIp)), E('span', {}, timing)]);
    });
    return E('div', { 'class': 'z2m-provider-result ' + providerResultClass(id) }, [
      E('span', { 'class': 'z2m-provider-status-dot ' + (ok ? 'ok' : 'fail') }, '●'),
      E('strong', {}, ok ? (partial ? _('Частично доступен') : _('Доступен')) : _('Проблема')),
      latency == null ? null : E('span', { 'class': 'z2m-provider-latency' }, formatLatency(latency)),
      attempts.length ? E('span', { 'class': 'z2m-provider-attempts' }, answered + ' ' + _('из') + ' ' + attempts.length + ' ' + _('отвечает')) : null,
      detailRows.length ? E('details', { 'class': 'z2m-provider-details' }, [E('summary', {}, _('Детали')), E('div', { 'class': 'z2m-provider-detail-list' }, detailRows)]) : null
    ]);
  }
  function diagnoseProvider(provider, refresh) {
    var id = providerId(provider);
    if (!id || state.providerBusy[id]) return Promise.resolve();
    state.providerBusy[id] = true;
    delete state.providerResults[id];
    delete state.providerErrors[id];
    if (refresh) refresh();
    return edit(ctx.api.dns.diagnose, { provider: id }).then(function (answer) {
      if (!answer || answer.ok === false) {
        state.providerResults[id] = answer || { ok: false, message: _('Провайдер не ответил.') };
        return;
      }
      state.providerResults[id] = answer;
    }).catch(function (error) {
      state.providerErrors[id] = ctx.api.normalizeError(error).message;
    }).then(function () {
      state.providerBusy[id] = false;
      if (!state.allProvidersBusy) {
        state.providerBatch.total = providers.length;
        state.providerBatch.completed = Object.keys(state.providerResults).length + Object.keys(state.providerErrors).length;
        state.providerBatch.working = Object.keys(state.providerResults).filter(function (key) {
          var probe = providerProbe(state.providerResults[key], key);
          return probe && (probe.working === true || probe.partial === true || probe.outcome === 'working' || probe.outcome === 'partial');
        }).length;
        state.providerBatch.failed = state.providerBatch.completed - state.providerBatch.working;
      }
      if (refresh) refresh();
    });
  }
  function checkAllProviders(refresh) {
    if (state.allProvidersBusy) return;
    state.allProvidersBusy = true;
    state.providerResults = {};
    state.providerErrors = {};
    state.providerBatch = { total: providers.length, completed: 0, working: 0, failed: 0 };
    refresh();
    providers.reduce(function (chain, provider) {
      return chain.then(function () { return diagnoseProvider(provider, refresh); }).then(function () {
        state.providerBatch.completed++;
        var id = providerId(provider), result = state.providerResults[id], probe = providerProbe(result, id);
        if (probe && (probe.working === true || probe.partial === true || probe.outcome === 'working' || probe.outcome === 'partial')) state.providerBatch.working++;
        else state.providerBatch.failed++;
        refresh();
      });
    }, Promise.resolve()).then(function () {
      state.allProvidersBusy = false;
      refresh();
      shell.showToast(_('Проверка провайдеров завершена.'), 'ok');
    }).catch(function (error) {
      state.allProvidersBusy = false;
      refresh();
      showError(error);
    });
  }
  function selectProvider(provider) {
    edit(ctx.api.dns.selectProvider, { providerId: provider.id, apply: true }).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('dns_select_provider failed');
      shell.showToast(_('DNS-провайдер выбран.'), 'ok');
      return ctx.refresh('dns');
    }).catch(showError);
  }

  /* ---- access pane ---- */
  function clearServiceOperation() {
    if (state.serviceOperationTimer) window.clearTimeout(state.serviceOperationTimer);
    state.serviceOperationTimer = null;
    state.serviceOperationInFlight = false;
    state.operation = null;
  }
  function scheduleServiceOperationPoll() {
    if (state.disposed || state.serviceOperationTimer || state.serviceOperationInFlight || !state.operation) return;
    var operationId = state.operation.operationId || state.operation.id;
    if (!operationId) return;
    state.serviceOperationTimer = window.setTimeout(function () {
      state.serviceOperationTimer = null;
      pollServiceOperation(operationId);
    }, 1800);
  }
  function pollServiceOperation(operationId) {
    if (state.disposed || state.serviceOperationInFlight || !state.operation) return;
    state.serviceOperationInFlight = true;
    edit(ctx.api.dns.serviceApplyStatus, { operationId: operationId }).then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('service_dns_apply_status failed');
      var operation = answer.operation || answer;
      state.operation = Object.assign({}, state.operation, operation, { operationId: operation.operationId || operationId });
      if (terminalServiceOperation(state.operation)) {
        state.lastOperation = state.operation;
        var success = serviceOperationSucceeded(state.operation);
        clearServiceOperation();
        if (success) {
          discardServiceSelections();
          shell.showToast(_('DNS для сервисов применён.'), 'ok');
        } else shell.showToast(_('Применение DNS для сервисов завершилось с ошибкой.'), 'err');
        return ctx.refresh('dns');
      }
      return ctx.refresh('dns');
    }).catch(function (error) {
      clearServiceOperation();
      showError(error);
      ctx.refresh('dns');
    }).then(function () {
      state.serviceOperationInFlight = false;
      scheduleServiceOperationPoll();
    });
  }
  function renderAccess() {
    var services = serviceStatus.services || serviceStatus.mappings || serviceStatus.availableServices || {};
    var items = serviceCatalogData.items.slice();
    var known = {};
    items.forEach(function (item) { known[item.id] = true; });
    var statusIds = Array.isArray(services) ? services.map(function (item) { return item.id || item.serviceId; }).filter(Boolean) : Object.keys(services || {});
    statusIds.concat(Object.keys(state.serviceBaseline || {}), Object.keys(state.selections || {})).forEach(function (id) {
      if (id && !known[id]) { known[id] = true; items.push({ id: id, name: state.serviceLabels[id] || id, category: 'other', profiles: [] }); }
    });
    var effectiveProviders = providers.length ? providers : state.globalProviders;
    var providerNames = {};
    effectiveProviders.forEach(function (provider) { providerNames[provider.id || provider.providerId] = provider.name || provider.label || provider.id; });
    serviceProviders.forEach(function (provider) { providerNames[provider.id || provider.providerId] = provider.name || provider.label || provider.id; });
    var providerLabel = function (id) {
      var labels = { 'comss-dns': _('Comss DNS'), cloudflare: _('Cloudflare DNS'), 'google-dns': _('Google Public DNS'), dnssb: _('Dns.SB'), 'malw-link': _('dns.malw.link') };
      return labels[id] || providerNames[id] || id || _('По умолчанию');
    };
    var profileName = function (item, id) {
      var profile = item && item.profiles.filter(function (candidate) { return candidate.id === id; })[0];
      if (profile) return providerLabel(profile.providerId);
      if (id) return providerLabel(id);
      return _('По умолчанию');
    };
    var categoryOrder = ['AI', 'social', 'messaging', 'video', 'music', 'games', 'developer', 'media', 'other'];
    var groups = {}, records = [], groupNodes = {};
    items.forEach(function (item) { var category = item.category || 'other'; (groups[category] || (groups[category] = [])).push(item); });
    var configured = Object.keys(state.selections || {}).filter(function (id) { return state.selections[id]; }).length;
    var changes = serviceDnsChanges(), changeIds = Object.keys(changes);
    var search = E('input', { type: 'search', 'class': 'z2m-input z2m-service-dns-search', placeholder: _('Поиск сервисов или доменов…'), 'aria-label': _('Поиск сервисов') });
    var searchControl = E('label', { 'class': 'z2m-service-dns-search-control' }, [
      E('span', { 'class': 'z2m-service-dns-search-icon', 'aria-hidden': 'true' }, [Icons.wrappedNode('search', { size: 16, fallback: 'search' })]),
      search
    ]);
    var categoryFilter = E('select', { 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Категория сервисов') }, [E('option', { value: '' }, _('Все категории'))]);
    categoryOrder.concat(Object.keys(groups)).filter(function (category, index, list) { return list.indexOf(category) === index && groups[category]; }).forEach(function (category) { categoryFilter.appendChild(E('option', { value: category }, serviceCategoryLabel(category))); });
    var assignmentFilter = E('select', { 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Назначение DNS') }, [E('option', { value: '' }, _('Все назначения')), E('option', { value: 'configured' }, _('С DNS-профилем')), E('option', { value: 'default' }, _('По умолчанию')), E('option', { value: 'changed' }, _('Изменённые'))]);
    var changedOnly = E('input', { type: 'checkbox', 'class': 'z2m-service-dns-changed-only', 'aria-label': _('Показывать только изменённые') });
    var groupsRoot = E('div', { 'class': 'z2m-service-dns-list', id: 'z2m-service-dns-grid' });
    Object.keys(groups).sort(function (a, b) { return (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)); }).forEach(function (category) {
      var groupBody = E('div', { 'class': 'z2m-service-dns-section-body' });
      var groupNode = E('section', { 'class': 'z2m-service-dns-section', 'data-category': category }, [E('div', { 'class': 'z2m-service-dns-section-head' }, [E('h3', { 'class': 'z2m-service-dns-section-title' }, serviceCategoryLabel(category)), E('span', { 'class': 'z2m-service-dns-count' }, String(groups[category].length))]), groupBody]);
      groupNodes[category] = groupNode;
      groups[category].sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (item) {
        var id = item.id, before = state.serviceBaseline[id] || '', after = state.selections[id] || '', iconData = serviceIconData(item), changed = before !== after;
        var select = E('select', { 'class': 'z2m-select z2m-service-dns-select', 'aria-label': _('DNS-провайдер для ') + item.name });
        select.appendChild(E('option', { value: '' }, _('По умолчанию')));
        var optionProviders = [], optionIds = {};
        effectiveProviders.forEach(function (provider) {
          var id = providerId(provider);
          if (id && !optionIds[id]) { optionIds[id] = true; optionProviders.push(provider); }
        });
        item.profiles.forEach(function (profile) {
          var id = profile && profile.providerId;
          if (id && !optionIds[id]) { optionIds[id] = true; optionProviders.push({ id: id, name: providerLabel(id) }); }
        });
        optionProviders.forEach(function (provider) { select.appendChild(E('option', { value: providerId(provider) }, providerLabel(providerId(provider)))); });
        select.value = after;
        var domains = asArray(item.domains).slice(0, 3).join(' · ') || _('Домены сервиса');
        var currentName = profileName(item, before);
        var icon = E('span', { 'class': 'z2m-service-dns-icon', style: 'color:' + iconData.color + ';background:' + iconData.color + '22' }, [Icons.wrappedNode(iconData.name, { size: 20, fallback: 'network' })]);
        var stateNode = changed ? E('div', { 'class': 'z2m-service-dns-state draft' }, [E('span', {}, _('Сейчас: ') + currentName), E('span', {}, _('Будет: ') + profileName(item, after)), E('span', { 'class': 'z2m-unsaved-state' }, _('● Не применено'))]) : null;
        var copy = E('div', { 'class': 'z2m-service-dns-copy' }, [E('strong', { 'class': 'z2m-service-name' }, item.name), E('small', { 'class': 'z2m-service-domains', title: domains }, domains)]);
        if (id === 'tiktok') {
          var auto = state.tiktokAuto || {};
          var selectedCandidate = tiktokSelectedCandidate(auto);
          var resolutionSummary = tiktokResolutionSummary(auto);
          var domainCandidates = asArray(auto.domainCandidates);
          var sourceDomains = domainCandidates.map(function (candidate) { return candidate && candidate.domain || candidate; }).filter(Boolean);
          var sourceDomain = selectedCandidate && selectedCandidate.sourceDomain || '';
          var sourceValue = sourceDomain || (sourceDomains.length ? _('Доменный каталог') : _('Источник недоступен'));
          var selectedMode = selectedCandidate && selectedCandidate.mode;
          var tiktokProbe = selectedCandidate ? selectedCandidate.ip + (auto.latencyMs != null ? ' · ' + auto.latencyMs + ' мс' : '') : null;
          var resolvedSummary = resolutionSummary.domainCount + ' из ' + sourceDomains.length + ' ' + _('доменов') + ' · ' + resolutionSummary.addressCount + ' ' + _('адресов');
          var resolvedRows = asArray(auto.resolvedCandidates).map(function (candidate) {
            var provenance = asArray(candidate && candidate.sourceDomains).join(' · ');
            var modes = asArray(candidate && candidate.modes).map(tiktokModeLabel).join(' · ');
            return E('li', {}, [
              E('code', {}, display(candidate && candidate.ip)),
              E('span', {}, [display(provenance || _('Источник не указан')), modes ? ' · ' + modes : ''])
            ]);
          });
          var autoSwitch = shell.switchControl({ checked: auto.enabled === true, small: true, label: _('Автоисправление ленты'), disabled: state.tiktokAutoBusy === true, attrs: { type: 'button', role: 'switch', 'aria-checked': auto.enabled ? 'true' : 'false', 'class': 'z2m-sw sm z2m-tiktok-auto-switch', title: _('Включить или выключить автоисправление TikTok') }, onChange: function (enabled) { toggleTiktok(enabled); } });
          autoSwitch.classList.toggle('on', auto.enabled === true);
          autoSwitch.setAttribute('data-state', auto.enabled === true ? 'on' : 'off');
          autoSwitch.setAttribute('aria-checked', auto.enabled === true ? 'true' : 'false');
          autoSwitch.disabled = state.tiktokAutoBusy === true;
          function toggleTiktok(enabled) {
            if (!ctx.api.dns.serviceTiktokSetAsync || state.tiktokAutoBusy) return;
            state.tiktokAutoBusy = true;
            autoSwitch.disabled = true;
            autoSwitch.classList.add('busy');
            ctx.api.dns.serviceTiktokSetAsync(edit(ctx.api.dns.serviceTiktokSetAsync, { enabled: enabled })).then(function (answer) {
              if (answer && answer.operationId) state.operation = answer;
              return ctx.api.dns.serviceTiktokStatus ? ctx.api.dns.serviceTiktokStatus() : answer;
            }).then(function (status) {
              if (status && status.ok !== false) state.tiktokAuto = status;
              state.tiktokAutoBusy = false;
              return ctx.refresh('dns');
            }).catch(function (error) {
              state.tiktokAutoBusy = false;
              showError(error);
              return ctx.refresh('dns').catch(function () {});
            });
          }
          autoSwitch.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleTiktok(!auto.enabled); }
          });
          var tiktokDetails = E('details', { 'class': 'z2m-service-dns-tiktok-details' }, [
            E('summary', {}, _('Подробнее о CDN')),
            E('div', { 'class': 'z2m-service-dns-tiktok-detail-grid' }, [
              E('span', {}, _('Домены источников: ') + display(sourceDomains.join(' · '))),
              E('span', {}, _('Резолвер: ') + display(asArray(auto.resolver).join(', ') || auto.resolver)),
              E('span', {}, _('Владелец резолвера: ') + display(auto.resolverOwner)),
              E('span', {}, _('Статус DNS: ') + display(auto.resolutionStatus)),
              E('span', {}, _('Режим выбранного: ') + tiktokModeLabel(selectedMode))
            ]),
            E('strong', { 'class': 'z2m-service-dns-tiktok-detail-title' }, _('Разрешённые адреса')),
            resolvedRows.length ? E('ul', { 'class': 'z2m-service-dns-tiktok-resolved' }, resolvedRows) : E('p', { 'class': 'z2m-dim' }, _('Адреса ещё не получены.')),
            auto.lastProbe ? E('code', { 'class': 'z2m-service-dns-tiktok-last-probe' }, JSON.stringify(auto.lastProbe)) : null
          ]);
          copy.appendChild(E('div', { 'class': 'z2m-service-dns-tiktok' }, [
            E('div', { 'class': 'z2m-service-dns-tiktok-head' }, [E('strong', {}, _('Автоисправление ленты')), autoSwitch]),
            E('div', { 'class': 'z2m-service-dns-tiktok-status' }, [
              E('span', {}, tiktokAutoStateLabel(auto)),
              E('span', { 'class': 'z2m-service-dns-tiktok-source' }, [_('Источник CDN: '), E('code', {}, sourceValue), selectedMode ? ' · ' + tiktokModeLabel(selectedMode) : '']),
              E('span', { 'class': 'z2m-service-dns-tiktok-counts' }, _('Результат: ') + resolvedSummary),
              tiktokProbe ? E('code', { title: _('Проверенный CDN и задержка') }, _('Текущий адрес ') + tiktokProbe) : null
            ]),
            tiktokDetails
          ]));
        }
        if (stateNode) copy.appendChild(stateNode);
        var info = E('div', { 'class': 'z2m-service-dns-row-main z2m-service-dns-meta' }, [icon, copy]);
        var action = E('div', { 'class': 'z2m-service-dns-action z2m-service-dns-control' }, [select]);
        var rowChildren = [info, action];
        var row = E('div', { 'class': 'z2m-service-dns-row' + (changed ? ' changed' : '') + (id === 'tiktok' ? ' tiktok-row' : ''), 'data-service-dns-id': id, 'data-service-name': (item.name + ' ' + domains).toLowerCase() }, rowChildren);
        select.addEventListener('change', function () { state.selections[id] = select.value; renderPane(); });
        groupBody.appendChild(row);
        records.push({ row: row, category: category, name: (item.name + ' ' + domains).toLowerCase(), configured: !!after, changed: changed });
      });
      groupsRoot.appendChild(groupNode);
    });
    if (!items.length) groupsRoot.appendChild(shell.empty(_('Каталог сервисов недоступен.')));
    function applyFilter() {
      var query = search.value.toLowerCase(), category = categoryFilter.value, assignment = assignmentFilter.value, onlyChanged = changedOnly.checked, visible = {};
      records.forEach(function (record) {
        var show = (!query || record.name.indexOf(query) >= 0) && (!category || record.category === category) && (!onlyChanged && assignment !== 'changed' || record.changed) && (assignment !== 'configured' || record.configured) && (assignment !== 'default' || !record.configured);
        record.row.style.display = show ? '' : 'none'; if (show) visible[record.category] = true;
      });
      Object.keys(groupNodes).forEach(function (key) { groupNodes[key].style.display = visible[key] ? '' : 'none'; });
    }
    search.addEventListener('input', applyFilter); categoryFilter.addEventListener('change', applyFilter); assignmentFilter.addEventListener('change', applyFilter); changedOnly.addEventListener('change', applyFilter);
    var toolbar = E('div', { 'class': 'z2m-service-dns-toolbar' }, [searchControl, E('div', { 'class': 'z2m-service-dns-filterbar' }, [categoryFilter, assignmentFilter]), E('label', { 'class': 'z2m-service-dns-changed' }, [changedOnly, _('Только изменённые')])]);
    var accessSummary = E('p', { 'class': 'z2m-service-dns-summary' }, String(items.length) + ' ' + _('сервисов') + ' · ' + String(configured) + ' ' + _('настроено') + ' · ' + String(items.length - configured) + ' ' + _('по умолчанию'));
    var technical = E('details', { 'class': 'z2m-service-dns-technical' }, [
      E('summary', {}, _('Технические детали')),
      E('div', { 'class': 'z2m-service-dns-technical-grid' }, [
        E('span', {}, _('Глобальный DNS: ') + (globalApplied.wanDns || _('Системный DNS'))),
        E('span', {}, _('Переопределений: ') + String(configured)),
        E('span', {}, _('Конфликтов: ') + _('Нет'))
      ]),
      E('code', {}, '/etc/config/dhcp · address=/v77.tiktokcdn.com/<IP>')
    ]);
    return shell.panel(_('DNS для сервисов'), E('div', { 'class': 'z2m-service-dns-access' }, [accessSummary, toolbar, groupsRoot, technical]), _('Назначьте DNS отдельным сервисам.'), localActions(changeIds.length, state.serviceApplyBusy, cancelServiceDns, applyServiceDns));
  }

  /* ---- donor-adapted per-domain routing pane ---- */
  function renderRouting() {
    var canonical = data.product && data.product.value || {};
    var catalog = canonical.providers || data.productProviders && data.productProviders.value && data.productProviders.value.providers || [];
    var rules = state.manual || [];
    var providerOptions = providerRows(catalog).filter(function (provider) { return !!routingAddress(provider); });
    var domainInput = E('input', { type: 'text', 'class': 'z2m-input', placeholder: 'example.com', 'aria-label': _('Домен') });
    var resolverSelect = E('select', { 'class': 'z2m-select', 'aria-label': _('DNS-сервер') });
    resolverSelect.appendChild(E('option', { value: '' }, providerOptions.length ? _('Выберите DNS-сервер') : _('DNS-серверы недоступны')));
    providerOptions.forEach(function (provider) {
      resolverSelect.appendChild(E('option', { value: routingAddress(provider) }, providerName(provider)));
    });
    function addRule(domain, providerIdValue) {
      domain = String(domain || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
      providerIdValue = String(providerIdValue || '').trim();
      if (!domain || !providerIdValue || !/^[a-z0-9*._-]+$/i.test(domain)) {
        shell.showToast(_('Укажите корректный домен и DNS-сервер.'), 'err');
        return;
      }
      var next = rules.filter(function (item) { return item.domain !== domain; });
      next.push({ domain: domain, ip: providerIdValue, enabled: true });
      state.manual = next;
      renderPane();
    }
    var addButton = shell.button(_('Добавить правило'), 'primary sm', function () {
      addRule(domainInput.value, resolverSelect.value);
    }, !providerOptions.length);
    var form = E('div', { 'class': 'z2m-dns-routing-form' }, [
      E('label', {}, [_('Домен'), domainInput]),
      E('label', {}, [_('DNS-сервер'), resolverSelect]),
      addButton
    ]);
    var quick = [
      ['youtube.com', _('YouTube')], ['google.com', _('Google')], ['telegram.org', _('Telegram')],
      ['t.me', _('t.me')], ['discord.com', _('Discord')], ['facebook.com', _('Facebook')], ['instagram.com', _('Instagram')]
    ];
    var quickButtons = quick.map(function (item) {
      return shell.button(item[1], 'sm', function () {
        addRule(item[0], resolverSelect.value || providerOptions[0] && routingAddress(providerOptions[0]));
      }, !providerOptions.length);
    });
    var rows = rules.length ? E('div', { 'class': 'z2m-dns-routing-rules' }, rules.map(function (rule) {
      var provider = providerOptions.filter(function (item) { return routingAddress(item) === String(rule.ip || rule.address || ''); })[0];
      var remove = shell.button(_('Удалить'), 'danger sm', function () {
        state.manual = rules.filter(function (item) { return item.domain !== rule.domain; });
        renderPane();
      });
      return E('div', { 'class': 'z2m-dns-routing-row' }, [
        E('div', {}, [E('strong', {}, rule.domain), E('small', {}, provider ? providerName(provider) : rule.ip || _('DNS-сервер не найден'))]),
        E('span', { 'class': 'chip ' + (provider ? 'g' : 'o') }, provider ? _('готов') : _('недоступен')),
        remove
      ]);
    })) : shell.empty(_('Правил пока нет. Добавьте домен или выберите быстрый пресет.'));
    var changedCount = manualChangedCount();
    var productError = data.product && data.product.error;
    return E('div', { 'class': 'z2m-dns-routing-layout', 'data-testid': 'dns-routing-pane' }, [
      productError ? shell.statePanel({ title: _('Canonical DNS facade недоступен'), message: productError.message, kind: 'warn' }) : null,
      shell.panel(_('Per-domain DNS'), E('div', {}, [
        E('p', { 'class': 'z2m-dim' }, _('Правило отправляет запросы по домену на выбранный DNS-сервер. Изменения применяются кнопкой «Применить» ниже.')),
        form,
        E('div', { 'class': 'z2m-dns-routing-presets' }, [E('strong', {}, _('Быстрые пресеты')), E('div', { 'class': 'z2m-btnrow' }, quickButtons)])
      ])),
      shell.panel(_('Правила'), rows, _('Правила применяются к dnsmasq только после нажатия «Применить».'), localActions(changedCount, state.manualApplyBusy, cancelManualRules, applyManualRules)),
      E('div', { 'class': 'btnrow z2m-dns-routing-actions' }, [
        shell.button(_('Обновить состояние'), 'sm', function () { return ctx.refresh('dns'); })
      ])
    ]);
  }

  /* ---- adv pane ---- */
  function renderAdvanced() {
    var dg = state.globalDraft;
    var ecsSw = E('span', { 'class': 'z2m-sw' + (dg.edns ? ' on' : ''), role: 'switch', 'aria-checked': dg.edns ? 'true' : 'false', tabindex: '0', 'aria-label': _('EDNS Client Subnet') }, [E('i')]);
    ecsSw.addEventListener('click', function () {
      state.globalDraft.edns = !state.globalDraft.edns;
      renderPane();
    });
    var soSw = E('span', { 'class': 'z2m-sw' + (dg.strictOrder ? ' on' : ''), role: 'switch', 'aria-checked': dg.strictOrder ? 'true' : 'false', tabindex: '0', 'aria-label': _('Использовать DNS-серверы по порядку') }, [E('i')]);
    soSw.addEventListener('click', function () {
      state.globalDraft.strictOrder = !state.globalDraft.strictOrder;
      renderPane();
    });
    var aaaaSw = E('span', { 'class': 'z2m-sw' + (dg.blockAaaa ? ' on' : ''), role: 'switch', 'aria-checked': dg.blockAaaa ? 'true' : 'false', tabindex: '0', 'aria-label': _('Блокировать IPv6-ответы') }, [E('i')]);
    aaaaSw.addEventListener('click', function () {
      state.globalDraft.blockAaaa = !state.globalDraft.blockAaaa;
      renderPane();
    });
    var ttlInp = E('input', { type: 'number', value: dg.minTtl, style: 'max-width:120px', 'aria-label': _('Минимальный TTL') });
    ttlInp.addEventListener('change', function () {
      state.globalDraft.minTtl = int(ttlInp.value) || 60;
    });
    var rulesTa = E('textarea', { id: 'z2m-dns-custom-rules', placeholder: 'server=/example.com/1.1.1.1', 'aria-label': _('Дополнительные правила dnsmasq') }, dg.customRules);
    rulesTa.addEventListener('input', function () {
      state.globalDraft.customRules = rulesTa.value;
    });

    var components = data.components && data.components.value || {};
    var compRows = asArray(components.components || components.items);
    var compBody = compRows.length ? E('div', {}, compRows.map(function (item) {
      var status = componentState(item);
      var detail = item.message || item.status || item.path;
      if (!detail && item.initPresent === false) detail = _('Инициализационный скрипт отсутствует');
      if (!detail && item.configOwner) detail = item.configOwner;
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
        E('div', {}, [
          E('div', { 'class': 'nm' }, display(item.name || item.id)),
          E('div', { 'class': 'co' }, display(detail))
        ]),
        shell.chip(status.label, status.kind)
      ]);
    })) : E('div', { 'class': 'z2m-dim' }, _('Backend не вернул список компонентов.'));

    var ownershipDetails = E('details', { 'class': 'z2m-dns-technical-details z2m-dns-advanced-ownership' }, [
      E('summary', {}, _('Технические детали и ownership')),
      E('div', { 'class': 'z2m-dim' }, [
        E('div', {}, _('managed / external: ') + display(ownership.owner || ownership.mode || '—')),
        E('div', {}, _('provenance: ') + display(product.provenance || productStatus.provenance || serviceHealth.provenance || '—')),
        E('div', {}, _('revision: ') + display(product.revision || productStatus.revision || serviceHealth.revision || '—')),
        overrideWarning ? E('div', {}, overrideWarning) : null
      ])
    ]);
    return E('div', {}, [
      ownershipDetails,
      shell.panel(_('Дополнительные параметры'), E('div', {}, [
          E('div', { 'class': 'z2m-cbi' }, [
          E('label', {}, _('EDNS Client Subnet')),
          E('div', { style: 'display:flex;align-items:center;gap:10px' }, [ecsSw, E('span', { 'class': 'dim' }, _('Передача части адреса клиента DNS-провайдеру'))]),
          E('label', {}, _('Минимальный TTL, с')),
          E('div', {}, [ttlInp]),
          E('label', { 'class': 'z2m-dns-strict-label' }, _('Использовать DNS-серверы по порядку')),
          E('div', { 'class': 'z2m-dns-strict-control' }, [soSw, E('span', { 'class': 'z2m-dns-strict-hint' }, _('Запросы отправляются серверам последовательно, без выбора самого быстрого.'))]),
          E('label', {}, _('Блокировать IPv6-ответы (AAAA)')),
          E('div', {}, [aaaaSw]),
          E('label', {}, _('Дополнительные правила dnsmasq')),
          E('div', {}, [rulesTa, E('div', { 'class': 'hint' }, _('Проверяются перед применением. Некорректные строки будут пропущены.'))])
        ])
      ]), null, localActions(globalChangedCount(), state.globalApplyBusy, cancelGlobalForm, applyGlobalForm)),
      shell.panel(_('Компоненты DNS'), compBody, _('Состояние компонентов по данным backend.'))
    ]);
  }

  /* ---- hist pane ---- */
  function renderHistory() {
    var history = [];
    function addEvents(value) {
      asArray(value).forEach(function (event) {
        if (!event || typeof event !== 'object') return;
        var id = event.operationId || event.id;
        if (id && history.some(function (existing) { return existing.operationId === id; })) return;
        history.push(event);
      });
    }
    addEvents(dns.history);
    addEvents(serviceStatus.history);
    addEvents(serviceStatus.events);
    addEvents(dns.lastOperation ? [dns.lastOperation] : []);
    addEvents(state.lastOperation ? [state.lastOperation] : []);
    history = history.slice(0, 30);

    function eventKind(event) {
      var value = String(event && (event.kind || event.scope || event.operation || event.action) || '').toLowerCase();
      if (value.indexOf('rollback') >= 0 || event && event.rollback === true) return 'rollback';
      if (value.indexOf('service') >= 0 || value.indexOf('mapping') >= 0 || value.indexOf('route') >= 0) return 'service';
      return 'dns';
    }
    function eventTitle(event) {
      var kind = eventKind(event);
      if (kind === 'rollback') return _('Выполнен откат');
      if (kind === 'service') return _('Правила для сервисов изменены');
      return _('DNS изменён');
    }
    function eventTime(event) {
      var value = event && (event.finishedAt || event.appliedAt || event.createdAt || event.startedAt);
      if (!value) return null;
      var date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      var now = new Date();
      var time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (date.toDateString() === now.toDateString()) return _('Сегодня, ') + time;
      return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + time;
    }
    function eventSummary(event) {
      var parts = [];
      if (event && event.changedCount !== undefined) parts.push(_('Изменено сервисов: ') + event.changedCount);
      else if (event && event.serviceCount !== undefined) parts.push(_('Изменено сервисов: ') + event.serviceCount);
      else if (event && event.routeCount !== undefined && event.routeCount !== null) parts.push(_('Правил DNS: ') + event.routeCount);
      if (event && event.appliedRevision !== undefined && event.appliedRevision !== null) parts.push(_('Версия ') + event.appliedRevision);
      else if (event && event.revision !== undefined && event.revision !== null) parts.push(_('Версия ') + event.revision);
      if (event && event.verified === true) parts.push(_('Проверка пройдена'));
      if (event && (event.ok === false || event.error)) parts.push(_('Операция завершилась с ошибкой'));
      return parts.join(' · ');
    }
    function eventRow(event) {
      var kind = eventKind(event), failed = event.ok === false || event.phase === 'failed' || event.state === 'failed';
      var icon = Icons.wrappedNode(kind === 'rollback' ? 'rotate-cw' : kind === 'service' ? 'route' : 'activity', { size: 18, fallback: 'activity' });
      var technical = E('details', { 'class': 'z2m-dns-history-technical' }, [
        E('summary', {}, _('Технические сведения')),
        E('code', {}, JSON.stringify(event, null, 2))
      ]);
      return E('article', { 'class': 'z2m-dns-history-event' + (failed ? ' is-error' : '') }, [
        E('div', { 'class': 'z2m-dns-history-icon ' + kind }, [icon]),
        E('div', { 'class': 'z2m-dns-history-copy' }, [
          E('strong', {}, eventTitle(event)),
          eventTime(event) ? E('span', { 'class': 'z2m-dns-history-time' }, eventTime(event)) : null,
          eventSummary(event) ? E('p', {}, eventSummary(event)) : null,
          technical
        ]),
        shell.chip(failed ? _('Ошибка') : _('Выполнено'), failed ? 'r' : 'g')
      ]);
    }

    var historyBody = history.length ? E('div', { 'class': 'z2m-dns-history-list' }, history.map(eventRow)) : E('div', { 'class': 'z2m-dns-history-empty' }, [
      E('span', { 'class': 'z2m-dns-history-empty-icon', 'aria-hidden': 'true' }, [Icons.wrappedNode('activity', { size: 24, fallback: 'activity' })]),
      E('strong', {}, _('История пока пуста')),
      E('p', {}, _('Здесь появятся изменения DNS, правил для сервисов и выполненные откаты.'))
    ]);
    var panels = [shell.panel(_('История DNS'), historyBody)];
    if (state.operation) panels.unshift(shell.panel(_('Текущая операция'), E('div', { 'class': 'z2m-dns-history-active' }, [
      E('strong', {}, _('Изменения выполняются')),
      E('span', {}, _('Состояние обновляется автоматически.'))
    ])));

    var rollbackCards = [];
    function rollbackVersion(value) {
      var revision = value && (value.appliedRevision !== undefined ? value.appliedRevision : value.revision);
      return revision === undefined || revision === null ? null : _('Версия ') + revision;
    }
    if (dns.rollbackAvailable === true) rollbackCards.push(E('div', { 'class': 'z2m-dns-rollback-card' }, [
      E('div', {}, [E('strong', {}, _('DNS-переопределения')), rollbackVersion(dns) ? E('span', {}, rollbackVersion(dns)) : null]),
      shell.button(_('Откатить'), 'sm', function () {
        ctx.api.dns.rollback().then(function (answer) {
          if (answer && answer.ok === false) throw answer;
          shell.showToast(_('DNS откатан.'), 'ok');
          return ctx.refresh('dns');
        }).catch(showError);
      })
    ]));
    if (serviceStatus.rollbackAvailable === true && !state.operation) rollbackCards.push(E('div', { 'class': 'z2m-dns-rollback-card' }, [
      E('div', {}, [E('strong', {}, _('Правила для сервисов')), rollbackVersion(serviceStatus) ? E('span', {}, rollbackVersion(serviceStatus)) : null]),
      shell.button(_('Откатить'), 'sm', function () {
        ctx.api.dns.serviceRollback().then(function (answer) {
          if (answer && answer.ok === false) throw answer;
          shell.showToast(_('Откат DNS сервисов запущен.'), 'ok');
          return ctx.refresh('dns');
        }).catch(showError);
      })
    ]));
    if (rollbackCards.length) panels.push(shell.panel(_('Откат изменений'), E('div', { 'class': 'z2m-dns-rollback-list' }, rollbackCards)));
    return E('div', { 'class': 'z2m-dns-history-page' }, panels);
  }

  function renderPane() {
    host.replaceChildren(
      state.pane === 'setup' ? renderSetup() :
      state.pane === 'check' ? renderCheck() :
      state.pane === 'routing' ? renderRouting() :
      state.pane === 'access' ? renderAccess() :
      state.pane === 'adv' ? renderAdvanced() : renderHistory()
    );
  }

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [E('h1', {}, _('DNS')), E('p', {}, _('Upstream-серверы, провайдеры и DNS-ответы для отдельных сервисов'))])
  ]));
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) {
      var mapped = ProductUX.errorMessage(data[key].error, _('DNS данные недоступны.'));
      root.appendChild(E('div', { 'class': 'warnbar z2m-product-error' }, [
        E('strong', {}, mapped.message),
        E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Технические детали')), E('code', {}, mapped.technical)])
      ]));
    }
  });
  var messages = collectMessages(data, [], 0);
  var overrideWarning = messages.filter(function (message) { return /manager overrides|dnsmasq/i.test(message); })[0] || (dns.overridesRegistered === false || dns.dnsmasqRegistered === false ? _('Файл DNS-переопределений менеджера не подключён к dnsmasq.') : '');
  root.appendChild(tabs);
  root.appendChild(host);
  renderPane();
  if (state.operation) scheduleServiceOperationPoll();
  return root;
}

function mount() {}
function unmount() {
  state.disposed = true;
  state.openPane = null;
  if (state.serviceOperationTimer) window.clearTimeout(state.serviceOperationTimer);
  if (state.tiktokAutoTimer) window.clearTimeout(state.tiktokAutoTimer);
  state.serviceOperationTimer = null;
  state.tiktokAutoTimer = null;
  state.serviceOperationInFlight = false;
}

return baseclass.extend({
  id: 'dns', title: _('DNS'), subtitle: _('Настройка DNS, проверки провайдеров и доступ сервисов'),
  load: load, render: render, mount: mount, unmount: unmount
});
