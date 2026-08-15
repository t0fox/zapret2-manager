'use strict';
'require baseclass';

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
var state = {
  pane: 'setup',
  manual: null, manualBaseline: null,
  selections: null, serviceBaseline: null, serviceLabels: {},
  globalDraft: null, globalBaseline: null, globalProviders: [],
  providerBusy: {}, providerResults: {}, providerErrors: {},
  allProvidersBusy: false, benchRunning: false,
  dnsCheck: null,
  operation: null, lastOperation: null,
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

/* ---- dns scope adapter (existing) ---- */
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
function dnsRevision(value) {
  value = object(value);
  return value.revision != null ? value.revision : object(value.draft).revision != null ? object(value.draft).revision : null;
}
function createAdapter(api, dnsModule) {
  api = api || {};
  dnsModule = dnsModule || {};
  function expected(value) { return dnsEntries({ entries: object(value).entries }); }
  function reloadAppliedState() {
    return api.dns.product.get().then(function (answer) {
      var overrides = answer && answer.applied && answer.applied.overrides || [];
      var revision = answer && answer.revision && answer.revision.overrides;
      return { value: { entries: dnsEntries({ entries: overrides }), raw: answer || {} }, revision: revision, raw: answer || {} };
    });
  }
  function validate(value) {
    return edit(api.dns.product.validate, { scope: 'overrides', value: { entries: expected(value) }, revision: value && value.revision }).then(function (answer) {
      var errors = asArray(answer && answer.errors);
      if (!answer || answer.ok === false || answer.error || errors.length || answer.valid !== true)
        return { ok: false, message: answer && answer.error && (answer.error.message || answer.error) || errors[0] && (errors[0].message || errors[0]) || _('Проверка DNS не пройдена.') };
      return Object.assign({}, answer, { ok: true });
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value) { return validate(value); },
    previewDraft: function (scope, value, context) {
      return validate(value).then(function (answer) {
        if (!answer || answer.ok !== true) return answer;
        var read = context && context.applied && context.applied.dns || {};
        var revision = read && typeof read.revision !== 'object' ? read.revision : null;
        if (revision === null || revision === undefined) revision = read && read.raw && read.raw.revision && read.raw.revision.overrides;
        return edit(api.dns.product.preview, { scope: 'overrides', value: { entries: expected(value) }, revision: revision }).then(function (preview) {
          return Object.assign({}, preview || {}, { precondition: { revision: revision } });
        });
      });
    },
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.dns.product.apply, { scope: 'overrides', value: { entries: expected(value) }, revision: expectedRevision });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      return sameEntries(expected(value), read && read.value);
    },
    resetDraft: function () { if (dnsModule.resetDraft) dnsModule.resetDraft(); }
  };
}

/* ---- dns-global scope adapter ---- */
function createGlobalAdapter(api) {
  api = api || {};
  function globalPayload(revision) {
    var draft = state.globalDraft || {};
    return {
      mode: draft.mode, primary: draft.primary, secondary: draft.secondary,
      hijack: draft.hijack, cache: draft.cache, cacheSize: draft.cacheSize,
      edns: draft.edns, minTtl: draft.minTtl, strictOrder: draft.strictOrder,
      blockAaaa: draft.blockAaaa, customRules: draft.customRules, revision: revision
    };
  }
  return {
    supported: true,
    validateDraft: function (scope, value) {
      if (!value || !Object.keys(value.changes || {}).length) return Promise.resolve({ ok: true, valid: true });
      return edit(api.dns.product.validate, { scope: 'global', value: globalPayload(value.revision), revision: value.revision }).then(function (answer) {
        if (!answer || answer.ok === false) return { ok: false, message: answer && answer.error && answer.error.message || _('Проверка глобальных DNS не пройдена.') };
        return Object.assign({}, answer, { ok: true, valid: true });
      });
    },
    previewDraft: function (scope, value, context) {
      var read = context && context.applied && context.applied['dns-global'] || context && context.applied && context.applied.dns || {};
      var revision = read && typeof read.revision !== 'object' ? read.revision : state.globalBaseline && state.globalBaseline.revision;
      return edit(api.dns.product.preview, { scope: 'global', value: globalPayload(revision), revision: revision }).then(function (answer) {
        if (!answer || answer.ok !== true) return answer;
        return Object.assign({}, answer, { precondition: { revision: answer.revision != null ? answer.revision : revision } });
      });
    },
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.dns.product.apply, { scope: 'global', value: globalPayload(value.revision != null ? value.revision : expectedRevision), revision: value.revision != null ? value.revision : expectedRevision });
    },
    reloadAppliedState: function () {
      return api.dns.product.get().then(function (answer) {
        var draft = answer && answer.desired && answer.desired.global || {};
        var applied = answer && answer.applied && answer.applied.global || {};
        var revision = answer && answer.revision && answer.revision.global != null ? answer.revision.global : 0;
        return { value: applied, revision: revision, precondition: { revision: revision }, raw: answer || {}, draft: draft };
      });
    },
    verifyApplied: function (value, context, read) {
      return true;
    },
    resetDraft: function () {
      state.globalDraft = null;
      state.globalBaseline = null;
    }
  };
}
function sameSelections(left, right) {
  left = object(left); right = object(right);
  var keys = Object.keys(left).concat(Object.keys(right)).filter(function (key, index, all) { return all.indexOf(key) === index; }).sort();
  return keys.every(function (key) { return (left[key] || '') === (right[key] || ''); });
}
function createServiceDnsAdapter(api) {
  api = api || {};
  function readState() {
    return api.dns.product.get().then(function (answer) {
      var desired = answer && answer.desired && answer.desired.service_dns || {};
      var applied = answer && answer.applied && answer.applied.service_dns || {};
      var revision = answer && answer.revision && answer.revision.service_dns != null ? answer.revision.service_dns : 0;
      return { value: { selections: object(applied), raw: answer || {} }, revision: revision, precondition: { revision: revision }, raw: answer || {}, draft: desired };
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value) {
      if (!Object.keys(object(value && value.changes)).length) return Promise.resolve({ ok: true, valid: true });
      return edit(api.dns.product.validate, { scope: 'service_dns', value: { selections: Object.assign({}, state.selections || {}) }, revision: value && value.revision });
    },
    previewDraft: function (scope, value, context) {
      var read = context && context.applied && context.applied['service-dns'] || {};
      var revision = read && typeof read.revision !== 'object' ? read.revision : null;
      if (revision === null || revision === undefined) revision = read && read.raw && read.raw.revision && read.raw.revision.service_dns;
      return edit(api.dns.product.preview, { scope: 'service_dns', value: { selections: Object.assign({}, state.selections || {}) }, revision: revision }).then(function (answer) {
        return Object.assign({}, answer, { precondition: { revision: revision } });
      });
    },
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.dns.product.apply, { scope: 'service_dns', value: { selections: Object.assign({}, state.selections || {}) }, revision: expectedRevision });
    },
    reloadAppliedState: readState,
    verifyApplied: function (value, context, read) {
      return sameSelections(state.selections, read && read.value && read.value.selections);
    },
    resetDraft: function () {
      state.selections = null;
      state.serviceBaseline = null;
      state.serviceLabels = {};
    }
  };
}

/* ---- helpers ---- */
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function cloneEntries(dns) {
  var source = dns && (dns.entries || dns.manualEntries || dns.overrides || dns.applied || dns.draft && dns.draft.entries) || [];
  return asArray(source).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function dnsDraftChanges(baseline, entries) {
  return sameEntries(baseline, entries) ? {} : {
    entries: { label: _('Ручные DNS-переопределения'), before: cloneEntries({ entries: baseline }), after: cloneEntries({ entries: entries }) }
  };
}
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
var SERVICE_ICON_DATA = {
  'chatgpt-openai': ['AI', '#10a37f'], 'google-gemini': ['G', '#4285f4'], claude: ['C', '#cc9b7a'], 'microsoft-copilot': ['MS', '#00bcf2'],
  grok: ['X', '#1da1f2'], manus: ['M', '#7c3aed'], 'meta-ai': ['AI', '#1877f2'], 'trae-ai': ['TR', '#7c3aed'], windsurf: ['WS', '#00a6ff'],
  tiktok: ['TK', '#ff0050'], spotify: ['SP', '#1db954'], twitch: ['TW', '#9146ff'], notion: ['N', '#ffffff'], deepl: ['DL', '#0f2b46'],
  canva: ['CV', '#00c4cc'], elevenlabs: ['11', '#ffffff'], jetbrains: ['JB', '#fe315d'], mangalib: ['ML', '#f28c28'], parsec: ['PS', '#5e5ce6'],
  square: ['SQ', '#006aff'], discord: ['DC', '#5865f2'], youtube: ['YT', '#ff0000'], github: ['GH', '#8b949e'], whatsapp: ['WA', '#25d366'],
  'x-twitter': ['X', '#1da1f2'], rutor: ['RT', '#e74c3c'], 'ntc-party': ['NT', '#3498db'], 'flowseal-discord': ['FS', '#5865f2'],
  supercell: ['SC', '#f4b400'], instagram: ['IG', '#e4405f']
};
function serviceIconData(item) {
  return SERVICE_ICON_DATA[item.id] || [String(item.name || item.id || '?').slice(0, 1).toUpperCase(), '#4b9fd5'];
}
function normalizeServiceSelections(selections, items) {
  var out = Object.assign({}, selections || {});
  Object.keys(out).forEach(function (serviceId) {
    var item = items.filter(function (candidate) { return candidate.id === serviceId; })[0];
    if (!item || !out[serviceId]) return;
    var exact = item.profiles.filter(function (profile) { return profile.id === out[serviceId]; })[0];
    if (!exact) {
      var providerProfile = item.profiles.filter(function (profile) { return profile.providerId === out[serviceId]; })[0];
      if (providerProfile) out[serviceId] = providerProfile.id;
    }
  });
  return out;
}
function providerId(provider) { return String(provider && (provider.id || provider.providerId || provider.key) || ''); }
function providerName(provider) { return provider && (provider.name || provider.label || provider.displayName || providerId(provider)) || '—'; }
function selectedProviderId(dns, providers) {
  var selected = dns && (dns.selectedProviderId || dns.providerId || dns.selectedProvider || dns.provider && (dns.provider.id || dns.provider.providerId));
  if (selected && typeof selected === 'object') selected = selected.id || selected.providerId;
  if (selected) return String(selected);
  var row = providers.filter(function (provider) { return provider && (provider.selected === true || provider.active === true || provider.current === true); })[0];
  return row ? providerId(row) : '';
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
function updateServiceDnsDraft(ctx) {
  var changes = serviceDnsChanges();
  if (Object.keys(changes).length) ctx.setDraft('service-dns', { changes: changes });
  else ctx.clearDraft('service-dns');
}
function openDraft(scope) {
  if (scope !== 'service-dns') return;
  state.pane = 'access';
  if (typeof state.openPane === 'function') state.openPane('access');
}
function focusDraft(ctx, scope) {
  if (scope !== 'service-dns' || !ctx || !ctx.root || !ctx.root.querySelector) return;
  var target = ctx.root.querySelector('[data-service-dns-id].changed') || ctx.root.querySelector('#z2m-service-dns-grid');
  if (!target) return;
  target.classList.add('focus');
  if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(function () { target.classList.remove('focus'); }, 1800);
}
function resetDraft(scope) {
  if (!scope || scope === 'service-dns') {
    state.selections = null;
    state.serviceBaseline = null;
    state.serviceLabels = {};
  }
  if (!scope || scope === 'dns') { state.manual = null; state.manualBaseline = null; }
  if (!scope || scope === 'dns-global') { state.globalDraft = null; state.globalBaseline = null; }
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
    ctx.api.dns.components(), ctx.api.dns.providers(), globalRead(ctx.api, productRead), ctx.api.services.catalogList()
  ]).then(function (results) {
    return {
      product: settled(results[0], ctx.api), productProviders: settled(results[1], ctx.api), productStatus: settled(results[2], ctx.api),
      dns: settled(results[3], ctx.api), service: settled(results[4], ctx.api), serviceProviders: settled(results[5], ctx.api),
      components: settled(results[6], ctx.api), providers: settled(results[7], ctx.api), global: settled(results[8], ctx.api),
      serviceCatalog: settled(results[9], ctx.api)
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
  var providers = providerRows(data.providers && data.providers.value || {});
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

  if (state.manual == null) {
    state.manualBaseline = cloneEntries({ entries: Array.isArray(productOverrides) ? productOverrides : dns });
    state.manual = cloneEntries({ entries: state.manualBaseline });
  }
  if (state.serviceBaseline == null) state.serviceBaseline = Object.assign({}, loadedSelections);
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
      revision: draft.revision || 0
    };
    state.globalDraft = Object.assign({}, state.globalBaseline);
  }
  if (!state.globalProviders.length)
    state.globalProviders = providerRows(global.providers || data.providers && data.providers.value || {});

  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-dns' });
  var host = E('div', { id: 'z2m-dns-pane' });
  var tabs = E('div', { 'class': 'z2m-subtabs', role: 'tablist' });

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function updateGlobalDraft(updated) {
    var d = state.globalDraft;
    var b = state.globalBaseline;
    var hasChanges = d.mode !== b.mode || d.primary !== b.primary || d.secondary !== b.secondary ||
      d.hijack !== b.hijack || d.cache !== b.cache || d.cacheSize !== b.cacheSize ||
      d.edns !== b.edns || d.minTtl !== b.minTtl || d.strictOrder !== b.strictOrder ||
      d.blockAaaa !== b.blockAaaa || d.customRules !== b.customRules;
    if (hasChanges) {
      ctx.setDraft('dns-global', {
        changes: { global: { label: _('Глобальные DNS настройки'), before: b, after: d } },
        revision: d.revision
      });
    } else {
      ctx.clearDraft('dns-global');
    }
  }
  function updateDnsDraft(entries) {
    var changes = dnsDraftChanges(state.manualBaseline || [], entries);
    if (Object.keys(changes).length) ctx.setDraft('dns', { entries: entries, changes: changes });
    else ctx.clearDraft('dns');
  }
  function setPane(id) {
    state.pane = id;
    renderTabs();
    renderPane();
  }
  state.openPane = setPane;
  function renderTabs() {
    tabs.replaceChildren();
    PANES.forEach(function (item) {
      var button = E('button', {
        type: 'button', 'class': state.pane === item[0] ? 'on' : '',
        'aria-selected': state.pane === item[0] ? 'true' : 'false'
      }, item[1]);
      button.addEventListener('click', function () { setPane(item[0]); });
      tabs.appendChild(button);
    });
  }

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
      updateGlobalDraft();
      renderPane();
    });

    var primSelect = E('select', { id: 'z2m-dns-primary', 'class': 'z2m-select', 'aria-label': _('Основной провайдер'), disabled: systemMode ? 'disabled' : undefined });
    primSelect.appendChild(E('option', { value: '' }, _('— выберите —')));
    state.globalProviders.forEach(function (p) {
      primSelect.appendChild(E('option', { value: p.id, selected: dg.primary === p.id ? 'selected' : undefined }, p.name || p.id));
    });
    primSelect.addEventListener('change', function () {
      state.globalDraft.primary = primSelect.value;
      updateGlobalDraft();
      renderPane();
    });

    var secSelect = E('select', { id: 'z2m-dns-secondary', 'class': 'z2m-select', 'aria-label': _('Запасной провайдер'), disabled: systemMode ? 'disabled' : undefined });
    secSelect.appendChild(E('option', { value: '' }, _('Нет')));
    state.globalProviders.forEach(function (p) {
      secSelect.appendChild(E('option', { value: p.id, selected: dg.secondary === p.id ? 'selected' : undefined }, p.name || p.id));
    });
    secSelect.addEventListener('change', function () {
      state.globalDraft.secondary = secSelect.value;
      updateGlobalDraft();
      renderPane();
    });

    var hijackSw = E('span', { 'class': 'z2m-sw' + (dg.hijack ? ' on' : ''), 'data-set': 'dnsHijack', role: 'switch', 'aria-checked': dg.hijack ? 'true' : 'false', tabindex: '0', 'aria-label': _('Запрещать сторонний DNS в сети') }, [E('i')]);
    hijackSw.addEventListener('click', function () {
      state.globalDraft.hijack = !state.globalDraft.hijack;
      updateGlobalDraft();
      renderPane();
    });

    var cacheSw = E('span', { 'class': 'z2m-sw' + (dg.cache ? ' on' : ''), 'data-set': 'dnsCache', role: 'switch', 'aria-checked': dg.cache ? 'true' : 'false', tabindex: '0', 'aria-label': _('Кэшировать ответы') }, [E('i')]);
    cacheSw.addEventListener('click', function () {
      state.globalDraft.cache = !state.globalDraft.cache;
      updateGlobalDraft();
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
      ]), _('Используется всеми клиентами сети')),
      shell.panel(_('Состояние'), E('div', { 'class': 'bd tight' }, [renderStatusTable()])),
      shell.panel(_('Проверка DNS'), E('div', {}, [checkResult, E('div', { 'class': 'btnrow', style: 'margin-top:8px' }, [checkButton])]))
    ]);
  }

  /* ---- check pane ---- */
  function renderCheck() {
    var wrapper = E('div');
    var categoryOrder = ['Популярные', 'Безопасные', 'Для ИИ'];
    function redraw() {
      var groups = {};
      providers.forEach(function (provider) { var category = provider.category || 'Другие'; (groups[category] || (groups[category] = [])).push(provider); });
      var list = E('div', { 'class': 'z2m-provider-groups' });
      Object.keys(groups).sort(function (a, b) { return (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)); }).forEach(function (category) {
        var body = E('div', { 'class': 'z2m-provider-group-body' });
        var group = E('section', { 'class': 'z2m-provider-group' }, [E('div', { 'class': 'z2m-provider-group-head' }, [E('h3', {}, category), E('span', { 'class': 'z2m-service-dns-count' }, String(groups[category].length) + ' ' + _('провайдера'))]), body]);
        groups[category].forEach(function (provider) {
          var id = providerId(provider), busy = state.providerBusy[id] === true, selected = id && id === currentProviderId;
          var icon = provider.name ? provider.name.slice(0, 1).toUpperCase() : '?';
          var diagnose = shell.button(busy ? _('Проверяется…') : _('Проверить'), 'sm', function () { diagnoseProvider(provider, redraw); }, busy || state.allProvidersBusy);
          var select = shell.button(selected ? _('Выбран') : _('Выбрать'), selected ? 'sm' : 'primary sm', function () { selectProvider(provider); }, busy || selected);
          body.appendChild(E('div', { 'class': 'z2m-provider-row' + (selected ? ' selected' : '') }, [
            E('span', { 'class': 'z2m-provider-icon' }, icon),
            E('div', { 'class': 'z2m-provider-main' }, [E('strong', { 'class': 'z2m-provider-name' }, providerName(provider)), E('small', { 'class': 'z2m-provider-addresses' }, asArray(provider.ipv4 || provider.addresses).join(' · ') || _('Адрес не указан'))]),
            E('div', { 'class': 'z2m-provider-result-cell' }, [providerResultNode(provider)]),
            diagnose,
            select
          ]));
        });
        list.appendChild(group);
      });
      if (!providers.length) list.appendChild(shell.empty(_('Провайдеры недоступны.')));
      var benchBtn = shell.button(state.allProvidersBusy ? _('Проверка выполняется…') : _('Проверить все'), 'sm', function () { checkAllProviders(redraw); }, state.allProvidersBusy || !providers.length);
      var checked = Object.keys(state.providerResults).length;
      var chosen = currentProviderId ? providerName(providers.filter(function (provider) { return providerId(provider) === currentProviderId; })[0]) : '—';
      wrapper.replaceChildren(shell.panel(_('Проверка и выбор провайдера'), E('div', {}, [
        E('div', { 'class': 'z2m-providers-summary' }, [E('div', { 'class': 'z2m-providers-summary-item' }, [E('strong', {}, String(providers.length)), E('span', {}, _('Всего провайдеров'))]), E('div', { 'class': 'z2m-providers-summary-item' }, [E('strong', {}, String(checked)), E('span', {}, _('Проверено'))]), E('div', { 'class': 'z2m-providers-summary-item' }, [E('strong', {}, chosen), E('span', {}, _('Выбранный провайдер'))]), benchBtn]),
        E('div', { 'class': 'z2m-provider-columns' }, [E('span'), E('span', {}, _('Провайдер')), E('span', {}, _('Результат проверки')), E('span', { 'class': 'z2m-provider-actions-label', colspan: '2' }, _('Действия'))]),
        state.allProvidersBusy ? E('div', { 'class': 'bar', style: 'margin:12px 0' }, [E('i', { class: 'g', style: 'width:100%', id: 'benchBar' })]) : E('span'),
        list
      ]), _('Проверка измеряет ответ DNS и задержку каждого провайдера.')));
    }
    redraw();
    return wrapper;
  }

  function providerResultClass(id) {
    if (state.providerErrors[id]) return 'z2m-provider-result-error';
    var result = state.providerResults[id];
    if (!result) return '';
    var probe = providerProbe(result, id);
    var ok = probe ? probe.working === true || probe.outcome === 'working' : result.ok === true || result.dnsAnswered === true || result.status === 'ready' || result.status === 'success' || result.status === 'ok';
    return ok ? 'z2m-provider-result-success' : 'z2m-provider-result-fail';
  }
  function providerProbe(result, id) {
    return asArray(result && result.probes).filter(function (probe) { return !id || probe.provider === id; })[0] || asArray(result && result.probes)[0] || null;
  }
  function providerLatency(result, id) {
    var probe = providerProbe(result, id);
    var values = asArray(probe && probe.attempts).map(function (attempt) { return attempt.durationMs; }).filter(function (value) { return value != null && isFinite(value); });
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
    if (error) return E('div', { 'class': 'z2m-provider-result z2m-provider-result-error' }, [shell.chip(_('Ошибка RPC'), 'r'), E('div', { 'class': 'z2m-dim' }, error)]);
    if (!result) return E('div', { 'class': 'z2m-provider-result z2m-dim' }, _('Не проверялось'));
    var ok = providerResultClass(id) === 'z2m-provider-result-success';
    var probe = providerProbe(result, id);
    var attempts = asArray(probe && probe.attempts);
    var answered = attempts.filter(function (attempt) { return attempt.dnsAnswered === true; }).length;
    return E('div', { 'class': 'z2m-provider-result ' + providerResultClass(id) }, [
      shell.chip(ok ? _('DNS работает') : _('DNS недоступен'), ok ? 'g' : 'r'),
      E('span', { 'class': 'z2m-provider-latency' }, _('Задержка: ') + formatLatency(providerLatency(result, id))),
      E('span', { 'class': 'z2m-provider-attempts' }, answered + '/' + attempts.length + ' ' + _('резолверов ответили'))
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
      if (refresh) refresh();
    });
  }
  function checkAllProviders(refresh) {
    if (state.allProvidersBusy) return;
    state.allProvidersBusy = true;
    refresh();
    providers.reduce(function (chain, provider) {
      return chain.then(function () { return diagnoseProvider(provider, refresh); });
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
          resetDraft('service-dns');
          ctx.clearDraft('service-dns');
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
    var providerNames = {};
    serviceProviders.forEach(function (provider) { providerNames[provider.id || provider.providerId] = provider.name || provider.label || provider.id; });
    var profileName = function (item, id) {
      var profile = item && item.profiles.filter(function (candidate) { return candidate.id === id; })[0];
      return profile ? (providerNames[profile.providerId] || profile.providerId) : _('По умолчанию');
    };
    var categoryOrder = ['AI', 'social', 'messaging', 'video', 'music', 'games', 'developer', 'media', 'other'];
    var groups = {}, records = [], groupNodes = {};
    items.forEach(function (item) { var category = item.category || 'other'; (groups[category] || (groups[category] = [])).push(item); });
    var configured = Object.keys(state.selections || {}).filter(function (id) { return state.selections[id]; }).length;
    var changes = serviceDnsChanges(), changeIds = Object.keys(changes);
    var stats = E('div', { 'class': 'z2m-dns-access-stats' }, [
      E('div', {}, [E('strong', {}, String(items.length)), E('span', {}, _('Всего сервисов'))]),
      E('div', {}, [E('strong', {}, String(configured)), E('span', {}, _('С пользовательским DNS'))]),
      E('div', {}, [E('strong', {}, String(items.length - configured)), E('span', {}, _('По умолчанию'))]),
      E('div', {}, [E('strong', {}, changeIds.length ? String(changeIds.length) : '—'), E('span', {}, _('Изменений'))])
    ]);
    var search = E('input', { type: 'search', 'class': 'z2m-service-dns-search', placeholder: _('Поиск сервиса или домена…'), 'aria-label': _('Поиск сервисов') });
    var categoryFilter = E('select', { 'class': 'z2m-service-dns-filter', 'aria-label': _('Категория сервисов') }, [E('option', { value: '' }, _('Все категории'))]);
    categoryOrder.concat(Object.keys(groups)).filter(function (category, index, list) { return list.indexOf(category) === index && groups[category]; }).forEach(function (category) { categoryFilter.appendChild(E('option', { value: category }, serviceCategoryLabel(category))); });
    var assignmentFilter = E('select', { 'class': 'z2m-service-dns-filter', 'aria-label': _('Назначение DNS') }, [E('option', { value: '' }, _('Все назначения')), E('option', { value: 'configured' }, _('С DNS-профилем')), E('option', { value: 'default' }, _('По умолчанию')), E('option', { value: 'changed' }, _('Изменённые'))]);
    var changedOnly = E('input', { type: 'checkbox', 'class': 'z2m-service-dns-changed-only', 'aria-label': _('Показывать только изменённые') });
    var groupsRoot = E('div', { 'class': 'z2m-service-dns-groups', id: 'z2m-service-dns-grid' });
    Object.keys(groups).sort(function (a, b) { return (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)); }).forEach(function (category) {
      var groupBody = E('div', { 'class': 'z2m-service-dns-group-body' });
      var groupNode = E('section', { 'class': 'z2m-service-dns-group', 'data-category': category }, [E('div', { 'class': 'z2m-service-dns-group-head' }, [E('span', { 'class': 'z2m-service-dns-group-mark' }, '☆'), E('h3', {}, serviceCategoryLabel(category)), E('span', { 'class': 'z2m-service-dns-count' }, String(groups[category].length)), E('span', { 'class': 'z2m-service-dns-chevron' }, '⌃')]), groupBody]);
      groupNodes[category] = groupNode;
      groups[category].sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (item) {
        var id = item.id, before = state.serviceBaseline[id] || '', after = state.selections[id] || '', iconData = serviceIconData(item);
        var select = E('select', { 'class': 'z2m-service-dns-select', 'aria-label': _('DNS-профиль для ') + item.name });
        select.appendChild(E('option', { value: '' }, _('По умолчанию')));
        item.profiles.forEach(function (profile) { select.appendChild(E('option', { value: profile.id }, providerNames[profile.providerId] || profile.providerId || profile.id)); });
        select.value = after;
        var domains = asArray(item.domains).slice(0, 3).join(' · ') || _('Домены сервиса');
        var currentName = profileName(item, before);
        var row = E('div', { 'class': 'z2m-service-dns-row' + (before !== after ? ' changed' : ''), 'data-service-dns-id': id, 'data-service-name': (item.name + ' ' + domains).toLowerCase() }, [
          E('div', { 'class': 'z2m-service-info' }, [E('span', { 'class': 'z2m-service-dns-icon', style: 'color:' + iconData[1] + ';background:' + iconData[1] + '22' }, iconData[0]), E('div', {}, [E('strong', { 'class': 'z2m-service-name' }, item.name), E('small', { 'class': 'z2m-service-domains', title: domains }, domains)])]),
          E('div', { 'class': 'z2m-service-controls' }, [E('span', { 'class': 'z2m-chip z2m-applied-badge' + (before ? ' b' : '') }, _('Применено: ') + currentName), select])
        ]);
        select.addEventListener('change', function () { state.selections[id] = select.value; updateServiceDnsDraft(ctx); renderPane(); });
        groupBody.appendChild(row);
        records.push({ row: row, category: category, name: (item.name + ' ' + domains).toLowerCase(), configured: !!after, changed: before !== after });
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
    var toolbar = E('div', { 'class': 'z2m-dns-access-toolbar' }, [search, categoryFilter, assignmentFilter, E('label', { 'class': 'z2m-dns-access-toggle' }, [changedOnly, _('Показывать только изменённые')]), E('span', { 'class': 'z2m-dns-access-draft' }, changeIds.length ? _('Черновик: есть изменения') : _('Черновик пуст'))]);
    var previewRows = changeIds.slice(0, 6).map(function (id) { var item = items.filter(function (candidate) { return candidate.id === id; })[0]; var change = changes[id]; return E('div', { 'class': 'z2m-dns-preview-row' }, [E('span', { 'class': 'z2m-dns-preview-dot' }), E('span', {}, item ? item.name : id), E('span', { 'class': 'z2m-dns-preview-arrow' }, '→'), E('strong', {}, item ? profileName(item, change.after) : change.after || _('По умолчанию'))]); });
    var rulesSummary = E('div', { 'class': 'z2m-dns-rule-summary' }, [
      E('div', {}, [E('span', {}, _('Глобальный DNS')), E('strong', {}, globalApplied.wanDns || _('Системный DNS'))]),
      E('div', {}, [E('span', {}, _('Переопределений')), E('strong', {}, String(configured))]),
      E('div', {}, [E('span', {}, _('Изменений в черновике')), E('strong', {}, String(changeIds.length))]),
      E('div', {}, [E('span', {}, _('Конфликтов')), E('strong', { 'class': 'ok' }, _('Нет'))]),
      E('div', {}, [E('span', {}, _('Файл правил')), E('code', {}, '/etc/zapret2-manager/dns-overrides.hosts')])
    ]);
    var sidebarChildren = [shell.panel(_('Текущие правила для сервисов'), rulesSummary)];
    if (previewRows.length) sidebarChildren.push(shell.panel(_('Предпросмотр изменений'), E('div', { 'class': 'z2m-dns-preview-list' }, previewRows)));
    sidebarChildren.push(shell.panel(_('Важно'), E('div', { 'class': 'z2m-dns-access-note' }, _('Изменения сначала сохраняются в черновик. Конфигурация применяется к системе только после нажатия кнопки «Применить».'))));
    var sidebar = E('aside', { 'class': 'z2m-dns-access-sidebar' }, sidebarChildren);
    return E('div', { 'class': 'z2m-dns-access-layout' }, [E('div', { 'class': 'z2m-dns-access-main' }, [shell.panel(_('Доступ сервисов'), E('div', {}, [stats, toolbar, groupsRoot]), _('Профиль DNS выбирается отдельно для каждого сервиса.'))]), sidebar]);
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
      updateDnsDraft(next);
      shell.showToast(_('Правило добавлено в черновик.'), 'ok');
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
        updateDnsDraft(state.manual);
        shell.showToast(_('Правило удалено из черновика.'), 'ok');
        renderPane();
      });
      return E('div', { 'class': 'z2m-dns-routing-row' }, [
        E('div', {}, [E('strong', {}, rule.domain), E('small', {}, provider ? providerName(provider) : rule.ip || _('DNS-сервер не найден'))]),
        E('span', { 'class': 'chip ' + (provider ? 'g' : 'o') }, provider ? _('готов') : _('недоступен')),
        remove
      ]);
    })) : shell.empty(_('Правил пока нет. Добавьте домен или выберите быстрый пресет.'));
    var changed = !sameEntries(state.manualBaseline || [], rules);
    var productError = data.product && data.product.error;
    return E('div', { 'class': 'z2m-dns-routing-layout', 'data-testid': 'dns-routing-pane' }, [
      productError ? shell.statePanel({ title: _('Canonical DNS facade недоступен'), message: productError.message, kind: 'warn' }) : null,
      shell.panel(_('Per-domain DNS'), E('div', {}, [
        E('p', { 'class': 'z2m-dim' }, _('Поведение адаптировано из Avatar: правило добавляется в черновик, затем проходит Preview → Validate → Apply через canonical DNS backend.')),
        form,
        E('div', { 'class': 'z2m-dns-routing-presets' }, [E('strong', {}, _('Быстрые пресеты')), E('div', { 'class': 'z2m-btnrow' }, quickButtons)])
      ])),
      shell.panel(_('Правила'), rows, _('Активные изменения не влияют на роутер до подтверждения в общем окне применения.')),
      E('div', { 'class': 'z2m-btnrow z2m-dns-routing-actions' }, [
        shell.button(_('Предпросмотр и применить'), 'primary', function () { ctx.openSemanticDiff(); }, !changed),
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
      updateGlobalDraft();
      renderPane();
    });
    var soSw = E('span', { 'class': 'z2m-sw' + (dg.strictOrder ? ' on' : ''), role: 'switch', 'aria-checked': dg.strictOrder ? 'true' : 'false', tabindex: '0', 'aria-label': _('Использовать DNS-серверы по порядку') }, [E('i')]);
    soSw.addEventListener('click', function () {
      state.globalDraft.strictOrder = !state.globalDraft.strictOrder;
      updateGlobalDraft();
      renderPane();
    });
    var aaaaSw = E('span', { 'class': 'z2m-sw' + (dg.blockAaaa ? ' on' : ''), role: 'switch', 'aria-checked': dg.blockAaaa ? 'true' : 'false', tabindex: '0', 'aria-label': _('Блокировать IPv6-ответы') }, [E('i')]);
    aaaaSw.addEventListener('click', function () {
      state.globalDraft.blockAaaa = !state.globalDraft.blockAaaa;
      updateGlobalDraft();
      renderPane();
    });
    var ttlInp = E('input', { type: 'number', value: dg.minTtl, style: 'max-width:120px', 'aria-label': _('Минимальный TTL') });
    ttlInp.addEventListener('change', function () {
      state.globalDraft.minTtl = int(ttlInp.value) || 60;
      updateGlobalDraft();
    });
    var rulesTa = E('textarea', { id: 'z2m-dns-custom-rules', placeholder: 'server=/example.com/1.1.1.1', 'aria-label': _('Дополнительные правила dnsmasq') }, dg.customRules);
    rulesTa.addEventListener('input', function () {
      state.globalDraft.customRules = rulesTa.value;
      updateGlobalDraft();
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

    return E('div', {}, [
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
      ])),
      shell.panel(_('Компоненты DNS'), compBody, _('Состояние компонентов по данным backend.'))
    ]);
  }

  /* ---- hist pane ---- */
  function renderHistory() {
    var history = asArray(dns.history || serviceStatus.history);
    if (state.lastOperation) history = [state.lastOperation].concat(history);
    var historyRows = !history.length ? shell.empty(_('История DNS пуста.'))
      : E('div', { 'class': 'z2m-history-list' }, history.slice(0, 30).map(function (event) {
        return E('div', { 'class': 'z2m-backup-row' }, [
          E('div', {}, [
            E('div', { 'class': 'nm' }, display(event.phase || event.status || event.action || _('Операция DNS'))),
            E('div', { 'class': 'co' }, [
              _('Ревизия: ') + display(event.appliedRevision),
              ' · ' + _('маршрутов: ') + display(event.routeCount)
            ].join(''))
          ]),
          shell.chip(event.ok === false || event.phase === 'failed' ? _('ошибка') : _('запись'), event.ok === false || event.phase === 'failed' ? 'r' : 'b')
        ]);
      }));

    var eventsArea = E('div', { 'class': 'z2m-console' }, state.operation ? _('Активная операция: ') + display(state.operation.operationId) : _('Событий пока нет.'));

    return E('div', {}, [
      shell.panel(_('События'), eventsArea, state.operation ? _('Активная операция') : ''),
      shell.panel(_('История DNS'), historyRows),
      shell.panel(_('Откат'), E('div', {}, [
        E('div', { 'class': 'z2m-cbi' }, [
          E('label', {}, 'DNS overrides'),
          E('div', {}, E('span', { 'class': 'num' }, dns.revision != null ? 'rev ' + dns.revision : 'rev 0')),
          E('label', {}, 'Service mappings'),
          E('div', {}, E('span', { 'class': 'num' }, serviceStatus.appliedRevision != null ? 'rev ' + serviceStatus.appliedRevision : 'rev 0'))
        ]),
        E('div', { 'class': 'btnrow', style: 'margin-top:12px' }, [
          shell.button(_('Откатить DNS overrides'), 'sm', function () {
            ctx.api.dns.rollback().then(function (answer) {
              if (answer && answer.ok === false) throw answer;
              shell.showToast(_('DNS откатан.'), 'ok');
              return ctx.refresh('dns');
            }).catch(showError);
          }, dns.rollbackAvailable !== true),
          shell.button(_('Откатить DNS сервисов'), 'sm', function () {
            ctx.api.dns.serviceRollback().then(function (answer) {
              if (answer && answer.ok === false) throw answer;
              shell.showToast(_('Откат DNS сервисов запущен.'), 'ok');
              return ctx.refresh('dns');
            }).catch(showError);
          }, serviceStatus.rollbackAvailable !== true || !!state.operation)
        ])
      ]))
    ]);
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
    if (data[key] && data[key].error) root.appendChild(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  var messages = collectMessages(data, [], 0);
  var overrideWarning = messages.filter(function (message) { return /manager overrides|dnsmasq/i.test(message); })[0];
  if (overrideWarning || dns.overridesRegistered === false || dns.dnsmasqRegistered === false) {
    root.appendChild(E('div', { 'class': 'warnbar' }, overrideWarning || _('Файл DNS-переопределений менеджера не подключён к dnsmasq.')));
  }
  root.appendChild(tabs);
  root.appendChild(host);
  renderTabs();
  renderPane();
  if (state.operation) scheduleServiceOperationPoll();
  return root;
}

function mount() {}
function unmount() {
  state.disposed = true;
  state.openPane = null;
  if (state.serviceOperationTimer) window.clearTimeout(state.serviceOperationTimer);
  state.serviceOperationTimer = null;
  state.serviceOperationInFlight = false;
}

return baseclass.extend({
  id: 'dns', title: _('DNS'), subtitle: _('Настройка DNS, проверки провайдеров и доступ сервисов'),
  load: load, render: render, mount: mount, unmount: unmount,
  openDraft: openDraft, focusDraft: focusDraft, resetDraft: resetDraft,
  createAdapter: createAdapter, createGlobalAdapter: createGlobalAdapter, createServiceDnsAdapter: createServiceDnsAdapter
});
