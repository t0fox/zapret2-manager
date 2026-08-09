'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function valueOf(entry) { return object(entry).value || {}; }

function load(ctx) {
  return Promise.all([
    ctx.api.settle(ctx.api.service.status()),
    ctx.api.settle(ctx.api.dns.get()),
    ctx.api.settle(ctx.api.proxy.status()),
    ctx.api.settle(ctx.api.jobs.list()),
    ctx.api.settle(ctx.api.maintenance.eventsTail({ limit: 12 }))
  ]).then(function (results) {
    return {
      service: results[0],
      dns: results[1],
      proxy: results[2],
      jobs: results[3],
      events: results[4],
      capabilities: ctx.api.capabilities()
    };
  });
}

function status(value) {
  value = object(value);
  return value.serviceState || value.state || value.status || (value.running === true ? 'running' : value.running === false ? 'stopped' : 'unavailable');
}

function metric(label, value) {
  return E('div', { 'class': 'z2m-metric' }, [E('span', { 'class': 'z2m-metric__label' }, label), E('strong', { 'class': 'z2m-metric__value' }, value == null || value === '' ? '—' : String(value))]);
}

function failedCard(ctx, title, entry) {
  var error = ctx.state.normalizeError(object(entry).error);
  return ctx.ui.card(title, ctx.ui.errorPanel(error), { kind: 'error', badge: ctx.ui.badge('failed', _('Ошибка')) });
}

function unavailableCard(ctx, title) {
  return ctx.ui.card(title, [
    E('p', { 'class': 'z2m-dim' }, _('Требуется backend contract. Интерфейс не показывает вымышленное состояние.'))
  ], { badge: ctx.ui.badge('unsupported', _('Недоступно')) });
}

function serviceCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, 'Zapret2', entry);
  var value = valueOf(entry);
  var state = status(value);
  return ctx.ui.card('Zapret2', [
    metric(_('Активная стратегия'), value.activeStrategy || object(value.strategy).name),
    metric(_('Uptime'), value.uptime || object(value.runtime).uptime),
    E('div', { 'class': 'z2m-action-row' }, [
      ctx.ui.button(_('Запустить'), { kind: 'primary', onClick: function (event) { runServiceAction(ctx, 'start', event && event.currentTarget); } }),
      ctx.ui.button(_('Остановить'), { onClick: function (event) { runServiceAction(ctx, 'stop', event && event.currentTarget); } }),
      ctx.ui.button(_('Перезапустить'), { onClick: function (event) { runServiceAction(ctx, 'restart', event && event.currentTarget); } })
    ])
  ], { badge: ctx.ui.badge(state, state) });
}

function dnsCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, 'DNS', entry);
  var value = valueOf(entry);
  var state = value.health || value.state || 'info';
  return ctx.ui.card('DNS', [metric(_('Режим'), value.mode), metric(_('Провайдер'), value.primary || value.provider)], { badge: ctx.ui.badge(state, state) });
}

function proxyCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, 'Telegram Proxy', entry);
  var value = valueOf(entry);
  var state = value.health || status(value);
  return ctx.ui.card('Telegram Proxy', [metric(_('Провайдер'), value.provider), metric(_('Установлен'), value.installed === true ? _('Да') : _('Нет'))], { badge: ctx.ui.badge(state, state) });
}

function jobsCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, _('Задачи'), entry);
  var jobs = array(valueOf(entry).jobs);
  var active = jobs.filter(function (job) { return ['queued', 'running', 'cancelling', 'rolling_back'].indexOf(job.state) >= 0; });
  var body = active.length ? active.map(function (job) {
    return E('div', { 'class': 'z2m-list-row' }, [E('strong', {}, job.kind || job.id), E('code', {}, job.phase || job.state)]);
  }) : ctx.ui.emptyState(_('Нет активных задач'), _('Долгие операции появятся здесь.'));
  return ctx.ui.card(_('Задачи'), body, { badge: ctx.ui.badge(active.length ? 'busy' : 'healthy', String(active.length)) });
}

function events(entry) { return array(valueOf(entry).events || valueOf(entry).items || valueOf(entry).lines); }

function warningsCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, _('Предупреждения'), entry);
  var warnings = events(entry).filter(function (event) { return ['warning', 'warn', 'error'].indexOf(object(event).level || object(event).severity) >= 0; });
  return ctx.ui.card(_('Предупреждения'), warnings.length ? warnings.map(function (event) {
    return E('div', { 'class': 'z2m-list-row is-warning' }, object(event).message || String(event));
  }) : ctx.ui.emptyState(_('Нет предупреждений'), _('Система не сообщает о деградации.')), { badge: ctx.ui.badge(warnings.length ? 'warning' : 'healthy', String(warnings.length)) });
}

function eventsCard(ctx, entry) {
  if (entry.error) return failedCard(ctx, _('Последние события'), entry);
  var rows = events(entry);
  return ctx.ui.card(_('Последние события'), rows.length ? rows.slice(0, 12).map(function (event) {
    event = object(event);
    return E('div', { 'class': 'z2m-list-row' }, [E('span', {}, event.message || event.event || String(event)), event.ts ? E('time', {}, event.ts) : '']);
  }) : ctx.ui.emptyState(_('Событий пока нет'), _('Значимые изменения появятся здесь.')));
}

function render(ctx) {
  var data = object(ctx.data);
  var caps = object(data.capabilities);
  return E('section', { 'class': 'z2m-page', 'data-page': 'overview' }, [
    E('header', { 'class': 'z2m-page-header' }, [E('div', {}, [E('h1', {}, _('Обзор')), E('p', { 'class': 'z2m-page-description' }, _('Оперативное состояние обхода и сетевых сервисов.'))]), ctx.ui.button(_('Обновить'), { onClick: ctx.refresh })]),
    E('div', { 'class': 'z2m-dashboard-grid' }, [
      serviceCard(ctx, object(data.service)),
      caps.routing ? ctx.ui.card(_('Маршрутизация'), _('Доступна')) : unavailableCard(ctx, _('Маршрутизация')),
      caps.masque ? ctx.ui.card('WARP / MASQUE', _('Доступен')) : unavailableCard(ctx, 'WARP / MASQUE'),
      dnsCard(ctx, object(data.dns)),
      proxyCard(ctx, object(data.proxy)),
      jobsCard(ctx, object(data.jobs)),
      warningsCard(ctx, object(data.events))
    ]),
    eventsCard(ctx, object(data.events))
  ]);
}

function pushToast(ctx, toast) {
  var snapshot = ctx.store.get();
  ctx.store.update({ toasts: array(snapshot.toasts).concat([toast]) });
}

function runServiceAction(ctx, action, control) {
  var labels = { start: _('Запуск'), stop: _('Остановка'), restart: _('Перезапуск') };
  var success = { start: _('Zapret2 запущен.'), stop: _('Zapret2 остановлен.'), restart: _('Zapret2 перезапущен.') };
  var operation = { operationId: 'service-' + action, kind: 'service-' + action, title: labels[action], state: 'running', phase: 'submitting', events: [] };
  var snapshot = ctx.store.get();
  ctx.store.update({ operations: array(snapshot.operations).concat([operation]) });
  ctx.ui.setBusy(control, true, labels[action]);
  return Promise.resolve(ctx.api.service[action]()).then(function (response) {
    if (response && response.ok === false) throw response;
    pushToast(ctx, { kind: 'success', title: labels[action], message: success[action] });
    return ctx.refresh();
  }).catch(function (error) {
    var normalized = ctx.state.normalizeError(error);
    pushToast(ctx, { kind: 'error', title: _('Операция не выполнена'), message: normalized.message, code: normalized.code });
  }).then(function () {
    var current = ctx.store.get();
    ctx.store.update({ operations: array(current.operations).filter(function (item) { return item !== operation; }) });
    ctx.ui.setBusy(control, false);
  });
}

return baseclass.extend({
  id: 'overview',
  title: _('Обзор'),
  load: load,
  render: render,
  runServiceAction: runServiceAction
});
