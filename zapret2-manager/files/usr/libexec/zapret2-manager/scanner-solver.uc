'use strict';

export const SOLVER_CAN_BYPASS_CANONICAL_VALIDATION = 0;

function is_array(v) { return type(v) == 'array'; }
function is_object(v) { return type(v) == 'object' && v != null; }

export const default_canonical_validate = function(strategyDraft) {
	if (!is_object(strategyDraft) || !is_array(strategyDraft.profiles) || length(strategyDraft.profiles) === 0) {
		return { ok: false, error: 'Strategy must contain at least one profile' };
	}

	let tcpPortsWildcard = {};
	let udpPortsWildcard = {};

	for (let i = 0; i < length(strategyDraft.profiles); i++) {
		let p = strategyDraft.profiles[i];
		if (!is_object(p) || type(p.args) != 'string') {
			return { ok: false, error: 'Profile args must be string' };
		}
		let args = trim(p.args);

		if (length(args) === 0) {
			return { ok: false, error: 'Profile args cannot be empty' };
		}

		if (match(args, /asset:\/\/[^\s]+\/missing/)) {
			return { ok: false, error: 'Unresolved asset reference in profile' };
		}

		let tcpMatch = match(args, /--filter-tcp(?:=|\s+)([^\s]+)/);
		let udpMatch = match(args, /--filter-udp(?:=|\s+)([^\s]+)/);
		let hlMatch = match(args, /--hostlist(?:=|\s+)([^\s]+)/);

		let tcpPort = tcpMatch ? tcpMatch[1] : (p.filter_tcp || null);
		let udpPort = udpMatch ? udpMatch[1] : (p.filter_udp || null);
		let hostlist = hlMatch ? hlMatch[1] : (p.hostlist || null);

		if (tcpPort && !hostlist) {
			if (tcpPortsWildcard[tcpPort]) {
				return { ok: false, error: 'Conflicting wildcard profiles on TCP port ' + tcpPort };
			}
			tcpPortsWildcard[tcpPort] = true;
		}

		if (udpPort && !hostlist) {
			if (udpPortsWildcard[udpPort]) {
				return { ok: false, error: 'Conflicting wildcard profiles on UDP port ' + udpPort };
			}
			udpPortsWildcard[udpPort] = true;
		}
	}

	return { ok: true };
};

export const build_canonical_draft = function(candidateList, customName) {
	let combinedProfiles = [];
	for (let i = 0; i < length(candidateList); i++) {
		let cand = candidateList[i];
		let profs = cand.profiles || [{
			id: 'p_' + (i + 1),
			name: cand.name || ('Кандидат ' + (i + 1)),
			args: cand.args || ''
		}];
		for (let j = 0; j < length(profs); j++) {
			let p = profs[j];
			push(combinedProfiles, {
				id: 'prof_' + (length(combinedProfiles) + 1),
				name: p.name || ('Профиль ' + (length(combinedProfiles) + 1)),
				enabled: true,
				args: p.args || ''
			});
		}
	}

	return {
		id: 'smart_solution_' + time(),
		name: customName || ('Решение Smart (' + length(combinedProfiles) + ' профилей)'),
		description: 'Автоматически сгенерированное решение Smart Scanner',
		profiles: combinedProfiles,
		isGenerated: true,
		sourceCount: length(candidateList)
	};
};

function getUnionTargets(covered1, covered2) {
	let seen = {};
	let res = [];
	for (let t in covered1 || []) {
		if (!seen[t]) { seen[t] = true; push(res, t); }
	}
	for (let t in covered2 || []) {
		if (!seen[t]) { seen[t] = true; push(res, t); }
	}
	return res;
}

export const solve_minimal_set = function(candidateCoverageList, requiredTargets, options) {
	options = options || {};
	let validator = options.validate_strategy;
	if (type(validator) != 'function') {
		return { solved: false, profiles_count: 0, reason: 'Canonical Strategy validator is mandatory' };
	}

	if (!is_array(candidateCoverageList) || !length(candidateCoverageList) || !is_array(requiredTargets) || !length(requiredTargets)) {
		return { solved: false, profiles_count: 0, reason: 'Empty candidates or targets' };
	}

	let reqMap = {};
	for (let t in requiredTargets) reqMap[t] = true;
	let totalReq = length(requiredTargets);

	// ─── STAGE 1: Try single candidate (1 strategy) ───
	for (let i = 0; i < length(candidateCoverageList); i++) {
		let item = candidateCoverageList[i];
		let cand = item.candidate;
		let passes = item.passes || [];
		let matches = 0;
		for (let p in passes) if (reqMap[p]) matches++;

		if (matches === totalReq) {
			let draft1 = build_canonical_draft([cand], cand.name);
			let val1 = validator(draft1);
			if (val1 && val1.ok === true) {
				return {
					solved: true,
					profiles_count: length(draft1.profiles),
					strategy_draft: draft1,
					covered_targets: passes,
					alternatives_count: 0
				};
			}
		}
	}

	// ─── STAGE 2: Try 2-candidate combinations ───
	for (let i = 0; i < length(candidateCoverageList); i++) {
		for (let j = i + 1; j < length(candidateCoverageList); j++) {
			let c1 = candidateCoverageList[i];
			let c2 = candidateCoverageList[j];

			let union2 = getUnionTargets(c1.passes, c2.passes);
			let matches2 = 0;
			for (let p in union2) if (reqMap[p]) matches2++;

			if (matches2 === totalReq) {
				let draft2 = build_canonical_draft([c1.candidate, c2.candidate]);
				let val2 = validator(draft2);
				if (val2 && val2.ok === true) {
					return {
						solved: true,
						profiles_count: length(draft2.profiles),
						strategy_draft: draft2,
						covered_targets: union2,
						components: [c1.candidate.scannerId || c1.candidate.id, c2.candidate.scannerId || c2.candidate.id]
					};
				}
			}
		}
	}

	return {
		solved: false,
		profiles_count: 0,
		reason: 'Не удалось найти полностью совместимое и валидное решение для всех выбранных ресурсов.'
	};
};

export const find_minimal_compatible_set = function(candidateCoverageList, requiredTargets, options) {
	return solve_minimal_set(candidateCoverageList, requiredTargets, options);
};
