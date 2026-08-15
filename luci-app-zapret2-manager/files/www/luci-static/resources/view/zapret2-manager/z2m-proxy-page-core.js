'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-model as ProxyModel';
'require view.zapret2-manager.z2m-qr as Qr';

var FIELDS = [
  { id: 'enabled', label: _('Включено'), type: 'bool' },
  { id: 'autostart', label: _('Автозапуск'), type: 'bool' },
  { id: 'host', label: _('Адрес прослушивания'), type: 'text' },
  { id: 'port', label: _('Порт'), type: 'number' },
  { id: 'linkIp', label: _('Адрес в ссылке'), type: 'text' },
  { id: 'faketlsDomain', label: _('FakeTLS SNI'), type: 'text' },
  { id: 'dcIps', label: _('Telegram DC mappings'), type: 'list' },
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
  tgViewportLocked: false
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function compact(value) { return array(value).filter(function (item) { return item !== null && item !== undefined; }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function display(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
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
function load(ctx) {
  return Promise.allSettled([
    ctx.api.proxy.capabilities(),
    ctx.api.proxy.status(),
    ctx.api.proxy.configGet(),
    edit(ctx.api.proxy.health, {}),
    edit(ctx.api.proxy.logsTail, { n: 50 }),
    ctx.api.tg.product.catalog(),
    ctx.api.tg.product.status(),
    ctx.api.tg.product.versions(),
    ctx.api.tg.product.operationStatus({})
  ]).then(function (results) {
    return {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      health: settled(results[3], ctx.api),
      logs: settled(results[4], ctx.api),
      providerCatalog: settled(results[5], ctx.api),
      providerStatus: settled(results[6], ctx.api),
      providerPreflight: settled(results[5], ctx.api),
      providerVersions: settled(results[7], ctx.api),
      providerOperation: settled(results[8], ctx.api),
      providerUpdates: { value: { providers: [] } }
    };
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
  ctx.shell.showToast(ctx.api.normalizeError(error).message, 'err');
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
    E('p', {}, running ? _('Дождитесь завершения: backend завершит транзакцию и проверит работоспособность сервиса.') : errorText || (rollback && rollback.status === 'ROLLED_BACK' ? _('Предыдущая реализация восстановлена.') : _('Backend завершил операцию.'))),
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
  state.tgOperation = { operationId: operationId, status: 'RUNNING', currentStage: 'PREPARE', progressPercent: 0 };
  state.tgRetry = retry || null;
  renderTgOperationModal(ctx, state.tgOperation);
  function poll() {
    ctx.api.tg.product.operationStatus({ operationId: operationId }).then(function (answer) {
      if (!answer || answer.ok === false || !answer.operation) throw answer && answer.error || new Error(_('Состояние операции недоступно.'));
      state.tgOperation = answer.operation;
      renderTgOperationModal(ctx, state.tgOperation);
      if (state.tgOperation.status === 'RUNNING' || state.tgOperation.status === 'ROLLING_BACK') state.tgOperationTimer = setTimeout(poll, 900);
    }).catch(function (error) {
      // The operation remains backend-owned; keep the modal and recover on the next status poll.
      state.tgOperation = Object.assign({}, state.tgOperation, { recoveryError: ctx.api.normalizeError(error).message });
      renderTgOperationModal(ctx, state.tgOperation);
      state.tgOperationTimer = setTimeout(poll, 1500);
    });
  }
  poll();
}
function tgTransactionConfirm(ctx, kind, provider, item, start) {
  var labels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Переключить') };
  var titles = { INSTALL: _('Установить TG Proxy?'), UPDATE: _('Обновить TG Proxy?'), DOWNGRADE: _('Откатить версию TG Proxy?'), PROVIDER_SWITCH: _('Переключить реализацию TG Proxy?') };
  var messages = {
    INSTALL: _('Будет подготовлен и проверен выбранный артефакт, затем backend активирует его после healthcheck.'),
    UPDATE: _('Будет загружено обновление и проверено, что процесс, listener и Telegram healthcheck работают.'),
    DOWNGRADE: _('Будет установлена выбранная более старая версия с сохранением текущей конфигурации и откатом при ошибке.'),
    PROVIDER_SWITCH: _('Текущий provider останется сохранённым до успешной проверки нового provider; при ошибке backend выполнит откат.')
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
    E('p', {}, purge ? _('Backend удалит provider, конфигурацию и secret после подтверждения операции.') : _('Backend удалит provider, но сохранит конфигурацию и secret для последующей установки.'))
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
function canonicalProjection(status) {
  status = object(status);
  var runtime = object(status.runtime);
  var health = object(status.health);
  var route = object(health.route);
  var upstream = object(route.upstream);
  var listeners = array(runtime.listeners);
  return {
    process: status.status === 'running' || runtime.running === true || object(status.observed).running === true,
    listener: listeners.some(function (item) {
      return item && item.address && item.port !== undefined;
    }),
    outbound: upstream.ok === true || status.outbound === true,
    activeConnections: runtime.activeConnections,
    drift: status.drift === true
  };
}
function providerCatalog(data) {
  return array(object(data.providerCatalog && data.providerCatalog.value).providers);
}
function providerVersions(data) {
  return array(object(data.providerVersions && data.providerVersions.value).providers);
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
    E('div', {}, _('Артефакт: ') + (item.apkAvailable ? _('OpenWrt APK') : item.directBinaryAvailable ? _('direct binary') : _('не найден'))),
    E('div', {}, _('SHA-256: ') + (item.checksumAvailable ? _('проверяется') : _('нет'))),
    E('div', {}, _('Механизм подписи: ') + (item.apkSignatureTrusted ? _('upstream key') : item.trustMode === 'sha256-only' ? _('sha256-only') : _('не подтверждён')))
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
  var selection = state.tgSelections[provider.id] || {};
  var choices = versionChoices(versions);
  var first = choices[0] || {};
  var selected = candidateForVersion(choices, selection.version || first.version);
  if (selected.version) state.tgSelections[provider.id] = { sourceId: selected.sourceId, version: selected.version };
  var isActive = providerInstalled(status.installed) && status.activeProvider === provider.id;
  var installedVersion = (array(status.packages).filter(function (item) { return item && item.provider === provider.id; })[0] || {}).version ||
    (array(status.packages).filter(function (item) { return item && item.provider === provider.id; })[0] || {}).packageVersion || (isActive ? status.activeVersion : null);
  var packageVersion = (array(status.packages).filter(function (item) { return item && item.provider === provider.id; })[0] || {}).packageVersion ||
    (isActive ? status.activePackageVersion : null);
  var latest = choices.filter(function (item) { return item && item.sourceId === 'official-github-release'; })[0] || first;
  var selectedIdentity = selected.packageVersion || selected.version;
  var installedIdentity = packageVersion || installedVersion;
  var selectedPackageVersion = selected.packageVersion;
  var installedLatest = isActive && installedIdentity && selectedIdentity === installedIdentity;
  var needsUpdate = isActive && installedVersion && releaseVersionCompare(latest.version, installedVersion) > 0;
  var switching = providerInstalled(status.installed) && !isActive;
  var selectedRelation = isActive && installedIdentity ? releaseVersionCompare(selectedIdentity, installedIdentity) : null;
  var actionKind = switching ? 'PROVIDER_SWITCH' : !providerInstalled(status.installed) ? 'INSTALL' : selectedRelation != null && selectedRelation < 0 ? 'DOWNGRADE' : 'UPDATE';
  var actionLabels = { INSTALL: _('Установить'), UPDATE: _('Обновить'), DOWNGRADE: _('Откатить версию'), PROVIDER_SWITCH: _('Переключить') };
  var packageVersionDisplay = packageVersion || (isActive && selected.artifactFormat === 'binary' ? _('Не предоставляется (direct binary)') : null);
  var unavailableReason = preflight.available === false ? preflight.reason || _('Backend-провайдер недоступен.') :
    selected.installable === false ? selected.unavailableReason || selected.incompatibilityReason || _('Выбранная версия недоступна.') :
    !selected.version ? _('Нет доступных версий для этого провайдера.') : null;
  var benefits = providerBenefits(provider.id);
  var diagnostics = E('details', { 'class': 'z2m-proxy-technical z2m-proxy-provider-diagnostics' }, [
    E('summary', {}, _('Подробнее')),
    compatibilityDetails(selected)
  ]);
  var action;
  var versionSelect = E('select', { 'aria-label': _('Версия'), value: selected.version || '', change: function (event) {
    var next = candidateForVersion(choices, event.target.value);
    state.tgSelections[provider.id] = { sourceId: next.sourceId, version: next.version };
    releasePanel.update(provider, next);
    diagnostics.replaceChildren(E('summary', {}, _('Подробнее')), compatibilityDetails(next));
    if (action) action.disabled = !!state.busy || !next.version || next.installable === false;
  } }, choices.map(function (item) {
    return E('option', { value: item.version }, item.version);
  }));
  var actionLabel = installedLatest ? _('Установлено') : actionLabels[actionKind];
  action = shell.button(preflight.available === false || selected.installable === false || !selected.version ? _('Недоступно') : actionLabel, installedLatest ? 'sm' : 'primary sm', function () {
    var liveSelection = state.tgSelections[provider.id] || { sourceId: selected.sourceId, version: selected.version };
    var liveCandidate = candidateForVersion(choices, liveSelection.version) || selected;
    var request = { provider: provider.id, sourceId: liveCandidate.sourceId, version: liveCandidate.version };
    function start() {
      state.busy = 'provider-install';
      ctx.api.tg.product.checkUpdates(request).then(function (check) {
        if (!check || check.ok === false || !check.checkToken) throw check && check.error || new Error(_('Выбранная версия не прошла проверку.'));
        return ctx.api.tg.product.switch({ provider: provider.id, sourceId: liveCandidate.sourceId, version: liveCandidate.version, checkToken: check.checkToken });
      }).then(function (answer) {
        if (!answer || answer.ok === false || !answer.operationId) throw answer && answer.error || new Error(_('Backend не создал операцию TG Proxy.'));
        state.busy = null;
        watchTgOperation(ctx, answer.operationId, start);
      }).catch(function (error) { state.busy = null; showError(ctx, error); });
    }
    tgTransactionConfirm(ctx, actionKind, provider, liveCandidate, start);
  }, !!state.busy || installedLatest || preflight.available === false || !selected.version || selected.installable === false);
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
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Установленная версия')), E('strong', {}, display(installedVersion))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Package version')), E('strong', {}, display(packageVersionDisplay))]),
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
    Promise.allSettled([ctx.api.tg.product.catalog(), ctx.api.tg.product.versions()]).then(function () {
      state.busy = null;
      return ctx.refresh('proxy');
    }).catch(function (error) { state.busy = null; showError(ctx, error); });
  }

  if (providerInstalled(status.installed)) {
    footer.push(shell.button(_('Удалить'), 'danger sm', function () {
      tgUninstallConfirm(ctx, false, function () {
        state.busy = 'provider-remove';
        ctx.api.tg.product.remove({ confirm: 'REMOVE' }).then(function (answer) {
          if (!answer || answer.ok === false || !answer.operationId) throw answer && answer.error || new Error(_('Backend не создал операцию удаления.'));
          state.busy = null;
          watchTgOperation(ctx, answer.operationId, null);
        }).catch(function (error) { state.busy = null; showError(ctx, error); });
      });
    }, !!state.busy));
    footer.push(shell.button(_('Удалить полностью'), 'danger sm', function () {
      tgUninstallConfirm(ctx, true, function () {
        state.busy = 'provider-purge';
        ctx.api.tg.product.purge({ confirm: 'PURGE' }).then(function (answer) {
          if (!answer || answer.ok === false || !answer.operationId) throw answer && answer.error || new Error(_('Backend не создал операцию полной очистки.'));
          state.busy = null;
          watchTgOperation(ctx, answer.operationId, null);
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
    removePanel = shell.panel(_('Удаление Telegram Proxy'), E('div', { 'class': 'z2m-btnrow' }, footer),
      _('Обычное удаление сохраняет настройки. Полная очистка удаляет конфигурацию и secret.'));
    removePanel.classList.add('z2m-proxy-danger-zone');
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
    shell.panel(_('Проверка готовности'), E('div', { 'class': 'z2m-proxy-preflight' }, checks.map(function (item) {
      return E('div', { 'class': 'z2m-proxy-check ' + (item.good ? 'good' : 'warn') }, [E('span', {}, item.label), E('strong', {}, item.value)]);
    })), _('Перед установкой проверяются устройство и доступность реализации'), shell.button(_('Повторить проверку'), 'sm', refreshChecks, !!state.busy)),
    E('div', { 'class': 'z2m-grid z2m-grid-2 z2m-proxy-provider-grid' }, cards),
    selectedVersionPanel,
    removePanel
  ]));
}
function statusPane(ctx, data, normalized) {
  var shell = ctx.shell;
  if (data.providerStatus && data.providerStatus.error) return shell.avatar.showErrorState(null, data.providerStatus.error, {
    api: ctx.api,
    retry: function () { return ctx.refresh('proxy'); },
    body: _('Telegram Proxy опционален и не влияет на остальные функции Zapret 2 Manager.')
  });
  var pstatus = providerStatus(data);
  var installed = providerInstalled(pstatus.installed);
  if (!installed) return shell.statePanel({
    title: _('TG Proxy не установлен'),
    message: _('Выберите Rust или Go во вкладке «Установка». Остальной менеджер продолжает работать без TG Proxy.'),
    kind: 'info'
  });

  var raw = object(data.status && data.status.value);
  var cfg = object(data.config && data.config.value);
  var applied = object(cfg.applied || cfg.draft);
  var listener = array(raw.listeners)[0] || {};
  var actions = [];
  if (!normalized.process) actions.push(shell.button(_('Запустить'), 'primary sm', function () {
    lifecycle(ctx, ctx.api.tg.product.start, _('Запустить'), _('Backend проверит процесс и точный listener после запуска.'));
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Перезапустить'), 'sm', function () {
    lifecycle(ctx, ctx.api.tg.product.restart, _('Перезапустить'), _('Текущие подключения будут прерваны.'));
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Остановить'), 'danger sm', function () {
    lifecycle(ctx, ctx.api.tg.product.stop, _('Остановить'), _('Telegram Proxy перестанет принимать подключения.'));
  }, !!state.busy));
  actions.push(shell.button(_('Новая ссылка'), 'danger sm', function () {
    lifecycle(ctx, ctx.api.proxy.secretRotate, _('Создать новую ссылку'), _('Старая ссылка перестанет работать; backend выполнит listener verification и rollback при ошибке.'));
  }, !!state.busy));
  actions.push(shell.button(_('Показать ссылку / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy));

  var badges = [shell.chip(pstatus.activeProvider === 'rust' ? 'Rust' : 'Go', 'b'), shell.chip(display(pstatus.activeVersion), ''), shell.chip(truthLabel(normalized.truth), truthKind(normalized.truth), true)];
  var metrics = [
    [_('Реализация'), pstatus.activeProvider === 'rust' ? 'Rust' : 'Go'],
    [_('Listener'), normalized.listener ? display(listener.address || applied.host) + ':' + display(listener.port || applied.port) : _('Не подтверждён')],
    [_('Активные сессии'), normalized.activeConnections === null ? '—' : String(normalized.activeConnections)],
    [_('Revision'), display(cfg.appliedRevision)]
  ];
  var statusRows = [
    [_('Версия'), display(pstatus.activeVersion)],
    [_('Package version'), display(pstatus.activePackageVersion)],
    [_('Процесс'), normalized.process ? _('Запущен') : _('Остановлен')],
    [_('Listener'), normalized.listener ? _('Подтверждён') : _('Не подтверждён')],
    [_('Связь с Telegram DC'), normalized.outbound ? _('Подтверждена') : _('Не подтверждена')],
    [_('Автозапуск'), object(cfg.autostart).rcDEnabled ? _('Включён') : _('Выключен')],
    [_('Provider drift'), pstatus.drift ? _('Обнаружен') : _('Нет')]
  ];
  var health = [
    [_('Provider'), installed, installed ? _('Готов') : _('Не установлен')],
    [_('Process'), normalized.process, normalized.process ? _('Запущен') : _('Остановлен')],
    [_('Listener'), normalized.listener, normalized.listener ? _('Готов') : _('Не подтверждён')],
    [_('Telegram DC'), normalized.outbound, normalized.outbound ? _('Готова') : _('Не подтверждена')]
  ];
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    E('section', { 'class': 'z2m-panel z2m-proxy-status-panel' }, [
      E('div', { 'class': 'bd' }, [
        E('div', { 'class': 'z2m-proxy-status-hero' }, [
          E('div', { 'class': 'z2m-proxy-status-summary' }, [
            E('div', { 'class': 'z2m-proxy-telegram-logo' }, E('img', { src: L.resource('view/zapret2-manager/icons/telegram.svg'), alt: 'Telegram' })),
            E('div', {}, [
              E('h3', {}, normalized.truth === 'healthy' ? _('Telegram Proxy работает') : normalized.process ? _('Telegram Proxy работает с ограничениями') : _('Telegram Proxy остановлен')),
              E('p', {}, normalized.truth === 'healthy' ? _('Процесс, listener и связь с Telegram DC подтверждены.') : _('Проверьте цепочку работоспособности ниже.')),
              E('div', { 'class': 'z2m-btnrow z2m-proxy-summary-badges' }, badges)
            ])
          ]),
          E('div', { 'class': 'z2m-btnrow z2m-proxy-lifecycle-actions' }, actions)
        ]),
        E('div', { 'class': 'z2m-proxy-metrics-grid' }, metrics.map(function (row) { return E('div', { 'class': 'z2m-proxy-metric-card' }, [E('span', {}, row[0]), E('strong', {}, row[1])]); }))
      ])
    ]),
    E('div', { 'class': 'z2m-proxy-main-side' }, [
      shell.panel(_('Состояние Telegram Proxy'), E('div', { 'class': 'z2m-proxy-info-list' }, statusRows.map(function (row) { return E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, row[0]), E('strong', {}, row[1])]); }))),
      shell.panel(_('Подключение Telegram'), E('div', { 'class': 'z2m-proxy-connection-card' }, [
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Listener')), E('strong', {}, normalized.listener ? display(listener.address || applied.host) + ':' + display(listener.port || applied.port) : _('не подтверждён'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Telegram DC')), E('strong', {}, normalized.outbound ? _('соединение подтверждено') : _('ожидает проверки'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Ссылка')), E('strong', {}, _('скрыта до подтверждения'))])
      ]), E('div', { 'class': 'z2m-btnrow' }, [shell.button(_('Показать ссылку / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy)])),
      E('div', { 'class': 'z2m-proxy-side-stack' }, [
        shell.panel(_('Цепочка работоспособности'), E('div', { 'class': 'z2m-proxy-health-chain' }, health.map(function (row) { return E('div', { 'class': 'z2m-proxy-health-step ' + (row[1] ? 'ok' : 'warn') }, [E('span', {}, row[0]), E('strong', {}, row[2])]); }))),
        E('section', { 'class': 'z2m-proxy-secret-card' }, [E('h3', {}, _('Ссылка скрыта по умолчанию')), E('p', {}, _('Показывается временно после подтверждения.')), shell.button(_('Показать ссылку / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy)])
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
      port: _('Диапазон 1–65535. Provider default: 1443.'),
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
      settingsSection(ctx, data, settings, _('Основное'), _('Listener, ссылка и запуск сервиса'), fields(['enabled','autostart','host','port','linkIp','faketlsDomain'])),
      settingsSection(ctx, data, settings, _('Telegram DC mappings'), _('Прямые маршруты Telegram DC'), fields(['dcIps'])),
      settingsSection(ctx, data, settings, _('Cloudflare routing'), _('Домены и Worker endpoints для WebSocket маршрутизации'), fields(['cfDomains','cfWorkerDomains','cfPriority','cfBalance','defaultDomains'])),
      E('section', { 'class': 'z2m-proxy-form-section' }, [
        E('div', { 'class': 'z2m-proxy-form-head' }, [
          E('h3', {}, _('Upstream MTProto fallback')),
          E('p', {}, _('Поведение Avatar сохранено как безопасная backend-managed fallback-секция. Secret-bearing entries не возвращаются в браузер.'))
        ]),
        E('div', { 'class': 'z2m-state-panel warn' }, [
          E('strong', { 'class': 'z2m-state-title' }, _('Backend-side secret contract')),
          E('div', { 'class': 'z2m-state-message' }, _('UI не показывает и не сохраняет существующие upstream secrets в draft или журнале. Управляемых fallback entries: ') + String(fallbackEntries.length)),
          E('div', { 'class': 'z2m-btnrow' }, [shell.button(_('Обновить состояние'), 'sm', function () { return ctx.refresh('proxy'); })])
        ])
      ]),
      settingsSection(ctx, data, settings, _('Исходящее соединение'), _('Необязательный HTTP/SOCKS proxy для upstream connections'), fields(['outboundProxy','noProxy'])),
      settingsSection(ctx, data, settings, _('Ресурсы и логирование'), _('Ограничения provider runtime'), fields(['poolSize','bufKb','maxConnections','quiet','verbose'])),
      E('details', { 'class': 'z2m-proxy-technical' }, [
        E('summary', {}, _('Технические сведения')),
        E('div', { 'class': 'z2m-proxy-info-list' }, [
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Config path'), E('strong', {}, '/etc/tg-ws-proxy/config.conf')]),
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Secret path'), E('strong', {}, '/etc/tg-ws-proxy/secret.conf · 0600')]),
          E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, 'Init'), E('strong', {}, '/etc/init.d/tg-ws-proxy')])
        ])
      ])
    ]), _('Изменения сохраняются как черновик и применяются общим coordinator workflow.'), draft.settings ? shell.button(_('Показать различия'), 'primary sm', ctx.openSemanticDiff, false) : null),
    state.preview ? shell.statePanel({ message: _('Backend preview готов; применение выполняется общим coordinator.'), kind: 'success' }) : null
  ]));
}
function activityPane(ctx, data) {
  var shell = ctx.shell;
  var logs = object(data.logs && data.logs.value);
  var rows = ProxyModel.activity(array(logs.lines || logs.items), 50);
  var host = E('div', { 'class': 'z2m-proxy-log-table' }, rows.length ? rows.map(function (row) {
    return E('div', { 'class': 'z2m-proxy-log-line' }, compact([row.ts ? E('time', {}, display(row.ts)) : null, E('strong', {}, row.event || _('Событие')), row.message ? E('span', {}, row.message) : null]));
  }) : [E('div', { 'class': 'z2m-proxy-log-empty' }, _('Событий пока нет.'))]);
  var refresh = shell.button(_('Обновить'), 'sm', function () { ctx.refresh('proxy'); });
  var diagnostics = shell.button(_('Копировать диагностику'), 'sm', function () {
    var payload = JSON.stringify({ status: object(data.status && data.status.value), health: object(data.health && data.health.value), logs: rows }, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(payload).then(function () { shell.showToast(_('Диагностика скопирована.'), 'ok'); }).catch(function () { shell.showToast(_('Не удалось скопировать диагностику.'), 'err'); });
  });
  return shell.panel(_('Активность и redacted logs'), host, _('Secret и Telegram links удаляются backend и frontend-моделью'), E('div', { 'class': 'z2m-btnrow' }, [refresh, diagnostics]));
}
function render(ctx) {
  var data = ctx.data || {};
  var pstatus = providerStatus(data);
  var canonical = canonicalProjection(pstatus);
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
  if (state.pane == null) state.pane = providerInstalled(pstatus.installed) ? 'status' : 'install';
  var panes = {
    install: installPane(ctx, data),
    status: statusPane(ctx, data, normalized),
    settings: settingsPane(ctx, data),
    activity: activityPane(ctx, data)
  };
  if (!panes[state.pane]) state.pane = 'install';
  var paneHost = E('div', { id: 'z2m-proxy-pane' }, panes[state.pane]);
  var tabs = ctx.shell.subTabs([
    { id: 'install', label: _('Установка') },
    { id: 'status', label: _('Состояние') },
    { id: 'settings', label: _('Настройки') },
    { id: 'activity', label: _('Активность') }
  ], state.pane, function (id) {
    state.pane = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы Telegram Proxy') });
  var errors = [];
  ['providerStatus', 'capabilities', 'status', 'config', 'health', 'logs'].forEach(function (key) {
    if (data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Ошибка backend'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on z2m-proxy-production', id: 'z2m-view-proxy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Telegram Proxy')), E('p', {}, _('Опциональный MTProto WebSocket proxy с безопасным управлением'))]),
      E('div', { 'class': 'sp' }, ctx.shell.chip(truthLabel(normalized.truth), truthKind(normalized.truth), true))
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
function unmount() { state.revealed = null; }

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
