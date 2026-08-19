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
  var mode = text(entry.mode) === 'frozen' ? 'frozen' : 'auto';

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

function strategyOptionsForPool(poolKey, currentStrategy, pools) {
  pools = object(pools);
  var pool = pools[poolKey] || pools[text(poolKey)] || null;
  if (!pool && (poolKey === 'circular_1_1' || poolKey === 'default' || poolKey === 'rkn_tcp')) {
    pool = pools['circular_1_1'] || pools['default'] || pools['rkn_tcp'] || null;
  }
  if (!pool && (poolKey === 'discord_voice' || poolKey === 'discord_udp')) {
    pool = pools['discord_voice'] || pools['discord_udp'] || null;
  }
  var poolSize = 0;
  var stratsMap = {};
  if (typeof pool === 'number') {
    poolSize = pool;
  } else if (pool && typeof pool === 'object') {
    poolSize = Number(pool.size || pool.max || (Array.isArray(pool.strategies) ? pool.strategies.length : 0)) || 0;
    if (Array.isArray(pool.strategies)) {
      pool.strategies.forEach(function (s) {
        if (s && s.index !== undefined) {
          stratsMap[s.index] = s;
        }
      });
      if (pool.strategies.length > poolSize) poolSize = pool.strategies.length;
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
      sName = (i === 1) ? 'Default v2 (circular)' : ('Strategy #' + i);
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

function resolveStrategyName(poolKey, currentStrategy, pools) {
  pools = object(pools);
  var pool = pools[poolKey] || pools[text(poolKey)] || null;
  if (!pool && (poolKey === 'circular_1_1' || poolKey === 'default' || poolKey === 'rkn_tcp')) {
    pool = pools['circular_1_1'] || pools['default'] || pools['rkn_tcp'] || null;
  }
  if (!pool && (poolKey === 'discord_voice' || poolKey === 'discord_udp')) {
    pool = pools['discord_voice'] || pools['discord_udp'] || null;
  }

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

  if (curNum === 1) return 'Default v2 (circular)';
  return 'Стратегия #' + curNum;
}

function modeBadge(mode) {
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
    label: 'Авто',
    icon: 'unlock',
    tooltip: 'Стратегия управляется autocircular автоматически. Нажмите, чтобы зафиксировать',
    ariaLabel: 'Зафиксировать текущую стратегию'
  };
}

return baseclass.extend({
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
