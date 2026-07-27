// Node reference: lists-page logic (ЦЕЛЬ ДВА).
//
// ALGORITHM SPEC for the shipped ucode lists.uc. Two functions:
// - normalize_domain: lowercase, trim, strip a leading dot.
// - find_conflicts(include[], exclude[]): exact-match (normalized) domains in
//   BOTH lists → conflict array. Not a suffix check; the engine's own
//   matching handles subdomains, we only flag the exact contradiction.
// - check_domain(domain, {userInclude, userExclude, autohostlist}): which
//   lists the domain matches + a conflict flag if it is in both include and
//   exclude.

export function normalize_domain(d) {
	if (d == null) return '';
	let s = String(d).trim().toLowerCase();
	if (s.startsWith('.')) s = s.slice(1);
	return s;
}

export function find_conflicts(include, exclude) {
	if (!include || !exclude) return [];
	const ex = new Set(exclude.map(normalize_domain).filter(Boolean));
	const conflicts = [];
	const seen = new Set();
	for (const d of include) {
		const n = normalize_domain(d);
		if (!n || seen.has(n)) continue;
		if (ex.has(n)) {
			conflicts.push(n);
			seen.add(n);
		}
	}
	return conflicts;
}

export function check_domain(domain, lists) {
	const n = normalize_domain(domain);
	const inInclude = (lists.userInclude || []).some(d => normalize_domain(d) === n);
	const inExclude = (lists.userExclude || []).some(d => normalize_domain(d) === n);
	const inAuto = (lists.autohostlist || []).some(d => normalize_domain(d) === n);
	return {
		domain: n,
		userInclude: inInclude,
		userExclude: inExclude,
		autohostlist: inAuto,
		conflict: inInclude && inExclude
	};
}
