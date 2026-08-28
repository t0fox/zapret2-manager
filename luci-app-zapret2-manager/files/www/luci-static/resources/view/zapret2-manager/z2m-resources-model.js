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
function decorateAsset(asset) {
	var out = Object.assign({}, object(asset));
	var policy = object(out.management);
	out.management = {
		owner: text(policy.owner),
		mode: text(policy.mode),
		editable: policy.editable === true,
		deletable: policy.deletable === true
	};
	// Missing backend policy fails closed; the model never infers ownership from
	// mutable/provenance fields and only exposes the server decision.
	out.readOnly = out.management.editable !== true;
	return out;
}

var USER_KINDS = { 'imported': true, 'user-created': true };
// System kinds are everything else except we treat generated separately (not auto-user)
var PACKAGE_IDS = { 'package-baseline': true, 'package': true };

function isUserKind(kind) {
	return kind === 'imported' || kind === 'user-created';
}

function normalizeSource(source) {
	source = object(source);
	return {
		id: text(source.id) || '',
		label: text(source.label) || text(source.id) || '',
		repository: text(source.repository) || null,
		commit: text(source.commit) || null,
		kind: text(source.kind) || null,
		state: text(source.state) || 'unknown',
		status: text(source.status) || null,
		manifestPath: text(source.manifestPath) || null,
		raw: source
	};
}

function severityRank(state) {
	// error/broken > attention > update > unknown > current/checking/stale -> current
	if (state === 'error' || state === 'broken') return 5;
	if (state === 'attention') return 4;
	if (state === 'update') return 3;
	if (state === 'missing') return 3; // treat missing as update-like needing action
	if (state === 'unknown') return 1;
	if (state === 'current') return 0;
	return 0; // checking/unavailable/stale -> 0 for group aggregation, unless all unknown
}

function maxSeverityState(states) {
	var best = 'current';
	var bestRank = -1;
	for (var i = 0; i < states.length; i++) {
		var r = severityRank(states[i]);
		if (r > bestRank) {
			bestRank = r;
			best = states[i];
		}
	}
	return best;
}

function z2kBadgeState(z2kStatus) {
	var canonical = UpdatePresentation.normalize(z2kStatus);
	if (canonical === 'current') return 'current';
	if (canonical === 'update-available') return 'update';
	if (canonical === 'unknown') return 'unknown';
	return canonical === 'broken' || canonical === 'failed' ? 'error' : 'attention';
}

function z2kUpdateState(value) {
	value = object(value);
	return UpdatePresentation.normalize(value.updateState || value.status || value.state);
}

function releaseValue(value) {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return text(value.value || value.version || value.release);
	}
	return text(value);
}

function deriveGroupState(group, z2k) {
	var assetStates = [];
	for (var i = 0; i < group.assets.length; i++) {
		var s = text(group.assets[i].state) || 'unknown';
		// Normalize missing -> attention? Keep as missing for now but rank same as update
		assetStates.push(s);
	}
	var base = assetStates.length ? maxSeverityState(assetStates) : 'current';
	// Special policy for z2k-resources: product truth from resources.z2k overrides but does not mask broken
	if (group.id === 'z2k-resources' && z2k) {
		var z2kState = z2kBadgeState(z2kUpdateState(z2k));
		var z2kRank = severityRank(z2kState);
		var baseRank = severityRank(base);
		// If asset severity is higher (broken/attention), keep it
		if (baseRank >= 4) return base;
		if (z2kRank > baseRank) return z2kState;
		return base;
	}
	return base;
}

function humanStateLabel(state) {
	var map = { current: 'Актуально', update: 'Доступно обновление', missing: 'Не установлено', unknown: 'Не проверено', attention: 'Требует внимания', error: 'Ошибка проверки' };
	return map[state] || map['unknown'];
}

function resourceCountText(count) {
	var value = Number(count);
	if (!isFinite(value)) value = 0;
	var n = Math.abs(Math.trunc(value));
	var mod10 = n % 10;
	var mod100 = n % 100;
	var word = mod10 === 1 && mod100 !== 11 ? 'ресурс' :
		mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'ресурса' : 'ресурсов';
	return String(count) + ' ' + word;
}

function buildModel(resources, assets, opts) {
	resources = object(resources);
	assets = object(assets);
	opts = object(opts);
	var advanced = opts.advanced === true;

	var sourcesRaw = array(resources.sources);
	var registryRaw = array(assets.assets || assets.list || []).map(decorateAsset);
	var registryById = {};
	for (var ri = 0; ri < registryRaw.length; ri++) if (text(registryRaw[ri].id)) registryById[text(registryRaw[ri].id)] = registryRaw[ri];
	var installedRaw = array(resources.installed).map(function (asset) {
		var row = object(asset);
		var registered = registryById[text(row.id)];
		return decorateAsset(registered ? Object.assign({}, row, registered) : row);
	});
	// Also support assets.assets already
	if (!registryRaw.length && Array.isArray(assets)) registryRaw = assets.map(decorateAsset);

	var z2k = object(resources.z2k);
	// Normalize sources and build indexes
	var sources = [];
	var byId = {};
	var byRepo = {};
	for (var i = 0; i < sourcesRaw.length; i++) {
		var s = normalizeSource(sourcesRaw[i]);
		if (!s.id) continue;
		sources.push(s);
		byId[s.id] = s;
		if (s.repository) byRepo[s.repository] = s;
		// also index by repository without case sensitivity
		if (s.repository) byRepo[s.repository.toLowerCase()] = s;
	}

	// Create groups: generic source -> group
	var groupsById = {};
	var groups = [];
	for (var si = 0; si < sources.length; si++) {
		var src = sources[si];
		var isPackage = PACKAGE_IDS[src.id] || src.kind === 'package';
		var group = {
			id: src.id,
			label: src.label,
			kind: src.kind,
			repository: src.repository,
			commit: src.commit,
			source: src.raw,
			assets: [],
			counts: {},
			total: 0,
			hiddenBasic: isPackage,
			isTechnical: isPackage,
			state: 'current',
			bundleUpdateState: null,
			bundlePresentation: null
		};
		groupsById[src.id] = group;
		groups.push(group);
	}
	// Synthetic user group (always present, may be empty)
	var userGroup = {
		id: 'user',
		label: 'Мои ресурсы',
		kind: 'user',
		repository: null,
		commit: null,
		source: null,
		assets: [],
		counts: {},
		total: 0,
		hiddenBasic: false,
		state: 'current'
	};
	// Keep user group separate but include in groups for summary? We will add at end
	groupsById['user'] = userGroup;

	var seen = {};
	var totalVisibleAssets = 0;

	function assignAsset(asset, sourceIdHint, provenance) {
		asset = decorateAsset(asset);
		var id = text(asset.id);
		if (!id) return false;
		if (seen[id]) return false;
		// Determine target group
		var targetId = null;
		var kind = provenance ? text(provenance.kind) : null;
		// Explicit user kinds -> user group
		if (isUserKind(kind)) {
			targetId = 'user';
		} else if (sourceIdHint && byId[sourceIdHint]) {
			targetId = sourceIdHint;
		} else if (provenance) {
			var repo = text(provenance.source) || text(provenance.repository);
			if (repo && byRepo[repo]) targetId = byRepo[repo].id;
			else if (repo && byRepo[repo.toLowerCase()]) targetId = byRepo[repo.toLowerCase()].id;
			else {
				// bundleId evidence: if bundleId contains known source id prefix
				var bundleId = text(provenance.bundleId);
				if (bundleId) {
					// Try to map via known bundleId -> sourceId for z2k/avatar
					// Generic: if bundleId starts with 'z2k-' -> z2k-resources
					if (bundleId.indexOf('z2k-') === 0 && byId['z2k-resources']) targetId = 'z2k-resources';
					else if (bundleId.indexOf('avatar') >= 0 && byId['avatar-strategy-catalog']) targetId = 'avatar-strategy-catalog';
				}
			}
		}
		// Fallback: if still no target and asset appears to be z2k/catalog via id pattern? Keep unassigned
		// For system assets without provenance, try to assign via installed source mapping already covered
		if (!targetId) {
			// Try to infer from id prefix? Not reliable. Leave unassigned for now -> will be assigned to first available? Better skip.
			return false;
		}
		var grp = groupsById[targetId];
		if (!grp) return false;
		// Respect catalog/upstream never as user (already handled) and user never as system
		grp.assets.push(asset);
		seen[id] = true;
		return true;
	}

	// Primary: installed -> source groups
	for (var j = 0; j < installedRaw.length; j++) {
		var row = object(installedRaw[j]);
		var prov = object(row.provenance);
		// installed rows have .source as sourceId and .provenance optional
		var srcId = text(row.source);
		// Provide fallback provenance from row itself if needed
		var effProv = prov && prov.kind ? prov : null;
		if (!effProv && row.source) {
			// synthesize minimal provenance for source assignment
			effProv = { kind: 'catalog/upstream', source: byId[srcId] ? byId[srcId].repository : null };
		}
		// For installed, we have explicit sourceId, so assign directly regardless of provenance kind
		// But still respect user kinds: if provenance is user-created, go to user (should not happen for installed system)
		var kindForRow = prov.kind ? text(prov.kind) : null;
		var target = null;
		if (isUserKind(kindForRow)) target = 'user';
		else if (srcId && byId[srcId]) target = srcId;
		else if (effProv) {
			var repo2 = text(effProv.source) || text(effProv.repository);
			if (repo2 && byRepo[repo2]) target = byRepo[repo2].id;
		}
		if (target && groupsById[target]) {
			if (!seen[text(row.id)]) {
				groupsById[target].assets.push(row);
				seen[text(row.id)] = true;
			}
		} else {
			// Fallback via generic assign
			assignAsset(row, srcId, effProv);
		}
	}

	// Registry-only / user additions not yet seen
	for (var k = 0; k < registryRaw.length; k++) {
		var reg = object(registryRaw[k]);
		var regProv = object(reg.provenance);
		var regId = text(reg.id);
		if (!regId || seen[regId]) continue;
		// Use generic assign: primary source via provenance fallback, or synthetic user
		var hint = null;
		// Try to derive sourceId from provenance.sourceCommit/repository?
		// Use provenance.source as repo
		assignAsset(reg, hint, regProv);
		// If not assigned and is user kind, force user (assignAsset already handles)
		// If still not assigned and kind is builtin/package, it should go to package-baseline
		if (!seen[regId]) {
			var knd = text(regProv.kind);
			if (knd === 'builtin/package' && byId['package-baseline']) {
				groupsById['package-baseline'].assets.push(reg);
				seen[regId] = true;
			} else if (!isUserKind(knd) && knd === 'catalog/upstream') {
				// Try repository fallback again with more lenient matching
				var r = text(regProv.source) || text(regProv.repository);
				if (r) {
					// Search by substring: necronicle/z2k -> z2k-resources
					for (var sKey in byId) {
						var candRepo = byId[sKey].repository;
						if (candRepo && r.indexOf(candRepo) >= 0) {
							groupsById[sKey].assets.push(reg);
							seen[regId] = true;
							break;
						}
					}
				}
			} else if (isUserKind(knd)) {
				// Ensure user group
				userGroup.assets.push(reg);
				seen[regId] = true;
			} else if (knd === 'generated') {
				// Generated not auto-user; keep as user only if ownership is manager and no other evidence
				// For now, treat as user if not otherwise classified
				userGroup.assets.push(reg);
				seen[regId] = true;
			}
		}
	}

	// Now any remaining catalog/upstream assets that still not assigned: try to assign by id pattern to z2k if id starts with lua:z2k- or blob:* and not seen? To avoid losing 43 assets when provenance missing
	// For robustness, collect unassigned registry assets that are catalog/upstream but repo fallback failed
	for (var u = 0; u < registryRaw.length; u++) {
		var rem = object(registryRaw[u]);
		var rid = text(rem.id);
		if (!rid || seen[rid]) continue;
		var rprov = object(rem.provenance);
		var rk = text(rprov.kind);
		if (rk === 'catalog/upstream' && byId['z2k-resources']) {
			groupsById['z2k-resources'].assets.push(rem);
			seen[rid] = true;
		}
	}

	// Derive counts and state per group
	var visibleGroups = [];
	var hiddenGroups = [];
	var summary = { total: 0, system: 0, user: 0, state: 'current', stateLabel: humanStateLabel('current'), updateCallout: null };
	var maxSummaryRank = -1;

	function updateGroupMetrics(grp) {
		var counts = {};
		for (var ci = 0; ci < grp.assets.length; ci++) {
			var a = grp.assets[ci];
			var t = text(a.type) || 'blob';
			counts[t] = (counts[t] || 0) + 1;
		}
		grp.counts = counts;
		grp.total = grp.assets.length;
		grp.state = deriveGroupState(grp, z2k);
		grp.stateLabel = humanStateLabel(grp.state);
		if (grp.id === 'z2k-resources') {
			grp.bundleUpdateState = z2kUpdateState(z2k);
			grp.bundlePresentation = UpdatePresentation.describe(grp.bundleUpdateState);
		}
		// Human name for consumer
		if (grp.id === 'z2k-resources') grp.consumer = 'Z2K Core';
		else if (grp.id === 'avatar-strategy-catalog') grp.consumer = null;
		else if (grp.id === 'user') grp.consumer = null;
	}

	for (var gi = 0; gi < groups.length; gi++) {
		var g = groups[gi];
		updateGroupMetrics(g);
		if (g.hiddenBasic) {
			hiddenGroups.push(g);
		} else {
			visibleGroups.push(g);
		}
	}
	updateGroupMetrics(userGroup);
	// User group is always visible but may be empty; include in visibleGroups at end
	// Decide ordering: keep source order for system groups, then user group
	visibleGroups.push(userGroup);

	// Deduplicate: ensure visibleGroups does not contain duplicate user if already in groups (it is separate)
	// Compute summary: total = sum visible system groups + user count (excluding hidden package-baseline)
	var sysTotal = 0;
	for (var vi = 0; vi < visibleGroups.length; vi++) {
		var vg = visibleGroups[vi];
		if (vg.id === 'user') continue;
		sysTotal += vg.total;
	}
	summary.system = sysTotal;
	summary.user = userGroup.total;
	summary.total = sysTotal + userGroup.total;

	// Summary state = max severity across visibleGroups (excluding empty user if zero? Still consider)
	for (var si = 0; si < visibleGroups.length; si++) {
		var sgrp = visibleGroups[si];
		if (sgrp.total === 0 && sgrp.id === 'user') continue; // empty user doesn't affect summary
		if (sgrp.total === 0) continue;
		var rank = severityRank(sgrp.state);
		if (rank > maxSummaryRank) {
			maxSummaryRank = rank;
			summary.state = sgrp.state;
		}
	}
	// If no assets at all, keep current
	if (maxSummaryRank === -1) summary.state = 'current';
	summary.stateLabel = humanStateLabel(summary.state);

	// Global update callout (only for z2k product)
	var updateCallout = null;
	var z2kStatus = z2kUpdateState(z2k);
	if (['update-available', 'rebase-required', 'review-required', 'integration-required'].indexOf(z2kStatus) >= 0) {
		var localCommit = null;
		var localProv = object(object(z2k.local).provenance);
		localCommit = text(object(z2k.local).commit) || text(localProv.commit) || null;
		var remoteCurrent = text(object(z2k.manifest).current) || null;
		var installedRelease = releaseValue(object(z2k.local).installedRelease || z2k.installedRelease);
		var availableRelease = releaseValue(z2k.availableRelease || z2k.available);
		updateCallout = {
			sourceId: 'z2k-resources',
			status: z2kStatus,
			presentation: UpdatePresentation.describe(z2kStatus),
			from: installedRelease,
			to: availableRelease,
			technicalFrom: localCommit,
			technicalTo: remoteCurrent,
			label: 'Z2K Core',
			targetRoute: 'components'
		};
	}
	summary.updateCallout = updateCallout;

	// For UI filtering: expose classification counts per group not needed separately

	return {
		summary: summary,
		groups: visibleGroups,
		hiddenGroups: hiddenGroups,
		allGroups: groups.concat([userGroup]),
		userGroup: userGroup,
		z2k: z2k,
		sources: sources,
		byId: byId,
		updateCallout: updateCallout,
		seen: seen
	};
}

function shouldShowBadge(asset) {
	var s = text(asset.state) || 'unknown';
	// Only non-current exceptional states get badge
	if (s === 'current') return false;
	if (s === 'attention' || s === 'error' || s === 'missing' || s === 'unknown' || s === 'update') return true;
	return false;
}

return baseclass.extend({
	buildModel: buildModel,
	shouldShowBadge: shouldShowBadge,
	severityRank: severityRank,
	humanStateLabel: humanStateLabel,
	resourceCountText: resourceCountText
});
