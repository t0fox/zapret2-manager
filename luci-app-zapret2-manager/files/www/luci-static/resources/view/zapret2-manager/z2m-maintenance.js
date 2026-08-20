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
function scalarRows(value, prefix) {
  var rows = [];
  value = object(value);
  Object.keys(value).sort().forEach(function (key) {
    var item = value[key];
    var label = prefix ? prefix + ' · ' + key : key;
    if (item === null || item === undefined) return;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      rows.push({ label: label, value: String(item) });
      return;
    }
    if (item && typeof item === 'object' && !Array.isArray(item))
      rows = rows.concat(scalarRows(item, label));
  });
  return rows;
}
function kvPanel(shell, rows) {
  return E('div', { 'class': 'z2m-proxy-kv' }, rows.map(function (row) {
    return E('div', {}, [E('span', {}, row.label), E('strong', {}, row.value)]);
  }));
}
function formatTime(shell, value) {
  return shell.format.timestamp(value) || '';
}
function renderSystem(ctx, data) {
  var shell = ctx.shell;
  var versions = MaintenanceModel.normalizeVersions(data.versions && data.versions.value || {});
  var versionCards = versions.map(function (item) {
    return E('div', { 'class': 'z2m-kpi' }, [
      E('div', { 'class': 'v' }, item.value),
      E('div', { 'class': 'l' }, item.label)
    ]);
  });
  return E('div', {}, [
    shell.panel(_('Версии пакетов'), versionCards.length
      ? E('div', { 'class': 'z2m-kpis' }, versionCards)
      : shell.statePanel({ message: _('Backend не вернул версии пакетов.'), kind: 'info' })),
    shell.panel(_('Состояние обновлений'), shell.statePanel({
      message: _('Доступность обновлений не проверяется этим read-only контрактом; показаны только версии, реально установленные в системе.'), kind: 'info'
    }))
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
    _('Backend сначала проверит identity/revision preview, сохранит текущее состояние, выполнит restore и повторно прочитает каждый файл.'),
    _('Восстановить'), function () {
      var request = MaintenanceModel.restoreRequest(preview, true);
      if (!request.ok) {
        ctx.shell.showToast(_('Restore заблокирован: ') + request.reason, 'err');
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
    { label: _('Scope'), value: preview.scope || '' },
    { label: _('Время'), value: formatTime(shell, preview.takenAt) },
    { label: _('Integrity'), value: preview.integrity || '' },
    { label: _('Version gate'), value: preview.versionGate || '' }
  ].filter(function (row) { return row.value; });
  var restore = shell.button(_('Восстановить этот архив'), 'danger', restoreBackup.bind(null, ctx),
    !preview.allowed || !!state.busy);
  return E('section', { 'class': 'z2m-panel', id: 'z2m-backup-preview' }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Предпросмотр восстановления')), E('div', { 'class': 'sp' }, restore)]),
    E('div', { 'class': 'bd' }, [
      preview.blocker ? shell.statePanel({ title: _('Restore заблокирован'), message: preview.blocker, kind: 'error' }) : null,
      metadata.length ? kvPanel(shell, metadata) : null,
      sections.length ? E('div', {}, sections) : shell.statePanel({ message: preview.primaryText, kind: 'info' }),
      state.verification && !state.verification.verified
        ? shell.statePanel({ title: _('Verification не подтверждён'), message: state.verification.message, kind: 'error' }) : null
    ])
  ]);
}
function renderBackups(ctx, data) {
  var shell = ctx.shell;
  var records = MaintenanceModel.backups(data.backups && data.backups.value || {}, 100);
  var scopeSelect = E('select', { id: 'z2m-backup-scope', 'aria-label': _('Backup scope') }, [
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
    ]), _('Четыре независимые области; backend хранит SHA-256 manifest и pre-restore snapshot.')),
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
      message: _('В текущем backend нет отдельного settings RPC. Эта настройка хранится в manager UI state; серверные конфигурации изменяются только своими существующими product contracts.'),
      kind: 'info'
    }))
  ]);
}

function render(ctx) {
  var data = ctx.data || {};
  var pane = activePane(ctx);
  var paneBody = pane === 'engine' ? renderEngine(ctx, data)
    : pane === 'backups' ? renderBackups(ctx, data)
    : pane === 'settings' ? renderSettings(ctx, data)
    : renderSystem(ctx, data);
  var paneHost = E('div', { id: 'z2m-system-pane' }, paneBody);
  var tabs = ctx.shell.subTabs([
    { id: 'updates', label: _('Обновления') },
    { id: 'engine', label: _('Движок') },
    { id: 'backups', label: _('Резервные копии') },
    { id: 'settings', label: _('Настройки') }
  ], pane, function (id) { ctx.navigate(id); }, { 'aria-label': _('Разделы системы') });
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (key !== 'engine' && data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Ошибка backend'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-system' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Система')), E('p', {}, _('Версии, движок, резервные копии и настройки manager UI'))])
    ]),
    errors.length ? E('div', {}, errors) : null,
    tabs,
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
