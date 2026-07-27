// Mutation diagnostics runner (plain script, NOT a node:test file).
// Run standalone:  node tests/mutation-runner.mjs
// For each mutation, stage the patched modules, run the target test file via
// `node --test`, and report which mutations reddened their target test.
// This is a PLAIN script (not a node:test test) so the child `node --test` is
// not nested inside a parent test runner — stdio is captured normally.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const MOD_SRC = {
	'./lib/backup-logic.mjs': readFileSync(new URL('lib/backup-logic.mjs', import.meta.url), 'utf8'),
	'./lib/apply-writer.mjs': readFileSync(new URL('lib/apply-writer.mjs', import.meta.url), 'utf8'),
	'./lib/stripper.mjs': readFileSync(new URL('lib/stripper.mjs', import.meta.url), 'utf8'),
	'./lib/profile-count.mjs': readFileSync(new URL('lib/profile-count.mjs', import.meta.url), 'utf8'),
};
const STEM = {
	'./lib/backup-logic.mjs': 'backup-logic',
	'./lib/apply-writer.mjs': 'apply-writer',
	'./lib/stripper.mjs': 'stripper',
	'./lib/profile-count.mjs': 'profile-count',
};

function stagePatched(mutator) {
	const dir = mkdtempSync(join(tmpdir(), 'z2m-mut-'));
	const urls = {};
	let n = 0;
	for (const k of Object.keys(MOD_SRC)) {
		let src = mutator(k, MOD_SRC[k]);
		if (src == null) src = MOD_SRC[k];
		const stem = STEM[k];
		const fn = join(dir, `${stem}-${n++}.mjs`);
		writeFileSync(fn, src);
		urls[k] = pathToFileURL(fn).href;
	}
	return { dir, urls };
}

function runAgainst(targetTest, urls) {
	const dir = dirname(new URL(Object.values(urls)[0]).pathname.replace(/^\//, ''));
	const testSrc = readFileSync(join(HERE, targetTest), 'utf8');
	let harness = testSrc;
	for (const k of Object.keys(urls))
		harness = harness.split(`from '${k}'`).join(`from '${urls[k]}'`);
	const hp = join(dir, `harness.mjs`);
	writeFileSync(hp, harness);
	let out, rc;
	try {
		out = execFileSync('node', ['--test', hp], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
		rc = 0;
	} catch (e) {
		out = e.stdout ? String(e.stdout) : '';
		rc = (e.status != null) ? e.status : -1;
	}
	const fail = rc === 0 ? 0 : 1;
	const pass = rc === 0 ? +((String(out).match(/ℹ pass\s+(\d+)/) || [, '0'])[1]) : 0;
	try { rmSync(dir, { recursive: true }); } catch (e) { }
	return { name: targetTest, pass, fail, rc, out: String(out).substring(0, 150) };
}

const MUTATIONS = [
	['evict: evict the NEWEST instead of the OLDEST', (k, s) => k === './lib/backup-logic.mjs' ? s.replace('let oldest = 0;', 'let oldest = st.history.length - 1;') : s, 'tests/backup.test.mjs', true],
	['verify: skip the checksum check', (k, s) => k === './lib/backup-logic.mjs' ? s.replace("if (checksum(payload) !== archive.checksum)", "if (false)") : s, 'tests/backup.test.mjs', true],
	['newer-version: accept a newer-version archive', (k, s) => k === './lib/backup-logic.mjs' ? s.replace('if (archive.version > currentVersion) {', 'if (false) {') : s, 'tests/backup.test.mjs', true],
	['one scope: restore one scope also touches another', (k, s) => k === './lib/backup-logic.mjs' ? s.replace('writeFiles(f.path, f.content);', "writeFiles(f.path, f.content); writeFiles('/p/ourState', 'TOUCHED');") : s, 'tests/backup.test.mjs', true],
	['pre-snapshot: do NOT take a pre-restore snapshot', (k, s) => k === './lib/backup-logic.mjs' ? s.replace('if (pre != null) this.store(scope, st.current,', 'if (false) this.store(scope, st.current,') : s, 'tests/backup.test.mjs', true],
	['atomic write: NOOP (test-asserted, no logic mutation)', () => null, 'tests/backup.test.mjs', false],
	['writer quotes: drop the quotes around a single-line quoted value', (k, s) => k === './lib/apply-writer.mjs' ? s.replace("name + '=\"' + value + '\"'", "name + '=' + value") : s, 'tests/apply-writer.test.mjs', true],
	['options multi-line: write the options string split across several lines', (k, s) => k === './lib/apply-writer.mjs' ? s.replace("block = [name + '=\"' + value + '\"'];", "block = (name + '=\"' + value + '\"').split('\\n');") : s, 'tests/apply-writer.test.mjs', true],
	['stripper eat <HOSTLIST>: eat the list placeholder', (k, s) => k === './lib/stripper.mjs' ? s.replace('if (tok.startsWith(TOKEN))', 'if (tok.startsWith(TOKEN) || tok.startsWith("<HOST"))') : s, 'tests/stripper.test.mjs', true],
	['stripper eat --new: eat the profile separator', (k, s) => k === './lib/stripper.mjs' ? s.replace('const TOKEN = \'--lua-desync=\';', "const TOKEN = '--lua-desync=';\nconst _NEW = '--new';\n\t\tif (tok.startsWith(TOKEN) || tok.startsWith(_NEW))") : s, 'tests/stripper.test.mjs', true],
	['profile count: count without the +1 (ignore the first profile)', (k, s) => k === './lib/profile-count.mjs' ? s.replace('return n + 1;', 'return n;') : s, 'tests/profile-count.test.mjs', true],
];

const holes = [];
const rows = [];
for (const [name, mutate, expectRed, isHole] of MUTATIONS) {
	const { dir, urls } = stagePatched(mutate);
	const r = runAgainst(expectRed, urls);
	rows.push(`${name}: ${r.fail > 0 ? 'REDDENED' : 'green'} (rc=${r.rc})`);
	if (isHole && r.fail <= 0) holes.push(name);
}
console.log(rows.join('\n  '));
console.log(`\nHOLEs: ${holes.length === 0 ? 'none' : holes.join('; ')}`);
// process.exit() does NOT flush console.log to a piped stdout; set exitCode and let the
// process exit naturally so the HOLEs line is flushed.
process.exitCode = holes.length === 0 ? 0 : 1;
