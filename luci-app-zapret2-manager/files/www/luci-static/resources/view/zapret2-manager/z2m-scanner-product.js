'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-scanner as Scanner';
'require view.zapret2-manager.z2m-blockcheck-page as BlockCheck';

var TABS = [
  { id: 'search', label: _('Подбор стратегии') },
  { id: 'diagnostics', label: _('Диагностика') },
  { id: 'history', label: _('История') }
];
var state = { activeTab: 'search', child: null, childContext: null, host: null, nav: null, root: null, ctx: null, history: [], detail: null, historyError: null };

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function edit(value) { return JSON.stringify(value || {}); }
function tabFrom(ctx) {
  var value = ctx && ctx.routeParams && ctx.routeParams.tab;
  return value === 'diagnostic' || value === 'blockcheck' ? 'diagnostics' : (value === 'history' ? 'history' : 'search');
}
function childFor(tab) { return tab === 'diagnostics' ? BlockCheck : (tab === 'search' ? Scanner : null); }
function activeLabel(tab) { return (TABS.filter(function (item) { return item.id === tab; })[0] || TABS[0]).label; }
function historyList(ctx) {
  return ctx.api.scanner.historyList(edit({ limit: 50 })).then(function (value) {
    state.historyError = null;
    state.history = array(object(value).items);
    return { history: state.history };
  }).catch(function (error) {
    state.historyError = ctx.api.normalizeError(error);
    state.history = [];
    return { history: [] };
  });
}
function loadTab(ctx, tab) {
  if (tab === 'history') return historyList(ctx);
  var child = childFor(tab);
  return child && child.load ? child.load(ctx) : Promise.resolve({});
}
function childContext(ctx, tab) {
  return Object.assign({}, ctx, { route: 'scan', routeParams: { tab: tab }, root: state.host });
}
function unmountChild() {
  if (state.child && state.child.unmount && state.childContext) state.child.unmount(state.childContext);
  state.child = null;
  state.childContext = null;
}
function renderHistory(ctx) {
  var detail = state.detail;
  var rows = state.history.map(function (item) {
    var request = object(item.request);
    var button = ctx.shell.button(_('Подробнее'), 'sm', function () {
      button.disabled = true;
      ctx.api.scanner.historyGet(edit({ id: item.id })).then(function (value) {
        state.detail = object(value).record || null;
        renderActive(ctx, { history: state.history });
      }).catch(function (error) { state.historyError = ctx.api.normalizeError(error); renderActive(ctx, { history: state.history }); });
    });
    return E('article', { 'class': 'z2m-result-card', 'data-scanner-history-id': item.id }, [
      E('strong', {}, item.id || _('Без ID')),
      E('span', {}, (request.target || _('цель не указана')) + ' · ' + (item.status || 'unknown') + ' · ' + (item.phase || '')),
      button
    ]);
  });
  var content = state.historyError ? ctx.shell.statePanel({ title: _('История недоступна'), message: state.historyError.message, kind: 'error' })
    : (rows.length ? E('div', { 'class': 'z2m-stack' }, rows) : ctx.shell.statePanel({ message: _('Сканирования ещё не выполнялись.'), kind: 'info' }));
  if (detail) content = E('div', {}, [content, ctx.shell.panel(_('Запись сканирования'), E('pre', { 'class': 'z2m-log' }, JSON.stringify(detail, null, 2)), _('Только чтение; запуск и применение доступны в соответствующих продуктах.'))]);
  return E('section', { 'class': 'z2m-panel z2m-scanner-history', id: 'z2m-scanner-history' }, [
    E('div', { 'class': 'hd' }, [E('strong', {}, _('История сканирований')), E('span', { 'class': 'z2m-dim' }, _('Bounded read-only Scanner state'))]), content
  ]);
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
  state.host.replaceChildren(ctx.shell.loadingState ? ctx.shell.loadingState(activeLabel(tab)) : E('p', { 'class': 'z2m-dim' }, _('Загрузка…')));
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
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Сканирование')), E('p', {}, _('Подбор стратегии, диагностика и история в одном Scanner product flow'))])])
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

return baseclass.extend({ id: 'scanner-product', title: _('Сканирование'), subtitle: _('Подбор стратегии, диагностика и история'), load: load, render: render, mount: mount, unmount: unmount });
