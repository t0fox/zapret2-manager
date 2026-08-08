import crypto from 'node:crypto';

const managerOnly = (token) => token === '<HOSTLIST>' || token === '<HOSTLIST_NOAUTO>' || token.startsWith('--filter-') || token.startsWith('--hostlist') || token.startsWith('--ipset=') || token === '--ipset';

export function convertWinws2Line(raw, requestedProtocol, target) {
	const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
	const out = [], removed = [], functions = [], blobs = [];
	for (const token of tokens) {
		if (token.includes('<') || token.includes('>')) {
			if (token.includes('<HOSTLIST')) { removed.push(token); continue; }
			return { ok: false, rejectionReason: 'unresolved placeholder' };
		}
		if (managerOnly(token)) { removed.push(token); continue; }
		if (/^(?:winws2?|winws)\.exe$/i.test(token) || /^[A-Za-z]:[\\/].*\.exe$/i.test(token)) { removed.push(token); continue; }
		if (token.startsWith('--lua-desync=')) {
			const value = token.slice('--lua-desync='.length);
			const fn = value.split(':', 1)[0];
			if (fn && !functions.includes(fn)) functions.push(fn);
			const match = value.match(/(?:^|:)blob=([^:]+)/);
			const fake = value.match(/(?:^|:)fake_blob=([^:]+)/);
			for (const blob of [match?.[1], fake?.[1]]) if (blob && !blobs.includes(blob)) blobs.push(blob);
		}
		out.push(token);
	}
	const parameters = out.join(' ').replace(/\s+/g, ' ').trim();
	if (!parameters || !parameters.includes('--lua-desync=')) return { ok: false, rejectionReason: 'no strategy parameters' };
	const protocol = requestedProtocol || (parameters.includes('quic_initial') ? 'quic_udp' : 'tcp_https');
	if (protocol === 'tcp_https' && /quic_initial|--filter-udp/.test(parameters)) return { ok: false, rejectionReason: 'protocol-incompatible' };
	if (protocol === 'quic_udp' && /tls_client_hello|--filter-tcp/.test(parameters)) return { ok: false, rejectionReason: 'protocol-incompatible' };
	return { ok: true, parameters, removedManagerOnlyOptions: removed, scope: target, protocol, requiredLuaFunctions: functions, requiredBlobs: blobs };
}

export function parseZapret2GuiCatalog(text, sourcePath, sourceRevision) {
	const defs = [];
	let current = null;
	for (const line of String(text).split(/\r?\n/)) {
		const section = line.match(/^\[([^\]]+)\]\s*$/);
		if (section) { if (current) defs.push(current); current = { id: section[1], name: section[1], label: '', sourcePath, sourceRevision, protocol: sourcePath.includes('udp') ? 'quic_udp' : 'tcp_https', lines: [] }; continue; }
		if (!current) continue;
		const key = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.*?)\s*$/);
		if (key && key[1] === 'name') current.name = key[2];
		else if (key && key[1] === 'label') current.label = key[2];
		else if (line.trim().startsWith('--')) current.lines.push(line.trim());
	}
	if (current) defs.push(current);
	return defs;
}

export function buildZapret2GuiCandidates(defs, { installedLua = [], installedBlobs = [] } = {}) {
	const lua = new Set(installedLua), blobs = new Set(installedBlobs), byHash = new Map();
	for (const def of defs) {
		const converted = convertWinws2Line(def.lines.join(' '), def.protocol, 'target');
		const normalizedHash = converted.ok ? crypto.createHash('sha256').update(`${converted.protocol}\n${converted.parameters}`).digest('hex') : null;
		const id = normalizedHash ? `z2gui-${converted.protocol}-${normalizedHash}` : null;
		const missingLua = converted.ok ? converted.requiredLuaFunctions.filter((x) => !lua.has(x)) : [];
		const missingBlobs = converted.ok ? converted.requiredBlobs.filter((x) => !blobs.has(x)) : [];
		const rejectionReason = !converted.ok ? converted.rejectionReason : missingLua.length ? `missing Lua functions: ${missingLua.join(',')}` : missingBlobs.length ? `missing blobs: ${missingBlobs.join(',')}` : null;
		if (!id) continue;
		const existing = byHash.get(normalizedHash);
		const source = { sourcePath: def.sourcePath, sourceRevision: def.sourceRevision, preset: def.name, generator: def.id };
		if (existing) { existing.sources.push(source); continue; }
		const candidate = { id, name: def.name, label: def.label, source: 'zapret2gui', sourcePath: def.sourcePath, sourceRevision: def.sourceRevision, preset: def.name, generator: def.id, protocol: converted.protocol, parameters: converted.parameters, normalizedParameterHash: normalizedHash, requiredLuaFunctions: converted.requiredLuaFunctions, requiredBlobs: converted.requiredBlobs, compatibilityStatus: rejectionReason ? 'incompatible' : 'compatible', rejectionReason, sources: [source] };
		byHash.set(normalizedHash, candidate);
	}
	return [...byHash.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function selectZapret2Gui(mode, candidates, ids = []) {
	if (mode === 'selected') return candidates.filter((c) => ids.includes(c.id));
	if (mode === 'recommended') return candidates.filter((c) => c.compatibilityStatus === 'compatible' && c.label === 'recommended');
	return candidates.filter((c) => c.compatibilityStatus === 'compatible');
}
