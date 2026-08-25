'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-runtime-state as RuntimeState';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';
'require view.zapret2-manager.z2m-navigation as Navigation';
'require view.zapret2-manager.z2m-overview as Overview';
'require view.zapret2-manager.z2m-avatar-control as Control';
'require view.zapret2-manager.z2m-strategy-page as Strategy';
'require view.zapret2-manager.z2m-scanner as Scanner';
'require view.zapret2-manager.z2m-scanner-product as ScannerProduct';
'require view.zapret2-manager.z2m-domain-hub-page as Services';
'require view.zapret2-manager.z2m-dns-page as Dns';
'require view.zapret2-manager.z2m-proxy-page as Proxy';
'require view.zapret2-manager.z2m-diagnostics-page as Diagnostics';
'require view.zapret2-manager.z2m-maintenance as Maintenance';
'require view.zapret2-manager.z2m-blockcheck-page as BlockCheck';
'require view.zapret2-manager.z2m-assets as Assets';
'require view.zapret2-manager.z2m-unified-routing as UnifiedRouting';
'require view.zapret2-manager.z2m-warp-page as Warp';
'require view.zapret2-manager.z2m-tab-cache as TabCache';

var MODULES = {
  dashboard: Overview,
  control: Control,
  strategies: Strategy,
  scan: ScannerProduct,
  scanner: ScannerProduct,
  services: Services,
  lists: Services,
  hostlists: Assets,
  resources: Assets,
  'dns-routing': Dns,
  'unified-routing': UnifiedRouting,
  'telegram-tunnel': Proxy,
  warp: Warp,
  'warp-setup': Warp,
  'warp-in-warp': Warp,
  ipsets: Assets,
  blobs: Assets,
  lua: Assets,
  hosts: Assets,
  diagnostics: Diagnostics,
  blockcheck: ScannerProduct,
  logs: Diagnostics,
  monitor: Diagnostics,
  system: Maintenance,
  components: Maintenance
};
// Compatibility tab routes all resolve to the single System lifecycle object.
MODULES.updates = MODULES.components;
MODULES.engine = MODULES.components;
MODULES.maintenance = MODULES.components;
MODULES.backups = MODULES.components;
MODULES.settings = MODULES.components;
var store = StoreModule.create();
var activeModule = null;
var activeContext = null;
var activationToken = 0;
var hashHandler = null;
var storeUnsubscribe = null;
var tabDataCache = {};
var tabLoadPromises = {};
function currentSessionKey() {
  var env = window.L && window.L.env || {};
  return env.sessionid || env.sessionId || window.location.host || 'luci';
}
var tabSessionKey = currentSessionKey();
var tabCache = TabCache.create({ sessionKey: tabSessionKey });
function syncTabCacheSession() {
  var next = currentSessionKey();
  if (next === tabSessionKey) return;
  tabSessionKey = next;
  tabCache.setSession(next);
  tabDataCache = {};
  tabLoadPromises = {};
}

function tabFromHash() {
  return Navigation.normalize(window.location.hash);
}
function paramsFromHash() {
  return Navigation.parse(window.location.hash).params || {};
}
function setHash(tab) {
  tab = Navigation.normalize(tab);
  var target = Navigation.hash(tab);
  if (window.location.hash !== target) window.location.hash = target;
}
function statusState(initial) {
  var value = RuntimeState.state(initial);
  if (value === 'unavailable') return { label: _('недоступно'), kind: 'r' };
  if (value === 'running') return { label: _('работает'), kind: 'g' };
  if (value === 'stopped') return { label: _('остановлена'), kind: 'r' };
  if (value === 'mismatch') return { label: _('расхождение'), kind: 'o' };
  return { label: value === 'degraded' ? _('деградировала') : _('неизвестно'), kind: 'o' };
}
function detectedVersion(initial) {
  var meta = initial && initial.meta || {};
  var value = meta.managerVersion || meta.packageVersion || initial && initial.packageVersion;
  return value === null || value === undefined || value === '' ? null : String(value);
}
function invalidateTabCache(tab) {
  if (tab) tabCache.invalidate(tab);
  else tabCache.invalidateAll();
  if (tab) {
    delete tabDataCache[tab];
    delete tabLoadPromises[tab];
  } else {
    tabDataCache = {};
    tabLoadPromises = {};
  }
}

return L.view.extend({
  load: function () {
    // App shell prerequisite must stay bounded: status_fast observes
    // process/queue state without spawning the full diagnostic collector.
    // The full collector remains available to the Diagnostics tab only.
    return Api.service.statusFast().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },

  render: function (initial) {
    Shell.injectCss();
    var content = E('main', { 'class': 'z2m-content', id: 'z2m-content' });
    var tabs = Shell.primaryNavigation(Navigation, tabFromHash(), navigateTo);
    var appRoot = null;
    var headerStatus = null;

    function setContentBusy(busy) {
      content.classList.toggle('z2m-refreshing', busy === true);
      content.setAttribute('aria-busy', busy === true ? 'true' : 'false');
    }
    function buildContext(tab, module, data, root) {
      var ctx = {
        route: tab,
        routeParams: paramsFromHash(),
        api: Api, store: store, shell: Shell, root: root || content,
        data: data || {}, initial: initial || {},
        navigate: navigateTo,
        refresh: function (next) {
          if (activeContext !== ctx) return Promise.resolve();
          return activate(next || tab, true);
        },
        invalidateCache: function (target) {
          invalidateTabCache(target || tab);
        },
        rerender: function () {
          if (activeContext !== ctx) return Promise.resolve();
          var token = ++activationToken;
          renderTabData(tab, module, tabDataCache[tab] || data || {}, token, true);
          setContentBusy(false);
          return Promise.resolve();
        }
      };
      return ctx;
    }
    function loadTabData(tab, module, force) {
      if (tabLoadPromises[tab]) return tabLoadPromises[tab];
      var requestSession = tabSessionKey;
      var requestPromise = tabCache.load(tab, function () {
        return module.load(buildContext(tab, module, tabDataCache[tab]));
      }, { bypass: force === true }).then(function (data) {
        if (requestSession === tabSessionKey) tabDataCache[tab] = data || {};
        if (tabLoadPromises[tab] === requestPromise) delete tabLoadPromises[tab];
        return requestSession === tabSessionKey ? tabDataCache[tab] : (data || {});
      }, function (error) {
        if (tabLoadPromises[tab] === requestPromise) delete tabLoadPromises[tab];
        throw error;
      });
      tabLoadPromises[tab] = requestPromise;
      return requestPromise;
    }
    function renderTabData(tab, module, data, token, force) {
      if (token !== activationToken) return;
      if (activeModule && activeContext && activeModule.unmount) activeModule.unmount(activeContext);
      activeModule = module;
      var ctx = buildContext(tab, module, data);
      var node;
      try { node = module.render(ctx); }
      catch (error) {
        activeContext = null;
        Shell.avatar.showErrorState(content, error, { api: Api, retry: function () { return activate(tab, true); } });
        return;
      }
      if (token !== activationToken) {
        if (module.unmount) module.unmount(ctx);
        return;
      }
      ctx.root = node;
      content.replaceChildren(node);
      updateHeaderStatus(data);
      activeContext = ctx;
      if (module.mount) module.mount(ctx);
      if (appRoot && appRoot.scrollIntoView && !force) appRoot.scrollIntoView({ block: 'start' });
    }
    function navigateTo(tab) {
      tab = Navigation.normalize(tab);
      if (window.location.hash !== Navigation.hash(tab)) {
        setHash(tab);
        return Promise.resolve();
      }
      if (activeModule === MODULES[tab] && activeContext && activeContext.route === tab) return Promise.resolve();
      return activate(tab);
    }
    function activate(tab, force) {
      tab = Navigation.normalize(tab);
      syncTabCacheSession();
      var token = ++activationToken;
      var module = MODULES[tab];
      var sameTab = activeModule === module && !!activeContext && activeContext.route === tab;
      var cachedEntry = force ? null : tabCache.get(tab);
      var cached = cachedEntry ? cachedEntry.data : null;
      store.update({ ui: Object.assign({}, store.get().ui, { tab: tab }) });
      if (tabs.setActive) tabs.setActive(tab);
      if (cached && !sameTab) renderTabData(tab, module, cached, token, force);
      else if (!cached && !(sameTab && force)) {
        if (tab === 'dashboard' || tab === 'control') {
          renderTabData(tab, module, {}, token, force);
        } else {
          if (activeModule && activeContext && activeModule.unmount) activeModule.unmount(activeContext);
          activeModule = module;
          activeContext = null;
          content.replaceChildren(Shell.renderLoadingState(Navigation.label(tab)));
        }
      }
      if (cached && force !== true) {
        tabDataCache[tab] = cached;
        setContentBusy(false);
        return Promise.resolve(cached);
      }
      setContentBusy(true);
      return loadTabData(tab, module, force).then(function (data) {
        if (token !== activationToken) return;
        renderTabData(tab, module, data, token, force);
        setContentBusy(false);
      }).catch(function (error) {
        if (token !== activationToken) return;
        setContentBusy(false);
        var message = Api.normalizeError(error).message;
        if ((activeModule === module && activeContext) || cached) {
          Shell.showToast(_('Не удалось обновить данные. Показано последнее успешное состояние: ') + message, 'warn');
          return;
        }
        activeModule = module;
        activeContext = null;
        Shell.avatar.showErrorState(content, error, { api: Api, retry: function () { return activate(tab, true); } });
      });
    }
    function renderState() {
      if (appRoot) appRoot.classList.toggle('adv', !!(store.get().ui && store.get().ui.advanced));
    }
    function updateHeaderStatus(data) {
      var envelope = data && data.status;
      if (!envelope || envelope.error || !headerStatus) return;
      var raw = envelope.value;
      for (var i = 0; i < 4; i++) {
        if (Array.isArray(raw)) { raw = raw[0]; continue; }
        if (raw && typeof raw === 'object' && raw.value !== undefined) { raw = raw.value; continue; }
        break;
      }
      if (!raw || typeof raw !== 'object') return;
      // Only global runtime status has runtimeSummary; per-tab scan/service status must not overwrite the global header
      if (!raw.runtimeSummary) return;
      var service = statusState(raw);
      var next = Shell.chip(service.label, service.kind, true);
      if (next && headerStatus.parentNode) headerStatus.replaceWith(next);
      headerStatus = next;
    }

    var initialTab = tabFromHash();
    if (hashHandler) window.removeEventListener('hashchange', hashHandler);
    hashHandler = function () { activate(tabFromHash()); };
    window.addEventListener('hashchange', hashHandler);

    var service = statusState(initial);
    var version = detectedVersion(initial);
    var brand = [E('span', { 'class': 'mark', 'aria-hidden': 'true' }, 'z2'),
      E('span', { 'class': 'nm' }, ['zapret2', E('span', { 'class': 'mgr' }, '·manager')])];
    if (version) brand.push(E('span', { 'class': 'ver' }, version));
    appRoot = E('div', { 'class': 'z2m-app', id: 'z2m-app' }, [
      E('header', { 'class': 'z2m-apptop' }, E('div', { 'class': 'in' }, [
        E('div', { 'class': 'z2m-brand' }, brand),
        E('div', { 'class': 'z2m-apptop-right' }, [
          E('span', { 'class': 'host' }, window.location.hostname || 'OpenWrt'),
          headerStatus = Shell.chip(service.label, service.kind, true)
        ])
      ])),
      E('div', { 'class': 'z2m-wrap' }, [tabs, content]),
      E('div', { id: 'z2m-modal', 'class': 'z2m-scrim modal-overlay' }),
      E('div', { id: 'z2m-toasts', 'class': 'z2m-toasts' })
    ]);
    if (storeUnsubscribe) storeUnsubscribe();
    storeUnsubscribe = store.subscribe(renderState);
    renderState();
    Promise.resolve().then(function () { activate(initialTab); });
    return appRoot;
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
