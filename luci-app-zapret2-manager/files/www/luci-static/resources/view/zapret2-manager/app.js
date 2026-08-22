'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-runtime-state as RuntimeState';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';
'require view.zapret2-manager.z2m-navigation as Navigation';
'require view.zapret2-manager.z2m-draft-model as DraftModel';
'require view.zapret2-manager.z2m-coordinator as Coordinator';
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

var DRAFT_META = {
  strategy: { label: _('Стратегия'), tab: 'strategy' },
  domainHub: { label: _('Сервисы и домены'), tab: 'services' },
  dns: { label: _('DNS'), tab: 'dns' },
  proxy: { label: _('Telegram Proxy'), tab: 'proxy' },
  maintenance: { label: _('Система'), tab: 'components' }
};
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

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function unsupportedAdapter(scope) {
  var reason = 'Unsupported scope: ' + scope;
  return {
    supported: false,
    validateDraft: function () { return Promise.resolve({ ok: false, message: reason }); },
    previewDraft: function () { return Promise.reject({ code: 'unsupported-scope', message: reason }); },
    applyDraft: function () { return Promise.reject({ code: 'unsupported-scope', message: reason }); },
    reloadAppliedState: function () { return Promise.resolve({ value: {}, revision: null }); },
    resetDraft: function () {}
  };
}
var ADAPTERS = {
  strategy: Strategy.createAdapter(Api),
  domainHub: Services.createAdapter(Api, Services),
  dns: Dns.createAdapter(Api, Dns),
  proxy: Proxy.createAdapter(Api, Proxy)
};
Object.keys(DRAFT_META).forEach(function (scope) {
  if (!ADAPTERS[scope]) ADAPTERS[scope] = unsupportedAdapter(scope);
});

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
function draftMeta(scope) { return DRAFT_META[scope] || { label: scope, tab: 'dashboard' }; }
function draftLabel(scope) { return draftMeta(scope).label; }
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
function humanValue(value, depth) {
  depth = depth || 0;
  if (depth > 2) return _('изменено');
  if (value === true) return _('Включено');
  if (value === false || value === null || value === undefined || value === '') return _('Отключено');
  if (Array.isArray(value)) return value.map(function (item) { return humanValue(item, depth + 1); }).join(', ') || _('Отключено');
  if (value && typeof value === 'object') return Object.keys(value).sort().map(function (key) {
    return key + ': ' + humanValue(value[key], depth + 1);
  }).join('; ') || _('изменено');
  return String(value);
}
function createCoordinator(options) { return Coordinator.create(options); }
function preflightDraft(coordinator, snapshot, context) { return coordinator.preflightDraft(snapshot, context); }
function applyDrafts(coordinator, snapshot, context) { return coordinator.applyDrafts(snapshot, context); }

function renderSemanticDiff(draft, applied, extraBlockers) {
  var groups = DraftModel.semanticDiff(draft, applied);
  var byScope = {};
  groups.forEach(function (group) { byScope[group.scope] = group; });
  Object.keys(object(draft)).forEach(function (scope) {
    var blocker = extraBlockers && extraBlockers[scope];
    if (ADAPTERS[scope] && ADAPTERS[scope].supported !== true) blocker = blocker || 'Unsupported scope: ' + scope;
    if (!blocker) return;
    if (!byScope[scope]) {
      byScope[scope] = { scope: scope, label: draftLabel(scope), rows: [], applicable: false, blocker: blocker };
      groups.push(byScope[scope]);
    } else if (!byScope[scope].blocker) byScope[scope].blocker = blocker;
  });
  if (!groups.length) return E('div', { 'class': 'z2m-dim' }, _('Нет семантических изменений.'));
  return E('div', {}, groups.map(function (group) {
    var children = [E('h4', {}, group.label)];
    if (group.blocker) children.push(E('div', { 'class': 'warnbar' }, group.blocker));
    if (group.rows.length) children.push(E('div', { 'class': 'z2m-change-list' }, group.rows.map(function (row) {
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
        E('div', {}, [E('div', { 'class': 'nm' }, row.label),
          E('div', { 'class': 'co' }, humanValue(row.before) + ' → ' + humanValue(row.after))]),
        E('span', { 'class': 'z2m-chip o' }, _('изменено'))
      ]);
    })));
    var advanced = object((draft[group.scope] || {}).advanced);
    if (Object.keys(advanced).length) children.push(E('details', { 'class': 'z2m-acc' }, [
      E('summary', {}, _('Технические детали')),
      E('pre', { 'class': 'z2m-diff' }, JSON.stringify(DraftModel.redact(advanced), null, 2))
    ]));
    return E('section', { 'class': 'z2m-draft-preview' }, children);
  }));
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
    var applyBar = Shell.renderApplyBar({ enabled: false, reason: _('Ожидается предварительная проверка.') });
    var appRoot = null;
    var headerStatus = null;
    var coordinator = createCoordinator({ api: Api, store: store, shell: Shell, adapters: ADAPTERS, root: content });

    function setContentBusy(busy) {
      content.classList.toggle('z2m-refreshing', busy === true);
      content.setAttribute('aria-busy', busy === true ? 'true' : 'false');
    }
    function buildContext(tab, module, data, root) {
      return {
        route: tab,
        routeParams: paramsFromHash(),
        api: Api, store: store, shell: Shell, root: root || content,
        data: data || {}, initial: initial || {},
        navigate: navigateTo,
        refresh: function (next) { return activate(next || tab, true); },
        invalidateCache: function (target) {
          var route = target && draftMeta(target).tab || target || tab;
          invalidateTabCache(route);
        },
        rerender: function () {
          var token = ++activationToken;
          renderTabData(tab, module, tabDataCache[tab] || data || {}, token, true);
          setContentBusy(false);
          return Promise.resolve();
        },
        setDraft: function (scope, value) { store.setDraft(scope, value); },
        clearDraft: function (scope) { store.clearDraft(scope); },
        openSemanticDiff: openSemanticDiff,
        applyDrafts: function () { return applyDrafts(coordinator, store.snapshotDraft(), { root: content }); },
        coordinator: coordinator
      };
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
    function rollbackActions(result) {
      return array(result && (result.rollbacks || (result.rollback ? [result.rollback] : []))).filter(function (entry) {
        return entry && entry.available === true;
      });
    }
    function openApplyResult(result) {
      var proofs = rollbackActions(result);
      if (!proofs.length) return;
      var actions = proofs.map(function (proof) {
        var button = Shell.button(_('Откатить: ') + draftLabel(proof.scope), 'danger', function () {
          button.disabled = true;
          coordinator.rollbackResult(proof, { root: content }).then(function (answer) {
            if (!answer || answer.ok === false || answer.verified === false) throw answer || new Error('rollback failed');
            Shell.closeModal();
            Shell.showToast(_('Откат выполнен и проверен.'), 'ok');
            invalidateTabCache();
            return activate(store.get().ui.tab || Navigation.defaultRoute, true);
          }).catch(function (error) {
            button.disabled = false;
            Shell.showToast(Api.normalizeError(error).message, 'err');
          });
        });
        return button;
      });
      Shell.openModal(_('Результат применения'), E('p', {},
        _('Backend подтвердил targetable snapshot. Откат выполняется только вручную.')),
        [Shell.button(_('Закрыть'), '', Shell.closeModal)].concat(actions));
    }
    function openSemanticDiff() {
      var snapshot = store.snapshotDraft();
      function show(availability) {
        var apply = Shell.button(_('Применить'), 'primary', function () {
          apply.disabled = true;
          applyDrafts(coordinator, store.snapshotDraft(), { root: content }).then(function (result) {
            Shell.closeModal();
            invalidateTabCache();
            renderState();
            activate(store.get().ui.tab || Navigation.defaultRoute, true);
            openApplyResult(result);
          }).catch(function (error) {
            apply.disabled = false;
            Shell.showToast(Api.normalizeError(error).message, 'err');
          });
        }, !availability.enabled);
        var body = [renderSemanticDiff(snapshot, store.get().applied || {}, coordinator.semanticBlockers(snapshot))];
        if (!availability.enabled) body.push(E('div', { 'class': 'z2m-apply-reason' },
          _('Применение заблокировано: ') + availability.reason));
        Shell.openModal(_('Семантические изменения'), body,
          [Shell.button(_('Закрыть'), '', Shell.closeModal), apply]);
      }
      show(coordinator.availability(snapshot));
      preflightDraft(coordinator, snapshot, { root: content }).then(function () {
        show(coordinator.availability(snapshot));
      });
    }
    function discardDrafts() {
      Shell.openModal(_('Отменить все изменения?'), E('p', {},
        _('Черновики существуют только в браузере. Backend и runtime изменены не будут.')), [
        Shell.button(_('Не отменять'), '', Shell.closeModal),
        Shell.button(_('Отменить черновики'), 'danger', function () {
          Shell.closeModal();
          Object.keys(MODULES).forEach(function (tab) {
            if (MODULES[tab].resetDraft) MODULES[tab].resetDraft();
          });
          store.clearAllDrafts();
          store.setCoordinator({ status: 'idle', preflight: null, result: null,
            availability: { enabled: false, reason: 'Нет изменений', blockers: [] } });
          var snapshot = store.get();
          store.update({ pending: Object.assign({}, snapshot.pending, {
            pendingStrategyId: null, pendingOverride: null
          }) });
          invalidateTabCache();
          renderState();
          activate(store.get().ui.tab || Navigation.defaultRoute, true);
        })
      ]);
    }
    function updateDraftBar() {
      var scopes = Object.keys(store.get().draft || {});
      var availability = coordinator.availability();
      applyBar.classList.toggle('hidden', !scopes.length);
      var message = applyBar.querySelector('#z2m-apply-text');
      var apply = applyBar.querySelector('#z2m-apply-drafts');
      var reason = applyBar.querySelector('#z2m-apply-reason');
      if (message && scopes.length) message.textContent = scopes.length + ' ' +
        (scopes.length === 1 ? _('изменение') : _('изменения')) + ': ' +
        scopes.map(draftLabel).join(', ') + '. ' + _('На работу роутера пока не влияет.');
      if (apply) apply.disabled = availability.enabled !== true;
      if (reason) reason.textContent = availability.enabled || !scopes.length ? '' :
        _('Применение заблокировано: ') + availability.reason;
    }
    function renderState() {
      if (appRoot) appRoot.classList.toggle('adv', !!(store.get().ui && store.get().ui.advanced));
      updateDraftBar();
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
      applyBar,
      E('div', { id: 'z2m-modal', 'class': 'z2m-scrim modal-overlay' }),
      E('div', { id: 'z2m-toasts', 'class': 'z2m-toasts' })
    ]);
    applyBar.querySelector('#z2m-discard-drafts').addEventListener('click', discardDrafts);
    applyBar.querySelector('#z2m-preview-drafts').addEventListener('click', openSemanticDiff);
    applyBar.querySelector('#z2m-apply-drafts').addEventListener('click', openSemanticDiff);
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
