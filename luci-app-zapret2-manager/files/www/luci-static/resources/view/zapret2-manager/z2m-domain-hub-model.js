'use strict';
'require baseclass';

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  var result = String(value).trim();
  return result || null;
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function unique(values) {
  var seen = {};
  return array(values).map(function (value) { return text(value); }).filter(function (value) {
    if (value === null || seen[value]) return false;
    seen[value] = true;
    return true;
  }).sort();
}
function same(left, right) { return JSON.stringify(unique(left)) === JSON.stringify(unique(right)); }
function normalizeDomain(value) {
  var domain = text(value);
  if (domain === null) return null;
  domain = domain.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  if (!domain || domain.length > 253 || domain.indexOf('*') >= 0 || !/^[a-z0-9.-]+$/.test(domain)) return null;
  var labels = domain.split('.');
  if (labels.length < 2 || labels.some(function (label) {
    return !label || label.length > 63 || label.charAt(0) === '-' || label.charAt(label.length - 1) === '-';
  })) return null;
  if (labels.every(function (label) { return /^\d+$/.test(label); })) return null;
  return domain;
}
function domains(values) {
  var seen = {};
  return array(values).map(normalizeDomain).filter(function (domain) {
    if (domain === null || seen[domain]) return false;
    seen[domain] = true;
    return true;
  }).sort();
}
function conflicts(include, exclude) {
  var excluded = {};
  domains(exclude).forEach(function (domain) { excluded[domain] = true; });
  return domains(include).filter(function (domain) { return excluded[domain]; });
}
function packageId(value) { return text(value && (value.id || value.packageId || value.serviceId)); }
function packageName(value) { return text(value && (value.name || value.label || value.displayName)); }
function packageCategory(value) { return text(value && (value.category || value.group)) || 'other'; }

function normalize(value) {
  var snapshot = object(value);
  var catalog = object(snapshot.catalog);
  var seen = {};
  var packages = array(catalog.packages).map(function (item) {
    var id = packageId(item);
    if (id === null || seen[id]) return null;
    seen[id] = true;
    return {
      id: id,
      name: packageName(item),
      category: packageCategory(item),
      domainCount: Number(item.domainCount || 0),
      stability: text(item.stability),
      mechanisms: array(item.mechanisms).slice(),
      source: clone(item)
    };
  }).filter(Boolean);
  var categories = unique(array(catalog.categories).concat(packages.map(function (item) { return item.category; })));
  var include = domains(object(snapshot.userDomains).include);
  var exclude = domains(object(snapshot.userDomains).exclude);
  return {
    tabs: ['catalog', 'domains', 'autohost', 'sources'],
    revision: text(snapshot.revision),
    catalogDigest: text(catalog.digest),
    catalogVersion: text(catalog.version),
    packages: packages,
    categories: categories,
    enabled: unique(catalog.enabled),
    userDomains: {
      include: include,
      exclude: exclude,
      conflicts: conflicts(include, exclude)
    },
    autohost: {
      entries: domains(object(snapshot.autohost).entries),
      counts: clone(object(snapshot.autohost).counts),
      writable: object(snapshot.autohost).writable === true,
      reason: text(object(snapshot.autohost).reason)
    },
    sources: {
      items: array(object(snapshot.sources).items).map(clone),
      schedule: clone(object(snapshot.sources).schedule),
      lastBuild: clone(object(snapshot.sources).lastBuild),
      writable: object(snapshot.sources).writable === true,
      reason: text(object(snapshot.sources).reason)
    },
    autohostOps: { promote: [], ignore: [], cleanupStale: [] },
    sourceOps: {},
    raw: clone(snapshot)
  };
}

function enabledMap(enabled) {
  var map = {};
  unique(enabled).forEach(function (id) { map[id] = true; });
  return map;
}
function categoryState(packages, enabled) {
  var rows = array(packages);
  var map = enabledMap(enabled);
  var count = rows.filter(function (item) { return map[item.id]; }).length;
  return {
    state: count === 0 ? 'off' : count === rows.length ? 'on' : 'mixed',
    enabled: count,
    total: rows.length
  };
}
function toggleAll(packages, enabled, on) {
  if (on) return unique(array(packages).map(function (item) { return item.id; }));
  return [];
}
function toggleCategory(packages, enabled, category) {
  var map = enabledMap(enabled);
  var rows = array(packages).filter(function (item) { return item.category === category; });
  var state = categoryState(rows, enabled);
  var turnOn = state.state !== 'on';
  rows.forEach(function (item) {
    if (turnOn) map[item.id] = true;
    else delete map[item.id];
  });
  return Object.keys(map).sort();
}
function togglePackage(enabled, id) {
  var map = enabledMap(enabled);
  if (map[id]) delete map[id];
  else map[id] = true;
  return Object.keys(map).sort();
}
function selectPackages(state, query, filter, category) {
  var value = object(state);
  var map = enabledMap(value.enabled);
  var needle = String(query || '').trim().toLowerCase();
  return array(value.packages).filter(function (item) {
    var enabled = !!map[item.id];
    if (filter === 'on' && !enabled) return false;
    if (filter === 'off' && enabled) return false;
    if (category && category !== 'all' && item.category !== category) return false;
    if (needle && String(item.name || item.id).toLowerCase().indexOf(needle) < 0) return false;
    return true;
  }).map(function (item) {
    return Object.assign({}, item, { enabled: !!map[item.id] });
  });
}

function setDomains(state, include, exclude) {
  var normalizedInclude = domains(include);
  var normalizedExclude = domains(exclude);
  return {
    include: normalizedInclude,
    exclude: normalizedExclude,
    conflicts: conflicts(normalizedInclude, normalizedExclude)
  };
}
function nextState(state) {
  return Object.assign({}, state, {
    enabled: unique(state.enabled),
    userDomains: clone(state.userDomains),
    autohost: clone(state.autohost),
    sources: clone(state.sources),
    autohostOps: clone(state.autohostOps || { promote: [], ignore: [], cleanupStale: [] }),
    sourceOps: clone(state.sourceOps || {})
  });
}
function promoteAutohost(state, domain) {
  var next = nextState(state);
  var normalized = normalizeDomain(domain);
  if (normalized === null) return next;
  next.userDomains.include = domains(next.userDomains.include.concat([normalized]));
  next.userDomains.conflicts = conflicts(next.userDomains.include, next.userDomains.exclude);
  next.autohostOps.promote = domains(next.autohostOps.promote.concat([normalized]));
  return next;
}
function ignoreAutohost(state, domain) {
  var next = nextState(state);
  var normalized = normalizeDomain(domain);
  if (normalized === null) return next;
  next.userDomains.exclude = domains(next.userDomains.exclude.concat([normalized]));
  next.userDomains.conflicts = conflicts(next.userDomains.include, next.userDomains.exclude);
  next.autohostOps.ignore = domains(next.autohostOps.ignore.concat([normalized]));
  return next;
}
function change(label, before, after) { return { label: label, before: clone(before), after: clone(after) }; }
function draft(baseline, next) {
  baseline = object(baseline);
  next = object(next);
  var changes = {};
  if (!same(baseline.enabled, next.enabled))
    changes.catalog = change('Пакеты сервисов', baseline.enabled, next.enabled);
  if (!same(object(baseline.userDomains).include, object(next.userDomains).include))
    changes.include = change('Мои домены: включить', object(baseline.userDomains).include, object(next.userDomains).include);
  if (!same(object(baseline.userDomains).exclude, object(next.userDomains).exclude))
    changes.exclude = change('Мои домены: исключить', object(baseline.userDomains).exclude, object(next.userDomains).exclude);
  var autohostOps = object(next.autohostOps);
  if (array(autohostOps.promote).length || array(autohostOps.ignore).length || array(autohostOps.cleanupStale).length)
    changes.autohost = change('Autohostlist', [], {
      promote: domains(autohostOps.promote),
      ignore: domains(autohostOps.ignore),
      cleanupStale: domains(autohostOps.cleanupStale)
    });
  var sourceOps = object(next.sourceOps);
  if (Object.keys(sourceOps).length)
    changes.sources = change('Источники и сборка', {}, sourceOps);
  if (!Object.keys(changes).length) return null;
  var listConflicts = conflicts(object(next.userDomains).include, object(next.userDomains).exclude);
  var sourceBlocked = Object.keys(sourceOps).length && !object(next.sources).writable;
  var blocker = listConflicts.length ? 'Домены одновременно находятся во включении и исключении.' :
    sourceBlocked ? object(next.sources).reason || 'Источник недоступен для изменения.' : null;
  return {
    expectedRevision: text(baseline.revision),
    expectedCatalogDigest: text(baseline.catalogDigest),
    catalog: { enabled: unique(next.enabled) },
    lists: {
      include: domains(object(next.userDomains).include),
      exclude: domains(object(next.userDomains).exclude)
    },
    autohost: {
      promote: domains(autohostOps.promote),
      ignore: domains(autohostOps.ignore),
      cleanupStale: domains(autohostOps.cleanupStale)
    },
    sources: clone(sourceOps),
    applicable: blocker === null,
    blocker: blocker,
    changes: changes,
    advanced: {
      expectedRevision: text(baseline.revision),
      expectedCatalogDigest: text(baseline.catalogDigest)
    }
  };
}
return baseclass.extend({
  normalize: normalize,
  categoryState: categoryState,
  toggleAll: toggleAll,
  toggleCategory: toggleCategory,
  togglePackage: togglePackage,
  selectPackages: selectPackages,
  setDomains: setDomains,
  promoteAutohost: promoteAutohost,
  ignoreAutohost: ignoreAutohost,
  draft: draft});
