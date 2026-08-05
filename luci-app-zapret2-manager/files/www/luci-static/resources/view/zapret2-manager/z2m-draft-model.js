'use strict';
'require baseclass';

var SCOPE_ORDER = ['strategy', 'domainHub', 'dns', 'proxy', 'service-dns', 'maintenance'];
var SCOPE_LABELS = {
  strategy: 'Стратегия', domainHub: 'Сервисы и домены', dns: 'DNS', proxy: 'Telegram Proxy',
  'service-dns': 'DNS сервисов', maintenance: 'Обслуживание'
};
var SECRET_KEY = /secret|token|password|link|url/i;

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
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]);
    });
    return result;
  }
  return value;
}
function redactField(key, value) {
  return SECRET_KEY.test(String(key)) ? '••••••' : redact(value);
}
function hasChanges(changes) {
  return Array.isArray(changes) ? changes.length > 0 : Object.keys(object(changes)).length > 0;
}
function knownScope(scope) { return SCOPE_ORDER.indexOf(String(scope)) >= 0; }
function firstDefined(values) {
  for (var i = 0; i < values.length; i++)
    if (values[i] !== undefined && values[i] !== null && values[i] !== '') return values[i];
  return null;
}
function scopeValue(value) { return value && typeof value === 'object' ? value : {}; }
function normalizedChanges(value) {
  if (value && Object.prototype.hasOwnProperty.call(value, 'changes')) return clone(value.changes);
  return {};
}
function normalizeScope(scope, value) {
  value = scopeValue(value);
  var changes = normalizedChanges(value);
  var hasDelta = hasChanges(changes);
  var blocker = value.blocker || null;
  var applicable = hasDelta && value.applicable !== false;
  if (!knownScope(scope)) {
    applicable = false;
    blocker = 'Unsupported scope: ' + String(scope);
  } else if (!hasDelta) {
    applicable = false;
  } else if (value.applicable === false && !blocker) {
    blocker = 'Scope is unavailable';
  }
  return {
    scope: String(scope), changes: changes, applicable: applicable,
    blocker: blocker, revision: firstDefined([
      value.revision, value.expectedRevision, object(value.precondition).revision
    ]), advanced: redact(value.advanced || {})
  };
}
function draftEntries(draft) {
  var entries = {};
  if (Array.isArray(draft)) {
    draft.forEach(function (item) {
      if (item && item.scope) entries[String(item.scope)] = item;
    });
  } else {
    Object.keys(object(draft)).forEach(function (scope) { entries[scope] = draft[scope]; });
  }
  return entries;
}
function orderedScopes(entries) {
  var result = SCOPE_ORDER.filter(function (scope) {
    return Object.prototype.hasOwnProperty.call(entries, scope);
  });
  Object.keys(entries).sort().forEach(function (scope) {
    if (result.indexOf(scope) < 0) result.push(scope);
  });
  return result;
}
function equal(left, right) {
  return JSON.stringify(clone(left)) === JSON.stringify(clone(right));
}
function appliedValue(applied, key) {
  if (Object.prototype.hasOwnProperty.call(object(applied), key)) return applied[key];
  return undefined;
}
function semanticRows(entry, applied) {
  var changes = normalizedChanges(entry);
  var rows = [];
  Object.keys(object(changes)).forEach(function (key) {
    var change = changes[key];
    var before = appliedValue(applied, key);
    var after = change;
    var label = key;
    if (change && typeof change === 'object' && !Array.isArray(change)) {
      label = change.label || key;
      if (Object.prototype.hasOwnProperty.call(change, 'before')) before = change.before;
      if (Object.prototype.hasOwnProperty.call(change, 'after')) after = change.after;
    }
    if (!equal(before, after)) rows.push({
      key: key, label: label, before: redactField(key, before), after: redactField(key, after)
    });
  });
  return rows;
}
function semanticDiff(draft, applied) {
  var entries = draftEntries(draft);
  var appliedScopes = object(applied);
  return orderedScopes(entries).map(function (scope) {
    var entry = normalizeScope(scope, entries[scope]);
    var rows = semanticRows(entries[scope], appliedScopes[scope]);
    if (!rows.length && !entry.blocker) return null;
    return {
      scope: scope, label: SCOPE_LABELS[scope] || scope, rows: rows,
      applicable: entry.applicable, blocker: entry.blocker
    };
  }).filter(function (group) { return group !== null; });
}
function applyAvailability(scopes) {
  var values = Array.isArray(scopes) ? scopes : Object.keys(object(scopes)).map(function (scope) {
    return normalizeScope(scope, scopes[scope]);
  });
  var blockers = [];
  var active = false;
  values.forEach(function (scope) {
    var entry = scope && typeof scope === 'object'
      ? normalizeScope(scope.scope, scope) : normalizeScope(scope, {});
    if (hasChanges(entry.changes)) active = true;
    if (!entry.applicable || entry.blocker) {
      if (entry.blocker) blockers.push(String(entry.blocker));
      else if (hasChanges(entry.changes)) blockers.push(String(entry.scope) + ': unavailable');
    }
  });
  return {
    enabled: active && blockers.length === 0,
    reason: blockers[0] || (active ? null : 'Нет изменений'), blockers: blockers
  };
}
function failedEntries(result) {
  result = object(result);
  var failures = array(result.failures).slice();
  array(result.failedScopes).forEach(function (scope) {
    if (!failures.some(function (item) { return (item && item.scope) === scope; }))
      failures.push({ scope: scope, error: result.errors && result.errors[scope] });
  });
  return failures;
}
function recordApplyResult(draft, result) {
  result = object(result);
  var failures = failedEntries(result);
  var failedScopes = failures.map(function (item) { return String(item && item.scope || item); });
  var successes = array(result.successes).concat(array(result.appliedScopes)).map(String).filter(function (scope, index, list) {
    return list.indexOf(scope) === index && failedScopes.indexOf(scope) < 0;
  });
  var nextDraft = clone(object(draft));
  successes.forEach(function (scope) { delete nextDraft[scope]; });
  var errors = failures.map(function (item) {
    var error = item && item.error !== undefined ? item.error : item;
    error = object(error);
    return {
      scope: String(item && item.scope || ''),
      code: error.code || null,
      message: error.message || String(item && item.error || error || 'Apply failed')
    };
  });
  var bookkeeping = { draft: nextDraft, clearedScopes: successes, failedScopes: failedScopes, errors: errors };
  var rollbacks = array(result.rollbacks).filter(function (item) {
    return item && item.scope && item.available === true;
  }).map(clone);
  if (!rollbacks.length && result.rollback && result.rollback.scope && result.rollback.available === true)
    rollbacks = [clone(result.rollback)];
  if (rollbacks.length) {
    bookkeeping.rollbacks = rollbacks;
    if (rollbacks.length === 1) bookkeeping.rollback = rollbacks[0];
  }
  return bookkeeping;
}

return baseclass.extend({
  normalizeScope: normalizeScope,
  semanticDiff: semanticDiff,
  redact: redact,
  applyAvailability: applyAvailability,
  recordApplyResult: recordApplyResult
});
