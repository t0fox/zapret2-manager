'use strict';
'require baseclass';

function text(value) { return value == null ? '' : String(value); }
function json(value) { return JSON.stringify(value); }
function routesOf(response) { return response && Array.isArray(response.routes) ? response.routes : []; }
function errorText(ctx, error) { return ctx.api.normalizeError(error).message; }
function requestFor(route, extra) {
  return Object.assign({ id: route.id, expectedRevision: route.revision }, extra || {});
}

function load(ctx) {
  return ctx.api.routing.list().then(function (response) {
    return { value: response || {} };
  }).catch(function (error) {
    return { error: ctx.api.normalizeError(error) };
  });
}

function render(ctx) {
  var shell = ctx.shell, envelope = ctx.data || {}, response = envelope.value || {};
  var root = E('section', { 'class': 'z2m-view on z2m-routing-page', id: 'z2m-view-unified-routing' });
  var status = E('div', { 'class': 'z2m-dim', 'aria-live': 'polite' });
  var editor = E('textarea', { rows: 13, 'class': 'z2m-console', 'aria-label': _('Route JSON') }, JSON.stringify({
    id: 'route:example', description: 'DNS route', enabled: true,
    selectors: [{ kind: 'asset', asset: { type: 'hostlist', id: 'hostlist:example', revision: 1, contentSha256: '' } }],
    primary_method: { kind: 'service_dns', service_id: 'discord', profile_id: '' }, ordered_fallbacks: []
  }, null, 2));
  var editorStatus = E('div', { 'class': 'z2m-dim', 'aria-live': 'polite' });

  function parseEditor() {
    try { return JSON.parse(editor.value); }
    catch (error) { editorStatus.textContent = _('Route JSON некорректен.'); editorStatus.className = 'warnbar'; return null; }
  }
  function refresh() { return ctx.refresh('unified-routing'); }
  function action(label, kind, call, input) {
    var button = shell.button(label, kind, function () {
      button.disabled = true; status.className = 'z2m-dim'; status.textContent = _('Выполняется: ') + label + '…';
      var value = typeof input === 'function' ? input() : input;
      if (!value) { button.disabled = false; return; }
      call(value).then(function (answer) {
        if (!answer || answer.ok === false) throw answer || new Error('route operation failed');
        status.className = 'okbar'; status.textContent = label + ': ' + _('готово');
        if (answer.route) editor.value = JSON.stringify(answer.route, null, 2);
        return refresh();
      }).catch(function (error) { status.className = 'warnbar'; status.textContent = errorText(ctx, error); })
        .then(function () { button.disabled = false; });
    });
    return button;
  }
  function routeActions(route) {
    var actions = E('div', { 'class': 'z2m-btnrow' });
    actions.appendChild(action(_('Preview'), '', ctx.api.routing.preview, requestFor(route)));
    actions.appendChild(action(_('Validate'), '', ctx.api.routing.validate, requestFor(route)));
    actions.appendChild(action(_('Apply'), 'primary', ctx.api.routing.apply, requestFor(route)));
    actions.appendChild(action(_('Status'), '', ctx.api.routing.status, requestFor(route)));
    actions.appendChild(action(_('Remove'), 'danger', ctx.api.routing.remove, requestFor(route)));
    return actions;
  }

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [
    E('h1', {}, _('Единая маршрутизация')),
    E('p', {}, _('M6 route lifecycle for typed assets and Service DNS. Service DNS remains the delegated writer.'))
  ])]));
  if (envelope.error) root.appendChild(E('div', { 'class': 'warnbar' }, envelope.error.message));
  root.appendChild(shell.panel(_('Создать или обновить маршрут'), E('div', { 'class': 'z2m-stack' }, [
    E('div', { 'class': 'z2m-hint' }, _('Ожидается полный route object; selectors поддерживают hostlist/hosts, primary_method — service_dns.')),
    editor,
    E('div', { 'class': 'z2m-btnrow' }, [
      action(_('Create'), 'primary', function (value) { return ctx.api.routing.create(value); }, parseEditor),
      action(_('Update'), '', function (value) { return ctx.api.routing.update(value); }, parseEditor),
      action(_('Reconcile'), '', function () { return ctx.api.routing.reconcile(); }, {})
    ]),
    editorStatus
  ]), _('Preview/Validate are pure. Apply delegates to the existing Service DNS owner.')));

  var rows = routesOf(response);
  var body = rows.length ? rows.map(function (route) {
    var state = route.observed_state && route.observed_state.state || _('не применён');
    return E('article', { 'class': 'z2m-routing-row' }, [
      E('div', { 'class': 'z2m-routing-row-head' }, [E('strong', {}, text(route.id)), shell.chip(state, state === 'applied' ? 'g' : 'o', true)]),
      E('div', { 'class': 'z2m-dim' }, text(route.description || _('Без описания')) + ' · revision ' + text(route.revision)),
      E('div', { 'class': 'z2m-dim' }, _('Владелец применения: ') + text(route.ownership && route.ownership.delegated_scope && route.ownership.delegated_scope.service_id || 'service_dns')),
      routeActions(route)
    ]);
  }) : [shell.empty(_('Маршруты ещё не созданы.'))];
  root.appendChild(shell.panel(_('Маршруты'), E('div', { 'class': 'z2m-routing-list' }, body), _('Всего: ') + rows.length));
  root.appendChild(status);
  return root;
}

return baseclass.extend({
  id: 'unified-routing',
  title: _('Единая маршрутизация'),
  subtitle: _('M6 route lifecycle'),
  load: load,
  render: render,
  mount: function () {},
  unmount: function () {}
});
