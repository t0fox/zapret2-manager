'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-update-presentation as UpdatePresentation';

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

function compatibilityState(value, fallback) {
	var raw = String(value || '').toLowerCase();
	if (raw === 'compatible' || raw === 'confirmed' || raw === 'ok') return 'compatible';
	if (raw === 'incompatible' || raw === 'failed' || raw === 'broken') return 'incompatible';
	if (['review-required', 'rebase-required', 'integration-required', 'inconsistent'].indexOf(raw) >= 0) return raw;
	return fallback || 'unverified';
}

function compatibilityRecord(value, fallback) {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return {
			state: compatibilityState(value.state || value.status, fallback),
			reason: first(value.reason || value.message, null)
		};
	}
	return { state: compatibilityState(value, fallback), reason: null };
}

function health(value, fallback) {
  var raw = String(value || '').toLowerCase();
  if (['ready', 'missing', 'degraded', 'broken', 'checking'].indexOf(raw) >= 0) return raw;
  return fallback || 'degraded';
}

function engineHealth(status) {
  if (status.installed !== true || status.state === 'engine_missing' || status.serviceState === 'engine_missing') return 'missing';
  // Runtime evidence gates first; a backend-supplied health field may only
  // DOWNGRADE the verdict, never fabricate readiness past these checks.
  var computed;
	if (status.serviceState === 'error') computed = 'broken';
  else if (status.serviceState !== 'running' || status.runtimeRunning === false) computed = 'degraded';
  else computed = 'ready';
  if (status.health) {
    var claimed = health(status.health, 'degraded');
    var severity = { ready: 0, degraded: 1, broken: 2, missing: 3 };
    if ((severity[claimed] || 1) > (severity[computed] || 1)) return claimed;
  }
  return computed;
}

function engineUpdate(input, status) {
	var check = object(input.check || input.update || status.update);
	var catalog = object(input.catalog);
	var raw = check.updateState || check.state || status.updateState || status.update || catalog.updateState;
	if (raw === undefined && check.updateAvailable === true) raw = 'update-available';
	if (raw === undefined && check.updateAvailable === false) raw = 'current';
	return UpdatePresentation.normalize(raw);
}

function timestamp(value) {
	return value === null || value === undefined || value === '' ? null : value;
}

function versionFrom(value) {
	value = object(value);
	return first(value.version || value.release || value.installedRelease || value.latestVersion, null);
}

function normalizeEngine(input) {
  input = object(input);
	var status = object(input.status || input.engine || input);
	var gate = object(input.gate || input.compatibilityGate);
	var installed = status.installed === true;
	var runtimeHealth = engineHealth(status);
	var check = object(input.check || input.update || status.update);
	var catalog = object(input.catalog);
	var compatibilityValue = check.compatibility || status.compatibility || gate.compatibility;
	var compatibilityStateValue = compatibilityValue || (status.compatible === false || gate.compatible === false
	    ? 'incompatible' : (status.compatible === true || gate.compatible === true ? 'compatible' : null));
	var compatibility = compatibilityRecord(compatibilityValue || compatibilityStateValue);
	var installedVersion = first(status.installedRelease || status.packageVersion, null);
	var artifactKind = first(status.artifactKind || status.artifact || (status.patchSeries && status.patchSeries.length ? 'legacy-compatibility-build' : null), null);
	var availableVersion = versionFrom(check.available) || first(check.availableRelease || check.latestRelease || check.latestVersion, null);
	if (availableVersion === null) availableVersion = versionFrom(status.available) || versionFrom(catalog.available);
	var installedIdentity = { version: installedVersion, artifactKind: artifactKind };
	var updateState = engineUpdate(input, status);
	var upstreamRelease = artifactKind === 'legacy-compatibility-build' ? null
		: first(status.upstreamRelease || (artifactKind === 'vanilla-bol-van-release' ? installedVersion : null), null);
	var capabilities = object(status.capabilities);
  var capabilityReady = capabilities.ready !== undefined ? capabilities.ready : capabilities.available;
  var capabilityTotal = capabilities.total !== undefined ? capabilities.total : capabilities.required;
  var actions = {
		primary: runtimeHealth === 'missing' ? 'install' : runtimeHealth === 'broken' ? 'repair' : 'manage'
	};
	return {
		id: 'engine',
		label: 'Zapret2 Engine',
		runtimeHealth: runtimeHealth,
		health: runtimeHealth,
		updateState: updateState,
		updatePresentation: UpdatePresentation.describe(updateState),
		compatibility: compatibility,
		installed: installedIdentity,
		available: { version: availableVersion },
		artifactKind: artifactKind,
		upstreamRelease: upstreamRelease,
		checkedAt: timestamp(check.checkedAt !== undefined ? check.checkedAt : status.checkedAt),
		summary: runtimeHealth === 'missing' ? 'Базовый движок обработки трафика отсутствует.' : 'Базовый движок обработки трафика.',
		version: installedVersion,
		actions: actions,
    counters: {
      capabilities: capabilityReady !== undefined && capabilityTotal !== undefined ? String(capabilityReady) + ' / ' + String(capabilityTotal) : null
    },
    details: {
      source: first(status.upstream, 'bol-van/zapret2'),
      serviceState: first(status.serviceState, null),
			autostart: typeof status.autostart === 'boolean' ? status.autostart : null,
      runtimeRunning: status.runtimeRunning === true,
      installed: installed,
      technical: object(status.technical)
    }
  };
}

function z2kUpdateState(status) {
	return UpdatePresentation.normalize(status);
}

function z2kLuaEvidence(value) {
  var lua = object(value.lua);
  return lua.ready !== undefined && lua.total !== undefined
    && lua.total > 0 && lua.ready === lua.total;
}

function normalizeZ2kCatalog(value) {
  return array(value).map(function (item) {
    item = object(item);
    return {
      version: first(item.version, null),
      latest: item.latest === true,
      installed: item.installed === true,
      installable: item.installable === true,
      unavailableReason: first(item.unavailableReason, null),
      publishedAt: first(item.publishedAt, null)
    };
  }).filter(function (item) { return item.version !== null; });
}

function normalizeZ2kDetails(value) {
  value = object(value);
  function normalizeChanges(input) {
    input = object(input);
    function normalizeItems(value) {
      return array(value).map(function (item) {
        item = object(item);
        return {
          id: first(item.id, null),
          name: first(item.name || item.localName || item.id || item.sourcePath, null),
          sourcePath: first(item.sourcePath, null),
          type: first(item.type, null)
        };
      }).filter(function (item) {
        return item.id !== null || item.name !== null || item.sourcePath !== null;
      });
    }
    var hasNumericCounts = typeof input.modified === 'number' || typeof input.added === 'number' || typeof input.removed === 'number';
    var known = input.known === true || (input.known === undefined && hasNumericCounts);
    return {
      known: known,
      modified: known && typeof input.modified === 'number' ? input.modified : null,
      added: known && typeof input.added === 'number' ? input.added : null,
      removed: known && typeof input.removed === 'number' ? input.removed : null,
      modifiedPaths: array(input.modifiedPaths),
      addedPaths: array(input.addedPaths),
      removedPaths: array(input.removedPaths),
      modifiedItems: normalizeItems(input.modifiedItems),
      addedItems: normalizeItems(input.addedItems),
      removedItems: normalizeItems(input.removedItems),
      managedPaths: array(input.managedPaths),
      unknown: array(input.unknown)
    };
  }
  var legacyChanges = value.changes || {};
  var releaseChanges = normalizeChanges(value.releaseChanges || legacyChanges);
  var installChanges = normalizeChanges(value.installChanges || value.changes || value.releaseChanges || {});
  return {
    version: first(value.version, null),
    releaseName: first(value.releaseName || value.version, null),
    releaseBody: first(value.releaseBody, null),
    publishedAt: first(value.publishedAt, null),
    previousVersion: first(value.previousVersion, null),
    installedVersion: first(value.installedVersion, null),
    installable: value.installable === true,
    unavailableReason: first(value.unavailableReason, null),
    latest: value.latest === true,
    installed: value.installed === true,
    operation: first(value.operation, null),
    targetCanApply: value.targetCanApply !== undefined ? value.targetCanApply === true : null,
    targetAttentionState: first(value.targetAttentionState, null),
    targetBlockingReasons: array(value.targetBlockingReasons),
    targetReviewDetails: array(value.targetReviewDetails),
    releaseChanges: releaseChanges,
    installChanges: installChanges,
    changes: installChanges,
    compareUrl: first(value.compareUrl, null)
  };
}

function normalizeZ2k(input, engineReady) {
  input = object(input);
	var value = object(input.z2k || input.component || input);
	var plan = object(value.plan);
	var catalog = normalizeZ2kCatalog(value.catalog || input.catalog);
	var selectedDetails = normalizeZ2kDetails(value.selectedDetails || input.selectedDetails);
	var selectedVersion = first(value.selectedVersion || selectedDetails.version, null);
	var remoteStatus = first(value.updateState || value.status || value.state, 'unknown');
	var updateState = z2kUpdateState(remoteStatus);
	var local = object(value.local);
	var hasLocal = local && (local.installed !== undefined || local.lua !== undefined || local.integrity !== undefined || local.integrityOk !== undefined || local.commit !== undefined || local.installedRelease !== undefined);
  var explicitHealth = value.health || value.integrity || local.health;
  if (local.integrity === 'broken' && !explicitHealth) explicitHealth = 'broken';
  // TRUTH MODEL: Z2K Core is ready only on top of a READY compatible Engine
  // plus materialized/integrity-checked assets. Without a proven engine the
  // component is a requires-engine install gate — regardless of bundled
  // package assets. Unknown state is bounded-degraded, never silently ready.
  var healthState;
  var summary;
  if (engineReady !== true) {
    healthState = 'missing';
    summary = 'Требуется совместимый Zapret2 Engine.';
  } else if (hasLocal) {
    var localEvidence = z2kLuaEvidence(local);
    if (local.installed === false) healthState = 'missing';
    else if (local.integrityOk === false || local.integrity === 'broken') healthState = 'broken';
    else if (localEvidence) healthState = 'ready';
    else healthState = 'degraded';
    if (explicitHealth) {
      var claimedLocal = health(explicitHealth, 'degraded');
      var severityLocal = { ready: 0, degraded: 1, broken: 2, missing: 3 };
      if ((severityLocal[claimedLocal] || 1) > (severityLocal[healthState] || 1)) healthState = claimedLocal;
    }
    summary = healthState === 'ready'
      ? 'Autocircular, detectors и расширения Zapret2.'
      : 'Z2K Core требует проверки целостности ресурсов.';
  } else {
    // Legacy fallback: production shape before local projection
    var legacyEvidence = z2kLuaEvidence(value);
    if (remoteStatus === 'broken' || remoteStatus === 'missing') healthState = remoteStatus;
    else if (legacyEvidence) healthState = 'ready';
    else healthState = 'degraded';
    if (explicitHealth) {
      var claimed = health(explicitHealth, 'degraded');
      var severity = { ready: 0, degraded: 1, broken: 2, missing: 3 };
      if ((severity[claimed] || 1) > (severity[healthState] || 1)) healthState = claimed;
    }
    summary = healthState === 'ready'
      ? 'Autocircular, detectors и расширения Zapret2.'
      : 'Z2K Core требует проверки целостности ресурсов.';
  }
	var compatibilityStateValue;
	if (hasLocal) {
		var compatRaw = value.compatibility || value.compatibilityState || (local.integrityOk === true ? 'compatible' : null);
		compatibilityStateValue = compatibilityRecord(compatRaw, value.compatible === true ? 'compatible' : null);
		if (compatibilityStateValue.state === 'unverified' && local.integrityOk === true) compatibilityStateValue.state = 'compatible';
	} else {
		compatibilityStateValue = compatibilityRecord(value.compatibility || value.compatibilityState, value.compatible === true ? 'compatible' : null);
	}
	var safeUpdate = object(value.safeUpdate || local.safeUpdate);
	var rebases = array(value.rebases || value.adapted || plan.rebases || local.rebases);
	var advisoryReviews = array(value.advisoryReviews || plan.advisoryReviews || local.advisoryReviews);
	var blockingReviews = array(value.blockingReviews || plan.blockingReviews || local.blockingReviews);
	var blockingReasons = array(value.blockingReasons || plan.blockingReasons || local.blockingReasons);
	var reviews = array(value.reviews || value.watched || plan.reviews || local.reviews);
	if (!reviews.length) reviews = advisoryReviews.concat(blockingReviews);
	var reviewDetails = array(value.reviewDetails || plan.reviewDetails || local.reviewDetails);
	var attentionState = first(value.attentionState || plan.attentionState, null);
	if (attentionState === null) {
		if (rebases.length || updateState === 'rebase-required') attentionState = 'rebase-required';
		else if (blockingReviews.length || updateState === 'review-required') attentionState = 'review-required';
		else if (updateState === 'integration-required') attentionState = 'integration-required';
		else if (advisoryReviews.length) attentionState = 'review-advisory';
		else attentionState = 'none';
	}
	var updates = array(value.updates || plan.updates);
	var canApplyValue = value.canApply !== undefined ? value.canApply : plan.canApply;
	var canApply = canApplyValue === undefined
		? updateState === 'update-available' && attentionState !== 'rebase-required'
			&& attentionState !== 'review-required' && attentionState !== 'integration-required'
			&& blockingReviews.length === 0
		: canApplyValue === true;
	var manifest = object(value.manifest || plan.manifest || local.manifest);
	var planToken = first(value.planToken || plan.planToken, null);
	var actions = {
    primary: engineReady !== true ? 'details'
      : healthState === 'missing' || healthState === 'broken' ? 'repair'
		: updateState === 'update-available' && canApply === true ? 'update'
		: ['integration-required', 'review-required', 'rebase-required'].indexOf(attentionState) >= 0
			|| ['integration-required', 'review-required', 'rebase-required'].indexOf(updateState) >= 0
			|| blockingReviews.length > 0 || rebases.length > 0 ? 'details' : 'check'
	};
	var luaSrc = hasLocal ? object(local.lua) : object(value.lua);
	var provenanceSrc = hasLocal && local.provenance ? object(local.provenance) : object(value.provenance);
	var releaseRaw = local.installedRelease !== undefined ? local.installedRelease : value.installedRelease;
	var installedRelease;
	if (releaseRaw && typeof releaseRaw === 'object' && !Array.isArray(releaseRaw)) {
		installedRelease = {
			value: first(releaseRaw.value || releaseRaw.version || releaseRaw.release, null),
			confidence: first(releaseRaw.confidence, 'unknown'),
			authority: first(releaseRaw.authority, null)
		};
	} else if (releaseRaw !== null && releaseRaw !== undefined && releaseRaw !== '') {
		installedRelease = { value: String(releaseRaw), confidence: 'inferred', authority: 'legacy-field' };
	} else {
		installedRelease = { value: null, confidence: 'unknown', authority: null };
	}
	var availableReleaseRaw = value.availableRelease || value.available;
	var catalogLatest = catalog.filter(function (item) { return item.latest === true; })[0];
	var availableRelease = availableReleaseRaw && typeof availableReleaseRaw === 'object'
		? versionFrom(availableReleaseRaw) : first(availableReleaseRaw, null);
	var latestRelease = availableRelease || catalogLatest && catalogLatest.version || (catalog[0] && catalog[0].version) || null;
	if (selectedVersion === null) selectedVersion = installedRelease.value || latestRelease || null;
	var preparedTarget = object(value.preparedTarget);
	var operation = first(preparedTarget.operation || selectedDetails.operation, null);
	var versionRaw = installedRelease.value;
	return {
    id: 'z2k-core',
    label: 'Z2K Core',
		runtimeHealth: healthState,
		health: healthState,
		updateState: updateState,
		updatePresentation: UpdatePresentation.describe(updateState),
		attentionState: attentionState,
		canApply: canApply,
		updates: updates,
		compatibility: compatibilityStateValue,
		installedRelease: installedRelease,
		availableRelease: availableRelease,
		latestRelease: latestRelease,
		catalog: catalog,
		selectedVersion: selectedVersion,
		selectedDetails: selectedDetails.version ? selectedDetails : null,
		preparedTarget: preparedTarget && preparedTarget.targetVersion ? {
			targetVersion: first(preparedTarget.targetVersion, null),
			operation: first(preparedTarget.operation, null),
			preparedAt: preparedTarget.preparedAt !== undefined ? preparedTarget.preparedAt : null
		} : null,
		operation: operation,
		checkedAt: timestamp(value.checkedAt),
		planToken: planToken,
		advisoryReviews: advisoryReviews,
		blockingReviews: blockingReviews,
		blockingReasons: blockingReasons,
		provenance: provenanceSrc,
		reviews: reviews,
		rebases: rebases,
    summary: summary,
    version: versionRaw,
    actions: actions,
    counters: {
      lua: luaSrc.ready !== undefined && luaSrc.total !== undefined ? String(luaSrc.ready) + ' / ' + String(luaSrc.total) : null,
      safeUpdate: safeUpdate.count !== undefined ? String(safeUpdate.count) : null
    },
		details: {
		engineDelta: first(value.engineDelta || local.engineDelta, null),
		localInstalled: hasLocal && (local.installed === true || local.installed === false) ? local.installed : null,
		provenance: provenanceSrc,
		rebases: rebases,
		reviews: reviews,
		reviewDetails: reviewDetails,
      trustMode: first(value.trustMode || local.trustMode, null),
      manifest: manifest,
		planToken: planToken,
		checkSnapshot: { checkedAt: timestamp(value.checkedAt), manifest: manifest }
	  }
  };
}

function aggregateHealth(components) {
  components = array(components);
	var ready = components.filter(function (item) { return (item.runtimeHealth || item.health) === 'ready'; }).length;
	var broken = components.some(function (item) { return (item.runtimeHealth || item.health) === 'broken'; });
	var missing = components.some(function (item) { return (item.runtimeHealth || item.health) === 'missing'; });
	var checking = components.some(function (item) { return (item.runtimeHealth || item.health) === 'checking'; });
  // A pending poll must never mask a hard failure.
  var state = ready === components.length ? 'ready' : broken ? 'broken' : missing ? 'missing' : checking ? 'checking' : 'degraded';
  var message = state === 'ready' ? 'Система готова к работе'
    : state === 'missing' ? 'Требуется установка компонентов'
    : state === 'broken' ? 'Требуется восстановление Z2K Core'
    : state === 'checking' ? 'Проверяется состояние компонентов' : 'Требуется проверка компонентов';
  return { ready: ready, total: components.length, state: state, message: message };
}

function normalizePage(input) {
  input = object(input);
  var engine = normalizeEngine(input.engine || {});
	var z2k = normalizeZ2k(input.z2k || input.resources || {}, engine.runtimeHealth === 'ready');
  var components = [engine, z2k];
  return {
    manager: managerMeta(input.versions || input.manager || {}),
    health: aggregateHealth(components),
		checkedAt: timestamp(input.checkedAt),
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
