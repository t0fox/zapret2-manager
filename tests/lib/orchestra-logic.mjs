// orchestra-logic.mjs — node reference for the read-only Orchestra adapter
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
// The adapter NEVER pretends these are available: unavailable capabilities
// return { available: false, reason, evidence, upstreamVersion }.

export const ORCHESTRA_VERSION = '0.9.20260307';
export const ORCHESTRA_UPSTREAM_COMMIT = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';

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
// facts: { engine: {auto,antidpi,lib}, luaFiles: [{path, sha256}], version,
//          compatVer, autohostlistVars: object, debugEnabled: bool }
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
			evidence: ['grep slm_preload zapret-auto.lua @d3b3011 → empty', 'upstream commit d3b3011']
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
		upstreamVersion: ORCHESTRA_VERSION,
		upstreamCommit: ORCHESTRA_UPSTREAM_COMMIT,
		note: 'returned as unavailable instead of an empty array pretending success'
	};
}

// parseAutohostlistVars(configText) — AUTOHOSTLIST_* verbatim (no thresholds
// of our own; upstreamMapping says they are surfaced verbatim).
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

// evidenceBound for orchestra reads (paths/hashes only).
export function boundedEvidence(list, max = 8) {
	return (list || []).slice(0, max);
}
