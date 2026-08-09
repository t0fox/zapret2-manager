'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-state as State';
'require view.zapret2-manager.z2m-ui-kit as UI';
'require view.zapret2-manager.z2m-page-placeholder as Placeholder';
'require view.zapret2-manager.z2m-page-overview as Overview';
'require view.zapret2-manager.z2m-page-dns as Dns';
'require view.zapret2-manager.z2m-page-proxy as Proxy';
'require view.zapret2-manager.z2m-page-monitoring as Monitoring';
'require view.zapret2-manager.z2m-page-maintenance as Maintenance';

var navigation = [
  { id: 'overview', group: _('ОБЗОР'), title: _('Обзор') },
  { id: 'strategies', group: _('ОБХОД DPI'), title: _('Стратегии') },
  { id: 'selection', group: _('ОБХОД DPI'), title: _('Подбор') },
  { id: 'diagnostics', group: _('ОБХОД DPI'), title: _('Диагностика DPI') },
  { id: 'lists', group: _('ДАННЫЕ'), title: _('Домены / списки') },
  { id: 'routing', group: _('МАРШРУТИЗАЦИЯ'), title: _('Маршрутизация') },
  { id: 'masque', group: _('WARP / MASQUE'), title: _('WARP / MASQUE') },
  { id: 'dns', group: _('DNS'), title: _('DNS') },
  { id: 'proxy', group: _('TELEGRAM PROXY'), title: _('Telegram Proxy') },
  { id: 'monitoring', group: _('МОНИТОРИНГ'), title: _('Мониторинг') },
  { id: 'maintenance', group: _('ОБСЛУЖИВАНИЕ'), title: _('Обслуживание') }
];

var pages = {
  overview: Overview,
  strategies: Placeholder.create('strategies', _('Стратегии'), _('Визуальный редактор profiles, каталоги, validation, preview, apply и rollback будут подключены отдельным этапом.')),
  selection: Placeholder.create('selection', _('Подбор'), _('BlockCheck и автоматический подбор требуют нормализованного run/candidate/ranking contract.')),
  diagnostics: Placeholder.create('diagnostics', _('Диагностика DPI'), _('Pipeline DNS, TCP, TLS, HTTP и QUIC требует диагностического job contract.')),
  lists: Placeholder.create('lists', _('Домены / списки'), _('Data Hub требует contract для CRUD, import, relations и IP/CIDR lists.')),
  routing: Placeholder.create('routing', _('Маршрутизация'), _('Разрешены только DIRECT, NFQWS2, WARP/MASQUE и BLOCK после утверждения routing contract.')),
  masque: Placeholder.create('masque', _('WARP / MASQUE'), _('Страница ограничена usque и ожидает component/session/runtime/connection contract.')),
  dns: Dns,
  proxy: Proxy,
  monitoring: Monitoring,
  maintenance: Maintenance
};

var store = State.createStore({ ui: { page: 'overview' }, toasts: [], operations: [] });
var activePage = null;
var activeContext = null;
var activationToken = 0;
var hashHandler = null;

function pageFromHash() {
  var match = String(window.location.hash || '').match(/^#\/([a-z-]+)$/);
  return match && pages[match[1]] ? match[1] : 'overview';
}

function contextFor(id, data, root) {
  return {
    id: id,
    api: Api,
    state: State,
    store: store,
    ui: UI,
    data: data || {},
    root: root,
    navigate: function (next) {
      if (!pages[next]) next = 'overview';
      if (window.location.hash === '#/' + next) return activate(next);
      window.location.hash = '#/' + next;
      return Promise.resolve();
    },
    refresh: function () { return activate(id, true); }
  };
}

function navigationNode(id, activatePage) {
  var groups = [];
  navigation.forEach(function (item) {
    var current = groups.length ? groups[groups.length - 1] : null;
    if (!current || current.group !== item.group) {
      current = { group: item.group, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  });
  return E('nav', { 'class': 'z2m-sidebar', 'aria-label': _('Разделы Zapret 2 Manager') }, [
    E('div', { 'class': 'z2m-brand' }, [E('strong', {}, 'ZAPRET2'), E('span', {}, 'MANAGER')])
  ].concat(groups.map(function (group) {
    return E('section', { 'class': 'z2m-nav-group' }, [
      E('div', { 'class': 'z2m-nav-group__label' }, group.group),
      E('div', { 'class': 'z2m-nav-group__items' }, group.items.map(function (item) {
        return E('button', {
          'class': 'z2m-nav-item' + (item.id === id ? ' is-active' : ''),
          'data-page': item.id,
          'aria-current': item.id === id ? 'page' : null,
          click: function () {
            if (window.location.hash === '#/' + item.id) activatePage(item.id);
            else window.location.hash = '#/' + item.id;
          }
        }, item.title);
      }))
    ]);
  })));
}

function updateCenters(toastHost, operationHost) {
  var snapshot = store.get();
  toastHost.replaceChildren(UI.toastCenter(snapshot.toasts));
  operationHost.replaceChildren(UI.operationCenter(snapshot.operations));
}

function activate(id, refresh) {
  if (!pages[id]) id = 'overview';
  var token = ++activationToken;
  var page = pages[id];
  var host = activeContext && activeContext.pageHost;
  if (!host) return Promise.resolve();

  if (activePage && activeContext && typeof activePage.unmount === 'function') activePage.unmount(activeContext);
  activePage = page;
  host.setAttribute('aria-busy', 'true');
  if (refresh) host.classList.add('z2m-refreshing');
  else host.replaceChildren(E('section', { 'class': 'z2m-page' }, UI.skeleton(7)));

  var ctx = contextFor(id, {}, host);
  ctx.pageHost = host;
  return Promise.resolve(page.load ? page.load(ctx) : {}).then(function (data) {
    if (token !== activationToken) return;
    ctx.data = data || {};
    var rendered = page.render(ctx);
    host.replaceChildren(rendered);
    host.setAttribute('aria-busy', 'false');
    host.classList.remove('z2m-refreshing');
    activeContext = ctx;
    store.update({ ui: { page: id } });
    if (typeof page.mount === 'function') page.mount(ctx);
  }, function (error) {
    if (token !== activationToken) return;
    host.replaceChildren(E('section', { 'class': 'z2m-page' }, UI.errorPanel(State.normalizeError(error))));
    host.setAttribute('aria-busy', 'false');
    host.classList.remove('z2m-refreshing');
  });
}

var application = view.extend({
  load: function () { return Promise.resolve(); },
  render: function () {
    UI.injectCss();
    var initial = pageFromHash();
    var pageHost = E('main', { 'class': 'z2m-main', id: 'z2m-page-host', 'aria-live': 'polite' });
    var toastHost = E('div', { id: 'z2m-toast-host' });
    var operationHost = E('div', { id: 'z2m-operation-host' });
    var app = E('div', { 'class': 'z2m-app' }, [
      navigationNode(initial, activate),
      pageHost,
      toastHost,
      operationHost
    ]);
    activeContext = { pageHost: pageHost };
    store.subscribe(function () { updateCenters(toastHost, operationHost); });
    updateCenters(toastHost, operationHost);
    hashHandler = function () { activate(pageFromHash()); };
    window.addEventListener('hashchange', hashHandler);
    activate(initial);
    return app;
  },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null,
  remove: function () {
    if (hashHandler) window.removeEventListener('hashchange', hashHandler);
    if (activePage && activeContext && typeof activePage.unmount === 'function') activePage.unmount(activeContext);
  }
});

application.navigation = navigation;
application.pages = pages;
application.pageFromHash = pageFromHash;

return application;
