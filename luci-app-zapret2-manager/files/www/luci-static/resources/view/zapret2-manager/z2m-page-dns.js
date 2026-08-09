'use strict';
'require baseclass';

var pollTimer = null;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function valueOf(entry) { return object(entry).value || {}; }

function load(ctx) {
  var calls = [
    ctx.api.dns.get(),
    ctx.api.dns.components(),
    ctx.api.dns.providers(),
    ctx.api.dns.globalGet(),
    ctx.api.dns.serviceProviders(),
    ctx.api.dns.serviceStatus(),
    ctx.api.dns.servicePreview()
  ];
  return Promise.all(calls.map(ctx.api.settle)).then(function (results) {
    return {
      current: results[0], components: results[1], providers: results[2],
      global: results[3], serviceProviders: results[4], serviceStatus: results[5],
      servicePreview: results[6]
    };
  });
}

function row(label, value) {
  return E('div', { 'class': 'z2m-metric' }, [E('span', { 'class': 'z2m-metric__label' }, label), E('strong', { 'class': 'z2m-metric__value' }, value == null || value === '' ? '—' : String(value))]);
}

function errorOr(ctx, entry, content) {
  return object(entry).error ? ctx.ui.errorPanel(ctx.state.normalizeError(entry.error)) : content;
}

function currentCard(ctx, data) {
  var value = valueOf(data.current);
  return ctx.ui.card(_('Текущее состояние'), errorOr(ctx, data.current, [
    row(_('Состояние'), value.health || value.state || _('Неизвестно')),
    row(_('Revision'), value.revision),
    row(_('Rollback'), value.rollbackAvailable === true ? _('Доступен') : _('Недоступен'))
  ]), { badge: ctx.ui.badge(value.health || value.state || 'info', value.health || value.state || _('Нет данных')) });
}

function providerCard(ctx, data) {
  var current = valueOf(data.current);
  var providers = array(valueOf(data.providers).providers);
  return ctx.ui.card(_('Режим / провайдер'), errorOr(ctx, data.providers, [
    row(_('Режим'), current.mode), row(_('Основной'), current.primary), row(_('Резервный'), current.fallback),
    E('div', { 'class': 'z2m-chip-row' }, providers.map(function (provider) {
      provider = object(provider);
      return ctx.ui.badge(provider.available === false ? 'unsupported' : 'info', provider.id || provider.name);
    }))
  ]));
}

function componentsCard(ctx, data) {
  var components = array(valueOf(data.components).components);
  return ctx.ui.card(_('Доступность компонентов'), errorOr(ctx, data.components, components.length ? components.map(function (component) {
    component = object(component);
    return E('div', { 'class': 'z2m-list-row' }, [
      E('code', {}, component.id || component.name),
      ctx.ui.badge(component.available === true ? 'healthy' : 'unsupported', component.available === true ? _('Доступен') : component.reason || _('Недоступен'))
    ]);
  }) : ctx.ui.emptyState(_('Компоненты не обнаружены'), _('Backend не вернул список компонентов.'))));
}

function configurationCard(ctx, data) {
  var current = valueOf(data.current);
  var global = valueOf(data.global);
  var routes = array(valueOf(data.serviceStatus).routes);
  return ctx.ui.card(_('Конфигурация'), [
    errorOr(ctx, data.global, [row(_('Global mode'), global.mode), row(_('DNS intercept'), global.intercept === true ? _('Включён') : _('Выключен'))]),
    row(_('Ручных записей'), array(current.entries).length),
    row(_('Service routes'), routes.length),
    routes.length ? E('div', { 'class': 'z2m-compact-table' }, routes.map(function (route) {
      route = object(route);
      return E('div', { 'class': 'z2m-list-row' }, [E('code', {}, route.serviceId || route.id), E('span', {}, route.providerId || 'system'), ctx.ui.badge(route.state || 'info', route.state || _('Настроен'))]);
    })) : ''
  ]);
}

function diagnosticsCard(ctx) {
  var input = E('input', { 'class': 'z2m-input', type: 'text', placeholder: 'example.com', 'aria-label': _('Домен для проверки') });
  var result = E('div', { 'class': 'z2m-result', 'aria-live': 'polite' }, _('Проверка ещё не запускалась.'));
  return ctx.ui.card(_('Проверка / диагностика'), [
    E('div', { 'class': 'z2m-inline-form' }, [input,
      ctx.ui.button(_('Проверить'), { kind: 'primary', onClick: function () {
        Promise.resolve(ctx.api.dns.check({ domain: input.value || '' })).then(function (answer) { result.replaceChildren(ctx.ui.terminal(JSON.stringify(answer, null, 2))); }, function (error) { result.replaceChildren(ctx.ui.errorPanel(ctx.state.normalizeError(error))); });
      } }),
      ctx.ui.button(_('Диагностика компонентов'), { onClick: function () {
        Promise.resolve(ctx.api.dns.diagnose({ domain: input.value || '' })).then(function (answer) { result.replaceChildren(ctx.ui.terminal(JSON.stringify(answer, null, 2))); }, function (error) { result.replaceChildren(ctx.ui.errorPanel(ctx.state.normalizeError(error))); });
      } })
    ]), result
  ]);
}

function previewCard(ctx, data) {
  var preview = valueOf(data.servicePreview);
  return ctx.ui.card(_('Предпросмотр'), errorOr(ctx, data.servicePreview, preview.changes && preview.changes.length ? ctx.ui.terminal(JSON.stringify(preview, null, 2)) : ctx.ui.emptyState(_('Изменений нет'), _('Предпросмотр service DNS не содержит изменений.'))));
}

function actionsCard(ctx, data) {
  var current = valueOf(data.current);
  return ctx.ui.card(_('Применение / откат'), [
    E('p', { 'class': 'z2m-dim' }, _('Изменения проходят validation, preview и только затем apply.')),
    E('div', { 'class': 'z2m-action-row' }, [
      ctx.ui.button(_('Проверить и применить'), { kind: 'primary', onClick: function () {
        applyDraft(ctx, { mode: current.mode, primary: current.primary, fallback: current.fallback, expectedRevision: current.revision });
      } }),
      ctx.ui.button(_('Применить service DNS'), { onClick: function () { applyServiceDns(ctx, { routes: array(valueOf(data.serviceStatus).routes) }); } }),
      ctx.ui.button(_('Откатить DNS'), { kind: 'danger', disabled: current.rollbackAvailable !== true, onClick: function () { requestRollback(ctx); } })
    ])
  ]);
}

function render(ctx) {
  var data = object(ctx.data);
  return E('section', { 'class': 'z2m-page', 'data-page': 'dns' }, [
    E('header', { 'class': 'z2m-page-header' }, [E('div', {}, [E('h1', {}, 'DNS'), E('p', { 'class': 'z2m-page-description' }, _('Управление существующим DNS backend zapret2-manager.'))]), ctx.ui.button(_('Обновить'), { onClick: ctx.refresh })]),
    E('div', { 'class': 'z2m-dashboard-grid' }, [currentCard(ctx, data), providerCard(ctx, data), componentsCard(ctx, data)]),
    configurationCard(ctx, data),
    E('div', { 'class': 'z2m-section-gap' }, diagnosticsCard(ctx)),
    E('div', { 'class': 'z2m-section-gap' }, previewCard(ctx, data)),
    E('div', { 'class': 'z2m-section-gap' }, actionsCard(ctx, data))
  ]);
}

function updateOperation(ctx, operation) {
  var snapshot = ctx.store.get();
  var rows = array(snapshot.operations).filter(function (item) { return item.operationId !== operation.operationId; });
  if (operation.state !== 'succeeded' && operation.state !== 'failed' && operation.state !== 'cancelled' && operation.state !== 'rolled_back') rows.push(operation);
  ctx.store.update({ operations: rows });
}

function toast(ctx, kind, message, error) {
  var snapshot = ctx.store.get();
  ctx.store.update({ toasts: array(snapshot.toasts).concat([{ kind: kind, title: kind === 'error' ? _('Операция не выполнена') : _('DNS'), message: message, code: error && error.code }]) });
}

function applyDraft(ctx, draft) {
  var operation = ctx.state.operationFrom('dns-apply', _('Применение DNS'), { operationId: 'dns-apply', state: 'running', phase: 'validating' });
  updateOperation(ctx, operation);
  return Promise.resolve(ctx.api.dns.validate(draft)).then(function (validation) {
    if (validation && validation.ok === false) throw validation;
    operation.phase = 'preview'; updateOperation(ctx, operation);
    return ctx.api.dns.apply({ mode: 'preview' });
  }).then(function (preview) {
    if (preview && preview.ok === false) throw preview;
    operation.phase = 'submitting'; updateOperation(ctx, operation);
    return ctx.api.dns.apply({ mode: 'apply' });
  }).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    operation.state = 'succeeded'; operation.phase = answer.stage || 'verified'; updateOperation(ctx, operation);
    toast(ctx, 'success', _('DNS применён и проверен.'));
    return ctx.refresh();
  }).catch(function (error) {
    operation.state = 'failed'; updateOperation(ctx, operation);
    var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
  });
}

function applyServiceDns(ctx, draft) {
  return Promise.resolve(ctx.api.dns.serviceApplyAsync(draft)).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    var operation = ctx.state.operationFrom('service-dns-apply', _('Применение service DNS'), answer);
    updateOperation(ctx, operation);
    return ctx.api.dns.serviceApplyStatus({ operationId: operation.operationId });
  }).then(function (answer) {
    if (answer && answer.ok === false) throw answer;
    var operation = ctx.state.operationFrom('service-dns-apply', _('Применение service DNS'), answer);
    updateOperation(ctx, operation);
    if (operation.state === 'succeeded') toast(ctx, 'success', _('Service DNS применён.'));
    return operation;
  }).catch(function (error) {
    var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
  });
}

function requestRollback(ctx) {
  var modal = ctx.ui.modal({
    title: _('Откат DNS'),
    body: _('Будет восстановлена предыдущая подтверждённая DNS-конфигурация.'),
    danger: true,
    confirmLabel: _('Откатить'),
    onConfirm: function () {
      return Promise.resolve(ctx.api.dns.rollback()).then(function (answer) {
        if (answer && answer.ok === false) throw answer;
        toast(ctx, 'success', _('DNS восстановлен.'));
        return ctx.refresh();
      }).catch(function (error) {
        var normalized = ctx.state.normalizeError(error); toast(ctx, 'error', normalized.message, normalized);
      });
    }
  });
  if (ctx.root && ctx.root.appendChild) ctx.root.appendChild(modal);
  return modal;
}

function unmount() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

return baseclass.extend({
  id: 'dns', title: 'DNS', load: load, render: render, unmount: unmount,
  applyDraft: applyDraft, applyServiceDns: applyServiceDns, requestRollback: requestRollback
});
