'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-dns as Dns';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function serviceSelections(data, changes) {
  var status = data && data.service && data.service.value || {};
  var source = status.selections || status.mappings || status.services || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.providerId || item.provider || item.dns || '';
  });
  else Object.keys(source || {}).forEach(function (id) {
    var item = source[id];
    result[id] = typeof item === 'string' ? item : item && (item.providerId || item.provider || item.dns) || '';
  });
  Object.keys(object(changes)).forEach(function (id) {
    result[id] = object(changes[id]).after || '';
  });
  return result;
}
function combinedDraft(current, patch, data) {
  var next = clone(object(current));
  if (patch.entries) next.entries = clone(patch.entries);
  if (patch.serviceDns) next.serviceDns = clone(patch.serviceDns);
  next.changes = Object.assign({}, object(next.changes), object(patch.changes));
  var dns = data && data.dns && data.dns.value || {};
  var service = data && data.service && data.service.value || {};
  next.expectedRevision = JSON.stringify({
    dns: dns.revision != null ? dns.revision : object(dns.draft).revision,
    serviceDns: service.draftRevision != null ? service.draftRevision : 0
  });
  next.applicable = patch.applicable !== false;
  next.blocker = patch.blocker || next.blocker || null;
  return next;
}
function wrapStore(store) {
  var proxy = {};
  Object.keys(store || {}).forEach(function (key) {
    proxy[key] = typeof store[key] === 'function' ? store[key].bind(store) : store[key];
  });
  proxy.get = function () {
    var snapshot = store.get();
    var result = Object.assign({}, snapshot);
    result.draft = Object.assign({}, snapshot.draft || {});
    var dns = clone(object(result.draft.dns));
    if (dns.serviceDns && dns.serviceDns.changes) result.draft['service-dns'] = { changes: clone(dns.serviceDns.changes) };
    return result;
  };
  return proxy;
}
function wrap(ctx) {
  return Object.assign({}, ctx, {
    store: wrapStore(ctx.store),
    setDraft: function (scope, value) {
      var current = ctx.store.get().draft && ctx.store.get().draft.dns || {};
      if (scope === 'service-dns') {
        var selections = serviceSelections(ctx.data, object(value).changes);
        return ctx.setDraft('dns', combinedDraft(current, {
          serviceDns: {
            selections: selections,
            changes: clone(object(value).changes),
            expectedDraftRevision: ctx.data && ctx.data.service && ctx.data.service.value && ctx.data.service.value.draftRevision
          },
          changes: { serviceDns: { label: _('DNS сервисов'), before: null, after: selections } },
          applicable: false,
          blocker: _('Service DNS сохранён в общем DNS-черновике, но backend пока не поддерживает zero-write preview произвольных selections.')
        }, ctx.data));
      }
      return ctx.setDraft('dns', combinedDraft(current, value || {}, ctx.data));
    },
    clearDraft: function (scope) {
      if (scope === 'service-dns') {
        var current = clone(object(ctx.store.get().draft && ctx.store.get().draft.dns));
        delete current.serviceDns;
        if (current.changes) delete current.changes.serviceDns;
        if (Object.keys(object(current.changes)).length) ctx.setDraft('dns', current);
        else ctx.clearDraft('dns');
        return;
      }
      return ctx.clearDraft(scope);
    }
  });
}
function createAdapter(api, module) {
  var core = Dns.createAdapter(api, module || Dns);
  var originalValidate = core.validateDraft;
  var originalPreview = core.previewDraft;
  core.validateDraft = function (scope, value, context) {
    if (value && value.serviceDns)
      return Promise.resolve({ ok: false, message: value.blocker || _('Service DNS backend preview contract недоступен.') });
    return originalValidate(scope, value, context);
  };
  core.previewDraft = function (scope, value, context) {
    if (value && value.serviceDns)
      return Promise.resolve({ ok: false, message: value.blocker || _('Service DNS backend preview contract недоступен.') });
    return originalPreview(scope, value, context);
  };
  return core;
}

return baseclass.extend({
  id: 'dns',
  title: _('DNS'),
  subtitle: _('Основной DNS, проверки провайдеров и DNS сервисов'),
  load: function (ctx) { return Dns.load(wrap(ctx)); },
  render: function (ctx) { return Dns.render(wrap(ctx)); },
  mount: function (ctx) { if (Dns.mount) Dns.mount(wrap(ctx)); },
  unmount: function (ctx) { if (Dns.unmount) Dns.unmount(wrap(ctx || {})); },
  openDraft: Dns.openDraft,
  focusDraft: Dns.focusDraft,
  resetDraft: Dns.resetDraft,
  createAdapter: createAdapter
});
