'use strict';
'require baseclass';

var SECRET_KEY = /secret|token|password|link|url/i;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]);
    });
    return result;
  }
  if (typeof value === 'string' && (/tg:\/\//i.test(value) || /t\.me\/proxy/i.test(value))) return '••••••';
  return value;
}

function normalizeError(error) {
  if (error === null || error === undefined) {
    return { code: 'EUNKNOWN', message: _('Неизвестная ошибка'), details: null };
  }
  if (typeof error === 'string') return { code: 'EUNKNOWN', message: error, details: null };

  var envelope = object(error);
  var value = envelope.error !== undefined ? envelope.error : envelope;
  if (typeof value === 'string') {
    return { code: envelope.code || 'EUNKNOWN', message: value, details: null };
  }

  value = object(value);
  return {
    code: value.code || envelope.code || 'EUNKNOWN',
    message: value.message || envelope.message || value.detail || envelope.detail || _('Неизвестная ошибка'),
    details: value.details !== undefined ? redact(value.details) : envelope.details !== undefined ? redact(envelope.details) : null
  };
}

function createStore(initial) {
  var state = Object.assign({}, object(initial));
  var listeners = [];

  return {
    get: function () { return state; },
    update: function (patch) {
      state = Object.assign({}, state, object(patch));
      listeners.slice().forEach(function (listener) { listener(state); });
      return state;
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }
  };
}

function operationFrom(kind, title, response) {
  response = object(response);
  return {
    operationId: response.operationId || response.id || null,
    kind: kind,
    title: title,
    state: response.state || 'running',
    phase: response.phase || null,
    current: clone(object(response.current)),
    events: clone(Array.isArray(response.events) ? response.events : []),
    warnings: clone(Array.isArray(response.warnings) ? response.warnings : []),
    result: response.result !== undefined ? redact(clone(response.result)) : null,
    error: response.error !== undefined && response.error !== null ? normalizeError(response.error) : null,
    controls: clone(object(response.controls))
  };
}

return baseclass.extend({
  createStore: createStore,
  normalizeError: normalizeError,
  redact: redact,
  operationFrom: operationFrom
});
