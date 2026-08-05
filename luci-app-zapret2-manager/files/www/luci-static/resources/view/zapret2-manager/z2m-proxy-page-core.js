'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-model as ProxyModel';
'require view.zapret2-manager.z2m-proxy-provider-api as ProviderApi';
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
  preview: null
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
    ProviderApi.catalog(),
    ProviderApi.status()
  ]).then(function (results) {
    return {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      health: settled(results[3], ctx.api),
      logs: settled(results[4], ctx.api),
      providerCatalog: settled(results[5], ctx.api),
      providerStatus: settled(results[6], ctx.api)
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
  ctx.shell.openModal(title, E('p', {}, message), [
    ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal),
    ctx.shell.button(label, danger === false ? 'primary' : 'danger', function () {
      ctx.shell.closeModal();
      action();
    })
  ]);
}
function reveal(ctx) {
  confirm(ctx, _('Показать ссылку?'),
    _('Ссылка станет видна до закрытия окна.'),
    _('Показать'), function () {
      edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (answer) {
        var url = answer && (answer.https_link || answer.link);
        if (!url) throw answer || new Error('proxy link unavailable');
        state.revealed = url;
        function copyLink() {
          var promise = navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(url)
            : Promise.reject(new Error('clipboard unavailable'));
          promise.then(function () { ctx.shell.showToast(_('Ссылка скопирована.'), 'ok'); })
            .catch(function () { ctx.shell.showToast(_('Не удалось скопировать ссылку.'), 'err'); });
        }
        ctx.shell.openModal(_('QR-код Telegram Proxy'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
          E('code', { 'class': 'z2m-proxy-link' }, url),
          Qr.render(url, 240),
          E('div', { 'class': 'z2m-dim' }, _('После закрытия окна ссылка снова будет скрыта.')),
          E('div', { 'class': 'z2m-btnrow' }, [
            ctx.shell.button(_('Открыть в Telegram'), 'primary', function () { window.open(url, '_blank', 'noopener'); }),
            ctx.shell.button(_('Копировать ссылку'), '', copyLink)
          ])
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
function providerCatalog(data) {
  return array(object(data.providerCatalog && data.providerCatalog.value).providers);
}
function providerCard(ctx, data, provider, status) {
  var shell = ctx.shell;
  var isActive = status.installed === true && status.activeProvider === provider.id;
  var needsUpdate = isActive && status.updateAvailable === true;
  var installedLatest = isActive && !needsUpdate;
  var switching = status.installed === true && !isActive;
  var actionLabel = installedLatest ? _('Установлено') :
    needsUpdate ? _('Обновить') :
    switching ? _('Переключить') : _('Установить');
  var action = shell.button(actionLabel, installedLatest ? 'sm' : 'primary sm', function () {
    var title = needsUpdate ? _('Обновить TG Proxy?') :
      switching ? _('Переключить реализацию?') : _('Установить TG Proxy?');
    var message = needsUpdate
      ? _('Будет установлен последний совместимый пакет из доверенного feed. Настройки и secret сохранятся.')
      : switching
        ? _('Сервис будет остановлен, реализация заменена последней совместимой версией и запущена снова только после проверки.')
        : _('Будет установлен последний совместимый пакет из доверенного feed. Остальной менеджер от него не зависит.');
    confirm(ctx, title, message, actionLabel, function () {
      mutation(ctx, 'provider-install', ProviderApi.install({ provider: provider.id }));
    }, false);
  }, !!state.busy || installedLatest);

  return E('article', { 'class': 'z2m-proxy-install-option' + (isActive ? ' selected' : '') }, [
    E('div', { 'class': 'z2m-proxy-option-top' }, [
      E('div', {}, [
        E('strong', { 'class': 'z2m-proxy-option-title' }, provider.title + ' · MTProto'),
        E('div', { 'class': 'z2m-proxy-option-sub' }, provider.short || '')
      ]),
      shell.chip(isActive ? (needsUpdate ? _('Обновление') : _('Активна')) : _('Доступна'), isActive && !needsUpdate ? 'g' : 'o')
    ]),
    E('p', { 'class': 'z2m-proxy-option-text' }, provider.feature || ''),
    E('div', { 'class': 'z2m-proxy-option-version' }, [
      E('span', {}, _('Последняя версия')),
      E('strong', {}, String(provider.latestLabel || provider.latestVersion || '—'))
    ]),
    E('div', { 'class': 'z2m-btnrow z2m-proxy-option-actions' }, [action])
  ]);
}
function installPane(ctx, data) {
  var shell = ctx.shell;
  var status = providerStatus(data);
  var providers = providerCatalog(data);
  var cards = providers.map(function (provider) { return providerCard(ctx, data, provider, status); });
  var footer = [];

  if (status.installed) {
    footer.push(shell.button(_('Удалить'), 'danger sm', function () {
      confirm(ctx, _('Удалить TG Proxy?'),
        _('Пакет и сервис будут удалены. Настройки и secret сохранятся для быстрой переустановки.'),
        _('Удалить'), function () { mutation(ctx, 'provider-remove', ProviderApi.remove()); });
    }, !!state.busy));
    footer.push(shell.button(_('Удалить полностью'), 'sm', function () {
      confirm(ctx, _('Удалить настройки и secret?'),
        _('Это удалит пакет, конфигурацию и текущую Telegram Proxy ссылку без возможности восстановления.'),
        _('Удалить полностью'), function () { mutation(ctx, 'provider-purge', ProviderApi.purge()); });
    }, !!state.busy));
  }

  var current = status.installed ? [
    E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Реализация')), E('strong', {}, display(status.activeProvider))]),
    E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Версия')), E('strong', {}, display(status.activeVersion))]),
    E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Состояние')), E('strong', { 'class': 'z2m-proxy-ok' }, status.running ? _('Запущен') : _('Остановлен'))]),
    E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Настройки')), E('strong', {}, status.configPreserved ? _('Сохранены') : _('Не созданы'))])
  ] : [shell.statePanel({ message: _('Выберите реализацию MTProto Proxy.'), kind: 'info' })];
  return E('div', { 'class': 'z2m-proxy-pane' }, compact([
    data.providerCatalog && data.providerCatalog.error ? shell.statePanel({ title: _('Каталог недоступен'), message: data.providerCatalog.error.message, kind: 'error' }) : null,
    E('div', { 'class': 'z2m-proxy-layout-main' }, [
      shell.panel(_('Способ установки'), E('div', {}, [
        E('div', { 'class': 'z2m-grid z2m-grid-2 z2m-proxy-install-options' }, cards),
        E('div', { 'class': 'z2m-proxy-notice' }, _('Переключение сохраняет настройки и перезапускает сервис только после проверки.'))
      ]), status.installed ? _('Компонент установлен') : _('Компонент не установлен')),
      shell.panel(_('Установленный компонент'), E('div', { 'class': 'z2m-proxy-info-list' }, current))
    ]),
    footer.length ? E('section', { 'class': 'z2m-panel z2m-proxy-danger' }, [
      E('div', { 'class': 'hd' }, [E('h2', {}, _('Удаление компонента')), E('div', { 'class': 'sp z2m-btnrow' }, footer)]),
      E('div', { 'class': 'bd z2m-dim' }, _('Обычное удаление сохраняет настройки. Полная очистка удаляет настройки и текущую ссылку.'))
    ]) : null
  ]));
}
function statusPane(ctx, data, normalized) {
  var shell = ctx.shell;
  var pstatus = providerStatus(data);
  if (!pstatus.installed) return shell.statePanel({
    title: _('TG Proxy не установлен'),
    message: _('Выберите Rust или Go во вкладке «Установка». Остальной менеджер продолжает работать без TG Proxy.'),
    kind: 'info'
  });

  var rawStatus = object(data.status && data.status.value);
  var config = object(data.config && data.config.value);
  var applied = object(config.applied || config.draft);
  var listener = array(rawStatus.listeners)[0] || {};
  var checks = array(object(data.health && data.health.value).checks);
  function check(name) { return checks.some(function (item) { return item && item.name === name && item.ok === true; }); }
  var actions = [];
  if (!normalized.process) actions.push(shell.button(_('Запустить'), 'primary sm', function () {
    lifecycle(ctx, ctx.api.proxy.start, _('Запустить'), _('Backend проверит процесс и точный listener после запуска.'));
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Перезапустить'), 'sm', function () {
    lifecycle(ctx, ctx.api.proxy.restart, _('Перезапустить'), _('Текущие подключения будут прерваны.'));
  }, !!state.busy));
  if (normalized.process) actions.push(shell.button(_('Остановить'), 'danger sm', function () {
    lifecycle(ctx, ctx.api.proxy.stop, _('Остановить'), _('Telegram Proxy перестанет принимать подключения.'));
  }, !!state.busy));
  actions.push(shell.button(_('Новая ссылка'), 'danger sm', function () {
    lifecycle(ctx, ctx.api.proxy.secretRotate, _('Создать новую ссылку'), _('Старая ссылка перестанет работать; backend выполнит listener verification и rollback при ошибке.'));
  }, !!state.busy));
  actions.push(shell.button(_('Показать ссылку / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy));

  var metrics = [
    { label: _('Реализация'), value: display(pstatus.activeProvider) },
    { label: _('Версия'), value: display(pstatus.activeVersion) },
    { label: _('Порт listener'), value: display(listener.port || applied.port) },
    { label: _('Активные сессии'), value: normalized.activeConnections === null ? '—' : String(normalized.activeConnections) }
  ];
  var connectionRows = [
    { label: _('Сервер'), value: display(applied.linkIp || listener.address || applied.host) },
    { label: _('Порт'), value: display(applied.port || listener.port) },
    { label: _('Секрет'), value: _('Скрыт') },
    { label: _('Ссылка'), value: _('Показывается после подтверждения') }
  ];
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    E('section', { 'class': 'z2m-panel z2m-proxy-status-card' }, [
      E('div', { 'class': 'z2m-proxy-status-hero' }, [
        E('div', { 'class': 'z2m-proxy-telegram-mark', 'aria-hidden': 'true' }, '➤'),
        E('div', { 'class': 'z2m-proxy-status-copy' }, [
          E('strong', {}, normalized.process ? _('Telegram Proxy активен') : _('Telegram Proxy остановлен')),
          E('span', {}, _('PID ') + display(array(rawStatus.pids)[0]) + ' · ' + (object(config.autostart).rcDEnabled ? _('автозапуск включён') : _('автозапуск выключен')))
        ]),
        E('div', { 'class': 'z2m-btnrow z2m-proxy-lifecycle' }, actions)
      ]),
      E('div', { 'class': 'z2m-proxy-metrics' }, metrics.map(function (item) {
        return E('div', { 'class': 'z2m-proxy-metric' }, [E('span', {}, item.label), E('strong', {}, item.value)]);
      }))
    ]),
    E('div', { 'class': 'z2m-proxy-layout-main' }, [
      shell.panel(_('Данные подключения'), E('div', { 'class': 'z2m-proxy-info-list' }, connectionRows.map(function (row) {
        return E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, row.label), E('strong', {}, row.value)]);
      })), _('Параметры для Telegram-клиента'), shell.button(_('Показать QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy)),
      shell.panel(_('Сеть и доступность'), E('div', { 'class': 'z2m-proxy-info-list' }, [
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Процесс')), E('strong', { 'class': normalized.process ? 'z2m-proxy-ok' : '' }, normalized.process ? _('Запущен') : _('Остановлен'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Listener')), E('strong', { 'class': normalized.listener ? 'z2m-proxy-ok' : '' }, normalized.listener ? _('Подтверждён') : _('Не подтверждён'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Telegram DC')), E('strong', { 'class': normalized.outbound ? 'z2m-proxy-ok' : '' }, normalized.outbound ? _('Связь подтверждена') : _('Не подтверждена'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Конфигурация')), E('strong', { 'class': check('config') ? 'z2m-proxy-ok' : '' }, check('config') ? _('Исправна') : _('Требует проверки'))])
      ]))
    ])
  ]);
}
function fieldNode(field, value, onChange) {
  var input;
  if (field.type === 'bool') {
    input = E('input', { type: 'checkbox', checked: value === true ? 'checked' : null, 'aria-label': field.label });
    input.checked = value === true;
    input.addEventListener('change', function () { onChange(input.checked); });
  } else if (field.type === 'list') {
    input = E('textarea', { rows: '4', 'aria-label': field.label }, array(value).join('\n'));
    input.value = array(value).join('\n');
    input.addEventListener('change', function () {
      onChange(String(input.value || '').split(/[\n,]/).map(function (item) { return item.trim(); }).filter(Boolean));
    });
  } else {
    input = E('input', { type: field.type === 'number' ? 'number' : 'text', value: value == null ? '' : String(value), 'aria-label': field.label });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', function () {
      onChange(field.type === 'number' ? Number(input.value) : String(input.value || '').trim());
    });
  }
  return [E('label', {}, field.label), E('div', {}, input)];
}
function settingsPane(ctx, data) {
  var shell = ctx.shell;
  var pstatus = providerStatus(data);
  var settings = workingConfig(ctx, data);
  var basic = E('div', { 'class': 'z2m-cbi z2m-proxy-settings-form' });
  var advanced = E('div', { 'class': 'z2m-cbi z2m-proxy-settings-form' });
  var basicIds = ['enabled','autostart','host','port','linkIp','faketlsDomain','poolSize','maxConnections','quiet','verbose'];
  FIELDS.forEach(function (field) {
    var nodes = fieldNode(field, settings[field.id], function (value) {
      var next = clone(settings);
      next[field.id] = value;
      stage(ctx, data, next);
    });
    var target = basicIds.indexOf(field.id) >= 0 ? basic : advanced;
    target.appendChild(nodes[0]);
    target.appendChild(nodes[1]);
  });
  var draft = currentDraft(ctx);
  return E('div', { 'class': 'z2m-proxy-pane' }, compact([
    !pstatus.installed ? shell.statePanel({
      message: _('Настройки можно подготовить заранее, но применить их получится только после установки Rust или Go.'),
      kind: 'info'
    }) : null,
    E('div', { 'class': 'z2m-proxy-layout-main' }, [
      shell.panel(_('Основные параметры'), basic, _('Настройки MTProto Proxy'),
        draft.settings ? shell.button(_('Показать различия'), 'primary sm', ctx.openSemanticDiff, false) : null),
      shell.panel(_('Маршруты и резервные подключения'), advanced, _('Telegram DC, Cloudflare и исходящие подключения'))
    ]),
    E('div', { 'class': 'z2m-proxy-notice' }, _('Изменения не применяются сразу. Используйте общую нижнюю панель после проверки различий.')),
    state.preview ? shell.statePanel({ message: _('Backend preview готов; применение выполняется общим coordinator.'), kind: 'success' }) : null
  ]));
}
function activityPane(ctx, data) {
  var shell = ctx.shell;
  var logs = object(data.logs && data.logs.value);
  var rows = ProxyModel.activity(array(logs.lines || logs.items), 50);
  var status = object(data.status && data.status.value);
  var active = status.activeConnections !== undefined ? status.activeConnections : status.connections;
  var events = rows.length ? rows.map(function (row) {
    var textNodes = [];
    if (row.event) textNodes.push(E('div', { 'class': 'nm' }, row.event));
    if (row.message) textNodes.push(E('div', { 'class': row.event ? 'co' : 'nm' }, row.message));
    var children = [E('div', {}, textNodes)];
    if (row.severity) children.push(shell.chip(row.severity, row.severity === 'error' ? 'r' : 'o'));
    return E('div', { 'class': 'z2m-proxy-log-row' }, children);
  }) : [E('div', { 'class': 'z2m-proxy-log-empty' }, _('Событий пока нет.'))];
  return E('div', { 'class': 'z2m-proxy-pane' }, [
    E('div', { 'class': 'z2m-proxy-activity-stats' }, [
      E('div', {}, [E('strong', {}, active === undefined || active === null ? '—' : String(active)), E('span', {}, _('активных сессий'))]),
      E('div', {}, [E('strong', {}, String(rows.length)), E('span', {}, _('последних событий'))]),
      E('div', {}, [E('strong', {}, status.running === true || status.state === 'running' ? _('Да') : _('Нет')), E('span', {}, _('процесс запущен'))])
    ]),
    shell.panel(_('Журнал Telegram Proxy'), E('div', { 'class': 'z2m-proxy-logs' }, events), _('Последние события и подключения'))
  ]);
}
function render(ctx) {
  var data = ctx.data || {};
  var pstatus = providerStatus(data);
  var merged = Object.assign({}, object(data.status && data.status.value), object(data.health && data.health.value), {
    capabilities: object(data.capabilities && data.capabilities.value),
    supported: object(data.capabilities && data.capabilities.value).supported,
    installed: pstatus.installed === true
  });
  var normalized = ProxyModel.normalize(merged);
  if (state.pane == null) state.pane = pstatus.installed ? 'status' : 'install';
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
  return E('section', { 'class': 'z2m-view on z2m-proxy-page', id: 'z2m-view-proxy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('div', { 'class': 'z2m-proxy-eyebrow' }, _('Сервисы / Telegram Proxy')), E('h1', {}, _('Telegram Proxy')), E('p', {}, _('Установка, управление и мониторинг MTProto-прокси на роутере.'))]),
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
      return ProviderApi.status().then(function (status) {
        if (!status || status.installed !== true)
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
