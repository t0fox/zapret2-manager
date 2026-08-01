import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileCorpus, compileRecord, COMPILER_VERSION, runIsolatedValidation } from '../tools/compile-stressozz-corpus.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1));
const source = JSON.parse(readFileSync(join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json'), 'utf8'));

test('all StressOzz records receive terminal compatibility status without merging Dv candidates', () => {
	const compiled = compileCorpus(source);
	assert.equal(compiled.records.length, 20);
	assert.equal(compiled.records.filter((r) => r.executionStatus === 'adapted').length + compiled.records.filter((r) => r.executionStatus === 'unsupported').length, 20);
	assert.deepEqual(compiled.records.filter((r) => r.feature === 'discord-media').map((r) => r.candidateId), Array.from({ length: 17 }, (_, i) => `stressozz-discord-media-dv${i + 1}`));
	assert.equal(compiled.records.some((r) => /not-adapted|maybe|partial/i.test(r.executionStatus)), false);
	assert.equal(compiled.compilerVersion, COMPILER_VERSION);
});

test('compiler is deterministic and packaged compiled corpus matches generated output', () => {
	const first = JSON.stringify(compileCorpus(source), null, '\t') + '\n';
	const second = JSON.stringify(compileCorpus(JSON.parse(JSON.stringify(source))), null, '\t') + '\n';
	assert.equal(first, second);
	const dir = mkdtempSync(join(tmpdir(), 'stressozz-compile-'));
	try {
		const output = join(dir, 'compiled.json');
		execFileSync(process.execPath, ['tools/compile-stressozz-corpus.mjs', 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json', output], { cwd: root });
		assert.deepEqual(readFileSync(output), readFileSync(join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json')));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('filters and payload references are preserved exactly', () => {
	const voice = compileRecord(source.records.find((r) => r.feature === 'discord-voice'));
	assert.equal(voice.filters.udpPorts, '19294-19344,50000-50100');
	assert.deepEqual(voice.filters.l7, ['discord', 'stun']);
	assert.deepEqual(voice.requiredPayloads, ['/opt/zapret/files/fake/stun.bin']);
	const game = compileRecord(source.records.find((r) => r.feature === 'game-filter'));
	assert.equal(game.filters.tcpPorts, source.records.find((r) => r.feature === 'game-filter').filters.tcpPorts);
	assert.equal(game.filters.udpPorts, source.records.find((r) => r.feature === 'game-filter').filters.udpPorts);
});

test('unknown primitive, missing payload and malformed fragment are unsupported', () => {
	const base = source.records[0];
	assert.equal(compileRecord({ ...base, originalOptions: ['--dpi-desync=unknown'] }).executionStatus, 'unsupported');
	assert.match(compileRecord({ ...base, originalOptions: ['--dpi-desync=unknown'] }).compatibilityReasons[0], /unsupported primitive/);
	assert.match(compileRecord({ ...base, originalOptions: [], payloadReferences: [] }).compatibilityReasons.join(' '), /missing payload|complete zapret2/);
	assert.equal(compileRecord({ ...base, originalOptions: ['--malformed="'] }).executionStatus, 'unsupported');
});

test('isolated validation always reports cleanup, including timeout', () => {
	const compiled = compileCorpus(source);
	const result = runIsolatedValidation(compiled.records, { execute: () => ({ status: 'unsupported', reason: 'validation timeout', nativeChecked: true, timedOut: true }) });
	assert.equal(result.totalRecords, 20);
	assert.equal(result.cleanup.status, 'completed');
	assert.ok(result.results.every((r) => r.cleanup.status === 'completed'));
});
