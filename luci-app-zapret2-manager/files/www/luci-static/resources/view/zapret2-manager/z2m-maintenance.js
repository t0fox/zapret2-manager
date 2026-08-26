'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';
'require view.zapret2-manager.z2m-components-model as ComponentsModel';

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
  componentBusy: false,
  engineExpanded: false,
  z2kExpanded: false,
  showAllBackups: false
};

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
  if (pane === 'components') promise = Promise.allSettled([
    boundedLoad(ctx.api.maintenance.versions(), 'manager versions'),
    boundedLoad(EnginePanel.load(ctx), 'engine status'),
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
  return E('div', { 'class': 'z2m-proxy-kv' }, rows.map(function (row) {
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
function componentStateLabel(component) {
  // Unified per-component labels — Engine: Работает, Z2K: Актуален — with canonical severity precedence
  // Priority: broken/error/incompatible > integration/review/update/degraded > healthy/current > unknown/off
  if (component.id === 'engine') {
    if (component.health === 'missing') return _('Не установлен');
    if (component.health === 'broken') return _('Ошибка');
    if (component.compatibility === 'incompatible') return _('Несовместим');
    if (component.health === 'checking') return _('Проверяется');
    var svc = component.details && component.details.serviceState;
    if (svc === 'paused') return _('Приостановлен');
    if (svc === 'stopped') return _('Остановлен');
    if (component.health === 'degraded') return _('Требует внимания');
    if (component.updateState === 'integration-required') return _('Требует внимания');
    if (component.updateState === 'update-available') return _('Доступно обновление');
    // Healthy installed+running+compatible => Работает (green)
    return _('Работает');
  }
  if (component.id === 'z2k-core') {
    if (component.health === 'missing') {
      return component.summary && String(component.summary).indexOf('Engine') >=0 ? _('Требуется Zapret2 Engine') : _('Не установлен');
    }
    if (component.health === 'broken') return _('Ошибка');
    if (component.compatibility === 'incompatible') return _('Несовместим');
    if (component.health === 'checking') return _('Проверяется');
    if (component.updateState === 'integration-required') return _('Требует внимания');
    if (component.updateState === 'update-available') return _('Доступно обновление');
    if (component.health === 'ready' && component.updateState === 'current' && component.compatibility === 'compatible') return _('Актуален');
    if (component.health === 'ready') {
      if (component.updateState === 'unknown') return _('Работает');
      return _('Актуален');
    }
    return _('Требует внимания');
  }
  var health = component.health;
  if (health === 'missing') return _('Не установлен');
  if (health === 'broken') return _('Ошибка');
  if (health === 'checking') return _('Проверяется');
  if (component.updateState === 'integration-required') return _('Требует внимания');
  if (component.updateState === 'update-available') return _('Доступно обновление');
  if (component.compatibility === 'incompatible') return _('Несовместим');
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
  var attention = page.components.filter(function (c) { return c.health === 'broken' || c.health === 'degraded' || c.compatibility === 'incompatible'; }).length;
  // Build dynamic counter like "2 работают · 1 обновление"
  var parts = [];
  if (ready === total && total > 0) parts.push(ready + ' ' + (ready === 1 ? _('работает') : _('работают')));
  else if (ready === 1) parts.push('1 ' + _('работает') + ' · ' + (total - 1) + ' ' + _('требует внимания'));
  else if (ready > 0) parts.push(ready + ' ' + _('работают') + ' · ' + (total - ready) + ' ' + _('требует внимания'));
  else parts.push(_('требуют внимания'));
  if (updates > 0) parts.push(updates === 1 ? _('1 обновление') : updates + ' ' + _('обновления'));
  return parts.join(' · ');
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
  if (state.componentBusy) return;
  state.componentBusy = true;
  rerender(ctx);
  // Обновить состояние — только локальный refresh, без сетевых проверок
  refresh(ctx).then(function () {
    state.componentBusy = false;
    rerender(ctx);
  }).catch(function (error) {
    state.componentBusy = false;
    showError(ctx, error);
    rerender(ctx);
  });
}
function checkUpdates(ctx) {
  if (state.componentBusy) return;
  state.componentBusy = true;
  rerender(ctx);
  Promise.allSettled([
    ctx.api.resources.check(),
    ctx.api.engine.status(),
    ctx.api.engine.gateStatus ? ctx.api.engine.gateStatus() : Promise.resolve({})
  ]).then(function (results) {
    state.componentBusy = false;
    var failed = results.some(function (r) { return r.status === 'rejected'; });
    if (failed) {
      var firstError = results.find(function (r) { return r.status === 'rejected'; });
      if (firstError) showError(ctx, firstError.reason);
    }
    return refresh(ctx);
  }).catch(function (error) {
    state.componentBusy = false;
    showError(ctx, error);
    rerender(ctx);
  });
}
function updateZ2K(ctx) {
  if (state.componentBusy) return;
  state.componentBusy = true;
  rerender(ctx);
  var payload = { bundleId: 'z2k-curated-lua', confirm: true };
  // Canonical Z2K update flow: bundle-based via resources_update, not z2k-runtime
  var promise = ctx.api.resources.update ? ctx.api.resources.update(JSON.stringify(payload)) : Promise.reject({ code: 'EINPUT', message: 'resources_update unavailable' });
  promise.then(function (answer) {
    state.componentBusy = false;
    if (!answer || answer.ok !== true) throw answer && answer.error || answer || new Error('update failed');
    // Invariant: planned>0 && applied==0 => FAILED, not SUCCESS
    var planned = answer.planned != null ? answer.planned : (answer.diagnostics && answer.diagnostics.planned);
    var applied = answer.applied != null ? answer.applied : (answer.diagnostics && answer.diagnostics.applied);
    if (planned == null && answer.diagnostics && answer.diagnostics.targetAssets) planned = answer.diagnostics.targetAssets.length;
    if (planned > 0 && applied === 0) {
      throw { code: 'EVERIFY', message: 'Обновление не применено: ' + planned + ' обновлений было запланировано, 0 установлено.' };
    }
    if (planned > 0 && applied === 0) throw { code: 'EVERIFY', message: 'Обновление не применено: ' + planned + ' обновлений было запланировано, 0 установлено.' };
    ctx.shell.showToast(_('Обновление применено.'), 'ok');
    return refresh(ctx);
  }).catch(function (error) {
    state.componentBusy = false;
    showError(ctx, error);
    rerender(ctx);
  });
}
function toggleEngine(ctx) {
  state.engineExpanded = !state.engineExpanded;
  rerender(ctx);
}
function toggleZ2K(ctx) {
  state.z2kExpanded = !state.z2kExpanded;
  rerender(ctx);
}
function renderHero(ctx, page) {
  var shell = ctx.shell;
  var lastCheck = page.checkedAt || (page.components[1] && page.components[1].details && page.components[1].details.checkedAt);
  if (!lastCheck && page.components[1] && page.components[1].details && page.components[1].details.provenance) {
    lastCheck = page.components[1].details.provenance.checkedAt || null;
  }
  var lastCheckLabel = formatLastCheck(shell, page.checkedAt || lastCheck);
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
          E('span', { 'class': 'z2m-dim' }, page.health.message)
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
        shell.button(_('Обновить состояние'), 'sm', refreshState.bind(null, ctx), state.componentBusy),
        shell.button(_('Проверить обновления'), 'primary sm', checkUpdates.bind(null, ctx), state.componentBusy)
      ])
    ])
  ]);
}
function engineMetaRows(component, engineStatus) {
  var details = component.details || {};
  var caps = component.counters && component.counters.capabilities ? component.counters.capabilities : null;
  var rows = [];
  rows.push({ label: _('Установлено'), value: component.version || _('Не установлен') });
  if (caps) rows.push({ label: _('Возможности'), value: caps });
  rows.push({ label: _('Служба'), value: details.serviceState ? (details.serviceState === 'running' ? _('Работает') : details.serviceState) : (engineStatus.serviceState === 'running' ? _('Работает') : _('—')) });
  rows.push({ label: _('Совместимость'), value: component.compatibility === 'compatible' ? _('✓ Подтверждена') : component.compatibility === 'incompatible' ? _('Несовместим') : _('Не подтверждена') });
  if (component.updateState === 'current') rows.push({ label: _('Актуальная версия'), value: _('✓ Актуальная версия') });
  return rows.filter(function (r) { return r.value; });
}
function z2kMetaRows(component) {
  var details = component.details || {};
  var local = details.provenance || {};
  var rows = [];
  rows.push({ label: _('Установлено'), value: component.version || local.commit && local.commit.slice(0,7) || _('Не установлен') });
  if (component.counters && component.counters.lua) rows.push({ label: _('Lua'), value: component.counters.lua });
  rows.push({ label: _('Целостность'), value: component.health === 'ready' ? _('✓ Подтверждена') : _('Требует проверки') });
  rows.push({ label: _('Совместимость'), value: component.compatibility === 'compatible' ? _('✓ Подтверждена') : _('Не подтверждена') });
  return rows;
}
function renderInlineOperation(ctx, component, opts) {
  var shell = ctx.shell;
  opts = opts || {};
  var isBusy = state.componentBusy;
  var hasOp = isBusy || opts.phase;
  if (!hasOp) return null;
  var phase = opts.phase || (isBusy ? _('Обновление…') : '');
  var progress = opts.progress;
  var message = opts.message || '';
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
  var shell = ctx.shell;
  var isReady = component.health === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var isBroken = component.health === 'broken' || component.health === 'missing';
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = engineMetaRows(component, engineStatus);
  var isExpanded = state.engineExpanded;
  var toggleIcon = isExpanded ? 'chevronUp' : 'chevronDown';
  // Contextual actions
  var primaryActions = [];
  if (isBroken) {
    primaryActions.push(shell.button(_('Восстановить'), 'primary sm', function () { /* TODO: trigger repair flow */ }, false));
  } else if (hasUpdate) {
    primaryActions.push(shell.button(_('Обновить'), 'primary sm', function () { checkUpdates(ctx); }, state.componentBusy));
    primaryActions.push(shell.button(_('Что изменилось'), 'sm', function () { toggleEngine(ctx); }, false));
  } else if (isReady) {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx), state.componentBusy));
  } else {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx), state.componentBusy));
  }
  var manageBtn = E('button', { 'class': 'z2m-btn sm' + (isExpanded ? ' on' : ''), click: toggleEngine.bind(null, ctx) }, [
    _('Управление'), E('span', { 'class': 'z2m-btn-chevron' }, Icons.html(toggleIcon, { size: 12 }))
  ]);
  var expanded = isExpanded ? E('div', { 'class': 'z2m-component-expand' }, [
    E('div', { 'class': 'z2m-component-expand-title' }, _('Управление движком')),
    kvPanel(shell, [
      { label: _('Состояние'), value: component.health === 'ready' ? _('Установлен') : _('Не установлен') },
      { label: _('Автозапуск'), value: engineStatus.autostart ? _('Включён') : _('Выключен') },
      { label: _('Runtime'), value: engineStatus.serviceState || _('—') },
      { label: _('Capabilities'), value: component.counters && component.counters.capabilities || _('—') },
      { label: _('Источник'), value: component.details && component.details.source || 'bol-van/zapret2' }
    ]),
    E('div', { 'class': 'z2m-btnrow z2m-component-expand-actions' }, [
      shell.button(_('Перезапустить'), 'sm', function () { mutation(ctx, 'engine-restart', ctx.api.service.restart()); }, !!state.busy),
      shell.button(_('Переустановить'), 'sm', function () { /* handled via EnginePanel */ }, !!state.busy),
      E('span', { 'class': 'z2m-dim', style: 'margin-left:auto' }, ''),
      shell.button(_('Удалить движок'), 'danger sm', function () {
        confirmAction(ctx, _('Удалить движок?'), _('Будет удалён только движок, конфигурация сохранится.'), _('Удалить'), function () {
          mutation(ctx, 'engine-uninstall', ctx.api.engine.uninstall({ confirm: 'REMOVE' })).then(function () { refresh(ctx); });
        });
      }, !!state.busy)
    ]),
    E('details', { 'class': 'z2m-acc' }, [
      E('summary', {}, _('Технические сведения')),
      kvPanel(shell, [
        { label: _('Установленная версия'), value: engineStatus.installedRelease || engineStatus.packageVersion || '—' },
        { label: _('Архитектура'), value: engineStatus.architecture || '—' },
        { label: _('Runtime build'), value: engineStatus.runtimeBuild || '—' }
      ])
    ])
  ]) : null;
  // Also render the existing EnginePanel content inside disclosure if expanded and available
  var enginePanel = null;
  if (isExpanded && engineValue.length) {
    var engineCtx = Object.assign({}, ctx);
    enginePanel = EnginePanel.render(engineCtx, engineValue);
    ctx.enginePanelContext = engineCtx;
  }
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
    renderInlineOperation(ctx, component, state.componentBusy ? { phase: _('Обновление…'), message: _('Выполняется операция…') } : {}),
    expanded,
    enginePanel ? E('div', { 'class': 'z2m-component-engine-panel' }, [enginePanel]) : null,
    component.details && component.details.rebases && component.details.rebases.length ? E('p', { 'class': 'z2m-dim' }, _('Требуются rebase/review перед обновлением.')) : null
  ]);
}
function renderZ2KCard(ctx, component) {
  var shell = ctx.shell;
  var isReady = component.health === 'ready';
  var hasUpdate = component.updateState === 'update-available';
  var needsIntegration = component.updateState === 'integration-required';
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = z2kMetaRows(component);
  var isExpanded = state.z2kExpanded;
  var toggleIcon = isExpanded ? 'chevronUp' : 'chevronDown';
  var primaryActions = [];
  if (hasUpdate) {
    primaryActions.push(shell.button(_('Обновить'), 'primary sm', updateZ2K.bind(null, ctx), state.componentBusy));
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx), state.componentBusy));
  } else if (needsIntegration) {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx), state.componentBusy));
  } else {
    primaryActions.push(shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx), state.componentBusy));
  }
  var detailsBtn = E('button', { 'class': 'z2m-btn sm' + (isExpanded ? ' on' : ''), click: toggleZ2K.bind(null, ctx) }, [
    _('Подробнее'), E('span', { 'class': 'z2m-btn-chevron' }, Icons.html(toggleIcon, { size: 12 }))
  ]);
  var expanded = isExpanded ? E('div', { 'class': 'z2m-component-expand' }, [
    E('div', { 'class': 'z2m-component-expand-grid' }, [
      E('div', { 'class': 'z2m-component-expand-col' }, [
        E('h4', {}, _('Локально')),
        kvPanel(shell, [
          { label: _('Источник'), value: component.details.provenance && component.details.provenance.source || 'necronicle/z2k' },
          { label: _('Локальная revision'), value: component.version || '—' },
          { label: _('Lua assets'), value: component.counters && component.counters.lua || '—' },
          { label: _('Целостность'), value: isReady ? _('Подтверждена') : _('Требует проверки') },
          { label: _('Совместимость'), value: component.compatibility === 'compatible' ? _('Подтверждена') : _('Не подтверждена') }
        ])
      ]),
      E('div', { 'class': 'z2m-component-expand-col' }, [
        E('h4', {}, _('Upstream / Обновления')),
        kvPanel(shell, [
          { label: _('Последняя проверка'), value: formatLastCheck(shell, component.details.checkedAt || null) },
          { label: _('Remote revision'), value: component.details.manifest && component.details.manifest.current || '—' },
          { label: _('Trust mode'), value: component.details.trustMode || 'allow-untrusted' },
          { label: _('Обновления'), value: hasUpdate ? _('Доступно обновление') : _('Актуально') },
          { label: _('Rebase'), value: component.details.rebases && component.details.rebases.length ? component.details.rebases.join(', ') : _('не требуется') },
          { label: _('Review'), value: component.details.reviews && component.details.reviews.length ? component.details.reviews.join(', ') : _('не требуется') }
        ])
      ])
    ]),
    E('details', { 'class': 'z2m-acc' }, [
      E('summary', {}, _('Технические сведения')),
      kvPanel(shell, [
        { label: _('Версия'), value: component.version || '—' },
        { label: _('Источник'), value: component.details.provenance && component.details.provenance.source || '—' },
        { label: _('Lua'), value: component.counters && component.counters.lua || '—' },
        { label: _('Trust mode'), value: component.details.trustMode || '—' },
        { label: _('Manifest'), value: component.details.manifest && component.details.manifest.current || '—' }
      ])
    ])
  ]) : null;
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
    renderInlineOperation(ctx, component, state.componentBusy ? { phase: _('Обновление…'), message: _('Выполняется операция…') } : {}),
    expanded
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
    tgActions.push(shell.button(_('Проверить обновления'), 'sm', function () { checkUpdates(ctx); }, state.componentBusy));
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
    engine: { status: engineStatus },
    z2k: payload.resources && payload.resources.value && payload.resources.value.z2k || {},
    checkedAt: payload.resources && payload.resources.value && payload.resources.value.checkedAt
  });
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
      ])
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
  if (activePane(ctx) === 'components' && ctx.enginePanelContext && ctx.enginePanelContext.engineState)
    EnginePanel.mount(ctx.enginePanelContext);
}
function unmount(ctx) {
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
