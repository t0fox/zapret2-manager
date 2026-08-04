'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-services as Services';

function cloneTop(value) {
  var result = {};
  Object.keys(value || {}).forEach(function (key) { result[key] = value[key]; });
  return result;
}
function wrapStore(store) {
  var proxy = {};
  Object.keys(store || {}).forEach(function (key) {
    if (typeof store[key] === 'function') proxy[key] = store[key].bind(store);
    else proxy[key] = store[key];
  });
  proxy.get = function () {
    var snapshot = store.get();
    var result = cloneTop(snapshot);
    result.draft = cloneTop(snapshot.draft || {});
    result.applied = cloneTop(snapshot.applied || {});
    result.draft.services = result.draft.domainHub;
    result.applied.services = result.applied.domainHub;
    return result;
  };
  return proxy;
}
function wrap(ctx) {
  return Object.assign({}, ctx, {
    store: wrapStore(ctx.store),
    setDraft: function (scope, value) {
      return ctx.setDraft(scope === 'services' ? 'domainHub' : scope, value);
    },
    clearDraft: function (scope) {
      return ctx.clearDraft(scope === 'services' ? 'domainHub' : scope);
    }
  });
}
function createAdapter(api, module) {
  return Services.createAdapter(api, module || Services);
}

return baseclass.extend({
  id: 'services',
  title: _('Сервисы и домены'),
  subtitle: _('Каталог, пользовательские домены, Autohostlist и источники'),
  load: function (ctx) { return Services.load(wrap(ctx)); },
  render: function (ctx) { return Services.render(wrap(ctx)); },
  mount: function (ctx) { if (Services.mount) Services.mount(wrap(ctx)); },
  unmount: function (ctx) { if (Services.unmount) Services.unmount(wrap(ctx || {})); },
  resetDraft: function () { if (Services.resetDraft) Services.resetDraft(); },
  createAdapter: createAdapter
});
