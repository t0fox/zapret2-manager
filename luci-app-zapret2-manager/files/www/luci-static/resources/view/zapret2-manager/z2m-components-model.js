'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-update-presentation as UpdatePresentation';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.length;
  return Object.keys(object(value)).length;
}

function countValue(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null;
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
	if (raw === 'not-applicable' || raw === 'not-installed') return 'not-applicable';
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
	var remoteState = first(input.remoteState || catalog.remoteState || status.remoteState, null);
	var raw = check.updateState || check.state || status.updateState || status.update || catalog.updateState;
	if (raw === undefined && check.updateAvailable === true) raw = 'update-available';
	if (raw === undefined && check.updateAvailable === false) raw = 'current';
	var hasExplicitCheck = check.checkedAt !== undefined || check.latestRelease !== undefined || check.availableRelease !== undefined || check.checkToken !== undefined;
	if (!hasExplicitCheck && ['unavailable', 'empty', 'not-loaded', 'stale'].indexOf(remoteState) >= 0) raw = 'unknown';
	return UpdatePresentation.normalize(raw);
}

function timestamp(value) {
	return value === null || value === undefined || value === '' ? null : value;
}

function versionFrom(value) {
	value = object(value);
	return first(value.value || value.version || value.release || value.installedRelease || value.latestVersion, null);
}

function normalizeEngine(input) {
  input = object(input);
	var status = object(input.status || input.engine || input);
	var gate = object(input.gate || input.compatibilityGate);
	var installed = status.installed === true;
	var runtimeHealth = engineHealth(status);
	var check = object(input.check || input.update || status.update);
	var catalog = object(input.catalog);
	var remoteState = first(input.remoteState || catalog.remoteState || status.remoteState, null);
	var remoteBlocked = ['unavailable', 'empty', 'not-loaded', 'stale'].indexOf(remoteState) >= 0;
	var candidate = object(check.candidate);
	var releases = Array.isArray(catalog.releases) ? catalog.releases : [];
	var catalogCandidate = object(releases[0]);
	var installedCompatibilityValue = check.installedCompatibility || status.installedCompatibility || gate.installedCompatibility;
	var installedCompatibilityFallback = status.compatible === false || gate.compatible === false ? 'incompatible'
	    : status.compatible === true || gate.compatible === true ? 'compatible' : null;
	var compatibility = installed
	    ? compatibilityRecord(installedCompatibilityValue || check.compatibility || status.compatibility || gate.compatibility || installedCompatibilityFallback)
	    : compatibilityRecord(installedCompatibilityValue, 'not-applicable');
	var candidateCompatibilityValue = check.candidateCompatibility || check.compatibility
	    || candidate.compatibility || candidate.compatibilityState
	    || catalogCandidate.compatibility || catalogCandidate.compatibilityState;
	var candidateCompatibility = compatibilityRecord(candidateCompatibilityValue);
	var installedVersion = versionFrom(check.installed)
		|| first(check.installedRelease, null)
		|| first(status.installedRelease || status.packageVersion, null);
	var artifactKind = first(status.artifactKind || status.artifact, null);
	var availableVersion = versionFrom(check.available) || first(check.availableRelease || check.latestRelease || check.latestVersion, null);
	if (availableVersion === null && !remoteBlocked) availableVersion = versionFrom(status.available) || versionFrom(catalog.available) || versionFrom(candidate) || versionFrom(catalogCandidate);
	var installedIdentity = { version: installedVersion, artifactKind: artifactKind };
	var updateState = engineUpdate(input, status);
	var upstreamRelease = first(status.upstreamRelease, null);
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
		candidateCompatibility: candidateCompatibility,
		installed: installedIdentity,
		available: { version: availableVersion },
		remoteState: remoteState,
		remoteAvailable: input.remoteAvailable !== undefined ? input.remoteAvailable === true : null,
		canApply: !remoteBlocked,
		catalog: { remoteState: remoteState, remoteAvailable: input.remoteAvailable !== undefined ? input.remoteAvailable === true : null, source: catalog.source || null },
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
      source: first(status.upstream, 'necronicle/zapret2-z2k'),
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

function z2kClosureComplete(closure, digest) {
  if (!closure || closure.available !== true || closure.resolution !== 'complete') return false;
  var counts = object(closure.counts);
  if (countValue(counts.missing) !== 0) return false;
  var closureDigest = first(closure.runtimeBundleDigest || digest, null);
  return !!(closureDigest && digest && closureDigest === digest);
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

function installableCatalogRelease(catalog, version) {
  if (!version) return null;
  return array(catalog).find(function (item) { return item.version === version; }) || null;
}

function validDigest(value) {
	return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function normalizeDetect(value, runtime, parent) {
	value = object(value);
	runtime = object(runtime);
	parent = object(parent);
	var canonical = object(parent.runtimeSummary);
	var nested = object(value.detect || value);
	var canonicalDetect = object(canonical.detect);
	var coherence = object(runtime.coherence || canonical.coherence || parent.coherence || value.coherence);
	var architecture = first(nested.architecture || nested.arch || canonicalDetect.architecture || canonicalDetect.arch, null);
	var digest = first(nested.digest || nested.sha256 || canonicalDetect.digest || canonicalDetect.sha256, null);
	var sourceCommit = first(nested.sourceCommit || canonicalDetect.sourceCommit, null);
	var runtimeSourceCommit = first(runtime.sourceCommit || canonical.sourceCommit || runtime.installedSourceCommit || parent.sourceCommit || parent.installedSourceCommit, null);
	var identity = first(runtime.compatibilityIdentity || canonical.compatibilityIdentity || parent.compatibilityIdentity || parent.local && parent.local.compatibilityIdentity || coherence.currentCompatibility && coherence.currentCompatibility.digest || value.runtime && value.runtime.compatibilityIdentity, null);
	var bundleDigest = first(runtime.runtimeBundleDigest || canonical.runtimeBundleDigest || parent.runtimeBundleDigest || value.runtime && value.runtime.bundleDigest, null);
	var coherenceStatus = coherence.coherenceStatus;
	var compatibilityStatus = coherence.compatibilityStatus;
	var runtimeHealth = first(runtime.health || canonical.health || parent.health, null);
	var coherent = runtimeHealth === 'ready' && ['coherent', 'aligned'].indexOf(coherenceStatus) >= 0
		&& (compatibilityStatus == null || compatibilityStatus === 'aligned')
		|| value.coherent === true && value.state === 'ready';
	var identityComplete = validDigest(identity) && validDigest(bundleDigest);
	var sourceAligned = !sourceCommit || !runtimeSourceCommit || sourceCommit === runtimeSourceCommit;
	var detectCompatible = nested.compatible !== false && canonicalDetect.compatible !== false && parent.detectCompatible !== false;
	var validatedReady = coherent && !!architecture && validDigest(digest) && identityComplete && sourceAligned && detectCompatible;
	var rawStatus = first(nested.status || nested.state || canonicalDetect.status || parent.detectStatus || value.detectStatus || value.detectState, null);
	var status = validatedReady ? 'ready' : rawStatus === 'ready' ? 'unknown' : first(rawStatus, 'unknown');
	return {
		architecture: architecture,
		status: status,
		digest: digest,
		sourceCommit: sourceCommit,
		compatible: validatedReady
	};
}

function normalizeZ2kDetails(value) {
  value = object(value);
  function normalizeChanges(input) {
    input = object(input);
    function normalizeExplanation(value) {
      value = object(value);
      var source = value.source === 'repository-compare' || value.source === 'immutable-manifest' ? value.source : null;
      var excerpts = array(value.excerpts).filter(function (item) { return typeof item === 'string' && item.trim(); });
      if (!source || !excerpts.length) return null;
      return {
        source: source,
        commitSha: first(value.commitSha, null),
        commitSubject: first(value.commitSubject, null),
        excerpts: excerpts,
        excerptIndexes: array(value.excerptIndexes).filter(function (item) { return Number.isInteger(item) && item >= 0; }),
        fullMessageAvailable: value.fullMessageAvailable === true,
        relation: first(value.relation, null)
      };
    }
    function normalizeCompareContext(value) {
      return array(value).map(function (item) {
        item = object(item);
        return {
          sha: first(item.sha || item.commitSha, null),
          subject: first(item.subject || item.commitSubject, null),
          paragraphs: array(item.paragraphs).filter(function (paragraph) { return typeof paragraph === 'string' && paragraph.trim(); })
        };
      }).filter(function (item) { return item.sha !== null && item.paragraphs.length > 0; });
    }
    function normalizeItems(value) {
      return array(value).map(function (item) {
        item = object(item);
        var summary = typeof item.summary === 'string' && item.summary.trim() ? item.summary : null;
        var summarySource = item.summarySource === 'immutable-manifest' || item.summarySource === 'repository-compare' ? item.summarySource : null;
        var explanation = normalizeExplanation(item.explanation);
        if (!explanation && summary && summarySource === 'immutable-manifest') explanation = {
          source: 'immutable-manifest',
          commitSha: null,
          commitSubject: null,
          excerpts: [summary],
          excerptIndexes: [],
          fullMessageAvailable: false,
          relation: 'exact-path'
        };
        return {
          id: first(item.id, null),
          name: first(item.name || item.localName || item.id || item.sourcePath, null),
          sourcePath: first(item.sourcePath, null),
          type: first(item.type, null),
          summary: summary,
          summarySource: summarySource,
          explanation: explanation
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
      compareContext: normalizeCompareContext(input.compareContext),
      managedPaths: array(input.managedPaths),
      unknown: array(input.unknown)
    };
  }
  var legacyChanges = value.changes || {};
  var releaseChanges = normalizeChanges(value.releaseChanges || legacyChanges);
  var installChanges = normalizeChanges(value.installChanges || value.changes || value.releaseChanges || {});
  // deviceChanges is the canonical target-plan projection. Keep the older
  // installChanges/changes fields as compatibility fallbacks for older RPC
  // payloads, but never use release history as the preferred device source.
  var deviceChanges = normalizeChanges(value.deviceChanges || value.installChanges || value.changes || {});
  var compareDiagnostics = value.compareDiagnostics && typeof value.compareDiagnostics === 'object' && !Array.isArray(value.compareDiagnostics)
    ? value.compareDiagnostics : null;
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
    deviceChanges: deviceChanges,
    installChanges: installChanges,
    changes: deviceChanges,
    compareUrl: first(value.compareUrl, null),
    compareDiagnostics: compareDiagnostics ? {
      requested: compareDiagnostics.requested === true,
      requestCount: typeof compareDiagnostics.requestCount === 'number' ? compareDiagnostics.requestCount : null,
      cache: first(compareDiagnostics.cache, null)
    } : null
  };
}

function normalizeZ2k(input, engineAvailable) {
  input = object(input);
	var value = object(input.z2k || input.component || input);
	var plan = object(value.plan);
	var catalogSource = value.catalog !== undefined ? value.catalog : input.catalog;
	var catalogMeta = object(catalogSource);
	var catalogKnown = value.catalogKnown !== undefined ? value.catalogKnown === true : Array.isArray(catalogSource);
	var catalog = normalizeZ2kCatalog(catalogSource);
	var remoteState = first(value.remoteState || catalogMeta.remoteState || input.remoteState, null);
	var selectedDetails = normalizeZ2kDetails(value.selectedDetails || input.selectedDetails);
	var selectedVersion = first(value.selectedVersion || selectedDetails.version, null);
	var runtimeSummary = value.runtimeSummary && typeof value.runtimeSummary === 'object' && !Array.isArray(value.runtimeSummary) ? value.runtimeSummary : null;
	var remoteStatus = first(value.updateState || value.status || value.state || runtimeSummary && runtimeSummary.updateState, 'unknown');
	var updateState = z2kUpdateState(remoteStatus);
	var local = object(value.local);
	var detect = normalizeDetect(runtimeSummary && runtimeSummary.detect || value.detect || local.detect, runtimeSummary || value, value);
	var compatibilityIdentity = first(runtimeSummary && runtimeSummary.compatibilityIdentity || value.compatibilityIdentity || local.compatibilityIdentity, null);
	var hasLocal = local && (local.installed !== undefined || local.lua !== undefined || local.integrity !== undefined || local.integrityOk !== undefined || local.commit !== undefined || local.installedRelease !== undefined) || runtimeSummary !== null;
	var canonicalHealth = runtimeSummary && runtimeSummary.health ? health(runtimeSummary.health, 'degraded') : null;
	var explicitHealth = value.health || value.integrity || local.health || canonicalHealth;
	if (local.integrity === 'broken' && !explicitHealth) explicitHealth = 'broken';
	var canonicalClosure = runtimeSummary && runtimeSummary.dependencyClosure && typeof runtimeSummary.dependencyClosure === 'object' ? runtimeSummary.dependencyClosure : null;
	var canonicalDigest = runtimeSummary ? first(runtimeSummary.runtimeBundleDigest, null) : null;
	var evidenceClosure = canonicalClosure || (local.dependencyClosure && typeof local.dependencyClosure === 'object' ? local.dependencyClosure : value.dependencyClosure && typeof value.dependencyClosure === 'object' ? value.dependencyClosure : null);
	var evidenceDigest = canonicalDigest || first(value.runtimeBundleDigest || local.runtimeBundleDigest || evidenceClosure && evidenceClosure.runtimeBundleDigest, null);
	var releaseEvidence = local.installedRelease !== undefined ? local.installedRelease : runtimeSummary && runtimeSummary.installedRelease !== undefined ? runtimeSummary.installedRelease : value.installedRelease;
	var receiptConfirmed = releaseEvidence && typeof releaseEvidence === 'object' && !Array.isArray(releaseEvidence)
		? !!(first(releaseEvidence.value || releaseEvidence.version || releaseEvidence.release, null)
			&& releaseEvidence.confidence === 'confirmed'
			&& ['activation-receipt-v3', 'activation-receipt-v2', 'activation-receipt-v1', 'activation-receipt'].indexOf(releaseEvidence.authority) >= 0)
		: false;
	// TRUTH MODEL: Z2K Core readiness is based on its own receipt, materialized
	// assets, dependency closure, and Detect identity. Engine compatibility is
	// still the install gate; the Engine process itself may remain stopped.
  var healthState;
  var summary;
  if (engineAvailable !== true) {
    healthState = 'missing';
    summary = 'Требуется совместимый Zapret2 Engine.';
  } else if (hasLocal) {
    var localEvidence = z2kLuaEvidence(local);
    if (local.installed === false || runtimeSummary && runtimeSummary.health === 'missing') healthState = 'missing';
		else if (local.integrityOk === false || local.integrity === 'broken') healthState = 'broken';
		else if (canonicalHealth === 'broken' || canonicalHealth === 'missing') healthState = canonicalHealth;
		else if (evidenceClosure && !z2kClosureComplete(evidenceClosure, evidenceDigest)) healthState = 'degraded';
		else if (!receiptConfirmed || !detect.architecture || detect.status !== 'ready' || !detect.compatible || !compatibilityIdentity) healthState = 'degraded';
		else if (canonicalHealth && (canonicalHealth !== 'ready' || localEvidence)) healthState = canonicalHealth;
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
    // Without local runtime evidence, Lua counts cannot establish readiness.
    healthState = remoteStatus === 'broken' || remoteStatus === 'missing' ? remoteStatus : 'degraded';
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
	var advisoryReviews = array(value.advisoryReviews || plan.advisoryReviews || local.advisoryReviews || runtimeSummary && runtimeSummary.advisoryReviews);
	var blockingReviews = array(value.blockingReviews || plan.blockingReviews || local.blockingReviews || runtimeSummary && runtimeSummary.blockingReviews);
	var blockingReasons = array(value.blockingReasons || plan.blockingReasons || local.blockingReasons);
	var reviews = array(value.reviews || value.watched || plan.reviews || local.reviews);
	if (!reviews.length) reviews = advisoryReviews.concat(blockingReviews);
	var reviewDetails = array(value.reviewDetails || plan.reviewDetails || local.reviewDetails);
	var unknownUnconsumed = array(value.unknownUnconsumed || plan.unknownUnconsumed || local.unknownUnconsumed || runtimeSummary && runtimeSummary.unknownUnconsumed);
	var compilerInputs = array(value.compilerInputs || plan.compilerInputs || local.compilerInputs);
	var dependencyGraph = object(value.dependencyGraph || plan.dependencyGraph || local.dependencyGraph);
	var dependencyClosure = canonicalClosure || (object(value.dependencyClosure || plan.dependencyClosure || local.dependencyClosure)
		? (value.dependencyClosure || plan.dependencyClosure || local.dependencyClosure) : null);
	var dependencyCounts = runtimeSummary && runtimeSummary.counts && typeof runtimeSummary.counts === 'object' ? runtimeSummary.counts : dependencyClosure && object(dependencyClosure.counts) ? dependencyClosure.counts : {};
	var runtimeEvidenceAuthoritative = runtimeSummary
		? runtimeSummary.health !== 'missing' && local.installed !== false
		: local.installed !== false;
	if (!runtimeEvidenceAuthoritative) dependencyCounts = {};
	var runtimeBundleDigest = first(canonicalDigest || value.runtimeBundleDigest || plan.runtimeBundleDigest || local.runtimeBundleDigest
		|| dependencyClosure && dependencyClosure.runtimeBundleDigest, null);
var strategyCount = countValue(value.strategyCount);
	if (strategyCount === null) strategyCount = countValue(plan.strategyCount);
	if (strategyCount === null) strategyCount = countValue(local.strategyCount);
	if (strategyCount === null && runtimeSummary) strategyCount = countValue(runtimeSummary.strategies);
	if (!runtimeEvidenceAuthoritative) strategyCount = null;
	var compiledDependencySummary = {
		available: dependencyClosure ? dependencyClosure.available === true : null,
		resolution: first(dependencyClosure && dependencyClosure.resolution, null),
		strategies: strategyCount,
		lua: countValue(dependencyCounts.lua),
		blobs: countValue(dependencyCounts.blobs),
		hostlists: countValue(dependencyCounts.hostlists),
		ipsets: countValue(dependencyCounts.ipsets),
		dynamic: countValue(dependencyCounts.dynamic),
		runtime: countValue(dependencyCounts.runtime),
		builtins: countValue(dependencyCounts.builtins),
		missing: countValue(dependencyCounts.missing),
		runtimeBundleDigest: runtimeBundleDigest
	};
	var dependencySummary = {
		runtimeExact: collectionCount(dependencyGraph.runtimeExact),
		compilerInputs: compilerInputs.length || collectionCount(dependencyGraph.compilerInputs),
		unknownUnconsumed: unknownUnconsumed.length,
		adapted: collectionCount(dependencyGraph.adapted) || rebases.length,
		blocking: blockingReviews.length,
		advisory: Math.max(advisoryReviews.length, unknownUnconsumed.length),
		registryAvailable: dependencyGraph.registryAvailable === true
	};
	var attentionState = first(value.attentionState || plan.attentionState || runtimeSummary && runtimeSummary.attentionState, null);
	if (attentionState === null) {
		if (rebases.length || updateState === 'rebase-required') attentionState = 'rebase-required';
		else if (blockingReviews.length) attentionState = 'review-required';
		else if (updateState === 'integration-required') attentionState = 'integration-required';
		else if (advisoryReviews.length) attentionState = 'review-advisory';
		else attentionState = 'none';
	}
	if (attentionState === 'review-required' && blockingReviews.length === 0)
		attentionState = advisoryReviews.length ? 'review-advisory' : 'none';
	var updates = array(value.updates || plan.updates);
	var canApplyValue = value.canApply !== undefined ? value.canApply : plan.canApply;
	var canApply = canApplyValue === undefined
		? updateState === 'update-available' && attentionState !== 'rebase-required'
			&& attentionState !== 'review-required' && attentionState !== 'integration-required'
			&& blockingReviews.length === 0
		: canApplyValue === true;
	// A remote catalog is browseable while stale, but it is never a mutation
	// authority. A missing/empty catalog also cannot unlock a local fallback.
	if (['unavailable', 'empty', 'not-loaded', 'stale'].indexOf(remoteState) >= 0) canApply = false;
	var manifest = object(value.manifest || plan.manifest || local.manifest);
	var planToken = first(value.planToken || plan.planToken, null);
	var actions = {
    primary: engineAvailable !== true ? 'details'
      : healthState === 'missing' || healthState === 'broken' ? 'repair'
		: updateState === 'update-available' && canApply === true ? 'update'
		: ['integration-required', 'review-required', 'rebase-required'].indexOf(attentionState) >= 0
			|| ['integration-required', 'rebase-required'].indexOf(updateState) >= 0
			|| blockingReviews.length > 0 || rebases.length > 0 ? 'details' : 'check'
	};
	var luaSrc = runtimeEvidenceAuthoritative && hasLocal ? object(local.lua) : runtimeEvidenceAuthoritative ? object(value.lua) : {};
	var provenanceSrc = hasLocal && local.provenance ? object(local.provenance) : object(value.provenance);
	var coherenceSource = object(value.coherence || plan.coherence || local.coherence || runtimeSummary && runtimeSummary.coherence || input.coherence);
	var localProvenance = object(local.provenance);
	var coherence = {
		installedRuntimeRevision: first(coherenceSource.installedRuntimeRevision || value.installedRuntimeRevision || local.commit || localProvenance.sourceCommit, null),
		availableUpstreamRevision: first(coherenceSource.availableUpstreamRevision || value.availableUpstreamRevision || value.sourceCommit || value.manifestRevision, null),
		currentStrategySourceRevision: first(coherenceSource.currentStrategySourceRevision || value.currentStrategySourceRevision, null),
		candidateStrategyRevision: first(coherenceSource.candidateStrategyRevision || value.candidateStrategyRevision, null),
		coherenceStatus: first(coherenceSource.coherenceStatus || value.coherenceStatus, 'unknown'),
		compatibilityStatus: first(coherenceSource.compatibilityStatus || value.compatibilityStatus, null)
	};
	var releaseRaw = runtimeSummary && runtimeSummary.installedRelease !== undefined ? runtimeSummary.installedRelease : local.installedRelease !== undefined ? local.installedRelease : value.installedRelease;
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
	var catalogCanProvideRelease = ['unavailable', 'empty', 'not-loaded'].indexOf(remoteState) < 0;
	var hasCanonicalAvailableRelease = runtimeSummary && Object.prototype.hasOwnProperty.call(runtimeSummary, 'availableRelease');
	var availableReleaseRaw = hasCanonicalAvailableRelease ? runtimeSummary.availableRelease
		: catalogCanProvideRelease ? (value.availableRelease || value.available) : null;
	var catalogLatest = catalog.filter(function (item) { return item.latest === true; })[0];
	var availableRelease = availableReleaseRaw && typeof availableReleaseRaw === 'object'
		? versionFrom(availableReleaseRaw) : first(availableReleaseRaw, null);
	var latestRelease = availableRelease || catalogLatest && catalogLatest.version || (catalog[0] && catalog[0].version) || null;
	var availableCatalogItem = installableCatalogRelease(catalog, availableRelease);
	var availableReleaseInCatalog = updateState === 'update-available'
		? remoteState === 'not-loaded' || !catalogKnown ? null : !!availableCatalogItem : null;
	var availableReleaseInstallable = updateState === 'update-available'
		? catalogKnown ? !!(availableCatalogItem && availableCatalogItem.installable === true) : null : null;
	// A remote manifest can announce a release before the immutable device
	// catalog contains its verified install target. Keep the announcement
	// visible, but never expose it as an actionable update.
	if (updateState === 'update-available' && availableReleaseInstallable === false) canApply = false;
	var updatePresentation = UpdatePresentation.describe(updateState);
	if (updateState === 'update-available' && availableReleaseInCatalog === false)
		updatePresentation = { state: 'review-required', label: 'Требуется проверка', kind: 'warning' };
	if (selectedVersion === null) selectedVersion = installedRelease.value || latestRelease || null;
	var preparedTarget = object(value.preparedTarget);
	var lifecycleOperation = value.operation && typeof value.operation === 'object' ? value.operation
		: runtimeSummary && runtimeSummary.operation && typeof runtimeSummary.operation === 'object' ? runtimeSummary.operation : null;
	var operationResult = value.operationResult && typeof value.operationResult === 'object' ? value.operationResult
		: runtimeSummary && runtimeSummary.operationResult && typeof runtimeSummary.operationResult === 'object' ? runtimeSummary.operationResult : null;
	var operation = first(preparedTarget.operation || selectedDetails.operation, null);
	var versionRaw = installedRelease.value;
	var discovery = object(value.discovery || local.discovery || runtimeSummary && runtimeSummary.discovery);
	var synchronized = coherence.compatibilityStatus === 'aligned';
	var facts = {
		strategies: { label: 'Стратегии', count: strategyCount },
		detect: { status: detect.status, arch: detect.architecture },
		runtime: {
			luaReady: countValue(luaSrc.ready),
			luaTotal: countValue(luaSrc.total),
			listsReady: countValue(luaSrc.listsReady !== undefined ? luaSrc.listsReady : dependencyCounts.hostlists),
			blobsReady: countValue(luaSrc.blobsReady !== undefined ? luaSrc.blobsReady : dependencyCounts.blobs)
		},
		discovery: {
			enabled: typeof discovery.enabled === 'boolean' ? discovery.enabled : null,
			running: typeof discovery.running === 'boolean' ? discovery.running : null
		},
		compatibility: { synchronized: synchronized }
	};
	var technical = {
		sourceCommit: first(coherence.installedRuntimeRevision || runtimeSummary && runtimeSummary.sourceCommit || localProvenance.sourceCommit || value.sourceCommit, null),
		manifestSeq: value.manifestSeq !== undefined ? value.manifestSeq : manifest.seq !== undefined ? manifest.seq : manifest.revision !== undefined ? manifest.revision : null,
		manifestSha256: first(value.manifestSha256 || manifest.sha256 || manifest.digest, null),
		runtimeBundleDigest: runtimeBundleDigest,
		compilerInputsDigest: first(value.compilerInputsDigest || runtimeSummary && runtimeSummary.compilerInputsDigest || local.compilerInputsDigest, null),
		catalogDigest: first(value.catalogDigest || runtimeSummary && runtimeSummary.catalogDigest || local.catalogDigest, null),
		compatibilityIdentity: compatibilityIdentity,
		detectSha256: detect.digest,
		dependencyClosure: dependencyClosure,
		provenance: provenanceSrc
	};
	var rollbackState = operationResult && (operationResult.state === 'rollback-result' || operationResult.rollback) ? operationResult : null;
	var state = healthState;
	if (rollbackState) state = 'rollback-result';
	else if (lifecycleOperation && ['working', 'pending', 'running', 'queued', 'applying'].indexOf(String(lifecycleOperation.state || lifecycleOperation.status || lifecycleOperation.phase || '').toLowerCase()) >= 0) state = 'working';
	else if (healthState === 'ready' && updateState === 'update-available') state = 'update-available';
	return {
    id: 'z2k-core',
    label: 'Z2K Core',
		state: state,
		runtimeHealth: healthState,
		health: healthState,
		updateState: updateState,
		updatePresentation: updatePresentation,
		attentionState: attentionState,
		canApply: canApply,
		requiresEngine: engineAvailable !== true,
		updates: updates,
		compatibility: compatibilityStateValue,
		installedRelease: installedRelease,
		availableRelease: availableRelease,
		availableReleaseInCatalog: availableReleaseInCatalog,
		availableReleaseInstallable: availableReleaseInstallable,
		latestRelease: latestRelease,
		remoteState: remoteState,
		remoteAvailable: value.remoteAvailable !== undefined ? value.remoteAvailable === true : null,
		catalog: catalog,
		selectedVersion: selectedVersion,
		selectedDetails: selectedDetails.version ? selectedDetails : null,
		preparedTarget: preparedTarget && preparedTarget.targetVersion ? {
			targetVersion: first(preparedTarget.targetVersion, null),
			operation: first(preparedTarget.operation, null),
			preparedAt: preparedTarget.preparedAt !== undefined ? preparedTarget.preparedAt : null
		} : null,
		operation: operation,
		lifecycle: { state: state, action: actions.primary, operation: lifecycleOperation, result: rollbackState },
		checkedAt: timestamp(value.checkedAt),
		planToken: planToken,
		advisoryReviews: advisoryReviews,
		blockingReviews: blockingReviews,
		blockingReasons: blockingReasons,
		unknownUnconsumed: unknownUnconsumed,
		compilerInputs: compilerInputs,
		dependencyGraph: dependencyGraph,
		dependencyClosure: dependencyClosure,
		 runtimeBundleDigest: runtimeBundleDigest,
		detect: detect,
		detectArchitecture: detect.architecture,
		detectStatus: detect.status,
		detectCompatible: detect.compatible,
		compatibilityIdentity: compatibilityIdentity,
		facts: facts,
		technical: technical,
		runtimeSummary: runtimeSummary,
		compiledDependencySummary: compiledDependencySummary,
		dependencySummary: dependencySummary,
		coherence: coherence,
		provenance: provenanceSrc,
		reviews: reviews,
		rebases: rebases,
    summary: summary,
    version: versionRaw,
    actions: actions,
		counters: {
      lua: luaSrc.ready !== undefined && luaSrc.total !== undefined ? String(luaSrc.ready) + ' / ' + String(luaSrc.total) : null,
		runtimeBundle: runtimeEvidenceAuthoritative && runtimeSummary && runtimeSummary.staticManagedCount !== undefined ? String(runtimeSummary.staticManagedCount) : null,
		strategies: runtimeEvidenceAuthoritative && strategyCount !== null ? String(strategyCount) : null,
      safeUpdate: safeUpdate.count !== undefined ? String(safeUpdate.count) : null
    },
		details: {
		engineDelta: first(value.engineDelta || local.engineDelta, null),
		localInstalled: hasLocal && (local.installed === true || local.installed === false) ? local.installed : null,
		requiresEngine: engineAvailable !== true,
		provenance: provenanceSrc,
		rebases: rebases,
		reviews: reviews,
		reviewDetails: reviewDetails,
		unknownUnconsumed: unknownUnconsumed,
		compilerInputs: compilerInputs,
		dependencyGraph: dependencyGraph,
		dependencyClosure: dependencyClosure,
		compiledDependencySummary: compiledDependencySummary,
		runtimeSummary: runtimeSummary,
		coherence: coherence,
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
	var z2k = normalizeZ2k(input.z2k || input.resources || {}, engine.compatibility.state === 'compatible');
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
