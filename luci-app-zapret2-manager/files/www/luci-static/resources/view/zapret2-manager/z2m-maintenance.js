'use strict';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
var state = { preview: null, busy: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function show(value) { return value == null || value === '' ? '—' : String(value); }
function formatTime(value) {
  if (value == null) return '—';
  var date = new Date(typeof value === 'number' && value < 100000000000 ? value * 1000 : value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.maintenance.versions(), ctx.api.maintenance.status(), ctx.api.maintenance.backupList(), edit(ctx.api.maintenance.eventsTail, {})
  ]).then(function (results) {
    return {
      versions: settled(results[0], ctx.api), status: settled(results[1], ctx.api),
      backups: settled(results[2], ctx.api), events: settled(results[3], ctx.api)
    };
  });
}
function renderMaintenance(ctx) {
  var shell = ctx.shell, data = ctx.data || {};
  var versions = data.versions && data.versions.value || {}, system = data.status && data.status.value || {};
  var backups = data.backups && data.backups.value || {}, scopes = backups.scopes || {};
  var nodes = [];
  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function rerender() { ctx.root.replaceChildren.apply(ctx.root, renderMaintenance(ctx)); }
  function reload() { return load(ctx).then(function (next) { ctx.data = next; rerender(); }); }
  nodes.push(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Обслуживание')), E('p', {}, _('Версии, scoped backups, события и diagnostics export'))])]));
  Object.keys(data).forEach(function (key) { if (data[key] && data[key].error) nodes.push(E('div', { 'class': 'warnbar' }, data[key].error.message)); });

  nodes.push(E('div', { 'class': 'z2m-row3' }, [
    shell.panel(_('Версии'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(versions, null, 2))),
    shell.panel(_('Система'), E('div', { 'class': 'z2m-proxy-kv' }, [
      E('div', {}, [E('span', {}, _('Uptime')), E('strong', {}, show(system.uptimeSec))]),
      E('div', {}, [E('span', {}, _('Memory available KiB')), E('strong', {}, show(system.memory && system.memory.availableKb))]),
      E('div', {}, [E('span', {}, _('Overlay %')), E('strong', {}, show(system.storage && system.storage.overlayPercent))])
    ]))
  ]));

  var scopeSelect = E('select', { id: 'z2m-backup-scope', 'aria-label': _('Backup scope') });
  ['all'].concat(SCOPES).forEach(function (scope) { scopeSelect.appendChild(E('option', { value: scope }, scope)); });
  var createButton = shell.button(_('Create backup'), 'primary', function () {
    createButton.disabled = true;
    edit(ctx.api.maintenance.backupCreate, { scope: scopeSelect.value || 'all' }).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('backup_create failed');
      shell.showToast(_('Backup created.'), 'ok'); return reload();
    }).catch(function (error) { createButton.disabled = false; showError(error); });
  });
  var history = E('div', { 'class': 'z2m-backup-history' });
  SCOPES.forEach(function (scope) {
    var item = scopes[scope] || {}, records = asArray(item.history);
    history.appendChild(E('div', { 'class': 'z2m-catbar' }, scope));
    if (!records.length) history.appendChild(shell.empty(_('История пуста.')));
    records.forEach(function (record) {
      var takenAt = record.takenAt;
      var previewButton = shell.button(_('Preview'), 'sm', function () {
        previewButton.disabled = true;
        edit(ctx.api.maintenance.backupPreview, { scope: scope, takenAt: takenAt }).then(function (result) {
          state.preview = { scope: scope, takenAt: takenAt, result: result || {} }; rerender();
        }).catch(function (error) {
          state.preview = { scope: scope, takenAt: takenAt, error: ctx.api.normalizeError(error) }; rerender();
        });
      });
      var deleteButton = shell.button(_('Delete'), 'danger sm', function () {
        if (!window.confirm(_('Delete backup ') + scope + ' @ ' + formatTime(takenAt) + '?')) return;
        edit(ctx.api.maintenance.backupDelete, { scope: scope, takenAt: takenAt }).then(function (answer) {
          if (!answer || answer.ok !== true) throw answer || new Error('backup_delete failed');
          shell.showToast(_('Backup deleted.'), 'ok'); return reload();
        }).catch(showError);
      });
      history.appendChild(E('div', { 'class': 'z2m-backup-row' }, [
        E('div', {}, [E('strong', {}, formatTime(takenAt)), E('div', { 'class': 'z2m-dim' }, show(record.manifestSha256))]),
        E('div', { 'class': 'z2m-btnrow' }, [previewButton, deleteButton])
      ]));
    });
  });
  nodes.push(shell.panel(_('Backups'), E('div', {}, [E('div', { 'class': 'z2m-btnrow' }, [scopeSelect, createButton]), history]), _('Four independent scopes; backend enforces retention and SHA-256 manifests.')));

  if (state.preview) {
    var pv = state.preview, result = pv.result || {};
    var body;
    if (pv.error) body = E('div', { 'class': 'warnbar' }, _('Preview failed: ') + pv.error.message);
    else if (result.ok !== true) body = E('div', { 'class': 'warnbar' }, _('Preview refused: ') + show(result.error && result.error.message || result.error));
    else {
      var restoreButton = shell.button(_('Restore this archive'), 'danger', function () {
        if (!window.confirm(_('Restore this archive? Current state is snapshotted first.'))) return;
        edit(ctx.api.maintenance.backupRestore, { scope: pv.scope, takenAt: pv.takenAt }).then(function (answer) {
          if (!answer || answer.ok !== true) throw answer || new Error('backup_restore failed');
          state.preview = null; shell.showToast(_('Backup restored.'), 'ok'); return reload();
        }).catch(showError);
      }, result.versionGate === 'refuse');
      body = E('div', {}, [
        E('div', { 'class': 'z2m-proxy-kv' }, [
          E('div', {}, [E('span', {}, _('Scope')), E('strong', {}, pv.scope)]),
          E('div', {}, [E('span', {}, _('Taken at')), E('strong', {}, formatTime(pv.takenAt))]),
          E('div', {}, [E('span', {}, _('Integrity')), E('strong', {}, show(result.integrity && (result.integrity.ok ? 'sha256 OK' : result.integrity.reason)))]),
          E('div', {}, [E('span', {}, _('Version gate')), E('strong', {}, show(result.versionGate))])
        ]),
        E('pre', { 'class': 'z2m-diff' }, JSON.stringify(result.diffs || result, null, 2)),
        E('div', { 'class': 'z2m-page-actions' }, [restoreButton])
      ]);
    }
    nodes.push(E('section', { 'class': 'z2m-panel', id: 'z2m-backup-preview' }, [
      E('div', { 'class': 'hd' }, E('h2', {}, _('Restore preview'))), E('div', { 'class': 'bd' }, body)
    ]));
  }

  var events = data.events && data.events.value || {}, eventLines = asArray(events.events || events.lines || events.items);
  nodes.push(shell.panel(_('Events'), data.events && data.events.error ? E('div', { 'class': 'warnbar' }, data.events.error.message) : E('pre', { 'class': 'z2m-console' }, eventLines.map(function (item) { return typeof item === 'string' ? item : JSON.stringify(item); }).join('\n') || _('Событий нет.'))));
  var diagnosticResult = E('pre', { 'class': 'z2m-console' }, _('Export не запускался.'));
  var exportButton = shell.button(_('Diagnostics export'), '', function () {
    exportButton.disabled = true;
    ctx.api.maintenance.diagnosticsExport().then(function (answer) { diagnosticResult.textContent = JSON.stringify(answer, null, 2); }).catch(showError).then(function () { exportButton.disabled = false; });
  });
  nodes.push(shell.panel(_('Diagnostics'), E('div', {}, [exportButton, diagnosticResult])));
  return nodes;
}
function render(ctx) { return E('section', { 'class': 'z2m-view on', id: 'z2m-view-maintenance' }, renderMaintenance(ctx)); }
function mount() {}
function unmount() {}
return { id: 'maintenance', title: _('Обслуживание'), subtitle: _('Backups, versions, events и diagnostics'), load: load, render: render, mount: mount, unmount: unmount };
