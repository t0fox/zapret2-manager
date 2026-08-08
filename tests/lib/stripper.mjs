// Node reference implementation of the lua-desync stripper (point 2 + followup 3).
//
// ALGORITHM SPEC for the shipped ucode strip_lua_desync. ucode does not run in
// the build environment, so this is what the local self-test exercises; the
// ucode function mirrors it and runs on the target via smoke.sh.
//
// ARG-based (not line-based): nfqws2 args are whitespace-separated (spaces OR
// newlines). The stripper removes every --lua-desync= TOKEN, preserving the
// order and the ORIGINAL separators between the KEPT tokens. Dropping a token
// also drops the separator that immediately preceded it, so no orphan
// separator is left behind. A token is a lua-desync arg iff it starts with
// "--lua-desync=" (exact prefix: --lua-init= and --lua-desync2= survive). This
// handles several args on one line (the line-based stripper did not, and that
// class of defect shows up silently at the user).

const TOKEN = '--lua-desync=';

function isWs(c) { return c == ' ' || c == '\n' || c == '\t' || c == '\r'; }

export function strip_lua_desync(value) {
	if (value == null) return '';
	let out = '';
	let i = 0;
	let n = value.length;
	while (i < n) {
		// capture a whitespace run (the separator before the next token)
		let wsStart = i;
		while (i < n && isWs(value[i])) i++;
		let ws = value.slice(wsStart, i);
		// capture a token (non-whitespace run)
		let tokStart = i;
		while (i < n && !isWs(value[i])) i++;
		let tok = value.slice(tokStart, i);
		if (tok.length === 0) {
			// trailing whitespace only (no token after) — keep it
			if (ws.length) out += ws;
			break;
		}
		if (tok.startsWith(TOKEN)) {
			// drop the token AND its preceding separator so no orphan sep remains
			continue;
		}
		// If out is empty (this is the first KEPT token), drop the leading
		// separator — it was the separator before a dropped token and would
		// be an orphan (leading space/newline).
		if (out.length === 0) out += tok;
		else out += ws + tok;
	}
	return out;
}
