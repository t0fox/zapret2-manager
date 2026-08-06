import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifestPath = 'zapret2-manager/src/z2m-core-helper/protocol-v1.json';
const designPath = 'docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md';
const planPath = 'docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md';

const roots = [
  'persistent_state', 'snapshots', 'registry', 'secrets',
  'runtime', 'jobs', 'locks', 'staging'
];
const operations = [
  'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
  'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned',
  'lock_acquire', 'lock_release', 'lock_status'
];
const exits = {
  success: 0,
  request_invalid: 2,
  policy_denied: 3,
  filesystem_failure: 4,
  lock_unavailable: 5,
  commit_uncertain: 6,
  internal: 70,
  response_incomplete: 74
};

function manifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function sorted(values) {
  return [...values].sort();
}

test('protocol v1 is a bounded one-request process with strict JSON framing', () => {
  const value = manifest();

  assert.equal(value.protocolVersion, 1);
  assert.deepEqual(value.transport, {
    lifecycle: 'short_lived',
    requestChannel: 'stdin',
    responseChannel: 'stdout',
    diagnosticsChannel: 'stderr',
    requestCount: 1,
    responseCount: 1,
    requestMaxBytes: 4 * 1024 * 1024,
    responseMaxBytes: 6 * 1024 * 1024,
    responseTerminator: '\n',
    diagnostics: 'redacted',
    inputEncoding: 'utf-8',
    invalidUtf8: 'reject',
    duplicateKeys: 'reject',
    trailingData: 'reject',
    trailingWhitespace: 'allow',
    embeddedNul: 'reject'
  });
  assert.deepEqual(value.exitCategories, exits);
  assert.equal('generation' in value.envelopes.request.properties, false);
  assert.equal('generation' in value.envelopes.success.properties, false);
  assert.equal('generation' in value.envelopes.failure.properties, false);
  assert.deepEqual(value.envelopes.request.required,
    ['protocolVersion', 'requestId', 'operation', 'arguments']);
  assert.deepEqual(value.envelopes.success.required,
    ['protocolVersion', 'requestId', 'ok', 'data']);
  assert.deepEqual(value.envelopes.failure.required,
    ['protocolVersion', 'requestId', 'ok', 'error']);
  for (const envelope of Object.values(value.envelopes))
    assert.equal(envelope.additionalProperties, false);
});

test('root policy is closed, complete, and isolates secrets, locks, and staging', () => {
  const value = manifest();
  assert.deepEqual(sorted(Object.keys(value.roots)), sorted(roots));

  const requiredPolicy = [
    'base', 'storage', 'persistence', 'ownerUid', 'ownerGid', 'rootMode',
    'fileMode', 'directoryMode', 'maxReadBytes', 'maxDepth',
    'mkdirPolicy', 'deletePolicy', 'directoryFsync', 'allowedOperations'
  ];
  for (const [name, policy] of Object.entries(value.roots)) {
    assert.deepEqual(sorted(Object.keys(policy)), sorted(requiredPolicy), name);
    assert.match(policy.base, name === 'persistent_state'
      ? /^\/etc\/zapret2-manager\/state$/
      : new RegExp(`^/(etc|tmp)/zapret2-manager/${name}$`));
    assert.ok(['persistent', 'tmpfs'].includes(policy.storage));
    assert.ok(['survives_reboot', 'cleared_on_reboot'].includes(policy.persistence));
    assert.equal(policy.ownerUid, 0);
    assert.equal(policy.ownerGid, 0);
    assert.match(policy.rootMode, /^0[0-7]{3}$/);
    assert.match(policy.fileMode, /^0[0-7]{3}$/);
    assert.match(policy.directoryMode, /^0[0-7]{3}$/);
    assert.ok(Number.isInteger(policy.maxReadBytes));
    assert.ok(Number.isInteger(policy.maxDepth) && policy.maxDepth > 0);
    assert.ok(['denied', 'private_only'].includes(policy.mkdirPolicy));
    assert.ok(['denied', 'owned_token_only'].includes(policy.deletePolicy));
    assert.ok(['required', 'not_required'].includes(policy.directoryFsync));
    assert.ok(policy.allowedOperations.every((operation) => operations.includes(operation)));
  }

  assert.deepEqual(value.roots.secrets.allowedOperations,
    ['stat_regular', 'atomic_write', 'atomic_write_json', 'mkdir_private', 'rename_owned', 'unlink_owned']);
  assert.equal(value.roots.secrets.maxReadBytes, 0);
  assert.deepEqual(value.roots.locks.allowedOperations,
    ['lock_acquire', 'lock_release', 'lock_status']);
  assert.equal(value.roots.locks.mkdirPolicy, 'denied');
  assert.equal(value.roots.locks.deletePolicy, 'denied');
  assert.equal(value.constraints.crossRootRename, 'denied');
  assert.equal(value.constraints.stagingAsPersistentAtomicSource, 'denied');
});

test('paths are canonical relative names without generic or absolute capability', () => {
  const value = manifest();

  assert.deepEqual(value.pathPolicy, {
    form: 'canonical_relative',
    maxBytes: 4096,
    maxComponentBytes: 255,
    maxDepth: 32,
    emptyPath: 'reject',
    leadingSlash: 'reject',
    trailingSlash: 'reject',
    repeatedSlash: 'reject',
    dotComponent: 'reject',
    dotDotComponent: 'reject',
    embeddedNul: 'reject',
    symlinks: 'reject',
    magicLinks: 'reject',
    mountCrossing: 'reject',
    primaryTraversal: 'openat2_resolve_beneath_no_symlinks_no_magiclinks',
    fallbackTraversal: 'descriptor_walk_openat_o_nofollow',
    unsafeFallback: 'fail_capability'
  });
  assert.equal(value.constraints.absolutePaths, 'denied');
  assert.equal(value.constraints.genericFilesystemOperation, 'absent');
  assert.equal(value.constraints.callerSelectedExecutable, 'absent');
  assert.equal(value.constraints.shellExecution, 'absent');
});

test('operation registry is closed and specifies schemas, limits, ownership, crash, and idempotency', () => {
  const value = manifest();
  assert.deepEqual(sorted(Object.keys(value.operations)), sorted(operations));

  for (const [name, operation] of Object.entries(value.operations)) {
    assert.deepEqual(sorted(Object.keys(operation)), sorted([
      'milestone', 'status', 'roots', 'requestSchema', 'successSchema',
      'limits', 'ownership', 'crashSemantics', 'idempotency'
    ]), name);
    assert.ok(Number.isInteger(operation.milestone) && operation.milestone > 0, name);
    assert.ok(['milestone_1', 'reserved_unsupported'].includes(operation.status), name);
    assert.ok(operation.roots.length > 0, name);
    assert.ok(operation.roots.every((root) => roots.includes(root)), name);
    assert.equal(operation.requestSchema.type, 'object', name);
    assert.equal(operation.requestSchema.additionalProperties, false, name);
    assert.ok(Array.isArray(operation.requestSchema.required), name);
    assert.equal(operation.successSchema.type, 'object', name);
    assert.equal(operation.successSchema.additionalProperties, false, name);
    assert.deepEqual(sorted(Object.keys(operation.limits)),
      ['maxInputBytes', 'maxOutputBytes', 'timeoutMsMax'], name);
    assert.equal(typeof operation.ownership, 'string', name);
    assert.equal(typeof operation.crashSemantics, 'string', name);
    assert.equal(typeof operation.idempotency, 'string', name);
  }

  assert.equal(value.operations.stat_regular.status, 'milestone_1');
  assert.equal(value.operations.read_regular.status, 'milestone_1');
  for (const name of operations.slice(2))
    assert.equal(value.operations[name].status, 'reserved_unsupported', name);
  assert.equal(value.operations.read_regular.limits.maxOutputBytes, 6 * 1024 * 1024);
  assert.equal(value.operations.read_regular.requestSchema.properties.maxBytes.maximum,
    4 * 1024 * 1024);
  assert.equal(value.operations.read_regular.successSchema.properties.content.encoding, 'canonical_base64');
  assert.deepEqual(value.operations.stat_regular.successSchema.required,
    ['type', 'size', 'mode', 'uid', 'gid', 'mtimeSec', 'mtimeNsec']);
  assert.deepEqual(value.operations.read_regular.successSchema.required,
    ['content', 'byteLength']);
  assert.equal(value.operations.secrets, undefined);
  assert.ok(!value.operations.read_regular.roots.includes('secrets'));
  assert.ok(!value.operations.sha256_regular.roots.includes('secrets'));
  assert.equal(value.operations.rename_owned.requestSchema.properties.ownershipToken.pattern,
    '^[a-f0-9]{64}$');
  assert.equal(value.operations.unlink_owned.requestSchema.properties.ownershipToken.pattern,
    '^[a-f0-9]{64}$');
  for (const name of ['lock_acquire', 'lock_release', 'lock_status']) {
    assert.deepEqual(value.operations[name].roots, ['locks']);
    assert.equal(value.operations[name].status, 'reserved_unsupported');
  }
  for (const name of ['atomic_write', 'atomic_write_json']) {
    assert.equal(value.operations[name].requestSchema.properties.mode.const, '0600');
    assert.equal(value.operations[name].requestSchema.properties.uid.const, 0);
    assert.equal(value.operations[name].requestSchema.properties.gid.const, 0);
  }
  assert.equal(value.operations.mkdir_private.requestSchema.properties.mode.const, '0700');
  assert.equal(value.operations.mkdir_private.requestSchema.properties.uid.const, 0);
  assert.equal(value.operations.mkdir_private.requestSchema.properties.gid.const, 0);
});

test('errors are stable, bounded, and map to one exit category', () => {
  const value = manifest();
  const expectedCodes = [
    'EMALFORMED', 'ESCHEMA', 'EREQUESTTOOBIG', 'EDENIED', 'EROOT', 'EPATH',
    'EUNSUPPORTED', 'ENOENT', 'ENOTREG', 'ESYMLINK', 'EXDEV', 'ETOOBIG', 'EIO',
    'ELOCKED', 'ETIMEOUT', 'EOWNERSHIP', 'ECOMMITUNKNOWN', 'EINTERNAL',
    'EINCOMPLETE'
  ];
  assert.deepEqual(sorted(Object.keys(value.errors)), sorted(expectedCodes));
  for (const [code, error] of Object.entries(value.errors)) {
    assert.deepEqual(sorted(Object.keys(error)),
      ['exitCategory', 'message', 'retryable'], code);
    assert.ok(Object.hasOwn(exits, error.exitCategory), code);
    assert.equal(typeof error.message, 'string', code);
    assert.ok(Buffer.byteLength(error.message, 'utf8') <= value.errorPolicy.maxMessageBytes, code);
    assert.equal(typeof error.retryable, 'boolean', code);
  }
  assert.deepEqual(value.errorPolicy, {
    maxMessageBytes: 512,
    maxDetailsBytes: 4096,
    pathsInMessages: 'redacted',
    callersBranchOn: 'code'
  });
});

test('design and plan describe only the manifest architecture and milestone 1 scope', () => {
  for (const file of [designPath, planPath]) {
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /protocol-v1\.json/);
    assert.match(body, /short-lived/i);
    assert.match(body, /one\s+bounded\s+JSON\s+request/i);
    assert.match(body, /one\s+bounded\s+JSON\s+response/i);
    assert.match(body, /Milestone 1[\s\S]{0,1200}stat_regular[\s\S]{0,1200}read_regular/i);
    assert.doesNotMatch(body, /runs as a root-owned procd service|listens on[^.]*socket|daemon retains|implement retained[^.]*broker|install[^.]*procd service/i);
  }

  const plan = fs.readFileSync(planPath, 'utf8');
  const milestoneOne = plan.match(/## Milestone 1[\s\S]*?(?=\n## Milestone 2|$)/i)?.[0] ?? '';
  assert.doesNotMatch(milestoneOne, /implement[^\n]*(sha256|atomic_write|mkdir_private|lock_)/i);
  assert.match(milestoneOne, /EUNSUPPORTED/);
});
