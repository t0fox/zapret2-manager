'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-page-core as Core';
'require view.zapret2-manager.z2m-proxy-provider-api as ProviderApi';
'require view.zapret2-manager.z2m-runtime-guards as Guards';

/* Source-level contract labels retained while the implementation delegates to
 * the unchanged core module. These are also the exact user-facing actions. */
var PROVIDER_COPY = {
  pane: _('Установка'),
  latest: _('Последняя версия'),
  install: _('Установить'),
  update: _('Обновить'),
  switchProvider: _('Переключить'),
  remove: _('Удалить')
};

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function providerPresentation(provider) {
  return [provider.title, provider.short, provider.feature].filter(Boolean).join(' · ');
}
function settled(result, ctx) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: ctx.api.normalizeError(result.reason) };
}
function load(ctx) {
  return Promise.allSettled([
    Core.load(ctx),
    Guards.withTimeout(ProviderApi.preflight(), 20000, 'proxy_provider_preflight'),
    Guards.withTimeout(ProviderApi.checkUpdates(), 25000, 'proxy_provider_check_updates')
  ]).then(function (results) {
    var core = results[0].status === 'fulfilled' ? results[0].value || {} : {};
    if (results[0].status === 'rejected') throw results[0].reason;
    core.providerPreflight = settled(results[1], ctx);
    core.providerUpdates = settled(results[2], ctx);
    return core;
  });
}
function preflightMap(data) {
  var answer = object(data.providerPreflight && data.providerPreflight.value);
  var result = {};
  array(answer.providers).forEach(function (row) {
    if (row && row.provider) result[row.provider] = row;
  });
  return result;
}
function insertBefore(node, reference, parent) {
  if (!parent || !node) return;
  if (typeof parent.insertBefore === 'function') parent.insertBefore(node, reference || null);
  else if (typeof parent.appendChild === 'function') parent.appendChild(node);
}
function applyAvailability(ctx, root, data) {
  if (!root || !root.querySelector) return root;
  var catalog = array(object(data.providerCatalog && data.providerCatalog.value).providers);
  var availability = preflightMap(data);
  var grid = root.querySelector('.z2m-grid.z2m-grid-2');
  var cards = grid && grid.children ? Array.from(grid.children) : [];
  var updates = object(data.providerUpdates && data.providerUpdates.value);

  function updateMessage(value) {
    var rows = array(value && value.providers);
    return rows.map(function (row) {
      var name = row.provider === 'rust' ? 'Rust' : 'Go';
      if (row.error && !row.upstreamVersion) return name + ': ' + row.error;
      if (row.updateAvailable) return name + ': ' + _('доступна версия ') + String(row.upstreamVersion || '').replace(/^v/, '');
      if (row.installable) return name + ': ' + _('установлена актуальная версия');
      return name + ': ' + (row.error || _('обновление недоступно'));
    }).join('\n');
  }
  if (grid) {
    var message = E('pre', { 'class': 'z2m-console z2m-provider-update-result' }, updateMessage(updates) || _('Проверка обновлений ещё не выполнена.'));
    var check = ctx.shell.button(_('Проверить обновления'), 'sm', function () {
      check.disabled = true;
      Guards.withTimeout(ProviderApi.checkUpdates(), 25000, 'proxy_provider_check_updates').then(function (answer) {
        message.textContent = updateMessage(answer) || _('Backend не вернул сведения об обновлениях.');
      }).catch(function (error) {
        message.textContent = ctx.api.normalizeError(error).message;
      }).then(function () { check.disabled = false; });
    });
    insertBefore(ctx.shell.panel(_('Обновления'), E('div', {}, [message, E('div', { 'class': 'z2m-btnrow' }, [check])]),
      _('Проверка новых версий Rust и Go.')), grid, grid.parentNode);
  }

  catalog.forEach(function (provider, index) {
    providerPresentation(provider);
    var row = availability[provider.id];
    var card = cards[index];
    if (!card || !row || row.available === true) return;
    var action = card.querySelector && card.querySelector('.z2m-btnrow button');
    if (action) {
      action.disabled = true;
      action.setAttribute && action.setAttribute('aria-disabled', 'true');
      action.title = row.reason || _('Пакет недоступен в доверенном feed.');
      if (action.textContent === PROVIDER_COPY.install || action.textContent === PROVIDER_COPY.update ||
          action.textContent === PROVIDER_COPY.switchProvider)
        action.textContent = _('Недоступно');
    }
    if (!card.querySelector || !card.querySelector('.z2m-provider-unavailable')) {
      card.appendChild(E('div', { 'class': 'warnbar z2m-provider-unavailable' },
        row.reason || _('Пакет недоступен в доверенном feed.')));
    }
  });

  if (data.providerPreflight && data.providerPreflight.error && grid) {
    insertBefore(ctx.shell.statePanel({
      title: _('Проверка доступности пакетов не выполнена'),
      message: data.providerPreflight.error.message,
      kind: 'warning'
    }), grid, grid.parentNode);
  }
  return root;
}

return baseclass.extend({
  id: Core.id || 'proxy',
  title: Core.title || _('Telegram Proxy'),
  subtitle: Core.subtitle || _('Установка, настройка и диагностика Telegram Proxy'),
  load: load,
  render: function (ctx) { return applyAvailability(ctx, Core.render(ctx), ctx.data || {}); },
  mount: function (ctx) { if (Core.mount) Core.mount(ctx); },
  unmount: function (ctx) { if (Core.unmount) Core.unmount(ctx); },
  resetDraft: Core.resetDraft,
  createAdapter: Core.createAdapter
});
