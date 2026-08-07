// Reference model for preset-apply.uc.  Profiles are delimited by --new;
// each raw fragment is retained so unknown options and formatting survive.

function splitProfiles(text) {
	const re = /(^|\s)(--new(?:\s|$))/g;
	const parts = [];
	let cursor = 0;
	let m;
	while ((m = re.exec(text))) {
		parts.push({ start: cursor, end: re.lastIndex });
		cursor = re.lastIndex;
	}
	parts.push({ start: cursor, end: text.length });
	return parts;
}

function optionValues(raw, name) {
	const values = [];
	const re = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '=([^\\s]+)', 'g');
	let m;
	while ((m = re.exec(raw))) values.push(m[1]);
	return values;
}

function domainMatches(target, entry) {
	const cleanTarget = String(target || '').trim().toLowerCase().replace(/^\.+/, '');
	let cleanEntry = String(entry || '').trim().toLowerCase().replace(/^\.+/, '');
	if (cleanEntry.startsWith('*.')) cleanEntry = cleanEntry.slice(2);
	return !!cleanTarget && !!cleanEntry && (cleanTarget === cleanEntry || cleanTarget.endsWith('.' + cleanEntry));
}

function portsContain(values, wanted) {
	return values.some((value) => value.split(',').some((part) => {
		const [a, b] = part.trim().split('-', 2);
		const lo = Number(a), hi = b === undefined ? lo : Number(b);
		return Number.isInteger(lo) && Number.isInteger(hi) && lo <= wanted && wanted <= hi;
	}));
}

export function parsePreset(text) {
	text = String(text || '');
	const first = text.search(/--(?:filter-tcp|filter-udp|wf-udp-out|hostlist|ipset|out-range|filter-l7|payload|new)\b/);
	const preambleEnd = first < 0 ? text.length : first;
	const body = text.slice(preambleEnd);
	const profiles = splitProfiles(body).map((span, index) => {
		const raw = body.slice(span.start, span.end);
		return { index, raw, matchSignature: JSON.stringify({ tcp: optionValues(raw, '--filter-tcp'), udp: optionValues(raw, '--filter-udp'), domains: optionValues(raw, '--hostlist-domains'), hostlist: optionValues(raw, '--hostlist'), ipset: optionValues(raw, '--ipset') }) };
	}).filter((profile) => profile.raw.trim());
	return { preamble: text.slice(0, preambleEnd), profiles, ending: text.endsWith('\n') ? '\n' : '' };
}

export function serializePreset(doc) {
	return doc.preamble + doc.profiles.map((p) => p.raw).join('');
}

function template({ strategy, target, protocol, ipsets }) {
	if (protocol === 'stun_voice') return '--wf-udp-out=443-65535 --filter-l7=stun,discord --payload=stun,discord_ip_discovery ' + strategy + '\n';
	if (protocol === 'udp_games') return '--wf-udp-out=443,50000-65535 --filter-udp=443,50000-65535 ' + (ipsets || []).map((x) => '--ipset=' + x).join(' ') + ' ' + strategy + '\n';
	return '--filter-tcp=443 --hostlist-domains=' + String(target).trim().toLowerCase() + ' --out-range=-d8 ' + strategy + '\n';
}

function replaceStrategy(raw, strategy) {
	const tokens = raw.trim().split(/\s+/);
	const match = ['--filter-tcp=', '--filter-udp=', '--hostlist-domains=', '--hostlist=', '--ipset=', '--wf-udp-out=', '--filter-l7=', '--payload=', '--out-range=', '--in-range='];
	const oldStrategy = ['--lua-desync=', '--dpi-desync=', '--payload=', '--tamper=', '--fooling=', '--split-pos='];
	const kept = tokens.filter((x) => !oldStrategy.some((prefix) => x.startsWith(prefix)) || match.some((prefix) => x.startsWith(prefix)));
	return kept.filter((x) => x !== '--new').join(' ') + ' ' + strategy + (raw.endsWith('--new\n') ? ' --new\n' : '\n');
}

export function applyStrategy({ text, strategy, target = '', protocol = 'tcp_https', ipsets = [] }) {
	const doc = parsePreset(text);
	const candidate = template({ strategy, target, protocol, ipsets });
	const candidateDoc = parsePreset(candidate);
	const sig = candidateDoc.profiles[0].matchSignature;
	let found = doc.profiles.find((p) => p.matchSignature === sig);
	if (!found && protocol === 'tcp_https') {
		found = doc.profiles.find((p) => portsContain(optionValues(p.raw, '--filter-tcp'), 443) && optionValues(p.raw, '--hostlist-domains').some((v) => v.split(',').some((d) => domainMatches(target, d))));
	}
	let operation;
	if (found) {
		const before = found.raw;
		found.raw = replaceStrategy(found.raw, strategy);
		operation = 'updated';
		return { operation, text: serializePreset(doc), preview: { added: [], changed: [before.trim(), found.raw.trim()] } };
	}
	candidateDoc.profiles[0].raw += '--new\n';
	doc.profiles.unshift(candidateDoc.profiles[0]);
	operation = 'created';
	return { operation, text: serializePreset(doc), preview: { added: [candidate.trim()], changed: [] } };
}
