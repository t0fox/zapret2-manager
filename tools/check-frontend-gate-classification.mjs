#!/usr/bin/env node
import { readFileSync } from 'node:fs';

export const ALLOWED_BACKEND_FAILURES = new Map([
  ['flowseal-combo-integration.test.mjs', 2],
  ['stressozz-corpus.test.mjs', 2]
]);

export function parseFailures(text) {
  const failures = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    let match = line.match(/^\s*FILE\s+(.+?\.test\.(?:mjs|sh))\s+cat=\S+\s+pass=\d+\s+fail=(\d+)/);
    if (match && Number(match[2]) > 0) failures.set(match[1].trim(), Number(match[2]));
    match = line.match(/^\s*FILE\s+(.+?\.test\.sh)\s+cat=\S+\s+FAIL/);
    if (match) failures.set(match[1].trim(), 1);
  }
  return failures;
}

export function classify(text) {
  const failures = parseFailures(text);
  const unexpected = [];
  const missing = [];
  const mismatched = [];
  for (const [file, count] of failures) {
    if (!ALLOWED_BACKEND_FAILURES.has(file)) unexpected.push({ file, count });
    else if (ALLOWED_BACKEND_FAILURES.get(file) !== count)
      mismatched.push({ file, expected: ALLOWED_BACKEND_FAILURES.get(file), actual: count });
  }
  for (const [file, count] of ALLOWED_BACKEND_FAILURES) {
    if (!failures.has(file)) missing.push({ file, count });
  }
  return { failures, unexpected, missing, mismatched, ok: unexpected.length === 0 && missing.length === 0 && mismatched.length === 0 };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-frontend-gate-classification.mjs FULL_GATE_LOG');
    process.exit(2);
  }
  const result = classify(readFileSync(path, 'utf8'));
  if (!result.ok) {
    console.error('Frontend completion classification failed.');
    if (result.unexpected.length) console.error('Unexpected failures:', JSON.stringify(result.unexpected));
    if (result.missing.length) console.error('Expected backend failures missing:', JSON.stringify(result.missing));
    if (result.mismatched.length) console.error('Failure counts changed:', JSON.stringify(result.mismatched));
    process.exit(1);
  }
  console.log('Frontend gate PASS: all non-green suites are explicitly classified backend handoff failures.');
  for (const [file, count] of result.failures) console.log(`  BACKEND-HANDOFF ${file}: ${count} failing tests`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
