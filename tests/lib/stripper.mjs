// Node reference implementation of the lua-desync stripper (point 2).
//
// ALGORITHM SPEC for the shipped ucode strip_lua_desync. ucode does not run
// in the build environment, so this is what the local self-test exercises;
// the ucode function mirrors it and runs on the target via smoke.sh.
//
// The real NFQWS2_OPT value puts one nfqws2 argument per line (see the
// /opt/zapret2/config fixture). Passthrough removes every --lua-desync arg
// and keeps the rest unchanged — order and line separators preserved. A line
// is a lua-desync arg iff its trimmed content starts with "--lua-desync="
// (exact prefix: --lua-init= and --lua-desync2= are NOT removed). A line that
// merely contains --lua-desync= mid-line is kept (we never rewrite an arg by
// stripping a token out of the middle of a line).

const TOKEN = '--lua-desync=';

export function strip_lua_desync(value) {
	if (value == null) return '';
	const lines = value.split('\n');
	const kept = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trimStart().startsWith(TOKEN)) continue;   // drop this arg
		kept.push(lines[i]);
	}
	return kept.join('\n');
}
