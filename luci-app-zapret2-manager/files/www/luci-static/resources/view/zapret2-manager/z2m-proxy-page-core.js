'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-model as ProxyModel';
'require view.zapret2-manager.z2m-qr as Qr';
'require view.zapret2-manager.z2m-product-ux-model as ProductUX';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';

var FIELDS = [
  { id: 'enabled', label: _('Включено'), type: 'bool' },
  { id: 'autostart', label: _('Автозапуск'), type: 'bool' },
  { id: 'host', label: _('Адрес прослушивания'), type: 'text' },
  { id: 'port', label: _('Порт'), type: 'number' },
  { id: 'linkIp', label: _('Адрес в ссылке'), type: 'text' },
  { id: 'faketlsDomain', label: _('FakeTLS SNI'), type: 'text' },
  { id: 'dcIps', label: _('Маршруты Telegram DC'), type: 'list' },
  { id: 'cfDomains', label: _('Cloudflare домены'), type: 'list' },
  { id: 'cfWorkerDomains', label: _('CF Worker домены'), type: 'list' },
  { id: 'cfPriority', label: _('CF в приоритете'), type: 'bool' },
  { id: 'cfBalance', label: _('CF round-robin'), type: 'bool' },
  { id: 'defaultDomains', label: _('Стандартный список CF'), type: 'bool' },
  { id: 'outboundProxy', label: _('Исходящий proxy'), type: 'text' },
  { id: 'noProxy', label: _('Исключения исходящего proxy'), type: 'text' },
  { id: 'poolSize', label: _('WS pool на DC'), type: 'number' },
  { id: 'bufKb', label: _('Буфер сокета, KiB'), type: 'number' },
  { id: 'maxConnections', label: _('Максимум подключений'), type: 'number' },
  { id: 'quiet', label: _('Тихое логирование'), type: 'bool' },
  { id: 'verbose', label: _('Отладочный лог'), type: 'bool' }
];

var state = {
  pane: null,
  busy: null,
  revealed: null,
  preview: null,
  tgSelections: {},
  tgOperation: null,
  tgOperationTimer: null,
  tgOperationStartedAt: null,
  tgRetry: null,
  tgPollGeneration: 0,
  tgViewportLocked: false,
  tgReleaseExpanded: false,
  tgReleaseKey: null,
  tgReleaseCurrent: null,
  tgSettingsAdvanced: false,
  loadToken: 0,
  deferred: {},
  deferredTimer: null,
  deferredStartedToken: null,
  fullHealthRequested: false,
  tgLifecycle: null,
  tgHealthCheck: null,
  mountedLoadToken: null
};

var PANE_ALIASES = { install: 'component', status: 'overview', activity: 'journal' };
function paneId(value) { return PANE_ALIASES[value] || value; }

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function compact(value) { return array(value).filter(function (item) { return item !== null && item !== undefined; }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function display(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
function installedVersionDisplay(version, packageVersion) {
  return version !== null && version !== undefined && version !== '' ? String(version) : display(packageVersion);
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function settled(result, api) {
  if (result.status !== 'fulfilled') return { error: api.normalizeError(result.reason) };
  var value = result.value || {};
  return value && value.ok === false
    ? { error: api.normalizeError(value.error || value) }
    : { value: value };
}
// LuCI can receive the ubus HTTP response quickly but settle its RPC promise
// at the five-second client deadline. Keep a margin so successful responses
// are not rendered as session failures by this page-local guard.
var LOAD_TIMEOUT_MS = 15000;
// A lost polling response must become an explicit, actionable state. The
// provider transaction remains backend-owned, but the browser must never keep
// a user in an unbounded pending modal when its observation channel is gone.
var TG_OPERATION_MAX_WAIT_MS = 120000;
function boundedLoad(promise, label) {
  return new Promise(function (resolve, reject) {
    var finished = false;
    var timeout = window.setTimeout(function () {
      if (finished) return;
      finished = true;
      reject({ code: 'frontend-timeout', message: _('Не удалось дождаться ответа: ') + label });
    }, LOAD_TIMEOUT_MS);
    Promise.resolve(promise).then(function (value) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve(value);
    }, function (error) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      reject(error);
    });
  });
}
var TELEGRAM_EVENT_IDENTITIES = ['proxy', 'telegram-proxy', 'telegram_proxy', 'tg-proxy', 'tg_proxy', 'telegram'];
function normalizedEventIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}
function isTelegramEvent(event) {
  event = object(event);
  return ['component', 'subsystem', 'owner', 'source'].some(function (key) {
    return TELEGRAM_EVENT_IDENTITIES.indexOf(normalizedEventIdentity(event[key])) >= 0;
  });
}
function telegramEventRows(envelope) {
  var value = envelope && envelope.value !== undefined ? envelope.value : envelope;
  value = object(value);
  var rows = array(value.events || value.lines || value.items || value.rows || value.log);
  return rows.filter(isTelegramEvent);
}
function explicitHealthRead(ctx) {
  return edit(ctx.api.proxy.health, {});
}
function refreshLocalStatus(ctx) {
  return boundedLoad(ctx.api.tg.product.status(), _('статуса Telegram Proxy')).then(function (value) {
    var envelope = { value: value || {} };
    state.deferred.providerStatus = envelope;
    state.deferred.status = envelope;
    state.deferred.health = statusHealthEnvelope(envelope);
    return value;
  }, function (error) {
    var envelope = { error: ctx.api.normalizeError(error) };
    state.deferred.providerStatus = envelope;
    state.deferred.status = envelope;
    state.deferred.health = envelope;
    return null;
  });
}
function statusHealthEnvelope(statusEnvelope) {
  if (statusEnvelope && statusEnvelope.error) return { error: statusEnvelope.error };
  var value = statusEnvelope && statusEnvelope.value;
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) { value = value[0]; continue; }
    if (value && typeof value === 'object' && value.value !== undefined) { value = value.value; continue; }
    break;
  }
  return { value: object(value && value.health) };
}
function scheduleDeferred(ctx, token, requestHealth) {
  if (!ctx || state.deferredStartedToken === token) return;
  state.deferredStartedToken = token;
  if (requestHealth && !state.busy && !state.tgHealthCheck) {
    state.tgHealthCheck = { status: 'pending' };
    state.tgLifecycle = { status: 'checking', action: 'health', message: _('Проверяем доступность Telegram…') };
  }
  function rerender() {
    if (token !== state.loadToken || !ctx || typeof ctx.rerender !== 'function') return;
    window.setTimeout(function () {
      if (token === state.loadToken) ctx.rerender();
    }, 0);
  }
  function publish(job, result) {
    if (token !== state.loadToken) return;
    var value = settled(result, ctx.api);
    if (job.keys) job.keys.forEach(function (key) { state.deferred[key] = value; });
    else state.deferred[job.key] = value;
    if (job.key === 'health') {
      var healthWasPending = state.tgHealthCheck && state.tgHealthCheck.status === 'pending';
      state.tgHealthCheck = null;
      if (healthWasPending || state.busy === 'health') {
        if (state.busy === 'health') state.busy = null;
        if (state.tgLifecycle && state.tgLifecycle.action === 'health') state.tgLifecycle = value.error ? {
          status: 'error',
          action: 'health',
          message: _('Не удалось подтвердить подключение Telegram.')
        } : null;
      }
    }
    rerender();
  }
  var jobs = [
    { key: 'status', label: _('статуса proxy'), run: function () { return ctx.api.proxy.status(); } },
    { keys: ['providerCatalog', 'providerPreflight'], label: _('каталога Telegram Proxy'), run: function () {
      return ctx.api.tg.product.catalog();
    } },
    { key: 'providerVersions', label: _('версий Telegram Proxy'), run: function () {
      return ctx.api.tg.product.versions();
    } },
    { key: 'events', label: _('журнала proxy'), run: function () {
      return edit((ctx.api.maintenance && ctx.api.maintenance.eventsTail) || ctx.api.monitor.eventsTail, { limit: 50 });
    } }
  ];
  // Keep the existing two-slot metadata scheduler predictable. Health is
  // already visible as pending, and runs after the ordinary deferred reads
  // instead of starving catalog/version/journal hydration.
  if (requestHealth) jobs.push({ key: 'health', label: _('состояния Telegram Proxy'), run: function () {
    return explicitHealthRead(ctx);
  } });
  var next = 0, active = 0;
  function pump() {
    if (token !== state.loadToken) return;
    while (active < 2 && next < jobs.length) {
      (function (job) {
        active++;
        Promise.resolve().then(function () { return boundedLoad(job.run(), job.label); })
          .then(function (value) { publish(job, { status: 'fulfilled', value: value }); },
            function (error) { publish(job, { status: 'rejected', reason: error }); })
          .then(function () { active--; pump(); });
      })(jobs[next++]);
    }
  }
  state.deferredTimer = window.setTimeout(function () {
    state.deferredTimer = null;
    pump();
  }, 0);
}
function load(ctx) {
  var token = ++state.loadToken;
  state.deferred = {};
  if (state.deferredTimer) clearTimeout(state.deferredTimer);
  state.deferredTimer = null;
  // Keep the local bootstrap fast, then verify Telegram in the deferred pass
  // on every Overview visit so a new tab never gets stuck on an old warning.
  var requestHealth = false;
  state.fullHealthRequested = false;
  // tg_product_status is the canonical local aggregator. It already includes
  // proxy runtime/config health with upstream:false, so it is the sole source
  // for the initial provider status; the explicit health action is deferred.
  return Promise.allSettled([
    boundedLoad(ctx.api.tg.product.status(), _('статуса Telegram Proxy')),
    boundedLoad(ctx.api.proxy.capabilities(), _('возможностей proxy')),
    boundedLoad(ctx.api.proxy.configGet(), _('конфигурации proxy')),
    boundedLoad(ctx.api.tg.product.operationStatus({}), _('операции Telegram Proxy'))
  ]).then(function (results) {
    var providerStatus = settled(results[0], ctx.api);
    var base = {
      capabilities: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      providerStatus: providerStatus,
      status: providerStatus,
      health: statusHealthEnvelope(providerStatus),
      providerOperation: settled(results[3], ctx.api),
      providerUpdates: { value: {} }
    };
    scheduleDeferred(ctx, token, requestHealth);
    return base;
  });
}
function appliedConfig(data) {
  var config = object(data.config && data.config.value);
  return ProxyModel.safeSettings(config.applied || config.config || config.draft || {});
}
function revision(data) {
  var config = object(data.config && data.config.value);
  return config.appliedRevision !== undefined ? config.appliedRevision :
    config.revision !== undefined ? config.revision : object(config.applied).revision;
}
function currentDraft(ctx) {
  return object(ctx.store.get().draft && ctx.store.get().draft.proxy);
}
function workingConfig(ctx, data) {
  var draft = currentDraft(ctx);
  return Object.keys(object(draft.settings)).length ? clone(draft.settings) : appliedConfig(data);
}
function showError(ctx, error) {
  var mapped = ProductUX.errorMessage(ctx.api.normalizeError(error));
  ctx.shell.showToast(mapped.message, 'err');
}
function showErrorState(ctx, error, fallback) {
  var shell = ctx.shell;
  var mapped = ProductUX.errorMessage(error, fallback);
  return E('div', { 'class': 'z2m-product-error' }, [shell.statePanel({
    title: mapped.message,
    message: _('Telegram Proxy опционален и не влияет на остальные функции Zapret 2 Manager.'),
    kind: 'error'
  }), E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Сведения об ошибке')), E('code', {}, mapped.technical)])]);
}
function rerenderProxy(ctx) {
  if (ctx && typeof ctx.rerender === 'function') return ctx.rerender();
  return null;
}
function mutation(ctx, name, run, pendingMessage) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  state.tgLifecycle = { status: 'pending', action: name, message: pendingMessage || _('Выполняем операцию…') };
  rerenderProxy(ctx);
  return Promise.resolve().then(function () {
    return typeof run === 'function' ? run() : run;
  }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.tgLifecycle = { status: 'refreshing', action: name, message: _('Проверяем состояние…') };
    rerenderProxy(ctx);
    return refreshLocalStatus(ctx).then(function () {
      state.busy = null;
      state.tgLifecycle = null;
      rerenderProxy(ctx);
      return answer;
    });
  }).catch(function (error) {
    state.busy = null;
    state.tgLifecycle = { status: 'error', action: name, message: ProductUX.errorMessage(ctx.api.normalizeError(error)).message };
    rerenderProxy(ctx);
    showError(ctx, error);
    return null;
  });
}

function tgOperationLabel(stage) {
  var labels = {
    PREPARE: _('Подготовка'), PREFLIGHT: _('Проверяем выбранный релиз'), DOWNLOAD: _('Скачиваем'),
    VERIFY: _('Проверяем целостность'), BACKUP: _('Создаём точку отката'), INSTALL: _('Устанавливаем'),
    CONFIG_VALIDATE: _('Проверяем конфигурацию'), RESTART: _('Запускаем сервис'),
    HEALTHCHECK: _('Проверяем Telegram Proxy'), COMMIT: _('Готово'),
    STOP: _('Останавливаем'), REMOVE: _('Удаляем провайдер'),
    ROLLING_BACK: _('Откат'), ROLLED_BACK: _('Откат выполнен')
  };
  return labels[stage] || display(stage);
}
function operationTitle(operation) {
  var titles = {
    INSTALL: _('Установка'), UPDATE: _('Обновление'), DOWNGRADE: _('Откат версии'),
    SWITCH: _('Переключение'), REMOVE: _('Удаление')
  };
  var base = titles[operation && operation.type] || _('Изменение TG Proxy');
  if (operation && operation.type !== 'REMOVE' && operation.provider)
    base += ' ' + (operation.provider === 'rust' ? 'Rust' : 'Go');
  if (operation && operation.type !== 'REMOVE' && operation.version)
    base += ' ' + operation.version;
  return base;
}
function tgViewportLock(locked) {
  if (state.tgViewportLocked === locked) return;
  state.tgViewportLocked = locked;
  var body = document && document.body;
  if (!body) return;
  if (locked) {
    body.classList.add('z2m-tg-operation-running');
    body.dataset.z2mTgOverflow = body.style.overflow || '';
    body.style.overflow = 'hidden';
    state.tgEscapeBlock = function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
    };
    state.tgClickBlock = function (event) {
      var target = event.target;
      if (!target || !target.closest || !target.closest('.z2m-modal')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', state.tgEscapeBlock, true);
    document.addEventListener('click', state.tgClickBlock, true);
  } else {
    body.classList.remove('z2m-tg-operation-running');
    body.style.overflow = body.dataset.z2mTgOverflow || '';
    document.removeEventListener('keydown', state.tgEscapeBlock, true);
    document.removeEventListener('click', state.tgClickBlock, true);
  }
}
function tgOperationBody(operation) {
  var running = operation && (operation.status === 'RUNNING' || operation.status === 'ROLLING_BACK');
  var failed = operation && operation.status === 'FAILED';
  var rolledBack = operation && (operation.status === 'ROLLED_BACK' || operation.rollbackState === 'ROLLED_BACK');
  var unknown = operation && operation.status === 'UNKNOWN';
  var rollbackBroken = operation && operation.rollbackState === 'ROLLBACK_FAILED';
  var errorText = operation && operation.error && operation.error.message || operation && operation.recoveryError;
  var percent = Math.max(0, Math.min(100, Number(operation && operation.progress || 0)));
  var body = [E('strong', {}, running ? operationTitle(operation) + '…' : failed ? operationTitle(operation) + ' — не выполнено' : operation.status === 'COMPLETE' ? operationTitle(operation) + ' — готово' : operationTitle(operation))];
  if (running) body.push(E('p', {}, display(operation && operation.message) !== '—' ? display(operation.message) : _('Дождитесь завершения: при ошибке сервер восстановит предыдущее состояние.')));
  if (failed || rolledBack || unknown) {
    body.push(E('div', { 'class': 'z2m-proxy-op-facts' }, compact([
      operation && operation.stage ? E('div', {}, [E('span', {}, _('Этап: ')), E('strong', {}, tgOperationLabel(operation.stage))]) : null,
      errorText ? E('div', {}, [E('span', {}, _('Причина: ')), E('strong', {}, errorText)]) : null,
      unknown ? E('div', { 'class': 'z2m-proxy-provider-unavailable' }, _('Результат операции не подтверждён. Проверьте журнал и состояние сервиса перед повторной попыткой.')) : null,
      rolledBack ? E('div', { 'class': 'z2m-proxy-ok' }, _('Предыдущая версия восстановлена ✓')) : null,
      rollbackBroken ? E('div', { 'class': 'z2m-proxy-provider-unavailable' }, _('⚠ Автоматический откат не удался — проверьте журнал.')) : null
    ])));
    if (operation && operation.error && operation.error.code)
      body.push(E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Технические детали')), E('code', {}, display(operation.error.code))]));
  }
  if (running) {
    body.push(E('div', { 'class': 'z2m-tg-operation-stage' }, [E('span', {}, tgOperationLabel(operation && operation.stage)), E('strong', {}, percent + '%')]));
    body.push(E('div', { 'class': 'z2m-progress-track', role: 'progressbar',
      'aria-label': tgOperationLabel(operation && operation.stage), 'aria-valuemin': 0,
      'aria-valuemax': 100, 'aria-valuenow': percent },
      E('div', { 'class': 'z2m-progress-bar', style: 'width:' + percent + '%' })));
  }
  return E('div', { 'class': 'z2m-tg-operation-body', role: 'status', 'aria-live': 'polite' }, body);
}
function normalizeOperation(record) {
  if (!record) return null;
  var op = Object.assign({}, record);
  if (!op.status && op.state) op.status = op.state;
  if (op.progress == null) op.progress = 0;
  return op;
}
function renderTgOperationModal(ctx, operation) {
  if (!operation) return;
  var running = operation.status === 'RUNNING' || operation.status === 'ROLLING_BACK';
  tgViewportLock(running);
  var footer = [];
  if (!running && (operation.status === 'FAILED' || operation.status === 'ROLLED_BACK') && state.tgRetry)
    footer.push(ctx.shell.button(_('Повторить'), 'danger sm', function () {
      ctx.shell.closeModal();
      tgViewportLock(false);
      state.tgOperation = null;
      state.tgRetry();
    }));
  if (!running) footer.push(ctx.shell.button(_('Завершить'), 'primary sm', function () {
    ctx.shell.closeModal();
    tgViewportLock(false);
    state.tgOperation = null;
    state.tgOperationStartedAt = null;
    state.tgRetry = null;
    state.busy = null;
    state.tgLifecycle = null;
    if (state.tgOperationTimer) { clearTimeout(state.tgOperationTimer); state.tgOperationTimer = null; }
    ctx.refresh('proxy');
  }));
  ctx.shell.openModal(operationTitle(operation), tgOperationBody(operation), footer);
  var close = document.querySelector('#z2m-modal .z2m-modal-close');
  if (close && running) { close.hidden = true; close.disabled = true; }
}
function operationWaitExpired(ctx) {
  if (!state.tgOperationStartedAt || Date.now() - state.tgOperationStartedAt < TG_OPERATION_MAX_WAIT_MS) return false;
  state.busy = 'operation-unknown';
  state.tgRetry = null;
  state.tgOperation = Object.assign({}, state.tgOperation, {
    status: 'UNKNOWN',
    recoveryError: _('Не удалось получить итог операции за отведённое время.')
  });
  renderTgOperationModal(ctx, state.tgOperation);
  return true;
}
function watchTgOperation(ctx, operationId, retry, meta) {
  if (state.tgOperationTimer) clearTimeout(state.tgOperationTimer);
  state.tgOperationTimer = null;
  state.tgPollGeneration++;
  var generation = state.tgPollGeneration;
  state.tgOperationStartedAt = Date.now();
  state.tgOperation = normalizeOperation(Object.assign({ status: 'RUNNING', stage: 'PREPARE', progress: 5 }, meta || {}, { operationId: operationId }));
  state.tgRetry = retry || null;
  renderTgOperationModal(ctx, state.tgOperation);
  function poll() {
    if (generation !== state.tgPollGeneration) return;
    if (operationWaitExpired(ctx)) return;
    boundedLoad(ctx.api.tg.product.operationStatus(operationId ? { operationId: operationId } : {}), _('состояния операции Telegram Proxy')).then(function (answer) {
      if (generation !== state.tgPollGeneration) return;
      if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Состояние операции недоступно.'));
      var op = normalizeOperation(answer.operation);
      if (!op) return;
      state.tgOperation = op;
      renderTgOperationModal(ctx, op);
      if (op.status === 'RUNNING' || op.status === 'ROLLING_BACK') state.tgOperationTimer = setTimeout(poll, 800);
    }).catch(function (error) {
      if (generation !== state.tgPollGeneration) return;
      // The operation remains backend-owned; keep the modal and recover on the next poll.
      state.tgOperation = Object.assign({}, state.tgOperation, { recoveryError: ctx.api.normalizeError(error).message });
      renderTgOperationModal(ctx, state.tgOperation);
      state.tgOperationTimer = setTimeout(poll, 1500);
    });
  }
  poll();
}
// Re-attach after a page (re)load: poll the durable record until it reaches a
// terminal state, so an in-flight transaction is never silently lost.
function watchAttachedTgOperation(ctx) {
  var generation = ++state.tgPollGeneration;
  if (!state.tgOperationStartedAt) state.tgOperationStartedAt = Date.now();
  function poll() {
    if (generation !== state.tgPollGeneration) return;
    if (operationWaitExpired(ctx)) return;
    boundedLoad(ctx.api.tg.product.operationStatus({}), _('состояния операции Telegram Proxy')).then(function (answer) {
      if (generation !== state.tgPollGeneration) return;
      var op = normalizeOperation(answer && answer.operation);
      if (!op) return;
      state.tgOperation = op;
      renderTgOperationModal(ctx, op);
      if (op.status === 'RUNNING' || op.status === 'ROLLING_BACK') state.tgOperationTimer = setTimeout(poll, 800);
    }).catch(function () {
      if (generation !== state.tgPollGeneration) return;
      state.tgOperationTimer = setTimeout(poll, 1500);
    });
  }
  poll();
}
function showOperationFailure(ctx, retry, error) {
  // Prefer the durable operation record (stage/reason/rollback) over a raw toast.
  boundedLoad(ctx.api.tg.product.operationStatus({}), _('состояния операции Telegram Proxy')).then(function (answer) {
    var op = normalizeOperation(answer && answer.operation);
    if (op && (op.status === 'RUNNING' || op.status === 'ROLLING_BACK')) {
      watchTgOperation(ctx, op.operationId, retry, op);
      return;
    }
    if (op && (op.status === 'FAILED' || op.status === 'ROLLED_BACK')) {
      state.tgOperation = op;
      state.tgRetry = retry || null;
      renderTgOperationModal(ctx, op);
      return;
    }
    throw error || new Error(_('Операция не выполнена.'));
  }).catch(function (e) { showError(ctx, e); });
}
// The backend transaction is synchronous by contract: the switch RPC resolves
// to { ok, provider, version, health } in one round trip, with live stage
// progress served from the durable record while it runs.
function finishTgTransaction(ctx, answer, retry) {
  state.tgPollGeneration++;
  if (answer && answer.operationId) { watchTgOperation(ctx, answer.operationId, retry); return; }
  boundedLoad(ctx.api.tg.product.operationStatus({}), _('состояния операции Telegram Proxy')).then(function (opAnswer) {
    var op = normalizeOperation(opAnswer && opAnswer.operation);
    if (op && op.status !== 'COMPLETE') {
      state.tgOperation = op;
      state.tgRetry = retry || null;
      renderTgOperationModal(ctx, op);
      return;
    }
    showSuccessModal(ctx, answer);
  }).catch(function () { showSuccessModal(ctx, answer); });
}
function showSuccessModal(ctx, answer) {
  var shell = ctx.shell;
  state.tgLifecycle = null;
  state.busy = null;
  state.tgOperationStartedAt = null;
  var identity = answer && answer.provider ? String(answer.provider).toUpperCase() : '';
  if (answer && answer.version) identity += ' ' + answer.version;
  if (answer && answer.changed === false) {
    shell.showToast(_('Версия уже установлена.'), 'ok');
    return ctx.refresh('proxy');
  }
  shell.openModal(_('Готово'), E('div', { 'class': 'z2m-tg-confirm-body' }, [
    E('strong', {}, identity || _('Готово')),
    E('p', {}, _('Сервер установил выбранную версию, перезапустил сервис и подтвердил локальную проверку.'))
  ]), [shell.button(_('Завершить'), 'primary sm', function () {
    shell.closeModal();
    ctx.refresh('proxy');
  })]);
}
function tgTransactionConfirm(ctx, kind, provider, item, start) {
  var labels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Установить и переключиться') };
  var titles = { INSTALL: _('Установить TG Proxy?'), UPDATE: _('Обновить TG Proxy?'), DOWNGRADE: _('Откатить версию TG Proxy?'), PROVIDER_SWITCH: _('Переключить реализацию TG Proxy?') };
  var messages = {
    INSTALL: _('Будет подготовлен и проверен выбранный релиз, затем сервис запустится и пройдёт проверку подключения.'),
    UPDATE: _('Будет скачано обновление, сервис перезапустится; при ошибке предыдущая версия восстановится автоматически.'),
    DOWNGRADE: _('Будет установлена выбранная более старая версия с сохранением настроек и откатом при ошибке.'),
    PROVIDER_SWITCH: _('Текущий провайдер останется активным до успешной проверки нового; при ошибке сервер выполнит откат.')
  };
  ctx.shell.openModal(titles[kind], E('div', { 'class': 'z2m-tg-confirm-body' }, [
    E('strong', {}, provider.title + ' · ' + display(item.version)), E('p', {}, messages[kind])
  ]), [ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal), ctx.shell.button(labels[kind], 'primary sm', function () {
    ctx.shell.closeModal();
    start();
  })]);
}
function tgUninstallConfirm(ctx, purge, start) {
  ctx.shell.openModal(purge ? _('Удалить TG Proxy и настройки?') : _('Удалить TG Proxy?'), E('div', { 'class': 'z2m-tg-confirm-body' }, [
    E('strong', {}, purge ? _('Полная очистка') : _('Сохранить настройки')),
    E('p', {}, purge ? _('Сервер удалит провайдер, конфигурацию и секрет после подтверждения операции.') : _('Сервер удалит провайдер, но сохранит конфигурацию и секрет для последующей установки.'))
  ]), [ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal), ctx.shell.button(purge ? _('Удалить полностью') : _('Удалить'), 'danger sm', function () {
    ctx.shell.closeModal();
    start();
  })]);
}
function stage(ctx, data, settings) {
  setLocalSettings(ctx, data, settings);
}
function getLocalSettings(ctx, data) {
  if (state.tgSettingsLocal && state.tgSettingsLocal.revision === revision(data)) return clone(state.tgSettingsLocal.settings);
  return clone(workingConfig(ctx, data));
}
function setLocalSettings(ctx, data, settings) {
  state.tgSettingsLocal = { revision: revision(data), settings: ProxyModel.safeSettings(settings) };
  ctx.root.replaceChildren(render(ctx));
}
function isSettingsDirty(ctx, data) {
  if (!state.tgSettingsLocal) return false;
  var applied = ProxyModel.safeSettings(appliedConfig(data));
  var local = ProxyModel.safeSettings(getLocalSettings(ctx, data));
  return JSON.stringify(applied) !== JSON.stringify(local);
}
function resetLocalSettings(ctx, data) {
  state.tgSettingsLocal = null;
  ctx.root.replaceChildren(render(ctx));
}
function saveSettings(ctx, data) {
  var local = getLocalSettings(ctx, data);
  var rev = revision(data);
  ctx.shell.showToast(_('Сохраняем…'), 'info');
  edit(ctx.api.proxy.configValidate, { config: local }).then(function (v) {
    if (!v || v.ok === false) throw v && v.error || new Error('validate failed');
    return edit(ctx.api.proxy.configApply, { config: local, expectedAppliedRevision: rev });
  }).then(function (res) {
    if (!res || res.ok === false) throw res && res.error || new Error('apply failed');
    state.tgSettingsLocal = null;
    ctx.shell.showToast(_('Настройки сохранены.'), 'ok');
    return ctx.refresh('proxy');
  }).catch(function (e) { showError(ctx, e); });
}
function truthLabel(truth) {
  var labels = {
    stopped: _('Остановлен'), starting: _('Запускается'), healthy: _('Работает'),
    degraded: _('Деградация'), unsupported: _('Не установлен'), error: _('Ошибка')
  };
  return labels[truth] || truth;
}
function truthKind(truth) {
  return truth === 'healthy' ? 'g' : truth === 'stopped' || truth === 'starting' ? 'o' : 'r';
}
function confirm(ctx, title, message, label, action, danger) {
  return ctx.shell.avatar.confirm({
    title: title,
    message: message,
    okLabel: label,
    className: danger === false ? '' : 'danger'
  }).then(function (accepted) {
    if (accepted) return action();
    return null;
  });
}
function reveal(ctx) {
  confirm(ctx, _('Показать секретную ссылку?'),
    _('Ссылка содержит proxy secret. Она не будет сохранена.'),
    _('Показать'), function () {
      edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (answer) {
        var url = answer && (answer.https_link || answer.link);
        if (!url) throw answer || new Error('proxy link unavailable');
        state.revealed = url;
        ctx.shell.openModal(_('QR-код Telegram Proxy'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
          E('code', { 'class': 'z2m-proxy-link' }, url),
          Qr.render(url, 240),
          E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Скопировать ссылку'), 'primary sm', function () {
            function fallbackCopy(text) {
              try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '0';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                try { ta.setSelectionRange(0, 99999); } catch (e) {}
                var ok = false;
                try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
                if (!ok && window.getSelection) {
                  var range = document.createRange();
                  range.selectNodeContents(ta);
                  var sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                  try { ok = document.execCommand('copy'); } catch (e) {}
                  sel.removeAllRanges();
                }
                document.body.removeChild(ta);
                return ok;
              } catch (e) { return false; }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(function () {
                ctx.shell.showToast(_('Ссылка скопирована.'), 'ok');
              }).catch(function () {
                if (fallbackCopy(url)) ctx.shell.showToast(_('Ссылка скопирована.'), 'ok');
                else ctx.shell.showToast(_('Не удалось скопировать ссылку.'), 'err');
              });
            } else {
              if (fallbackCopy(url)) ctx.shell.showToast(_('Ссылка скопирована.'), 'ok');
              else ctx.shell.showToast(_('Буфер обмена недоступен в этом браузере.'), 'err');
            }
          })]), E('a', { href: url, target: '_blank', rel: 'noopener noreferrer', 'class': 'z2m-btn primary sm z2m-proxy-open-tg', style: 'text-decoration:none' }, _('Открыть Telegram')),
          E('div', { 'class': 'z2m-dim' }, _('Закрытие окна удалит ссылку из UI state.'))
        ]), [ctx.shell.button(_('Закрыть'), '', function () {
          state.revealed = null;
          ctx.shell.closeModal();
        })]);
      }).catch(showError.bind(null, ctx));
    }, false);
}
function lifecycle(ctx, method, label, message, pendingMessage) {
  confirm(ctx, label + '?', message, label, function () {
    mutation(ctx, label, method, pendingMessage);
  });
}
function lifecycleFeedback(operation) {
  if (!operation) return null;
  var pending = operation.status === 'pending' || operation.status === 'refreshing' || operation.status === 'checking';
  var failed = operation.status === 'error';
  return E('div', {
    'class': 'z2m-component-operation z2m-proxy-lifecycle-feedback' + (failed ? ' error' : ''),
    role: failed ? 'alert' : 'status',
    'aria-live': failed ? 'assertive' : 'polite',
    'aria-busy': pending ? 'true' : 'false'
  }, compact([
    E('div', { 'class': 'z2m-op-header' }, [
      pending ? E('span', { 'class': 'spinner-inline z2m-op-spinner', 'aria-hidden': 'true' }) : E('span', { 'class': 'z2m-proxy-feedback-dot', 'aria-hidden': 'true' }),
      E('strong', {}, operation.message)
    ]),
    pending ? E('div', { 'class': 'z2m-op-progress z2m-op-progress--indeterminate', role: 'progressbar', 'aria-label': _('Выполнение операции') }, E('div', { 'class': 'z2m-op-progress-bar' })) : null
  ]));
}
function refreshWithHealth(ctx) {
  if (state.busy) return Promise.resolve(null);
  state.busy = 'health';
  state.tgHealthCheck = { status: 'pending' };
  state.tgLifecycle = { status: 'checking', action: 'health', message: _('Проверяем доступность Telegram…') };
  state.fullHealthRequested = true;
  rerenderProxy(ctx);
  return explicitHealthRead(ctx).then(function (value) {
    state.deferred.health = { value: value || {} };
    state.busy = null;
    state.tgHealthCheck = null;
    state.tgLifecycle = null;
    rerenderProxy(ctx);
    return value;
  }).catch(function (error) {
    if (state.busy !== 'health') return null;
    state.busy = null;
    state.tgHealthCheck = null;
    state.tgLifecycle = { status: 'error', action: 'health', message: _('Не удалось обновить проверку Telegram.') };
    rerenderProxy(ctx);
    showError(ctx, error);
    return null;
  });
}
function providerStatus(data) {
  return object(data.providerStatus && data.providerStatus.value);
}
function providerInstalled(value) {
  if (Array.isArray(value)) return value.some(function (item) { return item && item.installed === true; });
  return value === true;
}
function canonicalProjection(status, fallbackHealth) {
  status = object(status);
  var runtime = object(status.runtime);
  var health = object(status.health);
  var route = object(health.route);
  var upstream = object(route.upstream);
  var fallbackRoute = object(object(fallbackHealth).route);
  var fallbackUpstream = object(fallbackRoute.upstream);
  if (fallbackUpstream.ok === true) upstream = fallbackUpstream;
  var checks = array(health.checks);
  var listenerCheck = checks.some(function (item) {
    return item && item.name === 'listener' && item.ok === true;
  });
  var listeners = array(runtime.listeners);
  return {
    process: status.status === 'running' || runtime.running === true || object(status.observed).running === true,
    listener: listenerCheck || route.local && route.local.ok === true || listeners.some(function (item) {
      return item && item.address && item.port !== undefined;
    }),
    outbound: upstream.ok === true || status.outbound === true,
    activeConnections: runtime.activeConnections,
    drift: status.drift === true
  };
}
function providerCatalog(data) {
  var providers = array(object(data.providerCatalog && data.providerCatalog.value).providers);
  if (providers.length) return providers;
  return providerVersions(data).map(function (item) {
    var id = item && (item.id || item.provider);
    return {
      id: id,
      provider: id,
      title: id === 'rust' ? 'Rust' : id === 'go' ? 'Go' : id,
      available: true
    };
  }).filter(function (item) { return item.id; });
}
function providerVersions(data) {
  return array(object(data.providerVersions && data.providerVersions.value).providers);
}
function activeProviderLabel(data, status) {
  var id = status && status.activeProvider;
  var provider = providerCatalog(data).filter(function (item) { return item && item.id === id; })[0] || {};
  return provider.title || provider.name || (id === 'rust' ? 'Rust' : id === 'go' ? 'Go' : id || '—');
}
function activeUpdateState(data, status) {
  if (!providerInstalled(status && status.installed)) return { state: 'off', label: _('Не установлено') };
  var row = providerVersions(data).filter(function (item) { return item && item.id === status.activeProvider; })[0] || {};
  var choices = versionChoices(array(row.versions));
  var latest = choices.filter(function (item) { return item && item.sourceId === 'official-github-release'; })[0] || choices[0];
  if (!latest || !latest.version || !status.activeVersion) return { state: 'unknown', label: _('Проверка недоступна') };
  if (releaseVersionCompare(latest.version, status.activeVersion) > 0) return { state: 'degraded', label: _('Доступно обновление') };
  return { state: 'ok', label: _('Актуально') };
}
function providerIcon(provider) {
  return E('span', { 'class': 'z2m-proxy-provider-icon ' + provider, 'aria-hidden': 'true' },
    E('img', { src: L.resource('view/zapret2-manager/icons/' + provider + '.svg'), alt: '' }));
}
function providerBenefits(provider) {
  if (provider === 'rust') return {
    title: _('Лучше обходит сложные блокировки'),
    items: [
      _('Автоматически пробует несколько способов подключения'),
      _('Быстрее восстанавливает соединение при недоступном маршруте'),
      _('Рекомендуется для большинства пользователей')
    ]
  };
  return {
    title: _('Простой базовый вариант'),
    items: [
      _('Подходит, если обычное подключение уже работает'),
      _('Поддерживает основные способы обхода блокировок'),
      _('Меньше дополнительных возможностей, чем у Rust')
    ]
  };
}

function candidateForVersion(versions, version) {
  return array(versions).filter(function (item) { return item && item.version === version; }).sort(function (left, right) {
    if (left.installable === true && right.installable !== true) return -1;
    if (right.installable === true && left.installable !== true) return 1;
    if (left.sourceId === 'official-github-release' && right.sourceId !== 'official-github-release') return -1;
    if (right.sourceId === 'official-github-release' && left.sourceId !== 'official-github-release') return 1;
    return 0;
  })[0] || {};
}

function versionChoices(versions) {
  var seen = {};
  return array(versions).filter(function (item) {
    if (!item || !item.version || item.artifactAvailable !== true || seen[item.version]) return false;
    seen[item.version] = true;
    return true;
  });
}

// Version choice list for one provider. checkUpdates rows win: the backend
// attaches the full release identity (releaseId/tag/name/publishedAt/body)
// to each of them, so every dropdown entry carries its own changelog.
function updateChoicesFor(data, providerId) {
  var updateAnswer = object(data.providerUpdates && data.providerUpdates.value && data.providerUpdates.value[providerId]);
  if (!(updateAnswer && updateAnswer.ok && Array.isArray(updateAnswer.availableVersions))) return [];
  return updateAnswer.availableVersions.map(function (v) {
    return {
      version: v.version,
      prerelease: v.prerelease === true,
      artifactKind: v.artifactKind,
      installable: v.installable === true,
      unavailableReason: v.reason || null,
      incompatibilityReason: v.reason || null,
      artifactAvailable: v.installable === true,
      architectureCompatible: v.installable === true,
      sourceId: 'official-github-release',
      displayVersion: v.version + (v.prerelease ? ' (prerelease)' : ''),
      update: v.update,
      tag: v.tag || null,
      releaseId: v.releaseId || '',
      releaseName: v.releaseName || '',
      publishedAt: v.publishedAt || null,
      draft: v.draft === true,
      releaseBody: v.releaseBody != null ? v.releaseBody : '',
      releaseUrl: v.releaseUrl || null
    };
  });
}

function choicesForProvider(data, providerId) {
  var updateChoices = updateChoicesFor(data, providerId);
  if (updateChoices.length) return updateChoices;
  var versionRow = providerVersions(data).filter(function (item) { return item && item.id === providerId; })[0] || {};
  return versionChoices(array(versionRow.versions));
}

function safeMarkdownText(value) {
  var holder = document.createElement('span');
  holder.textContent = String(value === null || value === undefined ? '' : value).slice(0, 32768);
  return holder.textContent;
}

function safeReleaseUrl(value, providerId) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  // Hard allowlist: only the official upstream repository of THIS provider.
  var repos = { rust: 'https://github.com/valnesfjord/tg-ws-proxy-rs/', go: 'https://github.com/spatiumstas/tg-ws-proxy-go/' };
  var prefix = repos[providerId];
  if (!prefix) return null;
  return value.indexOf(prefix) === 0 || value === prefix.slice(0, -1) ? value : null;
}

function markdownInline(value) {
  var text = safeMarkdownText(value), nodes = [], cursor = 0;
  var pattern = /(`[^`]*`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g, found;
  while ((found = pattern.exec(text)) !== null) {
    if (found.index > cursor) nodes.push(E('span', {}, text.slice(cursor, found.index)));
    if (found[0].charAt(0) === '`') nodes.push(E('code', {}, safeMarkdownText(found[0].slice(1, -1))));
    else nodes.push(E('a', { href: safeReleaseUrl(found[3]) || '#', target: '_blank', rel: 'noopener noreferrer' }, safeMarkdownText(found[2])));
    cursor = found.index + found[0].length;
  }
  if (cursor < text.length) nodes.push(E('span', {}, text.slice(cursor)));
  return nodes.length ? nodes : [E('span', {}, text)];
}

function renderReleaseMarkdown(body) {
  var lines = safeMarkdownText(body).replace(/\r\n?/g, '\n').split('\n'), blocks = [], paragraph = [], list = null, code = null;
  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(E('p', {}, markdownInline(paragraph.join(' '))));
    paragraph = [];
  }
  function flushList() {
    if (!list) return;
    blocks.push(E(list.ordered ? 'ol' : 'ul', {}, list.items.map(function (item) { return E('li', {}, markdownInline(item)); })));
    list = null;
  }
  function flushCode() {
    if (!code) return;
    blocks.push(E('pre', { 'class': 'z2m-proxy-release-code' }, E('code', {}, safeMarkdownText(code.lines.join('\n')))));
    code = null;
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], trimmed = line.trim(), fence = /^```/.test(trimmed);
    if (code) {
      if (fence) flushCode();
      else code.lines.push(line);
      continue;
    }
    if (fence) { flushParagraph(); flushList(); code = { lines: [] }; continue; }
    var heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) { flushParagraph(); flushList(); blocks.push(E(heading[1].length === 1 ? 'h3' : 'h4', {}, markdownInline(heading[2]))); continue; }
    var unordered = /^[-*+]\s+(.+)$/.exec(trimmed), ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      var isOrdered = !!ordered, value = (ordered || unordered)[1];
      if (!list || list.ordered !== isOrdered) { flushList(); list = { ordered: isOrdered, items: [] }; }
      list.items.push(value);
      continue;
    }
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    flushList(); paragraph.push(trimmed);
  }
  if (code) flushCode();
  flushParagraph();
  flushList();
  return blocks.length ? blocks : [E('p', { 'class': 'z2m-proxy-release-empty' }, _('Описание изменений для этого релиза не опубликовано.'))];
}

function releaseSummary(item) {
  if (!item) return E('p', { 'class': 'z2m-proxy-release-empty' }, _('Данные релиза пока недоступны.'));
  if (!String(item.releaseBody == null ? '' : item.releaseBody).trim())
    return E('p', { 'class': 'z2m-proxy-release-empty' }, _('Описание изменений для этого релиза не опубликовано.'));
  var lines = safeMarkdownText(item.releaseBody).replace(/\r\n?/g, '\n').split('\n'), points = [];
  for (var i = 0; i < lines.length && points.length < 3; i++) {
    var line = lines[i].trim().replace(/^#{1,3}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (!line || /^```/.test(line)) continue;
    points.push(line.slice(0, 220));
  }
  return points.length ? E('ul', { 'class': 'z2m-proxy-release-summary' }, points.map(function (point) { return E('li', {}, markdownInline(point)); })) :
    E('p', { 'class': 'z2m-proxy-release-empty' }, _('Описание изменений для этого релиза не опубликовано.'));
}

function releaseDateHuman(value) {
  var months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var found = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value === null || value === undefined ? '' : value));
  return found ? (+found[3]) + ' ' + months[+found[2] - 1] + ' ' + found[1] : '';
}

// Compact "Что нового" block bound to the EXACT selected release identity.
// Collapsed: up to three bullet points. Expanded («Подробнее»): the full
// sanitized Markdown body INSTEAD of the summary — never both at once.
function selectedReleaseBlock(ctx, provider, item) {
  if (!item || !item.version) return E('section', { 'class': 'z2m-panel z2m-proxy-selected-release' }, E('div', { 'class': 'bd' }, _('Данные релиза пока недоступны: upstream не вернул совместимую версию.')));
  var shell = ctx.shell;
  var url = safeReleaseUrl(item.releaseUrl, provider && provider.id);
  var expanded = state.tgReleaseExpanded === true;
  var date = releaseDateHuman(item.publishedAt);
  var meta = compact([
    date ? E('span', { 'class': 'z2m-proxy-release-date' }, date) : null,
    item.releaseName ? E('span', {}, display(item.releaseName)) : null
  ]);
  var body = !String(item.releaseBody == null ? '' : item.releaseBody).trim()
    ? E('p', { 'class': 'z2m-proxy-release-empty' }, _('Описание изменений для этого релиза не опубликовано.'))
    : expanded
      ? E('div', { 'class': 'z2m-proxy-release-markdown' }, renderReleaseMarkdown(item.releaseBody))
      : releaseSummary(item);
  var toggle = String(item.releaseBody == null ? '' : item.releaseBody).trim() ? shell.button(
    expanded ? _('Свернуть') : _('Подробнее'), 'sm', function () {
      state.tgReleaseExpanded = !expanded;
      if (typeof state.tgReleaseRefresh === 'function') state.tgReleaseRefresh();
    }) : null;
  return E('section', { 'class': 'z2m-panel z2m-proxy-selected-release' + (expanded ? ' expanded' : '') }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Что нового в ') + provider.title + ' ' + item.version),
      meta.length ? E('div', { 'class': 'sub z2m-proxy-release-meta' }, meta) : null]),
    E('div', { 'class': 'bd' }, [
      body,
      toggle || url ? E('div', { 'class': 'z2m-btnrow z2m-proxy-release-actions' }, compact([
        toggle,
        url ? E('a', { href: url, target: '_blank', rel: 'noopener noreferrer', 'class': 'z2m-proxy-release-link' }, _('Открыть релиз на GitHub') + ' →') : null
      ])) : null
    ])
  ]);
}

function compatibilityDetails(item) {
  if (!item || !item.version) return null;
  var reason = item.unavailableReason || item.incompatibilityReason || _('Точная причина недоступности не указана.');
  return E('div', { 'class': 'z2m-proxy-compatibility' }, [
    item.installable === true ? E('div', { 'class': 'z2m-proxy-ok' }, '✓ ' + _('Архитектура и пакет подходят')) : E('div', { 'class': 'z2m-proxy-provider-unavailable' }, '⚠ ' + reason),
    item.installable !== true ? E('div', {}, _('Причина: ') + reason) : null,
    E('div', {}, _('Архитектура: ') + display(item.architecture) + (item.architectureCompatible === true ? ' ✓' : '')),
    E('div', {}, _('Артефакт: ') + (item.apkAvailable ? _('OpenWrt APK') : item.directBinaryAvailable ? _('Прямой бинарный файл') : _('не найден'))),
    E('div', {}, _('SHA-256: ') + (item.checksumAvailable ? _('проверяется') : _('нет'))),
    E('div', {}, _('Механизм проверки: ') + (item.apkSignatureTrusted ? _('ключ разработчика') : item.trustMode === 'sha256-only' ? _('SHA-256') : _('не подтверждён')))
  ]);
}

function releaseVersionCompare(left, right) {
  var a = String(left || '').replace(/^v/, '').split(/[.-]/), b = String(right || '').replace(/^v/, '').split(/[.-]/);
  if (!a[0] || !b[0]) return null;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    var av = /^\d+$/.test(a[i] || '') ? Number(a[i]) : String(a[i] || '');
    var bv = /^\d+$/.test(b[i] || '') ? Number(b[i]) : String(b[i] || '');
    if (av === bv) continue;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function versionOptionLabel(item, latestVersion, installedVersion) {
  var marks = [];
  if (latestVersion && item.version === latestVersion) marks.push(_('последняя'));
  if (installedVersion && item.version === installedVersion) marks.push(_('установлена'));
  if (item.prerelease) marks.push(_('предварительная'));
  return item.version + (marks.length ? ' — ' + marks.join(', ') : '');
}

function providerCard(ctx, data, provider, status, releasePanel) {
  var shell = ctx.shell;
  var preflight = array(object(data.providerPreflight && data.providerPreflight.value).providers)
    .filter(function (item) { return item && item.provider === provider.id; })[0] || {};
  var choices = choicesForProvider(data, provider.id);
  var versionRow = providerVersions(data).filter(function (item) { return item && item.id === provider.id; })[0] || {};
  var source = object(versionRow.source);
  var versionsEnvelope = data.providerVersions || {};
  var remoteState = versionRow.remoteState || (versionsEnvelope.error ? 'unavailable' : null);
  var selection = state.tgSelections[provider.id] || {};
  var first = choices[0] || {};
  var selected = candidateForVersion(choices, selection.version || first.version);
  if (selected.version) state.tgSelections[provider.id] = { sourceId: selected.sourceId, version: selected.version };
  var isActive = providerInstalled(status.installed) && status.activeProvider === provider.id;
  var installedPackage = array(status.packages).filter(function (item) { return item && item.provider === provider.id; })[0] || {};
  var installedVersion = installedPackage.version || (isActive ? status.activeVersion : null) || installedPackage.packageVersion;
  var packageVersion = installedPackage.packageVersion || (isActive ? status.activePackageVersion : null);
  var latest = choices.filter(function (item) { return item && item.sourceId === 'official-github-release'; })[0] || (choices.length ? first : null);
  var latestDisplay = latest ? (latest.displayVersion || latest.version || _('Нет данных')) : _('Нет данных');
  var selectedIdentity = selected.version;
  var installedIdentity = installedVersion;
  var needsUpdate = !!(isActive && installedVersion && latest && latest.version && releaseVersionCompare(latest.version, installedVersion) > 0);
  var switching = providerInstalled(status.installed) && !isActive;
  var benefits = providerBenefits(provider.id);
  var diagnostics = selected.version ? E('details', { 'class': 'z2m-proxy-technical z2m-proxy-provider-diagnostics' }, [
    E('summary', {}, _('Подробнее')),
    compatibilityDetails(selected)
  ]) : null;
  var actionLabels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Установить и переключиться') };
  function actionKindFor(candidate) {
    var candidateVersion = candidate && candidate.version;
    var relation = isActive && installedIdentity ? releaseVersionCompare(candidateVersion, installedIdentity) : null;
    return switching ? 'PROVIDER_SWITCH' : !providerInstalled(status.installed) ? 'INSTALL' : relation != null && relation < 0 ? 'DOWNGRADE' : 'UPDATE';
  }
  function actionDisabledFor(candidate) {
    var candidateVersion = candidate && candidate.version;
    return !!state.busy || preflight.available === false || !candidate || !candidate.version || candidate.installable === false ||
      (isActive && installedIdentity && candidateVersion === installedIdentity);
  }
  // Success preflight is silent: a healthy device shows no compatibility
  // noise. Only a real failure becomes a provider-local alert.
  var updateCheckFailed = remoteState === 'unavailable';
  var unavailableReason = preflight.available === false ? (preflight.reason || _('Провайдер недоступен для этого устройства.')) :
    updateCheckFailed ? _('Не удалось проверить обновления. Повторите попытку позже — проверьте подключение роутера к сети.') :
    selected.version && selected.installable === false ? (selected.unavailableReason || selected.incompatibilityReason || _('Выбранная версия недоступна для устройства.')) : null;
  var sourceNotice = remoteState === 'empty' ? E('div', { 'class': 'z2m-proxy-provider-alert' }, _('Upstream не опубликовал совместимых артефактов для этой архитектуры.')) :
    remoteState === 'unavailable' ? E('div', { 'class': 'z2m-proxy-provider-alert' }, _('Удалённый каталог временно недоступен; установленная версия и локальное состояние сохранены.')) :
    remoteState === 'stale' || source.stale ? E('div', { 'class': 'z2m-proxy-provider-alert' }, _('Показаны последние сохранённые данные upstream; перед изменением нужна свежая проверка.')) :
    source.error ? E('div', { 'class': 'z2m-proxy-provider-alert' }, source.error.code === 'ERATELIMIT' ? _('Upstream временно ограничил запросы; локальные данные и установленная версия сохранены.') : _('Удалённые версии временно недоступны; установленная версия и локальное состояние сохранены.')) : null;
  var versionSelect = choices.length > 1 ? E('select', { 'aria-label': _('Версия'), value: selected.version || '', change: function (event) {
    var next = candidateForVersion(choices, event.target.value);
    state.tgSelections[provider.id] = { sourceId: next.sourceId, version: next.version };
    // In-place updates only: a full pane re-render inside the change handler
    // destroys the select mid-interaction and wedges the dropdown after a few
    // quick switches.
    releasePanel.update(provider, next);
    actionsRow.replaceChildren(buildAction(next));
    if (diagnostics) diagnostics.replaceChildren(E('summary', {}, _('Подробнее')), compatibilityDetails(next));
  } }, choices.map(function (item) {
    return E('option', { value: item.version }, versionOptionLabel(item, first.version, isActive ? installedVersion : null));
  })) : E('strong', { 'class': 'z2m-proxy-version-static' }, display(selected.version || latest && latest.version));
  function buildAction(candidate) {
    if (!candidate || !candidate.version) return shell.button(_('Нет доступных версий'), 'sm', function () {}, true);
    var isInstalled = isActive && installedIdentity && candidate.version === installedIdentity;
    if (isInstalled) return E('span', { 'class': 'z2m-proxy-installed-state' }, '✓ ' + _('Установлена актуальная версия'));
    return shell.button(actionLabels[actionKindFor(candidate)], 'primary sm', function () {
      var liveCandidate = candidateForVersion(choices, (state.tgSelections[provider.id] || {}).version) || candidate;
      var request = { provider: provider.id, sourceId: liveCandidate.sourceId, version: liveCandidate.version };
      function start() {
        if (state.busy) return;
        state.busy = 'provider-install';
        state.tgLifecycle = { status: 'pending', action: 'provider-install', message: _('Проверяем выбранный релиз…') };
        rerenderProxy(ctx);
        Promise.resolve().then(function () {
          return boundedLoad(ctx.api.tg.product.checkUpdates({ provider: request.provider, sourceId: request.sourceId, version: request.version, intent: 'mutation' }), _('проверки выбранного релиза'));
        }).then(function (check) {
          if (!check || check.ok === false || !check.checkToken) throw check && check.error || new Error(_('Выбранная версия не прошла проверку.'));
          state.tgLifecycle = { status: 'pending', action: 'provider-install', message: _('Устанавливаем выбранную версию…') };
          rerenderProxy(ctx);
          return boundedLoad(ctx.api.tg.product.switch({ provider: provider.id, version: liveCandidate.version, checkToken: check.checkToken }), _('установки Telegram Proxy'));
        }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог установить Telegram Proxy.'));
          state.busy = null;
          state.tgLifecycle = { status: 'refreshing', action: 'provider-install', message: _('Проверяем установленную версию…') };
          rerenderProxy(ctx);
          finishTgTransaction(ctx, answer, start);
        }).catch(function (error) {
          state.busy = null;
          state.tgLifecycle = { status: 'error', action: 'provider-install', message: ProductUX.errorMessage(ctx.api.normalizeError(error)).message };
          rerenderProxy(ctx);
          showOperationFailure(ctx, start, error);
        });
      }
      tgTransactionConfirm(ctx, actionKindFor(liveCandidate), provider, liveCandidate, start);
    }, actionDisabledFor(candidate));
  }
  var actionsRow = E('div', { 'class': 'z2m-btnrow z2m-proxy-provider-actions' }, [buildAction(selected)]);
  var cardEl = E('article', { 'class': 'z2m-panel z2m-proxy-provider-card' + (isActive ? ' selected' : '') + (state.tgReleaseCurrent && state.tgReleaseCurrent.provider && state.tgReleaseCurrent.provider.id === provider.id ? ' release-active' : '') }, [
    E('div', { 'class': 'hd' }, compact([
      E('div', { 'class': 'z2m-proxy-provider-heading' }, [providerIcon(provider.id), E('h2', {}, provider.title)]),
      E('div', { 'class': 'sp z2m-proxy-provider-chips' }, compact([
        isActive ? shell.chip(_('Активен'), 'g', true) : null,
        needsUpdate ? shell.chip(_('Доступно обновление'), 'o', true) : null
      ]))
    ])),
    E('div', { 'class': 'bd' }, compact([
      E('strong', { 'class': 'z2m-proxy-provider-short' }, benefits.title),
      E('p', { 'class': 'z2m-proxy-provider-sub' }, benefits.items[0]),
      E('div', { 'class': 'z2m-proxy-info-list z2m-proxy-provider-rows' }, [
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Установлено')), E('strong', {}, installedVersionDisplay(installedVersion, packageVersion))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Последняя')), E('strong', {}, display(latestDisplay))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Версия')), versionSelect])
      ]),
      sourceNotice,
      unavailableReason ? E('div', { 'class': 'z2m-proxy-provider-alert' }, [
        E('div', {}, '⚠ ' + _('Эта версия недоступна для устройства')),
        E('div', { 'class': 'z2m-proxy-provider-alert-reason' }, unavailableReason)
      ]) : null,
      diagnostics,
      actionsRow
    ]))
  ]);
  // Clicking the card (outside interactive controls) switches the changelog
  // block to this provider's selected release.
  cardEl.addEventListener('click', function (event) {
    if (event.target.closest('select, button, a, input, textarea, details, summary')) return;
    releasePanel.update(provider, selected);
  });
  return cardEl;
}

function installPane(ctx, data) {
  var shell = ctx.shell;
  var status = providerStatus(data);
  var recoveredOperation = object(data.providerOperation && data.providerOperation.value).operation;
  if (recoveredOperation && (recoveredOperation.state === 'RUNNING' || recoveredOperation.status === 'RUNNING' ||
    recoveredOperation.state === 'ROLLING_BACK' || recoveredOperation.status === 'ROLLING_BACK')) {
    // A transaction is in flight (possibly started before a page reload):
    // re-attach to it and block new operations until it reaches a terminal state.
    state.busy = state.busy || 'operation';
    if (!state.tgOperation) {
      state.tgOperation = Object.assign({}, recoveredOperation, { status: recoveredOperation.state || recoveredOperation.status });
      watchAttachedTgOperation(ctx);
    }
  }
  var providers = providerCatalog(data).slice().sort(function (left, right) { return left.id === 'go' ? -1 : right.id === 'go' ? 1 : 0; });
  var selectedVersionPanel = E('div', { 'class': 'z2m-proxy-selected-release-wrap' });
  var releasePanel = {
    update: function (provider, item) {
      var key = (provider && provider.id ? provider.id : '') + '@' + (item && item.version ? item.version : '');
      if (state.tgReleaseKey !== key) { state.tgReleaseKey = key; state.tgReleaseExpanded = false; }
      state.tgSelectedRelease = item && item.version ? { provider: provider.id, version: item.version } : null;
      state.tgReleaseCurrent = { provider: provider, item: item };
      selectedVersionPanel.replaceChildren(selectedReleaseBlock(ctx, provider, item));
      Array.prototype.forEach.call(document.querySelectorAll('.z2m-proxy-provider-card'), function (c) {
        var title = (c.querySelector('h2') || {}).textContent || '';
        c.classList.toggle('release-active', !!provider && title === (provider.title || title));
      });
    }
  };
  state.tgReleaseRefresh = function () {
    var current = state.tgReleaseCurrent;
    if (current) releasePanel.update(current.provider, current.item);
  };
  var cards = providers.map(function (provider) { return providerCard(ctx, data, provider, status, releasePanel); });
  var catalogError = data.providerCatalog && data.providerCatalog.error;
  var versionsError = data.providerVersions && data.providerVersions.error;
  var metadataNotice = catalogError || versionsError
    ? shell.statePanel({ message: _('Удалённый каталог версий Telegram Proxy временно недоступен; локальное состояние сохранено.'), kind: 'error' })
    : !data.providerCatalog || !data.providerVersions
      ? shell.statePanel({ message: _('Каталог версий Telegram Proxy загружается…'), kind: 'info' })
      : null;
  var initialProvider = providers.filter(function (provider) { return state.tgSelectedRelease && state.tgSelectedRelease.provider === provider.id; })[0] ||
    providers.filter(function (provider) { return choicesForProvider(data, provider.id).length > 0; })[0] || providers[0];
  var initialChoices = initialProvider ? choicesForProvider(data, initialProvider.id) : [];
  var initialVersion = state.tgSelectedRelease && state.tgSelectedRelease.provider === (initialProvider || {}).id ? state.tgSelectedRelease.version : (initialChoices[0] || {}).version;
  releasePanel.update(initialProvider || { id: '', title: _('Telegram Proxy') }, candidateForVersion(initialChoices, initialVersion));
  // Manual refresh is explicit; ordinary page load remains browse-only.
  var checking = state.tgCheckingUpdates === true;
  var checkedJustNow = state.tgCheckedAt && (Date.now() - state.tgCheckedAt) < 5000;
  function checkUpdatesNow() {
    if (state.tgCheckingUpdates) return;
    state.tgCheckingUpdates = true;
    ctx.root.replaceChildren(render(ctx));
    Promise.all(['rust', 'go'].map(function (id) {
      return boundedLoad(ctx.api.tg.product.checkUpdates({ provider: id }), _('проверки обновлений Telegram Proxy') + ' ' + id).then(function (answer) {
        if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Не удалось проверить обновления.'));
        return answer;
      });
    })).then(function () {
      return ctx.refresh('proxy');
    }).then(function () {
      state.tgCheckingUpdates = false;
      state.tgCheckedAt = Date.now();
      ctx.root.replaceChildren(render(ctx));
      ctx.shell.showToast(_('Проверено только что'), 'ok');
    }).catch(function (error) {
      state.tgCheckingUpdates = false;
      ctx.root.replaceChildren(render(ctx));
      showError(ctx, error);
    });
  }
  var head = E('div', { 'class': 'z2m-proxy-component-head' }, [
    E('div', {}, [
      E('h2', {}, _('Telegram Proxy')),
      E('p', { 'class': 'z2m-dim' }, providerInstalled(status.installed)
        ? _('Установлен: ') + activeProviderLabel(data, status) + ' ' + installedVersionDisplay(status.activeVersion, status.activePackageVersion)
        : _('Не установлен — установите Rust или Go ниже'))
    ]),
    E('div', { 'class': 'z2m-btnrow' }, compact([
      shell.button(checking ? _('Проверяем обновления…') : _('Проверить обновления'), 'sm', checkUpdatesNow, checking || !!state.busy),
      checkedJustNow && !checking ? E('span', { 'class': 'z2m-proxy-checked-note' }, _('Проверено только что')) : null
    ]))
  ]);
  var removeFooter = [];
  if (providerInstalled(status.installed)) {
    removeFooter.push(shell.button(_('Удалить'), 'danger sm', function () {
      tgUninstallConfirm(ctx, false, function () {
        state.busy = 'provider-remove';
        ctx.api.tg.product.remove({ confirm: 'REMOVE' }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог удалить Telegram Proxy.'));
          state.busy = null;
          finishTgTransaction(ctx, answer, null);
        }).catch(function (error) { state.busy = null; showOperationFailure(ctx, null, error); });
      });
    }, !!state.busy));
    removeFooter.push(shell.button(_('Удалить полностью'), 'danger sm', function () {
      tgUninstallConfirm(ctx, true, function () {
        state.busy = 'provider-purge';
        ctx.api.tg.product.purge({ confirm: 'PURGE' }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог выполнить полную очистку.'));
          state.busy = null;
          ctx.shell.showToast(_('TG Proxy и настройки удалены.'), 'ok');
          return ctx.refresh('proxy');
        }).catch(function (error) { state.busy = null; showError(ctx, error); });
      });
    }, !!state.busy));
  }
  var removePanel = removeFooter.length ? E('details', { 'class': 'z2m-proxy-danger-zone' }, [
    E('summary', {}, _('Удаление Telegram Proxy')),
    E('div', { 'class': 'z2m-proxy-danger-zone-body' }, [
      E('strong', {}, _('Удаление Telegram Proxy')),
      E('p', {}, _('Обычное удаление сохраняет настройки. Полная очистка удаляет конфигурацию и секрет.')),
      E('div', { 'class': 'z2m-btnrow' }, removeFooter)
    ])
  ]) : null;
  return E('div', { 'class': 'z2m-proxy-pane' }, compact([
    head,
    metadataNotice,
    E('div', { 'class': 'z2m-grid z2m-grid-2 z2m-proxy-provider-grid' }, cards),
    selectedVersionPanel,
    removePanel
  ]));
}
function statusPane(ctx, data, normalized) {
  var shell = ctx.shell;
  if (data.providerStatus && data.providerStatus.error) {
    return showErrorState(ctx, data.providerStatus.error, _('Статус недоступен.'));
  }
  var pstatus = providerStatus(data);
  var installed = providerInstalled(pstatus.installed);
  if (!installed) return shell.statePanel({
    title: _('TG Proxy не установлен'),
    message: _('Выберите Rust или Go во вкладке «Компонент». Остальной менеджер продолжает работать без TG Proxy.'),
    kind: 'info'
  });

  var raw = object(data.status && data.status.value);
  if (!Object.keys(raw).length) raw = pstatus;
  var cfg = object(data.config && data.config.value);
  var applied = object(cfg.applied || cfg.draft);
  var listener = array(raw.listeners)[0] || {};
  var update = activeUpdateState(data, pstatus);
  var busyLabel = function (action, label, pending) {
    return state.busy === action ? [E('span', { 'class': 'spinner-inline', 'aria-hidden': 'true' }), _(pending)] : label;
  };
  var busyAttrs = function (label) {
    return { 'aria-busy': state.busy === label ? 'true' : null };
  };
  var actions = [];
  if (!normalized.process) actions.push(shell.button(busyLabel(_('Запустить'), _('Запустить'), _('Запускаем…')), 'primary sm', function () {
    lifecycle(ctx, ctx.api.tg.product.start, _('Запустить'), _('Сервер проверит процесс и точный адрес слушателя после запуска.'), _('Запускаем Telegram Proxy…'));
  }, !!state.busy, busyAttrs(_('Запустить'))));
  if (normalized.process) actions.push(shell.button(busyLabel('health', _('Проверить'), _('Проверяем…')), 'primary sm', function () {
    return refreshWithHealth(ctx);
  }, !!state.busy, busyAttrs('health')));
  if (normalized.process) actions.push(shell.button(busyLabel(_('Перезапустить'), _('Перезапустить'), _('Перезапускаем…')), 'sm', function () {
    lifecycle(ctx, ctx.api.tg.product.restart, _('Перезапустить'), _('Текущие подключения будут прерваны.'), _('Перезапускаем Telegram Proxy…'));
  }, !!state.busy, busyAttrs(_('Перезапустить'))));
  actions.push(shell.button(_('Ссылка / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy));
  var secondaryActions = E('details', { 'class': 'z2m-proxy-overflow-menu' }, [
    E('summary', {}, _('Ещё')),
    E('div', { 'class': 'z2m-proxy-overflow-list' }, compact([
      normalized.process ? shell.button(_('Остановить'), 'danger sm', function () {
        lifecycle(ctx, ctx.api.tg.product.stop, _('Остановить'), _('Telegram Proxy перестанет принимать подключения.'), _('Останавливаем Telegram Proxy…'));
      }, !!state.busy) : null,
      shell.button(_('Новая ссылка'), 'sm', function () {
        lifecycle(ctx, ctx.api.proxy.secretRotate, _('Создать новую ссылку'), _('Старая ссылка перестанет работать; сервер проверит слушатель и выполнит откат при ошибке.'), _('Создаём новую ссылку…'));
      }, !!state.busy),
      update.state === 'degraded' ? shell.button(_('Открыть компонент'), 'sm', function () {
        state.pane = 'component';
        ctx.root.replaceChildren(render(ctx));
      }, !!state.busy) : null,
      shell.button(_('Настройки'), 'sm', function () {
        state.pane = 'settings';
        ctx.root.replaceChildren(render(ctx));
      }, !!state.busy)
    ]))
  ]);
  actions.push(secondaryActions);

  var listenerAddress = listener.address || applied.host;
  var listenerPort = listener.port !== undefined ? listener.port : applied.port;
  var infoRow = function (row) { return E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, row[0]), E('strong', {}, row[1])]); };
  var rawHealth = object(data.health && data.health.value);
  if (!Object.keys(rawHealth).length) rawHealth = object(pstatus.health);
  var runtime = object(raw.runtime);
  var technicalRows = [
    [_('PID'), display(raw.pid !== undefined ? raw.pid : runtime.pid)],
    [_('Ревизия'), display(cfg.appliedRevision)],
    [_('Ревизия пакета'), display(pstatus.activePackageVersion)]
  ];
  var technicalEvidence = ProductUX.redact({
    status: raw,
    health: raw.health || rawHealth,
    provider: pstatus,
    config: { appliedRevision: cfg.appliedRevision },
    timestamps: {
      status: raw.timestamp !== undefined ? raw.timestamp : raw.ts,
      health: rawHealth.generatedAt !== undefined ? rawHealth.generatedAt : rawHealth.timestamp,
      provider: pstatus.generatedAt !== undefined ? pstatus.generatedAt : pstatus.updatedAt
    }
  });
  // Truthful status contract: green ONLY with local health AND confirmed
  // Telegram DC reachability; degraded when the upstream side is unproven;
  // red on local failure. Never a green «Работает» from process+listener alone.
  var localOk = normalized.process && normalized.listener;
  var upstreamOk = normalized.outbound === true;
  var humanStatus = !localOk ? _('Не работает') : upstreamOk ? _('Работает') : _('Работает с ограничениями');
  var statusKind = !localOk ? 'r' : upstreamOk ? 'g' : 'o';
  var healthPending = state.tgHealthCheck && state.tgHealthCheck.status === 'pending';
  var lifecyclePending = state.tgLifecycle && (state.tgLifecycle.status === 'pending' || state.tgLifecycle.status === 'refreshing');
  if (healthPending) {
    humanStatus = _('Проверяем Telegram');
    statusKind = 'o';
  } else if (state.busy === _('Запустить')) {
    humanStatus = _('Запускается');
    statusKind = 'o';
  }
  var statusMessage = healthPending ? _('Проверяем доступность Telegram DC…') : state.busy === _('Запустить') ?
    _('Сервис запускается. Проверяем процесс и слушатель после ответа сервера.') : !localOk ? _('Процесс Telegram Proxy не запущен или слушатель недоступен.') :
    upstreamOk ? _('Локальный слушатель и доступность Telegram DC подтверждены.') :
    _('Локальный прокси работает, но доступность Telegram DC пока не подтверждена.');
  function healthStep(row) {
    var rowPending = row[0] === 'telegram' && healthPending;
    return E('div', { 'class': 'z2m-proxy-health-step ' + (row[2] ? 'ok' : 'warn') }, compact([
      E('span', {}, row[1]),
      E('strong', {}, rowPending ? _('Проверяем…') : row[3]),
      !row[2] && row[0] === 'telegram' ? shell.button(rowPending ? [E('span', { 'class': 'spinner-inline', 'aria-hidden': 'true' }), _('Проверяем…')] : _('Проверить снова'), 'ghost sm', function () { return refreshWithHealth(ctx); }, !!state.busy, busyAttrs('health')) : null
    ]));
  }
  var listenerLabel = normalized.listener && listenerAddress ? display(listenerAddress) + ':' + display(listenerPort) : _('Не подтверждён');
  var health = [
    ['process', _('Процесс'), normalized.process, normalized.process ? _('Запущен') : _('Остановлен')],
    ['listener', _('Слушатель'), normalized.listener, listenerLabel],
    ['telegram', _('Telegram'), upstreamOk && !healthPending, upstreamOk ? _('Подключение подтверждено') : _('Не подтверждено')]
  ];
  var serviceRows = [
    [_('Версия'), installedVersionDisplay(pstatus.activeVersion, pstatus.activePackageVersion)],
    [_('Автозапуск'), object(cfg.autostart).rcDEnabled ? _('Включён') : _('Выключен')],
    [_('Активные сессии'), normalized.activeConnections === null || normalized.activeConnections === undefined ? '—' : String(normalized.activeConnections)]
  ];
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    E('section', { 'class': 'z2m-panel z2m-proxy-status-panel' }, [
      E('div', { 'class': 'bd' }, [
        E('div', { 'class': 'z2m-proxy-overview-lede' }, [
          E('div', { 'class': 'z2m-proxy-status-hero' }, [
            E('div', { 'class': 'z2m-proxy-status-summary' }, [
              E('div', { 'class': 'z2m-proxy-telegram-logo' }, E('img', { src: L.resource('view/zapret2-manager/icons/telegram.svg'), alt: 'Telegram' })),
              E('div', {}, [
                E('h3', { 'class': 'z2m-proxy-status-' + statusKind }, humanStatus),
                E('p', { 'class': 'z2m-proxy-status-meta' }, activeProviderLabel(data, pstatus) + ' · ' + installedVersionDisplay(pstatus.activeVersion, pstatus.activePackageVersion) + ' · ' + (object(cfg.autostart).rcDEnabled ? _('Автозапуск включён') : _('Автозапуск выключен'))),
                E('p', { 'class': 'z2m-proxy-status-description' }, statusMessage)
              ])
            ]),
            E('div', { 'class': 'z2m-btnrow z2m-proxy-lifecycle-actions' }, actions)
          ]),
          lifecycleFeedback(state.tgLifecycle)
        ]),
        E('div', { 'class': 'z2m-proxy-status-section' }, [
          E('div', { 'class': 'z2m-proxy-status-section-head' }, [
            E('h3', {}, _('Состояние')),
            E('span', { 'class': 'z2m-dim' }, lifecyclePending || healthPending ? _('Проверка выполняется') : _('Локально и через Telegram DC'))
          ]),
          E('div', { 'class': 'z2m-proxy-health-chain' }, health.map(healthStep))
        ]),
        E('div', { 'class': 'z2m-proxy-status-section' }, [
          E('div', { 'class': 'z2m-proxy-status-section-head' }, [E('h3', {}, _('Сервис'))]),
          E('div', { 'class': 'z2m-proxy-info-list z2m-proxy-service-facts' }, serviceRows.map(infoRow))
        ]),
        E('details', { 'class': 'z2m-proxy-technical' }, [
          E('summary', {}, _('Технические сведения')),
          E('div', { 'class': 'z2m-proxy-info-list' }, technicalRows.map(infoRow)),
          E('pre', { 'class': 'z2m-console' }, JSON.stringify(technicalEvidence, null, 2))
        ])
      ])
    ])
  ]);
}
function fieldNode(ctx, field, value, onChange) {
  var input;
  if (field.type === 'bool') {
    input = ctx.shell.switchControl({ checked: value === true, label: field.label, onChange: onChange });
  } else if (field.type === 'list') {
    input = E('textarea', { rows: '4', placeholder: field.placeholder || '', 'aria-label': field.label }, array(value).join('\n'));
    input.value = array(value).join('\n');
    input.addEventListener('change', function () {
      onChange(String(input.value || '').split(/[\n,]/).map(function (item) { return item.trim(); }).filter(Boolean));
    });
  } else {
    input = E('input', { type: field.type === 'number' ? 'number' : 'text', value: value == null ? '' : String(value), placeholder: field.placeholder || '', min: field.min, max: field.max, 'aria-label': field.label });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', function () {
      onChange(field.type === 'number' ? Number(input.value) : String(input.value || '').trim());
    });
  }
  return [E('label', {}, field.label), E('div', { 'class': 'z2m-proxy-control' }, compact([
    input,
    field.hint ? E('div', { 'class': 'z2m-proxy-field-hint' }, field.hint) : null
  ]))];
}
function settingsSection(ctx, data, settings, title, subtitle, fields) {
  var grid = E('div', { 'class': 'z2m-tg-settings-grid' });
  fields.forEach(function (field) {
    var nodes = fieldNode(ctx, field, settings[field.id], function (value) {
      var next = clone(settings);
      next[field.id] = value;
      setLocalSettings(ctx, data, next);
    });
    var row = E('div', { 'class': 'z2m-tg-settings-row' }, [
      E('label', {}, field.label),
      E('div', { 'class': 'z2m-tg-settings-control' }, [nodes[1], field.hint ? E('div', { 'class': 'z2m-proxy-field-hint' }, field.hint) : null])
    ]);
    grid.appendChild(row);
  });
  var head = title ? E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, title), subtitle ? E('p', {}, subtitle) : null]) : null;
  return E('section', { 'class': 'z2m-proxy-form-section' }, compact([head, grid]));
}

// ---- connection profiles (product UX over raw config keys) ---------------------
//
// Local fallback templates mirror the backend presets in proxycfg.uc
// (upstream defaults of tg-ws-proxy-rs / tg-ws-proxy-go). The backend value
// from proxy_config_get.presets wins whenever it is present.
var PROFILE_TEMPLATES = {
  recommended: {
    port: 1443, defaultDomains: true, cfPriority: true, cfBalance: false,
    // Live-trace contract: media aliases 10001-10005 must be mapped or the
    // provider drops media sessions with "no fallback IP available".
    dcIps: [
      '1:149.154.175.50', '2:149.154.167.51', '3:149.154.175.100',
      '4:149.154.167.91', '5:149.154.171.5',
      '10001:149.154.175.50', '10002:149.154.167.51', '10003:149.154.175.100',
      '10004:149.154.167.91', '10005:149.154.171.5'
    ],
    cfDomains: [], cfWorkerDomains: [],
    mtprotoProxies: [], outboundProxy: '', noProxy: '',
    poolSize: 4, bufKb: 256, maxConnections: 0, quiet: false, verbose: false
  },
  direct: {
    port: 1443, defaultDomains: false, cfPriority: false, cfBalance: false,
    faketlsDomain: '', dcIps: [], cfDomains: [], cfWorkerDomains: [],
    mtprotoProxies: [], outboundProxy: '', noProxy: '',
    poolSize: 4, bufKb: 256, maxConnections: 0, quiet: false, verbose: false
  }
};
var CONNECTION_FACT_KEYS = ['enabled', 'autostart', 'host', 'linkIp'];

function profilePresets(data) {
  var block = object(object(data.config && data.config.value).presets);
  var recommended = object(object(block.recommended).settings);
  var direct = object(object(block.direct).settings);
  return {
    recommended: Object.keys(recommended).length ? recommended : PROFILE_TEMPLATES.recommended,
    direct: Object.keys(direct).length ? direct : PROFILE_TEMPLATES.direct,
    lanAddress: block.lanAddress || null
  };
}

// The canonical Recommended DC set (DC1-5 + media aliases 10001-10005) counts
// as default routing — it IS the shipped preset, not a user customization.
var RECOMMENDED_DC_SET = [
  '1:149.154.175.50', '2:149.154.167.51', '3:149.154.175.100',
  '4:149.154.167.91', '5:149.154.171.5',
  '10001:149.154.175.50', '10002:149.154.167.51', '10003:149.154.175.100',
  '10004:149.154.167.91', '10005:149.154.171.5'
];

function routingCustomized(settings) {
  settings = object(settings);
  var dc = array(settings.dcIps);
  var dcDefault = dc.length === 0 || (dc.length === RECOMMENDED_DC_SET.length &&
    RECOMMENDED_DC_SET.every(function (v, i) { return dc[i] === v; }));
  return !dcDefault || array(settings.cfDomains).length > 0 ||
    array(settings.cfWorkerDomains).length > 0 || array(settings.mtprotoProxies).length > 0 ||
    String(settings.outboundProxy == null ? '' : settings.outboundProxy).trim() !== '';
}

// Frontend mirror of proxycfg detect_config_profile(): only the ROUTING
// signature decides, so toggling enabled/autostart or editing the listener
// never silently demotes the active profile.
function detectConfigProfile(settings) {
  settings = object(settings);
  if (routingCustomized(settings)) return 'custom';
  if (settings.defaultDomains === true && settings.cfPriority === true && settings.cfBalance !== true) return 'recommended';
  if (settings.defaultDomains === false && settings.cfPriority === false) return 'direct';
  return 'custom';
}

// A profile owns routing + tuning; connection facts stay with the user.
function profileSettingsFor(presets, name, current) {
  current = object(current);
  var merged = clone(name === 'direct' ? presets.direct : presets.recommended);
  CONNECTION_FACT_KEYS.forEach(function (key) { merged[key] = current[key]; });
  return ProxyModel.safeSettings(merged);
}

var SETTING_LABELS = {
  enabled: _('Включено'), autostart: _('Автозапуск'), host: _('Адрес прослушивания'),
  port: _('Порт'), linkIp: _('Адрес в ссылке'), faketlsDomain: _('FakeTLS SNI'),
  dcIps: _('Маршруты Telegram DC'), cfDomains: _('Cloudflare домены'),
  cfWorkerDomains: _('CF Worker домены'), cfPriority: _('Приоритет Cloudflare'),
  cfBalance: _('CF round-robin'), defaultDomains: _('Cloudflare fallback'),
  outboundProxy: _('Исходящий proxy'), noProxy: _('Исключения исходящего proxy'),
  poolSize: _('WS pool на DC'), bufKb: _('Буфер сокета, KiB'),
  maxConnections: _('Максимум подключений'), quiet: _('Тихое логирование'), verbose: _('Отладочный лог')
};

function settingValueDisplay(value) {
  if (value === true) return _('Вкл');
  if (value === false) return _('Выкл');
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(—)';
  var text = String(value === null || value === undefined ? '' : value);
  return text === '' ? '(—)' : text;
}

function presetDiffRows(current, target) {
  current = ProxyModel.safeSettings(current);
  target = ProxyModel.safeSettings(target);
  var ids = ['port', 'defaultDomains', 'cfPriority', 'cfBalance', 'faketlsDomain', 'dcIps',
    'cfDomains', 'cfWorkerDomains', 'outboundProxy', 'noProxy', 'poolSize', 'bufKb',
    'maxConnections', 'quiet', 'verbose'];
  var rows = [];
  ids.forEach(function (id) {
    var before = JSON.stringify(current[id] !== undefined ? current[id] : null);
    var after = JSON.stringify(target[id] !== undefined ? target[id] : null);
    if (before !== after) rows.push({ id: id, label: SETTING_LABELS[id] || id,
      from: settingValueDisplay(current[id]), to: settingValueDisplay(target[id]) });
  });
  return rows;
}

function profileCard(ctx, data, settings, presets) {
  var shell = ctx.shell;
  var active = detectConfigProfile(settings);
  var descriptions = {
    recommended: _('Использует резервные маршруты Cloudflare при проблемах с прямым подключением к Telegram.'),
    direct: _('Только прямое подключение к Telegram — без резервных Cloudflare-маршрутов.'),
    custom: _('Используются собственные значения — их можно изменить в дополнительных настройках.')
  };
  function pick(name) {
    if (name === 'custom') {
      state.tgSettingsAdvanced = true;
      ctx.root.replaceChildren(render(ctx));
      return;
    }
    var next = profileSettingsFor(presets, name, getLocalSettings(ctx, data));
    setLocalSettings(ctx, data, next);
  }
  var buttons = E('div', { 'class': 'z2m-tg-profile-switch', role: 'group', 'aria-label': _('Профиль подключения') },
    [['recommended', _('Рекомендуемый')], ['direct', _('Прямой')], ['custom', _('Пользовательский')]].map(function (pair) {
      var name = pair[0], isActive = active === name;
      return shell.button(pair[1], (isActive ? 'primary ' : '') + 'sm z2m-tg-profile-btn' + (isActive ? ' active' : ''),
        function () { pick(name); }, false);
    }));
  return E('section', { 'class': 'z2m-panel z2m-proxy-profile-card z2m-tg-profile' }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Режим подключения'))]),
    E('div', { 'class': 'bd' }, [
      buttons,
      E('p', { 'class': 'z2m-tg-profile-desc' }, descriptions[active] || descriptions.custom)
    ])
  ]);
}

function routingSummaryCard(shell, settings) {
  settings = object(settings);
  var ownDomains = array(settings.cfDomains).length + array(settings.cfWorkerDomains).length > 0;
  var chips = compact([
    E('span', { 'class': 'z2m-tg-routing-chip' + (settings.defaultDomains === true ? ' on' : '') }, settings.defaultDomains === true ? _('Fallback включён') : _('Fallback выключен')),
    settings.defaultDomains === true ? E('span', { 'class': 'z2m-tg-routing-chip' }, _('Flowseal')) : (ownDomains ? E('span', { 'class': 'z2m-tg-routing-chip' }, _('Свои домены')) : null),
    E('span', { 'class': 'z2m-tg-routing-chip' }, settings.cfPriority === true ? _('Cloudflare сначала') : _('Прямое сначала'))
  ]);
  return E('section', { 'class': 'z2m-proxy-form-section' }, [
    E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, _('Маршрутизация')), E('p', {}, _('Как прокси достигает Telegram'))]),
    E('div', { 'class': 'z2m-tg-routing-chips' }, chips)
  ]);
}

function restoreRecommended(ctx, data, presets, current) {
  var shell = ctx.shell;
  var target = profileSettingsFor(presets, 'recommended', current);
  var rows = presetDiffRows(current, target);
  var body = E('div', { 'class': 'z2m-tg-confirm-body z2m-proxy-preset-confirm' }, [
    E('strong', {}, _('Восстановить рекомендуемые настройки?')),
    E('p', {}, _('Будут восстановлены рекомендованные значения маршрутизации и порта. Включение, автозапуск и адрес прослушивания сохранятся.')),
    rows.length ? E('div', { 'class': 'z2m-proxy-preset-diff' }, [
      E('div', { 'class': 'z2m-proxy-preset-diff-head' }, [E('span', {}, _('Параметр')), E('span', {}, _('Сейчас')), E('span', {}, _('Станет'))])
    ].concat(rows.map(function (row) {
      return E('div', { 'class': 'z2m-proxy-preset-diff-row' }, [
        E('span', {}, row.label), E('span', {}, row.from), E('span', { 'class': 'z2m-proxy-ok' }, row.to)
      ]);
    }))) : E('p', {}, _('Изменений нет: текущая конфигурация уже соответствует рекомендуемому профилю.')),
    E('p', { 'class': 'z2m-dim' }, _('Secret не сбрасывается и не меняется.'))
  ]);
  shell.openModal(_('Рекомендуемый профиль'), body, [
    shell.button(_('Отмена'), '', shell.closeModal),
    shell.button(_('Применить рекомендуемые'), 'primary sm', function () {
      shell.closeModal();
      if (!rows.length) return;
      stage(ctx, data, target);
      ctx.shell.showToast(_('Рекомендуемые настройки применены.'), 'ok');
    }, !rows.length)
  ]);
}
function settingsPane(ctx, data) {
  var shell = ctx.shell;
  var pstatus = providerStatus(data);
  var installed = providerInstalled(pstatus.installed);
  var applied = ProxyModel.safeSettings(appliedConfig(data));
  var settings = getLocalSettings(ctx, data);
  var draft = currentDraft(ctx);
  var presets = profilePresets(data);
  var cfgValue = object(data.config && data.config.value);
  var lanAddress = presets.lanAddress;
  if (!state.tgSettingsLocal) {
    var hyd = clone(settings);
    hyd.autostart = object(cfgValue.autostart).rcDEnabled === true;
    hyd.enabled = hyd.enabled === true;
    settings = ProxyModel.safeSettings(hyd);
  }
  var lanEnabled = !!lanAddress && settings.host === lanAddress;
  var advertised = settings.linkIp || settings.host || lanAddress || '';
  var fallbackEntries = array(settings.mtprotoProxies);
  function fields(ids) {
    var hints = {
      host: _('Куда привязан процесс: LAN IPv4 для доступа с других устройств или 127.x только для самого роутера.'),
      port: _('Диапазон 1–65535. Рекомендуемое значение провайдера: 1443.'),
      linkIp: _('Адрес, который получает клиент в ссылке. Пусто = адрес прослушивания.'),
      faketlsDomain: _('Полное доменное имя для FakeTLS SNI.'),
      dcIps: _('По одному DC:IPv4 в строке, максимум 16. Пусто — значения по умолчанию провайдера.'),
      cfDomains: _('По одному домену в строке, максимум 8.'),
      cfWorkerDomains: _('По одному Worker-домену в строке, максимум 8.'),
      outboundProxy: _('Поддерживаются http://, socks5:// и socks5h://.'),
      noProxy: _('Comma-separated список исключений без пробелов.'),
      poolSize: _('1–32, default 4.'), bufKb: _('64–4096 KiB, default 256.'),
      maxConnections: _('0 = auto, иначе 1–65535.')
    };
    var bounds = { port: [1, 65535], poolSize: [1, 32], bufKb: [64, 4096], maxConnections: [0, 65535] };
    return FIELDS.filter(function (field) { return ids.indexOf(field.id) >= 0; }).map(function (field) {
      var result = Object.assign({}, field, { hint: hints[field.id] || null });
      if (bounds[field.id]) { result.min = bounds[field.id][0]; result.max = bounds[field.id][1]; }
      return result;
    });
  }
  function toggleAdvanced() {
    state.tgSettingsAdvanced = !state.tgSettingsAdvanced;
    ctx.root.replaceChildren(render(ctx));
  }
  function setLanAccess(enabled) {
    var next = clone(settings);
    next.host = enabled && lanAddress ? lanAddress : '127.0.0.1';
    if (enabled) next.linkIp = '';
    setLocalSettings(ctx, data, ProxyModel.safeSettings(next));
  }
  var dirty = isSettingsDirty(ctx, data);
  var mainRows = [];
  mainRows.push(E('div', { 'class': 'z2m-tg-settings-row' }, [
    E('label', {}, _('Прокси')),
    E('div', { 'class': 'z2m-tg-settings-control' }, [ctx.shell.switchControl({ checked: settings.enabled === true, label: _('Прокси'), onChange: function (v) { var n=clone(settings); n.enabled=v; setLocalSettings(ctx,data,ProxyModel.safeSettings(n)); } })])
  ]));
  mainRows.push(E('div', { 'class': 'z2m-tg-settings-row' }, [
    E('label', {}, _('Автозапуск')),
    E('div', { 'class': 'z2m-tg-settings-control' }, [ctx.shell.switchControl({ checked: settings.autostart === true, label: _('Автозапуск'), onChange: function (v) { var n=clone(settings); n.autostart=v; setLocalSettings(ctx,data,ProxyModel.safeSettings(n)); } })])
  ]));
  if (!!lanAddress && (lanEnabled || !settings.host || String(settings.host).indexOf('127.')===0)) {
    mainRows.push(E('div', { 'class': 'z2m-tg-settings-row' }, [
      E('label', {}, _('Доступ из локальной сети')),
      E('div', { 'class': 'z2m-tg-settings-control' }, [ctx.shell.switchControl({ checked: lanEnabled, label: _('Доступ из локальной сети'), onChange: setLanAccess })])
    ]));
  }
  var portField = fields(['port'])[0];
  var portInput = E('input', { type: 'number', value: settings.port, min: '1', max: '65535', 'aria-label': _('Порт'), style: 'width:90px' });
  portInput.addEventListener('change', function () {
    var v = parseInt(portInput.value, 10);
    if (!isFinite(v)) return;
    var n=clone(settings); n.port=v; setLocalSettings(ctx,data,ProxyModel.safeSettings(n));
  });
  mainRows.push(E('div', { 'class': 'z2m-tg-settings-row' }, [
    E('label', {}, _('Адрес и порт')),
    E('div', { 'class': 'z2m-tg-settings-control' }, [
      E('div', { 'class': 'z2m-tg-settings-addr' }, [E('strong', {}, advertised || '—'), E('span', {}, ' : '), portInput]),
      E('div', { 'class': 'z2m-tg-settings-hint' }, _('Этот адрес используется в ссылке и QR.'))
    ])
  ]));
  var mainSection = E('div', { 'class': 'z2m-tg-settings' }, [
    E('div', { 'class': 'z2m-proxy-form-section' }, [
      E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, _('Основное'))]),
      E('div', { 'class': 'z2m-tg-settings-grid' }, mainRows)
    ]),
    routingSummaryCard(shell, settings),
    (function () {
      var node = E('details', { 'class': 'z2m-proxy-advanced' }, [
        E('summary', {}, _('Дополнительные настройки')),
        settingsSection(ctx, data, settings, _('Адресация'), null, fields(['host', 'linkIp'])),
        settingsSection(ctx, data, settings, _('Маршрутизация'), null, fields(['dcIps', 'defaultDomains', 'cfPriority', 'cfBalance'])),
        settingsSection(ctx, data, settings, _('Cloudflare'), null, fields(['cfDomains', 'cfWorkerDomains'])),
        E('section', { 'class': 'z2m-proxy-form-section' }, [
          E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, _('Fallback-прокси'))]),
          E('div', { 'class': 'z2m-state-panel warn' }, [
            E('strong', { 'class': 'z2m-state-title' }, _('Контракт секрета на стороне сервера')),
            E('div', { 'class': 'z2m-state-message' }, _('Интерфейс не показывает существующие секреты. Управляемых резервных записей: ') + String(fallbackEntries.length)),
            E('div', { 'class': 'z2m-btnrow' }, [shell.button(_('Обновить состояние'), 'sm', function () { return ctx.refresh('proxy'); })])
          ]),
          settingsSection(ctx, data, settings, _('Исходящее соединение'), null, fields(['outboundProxy', 'noProxy']))
        ]),
        settingsSection(ctx, data, settings, _('FakeTLS'), null, fields(['faketlsDomain'])),
        settingsSection(ctx, data, settings, _('Производительность'), null, fields(['poolSize', 'bufKb', 'maxConnections'])),
        E('section', { 'class': 'z2m-proxy-form-section' }, [
          E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, _('Логи и диагностика'))]),
          settingsSection(ctx, data, settings, '', '', fields(['quiet', 'verbose'])),
          E('div', { 'class': 'z2m-state-panel ' + (object(cfgValue.secret).exists === true ? '' : 'warn') }, [
            E('strong', { 'class': 'z2m-state-title' }, object(cfgValue.secret).exists === true ? _('Секрет настроен ✓') : _('Секрет не найден')),
            E('div', { 'class': 'z2m-state-message' }, object(cfgValue.secret).exists === true ? _('Секрет хранится на роутере (0600) и никогда не отображается в настройках.') : _('Секрет будет создан автоматически при включении прокси.'))
          ]),
          E('details', { 'class': 'z2m-proxy-technical' }, [
            E('summary', {}, _('Технические сведения')),
            E('div', { 'class': 'z2m-proxy-info-list' }, [
              E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Config path'), E('strong', {}, '/etc/tg-ws-proxy/config.conf')]),
              E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Secret path'), E('strong', {}, '/etc/tg-ws-proxy/secret.conf · 0600')]),
              E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Init'), E('strong', {}, '/etc/init.d/tg-ws-proxy')])
            ])
          ])
        ])
      ]);
      node.open = state.tgSettingsAdvanced === true;
      return node;
    })(),
    dirty ? E('div', { 'class': 'z2m-tg-settings-actions' }, [
      E('span', { 'class': 'z2m-dim' }, _('Несохранённые изменения')),
      shell.button(_('Отменить'), '', function () { resetLocalSettings(ctx,data); }),
      shell.button(_('Сохранить изменения'), 'primary', function () { saveSettings(ctx,data); })
    ]) : null
  ]);
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    !installed ? shell.statePanel({ message: _('Настройки можно подготовить заранее, но применить их получится только после установки Rust или Go.'), kind: 'info' }) : null,
    profileCard(ctx, data, settings, presets),
    shell.panel(_('Настройки Telegram Proxy'), mainSection),
    E('div', { 'class': 'z2m-btnrow' }, [
      shell.button(_('Восстановить рекомендуемые'), '', function () { restoreRecommended(ctx, data, presets, settings); })
    ])
  ]);
}
function activityPane(ctx, data) {
  var shell = ctx.shell;
  var eventEnvelope = data.events;
  var rows = AvatarLog.normalizeRows({ events: telegramEventRows(eventEnvelope) }, 8);
  var eventPending = !eventEnvelope;
  var eventError = eventEnvelope && eventEnvelope.error;
  var host = AvatarLog.renderNormalized(rows, {
    id: 'telegram-activity-events',
    label: _('Журнал Telegram Proxy'),
    formatTimestamp: function (value) { return shell.format.timestamp(value); },
    compact: true,
    advanced: true,
    redactTechnical: ProductUX.redact,
    empty: eventPending
      ? shell.statePanel({ message: _('Журнал Telegram Proxy загружается…'), kind: 'info' })
      : eventError
        ? shell.statePanel({ message: _('Журнал Telegram Proxy недоступен.'), kind: 'error' })
        : shell.statePanel({ message: _('Событий Telegram Proxy пока нет.'), kind: 'info' })
  });
  var refresh = shell.button(_('Обновить'), 'sm', function () { ctx.refresh('proxy'); });
  var openLogs = shell.button(_('Открыть все журналы →'), 'primary sm', function () { return ctx.navigate('logs'); });
  var title = E('span', { style: 'white-space:nowrap' }, _('Журнал Telegram Proxy'));
  return shell.panel(title, host,
    _('Запуски, проверки, обновления и ошибки Telegram Proxy из общего журнала.'),
    E('div', { 'class': 'z2m-btnrow' }, [refresh, openLogs]));
}
function render(ctx) {
  var data = Object.assign({}, ctx.data || {}, state.deferred || {});
  var pstatus = providerStatus(data);
  var canonical = canonicalProjection(pstatus, object(data.health && data.health.value));
  var merged = Object.assign({}, object(data.status && data.status.value), object(data.health && data.health.value), {
    capabilities: object(data.capabilities && data.capabilities.value),
    supported: object(data.capabilities && data.capabilities.value).supported,
    installed: providerInstalled(pstatus.installed),
    process: canonical.process,
    listener: canonical.listener,
    outbound: canonical.outbound,
    activeConnections: canonical.activeConnections,
    drift: canonical.drift
  });
  var normalized = ProxyModel.normalize(merged);
  if (state.pane == null) state.pane = providerInstalled(pstatus.installed) ? 'overview' : 'component';
  state.pane = paneId(state.pane);
  var panes = {
    component: installPane(ctx, data),
    overview: statusPane(ctx, data, normalized),
    settings: settingsPane(ctx, data),
    journal: activityPane(ctx, data)
  };
  if (!panes[state.pane]) state.pane = 'component';
  var paneHost = E('div', { id: 'z2m-proxy-pane' }, panes[state.pane]);
  var tabs = ctx.shell.subTabs([
    { id: 'overview', label: _('Обзор') },
    { id: 'component', label: _('Компонент') },
    { id: 'settings', label: _('Настройки') },
    { id: 'journal', label: _('Журнал') }
  ], state.pane, function (id) {
    state.pane = paneId(id);
    paneHost.replaceChildren(panes[state.pane]);
  }, { 'aria-label': _('Разделы Telegram Proxy') });
  var errors = [];
  ['providerStatus', 'capabilities', 'status', 'config', 'health', 'events'].forEach(function (key) {
    if (data[key] && data[key].error) {
      var mapped = ProductUX.errorMessage(data[key].error, _('Данные Telegram Proxy недоступны.'));
      errors.push(E('div', { 'class': 'z2m-product-error' }, [
        ctx.shell.statePanel({ title: mapped.message, message: _('Повторите проверку или откройте технические детали.'), kind: 'error' }),
        E('details', { 'class': 'z2m-product-error-details' }, [E('summary', {}, _('Технические детали')), E('code', {}, mapped.technical)])
      ]));
    }
  });
  return E('section', { 'class': 'z2m-view on z2m-proxy-production', id: 'z2m-view-proxy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Telegram Proxy')), E('p', {}, _('Опциональный MTProto WebSocket proxy с безопасным управлением'))])
    ]),
    errors.length ? E('div', {}, errors) : null,
    tabs,
    paneHost
  ]));
}
function sameSettings(expected, actual) {
  expected = ProxyModel.safeSettings(expected);
  actual = ProxyModel.safeSettings(actual);
  return Object.keys(expected).every(function (key) {
    if (Array.isArray(expected[key])) return JSON.stringify(expected[key]) === JSON.stringify(actual[key]);
    return String(expected[key]) === String(actual[key]);
  });
}
function createAdapter(api) {
  function reloadAppliedState() {
    return Promise.all([api.proxy.configGet(), api.proxy.status()]).then(function (values) {
      var config = object(values[0]);
      var applied = ProxyModel.safeSettings(config.applied || config.config || config.draft || {});
      var appliedRevision = config.appliedRevision !== undefined ? config.appliedRevision : config.revision;
      return { value: { settings: applied, revision: appliedRevision, status: values[1] || {} }, revision: appliedRevision };
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value) {
      if (!value || !value.settings) return Promise.resolve({ ok: false, message: _('Proxy draft не содержит safe settings.') });
      return api.tg.product.status().then(function (status) {
        if (!status || !providerInstalled(status.installed))
          return { ok: false, error: { code: 'ENOPROVIDER', message: _('Сначала установите Rust или Go во вкладке TG Proxy.') } };
        return edit(api.proxy.configValidate, { config: value.settings });
      });
    },
    previewDraft: function (scope, value, context) {
      return edit(api.proxy.configPreview, { config: value.settings }).then(function (answer) {
        var read = context && context.applied && context.applied.proxy || {};
        var expected = object(answer && answer.precondition).appliedRevision;
        if (expected === undefined || expected === null) expected = read.revision;
        return Object.assign({}, answer || {}, { precondition: { revision: expected } });
      });
    },
    previewValid: function (answer) {
      return !!(answer && answer.ok === true && answer.writes === false && answer.precondition &&
        answer.precondition.revision !== null && answer.precondition.revision !== undefined);
    },
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.proxy.configApply, {
        config: value.settings,
        expectedAppliedRevision: expectedRevision
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      return sameSettings(value.settings, object(read && read.value).settings);
    },
    resetDraft: function () {}
  };
}
function unmount() {
  state.revealed = null;
  var leavingMountedPage = state.mountedLoadToken === state.loadToken;
  if (leavingMountedPage) {
    state.loadToken++;
    if (state.deferredTimer) clearTimeout(state.deferredTimer);
    state.deferredTimer = null;
  }
  state.mountedLoadToken = null;
  state.deferred = {};
  if (state.tgOperationTimer) clearTimeout(state.tgOperationTimer);
  state.tgOperationTimer = null;
  state.tgPollGeneration++;
  state.tgOperation = null;
  state.tgOperationStartedAt = null;
  state.tgRetry = null;
  state.busy = null;
  state.tgLifecycle = null;
  state.tgHealthCheck = null;
  tgViewportLock(false);
}

return baseclass.extend({
  id: 'proxy',
  title: _('Telegram Proxy'),
  subtitle: _('Опциональная установка последней версии Rust / Go'),
  load: load,
  render: render,
  mount: function (ctx) {
    state.mountedLoadToken = state.loadToken;
    scheduleDeferred(ctx, state.loadToken, false);
  },
  unmount: unmount,
  createAdapter: createAdapter
});
