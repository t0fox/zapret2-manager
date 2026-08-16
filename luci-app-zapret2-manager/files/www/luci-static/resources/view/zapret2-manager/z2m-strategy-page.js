'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-engine-gate as EngineGate';
'require view.zapret2-manager.z2m-strategy as Strategy';
'require view.zapret2-manager.z2m-avatar-strategies as AvatarStrategies';
'require view.zapret2-manager.z2m-strategy-workflow as Workflow';
'require view.zapret2-manager.z2m-auto as Auto';
'require view.zapret2-manager.z2m-runs as Runs';
'require view.zapret2-manager.z2m-scanner as Scanner';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function advanced(ctx) {
  var ui = ctx && ctx.store && ctx.store.get && ctx.store.get().ui;
  return !!(ui && ui.advanced);
}
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function primaryModule(mode) {
  return mode === 'workflow' ? Workflow : AvatarStrategies;
}
function primaryContext(ctx, envelope) {
  return Object.assign({}, ctx, { data: object(envelope && envelope.value) });
}
function primaryFailure(ctx, error) {
  var message = error && error.message || _('Не удалось загрузить основной интерфейс Strategy.');
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, [
    E('div', { 'class': 'z2m-phead' }, E('div', {}, [
      E('h1', {}, _('Стратегия')),
      E('p', {}, _('Выбор, проверка и автоматический подбор способа обхода DPI'))
    ])),
    ctx.shell.statePanel({ title: _('Ошибка загрузки'), message: message, kind: 'error' })
  ]);
}

function load(ctx) {
  var isAdvanced = advanced(ctx);
  var mode = isAdvanced ? 'workflow' : 'manual';
  var primary = primaryModule(mode);
  var requests = [primary.load(ctx), Scanner.load(ctx)];
  if (isAdvanced) {
    requests.push(Auto.load(ctx), Runs.load(ctx));
  }
  return Promise.allSettled(requests).then(function (results) {
    return {
      mode: mode,
      primary: settled(results[0], ctx.api),
      scanner: settled(results[1], ctx.api),
      auto: isAdvanced ? settled(results[2], ctx.api) : null,
      runs: isAdvanced ? settled(results[3], ctx.api) : null
    };
  });
}

function render(ctx) {
  var data = object(ctx.data);
  var primary = primaryModule(data.mode);
  var root = data.primary && data.primary.error
    ? primaryFailure(ctx, data.primary.error)
    : primary.render(primaryContext(ctx, data.primary));

  if (data.mode === 'workflow') {
    root.appendChild(Auto.render(ctx, data.auto));
    root.appendChild(Runs.render(ctx, data.runs));
  }
  root.appendChild(Scanner.render(Object.assign({}, ctx, { data: object(data.scanner && data.scanner.value) })));
  return root;
}

function mount(ctx) {
  var data = object(ctx.data);
  var primary = primaryModule(data.mode);
  if (!data.primary || !data.primary.error)
    primary.mount(primaryContext(ctx, data.primary));
  Scanner.mount(Object.assign({}, ctx, { data: object(data.scanner && data.scanner.value) }));
}

function unmount() {
  AvatarStrategies.unmount();
  Strategy.unmount();
  Workflow.unmount();
  Auto.unmount();
  Runs.unmount();
  Scanner.unmount();
}

function createAdapter(api) {
  return Strategy.createAdapter ? Strategy.createAdapter(api) : null;
}

return EngineGate.wrap(baseclass.extend({
  id: 'strategy',
  title: _('Стратегия'),
  subtitle: _('Выбор и проверка способа обхода DPI'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
}));
