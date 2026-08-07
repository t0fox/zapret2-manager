import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_BASE = '304728c4fb5e49252247d9f80c27becec89cfe41';
const DONOR = '76df521e61acc188be8d9f59fcb67be9da90af02';
const MANIFEST = 'docs/superpowers/reviews/native-clean-import-manifest.md';
const LEDGER_START = '<!-- native-clean-final-ledger:start -->';
const LEDGER_END = '<!-- native-clean-final-ledger:end -->';

const approvedClasses = new Set([
  'contract',
  'plan',
  'provenance',
  'spec',
  'native-test',
  'native-fixture',
  'runtime-module',
  'helper-source',
]);
const approvedStates = new Set(['EXACT', 'ADAPTED', 'LOCAL']);
const forbiddenExact = new Set([
  'docs/superpowers/plans/2026-08-07-sanitizer-launch-ownership-repair.md',
  'tests/native/ratings-helper.compile.test.mjs',
  'zapret2-manager/files/usr/libexec/zapret2-manager/ratings-helper.uc',
  'tests/gate-ucode-compile.test.sh',
  'tests/ucode-no-sugar.test.sh',
  'tools/gate-ucode-compile.sh',
  'tools/run-all-tests.sh',
]);
const forbiddenPrefixes = [
  'artifacts/',
  'build-apk/',
  'screenshots/',
  'tests/browser/',
  'tests/fixtures/gate-samples/tilde-',
  'luci-app-zapret2-manager/',
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio,
  });
}

function normalize(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function nulList(buffer) {
  return buffer.toString().split('\0').filter(Boolean).map(normalize);
}

function optionalBlob(revision, relativePath) {
  try {
    return git(['rev-parse', `${revision}:${relativePath}`], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (error?.status === 128) return null;
    throw error;
  }
}

function parseLedger() {
  const body = fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8');
  const start = body.indexOf(LEDGER_START);
  const end = body.indexOf(LEDGER_END);
  assert.notEqual(start, -1, 'final machine-readable import ledger is missing');
  assert.ok(end > start, 'final machine-readable import ledger is incomplete');
  const payload = body.slice(start + LEDGER_START.length, end).trim()
    .replace(/^```json\s*/, '').replace(/\s*```$/, '');
  const entries = JSON.parse(payload);
  assert.ok(Array.isArray(entries), 'final import ledger must be a JSON array');
  return entries;
}

function fileKind(fullPath) {
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile()) return stat.isSymbolicLink() ? 'symlink' : 'special';
  const header = fs.readFileSync(fullPath).subarray(0, 8);
  if (header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'binary';
  if (header.subarray(0, 2).toString() === 'MZ') return 'binary';
  if (header.includes(0)) return 'binary';
  return 'text';
}

export function inspectCandidate(relativePath, fullPath, { tracked = false, ledgerPaths = new Set() } = {}) {
  const candidate = normalize(relativePath);
  const name = path.posix.basename(candidate);
  const lower = candidate.toLowerCase();
  const violations = [];

  if (forbiddenExact.has(candidate)) violations.push('excluded donor or broad-gate path');
  if (forbiddenPrefixes.some((prefix) => lower.startsWith(prefix))) violations.push('generated or excluded path class');
  if (/(^|\/)tilde-[^/]+$/.test(lower)) violations.push('excluded tilde fixture');
  if (/(^|\/)(?:core(?:\.[^/]*)?|[^/]+\.(?:o|obj|apk|ipk))$/.test(lower)) violations.push('object, package, or core output');
  if (/(^|\/)(?:asan|ubsan|lsan|tsan|msan|saniti[sz]er)(?:[-_.][^/]*)?$/.test(lower) && !tracked)
    violations.push('untracked sanitizer-family output');
  if (fs.existsSync(fullPath) && fileKind(fullPath) !== 'text') violations.push('binary or special file type');
  if (!ledgerPaths.has(candidate)) violations.push('path is not approved by the final import ledger');
  return violations;
}

function repositoryCandidates() {
  const additions = nulList(git(['diff', '-z', '--name-only', '--diff-filter=A', MAIN_BASE], { encoding: 'buffer' }));
  const untracked = nulList(git(['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'buffer' }));
  const ignored = nulList(git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard'], { encoding: 'buffer' }))
    .filter((entry) => /(^|\/)(?:build-apk|screenshots)(\/|$)|\.(?:apk|ipk|o|obj)$|(^|\/)(?:core(?:\.|$)|(?:a|ub|l|t|m)san(?:[-_.]|$)|saniti[sz]er(?:[-_.]|$))/i.test(entry));
  return [...new Set([...additions, ...untracked, ...ignored])].sort();
}

test('main-relative additions have approved classes and verified provenance', () => {
  const entries = parseLedger();
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  assert.equal(byPath.size, entries.length, 'final import ledger paths must be unique');

  const additions = nulList(git(['diff', '-z', '--name-only', '--diff-filter=A', MAIN_BASE], { encoding: 'buffer' }));
  assert.deepEqual([...byPath.keys()].sort(), additions.sort(), 'ledger must cover exactly the main-relative additions');

  for (const entry of entries) {
    assert.ok(approvedClasses.has(entry.class), `${entry.path}: unapproved class ${entry.class}`);
    assert.ok(approvedStates.has(entry.state), `${entry.path}: invalid provenance state ${entry.state}`);
    assert.equal(typeof entry.consumer, 'string', `${entry.path}: consumer must be recorded`);
    assert.notEqual(entry.consumer.trim(), '', `${entry.path}: consumer must be concrete`);
    const headBlob = git(['hash-object', '--', entry.path]).trim();
    const donorBlob = optionalBlob(DONOR, entry.path);
    if (entry.state === 'EXACT') {
      assert.equal(donorBlob, entry.donorBlob, `${entry.path}: donor provenance drift`);
      assert.equal(headBlob, entry.donorBlob, `${entry.path}: exact donor blob drift`);
    }
    if (entry.state === 'ADAPTED') {
      assert.equal(donorBlob, entry.donorBlob, `${entry.path}: donor provenance drift`);
      assert.notEqual(headBlob, donorBlob, `${entry.path}: adapted file unexpectedly equals donor`);
      assert.notEqual(entry.adaptation?.trim(), '', `${entry.path}: adaptation must be explained`);
    }
    if (entry.state === 'LOCAL') {
      assert.equal(entry.donorBlob, null, `${entry.path}: local file cannot claim a donor blob`);
      assert.equal(donorBlob, null, `${entry.path}: donor path exists and must be classified EXACT or ADAPTED`);
    }
  }
});

test('repository candidates exclude generated, binary, donor-history, broad-gate, and UI material', () => {
  const ledgerPaths = new Set(parseLedger().map((entry) => entry.path));
  const tracked = new Set(nulList(git(['ls-files', '-z'], { encoding: 'buffer' })));
  const findings = new Map();
  for (const candidate of repositoryCandidates()) {
    const violations = inspectCandidate(candidate, path.join(ROOT, candidate), { tracked: tracked.has(candidate), ledgerPaths });
    if (violations.length) findings.set(candidate, violations);
  }
  assert.deepEqual(findings, new Map());
});

test('forbidden classes turn the hygiene gate red without a brittle extension blacklist', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-hygiene-'));
  const cases = [
    ['artifacts/run/report.json', Buffer.from('{}'), 'generated or excluded path class'],
    ['build-apk/zapret2.apk', Buffer.from('package'), 'generated or excluded path class'],
    ['screenshots/native.png', Buffer.from('image'), 'generated or excluded path class'],
    ['tests/browser/fixtures/session.json', Buffer.from('{}'), 'generated or excluded path class'],
    ['tests/fixtures/gate-samples/tilde-new.uc', Buffer.from('return 1;'), 'excluded tilde fixture'],
    ['tests/native/ratings-helper.compile.test.mjs', Buffer.from('test'), 'excluded donor or broad-gate path'],
    ['tools/run-all-tests.sh', Buffer.from('#!/bin/sh'), 'excluded donor or broad-gate path'],
    ['luci-app-zapret2-manager/htdocs/view.js', Buffer.from('ui'), 'generated or excluded path class'],
    ['native-helper.o', Buffer.from('object'), 'object, package, or core output'],
    ['core.412', Buffer.from('dump'), 'object, package, or core output'],
    ['sanitizer-report.txt', Buffer.from('report'), 'untracked sanitizer-family output'],
    ['innocent-looking.md', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'binary or special file type'],
  ];
  try {
    for (const [candidate, bytes, expected] of cases) {
      const fullPath = path.join(tempRoot, ...candidate.split('/'));
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, bytes);
      assert.ok(inspectCandidate(candidate, fullPath).includes(expected), `${candidate} must be rejected as ${expected}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime imports and package install references resolve', () => {
  const runtimeRoot = 'zapret2-manager/files/usr/libexec/zapret2-manager';
  const resultPath = `${runtimeRoot}/core/result.uc`;
  const result = fs.readFileSync(path.join(ROOT, resultPath), 'utf8');
  const imports = [...result.matchAll(/from\s+['"](.+?)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports, ['./errors.uc']);
  for (const specifier of imports) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(resultPath), specifier));
    assert.ok(fs.existsSync(path.join(ROOT, resolved)), `${resultPath}: unresolved import ${specifier}`);
  }

  const makefile = fs.readFileSync(path.join(ROOT, 'zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /\$\(CP\) \.\/files\/\* \$\(1\)\//, 'runtime module tree must be installed');
  assert.match(makefile, /\$\(INSTALL_BIN\) \$\(PKG_BUILD_DIR\)\/z2m-core-helper \$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-core-helper/,
    'native helper reference must resolve to its package install path');
  assert.ok(fs.existsSync(path.join(ROOT, 'zapret2-manager/src/z2m-core-helper/main.c')),
    'installed helper must have a source entry point');
});
