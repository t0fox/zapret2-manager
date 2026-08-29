import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const source = fs.readFileSync(modulePath, 'utf8');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(ucodeBin);
const fromCommit = 'b'.repeat(40);
const toCommit = 'a'.repeat(40);

const map = {
  files: [
    { sourcePath: 'files/fake/example.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/example.bin' },
    { sourcePath: 'files/fake/no-reason.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/no-reason.bin' },
  ],
};

const installed = { files_sha256: {
  'files/fake/example.bin': '1'.repeat(64),
  'files/fake/no-reason.bin': '2'.repeat(64),
} };

const selected = { files_sha256: {
  'files/fake/no-reason.bin': '3'.repeat(64),
} };

const compare = {
  status: 'behind',
  ahead_by: 2,
  behind_by: 0,
  total_commits: 2,
  commits: [
    { sha: 'c'.repeat(40), commit: { message: 'remove example.bin because fixture reason XYZ' } },
    { sha: 'd'.repeat(40), commit: { message: 'touch unrelated release plumbing' } },
  ],
  files: [
    { filename: 'files/fake/example.bin', status: 'removed', patch: '-fixture bytes' },
    { filename: 'files/fake/no-reason.bin', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
  ],
};

function invoke(compareEvidence = compare, current = selected, previous = installed, selectedMap = map) {
	const expression = `mod.z2k_explain_managed_delta(${JSON.stringify(current)}, ${JSON.stringify(previous)}, ${JSON.stringify(selectedMap)}, "r-test", ${JSON.stringify(compareEvidence)})`;
  const program = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucodeBin, ['-e', program], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function normalize(compareEvidence = compare) {
  const program = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', mod.z2k_normalize_compare_evidence(${JSON.stringify(compareEvidence)}, "${fromCommit}", "${toCommit}")));`;
  const result = spawnSync(ucodeBin, ['-e', program], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function validate(record, rawSize = 128) {
  const program = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', mod.z2k_validate_compare_cache(${JSON.stringify(record)}, "${fromCommit}", "${toCommit}", ${rawSize})));`;
  const result = spawnSync(ucodeBin, ['-e', program], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('compare evidence links an exact removed path to its repository-authored commit reason', { skip: !hasUcode }, () => {
  const delta = invoke();
  assert.equal(delta.removedItems[0].summary, 'remove example.bin because fixture reason XYZ');
  assert.equal(delta.removedItems[0].summarySource, 'repository-compare');
  assert.deepEqual(delta.removedItems[0].explanation, {
    source: 'repository-compare',
    commitSha: 'c'.repeat(40),
    commitSubject: 'remove example.bin because fixture reason XYZ',
    excerpts: ['remove example.bin because fixture reason XYZ'],
    excerptIndexes: [0],
    fullMessageAvailable: true,
    relation: 'basename',
  });
});

test('changing only compare commit text changes the projected summary', { skip: !hasUcode }, () => {
  const changed = structuredClone(compare);
  changed.commits[0].commit.message = 'remove example.bin because second repository explanation';
  const delta = invoke(changed);
  assert.equal(delta.removedItems[0].summary, 'remove example.bin because second repository explanation');
  assert.equal(delta.removedItems[0].summarySource, 'repository-compare');
  assert.deepEqual(delta.removedItems[0].explanation.excerpts, ['remove example.bin because second repository explanation']);
});

test('multiline repository messages are collapsed without losing their factual body', { skip: !hasUcode }, () => {
  const multiline = structuredClone(compare);
  multiline.commits[0].commit.message = 'fix(engine): remove example.bin because fixture reason XYZ\r\n\r\nThe consuming registration was removed too.';
  const value = normalize(multiline);
  assert.equal(value.commits[0].subject, 'fix(engine): remove example.bin because fixture reason XYZ');
  assert.deepEqual(value.commits[0].paragraphs, [
    'fix(engine): remove example.bin because fixture reason XYZ',
    'The consuming registration was removed too.',
  ]);
  assert.equal('body' in value.commits[0], false);
});

test('selects complete relevant paragraphs and one connected explanatory paragraph', { skip: !hasUcode }, () => {
  const structured = structuredClone(compare);
  structured.commits[0].commit.message = [
    'fix(engine): remove example.bin',
    '',
    'ЧТО СНЯТО.',
    'files/fake/example.bin was removed.',
    '',
    'ПОЧЕМУ.',
    'The file is no longer used by the engine.',
    '',
    'UNRELATED.',
    'This paragraph describes another release concern.',
    '',
    'TEST:',
    'git status',
    '',
    'Co-Authored-By: Example <example@example.com>',
  ].join('\n');
  const delta = invoke(structured);
  const explanation = delta.removedItems[0].explanation;
  assert.deepEqual(explanation.excerpts, [
    'ЧТО СНЯТО. files/fake/example.bin was removed.',
    'ПОЧЕМУ. The file is no longer used by the engine.',
  ]);
  assert.equal(explanation.excerpts.join('\n').includes('git status'), false);
  assert.equal(explanation.excerpts.join('\n').includes('Co-Authored-By'), false);
  assert.equal(explanation.excerpts.join('\n').includes('UNRELATED'), false);
});

test('preserves a relevant paragraph beyond the old character limit without ellipsis', { skip: !hasUcode }, () => {
  const longParagraph = 'files/fake/example.bin was removed because ' + 'repository evidence remains complete. '.repeat(80);
  const structured = structuredClone(compare);
  structured.commits[0].commit.message = 'remove example.bin\n\n' + longParagraph;
  const delta = invoke(structured);
  const excerpt = delta.removedItems[0].explanation.excerpts[0];
  assert.equal(excerpt, longParagraph);
  assert.ok(excerpt.length > 1000);
  assert.equal(excerpt.endsWith('...'), false);
});

test('ambiguous or unrelated compare evidence falls back without inventing a reason', { skip: !hasUcode }, () => {
  const noEvidence = structuredClone(compare);
  noEvidence.commits = [{ sha: 'c'.repeat(40), commit: { message: 'update release plumbing' } }];
  const delta = invoke(noEvidence);
  assert.equal(delta.removedItems[0].summary, null);
  assert.equal(delta.removedItems[0].summarySource, null);
  assert.equal(delta.removedItems[0].explanation, null);
});

test('normalized compare cache keeps only bounded repository evidence and detects truncation', { skip: !hasUcode }, () => {
  const value = normalize();
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.repository, 'necronicle/z2k');
  assert.equal(value.fromCommit, fromCommit);
  assert.equal(value.toCommit, toCommit);
  assert.equal(value.files['files/fake/example.bin'].status, 'removed');
  assert.equal(value.files['files/fake/example.bin'].commitEvidence[0].sha, 'c'.repeat(40));
  assert.equal(value.files['files/fake/example.bin'].commitEvidence[0].relation, 'basename');
  assert.deepEqual(value.files['files/fake/example.bin'].commitEvidence[0].excerptIndexes, [0]);
  assert.equal('body' in value.files['files/fake/example.bin'].commitEvidence[0], false);
  assert.equal('subject' in value.files['files/fake/example.bin'].commitEvidence[0], false);
  assert.equal(value.commits[0].paragraphs.length, 1);

  const truncated = structuredClone(compare);
  truncated.total_commits = 251;
  truncated.commits = truncated.commits.slice(0, 250);
  assert.equal(normalize(truncated), null);
});

test('corrupt, mismatched, and oversized compare cache records are cache misses', { skip: !hasUcode }, () => {
  const evidence = normalize();
  const record = { schemaVersion: 2, repository: 'necronicle/z2k', fromCommit, toCommit, fetchedAt: 1, cooldownUntil: 0, evidence };
  assert.ok(validate(record));
  assert.equal(validate({ ...record, fromCommit: 'c'.repeat(40) }), null);
  assert.equal(validate({ ...record, evidence: { ...evidence, files: { bad: true } } }), null);
  assert.equal(validate(record, 256 * 1024 + 1), null);
});

test('fifty managed resources consume one shared normalized compare dataset', { skip: !hasUcode }, () => {
  const manyMap = { files: [] };
  const manyInstalled = { files_sha256: {} };
  const manySelected = { files_sha256: {} };
  for (let index = 0; index < 50; index += 1) {
    const sourcePath = `files/fake/example-${index}.bin`;
    manyMap.files.push({ sourcePath, class: 'exact-managed', type: 'bin', localName: `runtime-assets/bin/example-${index}.bin` });
    manyInstalled.files_sha256[sourcePath] = '1'.repeat(64);
    manySelected.files_sha256[sourcePath] = '2'.repeat(64);
  }
  const evidence = { ...compare, files: [], commits: [{ sha: 'c'.repeat(40), commit: { message: 'bulk update has no path-specific reason' } }] };
  const program = `import * as mod from ${JSON.stringify(modulePath)}; let value = mod.z2k_explain_managed_delta(${JSON.stringify(manySelected)}, ${JSON.stringify(manyInstalled)}, ${JSON.stringify(manyMap)}, "r-test", ${JSON.stringify(evidence)}); print(sprintf('%J', { count: length(value.modifiedItems), summaries: length(value.modifiedItems.filter(function(item) { return item.summary != null; })) }));`;
  const result = spawnSync(ucodeBin, ['-e', program], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { count: 50, summaries: 0 });
});

test('deduplicates one shared repository reason while allowing different reasons in one commit', { skip: !hasUcode }, () => {
  const manyMap = { files: [
    { sourcePath: 'files/fake/a.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/a.bin' },
    { sourcePath: 'files/fake/b.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/b.bin' },
    { sourcePath: 'files/fake/c.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/c.bin' },
  ] };
  const previous = { files_sha256: { 'files/fake/a.bin': '1'.repeat(64), 'files/fake/b.bin': '1'.repeat(64), 'files/fake/c.bin': '1'.repeat(64) } };
  const current = { files_sha256: { 'files/fake/a.bin': '2'.repeat(64), 'files/fake/b.bin': '2'.repeat(64), 'files/fake/c.bin': '2'.repeat(64) } };
  const evidence = structuredClone(compare);
  evidence.files = [
    { filename: 'files/fake/a.bin', status: 'modified' },
    { filename: 'files/fake/b.bin', status: 'modified' },
    { filename: 'files/fake/c.bin', status: 'modified' },
  ];
  evidence.commits = [{
    sha: 'c'.repeat(40),
    commit: { message: [
      'refactor(resources): split managed reasons',
      '',
      'files/fake/a.bin, files/fake/b.bin and files/fake/c.bin share this repository reason.',
      '',
      'files/fake/b.bin also received a separate compatibility adjustment.',
    ].join('\n') },
  }];
  evidence.total_commits = 1;
  const delta = invoke(evidence, current, previous, manyMap);
  assert.equal(delta.modifiedItems[0].explanation.excerpts[0], delta.modifiedItems[1].explanation.excerpts[0]);
  assert.equal(delta.modifiedItems[0].explanation.excerptIndexes[0], delta.modifiedItems[2].explanation.excerptIndexes[0]);
  assert.notDeepEqual(delta.modifiedItems[0].explanation.excerptIndexes, delta.modifiedItems[1].explanation.excerptIndexes);
});

test('rejects replacement characters and operational-only paragraphs as collapsed evidence', { skip: !hasUcode }, () => {
  const broken = structuredClone(compare);
  broken.commits[0].commit.message = [
    'cleanup',
    '',
    'files/fake/example.bin was removed � because the decoder broke.',
    '',
    'TEST:',
    'files/fake/example.bin git status /tmp/check line 42',
  ].join('\n');
  const delta = invoke(broken);
  assert.equal(delta.removedItems[0].explanation, null);
  assert.equal(delta.removedItems[0].summary, null);
});

test('read-only compare adapter removes the old upstream metadata dependency', () => {
  assert.match(source, /COMPARE_URL|compare\//);
  assert.match(source, /repository-compare/);
  assert.match(source, /z2k-compare/);
  assert.match(source, /per_page=100/);
  assert.doesNotMatch(source, /release-changes\.json|RELEASE_CHANGES_URL|repository-index/);
  assert.doesNotMatch(source, /bad identifier|дублировал tls_clienthello|1858 строк/);
  assert.match(source, /paragraphs/);
  assert.match(source, /excerptIndexes/);
  assert.match(source, /fullMessageAvailable/);
  assert.match(source, /valid_evidence_text\(firstLine, MAX_COMPARE_TEXT\)/);
  assert.match(source, /result\.compareContext = compare_context\(normalizedCompare, result\)/);
  assert.doesNotMatch(source, /bounded_text\(best\.body|summary\.substring|summary\.slice/);
});

test('compare browse is optional and cannot affect lifecycle planning', () => {
  assert.match(source, /targetPlan = z2k_upstream_plan\(checked\.manifest\)/);
  assert.match(source, /targetCanApply = targetPlan\.ok === true/);
  assert.match(source, /summarySource/);
  assert.match(source, /COMPARE_CACHE_DIR/);
  assert.match(source, /MAX_COMPARE_CACHE|256 \* 1024/);
  assert.match(source, /MAX_COMPARE_CACHE_TOTAL|512 \* 1024/);
  assert.match(source, /403|cooldown|LKG|last-known-good/i);
});

test('compare evidence uses one aggregate transport and no per-resource REST endpoint', () => {
  const compareFetcher = source.slice(source.indexOf('function fetch_compare_page'), source.indexOf('function fetch_manifest'));
  assert.ok(compareFetcher.length > 0);
  assert.equal((compareFetcher.match(/fetch_text\(/g) || []).length, 1);
  assert.doesNotMatch(compareFetcher, /\/commits\/|\/contents\/|\/git\/blobs/);
  assert.match(source, /mkdir .*compare|compare_lock_file/);
  assert.match(source, /for \(let i = 0; i < 5/);
});
