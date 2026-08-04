'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-strategy as Strategy';

function load(ctx) {
  return Strategy.load(ctx);
}
function render(ctx) {
  return Strategy.render(Object.assign({}, ctx, { data: ctx.data || {} }));
}
function mount(ctx) {
  Strategy.mount(Object.assign({}, ctx, { data: ctx.data || {}, root: ctx.root }));
}
function unmount(ctx) {
  Strategy.unmount(Object.assign({}, ctx || {}, { data: ctx && ctx.data || {}, root: ctx && ctx.root }));
}
function createAdapter(api) {
  return Strategy.createAdapter ? Strategy.createAdapter(api) : null;
}

return baseclass.extend({
  id: 'strategy',
  title: _('Стратегия'),
  subtitle: _('Выбор и проверка способа обхода DPI'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
});
