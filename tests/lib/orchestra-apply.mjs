import { createHash } from 'node:crypto';

export function targetVerificationDisposition({ probePathCovered, router, lan }) {
	const lanResult = { attempts: Number(lan?.attempts || 0), successes: Number(lan?.successes || 0) };
	const lanOk = lanResult.attempts >= 2 && lanResult.successes >= 2;
	if (probePathCovered === true) {
		const ok = router?.ok === true && lanOk;
		return { ok, rollback: !ok, router: { state: router?.ok === true ? 'passed' : 'failed' }, lan: lanResult };
	}
	return { ok: lanOk, rollback: !lanOk, router: { state: 'not-applicable', reason: 'router-local traffic is outside production scope' }, lan: lanResult };
}

export function buildWinnerChange(run, candidate, currentOpt) {
	if (run?.phase !== 'completed' || !run?.selectedWinner || run.selectedWinner.candidateId !== candidate?.id)
		throw new Error('completed winner is required');
	if (run.target !== 'youtube.com' || candidate.protocol !== 'tcp_https')
		throw new Error('only the verified HTTPS target is eligible');
	const passes = (run.results || []).filter(x => x.candidateId === candidate.id && x.protocol === 'tcp_https' && x.verdict === 'pass' && x.positiveEvidence);
	if (passes.length < 2) throw new Error('two positive HTTPS attempts are required');
	const fragments = String(currentOpt || '').split(/\s+--new(?:=[^\s]+)?\s+/);
	const scoped = `--new=Orchestra_youtube.com --filter-tcp=443 --filter-l7=tls --hostlist-domains=youtube.com ${candidate.opt}`;
	let replaced = false;
	const next = fragments.map(fragment => {
		if (/--hostlist-domains=youtube\.com(?:\s|$)/.test(fragment)) { replaced = true; return scoped.replace(/^--new=\S+\s+/, ''); }
		if (/--filter-tcp=443(?:\s|$)/.test(fragment) && /--filter-l7=tls(?:\s|$)/.test(fragment) && !/--hostlist-exclude-domains=youtube\.com(?:\s|$)/.test(fragment)) return `${fragment} --hostlist-exclude-domains=youtube.com`;
		return fragment;
	});
	const proposed = replaced ? next.join(' --new ') : `${next.join(' --new ')} ${scoped}`;
	const change = {
		target: run.target, protocol: 'tcp_https', currentConfiguration: currentOpt,
		proposedConfiguration: proposed, candidateId: candidate.id, candidateHash: candidate.sanitizedParameterHash,
		sourceRevision: candidate.revision || null, catalogRevision: run.catalogRevision || null,
		currentProfile: { target: 'youtube.com', present: replaced, configuration: currentOpt },
		proposedProfile: { name: 'Orchestra_youtube.com', domain: 'youtube.com', protocol: 'tcp', port: 443, l7: 'tls' },
		targetScope: { domain: 'youtube.com', protocol: 'tcp', port: 443, l7: 'tls' },
		operations: [{ type: replaced ? 'replace-target-profile' : 'create-target-profile', target: 'youtube.com', tcpPort: 443, tlsScope: true }],
		affected: { files: ['/opt/zapret2/config'], uciSections: ['zapret2.main'] },
		unchangedComponents: ['UDP/QUIC', 'DNS', 'Service DNS', 'Proxy'],
	};
	change.changeHash = createHash('sha256').update(JSON.stringify(change)).digest('hex');
	return change;
}
