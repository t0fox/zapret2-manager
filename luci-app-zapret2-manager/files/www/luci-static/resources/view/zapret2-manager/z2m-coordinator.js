'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-draft-model as DraftModel';

var APPLY_SCOPE_ORDER = ['strategy', 'domainHub', 'dns', 'proxy'];

function array(value) { return Array.isArray(value) ? value : []; }
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
function same(left, right) { return JSON.stringify(left || {}) === JSON.stringify(right || {}); }
function orderedScopes(snapshot) {
  var keys = Object.keys(object(snapshot));
  var result = APPLY_SCOPE_ORDER.filter(function (scope) { return keys.indexOf(scope) >= 0; });
  keys.sort().forEach(function (scope) { if (result.indexOf(scope) < 0) result.push(scope); });
  return result;
}
function sequence(scopes, fn) {
  return scopes.reduce(function (chain, scope) {
    return chain.then(function () { return fn(scope); });
  }, Promise.resolve());
}
function responseMessage(value, fallback) {
  var error = value && value.error !== undefined ? value.error : value;
  if (error && typeof error === 'object') return error.message || error.detail || error.code || fallback;
  return error ? String(error) : fallback;
}
function responseFailure(value, fallbackCode, fallbackMessage) {
  if (value && value.ok === true) {
    var errors = array(value.errors).concat(array(value.blockers));
    if (!errors.length) return null;
    value = errors[0];
  }
  var error = value && value.error !== undefined ? value.error : value;
  if (error && typeof error === 'object') return {
    code: error.code || value && value.code || fallbackCode,
    message: error.message || error.detail || error.code || fallbackMessage
  };
  return { code: value && value.code || fallbackCode, message: error ? String(error) : fallbackMessage };
}
function responseBlocker(value, fallback) {
  var failure = responseFailure(value, 'preflight-blocked', fallback);
  return failure ? failure.message : null;
}
function previewRevision(preview) {
  var precondition = object(preview && preview.precondition);
  if (precondition.revision !== null && precondition.revision !== undefined) return precondition.revision;
  if (precondition.appliedRevision !== null && precondition.appliedRevision !== undefined) return precondition.appliedRevision;
  if (precondition.ledgerRevision !== null && precondition.ledgerRevision !== undefined) return precondition.ledgerRevision;
  return null;
}

function create(options) {
  options = options || {};
  var api = options.api || {};
  var store = options.store;
  var shell = options.shell || { showToast: function () {} };
  var adapters = options.adapters || {};
  var root = options.root || null;

  function normalize(error) {
    if (api && typeof api.normalizeError === 'function') return api.normalizeError(error);
    var value = error && error.error && typeof error.error === 'object' ? error.error : error;
    return { code: value && value.code || 'error', message: value && value.message || String(value || 'Unknown error') };
  }
  function contextFor(context) {
    context = context || {};
    context.api = context.api || api;
    context.store = context.store || store;
    context.shell = context.shell || shell;
    context.root = context.root || root;
    context.applied = context.applied || clone(store.get().applied || {});
    context.previews = context.previews || {};
    return context;
  }
  function availability(draft) {
    draft = draft || store.get().draft || {};
    var scopes = orderedScopes(draft);
    var model = DraftModel.applyAvailability(scopes.map(function (scope) {
      return Object.assign({ scope: scope }, object(draft[scope]));
    }));
    var blockers = model.blockers.slice();
    scopes.forEach(function (scope) {
      if (!adapters[scope] || adapters[scope].supported !== true) {
        var message = 'Unsupported scope: ' + scope;
        if (blockers.indexOf(message) < 0) blockers.push(message);
      }
    });
    var coordinator = object(store.get().coordinator);
    var preflight = object(coordinator.preflight);
    var current = (coordinator.status === 'ready' || coordinator.status === 'blocked') && same(preflight.snapshot, draft);
    if (current) array(preflight.blockers).forEach(function (blocker) {
      if (blockers.indexOf(blocker) < 0) blockers.push(blocker);
    });
    return {
      enabled: coordinator.status === 'ready' && current && scopes.length > 0 && blockers.length === 0,
      reason: blockers[0] || (current ? model.reason : 'Ожидается предварительная проверка.'),
      blockers: blockers
    };
  }
  function stageError(states, scope, error) {
    var normalized = normalize(error);
    states[scope] = states[scope] || {};
    states[scope].error = normalized;
    states[scope].blocker = normalized.code && normalized.code !== 'error'
      ? normalized.code + ': ' + normalized.message : normalized.message;
  }
  function checkPreview(scope, draft, read, preview, adapter) {
    if (!preview || preview.ok !== true)
      return responseFailure(preview, 'E_PREVIEW', 'Предпросмотр недоступен.');
    if (adapter && typeof adapter.previewValid === 'function' && adapter.previewValid(preview) !== true)
      return { code: 'E_PRECONDITION_MISMATCH', message: 'Предпросмотр не содержит допустимой precondition.' };
    var revision = previewRevision(preview);
    if (revision === null)
      return { code: 'E_PRECONDITION_MISMATCH', message: 'Предпросмотр не содержит ревизию precondition.' };
    var expected = DraftModel.normalizeScope(scope, draft).revision;
    if (read && read.revision !== null && read.revision !== undefined && String(revision) !== String(read.revision))
      return { code: 'E_PRECONDITION_MISMATCH', message: 'Preview revision отличается от backend reread.' };
    if (expected !== null && expected !== undefined && String(revision) !== String(expected))
      return { code: 'E_PRECONDITION_MISMATCH', message: 'Preview revision отличается от revision черновика.' };
    if (scope === 'domainHub') {
      var precondition = object(preview.precondition);
      var actualDigest = precondition.catalogDigest;
      var expectedDigest = draft.expectedCatalogDigest;
      if (expectedDigest && actualDigest !== expectedDigest)
        return { code: 'E_PRECONDITION_MISMATCH', message: 'Preview catalog digest отличается от черновика.' };
      var expectedFile = object(draft.precondition).fileSha256;
      if (expectedFile && precondition.fileSha256 !== expectedFile)
        return { code: 'E_PRECONDITION_MISMATCH', message: 'Preview fileSha256 отличается от черновика.' };
    }
    return null;
  }
  function preflightDraft(snapshot, context) {
    snapshot = snapshot || store.snapshotDraft();
    context = contextFor(context);
    var scopes = orderedScopes(snapshot);
    var states = {};
    scopes.forEach(function (scope) {
      var entry = DraftModel.normalizeScope(scope, snapshot[scope]);
      states[scope] = { value: snapshot[scope], entry: entry };
      if (entry.blocker) states[scope].blocker = entry.blocker;
      else if (!entry.applicable) states[scope].blocker = 'Нет применимых изменений.';
      if (!adapters[scope] || adapters[scope].supported !== true) states[scope].blocker = 'Unsupported scope: ' + scope;
    });
    store.setCoordinator({ status: 'preflighting', preflight: null, availability: { enabled: false, reason: 'Ожидается предварительная проверка.', blockers: [] } });

    return sequence(scopes, function (scope) {
      var adapter = adapters[scope];
      if (!adapter || adapter.supported !== true) return;
      return Promise.resolve(adapter.reloadAppliedState(context)).then(function (read) {
        states[scope].read = read || {};
        context.applied[scope] = read && read.value || {};
        if (!read || read.revision === null || read.revision === undefined) {
          var missingRevision = { code: 'E_REVISION_UNAVAILABLE', message: 'Ревизия backend недоступна.' };
          states[scope].error = states[scope].error || missingRevision;
          states[scope].blocker = states[scope].blocker || missingRevision.code + ': ' + missingRevision.message;
        }
        var expected = states[scope].entry.revision;
        if (expected !== null && expected !== undefined && read && read.revision !== null && read.revision !== undefined &&
            String(expected) !== String(read.revision)) {
          states[scope].error = { code: 'E_REVISION_CONFLICT', message: 'Revision conflict: backend state изменился.' };
          states[scope].blocker = states[scope].error.code + ': ' + states[scope].error.message;
        }
      }).catch(function (error) { stageError(states, scope, error); });
    }).then(function () {
      return sequence(scopes, function (scope) {
        var adapter = adapters[scope];
        if (!adapter || adapter.supported !== true || states[scope].blocker) return;
        return Promise.resolve(adapter.validateDraft(scope, snapshot[scope], context)).then(function (answer) {
          var failure = responseFailure(answer, 'E_VALIDATION', 'Локальная проверка не пройдена.');
          if (failure) {
            states[scope].error = failure;
            states[scope].blocker = failure.code + ': ' + failure.message;
          } else states[scope].validation = answer;
        }).catch(function (error) { stageError(states, scope, error); });
      });
    }).then(function () {
      return sequence(scopes, function (scope) {
        var adapter = adapters[scope];
        if (!adapter || adapter.supported !== true || states[scope].blocker) return;
        return Promise.resolve(adapter.previewDraft(scope, snapshot[scope], context)).then(function (answer) {
          var failure = checkPreview(scope, snapshot[scope], states[scope].read, answer, adapter);
          if (failure) {
            states[scope].error = failure;
            states[scope].blocker = failure.code + ': ' + failure.message;
          } else {
            states[scope].preview = answer;
            context.previews[scope] = answer;
          }
        }).catch(function (error) { stageError(states, scope, error); });
      });
    }).then(function () {
      var blockers = scopes.filter(function (scope) { return !!states[scope].blocker; }).map(function (scope) {
        return scope + ': ' + states[scope].blocker;
      });
      var preflight = { snapshot: clone(snapshot), scopes: scopes, states: states, blockers: blockers };
      store.setCoordinator({
        status: blockers.length ? 'blocked' : 'ready',
        preflight: preflight,
        availability: {
          enabled: blockers.length === 0 && scopes.length > 0,
          reason: blockers[0] || null,
          blockers: blockers
        }
      });
      return preflight;
    });
  }
  function proofFrom(scope, adapter, answer, context) {
    if (adapter && typeof adapter.rollbackProof === 'function') {
      var proof = adapter.rollbackProof(answer, context);
      if (proof && proof.available === true) return Object.assign({ scope: scope }, proof);
    }
    var rollback = object(answer && answer.rollback);
    if (rollback.available === true && (rollback.snapshotId || rollback.snapshot || rollback.revision || rollback.expectedRevision)) {
      return {
        scope: scope,
        available: true,
        snapshot: rollback.snapshotId || rollback.snapshot || null,
        revision: rollback.expectedRevision !== undefined ? rollback.expectedRevision : rollback.revision
      };
    }
    return null;
  }
  function mutationError(answer) {
    if (!answer || answer.ok !== true) return {
      code: answer && answer.error && answer.error.code || answer && answer.code || 'apply-rejected',
      message: responseMessage(answer, 'Backend не подтвердил применение.')
    };
    return null;
  }
  function handleApplyResult(outcomes) {
    var applied = DraftModel.recordApplyResult(outcomes.snapshot, outcomes);
    store.update({ draft: applied.draft });
    applied.clearedScopes.forEach(function (scope) {
      if (adapters[scope] && typeof adapters[scope].resetDraft === 'function') adapters[scope].resetDraft();
    });
    store.setCoordinator({
      status: applied.failedScopes.length ? 'partial' : 'idle',
      preflight: null,
      result: applied,
      availability: { enabled: false, reason: applied.failedScopes.length ? applied.errors[0].message : 'Нет изменений', blockers: [] }
    });
    return applied;
  }
  function applyDrafts(snapshot, context) {
    snapshot = snapshot || store.snapshotDraft();
    context = contextFor(context);
    return preflightDraft(snapshot, context).then(function (preflight) {
      var outcomes = { snapshot: snapshot, successes: [], failures: [], rollbacks: [] };
      if (preflight.blockers.length) {
        preflight.scopes.forEach(function (scope) {
          outcomes.failures.push({
            scope: scope,
            error: preflight.states[scope].error || { code: 'preflight-blocked', message: preflight.states[scope].blocker || 'Preflight blocked' }
          });
        });
        return handleApplyResult(outcomes);
      }
      store.setCoordinator({ status: 'applying', preflight: preflight, availability: { enabled: false, reason: 'Применение выполняется.', blockers: [] } });
      return sequence(preflight.scopes, function (scope) {
        var adapter = adapters[scope];
        var state = preflight.states[scope];
        context.preview = state.preview;
        context.previews[scope] = state.preview;
        return Promise.resolve(adapter.applyDraft(scope, snapshot[scope], state.read.revision, context)).then(function (answer) {
          var failure = mutationError(answer);
          if (failure) throw failure;
          var proof = proofFrom(scope, adapter, answer, context);
          if (proof) outcomes.rollbacks.push(proof);
          return Promise.resolve(adapter.reloadAppliedState(context)).then(function (read) {
            if (!read || read.revision === null || read.revision === undefined)
              throw { code: 'verification-failed', message: 'Проверка ревизии применённого состояния не пройдена.' };
            if (typeof adapter.verifyApplied === 'function' && adapter.verifyApplied(snapshot[scope], context, read) !== true)
              throw { code: 'verification-failed', message: 'Проверка применённого состояния не пройдена.' };
            context.applied[scope] = read.value || {};
            store.setApplied(scope, context.applied[scope]);
            outcomes.successes.push(scope);
          });
        }).catch(function (error) {
          outcomes.failures.push({ scope: scope, error: normalize(error) });
        });
      }).then(function () { return handleApplyResult(outcomes); });
    });
  }
  function rollbackResult(result, context) {
    result = object(result);
    var adapter = adapters[result.scope];
    if (!adapter || typeof adapter.rollbackResult !== 'function' || result.available !== true)
      return Promise.reject({ code: 'rollback-unavailable', message: 'Для этого результата нет безопасного отката.' });
    return Promise.resolve(adapter.rollbackResult(result, contextFor(context)));
  }
  function semanticBlockers(draft) {
    var coordinator = object(store.get().coordinator);
    var preflight = object(coordinator.preflight);
    if (!same(preflight.snapshot, draft || store.get().draft || {})) return {};
    var result = {};
    Object.keys(object(preflight.states)).forEach(function (scope) {
      if (preflight.states[scope].blocker) result[scope] = preflight.states[scope].blocker;
    });
    return result;
  }

  return {
    availability: availability,
    semanticBlockers: semanticBlockers,
    preflightDraft: preflightDraft,
    applyDrafts: applyDrafts,
    handleApplyResult: handleApplyResult,
    rollbackResult: rollbackResult,
    order: APPLY_SCOPE_ORDER.slice()
  };
}

return baseclass.extend({
  APPLY_SCOPE_ORDER: APPLY_SCOPE_ORDER,
  create: create
});
