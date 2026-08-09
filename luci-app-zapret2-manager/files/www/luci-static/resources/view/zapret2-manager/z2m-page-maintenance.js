'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function valueOf(entry) { return object(entry).value || {}; }

function load(ctx) {
  return Promise.all([
    ctx.api.settle(ctx.api.maintenance.versions()), ctx.api.settle(ctx.api.maintenance.status()),
    ctx.api.settle(ctx.api.maintenance.backupList()), ctx.api.settle(ctx.api.maintenance.eventsTail({ limit: 100 }))
  ]).then(function (results) { return { versions: results[0], status: results[1], backups: results[2], events: results[3] }; });
}

function row(label, value) { return E('div', { 'class': 'z2m-list-row' }, [E('span', {}, label), E('code', {}, value == null ? '—' : String(value))]); }
function errorOr(ctx, entry, body) { return object(entry).error ? ctx.ui.errorPanel(ctx.state.normalizeError(entry.error)) : body; }

function render(ctx) {
  var data = object(ctx.data);
  var versions = valueOf(data.versions);
  var status = valueOf(data.status);
  var backups = array(valueOf(data.backups).backups);
  var events = array(valueOf(data.events).events || valueOf(data.events).items);
  return E('section', { 'class': 'z2m-page', 'data-page': 'maintenance' }, [
    E('header', { 'class': 'z2m-page-header' }, [E('div', {}, [E('h1', {}, _('Обслуживание')), E('p', { 'class': 'z2m-page-description' }, _('Версии, резервные копии и диагностика системы.'))]), ctx.ui.button(_('Обновить'), { onClick: ctx.refresh })]),
    E('div', { 'class': 'z2m-dashboard-grid' }, [
      ctx.ui.card(_('Версии'), errorOr(ctx, data.versions, Object.keys(versions).map(function (key) { return row(key, versions[key]); }))),
      ctx.ui.card(_('Состояние обслуживания'), errorOr(ctx, data.status, [row(_('State'), status.state || status.status), row(_('Last operation'), status.lastOperation || status.operation)]))
    ]),
    ctx.ui.card(_('Резервные копии'), errorOr(ctx, data.backups, [
      E('div', { 'class': 'z2m-action-row' }, [ctx.ui.button(_('Создать backup'), { kind: 'primary', onClick: function () { createBackup(ctx); } })]),
      backups.length ? E('div', { 'class': 'z2m-backup-list' }, backups.map(function (backup) { backup = object(backup); return E('div', { 'class': 'z2m-provider-row' }, [E('div', {}, [E('strong', {}, backup.id || backup.name), E('div', { 'class': 'z2m-dim' }, backup.createdAt || '')]), E('div', { 'class': 'z2m-action-row' }, [ctx.ui.button(_('Восстановить'), { onClick: function () { requestRestore(ctx, backup.id || backup.name); } }), ctx.ui.button(_('Удалить'), { kind: 'danger', onClick: function () { requestDelete(ctx, backup.id || backup.name); } })])]); })) : ctx.ui.emptyState(_('Backup отсутствуют'), _('Создайте первую резервную копию.'))
    ])),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('Экспорт диагностики'), [E('p', { 'class': 'z2m-dim' }, _('Backend вернёт путь или идентификатор диагностического архива.')), ctx.ui.button(_('Создать диагностику'), { onClick: function () { exportDiagnostics(ctx); } })])),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('События'), errorOr(ctx, data.events, events.length ? ctx.ui.terminal(events.map(function (event) { return object(event).message || JSON.stringify(event); }).join('\n')) : ctx.ui.emptyState(_('Событий нет'), ''))))
  ]);
}

function toast(ctx, kind, message, error) {
  var snapshot = ctx.store.get();
  ctx.store.update({ toasts: array(snapshot.toasts).concat([{ kind: kind, title: kind === 'error' ? _('Операция не выполнена') : _('Обслуживание'), message: message, code: error && error.code }]) });
}

function operation(ctx, id, title, invoke, success) {
  var item = { operationId: id, kind: id, title: title, state: 'running', phase: 'submitting', events: [] };
  var snapshot = ctx.store.get();
  ctx.store.update({ operations: array(snapshot.operations).concat([item]) });
  return Promise.resolve().then(invoke).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    var current = ctx.store.get(); ctx.store.update({ operations: array(current.operations).filter(function (entry) { return entry !== item; }) });
    toast(ctx, 'success', success); return ctx.refresh();
  }).catch(function (error) {
    var current = ctx.store.get(); ctx.store.update({ operations: array(current.operations).filter(function (entry) { return entry !== item; }) });
    var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
  });
}

function createBackup(ctx) { return operation(ctx, 'backup-create', _('Создание backup'), function () { return ctx.api.maintenance.backupCreate({}); }, _('Backup создан.')); }
function exportDiagnostics(ctx) { return operation(ctx, 'diagnostics-export', _('Экспорт диагностики'), function () { return ctx.api.maintenance.diagnosticsExport(); }, _('Диагностический архив создан.')); }

function previewBody(ctx, preview) {
  var safe = ctx.state.redact ? ctx.state.redact(preview) : preview;
  return E('div', {}, [E('p', {}, _('Проверьте изменения перед восстановлением.')), ctx.ui.terminal(JSON.stringify(safe, null, 2))]);
}

function requestRestore(ctx, id) {
  return Promise.resolve(ctx.api.maintenance.backupPreview({ id: id })).then(function (preview) {
    if (preview && preview.ok === false) throw preview;
    var modal = ctx.ui.modal({
      title: _('Восстановить backup'), body: previewBody(ctx, preview), danger: true, confirmLabel: _('Восстановить'),
      onConfirm: function () { return operation(ctx, 'backup-restore', _('Восстановление backup'), function () { return ctx.api.maintenance.backupRestore({ id: id }); }, _('Backup восстановлен.')); }
    });
    if (ctx.root && ctx.root.appendChild) ctx.root.appendChild(modal);
    return modal;
  }).catch(function (error) { var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized); });
}

function requestDelete(ctx, id) {
  var modal = ctx.ui.modal({
    title: _('Удалить backup'), body: _('Резервная копия будет удалена без возможности восстановления.'), danger: true, confirmLabel: _('Удалить'),
    onConfirm: function () { return operation(ctx, 'backup-delete', _('Удаление backup'), function () { return ctx.api.maintenance.backupDelete({ id: id }); }, _('Backup удалён.')); }
  });
  if (ctx.root && ctx.root.appendChild) ctx.root.appendChild(modal);
  return modal;
}

return baseclass.extend({ id: 'maintenance', title: _('Обслуживание'), load: load, render: render, requestRestore: requestRestore, requestDelete: requestDelete });
