'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
var LOAD_TIMEOUT_MS = 5000;
var SCOPE_LABELS = {
  engineConfig: _('Конфигурация движка'),
  ourState: _('Состояние менеджера'),
  lists: _('Списки'),
  profiles: _('Профили')
};
var PANE_META = {
  updates: { title: _('Обновления'), subtitle: _('Версии и состояние компонентов') },
  engine: { title: _('Движок'), subtitle: _('Установка и управление zapret2') },
  backups: { title: _('Резервные копии'), subtitle: _('Сохранение и восстановление состояния менеджера') },
  settings: { title: _('Настройки'), subtitle: _('Параметры интерфейса менеджера') }
};
var state = {
  pane: 'system',
  paneInitialized: false,
  preview: null,
  previewModel: null,
  verification: null,
  diagnostics: null,
  busy: null
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
  if (route === 'engine') return 'engine';
  if (route === 'backups') return 'backups';
  if (route === 'settings') return 'settings';
  return 'updates';
}
function normalizeUpdateModel(value) {
  value = object(value);
  var manager = object(value.manager), upstream = object(value.upstreamPkg);
  function row(id, label, installed, record) {
    record = object(record);
    var state = record.error ? 'ERROR' : record.stale === true ? 'STALE'
      : installed === null ? 'NOT_INSTALLED'
      : record.updateAvailable === true ? 'UPDATE_AVAILABLE'
      : record.updateAvailable === false && (record.checkedAt || record.checked === true) ? 'UP_TO_DATE' : 'UNKNOWN';
    var labels = { ERROR: 'Ошибка проверки', STALE: 'Проверка устарела', NOT_INSTALLED: 'Не установлен', UPDATE_AVAILABLE: 'Доступно обновление', UP_TO_DATE: 'Актуально', UNKNOWN: 'Проверка недоступна' };
    return { id: id, label: label, installed: installed, latest: record.latest || record.latestVersion || null, state: state, stateLabel: labels[state] };
  }
  return {
    rows: [
      row('manager', 'zapret2-manager', manager.version == null ? null : String(manager.version), manager),
      row('zapret2', 'zapret2', upstream.version == null ? null : String(upstream.version), upstream),
      row('openwrt', 'OpenWrt', value.os == null ? null : String(value.os), object(value.openwrt))
    ],
    technical: { luciApp: object(value.luciApp), nfqws2: value.nfqws2, luaCompatVer: value.luaCompatVer, updateAvailable: value.updateAvailable }
  };
}
function load(ctx) {
  var pane = activePane(ctx);
  var promise;
  if (pane === 'engine') promise = EnginePanel.load(ctx).then(function (value) { return { engine: settled({ status: 'fulfilled', value: value }, ctx.api) }; });
  else if (pane === 'backups') promise = boundedLoad(ctx.api.maintenance.backupList(), 'backup list').then(function (value) { return { backups: { value: value || {} } }; });
  else if (pane === 'settings') promise = Promise.resolve({ settings: { value: { ui: ctx.store.get().ui || {} } } });
  else promise = boundedLoad(ctx.api.maintenance.versions(), 'versions').then(function (value) { return { versions: { value: value || {} } }; });
  return promise.catch(function (error) {
    var key = pane === 'engine' ? 'engine' : pane === 'backups' ? 'backups' : pane === 'settings' ? 'settings' : 'versions';
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
function updateStateKind(stateName) {
  if (stateName === 'UP_TO_DATE') return 'g';
  if (stateName === 'UPDATE_AVAILABLE') return 'o';
  if (stateName === 'ERROR' || stateName === 'NOT_INSTALLED') return 'r';
  return 'o';
}
function updateTable(shell, model) {
  var head = E('div', { 'class': 'z2m-system-version-row z2m-system-version-head' }, [
    E('strong', {}, _('Компонент')),
    E('strong', {}, _('Установлено')),
    E('strong', {}, _('Последняя')),
    E('strong', {}, _('Состояние'))
  ]);
  var rows = model.rows.map(function (row) {
    return E('div', { 'class': 'z2m-system-version-row' }, [
      E('span', { 'class': 'z2m-system-version-name' }, row.label),
      E('span', {}, row.installed || '—'),
      E('span', {}, row.latest || '—'),
      E('span', { 'class': 'z2m-chip ' + updateStateKind(row.state) }, row.stateLabel)
    ]);
  });
  return E('div', { 'class': 'z2m-system-version-table' }, [head].concat(rows));
}
function renderSystem(ctx, data) {
  var shell = ctx.shell;
  var normalizeUpdates = MaintenanceModel.normalizeUpdateModel || normalizeUpdateModel;
  var updateModel = normalizeUpdates(data.versions && data.versions.value || {});
  var technical = updateModel.technical || {};
  var technicalRows = [
    { label: _('Версия luci-app'), value: object(technical.luciApp).version },
    { label: _('Версия nfqws2'), value: technical.nfqws2 },
    { label: _('Совместимость Lua'), value: technical.luaCompatVer },
    { label: _('Сырые данные проверки обновлений'), value: technical.updateAvailable }
  ].filter(function (row) { return row.value !== null && row.value !== undefined && row.value !== ''; });
  return E('div', {}, [
    shell.panel(_('Установленные версии'), [
      updateTable(shell, updateModel),
      shell.statePanel({ message: _('Проверка обновлений недоступна для текущего серверного контракта. Показаны версии, реально установленные в системе.'), kind: 'info' }),
      technicalRows.length ? E('details', { 'class': 'z2m-acc' }, [
        E('summary', {}, _('Технические детали')),
        kvPanel(shell, technicalRows)
      ]) : null
    ]),
    shell.panel(_('Telegram Proxy'), E('div', { 'class': 'z2m-product-owner-handoff' }, [
      E('p', {}, _('Проверить обновление TG Proxy можно на странице его владельца. Установка и обновление выполняются существующим lifecycle Telegram Proxy.')),
      E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn primary sm' }, _('Проверить обновление'))
    ]), _('System → Updates направляет пользователя к canonical owner без второго installer.'))
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
  confirmAction(ctx, _('Удалить backup?'),
    (SCOPE_LABELS[record.scope] || record.scope) + ' · ' + formatTime(ctx.shell, record.takenAt),
    _('Удалить'), function () {
      mutation(ctx, 'backup-delete', edit(ctx.api.maintenance.backupDelete, {
        scope: record.scope,
        takenAt: record.takenAt
      })).then(function (answer) {
        if (!answer) return;
        state.preview = null;
        state.previewModel = null;
        ctx.shell.showToast(_('Backup удалён.'), 'ok');
        refresh(ctx);
      });
    });
}
function restoreBackup(ctx) {
  var preview = state.previewModel;
  if (!preview) return;
  confirmAction(ctx, _('Восстановить backup?'),
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
          ctx.shell.showToast(_('Backup восстановлен и проверен.'), 'ok');
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
  var restore = shell.button(_('Восстановить этот архив'), 'danger', restoreBackup.bind(null, ctx),
    !preview.allowed || !!state.busy);
  return E('section', { 'class': 'z2m-panel', id: 'z2m-backup-preview' }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Предпросмотр восстановления')), E('div', { 'class': 'sp' }, restore)]),
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
  var scopeSelect = E('select', { id: 'z2m-backup-scope', 'aria-label': _('Область резервной копии') }, [
    E('option', { value: 'all' }, _('Все области'))
  ].concat(SCOPES.map(function (scope) {
    return E('option', { value: scope }, SCOPE_LABELS[scope]);
  })));
  var createButton = shell.button(_('Создать backup'), 'primary', function () {
    mutation(ctx, 'backup-create', edit(ctx.api.maintenance.backupCreate, {
      scope: scopeSelect.value || 'all'
    })).then(function (answer) {
      if (!answer) return;
      shell.showToast(_('Backup создан.'), 'ok');
      refresh(ctx);
    });
  }, !!state.busy);
  var rows = records.map(function (record) {
    return E('div', { 'class': 'z2m-backup-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, SCOPE_LABELS[record.scope] || record.scope),
        E('div', { 'class': 'co' }, formatTime(shell, record.takenAt)),
        record.manifestSha256 ? E('div', { 'class': 'z2m-tech' }, record.manifestSha256) : null
      ]),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Предпросмотр'), 'sm', previewBackup.bind(null, ctx, record), !!state.busy),
        shell.button(_('Удалить'), 'danger sm', deleteBackup.bind(null, ctx, record), !!state.busy)
      ])
    ]);
  });
  return E('div', {}, [
    shell.panel(_('Резервные копии'), E('div', {}, [
      E('div', { 'class': 'z2m-btnrow' }, [scopeSelect, createButton]),
      E('div', { 'class': 'z2m-backup-history' }, rows.length ? rows : [
        shell.statePanel({ message: _('История backup пуста.'), kind: 'info' })
      ])
    ]), _('Четыре области состояния; для восстановления используется проверка целостности и версии.')),
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
    ])),
    shell.panel(_('Граница контракта'), shell.statePanel({
      message: _('В текущем серверном API нет отдельного RPC настроек. Эта настройка хранится в состоянии интерфейса; серверные конфигурации изменяются только своими существующими контрактами.'),
      kind: 'info'
    }))
  ]);
}

function render(ctx) {
  var data = ctx.data || {};
  var pane = activePane(ctx);
  var meta = PANE_META[pane] || PANE_META.updates;
  var paneBody = pane === 'engine' ? renderEngine(ctx, data)
    : pane === 'backups' ? renderBackups(ctx, data)
    : pane === 'settings' ? renderSettings(ctx, data)
    : renderSystem(ctx, data);
  var paneHost = E('div', { id: 'z2m-system-pane' }, paneBody);
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (key !== 'engine' && data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Не удалось загрузить данные'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-system' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, meta.title), E('p', {}, meta.subtitle)])
    ]),
    errors.length ? E('div', {}, errors) : null,
    paneHost
  ]);
}
function mount(ctx) { if (activePane(ctx) === 'engine') EnginePanel.mount(ctx); }
function unmount(ctx) { if (ctx && ctx.engineState) EnginePanel.unmount(ctx); }

return baseclass.extend({
  id: 'system',
  title: _('Система'),
  subtitle: _('Версии, движок, резервные копии и настройки'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
