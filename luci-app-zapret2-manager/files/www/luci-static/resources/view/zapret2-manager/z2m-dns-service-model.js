'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function same(left, right) { return JSON.stringify(left || {}) === JSON.stringify(right || {}); }
function dnsRevision(value) {
  value = object(value);
  return value.revision != null ? value.revision : object(value.draft).revision != null ? object(value.draft).revision : null;
}
function serviceStatus(data) { return object(data && data.service && data.service.value); }
function selectionMap(status, applied) {
  status = object(status);
  var source = applied ? object(status.applied).selections || status.applied :
    status.selections || status.mappings || status.services || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.profileId || item.providerId || item.provider || item.dns || '';
  });
  else Object.keys(object(source)).forEach(function (id) {
    var item = source[id];
    result[id] = typeof item === 'string' ? item : item &&
      (item.profileId || item.providerId || item.provider || item.dns) || '';
  });
  return result;
}
function serviceSelections(data, changes) {
  var result = selectionMap(serviceStatus(data), false);
  Object.keys(object(changes)).forEach(function (id) {
    var change = object(changes[id]);
    result[id] = change.after == null ? '' : String(change.after);
  });
  return result;
}
function enrich(data) {
  data = data || {};
  var envelope = data.serviceProviders || {};
  var value = object(envelope.value);
  var profiles = array(value.profiles);
  var providers = array(value.providers);
  if (!profiles.length) return data;
  var providerNames = {};
  providers.forEach(function (provider) {
    if (provider && provider.id) providerNames[provider.id] = provider.name || provider.label || provider.id;
  });
  var options = profiles.map(function (profile) {
    var domains = array(profile.requiredDomains);
    return Object.assign({}, profile, {
      id: profile.id,
      name: profile.name || profile.label ||
        String(profile.serviceId || profile.id) + ' · ' + String(providerNames[profile.providerId] || profile.providerId || ''),
      notes: domains.length ? domains.join(', ') : profile.notes
    });
  });
  envelope.value = Object.assign({}, value, { resolverProviders: providers, providers: options });
  data.serviceProviders = envelope;

  var serviceEnvelope = data.service || {};
  var status = object(serviceEnvelope.value);
  var services = object(status.services);
  profiles.forEach(function (profile) {
    var id = profile && profile.serviceId;
    if (!id || services[id]) return;
    services[id] = { id: id, name: profile.serviceName || profile.serviceLabel || id };
  });
  serviceEnvelope.value = Object.assign({}, status, { services: services });
  data.service = serviceEnvelope;
  return data;
}
function combinedDraft(current, patch, data) {
  var next = clone(object(current));
  if (patch.entries) next.entries = clone(patch.entries);
  if (patch.serviceDns) next.serviceDns = clone(patch.serviceDns);
  next.changes = Object.assign({}, object(next.changes), object(patch.changes));
  var dns = data && data.dns && data.dns.value || {};
  next.expectedRevision = dnsRevision(dns);
  next.applicable = patch.applicable !== false;
  next.blocker = patch.blocker || null;
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
    if (dns.serviceDns && dns.serviceDns.changes)
      result.draft['service-dns'] = { changes: clone(dns.serviceDns.changes) };
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
        var changes = object(value).changes;
        var selections = serviceSelections(ctx.data, changes);
        var currentService = object(current.serviceDns);
        var baseline = currentService.baseline || selectionMap(serviceStatus(ctx.data), false);
        var draftRevision = serviceStatus(ctx.data).draftRevision;
        return ctx.setDraft('dns', combinedDraft(current, {
          serviceDns: {
            selections: selections,
            baseline: clone(baseline),
            changes: clone(changes),
            expectedDraftRevision: currentService.expectedDraftRevision != null
              ? currentService.expectedDraftRevision : draftRevision
          },
          changes: {
            serviceDns: {
              label: _('DNS сервисов'),
              before: clone(baseline),
              after: clone(selections)
            }
          },
          applicable: true,
          blocker: null
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

return baseclass.extend({
  object: object,
  array: array,
  clone: clone,
  same: same,
  dnsRevision: dnsRevision,
  serviceStatus: serviceStatus,
  selectionMap: selectionMap,
  enrich: enrich,
  wrap: wrap
});
