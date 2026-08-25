'use strict';
'require baseclass';

function create(initial) {
  var state = Object.assign({
    server: {},
    ui: { tab: 'overview', advanced: false, modal: null }
  }, initial || {});
  var listeners = [];

  function emit() { listeners.slice().forEach(function (fn) { fn(state); }); }

  return {
    get: function () { return state; },
    update: function (patch) { state = Object.assign({}, state, patch || {}); emit(); return state; },
    subscribe: function (fn) {
      if (typeof fn !== 'function') throw new TypeError('subscriber must be a function');
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
    }
  };
}

return baseclass.extend({ create: create });
