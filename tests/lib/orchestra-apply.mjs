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
	if (run.targetType === 'service') throw new Error('domain runs only');
	if (candidate.protocol !== 'tcp_https') throw new Error('tcp_https only');
	const passes = (run.results || []).filter(x => x.candidateId === candidate.id && x.protocol === 'tcp_https' && x.verdict === 'pass' && x.positiveEvidence);
	if (passes.length < 2) throw new Error('two positive HTTPS attempts are required');
	const fragments = String(currentOpt || '').split(/\s+--new(?:=[^\s]+)?\s+/);
	const domain = run.target, profile = `Orchestra_${domain.replace(/[^a-z0-9]/g, '_')}_tcp443`;
	const scoped = `--new=${profile} --filter-tcp=443 --filter-l7=tls --hostlist-domains=${domain} ${candidate.opt}`;
	let replaced = false;
	const next = fragments.map(fragment => {
		if (new RegExp(`--hostlist-domains=${domain.replace('.', '\\.')}(?:\\s|$)`).test(fragment)) { replaced = true; return scoped.replace(/^--new=\S+\s+/, ''); }
		if (/--filter-tcp=443(?:\s|$)/.test(fragment) && /--filter-l7=tls(?:\s|$)/.test(fragment) && !fragment.includes(`--hostlist-exclude-domains=${domain}`)) return `${fragment} --hostlist-exclude-domains=${domain}`;
		return fragment;
	});
	const proposed = replaced ? next.join(' --new ') : `${next.join(' --new ')} ${scoped}`;
	const change = {
		target: domain, protocol: 'tcp_https', currentConfiguration: currentOpt,
		proposedConfiguration: proposed, candidateId: candidate.id, candidateHash: candidate.sanitizedParameterHash,
		sourceRevision: candidate.revision || null, catalogRevision: run.catalogRevision || null,
		currentProfile: { target: domain, present: replaced, configuration: currentOpt },
		proposedProfile: { name: profile, domain, protocol: 'tcp', port: 443, l7: 'tls' },
		targetScope: { domain, protocol: 'tcp_https', port: 443, l7: 'tls' },
		operations: [{ type: replaced ? 'replace-target-profile' : 'create-target-profile', target: domain, tcpPort: 443, tlsScope: true }],
		affected: { files: ['/opt/zapret2/config'], uciSections: ['zapret2.main'] },
		unchangedComponents: ['UDP/QUIC', 'DNS', 'Service DNS', 'Proxy'],
	};
	change.changeHash = createHash('sha256').update(JSON.stringify(change)).digest('hex');
	return change;
}
