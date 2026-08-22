import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
const tokenizerFixture = readFixture('tokenizer-cases.json');
const domainFixture = readFixture('domain-cases.json');

function model(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function catalogEntry(overrides = {}) {
  return {
    id: 'avatar-stable-id',
    metadata: {
      name: 'Catalog name',
      author: 'Avatar author',
      label: 'recommended',
      description: 'Catalog description',
      blobs: ['tls_google', 'quic_google'],
      featured: true,
    },
    args: '--filter-tcp=80 --lua-init=code=\'hello world\' --new --filter-udp=443 --payload=quic_initial',
    level: 'builtin',
    protocol: 'udp',
    sourceFile: 'builtin/winws2_presets.txt',
    sourceOrdinal: 17,
    cacheKey: 'builtin/udp',
    cacheOrdinal: 23,
    effectiveOrdinal: 9,
    duplicateGroup: 4,
    winner: true,
    rawArgs: '--filter-tcp=80 --lua-init=code=\'hello world\'\n--new\n--filter-udp=443 --payload=quic_initial',
    ...overrides,
  };
}

test('missing enabled defaults to true and preserves quoted tokens', () => {
  const result = model('strategy_normalize', {
    id: 's1', name: 'S1', profiles: [{ id: 'p1', args: "--lua-init=code='hello world'\n--x" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.strategy.profiles[0].enabled, true);
  assert.deepEqual(result.tokens, ["--lua-init=code='hello world'", '--x']);
});

test('tokenizer matches every stable Avatar whitespace and quoting fixture', () => {
  for (const entry of tokenizerFixture.cases) {
    const result = model('avatar_tokenize', entry.input);
    assert.equal(result.ok, true, entry.id);
    assert.deepEqual(result.tokens.map(token => token.value), entry.tokens, entry.id);
    assert.deepEqual(result.tokens.map(token => entry.input.slice(token.start, token.end)),
      entry.tokens, entry.id);
    for (let i = 0; i < result.tokens.length; i++) {
      assert.ok(result.tokens[i].start <= result.tokens[i].end, entry.id);
      if (i > 0) assert.ok(result.tokens[i - 1].end <= result.tokens[i].start, entry.id);
    }
  }
});

test('tokenizer preserves quote characters and retains an unmatched final quote', () => {
  const result = model('avatar_tokenize', "--lua-init=code='hello world");
  assert.deepEqual(result, {
    ok: true,
    tokens: [{ value: "--lua-init=code='hello world", start: 0, end: 28 }],
  });
});

test('normalization preserves unknown options, disabled children, duplicates, and order', () => {
  const input = {
    id: 'duplicate-children',
    name: 'Duplicate children',
    profiles: [
      { id: 'p1', args: '--known=one  --unknown=value', enabled: true },
      { id: 'p1', args: '--filter-tcp=443\t--payload=http_req', enabled: false },
      { id: 'p2', args: '--filter-udp=443\r\n--payload=quic_initial' },
    ],
  };
  const result = model('strategy_normalize', input, 'user');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.strategy.origin, 'user');
  assert.deepEqual(result.strategy.profiles.map(profile => ({
    id: profile.id, args: profile.args, enabled: profile.enabled,
  })), [
    { id: 'p1', args: '--known=one --unknown=value', enabled: true },
    { id: 'p1', args: '--filter-tcp=443 --payload=http_req', enabled: false },
    { id: 'p2', args: '--filter-udp=443 --payload=quic_initial', enabled: true },
  ]);
  assert.deepEqual(model('strategy_enabled_profiles', result.strategy)
    .map(profile => profile.id), ['p1', 'p2']);
  assert.equal(model('strategy_profile_count', result.strategy), 2);
});

test('catalog conversion splits only exact separator tokens and preserves order', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    id: 's1',
    args: '--filter-tcp=80 --x --new --filter-tcp=443 --y --new=literal --quoted=\'--new\' --z',
  }));
  assert.equal(result.id, 's1');
  assert.equal(result.type, 'combined');
  assert.deepEqual(result.profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    args: profile.args,
  })), [
    { id: 'http1', name: 'HTTP (порт 80)', enabled: true, args: '--filter-tcp=80 --x' },
    {
      id: 'tcp2', name: 'TCP (порты 443)', enabled: true,
      args: "--filter-tcp=443 --y --new=literal --quoted='--new' --z",
    },
  ]);
});

test('catalog conversion drops empty separator segments and omits no-args entries', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    args: '--new --new --filter-l3=ipv4 --new',
  }));
  assert.deepEqual(result.profiles.map(profile => ({
    id: profile.id, name: profile.name, args: profile.args,
  })), [{ id: 'ipv4_1', name: 'IPV4', args: '--filter-l3=ipv4' }]);
  assert.equal(model('catalog_entry_to_strategy', catalogEntry({ args: '' })), null);
});

test('catalog conversion falls back to the pinned ID when metadata name is empty', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    id: 'stable-id',
    metadata: { ...catalogEntry().metadata, name: '' },
    args: '--payload=all',
  }));
  assert.equal(result.id, 'stable-id');
  assert.equal(result.name, 'stable-id');
});

test('catalog conversion uses the first TCP, UDP, or L3 filter for profile identity', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    args: '--filter-tcp=443 --filter-udp=53 --new --filter-udp=53 --new --filter-l3=ipv6 --new --payload=all',
  }));
  assert.deepEqual(result.profiles.map(profile => [profile.id, profile.name]), [
    ['tcp1', 'TCP (порты 443)'],
    ['udp2', 'UDP (порты 53)'],
    ['ipv6_3', 'IPV6'],
    ['profile4', 'Profile 4'],
  ]);
});

test('catalog conversion copies metadata and physical provenance without rewriting IDs', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    id: 'Avatar ID.with punctuation',
    protocol: 'tcp',
    args: '--payload=tls_client_hello',
  }));
  assert.deepEqual(result, {
    id: 'Avatar ID.with punctuation',
    name: 'Catalog name',
    description: 'Catalog description',
    type: 'single',
    version: 1,
    is_builtin: true,
    source: 'catalog',
    level: 'builtin',
    label: 'recommended',
    author: 'Avatar author',
    protocol: 'tcp',
    featured: true,
    blobs: ['tls_google', 'quic_google'],
    circular: false,
    isCircular: false,
    sourceFile: 'builtin/winws2_presets.txt',
    sourceOrdinal: 17,
    cacheKey: 'builtin/udp',
    cacheOrdinal: 23,
    effectiveOrdinal: 9,
    duplicateGroup: 4,
    winner: true,
    rawArgs: "--filter-tcp=80 --lua-init=code='hello world'\n--new\n--filter-udp=443 --payload=quic_initial",
    profiles: [{
      id: 'profile1', name: 'Profile 1', enabled: true, args: '--payload=tls_client_hello',
    }],
  });
});

test('catalog conversion preserves preset Blob and Lua references and does not filter user input', () => {
  const result = model('catalog_entry_to_strategy', catalogEntry({
    args: "--wf-tcp=inline --blob=tls_google:@bin/tls_clienthello.bin --lua-desync=fake:blob=tls_google --unknown=keep",
    metadata: {
      ...catalogEntry().metadata,
      blobs: ['tls_google'],
    },
  }));
  assert.equal(result.protocol, 'udp');
  assert.deepEqual(result.blobs, ['tls_google']);
  assert.equal(result.profiles[0].args,
    "--wf-tcp=inline --blob=tls_google:@bin/tls_clienthello.bin --lua-desync=fake:blob=tls_google --unknown=keep");
});

test('domain fixtures preserve defaulting and empty-array structural validity', () => {
  const enabled = new Map(domainFixture.groups.find(group => group.id === 'enabled-defaulting')
    .cases.map(entry => [entry.id, entry]));
  for (const entry of enabled.values()) {
    const result = model('strategy_normalize', entry.strategy);
    assert.equal(result.ok, true, `${entry.id}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.strategy.profiles.map(profile => profile.enabled),
      entry.expectedEnabled, entry.id);
    assert.deepEqual(model('strategy_enabled_profiles', result.strategy)
      .map(profile => profile.args), entry.expectedArgs, entry.id);
  }

  const empty = domainFixture.groups.find(group => group.id === 'empty-profiles').cases;
  assert.equal(model('strategy_validate', empty[0].strategy, 'structural').ok, true);
  assert.equal(model('strategy_validate', empty[0].strategy, 'create').ok, false);
  assert.equal(model('strategy_validate', empty[0].strategy, 'update').ok, true);
  assert.equal(model('strategy_validate', empty[1].strategy, 'structural').ok, false);
});

test('zero-enabled strategies remain structurally valid while enabled count is zero', () => {
  const zero = domainFixture.groups.find(group => group.id === 'zero-enabled').cases[0].strategy;
  const result = model('strategy_normalize', zero);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.strategy.profiles.map(profile => profile.enabled), [false, false]);
  assert.deepEqual(model('strategy_enabled_profiles', result.strategy), []);
  assert.equal(model('strategy_profile_count', result.strategy), 0);
});

test('validation requires Strategy identity, profiles, child IDs, and args', () => {
  for (const input of [
    { name: 'missing id', value: { name: 'S1', profiles: [] } },
    { name: 'missing name', value: { id: 's1', profiles: [] } },
    { name: 'missing profiles', value: { id: 's1', name: 'S1' } },
    { name: 'missing child id', value: { id: 's1', name: 'S1', profiles: [{ args: '--x' }] } },
    { name: 'missing child args', value: { id: 's1', name: 'S1', profiles: [{ id: 'p1' }] } },
    { name: 'null child args', value: { id: 's1', name: 'S1', profiles: [{ id: 'p1', args: null }] } },
  ]) {
    const result = model('strategy_validate', input.value, 'structural');
    assert.equal(result.ok, false, input.name);
    assert.equal(result.error.code, 'EINPUT', input.name);
  }
});
