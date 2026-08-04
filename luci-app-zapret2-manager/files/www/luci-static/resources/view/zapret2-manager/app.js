'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';
'require view.zapret2-manager.z2m-draft-model as DraftModel';
'require view.zapret2-manager.z2m-overview as Overview';
'require view.zapret2-manager.z2m-strategy-page as Strategy';
'require view.zapret2-manager.z2m-services as Services';
'require view.zapret2-manager.z2m-lists as Lists';
'require view.zapret2-manager.z2m-dns as Dns';
'require view.zapret2-manager.z2m-proxy as Proxy';
'require view.zapret2-manager.z2m-monitor as Monitor';
'require view.zapret2-manager.z2m-maintenance as Maintenance';

var TAB_IDS = ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'];
var TAB_LABELS = {
  overview: _('Обзор'), strategy: _('Стратегия'), services: _('Сервисы'), lists: _('Списки'),
  dns: _('DNS'), proxy: _('Telegram Proxy'), monitor: _('Мониторинг'), maintenance: _('Обслуживание')
};
var DRAFT_META = {
  strategy: { label: _('Стратегия'), tab: 'strategy' },
  services: { label: _('Сервисы'), tab: 'services' },
  lists: { label: _('Списки'), tab: 'lists' },
  dns: { label: _('DNS'), tab: 'dns', pane: 'setup' },
  'service-dns': { label: _('DNS: доступ сервисов'), tab: 'dns', pane: 'access' },
  proxy: { label: _('Telegram Proxy'), tab: 'proxy' },
  monitor: { label: _('Мониторинг'), tab: 'monitor' },
  maintenance: { label: _('Обслуживание'), tab: 'maintenance' }
};
var MODULES = {
  overview: Overview, strategy: Strategy, services: Services, lists: Lists,
  dns: Dns, proxy: Proxy, monitor: Monitor, maintenance: Maintenance
};
var store = StoreModule.create();
var hashHandler = null;
var activeModule = null;
var activeContext = null;
var activationToken = 0;
var storeUnsubscribe = null;
var tabDataCache = {};
var tabLoadPromises = {};

function tabFromHash() {
  var match = String(window.location.hash || '').match(/^#\/(overview|strategy|services|lists|dns|proxy|monitor|maintenance)$/);
  return match ? match[1] : 'overview';
}
function setHash(tab) {
  if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
  if (window.location.hash !== '#/' + tab) window.location.hash = '#/' + tab;
}
function statusState(initial) {
  if (initial && initial.error) return { label: _('недоступно'), kind: 'r' };
  var value = initial && (initial.serviceState || initial.state || initial.runtime && initial.runtime.state);
  if (value === 'running') return { label: _('работает'), kind: 'g' };
  if (value === 'stopped') return { label: _('остановлена'), kind: 'r' };
  return { label: value || _('неизвестно'), kind: 'o' };
}
function detectedVersion(initial) {
  var meta = initial && initial.meta || {};
  var value = meta.managerVersion || meta.packageVersion ||
    initial && initial.packageVersion;
  return value == null || value === '' ? null : String(value);
}
function draftScopes() { return Object.keys(store.get().draft || {}); }
function draftMeta(scope) { return DRAFT_META[scope] || { label: scope, tab: 'overview' }; }
function draftLabel(scope) { return draftMeta(scope).label; }
function humanDraftValue(value) {
  if (value === true) return _('Включено');
  if (value === false) return _('Выключено');
  if (value == null || value === '') return _('Отключено');
  if (Array.isArray(value)) return value.join(', ') || _('Отключено');
  return String(value);
}
function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = cloneValue(value[key]); });
    return result;
  }
  return value;
}
function responseMessage(value, fallback) {
  var error = value && value.error !== undefined ? value.error : value;
  if (error && typeof error === 'object') return error.message || error.detail || error.code || fallback;
  return error ? String(error) : fallback;
}
function responseBlocker(value, fallback) {
  if (!value || value.ok === false) return responseMessage(value, fallback);
  var errors = asArray(value.errors).concat(asArray(value.blockers));
  if (errors.length) return responseMessage(errors[0], fallback);
  return null;
}
function unsupportedAdapter(scope) {
  var reason = 'Unsupported scope: ' + String(scope);
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
  services: Services.createAdapter(Api, Services),
  dns: Dns.createAdapter(Api)
};
Object.keys(DRAFT_META).forEach(function (scope) {
  if (!ADAPTERS[scope]) ADAPTERS[scope] = unsupportedAdapter(scope);
});
function renderSemanticDiff(draft, applied, extraBlockers) {
  var groups = DraftModel.semanticDiff(draft, applied);
  var byScope = {};
  groups.forEach(function (group) { byScope[group.scope] = group; });
  Object.keys(object(draft)).forEach(function (scope) {
    var adapter = ADAPTERS[scope];
    var blocker = extraBlockers && extraBlockers[scope];
    if (adapter && adapter.supported !== true) blocker = blocker || 'Unsupported scope: ' + scope;
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
        E('div', {}, [E('div', { 'class': 'nm' }, row.label), E('div', { 'class': 'co' }, humanDraftValue(row.before) + ' → ' + humanDraftValue(row.after))]),
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
function createCoordinator(options) {
  options = options || {};
  var api = options.api || Api;
  var targetStore = options.store || StoreModule.create();
  var shell = options.shell || Shell;
  var adapters = options.adapters || ADAPTERS;
  var root = options.root || null;

  function normalize(error) {
    if (api && typeof api.normalizeError === 'function') return api.normalizeError(error);
    return { code: error && error.code || 'error', message: error && error.message || String(error || 'Unknown error') };
  }
  function sequence(scopes, fn) {
    return scopes.reduce(function (chain, scope) {
      return chain.then(function () { return fn(scope); });
    }, Promise.resolve());
  }
  function same(left, right) { return JSON.stringify(left || {}) === JSON.stringify(right || {}); }
  function availability(draft) {
    draft = draft || targetStore.get().draft || {};
    var scopes = Object.keys(draft);
    var normalized = DraftModel.applyAvailability(scopes.map(function (scope) {
      return Object.assign({ scope: scope }, draft[scope] || {});
    }));
    var blockers = normalized.blockers.slice();
    scopes.forEach(function (scope) {
      if (!adapters[scope]) blockers.push('Unsupported scope: ' + scope);
      else if (adapters[scope].supported !== true && blockers.indexOf('Unsupported scope: ' + scope) < 0)
        blockers.push('Unsupported scope: ' + scope);
    });
    var coordinator = targetStore.get().coordinator || {};
    var ready = coordinator.status === 'ready' && coordinator.preflight && same(coordinator.preflight.snapshot, draft);
    var preflightReason = ready ? null : coordinator.preflight && same(coordinator.preflight.snapshot, draft) &&
      coordinator.preflight.blockers && coordinator.preflight.blockers[0];
    return {
      enabled: ready && scopes.length > 0 && blockers.length === 0,
      reason: blockers[0] || preflightReason || (ready ? normalized.reason : _('Ожидается предварительная проверка.')),
      blockers: blockers
    };
  }
  function contextFor(context) {
    context = context || {};
    context.api = context.api || api;
    context.store = context.store || targetStore;
    context.shell = context.shell || shell;
    context.applied = context.applied || cloneValue(targetStore.get().applied || {});
    context.root = context.root || root;
    context.previews = context.previews || {};
    return context;
  }
  function stageError(states, scope, error) {
    var normalized = normalize(error);
    states[scope] = states[scope] || {};
    states[scope].blocker = normalized.code && normalized.code !== 'error'
      ? normalized.code + ': ' + normalized.message : normalized.message;
    states[scope].error = normalized;
  }
  function previewError(answer, scope, adapter) {
    if (!answer || typeof answer !== 'object' || answer.ok !== true)
      return responseMessage(answer, _('Предпросмотр недоступен.'));
    if (adapter && typeof adapter.previewValid === 'function')
      return adapter.previewValid(answer) === true ? null : _('Предпросмотр не содержит допустимой precondition.');
    var precondition = answer.precondition;
    if (!precondition || typeof precondition !== 'object') return _('Предпросмотр не содержит допустимой precondition.');
    if (precondition.ledgerRevision == null && precondition.revision == null && precondition.appliedRevision == null)
      return _('Предпросмотр не содержит ревизию precondition.');
    if (scope === 'services' && !Object.prototype.hasOwnProperty.call(precondition, 'fileSha256'))
      return _('Предпросмотр каталога не содержит fileSha256 precondition.');
    return null;
  }
  function mutationError(answer) {
    if (!answer || typeof answer !== 'object' || answer.ok !== true)
      return responseMessage(answer, _('Backend не подтвердил применение.'));
    return null;
  }
  function preflightDraft(snapshot, context) {
    snapshot = snapshot || targetStore.snapshotDraft();
    context = contextFor(context);
    var scopes = Object.keys(snapshot);
    var states = {};
    var normalized = {};
    scopes.forEach(function (scope) {
      normalized[scope] = DraftModel.normalizeScope(scope, snapshot[scope]);
      states[scope] = { value: snapshot[scope], entry: normalized[scope] };
      if (normalized[scope].blocker) states[scope].blocker = normalized[scope].blocker;
      if (!adapters[scope]) states[scope].blocker = 'Unsupported scope: ' + scope;
      else if (adapters[scope].supported !== true) states[scope].blocker = 'Unsupported scope: ' + scope;
    });
    var pendingAvailability = availability(snapshot);
    pendingAvailability.enabled = false;
    if (!pendingAvailability.reason) pendingAvailability.reason = _('Ожидается предварительная проверка.');
    targetStore.setCoordinator({ status: 'preflighting', availability: pendingAvailability, preflight: null });
    return sequence(scopes, function (scope) {
      var adapter = adapters[scope];
      if (!adapter) return Promise.resolve();
      return Promise.resolve().then(function () { return adapter.reloadAppliedState(context); }).then(function (read) {
        states[scope].read = read || {};
        context.applied[scope] = read && read.value || {};
        if (read == null || read.revision == null) states[scope].blocker = _('Ревизия backend недоступна.');
        else if (normalized[scope].revision != null && String(normalized[scope].revision) !== String(read.revision))
          states[scope].blocker = _('Конфликт ревизий: черновик устарел.');
      }).catch(function (error) { stageError(states, scope, error); });
    }).then(function () {
      return sequence(scopes, function (scope) {
        var adapter = adapters[scope];
        if (!adapter) return Promise.resolve();
        return Promise.resolve().then(function () { return adapter.validateDraft(scope, snapshot[scope], context); }).then(function (answer) {
          var blocker = responseBlocker(answer, _('Локальная проверка не пройдена.'));
          if (blocker) states[scope].blocker = states[scope].blocker || blocker;
        }).catch(function (error) { stageError(states, scope, error); });
      });
    }).then(function () {
      return sequence(scopes, function (scope) {
        var adapter = adapters[scope];
        if (!adapter) return Promise.resolve();
        return Promise.resolve().then(function () { return adapter.previewDraft(scope, snapshot[scope], context); }).then(function (answer) {
          var blocker = previewError(answer, scope, adapter);
          if (blocker) states[scope].blocker = states[scope].blocker || blocker;
          states[scope].preview = answer || {};
          context.previews[scope] = states[scope].preview;
        }).catch(function (error) { stageError(states, scope, error); });
      });
    }).then(function () {
      var blockers = scopes.map(function (scope) { return states[scope].blocker ? scope + ': ' + states[scope].blocker : null; }).filter(Boolean);
      var result = {
        ok: scopes.length > 0 && blockers.length === 0,
        snapshot: snapshot, scopes: scopes, states: states, blockers: blockers,
        availability: { enabled: scopes.length > 0 && blockers.length === 0, reason: blockers[0] || null, blockers: blockers }
      };
      targetStore.setCoordinator({ status: result.ok ? 'ready' : 'blocked', availability: result.availability, preflight: result });
      return result;
    });
  }
  function handleApplyResult(result) {
    var bookkeeping = DraftModel.recordApplyResult(targetStore.get().draft || {}, result || {});
    targetStore.update({ draft: bookkeeping.draft });
    (bookkeeping.clearedScopes || []).forEach(function (scope) {
      if (adapters[scope] && adapters[scope].resetDraft) adapters[scope].resetDraft();
    });
    targetStore.setCoordinator({ status: bookkeeping.failedScopes.length ? 'failed' : 'applied', result: bookkeeping });
    bookkeeping.errors.forEach(function (error) { if (shell && shell.showToast) shell.showToast(error.scope + ': ' + error.message, 'err'); });
    if (!bookkeeping.errors.length && bookkeeping.clearedScopes.length && shell && shell.showToast)
      shell.showToast(_('Изменения применены и проверены.'), 'ok');
    return bookkeeping;
  }
  function applyDrafts(snapshot, context) {
    snapshot = snapshot || targetStore.snapshotDraft();
    context = contextFor(context);
    return preflightDraft(snapshot, context).then(function (preflight) {
      if (!preflight.ok) {
        return handleApplyResult({ successes: [], failures: preflight.scopes.filter(function (scope) {
          return preflight.states[scope].blocker;
        }).map(function (scope) {
          return { scope: scope, error: { code: 'preflight-blocked', message: preflight.states[scope].blocker } };
        }) });
      }
      var outcomes = { successes: [], failures: [], rollback: null };
      return sequence(preflight.scopes, function (scope) {
        var state = preflight.states[scope];
        var adapter = adapters[scope];
        context.previews[scope] = state.preview;
        context.preview = state.preview;
        return Promise.resolve().then(function () {
          return adapter.applyDraft(scope, snapshot[scope], state.read && state.read.revision, context);
        }).then(function (answer) {
          var blocker = mutationError(answer);
          if (blocker) throw { code: 'apply-rejected', message: blocker };
          var rollback = answer && (answer.rollback || answer.snapshot || answer);
          if (rollback && rollback.available === true && (rollback.snapshotId != null || rollback.revision != null)) outcomes.rollback = rollback;
          return Promise.resolve().then(function () { return adapter.reloadAppliedState(context); }).then(function (read) {
            if (!read || read.revision == null) throw { code: 'verification-failed', message: _('Проверка ревизии применённого состояния не пройдена.') };
            if (adapter.verifyApplied && adapter.verifyApplied(snapshot[scope], context, read) !== true)
              throw { code: 'verification-failed', message: _('Проверка применённого состояния не пройдена.') };
            context.applied[scope] = read.value || {};
            targetStore.setApplied(scope, context.applied[scope]);
            outcomes.successes.push(scope);
          });
        }).catch(function (error) { outcomes.failures.push({ scope: scope, error: normalize(error) }); });
      }).then(function () {
        outcomes.snapshot = snapshot;
        var applied = handleApplyResult(outcomes);
        if (outcomes.rollback) applied.rollback = outcomes.rollback;
        return applied;
      });
    });
  }
  return {
    availability: availability,
    semanticBlockers: function (draft) {
      var preflight = targetStore.get().coordinator && targetStore.get().coordinator.preflight;
      if (!preflight || !same(preflight.snapshot, draft || targetStore.get().draft || {})) return {};
      var result = {};
      Object.keys(preflight.states || {}).forEach(function (scope) {
        if (preflight.states[scope].blocker) result[scope] = preflight.states[scope].blocker;
      });
      return result;
    },
    preflightDraft: preflightDraft,
    applyDrafts: applyDrafts,
    handleApplyResult: handleApplyResult,
    openSemanticDiff: options.openSemanticDiff || function () {}
  };
}

return L.view.extend({
  load: function () {
    return Api.service.status().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },

  render: function (initial) {
    Shell.injectCss();
    var content = E('main', { 'class': 'z2m-content', id: 'z2m-content' });
    var tabs = E('nav', { 'class': 'z2m-tabs', id: 'z2m-tabs', role: 'tablist', 'aria-label': _('Разделы Zapret 2 Manager') });
    var coordinator = createCoordinator({ api: Api, store: store, shell: Shell, adapters: ADAPTERS, root: content });
    var applyBar = Shell.renderApplyBar(store, coordinator.availability());
    var appRoot = null;

    function setContentBusy(busy) {
      content.classList.toggle('z2m-refreshing', busy === true);
      content.setAttribute('aria-busy', busy === true ? 'true' : 'false');
    }

    function openApplyResult(result) {
      if (!result || !result.rollback) return;
      var rollback = Shell.button(_('Откатить результат'), 'danger', function () {
        rollback.disabled = true;
        Api.strategy.rollbackManager().then(function () {
          Shell.closeModal();
          Shell.showToast(_('Результат применения отменён.'), 'ok');
          return activate(store.get().ui.tab || 'overview', true);
        }).catch(function (error) {
          rollback.disabled = false;
          Shell.showToast(Api.normalizeError(error).message, 'err');
        });
      });
      Shell.openModal(_('Результат применения'), E('p', {}, _('Backend сообщил доступный снимок результата. Откат выполняется только вручную.')), [
        Shell.button(_('Закрыть'), '', Shell.closeModal), rollback
      ]);
    }
    function openSemanticDiff() {
      var draft = store.snapshotDraft();
      function renderModal(availability) {
        var apply = Shell.button(_('Применить'), 'primary', function () {
          apply.disabled = true;
          coordinator.applyDrafts(store.snapshotDraft(), { root: content }).then(function (result) {
            Shell.closeModal();
            renderState();
            activate(store.get().ui.tab || 'overview', true);
            openApplyResult(result);
          }).catch(function (error) {
            apply.disabled = false;
            Shell.showToast(Api.normalizeError(error).message, 'err');
          });
        }, !availability.enabled);
        var body = [renderSemanticDiff(draft, store.get().applied || {}, coordinator.semanticBlockers(draft))];
        if (!availability.enabled) body.push(E('div', { 'class': 'z2m-apply-reason' }, _('Применение заблокировано: ') + availability.reason));
        Shell.openModal(_('Семантические изменения'), body, [Shell.button(_('Закрыть'), '', Shell.closeModal), apply]);
      }
      renderModal(coordinator.availability(draft));
      coordinator.preflightDraft(draft, { root: content }).then(function () {
        renderModal(coordinator.availability(draft));
      });
    }
    function context(tab, module, data, node) {
      return {
        api: Api, store: store, shell: Shell, root: node || content,
        data: data || {}, initial: initial || {},
        navigate: function (next) { return navigateTo(next); },
        refresh: function (next) { return activate(next || tab, true); },
        setDraft: function (scope, value) { store.setDraft(scope, value); },
        clearDraft: function (scope) { store.clearDraft(scope); },
        openSemanticDiff: openSemanticDiff,
        applyDrafts: function () { return coordinator.applyDrafts(store.snapshotDraft(), { root: content }); },
        coordinator: {
          preflightDraft: coordinator.preflightDraft,
          applyDrafts: coordinator.applyDrafts,
          handleApplyResult: coordinator.handleApplyResult,
          openSemanticDiff: openSemanticDiff
        }
      };
    }
    function loadTabData(tab, module) {
      if (tabLoadPromises[tab]) return tabLoadPromises[tab];
      tabLoadPromises[tab] = Promise.resolve().then(function () {
        return module.load(context(tab, module, tabDataCache[tab]));
      }).then(function (data) {
        tabDataCache[tab] = data || {};
        delete tabLoadPromises[tab];
        return tabDataCache[tab];
      }, function (error) {
        delete tabLoadPromises[tab];
        throw error;
      });
      return tabLoadPromises[tab];
    }
    function renderTabData(tab, module, data, token, force) {
      if (token !== activationToken) return false;
      if (activeModule && activeContext && activeModule.unmount)
        activeModule.unmount(activeContext);
      activeModule = module;
      activeContext = null;
      var ctx = context(tab, module, data);
      var node;
      try {
        node = module.render(ctx);
      } catch (error) {
        content.replaceChildren(E('div', { 'class': 'warnbar' }, Api.normalizeError(error).message));
        return false;
      }
      if (token !== activationToken) {
        if (module.unmount) module.unmount(ctx);
        return false;
      }
      ctx.root = node;
      content.replaceChildren(node);
      activeContext = ctx;
      if (module.mount) module.mount(ctx);
      if (appRoot && appRoot.scrollIntoView && !force)
        appRoot.scrollIntoView({ block: 'start' });
      return true;
    }
    function navigateTo(tab) {
      if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
      if (activeModule === MODULES[tab] && activeContext) return Promise.resolve();
      if (window.location.hash !== '#/' + tab) {
        setHash(tab);
        return Promise.resolve();
      }
      return activate(tab);
    }
    function activate(tab, force) {
      if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
      var token = ++activationToken;
      var module = MODULES[tab];
      var sameTab = activeModule === module && !!activeContext;
      var keepCurrent = sameTab && force === true;
      var cachedData = tabDataCache[tab];

      store.update({ ui: Object.assign({}, store.get().ui, { tab: tab }) });
      Array.from(tabs.querySelectorAll('button[data-tab]')).forEach(function (button) {
        var selected = button.getAttribute('data-tab') === tab;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });

      if (cachedData && !sameTab) {
        renderTabData(tab, module, cachedData, token, force);
      } else if (!cachedData && !keepCurrent) {
        if (activeModule && activeContext && activeModule.unmount)
          activeModule.unmount(activeContext);
        activeModule = module;
        activeContext = null;
        content.replaceChildren(Shell.renderLoadingState(TAB_LABELS[tab]));
      }

      setContentBusy(true);
      return loadTabData(tab, module).then(function (data) {
        if (token !== activationToken) return;
        renderTabData(tab, module, data, token, force);
        setContentBusy(false);
      }).catch(function (error) {
        if (token !== activationToken) return;
        setContentBusy(false);
        var message = Api.normalizeError(error).message;
        if ((activeModule === module && activeContext) || cachedData) {
          Shell.showToast(_('Не удалось обновить данные. Показано последнее успешное состояние: ') + message, 'warn');
          return;
        }
        activeModule = module;
        activeContext = null;
        content.replaceChildren(E('div', { 'class': 'warnbar' }, message));
      });
    }

    function updateDraftBar() {
      var scopes = draftScopes();
      var availability = coordinator.availability();
      applyBar.classList.toggle('hidden', !scopes.length);
      var text = applyBar.querySelector('#z2m-apply-text');
      var apply = applyBar.querySelector('#z2m-apply-drafts');
      var reason = applyBar.querySelector('#z2m-apply-reason');
      if (text && scopes.length) {
        text.textContent = scopes.length + ' ' + (scopes.length === 1 ? _('изменение') : _('изменения')) + ': ' +
          scopes.map(draftLabel).join(', ') + '. ' + _('На работу роутера пока не влияет.');
      }
      if (apply) apply.disabled = availability.enabled !== true;
      if (reason) reason.textContent = availability.enabled || !scopes.length ? '' : _('Применение заблокировано: ') + availability.reason;
    }
    function renderState() {
      if (appRoot)
        appRoot.classList.toggle('adv', !!(store.get().ui && store.get().ui.advanced));
      updateDraftBar();
    }
    function discardDrafts() {
      Shell.openModal(
        _('Отменить все изменения?'),
        E('p', {}, _('Черновики существуют только в браузере. Backend и runtime изменены не будут.')),
        [
          Shell.button(_('Не отменять'), '', Shell.closeModal),
          Shell.button(_('Отменить черновики'), 'danger', function () {
            Shell.closeModal();
            Object.keys(MODULES).forEach(function (tab) {
              var module = MODULES[tab];
              if (module.resetDraft) module.resetDraft();
            });
            store.clearAllDrafts();
            var snapshot = store.get();
            store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: null, pendingOverride: null }) });
            tabDataCache = {};
            renderState();
            activate(store.get().ui.tab || 'overview', true);
          })
        ]
      );
    }

    var initialTab = tabFromHash();
    TAB_IDS.forEach(function (tab) {
      var button = E('button', {
        type: 'button', 'data-tab': tab,
        'class': tab === initialTab ? 'on' : '', role: 'tab',
        'aria-selected': tab === initialTab ? 'true' : 'false'
      }, TAB_LABELS[tab]);
      button.addEventListener('click', function () { navigateTo(tab); });
      tabs.appendChild(button);
    });
    if (hashHandler) window.removeEventListener('hashchange', hashHandler);
    hashHandler = function () { activate(tabFromHash()); };
    window.addEventListener('hashchange', hashHandler);

    var service = statusState(initial);
    var version = detectedVersion(initial);
    var brand = [
      E('span', { 'class': 'mark', 'aria-hidden': 'true' }, 'z2'),
      E('span', { 'class': 'nm' }, ['zapret2', E('span', { 'class': 'mgr' }, '·manager')])
    ];
    if (version) brand.push(E('span', { 'class': 'ver' }, version));
    appRoot = E('div', { 'class': 'z2m-app', id: 'z2m-app' }, [
      E('header', { 'class': 'z2m-apptop' }, E('div', { 'class': 'in' }, [
        E('div', { 'class': 'z2m-brand' }, brand),
        E('div', { 'class': 'z2m-apptop-right' }, [
          E('span', { 'class': 'host' }, window.location.hostname || 'OpenWrt'),
          Shell.chip(service.label, service.kind, true)
        ])
      ])),
      E('div', { 'class': 'z2m-wrap' }, [tabs, content]),
      applyBar,
      E('div', { id: 'z2m-modal', 'class': 'z2m-scrim' }),
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
  handleReset: null,
  createCoordinator: createCoordinator,
  createServicesAdapter: Services.createAdapter,
  createDnsAdapter: Dns.createAdapter,
  createStrategyAdapter: Strategy.createAdapter,
  renderSemanticDiff: renderSemanticDiff
});
