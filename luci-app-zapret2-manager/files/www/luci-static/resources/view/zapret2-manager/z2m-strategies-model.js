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
function normalize(value, status, selectedId) {
  value = object(value);
  var ids = identity(status);
  var id = text(value.id || value.strategyId);
  var origin = text(value.origin) || (value.is_builtin === true ? 'avatar_builtin' : 'user');
  var metadata = object(value.metadata), label = text(value.label || metadata.label).toLowerCase();
  var argsText = profileText(value);
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
    circular: value.circular === true || metadata.circular === true || /(^|\s)--lua-desync=circular(?:[:=]|\s|$)/i.test(argsText),
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
function visibleReason(value) { return value && value.reasonCode ? '' : ''; }
function classifyUnsupported(action) {
  return action === 'healthcheck' || action === 'autocircular' ? 'BACKEND_NOT_READY' : 'INTENTIONAL_Z2M_DIFFERENCE';
}
return baseclass.extend({
  normalize: normalize,
  list: list,
  profiles: profiles,
  profilePortTags: profilePortTags,
  strategyProfileTags: strategyProfileTags,
  identity: identity,
  stateLabel: stateLabel,
  actionCopy: actionCopy,
  canMutate: canMutate,
  visibleReason: visibleReason,
  classifyUnsupported: classifyUnsupported,
  looksLikeStrategy: looksLikeStrategy,
  parseClipboardStrategies: parseClipboardStrategies,
  combineStrategies: combineStrategies
});
