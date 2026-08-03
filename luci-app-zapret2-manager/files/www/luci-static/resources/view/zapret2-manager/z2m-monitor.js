'use strict';

var POLL_MS = 5000;
var state = { pane: 'connections', timer: null, inflight: false, lastGood: null, eventsUnsupported: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function show(value) { return value == null || value === '' ? '—' : String(value); }
function unsupported(error) {
  var text = String(error && (error.message || error.code || error) || '').toLowerCase();
  return text.indexOf('events_tail') >= 0 || text.indexOf('method not found') >= 0 || text.indexOf('not found') >= 0 || text.indexOf('unsupported') >= 0;
}
function load(ctx) {
  return Promise.allSettled([ctx.api.monitor.status(), edit(ctx.api.monitor.eventsTail, {})]).then(function (results) {
    var data = {};
    if (results[0].status === 'fulfilled') { data.status = results[0].value || {}; state.lastGood = data.status; }
    else data.statusError = ctx.api.normalizeError(results[0].reason);
    if (results[1].status === 'fulfilled') data.events = results[1].value || {};
    else {
      data.eventsError = ctx.api.normalizeError(results[1].reason);
      state.eventsUnsupported = unsupported(data.eventsError);
    }
    return data;
  });
}
function table(headers, rows) {
  return E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
    E('thead', {}, E('tr', {}, headers.map(function (header) { return E('th', {}, header); }))),
    E('tbody', {}, rows)
  ]));
}
function renderMonitor(ctx) {
  var shell = ctx.shell, data = ctx.data || {}, status = data.status || state.lastGood || {};
  var runtime = status.runtime || {}, health = status.health || {}, queue = health.queue || {}, checks = asArray(health.checks);
  var instances = asArray(runtime.instances), jobs = asArray(status.jobs), warnings = asArray(status.warnings);
  var nodes = [];
  function setPane(pane) { state.pane = pane; ctx.root.replaceChildren.apply(ctx.root, renderMonitor(ctx)); }
  var tabs = E('div', { 'class': 'z2m-subtabs' });
  [['connections',_('Соединения')],['diagnostics',_('Диагностика')],['log',_('Журнал службы')]].forEach(function (item) {
    var button = E('button', { type: 'button', 'class': state.pane === item[0] ? 'on' : '' }, item[1]);
    button.addEventListener('click', function () { setPane(item[0]); }); tabs.appendChild(button);
  });
  nodes.push(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Мониторинг')), E('p', {}, _('Live runtime state; обновление каждые 5 секунд только на активной вкладке'))])]));
  if (data.statusError) nodes.push(E('div', { 'class': 'warnbar' }, _('Status unavailable: ') + data.statusError.message));
  nodes.push(tabs);

  if (state.pane === 'connections') {
    nodes.push(E('div', { 'class': 'z2m-kpis' }, [
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, show(status.serviceState)), E('div', { 'class': 'l' }, _('service'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, show(runtime.profileCount)), E('div', { 'class': 'l' }, _('profiles'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, show(queue.number)), E('div', { 'class': 'l' }, _('NFQUEUE'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, show(queue.queueDropped)), E('div', { 'class': 'l' }, _('drops'))])
    ]));
    var rows = instances.slice(0, 20).map(function (item) {
      var qnum = /--qnum=(\d+)/.exec(item.cmdline || '');
      return E('tr', {}, [E('td', {}, show(item.pid)), E('td', {}, qnum ? qnum[1] : show(queue.number)), E('td', {}, show(item.rssKb)), E('td', {}, E('code', {}, show(item.cmdline)))]);
    });
    nodes.push(shell.panel(_('nfqws2 instances'), rows.length ? table([_('PID'),_('qnum'),_('RSS KiB'),_('Command')], rows) : shell.empty(_('No nfqws2 instances running.')), queue.registered === false ? _('NFQUEUE not registered') : _('read-only runtime')));
  } else if (state.pane === 'diagnostics') {
    var checkRows = checks.slice(0, 20).map(function (check) { return E('tr', {}, [E('td', {}, show(check.id || check.name)), E('td', {}, E('code', {}, JSON.stringify(check)))]); });
    var jobRows = jobs.slice(0, 20).map(function (job) { return E('tr', {}, [E('td', {}, show(job.id)), E('td', {}, show(job.status)), E('td', {}, show(job.updatedAt))]); });
    nodes.push(shell.panel(_('Health checks'), checkRows.length ? table([_('Check'),_('Result')], checkRows) : shell.empty(_('No checks reported.'))));
    nodes.push(shell.panel(_('Recent jobs'), jobRows.length ? table([_('ID'),_('Status'),_('Updated')], jobRows) : shell.empty(_('No jobs reported.'))));
    warnings.slice(0, 10).forEach(function (warning) { nodes.push(E('div', { 'class': 'warnbar' }, show(warning.code) + ': ' + show(warning.message))); });
  } else {
    var events = data.events || {}, lines = asArray(events.events || events.lines || events.items);
    if (state.eventsUnsupported) nodes.push(shell.panel(_('Журнал службы'), E('div', { 'class': 'z2m-empty' }, _('События недоступны: установленный backend не предоставляет events_tail.'))));
    else if (data.eventsError) nodes.push(shell.panel(_('Журнал службы'), E('div', { 'class': 'warnbar' }, data.eventsError.message)));
    else nodes.push(shell.panel(_('Журнал службы'), E('pre', { 'class': 'z2m-console' }, lines.map(function (entry) { return typeof entry === 'string' ? entry : JSON.stringify(entry); }).join('\n') || _('Событий нет.'))));
  }
  return nodes;
}
function render(ctx) { return E('section', { 'class': 'z2m-view on', id: 'z2m-view-monitor' }, renderMonitor(ctx)); }
function mount(ctx) {
  if (state.timer) return;
  state.timer = setInterval(function () {
    if (state.inflight) return;
    state.inflight = true;
    ctx.api.monitor.status().then(function (status) {
      ctx.data.status = status || {}; ctx.data.statusError = null; state.lastGood = ctx.data.status;
      ctx.root.replaceChildren.apply(ctx.root, renderMonitor(ctx));
    }).catch(function (error) { ctx.data.statusError = ctx.api.normalizeError(error); })
      .then(function () { state.inflight = false; });
  }, POLL_MS);
}
function unmount() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null; state.inflight = false;
}
return { id: 'monitor', title: _('Мониторинг'), subtitle: _('Соединения, диагностика и журнал'), load: load, render: render, mount: mount, unmount: unmount };
