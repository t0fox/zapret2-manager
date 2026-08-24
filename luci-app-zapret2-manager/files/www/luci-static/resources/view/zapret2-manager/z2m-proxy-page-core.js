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
  tgRetry: null,
  tgPollGeneration: 0,
  tgViewportLocked: false
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
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
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
function load(ctx) {
  return Promise.allSettled([
    ctx.api.proxy.capabilities(),
    ctx.api.proxy.status(),
    ctx.api.proxy.configGet(),
    edit(ctx.api.proxy.health, {}),
    edit((ctx.api.maintenance && ctx.api.maintenance.eventsTail) || ctx.api.monitor.eventsTail, { limit: 50 }),
    ctx.api.tg.product.catalog(),
    ctx.api.tg.product.status(),
    ctx.api.tg.product.versions(),
    ctx.api.tg.product.operationStatus({})
  ]).then(function (results) {
    var base = {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      health: settled(results[3], ctx.api),
      events: settled(results[4], ctx.api),
      providerCatalog: settled(results[5], ctx.api),
      providerStatus: settled(results[6], ctx.api),
      providerPreflight: settled(results[5], ctx.api),
      providerVersions: settled(results[7], ctx.api),
      providerOperation: settled(results[8], ctx.api),
      providerUpdates: { value: {} }
    };
    var providers = ['rust', 'go'];
    return Promise.all(providers.map(function (id) {
      return ctx.api.tg.product.checkUpdates({ provider: id }).then(function (answer) {
        return { id: id, answer: answer };
      }).catch(function (error) {
        return { id: id, answer: { ok: false, error: ctx.api.normalizeError(error) } };
      });
    })).then(function (updates) {
      var map = {};
      updates.forEach(function (item) { map[item.id] = item.answer; });
      base.providerUpdates = { value: map };
      return base;
    });
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
function mutation(ctx, name, promise) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.busy = null;
    return ctx.refresh('proxy').then(function () { return answer; });
  }).catch(function (error) {
    state.busy = null;
    showError(ctx, error);
    return null;
  });
}

function tgOperationLabel(stage) {
  var labels = {
    PREPARE: _('Подготовка'), PREFLIGHT: _('Предварительная проверка'), DOWNLOAD: _('Загрузка'),
    VERIFY: _('Проверка артефакта'), BACKUP: _('Сохранение текущего состояния'), INSTALL: _('Установка'),
    CONFIG_VALIDATE: _('Проверка конфигурации'), RESTART: _('Перезапуск сервиса'),
    HEALTHCHECK: _('Проверка работоспособности'), COMMIT: _('Подтверждение'),
    ROLLING_BACK: _('Откат'), ROLLED_BACK: _('Откат выполнен')
  };
  return labels[stage] || display(stage);
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
  // Legacy acceptance marker: «Установка выполняется» is now rendered in the locked transaction modal.
  var running = operation && (operation.status === 'RUNNING' || operation.status === 'ROLLING_BACK');
  var errorText = operation && operation.error && operation.error.message || operation && operation.recoveryError;
  var rollback = operation && operation.rollback;
  return E('div', { 'class': 'z2m-tg-operation-body', role: 'status', 'aria-live': 'polite' }, compact([
    E('strong', {}, running ? _('Изменение выполняется…') : operation && operation.status === 'COMPLETE' ? _('Изменение завершено') : _('Изменение не выполнено')),
    E('p', {}, running ? _('Дождитесь завершения: сервер завершит операцию и проверит работоспособность сервиса.') : errorText || (rollback && rollback.status === 'ROLLED_BACK' ? _('Предыдущая реализация восстановлена.') : _('Сервер завершил операцию.'))),
    E('div', { 'class': 'z2m-tg-operation-stage' }, [E('span', {}, tgOperationLabel(operation && operation.currentStage)), E('strong', {}, String(operation && operation.progressPercent != null ? operation.progressPercent : 0) + '%')]),
    E('div', { 'class': 'z2m-progress-track' }, E('div', { 'class': 'z2m-progress-bar', style: 'width:' + Math.max(0, Math.min(100, Number(operation && operation.progressPercent || 0))) + '%' })),
    E('div', { 'class': 'z2m-tg-operation-meta' }, _('Операция: ') + display(operation && operation.operationId)),
    !running && rollback ? E('div', { 'class': 'z2m-tg-operation-rollback' }, _('Откат: ') + display(rollback.status)) : null
  ]));
}
function renderTgOperationModal(ctx, operation) {
  if (!operation) return;
  var running = operation.status === 'RUNNING' || operation.status === 'ROLLING_BACK';
  tgViewportLock(running);
  var footer = [];
  if (!running && (operation.status === 'FAILED' || operation.status === 'ROLLED_BACK') && state.tgRetry) footer.push(ctx.shell.button(_('Повторить'), 'danger sm', function () {
    ctx.shell.closeModal();
    state.tgRetry();
  }));
  if (!running) footer.push(ctx.shell.button(_('Завершить'), 'primary sm', function () {
    ctx.shell.closeModal();
    tgViewportLock(false);
    state.tgOperation = null;
    state.tgRetry = null;
    if (state.tgOperationTimer) { clearTimeout(state.tgOperationTimer); state.tgOperationTimer = null; }
    ctx.refresh('proxy');
  }));
  ctx.shell.openModal(operation.status === 'COMPLETE' ? _('TG Proxy установлен') : running ? _('Изменение TG Proxy') : operation.status === 'ROLLED_BACK' ? _('TG Proxy восстановлен') : _('Ошибка изменения TG Proxy'), tgOperationBody(operation), footer);
  var close = document.querySelector('#z2m-modal .z2m-modal-close');
  if (close && running) { close.hidden = true; close.disabled = true; }
}
function watchTgOperation(ctx, operationId, retry) {
  if (state.tgOperationTimer) clearTimeout(state.tgOperationTimer);
  state.tgOperationTimer = null;
  state.tgPollGeneration++;
  var generation = state.tgPollGeneration;
  state.tgOperation = { operationId: operationId, status: 'RUNNING', currentStage: 'PREPARE', progressPercent: 0 };
  state.tgRetry = retry || null;
  renderTgOperationModal(ctx, state.tgOperation);
  function poll() {
    if (generation !== state.tgPollGeneration) return;
    ctx.api.tg.product.operationStatus({ operationId: operationId }).then(function (answer) {
      if (generation !== state.tgPollGeneration) return;
      if (!answer || answer.ok === false || !answer.operation) throw answer && answer.error || new Error(_('Состояние операции недоступно.'));
      state.tgOperation = answer.operation;
      renderTgOperationModal(ctx, state.tgOperation);
      if (state.tgOperation.status === 'RUNNING' || state.tgOperation.status === 'ROLLING_BACK') state.tgOperationTimer = setTimeout(poll, 900);
    }).catch(function (error) {
      if (generation !== state.tgPollGeneration) return;
      // The operation remains backend-owned; keep the modal and recover on the next status poll.
      state.tgOperation = Object.assign({}, state.tgOperation, { recoveryError: ctx.api.normalizeError(error).message });
      renderTgOperationModal(ctx, state.tgOperation);
      state.tgOperationTimer = setTimeout(poll, 1500);
    });
  }
  poll();
}
// The backend transaction is synchronous by contract: proxy_provider_install
// resolves to { ok, provider, version, health } in one RPC round trip. An
// async operation envelope (operationId) remains supported for forward
// compatibility, but success must never depend on it.
function finishTgTransaction(ctx, answer, retry, title) {
  if (answer && answer.operationId) { watchTgOperation(ctx, answer.operationId, retry); return; }
  var shell = ctx.shell;
  var identity = answer && answer.provider ? String(answer.provider).toUpperCase() : '';
  if (answer && answer.version) identity += ' ' + answer.version;
  shell.openModal(title, E('div', { 'class': 'z2m-tg-confirm-body' }, [
    E('strong', {}, identity || _('Готово')),
    E('p', {}, _('Сервер установил выбранную версию, перезапустил сервис и подтвердил локальную проверку работоспособности.'))
  ]), [shell.button(_('Завершить'), 'primary sm', function () {
    shell.closeModal();
    ctx.refresh('proxy');
  })]);
}
function tgTransactionConfirm(ctx, kind, provider, item, start) {
  var labels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Переключить') };
  var titles = { INSTALL: _('Установить TG Proxy?'), UPDATE: _('Обновить TG Proxy?'), DOWNGRADE: _('Откатить версию TG Proxy?'), PROVIDER_SWITCH: _('Переключить реализацию TG Proxy?') };
  var messages = {
    INSTALL: _('Будет подготовлен и проверен выбранный артефакт, затем сервер активирует его после проверки состояния.'),
    UPDATE: _('Будет загружено обновление и проверено, что процесс, слушатель и проверка Telegram работают.'),
    DOWNGRADE: _('Будет установлена выбранная более старая версия с сохранением текущей конфигурации и откатом при ошибке.'),
    PROVIDER_SWITCH: _('Текущий провайдер останется сохранённым до успешной проверки нового провайдера; при ошибке сервер выполнит откат.')
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
  var baseline = { revision: revision(data), settings: appliedConfig(data) };
  var draft = ProxyModel.draft(baseline, { settings: settings });
  if (draft) ctx.setDraft('proxy', draft);
  else ctx.clearDraft('proxy');
  ctx.refresh('proxy');
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
    _('Ссылка содержит proxy secret. Она не будет сохранена в store, журнале или coordinator draft.'),
    _('Показать'), function () {
      edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (answer) {
        var url = answer && (answer.https_link || answer.link);
        if (!url) throw answer || new Error('proxy link unavailable');
        state.revealed = url;
        ctx.shell.openModal(_('QR-код Telegram Proxy'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
          E('code', { 'class': 'z2m-proxy-link' }, url),
          Qr.render(url, 240),
          E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Скопировать ссылку'), 'primary sm', function () {
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
              ctx.shell.showToast(_('Буфер обмена недоступен в этом браузере.'), 'err');
              return;
            }
            navigator.clipboard.writeText(url).then(function () {
              ctx.shell.showToast(_('Ссылка скопирована.'), 'ok');
            }).catch(function () { ctx.shell.showToast(_('Не удалось скопировать ссылку.'), 'err'); });
          })]),
          E('div', { 'class': 'z2m-dim' }, _('Закрытие окна удалит ссылку из UI state.'))
        ]), [ctx.shell.button(_('Закрыть'), '', function () {
          state.revealed = null;
          ctx.shell.closeModal();
        })]);
      }).catch(showError.bind(null, ctx));
    }, false);
}
function lifecycle(ctx, method, label, message) {
  confirm(ctx, label + '?', message, label, function () {
    mutation(ctx, label, method());
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

function safeMarkdownText(value) {
  var holder = document.createElement('span');
  holder.textContent = String(value === null || value === undefined ? '' : value).slice(0, 32768);
  return holder.textContent;
}

function safeReleaseUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
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
  return blocks.length ? blocks : [E('p', { 'class': 'z2m-proxy-release-empty' }, _('Автор не указал описание изменений для этого релиза.'))];
}

function releaseSummary(item) {
  if (!item || !item.releaseBody) return E('p', { 'class': 'z2m-proxy-release-empty' }, _('Автор не указал описание изменений для этого релиза.'));
  var lines = safeMarkdownText(item.releaseBody).replace(/\r\n?/g, '\n').split('\n'), points = [];
  for (var i = 0; i < lines.length && points.length < 3; i++) {
    var line = lines[i].trim().replace(/^#{1,3}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (!line || /^```/.test(line)) continue;
    points.push(line.slice(0, 220));
  }
  return points.length ? E('ul', { 'class': 'z2m-proxy-release-summary' }, points.map(function (point) { return E('li', {}, markdownInline(point)); })) :
    E('p', { 'class': 'z2m-proxy-release-empty' }, _('Автор не указал описание изменений для этого релиза.'));
}

function selectedReleasePanel(provider, item) {
  if (!item || !item.version) return E('section', { 'class': 'z2m-panel z2m-proxy-selected-release' }, E('div', { 'class': 'bd' }, _('Выберите версию, чтобы увидеть описание релиза.')));
  var url = safeReleaseUrl(item.releaseUrl), full = item.releaseBody ? E('details', { 'class': 'z2m-proxy-release-full' }, [
    E('summary', {}, _('Показать полный changelog')),
    E('div', { 'class': 'z2m-proxy-release-markdown' }, renderReleaseMarkdown(item.releaseBody))
  ]) : null;
  return E('section', { 'class': 'z2m-panel z2m-proxy-selected-release' }, [
    E('div', { 'class': 'hd' }, [E('div', {}, [E('h2', {}, provider.title + ' ' + item.version), E('div', { 'class': 'sub' }, _('Выбранная версия'))])]),
    E('div', { 'class': 'bd' }, [
      E('div', { 'class': 'z2m-proxy-release-meta' }, [
        E('span', {}, _('Дата релиза: ') + display(item.publishedAt || '—')),
        item.releaseName ? E('span', {}, display(item.releaseName)) : null
      ]),
      E('h3', {}, _('Что изменилось')),
      releaseSummary(item),
      full,
      url ? E('a', { href: url, target: '_blank', rel: 'noopener noreferrer', 'class': 'z2m-proxy-release-link' }, _('Открыть релиз на GitHub')) : null
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

function providerCard(ctx, data, provider, status, releasePanel) {
  var shell = ctx.shell;
  var preflight = array(object(data.providerPreflight && data.providerPreflight.value).providers)
    .filter(function (item) { return item && item.provider === provider.id; })[0] || {};
  var versionRow = providerVersions(data).filter(function (item) { return item && item.id === provider.id; })[0] || {};
  var versions = array(versionRow.versions);
  var updateAnswer = object(data.providerUpdates && data.providerUpdates.value && data.providerUpdates.value[provider.id]);
  var updateChoices = [];
  if (updateAnswer && updateAnswer.ok && Array.isArray(updateAnswer.availableVersions)) {
    updateChoices = updateAnswer.availableVersions.map(function (v) {
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
        releaseUrl: v.releaseUrl || null,
        releaseBody: v.releaseBody || null
      };
    });
  }
  var selection = state.tgSelections[provider.id] || {};
  var fallbackChoices = versionChoices(versions);
  var choices = updateChoices.length ? updateChoices : fallbackChoices;
  var first = choices[0] || {};
  var selected = candidateForVersion(choices, selection.version || first.version);
  if (selected.version) state.tgSelections[provider.id] = { sourceId: selected.sourceId, version: selected.version };
  var isActive = providerInstalled(status.installed) && status.activeProvider === provider.id;
  var installedPackage = array(status.packages).filter(function (item) { return item && item.provider === provider.id; })[0] || {};
  var installedVersion = installedPackage.version || (isActive ? status.activeVersion : null) || installedPackage.packageVersion;
  var packageVersion = installedPackage.packageVersion ||
    (isActive ? status.activePackageVersion : null);
  var latest = choices.filter(function (item) { return item && item.sourceId === 'official-github-release'; })[0] || first;
  var selectedIdentity = selected.packageVersion || selected.version;
  var installedIdentity = packageVersion || installedVersion;
  var selectedPackageVersion = selected.packageVersion;
  var installedLatest = isActive && installedIdentity && selectedIdentity === installedIdentity;
  var needsUpdate = isActive && installedVersion && releaseVersionCompare(latest.version, installedVersion) > 0;
  var switching = providerInstalled(status.installed) && !isActive;
  var selectedRelation = isActive && installedIdentity ? releaseVersionCompare(selectedIdentity, installedIdentity) : null;
  var actionLabels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Переключить') };
  function actionKindFor(candidate) {
    var candidateIdentity = candidate && (candidate.packageVersion || candidate.version);
    var relation = isActive && installedIdentity ? releaseVersionCompare(candidateIdentity, installedIdentity) : null;
    return switching ? 'PROVIDER_SWITCH' : !providerInstalled(status.installed) ? 'INSTALL' : relation != null && relation < 0 ? 'DOWNGRADE' : 'UPDATE';
  }
  function actionLabelFor(candidate) {
    var candidateIdentity = candidate && (candidate.packageVersion || candidate.version);
    return isActive && installedIdentity && candidateIdentity === installedIdentity ? _('Актуально') : actionLabels[actionKindFor(candidate)];
  }
  function actionDisabledFor(candidate) {
    var candidateIdentity = candidate && (candidate.packageVersion || candidate.version);
    return !!state.busy || preflight.available === false || !candidate || !candidate.version || candidate.installable === false ||
      (isActive && installedIdentity && candidateIdentity === installedIdentity);
  }
  var installedVersionValue = installedVersionDisplay(installedVersion, packageVersion);
  var unavailableReason = preflight.available === false ? preflight.reason || _('Провайдер недоступен.') :
    selected.installable === false ? selected.unavailableReason || selected.incompatibilityReason || _('Выбранная версия недоступна.') :
    !selected.version ? _('Нет доступных версий для этого провайдера.') : null;
  var benefits = providerBenefits(provider.id);
  var diagnostics = E('details', { 'class': 'z2m-proxy-technical z2m-proxy-provider-diagnostics' }, [
    E('summary', {}, _('Подробнее')),
    compatibilityDetails(selected)
  ]);
  var action;
  var versionSelect = choices.length > 1 ? E('select', { 'aria-label': _('Версия'), value: selected.version || '', change: function (event) {
    var next = candidateForVersion(choices, event.target.value);
    state.tgSelections[provider.id] = { sourceId: next.sourceId, version: next.version };
    releasePanel.update(provider, next);
    diagnostics.replaceChildren(E('summary', {}, _('Подробнее')), compatibilityDetails(next));
    if (action && action.tagName === 'BUTTON') {
      action.textContent = actionLabelFor(next);
      action.disabled = actionDisabledFor(next);
    }
  } }, choices.map(function (item) {
    return E('option', { value: item.version }, item.version);
  })) : E('strong', { 'class': 'z2m-proxy-version-static' }, display(selected.version || latest.version));
  var actionLabel = actionLabelFor(selected);
  var actionNeedsButton = choices.length > 1 || !installedLatest;
  action = actionNeedsButton ? shell.button(actionLabel, 'primary sm', function () {
    var liveSelection = state.tgSelections[provider.id] || { sourceId: selected.sourceId, version: selected.version };
    var liveCandidate = candidateForVersion(choices, liveSelection.version) || selected;
    var request = { provider: provider.id, sourceId: liveCandidate.sourceId, version: liveCandidate.version };
    function start() {
      state.busy = 'provider-install';
      ctx.api.tg.product.checkUpdates(request).then(function (check) {
        if (!check || check.ok === false || !check.checkToken) throw check && check.error || new Error(_('Выбранная версия не прошла проверку.'));
        return ctx.api.tg.product.switch({ provider: provider.id, version: liveCandidate.version, checkToken: check.checkToken });
      }).then(function (answer) {
        if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог установить Telegram Proxy.'));
        state.busy = null;
        finishTgTransaction(ctx, answer, start, _('TG Proxy установлен'));
      }).catch(function (error) { state.busy = null; showError(ctx, error); });
    }
    tgTransactionConfirm(ctx, actionKindFor(liveCandidate), provider, liveCandidate, start);
  }, actionDisabledFor(selected)) : E('span', { 'class': 'z2m-proxy-installed-state' }, '✓ ' + _('Актуально'));
  // Compatibility marker for older acceptance readers: update.installable === false
  // is now represented by the selected version's exact incompatibilityReason.

  return E('article', { 'class': 'z2m-panel z2m-proxy-provider-card' + (isActive ? ' selected' : '') }, [
    E('div', { 'class': 'hd' }, compact([
      E('div', { 'class': 'z2m-proxy-provider-heading' }, [providerIcon(provider.id), E('h2', {}, provider.title)]),
      isActive ? E('div', { 'class': 'sp' }, shell.chip(needsUpdate ? _('Доступно обновление') : _('Активна'), needsUpdate ? 'o' : 'g', true)) : null
    ])),
    E('div', { 'class': 'bd' }, compact([
      E('strong', { 'class': 'z2m-proxy-provider-short' }, benefits.title),
      E('ul', { 'class': 'z2m-proxy-provider-benefits' }, benefits.items.map(function (item) { return E('li', {}, item); })),
      E('div', { 'class': 'z2m-proxy-info-list' }, [
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Установленная версия')), E('strong', {}, installedVersionValue)]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Последняя версия')), E('strong', {}, display(latest.displayVersion || latest.version))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Версия')), versionSelect]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Готовность')), E('strong', { 'class': !unavailableReason ? 'z2m-proxy-ok' : '' }, unavailableReason ? _('Недоступно') : _('Проверка перед установкой'))])
      ]),
      E('div', { 'class': unavailableReason ? 'z2m-proxy-install-state unavailable' : 'z2m-proxy-install-state ready' }, unavailableReason ? '⚠ ' + unavailableReason : '✓ ' + _('Можно установить на это устройство')),
      diagnostics,
      E('div', { 'class': 'z2m-btnrow z2m-proxy-provider-actions' }, [action])
    ]))
  ]);
}
function installPane(ctx, data) {
  var shell = ctx.shell;
  var status = providerStatus(data);
  var recoveredOperation = object(data.providerOperation && data.providerOperation.value).operation;
  if (!state.tgOperation && recoveredOperation && (recoveredOperation.status === 'RUNNING' || recoveredOperation.status === 'ROLLING_BACK'))
    watchTgOperation(ctx, recoveredOperation.operationId, state.tgRetry);
  var providers = providerCatalog(data).slice().sort(function (left, right) { return left.id === 'go' ? -1 : right.id === 'go' ? 1 : 0; });
  var selectedVersionPanel = E('div', { 'class': 'z2m-proxy-selected-release-wrap' });
  var releasePanel = {
    update: function (provider, item) {
      state.tgSelectedRelease = item && item.version ? { provider: provider.id, version: item.version } : null;
      selectedVersionPanel.replaceChildren(selectedReleasePanel(provider, item));
    }
  };
  var cards = providers.map(function (provider) { return providerCard(ctx, data, provider, status, releasePanel); });
  var initialProvider = providers.filter(function (provider) { return state.tgSelectedRelease && state.tgSelectedRelease.provider === provider.id; })[0] || providers[0];
  var initialVersions = initialProvider ? providerVersions(data).filter(function (row) { return row && row.id === initialProvider.id; })[0] || {} : {};
  var initialChoices = versionChoices(initialVersions.versions);
  var initialVersion = state.tgSelectedRelease && state.tgSelectedRelease.provider === (initialProvider || {}).id ? state.tgSelectedRelease.version : (initialChoices[0] || {}).version;
  releasePanel.update(initialProvider || { id: '', title: _('Telegram Proxy') }, candidateForVersion(initialChoices, initialVersion));
  var footer = [];
  var preflight = object(data.providerPreflight && data.providerPreflight.value);
  function refreshChecks() {
    if (state.busy) return;
    state.busy = 'preflight';
    ctx.refresh('proxy').then(function () { state.busy = null; }).catch(function (error) { state.busy = null; showError(ctx, error); });
  }

  if (providerInstalled(status.installed)) {
    footer.push(shell.button(_('Удалить'), 'danger sm', function () {
      tgUninstallConfirm(ctx, false, function () {
        state.busy = 'provider-remove';
        ctx.api.tg.product.remove({ confirm: 'REMOVE' }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог удалить Telegram Proxy.'));
          state.busy = null;
          if (answer.operationId) { watchTgOperation(ctx, answer.operationId, null); return null; }
          ctx.shell.showToast(_('TG Proxy удалён.'), 'ok');
          return ctx.refresh('proxy');
        }).catch(function (error) { state.busy = null; showError(ctx, error); });
      });
    }, !!state.busy));
    footer.push(shell.button(_('Удалить полностью'), 'danger sm', function () {
      tgUninstallConfirm(ctx, true, function () {
        state.busy = 'provider-purge';
        ctx.api.tg.product.purge({ confirm: 'PURGE' }).then(function (answer) {
          if (!answer || answer.ok === false) throw answer && answer.error || new Error(_('Сервер не смог выполнить полную очистку.'));
          state.busy = null;
          if (answer.operationId) { watchTgOperation(ctx, answer.operationId, null); return null; }
          ctx.shell.showToast(_('TG Proxy и настройки удалены.'), 'ok');
          return ctx.refresh('proxy');
        }).catch(function (error) { state.busy = null; showError(ctx, error); });
      });
    }, !!state.busy));
  }

  var checks = [
    { label: _('Архитектура'), value: display(preflight.architecture), good: !!preflight.architecture }
  ].concat(array(preflight.providers).map(function (item) {
    return { label: item.provider === 'rust' ? 'Rust' : 'Go', value: item.available ? _('Готов') : display(item.reason), good: item.available === true };
  }));
  var removePanel = null;
  if (footer.length) {
    removePanel = E('details', { 'class': 'z2m-proxy-danger-zone' }, [
      E('summary', {}, _('Дополнительные действия')),
      E('div', { 'class': 'z2m-proxy-danger-zone-body' }, [
        E('strong', {}, _('Удаление Telegram Proxy')),
        E('p', {}, _('Обычное удаление сохраняет настройки. Полная очистка удаляет конфигурацию и secret.')),
        E('div', { 'class': 'z2m-btnrow' }, footer)
      ])
    ]);
  }
  return E('div', { 'class': 'z2m-proxy-pane' }, compact([
    shell.statePanel({
      title: providerInstalled(status.installed) ? _('Компонент установлен') : _('Компонент не установлен'),
      message: providerInstalled(status.installed)
        ? _('Выбрано: ') + String(status.activeProvider || '—') + ' ' + String(status.activeVersion || '')
        : _('Это нормально: TG Proxy полностью опционален и не влияет на остальные функции Zapret2 Manager.'),
      kind: providerInstalled(status.installed) ? 'success' : 'info'
    }),
    data.providerCatalog && data.providerCatalog.error ? shell.statePanel({
      title: _('Каталог недоступен'), message: data.providerCatalog.error.message, kind: 'error'
    }) : null,
    shell.panel(_('Проверка готовности'), E('details', { 'class': 'z2m-proxy-preflight-disclosure', open: !providerInstalled(status.installed) || checks.some(function (item) { return !item.good; }) }, [
      E('summary', {}, checks.every(function (item) { return item.good; }) ? _('Устройство совместимо · проверка пройдена') : _('Некоторые реализации недоступны')),
      E('div', { 'class': 'z2m-proxy-preflight' }, checks.map(function (item) {
        return E('div', { 'class': 'z2m-proxy-check ' + (item.good ? 'good' : 'warn') }, [E('span', {}, item.label), E('strong', {}, item.value)]);
      })),
      shell.button(_('Повторить проверку'), 'sm', refreshChecks, !!state.busy)
    ]), _('Перед установкой проверяются устройство и доступность реализации')),
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
  var cfg = object(data.config && data.config.value);
  var applied = object(cfg.applied || cfg.draft);
  var listener = array(raw.listeners)[0] || {};
  var update = activeUpdateState(data, pstatus);
  var actions = [];
  if (!normalized.process) actions.push(shell.button(_('Запустить'), 'primary sm', function () {
    lifecycle(ctx, ctx.api.tg.product.start, _('Запустить'), _('Сервер проверит процесс и точный адрес слушателя после запуска.'));
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Проверить'), 'primary sm', function () {
    return ctx.refresh('proxy');
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Перезапустить'), 'sm', function () {
    lifecycle(ctx, ctx.api.tg.product.restart, _('Перезапустить'), _('Текущие подключения будут прерваны.'));
  }, !!state.busy));
  actions.push(shell.button(_('Ссылка / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy));
  var secondaryActions = E('details', { 'class': 'z2m-proxy-overflow-menu' }, [
    E('summary', {}, _('Ещё')),
    E('div', { 'class': 'z2m-proxy-overflow-list' }, compact([
      normalized.process ? shell.button(_('Остановить'), 'danger sm', function () {
        lifecycle(ctx, ctx.api.tg.product.stop, _('Остановить'), _('Telegram Proxy перестанет принимать подключения.'));
      }, !!state.busy) : null,
      shell.button(_('Новая ссылка'), 'sm', function () {
        lifecycle(ctx, ctx.api.proxy.secretRotate, _('Создать новую ссылку'), _('Старая ссылка перестанет работать; сервер проверит слушатель и выполнит откат при ошибке.'));
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
  var serviceRows = [
    [_('Провайдер'), activeProviderLabel(data, pstatus)],
    [_('Слушатель'), normalized.listener && listenerAddress ? display(listenerAddress) + ':' + display(listenerPort) : _('Не подтверждён')],
    [_('Версия'), installedVersionDisplay(pstatus.activeVersion, pstatus.activePackageVersion)],
    [_('Автозапуск'), object(cfg.autostart).rcDEnabled ? _('Включён') : _('Выключен')],
    [_('Активные сессии'), normalized.activeConnections === null || normalized.activeConnections === undefined ? '—' : String(normalized.activeConnections)]
  ];
  var health = [
    ['provider', _('Провайдер'), installed, installed ? _('Готов') : _('Не установлен')],
    ['process', _('Процесс'), normalized.process, normalized.process ? _('Запущен') : _('Остановлен')],
    ['listener', _('Слушатель'), normalized.listener, normalized.listener ? _('Готов') : _('Не подтверждён')],
    ['telegram-dc', _('Telegram DC'), normalized.outbound, normalized.outbound ? _('Готова') : _('Не подтверждена')]
  ];
  var rawHealth = object(data.health && data.health.value);
  var runtime = object(raw.runtime);
  var technicalRows = [
    [_('PID'), display(raw.pid !== undefined ? raw.pid : runtime.pid)],
    [_('Ревизия'), display(cfg.appliedRevision)],
    [_('Состояние провайдера'), pstatus.drift ? _('Обнаружен дрейф') : _('Синхронизирован')],
    [_('Ревизия пакета'), display(pstatus.activePackageVersion)],
    [_('Внутреннее состояние'), display(pstatus.state !== undefined ? pstatus.state : raw.state)]
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
  var humanStatus = normalized.truth === 'healthy' ? _('Работает') : normalized.process ? _('Работает с ограничениями') : _('Остановлен');
  var statusMessage = normalized.truth === 'healthy' ? _('Все проверки пройдены.') : normalized.process ?
    (normalized.outbound ? _('Прокси локально работает, но часть проверок требует внимания.') : _('Прокси локально работает, но соединение с Telegram DC ещё не подтверждено.')) :
    _('Процесс Telegram Proxy сейчас не запущен.');
  function healthStep(row) {
    return E('div', { 'class': 'z2m-proxy-health-step ' + (row[2] ? 'ok' : 'warn') }, compact([
      E('span', {}, row[1]),
      E('strong', {}, row[3]),
      !row[2] && (row[0] === 'listener' || row[0] === 'telegram-dc') ? shell.button(_('Проверить снова'), 'ghost sm', function () { return ctx.refresh('proxy'); }, !!state.busy) : null
    ]));
  }
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    E('section', { 'class': 'z2m-panel z2m-proxy-status-panel' }, [
      E('div', { 'class': 'bd' }, [
        E('div', { 'class': 'z2m-proxy-status-hero' }, [
          E('div', { 'class': 'z2m-proxy-status-summary' }, [
            E('div', { 'class': 'z2m-proxy-telegram-logo' }, E('img', { src: L.resource('view/zapret2-manager/icons/telegram.svg'), alt: 'Telegram' })),
            E('div', {}, [
              E('h3', {}, humanStatus),
              E('p', { 'class': 'z2m-proxy-status-meta' }, activeProviderLabel(data, pstatus) + ' · ' + installedVersionDisplay(pstatus.activeVersion, pstatus.activePackageVersion) + ' · ' + (object(cfg.autostart).rcDEnabled ? _('Автозапуск включён') : _('Автозапуск выключен'))),
              E('p', {}, statusMessage)
            ])
          ]),
          E('div', { 'class': 'z2m-btnrow z2m-proxy-lifecycle-actions' }, actions)
        ]),
        E('div', { 'class': 'z2m-proxy-status-section' }, [
          E('h3', {}, _('Цепочка работоспособности')),
          E('div', { 'class': 'z2m-proxy-health-chain' }, health.map(healthStep))
        ]),
        E('div', { 'class': 'z2m-proxy-status-section' }, [
          E('h3', {}, _('Сервис')),
          E('div', { 'class': 'z2m-proxy-info-list' }, serviceRows.map(infoRow))
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
  var grid = E('div', { 'class': 'z2m-cbi z2m-proxy-form-grid' });
  fields.forEach(function (field) {
    var nodes = fieldNode(ctx, field, settings[field.id], function (value) {
      var next = clone(settings);
      next[field.id] = value;
      stage(ctx, data, next);
    });
    grid.appendChild(nodes[0]);
    grid.appendChild(nodes[1]);
  });
  return E('section', { 'class': 'z2m-proxy-form-section' }, [
    E('div', { 'class': 'z2m-proxy-form-head' }, [E('h3', {}, title), E('p', {}, subtitle)]),
    grid
  ]);
}
function settingsPane(ctx, data) {
  var shell = ctx.shell;
  var pstatus = providerStatus(data);
  var installed = providerInstalled(pstatus.installed);
  var settings = workingConfig(ctx, data);
  var draft = currentDraft(ctx);
  var fallbackEntries = array(settings.mtprotoProxies);
  function fields(ids) {
    var hints = {
      host: _('Требуется конкретный локальный IPv4. Wildcard bind запрещён.'),
      port: _('Диапазон 1–65535. Значение провайдера по умолчанию: 1443.'),
      linkIp: _('Пустое значение использует адрес прослушивания.'),
      faketlsDomain: _('Полное доменное имя для FakeTLS SNI.'),
      dcIps: _('По одному DC:IPv4 в строке, максимум 16.'),
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
  return E('div', { 'class': 'z2m-proxy-pane' }, compact([
    !installed ? shell.statePanel({
      message: _('Настройки можно подготовить заранее, но применить их получится только после установки Rust или Go.'),
      kind: 'info'
    }) : null,
    shell.panel(_('Настройки Telegram Proxy'), E('div', {}, [
      settingsSection(ctx, data, settings, _('Основное'), _('Слушатель, ссылка и запуск сервиса'), fields(['enabled','autostart','host','port','linkIp','faketlsDomain'])),
      settingsSection(ctx, data, settings, _('Маршруты Telegram DC'), _('Прямые маршруты Telegram DC'), fields(['dcIps'])),
      settingsSection(ctx, data, settings, _('Маршрутизация Cloudflare'), _('Домены и адреса Worker для WebSocket-маршрутизации'), fields(['cfDomains','cfWorkerDomains','cfPriority','cfBalance','defaultDomains'])),
      E('section', { 'class': 'z2m-proxy-form-section' }, [
        E('div', { 'class': 'z2m-proxy-form-head' }, [
          E('h3', {}, _('Резервный MTProto-маршрут')),
          E('p', {}, _('Поведение Avatar сохранено как безопасная резервная секция под управлением сервера. Секретные записи не возвращаются в браузер.'))
        ]),
        E('div', { 'class': 'z2m-state-panel warn' }, [
          E('strong', { 'class': 'z2m-state-title' }, _('Контракт секрета на стороне сервера')),
          E('div', { 'class': 'z2m-state-message' }, _('Интерфейс не показывает и не сохраняет существующие секреты исходящего соединения в черновике или журнале. Управляемых резервных записей: ') + String(fallbackEntries.length)),
          E('div', { 'class': 'z2m-btnrow' }, [shell.button(_('Обновить состояние'), 'sm', function () { return ctx.refresh('proxy'); })])
        ])
      ]),
      settingsSection(ctx, data, settings, _('Исходящее соединение'), _('Необязательный HTTP/SOCKS proxy для исходящих подключений'), fields(['outboundProxy','noProxy'])),
      settingsSection(ctx, data, settings, _('Ресурсы и логирование'), _('Ограничения рабочего процесса провайдера'), fields(['poolSize','bufKb','maxConnections','quiet','verbose'])),
      E('details', { 'class': 'z2m-proxy-technical' }, [
        E('summary', {}, _('Технические сведения')),
        E('div', { 'class': 'z2m-proxy-info-list' }, [
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Config path'), E('strong', {}, '/etc/tg-ws-proxy/config.conf')]),
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Secret path'), E('strong', {}, '/etc/tg-ws-proxy/secret.conf · 0600')]),
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Init'), E('strong', {}, '/etc/init.d/tg-ws-proxy')])
        ])
      ])
    ]), _('Изменения сохраняются как черновик и применяются общим coordinator workflow.'), draft.settings ? shell.button(_('Показать различия'), 'primary sm', ctx.openSemanticDiff, false) : null),
    state.preview ? shell.statePanel({ message: _('Предпросмотр сервера готов; применение выполняется общим координатором.'), kind: 'success' }) : null
  ]));
}
function activityPane(ctx, data) {
  var shell = ctx.shell;
  var rows = AvatarLog.normalizeRows({ events: telegramEventRows(data.events) }, 8);
  var host = AvatarLog.renderNormalized(rows, {
    id: 'telegram-activity-events',
    label: _('Журнал Telegram Proxy'),
    formatTimestamp: function (value) { return shell.format.timestamp(value); },
    compact: true,
    advanced: true,
    redactTechnical: ProductUX.redact,
    empty: shell.statePanel({ message: _('Событий Telegram Proxy пока нет.'), kind: 'info' })
  });
  var refresh = shell.button(_('Обновить'), 'sm', function () { ctx.refresh('proxy'); });
  var openLogs = shell.button(_('Открыть все журналы →'), 'primary sm', function () { return ctx.navigate('logs'); });
  var title = E('span', { style: 'white-space:nowrap' }, _('Журнал Telegram Proxy'));
  return shell.panel(title, host,
    _('Запуски, проверки, обновления и ошибки Telegram Proxy из общего журнала.'),
    E('div', { 'class': 'z2m-btnrow' }, [refresh, openLogs]));
}
function render(ctx) {
  var data = ctx.data || {};
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
  if (state.tgOperationTimer) clearTimeout(state.tgOperationTimer);
  state.tgOperationTimer = null;
  state.tgPollGeneration++;
  state.tgOperation = null;
  state.tgRetry = null;
  state.busy = null;
  tgViewportLock(false);
}

return baseclass.extend({
  id: 'proxy',
  title: _('Telegram Proxy'),
  subtitle: _('Опциональная установка последней версии Rust / Go'),
  load: load,
  render: render,
  mount: function () {},
  unmount: unmount,
  createAdapter: createAdapter
});
