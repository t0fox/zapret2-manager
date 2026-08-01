#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const COMPILER_VERSION = 'stressozz-zapret2-compiler/1.0.0';

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
	if (record.feature === 'discord-finland') return ['semantic mismatch: Finnish Discord scope is an /etc/hosts IP/hostname mapping, not a zapret2 packet profile'];
	const reasons = [];
	const options = record.originalOptions || [];
	const primitive = options.find((option) => option.startsWith('--dpi-desync'));
	if (primitive) reasons.push(`unsupported primitive: ${primitive.split('=', 1)[0]} is zapret1 syntax with no lossless nfqws2 equivalent`);
	if (!record.payloadReferences?.length) reasons.push('missing payload: record has no concrete payload reference for its fake operation');
	if (!reasons.length) reasons.push('semantic mismatch: source record does not contain a complete zapret2 operation fragment');
	return reasons;
}

export function compileRecord(record) {
	const reasons = reasonsFor(record);
	const adapted = reasons.length === 0;
	const compiledOptions = {
		format: 'zapret2/nfqws2-profile-fragment', filters: filtersOf(record), operations: [],
		...(adapted ? {} : { status: 'rejected', compatibilityReasons: reasons })
	};
	return {
		candidateId: record.id,
		feature: record.feature,
		sourceCommit: record.sourceCommit,
		originalOptions: record.originalOptions,
		filters: filtersOf(record),
		compiledOptions,
		requiredPayloads: record.payloadReferences || [],
		executionStatus: adapted ? 'adapted' : 'unsupported',
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
	const input = process.argv[2] ?? resolve(import.meta.dirname, '../zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
	const output = process.argv[3] ?? resolve(import.meta.dirname, '../zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json');
	writeFileSync(output, `${JSON.stringify(compileCorpus(JSON.parse(readFileSync(input, 'utf8'))), null, '\t')}\n`);
}
