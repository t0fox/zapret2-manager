// parse.mjs — NFQWS2_OPT options string → StrategyDocument.
//
// SCOPE (manager-owned): shell/profile STRUCTURE only.
//   - profile splitting on `--new` / `--new=name` (nfqws.c: IDX_NEW begins a
//     new desync profile; an optional value names it — nfqws.c:2738 @8a0f53f);
//   - `--name=name` names the CURRENT profile (IDX_NAME);
//   - top-level option extraction (filters, ports, payload, ranges, lists,
//     ipsets, blob declarations, lua-init) with source spans;
//   - lossless raw preservation of every token.
//
// `--lua-desync` VALUES ARE OPAQUE. The manager never interprets the
// expression grammar, never decides method validity, never reorders colon
// fragments. catalogHints are UI hints only — not an AST, not a verdict.
//
// The parser never throws on malformed input: it produces a (possibly
// partial) model plus diagnostics. Process-level crashes are a defect.

import { tokenize } from './tokenize.mjs';
import { TOP_LEVEL_OPTIONS, OPTIONS_REQUIRED_VALUE } from './catalog.mjs';
import { serializeCanonical } from './serialize.mjs';

const MODEL_VERSION = 1;

function diag(severity, code, message, tokenIndex = null, profileIndex = null, span = null, related = []) {
	return { severity, code, message, tokenIndex, profileIndex, span, related };
}

// ---------------------------------------------------------------------------
// Top-level structuring helpers (C-grounded grammar — STRUCTURING ONLY; the
// semantic owner is the native C parser. Citations: pinned bol-van/zapret2
// 8a0f53f; identical at target commit d3b3011).
// ---------------------------------------------------------------------------

// Port list element grammar — mirrors pf_parse (nfq2/filter.c:12):
// `*` | [~]N | [~]N-M, N/M decimal 0..65535, N<=M.
export function parsePortElement(raw) {
	const el = { raw, negated: false, star: false, from: null, to: null, valid: false };
	let s = raw;
	if (s === '*') { el.star = true; el.from = 1; el.to = 65535; el.valid = true; return el; }
	if (s.startsWith('~')) { el.negated = true; s = s.slice(1); }
	let m = /^(\d+)-(\d+)$/.exec(s);
	if (m) {
		const lo = Number(m[1]), hi = Number(m[2]);
		if (lo <= 65535 && hi <= 65535 && lo <= hi) { el.from = lo; el.to = hi; el.valid = true; }
		return el;
	}
	m = /^(\d+)$/.exec(s);
	if (m) {
		const p = Number(m[1]);
		if (p <= 65535) { el.from = p; el.to = p; el.valid = true; }
		return el;
	}
	return el;
}

export function parsePortList(raw) {
	return raw.split(',').map(parsePortElement);
}

// Packet range grammar — mirrors packet_range_parse (nfq2/filter.c:126) and
// packet_pos_parse (nfq2/filter.c:115):
//   pos    := ('n'|'d'|'s'|'p'|'b')<digits> | 'a' | 'x'
//   range  := [pos] ('-'|'<') [pos] | '-' | '<' | ('a'|'x')
// Native quirks faithfully mirrored: 'a'/'x' as the from-pos ignores any
// trailing garbage; a parsed to-pos ignores trailing garbage after its digits.
// A BARE NUMERIC operand (digits without a unit prefix) is REJECTED by the
// native parser — we surface that as invalid with bareNumeric=true so the
// diagnostic can say exactly why.
export function parseRangeExpression(raw) {
	const res = {
		raw, valid: false, bareNumeric: false,
		from: null, fromAlways: false, op: null, to: null, toAlways: false,
	};
	if (raw === '') return res;

	const readPos = (s) => {
		let m = /^([ndspb])(\d+)/.exec(s);
		if (m) return { prefix: m[1], num: Number(m[2]) };
		if (s[0] === 'a' || s[0] === 'x') return { prefix: s[0], num: 0 };
		return null;
	};
	const isBareNumeric = (s) => /^\d/.test(s);

	let s = raw;
	if (s[0] === '-' || s[0] === '<') {
		res.fromAlways = true;
		res.op = s[0];
		s = s.slice(1);
		if (s === '') { res.toAlways = true; res.valid = true; return res; }
		const p = readPos(s);
		if (!p) { if (isBareNumeric(s)) res.bareNumeric = true; return res; }
		res.to = p;
		res.valid = true; // native: trailing garbage after to-pos digits ignored
		return res;
	}

	if (s[0] === 'a' || s[0] === 'x') {
		res.from = { prefix: s[0], num: 0 };
		res.to = res.from;
		res.valid = true; // native: 'a'/'x' from-pos ignores the rest
		return res;
	}

	const from = readPos(s);
	if (!from) { if (isBareNumeric(s)) res.bareNumeric = true; return res; }
	res.from = from;
	s = s.slice(1 + String(from.num).length);
	if (s === '') return res; // n/d/s/p/b from-pos without separator: native rejects
	if (s[0] !== '-' && s[0] !== '<') return res;
	res.op = s[0];
	s = s.slice(1);
	if (s === '') { res.toAlways = true; res.valid = true; return res; }
	const to = readPos(s);
	if (!to) { if (isBareNumeric(s)) res.bareNumeric = true; return res; }
	res.to = to;
	res.valid = true;
	return res;
}

// ---------------------------------------------------------------------------
// --lua-desync opaque value + catalog hints (NOT an AST — hints for UI only;
// the serializer never uses them; validity is decided only natively).
// ---------------------------------------------------------------------------

// Colon-fragment split honouring the native `\:` escape (parse_lua_call,
// nfq2/nfqws.c:1394 swallows `\:`). Used ONLY to compute hints.
export function splitUnescapedColons(s) {
	const frags = [];
	let cur = '';
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '\\' && s[i + 1] === ':') { cur += s[i] + s[i + 1]; i++; continue; }
		if (s[i] === ':') { frags.push(cur); cur = ''; continue; }
		cur += s[i];
	}
	frags.push(cur);
	return frags;
}

const BLOB_ARG_KEYS = /^(blob|seqovl_pattern|pattern|fallback)=(.*)$/s;
const NON_NAME_BLOB_REF = /^(0x|#|%)/;

function makeCatalogHints(rawValue) {
	const fragments = splitUnescapedColons(rawValue);
	const referencedBlobs = [];
	for (const frag of fragments.slice(1)) {
		const m = BLOB_ARG_KEYS.exec(frag);
		if (m && m[2] !== '' && !NON_NAME_BLOB_REF.test(m[2])) referencedBlobs.push(m[2]);
	}
	return {
		functionName: fragments[0] ?? '',
		referencedBlobs,
		fragmentCount: fragments.length,
	};
}

export function makeNativeValidationUnchecked() {
	return { status: 'not_checked', diagnostics: [], bundleId: null, nativeVersion: null, luaCompatVer: null };
}

function makeLuaDesyncOpaque(value, token, optionRaw) {
	return {
		raw: value,
		optionRaw,
		sourceSpan: { start: token.start, end: token.end },
		tokenIndex: token.index,
		catalogHints: makeCatalogHints(value),
		nativeValidation: makeNativeValidationUnchecked(),
	};
}

// ---------------------------------------------------------------------------
// Option classification (top-level only).
// ---------------------------------------------------------------------------

const OPTION_CLASSES = {
	'filter-tcp': 'tcpPorts',
	'filter-udp': 'udpPorts',
	'filter-l7': 'l7Filters',
	'payload': 'payloads',
	'out-range': 'outboundRanges',
	'in-range': 'inboundRanges',
	'hostlist': 'hostlists',
	'hostlist-domains': 'hostlists',
	'hostlist-auto': 'hostlists',
	'hostlist-exclude': 'hostlistExcludes',
	'hostlist-exclude-domains': 'hostlistExcludes',
	'ipset': 'ipsets',
	'ipset-ip': 'ipsets',
	'ipset-exclude': 'ipsetExcludes',
	'ipset-exclude-ip': 'ipsetExcludes',
	'blob': 'blobs',
	'lua-init': 'luaInit',
	'lua-desync': 'luaDesync',
};

function baseEntry(option, value, hasEquals, separateForm, token, valueToken = null) {
	return {
		option,
		value,
		hasEquals,
		separateForm,
		tokenIndex: token.index,
		valueTokenIndex: valueToken ? valueToken.index : null,
		sourceSpan: { start: token.start, end: token.end },
	};
}

function makeStructuredEntry(name, option, value, hasEquals, separateForm, token, valueToken = null) {
	const e = baseEntry(option, value, hasEquals, separateForm, token, valueToken);
	switch (OPTION_CLASSES[name]) {
		case 'tcpPorts':
		case 'udpPorts':
			e.elements = parsePortList(value);
			return e;
		case 'outboundRanges':
		case 'inboundRanges':
			e.range = parseRangeExpression(value);
			return e;
		case 'blobs': {
			const idx = value.indexOf(':');
			e.blobName = idx >= 0 ? value.slice(0, idx) : value;
			e.blobSource = idx >= 0 ? value.slice(idx + 1) : null;
			e.blobSourceType = e.blobSource === null ? 'none'
				: e.blobSource.startsWith('0x') ? 'hex'
				: e.blobSource.startsWith('@') ? 'file'
				: e.blobSource.startsWith('+') ? 'offset-file'
				: 'other';
			return e;
		}
		case 'luaDesync':
			return makeLuaDesyncOpaque(value, token, token.raw);
		default:
			return e;
	}
}

// ---------------------------------------------------------------------------
// Parser.
// ---------------------------------------------------------------------------

function newProfile(index, separator) {
	return {
		index,
		name: null,
		nameSource: null, // 'new' | 'name-option' | null
		nameRecords: [],  // every naming event: { value, via, tokenIndex }
		separator,        // null | { form: 'new'|'new-with-name', raw, value, tokenIndex }
		enabled: true,
		protocol: null,   // derived: 'tcp' | 'udp' | 'mixed' | null
		tcpPorts: [],
		udpPorts: [],
		l7Filters: [],
		payloads: [],
		outboundRanges: [],
		inboundRanges: [],
		hostlists: [],
		hostlistExcludes: [],
		ipsets: [],
		ipsetExcludes: [],
		blobs: [],
		luaInit: [],
		luaDesync: [],
		passthroughOptions: [],
		unknownOptions: [],
		originalTokens: [],
		sourceSpan: { start: null, end: null },
	};
}

export function parse(text, options = {}) {
	const { tokens, diagnostics: tokDiags } = tokenize(text);
	const diagnostics = [...tokDiags];
	const profiles = [];

	let current = null;

	const finalize = (p, endOffset) => {
		if (!p) return;
		p.sourceSpan.end = endOffset;
		if (p.originalTokens.length === 0 && p.separator !== null) {
			diagnostics.push(diag('warning', 'MANAGER_EMPTY_PROFILE',
				`profile ${p.index} contains no options`, null, p.index,
				p.separator.span ?? null, []));
		}
		// derived protocol summary
		const hasTcp = p.tcpPorts.length > 0;
		const hasUdp = p.udpPorts.length > 0;
		p.protocol = hasTcp && hasUdp ? 'mixed' : hasTcp ? 'tcp' : hasUdp ? 'udp' : null;
	};

	for (let ti = 0; ti < tokens.length; ti++) {
		const token = tokens[ti];

		if (token.kind === 'option') {
			const body = token.value.slice(2);
			const eq = body.indexOf('=');
			let name = eq >= 0 ? body.slice(0, eq) : body;
			let value = eq >= 0 ? body.slice(eq + 1) : undefined;
			let hasEquals = eq >= 0;
			let separateForm = false;
			let valueToken = null;

			// `--option value` form: only for options the C table marks
			// required_argument, and only when the next token is a bare word.
			if (!hasEquals && OPTIONS_REQUIRED_VALUE.has(name)
				&& ti + 1 < tokens.length && tokens[ti + 1].kind === 'word') {
				ti++;
				valueToken = tokens[ti];
				value = valueToken.value;
				separateForm = true;
			}

			if (name === 'new') {
				// boundary: begin a new profile; an optional value NAMES it
				// (nfqws.c:2738 — upstream ground truth).
				if (current === null) {
					current = newProfile(0, null);
				} else {
					finalize(current, token.start);
				}
				const sep = {
					form: hasEquals ? 'new-with-name' : 'new',
					raw: token.raw,
					value: hasEquals ? value : null,
					tokenIndex: token.index,
					span: { start: token.start, end: token.end },
				};
				if (current.separator !== null || current.originalTokens.length > 0 || current.nameRecords.length > 0) {
					profiles.push(current);
					current = newProfile(profiles.length, sep);
				} else {
					// first token(s) were only separators: attach to the pristine profile
					current.separator = sep;
				}
				token.profileIndex = current.index;
				if (hasEquals) {
					current.nameRecords.push({ value, via: 'new', tokenIndex: token.index });
				}
				continue;
			}

			if (current === null) current = newProfile(0, null);
			token.profileIndex = current.index;
			current.originalTokens.push(token.index);
			if (separateForm) {
				current.originalTokens.push(valueToken.index);
				valueToken.profileIndex = current.index;
			}

			if (name === 'name') {
				const v = hasEquals || separateForm ? value : undefined;
				current.nameRecords.push({ value: v ?? '', via: 'name-option', tokenIndex: token.index, valueTokenIndex: valueToken ? valueToken.index : null });
				continue;
			}
			if (name === 'skip') {
				current.enabled = false;
				current.passthroughOptions.push(baseEntry('--skip', hasEquals ? value : undefined, hasEquals, separateForm, token, valueToken));
				continue;
			}

			const cls = OPTION_CLASSES[name];
			if (cls) {
				const v = hasEquals || separateForm ? value : '';
				current[cls].push(makeStructuredEntry(name, '--' + name, v, hasEquals, separateForm, token, valueToken));
			} else if (name in TOP_LEVEL_OPTIONS) {
				current.passthroughOptions.push(baseEntry('--' + name, hasEquals || separateForm ? value : undefined, hasEquals, separateForm, token, valueToken));
			} else {
				current.unknownOptions.push(baseEntry('--' + name, hasEquals || separateForm ? value : undefined, hasEquals, separateForm, token, valueToken));
			}
			continue;
		}

		// bare word not consumed as a value: preserve it (lossless transport).
		if (current === null) current = newProfile(0, null);
		token.profileIndex = current.index;
		current.originalTokens.push(token.index);
		current.unknownOptions.push({
			option: null,
			value: token.value,
			hasEquals: false,
			separateForm: false,
			strayWord: true,
			tokenIndex: token.index,
			sourceSpan: { start: token.start, end: token.end },
		});
	}

	// finalize last profile; a trailing bare `--new` must NOT silently create
	// an empty profile — fold it into trailingTokens with a diagnostic.
	let trailingTokens = [];
	if (current !== null) {
		if (current.originalTokens.length === 0 && current.nameRecords.length === 0 && current.separator !== null) {
			trailingTokens = [current.separator.tokenIndex];
			diagnostics.push(diag('warning', 'MANAGER_TRAILING_NEW_SEPARATOR',
				'trailing --new starts no profile (preserved as trailing separator)',
				current.separator.tokenIndex, current.index, current.separator.span, []));
		} else {
			finalize(current, text.length);
			profiles.push(current);
		}
	}

	// resolve names (native order semantics: the LAST naming event wins;
	// conflicts between --new=... and --name=... are diagnosed by validate).
	for (const p of profiles) {
		if (p.nameRecords.length > 0) {
			const last = p.nameRecords[p.nameRecords.length - 1];
			p.name = last.value;
			p.nameSource = last.via;
		}
		// fix sourceSpan.start from first token / separator
		const firstTi = p.separator ? p.separator.tokenIndex : (p.originalTokens[0] ?? null);
		p.sourceSpan = {
			start: firstTi !== null ? tokens[firstTi].start : (p.sourceSpan.end ?? 0),
			end: p.sourceSpan.end,
		};
	}

	const model = {
		version: MODEL_VERSION,
		source: options.source ?? null,
		profiles,
		globalOptions: [], // derived view: lua-init entries in document order
		diagnostics,
		originalText: text,
		tokens,
		trailingTokens,
		normalizedText: null,
	};

	for (const p of profiles) {
		for (const e of p.luaInit) {
			model.globalOptions.push({ option: e.option, value: e.value, tokenIndex: e.tokenIndex, profileIndex: p.index });
		}
	}
	model.globalOptions.sort((a, b) => a.tokenIndex - b.tokenIndex);

	model.normalizedText = serializeCanonical(model).text;
	return model;
}
