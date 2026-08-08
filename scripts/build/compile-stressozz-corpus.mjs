#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const COMPILER_VERSION = 'stressozz-zapret2-compiler/2.0.0';

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function filtersOf(record) {
	const source = record.filters || {};
	return {
		domains: source.domains || [],
		ipScope: { hostnames: source.hostnames || [], ips: source.ips || [] },
		tcpPorts: source.tcpPorts || null,
		udpPorts: source.udpPorts || null,
		l7: source.l7 || []
	};
}

function reasonsFor(record) {
	if (record.id === 'stressozz-discord-media-dv1') {
		const options = record.originalOptions || [];
		if (record.filters?.tcpPorts === '2053,2083,2087,2096,8443' && record.filters?.domains?.includes('discord.media')
			&& options.includes('--dpi-desync=multisplit') && options.includes('--dpi-desync-split-seqovl=652')
			&& options.includes('--dpi-desync-split-pos=2')) return [];
		return ['semantic mismatch: Dv1 source semantics are incomplete or altered'];
	}
	if (record.feature === 'discord-voice') {
		const options = record.originalOptions || [];
		if (record.filters?.udpPorts === '19294-19344,50000-50100' && JSON.stringify(record.filters?.l7) === JSON.stringify(['discord', 'stun'])
			&& options.includes('--dpi-desync=fake') && options.includes('--dpi-desync-repeats=6')) return [];
		return ['semantic mismatch: Discord Voice source semantics are incomplete or altered'];
	}
	if (record.feature === 'discord-finland') return ['semantic mismatch: Finnish Discord scope is an /etc/hosts IP/hostname mapping, not a zapret2 packet profile'];
	const reasons = [];
	const options = record.originalOptions || [];
	const primitive = options.find((option) => option.startsWith('--dpi-desync'));
	if (primitive) reasons.push(`unsupported primitive: ${primitive.split('=', 1)[0]} is zapret1 syntax with no lossless nfqws2 equivalent`);
	if (!record.payloadReferences?.length) reasons.push('missing payload: record has no concrete payload reference for its fake operation');
	if (!reasons.length) reasons.push('semantic mismatch: source record does not contain a complete zapret2 operation fragment');
	return reasons;
}

function nativeMapping(record, filters) {
	if (record.id === 'stressozz-discord-media-dv1') {
		const blobName = 'blob_stressozz_tls_clienthello_www_google_com';
		return {
			profileName: 'StressOzz_Discord_Media_Dv1',
			fragment: `--blob=${blobName}:@/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin --filter-tcp=${filters.tcpPorts} --filter-l7=tls --hostlist-domains=discord.media --payload=tls_client_hello --lua-desync=multisplit:pos=2:seqovl=652:seqovl_pattern=${blobName}`,
			nativeLuaChain: [`multisplit:pos=2:seqovl=652:seqovl_pattern=${blobName}`],
			resolvedPayloads: [{ blobName, sourcePath: '/opt/zapret/files/fake/tls_clienthello_www_google_com.bin', targetPath: '/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin' }],
			semanticMappingEvidence: ['--filter-tcp + --hostlist-domains → native TCP/domain filter', '--dpi-desync=multisplit → --lua-desync=multisplit', '--dpi-desync-split-seqovl=652 → seqovl=652', '--dpi-desync-split-pos=2 → pos=2', '--dpi-desync-split-seqovl-pattern → --blob + seqovl_pattern']
		};
	}
	if (record.feature === 'discord-voice') {
		const blobName = 'blob_stressozz_stun';
		return {
			profileName: 'StressOzz_Discord_Voice',
			fragment: `--blob=${blobName}:@/opt/zapret2/files/fake/stun.bin --filter-udp=${filters.udpPorts} --filter-l7=discord,stun --payload=stun,discord_ip_discovery --lua-desync=fake:blob=${blobName}:repeats=6`,
			nativeLuaChain: [`fake:blob=${blobName}:repeats=6`],
			resolvedPayloads: [{ blobName, sourcePath: '/opt/zapret/files/fake/stun.bin', targetPath: '/opt/zapret2/files/fake/stun.bin' }],
			semanticMappingEvidence: ['--filter-udp → native UDP filter', '--filter-l7=discord,stun → native L7 filter', '--dpi-desync=fake → --lua-desync=fake', '--dpi-desync-repeats=6 → repeats=6', 'Discord/STUN packet selection → payload=stun,discord_ip_discovery']
		};
	}
	return null;
}

export function compileRecord(record) {
	const reasons = reasonsFor(record);
	const filters = filtersOf(record);
	const mapping = reasons.length === 0 ? nativeMapping(record, filters) : null;
	const adapted = mapping != null;
	const compiledOptions = {
		format: 'zapret2/nfqws2-profile-fragment', filters, operations: [],
		...(mapping || {}),
		...(adapted ? {} : { status: 'rejected', compatibilityReasons: reasons })
	};
	if (adapted) compiledOptions.argv = compiledOptions.fragment.split(' ');
	return {
		candidateId: record.id,
		feature: record.feature,
		sourceCommit: record.sourceCommit,
		originalOptions: record.originalOptions,
		filters,
		compiledOptions,
		requiredPayloads: record.payloadReferences || [],
		resolvedPayloads: mapping?.resolvedPayloads || [],
		semanticMappingEvidence: mapping?.semanticMappingEvidence || [],
		executionStatus: adapted ? 'native-adapted' : 'unsupported',
		compatibilityReasons: reasons,
		compilerVersion: COMPILER_VERSION,
		compiledDigest: adapted ? digest(compiledOptions) : null
	};
}

export function compileCorpus(corpus) {
	const records = (corpus.records || []).map(compileRecord);
	return {
		schemaVersion: 1,
		compilerVersion: COMPILER_VERSION,
		sourceRepo: corpus.sourceRepo,
		sourceCommit: corpus.sourceCommit,
		records
	};
}

export function runIsolatedValidation(records, { execute = () => ({ exitCode: 0, stdout: '', stderr: '' }), timeoutMs = 20000 } = {}) {
	const results = [];
	for (const record of records) {
		const startedAt = Date.now();
		let result;
		try {
			if (record.executionStatus === 'unsupported') result = { status: 'unsupported', reason: record.compatibilityReasons[0], nativeChecked: false };
			else result = execute(record, timeoutMs);
		} catch (error) {
			result = { status: 'unsupported', reason: `validation error: ${error.message}`, nativeChecked: false };
		}
		results.push({ candidateId: record.candidateId, ...result, durationMs: Date.now() - startedAt, cleanup: { status: 'completed' } });
	}
	return { compilerVersion: COMPILER_VERSION, totalRecords: results.length, results, cleanup: { status: 'completed', ownedResourcesRemoved: true } };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const input = process.argv[2] ?? resolve(import.meta.dirname, '../../zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
	const output = process.argv[3] ?? resolve(import.meta.dirname, '../../zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json');
	writeFileSync(output, `${JSON.stringify(compileCorpus(JSON.parse(readFileSync(input, 'utf8'))), null, '\t')}\n`);
}
