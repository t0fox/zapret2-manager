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
    ProviderApi.status(),
    ProviderApi.preflight(),
    ProviderApi.checkUpdates()
  ]).then(function (results) {
    return {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      health: settled(results[3], ctx.api),
      logs: settled(results[4], ctx.api),
      providerCatalog: settled(results[5], ctx.api),
      providerStatus: settled(results[6], ctx.api),
      providerPreflight: settled(results[7], ctx.api),
      providerUpdates: settled(results[8], ctx.api)
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
function providerCatalog(data) {
  return array(object(data.providerCatalog && data.providerCatalog.value).providers);
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
function providerCard(ctx, data, provider, status) {
  var shell = ctx.shell;
  var preflight = array(object(data.providerPreflight && data.providerPreflight.value).providers)
    .filter(function (item) { return item && item.provider === provider.id; })[0] || {};
  var update = array(object(data.providerUpdates && data.providerUpdates.value).providers)
    .filter(function (item) { return item && (item.provider === provider.id || object(item.candidate).provider === provider.id); })[0] || {};
  var isActive = status.installed === true && status.activeProvider === provider.id;
  var checked = update.ok === true && !!update.checkToken;
  var needsUpdate = isActive && checked && update.updateAvailable === true;
  var installedLatest = isActive && !needsUpdate;
  var switching = status.installed === true && !isActive;
  var benefits = providerBenefits(provider.id);
  var actionLabel = installedLatest ? _('Установлено') :
    needsUpdate ? _('Обновить') :
    switching ? _('Переключить') : _('Установить');
  var action = shell.button(preflight.available === false || (checked && update.installable === false) ? _('Недоступно') : actionLabel, installedLatest ? 'sm' : 'primary sm', function () {
    var title = needsUpdate ? _('Обновить TG Proxy?') :
      switching ? _('Переключить реализацию?') : _('Установить TG Proxy?');
    var message = needsUpdate
      ? _('Будет установлен последний совместимый пакет из доверенного feed. Настройки и secret сохранятся.')
      : switching
        ? _('Сервис будет остановлен, реализация заменена последней совместимой версией и запущена снова только после проверки.')
        : _('Будет установлен последний совместимый пакет из доверенного feed. Остальной менеджер от него не зависит.');
    confirm(ctx, title, message, actionLabel, function () {
      if (!checked) {
        shell.showToast(_('Сначала нажмите «Проверить обновления». После проверки установка будет доступна 10 минут.'), 'err');
        return;
      }
      mutation(ctx, 'provider-install', ProviderApi.install({ provider: provider.id, checkToken: update.checkToken }));
    }, false);
  }, !!state.busy || installedLatest || preflight.available === false || !checked || update.installable === false);

  return E('article', { 'class': 'z2m-panel z2m-proxy-provider-card' + (isActive ? ' selected' : '') }, [
    E('div', { 'class': 'hd' }, compact([
      E('div', { 'class': 'z2m-proxy-provider-heading' }, [providerIcon(provider.id), E('h2', {}, provider.title)]),
      isActive ? E('div', { 'class': 'sp' }, shell.chip(needsUpdate ? _('Доступно обновление') : _('Активна'), needsUpdate ? 'o' : 'g', true)) : null
    ])),
    E('div', { 'class': 'bd' }, compact([
      E('strong', { 'class': 'z2m-proxy-provider-short' }, benefits.title),
      E('ul', { 'class': 'z2m-proxy-provider-benefits' }, benefits.items.map(function (item) { return E('li', {}, item); })),
      E('div', { 'class': 'z2m-proxy-info-list' }, [
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Последняя версия')), E('strong', {}, checked ? String(update.latestVersion || '—') : _('Нажмите «Проверить обновления»'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Установка')), E('strong', {}, _('Только из доверенного APK feed'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Версии')), E('strong', {}, _('Только latest compatible'))]),
        E('div', { 'class': 'z2m-proxy-info-row' }, [E('span', {}, _('Готовность')), E('strong', { 'class': checked && update.installable !== false ? 'z2m-proxy-ok' : '' }, !checked ? _('Требуется проверка') : update.installable === false ? _('Версия ещё не опубликована в feed') : _('Готова к установке'))])
      ]),
      preflight.available === false ? E('div', { 'class': 'z2m-proxy-provider-unavailable' }, preflight.reason || _('Установка недоступна.')) : null,
      E('div', { 'class': 'z2m-btnrow z2m-proxy-provider-actions' }, [action])
    ]))
  ]);
}
function installPane(ctx, data) {
  var shell = ctx.shell;
  var status = providerStatus(data);
  var providers = providerCatalog(data);
  var cards = providers.map(function (provider) { return providerCard(ctx, data, provider, status); });
  var footer = [];
  var preflight = object(data.providerPreflight && data.providerPreflight.value);
  function refreshChecks() {
    if (state.busy) return;
    state.busy = 'preflight';
    Promise.allSettled([ProviderApi.preflight(), ProviderApi.checkUpdates()]).then(function () {
      state.busy = null;
      return ctx.refresh('proxy');
    }).catch(function (error) { state.busy = null; showError(ctx, error); });
  }

  if (status.installed) {
    footer.push(shell.button(_('Удалить'), 'danger sm', function () {
      confirm(ctx, _('Удалить TG Proxy?'),
        _('Пакет и сервис будут удалены. Настройки и secret сохранятся для быстрой переустановки.'),
        _('Удалить'), function () { mutation(ctx, 'provider-remove', ProviderApi.remove()); });
    }, !!state.busy));
    footer.push(shell.button(_('Удалить полностью'), 'danger sm', function () {
      confirm(ctx, _('Удалить настройки и secret?'),
        _('Это удалит пакет, конфигурацию и текущую Telegram Proxy ссылку без возможности восстановления.'),
        _('Удалить полностью'), function () { mutation(ctx, 'provider-purge', ProviderApi.purge()); });
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
      title: status.installed ? _('Компонент установлен') : _('Компонент не установлен'),
      message: status.installed
        ? _('Выбрано: ') + String(status.activeProvider || '—') + ' ' + String(status.activeVersion || '')
        : _('Это нормально: TG Proxy полностью опционален и не влияет на остальные функции Zapret2 Manager.'),
      kind: status.installed ? 'success' : 'info'
    }),
    data.providerCatalog && data.providerCatalog.error ? shell.statePanel({
      title: _('Каталог недоступен'), message: data.providerCatalog.error.message, kind: 'error'
    }) : null,
    shell.panel(_('Проверка готовности'), E('div', { 'class': 'z2m-proxy-preflight' }, checks.map(function (item) {
      return E('div', { 'class': 'z2m-proxy-check ' + (item.good ? 'good' : 'warn') }, [E('span', {}, item.label), E('strong', {}, item.value)]);
    })), _('Перед установкой проверяются устройство и доступность реализации'), shell.button(_('Повторить проверку'), 'sm', refreshChecks, !!state.busy)),
    E('div', { 'class': 'z2m-grid z2m-grid-2 z2m-proxy-provider-grid' }, cards),
    removePanel
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

  var raw = object(data.status && data.status.value);
  var cfg = object(data.config && data.config.value);
  var applied = object(cfg.applied || cfg.draft);
  var listener = array(raw.listeners)[0] || {};
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
    [_('Provider'), pstatus.installed, pstatus.installed ? _('Готов') : _('Не установлен')],
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
  var settings = workingConfig(ctx, data);
  var draft = currentDraft(ctx);
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
    !pstatus.installed ? shell.statePanel({
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
          E('p', {}, _('Secret-bearing entries остаются на backend и не возвращаются в браузер.'))
        ]),
        E('div', { 'class': 'z2m-state-panel warn' }, [
          E('strong', { 'class': 'z2m-state-title' }, _('Backend-side secret contract')),
          E('div', { 'class': 'z2m-state-message' }, _('UI не показывает и не сохраняет существующие upstream secrets в draft или журнале.'))
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
