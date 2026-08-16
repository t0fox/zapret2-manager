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
    return {
      id: text(profile.id || profile.profileId) || 'profile-' + String(index + 1),
      name: text(profile.name || profile.label) || 'Профиль ' + String(index + 1),
      args: String(profile.args !== undefined ? profile.args : profile.opt || profile.raw || ''),
      argsTruncated: profile.argsTruncated === true,
      enabled: profile.enabled !== false,
      revision: profile.revision
    };
  });
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
