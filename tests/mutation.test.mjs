// Mutation testing for test STRENGTH (ЦЕЛЬ fix/06).
// Delegates to tests/mutation-runner.mjs (a PLAIN script) so the child `node --test` is not
// nested inside a parent test runner. This file just runs the runner and asserts
// NO HOLES.
// Run: node --test tests/mutation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const HERE = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const TESTS = new URL('.', import.meta.url).pathname.replace(/^\//, '');
const RUNNER = join(HERE, 'tests/mutation-runner.mjs');

test('mutation testing: no holes (every mandatory mutation reddens its target test)', () => {
	let out, rc;
	try {
		out = execFileSync('node', [RUNNER], {
			cwd: TESTS,
			encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				PATH: process.env.PATH,
				SYSTEMROOT: process.env.SYSTEMROOT,
				USERPROFILE: process.env.USERPROFILE,
				TEMP: process.env.TEMP,
				TMP: process.env.TMP,
				HOME: process.env.HOME
			}
		});
		rc = 0;
	} catch (e) {
		out = e.stdout ? String(e.stdout) : '';
		rc = e.status != null ? e.status : -1;
	}
	const lastLine = String(out).trim().split('\n').pop();
	assert.equal(rc, 0, `mutation runner found holes (rc=${rc}):\n${lastLine}\n---\n${String(out).substring(0, 600)}`);
	assert.match(lastLine, /HOLEs: none/, `runner did not report 'HOLEs: none': ${lastLine}`);
});
