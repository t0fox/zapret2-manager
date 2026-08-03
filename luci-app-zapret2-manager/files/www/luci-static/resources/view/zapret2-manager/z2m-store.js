'use strict';
'require baseclass';

function create(initial) {
  var state = Object.assign({
    server: {}, draft: {}, pending: {}, applied: {}, jobs: {},
    ui: { tab: 'overview', advanced: false, modal: null }
  }, initial || {});
  var listeners = [];

  function emit() { listeners.slice().forEach(function (fn) { fn(state); }); }

  return {
    get: function () { return state; },
    update: function (patch) { state = Object.assign({}, state, patch || {}); emit(); return state; },
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
    hasDraft: function () { return Object.keys(state.draft || {}).length > 0; },
    subscribe: function (fn) {
      if (typeof fn !== 'function') throw new TypeError('subscriber must be a function');
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
    }
  };
}

return baseclass.extend({ create: create });
