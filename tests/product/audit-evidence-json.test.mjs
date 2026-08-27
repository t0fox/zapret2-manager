import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Evidence-integrity regression: every committed machine-readable evidence
// artifact must actually parse as JSON. Catches drift like arithmetic
// expressions accidentally written inside JSON literals.

const ROOT = path.resolve();
const BASE = path.join(ROOT, '.superpowers', 'sdd');

test('all committed evidence JSON files parse cleanly', () => {
	assert.ok(fs.existsSync(BASE), 'evidence base directory must exist');
	const offenders = [];
	(function walk(dir) {
		for (const e of fs.readdirSync(dir)) {
			const p = path.join(dir, e);
			const st = fs.statSync(p);
			if (st.isDirectory()) { walk(p); continue; }
			if (!e.endsWith('.json')) continue;
			try { JSON.parse(fs.readFileSync(p, 'utf8')); }
			catch (err) { offenders.push(`${path.relative(ROOT, p)} :: ${err.message}`); }
		}
	})(BASE);
	assert.deepEqual(offenders, [], `invalid evidence JSON files:\n${offenders.join('\n')}`);
});
