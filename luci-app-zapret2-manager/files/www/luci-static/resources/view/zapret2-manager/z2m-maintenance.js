'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';
'require view.zapret2-manager.z2m-components-model as ComponentsModel';
'require view.zapret2-manager.z2m-update-presentation as UpdatePresentation';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
var LOAD_TIMEOUT_MS = 30000;
var Z2K_COMPARE_LOAD_TIMEOUT_MS = 30000;
var Z2K_MUTATION_TIMEOUT_MS = 180000;
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
  engineOperationOverride: false,
  z2kCheck: null,
  z2kCatalog: null,
  z2kSelectedVersion: null,
  z2kDetails: null,
  z2kDetailsCompared: false,
  z2kDetailsLoading: false,
  z2kDetailsLoadError: null,
  z2kDetailsRequestId: 0,
  z2kDetailsExpanded: false,
  z2kReleaseRefresh: null,
  z2kPrepared: null,
  z2kPostMutationStatus: null,
  z2kPostMutationRefreshError: null,
  z2kOperationError: null,
  showAllBackups: false,
  componentLoadToken: 0,
  componentHydrationToken: null,
  componentHydrationTimer: null,
  componentMetadata: {}
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
  if (op.scope === 'z2k') {
    var z2kPhase = String(op.phase || '').toLowerCase();
    if (z2kPhase === 'queued') return _('Операция Z2K в очереди…');
    if (z2kPhase === 'running') {
      if (op.kind === 'prepare') return _('Подготовка Z2K…');
      if (op.kind === 'refresh') return _('Проверка состояния Z2K…');
      return _('Обновление Z2K…');
    }
    if (z2kPhase === 'completed') return _('Обновление завершено');
    if (z2kPhase === 'failed') return _('Обновление не завершено');
  }
  if (op.kind === 'check') return _('Проверка обновлений…');
  if (op.kind === 'prepare' && op.scope === 'z2k') return _('Подготовка Z2K…');
  if (op.kind === 'update' && op.scope === 'z2k') return _('Обновление Z2K…');
  if (op.kind === 'refresh') return _('Обновление состояния…');
  return _('Обновление…');
}
function operationMessage(op) {
  if (!op) return '';
  if (op.scope === 'z2k') {
    var z2kPhase = String(op.phase || '').toLowerCase();
    if (z2kPhase === 'queued') return _('Операция поставлена в очередь на роутере.');
    if (z2kPhase === 'running') {
      if (op.kind === 'prepare') return _('Подготавливаем безопасный план обновления.');
      if (op.kind === 'refresh') return _('Проверяем установленное состояние системы.');
      return _('Операция выполняется на роутере.');
    }
  }
  if (op.kind === 'check') return _('Проверяем доступные версии…');
  if (op.kind === 'prepare' && op.scope === 'z2k') return _('Сохраняем выбранный release…');
  if (op.kind === 'update' && op.scope === 'z2k') return _('Применяем Z2K-обновление…');
  return _('Выполняется операция…');
}
function engineOperationTerminal(operation) {
  return operation && ['completed', 'failed', 'rolled_back'].indexOf(operation.phase) >= 0;
}

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function settled(result, api) {
  if (result.status !== 'fulfilled') return { error: api.normalizeError(result.reason) };
  var value = result.value || {};
  return value && value.ok === false
    ? { error: api.normalizeError(value.error || value) }
    : { value: value };
}
function catalogSourcePanel(ctx, state) {
  state = object(state);
  var source = object(state.source);
  var remoteState = state.remoteState;
  if (!source.stale && !source.error && remoteState !== 'unavailable' && remoteState !== 'empty') return null;
  var limited = source.error && source.error.code === 'ERATELIMIT';
  var empty = remoteState === 'empty';
  return ctx.shell.statePanel({
    title: source.stale || remoteState === 'stale' ? _('Каталог показан из последнего сохранённого состояния') : empty ? _('Официальные release не найдены') : _('Каталог upstream недоступен'),
    message: source.stale || remoteState === 'stale' ? _('Версии могут быть устаревшими. Нажмите «Проверить», чтобы подтвердить release перед изменением.') : empty ? _('Upstream ответил пустым каталогом. Установленное состояние не изменено.') :
      (limited ? _('Upstream временно ограничил запросы. Установленное состояние не изменено.') : _('Установленное состояние сохранено; повторите проверку позже.')),
    kind: source.stale || remoteState === 'stale' || empty ? 'info' : 'error'
  });
}
function boundedLoad(promise, label, timeoutMs) {
  timeoutMs = Number(timeoutMs) || LOAD_TIMEOUT_MS;
  var timer;
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject({ code: 'frontend-timeout', message: label + ' timeout' });
      }, timeoutMs);
    })
  ]).then(function (value) {
    window.clearTimeout(timer);
    return value;
  }, function (error) {
    window.clearTimeout(timer);
    throw error;
  });
}
function checkedResult(promise, label, timeoutMs) {
  return boundedLoad(promise, label, timeoutMs).then(function (answer) {
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
    state.componentLoadToken++;
    state.componentHydrationToken = null;
    state.componentMetadata = {};
    if (state.componentHydrationTimer) window.clearTimeout(state.componentHydrationTimer);
    state.componentHydrationTimer = null;
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
        // The release catalog is remote metadata. Keep an explicit not-loaded
        // envelope so the first render cannot mistake local status for latest.
        catalog: { value: { versions: [], remoteAvailable: null, remoteState: 'not-loaded', source: null } },
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

function verifiedRemote(answer, label) {
  if (!answer || answer.ok === false)
    throw answer && answer.error || answer || { code: 'EEMPTY', message: label + ' не вернул результат.' };
  return answer;
}

function scheduleComponentMetadata(ctx) {
  if (!ctx || activePane(ctx) !== 'components') return;
  var token = state.componentLoadToken;
  if (state.componentHydrationToken === token) return;
  state.componentHydrationToken = token;
  var jobs = [];
  if (ctx.api.engine && typeof ctx.api.engine.releases === 'function') jobs.push({
    key: 'engine', label: _('каталога Zapret2 Engine'), run: function () {
      return EnginePanel.loadCatalog ? EnginePanel.loadCatalog(ctx) : ctx.api.engine.releases();
    }
  });
  if (ctx.api.resources && typeof ctx.api.resources.versions === 'function') jobs.push({
    key: 'z2k', label: _('каталога Z2K'), run: function () { return ctx.api.resources.versions(); }
  });
  var next = 0, active = 0;
  function repaint() {
    if (token !== state.componentLoadToken || !ctx.root || typeof ctx.root.replaceChildren !== 'function') return;
    window.setTimeout(function () {
      if (token === state.componentLoadToken) rerender(ctx);
    }, 0);
  }
  function publish(job, result) {
    if (token !== state.componentLoadToken) return;
    try {
      state.componentMetadata[job.key] = { value: verifiedRemote(result, job.label) };
    } catch (error) {
      state.componentMetadata[job.key] = { error: ctx.api.normalizeError(error) };
    }
    repaint();
  }
  function pump() {
    if (token !== state.componentLoadToken) return;
    while (active < 2 && next < jobs.length) {
      (function (job) {
        active++;
        Promise.resolve().then(function () { return boundedLoad(job.run(), job.label); })
          .then(function (value) { publish(job, value); }, function (error) {
            publish(job, { ok: false, error: error });
          })
          .then(function () { active--; pump(); });
      })(jobs[next++]);
    }
  }
  state.componentHydrationTimer = window.setTimeout(function () {
    state.componentHydrationTimer = null;
    pump();
  }, 0);
}
function showError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  ctx.shell.showToast(normalized.message, 'err');
}
function rerender(ctx) {
  var next = render(ctx);
  ctx.root.replaceChildren(next);
}
function rerenderCurrent(ctx) {
  if (ctx && typeof ctx.rerender === 'function') return ctx.rerender();
  return rerender(ctx);
}
function rerenderZ2KOperation(ctx) {
  if (state.z2kExpanded && typeof state.z2kReleaseRefresh === 'function') {
    state.z2kReleaseRefresh();
    return;
  }
  rerender(ctx);
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
function confirmAction(ctx, title, message, confirmLabel, handler, kind) {
  var shell = ctx.shell;
  shell.openModal(title, E('p', {}, message), [
    shell.button(_('Отмена'), '', shell.closeModal),
    shell.button(confirmLabel, kind || 'danger', function () {
      shell.closeModal();
      handler();
    })
  ]);
}
function waitForZ2KUpdate(ctx, operationId) {
  var attempts = 0;
  function poll() {
    return checkedResult(ctx.api.resources.updateStatus({ operationId: operationId }), _('Состояние Z2K')).then(function (answer) {
      var operation = state.componentOperation;
      if (!operation || operation.scope !== 'z2k' || operation.operationId && operation.operationId !== operationId) return null;
      var nextOperation = operation ? Object.assign({}, operation) : null;
      var projectionChanged = false;
      if (nextOperation && answer && answer.phase !== undefined && nextOperation.phase !== answer.phase) {
        nextOperation.phase = answer.phase;
        projectionChanged = true;
      } else if (nextOperation && answer && answer.state !== undefined && nextOperation.phase !== answer.state) {
        nextOperation.phase = answer.state;
        projectionChanged = true;
      }
      if (nextOperation && answer && Object.prototype.hasOwnProperty.call(answer, 'progress') && nextOperation.progress !== answer.progress) {
        nextOperation.progress = answer.progress;
        projectionChanged = true;
      }
      if (nextOperation && answer && Object.prototype.hasOwnProperty.call(answer, 'message') && nextOperation.message !== answer.message) {
        nextOperation.message = answer.message;
        projectionChanged = true;
      }
      if (nextOperation && answer && Array.isArray(answer.stages)) {
        var previousStages = JSON.stringify(nextOperation.stages || []);
        var nextStages = JSON.stringify(answer.stages);
        if (previousStages !== nextStages) {
          nextOperation.stages = answer.stages;
          projectionChanged = true;
        }
      }
      if (projectionChanged) {
        state.componentOperation = nextOperation;
        rerenderZ2KOperation(ctx);
      }
      var phase = String(answer && answer.phase || answer && answer.state || '').toLowerCase();
      if ((answer && answer.finished === true) || phase === 'completed' || phase === 'failed') {
        var result = answer && answer.result || answer;
        if (!result || result.ok !== true) throw result && result.error || answer && answer.error || { code: 'EINTERNAL', message: _('Операция Z2K завершилась без результата.') };
        return result;
      }
      attempts++;
      if (attempts >= 180) throw { code: 'frontend-timeout', message: _('Операция Z2K не завершилась в установленный срок.') };
      return new Promise(function (resolve) { window.setTimeout(resolve, 1000); }).then(poll);
    });
  }
  return poll();
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
    if (component.updateState === 'refresh-required') return _('Состояние не подтверждено');
    var attentionState = component.attentionState;
    var blockingReviews = Array.isArray(component.blockingReviews) ? component.blockingReviews : [];
    var rebases = Array.isArray(component.rebases) ? component.rebases : [];
    if (runtimeHealth === 'missing') {
      return component.summary && String(component.summary).indexOf('Engine') >=0 ? _('Требуется Zapret2 Engine') : _('Не установлен');
    }
    if (runtimeHealth === 'broken') return _('Ошибка');
    if (compatibility === 'incompatible') return _('Несовместим');
    if (runtimeHealth === 'checking') return _('Проверяется');
    if (attentionState === 'rebase-required' || rebases.length) return _('Требуется адаптация');
    if (attentionState === 'review-required' || blockingReviews.length) return _('Требуется проверка');
    if (attentionState === 'integration-required') return _('Требуется интеграция');
    var installedValue = component.installedRelease && component.installedRelease.value;
    var latestValue = component.latestRelease || component.availableRelease;
    if (!installedValue) return runtimeHealth === 'ready' ? _('Работает') : _('Требует внимания');
    if (component.updateState === 'update-available') return _('Доступно обновление');
    if (component.updateState === 'review-required') return _('Требуется проверка');
    if (component.updateState === 'rebase-required') return _('Требуется адаптация');
    if (component.updateState === 'integration-required') return _('Требуется интеграция');
    if (runtimeHealth === 'ready' && component.updateState === 'current' && compatibility === 'compatible' && (!latestValue || installedValue === latestValue)) return _('Актуален');
    if (runtimeHealth === 'ready') {
      return _('Работает');
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
    var attentionState = component.attentionState;
    var blocking = attentionState === 'review-required' || attentionState === 'rebase-required'
      || attentionState === 'integration-required'
      || (component.blockingReviews && component.blockingReviews.length)
      || (component.rebases && component.rebases.length);
    if (blocking) {
      if (counts[attentionState] !== undefined) counts[attentionState]++;
      else if (component.blockingReviews && component.blockingReviews.length) counts['review-required']++;
      else if (component.rebases && component.rebases.length) counts['rebase-required']++;
      return;
    }
    if (component.updateState === 'update-available' && (component.id !== 'z2k-core' || component.canApply !== false))
      counts['update-available']++;
  });
  var parts = [];
  if (counts['update-available'] > 0)
    parts.push(_('Доступно ') + counts['update-available'] + ' ' + (counts['update-available'] === 1 ? _('обновление') : _('обновления')));
  if (counts['review-required'] > 0)
    parts.push(counts['review-required'] + ' ' + (counts['review-required'] === 1 ? _('компонент требует проверки') : _('компонента требуют проверки')));
  if (counts['rebase-required'] > 0)
    parts.push(counts['rebase-required'] + ' ' + (counts['rebase-required'] === 1 ? _('компонент требует адаптации') : _('компонента требуют адаптации')));
  if (counts['integration-required'] > 0)
    parts.push(counts['integration-required'] + ' ' + (counts['integration-required'] === 1 ? _('компонент требует интеграции') : _('компонента требуют интеграции')));
  if (z2kIdentityUnknown(page)) parts.push(_('Версия Z2K требует уточнения'));
  return parts.join(' · ') || _('Обновления не требуются');
}
function z2kIdentityUnknown(page) {
  var z2k = page && page.components && page.components.find(function (component) { return component.id === 'z2k-core'; });
  return !z2k || !z2k.installedRelease || !z2k.installedRelease.value;
}
function heroStatusLabel(page) {
  if (page.health.state === 'ready' && z2kIdentityUnknown(page)) return _('Система работает');
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
function heroStatusMessage(page) {
  return page.health.state === 'ready' && z2kIdentityUnknown(page)
    ? _('Версия Z2K требует уточнения') : page.health.message;
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
function invalidateZ2KAfterMutation(targetRelease) {
  state.z2kPrepared = null;
  state.z2kCheck = null;
  state.z2kDetails = null;
  state.z2kDetailsCompared = false;
  state.z2kDetailsLoading = false;
  state.z2kDetailsLoadError = null;
  state.z2kDetailsRequestId += 1;
  state.z2kDetailsExpanded = false;
  state.z2kPostMutationStatus = null;
  state.z2kPostMutationRefreshError = null;
  state.z2kOperationError = null;
  if (targetRelease) state.z2kSelectedVersion = targetRelease;
}
function reloadZ2KSelectedDetails(ctx) {
  // ctx.refresh() replaces the page context; never inspect ctx.data here because
  // it is the pre-mutation snapshot. Re-read the selected release against the
  // authoritative post-refresh state whenever the details pane is open.
  if (state.z2kExpanded && state.z2kSelectedVersion)
    loadZ2KVersionDetails(ctx, state.z2kSelectedVersion, false);
}
function refreshZ2KAfterMutation(ctx, targetRelease) {
  invalidateZ2KAfterMutation(targetRelease);
  state.z2kPostMutationStatus = {
    kind: 'success',
    title: _('Z2K обновлён до ') + targetRelease,
    message: _('Проверяем установленное состояние…')
  };
  state.componentOperation = { kind: 'refresh', scope: 'z2k', targetVersion: targetRelease };
  rerender(ctx);
  state.componentOperation = null;
  rerender(ctx);
  return Promise.resolve().then(function () { return refresh(ctx); }).then(function () {
    state.z2kPostMutationStatus = null;
    state.z2kPostMutationRefreshError = null;
    reloadZ2KSelectedDetails(ctx);
  }, function (error) {
    state.componentOperation = null;
    state.z2kPostMutationStatus = null;
    state.z2kPostMutationRefreshError = { code: 'z2k-post-mutation-refresh', cause: error };
    rerenderCurrent(ctx);
    showError(ctx, error);
  });
}
function retryZ2KPostMutationRefresh(ctx) {
  if (state.componentOperation) return;
  state.z2kPostMutationRefreshError = null;
  state.z2kPostMutationStatus = {
    kind: 'success',
    title: _('Проверка состояния Z2K'),
    message: _('Проверяем установленное состояние…')
  };
  state.componentOperation = { kind: 'refresh', scope: 'z2k' };
  rerender(ctx);
  state.componentOperation = null;
  rerender(ctx);
  Promise.resolve().then(function () { return refresh(ctx); }).then(function () {
    state.z2kPostMutationStatus = null;
    reloadZ2KSelectedDetails(ctx);
  }, function (error) {
    state.componentOperation = null;
    state.z2kPostMutationStatus = null;
    state.z2kPostMutationRefreshError = { code: 'z2k-post-mutation-refresh', cause: error };
    rerenderCurrent(ctx);
    showError(ctx, error);
  });
}
var CHECK_TIMEOUT_MS = 20000;
function checkUpdates(ctx, scope) {
  scope = scope || 'all';
  if (state.componentOperation) return;
  if (scope === 'all' || scope === 'z2k') {
    state.z2kOperationError = null;
    state.z2kPostMutationStatus = null;
  }
  state.componentOperation = { kind: 'check', scope: scope };
  rerender(ctx);
  var promises = [];
  var promiseScopes = [];
  function addCheck(checkScope, promise) {
    promiseScopes.push(checkScope);
    promises.push(promise);
  }
  if (scope === 'all' || scope === 'z2k') addCheck('z2k', checkedResult(ctx.api.resources.check(), 'Проверка Z2K'));
  if (scope === 'all' || scope === 'engine') {
    addCheck('engine', checkedResult(ctx.api.engine.check({ forceRefresh: true }), 'Проверка движка'));
    if (ctx.api.engine.gateStatus) addCheck('engine-gate', checkedResult(ctx.api.engine.gateStatus(), 'Проверка гейта движка'));
  }
  // Bounded lifecycle: even a hung rpc transport must never leave busy forever.
  var checkTimer = null;
  Promise.race([Promise.allSettled(promises), new Promise(function (_, reject) {
    checkTimer = window.setTimeout(function () {
      reject({ code: 'frontend-timeout', message: _('Проверка обновлений превысила допустимое время.') });
    }, CHECK_TIMEOUT_MS);
  })]).then(function (results) {
    var failed = results && results.some ? results.some(function (r) { return r.status === 'rejected'; }) : false;
    if (failed) {
      var firstError = results.find(function (r) { return r.status === 'rejected'; });
      if (firstError) showError(ctx, firstError.reason);
      return false;
    }
    results.forEach(function (result, index) {
      var checkedAt = result && result.status === 'fulfilled' && result.value && result.value.checkedAt;
      if (checkedAt !== null && checkedAt !== undefined && checkedAt !== '')
        state.lastSuccessfulCheckAt = latestCanonicalTimestamp(state.lastSuccessfulCheckAt, checkedAt);
      if (result && result.status === 'fulfilled' && promiseScopes[index] === 'z2k') {
        var answer = result.value || {};
        var z2k = object(answer.z2k);
        var planToken = answer.planToken || z2k.planToken;
        if (planToken) state.z2kCheck = {
          planToken: planToken,
          checkedAt: answer.checkedAt !== undefined ? answer.checkedAt : z2k.checkedAt,
          manifest: object(z2k.manifest)
        };
      }
    });
    ctx.shell.showToast(_('Проверка обновлений завершена.'), 'ok');
    return true;
  }).catch(function (error) {
    showError(ctx, error);
  }).then(function () {
    if (checkTimer) window.clearTimeout(checkTimer);
    state.skipEngineOperationStatus = true;
    state.componentOperation = null;
    rerender(ctx);
    return refresh(ctx);
  }).catch(function (error) {
    showError(ctx, error);
  });
}
function updateZ2K(ctx, component) {
  if (state.componentOperation) return;
  state.z2kOperationError = null;
  state.z2kPostMutationStatus = null;
  var targetRelease = z2kTargetRelease(component);
  var operation = z2kOperation(component);
  var legacyCatalogFallback = component && !component.selectedDetails && (!component.catalog || !component.catalog.length)
    && component.canApply === true && component.updateState === 'update-available';
  if (!targetRelease || !component || !operation || (!component.selectedDetails && !legacyCatalogFallback) || (component.selectedDetails && component.selectedDetails.installable !== true)) {
    showError(ctx, { code: 'EINPUT', message: _('Сначала выберите доступный release и дождитесь его деталей.') });
    return;
  }
  state.componentOperation = { kind: 'prepare', scope: 'z2k', targetVersion: targetRelease };
  rerender(ctx);
  var prepare = ctx.api.resources.prepareVersion ? checkedResult(ctx.api.resources.prepareVersion({ version: targetRelease }), _('Подготовка Z2K'))
    : Promise.reject({ code: 'EINPUT', message: 'z2k_prepare_version unavailable' });
  prepare.then(function (prepared) {
    var preparedTarget = prepared && prepared.target;
    if (!prepared || !prepared.planToken || !preparedTarget
      || preparedTarget.targetVersion !== targetRelease
      || ['install', 'upgrade', 'reinstall', 'downgrade'].indexOf(preparedTarget.operation) < 0
      || !Object.prototype.hasOwnProperty.call(preparedTarget, 'installedVersion')) {
      throw { code: 'EINPUT', message: _('Подготовленный target Z2K не совпадает с выбранной операцией.') };
    }
    state.z2kPrepared = prepared;
    state.componentOperation = null;
    rerender(ctx);
    var preparedOperation = preparedTarget.operation;
    var preparedRelease = preparedTarget.targetVersion;
    var preparedInstalled = preparedTarget.installedVersion;
    var preparedLabel = z2kOperationLabel(preparedOperation, preparedRelease);
    var confirmationMessage = preparedOperation === 'reinstall'
      ? _('Компоненты этой версии будут скачаны, проверены и установлены заново.')
      : preparedOperation === 'downgrade'
        ? _('Будет установлена более ранняя версия. При ошибке Manager запустит предусмотренный откат, а его результат будет показан в сообщении.')
        : preparedOperation === 'upgrade'
          ? _('Будет установлена новая версия компонентов Z2K. Перед применением загруженные файлы будут проверены.')
          : _('Текущая версия не определена. Manager проверит установленные компоненты и приведёт их к выбранной версии.');
    var transition = preparedInstalled && preparedInstalled !== preparedRelease
      ? preparedInstalled + ' → ' + preparedRelease + '. '
      : '';
    confirmAction(ctx, preparedLabel + '?', preparedRelease + '. ' + transition + confirmationMessage,
      preparedOperation === 'reinstall' ? _('Переустановить') : preparedLabel, function () {
        state.componentOperation = { kind: 'update', scope: 'z2k', targetVersion: preparedRelease, operation: preparedOperation, installedVersion: preparedInstalled };
        rerender(ctx);
        var payload = {
          bundleId: 'z2k-curated-lua',
          targetVersion: preparedRelease,
          operation: preparedOperation,
          installedVersion: preparedInstalled,
          planToken: prepared.planToken,
          confirm: true
        };
        var update = ctx.api.resources.update ? checkedResult(ctx.api.resources.update(JSON.stringify(payload)), _('Применение Z2K'), Z2K_MUTATION_TIMEOUT_MS)
          : Promise.reject({ code: 'EINPUT', message: 'resources_update unavailable' });
        update = update.then(function (answer) {
          if (answer && answer.accepted === true) {
            if (!answer.operationId || !ctx.api.resources.updateStatus)
              throw { code: 'EINTERNAL', message: _('Z2K принял операцию, но состояние операции недоступно.') };
            state.componentOperation = Object.assign({}, state.componentOperation, { operationId: answer.operationId });
            return waitForZ2KUpdate(ctx, answer.operationId);
          }
          return answer;
        });
        update.then(function (answer) {
          if (!answer || answer.ok !== true) throw answer && answer.error || answer || new Error('update failed');
          // Operation-specific success toast follows the prepared operation.
          ctx.shell.showToast(_('Z2K Core: ') + z2kOperationLabel(preparedOperation, preparedRelease) + '.', 'ok');
          return refreshZ2KAfterMutation(ctx, preparedRelease);
        }).catch(function (error) {
          state.z2kPrepared = null;
          state.componentOperation = null;
          state.z2kOperationError = operationErrorProjection(ctx, error);
          rerender(ctx);
          showError(ctx, error);
        });
      }, 'primary');
  }).catch(function (error) {
    state.z2kPrepared = null;
    state.componentOperation = null;
    state.z2kOperationError = operationErrorProjection(ctx, error);
    rerender(ctx);
    showError(ctx, error);
  });
}
function operationErrorProjection(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  var rollback = error && error.rollback || normalized && normalized.rollback;
  return {
    message: normalized && normalized.message || _('Операция Z2K не завершена.'),
    rollback: rollback && typeof rollback === 'object' ? rollback : null
  };
}
function z2kCatalogRows(component) {
  return component && Array.isArray(component.catalog) ? component.catalog : [];
}
function z2kSelectedDetails(component) {
  return component && component.selectedDetails && typeof component.selectedDetails === 'object' ? component.selectedDetails : null;
}
function z2kCatalogOptionLabel(item) {
  var labels = [];
  if (item.installed) labels.push(_('установлена'));
  if (item.latest) labels.push(_('последняя'));
  if (item.installable === false) return item.version + ' · ' + _('несовместим');
  return item.version + (labels.length ? ' · ' + labels.join(' · ') : '');
}
function z2kUnavailableReason(item) {
  if (!item) return _('Release недоступен.');
  if (item.unavailableReason === 'incompatible-manager') return _('Release несовместим с текущим Manager.');
  if (item.unavailableReason === 'invalid-manifest') return _('Manifest release не прошёл проверку.');
  return _('Release временно недоступен.');
}
function z2kOperationLabel(operation, version) {
  if (operation === 'install') return _('Установить') + (version ? ' ' + version : '');
  if (operation === 'upgrade') return _('Обновить до ') + version;
  if (operation === 'downgrade') return _('Откатить до ') + version;
  if (operation === 'reinstall') return _('Переустановить ') + version;
  return _('Действие недоступно');
}
function z2kChangeSummary(details) {
  var changes = details && (details.deviceChanges || details.installChanges || details.changes) || {};
  if (changes.known === false) return _('История установленной версии не подтверждена.');
  var parts = [];
  if (changes.modified) parts.push(_('Обновится') + ' ' + changes.modified);
  if (changes.added) parts.push(_('Добавится') + ' ' + changes.added);
  if (changes.removed) parts.push(_('Удалится') + ' ' + changes.removed);
  if (parts.length) return parts.join(' · ');
  return details && details.operation === 'reinstall'
    ? _('Изменений относительно установленной версии нет.')
    : _('Новых изменений при установке нет.');
}
function z2kManagedChangeItems(changes, key) {
  return changes && Array.isArray(changes[key]) ? changes[key] : [];
}
function z2kManagedChangeFallback(action, version) {
  var verb = action === 'modified' ? _('Изменён в ') : action === 'added' ? _('Добавлен в ') : _('Удалён в ');
  return verb + (version || _('выбранном release'));
}
function z2kEvidenceIdentity(item) {
  var explanation = item && item.explanation;
  if (!explanation || explanation.source !== 'repository-compare' || !explanation.commitSha) return null;
  return explanation.commitSha + '|' + explanation.excerptIndexes.join(',') + '|' + explanation.excerpts.join('\n\n');
}
function z2kManagedEvidenceGroups(items) {
  var groups = [], indexes = {};
  items.forEach(function (item) {
    var key = z2kEvidenceIdentity(item) || 'resource:' + (item && (item.sourcePath || item.id || item.name) || groups.length);
    if (indexes[key] === undefined) {
      indexes[key] = groups.length;
      groups.push({ key: key, items: [] });
    }
    groups[indexes[key]].items.push(item);
  });
  return groups;
}
function z2kCompareContext(changes, commitSha) {
  var contexts = changes && Array.isArray(changes.compareContext) ? changes.compareContext : [];
  return contexts.find(function (item) { return item && (item.sha || item.commitSha) === commitSha; }) || null;
}
function z2kCommitUrl(commitSha) {
  return typeof commitSha === 'string' && /^[a-f0-9]{40}$/i.test(commitSha)
    ? 'https://github.com/necronicle/z2k/commit/' + commitSha
    : null;
}
function z2kEvidenceContext(changes, explanation) {
  if (!explanation || explanation.source !== 'repository-compare' || explanation.fullMessageAvailable !== true) return null;
  var context = z2kCompareContext(changes, explanation.commitSha);
  return context && Array.isArray(context.paragraphs) && context.paragraphs.length ? context : null;
}
function z2kAdditionalContext(context, explanation) {
  var selected = Array.isArray(explanation && explanation.excerptIndexes) ? explanation.excerptIndexes : [];
  return Array.isArray(context && context.paragraphs) ? context.paragraphs.filter(function (_, index) { return selected.indexOf(index) < 0; }) : [];
}
function z2kEvidenceGroup(changes, group, action, version) {
  var first = group.items[0] || {};
  var explanation = first.explanation;
  var repositoryEvidence = explanation && explanation.source === 'repository-compare' && Array.isArray(explanation.excerpts) && explanation.excerpts.length;
  var context = repositoryEvidence ? z2kEvidenceContext(changes, explanation) : null;
  var additionalContext = context ? z2kAdditionalContext(context, explanation) : [];
  var commitUrl = repositoryEvidence ? z2kCommitUrl(explanation.commitSha) : null;
  var rows = group.items.map(function (item) {
    item = item || {};
    var name = item.name || item.id || item.sourcePath || _('Ресурс');
    var itemExplanation = item.explanation;
    var rowEvidence = !repositoryEvidence && itemExplanation && Array.isArray(itemExplanation.excerpts) && itemExplanation.excerpts.length
      ? itemExplanation.excerpts.join('\n\n') : null;
    return E('div', { 'class': 'z2m-z2k-change-item', role: 'listitem' }, [
    E('span', { 'class': 'z2m-z2k-change-item-name' }, name),
      item.sourcePath && item.sourcePath !== name ? E('span', { 'class': 'z2m-dim z2m-z2k-change-item-source' }, item.sourcePath) : null,
      rowEvidence ? E('span', { 'class': 'z2m-z2k-change-summary' }, rowEvidence) : !repositoryEvidence ? E('span', { 'class': 'z2m-z2k-change-summary' }, z2kManagedChangeFallback(action, version)) : null
    ]);
  });
  var fullContext = repositoryEvidence ? [E('strong', {}, explanation.commitSubject || _('Полный commit'))] : [];
  if (repositoryEvidence) additionalContext.forEach(function (paragraph) { fullContext.push(E('p', {}, paragraph)); });
  var evidence = repositoryEvidence ? E('div', { 'class': 'z2m-z2k-change-evidence' }, [
    E('strong', { 'class': 'z2m-z2k-change-evidence-title' }, explanation.commitSubject || _('Изменения из одного upstream commit')),
    E('div', { 'class': 'z2m-z2k-change-evidence-excerpts' }, explanation.excerpts.map(function (excerpt) {
      return E('p', {}, excerpt);
    })),
    context || commitUrl ? E('div', { 'class': 'z2m-z2k-change-evidence-actions' }, [
      additionalContext.length ? E('details', { 'class': 'z2m-z2k-change-evidence-context' }, [
        E('summary', {}, _('Контекст')),
        E('div', { 'class': 'z2m-z2k-change-evidence-full' }, fullContext)
      ]) : null,
      commitUrl ? E('a', { href: commitUrl, target: '_blank', rel: 'noreferrer', 'class': 'z2m-z2k-change-commit-link' }, _('Открыть commit ↗')) : null
    ]) : null
  ]) : null;
  return E('div', { 'class': 'z2m-z2k-change-evidence-group' }, [
    evidence,
    E('div', { 'class': 'z2m-z2k-change-items', role: 'list' }, rows)
  ]);
}
function z2kManagedChangeGroup(label, items, action, version, changes) {
  if (!items.length) return null;
  var children = [E('strong', {}, label + ' · ' + items.length)];
  z2kManagedEvidenceGroups(items).forEach(function (group) { children.push(z2kEvidenceGroup(changes, group, action, version)); });
  return E('div', { 'class': 'z2m-z2k-change-group' }, children);
}
function renderZ2KManagedChangeDetails(changes, version) {
  return [
    z2kManagedChangeGroup(_('Обновится'), z2kManagedChangeItems(changes, 'modifiedItems'), 'modified', version, changes),
    z2kManagedChangeGroup(_('Добавится'), z2kManagedChangeItems(changes, 'addedItems'), 'added', version, changes),
    z2kManagedChangeGroup(_('Удалится'), z2kManagedChangeItems(changes, 'removedItems'), 'removed', version, changes)
  ].filter(Boolean);
}
function loadZ2KVersionDetails(ctx, version, includeCompare) {
  if (!version || state.componentOperation || !ctx.api.resources || !ctx.api.resources.versionDetails) return;
  var compareRequested = includeCompare === true;
  var requestId = ++state.z2kDetailsRequestId;
  checkedResult(ctx.api.resources.versionDetails({ version: version, includeCompare: compareRequested ? 'compare' : 'fallback' }), _('Детали Z2K release'), compareRequested ? Z2K_COMPARE_LOAD_TIMEOUT_MS : undefined).then(function (answer) {
    if (state.z2kSelectedVersion !== version || state.z2kDetailsRequestId !== requestId) return;
    state.z2kDetails = answer;
    state.z2kDetailsCompared = compareRequested;
    if (compareRequested) {
      state.z2kDetailsLoading = false;
      state.z2kDetailsLoadError = null;
    }
    if (typeof state.z2kReleaseRefresh === 'function') state.z2kReleaseRefresh();
    else rerender(ctx);
  }).catch(function (error) {
    if (state.z2kSelectedVersion !== version || state.z2kDetailsRequestId !== requestId) return;
    if (compareRequested) {
      state.z2kDetailsLoading = false;
      state.z2kDetailsLoadError = error;
      if (typeof state.z2kReleaseRefresh === 'function') state.z2kReleaseRefresh();
      else rerender(ctx);
      return;
    }
    showError(ctx, error);
  });
}
function selectZ2KVersion(ctx, version) {
  if (!version || state.componentOperation) return;
  state.z2kSelectedVersion = version;
  state.z2kOperationError = null;
  state.z2kPostMutationStatus = null;
  state.z2kDetails = null;
  state.z2kDetailsCompared = false;
  state.z2kDetailsLoading = false;
  state.z2kDetailsLoadError = null;
  state.z2kDetailsRequestId += 1;
  state.z2kDetailsExpanded = false;
  if (typeof state.z2kReleaseRefresh === 'function') state.z2kReleaseRefresh();
  else rerender(ctx);
  loadZ2KVersionDetails(ctx, version, false);
}
function toggleEngine(ctx) {
  state.engineExpanded = !state.engineExpanded;
  if (state.engineExpanded) state.z2kExpanded = false;
  rerender(ctx);
}
function toggleZ2K(ctx) {
  if (state.componentOperation) return;
  state.z2kExpanded = !state.z2kExpanded;
  if (state.z2kExpanded) state.engineExpanded = false;
  rerender(ctx);
  if (state.z2kExpanded && !state.z2kDetails) {
    var resources = ctx.data && ctx.data.components && ctx.data.components.resources && ctx.data.components.resources.value || {};
    var current = resources.z2k && resources.z2k.selectedDetails;
    if (!current) loadZ2KVersionDetails(ctx, state.z2kSelectedVersion, false);
  }
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
  rows.push({ label: _('Установлено'), value: z2kReleaseLabel(component) });
  rows.push({ label: _('Последняя'), value: z2kLatestRelease(component) });
  if (component.counters && component.counters.lua) rows.push({ label: _('Lua'), value: component.counters.lua });
  rows.push({ label: _('Целостность'), value: (component.runtimeHealth || component.health) === 'ready' ? _('✓ Подтверждена') : _('Требует проверки') });
  return rows;
}
function z2kReleaseLabel(component) {
  var release = component.installedRelease || {};
  if (release.value) return release.value;
  return component.details && component.details.localInstalled === false ? _('Не установлен') : _('Версия не определена');
}
function z2kLatestRelease(component) {
  return component && (component.latestRelease || component.availableRelease) || _('Не определена');
}
function z2kOperation(component) {
  var details = z2kSelectedDetails(component);
  return component && (component.operation || details && details.operation) || null;
}
function z2kTargetRelease(component) {
  var details = z2kSelectedDetails(component);
  return component && (component.selectedVersion || details && details.version || component.availableRelease) || null;
}
function z2kUpdateActionLabel(component) {
  var targetRelease = z2kTargetRelease(component);
  var operation = z2kOperation(component);
  if (!operation && component && component.updateState === 'update-available') operation = 'upgrade';
  return z2kOperationLabel(operation, targetRelease);
}
function z2kCanApply(component) {
  var selected = z2kSelectedDetails(component);
  var attentionState = selected && selected.targetAttentionState !== null && selected.targetAttentionState !== undefined
    ? selected.targetAttentionState : component && component.attentionState;
  var blockingReviews = component && Array.isArray(component.blockingReviews) ? component.blockingReviews : [];
  var targetBlockingReasons = selected && Array.isArray(selected.targetBlockingReasons) ? selected.targetBlockingReasons : [];
  var legacyCatalogFallback = !!component && !selected && (!component.catalog || !component.catalog.length)
    && component.canApply === true && component.updateState === 'update-available';
  var targetCanApply = selected && selected.targetCanApply !== null && selected.targetCanApply !== undefined
    ? selected.targetCanApply === true : component && component.canApply === true;
  return !!component && (selected && selected.installable === true || legacyCatalogFallback)
    && !!z2kTargetRelease(component)
    && component.runtimeHealth === 'ready'
    && ['review-required', 'rebase-required', 'integration-required'].indexOf(attentionState) < 0
    && blockingReviews.length === 0
    && targetBlockingReasons.length === 0
    && targetCanApply;
}
function z2kUpdateLabel(component) {
  if (component.attentionState === 'rebase-required' || (component.rebases && component.rebases.length)) return _('Требуется адаптация');
  if (component.attentionState === 'review-required' || (component.blockingReviews && component.blockingReviews.length)) return _('Требуется проверка');
  if (component.attentionState === 'integration-required') return _('Требуется интеграция');
  return component.updatePresentation && component.updatePresentation.label || UpdatePresentation.describe(component.updateState).label;
}
function z2kNeedsIntegration(component) {
  var attentionState = component && component.attentionState;
  var blockingReviews = component && Array.isArray(component.blockingReviews) ? component.blockingReviews : [];
  var rebases = component && Array.isArray(component.rebases) ? component.rebases : [];
  return ['integration-required', 'review-required', 'rebase-required'].indexOf(attentionState) >= 0
    || ['integration-required', 'review-required', 'rebase-required'].indexOf(component && component.updateState) >= 0
    || blockingReviews.length > 0
    || rebases.length > 0;
}
function z2kReviewReason(component) {
  var hasBlocking = component && (component.attentionState === 'review-required' || (component.blockingReviews && component.blockingReviews.length));
  var hasRebase = component && (component.attentionState === 'rebase-required' || (component.rebases && component.rebases.length));
  if (!hasBlocking && !hasRebase) return '';
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
  if (!reasons.length && component.blockingReasons && component.blockingReasons.length)
    reasons.push(component.blockingReasons.join(', '));
  if (!reasons.length && component.reviews && component.reviews.length)
    reasons.push(_('Изменения в upstream-файлах требуют ручной semantic review: ') + component.reviews.join(', '));
  if (!reasons.length && component.rebases && component.rebases.length)
    reasons.push(_('Адаптированные файлы требуют ручного rebase: ') + component.rebases.join(', '));
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
  var attentionState = component.attentionState;
  var hasBlocking = attentionState === 'review-required' || (component.blockingReviews && component.blockingReviews.length);
  var hasRebase = attentionState === 'rebase-required' || (component.rebases && component.rebases.length);
  if (!hasBlocking && !hasRebase && component.updateState !== 'review-required') return null;
  var title = hasRebase ? _('Требуется адаптация') : _('Требуется semantic review');
  var kind = hasRebase ? 'rebase' : 'blocking';
  var reason = z2kReviewReason(component) || (hasRebase ? _('Адаптированные файлы нельзя обновить автоматически.') : _('Изменения требуют ручной проверки перед обновлением.'));
  return E('aside', { 'class': 'z2m-component-review-callout z2m-component-review-callout--' + kind, role: 'status', 'aria-live': 'polite' }, [
    E('strong', {}, title),
    E('p', {}, reason)
  ]);
}
function engineActionWithCheck(ctx, component, action, label) {
  var version = component.available && component.available.version || component.installed && component.installed.version;
  if (component.canApply === false || !version || !ctx.api.engine.check || !ctx.api.engine[action]) {
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
function engineUpdateActionLabel(component) {
  var target = component && component.available && component.available.version;
  return target ? _('Обновить до ') + target : _('Обновить');
}
function renderEngineDetails(ctx, component, engineStatus) {
  var shell = ctx.shell;
  var status = object(engineStatus);
  var details = component.details || {};
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var hasUpdate = component.updateState === 'update-available' && component.canApply !== false;
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
    catalogSourcePanel(ctx, component.catalog || { remoteState: component.remoteState }),
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
      actions: hasUpdate ? [
        shell.button(engineUpdateActionLabel(component), 'primary sm', engineActionWithCheck.bind(null, ctx, component, 'update', engineUpdateActionLabel(component)), !!state.componentOperation),
        shell.button(_('Проверить снова'), 'sm', checkUpdates.bind(null, ctx, 'engine'), !!state.componentOperation)
      ] : [
        shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'engine'), !!state.componentOperation)
      ]
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
function z2kReleaseDate(ctx, selected) {
  if (!selected || !selected.publishedAt) return null;
  return formatTime(ctx.shell, selected.publishedAt) || String(selected.publishedAt);
}
function z2kSelectionMessage(component, selected, operation, targetRelease) {
  if (!selected || selected.installable !== true) return _('Установка недоступна');
  if (selected.targetCanApply === false) return _('Эта версия требует проверки перед установкой.');
  var installed = selected.installedVersion || component.installedRelease && component.installedRelease.value;
  if (operation === 'reinstall') return _('✓ Эта версия уже установлена.');
  if (operation === 'upgrade') return _('Доступно обновление');
  if (operation === 'downgrade') return _('Будет установлена более ранняя версия.');
  if (operation === 'install') return _('Текущая версия не определена.');
  return installed && targetRelease && installed === targetRelease ? _('Эта версия уже установлена.') : _('Выберите доступную версию.');
}
function z2kTransition(component, selected, operation, targetRelease) {
  var installed = selected && selected.installedVersion || component.installedRelease && component.installedRelease.value;
  if (!installed || !targetRelease || installed === targetRelease) return null;
  if (operation === 'upgrade' || operation === 'downgrade') return installed + ' → ' + targetRelease;
  return null;
}
function z2kReleasePanelUpdate(ctx, component) {
  var selectedVersion = state.z2kSelectedVersion || component.selectedVersion;
  var componentDetails = component.selectedDetails && (!component.selectedDetails.version || component.selectedDetails.version === selectedVersion)
    ? component.selectedDetails
    : null;
  var selectedDetails = state.z2kDetails || componentDetails;
  var next = Object.assign({}, component, {
    selectedVersion: selectedVersion,
    selectedDetails: selectedDetails,
    operation: selectedDetails && selectedDetails.operation || null
  });
  var host = typeof document !== 'undefined' && document.getElementById('z2m-z2k-release-panel-host');
  if (host && typeof host.replaceChildren === 'function') host.replaceChildren(renderZ2KReleasePanel(ctx, next));
  else rerender(ctx);
}
function refreshZ2KDetailsPanel(ctx) {
  if (typeof state.z2kReleaseRefresh === 'function') state.z2kReleaseRefresh();
  else rerender(ctx);
}
function requestZ2KDetailsCompare(ctx) {
  if (!state.z2kSelectedVersion || state.componentOperation || state.z2kDetailsCompared || state.z2kDetailsLoading) return;
  state.z2kDetailsLoading = true;
  state.z2kDetailsLoadError = null;
  refreshZ2KDetailsPanel(ctx);
  loadZ2KVersionDetails(ctx, state.z2kSelectedVersion, true);
}
function retryZ2KDetails(ctx) {
  if (state.z2kDetailsLoading) return;
  requestZ2KDetailsCompare(ctx);
}
function toggleZ2KDetails(ctx) {
  if (state.z2kDetailsLoading) return;
  if (state.z2kDetailsExpanded) {
    state.z2kDetailsExpanded = false;
    refreshZ2KDetailsPanel(ctx);
    return;
  }
  state.z2kDetailsExpanded = true;
  if (!state.z2kDetailsCompared && !state.z2kDetailsLoadError) {
    requestZ2KDetailsCompare(ctx);
    return;
  }
  refreshZ2KDetailsPanel(ctx);
}
function z2kBusyActionLabel(operation) {
  if (operation && operation.kind === 'prepare') return _('⟳ Подготавливаем…');
  if (operation && operation.kind === 'refresh') return _('⟳ Проверяем состояние…');
  return _('⟳ Обновление…');
}
function renderZ2KPostMutationStatus(ctx) {
  var status = state.z2kPostMutationStatus;
  if (!status) return null;
  return E('div', { 'class': 'z2m-z2k-operation-result z2m-z2k-operation-result--success', role: 'status', 'aria-live': 'polite' }, [
    E('div', { 'class': 'z2m-z2k-operation-result-heading' }, [
      E('span', { 'class': 'z2m-z2k-operation-result-icon', 'aria-hidden': 'true' }, '✓'),
      E('strong', {}, status.title)
    ]),
    E('p', {}, status.message)
  ]);
}
function renderZ2KOperationError(ctx) {
  var error = state.z2kOperationError;
  if (!error) return null;
  var rollback = error.rollback;
  var rollbackMessage = rollback && (rollback.verified === true || rollback.ok === true || rollback.state === 'completed')
    ? _('Откат выполнен и проверен.')
    : rollback && rollback.requested === true
      ? _('Откат запрошен, но его результат не подтверждён.')
      : null;
  return E('div', { 'class': 'z2m-z2k-operation-result z2m-z2k-operation-result--error', role: 'alert', 'aria-live': 'assertive' }, [
    E('div', { 'class': 'z2m-z2k-operation-result-heading' }, [
      E('span', { 'class': 'z2m-z2k-operation-result-icon', 'aria-hidden': 'true' }, '✕'),
      E('strong', {}, _('Не удалось обновить Z2K'))
    ]),
    E('p', {}, error.message),
    rollbackMessage ? E('p', { 'class': 'z2m-z2k-operation-result-rollback' }, rollbackMessage) : null,
    ctx.shell.button(_('Проверить снова'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), !!state.componentOperation)
  ]);
}
function renderZ2KOperationHost(ctx, component) {
  var children = [];
  if (isBusyFor('z2k-core')) children.push(renderInlineOperation(ctx, component, operationRenderOptions()));
  var postMutationStatus = renderZ2KPostMutationStatus(ctx);
  var operationError = renderZ2KOperationError(ctx);
  if (postMutationStatus) children.push(postMutationStatus);
  if (operationError) children.push(operationError);
  return E('div', { id: 'z2m-z2k-operation-host', 'class': 'z2m-z2k-operation-host' }, children);
}
function renderZ2KReleasePanel(ctx, component) {
  var shell = ctx.shell;
  var selected = z2kSelectedDetails(component);
  if (!selected) return E('div', { id: 'z2m-z2k-release-panel', 'class': 'z2m-z2k-release-panel z2m-z2k-release-panel--empty', 'aria-live': 'polite', 'aria-busy': 'true' }, [
    renderZ2KOperationHost(ctx, component),
    E('div', { 'class': 'z2m-z2k-release-panel-loading', role: 'status', 'aria-live': 'polite' }, [
      E('span', { 'class': 'spinner-inline', 'aria-hidden': 'true' }),
      E('span', {}, _('Загружаем выбранную версию…'))
    ]),
    E('p', { 'class': 'z2m-dim' }, _('Смена версии только показывает её сведения и готовит безопасный план.'))
  ]);
  var targetRelease = selected.version || component.selectedVersion;
  var operation = selected.operation || z2kOperation(component);
  var unavailable = selected.installable !== true;
  var expanded = state.z2kDetailsExpanded === true;
  var date = z2kReleaseDate(ctx, selected);
  var transition = z2kTransition(component, selected, operation, targetRelease);
  var compare = selected.compareUrl ? E('a', { href: selected.compareUrl, target: '_blank', rel: 'noreferrer', 'class': 'z2m-z2k-release-compare' }, _('Сравнить upstream изменения ↗')) : null;
  var body = String(selected.releaseBody || '').trim();
  var changes = selected.deviceChanges || selected.installChanges || selected.changes || {};
  var changeCount = Number(changes.modified || 0) + Number(changes.added || 0) + Number(changes.removed || 0);
  var hasDeviceDetails = !unavailable && changes.known === true && (changeCount > 0 || operation === 'reinstall');
  var detailsLoading = state.z2kDetailsLoading === true && state.z2kDetailsCompared !== true;
  var detailsError = state.z2kDetailsLoadError;
  var operationBusy = isBusyFor('z2k-core');
  var releaseHeadingId = 'z2m-z2k-release-heading';
  var deviceHeadingId = 'z2m-z2k-device-heading';
  var releaseDetailsId = 'z2m-z2k-release-details';
  var changelog = E('div', { 'class': 'z2m-z2k-release-changelog' }, [
    E('strong', { id: releaseHeadingId }, _('Что нового в ') + targetRelease),
    body ? E('p', { 'class': 'z2m-z2k-release-body' }, body) : E('p', { 'class': 'z2m-z2k-release-body' }, _('Описание изменений для этого release не опубликовано.'))
  ]);
  var diff = unavailable ? null : E('div', { 'class': 'z2m-z2k-install-diff' }, [
    E('strong', { id: deviceHeadingId }, _('Что изменится на устройстве')),
    changes.known === false
      ? E('p', { 'class': 'z2m-z2k-release-no-diff' }, z2kChangeSummary(selected))
      : operation === 'reinstall' && !changes.modified && !changes.added && !changes.removed
      ? E('p', { 'class': 'z2m-z2k-release-no-diff' }, z2kChangeSummary(selected))
      : renderFactGrid([
        { label: _('Обновится'), value: Number(changes.modified || 0) },
        { label: _('Добавится'), value: Number(changes.added || 0) },
        { label: _('Удалится'), value: Number(changes.removed || 0) }
      ]),
    hasDeviceDetails ? E('div', { id: releaseDetailsId, role: 'region', 'aria-labelledby': deviceHeadingId, 'aria-busy': detailsLoading ? 'true' : 'false', 'class': 'z2m-z2k-release-details' + (expanded ? ' is-visible' : ''), hidden: expanded ? undefined : 'hidden' }, [
      E('strong', {}, _('Ресурсы, которые изменятся'))
    ].concat(renderZ2KManagedChangeDetails(changes, targetRelease), detailsLoading ? [E('div', { 'class': 'z2m-z2k-release-details-status', role: 'status', 'aria-live': 'polite' }, [
      E('span', { 'class': 'spinner-inline', 'aria-hidden': 'true' }),
      _('Загружаем подробности изменений…')
    ])] : [], detailsError ? [E('div', { 'class': 'z2m-z2k-release-details-error', role: 'alert' }, [
      E('strong', {}, _('Не удалось загрузить пояснения.')),
      E('p', {}, _('План изменений сохранён. Повторите попытку, чтобы получить пояснения.')),
      shell.button(_('Повторить'), 'sm', retryZ2KDetails.bind(null, ctx), false)
    ])] : [])) : null
  ]);
  var actionLabel = operationBusy ? z2kBusyActionLabel(state.componentOperation) : unavailable ? _('Установка недоступна') : z2kOperationLabel(operation, targetRelease);
  var actionEnabled = !operationBusy && !unavailable && !!operation && z2kCanApply(component);
  return E('div', { id: 'z2m-z2k-release-panel', 'class': 'z2m-z2k-release-panel' + (expanded ? ' is-expanded' : ''), 'aria-live': 'polite' }, [
    E('div', { 'class': 'z2m-z2k-release-panel-head' }, [
      E('div', { 'class': 'z2m-z2k-release-title' }, [
        E('h4', {}, selected.releaseName || targetRelease),
        date ? E('p', { 'class': 'z2m-z2k-release-date' }, date) : null
      ]),
      compare
    ]),
    E('div', { 'class': 'z2m-z2k-release-state ' + (unavailable ? 'is-unavailable' : '') }, [
      E('strong', {}, z2kSelectionMessage(component, selected, operation, targetRelease)),
      transition ? E('span', { 'class': 'z2m-z2k-release-transition' }, transition) : null,
      operation === 'install' && !unavailable ? E('p', { 'class': 'z2m-dim' }, _('Manager проверит установленные компоненты и приведёт их к состоянию выбранной версии.')) : null,
      operation === 'downgrade' && !unavailable ? E('p', { 'class': 'z2m-dim' }, _('При ошибке Manager запустит предусмотренный откат, а его результат будет показан в сообщении.')) : null,
      unavailable ? E('p', { 'class': 'z2m-dim' }, z2kUnavailableReason(selected)) : null
    ]),
    changelog,
    diff,
    hasDeviceDetails ? shell.button(detailsLoading ? [E('span', { 'class': 'spinner-inline', 'aria-hidden': 'true' }), _('Загрузка…')] : expanded ? _('Свернуть') : _('Подробнее'), 'sm', toggleZ2KDetails.bind(null, ctx), detailsLoading, {
      'aria-controls': releaseDetailsId,
      'aria-expanded': expanded ? 'true' : 'false',
      'aria-disabled': detailsLoading ? 'true' : 'false'
    }) : null,
    renderZ2KOperationHost(ctx, component),
    E('div', { 'class': 'z2m-z2k-release-actions' }, [
      shell.button(actionLabel, actionEnabled ? 'primary' : 'sm', updateZ2K.bind(null, ctx, component), !actionEnabled)
    ])
  ]);
}
function renderZ2KDetails(ctx, component) {
  var shell = ctx.shell;
  var componentDetails = component.details || {};
  var provenance = component.provenance || componentDetails.provenance || {};
  var isReady = (component.runtimeHealth || component.health) === 'ready';
  var catalog = z2kCatalogRows(component);
  var selectedVersion = component.selectedVersion || (catalog[0] && catalog[0].version) || null;
  var selected = z2kSelectedDetails(component);
  var catalogMessage = component.remoteState === 'unavailable'
    ? _('Удалённый каталог временно недоступен; установленное состояние сохранено.')
    : component.remoteState === 'empty'
      ? _('Upstream не опубликовал совместимых release для этого устройства.')
      : component.remoteState === 'stale'
        ? _('Показан последний сохранённый каталог. Перед изменением нужна свежая проверка.')
        : _('Каталог release ещё загружается.');
  state.z2kReleaseRefresh = function () { z2kReleasePanelUpdate(ctx, component); };
  var selector = catalog.length ? E('div', { 'class': 'z2m-z2k-release-picker' }, [
    E('label', { 'for': 'z2m-z2k-release-select' }, _('Выбрать версию')),
    E('select', { id: 'z2m-z2k-release-select', 'class': 'z2m-select', value: selectedVersion || '', 'aria-label': _('Выбор Z2K release'), disabled: isBusyFor('z2k-core') ? 'disabled' : undefined, change: function (event) {
      selectZ2KVersion(ctx, event && event.target ? event.target.value : this.value);
    } }, catalog.map(function (item) {
      return E('option', { value: item.version, selected: item.version === selectedVersion ? 'selected' : undefined }, z2kCatalogOptionLabel(item));
    }))
  ]) : E('p', { 'class': 'z2m-dim' }, catalogMessage);
  var reviewDetails = componentDetails.reviewDetails || [];
  var reviewPaths = reviewDetails.map(function (item) { return item && item.path; }).filter(Boolean).join(', ');
  return E('section', { 'class': 'z2m-component-details z2m-component-details--z2k', 'data-component-details': 'z2k-core' }, [
    E('div', { 'class': 'z2m-component-details-head' }, [
      E('div', { 'class': 'z2m-component-details-heading' }, [
        E('span', { 'class': 'z2m-component-details-kicker' }, _('УПРАВЛЕНИЕ РЕСУРСАМИ')),
        E('div', { 'class': 'z2m-component-details-title' }, [
          E('h3', {}, component.label),
          E('span', { 'class': 'z2m-chip ' + componentStateKind(component) }, componentStateLabel(component))
        ]),
        E('p', { 'class': 'z2m-dim' }, component.summary),
        E('span', { 'class': 'z2m-z2k-compatibility' }, _('Совместимость: ') + componentCompatibilityLabel(component))
      ]),
      E('div', { 'class': 'z2m-component-details-source' }, [
        E('span', { 'class': 'z2m-dim' }, _('Источник')),
        E('strong', { translate: 'no' }, provenance.source || 'necronicle/z2k')
      ])
    ]),
    renderFactGrid([
      { label: _('Установлено'), value: z2kReleaseLabel(component) },
      { label: _('Последняя'), value: z2kLatestRelease(component) },
      { label: _('Lua assets'), value: component.counters && component.counters.lua },
      { label: _('Целостность'), value: isReady ? _('Подтверждена') : _('Требует проверки') }
    ]),
    renderDetailSection(_('Версии'), E('div', { 'class': 'z2m-z2k-release-selection' }, [
      E('div', { 'class': 'z2m-z2k-current-version' }, [E('span', { 'class': 'z2m-dim' }, _('Текущая версия')), E('strong', {}, z2kReleaseLabel(component))]),
      selector,
      E('div', { id: 'z2m-z2k-release-panel-host' }, [renderZ2KReleasePanel(ctx, component)])
    ]), 'z2m-z2k-release-selection-section'),
    E('div', { 'class': 'z2m-z2k-release-check' }, [
      E('span', { 'class': 'z2m-dim' }, _('Последняя проверка: ') + formatLastCheck(shell, component.checkedAt)),
      shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core'))
    ]),
    renderReviewCallout(component),
    E('details', { 'class': 'z2m-component-technical' }, [
      E('summary', {}, _('Технические детали')),
      renderInfoRows([
        { label: _('Источник'), value: provenance.source },
        { label: _('Trust mode'), value: componentDetails.trustMode },
        { label: _('Выбранный release'), value: selectedVersion },
        { label: _('Проверяемые пути'), value: reviewPaths },
        { label: _('Причина проверки'), value: z2kReviewReason(component) },
        { label: _('Rebase'), value: component.rebases && component.rebases.length ? component.rebases.join(', ') : null }
      ])
    ])
  ]);
}
function operationRenderOptions() {
  var operation = state.componentOperation;
  return {
    phase: operationPhase(operation),
    progress: operation && typeof operation.progress === 'number' ? operation.progress : null,
    message: operation && operation.message || operationMessage(operation),
    stages: operation && Array.isArray(operation.stages) ? operation.stages : []
  };
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
  return E('div', { 'class': 'z2m-component-operation', role: 'status', 'aria-live': 'polite', 'aria-busy': isBusy ? 'true' : 'false' }, [
    E('div', { 'class': 'z2m-op-header' }, [
      isBusy ? E('span', { 'class': 'spinner-inline z2m-op-spinner', 'aria-hidden': 'true' }) : null,
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
  var hasUpdate = component.updateState === 'update-available' && component.canApply !== false;
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = engineMetaRows(component, engineStatus);
  // Contextual actions
  var primaryActions = [];
  if (hasUpdate) {
    primaryActions.push(shell.button(engineUpdateActionLabel(component), 'primary sm', engineActionWithCheck.bind(null, ctx, component, 'update', engineUpdateActionLabel(component)), !!state.componentOperation));
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
    catalogSourcePanel(ctx, component.catalog || { remoteState: component.remoteState }),
    E('div', { 'class': 'z2m-component-card-actions' }, [
      E('div', { 'class': 'z2m-btnrow' }, primaryActions),
      E('div', { 'class': 'z2m-btnrow' }, [manageBtn])
    ]),
    renderInlineOperation(ctx, component, isBusyFor(component.id) ? operationRenderOptions() : {}),
    renderEngineOperation(ctx, state.engineOperation),
    component.details && component.details.rebases && component.details.rebases.length ? E('p', { 'class': 'z2m-dim' }, _('Требуются rebase/review перед обновлением.')) : null
  ]);
}
function renderZ2KCard(ctx, component) {
  var shell = ctx.shell;
  var chipKind = componentStateKind(component);
  var chipLabel = componentStateLabel(component);
  var metaRows = z2kMetaRows(component);
  var primaryActions = [shell.button(_('Проверить обновления'), 'sm', checkUpdates.bind(null, ctx, 'z2k'), isBusyFor('z2k-core'))];
  if (!state.z2kExpanded && z2kCanApply(component)) {
    var updateActionLabel = z2kUpdateActionLabel(component);
    var updateActionClass = updateActionLabel.indexOf(_('Переустановить')) === 0 ? 'sm' : 'primary sm';
    primaryActions.unshift(shell.button(updateActionLabel, updateActionClass, updateZ2K.bind(null, ctx, component), isBusyFor('z2k-core')));
  }
  var detailsBtn = E('button', { 'class': 'z2m-btn sm' + (state.z2kExpanded ? ' on' : ''), click: toggleZ2K.bind(null, ctx), disabled: isBusyFor('z2k-core') ? 'disabled' : null, 'aria-expanded': state.z2kExpanded ? 'true' : 'false' }, [
    _('Подробнее'), E('span', { 'class': 'z2m-btn-chevron' }, Icons.html(state.z2kExpanded ? 'chevronUp' : 'chevronDown', { size: 12 }))
  ]);
  return E('article', { 'class': 'z2m-component-card z2m-component-card--z2k ' + component.health, 'data-component': component.id }, [
    E('div', { 'class': 'z2m-component-card-head' }, [
      E('div', { 'class': 'z2m-component-card-icon' }, Icons.wrappedNode('workflow', { size: 20, wrapperClass: 'z2m-card-icon-wrap' })),
      E('div', { 'class': 'z2m-component-card-title' }, [
        E('h3', {}, component.label),
        E('p', { 'class': 'z2m-dim' }, _('Ресурсы Z2K для обхода блокировок'))
      ]),
      E('span', { 'class': 'z2m-chip ' + chipKind }, chipLabel)
    ]),
    E('div', { 'class': 'z2m-component-card-meta' }, metaRows.map(function (row) {
      return E('div', { 'class': 'z2m-component-meta-row' }, [
        E('span', { 'class': 'z2m-dim' }, row.label),
        E('strong', {}, row.value)
      ]);
    })),
    renderReviewCallout(component),
    E('div', { 'class': 'z2m-component-card-actions' }, [
      E('div', { 'class': 'z2m-btnrow' }, primaryActions),
      E('div', { 'class': 'z2m-btnrow' }, [detailsBtn])
    ]),
    !state.z2kExpanded && isBusyFor(component.id) ? renderInlineOperation(ctx, component, operationRenderOptions()) : null,
  ]);
}
function renderZ2KPostMutationRefreshError(ctx) {
  if (!state.z2kPostMutationRefreshError) return null;
  return ctx.shell.statePanel({
    title: _('Обновление завершено.'),
    message: _('Не удалось подтвердить новое состояние.'),
    kind: 'error',
    actions: [ctx.shell.button(_('Обновить состояние'), 'sm', retryZ2KPostMutationRefresh.bind(null, ctx), !!state.componentOperation)]
  });
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
  var engineEnvelope = state.componentMetadata.engine || null;
  var engineCatalog = engineEnvelope && engineEnvelope.error
    ? { releases: [], remoteAvailable: false, remoteState: 'unavailable', source: null, error: engineEnvelope.error }
    : engineEnvelope && engineEnvelope.value !== undefined ? engineEnvelope.value : engineValue[0] || {};
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
  var resourceValue = payload.resources && payload.resources.value || {};
  var resourceZ2K = resourceValue.z2k || {};
  var catalogEnvelope = state.componentMetadata.z2k || payload.catalog;
  var catalogValue = catalogEnvelope && catalogEnvelope.error
    ? { versions: [], remoteAvailable: false, remoteState: 'unavailable', source: null, error: catalogEnvelope.error }
    : catalogEnvelope && catalogEnvelope.value !== undefined ? catalogEnvelope.value : resourceValue.catalog || resourceZ2K.catalog || {};
  var catalogState = catalogValue.remoteState || (catalogEnvelope ? 'not-loaded' : null);
  var catalogRows = Array.isArray(catalogValue.versions) ? catalogValue.versions : Array.isArray(catalogValue) ? catalogValue : [];
  var postMutationRefreshFailed = !!state.z2kPostMutationRefreshError;
  if (catalogValue && catalogState !== 'not-loaded') {
    state.z2kCatalog = catalogValue;
    if (catalogRows.length && !state.z2kSelectedVersion) {
      var selectedCatalog = catalogRows.find(function (item) { return item && item.installed; }) || catalogRows[0];
      state.z2kSelectedVersion = resourceZ2K.selectedVersion || selectedCatalog && selectedCatalog.version || null;
    }
  }
  var page = ComponentsModel.normalizePage({
    versions: payload.versions && payload.versions.value || {},
    engine: { status: engineStatus, catalog: engineCatalog },
    z2k: Object.assign({}, resourceZ2K, {
      catalog: catalogRows,
      remoteState: catalogState,
      remoteAvailable: catalogValue.remoteAvailable,
      selectedVersion: state.z2kSelectedVersion || resourceZ2K.selectedVersion,
      selectedDetails: postMutationRefreshFailed || state.z2kPostMutationStatus ? null : state.z2kDetails || resourceZ2K.selectedDetails,
      preparedTarget: postMutationRefreshFailed || state.z2kPostMutationStatus ? null : state.z2kPrepared || resourceZ2K.preparedTarget,
      updateState: postMutationRefreshFailed ? 'refresh-required' : state.z2kPostMutationStatus ? 'checking' : resourceZ2K.updateState,
      canApply: postMutationRefreshFailed || state.z2kPostMutationStatus ? false : resourceZ2K.canApply
    }),
    checkedAt: latestCanonicalTimestamp(
      payload.resources && payload.resources.value && payload.resources.value.checkedAt,
      state.lastSuccessfulCheckAt
    )
  });
  if (!state.engineOperationOverride)
    state.engineOperation = engineValue[2] && engineValue[2].operation || null;
  var engineComp = page.components.find(function (c) { return c.id === 'engine'; });
  var z2kComp = page.components.find(function (c) { return c.id === 'z2k-core'; });
  var hero = renderHero(ctx, page);
  var summaryText = mandatorySummary(page);
  return E('div', { 'class': 'z2m-components-page' }, [
    hero,
    renderZ2KPostMutationRefreshError(ctx),
    E('section', { 'class': 'z2m-components-section' }, [
      E('div', { 'class': 'z2m-components-section-head' }, [
        E('h2', {}, _('Обязательные компоненты')),
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
        E('h2', {}, _('Дополнительные компоненты')),
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
    (function() {
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
        return E('div', { 'class': 'z2m-components-advanced-row' }, [
          E('div', {}, [
            E('strong', {}, _('Расширенный режим')),
            E('p', { 'class': 'z2m-dim' }, _('Показывать технические данные и диагностические поля.'))
          ]),
          toggle
        ]);
      })()
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
  if (activePane(ctx) !== 'components') return;
  scheduleComponentMetadata(ctx);
  if (!ctx.api.engine || !ctx.api.engine.operationStatus) return;
  if (state.engineOperationTimer) window.clearInterval(state.engineOperationTimer);
  state.engineOperationTimer = window.setInterval(function () {
    var operation = state.engineOperation;
    if (!operation || engineOperationTerminal(operation) || state.engineOperationPolling) return;
    state.engineOperationPolling = true;
    ctx.api.engine.operationStatus({ id: operation.id }).then(function (answer) {
      var nextOperation = answer && answer.operation || null;
      state.engineOperationPolling = false;
      state.engineOperation = nextOperation;
      if (nextOperation && engineOperationTerminal(nextOperation)) {
        state.engineOperationOverride = false;
        state.skipEngineOperationStatus = true;
        return refresh(ctx);
      }
      state.engineOperationOverride = true;
      rerender(ctx);
      state.engineOperationOverride = false;
    }).catch(function () {
      state.engineOperationPolling = false;
    });
  }, 1500);
}
function unmount(ctx) {
  if (state.engineOperationTimer) window.clearInterval(state.engineOperationTimer);
  state.engineOperationTimer = null;
  state.engineOperationPolling = false;
  state.engineOperationOverride = false;
  if (state.componentHydrationTimer) window.clearTimeout(state.componentHydrationTimer);
  state.componentHydrationTimer = null;
  state.componentHydrationToken = null;
  state.componentLoadToken++;
  state.componentMetadata = {};
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
