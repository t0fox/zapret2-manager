'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';

var TAB_IDS = ['overview', 'strategy', 'services', 'lists', 'dns', 'proxy', 'monitor', 'maintenance'];
var TAB_LABELS = {
  overview: _('Обзор'),
  strategy: _('Стратегия'),
  services: _('Сервисы'),
  lists: _('Списки'),
  dns: _('DNS'),
  proxy: _('Telegram Proxy'),
  monitor: _('Мониторинг'),
  maintenance: _('Обслуживание')
};
var store = StoreModule.create();
var hashHandler = null;

function tabFromHash() {
  var match = String(window.location.hash || '').match(/^#\/(overview|strategy|services|lists|dns|proxy|monitor|maintenance)$/);
  return match ? match[1] : 'overview';
}

function setHash(tab) {
  if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
  if (window.location.hash !== '#/' + tab) window.location.hash = '#/' + tab;
}

function placeholder(tab) {
  return E('section', { 'class': 'z2m-view on', 'data-view': tab }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, TAB_LABELS[tab]), E('p', {}, _('Раздел подключается к существующему RPC backend.'))])
    ]),
    Shell.panel(TAB_LABELS[tab], Shell.empty(_('Загрузка данных раздела…')))
  ]);
}

function statusState(initial) {
  if (initial && initial.error) return { label: _('недоступно'), kind: 'r' };
  var state = initial && (initial.serviceState || initial.state || (initial.runtime && initial.runtime.state));
  if (state === 'running') return { label: _('работает'), kind: 'g' };
  if (state === 'stopped') return { label: _('остановлена'), kind: 'r' };
  return { label: state || _('неизвестно'), kind: 'o' };
}

return L.view.extend({
  load: function () {
    return Api.service.status().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },

  render: function (initial) {
    Shell.injectCss();
    var active = tabFromHash();
    var content = E('main', { 'class': 'z2m-content', id: 'z2m-content' }, placeholder(active));
    var tabs = E('nav', { 'class': 'z2m-tabs', id: 'z2m-tabs', 'aria-label': _('Разделы Zapret 2 Manager') });

    function activate(tab) {
      if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
      store.update({ ui: Object.assign({}, store.get().ui, { tab: tab }) });
      Array.from(tabs.querySelectorAll('button[data-tab]')).forEach(function (button) {
        var selected = button.getAttribute('data-tab') === tab;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      content.replaceChildren(placeholder(tab));
      var app = document.getElementById('z2m-app');
      if (app && app.scrollIntoView) app.scrollIntoView({ block: 'start' });
    }

    TAB_IDS.forEach(function (tab) {
      var button = E('button', {
        type: 'button',
        'data-tab': tab,
        'class': tab === active ? 'on' : '',
        role: 'tab',
        'aria-selected': tab === active ? 'true' : 'false'
      }, TAB_LABELS[tab]);
      button.addEventListener('click', function () { setHash(tab); activate(tab); });
      tabs.appendChild(button);
    });

    if (hashHandler) window.removeEventListener('hashchange', hashHandler);
    hashHandler = function () { activate(tabFromHash()); };
    window.addEventListener('hashchange', hashHandler);

    var service = statusState(initial);
    return E('div', { 'class': 'z2m-app', id: 'z2m-app' }, [
      E('header', { 'class': 'z2m-apptop' }, E('div', { 'class': 'in' }, [
        E('div', { 'class': 'z2m-brand' }, [
          E('span', { 'class': 'mark', 'aria-hidden': 'true' }, 'z2'),
          E('span', { 'class': 'nm' }, ['zapret2', E('span', { 'class': 'mgr' }, '·manager')]),
          E('span', { 'class': 'ver' }, 'v0.1.0')
        ]),
        E('div', { 'class': 'z2m-apptop-right' }, [
          E('span', { 'class': 'host' }, window.location.hostname || 'OpenWrt'),
          Shell.chip(service.label, service.kind, true)
        ])
      ])),
      E('div', { 'class': 'z2m-wrap' }, [tabs, content]),
      Shell.renderApplyBar(store),
      E('div', { id: 'z2m-modal', 'class': 'z2m-scrim' }),
      E('div', { id: 'z2m-toasts', 'class': 'z2m-toasts' })
    ]);
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
