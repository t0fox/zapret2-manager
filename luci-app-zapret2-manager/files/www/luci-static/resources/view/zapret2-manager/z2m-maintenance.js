'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
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
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.maintenance.versions(),
    ctx.api.maintenance.status(),
    ctx.api.maintenance.backupList(),
    edit(ctx.api.maintenance.eventsTail, { limit: 100 }),
    EnginePanel.load(ctx)
  ]).then(function (results) {
    return {
      versions: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      backups: settled(results[2], ctx.api),
      events: settled(results[3], ctx.api),
      engine: settled(results[4], ctx.api)
    };
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
  return ctx.refresh('maintenance');
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
  var system = MaintenanceModel.normalizeSystem(data.status && data.status.value || {});
  var versionCards = versions.map(function (item) {
    return E('div', { 'class': 'z2m-kpi' }, [
      E('div', { 'class': 'v' }, item.value),
      E('div', { 'class': 'l' }, item.label)
    ]);
  });
  var systemRows = [];
  if (system.uptime) systemRows.push({ label: _('Uptime'), value: system.uptime });
  if (system.memoryAvailable) systemRows.push({ label: _('Доступная память'), value: system.memoryAvailable });
  if (system.overlay) systemRows.push({ label: _('Overlay'), value: system.overlay });
  systemRows = systemRows.concat(system.runtime.map(function (row) {
    return { label: row.label, value: row.value };
  }));
  return E('div', {}, [
    shell.panel(_('Версии пакетов'), versionCards.length
      ? E('div', { 'class': 'z2m-kpis' }, versionCards)
      : shell.statePanel({ message: _('Backend не вернул версии пакетов.'), kind: 'info' })),
    shell.panel(_('Система и runtime'), systemRows.length
      ? kvPanel(shell, systemRows)
      : shell.statePanel({ message: _('Системные данные недоступны.'), kind: 'info' }))
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
    shell.panel(_('Backups'), E('div', {}, [
      E('div', { 'class': 'z2m-btnrow' }, [scopeSelect, createButton]),
      E('div', { 'class': 'z2m-backup-history' }, rows.length ? rows : [
        shell.statePanel({ message: _('История backup пуста.'), kind: 'info' })
      ])
    ]), _('Четыре независимые области; backend хранит SHA-256 manifest и pre-restore snapshot.')),
    renderPreview(ctx)
  ]);
}

function renderEvents(ctx, data) {
  var shell = ctx.shell;
  var envelope = data.events && data.events.value || {};
  var source = array(envelope.events || envelope.lines || envelope.items).map(function (item) {
    return typeof item === 'string' ? { message: item } : item;
  });
  var events = MaintenanceModel.events(source, 100);
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  var rows = events.map(function (event) {
    var details = advanced && event.details && Object.keys(event.details).length
      ? E('details', { 'class': 'z2m-acc' }, [
          E('summary', {}, _('Технические детали')),
          E('pre', { 'class': 'z2m-console' }, JSON.stringify(MaintenanceModel.redact(event.details), null, 2))
        ]) : null;
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [
        event.message ? E('div', { 'class': 'nm' }, event.message) : null,
        event.timestamp ? E('div', { 'class': 'co' }, formatTime(shell, event.timestamp)) : null,
        details
      ]),
      event.severity ? shell.chip(event.severity, event.severity === 'error' ? 'r' : 'o') : null
    ]);
  });
  return shell.panel(_('События'), E('div', {}, rows.length ? rows : [
    shell.statePanel({ message: _('Событий нет.'), kind: 'info' })
  ]), _('Показаны последние 100 redacted событий.'));
}

function renderDiagnostics(ctx) {
  var shell = ctx.shell;
  var resultRows = scalarRows(MaintenanceModel.redact(state.diagnostics || {}));
  var exportButton = shell.button(_('Собрать диагностику'), 'primary', function () {
    mutation(ctx, 'diagnostics-export', ctx.api.maintenance.diagnosticsExport()).then(function (answer) {
      if (!answer) return;
      state.diagnostics = MaintenanceModel.redact(answer);
      rerender(ctx);
    });
  }, !!state.busy);
  return shell.panel(_('Diagnostics export'), E('div', {}, [
    E('div', { 'class': 'z2m-btnrow' }, exportButton),
    resultRows.length ? kvPanel(shell, resultRows) : shell.statePanel({
      message: _('Export ещё не запускался. Диагностика не изменяет router state.'),
      kind: 'info'
    })
  ]));
}

function render(ctx) {
  var data = ctx.data || {};
  if (!state.paneInitialized) {
    state.pane = data.engine && data.engine.value && EnginePanel.missing(data.engine.value) ? 'engine' : 'system';
    state.paneInitialized = true;
  }
  var panes = {
    system: renderSystem(ctx, data),
    engine: renderEngine(ctx, data),
    backups: renderBackups(ctx, data),
    events: renderEvents(ctx, data),
    diagnostics: renderDiagnostics(ctx)
  };
  if (!panes[state.pane]) state.pane = 'system';
  var paneHost = E('div', { id: 'z2m-maintenance-pane' }, panes[state.pane]);
  var tabs = ctx.shell.subTabs([
    { id: 'system', label: _('Система') },
    { id: 'engine', label: _('Движок') },
    { id: 'backups', label: _('Backups') },
    { id: 'events', label: _('События') },
    { id: 'diagnostics', label: _('Диагностика') }
  ], state.pane, function (id) {
    state.pane = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы обслуживания') });
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (key !== 'engine' && data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Ошибка backend'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-maintenance' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Обслуживание')), E('p', {}, _('Движок, версии, безопасные backups, события и diagnostics export'))])
    ]),
    errors.length ? E('div', {}, errors) : null,
    tabs,
    paneHost
  ]);
}
function mount(ctx) { EnginePanel.mount(ctx); }
function unmount() { EnginePanel.unmount(); }

return baseclass.extend({
  id: 'maintenance',
  title: _('Обслуживание'),
  subtitle: _('Engine installer, backups, versions, events и diagnostics'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
