'use strict';
'require baseclass';

/* P03 model boundary: donor card semantics over canonical Z2M Strategy data. */
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
function unwrap(value) {
  value = object(value);
  return object(value.value || value);
}
function identity(status) {
  status = unwrap(status);
  var strategyStatus = object(status.strategyStatus);
  var runtime = object(status.runtimeSummary);
  var selected = object(status.selectedStrategy || status.selected || object(status.strategyState).selected);
  var applied = object(status.appliedStrategy || status.applied || status.strategy);
  var selectedId = text(selected.id || selected.strategyId || selected.selectedId || strategyStatus.selectedId);
  var appliedId = text(applied.id || applied.strategyId || strategyStatus.appliedId);
  var currentId = text(runtime.strategyId || runtime.strategy_id || status.currentStrategyId);
  var statusId = text(strategyStatus.id || strategyStatus.strategyId);
  return {
    selectedId: selectedId || statusId,
    appliedId: appliedId || statusId,
    currentId: currentId || statusId,
    status: strategyStatus
  };
}
function profiles(value) {
  return array(object(value).profiles).map(function (profile, index) {
    profile = object(profile);
    var filters = object(profile.filters);
    return {
      id: text(profile.id || profile.profileId) || 'profile-' + String(index + 1),
      name: text(profile.name || profile.label) || 'Профиль ' + String(index + 1),
      args: String(profile.args !== undefined ? profile.args : profile.opt || profile.raw || ''),
      argsTruncated: profile.argsTruncated === true,
      enabled: profile.enabled !== false,
      revision: profile.revision,
      protocol: text(profile.protocol),
      tcpPorts: text(profile.tcpPorts || filters.tcpPorts),
      udpPorts: text(profile.udpPorts || filters.udpPorts),
      filters: filters
    };
  });
}
function validPortList(value) {
  value = text(value);
  var match = value.match(/^([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)\b/);
  return match ? match[1] : '';
}
function pushPortTag(result, protocol, ports) {
  protocol = text(protocol).toLowerCase();
  ports = validPortList(ports);
  if ((protocol !== 'tcp' && protocol !== 'udp') || !ports) return;
  var label = protocol.toUpperCase() + ' (порты ' + ports + ')';
  if (!result.some(function (item) { return item.label === label; })) {
    result.push({ label: label, kind: 'protocol-port', protocol: protocol, ports: ports });
  }
}
function profilePortTags(profile) {
  profile = object(profile);
  var result = [], filters = object(profile.filters);
  pushPortTag(result, 'tcp', profile.tcpPorts || filters.tcpPorts);
  pushPortTag(result, 'udp', profile.udpPorts || filters.udpPorts);
  var args = text(profile.args), match;
  var filterPattern = /(?:^|\s)--filter-(tcp|udp)=([^\s]+)/g;
  while ((match = filterPattern.exec(args)) !== null) pushPortTag(result, match[1], match[2]);
  return result;
}
function isGeneratedProfileName(value) {
  return /^(?:profile|профиль)\s+\d+$/i.test(text(value));
}
function strategyProfileTags(strategy) {
  strategy = object(strategy);
  var result = [], hasFallbackProtocol = false;
  array(strategy.profiles).forEach(function (profile) {
    profile = object(profile);
    var portTags = profilePortTags(profile);
    if (portTags.length) {
      portTags.forEach(function (tag) {
        var existing = result.find(function (item) { return item.label === tag.label; });
        if (existing) {
          existing.enabled = existing.enabled || profile.enabled !== false;
          return;
        }
        result.push({ label: tag.label, kind: tag.kind, protocol: tag.protocol, ports: tag.ports, enabled: profile.enabled !== false });
      });
      return;
    }
    var protocol = text(profile.protocol || strategy.protocol).toLowerCase();
    if (protocol && !hasFallbackProtocol) {
      result.push({ label: protocol.toUpperCase(), kind: 'protocol', protocol: protocol, enabled: profile.enabled !== false });
      hasFallbackProtocol = true;
    }
    var profileName = text(profile.name);
    if (profileName && !isGeneratedProfileName(profileName))
      result.push({ label: profileName, kind: 'profile', protocol: protocol, enabled: profile.enabled !== false });
  });
  if (!result.length && text(strategy.protocol)) {
    var fallback = text(strategy.protocol).toLowerCase();
    result.push({ label: fallback.toUpperCase(), kind: 'protocol', protocol: fallback, enabled: true });
  }
  return result;
}
function profileText(value) {
  return profiles(value).map(function (profile) { return profile.args || ''; }).join('\n');
}
function looksLikeStrategy(value) {
  var source = text(value);
  return /(^|\s)--(?:filter-|lua-desync=|payload=|hostlist=|ipset=|new(?:\s|$))/i.test(source);
}
function parseClipboardStrategies(value) {
  var source = text(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!source) return [];
  source = source.replace(/^\s*nfqws2\??\s*[:|]?\s*/i, '');
  return source.split(/\s+--new(?:\s+|$)/i).map(function (part) {
    return text(part).trim();
  }).filter(looksLikeStrategy).map(function (args, index) {
    return { id: 'clipboard-' + String(index + 1), name: 'Импортированный профиль ' + String(index + 1), args: args, enabled: true };
  });
}
function combineStrategies(values) {
  var source = array(values), profilesList = [], names = [];
  source.forEach(function (strategy) {
    strategy = object(strategy);
    if (text(strategy.name)) names.push(text(strategy.name));
    profiles(strategy).forEach(function (profile, index) {
      profilesList.push({
        id: text(strategy.id) + '-' + text(profile.id || ('profile-' + String(index + 1))),
        name: text(profile.name) || 'Профиль ' + String(profilesList.length + 1),
        args: profile.args || '', enabled: profile.enabled !== false
      });
    });
  });
  return { id: '', name: names.join(' + ') || 'Объединённая стратегия', description: 'Объединено из: ' + names.join(', '), origin: 'user', isBuiltin: false, profiles: profilesList };
}
/**
 * Determines whether a strategy represents an autocircular strategy.
 * @param {Object} strategy - The strategy data to inspect.
 * @returns {boolean} `true` if the strategy is marked or identified as circular, `false` otherwise.
 */
function isCircularStrategy(strategy) {
  strategy = object(strategy);
  var metadata = object(strategy.metadata);
  if (strategy.circular === true || metadata.circular === true) return true;
  var argsText = profileText(strategy);
  if (/(^|\s)--lua-desync=circular(?:[:=]|\s|$)/i.test(argsText)) return true;
  var id = text(strategy.id || strategy.strategyId).toLowerCase();
  var name = text(strategy.name || strategy.displayName).toLowerCase();
  var desc = text(strategy.description || metadata.description).toLowerCase();
  if (/(?:^|[_-])(?:auto)?circular(?:[_-]|$)|(?:^|[_\s])autocircular(?:[_\s]|$)/i.test(id)) return true;
  if (/\b(?:circular|autocircular)\b/i.test(name) || /\bавто\b/i.test(name) || /\(circular\)/i.test(name)) return true;
  if (/\b(?:circular|autocircular|автоподбор)\b/i.test(desc)) return true;
  return false;
}
function humanizeLearnedEntry(entry) {
  entry = object(entry);
  var key = text(entry.key).toLowerCase();
  var strat = text(entry.strategy);
  var host = text(entry.host) || '—';
  var ts = entry.ts;

  var protocol = 'TLS';
  var protoClass = 'tls';
  if (key.indexOf('quic') >= 0) { protocol = 'QUIC'; protoClass = 'quic'; }
  else if (key.indexOf('stun') >= 0 || key.indexOf('voice') >= 0) { protocol = 'STUN'; protoClass = 'stun'; }
  else if (key.indexOf('http') >= 0) { protocol = 'HTTP'; protoClass = 'http'; }
  else if (key.indexOf('udp') >= 0) { protocol = 'UDP'; protoClass = 'quic'; }
  else if (key.indexOf('tcp') >= 0) { protocol = 'TLS'; protoClass = 'tls'; }

  var variantNum = strat;
  if (!variantNum && /_(\d+)$/.test(key)) {
    var match = key.match(/_(\d+)$/);
    if (match) variantNum = match[1];
  }
  var vNum = variantNum || '1';
  var variant = 'Вариант ' + vNum;
  var variantTooltip = 'Внутренний кандидат circular №' + vNum;
  var humanLabel = protocol + ' · ' + variant;

  var tsDisplay = '—';
  var tsNumeric = 0;
  if (ts) {
    var num = Number(ts);
    if (!isNaN(num) && num > 0) {
      if (num < 10000000000) num *= 1000;
      tsNumeric = num;
      var d = new Date(num);
      if (!isNaN(d.getTime())) {
        var day = ('0' + d.getDate()).slice(-2);
        var month = ('0' + (d.getMonth() + 1)).slice(-2);
        var hours = ('0' + d.getHours()).slice(-2);
        var mins = ('0' + d.getMinutes()).slice(-2);
        tsDisplay = day + '.' + month + ' ' + hours + ':' + mins;
      }
    } else {
      tsDisplay = String(ts);
    }
  }
  var mode = text(entry.mode) === 'frozen' || text(entry.mode) === 'excluded' ? text(entry.mode) : 'auto';

  return {
    host: host,
    protocol: protocol,
    protoClass: protoClass,
    variant: variant,
    variantNum: vNum,
    variantTooltip: variantTooltip,
    humanLabel: humanLabel,
    key: text(entry.key),
    rawStrategy: strat,
    strategy: vNum,
    mode: mode,
    frozen: mode === 'frozen',
    excluded: mode === 'excluded',
    modeLabel: mode === 'excluded' ? 'Без обхода' : mode === 'frozen' ? 'Зафиксировано' : 'Авто',
    ts: tsDisplay,
    rawTs: tsNumeric,
    tsOriginal: text(ts)
  };
}
function normalize(value, status, selectedId) {
  value = object(value);
  var ids = identity(status);
  var id = text(value.id || value.strategyId);
  var origin = text(value.origin) || (value.is_builtin === true ? 'avatar_builtin' : 'user');
  var metadata = object(value.metadata), label = text(value.label || metadata.label).toLowerCase();
  var result = {
    id: id,
    name: text(value.name || value.displayName) || id || 'Стратегия',
    description: text(value.description || metadata.description),
    author: text(value.author || metadata.author),
    protocol: text(value.protocol || metadata.protocol),
    origin: origin,
    isBuiltin: value.is_builtin === true || value.isBuiltin === true || origin === 'avatar_builtin' || origin === 'builtin',
    revision: value.revision,
    favorite: value.favorite === true || value.is_favorite === true,
    label: label,
    recommended: label === 'recommended' || /^recommended/.test(label),
    featured: value.featured === true || metadata.featured === true,
    circular: isCircularStrategy(value),
    availability: value.availability,
    profiles: profiles(value)
  };
  result.selected = text(selectedId) ? result.id === text(selectedId) : result.id === ids.selectedId;
  result.applied = result.id === ids.appliedId;
  result.current = result.id === ids.currentId;
  result.runtimeKnown = !!ids.currentId;
  return result;
}
function list(value) {
  value = unwrap(value);
  return array(value.strategies || value.items || value.list).map(function (item) { return normalize(item); });
}
function stateLabel(state) {
  return {
    loading: 'Загрузка…',
    empty: 'Стратегии не найдены',
    error: 'Не удалось загрузить стратегии',
    ready: 'Стратегии'
  }[String(state)] || 'Стратегии';
}
function actionCopy(action) {
  if (String(action) === 'apply') return {
    pending: 'Применение…',
    success: 'Стратегия применена',
    failure: 'Не удалось применить стратегию'
  };
  return { pending: 'Выполняется…', success: 'Готово', failure: 'Операция не выполнена' };
}
function canMutate(pending) { return pending !== true; }

var DEFAULT_RUNTIME_POOLS = {
  circular_1_1: {
    key: 'circular_1_1',
    protocol: 'TLS',
    size: 6,
    strategies: [
      { index: 1, name: 'Fake TLS (MD5)' },
      { index: 2, name: 'Multidisorder (midsld) + Fake (Dynamic TTL)' },
      { index: 3, name: 'Multisplit (SeqOvl) + Multisplit (host)' },
      { index: 4, name: 'Fake (Dynamic TTL) + Multidisorder (host)' },
      { index: 5, name: 'Fake TLS + Multisplit (midsld)' },
      { index: 6, name: 'Multisplit (host)' }
    ]
  },
  yt_quic: {
    key: 'yt_quic',
    protocol: 'QUIC',
    size: 9,
    strategies: [
      { index: 1, name: 'Fake QUIC (google x11)' },
      { index: 2, name: 'Fake QUIC (google x8)' },
      { index: 3, name: 'Fake QUIC (google x6)' },
      { index: 4, name: 'Fake QUIC (x3) + IPFrag' },
      { index: 5, name: 'UDPLen (+4) + Fake QUIC (x2)' },
      { index: 6, name: 'UDPLen (+8) + Fake QUIC (x2)' },
      { index: 7, name: 'UDPLen (+25) + Fake QUIC (x2)' },
      { index: 8, name: 'Fake QUIC (x6)' },
      { index: 9, name: 'UDPLen (+8) + Fake QUIC (x2)' }
    ]
  },
  discord_udp: {
    key: 'discord_udp',
    runtimeKey: 'discord_udp',
    protocol: 'STUN',
    size: 6,
    strategies: [
      { index: 1, name: 'Fake QUIC (x10)' },
      { index: 2, name: 'Fake QUIC (x3)' },
      { index: 3, name: 'Fake QUIC (x6)' },
      { index: 4, name: 'Fake QUIC (Dynamic TTL, x6)' },
      { index: 5, name: 'Fake QUIC (x4)' },
      { index: 6, name: 'Fake QUIC (x5)' }
    ]
  }
};
DEFAULT_RUNTIME_POOLS.default = DEFAULT_RUNTIME_POOLS.circular_1_1;
DEFAULT_RUNTIME_POOLS.rkn_tcp = DEFAULT_RUNTIME_POOLS.circular_1_1;
DEFAULT_RUNTIME_POOLS.discord_voice = DEFAULT_RUNTIME_POOLS.discord_udp;

function findLivePool(poolKey, pools) {
  var pKey = text(poolKey).toLowerCase();
  pools = object(pools);
  var pool = pools[poolKey] || pools[pKey] || null;
  if (!pool && (pKey === 'circular_1_1' || pKey === 'default' || pKey === 'rkn_tcp' || pKey.indexOf('circular') >= 0 || pKey.indexOf('tls') >= 0 || pKey.indexOf('tcp') >= 0)) {
    pool = pools['circular_1_1'] || pools['default'] || pools['rkn_tcp'] || null;
  }
  if (!pool && (pKey === 'yt_quic' || pKey.indexOf('quic') >= 0 || pKey.indexOf('yt') >= 0)) {
    pool = pools['yt_quic'] || null;
  }
  if (!pool && (pKey === 'discord_voice' || pKey === 'discord_udp' || pKey.indexOf('voice') >= 0 || pKey.indexOf('stun') >= 0 || pKey.indexOf('discord') >= 0)) {
    pool = pools['discord_udp'] || pools['discord_voice'] || null;
  }
  return pool;
}

function findPool(poolKey, pools) {
  var live = findLivePool(poolKey, pools);
  if (live) return live;
  var pKey = text(poolKey).toLowerCase();
  if (pKey === 'circular_1_1' || pKey === 'default' || pKey === 'rkn_tcp' || pKey.indexOf('circular') >= 0 || pKey.indexOf('tls') >= 0 || pKey.indexOf('tcp') >= 0) {
    return DEFAULT_RUNTIME_POOLS['circular_1_1'];
  }
  if (pKey === 'yt_quic' || pKey.indexOf('quic') >= 0 || pKey.indexOf('yt') >= 0) {
    return DEFAULT_RUNTIME_POOLS['yt_quic'];
  }
  if (pKey === 'discord_voice' || pKey === 'discord_udp' || pKey.indexOf('voice') >= 0 || pKey.indexOf('stun') >= 0 || pKey.indexOf('discord') >= 0) {
    return DEFAULT_RUNTIME_POOLS['discord_udp'];
  }
  return DEFAULT_RUNTIME_POOLS[poolKey] || DEFAULT_RUNTIME_POOLS[pKey] || null;
}

/**
 * Extract the Discord voice strategy state for the `nohost` entry.
 * @param {Array} entries - Runtime strategy entries to search.
 * @param {Object|Array} pools - Runtime pool definitions used to determine the active pool and size.
 * @return {Object} The strategy state, including its mode, strategy index, pool metadata, and whether an entry was found.
 */
function extractDiscordVoiceState(entries, pools) {
  entries = array(entries);
  var livePool = findLivePool('discord_udp', pools) || findLivePool('discord_voice', pools);
  var isLive = !!livePool;
  // The runtime API exposes `runtimeKey` when a legacy pool is still the
  // materialized key.  A synthetic/older pool row without that provenance is
  // only a Discord compatibility alias; keep the UI mutations on the
  // canonical live key instead of leaking the alias into the DOM.
  var liveKey = (livePool && livePool.runtimeKey) || 'discord_udp';
  var poolSize = livePool ? (livePool.size || 6) : 6;

  var found = null;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e && text(e.host).toLowerCase() === 'nohost' && text(e.key).toLowerCase() === liveKey.toLowerCase()) {
      found = e;
      break;
    }
  }
  if (!found) {
    for (var j = 0; j < entries.length; j++) {
      var le = entries[j];
      if (le && text(le.host).toLowerCase() === 'nohost' && (text(le.key).toLowerCase() === 'discord_udp' || text(le.key).toLowerCase() === 'discord_voice')) {
        found = le;
        break;
      }
    }
  }

  if (found) {
    var curStrat = Number(found.strategy || found.variantNum) || 1;
    var mode = text(found.mode) === 'frozen' || text(found.mode) === 'excluded' ? text(found.mode) : 'auto';
    if (curStrat < 1 || curStrat > poolSize) {
      curStrat = 1;
      mode = 'auto';
    }
    return {
      key: liveKey,
      host: 'nohost',
      strategy: curStrat,
      mode: mode,
      isFrozen: mode === 'frozen',
      isExcluded: mode === 'excluded',
      ts: found.ts || '',
      exists: true,
      isLive: isLive,
      runtimeKey: liveKey,
      poolSize: poolSize,
      legacyKey: text(found.key).toLowerCase() !== liveKey.toLowerCase() ? text(found.key).toLowerCase() : null
    };
  }

  return {
    key: liveKey,
    host: 'nohost',
    strategy: 1,
    mode: 'auto',
    isFrozen: false,
    isExcluded: false,
    ts: '',
    exists: false,
    isLive: isLive,
    runtimeKey: liveKey,
    poolSize: poolSize,
    legacyKey: null
  };
}

/**
 * Filters out learned entries associated with the `nohost` pseudo-host.
 * @param {Array} entries - The learned entries to filter.
 * @return {Array} The entries with `nohost` and falsy values removed.
 */
function filterDomainLearnedEntries(entries) {
  return array(entries).filter(function (entry) {
    if (!entry) return false;
    var host = text(entry.host).toLowerCase();
    return host !== 'nohost';
  });
}

/**
 * Builds selectable strategy options for a runtime strategy pool.
 * @param {string} poolKey - The pool identifier used to resolve strategy metadata.
 * @param {number|string} currentStrategy - The currently selected strategy index.
 * @param {Object} pools - Available runtime strategy pools.
 * @return {Array<Object>} Strategy options with labels, selection state, and unknown-strategy status.
 */
function strategyOptionsForPool(poolKey, currentStrategy, pools) {
  var pool = findPool(poolKey, pools);
  var poolSize = 0;
  var stratsMap = {};
  if (typeof pool === 'number') {
    poolSize = pool;
  } else if (pool && typeof pool === 'object') {
    poolSize = Number(pool.size || pool.max) || 0;
    if (Array.isArray(pool.strategies)) {
      var seen = new Set();
      pool.strategies.forEach(function (s) {
        if (s && s.index !== undefined) {
          var idx = Number(s.index) || 0;
          if (!seen.has(idx) && idx >= 1) { seen.add(idx); stratsMap[idx] = s; }
        }
      });
      // use unique-index count when no explicit size was declared
      if (seen.size > poolSize) poolSize = seen.size;
    }
  }

  var curNum = Number(currentStrategy);
  if (isNaN(curNum) || curNum < 1) curNum = 1;
  var total = Math.max(poolSize, 1);
  var options = [];

  for (var i = 1; i <= total; i++) {
    var meta = stratsMap[i];
    var sName = meta && text(meta.name);
    if (!sName) {
      sName = 'Стратегия #' + i;
    }
    var label = String(i) + ' — ' + sName;
    options.push({
      index: i,
      value: String(i),
      name: sName,
      label: label,
      selected: i === curNum,
      isUnknown: false
    });
  }

  if (curNum > total) {
    options.push({
      index: curNum,
      value: String(curNum),
      name: 'Неизвестная стратегия #' + curNum,
      label: String(curNum) + ' — Неизвестная стратегия #' + curNum,
      selected: true,
      isUnknown: true
    });
  }

  return options;
}

/**
 * Resolves the display name for a strategy in a runtime pool.
 * @param {string} poolKey - The runtime pool identifier.
 * @param {number|string} currentStrategy - The strategy index to resolve; invalid values use index 1.
 * @param {Object} pools - Runtime pool definitions to search before using default definitions.
 * @return {string} The matching strategy name or a generated label for the strategy index.
 */
function resolveStrategyName(poolKey, currentStrategy, pools) {
  var pool = findPool(poolKey, pools);
  var curNum = Number(currentStrategy);
  if (isNaN(curNum) || curNum < 1) curNum = 1;

  if (pool && typeof pool === 'object' && Array.isArray(pool.strategies)) {
    for (var i = 0; i < pool.strategies.length; i++) {
      var s = pool.strategies[i];
      if (s && Number(s.index) === curNum && text(s.name)) {
        return text(s.name);
      }
    }
  }

  // If pools is empty or missing, fall back to default runtime pools explicitly
  var fallbackPool = findPool(poolKey, DEFAULT_RUNTIME_POOLS);
  if (fallbackPool && Array.isArray(fallbackPool.strategies)) {
    for (var j = 0; j < fallbackPool.strategies.length; j++) {
      var fs = fallbackPool.strategies[j];
      if (fs && Number(fs.index) === curNum && text(fs.name)) return text(fs.name);
    }
  }

  return 'Стратегия #' + curNum;
}

function modeBadge(mode) {
  if (text(mode) === 'excluded') {
    return {
      mode: 'excluded', isFrozen: false, isExcluded: true,
      label: 'Без обхода', icon: 'ban',
      tooltip: 'Для этого ресурса DPI-обход отключён. Нажмите, чтобы включить обратно',
      ariaLabel: 'Включить обратно'
    };
  }
  var isFrozen = text(mode) === 'frozen';
  if (isFrozen) {
    return {
      mode: 'frozen',
      isFrozen: true,
      label: 'Зафиксировано',
      icon: 'lock',
      tooltip: 'Текущая стратегия зафиксирована вручную. Нажмите, чтобы вернуть автоподбор',
      ariaLabel: 'Вернуть автоматический режим'
    };
  }
  return {
    mode: 'auto',
    isFrozen: false,
    isExcluded: false,
    label: 'Авто',
    icon: 'unlock',
    tooltip: 'Стратегия управляется autocircular автоматически. Нажмите, чтобы зафиксировать',
    ariaLabel: 'Зафиксировать текущую стратегию'
  };
}

return baseclass.extend({
  DEFAULT_RUNTIME_POOLS: DEFAULT_RUNTIME_POOLS,
  findLivePool: findLivePool,
  findPool: findPool,
  extractDiscordVoiceState: extractDiscordVoiceState,
  filterDomainLearnedEntries: filterDomainLearnedEntries,
  normalize: normalize,
  list: list,
  profiles: profiles,
  strategyProfileTags: strategyProfileTags,
  identity: identity,
  stateLabel: stateLabel,
  actionCopy: actionCopy,
  canMutate: canMutate,
  parseClipboardStrategies: parseClipboardStrategies,
  combineStrategies: combineStrategies,
  isCircularStrategy: isCircularStrategy,
  humanizeLearnedEntry: humanizeLearnedEntry,
  strategyOptionsForPool: strategyOptionsForPool,
  resolveStrategyName: resolveStrategyName,
  modeBadge: modeBadge
});
