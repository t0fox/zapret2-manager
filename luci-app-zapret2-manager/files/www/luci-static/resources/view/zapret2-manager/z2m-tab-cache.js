'use strict';
'require baseclass';

var DEFAULT_TTLS = {
  dashboard: 10000,
  strategies: 15000,
  lists: 30000,
  hostlists: 30000,
  'dns-routing': 20000,
  'telegram-tunnel': 12000,
  ipsets: 30000,
  blobs: 30000,
  lua: 30000,
  hosts: 30000,
  updates: 20000,
  zapret: 20000,
  autostart: 20000,
  settings: 20000
};

function create(options) {
  options = options || {};
  var now = typeof options.now === 'function' ? options.now : function () { return Date.now(); };
  var ttls = Object.assign({}, DEFAULT_TTLS, options.ttls || {});
  var entries = {};
  var inflight = {};
  var generation = 0;
  var epoch = 0;

  function ttl(tab) { return Number(ttls[tab]) > 0 ? Number(ttls[tab]) : 0; }
  function get(tab) {
    var entry = entries[tab];
    if (!entry || ttl(tab) <= 0 || now() - entry.timestamp >= ttl(tab)) return null;
    return { fresh: true, data: entry.data, generation: entry.generation };
  }
  function getStale(tab) {
    var entry = entries[tab];
    if (!entry || ttl(tab) <= 0) return null;
    return { fresh: now() - entry.timestamp < ttl(tab), data: entry.data, generation: entry.generation };
  }
  function load(tab, loader, options) {
    options = options || {};
    var fresh = options.bypass === true ? null : get(tab);
    if (fresh) return Promise.resolve(fresh.data);
    if (inflight[tab] && inflight[tab].epoch === epoch) return inflight[tab].promise;
    var loadEpoch = epoch;
    var started;
    try { started = loader(); } catch (error) { return Promise.reject(error); }
    var request = { epoch: loadEpoch, promise: null };
    request.promise = Promise.resolve(started).then(function (data) {
      var value = data || {};
      // An invalidated response must not repopulate the cache. Active pages
      // use TTL 0 and are never stored.
      if (loadEpoch === epoch && ttl(tab) > 0)
        entries[tab] = { data: value, timestamp: now(), generation: ++generation };
      return value;
    }).then(function (value) {
      if (inflight[tab] === request) delete inflight[tab];
      return value;
    }, function (error) {
      if (inflight[tab] === request) delete inflight[tab];
      throw error;
    });
    inflight[tab] = request;
    return request.promise;
  }
  function invalidate(tab) {
    epoch++;
    if (tab) delete entries[tab];
    else entries = {};
    inflight = {};
  }
  function setSession(sessionKey) {
    if (setSession.current !== sessionKey) {
      setSession.current = sessionKey;
      invalidate();
    }
  }
  setSession.current = options.sessionKey || null;
  return { get: get, getStale: getStale, load: load, invalidate: invalidate, invalidateAll: invalidate, setSession: setSession,
    ttl: ttl, defaults: Object.assign({}, DEFAULT_TTLS) };
}

return baseclass.extend({ create: create, DEFAULT_TTLS: DEFAULT_TTLS });
