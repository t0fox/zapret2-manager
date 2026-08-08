// catalog.mjs — manager UI catalog for zapret2 strategy models.
//
// !!! THIS CATALOG IS NOT A SOURCE OF TRUTH !!!
//
// The authoritative parsers are the target's nfqws2 binary (C option parser)
// and the Lua bundle loaded with it (same release, matching lua_compat_ver).
// Everything here is a HINT source for autocomplete / warnings only:
//   - a name missing from this catalog yields MANAGER_NOT_IN_CATALOG (warning),
//     never a fatal error;
//   - final validity of a --lua-desync expression is decided ONLY by native
//     validation (see native.mjs).
//
// Grounding (verified 2026-07-27):
//   - pinned study commit: bol-van/zapret2 8a0f53f3cf2c92ddeaa66995ee63a35c1210c410
//   - target commit (v5 binary self-report): d3b3011000f103c5af161cc4e3167e80fd6928a2
//   - target Lua bundle: tests/fixtures-postinstall/opt-zapret2-lua-contents.out
//     (byte-exact match to upstream d3b3011, NFQWS2_COMPAT_VER_REQUIRED=5)
//   - legacy Lua bundle: tests/fixtures/opt-zapret2-lua-contents.out
//     (byte-exact match to upstream 8a0f53f, NFQWS2_COMPAT_VER_REQUIRED=6)

export const PINNED_STUDY_COMMIT = '8a0f53f3cf2c92ddeaa66995ee63a35c1210c410';
export const TARGET_COMMIT = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
export const TARGET_LUA_COMPAT_VER = 5;
export const LEGACY_LUA_COMPAT_VER = 6;

// ---------------------------------------------------------------------------
// Lua function catalog (HINTS ONLY — not a grammar, not a validator).
// Each entry: name + type, so orchestration primitives are never mixed with
// antidpi packet methods.
// ---------------------------------------------------------------------------

// 25 antidpi packet methods — verified as `function name(ctx, desync)` in
// zapret-antidpi.lua at both the pinned study commit and the target bundle.
export const DESYNC_METHODS = Object.freeze([
	'drop', 'send', 'pktmod',
	'http_hostcase', 'http_domcase', 'http_methodeol', 'http_unixeol',
	'wsize', 'wssize', 'syndata', 'tls_client_hello_clone',
	'fake', 'rst',
	'multisplit', 'multidisorder', 'multidisorder_legacy',
	'fakedsplit', 'fakeddisorder', 'hostfakesplit', 'tcpseg',
	'oob', 'udplen', 'dht_dn',
	'synack', 'synack_split',
]);

// Orchestration primitives — verified in zapret-auto.lua (circular, repeater,
// condition, per_instance_condition, stopif) and zapret-lib.lua (orchestrate)
// at both commits. Kept strictly separate from antidpi methods.
export const ORCHESTRA_PRIMITIVES = Object.freeze([
	'circular', 'repeater', 'condition', 'per_instance_condition', 'stopif',
	'orchestrate',
]);

// Helper functions callable via --lua-desync= — verified in zapret-lib.lua.
// (pass/pktdebug/argdebug/posdebug are diagnostic basics; luaexec runs inline
// code; detect_payload_str is a payload detector helper.)
export const LUA_HELPERS = Object.freeze([
	'luaexec', 'detect_payload_str', 'pass', 'pktdebug', 'argdebug', 'posdebug',
]);

export const CATALOG_FUNCTION_TYPES = Object.freeze({
	antidpi: DESYNC_METHODS,
	orchestra: ORCHESTRA_PRIMITIVES,
	helper: LUA_HELPERS,
});

export function catalogFunctionType(name) {
	for (const [type, list] of Object.entries(CATALOG_FUNCTION_TYPES)) {
		if (list.includes(name)) return type;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Blob catalog (HINTS ONLY). Three classes, kept separate:
// ---------------------------------------------------------------------------

// (1) Files shipped with the zapret2 distribution (live under
// /opt/zapret2/bin/ on the target; names per task-confirmed inventory).
// These are FILES, not blob globals — they become blob names only through an
// explicit `--blob=<name>:@<file>` declaration.
export const BLOB_SHIPPED_FILES = Object.freeze([
	'quic_initial.bin',
	'tls_clienthello.bin',
	'tls_clienthello_www_google_com.bin',
	'quic_initial_www_google_com.bin',
	'tls_clienthello_max_ru.bin',
	'stun.bin',
	'quic_initial_dbankcloud_ru.bin',
]);

// (2) C builtin blobs — compiled into the nfqws2 binary (see params.c
// fake_tls_clienthello_default etc.); read but never assigned in Lua.
export const BLOB_C_BUILTIN = Object.freeze([
	'fake_default_tls', 'fake_default_http', 'fake_default_quic',
]);

// (3) Lua-global blob aliases — verified in init_vars.lua of the LEGACY (v6)
// captured bundle (defined via tls_mod(fake_default_tls, ...) / invert_bytes).
// The current v5 target capture does NOT include init_vars.lua, so their
// presence on the current target is NOT captured/proven — hints only.
export const BLOB_LUA_GLOBALS = Object.freeze([
	'tls_google', 'tls_vk', 'tls_sber', 'tls_yandex', 'tls_mail',
	'tls_cloudflare', 'tls_discord', 'tls_youtube',
	'bin_max', 'fake_max',
	'tls_rnd', 'tls_rndsni', 'tls_rnd_google',
	'tls_rnd_dupsid', 'tls_rnd_dupsid_google',
	'tls_padencap', 'tls_padencap_google',
	'fake_inverted_tls',
]);

// Names a `blob=` (or pattern) hint may reference without a local declaration.
export const BLOB_BUILTIN_NAMES = Object.freeze([...BLOB_C_BUILTIN, ...BLOB_LUA_GLOBALS]);

// ---------------------------------------------------------------------------
// Top-level CLI options — extracted from the pinned nfqws2 long_options table
// (nfq2/nfqws.c @8a0f53f, identical at d3b3011). This is manager-owned
// top-level grammar (the C parser owns it; we mirror the NAME LIST for
// unknown-option warnings — we do NOT reinterpret option semantics).
// platform: 'common' | 'windows' (wf-*/nlm-*/ssid-filter exist in the table;
// they are compiled per-platform — marking them avoids false unknown warnings
// on winws2 configs).
// ---------------------------------------------------------------------------
export const TOP_LEVEL_OPTIONS = Object.freeze({
	// daemon / process
	'debug': 'common', 'dry-run': 'common', 'intercept': 'common', 'fuzz': 'common',
	'version': 'common', 'comment': 'common', 'qnum': 'common',
	'bind-fix4': 'common', 'bind-fix6': 'common', 'port': 'common',
	'daemon': 'common', 'chdir': 'common', 'pidfile': 'common',
	'user': 'common', 'uid': 'common',
	// conntrack / server
	'ctrack-timeouts': 'common', 'ctrack-disable': 'common',
	'payload-disable': 'common', 'server': 'common',
	'ipcache-lifetime': 'common', 'ipcache-hostname': 'common',
	'reasm-disable': 'common',
	// marks / sockets
	'fwmark': 'common', 'sockarg': 'common', 'writable': 'common',
	// lua
	'blob': 'common', 'lua-init': 'common', 'lua-gc': 'common',
	'lua-desync': 'common',
	// hostlists / autohostlist
	'hostlist': 'common', 'hostlist-domains': 'common',
	'hostlist-exclude': 'common', 'hostlist-exclude-domains': 'common',
	'hostlist-auto': 'common',
	'hostlist-auto-fail-threshold': 'common', 'hostlist-auto-fail-time': 'common',
	'hostlist-auto-retrans-threshold': 'common', 'hostlist-auto-retrans-maxseq': 'common',
	'hostlist-auto-retrans-reset': 'common', 'hostlist-auto-incoming-maxseq': 'common',
	'hostlist-auto-udp-in': 'common', 'hostlist-auto-udp-out': 'common',
	'hostlist-auto-debug': 'common',
	// profile structure
	'new': 'common', 'skip': 'common', 'name': 'common',
	'template': 'common', 'import': 'common', 'cookie': 'common',
	// filters
	'filter-l3': 'common', 'filter-tcp': 'common', 'filter-udp': 'common',
	'filter-icmp': 'common', 'filter-ipp': 'common', 'filter-l7': 'common',
	'filter-ssid': 'common',
	// ipsets
	'ipset': 'common', 'ipset-ip': 'common',
	'ipset-exclude': 'common', 'ipset-exclude-ip': 'common',
	// payload / ranges
	'payload': 'common', 'in-range': 'common', 'out-range': 'common',
	// windows (winws2) platform options
	'wf-iface': 'windows', 'wf-l3': 'windows',
	'wf-tcp-in': 'windows', 'wf-tcp-out': 'windows',
	'wf-udp-in': 'windows', 'wf-udp-out': 'windows',
	'wf-tcp-empty': 'windows',
	'wf-icmp-in': 'windows', 'wf-icmp-out': 'windows',
	'wf-ipp-in': 'windows', 'wf-ipp-out': 'windows',
	'wf-raw': 'windows', 'wf-raw-part': 'windows', 'wf-raw-filter': 'windows',
	'wf-filter-lan': 'windows', 'wf-filter-loopback': 'windows',
	'wf-save': 'windows', 'wf-dup-check': 'windows',
	'ssid-filter': 'windows', 'nlm-filter': 'windows', 'nlm-list': 'windows',
});

// Options that take a required value (used for the `--option value` form —
// mirrors required_argument in the C table; optional_argument flags accept
// `--option=value` but never consume a following bare token).
export const OPTIONS_REQUIRED_VALUE = Object.freeze(new Set([
	'qnum', 'port', 'pidfile', 'user', 'uid', 'ctrack-timeouts',
	'ipcache-lifetime', 'fwmark', 'sockarg', 'lua-gc',
	'blob', 'lua-init', 'lua-desync',
	'hostlist', 'hostlist-domains', 'hostlist-exclude', 'hostlist-exclude-domains',
	'hostlist-auto', 'hostlist-auto-fail-threshold', 'hostlist-auto-fail-time',
	'hostlist-auto-retrans-threshold', 'hostlist-auto-retrans-maxseq',
	'hostlist-auto-incoming-maxseq', 'hostlist-auto-udp-in', 'hostlist-auto-udp-out',
	'hostlist-auto-debug',
	'name', 'import', 'cookie',
	'filter-l3', 'filter-tcp', 'filter-udp', 'filter-icmp', 'filter-ipp',
	'filter-l7', 'filter-ssid',
	'ipset', 'ipset-ip', 'ipset-exclude', 'ipset-exclude-ip',
	'payload', 'in-range', 'out-range',
	'wf-iface', 'wf-l3', 'wf-tcp-in', 'wf-tcp-out', 'wf-udp-in', 'wf-udp-out',
	'wf-icmp-in', 'wf-icmp-out', 'wf-ipp-in', 'wf-ipp-out',
	'wf-raw', 'wf-raw-part', 'wf-raw-filter', 'wf-filter-lan', 'wf-filter-loopback',
	'wf-save', 'ssid-filter', 'nlm-filter',
]));

// Placeholders used by upstream init scripts inside list values. Must be
// preserved byte-for-byte (they are substituted by the init layer, not by
// nfqws2).
export const KNOWN_PLACEHOLDERS = Object.freeze(['<HOSTLIST>', '<HOSTLIST_NOAUTO>']);
