// semantics.mjs — semantic projection of a StrategyDocument for round-trip
// equality checks.
//
// The projection strips transport bookkeeping (token indexes, source spans,
// offsets, original text, diagnostics, native validation, naming form) and
// keeps the SEMANTIC content: profile structure, names (value only), and
// every option's value/structure. lua-desync entries are compared by their
// opaque raw expression plus the derived catalog hints (hints are a pure
// function of raw, so hint equality follows raw equality).

function projectEntry(e) {
	const out = { option: e.option ?? null, value: e.value === undefined ? null : e.value };
	if (e.elements) out.elements = e.elements;
	if (e.range) out.range = e.range;
	if (e.blobName !== undefined) {
		out.blobName = e.blobName;
		out.blobSource = e.blobSource;
		out.blobSourceType = e.blobSourceType;
	}
	if (e.strayWord) out.strayWord = true;
	return out;
}

export function semanticProjection(model) {
	return {
		version: model.version,
		profiles: model.profiles.map((p) => ({
			index: p.index,
			name: p.name,
			enabled: p.enabled,
			protocol: p.protocol,
			tcpPorts: p.tcpPorts.map(projectEntry),
			udpPorts: p.udpPorts.map(projectEntry),
			l7Filters: p.l7Filters.map(projectEntry),
			payloads: p.payloads.map(projectEntry),
			outboundRanges: p.outboundRanges.map(projectEntry),
			inboundRanges: p.inboundRanges.map(projectEntry),
			hostlists: p.hostlists.map(projectEntry),
			hostlistExcludes: p.hostlistExcludes.map(projectEntry),
			ipsets: p.ipsets.map(projectEntry),
			ipsetExcludes: p.ipsetExcludes.map(projectEntry),
			blobs: p.blobs.map(projectEntry),
			luaInit: p.luaInit.map(projectEntry),
			luaDesync: p.luaDesync.map((e) => ({
				raw: e.raw,
				catalogHints: e.catalogHints,
			})),
			passthroughOptions: p.passthroughOptions.map(projectEntry),
			unknownOptions: p.unknownOptions.map(projectEntry),
		})),
	};
}
