import { createHash } from 'node:crypto';

const MANAGER_ONLY = /^(--filter-(?:tcp|udp|l3|l7|icmp|ipp|ssid)(?:=.*)?|--hostlist(?:-.*)?(?:=.*)?|<HOSTLIST(?:_NOAUTO)?>)$/;
const SAFE_TOKEN = /^[A-Za-z0-9_./:=,+#@~<>-]+$/;

export function normalizeStrategyLine(line) {
	return String(line).trim().replace(/\s+/g, ' ');
}

export function compatibility(line, protocol) {
	const normalized = normalizeStrategyLine(line);
	if (!normalized) return { ok: false, reason: 'empty line' };
	if (normalized.startsWith('#')) return { ok: false, reason: 'comment' };
	if (/[;&|`$()\\]/.test(normalized)) return { ok: false, reason: 'shell syntax' };
	if (/<[^>]+>/.test(normalized)) return { ok: false, reason: 'unresolved placeholder' };
	const tokens = normalized.split(' ');
	if (tokens.some(t => !SAFE_TOKEN.test(t))) return { ok: false, reason: 'malformed parameter' };
	const payload = tokens.find(t => t.startsWith('--payload='));
	if (protocol === 'tcp_https' && payload?.split('=')[1] !== 'tls_client_hello') return { ok: false, reason: 'protocol-incompatible payload' };
	if (protocol === 'quic_udp' && payload?.split('=')[1] !== 'quic_initial') return { ok: false, reason: 'protocol-incompatible payload' };
	if (!payload) return { ok: false, reason: 'missing payload' };
	return { ok: true };
}

export function sanitize(line) {
	const removed = [];
	const tokens = normalizeStrategyLine(line).split(' ').filter(Boolean).filter(token => {
		if (MANAGER_ONLY.test(token)) { removed.push(token); return false; }
		return true;
	});
	return { line: tokens.join(' '), removed };
}

export function stableCandidateId(source, protocol, line, revision) {
	const normalized = normalizeStrategyLine(line);
	const hash = createHash('sha256').update(`${source}\n${revision}\n${protocol}\n${normalized}`).digest('hex').slice(0, 16);
	return `c-${source.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${protocol}-${hash}`;
}

export function buildTrustedCorpus(entries) {
	const candidates = [], rejected = [], seen = new Set();
	for (const entry of entries) {
		const raw = normalizeStrategyLine(entry.line);
		if (!raw || raw.startsWith('#')) continue;
		const clean = sanitize(raw);
		const check = compatibility(clean.line, entry.protocol);
		if (!check.ok) { rejected.push({ entry, reason: check.reason }); continue; }
		const hash = createHash('sha256').update(clean.line).digest('hex');
		if (seen.has(hash)) continue;
		seen.add(hash);
		candidates.push({ ...entry, candidateId: stableCandidateId(entry.source, entry.protocol, clean.line, entry.revision), line: clean.line, sanitizedParameterHash: hash, removedManagerOnlyOptions: clean.removed, compatibility: 'compatible' });
	}
	candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
	return { candidates, rejected };
}

export function selectCandidates(candidates, { mode = 'recommended', protocol, candidateIds = [], limit = 20 } = {}) {
	const compatible = candidates.filter(c => c.protocol === protocol && c.compatibility === 'compatible').sort((a, b) => a.candidateId.localeCompare(b.candidateId));
	if (mode === 'selected') {
		const byId = new Map(compatible.map(c => [c.candidateId, c]));
		return candidateIds.map(id => byId.get(id)).filter(Boolean);
	}
	return compatible.slice(0, limit);
}
