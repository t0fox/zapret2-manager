'use strict';
'require view.zapret2-manager.z2m-strategy as Strategy';
'require view.zapret2-manager.z2m-auto as Auto';

function strategyContext(ctx, data, root) {
  return Object.assign({}, ctx, { data: data || {}, root: root || ctx.root });
}
function load(ctx) {
  return Promise.all([
    Strategy.load(ctx),
    Auto.load(ctx)
  ]).then(function (results) {
    return { strategy: results[0] || {}, auto: results[1] || {} };
  });
}
function render(ctx) {
  var coreCtx = strategyContext(ctx, ctx.data && ctx.data.strategy);
  var node = Strategy.render(coreCtx);
  var autoPanel = Auto.render(ctx, ctx.data && ctx.data.auto);
  if (node && node.insertBefore) {
    var before = node.querySelector && node.querySelector('.z2m-subtabs');
    node.insertBefore(autoPanel, before || null);
  } else if (node && node.appendChild) {
    node.appendChild(autoPanel);
  }
  return node;
}
function mount(ctx) {
  Strategy.mount(strategyContext(ctx, ctx.data && ctx.data.strategy, ctx.root));
}
function unmount(ctx) {
  Strategy.unmount(strategyContext(ctx, ctx && ctx.data && ctx.data.strategy, ctx && ctx.root));
  Auto.unmount();
}

return {
  id: 'strategy',
  title: _('Стратегия'),
  subtitle: _('Выбор, автоматический подбор и проверка способа обхода DPI'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
};
