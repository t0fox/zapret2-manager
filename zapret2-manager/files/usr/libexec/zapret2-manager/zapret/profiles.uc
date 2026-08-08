'use strict';
// profiles.uc — production lossless reader for the applied NFQWS2_OPT.
//
// Reads the APPLIED options string from /opt/zapret2/config through the
// SANCTIONED reader (apply.uc read_var — the same single-writer module;
// there is no second config reader), tokenizes/parses it LOSSLESSLY, and
// returns the profiles_list wire envelope (schema 1).
//
// BOUNDARY (docs/contracts/strategy-model.md):
//   - the manager parses only shell/profile STRUCTURE and provides lossless
//     transport; --lua-desync values are OPAQUE — the internal Lua grammar is
//     never interpreted, method validity is never decided here;
//   - nativeValidation vocabulary is EXACTLY not_checked | partial | rejected
//     | unavailable. There is NO 'valid' — runtime semantics is never covered
//     without packets. sanitize_native() clamps any out-of-vocabulary status
//     to 'not_checked' so a forged record can never reach the wire;
//   - malformed input is diagnosed and PRESERVED, never erased.
//
// Mirrors (algorithm specs, exercised by the local node self-tests):
//   tests/strategy/lib/tokenize.mjs   (tokenizer + diagnostics)
//   tests/strategy/lib/parse.mjs      (profile split + top-level extraction)
//   tests/strategy/lib/validate.mjs   (MANAGER_* diagnostics)
//   tests/strategy/lib/serialize.mjs  (preserve round-trip)
//   tests/lib/profiles-wire.mjs       (the wire envelope)
// ucode does not run in the build environment; runtime is confirmed on
// target via tools/smoke.sh.

import { readfile, stat, popen } from 'fs';
import { read_var } from './apply.uc';
import { PATHS } from './constants.uc';

const OPT_VAR = 'NFQWS2_OPT';
const WIRE_SCHEMA = 1;
const UPSTREAM_COMMIT_PIN = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';

// ---------------------------------------------------------------------------
// diagnostics helper
// ---------------------------------------------------------------------------
function diag(sev, code, msg, tokenIndex, profileIndex) {
	return {
		severity: sev, code: code, message: msg,
		tokenIndex: tokenIndex, profileIndex: profileIndex
	};
}

// ---------------------------------------------------------------------------
// native validation shell + sanitizer (strategy-model.md §3.4/§3.6)
// ---------------------------------------------------------------------------
const COVERAGE_KEYS = ['cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence', 'runtimeArguments', 'executionPlan'];

function coverage_shell() {
	let c = {};
	for (let i = 0; i < length(COVERAGE_KEYS); i++) c[COVERAGE_KEYS[i]] = 'not_checked';
	return c;
}

function make_native_shell() {
	return {
		status: 'not_checked',
		entryPoint: null,
		coverage: coverage_shell(),
		diagnostics: [],
		bundleId: null,
		nativeVersion: null,
		luaCompatVer: null
	};
}

function is_valid_native_status(s) {
	return (s == 'not_checked' || s == 'partial' || s == 'rejected' || s == 'unavailable');
}

function is_valid_coverage_status(s) {
	return (s == 'not_checked' || s == 'passed' || s == 'failed');
}

// Clamp a nativeValidation record to the honest vocabulary. Any field outside
// the vocabulary (or absent) falls back to the not_checked shell. 'valid' is
// NOT in the vocabulary — a forged record can never pass through.
function sanitize_native(nv) {
	let out = make_native_shell();
	if (type(nv) != 'object' || nv == null) return out;
	if (is_valid_native_status(nv.status)) out.status = nv.status;
	if (nv.entryPoint == 'dry-run' || nv.entryPoint == 'intercept-zero') out.entryPoint = nv.entryPoint;
	if (type(nv.coverage) == 'object' && nv.coverage != null) {
		for (let i = 0; i < length(COVERAGE_KEYS); i++) {
			let k = COVERAGE_KEYS[i];
			if (is_valid_coverage_status(nv.coverage[k])) out.coverage[k] = nv.coverage[k];
		}
	}
	if (type(nv.diagnostics) == 'array') out.diagnostics = nv.diagnostics;
	if (type(nv.bundleId) == 'string') out.bundleId = nv.bundleId;
	if (type(nv.nativeVersion) == 'string') out.nativeVersion = nv.nativeVersion;
	if (type(nv.luaCompatVer) == 'int') out.luaCompatVer = nv.luaCompatVer;
	return out;
}

// ---------------------------------------------------------------------------
// tokenizer (mirrors tests/strategy/lib/tokenize.mjs)
//
// NFQWS2_OPT is a DOUBLE-QUOTED shell assignment, so the options string obeys
// DOUBLE-QUOTE backslash rules: backslash is special ONLY before $ ` " \ and
// newline (line continuation); before any other character it is LITERAL —
// this keeps the native `\:` escape of parse_lua_call intact.
// ---------------------------------------------------------------------------
function is_ws(ch) {
	return (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n');
}

function is_ctrl(code, ch) {
	if (code == 0 || code == 127) return true;
	if (code < 32 && !is_ws(ch)) return true;
	return false;
}

function hex4(code) {
	let h = '0000' + sprintf('%x', code);
	return substr(h, length(h) - 4);
}

// Returns { tokens: [...], diagnostics: [...] }.
// token: { index, kind:'option'|'word', raw, value, quoteStyle, start, end, profileIndex }
function tokenize(text) {
	let tokens = [];
	let diagnostics = [];
	let n = length(text);
	let i = 0;

	while (i < n) {
		let ch0 = substr(text, i, 1);
		if (is_ws(ch0)) { i++; continue; }
		let code0 = ord(ch0);
		if (is_ctrl(code0, ch0)) {
			push(diagnostics, diag('error', 'MANAGER_CONTROL_CHARACTER',
				'control character U+' + hex4(code0) + ' in input (removed)', length(tokens), null));
			i++;
			continue;
		}

		let start = i;
		let value = '';
		let quoteStyle = null;   // null | 'single' | 'double' | 'mixed'
		let unterminated = null;

		while (i < n) {
			let ch = substr(text, i, 1);
			if (is_ws(ch)) break;
			let code = ord(ch);
			if (is_ctrl(code, ch)) {
				// diagnosed and REMOVED; it also terminates the current word so
				// two words never merge across a control byte.
				push(diagnostics, diag('error', 'MANAGER_CONTROL_CHARACTER',
					'control character U+' + hex4(code) + ' in input (removed)', length(tokens), null));
				i++;
				break;
			}

			if (ch == '\\') {
				if (i + 1 >= n) {
					push(diagnostics, diag('error', 'MANAGER_DANGLING_ESCAPE',
						'backslash at end of input (dangling escape, kept literally)', length(tokens), null));
					value += ch;
					i++;
					continue;
				}
				let next = substr(text, i + 1, 1);
				if (next == '\n') { i += 2; continue; }   // line continuation
				if (next == '$' || next == '`' || next == '"' || next == '\\') {
					value += next;
					i += 2;
					continue;
				}
				// double-quote rules: literal backslash (keeps native `\:` intact)
				value += ch;
				i++;
				continue;
			}

			if (ch == "'" || ch == '"') {
				let q = (ch == "'") ? 'single' : 'double';
				if (quoteStyle == null) quoteStyle = q;
				else if (quoteStyle != q) quoteStyle = 'mixed';
				let openAt = i;
				i++;
				let closed = false;
				while (i < n) {
					let c2 = substr(text, i, 1);
					if (c2 == ch) { closed = true; i++; break; }
					if (q == 'double' && c2 == '\\' && i + 1 < n) {
						let nx = substr(text, i + 1, 1);
						if (nx == '\n') { i += 2; continue; }
						if (nx == '$' || nx == '`' || nx == '"' || nx == '\\') {
							value += nx; i += 2; continue;
						}
						value += c2; i++; continue;   // literal backslash kept
					}
					let cc = ord(c2);
					if (cc == 0 || cc == 127 || (cc < 32 && c2 != '\t' && c2 != '\n' && c2 != '\r')) {
						push(diagnostics, diag('error', 'MANAGER_CONTROL_CHARACTER',
							'control character U+' + hex4(cc) + ' inside quotes (skipped)', length(tokens), null));
						i++;
						continue;
					}
					value += c2;
					i++;
				}
				if (!closed) {
					unterminated = q;
					push(diagnostics, diag('error', 'MANAGER_UNTERMINATED_QUOTE',
						'unterminated ' + q + ' quote opened at offset ' + openAt, length(tokens), null));
				}
				continue;
			}

			value += ch;
			i++;
		}

		let end = i;
		let raw = substr(text, start, end - start);
		let kind = (substr(raw, 0, 2) == '--') ? 'option' : 'word';
		let ti = length(tokens);
		push(tokens, {
			index: ti,
			kind: kind,
			raw: raw,
			value: value,
			quoteStyle: quoteStyle,
			start: start,
			end: end,
			profileIndex: null
		});

		if (kind == 'option') {
			// MANAGER_EMPTY_OPTION: value is '--' or starts '--='
			if (value == '--' || substr(value, 0, 3) == '--=') {
				push(diagnostics, diag('error', 'MANAGER_EMPTY_OPTION',
					"empty option name in token '" + raw + "'", ti, null));
			}
		}
	}

	return { tokens: tokens, diagnostics: diagnostics };
}

// ---------------------------------------------------------------------------
// top-level port / range grammar (mirrors parse.mjs; native C grounding:
// pf_parse nfq2/filter.c:12, packet_range_parse filter.c:126)
// ---------------------------------------------------------------------------
function is_digits(s) {
	if (length(s) == 0) return false;
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		if (c < 48 || c > 57) return false;
	}
	return true;
}

function parse_port_element(raw) {
	let el = { raw: raw, negated: false, star: false, from: null, to: null, valid: false };
	let s = raw;
	if (s == '*') { el.star = true; el.from = 1; el.to = 65535; el.valid = true; return el; }
	if (substr(s, 0, 1) == '~') { el.negated = true; s = substr(s, 1); }
	let dash = index(s, '-');
	if (dash > 0) {
		let lo = substr(s, 0, dash);
		let hi = substr(s, dash + 1);
		if (is_digits(lo) && is_digits(hi)) {
			let l = int(lo); let h = int(hi);
			if (l <= 65535 && h <= 65535 && l <= h) {
				el.from = l; el.to = h; el.valid = true;
			}
		}
		return el;
	}
	if (is_digits(s)) {
		let p = int(s);
		if (p <= 65535) { el.from = p; el.to = p; el.valid = true; }
	}
	return el;
}

function parse_port_list(raw) {
	let parts = split(raw, ',');
	let out = [];
	for (let i = 0; i < length(parts); i++) push(out, parse_port_element(parts[i]));
	return out;
}

// pos := ('n'|'d'|'s'|'p'|'b')<digits> | 'a' | 'x'
function range_read_pos(s) {
	if (length(s) == 0) return null;
	let p = substr(s, 0, 1);
	if (p == 'a' || p == 'x') return { prefix: p, num: 0, consumed: 1 };
	if (p != 'n' && p != 'd' && p != 's' && p != 'p' && p != 'b') return null;
	let j = 1;
	while (j < length(s)) {
		let c = ord(substr(s, j, 1));
		if (c < 48 || c > 57) break;
		j++;
	}
	if (j == 1) return null;   // prefix without digits
	let digits = substr(s, 1, j - 1);
	return { prefix: p, num: int(digits), consumed: j };
}

function range_is_bare_numeric(s) {
	if (length(s) == 0) return false;
	let c = ord(substr(s, 0, 1));
	return (c >= 48 && c <= 57);
}

// Mirrors parseRangeExpression (native quirks kept): 'a'/'x' from-pos ignores
// trailing garbage; a parsed to-pos ignores trailing garbage after its digits;
// a BARE NUMERIC operand is rejected by the native parser (bareNumeric=true).
function parse_range_expression(raw) {
	let res = {
		raw: raw, valid: false, bareNumeric: false,
		from: null, fromAlways: false, op: null, to: null, toAlways: false
	};
	if (raw == '') return res;

	let s = raw;
	let c0 = substr(s, 0, 1);
	if (c0 == '-' || c0 == '<') {
		res.fromAlways = true;
		res.op = c0;
		s = substr(s, 1);
		if (s == '') { res.toAlways = true; res.valid = true; return res; }
		let p = range_read_pos(s);
		if (p == null) { if (range_is_bare_numeric(s)) res.bareNumeric = true; return res; }
		res.to = { prefix: p.prefix, num: p.num };
		res.valid = true;   // native: trailing garbage after to-pos digits ignored
		return res;
	}

	if (c0 == 'a' || c0 == 'x') {
		res.from = { prefix: c0, num: 0 };
		res.to = res.from;
		res.valid = true;   // native: 'a'/'x' from-pos ignores the rest
		return res;
	}

	let from = range_read_pos(s);
	if (from == null) { if (range_is_bare_numeric(s)) res.bareNumeric = true; return res; }
	res.from = { prefix: from.prefix, num: from.num };
	s = substr(s, from.consumed);
	if (s == '') return res;   // n/d/s/p/b from-pos without separator: native rejects
	let op = substr(s, 0, 1);
	if (op != '-' && op != '<') return res;
	res.op = op;
	s = substr(s, 1);
	if (s == '') { res.toAlways = true; res.valid = true; return res; }
	let to = range_read_pos(s);
	if (to == null) { if (range_is_bare_numeric(s)) res.bareNumeric = true; return res; }
	res.to = { prefix: to.prefix, num: to.num };
	res.valid = true;
	return res;
}

// ---------------------------------------------------------------------------
// --lua-desync opaque hints (NOT an AST — UI hints only; the serializer never
// uses them; validity is decided only natively)
// ---------------------------------------------------------------------------
function split_unescaped_colons(s) {
	let frags = [];
	let cur = '';
	let i = 0;
	while (i < length(s)) {
		let c = substr(s, i, 1);
		if (c == '\\' && i + 1 < length(s) && substr(s, i + 1, 1) == ':') {
			cur += c + ':';
			i += 2;
			continue;
		}
		if (c == ':') { push(frags, cur); cur = ''; i++; continue; }
		cur += c;
		i++;
	}
	push(frags, cur);
	return frags;
}

function is_blob_arg_key(frag) {
	// (blob|seqovl_pattern|pattern|fallback)=VALUE — manual prefix match
	let eq = index(frag, '=');
	if (eq <= 0) return null;
	let k = substr(frag, 0, eq);
	if (k == 'blob' || k == 'seqovl_pattern' || k == 'pattern' || k == 'fallback') {
		return substr(frag, eq + 1);
	}
	return null;
}

function make_catalog_hints(rawValue) {
	let fragments = split_unescaped_colons(rawValue);
	let referencedBlobs = [];
	for (let i = 1; i < length(fragments); i++) {
		let v = is_blob_arg_key(fragments[i]);
		if (v != null && v != '') {
			let c0 = substr(v, 0, 1);
			// skip 0x…/#…/%… refs (not name references)
			if (c0 != '#' && c0 != '%' && substr(v, 0, 2) != '0x') push(referencedBlobs, v);
		}
	}
	return {
		functionName: (length(fragments) > 0) ? fragments[0] : '',
		referencedBlobs: referencedBlobs,
		fragmentCount: length(fragments)
	};
}

// ---------------------------------------------------------------------------
// option classification catalogs (mirrors catalog.mjs — HINTS ONLY)
// ---------------------------------------------------------------------------
const OPTION_CLASSES = {
	'filter-tcp': 'tcpPorts', 'filter-udp': 'udpPorts', 'filter-l7': 'l7Filters',
	'payload': 'payloads', 'out-range': 'outboundRanges', 'in-range': 'inboundRanges',
	'hostlist': 'hostlists', 'hostlist-domains': 'hostlists', 'hostlist-auto': 'hostlists',
	'hostlist-exclude': 'hostlistExcludes', 'hostlist-exclude-domains': 'hostlistExcludes',
	'ipset': 'ipsets', 'ipset-ip': 'ipsets',
	'ipset-exclude': 'ipsetExcludes', 'ipset-exclude-ip': 'ipsetExcludes',
	'blob': 'blobs', 'lua-init': 'luaInit', 'lua-desync': 'luaDesync'
};

// pinned nfqws2 long_options table (name list for unknown-option warnings)
const TOP_LEVEL_OPTIONS = {
	'debug': 1, 'dry-run': 1, 'intercept': 1, 'fuzz': 1, 'version': 1, 'comment': 1,
	'qnum': 1, 'bind-fix4': 1, 'bind-fix6': 1, 'port': 1, 'daemon': 1, 'chdir': 1,
	'pidfile': 1, 'user': 1, 'uid': 1,
	'ctrack-timeouts': 1, 'ctrack-disable': 1, 'payload-disable': 1, 'server': 1,
	'ipcache-lifetime': 1, 'ipcache-hostname': 1, 'reasm-disable': 1,
	'fwmark': 1, 'sockarg': 1, 'writable': 1,
	'blob': 1, 'lua-init': 1, 'lua-gc': 1, 'lua-desync': 1,
	'hostlist': 1, 'hostlist-domains': 1, 'hostlist-exclude': 1, 'hostlist-exclude-domains': 1,
	'hostlist-auto': 1, 'hostlist-auto-fail-threshold': 1, 'hostlist-auto-fail-time': 1,
	'hostlist-auto-retrans-threshold': 1, 'hostlist-auto-retrans-maxseq': 1,
	'hostlist-auto-retrans-reset': 1, 'hostlist-auto-incoming-maxseq': 1,
	'hostlist-auto-udp-in': 1, 'hostlist-auto-udp-out': 1, 'hostlist-auto-debug': 1,
	'new': 1, 'skip': 1, 'name': 1, 'template': 1, 'import': 1, 'cookie': 1,
	'filter-l3': 1, 'filter-tcp': 1, 'filter-udp': 1, 'filter-icmp': 1, 'filter-ipp': 1,
	'filter-l7': 1, 'filter-ssid': 1,
	'ipset': 1, 'ipset-ip': 1, 'ipset-exclude': 1, 'ipset-exclude-ip': 1,
	'payload': 1, 'in-range': 1, 'out-range': 1,
	'wf-iface': 1, 'wf-l3': 1, 'wf-tcp-in': 1, 'wf-tcp-out': 1, 'wf-udp-in': 1, 'wf-udp-out': 1,
	'wf-tcp-empty': 1, 'wf-icmp-in': 1, 'wf-icmp-out': 1, 'wf-ipp-in': 1, 'wf-ipp-out': 1,
	'wf-raw': 1, 'wf-raw-part': 1, 'wf-raw-filter': 1, 'wf-filter-lan': 1, 'wf-filter-loopback': 1,
	'wf-save': 1, 'wf-dup-check': 1, 'ssid-filter': 1, 'nlm-filter': 1, 'nlm-list': 1
};

const OPTIONS_REQUIRED_VALUE = {
	'qnum': 1, 'port': 1, 'pidfile': 1, 'user': 1, 'uid': 1, 'ctrack-timeouts': 1,
	'ipcache-lifetime': 1, 'fwmark': 1, 'sockarg': 1, 'lua-gc': 1,
	'blob': 1, 'lua-init': 1, 'lua-desync': 1,
	'hostlist': 1, 'hostlist-domains': 1, 'hostlist-exclude': 1, 'hostlist-exclude-domains': 1,
	'hostlist-auto': 1, 'hostlist-auto-fail-threshold': 1, 'hostlist-auto-fail-time': 1,
	'hostlist-auto-retrans-threshold': 1, 'hostlist-auto-retrans-maxseq': 1,
	'hostlist-auto-incoming-maxseq': 1, 'hostlist-auto-udp-in': 1, 'hostlist-auto-udp-out': 1,
	'hostlist-auto-debug': 1,
	'name': 1, 'import': 1, 'cookie': 1,
	'filter-l3': 1, 'filter-tcp': 1, 'filter-udp': 1, 'filter-icmp': 1, 'filter-ipp': 1,
	'filter-l7': 1, 'filter-ssid': 1,
	'ipset': 1, 'ipset-ip': 1, 'ipset-exclude': 1, 'ipset-exclude-ip': 1,
	'payload': 1, 'in-range': 1, 'out-range': 1,
	'wf-iface': 1, 'wf-l3': 1, 'wf-tcp-in': 1, 'wf-tcp-out': 1, 'wf-udp-in': 1, 'wf-udp-out': 1,
	'wf-icmp-in': 1, 'wf-icmp-out': 1, 'wf-ipp-in': 1, 'wf-ipp-out': 1,
	'wf-raw': 1, 'wf-raw-part': 1, 'wf-raw-filter': 1, 'wf-filter-lan': 1, 'wf-filter-loopback': 1,
	'wf-save': 1, 'ssid-filter': 1, 'nlm-filter': 1
};

// hint catalogs (catalog.mjs) — warnings only, never a verdict
const CATALOG_FUNCTIONS = {
	'drop': 1, 'send': 1, 'pktmod': 1,
	'http_hostcase': 1, 'http_domcase': 1, 'http_methodeol': 1, 'http_unixeol': 1,
	'wsize': 1, 'wssize': 1, 'syndata': 1, 'tls_client_hello_clone': 1,
	'fake': 1, 'rst': 1,
	'multisplit': 1, 'multidisorder': 1, 'multidisorder_legacy': 1,
	'fakedsplit': 1, 'fakeddisorder': 1, 'hostfakesplit': 1, 'tcpseg': 1,
	'oob': 1, 'udplen': 1, 'dht_dn': 1,
	'synack': 1, 'synack_split': 1,
	'circular': 1, 'repeater': 1, 'condition': 1, 'per_instance_condition': 1, 'stopif': 1,
	'orchestrate': 1,
	'luaexec': 1, 'detect_payload_str': 1, 'pass': 1, 'pktdebug': 1, 'argdebug': 1, 'posdebug': 1
};

const BLOB_BUILTIN_NAMES = {
	'fake_default_tls': 1, 'fake_default_http': 1, 'fake_default_quic': 1,
	'tls_google': 1, 'tls_vk': 1, 'tls_sber': 1, 'tls_yandex': 1, 'tls_mail': 1,
	'tls_cloudflare': 1, 'tls_discord': 1, 'tls_youtube': 1,
	'bin_max': 1, 'fake_max': 1,
	'tls_rnd': 1, 'tls_rndsni': 1, 'tls_rnd_google': 1,
	'tls_rnd_dupsid': 1, 'tls_rnd_dupsid_google': 1,
	'tls_padencap': 1, 'tls_padencap_google': 1,
	'fake_inverted_tls': 1
};

// ---------------------------------------------------------------------------
// parser (mirrors parse.mjs — shell/profile STRUCTURE only; never throws on
// malformed input: a partial model plus diagnostics is produced)
// ---------------------------------------------------------------------------
function base_entry(option, value, hasEquals, separateForm, token, valueToken) {
	return {
		option: option,
		value: value,
		hasEquals: hasEquals,
		separateForm: separateForm,
		tokenIndex: token.index,
		valueTokenIndex: (valueToken != null) ? valueToken.index : null,
		sourceSpan: { start: token.start, end: token.end }
	};
}

function make_structured_entry(name, option, value, hasEquals, separateForm, token, valueToken) {
	let e = base_entry(option, value, hasEquals, separateForm, token, valueToken);
	let cls = OPTION_CLASSES[name];
	if (cls == 'tcpPorts' || cls == 'udpPorts') {
		e.elements = parse_port_list(value);
		return e;
	}
	if (cls == 'outboundRanges' || cls == 'inboundRanges') {
		e.range = parse_range_expression(value);
		return e;
	}
	if (cls == 'blobs') {
		let idx = index(value, ':');
		e.blobName = (idx >= 0) ? substr(value, 0, idx) : value;
		e.blobSource = (idx >= 0) ? substr(value, idx + 1) : null;
		if (e.blobSource == null) e.blobSourceType = 'none';
		else if (substr(e.blobSource, 0, 2) == '0x') e.blobSourceType = 'hex';
		else if (substr(e.blobSource, 0, 1) == '@') e.blobSourceType = 'file';
		else if (substr(e.blobSource, 0, 1) == '+') e.blobSourceType = 'offset-file';
		else e.blobSourceType = 'other';
		return e;
	}
	if (cls == 'luaDesync') {
		// OPAQUE: raw expression + hints + a not_checked native shell.
		return {
			raw: value,
			optionRaw: token.raw,
			sourceSpan: { start: token.start, end: token.end },
			tokenIndex: token.index,
			valueTokenIndex: (valueToken != null) ? valueToken.index : null,
			catalogHints: make_catalog_hints(value),
			nativeValidation: make_native_shell()
		};
	}
	return e;
}

function new_profile(index, separator) {
	return {
		index: index,
		name: null,
		nameSource: null,
		nameRecords: [],
		separator: separator,
		enabled: true,
		protocol: null,
		tcpPorts: [], udpPorts: [], l7Filters: [], payloads: [],
		outboundRanges: [], inboundRanges: [],
		hostlists: [], hostlistExcludes: [], ipsets: [], ipsetExcludes: [],
		blobs: [], luaInit: [], luaDesync: [],
		passthroughOptions: [], unknownOptions: [],
		originalTokens: [],
		sourceSpan: { start: null, end: null }
	};
}

function finalize_profile(p, endOffset, diagnostics) {
	p.sourceSpan.end = endOffset;
	if (length(p.originalTokens) == 0 && p.separator != null) {
		push(diagnostics, diag('warning', 'MANAGER_EMPTY_PROFILE',
			'profile ' + p.index + ' contains no options', null, p.index));
	}
	let hasTcp = length(p.tcpPorts) > 0;
	let hasUdp = length(p.udpPorts) > 0;
	if (hasTcp && hasUdp) p.protocol = 'mixed';
	else if (hasTcp) p.protocol = 'tcp';
	else if (hasUdp) p.protocol = 'udp';
	else p.protocol = null;
}

function parse_opt(text) {
	let tz = tokenize(text);
	let tokens = tz.tokens;
	let diagnostics = tz.diagnostics;
	let profiles = [];
	let current = null;

	for (let ti = 0; ti < length(tokens); ti++) {
		let token = tokens[ti];

		if (token.kind == 'option') {
			let body = substr(token.value, 2);
			let eq = index(body, '=');
			let name = (eq >= 0) ? substr(body, 0, eq) : body;
			let value = (eq >= 0) ? substr(body, eq + 1) : null;
			let hasEquals = (eq >= 0);
			let separateForm = false;
			let valueToken = null;

			// `--option value` form: only for required_argument options, and
			// only when the next token is a bare word.
			if (!hasEquals && OPTIONS_REQUIRED_VALUE[name] && ti + 1 < length(tokens)
				&& tokens[ti + 1].kind == 'word') {
				ti++;
				valueToken = tokens[ti];
				value = valueToken.value;
				separateForm = true;
			}

			if (name == 'new') {
				// boundary: begin a new profile; an optional value NAMES it
				if (current == null) {
					current = new_profile(0, null);
				} else {
					finalize_profile(current, token.start, diagnostics);
				}
				let sep = {
					form: hasEquals ? 'new-with-name' : 'new',
					raw: token.raw,
					value: hasEquals ? value : null,
					tokenIndex: token.index,
					span: { start: token.start, end: token.end }
				};
				if (current.separator != null || length(current.originalTokens) > 0 || length(current.nameRecords) > 0) {
					push(profiles, current);
					current = new_profile(length(profiles), sep);
				} else {
					// first token(s) were only separators: attach to the pristine profile
					current.separator = sep;
				}
				token.profileIndex = current.index;
				if (hasEquals) {
					push(current.nameRecords, { value: value, via: 'new', tokenIndex: token.index, valueTokenIndex: null });
				}
				continue;
			}

			if (current == null) current = new_profile(0, null);
			token.profileIndex = current.index;
			push(current.originalTokens, token.index);
			if (separateForm) {
				push(current.originalTokens, valueToken.index);
				valueToken.profileIndex = current.index;
			}

			if (name == 'name') {
				let v = (hasEquals || separateForm) ? value : '';
				push(current.nameRecords, { value: v, via: 'name-option', tokenIndex: token.index, valueTokenIndex: (valueToken != null) ? valueToken.index : null });
				continue;
			}
			if (name == 'skip') {
				current.enabled = false;
				push(current.passthroughOptions, base_entry('--skip', hasEquals ? value : null, hasEquals, separateForm, token, valueToken));
				continue;
			}

			let cls = OPTION_CLASSES[name];
			if (cls != null) {
				let v = (hasEquals || separateForm) ? value : '';
				push(current[cls], make_structured_entry(name, '--' + name, v, hasEquals, separateForm, token, valueToken));
			} else if (TOP_LEVEL_OPTIONS[name]) {
				push(current.passthroughOptions, base_entry('--' + name, (hasEquals || separateForm) ? value : null, hasEquals, separateForm, token, valueToken));
			} else {
				push(current.unknownOptions, base_entry('--' + name, (hasEquals || separateForm) ? value : null, hasEquals, separateForm, token, valueToken));
			}
			continue;
		}

		// bare word not consumed as a value: preserve it (lossless transport)
		if (current == null) current = new_profile(0, null);
		token.profileIndex = current.index;
		push(current.originalTokens, token.index);
		let se = base_entry(null, token.value, false, false, token, null);
		se.strayWord = true;
		push(current.unknownOptions, se);
	}

	// finalize last profile; a trailing bare --new folds into trailingTokens
	let trailingTokens = [];
	if (current != null) {
		if (length(current.originalTokens) == 0 && length(current.nameRecords) == 0 && current.separator != null) {
			push(trailingTokens, current.separator.tokenIndex);
			push(diagnostics, diag('warning', 'MANAGER_TRAILING_NEW_SEPARATOR',
				'trailing --new starts no profile (preserved as trailing separator)',
				current.separator.tokenIndex, current.index));
		} else {
			finalize_profile(current, length(text), diagnostics);
			push(profiles, current);
		}
	}

	// resolve names: the LAST naming event wins (native order semantics)
	for (let pi = 0; pi < length(profiles); pi++) {
		let p = profiles[pi];
		if (length(p.nameRecords) > 0) {
			let last = p.nameRecords[length(p.nameRecords) - 1];
			p.name = last.value;
			p.nameSource = last.via;
		}
		let firstTi = null;
		if (p.separator != null) firstTi = p.separator.tokenIndex;
		else if (length(p.originalTokens) > 0) firstTi = p.originalTokens[0];
		p.sourceSpan = {
			start: (firstTi != null) ? tokens[firstTi].start : ((p.sourceSpan.end != null) ? p.sourceSpan.end : 0),
			end: p.sourceSpan.end
		};
	}

	return {
		version: 1,
		source: null,
		profiles: profiles,
		diagnostics: diagnostics,
		originalText: text,
		tokens: tokens,
		trailingTokens: trailingTokens,
		nativeValidation: make_native_shell()
	};
}

// ---------------------------------------------------------------------------
// validate (mirrors validate.mjs — MANAGER-level diagnostics only)
// ---------------------------------------------------------------------------
function validate_manager(model) {
	let out = [];

	// ports / ranges (native exits(1) on failure → severity error)
	for (let pi = 0; pi < length(model.profiles); pi++) {
		let p = model.profiles[pi];
		let portGroups = ['tcpPorts', 'udpPorts'];
		for (let gi = 0; gi < length(portGroups); gi++) {
			let entries = p[portGroups[gi]];
			for (let ei = 0; ei < length(entries); ei++) {
				let e = entries[ei];
				for (let li = 0; li < length(e.elements); li++) {
					let el = e.elements[li];
					if (!el.valid) {
						push(out, diag('error', 'MANAGER_INVALID_TOP_LEVEL_PORT',
							e.option + ": invalid port element '" + el.raw + "' (native grammar: [~]N | [~]N-M | *, 0..65535, lo<=hi — pf_parse)",
							e.tokenIndex, p.index));
					}
				}
			}
		}
		let rangeGroups = ['outboundRanges', 'inboundRanges'];
		for (let gi = 0; gi < length(rangeGroups); gi++) {
			let entries = p[rangeGroups[gi]];
			for (let ei = 0; ei < length(entries); ei++) {
				let e = entries[ei];
				if (!e.range.valid) {
					let why = e.range.bareNumeric
						? 'bare numeric operand — native grammar requires a unit prefix (n/d/s/p/b/a/x), e.g. -n3 instead of -3 (packet_pos_parse)'
						: 'does not match native grammar [(n|a|d|s|p|b|x)<int>](-|<)[(n|a|d|s|p|b|x)<int>] (packet_range_parse)';
					push(out, diag('error', 'MANAGER_INVALID_TOP_LEVEL_RANGE',
						e.option + ": invalid range expression '" + e.range.raw + "': " + why,
						e.tokenIndex, p.index));
				}
			}
		}
	}

	// names: duplicates + conflicting naming events
	let byName = {};
	for (let pi = 0; pi < length(model.profiles); pi++) {
		let p = model.profiles[pi];
		if (p.name != null && p.name != '') {
			if (byName[p.name] != null) {
				push(out, diag('warning', 'MANAGER_DUPLICATE_PROFILE_NAME',
					"profile name '" + p.name + "' is used by profiles " + byName[p.name] + ' and ' + p.index,
					null, p.index));
			} else {
				byName[p.name] = p.index;
			}
		}
		let seen = {};
		let count = 0;
		for (let ri = 0; ri < length(p.nameRecords); ri++) {
			let v = p.nameRecords[ri].value;
			if (!seen[v]) { seen[v] = true; count++; }
		}
		if (count > 1) {
			let desc = '';
			let related = [];
			for (let ri = 0; ri < length(p.nameRecords); ri++) {
				let r = p.nameRecords[ri];
				let form = (r.via == 'new') ? '--new' : '--name';
				if (ri > 0) desc += ' vs ';
				desc += form + "='" + r.value + "'";
				push(related, r.tokenIndex);
			}
			push(out, diag('warning', 'MANAGER_CONFLICTING_PROFILE_NAMES',
				'profile ' + p.index + ' has conflicting names (' + desc + "); native semantics: the last naming event wins ('" + p.name + "'); both forms preserved",
				null, p.index));
		}
	}

	// unknown options / stray words
	for (let pi = 0; pi < length(model.profiles); pi++) {
		let p = model.profiles[pi];
		for (let ei = 0; ei < length(p.unknownOptions); ei++) {
			let e = p.unknownOptions[ei];
			let msg = e.strayWord
				? "stray token '" + e.value + "' is not an option (preserved as-is)"
				: e.option + ' is not in the nfqws2 option table (pinned nfq2/nfqws.c long_options); preserved as-is';
			push(out, diag('warning', 'MANAGER_UNKNOWN_OPTION', msg, e.tokenIndex, p.index));
		}
	}

	// catalog hints → MANAGER_NOT_IN_CATALOG warnings (NOT a validity verdict)
	let declared = {};
	for (let pi = 0; pi < length(model.profiles); pi++) {
		let p = model.profiles[pi];
		for (let bi = 0; bi < length(p.blobs); bi++) {
			if (p.blobs[bi].blobName != null) declared[p.blobs[bi].blobName] = true;
		}
	}
	for (let pi = 0; pi < length(model.profiles); pi++) {
		let p = model.profiles[pi];
		for (let ei = 0; ei < length(p.luaDesync); ei++) {
			let e = p.luaDesync[ei];
			let hints = e.catalogHints;
			if (hints.functionName == '' || !CATALOG_FUNCTIONS[hints.functionName]) {
				let msg = (hints.functionName == '')
					? "--lua-desync has an empty function-name hint; preserved; native validation decides"
					: "--lua-desync function hint '" + hints.functionName + "' is not in the manager catalog; this is NOT a native verdict — the expression is preserved and awaits native validation";
				push(out, diag('warning', 'MANAGER_NOT_IN_CATALOG', msg, e.tokenIndex, p.index));
			}
			for (let ri = 0; ri < length(hints.referencedBlobs); ri++) {
				let ref = hints.referencedBlobs[ri];
				if (!declared[ref] && !BLOB_BUILTIN_NAMES[ref]) {
					push(out, diag('warning', 'MANAGER_NOT_IN_CATALOG',
						"blob hint '" + ref + "' is neither declared with --blob= in this document nor in the manager blob catalog; NOT a native verdict — the expression is preserved and awaits native validation",
						e.tokenIndex, p.index));
				}
			}
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// preserve serializer (mirrors serialize.mjs PRESERVE mode): byte-identical
// reconstruction of the original input; any lost token or non-whitespace
// segment outside token spans is a MANAGER_LOSSY_ROUNDTRIP error — never a
// silent change.
// ---------------------------------------------------------------------------
const PROFILE_LIST_KEYS = ['tcpPorts', 'udpPorts', 'l7Filters', 'payloads',
	'outboundRanges', 'inboundRanges', 'hostlists', 'hostlistExcludes',
	'ipsets', 'ipsetExcludes', 'blobs', 'luaInit', 'luaDesync',
	'passthroughOptions', 'unknownOptions'];

function profile_token_indexes(p, set) {
	if (p.separator != null) set['' + p.separator.tokenIndex] = true;
	for (let ri = 0; ri < length(p.nameRecords); ri++) {
		set['' + p.nameRecords[ri].tokenIndex] = true;
		if (p.nameRecords[ri].valueTokenIndex != null) set['' + p.nameRecords[ri].valueTokenIndex] = true;
	}
	for (let ki = 0; ki < length(PROFILE_LIST_KEYS); ki++) {
		let entries = p[PROFILE_LIST_KEYS[ki]];
		for (let ei = 0; ei < length(entries); ei++) {
			let e = entries[ei];
			set['' + e.tokenIndex] = true;
			if (e.valueTokenIndex != null) set['' + e.valueTokenIndex] = true;
		}
	}
}

function sort_numeric(arr) {
	// insertion sort (n small; avoids comparator-API uncertainty)
	for (let i = 1; i < length(arr); i++) {
		let v = arr[i];
		let j = i - 1;
		while (j >= 0 && arr[j] > v) { arr[j + 1] = arr[j]; j--; }
		arr[j + 1] = v;
	}
	return arr;
}

function is_whitespace_only(s) {
	for (let i = 0; i < length(s); i++) {
		if (!is_ws(substr(s, i, 1))) return false;
	}
	return true;
}

function serialize_preserve(model) {
	let diagnostics = [];
	let tokens = model.tokens;
	let original = model.originalText;

	if (original == null || (length(tokens) == 0 && length(original) > 0)) {
		push(diagnostics, diag('error', 'MANAGER_LOSSY_ROUNDTRIP',
			'preserve mode requires a parsed model with original tokens', null, null));
		return { text: (original != null) ? original : '', diagnostics: diagnostics };
	}

	let emittedSet = {};
	for (let pi = 0; pi < length(model.profiles); pi++) {
		profile_token_indexes(model.profiles[pi], emittedSet);
	}
	for (let ti = 0; ti < length(model.trailingTokens); ti++) {
		emittedSet['' + model.trailingTokens[ti]] = true;
	}

	let emitted = [];
	let lost = [];
	for (let ti = 0; ti < length(tokens); ti++) {
		if (emittedSet['' + tokens[ti].index]) push(emitted, tokens[ti].index);
		else push(lost, tokens[ti].index);
	}
	if (length(lost) > 0) {
		push(diagnostics, diag('error', 'MANAGER_LOSSY_ROUNDTRIP',
			'preserve mode would lose ' + length(lost) + ' original token(s): refusing silent loss', null, null));
	}
	emitted = sort_numeric(emitted);

	// gaps reproduce exactly ONLY when pure whitespace
	let skippedSegments = 0;
	let text = '';
	if (length(emitted) == 0) {
		if (is_whitespace_only(original)) text = original;
		else { skippedSegments++; text = ''; }
	} else {
		let first = tokens[emitted[0]];
		let pre = substr(original, 0, first.start);
		if (is_whitespace_only(pre)) text += pre;
		else skippedSegments++;
		for (let k = 0; k < length(emitted); k++) {
			let t = tokens[emitted[k]];
			text += t.raw;
			if (k + 1 < length(emitted)) {
				let nx = tokens[emitted[k + 1]];
				if (nx.start >= t.end) {
					let gap = substr(original, t.end, nx.start - t.end);
					if (is_whitespace_only(gap)) text += gap;
					else { skippedSegments++; text += ' '; }
				} else {
					text += ' ';
				}
			}
		}
		let lastT = tokens[emitted[length(emitted) - 1]];
		let post = substr(original, lastT.end);
		if (is_whitespace_only(post)) text += post;
		else skippedSegments++;
	}
	if (skippedSegments > 0) {
		push(diagnostics, diag('error', 'MANAGER_LOSSY_ROUNDTRIP',
			'preserve mode skipped ' + skippedSegments + ' non-whitespace segment(s) outside token spans', null, null));
	}

	return { text: text, diagnostics: diagnostics };
}

// ---------------------------------------------------------------------------
// wire envelope (mirrors tests/lib/profiles-wire.mjs — schema 1)
// ---------------------------------------------------------------------------

// profile_fragment(model, profile, optText) — the profile's raw byte-slice:
// from the end of its --new separator (or its first token, for the implicit
// first profile) to its sourceSpan end; surrounding whitespace trimmed. All
// CONTENT bytes (quotes, escapes, placeholders) survive verbatim. Mirrors
// tests/lib/profiles-draft.mjs profileFragment. DECLARED BEFORE profile_out:
// ucode does not hoist function declarations in module mode (the undeclared-
// variable runtime error this caused was found on the target, not locally).
function profile_fragment(model, p, optText) {
	let start;
	if (p.separator != null && p.separator.span != null) start = p.separator.span.end;
	else if (length(p.originalTokens) > 0) start = model.tokens[p.originalTokens[0]].start;
	else start = (p.sourceSpan.start != null) ? p.sourceSpan.start : 0;
	let end = (p.sourceSpan.end != null) ? p.sourceSpan.end : length(optText);
	let frag = substr(optText, start, end - start);
	// trim surrounding whitespace only (content bytes preserved)
	let a = 0;
	while (a < length(frag) && is_ws(substr(frag, a, 1))) a++;
	let b = length(frag);
	while (b > a && is_ws(substr(frag, b - 1, 1))) b--;
	return substr(frag, a, b - a);
}
function option_entry_out(e) {
	let o = { option: e.option, value: e.value, tokenIndex: e.tokenIndex };
	if (e.strayWord) o.strayWord = true;
	if (e.elements != null) {
		let els = [];
		for (let i = 0; i < length(e.elements); i++) {
			let el = e.elements[i];
			push(els, { raw: el.raw, negated: el.negated, star: el.star, from: el.from, to: el.to, valid: el.valid });
		}
		o.elements = els;
	}
	if (e.range != null) {
		o.range = {
			raw: e.range.raw, valid: e.range.valid, bareNumeric: e.range.bareNumeric,
			from: e.range.from, op: e.range.op, to: e.range.to,
			fromAlways: e.range.fromAlways, toAlways: e.range.toAlways
		};
	}
	if (e.blobName != null) {
		o.blobName = e.blobName;
		o.blobSource = e.blobSource;
		o.blobSourceType = e.blobSourceType;
	}
	return o;
}

function entries_out(arr) {
	let out = [];
	for (let i = 0; i < length(arr); i++) push(out, option_entry_out(arr[i]));
	return out;
}

function lua_desync_out(e) {
	return {
		raw: e.raw,
		tokenIndex: e.tokenIndex,
		catalogHints: {
			functionName: e.catalogHints.functionName,
			referencedBlobs: e.catalogHints.referencedBlobs,
			fragmentCount: e.catalogHints.fragmentCount
		},
		nativeValidation: sanitize_native(e.nativeValidation)
	};
}

function profile_out(p, model, optText) {
	let nameRecords = [];
	for (let i = 0; i < length(p.nameRecords); i++) {
		let r = p.nameRecords[i];
		push(nameRecords, { value: r.value, via: r.via, tokenIndex: r.tokenIndex });
	}
	let desync = [];
	for (let i = 0; i < length(p.luaDesync); i++) push(desync, lua_desync_out(p.luaDesync[i]));
	return {
		index: p.index,
		name: p.name,
		nameSource: p.nameSource,
		nameRecords: nameRecords,
		enabled: p.enabled,
		protocol: p.protocol,
		fragment: profile_fragment(model, p, optText),
		tcpPorts: entries_out(p.tcpPorts),
		udpPorts: entries_out(p.udpPorts),
		l7Filters: entries_out(p.l7Filters),
		payloads: entries_out(p.payloads),
		outboundRanges: entries_out(p.outboundRanges),
		inboundRanges: entries_out(p.inboundRanges),
		hostlists: entries_out(p.hostlists),
		hostlistExcludes: entries_out(p.hostlistExcludes),
		ipsets: entries_out(p.ipsets),
		ipsetExcludes: entries_out(p.ipsetExcludes),
		blobs: entries_out(p.blobs),
		luaInit: entries_out(p.luaInit),
		luaDesync: desync,
		passthroughOptions: entries_out(p.passthroughOptions),
		unknownOptions: entries_out(p.unknownOptions),
		sourceSpan: { start: p.sourceSpan.start, end: p.sourceSpan.end }
	};
}

function sha256_file(path) {	let p = popen("sha256sum " + path + " 2>/dev/null | awk '{print $1}'", 'r');
	if (!p) return null;
	let out = trim(p.read('all'));
	p.close();
	return (length(out) == 64) ? out : null;
}

function provenance_block() {
	return {
		source: 'applied',
		reader: 'apply.uc read_var',
		model: 'strategy-model.md v1',
		upstreamCommit: UPSTREAM_COMMIT_PIN,
		configPath: PATHS.applied_conf
	};
}

// profiles_list() → the profiles_list wire envelope (schema 1). Reads the
// APPLIED config through the sanctioned reader only; never writes anything.
export const profiles_list = function() {
	let st = stat(PATHS.applied_conf);
	if (!st) {
		return {
			ok: false,
			schema: WIRE_SCHEMA,
			error: { code: 'ETARGET', message: 'applied config is unreadable or absent' },
			source: { configPath: PATHS.applied_conf, configPresent: false, optPresent: false, optVar: OPT_VAR },
			parseStatus: 'unavailable',
			profileCount: 0,
			profiles: [],
			diagnostics: [],
			roundtrip: { preserve: 'skipped', diagnostics: [] },
			nativeValidation: make_native_shell(),
			provenance: provenance_block()
		};
	}

	let source = {
		configPath: PATHS.applied_conf,
		configPresent: true,
		configMtime: st.mtime,
		configSize: st.size,
		configSha256: sha256_file(PATHS.applied_conf),
		optPresent: false,
		optVar: OPT_VAR
	};

	let opt = read_var(OPT_VAR);
	if (opt == null) {
		return {
			ok: true,
			schema: WIRE_SCHEMA,
			source: source,
			parseStatus: 'unavailable',
			profileCount: 0,
			profiles: [],
			diagnostics: [diag('warning', 'MANAGER_NO_NFQWS2_OPT',
				OPT_VAR + ' is not set in the applied config — no profiles applied', null, null)],
			roundtrip: { preserve: 'skipped', diagnostics: [] },
			nativeValidation: make_native_shell(),
			provenance: provenance_block()
		};
	}
	source.optPresent = true;

	let model = parse_opt(opt);
	model.source = PATHS.applied_conf;

	let diags = [];
	for (let i = 0; i < length(model.diagnostics); i++) push(diags, model.diagnostics[i]);
	let vdiags = validate_manager(model);
	for (let i = 0; i < length(vdiags); i++) push(diags, vdiags[i]);

	let preserve = serialize_preserve(model);
	let preserveIdentical = (preserve.text == model.originalText) && (length(preserve.diagnostics) == 0);

	let hasErrors = false;
	for (let i = 0; i < length(diags); i++) {
		if (diags[i].severity == 'error') { hasErrors = true; break; }
	}

	let profiles = [];
	for (let i = 0; i < length(model.profiles); i++) push(profiles, profile_out(model.profiles[i], model, opt));

	return {
		ok: true,
		schema: WIRE_SCHEMA,
		source: source,
		parseStatus: hasErrors ? 'partial' : 'success',
		profileCount: length(model.profiles),
		profiles: profiles,
		diagnostics: diags,
		roundtrip: {
			preserve: preserveIdentical ? 'identical' : 'lossy',
			diagnostics: preserve.diagnostics
		},
		nativeValidation: sanitize_native(model.nativeValidation),
		provenance: provenance_block()
	};
};

// ---- export aliases for profiles-draft.uc (the draft CRUD layer reuses the
// SAME lossless parser — there is no second parser in the tree) -------------
export const z2m_tokenize = tokenize;
export const z2m_parse = parse_opt;
export const z2m_validate = validate_manager;
export const z2m_fragment = profile_fragment;
