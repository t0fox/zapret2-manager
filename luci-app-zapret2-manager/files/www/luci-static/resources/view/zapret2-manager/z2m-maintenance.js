'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';
'require view.zapret2-manager.z2m-components-model as ComponentsModel';
'require view.zapret2-manager.z2m-update-presentation as UpdatePresentation';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
var LOAD_TIMEOUT_MS = 30000;
var SCOPE_LABELS = {
  engineConfig: _('Конфигурация движка'),
  ourState: _('Состояние менеджера'),
  lists: _('Списки'),
  profiles: _('Профили'),
  all: _('Полная резервная копия')
};
var PANE_META = {
  components: { title: _('Компоненты'), subtitle: _('Обязательные компоненты системы и их состояние') },
  backups: { title: _('Резервные копии'), subtitle: _('Сохранение и восстановление состояния менеджера') },
  settings: { title: _('Настройки'), subtitle: _('Параметры интерфейса менеджера') }
};

// Unified semantic mapping — single source of truth for label → visual kind
var SEMANTIC_KIND = {
  'Система готова': 'g',
  'Работает': 'g',
  'Актуален': 'g',
  'Актуально': 'g',
  'Проверено': 'g',
  'Готов': 'g',
  'Доступно обновление': 'o',
  'Требует внимания': 'o',
  'Требует проверки': 'o',
  'Требуется проверка': 'o',
  'Требуется адаптация': 'o',
  'Проверяется': 'o',
  'Требуется интеграция': 'o',
  'Ошибка': 'r',
  'Несовместим': 'r',
  'Сломан': 'r',
  'Требуется восстановление': 'r',
  'Не установлен': '',
  'Остановлен': '',
  'Приостановлен': '',
  'Недоступен': '',
  'Выключен': '',
  'Требуется Zapret2 Engine': '',
  'Состояние неизвестно': ''
};
function kindForLabel(label) {
  return SEMANTIC_KIND[label] !== undefined ? SEMANTIC_KIND[label] : 'o';
}

var state = {
  pane: 'system',
  paneInitialized: false,
  preview: null,
  previewModel: null,
  verification: null,
  diagnostics: null,
  busy: null,
  componentOperation: null,
  lastSuccessfulCheckAt: null,
  skipEngineOperationStatus: false,
  get componentBusy() { return this.componentOperation != null; },
  set componentBusy(v) {
    // Backward compat: boolean true => generic check, false => clear
    if (v) this.componentOperation = { kind: 'check', scope: 'all' };
    else this.componentOperation = null;
  },
  engineExpanded: false,
  z2kExpanded: false,
  engineOperation: null,
  engineOperationTimer: null,
  engineOperationPolling: false,
  showAllBackups: false
};
function isBusyFor(componentId) {
  var op = state.componentOperation;
  if (!op) return false;
  if (op.scope === 'all') return true;
  if (op.scope === 'z2k' && componentId === 'z2k-core') return true;
  if (op.scope === 'engine' && componentId === 'engine') return true;
  return false;
}
function operationPhase(op) {
  if (!op) return '';
  if (op.kind === 'check') return _('Проверка обновлений…');
  if (op.kind === 'update' && op.scope === 'z2k') return _('Обновление Z2K…');
  if (op.kind === 'refresh') return _('Обновление состояния…');
  return _('Обновление…');
}
function operationMessage(op) {
  if (!op) return '';
  if (op.kind === 'check') return _('Проверяем доступные версии…');
  if (op.kind === 'update' && op.scope === 'z2k') return _('Применяем Z2K-обновление…');
  return _('Выполняется операция…');
}
function engineOperationTerminal(operation) {
  return operation && ['completed', 'failed', 'rolled_back'].indexOf(operation.phase) >= 0;
}

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function boundedLoad(promise, label) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject({ code: 'frontend-timeout', message: label + ' timeout' });
      }, LOAD_TIMEOUT_MS);
    })
  ]).then(function (value) {
    window.clearTimeout(timer);
    return value;
  }, function (error) {
    window.clearTimeout(timer);
    throw error;
  });
}
function checkedResult(promise, label) {
  return boundedLoad(promise, label).then(function (answer) {
    if (!answer || answer.ok === false || answer.error)
      throw answer && answer.error || answer || { code: 'EEMPTY', message: label + ' не вернул результат.' };
    return answer;
  });
}
function activePane(ctx) {
  var route = ctx.route || '';
  if (route === 'backups') return 'backups';
  if (route === 'settings') return 'components';
  return 'components';
}
function telegramCardState(tg) {
  // Canonical projection for tg-product.v2 — uses unified SEMANTIC_KIND
  if (!tg || typeof tg !== 'object') return { status: 'unknown', label: _('Состояние неизвестно'), kind: kindForLabel(_('Состояние неизвестно')), meta: [] };
  if (tg.error) return { status: 'unknown', label: _('Состояние неизвестно'), kind: kindForLabel(_('Состояние неизвестно')), meta: [] };
  if (tg.ok === false) return { status: 'unknown', label: _('Состояние неизвестно'), kind: kindForLabel(_('Состояние неизвестно')), meta: [] };
  var status = String(tg.status || '').toLowerCase();
  var readinessInstalled = tg.readiness && tg.readiness.installed === true;
  var installedArray = Array.isArray(tg.installed) ? tg.installed : [];
  var hasInstalled = installedArray.length > 0 && installedArray.some(function (p) { return p.installed === true; });
  var hasAnyInstalled = readinessInstalled || hasInstalled;
  // not-installed
  if (status === 'not-installed' || (!hasAnyInstalled && status !== 'running' && status !== 'stopped' && status !== 'degraded')) {
    if (readinessInstalled === false || (installedArray.length === 0 && status === 'not-installed')) {
      return { status: 'off', label: _('Не установлен'), kind: kindForLabel(_('Не установлен')), meta: [] };
    }
  }
  if (status === 'not-installed' && readinessInstalled === false) return { status: 'off', label: _('Не установлен'), kind: kindForLabel(_('Не установлен')), meta: [] };
  if (status === 'stopped') return { status: 'off', label: _('Остановлен'), kind: kindForLabel(_('Остановлен')), meta: hasAnyInstalled ? [{ label: _('Provider'), value: tg.activeProvider || installedArray[0] && installedArray[0].provider || '—' }] : [] };
  if (status === 'degraded') return { status: 'degraded', label: _('Требует внимания'), kind: kindForLabel(_('Требует внимания')), meta: [{ label: _('Provider'), value: tg.activeProvider || '—' }, { label: _('Версия'), value: tg.activeVersion || tg.activePackageVersion || '—' }] };
  if (status === 'running') {
    var meta = [];
    if (tg.activeProvider) meta.push({ label: _('Provider'), value: tg.activeProvider });
    if (tg.activeVersion || tg.activePackageVersion) meta.push({ label: _('Версия'), value: tg.activeVersion || tg.activePackageVersion });
    return { status: 'ok', label: _('Работает'), kind: kindForLabel(_('Работает')), meta: meta };
  }
  if (readinessInstalled === false) return { status: 'off', label: _('Не установлен'), kind: kindForLabel(_('Не установлен')), meta: [] };
  return { status: 'unknown', label: _('Состояние неизвестно'), kind: kindForLabel(_('Состояние неизвестно')), meta: [] };
}
function load(ctx) {
  var pane = activePane(ctx);
  var promise;
  if (pane === 'components') {
    var skipEngineOperationStatus = state.skipEngineOperationStatus;
    var engineLoad = skipEngineOperationStatus
      ? EnginePanel.load(Object.assign({}, ctx, { skipEngineOperationStatus: true }))
      : EnginePanel.load(ctx);
    state.skipEngineOperationStatus = false;
    promise = Promise.allSettled([
    boundedLoad(ctx.api.maintenance.versions(), 'manager versions'),
    boundedLoad(engineLoad, 'engine status'),
    boundedLoad(ctx.api.resources.status(), 'Z2K status'),
    boundedLoad(ctx.api.tg && ctx.api.tg.product && ctx.api.tg.product.status ? ctx.api.tg.product.status() : Promise.resolve({}), 'TG status')
  ]).then(function (values) {
    return {
      components: {
        versions: settled(values[0], ctx.api),
        engine: settled(values[1], ctx.api),
        resources: settled(values[2], ctx.api),
        telegram: settled(values[3], ctx.api)
      }
    };
  });
  }
  else if (pane === 'backups') promise = boundedLoad(ctx.api.maintenance.backupList(), 'backup list').then(function (value) { return { backups: { value: value || {} } }; });
  else if (pane === 'settings') promise = Promise.resolve({ settings: { value: { ui: ctx.store.get().ui || {} } } });
  return promise.catch(function (error) {
    var key = pane === 'components' ? 'components' : pane === 'backups' ? 'backups' : 'settings';
    var result = {}; result[key] = { error: ctx.api.normalizeError(error) }; return result;
  });
}
function showError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  ctx.shell.showToast(normalized.message, 'err');
}
function rerender(ctx) {
  var next = render(ctx);
  ctx.root.replaceChildren(next);
}
function refresh(ctx) {
  return ctx.refresh(ctx.route || 'system');
}
function mutation(ctx, name, promise) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.busy = null;
    return answer;
  }).catch(function (error) {
    state.busy = null;
    showError(ctx, error);
    return null;
  });
}
function confirmAction(ctx, title, message, confirmLabel, handler) {
  var shell = ctx.shell;
  shell.openModal(title, E('p', {}, message), [
    shell.button(_('Отмена'), '', shell.closeModal),
    shell.button(confirmLabel, 'danger', function () {
      shell.closeModal();
      handler();
    })
  ]);
}
function kvPanel(shell, rows) {
  return E('div', { 'class': 'z2m-proxy-kv' }, rows.filter(function (row) {
    return row.value !== null && row.value !== undefined && row.value !== '';
  }).map(function (row) {
    return E('div', {}, [E('span', {}, row.label), E('strong', {}, row.value)]);
  }));
}
function formatTime(shell, value) {
  return shell.format.timestamp(value) || '';
}
function formatLastCheck(shell, value) {
  if (!value) return _('ещё не проверялось');
  var t = shell.format.timestamp(value);
  if (!t) return _('только что');
  // shell.format.timestamp already handles relative, fallback to t
  return t;
}
function latestCanonicalTimestamp() {
  var latest = null;
  var latestOrder = -Infinity;
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (value === null || value === undefined || value === '') continue;
    var numeric = Number(value);
    var order = Number.isFinite(numeric) ? numeric : Date.parse(String(value)) / 1000;
    if (Number.isFinite(order) && order > latestOrder) {
      latest = value;
      latestOrder = order;
    }
  }
  return latest;
}
function componentStateLabel(component) {
  var runtimeHealth = component.runtimeHealth || component.health;
  var compatibility = component.compatibility && typeof component.compatibility === 'object'
    ? component.compatibility.state : component.compatibility;
  if (component.id === 'engine') {
    if (runtimeHealth === 'missing') return _('Не установлен');
    if (runtimeHealth === 'broken') return _('Ошибка');
    if (compatibility === 'incompatible') return _('Несовместим');
    if (runtimeHealth === 'checking') return _('Проверяется');
    var svc = component.details && component.details.serviceState;
    if (svc === 'paused') return _('Приостановлен');
    if (svc === 'stopped') return _('Остановлен');
    if (runtimeHealth === 'degraded') return _('Требует внимания');
    if (component.updateState === 'update-available') return _('Доступно обновление');
    if (component.updateState === 'review-required') return _('Требуется проверка');
    if (component.updateState === 'rebase-required') return _('Требуется адаптация');
    if (component.updateState === 'integration-required') return _('Требуется интеграция');
    // Healthy installed+running+compatible => Работает (green)
    return _('Работает');
  }
  if (component.id === 'z2k-core') {
    if (runtimeHealth === 'missing') {
      return component.summary && String(component.summary).indexOf('Engine') >=0 ? _('Требуется Zapret2 Engine') : _('Не установлен');
    }
    if (runtimeHealth === 'broken') return _('Ошибка');
    if (compatibility === 'incompatible') return _('Несовместим');
    if (runtimeHealth === 'checking') return _('Проверяется');
    if (component.updateState === 'update-available') return _('Доступно обновление');
    if (component.updateState === 'review-required') return _('Требуется проверка');
    if (component.updateState === 'rebase-required') return _('Требуется адаптация');
    if (component.updateState === 'integration-required') return _('Требуется интеграция');
    if (runtimeHealth === 'ready' && component.updateState === 'current' && compatibility === 'compatible') return _('Актуален');
    if (runtimeHealth === 'ready') {
      if (component.updateState === 'unknown') return _('Работает');
      return _('Актуален');
    }
    return _('Требует внимания');
  }
  var health = runtimeHealth;
  if (health === 'missing') return _('Не установлен');
  if (health === 'broken') return _('Ошибка');
  if (health === 'checking') return _('Проверяется');
  if (component.updateState === 'update-available') return _('Доступно обновление');
  if (component.updateState === 'review-required') return _('Требуется проверка');
  if (component.updateState === 'rebase-required') return _('Требуется адаптация');
  if (component.updateState === 'integration-required') return _('Требуется интеграция');
  if (compatibility === 'incompatible') return _('Несовместим');
  return _('Актуален');
}
function componentStateKind(component) {
  var label = componentStateLabel(component);
  return kindForLabel(label);
}
function mandatorySummary(page) {
  var ready = page.health.ready;
  var total = page.health.total;
  var updates = page.components.filter(function (c) { return c.updateState === 'update-available'; }).length;
  var reviews = page.components.filter(function (c) { return c.updateState === 'review-required'; }).length;
  var rebases = page.components.filter(function (c) { return c.updateState === 'rebase-required'; }).length;
  var integrations = page.components.filter(function (c) { return c.updateState === 'integration-required'; }).length;
  // Build dynamic counter like "2 работают · 1 обновление"
  var parts = [];
  if (ready === total && total > 0) parts.push(ready + ' ' + (ready === 1 ? _('работает') : _('работают')));
  else if (ready === 1) parts.push('1 ' + _('работает') + ' · ' + (total - 1) + ' ' + _('требует внимания'));
  else if (ready > 0) parts.push(ready + ' ' + _('работают') + ' · ' + (total - ready) + ' ' + _('требует внимания'));
  else parts.push(_('требуют внимания'));
  if (updates > 0) parts.push(updates === 1 ? _('1 обновление') : updates + ' ' + _('обновления'));
  if (reviews > 0) parts.push(reviews === 1 ? _('1 требует проверки') : reviews + ' ' + _('требуют проверки'));
  if (rebases > 0) parts.push(rebases === 1 ? _('1 требует адаптации') : rebases + ' ' + _('требуют адаптации'));
  if (integrations > 0) parts.push(integrations === 1 ? _('1 требует интеграции') : integrations + ' ' + _('требуют интеграции'));
  return parts.join(' · ');
}
function updateSummary(page) {
  var counts = { 'update-available': 0, 'review-required': 0, 'rebase-required': 0, 'integration-required': 0 };
  page.components.forEach(function (component) {
    if (counts[component.updateState] !== undefined) counts[component.updateState]++;
  });
  return Object.keys(counts).filter(function (key) { return counts[key] > 0; }).map(function (key) {
    var count = counts[key];
    return count + ' × ' + UpdatePresentation.describe(key).label;
  }).join(' · ') || _('Обновления не требуются');
}
function heroStatusLabel(page) {
  if (page.health.state === 'ready') return _('Система готова');
  if (page.health.state === 'broken') return _('Требуется восстановление');
  if (page.health.state === 'missing') return _('Требуется установка');
  return _('Требуется проверка');
}
function heroStatusKind(page) {
  if (page.health.state === 'ready') return 'g';
  if (page.health.state === 'broken' || page.health.state === 'missing') return 'r';
  return 'o';
}
function refreshState(ctx) {
  if (state.componentOperation) return;
  state.componentOperation = { kind: 'refresh', scope: 'all' };
  rerender(ctx);
  // Clear BEFORE refresh boundary
  state.componentOperation = null;
  rerender(ctx);
  return refresh(ctx).catch(function (error) {
    showError(ctx, error);
  });
}
var CHECK_TIMEOUT_MS = 20000;
function checkUpdates(ctx, scope) {
  scope = scope || 'all';
  if (state.componentOperation) return;
  state.componentOperation = { kind: 'check', scope: scope };
  rerender(ctx);
  var promises = [];
  if (scope === 'all' || scope === 'z2k') promises.push(checkedResult(ctx.api.resources.check(), 'Проверка Z2K'));
  if (scope === 'all' || scope === 'engine') {
    promises.push(checkedResult(ctx.api.engine.check({ forceRefresh: true }), 'Проверка движка'));
    if (ctx.api.engine.gateStatus) promises.push(checkedResult(ctx.api.engine.gateStatus(), 'Проверка гейта движка'));
  }
  // Bounded lifecycle: even a hung rpc transport must never leave busy forever.
  Promise.race([Promise.allSettled(promises), new Promise(function (_, reject) {
    window.setTimeout(function () {
      reject({ code: 'frontend-timeout', message: _('Проверка обновлений превысила допустимое время.') });
    }, CHECK_TIMEOUT_MS);
  })]).then(function (results) {
    var failed = results && results.some ? results.some(function (r) { return r.status === 'rejected'; }) : false;
    if (failed) {
      var firstError = results.find(function (r) { return r.status === 'rejected'; });
      if (firstError) showError(ctx, firstError.reason);
      return false;
    }
    results.forEach(function (result) {
      var checkedAt = result && result.status === 'fulfilled' && result.value && result.value.checkedAt;
      if (checkedAt !== null && checkedAt !== undefined && checkedAt !== '')
        state.lastSuccessfulCheckAt = latestCanonicalTimestamp(state.lastSuccessfulCheckAt, checkedAt);
    });
    ctx.shell.showToast(_('Проверка обновлений завершена.'), 'ok');
    return true;
  }).catch(function (error) {
    showError(ctx, error);
  }).then(function () {
    state.skipEngineOperationStatus = true;
    state.componentOperation = null;
    rerender(ctx);
    return refresh(ctx);
  }).catch(function (error) {
    showError(ctx, error);
  });
}
function updateZ2K(ctx) {
  if (state.componentOperation) return;
  state.componentOperation = { kind: 'update', scope: 'z2k' };
  rerender(ctx);
  var payload = { bundleId: 'z2k-curated-lua', confirm: true };
  var promise = ctx.api.resources.update ? ctx.api.resources.update(JSON.stringify(payload)) : Promise.reject({ code: 'EINPUT', message: 'resources_update unavailable' });
  promise.then(function (answer) {
    if (!answer || answer.ok !== true) throw answer && answer.error || answer || new Error('update failed');
    var planned = answer.planned != null ? answer.planned : (answer.diagnostics && answer.diagnostics.planned);
    var applied = answer.applied != null ? answer.applied : (answer.diagnostics && answer.diagnostics.applied);
    if (planned == null && answer.diagnostics && answer.diagnostics.targetAssets) planned = answer.diagnostics.targetAssets.length;
    if (planned > 0 && applied === 0) {
      throw { code: 'EVERIFY', message: 'Обновление не применено: ' + planned + ' обновлений было запланировано, 0 установлено.' };
    }
    ctx.shell.showToast(_('Обновление применено.'), 'ok');
  }).catch(function (error) {
    showError(ctx, error);
  }).then(function () {
    state.componentOperation = null;
    rerender(ctx);
    return refresh(ctx);
  }).catch(function (error) {
    showError(ctx, error);
  });
}
function toggleEngine(ctx) {
  state.engineExpanded = !state.engineExpanded;
  if (state.engineExpanded) state.z2kExpanded = false;
  rerender(ctx);
}
function toggleZ2K(ctx) {
  state.z2kExpanded = !state.z2kExpanded;
  if (state.z2kExpanded) state.engineExpanded = false;
  rerender(ctx);
}
function renderHero(ctx, page) {
  var shell = ctx.shell;
  var lastCheckLabel = formatLastCheck(shell, page.checkedAt);
  var heroKind = heroStatusKind(page);
  var heroLabel = heroStatusLabel(page);
  var isReady = page.health.state === 'ready';
  return E('div', { 'class': 'z2m-components-hero' }, [
    E('div', { 'class': 'z2m-components-hero-main' }, [
      E('div', { 'class': 'z2m-components-hero-icon ' + heroKind }, Icons.wrappedNode(isReady ? 'shield-check' : 'activity', { size: 28, wrapperClass: 'z2m-hero-icon-wrap' })),
      E('div', { 'class': 'z2m-components-hero-info' }, [
        E('div', { 'class': 'z2m-components-hero-title' }, [
          E('strong', {}, _('Состояние системы')),
          E('span', { 'class': 'z2m-chip ' + heroKind }, heroLabel)
        ]),
        E('div', { 'class': 'z2m-components-hero-stats' }, [
          E('span', { 'class': 'z2m-components-hero-ready' }, page.health.ready + ' / ' + page.health.total + ' ' + _('обязательных компонента работают')),
          E('span', { 'class': 'z2m-dim' }, page.health.message),
          E('span', { 'class': 'z2m-components-hero-updates' }, updateSummary(page))
        ]),
        E('div', { 'class': 'z2m-components-hero-dots' }, page.components.map(function (c) {
          var kind = componentStateKind(c);
          return E('span', { 'class': 'z2m-hero-dot-row' }, [
            E('span', { 'class': 'z2m-dot ' + kind }),
            E('span', {}, c.label)
          ]);
        }))
      ])
    ]),
    E('div', { 'class': 'z2m-components-hero-meta' }, [
      E('span', { 'class': 'z2m-dim' }, _('Последняя проверка') + ': ' + lastCheckLabel),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Обновить состояние'), 'sm', refreshState.bind(null, ctx), !!state.componentOperation),
        shell.button(_('Проверить обновления'), 'primary sm', checkUpdates.bind(null, ctx, 'all'), !!state.componentOperation)
      ])
    ])
  ]);
}
function engineMetaRows(component, engineStatus) {
  var details = component.details || {};
  var installed = component.installed || {};
  var compatibility = component.compatibility && typeof component.compatibility === 'object' ? component.compatibility.state : component.compatibility;
  var rows = [];
  rows.push({ label: _('Установлено'), value: installed.version || _('Не установлен') });
  rows.push({ label: _('Служба'), value: details.serviceState ? (details.serviceState === 'running' ? _('Работает') : details.serviceState) : null });
  rows.push({ label: _('Совместимость'), value: compatibility === 'compatible' ? _('✓ Подтверждена') : compatibility === 'incompatible' ? _('Несовместим') : compatibility === 'review-required' ? _('Требуется проверка') : _('Не подтверждена') });
  if (component.updateState === 'update-available' && component.available && component.available.version)
    rows.push({ label: _('Доступная версия'), value: component.available.version });
  return rows.filter(function (r) { return r.value; });
}
function z2kMetaRows(component) {
  var rows = [];
  rows.push({ label: _('Установленный release'), value: z2kReleaseLabel(component) });
  if (component.counters && component.counters.lua) rows.push({ label: _('Lua'), value: component.counters.lua });
  rows.push({ label: _('Целостность'), value: (component.runtimeHealth || component.health) === 'ready' ? _('✓ Подтверждена') : _('Требует проверки') });
  var compatibility = component.compatibility && typeof component.compatibility === 'object' ? component.compatibility.state : component.compatibility;
  rows.push({ label: _('Совместимость'), value: compatibility === 'compatible' ? _('✓ Подтверждена') : compatibility === 'incompatible' ? _('Несовместим') : _('Не подтверждена') });
  if (component.updateState === 'update-available' && component.availableRelease)
    rows.push({ label: _('Доступный release'), value: component.availableRelease });
  return rows;
}
function z2kReleaseLabel(component) {
  var release = component.installedRelease || {};
  if (release.value) return release.value;
  return component.details && component.details.localInstalled === false ? _('Не установлен') : _('Не определён');
}
function z2kReviewReason(component) {
  var details = component.details || {};
  var reviewDetails = details.reviewDetails || [];
  var reasons = [];
  reviewDetails.forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var reason = item.message || item.reason || '';
    var path = item.path || '';
    if (reason && path) reasons.push(reason + ' (' + path + ')');
    else if (reason) reasons.push(reason);
    else if (path) reasons.push(path);
  });
  if (!reasons.length && component.reviews && component.reviews.length)
    reasons.push(_('Изменения в upstream-файлах требуют ручной semantic review: ') + component.reviews.join(', '));
  return reasons.join(' ');
}
function componentCompatibilityLabel(component) {
  var compatibility = component.compatibility && typeof component.compatibility === 'object' ? component.compatibility.state : component.compatibility;
  if (compatibility === 'compatible') return _('Подтверждена');
  if (compatibility === 'incompatible') return _('Несовместим');
  return _('Не подтверждена');
}
function engineServiceLabel(value) {
  if (value === 'running') return _('Работает');
  if (value === 'stopped') return _('Остановлен');
  if (value === 'paused') return _('Приостановлен');
  if (value === 'error') return _('Ошибка');
  return componentDisplay(value);
}
function renderEngineOperation(ctx, operation) {
  if (!operation) return null;
  return renderInlineOperation(ctx, { id: 'engine' }, {
    phase: operation.phase || _('Операция с движком…'),
    progress: typeof operation.progress === 'number' ? operation.progress : null,
    message: operation.message || ''
  });
}
function componentDisplay(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
function renderFactGrid(items) {
  return E('div', { 'class': 'z2m-component-fact-grid' }, items.filter(function (item) {
    return item.value !== null && item.value !== undefined && item.value !== '';
  }).map(function (item) {
    return E('div', { 'class': 'z2m-component-fact' }, [
      E('span', { 'class': 'z2m-dim' }, item.label),
      E('strong', {}, componentDisplay(item.value))
    ]);
  }));
}
function renderInfoRows(items) {
  return E('div', { 'class': 'z2m-component-info-rows' }, items.filter(function (item) {
    return item.value !== null && item.value !== undefined && item.value !== '';
  }).map(function (item) {
    return E('div', { 'class': 'z2m-component-info-row' }, [
      E('span', { 'class': 'z2m-dim' }, item.label),
      E('strong', {}, componentDisplay(item.value))
    ]);
  }));
}
function renderDetailSection(title, body, className) {
  return E('section', { 'class': 'z2m-component-detail-section ' + (className || '') }, [
    E('h4', {}, title),
    body
  ]);
}
function renderUpdateSection(ctx, options) {
  var shell = ctx.shell;
  var actions = options.actions || [];
  return renderDetailSection(options.title || _('Обновления'), E('div', {}, [
    E('div', { 'class': 'z2m-component-update-state' }, [
      E('span', { 'class': 'z2m-dim' }, _('Состояние')),
      E('strong', {}, options.stateLabel)
    ]),
    renderInfoRows(options.rows || []),
    actions.length ? E('div', { 'class': 'z2m-btnrow z2m-component-detail-actions' }, actions) : null
  ]), 'z2m-component-updates');
}
function renderReviewCallout(component) {
  if (component.updateState !== 'review-required' && !z2kReviewReason(component)) return null;
  return E('aside', { 'class': 'z2m-component-review-callout', role: 'status' }, [
    E('strong', {}, _('Требуется semantic review')),
    E('p', {}, z2kReviewReason(component) || _('Изменения требуют ручной проверки перед обновлением.'))
  ]);
}
function engineActionWithCheck(ctx, component, action, label) {
  var version = component.available && component.available.version || component.installed && component.installed.version;
  if (!version || !ctx.api.engine.check || !ctx.api.engine[action]) {
    showError(ctx, { message: _('Действие движка недоступно: отсутствует проверенный release.') });
    return;
  }
  if (state.componentOperation || state.busy) return;
  state.componentOperation = { kind: 'engine-' + action, scope: 'engine' };
  rerender(ctx);
  checkedResult(ctx.api.engine.check({ version: version, forceRefresh: true }), _('Проверка движка')).then(function (answer) {
    state.componentOperation = null;
    rerender(ctx);
    if (!answer.checkToken) throw { code: 'EINPUT', message: _('Проверка движка не вернула check token.') };
    confirmAction(ctx, label + '?', _('Будет изменён только официальный embedded runtime zapret2. Конфигурация и Strategy сохраняются.'), label, function () {
      mutation(ctx, 'engine-' + action, ctx.api.engine[action]({ version: version, checkToken: answer.checkToken })).then(function (result) {
        if (result) return refresh(ctx);
      });
    });
  }).catch(function (error) {
    state.componentOperation = null;
    rerender(ctx);
    showError(ctx, error);
  });
}
function renderEngineDetails(ctx, component, engineStatus) {
  var shell = ctx.shell;
  var status = object(engineStatus);
  var details = component.details || {};
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var installed = component.installed && component.installed.version || _('Не установлен');
  var available = component.available && component.available.version || _('Не определена');
  var updateLabel = component.updatePresentation && component.updatePresentation.label || UpdatePresentation.describe(component.updateState).label;
  var source = details.source || status.upstream || 'bol-van/zapret2';
  return E('section', { 'class': 'z2m-component-details z2m-component-details--engine', 'data-component-details': 'engine' }, [
    E('div', { 'class': 'z2m-component-details-head' }, [
      E('div', { 'class': 'z2m-component-details-heading' }, [
        E('span', { 'class': 'z2m-component-details-kicker' }, _('УПРАВЛЕНИЕ ДВИЖКОМ')),
        E('div', { 'class': 'z2m-component-details-title' }, [
          E('h3', {}, component.label),
          E('span', { 'class': 'z2m-chip ' + componentStateKind(component) }, componentStateLabel(component))
        ]),
        E('p', { 'class': 'z2m-dim' }, component.summary)
      ]),
      E('div', { 'class': 'z2m-component-details-source' }, [
        E('span', { 'class': 'z2m-dim' }, _('Источник')),
        E('strong', { translate: 'no' }, source)
      ])
    ]),
    renderFactGrid([
      { label: _('Статус'), value: componentStateLabel(component) },
      { label: _('Установленный release'), value: installed },
      { label: _('Служба'), value: engineServiceLabel(details.serviceState || status.serviceState) },
      { label: _('Совместимость'), value: componentCompatibilityLabel(component) }
    ]),
    renderUpdateSection(ctx, {
      stateLabel: updateLabel,
      rows: [
        { label: _('Установленная версия'), value: installed },
        { label: _('Доступная версия'), value: available },
        { label: _('Последняя проверка'), value: formatLastCheck(shell, component.checkedAt) }
      ],
      actions: [hasUpdate
        ? shell.button(_('Обновить'), 'primary sm', engineActionWithCheck.bind(null, ctx, component, 'update', _('Обновить')), !!state.componentOperation)
        : shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'engine'), !!state.componentOperation)]
    }),
    renderDetailSection(_('Управление службой'), E('div', {}, [
      E('p', { 'class': 'z2m-dim' }, isReady ? _('Перезапуск применяет текущую конфигурацию без изменения release.') : _('Служба недоступна; сначала восстановите установленный release.')),
      E('div', { 'class': 'z2m-btnrow z2m-component-detail-actions' }, [
        shell.button(_('Перезапустить'), 'sm', function () { mutation(ctx, 'engine-restart', ctx.api.service.restart()).then(function (result) { if (result) return refresh(ctx); }); }, !!state.busy || !isReady),
        component.installed && component.installed.version ? shell.button(_('Переустановить'), 'sm', engineActionWithCheck.bind(null, ctx, component, 'reinstall', _('Переустановить')), !!state.componentOperation) : null
      ])
    ]), 'z2m-component-service-management'),
    E('details', { 'class': 'z2m-component-technical' }, [
      E('summary', {}, _('Технические детали')),
      renderInfoRows([
        { label: _('Версия пакета'), value: status.packageVersion },
        { label: _('Engine state release'), value: status.installedRelease },
        { label: _('Сборка runtime'), value: status.runtimeBuild },
        { label: _('Архитектура'), value: status.architecture },
        { label: _('Автозапуск'), value: details.autostart === true ? _('Включён') : details.autostart === false ? _('Выключен') : null },
        { label: _('Origin state'), value: status.installedOrigin },
        { label: _('Capabilities'), value: component.counters && component.counters.capabilities }
      ])
    ]),
    E('details', { 'class': 'z2m-component-danger-zone' }, [
      E('summary', {}, _('Опасная зона')),
      E('p', { 'class': 'z2m-dim' }, _('Удаление затрагивает только embedded runtime zapret2. Конфигурация и Strategy сохраняются.')),
      shell.button(_('Удалить движок'), 'danger sm', function () {
        confirmAction(ctx, _('Удалить движок?'), _('Будет удалён только движок, конфигурация сохранится.'), _('Удалить'), function () {
          mutation(ctx, 'engine-uninstall', ctx.api.engine.uninstall({ confirm: 'REMOVE', preserveConfig: true })).then(function (result) { if (result) return refresh(ctx); });
        });
      }, !!state.busy)
    ])
  ]);
}
function renderZ2KDetails(ctx, component) {
  var shell = ctx.shell;
  var details = component.details || {};
  var provenance = component.provenance || details.provenance || {};
  var manifest = details.manifest || {};
  var localRevision = provenance.sourceCommit || provenance.commit;
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var updateLabel = component.updatePresentation && component.updatePresentation.label || UpdatePresentation.describe(component.updateState).label;
  var reviewReason = z2kReviewReason(component);
  var reviewDetails = details.reviewDetails || [];
  var reviewPaths = reviewDetails.map(function (item) { return item && item.path; }).filter(Boolean).join(', ');
  var manifestHash = manifest.sha256 || manifest.contentSha256 || manifest.hash;
  var localHash = provenance.sha256 || provenance.contentSha256 || provenance.hash;
  return E('section', { 'class': 'z2m-component-details z2m-component-details--z2k', 'data-component-details': 'z2k-core' }, [
    E('div', { 'class': 'z2m-component-details-head' }, [
      E('div', { 'class': 'z2m-component-details-heading' }, [
        E('span', { 'class': 'z2m-component-details-kicker' }, _('УПРАВЛЕНИЕ РЕСУРСАМИ')),
        E('div', { 'class': 'z2m-component-details-title' }, [
          E('h3', {}, component.label),
          E('span', { 'class': 'z2m-chip ' + componentStateKind(component) }, componentStateLabel(component))
        ]),
        E('p', { 'class': 'z2m-dim' }, component.summary)
      ]),
      E('div', { 'class': 'z2m-component-details-source' }, [
        E('span', { 'class': 'z2m-dim' }, _('Источник')),
        E('strong', { translate: 'no' }, provenance.source || 'necronicle/z2k')
      ])
    ]),
    renderFactGrid([
      { label: _('Lua assets'), value: component.counters && component.counters.lua },
      { label: _('Целостность'), value: isReady ? _('Подтверждена') : _('Требует проверки') },
      { label: _('Совместимость'), value: componentCompatibilityLabel(component) },
      { label: _('Установленный release'), value: z2kReleaseLabel(component) }
    ]),
    renderUpdateSection(ctx, {
      stateLabel: updateLabel,
      rows: [
        { label: _('Установленный release'), value: z2kReleaseLabel(component) },
        { label: _('Доступный release'), value: component.availableRelease || _('Нет данных') },
        { label: _('Локальная revision'), value: localRevision || _('Не определена') },
        { label: _('Последняя проверка'), value: formatLastCheck(shell, component.checkedAt) }
      ],
      actions: [hasUpdate
        ? shell.button(_('Обновить'), 'primary sm', updateZ2K.bind(null, ctx), isBusyFor('z2k-core'))
        : shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core'))]
    }),
    renderReviewCallout(component),
    E('details', { 'class': 'z2m-component-technical' }, [
      E('summary', {}, _('Технические детали')),
      renderInfoRows([
        { label: _('Provenance'), value: provenance.source },
        { label: _('Source commit'), value: localRevision },
        { label: _('Trust mode'), value: details.trustMode },
        { label: _('Manifest revision'), value: manifest.current },
        { label: _('Manifest hash'), value: manifestHash },
        { label: _('Local asset hash'), value: localHash },
        { label: _('Проверяемые пути'), value: reviewPaths },
        { label: _('Причина проверки'), value: reviewReason },
        { label: _('Rebase'), value: component.rebases && component.rebases.length ? component.rebases.join(', ') : null }
      ])
    ])
  ]);
}
function renderInlineOperation(ctx, component, opts) {
  var shell = ctx.shell;
  opts = opts || {};
  var op = state.componentOperation;
  var isBusy = component && component.id ? isBusyFor(component.id) : !!op;
  var hasOp = isBusy || opts.phase;
  if (!hasOp) return null;
  var phase = opts.phase || (isBusy ? operationPhase(op) : '');
  var progress = opts.progress;
  var message = opts.message || (isBusy ? operationMessage(op) : '');
  var cancellable = opts.cancellable === true;
  var bar = null;
  if (progress !== null && progress !== undefined && typeof progress === 'number') {
    bar = E('div', { 'class': 'z2m-op-progress' }, [
      E('div', { 'class': 'z2m-op-progress-bar', style: 'width:' + Math.max(0, Math.min(100, progress)) + '%' })
    ]);
  } else if (isBusy) {
    bar = E('div', { 'class': 'z2m-op-progress z2m-op-progress--indeterminate' }, [
      E('div', { 'class': 'z2m-op-progress-bar' })
    ]);
  }
  var stages = opts.stages || [];
  var stagesEl = stages.length ? E('div', { 'class': 'z2m-op-stages' }, stages.map(function (s) {
    var st = s.state || 'pending';
    var icon = st === 'done' ? '✓' : st === 'running' ? '●' : st === 'error' ? '✕' : '○';
    var cls = 'z2m-op-stage--' + st;
    return E('div', { 'class': 'z2m-op-stage ' + cls }, [
      E('span', { 'class': 'z2m-op-stage-icon' }, icon),
      E('span', {}, s.label + (s.detail ? ' — ' + s.detail : ''))
    ]);
  })) : null;
  return E('div', { 'class': 'z2m-component-operation' }, [
    E('div', { 'class': 'z2m-op-header' }, [
      E('strong', {}, phase || _('Обновление…')),
      progress !== null && progress !== undefined ? E('span', { 'class': 'z2m-op-progress-text' }, progress + '%') : null,
      cancellable ? shell.button(_('Отменить'), 'sm', function () {
        if (opts.onCancel) opts.onCancel();
      }, false) : null
    ]),
    bar,
    message ? E('div', { 'class': 'z2m-op-message' }, message) : null,
    stagesEl
  ]);
}
function renderEngineCard(ctx, component, engineStatus, engineValue) {
  // componentOperation scope z2k via isBusyFor
  var shell = ctx.shell;
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = engineMetaRows(component, engineStatus);
  // Contextual actions
  var primaryActions = [];
  if (hasUpdate) {
    primaryActions.push(shell.button(_('Обновить'), 'primary sm', engineActionWithCheck.bind(null, ctx, component, 'update', _('Обновить')), !!state.componentOperation));
  } else if (isReady) {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'engine'), isBusyFor('engine')));
  } else {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'engine'), isBusyFor('engine')));
  }
  var manageBtn = E('button', { 'class': 'z2m-btn sm' + (state.engineExpanded ? ' on' : ''), click: toggleEngine.bind(null, ctx), 'aria-expanded': state.engineExpanded ? 'true' : 'false' }, [
    _('Управление'), E('span', { 'class': 'z2m-btn-chevron' }, Icons.html(state.engineExpanded ? 'chevronUp' : 'chevronDown', { size: 12 }))
  ]);
  return E('article', { 'class': 'z2m-component-card z2m-component-card--engine ' + component.health, 'data-component': component.id }, [
    E('div', { 'class': 'z2m-component-card-head' }, [
      E('div', { 'class': 'z2m-component-card-icon' }, Icons.wrappedNode('cpu', { size: 20, wrapperClass: 'z2m-card-icon-wrap' })),
      E('div', { 'class': 'z2m-component-card-title' }, [
        E('h3', {}, component.label),
        E('p', { 'class': 'z2m-dim' }, component.summary)
      ]),
      E('span', { 'class': 'z2m-chip ' + chipKind }, chipLabel)
    ]),
    E('div', { 'class': 'z2m-component-card-meta' }, metaRows.map(function (row) {
      return E('div', { 'class': 'z2m-component-meta-row' }, [
        E('span', { 'class': 'z2m-dim' }, row.label),
        E('strong', {}, row.value)
      ]);
    })),
    E('div', { 'class': 'z2m-component-card-actions' }, [
      E('div', { 'class': 'z2m-btnrow' }, primaryActions),
      E('div', { 'class': 'z2m-btnrow' }, [manageBtn])
    ]),
    renderInlineOperation(ctx, component, isBusyFor(component.id) ? { phase: operationPhase(state.componentOperation), message: operationMessage(state.componentOperation) } : {}),
    renderEngineOperation(ctx, state.engineOperation),
    component.details && component.details.rebases && component.details.rebases.length ? E('p', { 'class': 'z2m-dim' }, _('Требуются rebase/review перед обновлением.')) : null
  ]);
}
function renderZ2KCard(ctx, component) {
  var shell = ctx.shell;
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var needsIntegration = ['integration-required', 'review-required', 'rebase-required'].indexOf(component.updateState) >= 0;
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = z2kMetaRows(component);
  var primaryActions = [];
  if (hasUpdate) {
    primaryActions.push(shell.button(_('Обновить'), 'primary sm', updateZ2K.bind(null, ctx), isBusyFor('z2k-core')));
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core')));
  } else if (component.updateState === 'review-required') {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core')));
  } else if (needsIntegration) {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core')));
  } else {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core')));
  }
  var detailsBtn = E('button', { 'class': 'z2m-btn sm' + (state.z2kExpanded ? ' on' : ''), click: toggleZ2K.bind(null, ctx), 'aria-expanded': state.z2kExpanded ? 'true' : 'false' }, [
    _('Подробнее'), E('span', { 'class': 'z2m-btn-chevron' }, Icons.html(state.z2kExpanded ? 'chevronUp' : 'chevronDown', { size: 12 }))
  ]);
  return E('article', { 'class': 'z2m-component-card z2m-component-card--z2k ' + component.health, 'data-component': component.id }, [
    E('div', { 'class': 'z2m-component-card-head' }, [
      E('div', { 'class': 'z2m-component-card-icon' }, Icons.wrappedNode('workflow', { size: 20, wrapperClass: 'z2m-card-icon-wrap' })),
      E('div', { 'class': 'z2m-component-card-title' }, [
        E('h3', {}, component.label),
        E('p', { 'class': 'z2m-dim' }, _('Runtime-assets и расширения Zapret2'))
      ]),
      E('span', { 'class': 'z2m-chip ' + chipKind }, chipLabel)
    ]),
    E('div', { 'class': 'z2m-component-card-meta' }, metaRows.map(function (row) {
      return E('div', { 'class': 'z2m-component-meta-row' }, [
        E('span', { 'class': 'z2m-dim' }, row.label),
        E('strong', {}, row.value)
      ]);
    })),
    E('div', { 'class': 'z2m-component-card-actions' }, [
      E('div', { 'class': 'z2m-btnrow' }, primaryActions),
      E('div', { 'class': 'z2m-btnrow' }, [detailsBtn])
    ]),
    renderInlineOperation(ctx, component, isBusyFor(component.id) ? { phase: operationPhase(state.componentOperation), message: operationMessage(state.componentOperation) } : {}),
  ]);
}
function renderOptionalCard(ctx, opts) {
  var shell = ctx.shell;
  var icon = opts.icon || 'help';
  var statusKind = opts.statusKind || 'o';
  var statusLabel = opts.statusLabel || _('Не установлен');
  var actions = opts.actions || [];
  return E('article', { 'class': 'z2m-component-card z2m-component-card--optional ' + (opts.health || ''), 'data-component': opts.id }, [
    E('div', { 'class': 'z2m-component-card-head' }, [
      E('div', { 'class': 'z2m-component-card-icon' }, Icons.wrappedNode(icon, { size: 20, wrapperClass: 'z2m-card-icon-wrap' })),
      E('div', { 'class': 'z2m-component-card-title' }, [
        E('h3', {}, opts.title),
        E('p', { 'class': 'z2m-dim' }, opts.description)
      ]),
      E('span', { 'class': 'z2m-chip ' + statusKind }, statusLabel)
    ]),
    opts.meta && opts.meta.length ? E('div', { 'class': 'z2m-component-card-meta' }, opts.meta.map(function (row) {
      return E('div', { 'class': 'z2m-component-meta-row' }, [
        E('span', { 'class': 'z2m-dim' }, row.label),
        E('strong', {}, row.value)
      ]);
    })) : null,
    E('div', { 'class': 'z2m-component-card-actions' }, [
      E('div', { 'class': 'z2m-btnrow' }, actions)
    ])
  ]);
}
function renderComponents(ctx, data) {
  var shell = ctx.shell;
  var payload = data.components || {};
  var engineValue = payload.engine && payload.engine.value || [];
  var engineStatus = engineValue[1] || {};
  var tgRaw = payload.telegram && payload.telegram.value || {};
  // Handle envelope error case: if telegram load failed, keep tgRaw as {error} for unknown state
  if (payload.telegram && payload.telegram.error) tgRaw = { error: payload.telegram.error, ok: false };
  var tgState = telegramCardState(tgRaw);
  var isTgInstalled = tgState.status === 'ok' || tgState.status === 'degraded' || (tgState.status === 'off' && tgState.label === 'Остановлен');
  var tgActions = [];
  if (tgState.status === 'ok') {
    tgActions.push(shell.button(_('Проверить обновления'), 'sm', function () { checkUpdates(ctx); }, !!state.componentOperation));
    tgActions.push(E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn sm' }, _('Управление →')));
  } else if (tgState.label === 'Остановлен') {
    tgActions.push(E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn sm' }, _('Управление →')));
  } else if (tgState.status === 'degraded') {
    tgActions.push(E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn sm' }, _('Управление →')));
  } else if (tgState.status === 'unknown') {
    tgActions.push(E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn sm' }, _('Подробнее →')));
  } else {
    tgActions.push(E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn sm' }, _('Настроить →')));
  }
  var page = ComponentsModel.normalizePage({
    versions: payload.versions && payload.versions.value || {},
    engine: { status: engineStatus, catalog: engineValue[0] || {} },
    z2k: payload.resources && payload.resources.value && payload.resources.value.z2k || {},
    checkedAt: latestCanonicalTimestamp(
      payload.resources && payload.resources.value && payload.resources.value.checkedAt,
      state.lastSuccessfulCheckAt
    )
  });
  state.engineOperation = engineValue[2] && engineValue[2].operation || null;
  var engineComp = page.components.find(function (c) { return c.id === 'engine'; });
  var z2kComp = page.components.find(function (c) { return c.id === 'z2k-core'; });
  var hero = renderHero(ctx, page);
  var summaryText = mandatorySummary(page);
  return E('div', { 'class': 'z2m-components-page' }, [
    hero,
    E('section', { 'class': 'z2m-components-section' }, [
      E('div', { 'class': 'z2m-components-section-head' }, [
        E('h2', {}, _('ОБЯЗАТЕЛЬНЫЕ КОМПОНЕНТЫ')),
        E('span', { 'class': 'z2m-dim' }, summaryText)
      ]),
      E('div', { 'class': 'z2m-components-grid' }, [
        renderEngineCard(ctx, engineComp, engineStatus, engineValue),
        renderZ2KCard(ctx, z2kComp)
      ]),
      state.engineExpanded ? renderEngineDetails(ctx, engineComp, engineStatus)
        : state.z2kExpanded ? renderZ2KDetails(ctx, z2kComp) : null
    ]),
    E('section', { 'class': 'z2m-components-section z2m-components-section--optional' }, [
      E('div', { 'class': 'z2m-components-section-head' }, [
        E('h2', {}, _('ДОПОЛНИТЕЛЬНЫЕ КОМПОНЕНТЫ')),
        E('span', { 'class': 'z2m-dim' }, _('Не влияют на готовность основной системы'))
      ]),
      E('div', { 'class': 'z2m-components-grid' }, [
        renderOptionalCard(ctx, {
          id: 'telegram-proxy',
          icon: 'service:telegram',
          title: _('Telegram Proxy'),
          description: _('Дополнительный Telegram WebSocket Proxy. Установка не требуется для основной работы Z2M.'),
          statusKind: tgState.kind,
          statusLabel: tgState.label,
          health: 'optional',
          meta: tgState.meta,
          actions: tgActions
        }),
        renderOptionalCard(ctx, {
          id: 'warp',
          icon: 'shield',
          title: _('WARP / MASQUE'),
          description: _('Backend provider пока не подключён.'),
          statusKind: kindForLabel(_('Недоступен')),
          statusLabel: _('Недоступен'),
          health: 'optional',
          meta: [],
          actions: [E('a', { href: '#/warp', 'class': 'z2m-btn sm' }, _('Подробнее →'))]
        })
      ])
    ]),
    E('section', { 'class': 'z2m-components-section z2m-components-section--advanced' }, [
      E('div', { 'class': 'z2m-components-section-head' }, [
        E('h2', {}, _('ДОПОЛНИТЕЛЬНО')),
        E('span', { 'class': 'z2m-dim' }, '')
      ]),
      E('div', { 'class': 'z2m-advanced-block' }, (function() {
        var ui = object(ctx.store.get().ui || {});
        var advanced = ui.advanced === true;
        var toggle = ctx.shell.switchControl({
          checked: advanced,
          label: _('Расширенный режим интерфейса'),
          onChange: function (enabled) {
            ctx.store.update({ ui: Object.assign({}, ctx.store.get().ui || {}, { advanced: enabled }) });
            ctx.rerender();
          }
        });
        return E('div', { 'class': 'z2m-advanced-row' }, [
          E('div', {}, [
            E('strong', {}, _('Расширенный режим')),
            E('p', { 'class': 'z2m-dim' }, _('Показывать технические данные и диагностические поля.'))
          ]),
          toggle
        ]);
      })())
    ])
  ]);
}

function renderEngine(ctx, data) {
  var envelope = data.engine || {};
  if (envelope.error) return ctx.shell.statePanel({
    title: _('Установщик движка недоступен'),
    message: envelope.error.message,
    kind: 'error'
  });
  return EnginePanel.render(ctx, envelope.value || {});
}

function previewBackup(ctx, record) {
  state.verification = null;
  mutation(ctx, 'backup-preview', edit(ctx.api.maintenance.backupPreview, {
    scope: record.scope,
    takenAt: record.takenAt
  })).then(function (answer) {
    if (!answer) return;
    state.preview = answer;
    state.previewModel = MaintenanceModel.restorePreview(answer);
    rerender(ctx);
  });
}
function deleteBackup(ctx, record) {
  confirmAction(ctx, _('Удалить резервную копию?'),
    (SCOPE_LABELS[record.scope] || record.scope) + ' · ' + formatTime(ctx.shell, record.takenAt),
    _('Удалить'), function () {
      mutation(ctx, 'backup-delete', edit(ctx.api.maintenance.backupDelete, {
        scope: record.scope,
        takenAt: record.takenAt
      })).then(function (answer) {
        if (!answer) return;
        state.preview = null;
        state.previewModel = null;
        ctx.shell.showToast(_('Резервная копия удалена.'), 'ok');
        refresh(ctx);
      });
    });
}
function restoreBackup(ctx) {
  var preview = state.previewModel;
  if (!preview) return;
  confirmAction(ctx, _('Восстановить резервную копию?'),
    _('Сервер сначала проверит идентификатор и ревизию предпросмотра, сохранит текущее состояние, выполнит восстановление и повторно прочитает каждый файл.'),
    _('Восстановить'), function () {
      var request = MaintenanceModel.restoreRequest(preview, true);
      if (!request.ok) {
        ctx.shell.showToast(_('Восстановление заблокировано: ') + request.reason, 'err');
        return;
      }
      mutation(ctx, 'backup-restore', edit(ctx.api.maintenance.backupRestore, request.edit)).then(function (answer) {
        if (!answer) return;
        state.verification = MaintenanceModel.verifyRestore(answer);
        if (state.verification.verified) {
          ctx.shell.showToast(_('Резервная копия восстановлена и проверена.'), 'ok');
          state.preview = null;
          state.previewModel = null;
          refresh(ctx);
        } else {
          rerender(ctx);
        }
      });
    });
}
function renderPreview(ctx) {
  var shell = ctx.shell;
  var preview = state.previewModel;
  if (!preview) return null;
  var sections = preview.sections.map(function (section) {
    return E('section', { 'class': 'z2m-draft-preview' }, [
      E('h4', {}, section.label),
      E('div', { 'class': 'z2m-change-list' }, section.items.map(function (item) {
        return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, E('div', { 'class': 'nm' }, item));
      }))
    ]);
  });
  var metadata = [
    { label: _('Область'), value: preview.scope || '' },
    { label: _('Время'), value: formatTime(shell, preview.takenAt) },
    { label: _('Целостность'), value: preview.integrity || '' },
    { label: _('Проверка версии'), value: preview.versionGate || '' }
  ].filter(function (row) { return row.value; });
  var restore = shell.button(_('Восстановить копию'), 'danger', restoreBackup.bind(null, ctx),
    !preview.allowed || !!state.busy);
  return E('section', { 'class': 'z2m-panel', id: 'z2m-backup-preview' }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Восстановление резервной копии')), E('div', { 'class': 'sp' }, restore)]),
    E('div', { 'class': 'bd' }, [
      preview.blocker ? shell.statePanel({ title: _('Восстановление заблокировано'), message: preview.blocker, kind: 'error' }) : null,
      metadata.length ? kvPanel(shell, metadata) : null,
      sections.length ? E('div', {}, sections) : shell.statePanel({ message: preview.primaryText, kind: 'info' }),
      state.verification && !state.verification.verified
        ? shell.statePanel({ title: _('Проверка восстановления не подтверждена'), message: state.verification.message, kind: 'error' }) : null
    ])
  ]);
}
function renderBackups(ctx, data) {
  var shell = ctx.shell;
  var records = MaintenanceModel.backups(data.backups && data.backups.value || {}, 100);
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  var scopeSelect = E('select', { id: 'z2m-backup-scope', 'aria-label': _('Область резервной копии') }, [
  ].concat(SCOPES.map(function (scope) {
    return E('option', { value: scope }, SCOPE_LABELS[scope]);
  })));
  function create(scope) {
    mutation(ctx, 'backup-create', edit(ctx.api.maintenance.backupCreate, {
      scope: scope || scopeSelect.value
    })).then(function (answer) {
      if (!answer) return;
      shell.showToast(_('Резервная копия создана.'), 'ok');
      refresh(ctx);
    });
  }
  var createAllButton = shell.button(_('Создать полную копию'), 'primary', function () { create('all'); }, !!state.busy);
  var createScopedButton = shell.button(_('Создать выбранную область'), 'sm', function () { create(scopeSelect.value); }, !!state.busy);
  var visibleRecords = state.showAllBackups ? records : records.slice(0, 5);
  var rows = visibleRecords.map(function (record) {
    var label = SCOPE_LABELS[record.scope] || (record.scope === 'all' ? _('Полная резервная копия') : record.scope);
    return E('div', { 'class': 'z2m-backup-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, label),
        E('div', { 'class': 'co' }, formatTime(shell, record.takenAt)),
        (advanced && record.manifestSha256) ? E('div', { 'class': 'z2m-tech' }, 'SHA-256: ' + record.manifestSha256.slice(0, 8) + '...') : null
      ]),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Восстановить'), 'sm', previewBackup.bind(null, ctx, record), !!state.busy),
        shell.button(_('Удалить'), 'danger sm', deleteBackup.bind(null, ctx, record), !!state.busy)
      ])
    ]);
  });
  var toggleButton = null;
  if (records.length > 5) {
    toggleButton = state.showAllBackups
      ? shell.button(_('Скрыть старые'), 'sm', function () { state.showAllBackups = false; rerender(ctx); }, false)
      : shell.button(_('Показать все (' + records.length + ')'), 'sm', function () { state.showAllBackups = true; rerender(ctx); }, false);
  }
  return E('div', {}, [
    shell.panel(_('Создать резервную копию'), E('div', {}, [
      E('p', { 'class': 'z2m-dim' }, _('Сохранит всё состояние Zapret2 Manager.')),
      E('div', { 'class': 'z2m-btnrow' }, [createAllButton]),
      E('details', { 'class': 'z2m-acc z2m-backup-advanced' }, [
        E('summary', {}, _('Дополнительно')),
        E('div', { 'class': 'z2m-btnrow' }, [scopeSelect, createScopedButton])
      ])
    ])),
    E('div', {}, [
      E('div', { 'class': 'z2m-backup-history' }, rows.length ? rows : [
        shell.statePanel({ message: _('История резервных копий пуста.'), kind: 'info' })
      ]),
      toggleButton ? E('div', { 'class': 'z2m-btnrow', style: 'margin-top:10px;justify-content:center' }, [toggleButton]) : null
    ]),
    renderPreview(ctx)
  ]);
}

function renderSettings(ctx, data) {
  var shell = ctx.shell;
  var ui = object(data.settings && data.settings.value && data.settings.value.ui);
  var advanced = ui.advanced === true;
  var toggle = shell.switchControl({
    checked: advanced,
    label: _('Расширенный режим интерфейса'),
    onChange: function (enabled) {
      ctx.store.update({ ui: Object.assign({}, ctx.store.get().ui || {}, { advanced: enabled }) });
      ctx.rerender();
    }
  });
  return E('div', {}, [
    shell.panel(_('Настройки менеджера'), E('div', { 'class': 'z2m-setting-row' }, [
      E('div', {}, [E('strong', {}, _('Расширенный режим')), E('p', { 'class': 'z2m-dim' }, _('Показывает технические детали и диагностические поля в существующих экранах.'))]),
      toggle
    ]))
  ]);
}

function render(ctx) {
  var data = ctx.data || {};
  var pane = activePane(ctx);
  var meta = PANE_META[pane] || PANE_META.updates;
  var paneBody = pane === 'backups' ? renderBackups(ctx, data)
    : pane === 'settings' ? renderSettings(ctx, data)
    : renderComponents(ctx, data);
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Не удалось загрузить данные'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-system' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, [Icons.wrappedNode(pane === 'components' ? 'cpu' : pane === 'backups' ? 'archive' : 'settings', { size: 20, wrapperClass: 'z2m-system-page-icon' }), E('span', {}, meta.title)]), E('p', {}, meta.subtitle)])
    ]),
    errors.length ? E('div', {}, errors) : null,
    paneBody
  ]);
}
function mount(ctx) {
  if (activePane(ctx) !== 'components' || !ctx.api.engine || !ctx.api.engine.operationStatus) return;
  if (state.engineOperationTimer) window.clearInterval(state.engineOperationTimer);
  state.engineOperationTimer = window.setInterval(function () {
    var operation = state.engineOperation;
    if (!operation || engineOperationTerminal(operation) || state.engineOperationPolling) return;
    state.engineOperationPolling = true;
    ctx.api.engine.operationStatus({ id: operation.id }).then(function (answer) {
      state.engineOperation = answer && answer.operation || null;
      state.engineOperationPolling = false;
      if (state.engineOperation && engineOperationTerminal(state.engineOperation)) {
        state.skipEngineOperationStatus = true;
        return refresh(ctx);
      }
      rerender(ctx);
    }).catch(function () {
      state.engineOperationPolling = false;
    });
  }, 1500);
}
function unmount(ctx) {
  if (state.engineOperationTimer) window.clearInterval(state.engineOperationTimer);
  state.engineOperationTimer = null;
  state.engineOperationPolling = false;
  if (ctx && ctx.enginePanelContext && ctx.enginePanelContext.engineState)
    EnginePanel.unmount(ctx.enginePanelContext);
}

return baseclass.extend({
  id: 'system',
  title: _('Система'),
  subtitle: _('Версии, движок, резервные копии и настройки'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
