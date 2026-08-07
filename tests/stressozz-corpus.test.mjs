import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateCorpus, SOURCE_COMMIT, SOURCE_REPO } from '../tools/generate-stressozz-corpus.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1));
const packagedPath = join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');

test('git checkout without the pinned object falls back to the verified vendored fixture', () => {
	const dir = mkdtempSync(join(tmpdir(), 'stressozz-empty-git-'));
	try {
		execFileSync('git', ['init', '-q'], { cwd: dir });
		const corpus = generateCorpus(dir);
		assert.equal(corpus.sourceCommit, SOURCE_COMMIT);
		assert.equal(corpus.records.length, 20);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('StressOzz corpus is pinned, complete, lossless and not adapted', () => {
	const corpus = generateCorpus(root);
	assert.equal(corpus.records.length, 20);
	assert.deepEqual(corpus.records.filter((r) => r.feature === 'discord-media').map((r) => r.sourceName), Array.from({ length: 17 }, (_, i) => `Dv${i + 1}`));
	assert.equal(new Set(corpus.records.map((r) => r.id)).size, 20);
	assert.equal(corpus.records.some((r) => r.sourceName === 'Dv18'), false);
	assert.equal(corpus.sourceRepo, SOURCE_REPO);
	assert.equal(corpus.sourceCommit, SOURCE_COMMIT);
	for (const record of corpus.records) {
		assert.ok(record.originalOptions.length);
		assert.equal(record.executionStatus, 'not-adapted');
		assert.equal(record.sourceCommit, SOURCE_COMMIT);
	}
	const voice = corpus.records.find((r) => r.feature === 'discord-voice');
	assert.equal(voice.filters.udpPorts, '19294-19344,50000-50100');
	assert.deepEqual(voice.filters.l7, ['discord', 'stun']);
	assert.ok(voice.originalOptions.includes('--dpi-desync-repeats=6'));
	const finland = corpus.records.find((r) => r.feature === 'discord-finland');
	assert.ok(finland.filters.hostnames.length && finland.filters.ips.length);
	const game = corpus.records.find((r) => r.feature === 'game-filter');
	assert.ok(game.filters.tcpPorts && game.filters.udpPorts);
});

test('StressOzz generation is byte-identical and package contains generated JSON', () => {
	const dir = mkdtempSync(join(tmpdir(), 'stressozz-corpus-'));
	try {
		const generated = join(dir, 'corpus.json');
		execFileSync(process.execPath, ['tools/generate-stressozz-corpus.mjs', generated], { cwd: root });
		const generatedBytes = readFileSync(generated);
		const packagedBytes = readFileSync(packagedPath);
		assert.deepEqual(generatedBytes, packagedBytes);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
