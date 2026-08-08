// tests/source-encoding.test.mjs
// Regression test: no source file shall contain NUL bytes, UTF-16 BOM, or invalid UTF-8.
// This guard prevents PowerShell Set-Content UTF-16LE corruption from reaching the repo.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { strict as assert } from 'assert';

const EXTENSIONS = new Set(['.uc', '.js', '.json', '.mjs', '.sh', '.md', '.css']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'build-apk', 'target']);
const ROOT = process.argv[2] || '.';

function walk(dir, files) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, files);
		} else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
			files.push(full);
		}
	}
}

const files = [];
walk(ROOT, files);

let failures = 0;
for (const path of files) {
	const data = readFileSync(path);
	const issues = [];

	if (data.includes(0x00)) issues.push(`NUL bytes: ${data.filter(b => b === 0).length}`);
	if (data[0] === 0xFF && data[1] === 0xFE) issues.push('UTF-16LE BOM');
	if (data[0] === 0xFE && data[1] === 0xFF) issues.push('UTF-16BE BOM');

	try {
		data.toString('utf8');
	} catch (e) {
		issues.push(`invalid UTF-8: ${e.message}`);
	}

	if (issues.length) {
		console.error(`FAIL: ${path} — ${issues.join('; ')}`);
		failures++;
	}
}

assert.strictEqual(failures, 0, `${failures} source file(s) contain invalid encoding`);
console.log(`OK: ${files.length} source files checked, no NUL/UTF-16/invalid-UTF-8 found`);
