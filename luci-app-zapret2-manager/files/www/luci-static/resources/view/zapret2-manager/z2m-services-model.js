'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' ? value : {}; }
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
function serviceId(service) {
  return service && (service.id || service.serviceId || service.key);
}
function serviceCategory(service) {
  return service && (service.category || service.group || service.categoryId);
}
function serviceLabel(service) {
  return service && (service.label || service.name || service.displayName || serviceId(service));
}
function activeIds(services) {
  var result = {};
  array(services).forEach(function (service) {
    var id = serviceId(service);
    if (id != null) result[String(id)] = true;
  });
  return result;
}
function enabledMap(value, services) {
  value = value && value.enabled !== undefined ? value.enabled : value;
  var ids = activeIds(services);
  var result = {};
  if (Array.isArray(value)) {
    value.forEach(function (id) {
      if (ids[String(id)]) result[String(id)] = true;
    });
    return result;
  }
  Object.keys(object(value)).forEach(function (id) {
    if (ids[String(id)] && typeof value[id] === 'boolean') result[String(id)] = value[id];
  });
  if (value == null) array(services).forEach(function (service) {
    var id = serviceId(service);
    if (id != null && service.enabled != null) result[String(id)] = service.enabled === true;
  });
  return result;
}
function catalogCategories(catalog, services) {
  var source = array(catalog.categories);
  if (!source.length) {
    var seen = {};
    source = array(services).map(serviceCategory).filter(function (id) {
      if (id == null || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  return source.map(function (category) {
    if (category && typeof category === 'object') return clone(category);
    return { id: String(category), label: String(category) };
  });
}
function catalog(catalogValue, status) {
  var source = object(catalogValue);
  var statusValue = object(status);
  var services = array(source.services || source.items).map(function (service) {
    var normalized = clone(object(service));
    var id = serviceId(service);
    if (id != null) normalized.id = String(id);
    if (serviceLabel(service) != null) normalized.label = serviceLabel(service);
    if (serviceCategory(service) != null) normalized.category = serviceCategory(service);
    return normalized;
  }).filter(function (service) { return service.id != null && service.id !== ''; });
  var ledger = object(statusValue.ledger);
  var revision = ledger.revision !== undefined && ledger.revision !== null
    ? ledger.revision : source.revision !== undefined && source.revision !== null
      ? source.revision : null;
  return {
    services: services,
    categories: catalogCategories(source, services),
    modes: clone(array(source.modes || statusValue.modes)),
    activeMode: statusValue.activeMode || source.activeMode || null,
    revision: revision
  };
}
function draftEnabled(services, baseline, draft) {
  var result = enabledMap(baseline, services);
  var ids = activeIds(services);
  if (baseline == null) result = enabledMap(null, services);
  draft = object(draft);
  if (draft.enabled !== undefined) {
    var direct = enabledMap(draft.enabled, services);
    array(services).forEach(function (service) {
      var id = String(serviceId(service));
      result[id] = !!direct[id];
    });
  }
  var changes = object(draft.changes);
  Object.keys(changes).forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(ids, String(id))) return;
    var change = changes[id];
    result[String(id)] = change && typeof change === 'object' && change.after !== undefined
      ? change.after === true : change === true;
  });
  if (draft.enabled === undefined && !Object.keys(changes).length) {
    Object.keys(draft).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(ids, id) && id !== 'mode' &&
        id !== 'baseline' && id !== 'precondition' && typeof draft[id] === 'boolean')
        result[id] = draft[id];
    });
  }
  return result;
}
function selectors(services, baseline, draft, query, filter, category) {
  services = array(services);
  var applied = enabledMap(baseline, services);
  var enabled = draftEnabled(services, baseline, draft);
  var changed = changes(services, applied, enabled);
  var text = String(query || '').trim().toLowerCase();
  var selectedFilter = filter || 'all';
  var selectedCategory = category || 'all';
  var visible = services.filter(function (service) {
    var id = String(serviceId(service));
    var label = String(serviceLabel(service) || '');
    var group = String(serviceCategory(service) || '');
    if (selectedCategory !== 'all' && selectedCategory !== group) return false;
    if (selectedFilter === 'on' && !enabled[id]) return false;
    if (selectedFilter === 'off' && enabled[id]) return false;
    if (selectedFilter === 'changed' && !changed[id]) return false;
    return !text || (id + ' ' + label + ' ' + group).toLowerCase().indexOf(text) >= 0;
  }).map(function (service) {
    var item = clone(service);
    var id = String(serviceId(service));
    item.enabled = !!enabled[id];
    item.appliedEnabled = !!applied[id];
    item.changed = !!changed[id];
    return item;
  });
  var all = services.length;
  var on = services.filter(function (service) { return !!enabled[String(serviceId(service))]; }).length;
  var changedCount = Object.keys(changed).length;
  return {
    visible: visible,
    counts: { all: all, on: on, off: all - on, changed: changedCount },
    kpis: { total: all, enabled: on, changed: changedCount }
  };
}
function categoryState(services, enabled) {
  var map = enabledMap(enabled, services);
  var total = array(services).length;
  var on = array(services).filter(function (service) { return !!map[String(serviceId(service))]; }).length;
  return { state: on === 0 ? 'off' : on === total ? 'on' : 'mixed', enabled: on, total: total };
}
function categoryStateFor(services, enabled, category) {
  return categoryState(array(services).filter(function (service) {
    return serviceCategory(service) === category;
  }), enabled);
}
function toggleCategory(services, enabled, category) {
  var result = enabledMap(enabled, services);
  var state = categoryStateFor(services, result, category).state;
  var next = state !== 'on';
  array(services).forEach(function (service) {
    if (serviceCategory(service) === category) result[String(serviceId(service))] = next;
  });
  return result;
}
function toggleAll(services, enabled, on) {
  var result = enabledMap(enabled, services);
  array(services).forEach(function (service) { result[String(serviceId(service))] = on === true; });
  return result;
}
function changes(services, baseline, enabled) {
  var before = enabledMap(baseline, services);
  var after = enabledMap(enabled, services);
  var result = {};
  array(services).forEach(function (service) {
    var id = String(serviceId(service));
    if (!!before[id] !== !!after[id]) result[id] = { before: !!before[id], after: !!after[id] };
  });
  return result;
}

return baseclass.extend({
  catalog: catalog,
  selectors: selectors,
  categoryState: categoryState,
  toggleCategory: toggleCategory,
  toggleAll: toggleAll,
  changes: changes
});
