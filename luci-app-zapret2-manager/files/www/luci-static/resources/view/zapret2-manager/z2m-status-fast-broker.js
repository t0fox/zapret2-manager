'use strict';
'require baseclass';

var DEFAULT_FRESHNESS_MS = 1500;

function create(options) {
  options = options || {};
  var read = options.read;
  var now = options.now || function () { return Date.now(); };
  var freshnessMs = Math.max(250, Number(options.freshnessMs) || DEFAULT_FRESHNESS_MS);
  var cached = null;
  var cachedAt = 0;
  var inflight = null;

  function get(requestOptions) {
    requestOptions = requestOptions || {};
    var forceFresh = requestOptions.forceFresh === true;
    if (!forceFresh && cached !== null && now() - cachedAt < freshnessMs) return Promise.resolve(cached);
    // A forceFresh caller may join the already authoritative request. This
    // keeps Header/Dashboard/Control/Strategies single-flight during a burst.
    if (inflight) return inflight;
    if (typeof read !== 'function') return Promise.reject({ code: 'status-fast-unavailable', message: 'status_fast unavailable' });
    inflight = Promise.resolve().then(function () { return read(); }).then(function (value) {
      cached = value || {};
      cachedAt = now();
      return cached;
    }).then(function (value) {
      inflight = null;
      return value;
    }, function (error) {
      inflight = null;
      throw error;
    });
    return inflight;
  }

  function clear() {
    cached = null;
    cachedAt = 0;
  }

  return { get: get, clear: clear, freshnessMs: freshnessMs };
}

return baseclass.extend({ create: create, DEFAULT_FRESHNESS_MS: DEFAULT_FRESHNESS_MS });
