'use strict';
'require baseclass';

var pollTimer = null;
var visibilityHandler = null;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function valueOf(entry) { return object(entry).value || {}; }

function load(ctx) {
  return Promise.all([
    ctx.api.settle(ctx.api.monitor.snapshot({})), ctx.api.settle(ctx.api.monitor.status()),
    ctx.api.settle(ctx.api.jobs.list()), ctx.api.settle(ctx.api.monitor.eventsTail({ limit: 100 })),
    ctx.api.settle(ctx.api.dns.get()), ctx.api.settle(ctx.api.proxy.status())
  ]).then(function (results) {
    return { snapshot: results[0], status: results[1], jobs: results[2], events: results[3], dns: results[4], proxy: results[5] };
  });
}

function row(values) { return E('div', { 'class': 'z2m-list-row' }, values); }
function errorOr(ctx, entry, body) { return object(entry).error ? ctx.ui.errorPanel(ctx.state.normalizeError(entry.error)) : body; }

function render(ctx) {
  var data = object(ctx.data);
  var snap = valueOf(data.snapshot);
  var runtime = valueOf(data.status);
  var processes = array(snap.processes || object(snap.runtime).processes);
  var jobs = array(valueOf(data.jobs).jobs).filter(function (job) { return ['queued', 'running', 'cancelling', 'rolling_back'].indexOf(job.state) >= 0; });
  var events = array(valueOf(data.events).events || valueOf(data.events).items);
  var errors = events.filter(function (event) { return object(event).level === 'error' || object(event).severity === 'error'; });
  var subsystems = array(snap.subsystems).concat([
    { id: 'dns', state: valueOf(data.dns).state || valueOf(data.dns).health || 'unavailable' },
    { id: 'telegram-proxy', state: valueOf(data.proxy).state || (valueOf(data.proxy).running === true ? 'running' : 'stopped') },
    { id: 'routing', state: 'unsupported' }, { id: 'usque', state: 'unsupported' }
  ]);

  return E('section', { 'class': 'z2m-page', 'data-page': 'monitoring' }, [
    E('header', { 'class': 'z2m-page-header' }, [E('div', {}, [E('h1', {}, _('Мониторинг')), E('p', { 'class': 'z2m-page-description' }, _('Детальное operational состояние runtime и процессов.'))]), ctx.ui.button(_('Обновить'), { onClick: ctx.refresh })]),
    ctx.ui.card('Runtime', errorOr(ctx, data.status, [row([E('span', {}, _('Service state')), ctx.ui.badge(runtime.serviceState || runtime.state || 'unavailable', runtime.serviceState || runtime.state || _('Нет данных'))]), row([E('span', {}, _('Generated at')), E('time', {}, runtime.generatedAt || snap.generatedAt || '—')])])),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('Процессы'), processes.length ? processes.map(function (process) { process = object(process); return row([E('code', {}, String(process.pid || '—')), E('span', {}, process.owner || process.exe || '—'), E('code', {}, process.state || '')]); }) : ctx.ui.emptyState(_('Процессов нет'), _('Runtime не сообщил управляемые процессы.')))),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('Активные задачи'), jobs.length ? jobs.map(function (job) { job = object(job); return row([E('strong', {}, job.kind || job.id), E('code', {}, job.phase || job.state)]); }) : ctx.ui.emptyState(_('Нет активных задач'), _('Очередь операций пуста.')))),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('Подсистемы'), subsystems.map(function (item) { item = object(item); return row([E('code', {}, item.id), ctx.ui.badge(item.state, item.state)]); }))),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card('Health matrix', ctx.ui.terminal(JSON.stringify(snap.health || {}, null, 2)))),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('События'), events.length ? ctx.ui.terminal(events.map(function (event) { return object(event).message || JSON.stringify(event); }).join('\n')) : ctx.ui.emptyState(_('Событий нет'), ''))),
    E('div', { 'class': 'z2m-section-gap' }, ctx.ui.card(_('Последние ошибки'), errors.length ? errors.map(function (event) { return row([E('span', {}, object(event).message || String(event)), E('time', {}, object(event).ts || '')]); }) : ctx.ui.emptyState(_('Ошибок нет'), _('За выбранный период ошибок не обнаружено.'))))
  ]);
}

function schedule(ctx) {
  if (pollTimer) clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(function () { Promise.resolve(ctx.refresh()).then(function () { schedule(ctx); }); }, 5000);
}

function mount(ctx) {
  visibilityHandler = function () { if (document.hidden) { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; } else schedule(ctx); };
  document.addEventListener('visibilitychange', visibilityHandler);
  schedule(ctx);
}

function unmount() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
}

return baseclass.extend({ id: 'monitoring', title: _('Мониторинг'), load: load, render: render, mount: mount, unmount: unmount });
