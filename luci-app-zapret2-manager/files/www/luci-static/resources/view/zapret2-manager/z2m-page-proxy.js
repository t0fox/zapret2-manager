'use strict';
'require baseclass';

var revealedLink = null;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function valueOf(entry) { return object(entry).value || {}; }

function load(ctx) {
  var calls = [
    ctx.api.proxy.capabilities(), ctx.api.proxy.status(), ctx.api.proxy.configGet(),
    ctx.api.proxy.health({}), ctx.api.proxy.logsTail({ n: 100 }),
    ctx.api.proxyProvider.catalog(), ctx.api.proxyProvider.status(), ctx.api.proxyProvider.preflight()
  ];
  return Promise.all(calls.map(ctx.api.settle)).then(function (results) {
    return {
      capabilities: results[0], status: results[1], config: results[2], health: results[3], logs: results[4],
      providerCatalog: results[5], providerStatus: results[6], providerPreflight: results[7]
    };
  });
}

function row(label, value) {
  return E('div', { 'class': 'z2m-metric' }, [E('span', { 'class': 'z2m-metric__label' }, label), E('strong', { 'class': 'z2m-metric__value' }, value == null || value === '' ? '—' : String(value))]);
}

function errorOr(ctx, entry, content) { return object(entry).error ? ctx.ui.errorPanel(ctx.state.normalizeError(entry.error)) : content; }

function safeConfig(ctx, value) {
  value = object(value);
  return ctx.state.redact(object(value.config || value.settings || value.draft));
}

function statusCard(ctx, data) {
  var status = valueOf(data.status);
  var health = valueOf(data.health);
  var state = status.health || (status.running === true ? (health.outbound === false ? 'degraded' : 'healthy') : 'stopped');
  return ctx.ui.card(_('Статус'), errorOr(ctx, data.status, [
    row(_('Провайдер'), status.provider), row(_('Установлен'), status.installed === true ? _('Да') : _('Нет')),
    row(_('Процесс'), status.running === true ? _('Работает') : _('Остановлен')), row(_('Uptime'), status.uptime),
    row(_('Health'), health.state || status.health || state), row(_('Latency'), health.latencyMs != null ? health.latencyMs + ' ms' : null)
  ]), { badge: ctx.ui.badge(state, state) });
}

function configCard(ctx, data) {
  var config = valueOf(data.config);
  var safe = safeConfig(ctx, config);
  return ctx.ui.card(_('Конфигурация'), errorOr(ctx, data.config, [
    row(_('Revision'), config.revision),
    Object.keys(safe).length ? ctx.ui.terminal(JSON.stringify(safe, null, 2)) : ctx.ui.emptyState(_('Конфигурация пуста'), _('Backend не вернул доступные поля.')),
    E('div', { 'class': 'z2m-action-row' }, [ctx.ui.button(_('Проверить и применить'), { kind: 'primary', onClick: function () { applyConfig(ctx, { expectedRevision: config.revision, settings: safe }); } })])
  ]));
}

function clientCard(ctx) {
  var display = revealedLink || _('Скрыта до подтверждения');
  return ctx.ui.card(_('Доступ клиента'), [
    E('code', { 'class': 'z2m-secret-display' }, display),
    E('p', { 'class': 'z2m-dim' }, _('Ссылка содержит proxy secret. Не сохраняйте её в логах и скриншотах.')),
    E('div', { 'class': 'z2m-action-row' }, [
      ctx.ui.button(_('Показать ссылку'), { onClick: function () { requestReveal(ctx); } }),
      ctx.ui.button(_('Копировать'), { disabled: !revealedLink, onClick: function () { if (revealedLink && navigator.clipboard) navigator.clipboard.writeText(revealedLink); } }),
      ctx.ui.button('QR', { disabled: !revealedLink })
    ])
  ]);
}

function serviceCard(ctx, data) {
  var status = valueOf(data.status);
  return ctx.ui.card(_('Сервис'), [
    E('div', { 'class': 'z2m-action-row' }, [
      ctx.ui.button(_('Запустить'), { kind: 'primary', onClick: function () { lifecycle(ctx, 'start'); } }),
      ctx.ui.button(_('Остановить'), { onClick: function () { lifecycle(ctx, 'stop'); } }),
      ctx.ui.button(_('Перезапустить'), { onClick: function () { lifecycle(ctx, 'restart'); } }),
      ctx.ui.button(status.autostart === true ? _('Отключить автозапуск') : _('Включить автозапуск'), { onClick: function () { autostart(ctx, status.autostart !== true); } })
    ])
  ]);
}

function providerCard(ctx, data) {
  var providers = array(valueOf(data.providerCatalog).providers);
  var providerStatus = valueOf(data.providerStatus);
  return ctx.ui.card(_('Обслуживание'), [
    errorOr(ctx, data.providerCatalog, providers.length ? providers.map(function (provider) {
      provider = object(provider);
      var installed = array(providerStatus.installed).indexOf(provider.id) >= 0;
      return E('div', { 'class': 'z2m-provider-row' }, [
        E('div', {}, [E('strong', {}, provider.name || provider.id), ctx.ui.badge(installed ? 'healthy' : 'not-installed', installed ? _('Установлен') : _('Не установлен'))]),
        E('div', { 'class': 'z2m-action-row' }, [
          ctx.ui.button(_('Установить / обновить'), { onClick: function () { providerAction(ctx, 'install', provider.id); } }),
          ctx.ui.button(_('Удалить'), { onClick: function () { requestDanger(ctx, 'remove', provider.id); } }),
          ctx.ui.button(_('Purge'), { kind: 'danger', onClick: function () { requestDanger(ctx, 'purge', provider.id); } })
        ])
      ]);
    }) : ctx.ui.emptyState(_('Провайдеры не найдены'), _('Provider catalog недоступен.'))),
    E('div', { 'class': 'z2m-action-row' }, [
      ctx.ui.button(_('Быстрая установка'), { onClick: function () { providerAction(ctx, 'quickInstall'); } }),
      ctx.ui.button(_('Сменить secret'), { kind: 'danger', onClick: function () { requestDanger(ctx, 'rotate'); } })
    ])
  ]);
}

function logsCard(ctx, data) {
  var lines = array(valueOf(data.logs).lines).map(function (line) {
    var text = typeof line === 'string' ? line : JSON.stringify(line);
    return /secret|token|tg:\/\/proxy/i.test(text) ? '[redacted]' : text;
  });
  return ctx.ui.card(_('Логи'), errorOr(ctx, data.logs, ctx.ui.terminal(lines.join('\n') || _('Логи пусты.'))));
}

function render(ctx) {
  var data = object(ctx.data);
  return E('section', { 'class': 'z2m-page', 'data-page': 'proxy' }, [
    E('header', { 'class': 'z2m-page-header' }, [E('div', {}, [E('h1', {}, _('Telegram Proxy')), E('p', { 'class': 'z2m-page-description' }, _('Управление существующим tg-ws-proxy backend.'))]), ctx.ui.button(_('Обновить'), { onClick: ctx.refresh })]),
    E('div', { 'class': 'z2m-dashboard-grid' }, [statusCard(ctx, data), serviceCard(ctx, data)]),
    configCard(ctx, data), E('div', { 'class': 'z2m-section-gap' }, clientCard(ctx)),
    E('div', { 'class': 'z2m-section-gap' }, providerCard(ctx, data)),
    E('div', { 'class': 'z2m-section-gap' }, logsCard(ctx, data))
  ]);
}

function updateOperation(ctx, operation, done) {
  var snapshot = ctx.store.get();
  var rows = array(snapshot.operations).filter(function (item) { return item.operationId !== operation.operationId; });
  if (!done) rows.push(operation);
  ctx.store.update({ operations: rows });
}

function toast(ctx, kind, message, error) {
  var snapshot = ctx.store.get();
  ctx.store.update({ toasts: array(snapshot.toasts).concat([{ kind: kind, title: kind === 'error' ? _('Операция не выполнена') : _('Telegram Proxy'), message: message, code: error && error.code }]) });
}

function mutate(ctx, kind, title, invoke, success) {
  var operation = { operationId: 'proxy-' + kind, kind: 'proxy-' + kind, title: title, state: 'running', phase: 'submitting', events: [] };
  updateOperation(ctx, operation, false);
  return Promise.resolve().then(invoke).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    updateOperation(ctx, operation, true); toast(ctx, 'success', success); return ctx.refresh();
  }).catch(function (error) {
    updateOperation(ctx, operation, true); var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
  });
}

function applyConfig(ctx, draft) {
  var operation = { operationId: 'proxy-config', kind: 'proxy-config', title: _('Применение конфигурации'), state: 'running', phase: 'validating', events: [] };
  updateOperation(ctx, operation, false);
  return Promise.resolve(ctx.api.proxy.configValidate(draft)).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    operation.phase = 'preview'; updateOperation(ctx, operation, false); return ctx.api.proxy.configPreview(draft);
  }).then(function (answer) {
    if (answer && (answer.ok === false || answer.verified === false)) throw answer;
    operation.phase = 'submitting'; updateOperation(ctx, operation, false); return ctx.api.proxy.configApply(draft);
  }).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    updateOperation(ctx, operation, true); toast(ctx, 'success', _('Конфигурация применена.')); return ctx.refresh();
  }).catch(function (error) {
    updateOperation(ctx, operation, true); var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
  });
}

function requestReveal(ctx) {
  var modal = ctx.ui.modal({
    title: _('Показать секретную ссылку'), danger: false,
    body: _('Ссылка содержит proxy secret. Не публикуйте её и не сохраняйте на общих устройствах.'),
    confirmLabel: _('Показать'),
    onConfirm: function () {
      return Promise.resolve(ctx.api.proxy.linkInfo({ reveal: true, confirm: 'REVEAL' })).then(function (answer) {
        if (answer && answer.ok === false) throw answer;
        revealedLink = answer.link || answer.https_link || null;
        return revealedLink;
      }).catch(function (error) {
        var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
      });
    }
  });
  if (ctx.root && ctx.root.appendChild) ctx.root.appendChild(modal);
  return modal;
}

function lifecycle(ctx, action) { return mutate(ctx, action, action, function () { return ctx.api.proxy[action](); }, _('Состояние сервиса обновлено.')); }
function autostart(ctx, enabled) { return mutate(ctx, 'autostart', _('Автозапуск'), function () { return ctx.api.proxy.autostartSet({ enabled: enabled }); }, _('Автозапуск обновлён.')); }

function providerAction(ctx, action, providerId) {
  if (action === 'quickInstall') return mutate(ctx, action, _('Установка'), function () { return ctx.api.proxy.quickInstall(); }, _('Установка завершена.'));
  return mutate(ctx, action, _('Провайдер'), function () { return ctx.api.proxyProvider[action]({ provider: providerId }); }, _('Операция провайдера завершена.'));
}

function requestDanger(ctx, action, providerId) {
  var labels = {
    rotate: [_('Сменить proxy secret'), _('Старые ссылки перестанут работать.'), _('Сменить')],
    remove: [_('Удалить провайдер'), _('Сервис этого провайдера будет недоступен.'), _('Удалить')],
    purge: [_('Полностью удалить провайдер'), _('Будут удалены пакет и его данные.'), _('Purge')]
  };
  var label = labels[action];
  var modal = ctx.ui.modal({
    title: label[0], body: label[1], danger: true, confirmLabel: label[2],
    onConfirm: function () {
      if (action === 'rotate') return mutate(ctx, 'rotate', label[0], function () { return ctx.api.proxy.secretRotate(); }, _('Secret обновлён.'));
      return providerAction(ctx, action, providerId);
    }
  });
  if (ctx.root && ctx.root.appendChild) ctx.root.appendChild(modal);
  return modal;
}

function unmount() { revealedLink = null; }

return baseclass.extend({
  id: 'proxy', title: _('Telegram Proxy'), load: load, render: render, unmount: unmount,
  requestReveal: requestReveal, applyConfig: applyConfig, requestDanger: requestDanger
});
