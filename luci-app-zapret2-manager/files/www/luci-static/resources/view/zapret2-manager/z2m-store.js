'use strict';
'require baseclass';

function create(initial) {
  var state = Object.assign({
    server: {}, draft: {}, pending: {}, applied: {}, jobs: {},
    coordinator: { status: 'idle', availability: { enabled: false, reason: 'Нет изменений', blockers: [] } },
    ui: { tab: 'overview', advanced: false, modal: null }
  }, initial || {});
  var listeners = [];

  function emit() { listeners.slice().forEach(function (fn) { fn(state); }); }
  function snapshot(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(snapshot);
    if (typeof value === 'object') {
      var result = {};
      Object.keys(value).forEach(function (key) { result[key] = snapshot(value[key]); });
      return result;
    }
    return value;
  }

  return {
    get: function () { return state; },
    update: function (patch) { state = Object.assign({}, state, patch || {}); emit(); return state; },
    snapshotDraft: function () { return snapshot(state.draft || {}); },
    setCoordinator: function (patch) {
      state = Object.assign({}, state, { coordinator: Object.assign({}, state.coordinator, patch || {}) });
      emit();
      return state.coordinator;
    },
    setApplied: function (scope, value) {
      state = Object.assign({}, state, { applied: Object.assign({}, state.applied || {}) });
      state.applied[scope] = snapshot(value);
      emit();
      return state.applied;
    },
    setDraft: function (scope, value) {
      state = Object.assign({}, state, { draft: Object.assign({}, state.draft) });
      state.draft[scope] = value;
      emit();
    },
    clearDraft: function (scope) {
      state = Object.assign({}, state, { draft: Object.assign({}, state.draft) });
      delete state.draft[scope];
      emit();
    },
    clearAllDrafts: function () {
      state = Object.assign({}, state, { draft: {} });
      emit();
    },
    subscribe: function (fn) {
      if (typeof fn !== 'function') throw new TypeError('subscriber must be a function');
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
    }
  };
}

return baseclass.extend({ create: create });
