// serialize.mjs — StrategyDocument → NFQWS2_OPT options string.
//
// TWO MODES:
//
// 1. PRESERVE — byte-identical reconstruction of the original input.
//    Emits every original token RAW (exact source slice) joined by the exact
//    original gaps, so parse→preserve is a byte-for-byte identity. If any
//    original token would be lost (dropped from the semantic model), the
//    serializer emits MANAGER_LOSSY_ROUNDTRIP (error) naming the lost tokens
//    instead of silently changing the string.
//
// 2. CANONICAL — a documented stable order of the MANAGER-OWNED top-level
//    structure only:
//      --name, lua-init, blob declarations, filters/payload/lists/ranges
//      (grouped), lua-desync (RAW, ORIGINAL ORDER — never reordered, never
//      rewritten: the expression internals are opaque and their order is
//      semantically significant to the native engine), passthrough options,
//      unknown options.
//    If a profile interleaves stateful options with lua-desync entries, the
//    whole profile falls back to original relative order (semantics first).
//    Canonical mode makes no byte-identity promise.

const STATEFUL_OPTION_NAMES = new Set([
	'--filter-l3', '--filter-tcp', '--filter-udp', '--filter-icmp',
	'--filter-ipp', '--filter-l7', '--filter-ssid',
	'--payload', '--out-range', '--in-range',
	'--hostlist', '--hostlist-domains', '--hostlist-auto',
	'--hostlist-exclude', '--hostlist-exclude-domains',
	'--ipset', '--ipset-ip', '--ipset-exclude', '--ipset-exclude-ip',
	'--blob', '--lua-init',
]);

function lossy(message, related) {
	return { severity: 'error', code: 'MANAGER_LOSSY_ROUNDTRIP', message, tokenIndex: null, profileIndex: null, span: null, related };
}

// Collect every token index a profile is responsible for emitting.
function profileTokenIndexes(profile) {
	const idx = new Set();
	if (profile.separator) idx.add(profile.separator.tokenIndex);
	for (const rec of profile.nameRecords ?? []) {
		idx.add(rec.tokenIndex);
		if (rec.valueTokenIndex != null) idx.add(rec.valueTokenIndex);
	}
	const lists = [
		'tcpPorts', 'udpPorts', 'l7Filters', 'payloads',
		'outboundRanges', 'inboundRanges',
		'hostlists', 'hostlistExcludes', 'ipsets', 'ipsetExcludes',
		'blobs', 'luaInit', 'luaDesync', 'passthroughOptions', 'unknownOptions',
	];
	for (const key of lists) {
		for (const e of profile[key] ?? []) {
			idx.add(e.tokenIndex);
			if (e.valueTokenIndex != null) idx.add(e.valueTokenIndex);
		}
	}
	return idx;
}

export function serializePreserve(model) {
	const diagnostics = [];
	const tokens = model.tokens ?? [];
	const original = model.originalText;

	if (original == null || tokens.length === 0 && (original ?? '') !== '') {
		diagnostics.push(lossy('preserve mode requires a parsed model with original tokens', []));
		return { text: original ?? '', diagnostics, mode: 'preserve' };
	}

	// emission set in document order
	const emitted = [];
	for (const profile of model.profiles) {
		const set = profileTokenIndexes(profile);
		for (const i of [...set].sort((a, b) => a - b)) emitted.push(i);
	}
	for (const i of model.trailingTokens ?? []) emitted.push(i);
	emitted.sort((a, b) => a - b);

	const emittedSet = new Set(emitted);
	const lost = [];
	for (const t of tokens) {
		if (!emittedSet.has(t.index)) lost.push(t.index);
	}
	if (lost.length > 0) {
		diagnostics.push(lossy(
			`preserve mode would lose ${lost.length} original token(s): ${lost.join(', ')} — refusing silent loss`,
			lost));
	}

	// Inter-token text (prefix, gaps, suffix) is reproduced exactly ONLY when
	// it is pure whitespace. Non-whitespace content outside token spans has
	// no token to preserve it — reproducing it through a gap would leak
	// dropped content, so it is reported and skipped instead.
	let skippedSegments = 0;
	const gap = (a, b, fallback) => {
		const slice = original.slice(a, b);
		if (/^\s*$/.test(slice)) return slice;
		skippedSegments++;
		return fallback;
	};

	let text = '';
	if (emitted.length === 0) {
		text = /^\s*$/.test(original) ? original : (skippedSegments++, '');
	} else {
		const first = tokens[emitted[0]];
		text += gap(0, first.start, '');
		for (let k = 0; k < emitted.length; k++) {
			const t = tokens[emitted[k]];
			text += t.raw;
			if (k + 1 < emitted.length) {
				const next = tokens[emitted[k + 1]];
				text += next.start >= t.end ? gap(t.end, next.start, ' ') : ' ';
			}
		}
		text += gap(tokens[emitted[emitted.length - 1]].end, original.length, '');
	}
	if (skippedSegments > 0) {
		diagnostics.push(lossy(
			`preserve mode skipped ${skippedSegments} non-whitespace segment(s) outside token spans`,
			lost));
	}

	return { text, diagnostics, mode: 'preserve' };
}

// ---------------------------------------------------------------------------

export function escapeCanonicalValue(value) {
	if (value == null) return '';
	if (!/[\s"'\\]/.test(value)) return value;
	return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function optionLine(option, value, hasValue = true) {
	if (!hasValue || value === undefined) return option;
	return option + '=' + escapeCanonicalValue(value);
}

// A profile must fall back to original relative order when a stateful option
// appears after the first lua-desync entry (native filters are stateful: they
// apply to the instances that follow them).
function needsOrderFallback(profile) {
	if (profile.luaDesync.length === 0) return false;
	const firstDesync = Math.min(...profile.luaDesync.map((e) => e.tokenIndex));
	const groups = [
		...profile.tcpPorts, ...profile.udpPorts, ...profile.l7Filters,
		...profile.payloads, ...profile.outboundRanges, ...profile.inboundRanges,
		...profile.hostlists, ...profile.hostlistExcludes,
		...profile.ipsets, ...profile.ipsetExcludes,
		...profile.blobs, ...profile.luaInit,
		...profile.passthroughOptions.filter((e) => STATEFUL_OPTION_NAMES.has(e.option)),
	];
	return groups.some((e) => e.tokenIndex > firstDesync);
}

function profileInOriginalOrder(profile) {
	const items = [];
	for (const rec of profile.nameRecords ?? []) {
		items.push({ tokenIndex: rec.tokenIndex, line: optionLine('--name', rec.value) });
	}
	const lists = [
		'tcpPorts', 'udpPorts', 'l7Filters', 'payloads',
		'outboundRanges', 'inboundRanges',
		'hostlists', 'hostlistExcludes', 'ipsets', 'ipsetExcludes',
		'blobs', 'luaInit', 'passthroughOptions', 'unknownOptions',
	];
	for (const key of lists) {
		for (const e of profile[key] ?? []) {
			if (e.strayWord) items.push({ tokenIndex: e.tokenIndex, line: e.value });
			else items.push({ tokenIndex: e.tokenIndex, line: optionLine(e.option, e.value, e.value !== undefined) });
		}
	}
	for (const e of profile.luaDesync) {
		items.push({ tokenIndex: e.tokenIndex, line: optionLine('--lua-desync', e.raw) });
	}
	items.sort((a, b) => a.tokenIndex - b.tokenIndex);
	return items.map((i) => i.line);
}

function profileInCanonicalOrder(profile) {
	const lines = [];
	if (profile.nameRecords.length > 0) {
		lines.push(optionLine('--name', profile.name));
	}
	for (const e of profile.luaInit) lines.push(optionLine('--lua-init', e.value));
	for (const e of profile.blobs) lines.push(optionLine('--blob', e.value));
	const groups = [
		profile.tcpPorts, profile.udpPorts, profile.l7Filters, profile.payloads,
		profile.hostlists, profile.hostlistExcludes,
		profile.ipsets, profile.ipsetExcludes,
		profile.outboundRanges, profile.inboundRanges,
	];
	for (const g of groups) for (const e of g) lines.push(optionLine(e.option, e.value));
	// lua-desync: RAW, original order, NEVER rewritten.
	for (const e of [...profile.luaDesync].sort((a, b) => a.tokenIndex - b.tokenIndex)) {
		lines.push(optionLine('--lua-desync', e.raw));
	}
	for (const e of profile.passthroughOptions) lines.push(optionLine(e.option, e.value, e.value !== undefined));
	for (const e of profile.unknownOptions) {
		lines.push(e.strayWord ? e.value : optionLine(e.option, e.value, e.value !== undefined));
	}
	return lines;
}

export function serializeCanonical(model) {
	const lines = [];
	for (const profile of model.profiles) {
		const isFirst = profile.index === 0;
		const empty = profile.originalTokens.length === 0 && profile.nameRecords.length === 0;
		if (!isFirst || empty) {
			// every non-first profile is introduced by a bare `--new`;
			// an empty profile keeps its separator so it still exists.
			if (!isFirst) lines.push('--new');
			else if (profile.separator) lines.push('--new');
		}
		if (empty) continue;
		lines.push(...(needsOrderFallback(profile) ? profileInOriginalOrder(profile) : profileInCanonicalOrder(profile)));
	}
	return { text: lines.join('\n'), diagnostics: [], mode: 'canonical' };
}
