'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';
'require view.zapret2-manager.z2m-overview as Overview';
'require view.zapret2-manager.z2m-strategy-page as Strategy';
'require view.zapret2-manager.z2m-services as Services';
'require view.zapret2-manager.z2m-lists as Lists';
'require view.zapret2-manager.z2m-dns as Dns';
'require view.zapret2-manager.z2m-proxy as Proxy';
'require view.zapret2-manager.z2m-monitor as Monitor';
'require view.zapret2-manager.z2m-maintenance as Maintenance';

var TAB_IDS = ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'];
var TAB_LABELS = {
  overview: _('Обзор'), strategy: _('Стратегия'), services: _('Сервисы'), lists: _('Списки'),
  dns: _('DNS'), proxy: _('Telegram Proxy'), monitor: _('Мониторинг'), maintenance: _('Обслуживание')
};
var DRAFT_TAB = {
  strategy: 'strategy', services: 'services', lists: 'lists', dns: 'dns',
  proxy: 'proxy', monitor: 'monitor', maintenance: 'maintenance'
};
var DRAFT_LABEL = {
  strategy: _('Стратегия'), services: _('Сервисы'), lists: _('Списки'), dns: _('DNS'),
  proxy: _('Telegram Proxy'), monitor: _('Мониторинг'), maintenance: _('Обслуживание')
};
var MODULES = {
  overview: Overview, strategy: Strategy, services: Services, lists: Lists,
  dns: Dns, proxy: Proxy, monitor: Monitor, maintenance: Maintenance
};
var store = StoreModule.create();
var hashHandler = null;
var activeModule = null;
var activeContext = null;
var activationToken = 0;
var storeUnsubscribe = null;
var confirmationTimer = null;

function tabFromHash() {
  var match = String(window.location.hash || '').match(/^#\/(overview|strategy|services|lists|dns|proxy|monitor|maintenance)$/);
  return match ? match[1] : 'overview';
}
function setHash(tab) {
  if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
  if (window.location.hash !== '#/' + tab) window.location.hash = '#/' + tab;
}
function statusState(initial) {
  if (initial && initial.error) return { label: _('недоступно'), kind: 'r' };
  var value = initial && (initial.serviceState || initial.state || initial.runtime && initial.runtime.state);
  if (value === 'running') return { label: _('работает'), kind: 'g' };
  if (value === 'stopped') return { label: _('остановлена'), kind: 'r' };
  return { label: value || _('неизвестно'), kind: 'o' };
}
function draftScopes() { return Object.keys(store.get().draft || {}); }
function draftLabel(scope) { return DRAFT_LABEL[scope] || scope; }
function draftTab(scope) { return DRAFT_TAB[scope] || 'overview'; }
function safeDraft(value) {
  return JSON.stringify(value, function (key, item) {
    return /secret|token|password/i.test(key) ? '••••••••' : item;
  }, 2);
}

return L.view.extend({
  load: function () {
    return Api.service.status().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },

  render: function (initial) {
    Shell.injectCss();
    var content = E('main', { 'class': 'z2m-content', id: 'z2m-content' });
    var tabs = E('nav', { 'class': 'z2m-tabs', id: 'z2m-tabs', role: 'tablist', 'aria-label': _('Разделы Zapret 2 Manager') });
    var applyBar = Shell.renderApplyBar(store);
    var confirmBar = Shell.renderConfirmBar();
    var appRoot = null;

    function setConfirmation(response) {
      if (!response || response.rollback_ttl == null) return false;
      var ttl = Number(response.rollback_ttl);
      if (!isFinite(ttl) || ttl <= 0) return false;
      var snapshot = store.get();
      store.update({ pending: Object.assign({}, snapshot.pending, {
        confirmation: { rollback_ttl: ttl, deadline: Date.now() + ttl * 1000 }
      }) });
      return true;
    }
    function clearConfirmation() {
      var snapshot = store.get();
      var pending = Object.assign({}, snapshot.pending);
      delete pending.confirmation;
      store.update({ pending: pending });
    }
    function context(tab, module, data, node) {
      return {
        api: Api, store: store, shell: Shell, root: node || content,
        data: data || {}, initial: initial || {},
        navigate: function (next) { return navigateTo(next); },
        refresh: function (next) { return activate(next || tab, true); },
        setDraft: function (scope, value) { store.setDraft(scope, value); },
        clearDraft: function (scope) { store.clearDraft(scope); },
        setConfirmation: setConfirmation
      };
    }
    function navigateTo(tab) {
      if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
      if (window.location.hash !== '#/' + tab) {
        setHash(tab);
        return Promise.resolve();
      }
      return activate(tab);
    }
    function activate(tab, force) {
      if (TAB_IDS.indexOf(tab) < 0) tab = 'overview';
      var token = ++activationToken;
      var module = MODULES[tab];
      if (activeModule && activeContext && activeModule.unmount)
        activeModule.unmount(activeContext);
      activeModule = module;
      activeContext = null;
      store.update({ ui: Object.assign({}, store.get().ui, { tab: tab }) });
      Array.from(tabs.querySelectorAll('button[data-tab]')).forEach(function (button) {
        var selected = button.getAttribute('data-tab') === tab;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      content.replaceChildren(E('div', { 'class': 'z2m-app-placeholder' }, _('Загрузка данных…')));
      return Promise.resolve(module.load(context(tab, module))).then(function (data) {
        if (token !== activationToken) return;
        var ctx = context(tab, module, data);
        var node = module.render(ctx);
        ctx.root = node;
        activeContext = ctx;
        content.replaceChildren(node);
        if (module.mount) module.mount(ctx);
        if (appRoot && appRoot.scrollIntoView && !force) appRoot.scrollIntoView({ block: 'start' });
      }).catch(function (error) {
        if (token !== activationToken) return;
        activeContext = null;
        content.replaceChildren(E('div', { 'class': 'warnbar' }, Api.normalizeError(error).message));
      });
    }

    function updateDraftBar() {
      var scopes = draftScopes();
      var confirmation = store.get().pending && store.get().pending.confirmation;
      applyBar.classList.toggle('hidden', !scopes.length || !!confirmation);
      var text = applyBar.querySelector('#z2m-apply-text');
      if (text && scopes.length) {
        text.textContent = scopes.length + ' ' + (scopes.length === 1 ? _('изменение') : _('изменения')) + ': ' +
          scopes.map(draftLabel).join(', ') + '. ' + _('На работу роутера пока не влияет.');
      }
    }
    function updateConfirmBar() {
      var confirmation = store.get().pending && store.get().pending.confirmation;
      if (confirmationTimer) {
        window.clearInterval(confirmationTimer);
        confirmationTimer = null;
      }
      if (!confirmation) {
        confirmBar.classList.add('hidden');
        updateDraftBar();
        return;
      }
      confirmBar.classList.remove('hidden');
      applyBar.classList.add('hidden');
      var text = confirmBar.querySelector('#z2m-confirm-text');
      function tick() {
        var current = store.get().pending && store.get().pending.confirmation;
        if (!current) return;
        var remaining = Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000));
        if (text) text.textContent = _('Проверьте связь. Автооткат через ') + remaining + _(' с.');
        if (remaining <= 0) {
          window.clearInterval(confirmationTimer);
          confirmationTimer = null;
          clearConfirmation();
          Shell.showToast(_('Срок подтверждения истёк; backend должен выполнить автооткат.'), 'warn');
          activate(store.get().ui.tab, true);
        }
      }
      tick();
      confirmationTimer = window.setInterval(tick, 1000);
    }
    function renderState() {
      if (appRoot)
        appRoot.classList.toggle('adv', !!(store.get().ui && store.get().ui.advanced));
      updateDraftBar();
      updateConfirmBar();
    }
    function previewDrafts() {
      var draft = store.get().draft || {};
      var body = E('div', {}, Object.keys(draft).map(function (scope) {
        return E('section', { 'class': 'z2m-draft-preview' }, [
          E('h4', {}, draftLabel(scope)),
          E('pre', { 'class': 'z2m-diff' }, safeDraft(draft[scope]))
        ]);
      }));
      Shell.openModal(_('Что именно изменится'), body);
    }
    function discardDrafts() {
      Shell.openModal(
        _('Отменить все изменения?'),
        E('p', {}, _('Черновики существуют только в браузере. Backend и runtime изменены не будут.')),
        [
          Shell.button(_('Не отменять'), '', Shell.closeModal),
          Shell.button(_('Отменить черновики'), 'danger', function () {
            Shell.closeModal();
            store.clearAllDrafts();
            var snapshot = store.get();
            store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: null, pendingOverride: null }) });
            window.location.reload();
          })
        ]
      );
    }

    var initialTab = tabFromHash();
    TAB_IDS.forEach(function (tab) {
      var button = E('button', {
        type: 'button', 'data-tab': tab,
        'class': tab === initialTab ? 'on' : '', role: 'tab',
        'aria-selected': tab === initialTab ? 'true' : 'false'
      }, TAB_LABELS[tab]);
      button.addEventListener('click', function () { navigateTo(tab); });
      tabs.appendChild(button);
    });
    if (hashHandler) window.removeEventListener('hashchange', hashHandler);
    hashHandler = function () { activate(tabFromHash()); };
    window.addEventListener('hashchange', hashHandler);

    var service = statusState(initial);
    appRoot = E('div', { 'class': 'z2m-app', id: 'z2m-app' }, [
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
      applyBar,
      confirmBar,
      E('div', { id: 'z2m-modal', 'class': 'z2m-scrim' }),
      E('div', { id: 'z2m-toasts', 'class': 'z2m-toasts' })
    ]);

    applyBar.querySelector('#z2m-discard-drafts').addEventListener('click', discardDrafts);
    applyBar.querySelector('#z2m-preview-drafts').addEventListener('click', previewDrafts);
    applyBar.querySelector('#z2m-open-drafts').addEventListener('click', function () {
      var scopes = draftScopes();
      if (scopes.length) navigateTo(draftTab(scopes[0]));
    });
    confirmBar.querySelector('#z2m-confirm-alive').addEventListener('click', function () {
      var keep = confirmBar.querySelector('#z2m-confirm-alive');
      var rollback = confirmBar.querySelector('#z2m-rollback-now');
      keep.disabled = true;
      rollback.disabled = true;
      Api.strategy.confirmAlive().then(function () {
        clearConfirmation();
        Shell.showToast(_('Изменения подтверждены.'), 'ok');
      }).catch(function (error) {
        keep.disabled = false;
        rollback.disabled = false;
        Shell.showToast(Api.normalizeError(error).message, 'err');
      });
    });
    confirmBar.querySelector('#z2m-rollback-now').addEventListener('click', function () {
      var keep = confirmBar.querySelector('#z2m-confirm-alive');
      var rollback = confirmBar.querySelector('#z2m-rollback-now');
      keep.disabled = true;
      rollback.disabled = true;
      Api.strategy.rollbackManager().then(function () {
        clearConfirmation();
        Shell.showToast(_('Выполнен откат к last-good.'), 'ok');
        return activate(store.get().ui.tab, true);
      }).catch(function (error) {
        keep.disabled = false;
        rollback.disabled = false;
        Shell.showToast(Api.normalizeError(error).message, 'err');
      });
    });

    if (storeUnsubscribe) storeUnsubscribe();
    storeUnsubscribe = store.subscribe(renderState);
    renderState();
    Promise.resolve().then(function () { activate(initialTab); });
    return appRoot;
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
