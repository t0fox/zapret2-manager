'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-scanner as Scanner';

var TABS = [
  { id: 'search', label: _('Подбор стратегии') },
  { id: 'history', label: _('История') }
];
var state = { activeTab: 'search', child: null, childContext: null, host: null, nav: null, root: null, ctx: null, history: [], detail: null, historyError: null };
var DETECT_HISTORY_SCHEMA = 'z2m-detect-history.v1';
var DETECT_OPERATIONS = ['probe', 'classify', 'quic', 'voice', 'tcp16'];

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function dateValue(value) { if (typeof value === 'number' && isFinite(value)) return value < 100000000000 ? value * 1000 : value; var time = Date.parse(text(value)); return isNaN(time) ? 0 : time; }
function icon(name, className) { return Icons.wrappedNode(name, { size: 18, wrapperClass: 'z2m-scanner-icon' + (className ? ' ' + className : '') }); }
function statusLabel(value) { return ({ completed: _('Завершено'), running: _('Выполняется'), probing: _('Выполняется'), starting: _('Подготавливается'), cancelled: _('Остановлено'), stopped: _('Остановлено'), error: _('Ошибка') })[text(value)] || _('Состояние уточняется'); }
function statusClass(value) { return ({ completed: 'is-success', running: 'is-running', probing: 'is-running', starting: 'is-running', cancelled: 'is-stopped', stopped: 'is-stopped', error: 'is-error' })[text(value)] || 'is-unknown'; }
function validHistoryTarget(value) {
  var target = text(value).trim().toLowerCase();
  if (!target || target.length > 253 || target.indexOf('://') >= 0 || target.indexOf('/') >= 0 || target.indexOf(':') >= 0 || target.indexOf(' ') >= 0 || target.indexOf('.') < 0) return null;
  var labels = target.split('.');
  for (var i = 0; i < labels.length; i++) {
    if (!labels[i] || labels[i].length > 63 || labels[i].startsWith('-') || labels[i].endsWith('-') || !/^[a-z0-9-]+$/.test(labels[i])) return null;
  }
  return target;
}
function normalizeDetectHistory(value) {
  value = object(value);
  var report = object(value.report), provenance = object(value.provenance), request = object(value.request), data = report.data;
  var operation = text(value.operation).toLowerCase();
  var target = validHistoryTarget(request.target);
  if (value.schema !== DETECT_HISTORY_SCHEMA || !text(value.id) || text(value.id).length > 128 || value.status !== 'completed' || !dateValue(value.createdAt) || !target || DETECT_OPERATIONS.indexOf(operation) < 0 || provenance.source !== 'z2k-detect' || provenance.schema !== DETECT_HISTORY_SCHEMA || provenance.operation !== operation || report.typedDetect !== true || report.operation !== operation || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    schema: DETECT_HISTORY_SCHEMA,
    id: text(value.id),
    status: 'completed',
    createdAt: value.createdAt,
    request: { target: target },
    operation: operation,
    provenance: { source: 'z2k-detect', schema: DETECT_HISTORY_SCHEMA, operation: operation },
    report: { typedDetect: true, operation: operation, data: data }
  };
}
function detectVerdict(record) {
  var normalized = normalizeDetectHistory(record), data = normalized ? object(normalized.report.data) : {};
  return text(data.verdict || data.PathVerdict || (data.Detected === true ? 'detected' : data.Detected === false ? 'clear' : data.FailureCode || 'observed'));
}
function historyStatusLabel(item) {
  var normalized = normalizeDetectHistory(item);
  return normalized ? statusLabel(normalized.status) : _('История недоступна');
}
function historyStatusClass(item) {
  var normalized = normalizeDetectHistory(item);
  return normalized ? statusClass(normalized.status) : 'is-error';
}
function humanDate(value) { var time = dateValue(value); return time ? new Date(time).toLocaleString() : _('Дата неизвестна'); }
function historyTimestamp(item) { var normalized = normalizeDetectHistory(item); return normalized ? normalized.createdAt : null; }
function historyTime(value) { var time = dateValue(value); return time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : _('Время неизвестно'); }
function diagnosticRecord() { return false; }
function historySort(items) {
  return array(items).map(normalizeDetectHistory).filter(function (item) { return !!item; }).sort(function (a, b) { return Number(diagnosticRecord(a)) - Number(diagnosticRecord(b)) || dateValue(historyTimestamp(b)) - dateValue(historyTimestamp(a)); });
}
function historyGroupKey(value) { var time = dateValue(value); return time ? new Date(time).toISOString().slice(0, 10) : 'undated'; }
function historyGroupLabel(key) {
  if (key === 'undated') return _('Без даты');
  var date = new Date(key + 'T12:00:00');
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var delta = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (delta === 0) return _('Сегодня');
  if (delta === 1) return _('Вчера');
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function historyCounts(item) {
  var normalized = normalizeDetectHistory(item);
  return normalized ? normalized.operation.toUpperCase() + ' · ' + detectVerdict(normalized) : _('История недоступна');
}
function historyBest(record) { var normalized = normalizeDetectHistory(record); return normalized ? normalized.report.data : {}; }
function historyDetailBody(ctx, record) {
  var normalized = normalizeDetectHistory(record);
  if (!normalized) return ctx.shell.statePanel({ title: _('История недоступна'), message: _('Запись не содержит подтверждённого результата Z2K Detect.'), kind: 'info' });
  var data = object(normalized.report.data);
  var verdict = detectVerdict(normalized);
  var reason = text(data.reason || data.PathReason || data.FailureReason || data.Err || _('Результат получен от Z2K Detect.'));
  var technical = { schema: normalized.schema, id: normalized.id, operation: normalized.operation, provenance: normalized.provenance, report: normalized.report };
  return E('div', { 'class': 'z2m-scanner-detail' }, [E('div', { 'class': 'z2m-scanner-detail-heading' }, [icon('history'), E('div', {}, [E('strong', {}, normalized.request.target), E('span', {}, normalized.operation.toUpperCase() + ' · ' + verdict + ' · ' + humanDate(normalized.createdAt))])]), E('div', { 'class': 'z2m-scanner-detail-grid' }, [E('div', {}, [E('span', {}, _('Операция')), E('strong', {}, normalized.operation.toUpperCase())]), E('div', {}, [E('span', {}, _('Результат')), E('strong', {}, verdict)]), E('div', {}, [E('span', {}, _('Состояние')), E('strong', {}, statusLabel(normalized.status))])]), E('p', { 'class': 'z2m-scanner-detail-reason' }, reason), E('details', { 'class': 'z2m-scanner-technical' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, JSON.stringify(technical, null, 2))])]);
}
function openHistoryDetail(ctx, item, button) {
  button.disabled = true;
  Promise.resolve(object(item)).then(function (record) {
    var footer = [ctx.shell.button(_('Закрыть'), '', ctx.shell.closeModal)];
    footer.push(ctx.shell.button(_('Проверить снова'), 'sm', function () { ctx.shell.closeModal(); if (ctx.navigate) ctx.navigate('scan'); }));
    ctx.shell.openModal(_('Подробности проверки'), historyDetailBody(ctx, record), footer);
    button.disabled = false;
  }).catch(function (error) { button.disabled = false; ctx.shell.openModal(_('Проверка недоступна'), ctx.shell.statePanel({ title: _('Не удалось открыть запись'), message: ctx.api.normalizeError(error).message, kind: 'error' })); });
}
function tabFrom(ctx) {
  var value = ctx && ctx.routeParams && ctx.routeParams.tab;
  return value === 'history' ? 'history' : 'search';
}
function childFor(tab) { return tab === 'search' ? Scanner : null; }
function activeLabel(tab) { return (TABS.filter(function (item) { return item.id === tab; })[0] || TABS[0]).label; }
function boundedChildLoad(child, ctx) {
  var work = child && child.load ? child.load(ctx) : Promise.resolve({});
  return Promise.race([Promise.resolve(work), new Promise(function (resolve) { window.setTimeout(function () { resolve({}); }, 1500); })]);
}
function historyList(ctx) {
  return Promise.resolve().then(function () {
    var value = typeof sessionStorage === 'undefined' ? [] : JSON.parse(sessionStorage.getItem('z2m.detect.history.v1') || '[]');
    state.historyError = null;
    state.history = historySort(array(value)).slice(0, 50);
    return { history: state.history };
  }).catch(function (error) {
    state.historyError = ctx.api.normalizeError ? ctx.api.normalizeError({ code: 'EDETECT_SCHEMA', message: 'Detect history is malformed.' }) : { message: _('История проверки повреждена.') };
    state.history = [];
    return { history: [] };
  });
}
function loadTab(ctx, tab) {
  if (tab === 'history') return historyList(ctx);
  var child = childFor(tab);
  return boundedChildLoad(child, ctx);
}
function childContext(ctx, tab) {
  return Object.assign({}, ctx, {
    route: 'scan',
    routeParams: { tab: tab },
    root: state.host,
    refresh: function () { return ctx.refresh('scan'); },
    rerender: function () { return typeof ctx.rerender === 'function' ? ctx.rerender() : Promise.resolve(); }
  });
}
function unmountChild() {
  if (state.child && state.child.unmount && state.childContext) state.child.unmount(state.childContext);
  state.child = null;
  state.childContext = null;
}
function renderHistory(ctx) {
  var groups = {}, order = [];
  state.history.forEach(function (item) { var key = historyGroupKey(historyTimestamp(item)); if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(item); });
  var groupNodes = order.map(function (key) {
    var rows = groups[key].map(function (item) {
      var request = object(item.request), debug = diagnosticRecord(item), started = historyTimestamp(item), action = ctx.shell.button(item.status === 'running' || item.status === 'probing' ? _('Открыть') : _('Подробнее'), 'sm', function () { openHistoryDetail(ctx, item, action); });
      return E('article', { 'class': 'z2m-scanner-history-row', 'data-scanner-history-id': item.id }, [E('div', { 'class': 'z2m-scanner-history-icon' }, [icon(debug ? 'bug' : 'history')]), E('div', { 'class': 'z2m-scanner-history-main' }, [E('strong', {}, request.target || _('Сайт не указан')), E('span', {}, started ? historyTime(started) : _('Время неизвестно')), debug ? E('span', { 'class': 'z2m-scanner-debug-label' }, _('Диагностический запуск')) : null]), E('div', { 'class': 'z2m-scanner-history-result' }, [E('span', { 'class': 'z2m-scanner-status-badge ' + historyStatusClass(item) }, [icon(item.status === 'error' ? 'circle-alert' : (item.status === 'completed' && (object(item.counts).working || 0) > 0) ? 'circle-check' : item.status === 'cancelled' ? 'stop-square' : 'activity'), E('span', {}, historyStatusLabel(item))]), E('span', { 'class': 'z2m-dim' }, historyCounts(item))]), E('div', { 'class': 'z2m-scanner-history-action' }, action)]);
    });
    return E('section', { 'class': 'z2m-scanner-history-group' }, [E('h3', {}, historyGroupLabel(key)), E('div', { 'class': 'z2m-scanner-history-list' }, rows)]);
  });
  var content = state.historyError ? ctx.shell.statePanel({ title: _('История недоступна'), message: state.historyError.message, kind: 'error' }) : (groupNodes.length ? E('div', { 'class': 'z2m-scanner-history-groups' }, groupNodes) : ctx.shell.statePanel({ message: _('Сканирования ещё не выполнялись.'), kind: 'info' }));
  return E('section', { 'class': 'z2m-panel z2m-scanner-history', id: 'z2m-scanner-history' }, [E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('history'), E('strong', {}, _('История проверок Z2K Detect'))]), E('span', { 'class': 'z2m-dim' }, _('Предыдущие типизированные действия Detect'))]), content]);
}
function renderNavigation(ctx) {
  return E('nav', { 'class': 'z2m-subtabs', 'aria-label': _('Разделы сканирования') }, TABS.map(function (item) {
    var button = E('button', { type: 'button', 'class': state.activeTab === item.id ? 'on' : '', 'aria-selected': state.activeTab === item.id ? 'true' : 'false' }, item.label);
    button.addEventListener('click', function () { switchTab(ctx, item.id); });
    return button;
  }));
}
function mountChild(ctx, tab, data) {
  unmountChild();
  if (tab === 'history') {
    state.host.replaceChildren(renderHistory(ctx));
    return;
  }
  var child = childFor(tab), context = childContext(ctx, tab), node = child.render(context);
  state.child = child;
  state.childContext = context;
  state.host.replaceChildren(node);
  if (child.mount) child.mount(context);
}
function renderActive(ctx, data) { mountChild(ctx, state.activeTab, data || {}); }
function switchTab(ctx, tab) {
  if (state.activeTab === tab) return;
  state.activeTab = tab;
  state.detail = null;
  state.nav.replaceWith(renderNavigation(ctx));
  state.nav = state.root.querySelector('.z2m-subtabs');
  state.host.replaceChildren(ctx.shell.loadingState ? ctx.shell.loadingState(activeLabel(tab)) : E('div', { 'class': 'z2m-avatar-state is-loading' }, [E('span', { 'class': 'z2m-spinner', 'aria-hidden': 'true' }), E('p', {}, _('Загружаем данные…'))]));
  loadTab(ctx, tab).then(function (data) { if (state.activeTab === tab) renderActive(ctx, data); });
}
function load(ctx) {
  state.activeTab = tabFrom(ctx);
  state.ctx = ctx;
  return loadTab(ctx, state.activeTab);
}
function render(ctx) {
  state.ctx = ctx;
  state.activeTab = tabFrom(ctx);
  state.root = E('section', { 'class': 'z2m-view on z2m-scanner-product', id: 'z2m-view-scanner-product' }, [
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Сканирование')), E('p', {}, _('Подбор стратегии и история проверок сайтов'))])])
  ]);
  state.nav = renderNavigation(ctx);
  state.host = E('div', { id: 'z2m-scanner-product-host' });
  state.root.appendChild(state.nav);
  state.root.appendChild(state.host);
  renderActive(ctx, ctx.data || {});
  return state.root;
}
function mount() {}
function unmount() { unmountChild(); state.root = null; state.host = null; state.nav = null; state.ctx = null; }

return baseclass.extend({ id: 'scanner-product', title: _('Сканирование'), subtitle: _('Подбор стратегии и история'), load: load, render: render, mount: mount, unmount: unmount });
