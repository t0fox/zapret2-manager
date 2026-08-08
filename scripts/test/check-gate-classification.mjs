#!/usr/bin/env node
import { readFileSync } from 'node:fs';

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
  for (const [file, count] of failures) unexpected.push({ file, count });
  return { failures, unexpected, missing: [], mismatched: [], ok: unexpected.length === 0 };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-gate-classification.mjs FULL_GATE_LOG');
    process.exit(2);
  }
  const result = classify(readFileSync(path, 'utf8'));
  if (!result.ok) {
    console.error('Repository gate classification failed.');
    if (result.unexpected.length) console.error('Unexpected failures:', JSON.stringify(result.unexpected));
    process.exit(1);
  }
  console.log('Repository gate PASS: all parsed suites are green.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
