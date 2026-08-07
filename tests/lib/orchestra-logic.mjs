// orchestra-logic.mjs — node reference for the read-only Orchestra adapter v2
// (Phase D). Mirrored by the shipped ucode orchestra.uc.
//
// Grounding (verified on target + pinned upstream d3b3011):
//   - zapret-auto.lua IS loaded in the live argv (orchestra engine active);
//   - autostate is a Lua global table (autostate.<askey>.<hostkey>) created
//     at packet time, IN-PROCESS MEMORY ONLY — no persistence calls exist in
//     zapret-auto.lua (only an execution-plan copy, also in-memory);
//   - Zapret2GUI's slm_preload_blocked/locked/history APIs DO NOT EXIST in
//     the pinned upstream zapret-auto.lua (grep-empty at d3b3011);
//   - DLOG is gated by b_debug (no --debug in the live argv) and
//     AUTOHOSTLIST_DEBUGLOG=0 — there is NO event stream to read.
//
// v2: dynamic upstream detection, semantic autohostlist model, safe diag tail,
//     manager observation history.

export const PINNED_UPSTREAM = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';

const KNOWN_EVENT_PREFIXES = ['adaptive_failure:', 'retransmission:', 'autohostlist_decision:', 'strategy_transition:'];

// detectEngineInArgv(cmdline) — whether the orchestra engine is loaded.
export function detectEngineInArgv(cmdline) {
	const s = String(cmdline ?? '');
	return {
		auto: s.includes('zapret-auto.lua'),
		antidpi: s.includes('zapret-antidpi.lua'),
		lib: s.includes('zapret-lib.lua')
	};
}

// capabilityMatrix(facts) — the honest capability list.
export function capabilityMatrix(facts) {
	const engineLoaded = facts.engine && facts.engine.auto === true;
	return [
		{
			capability: 'engine-loaded',
			available: engineLoaded,
			reason: engineLoaded ? null : 'zapret-auto.lua is not in the live nfqws2 argv',
			evidence: ['live process argv (/proc/<pid>/cmdline)']
		},
		{
			capability: 'lua-bundle-present',
			available: (facts.luaFiles || []).length > 0,
			reason: null,
			evidence: (facts.luaFiles || []).map((f) => f.path)
		},
		{
			capability: 'autostate-model',
			available: engineLoaded,
			reason: 'state records live in the Lua global autostate (autostate.<askey>.<hostkey>), created at packet time — IN-PROCESS MEMORY ONLY (no persistence calls exist in zapret-auto.lua)',
			evidence: ['zapret-auto.lua:48-57 (autostate creation)']
		},
		{
			capability: 'preload-apis',
			available: false,
			reason: 'Zapret2GUI slm_preload_blocked/slm_preload_locked/slm_preload_history do NOT exist in the pinned upstream zapret-auto.lua — there is no way to read autostate from outside the process',
			evidence: ['grep slm_preload zapret-auto.lua @d3b3011 → empty', 'pinned upstream ' + PINNED_UPSTREAM]
		},
		{
			capability: 'event-stream',
			available: false,
			reason: 'no event stream exists: DLOG is gated by b_debug (absent in the live argv) and AUTOHOSTLIST_DEBUGLOG=0 in the applied config',
			evidence: ['zapret-auto.lua DLOG/b_debug usage', 'applied config AUTOHOSTLIST_DEBUGLOG=0']
		},
		{
			capability: 'lock-block-whitelist-mutation',
			available: false,
			reason: 'no upstream interface exists for strategy lock/block/whitelist management — implementing one would require a second orchestration layer, which is architecturally forbidden',
			evidence: ['docs/architecture.md invariants (upstream owns packet-time orchestration)']
		},
		{
			capability: 'autohostlist-config',
			available: true,
			reason: null,
			evidence: ['AUTOHOSTLIST_* in /opt/zapret2/config (verbatim)']
		}
	];
}

// unavailableResult(what, reason, evidence) — the honest unavailable envelope.
export function unavailableResult(what, reason, evidence) {
	return {
		available: false,
		what,
		reason,
		evidence: evidence || [],
		note: 'returned as unavailable instead of an empty array pretending success'
	};
}

// parseAutohostlistVars(configText) — AUTOHOSTLIST_* verbatim.
export function parseAutohostlistVars(configText) {
	const out = {};
	for (const line of String(configText ?? '').split('\n')) {
		const t = line.trim();
		if (t.startsWith('#')) continue;
		if (!t.startsWith('AUTOHOSTLIST_')) continue;
		const eq = t.indexOf('=');
		if (eq < 0) continue;
		const k = t.slice(0, eq);
		let v = t.slice(eq + 1);
		if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
		out[k] = v;
	}
	return out;
}

// parseIntSafe / parseBoolSafe — semantic parsing helpers.
export function parseIntSafe(s) {
	if (s == null || s === '') return null;
	const n = Number(s);
	if (Number.isNaN(n)) return null;
	if (Math.abs(n) > 2147483647) return null;
	return n;
}

export function parseBoolSafe(s) {
	if (s == null || s === '') return null;
	const t = String(s).trim();
	if (t === '1' || t === 'true' || t === 'yes') return true;
	if (t === '0' || t === 'false' || t === 'no') return false;
	return null;
}

// semanticAutohostlist(rawVars) → normalized model.
export function semanticAutohostlist(rawVars) {
	const result = {
		failure: {},
		retransmission: {},
		udp: {},
		debug: { enabled: false, path: null },
		raw: rawVars ?? {},
		parseErrors: []
	};

	if (!rawVars || typeof rawVars !== 'object') return result;

	const failThresh = parseIntSafe(rawVars.AUTOHOSTLIST_FAIL_THRESHOLD);
	if (failThresh != null) result.failure.threshold = failThresh;
	else if (rawVars.AUTOHOSTLIST_FAIL_THRESHOLD != null)
		result.parseErrors.push('AUTOHOSTLIST_FAIL_THRESHOLD is not a valid integer: ' + rawVars.AUTOHOSTLIST_FAIL_THRESHOLD);

	const failTime = parseIntSafe(rawVars.AUTOHOSTLIST_FAIL_TIME);
	if (failTime != null) result.failure.windowSeconds = failTime;
	else if (rawVars.AUTOHOSTLIST_FAIL_TIME != null)
		result.parseErrors.push('AUTOHOSTLIST_FAIL_TIME is not a valid integer: ' + rawVars.AUTOHOSTLIST_FAIL_TIME);

	const retxThresh = parseIntSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD);
	if (retxThresh != null) result.retransmission.threshold = retxThresh;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD != null)
		result.parseErrors.push('AUTOHOSTLIST_RETRANSMIT_THRESHOLD is not a valid integer: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD);

	const retxReset = parseBoolSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_RESET);
	if (retxReset != null) result.retransmission.reset = retxReset;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_RESET != null)
		result.parseErrors.push('AUTOHOSTLIST_RETRANSMIT_RESET is not a valid boolean: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_RESET);

	const maxSeq = parseIntSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ);
	if (maxSeq != null) result.retransmission.maxSequence = maxSeq;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ != null)
		result.parseErrors.push('AUTOHOSTLIST_RETRANSMIT_MAXSEQ is not a valid integer: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ);

	const udpIn = parseIntSafe(rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ);
	if (udpIn != null) result.udp.incomingMaxSeq = udpIn;
	else if (rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ != null)
		result.parseErrors.push('AUTOHOSTLIST_INCOMING_MAXSEQ is not a valid integer: ' + rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ);

	const udpOut = parseIntSafe(rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ);
	if (udpOut != null) result.udp.outgoingMaxSeq = udpOut;
	else if (rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ != null)
		result.parseErrors.push('AUTOHOSTLIST_OUTGOING_MAXSEQ is not a valid integer: ' + rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ);

	const dbgEnabled = parseBoolSafe(rawVars.AUTOHOSTLIST_DEBUGLOG);
	if (dbgEnabled != null) result.debug.enabled = dbgEnabled;
	else {
		const dbg = rawVars.AUTOHOSTLIST_DEBUGLOG;
		if (dbg != null && dbg !== '0' && dbg !== '') {
			result.debug.enabled = true;
			if (dbg !== '1') result.debug.path = dbg;
		}
	}

	return result;
}

// safeDiagTail(lines) — parse known event classes, count unknown, never execute.
export function safeDiagTail(lines) {
	const parsed = [];
	let unknownCount = 0;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i].trim();
		if (!l) continue;
		let known = false;
		for (const prefix of KNOWN_EVENT_PREFIXES) {
			if (l.startsWith(prefix)) {
				known = true;
				parsed.push({ lineIndex: i, eventClass: prefix, rawLineHash: simpleHash(l) });
				break;
			}
		}
		if (!known) unknownCount++;
	}
	return { parsed, unknownCount, parserVersion: 1 };
}

function simpleHash(s) {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h) + s.charCodeAt(i);
		h = h & 0xFFFFFFFF;
	}
	return h.toString(16).padStart(8, '0');
}

// evidenceBound for orchestra reads (paths/hashes only).
export function boundedEvidence(list, max = 8) {
	return (list || []).slice(0, max);
}

// adaptiveState(engine, semantic) — overall state for simple mode.
export function adaptiveState(engine, semantic) {
	if (!engine || !engine.auto) return 'inactive';
	if (Object.keys(semantic.failure || {}).length > 0 || Object.keys(semantic.retransmission || {}).length > 0)
		return 'active';
	return 'partial';
}
