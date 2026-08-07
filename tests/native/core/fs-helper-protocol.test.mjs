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
const expectedRoots = {
  persistent_state: {
    base: '/etc/zapret2-manager/state', storage: 'persistent', persistence: 'survives_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 4194304, maxDepth: 16, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  },
  snapshots: {
    base: '/etc/zapret2-manager/snapshots', storage: 'persistent', persistence: 'survives_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 4194304, maxDepth: 16, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  },
  registry: {
    base: '/etc/zapret2-manager/registry', storage: 'persistent', persistence: 'survives_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 4194304, maxDepth: 16, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  },
  secrets: {
    base: '/etc/zapret2-manager/secrets', storage: 'persistent', persistence: 'survives_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 0, maxDepth: 8, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'atomic_write', 'atomic_write_json', 'mkdir_private',
      'rename_owned', 'unlink_owned'
    ]
  },
  runtime: {
    base: '/tmp/zapret2-manager/runtime', storage: 'tmpfs', persistence: 'cleared_on_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 1048576, maxDepth: 12, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'not_required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  },
  jobs: {
    base: '/tmp/zapret2-manager/jobs', storage: 'tmpfs', persistence: 'cleared_on_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 4194304, maxDepth: 16, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'not_required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  },
  locks: {
    base: '/tmp/zapret2-manager/locks', storage: 'tmpfs', persistence: 'cleared_on_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 0, maxDepth: 1, mkdirPolicy: 'denied', deletePolicy: 'denied',
    directoryFsync: 'not_required', objectType: 'directory', noFollowRoot: true,
    allowedOperations: ['lock_acquire', 'lock_release', 'lock_status']
  },
  staging: {
    base: '/tmp/zapret2-manager/staging', storage: 'tmpfs', persistence: 'cleared_on_reboot',
    ownerUid: 0, ownerGid: 0, rootMode: '0700', fileMode: '0600', directoryMode: '0700',
    maxReadBytes: 4194304, maxDepth: 12, mkdirPolicy: 'private_only',
    deletePolicy: 'owned_token_only', directoryFsync: 'not_required',
    objectType: 'directory', noFollowRoot: true, allowedOperations: [
      'stat_regular', 'read_regular', 'atomic_write', 'atomic_write_json',
      'mkdir_private', 'sha256_regular', 'rename_owned', 'unlink_owned'
    ]
  }
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
  assert.deepEqual(value.requestIdentity, {
    beforeRequestIdValidation: 'null',
    afterRequestIdValidation: 'echo_exactly',
    successRequiresValidatedRequestId: true,
    failureRequiresValidatedRequestIdOrNull: true
  });
});

test('root policy is closed, complete, and isolates secrets, locks, and staging', () => {
  const value = manifest();
  assert.deepEqual(value.roots, expectedRoots);
  assert.deepEqual(value.rootOpenPolicy, {
    absoluteBaseOpenedByHelperOnly: true,
    ancestorPolicy: {
      required: 'root_owned_directory_no_symlink',
      writableException: '/tmp_must_be_root_owned_sticky_directory',
      managedTmpParent: '/tmp/zapret2-manager_must_be_root_owned_0700_directory'
    },
    rejectSymlinkAncestors: true,
    openFlags: ['O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC'],
    verifyAfterOpen: ['object_type', 'owner_uid', 'owner_gid', 'mode'],
    insecureRoot: 'EROOT',
    unsafeRootOpen: 'fail_capability'
  });

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

test('root and operation authorization is bidirectionally consistent', () => {
  const value = manifest();
  for (const root of roots) {
    const fromOperations = operations.filter((operation) =>
      value.operations[operation].roots.includes(root));
    assert.deepEqual(sorted(value.roots[root].allowedOperations), sorted(fromOperations), root);
  }
  for (const operation of operations) {
    const fromRoots = roots.filter((root) =>
      value.roots[root].allowedOperations.includes(operation));
    assert.deepEqual(sorted(value.operations[operation].roots), sorted(fromRoots), operation);
  }
});

test('paths are canonical relative names without generic or absolute capability', () => {
  const value = manifest();

  assert.deepEqual(value.pathPolicy, {
    form: 'canonical_relative',
    maxBytes: 4096,
    maxComponentBytes: 255,
    maxDepth: 32,
    allowedComponentPattern: '^[A-Za-z0-9._-]+$',
    emptyPath: 'reject',
    leadingSlash: 'reject',
    trailingSlash: 'reject',
    repeatedSlash: 'reject',
    dotComponent: 'reject',
    dotDotComponent: 'reject',
    embeddedNul: 'reject',
    embeddedNulObjectKeys: 'reject_schema',
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
    const requiredKeys = [
      'milestone', 'status', 'roots', 'requestSchema', 'successSchema',
      'limits', 'ownership', 'crashSemantics', 'idempotency'
    ];
    if (operation.status === 'reserved_unsupported')
      requiredKeys.push('unsupportedBehavior');
    assert.deepEqual(sorted(Object.keys(operation)), sorted(requiredKeys), name);
    assert.ok(Number.isInteger(operation.milestone) && operation.milestone > 0, name);
    assert.ok(['milestone_1', 'milestone_2', 'reserved_unsupported'].includes(operation.status), name);
    assert.ok(operation.roots.length > 0, name);
    assert.ok(operation.roots.every((root) => roots.includes(root)), name);
    assert.equal(operation.requestSchema.type, 'object', name);
    assert.equal(operation.requestSchema.additionalProperties, false, name);
    assert.ok(Array.isArray(operation.requestSchema.required), name);
    assert.equal(operation.successSchema.type, 'object', name);
    assert.equal(operation.successSchema.additionalProperties, false, name);
    const limitKeys = ['maxInputBytes', 'maxOutputBytes', 'timeoutMsMax'];
    if (name === 'atomic_write') limitKeys.push('effectiveMaxDecodedInputBytes');
    assert.deepEqual(sorted(Object.keys(operation.limits)), sorted(limitKeys), name);
    assert.equal(typeof operation.ownership, 'string', name);
    assert.equal(typeof operation.crashSemantics, 'string', name);
    assert.equal(typeof operation.idempotency, 'string', name);
  }

  assert.equal(value.operations.stat_regular.status, 'milestone_1');
  assert.equal(value.operations.read_regular.status, 'milestone_1');
  assert.equal(value.operations.atomic_write.status, 'milestone_2');
  assert.equal(value.operations.mkdir_private.status, 'milestone_2');
  assert.equal(value.operations.sha256_regular.status, 'milestone_2');
  for (const name of operations.slice(2).filter((name) => !['atomic_write', 'mkdir_private', 'sha256_regular'].includes(name)))
    assert.equal(value.operations[name].status, 'reserved_unsupported', name);
  for (const name of operations.slice(2).filter((name) => !['atomic_write', 'mkdir_private', 'sha256_regular'].includes(name))) {
    assert.deepEqual(value.operations[name].unsupportedBehavior, {
      errorCode: 'EUNSUPPORTED',
      dispatch: 'reject_before_operation_dispatch',
      sideEffects: 'none',
      response: 'complete_failure_envelope',
      exitCategory: 'policy_denied',
      exitCode: 3
    }, name);
  }
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
  assert.deepEqual(value.operations.mkdir_private.successSchema.required,
    ['created', 'committed', 'durability']);
});

test('errors are stable, bounded, and map to one exit category', () => {
  const value = manifest();
  const expectedCodes = [
    'EMALFORMED', 'ESCHEMA', 'EREQUESTTOOBIG', 'EDENIED', 'EROOT', 'EPATH',
    'EUNSUPPORTED', 'ECAPABILITY', 'ENOENT', 'ENOTREG', 'ESYMLINK', 'EXDEV', 'ETOOBIG', 'EIO',
    'ELOCKED', 'ETIMEOUT', 'EOWNERSHIP', 'ECOMMITUNKNOWN', 'EINTERNAL',
    'EINCOMPLETE'
  ];
  assert.deepEqual(sorted(Object.keys(value.errors)), sorted(expectedCodes));
  assert.deepEqual(sorted(value.envelopes.failure.properties.error.properties.code.enum),
    sorted(expectedCodes));
  for (const [code, error] of Object.entries(value.errors)) {
    assert.deepEqual(sorted(Object.keys(error)),
      ['allowedExitCategories', 'allowedStages', 'committed', 'durability', 'message', 'retryable'], code);
    assert.ok(error.allowedExitCategories.length > 0, code);
    assert.ok(error.allowedExitCategories.every((category) => Object.hasOwn(exits, category)), code);
    assert.ok(error.allowedStages.length > 0, code);
    assert.equal(typeof error.message, 'string', code);
    assert.ok(Buffer.byteLength(error.message, 'utf8') <= value.errorPolicy.maxMessageBytes, code);
    assert.equal(typeof error.retryable, 'boolean', code);
  }
  for (const code of ['EMALFORMED', 'ESCHEMA', 'EREQUESTTOOBIG', 'EDENIED',
    'EROOT', 'EPATH', 'EUNSUPPORTED', 'ECAPABILITY', 'ENOENT', 'ENOTREG', 'ESYMLINK',
    'EXDEV', 'ETOOBIG', 'EIO', 'ELOCKED', 'ETIMEOUT', 'EOWNERSHIP']) {
    assert.equal(value.errors[code].committed, false, code);
    assert.equal(value.errors[code].durability, 'unchanged', code);
  }
  assert.deepEqual(value.errors.ECOMMITUNKNOWN, {
    message: 'Commit may be visible but durability is unknown.',
    retryable: false,
    committed: true,
    durability: 'unknown',
    allowedExitCategories: ['commit_uncertain'],
    allowedStages: ['directory_fsync']
  });
  assert.ok(value.envelopes.failure.properties.error.required.includes('stage'));
  assert.deepEqual(value.envelopes.failure.properties.error.properties.stage,
    { type: 'string', minLength: 1, maxLength: 64 });
  assert.deepEqual(value.errorPolicy, {
    maxMessageBytes: 512,
    maxDetailsBytes: 4096,
    pathsInMessages: 'redacted',
    callersBranchOn: 'code'
  });
  assert.deepEqual(value.errors.EINTERNAL.allowedStages, ['internal', 'response_encode']);
});

test('reserved atomic write decoded input limit fits the bounded request wire independently', () => {
  const value = manifest();
  const operation = value.operations.atomic_write;
  assert.equal(operation.requestSchema.properties.content.maxDecodedBytes, 521028);
  assert.equal(operation.limits.effectiveMaxDecodedInputBytes, 521028);
  const longestAllowedPath = [...Array(15).fill('a'.repeat(255)), 'a'.repeat(254), 'a'].join('/');
  assert.equal(Buffer.byteLength(longestAllowedPath), 4096);
  assert.match(longestAllowedPath, /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/);
  const worstCaseRequest = '{"\\u0070\\u0072\\u006f\\u0074\\u006f\\u0063\\u006f\\u006c\\u0056\\u0065\\u0072\\u0073\\u0069\\u006f\\u006e":1,'
    + `"\\u0072\\u0065\\u0071\\u0075\\u0065\\u0073\\u0074\\u0049\\u0064":"${'\\u0072'.repeat(128)}",`
    + '"\\u006f\\u0070\\u0065\\u0072\\u0061\\u0074\\u0069\\u006f\\u006e":"\\u0061\\u0074\\u006f\\u006d\\u0069\\u0063\\u005f\\u0077\\u0072\\u0069\\u0074\\u0065",'
    + '"\\u0061\\u0072\\u0067\\u0075\\u006d\\u0065\\u006e\\u0074\\u0073":{'
    + '"\\u0072\\u006f\\u006f\\u0074":"\\u0070\\u0065\\u0072\\u0073\\u0069\\u0073\\u0074\\u0065\\u006e\\u0074\\u005f\\u0073\\u0074\\u0061\\u0074\\u0065",'
    + `"\\u0070\\u0061\\u0074\\u0068":"${`${'\\u0061'.repeat(255)}\\u002f`.repeat(15)}${'\\u0061'.repeat(254)}\\u002f\\u0061",`
    + `"\\u0063\\u006f\\u006e\\u0074\\u0065\\u006e\\u0074":"${'\\u0041'.repeat(694704)}",`
    + '"\\u006d\\u006f\\u0064\\u0065":"\\u0030\\u0036\\u0030\\u0030",'
    + '"\\u0075\\u0069\\u0064":0,"\\u0067\\u0069\\u0064":0,"\\u0061\\u006c\\u006c\\u006f\\u0077\\u0043\\u0072\\u0065\\u0061\\u0074\\u0065":true}}';
  assert.ok(Buffer.byteLength(worstCaseRequest) <= value.transport.requestMaxBytes,
    String(Buffer.byteLength(worstCaseRequest)));
  assert.equal(Buffer.byteLength(worstCaseRequest), 4194293);
});

test('ucode mapping supplies generation and closes helper and transport failures', () => {
  const value = manifest();
  assert.deepEqual(value.rpcMapping, {
    backendContract: 'docs/contracts/native-backend-v1.md',
    generationSource: 'calling_state_layer',
    helperMayAssignGeneration: false,
    success: { helperData: 'rpc.data' },
    validHelperFailure: {
      canonicalCodeByHelperCode: {
        EMALFORMED: 'EINTERNAL', ESCHEMA: 'EINTERNAL', EREQUESTTOOBIG: 'EINTERNAL',
        EDENIED: 'EINPUT', EROOT: 'EDEPENDENCY', EPATH: 'EINPUT',
        EUNSUPPORTED: 'EDEPENDENCY', ECAPABILITY: 'EDEPENDENCY', ENOENT: 'EDEPENDENCY', ENOTREG: 'EDEPENDENCY',
        ESYMLINK: 'EDEPENDENCY', EXDEV: 'EDEPENDENCY', ETOOBIG: 'EINPUT', EIO: 'EDEPENDENCY',
        ELOCKED: 'ELOCKED', ETIMEOUT: 'ELOCKED', EOWNERSHIP: 'EOWNERSHIP',
        ECOMMITUNKNOWN: 'EAPPLY', EINTERNAL: 'EINTERNAL', EINCOMPLETE: 'EDEPENDENCY'
      },
      details: {
        helperCode: 'preserve', helperRetryable: 'preserve',
        helperCommitted: 'preserve', helperDurability: 'preserve', helperStage: 'preserve_if_present'
      }
    },
    adapterFailures: {
      callerArgumentsRejectedBeforeInvocation: 'EINPUT',
      helperUnavailableOrTransportFailure: 'EDEPENDENCY',
      missingOrIncompleteResponse: 'EDEPENDENCY',
      malformedResponse: 'EINTERNAL',
      protocolVersionMismatch: 'EINTERNAL',
      missingRequestIdAfterValidation: 'EINTERNAL',
      mismatchedRequestId: 'EINTERNAL'
    }
  });
});

test('design and plan describe only the manifest architecture and milestone 1 scope', () => {
  for (const file of [designPath, planPath]) {
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /protocol-v1\.json/);
    assert.match(body, /short-lived/i);
    assert.match(body, /one\s+bounded\s+JSON\s+request/i);
    assert.match(body, /one\s+bounded\s+JSON\s+response/i);
    assert.match(body, /calling state layer/i);
    assert.match(body, /requestId/i);
    assert.match(body, /Milestone 1[\s\S]{0,1200}stat_regular[\s\S]{0,1200}read_regular/i);
    assert.doesNotMatch(body, /runs as a root-owned procd service|listens on[^.]*socket|daemon retains|implement retained[^.]*broker|install[^.]*procd service/i);
  }

  const plan = fs.readFileSync(planPath, 'utf8');
  const milestoneOne = plan.match(/## Milestone 1[\s\S]*?(?=\n## Milestone 2|$)/i)?.[0] ?? '';
  assert.doesNotMatch(milestoneOne, /implement[^\n]*(sha256|atomic_write|mkdir_private|lock_)/i);
  assert.match(milestoneOne, /EUNSUPPORTED/);

  const design = fs.readFileSync(designPath, 'utf8');
  assert.match(design, /host kernel[\s\S]{0,200}host root\/UID 0[\s\S]{0,200}trusted/i);
  assert.match(design, /malicious UID 0[\s\S]{0,100}`?CAP_SYS_ADMIN`?[\s\S]{0,100}out\s+of\s+scope/i);
  assert.match(design, /CAS checks[\s\S]{0,200}detection/i);
  assert.doesNotMatch(design, /resist(?:s|ance)?[\s\S]{0,100}(?:malicious|hostile) root/i);
});
