// blockcheck-logic.mjs — node reference for the blockcheck2 job wrapper
// (SLICE 4). Mirrored by the shipped ucode jobs.uc / blockcheck-run.sh.
//
// The upstream scanner (/opt/zapret2/blockcheck2.sh) is CALLED, never
// reimplemented (architecture §1 invariant). Interface contract (verified by
// reading the pinned upstream script d3b3011):
//   env-driven, BATCH=1 non-interactive:
//     TEST=standard            strategy set under blockcheck2.d
//     DOMAINS="dom1 dom2"      space-separated (URIs allowed)
//     IPVS=4                   IPv4
//     SCANLEVEL=quick|standard|force
//     ENABLE_HTTP/ENABLE_HTTPS_TLS12/ENABLE_HTTPS_TLS13/ENABLE_HTTP3 (0/1)
//     REPEATS=1 PARALLEL=0
//   output: run lines + `!!!!! <testf>: working strategy found for ipv<N>
//     <dom> : <daemon> <strategy> !!!!!` success lines, then a `* SUMMARY`
//     section (and `* COMMON` for multi-domain intersections).
//   SAFETY: the scanner creates its OWN nft table (blockcheck$$) and removes
//     it on INT/unprepare — cancel must send INT, never a raw -9 first.

export const BLOCKCHECK_MODES = ['quick', 'domains', 'full'];

export const BLOCKCHECK_SCANNER = '/opt/zapret2/blockcheck2.sh';

// mode_env(mode) → the fixed env for the runner + timeout. Single source of
// truth for the mode mapping (ucode writes the .env file from this shape).
// Timeouts are EMPIRICALLY grounded (acceptance r-blockcheck-1: a real
// 1-domain quick scan was still mid-strategy-set at 304s on the target —
// each strategy test has up to 2s curl timeouts plus daemon cycles and the
// DNS/port-block preamble). quick must fit that reality.
export function mode_env(mode) {
	switch (mode) {
		case 'quick':
			return { scanlevel: 'quick', enableHttp: 1, enableTls12: 1, enableTls13: 0, enableHttp3: 0, repeats: 1, timeoutSec: 600 };
		case 'domains':
			return { scanlevel: 'standard', enableHttp: 1, enableTls12: 1, enableTls13: 0, enableHttp3: 0, repeats: 1, timeoutSec: 1200 };
		case 'full':
			return { scanlevel: 'force', enableHttp: 1, enableTls12: 1, enableTls13: 1, enableHttp3: 1, repeats: 1, timeoutSec: 2400 };
		default:
			return null;
	}
}

// validate_domains(input) → { ok, domains } | { ok:false, reason }.
// Domains/URIs only; strict charset (defense-in-depth — values are also
// single-quote escaped before reaching the shell); at most 10, total ≤ 512.
const DOMAIN_RE = /^[A-Za-z0-9._~/%+-]+$/;
export function validate_domains(input) {
	if (input == null) return { ok: false, reason: 'missing domains' };
	const list = (Array.isArray(input) ? input : String(input).split(/\s+/))
		.map((d) => String(d).trim()).filter(Boolean);
	if (!list.length) return { ok: false, reason: 'no domains given' };
	if (list.length > 10) return { ok: false, reason: 'too many domains (max 10)' };
	let total = 0;
	for (const d of list) {
		total += d.length + 1;
		if (total > 512) return { ok: false, reason: 'domains too long (total > 512)' };
		if (!DOMAIN_RE.test(d)) return { ok: false, reason: 'invalid characters in domain ' + JSON.stringify(d) };
	}
	return { ok: true, domains: list };
}

// truncate_log(text, maxBytes) — tail-preserving truncation: keep the LAST
// maxBytes bytes, cut at a line boundary, prefix a marker line.
export function truncate_log(text, maxBytes) {
	const s = String(text ?? '');
	if (s.length <= maxBytes) return s;
	const tail = s.slice(s.length - maxBytes);
	const nl = tail.indexOf('\n');
	return '[log truncated to last ' + maxBytes + ' bytes]\n' + (nl >= 0 ? tail.slice(nl + 1) : tail);
}

// parse_summary(logText) → { recommendations:[...], summary:[...], common:[...] }
//
// recommendations: ONLY from the machine-verifiable success lines
//   !!!!! <testf>: working strategy found for ipv<N> <dom> : <daemon> <strategy> !!!!!
// Each carries the raw line as provenance. COMMON-intersection lines are
// listed separately (they are cross-domain strategy rows from the SUMMARY).
// Nothing here is an apply instruction — consumers decide (Review / Save to
// Draft); there is NO automatic apply anywhere in this pipeline.
const SUCCESS_RE = /^!!!!! (\S+): working strategy found for (ipv\d+) (\S+) : (\S+) (.+?) !!!!!\s*$/;
const SUMMARY_ROW_RE = /^(\S+) (ipv\d+) (\S+) : (.+)$/;

export function parse_summary(logText) {
	const lines = String(logText ?? '').split('\n');
	const recommendations = [];
	const summary = [];
	const common = [];
	let section = 'run';
	for (const line of lines) {
		const l = line.replace(/\r$/, '');
		if (/^\* SUMMARY\s*$/.test(l)) { section = 'summary'; continue; }
		if (/^\* COMMON\s*$/.test(l)) { section = 'common'; continue; }
		const m = SUCCESS_RE.exec(l);
		if (m) {
			recommendations.push({
				test: m[1], ipver: m[2], domain: m[3], daemon: m[4],
				strategy: m[5], raw: l
			});
			continue;
		}
		if (section === 'summary' && l.trim()) {
			const r = SUMMARY_ROW_RE.exec(l.trim());
			if (r && !r[4].startsWith('blockcheck optimizes') && !r[4].startsWith('That'))
				summary.push({ test: r[1], ipver: r[2], domain: r[3], result: r[4] });
			continue;
		}
		if (section === 'common' && l.trim()) {
			const r = /^(\S+) (ipv\d+) : (.+)$/.exec(l.trim());
			if (r) common.push({ test: r[1], ipver: r[2], result: r[3] });
		}
	}
	return { recommendations, summary, common };
}

// recommendations_with_provenance(parsed, ctx) — attach provenance to every
// recommendation (source, mode, scanned domains, engine-running flag).
export function recommendations_with_provenance(parsed, ctx) {
	const prov = {
		source: 'upstream blockcheck2.sh',
		mode: ctx.mode,
		domains: ctx.domains || [],
		engineRunning: ctx.engineRunning === true
	};
	return (parsed.recommendations || []).map((r) => ({ ...r, provenance: prov }));
}
