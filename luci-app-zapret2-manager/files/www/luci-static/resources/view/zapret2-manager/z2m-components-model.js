'use strict';
'require baseclass';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function first(value, fallback) {
  var result = text(value);
  return result === null ? fallback : result;
}

function managerMeta(value) {
  var versions = object(value);
  var manager = object(versions.manager || versions);
  var update = object(manager.update || manager);
  return {
    version: first(manager.version || manager.packageVersion, null),
    updateState: first(update.updateState || update.state, 'unknown'),
    updateVersion: first(update.latest || update.latestVersion || update.candidateVersion, null),
    selfUpdateAvailable: update.selfUpdateAvailable === true
  };
}

function compatibility(value, fallback) {
  var raw = String(value || '').toLowerCase();
  if (raw === 'compatible' || raw === 'confirmed' || raw === 'ok') return 'compatible';
  if (raw === 'incompatible' || raw === 'failed' || raw === 'broken') return 'incompatible';
  return fallback || 'unverified';
}

function health(value, fallback) {
  var raw = String(value || '').toLowerCase();
  if (['ready', 'missing', 'degraded', 'broken', 'checking'].indexOf(raw) >= 0) return raw;
  return fallback || 'degraded';
}

function engineHealth(status) {
  if (status.installed !== true || status.state === 'engine_missing' || status.serviceState === 'engine_missing') return 'missing';
  if (status.health) return health(status.health, 'degraded');
  if (status.serviceState === 'error' || status.compatible === false) return 'broken';
  if (status.serviceState !== 'running' || status.runtimeRunning === false) return 'degraded';
  return 'ready';
}

function engineUpdate(input, status) {
  var check = object(input.check || input.update || status.update);
  if (check.integrationRequired === true) return 'integration-required';
  if (check.updateAvailable === true || check.state === 'update-available') return 'update-available';
  if (check.updateAvailable === false || check.state === 'current') return 'current';
  return 'unknown';
}

function normalizeEngine(input) {
  input = object(input);
  var status = object(input.status || input.engine || input);
  var gate = object(input.gate || input.compatibilityGate);
  var installed = status.installed === true;
  var healthState = engineHealth(status);
  var compatible = status.compatible === false || gate.compatible === false
    ? 'incompatible'
    : (status.compatible === true || gate.compatible === true ? 'compatible' : 'unverified');
  var capabilities = object(status.capabilities);
  var capabilityReady = capabilities.ready !== undefined ? capabilities.ready : capabilities.available;
  var capabilityTotal = capabilities.total !== undefined ? capabilities.total : capabilities.required;
  var actions = {
    primary: healthState === 'missing' ? 'install' : healthState === 'broken' ? 'repair' : 'manage'
  };
  return {
    id: 'engine',
    label: 'Zapret2 Engine',
    health: healthState,
    updateState: engineUpdate(input, status),
    compatibility: compatible,
    summary: healthState === 'missing' ? 'Базовый движок обработки трафика отсутствует.' : 'Базовый движок обработки трафика.',
    version: first(status.installedRelease || status.packageVersion, null),
    actions: actions,
    counters: {
      capabilities: capabilityReady !== undefined && capabilityTotal !== undefined ? String(capabilityReady) + ' / ' + String(capabilityTotal) : null
    },
    details: {
      source: first(status.upstream, 'bol-van/zapret2'),
      serviceState: first(status.serviceState, null),
      autostart: status.autostart === true,
      runtimeRunning: status.runtimeRunning === true,
      installed: installed,
      technical: object(status.technical)
    }
  };
}

function z2kUpdateState(status) {
  if (status === 'rebase-required' || status === 'review-required' || status === 'integration-required') return 'integration-required';
  if (status === 'update-available' || status === 'update') return 'update-available';
  if (status === 'current') return 'current';
  return 'unknown';
}

function normalizeZ2k(input) {
  input = object(input);
  var value = object(input.z2k || input.component || input);
  var rawStatus = first(value.status || value.state, 'unknown');
  var updateState = z2kUpdateState(rawStatus);
  var explicitHealth = value.health || value.integrity;
  var healthState = health(explicitHealth, rawStatus === 'broken' || rawStatus === 'missing' ? rawStatus : 'ready');
  var compatibilityState = compatibility(value.compatibility || value.compatibilityState, value.compatible === true ? 'compatible' : null);
  var safeUpdate = object(value.safeUpdate);
  var rebases = array(value.rebases || value.adapted || object(value.plan).rebases);
  var reviews = array(value.reviews || value.watched || object(value.plan).reviews);
  var actions = {
    primary: healthState === 'missing' || healthState === 'broken' ? 'repair'
      : updateState === 'update-available' ? 'update'
      : updateState === 'integration-required' ? 'details' : 'check'
  };
  return {
    id: 'z2k-core',
    label: 'Z2K Core',
    health: healthState,
    updateState: updateState,
    compatibility: compatibilityState,
    summary: 'Autocircular, detectors и расширения Zapret2.',
    version: first(value.runtime || value.runtimeVersion, null),
    actions: actions,
    counters: {
      lua: object(value.lua).ready !== undefined && object(value.lua).total !== undefined ? String(object(value.lua).ready) + ' / ' + String(object(value.lua).total) : null,
      safeUpdate: safeUpdate.count !== undefined ? String(safeUpdate.count) : null
    },
    details: {
      engineDelta: first(value.engineDelta, null),
      provenance: object(value.provenance),
      rebases: rebases,
      reviews: reviews,
      trustMode: first(value.trustMode, null),
      manifest: object(value.manifest)
    }
  };
}

function aggregateHealth(components) {
  components = array(components);
  var ready = components.filter(function (item) { return item.health === 'ready'; }).length;
  var broken = components.some(function (item) { return item.health === 'broken'; });
  var missing = components.some(function (item) { return item.health === 'missing'; });
  var checking = components.some(function (item) { return item.health === 'checking'; });
  var state = ready === components.length ? 'ready' : checking ? 'checking' : missing ? 'missing' : broken ? 'broken' : 'degraded';
  var message = state === 'ready' ? 'Система готова к работе'
    : state === 'missing' ? 'Требуется установка компонентов'
    : state === 'broken' ? 'Требуется восстановление Z2K Core'
    : state === 'checking' ? 'Проверяется состояние компонентов' : 'Требуется проверка компонентов';
  return { ready: ready, total: components.length, state: state, message: message };
}

function normalizePage(input) {
  input = object(input);
  var engine = normalizeEngine(input.engine || {});
  var z2k = normalizeZ2k(input.z2k || input.resources || {});
  var components = [engine, z2k];
  return {
    manager: managerMeta(input.versions || input.manager || {}),
    health: aggregateHealth(components),
    checkedAt: input.checkedAt || null,
    components: components,
    notices: array(input.notices)
  };
}

return baseclass.extend({
  managerMeta: managerMeta,
  normalizeEngine: normalizeEngine,
  normalizeZ2k: normalizeZ2k,
  aggregateHealth: aggregateHealth,
  normalizePage: normalizePage
});
