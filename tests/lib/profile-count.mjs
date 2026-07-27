// Node reference: count profile/strategy markers in an NFQWS2_OPT value.
//
// The profile separator in the applied options string is the strategy marker
// ':strategy=N' inside each '--lua-desync=...' entry. count_strategy_markers
// returns the number of ':strategy=' occurrences, or null if the value is null
// or has no markers (null = "checked, no value"). Mirrored by the ucode
// profile_count in status.uc.

export function count_strategy_markers(value) {
	if (value == null) return null;
	const MARKER = ':strategy=';
	let n = 0;
	let i = 0;
	while (true) {
		let p = value.indexOf(MARKER, i);
		if (p < 0) break;
		n++;
		i = p + MARKER.length;
	}
	return n > 0 ? n : null;
}
