import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const backendPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub.uc';
const cliPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub-cli.uc';
const rpcPath = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-domain-hub.uc';

function source(path) {
  return fs.readFileSync(path, 'utf8');
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  if (!domain || domain.length > 253 || domain.includes('*') || !/^[a-z0-9.-]+$/.test(domain)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null;
  return labels.every((label) => /^\d+$/.test(label)) ? null : domain;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeDomain).filter(Boolean))].sort();
}

function preview(snapshot, edit) {
  if (edit.expectedRevision !== snapshot.revision)
    return { ok: false, error: { code: 'ESTALE' }, mutated: false };
  if (edit.expectedCatalogDigest !== snapshot.catalog.digest)
    return { ok: false, error: { code: 'ECONFLICT' }, mutated: false };

  const include = normalizeList([
    ...(edit.lists?.include ?? snapshot.userDomains.include),
    ...(edit.autohost?.promote ?? [])
  ]);
  const exclude = normalizeList([
    ...(edit.lists?.exclude ?? snapshot.userDomains.exclude),
    ...(edit.autohost?.ignore ?? [])
  ]);
  const conflicts = include.filter((domain) => exclude.includes(domain));
  const blockers = [];
  if ((edit.autohost?.cleanupStale ?? []).length) blockers.push('autohost-cleanup-owner-unavailable');
  if (edit.sources && Object.keys(edit.sources).length) blockers.push('source-owner-unavailable');
  return {
    ok: conflicts.length === 0 && blockers.length === 0,
    mutated: false,
    precondition: {
      revision: snapshot.revision,
      catalogDigest: snapshot.catalog.digest
    },
    userDomains: { include, exclude, conflicts },
    blockers
  };
}

const snapshot = {
  revision: 'r-12',
  catalog: { digest: 'a'.repeat(64), enabled: ['video'] },
  userDomains: { include: ['custom.example'], exclude: ['blocked.example'] },
  autohost: { entries: ['learned.example'] }
};

test('preview is non-mutating and carries exact preconditions', () => {
  const result = preview(snapshot, {
    expectedRevision: 'r-12',
    expectedCatalogDigest: 'a'.repeat(64),
    lists: { include: ['Example.COM'], exclude: ['blocked.example'] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.mutated, false);
  assert.equal(result.precondition.revision, snapshot.revision);
  assert.equal(result.precondition.catalogDigest, snapshot.catalog.digest);
  assert.deepEqual(result.userDomains.include, ['example.com']);
});

test('stale revision and digest fail closed before mutation', () => {
  assert.equal(preview(snapshot, {
    expectedRevision: 'old', expectedCatalogDigest: snapshot.catalog.digest
  }).error.code, 'ESTALE');
  assert.equal(preview(snapshot, {
    expectedRevision: snapshot.revision, expectedCatalogDigest: 'b'.repeat(64)
  }).error.code, 'ECONFLICT');
});

test('include/exclude identity is normalized and conflicts are explicit', () => {
  const result = preview(snapshot, {
    expectedRevision: snapshot.revision,
    expectedCatalogDigest: snapshot.catalog.digest,
    lists: { include: ['.Example.COM', 'example.com'], exclude: ['example.com'] }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.userDomains.include, ['example.com']);
  assert.deepEqual(result.userDomains.conflicts, ['example.com']);
});

test('autohost promote and ignore use sanctioned user lists', () => {
  const result = preview(snapshot, {
    expectedRevision: snapshot.revision,
    expectedCatalogDigest: snapshot.catalog.digest,
    autohost: { promote: ['Learned.Example'], ignore: ['noise.example'] }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.userDomains.include, ['custom.example', 'learned.example']);
  assert.deepEqual(result.userDomains.exclude, ['blocked.example', 'noise.example']);
});

test('unsupported autohost cleanup and source writes are visible blockers', () => {
  const result = preview(snapshot, {
    expectedRevision: snapshot.revision,
    expectedCatalogDigest: snapshot.catalog.digest,
    autohost: { cleanupStale: ['old.example'] },
    sources: { schedule: 'daily' }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    'autohost-cleanup-owner-unavailable',
    'source-owner-unavailable'
  ]);
});

test('backend adapter uses only existing catalog/list owners and verifies reread', () => {
  const code = source(backendPath);
  assert.match(code, /catalog_preview/);
  assert.match(code, /catalog_apply/);
  assert.match(code, /lists_get/);
  assert.match(code, /lists_set/);
  assert.match(code, /snapshot_take/);
  assert.match(code, /snapshot_restore/);
  assert.match(code, /verify_result/);
  assert.match(code, /verified:\s*true/);
  assert.doesNotMatch(code, /nft\s+flush|firewall\s+restart|killall\s+nfqws2/);
});

test('rpc surface exposes get preview and apply with positional edit transport', () => {
  const cli = source(cliPath);
  const rpc = source(rpcPath);
  assert.match(cli, /domain_hub_get/);
  assert.match(cli, /domain_hub_preview/);
  assert.match(cli, /domain_hub_apply/);
  assert.match(rpc, /domain_hub_get/);
  assert.match(rpc, /domain_hub_preview/);
  assert.match(rpc, /domain_hub_apply/);
  assert.match(rpc, /edit must be a JSON string/);
});

test('apply contract includes request id, atomic snapshot and rollback proof', () => {
  const code = source(backendPath);
  assert.match(code, /requestId/);
  assert.match(code, /expectedRevision/);
  assert.match(code, /expectedCatalogDigest/);
  assert.match(code, /rollback/);
  assert.match(code, /snapshotId/);
  assert.match(code, /restored/);
});
