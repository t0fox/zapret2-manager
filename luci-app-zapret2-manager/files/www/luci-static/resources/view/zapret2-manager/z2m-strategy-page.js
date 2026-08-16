'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-strategies as Strategies';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function primaryModule(mode) {
  return Strategies;
}
function primaryContext(ctx, envelope) {
  return Object.assign({}, ctx, { data: object(envelope && envelope.value) });
}
function primaryFailure(ctx, error) {
  var message = error && error.message || _('Не удалось загрузить страницу стратегий.');
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, [
    E('div', { 'class': 'z2m-phead' }, E('div', {}, [
      E('h1', {}, _('Стратегия')),
      E('p', {}, _('Выбор, проверка и автоматический подбор способа обхода DPI'))
    ])),
    ctx.shell.statePanel({ title: _('Ошибка загрузки'), message: message, kind: 'error' })
  ]);
}

function load(ctx) {
  var mode = 'manual';
  var primary = primaryModule(mode);
  return Promise.allSettled([primary.load(ctx)]).then(function (results) {
    return {
      mode: mode,
      primary: settled(results[0], ctx.api),
      auto: null,
      runs: null
    };
  });
}

function render(ctx) {
  var data = object(ctx.data);
  var primary = primaryModule(data.mode);
  var root = data.primary && data.primary.error
    ? primaryFailure(ctx, data.primary.error)
    : primary.render(primaryContext(ctx, data.primary));

  return root;
}

function mount(ctx) {
  var data = object(ctx.data);
  var primary = primaryModule(data.mode);
  if (!data.primary || !data.primary.error)
    primary.mount(primaryContext(ctx, data.primary));
}

function unmount() {
  Strategies.unmount();
}

function createAdapter(api) {
  return Strategies.createAdapter ? Strategies.createAdapter(api) : null;
}

return baseclass.extend({
  id: 'strategy',
  title: _('Стратегии'),
  subtitle: _('Управление способами обхода DPI'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
});
