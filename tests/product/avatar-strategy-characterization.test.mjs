import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy');
const readFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));

const manifest = () => readFixture('manifest.expected.json');
const tokenizerCases = () => readFixture('tokenizer-cases.json');
const domainCases = () => readFixture('domain-cases.json');

const EXPECTED_FILES = [
  ['advanced/discord_voice_zapret2_advanced.txt', 75, '5da32af9b03f005405a1c3aecb608354e81763895cd2396c6e0edb56042a8844'],
  ['advanced/http80_blockcheckw.txt', 2, '3fe64a1df68247b62685f6d89663de19797e4794482bada49046fc2ea750f805'],
  ['advanced/http80_zapret2_advanced.txt', 127, '50769638b45bcb968e1edba2b9db6932c9bc4caaeae19e7a933e4200feddf3fe'],
  ['advanced/tcp_blockcheckw.txt', 6, 'bfe77d1610317182f1f86316aaaa17107e081e9b505bb704afe509d3c516d865'],
  ['advanced/tcp_fake_zapret2_advanced.txt', 24, 'f3d75636a7e9c686f71bef55b9af22efaaafd67bfb8d086386db04c0658293c9'],
  ['advanced/tcp_z2k_advanced.txt', 3, '8625f516ecb9993199d6bb96116b50b86128bb27301f6929148b481f8534f995'],
  ['advanced/tcp_zapret2_advanced.txt', 253, '0a9b988e01a36abb3dc27eaa296b626186e620a62556b386edaec73afa907b14'],
  ['advanced/udp_z2k_advanced.txt', 5, 'd8a2bd471d3a5fbdff88ac94a02236e36719e68882796d7b1fda45991003a5fc'],
  ['advanced/udp_zapret2_advanced.txt', 70, '95085372bca639eb8499b5fdd4c17dcfa4db46b84c45afe4f05c44fb10b185c2'],
  ['basic/discord_voice_zapret2_basic.txt', 73, '9feab1d06f15213bd1c3daac8910f7c3cc8e8af32075eaed2cad458152424f11'],
  ['basic/http80_zapret2_basic.txt', 126, '9d7ce7c906f37494a05d511e6b56d430cef3c642145a1359101741c922acd3f9'],
  ['basic/tcp_zapret2_basic.txt', 235, '035dd277e62e8705784348e2fcc34fc68cda8440d7999cf7cfa99188d34ba1af'],
  ['basic/udp_zapret_basic.txt', 62, '8fbca351b3ed724fa84e20ff791461df69d69aba229663e69e349e40aeaf7ab6'],
  ['builtin/winws2_presets.txt', 85, '87d33c2c202f365a48945a3326183a8e0bf638cd757dcbdbdde8f2c3c9768e8a'],
  ['builtin/z2k_all_in_one.txt', 1, '83f79ba2f3566f9f5fa7e330c3b4e4b03b4afbfda1995f55f7b6133786d9ecaf'],
  ['builtin/z2k_autocircular_quic.txt', 2, 'b52cc3af6779e6ea69614d4a3014d3bc864148ae321652856e51d5c6c03db143'],
  ['builtin/z2k_autocircular_tcp.txt', 3, '79b3df3aa7af7bfa440f2bb64cf3c8eb53c527900a8007b4213f5455af22b50d'],
  ['builtin/z2k_circular.txt', 1, 'd4e998e7a38c1232525c712f4d2411d64fe6f11ee22e2ed45be6dc0def348b7e'],
  ['builtin/zapret_gui_defaults.txt', 8, '161aa598c2bdd860cc4c67123a78a32077722bdafbb907cfc12d7a17b9c4d7a9'],
  ['direct/http80.txt', 174, 'bce0dda3f008af8c6c3f3d6d51cfeb383226efcfea51baecb12c42f772436de3'],
  ['direct/tcp.txt', 354, '5d5a57b8a96010d20bfb8bdf10eed1c41a50b58fe5cb3bcf4fdbf75ac3b079e1'],
  ['direct/udp.txt', 71, 'c0d0239b8d4883ae7ddb49c316dfad00b6a6bf0be9c17a62804b2a9ea5e7894c'],
  ['direct/voice.txt', 76, 'e4f444173a19e9364536b80c7df1197b50be225ba783b0947e1422bc78002b4b'],
];

test('pinned Avatar fixture has the complete physical catalog contract', () => {
  const fixture = manifest();
  assert.equal(fixture.schema, 1);
  assert.deepEqual(fixture.source, {
    repository: 'avatarDD/zapret-gui',
    commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c',
  });
  assert.equal(fixture.physicalFileCount, 23);
  assert.equal(fixture.physicalEntryCount, 1836);
  assert.equal(fixture.uniqueStrategyIdCount, 732);
  assert.equal(fixture.duplicateIdGroupCount, 503);
  assert.equal(fixture.aggregateDigest,
    '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1');
  assert.deepEqual(fixture.featuredIds, ['z2k_all_in_one', 'z2k_tls_circular_smart']);
});

test('manifest inventory preserves audited files and physical arithmetic', () => {
  const fixture = manifest();
  assert.equal(fixture.files.length, fixture.physicalFileCount);
  assert.equal(fixture.physicalEntries.length, fixture.physicalEntryCount);
  assert.equal(fixture.physicalEntries.at(-1).sourceOrdinal, fixture.physicalEntryCount);
  assert.deepEqual(fixture.files.map(file => [file.path, file.physicalEntryCount, file.sha256]), EXPECTED_FILES);
  assert.deepEqual(fixture.levelEntryCounts, {
    advanced: 565,
    basic: 496,
    builtin: 100,
    direct: 675,
  });
  assert.deepEqual(fixture.protocolEntryCounts, { tcp: 1402, udp: 434 });
  assert.equal(new Set(fixture.physicalEntries.map(entry => entry.id)).size,
    fixture.uniqueStrategyIdCount);
  assert.equal(new Set(fixture.duplicateGroups.map(group => group.id)).size,
    fixture.duplicateIdGroupCount);
  assert.equal(fixture.duplicateGroups.length, fixture.duplicateIdGroupCount);

  for (const file of fixture.files) {
    assert.match(file.path, /^(advanced|basic|builtin|direct)\/[^/]+\.txt$/);
    assert.ok(Number.isInteger(file.byteSize) && file.byteSize > 0, file.path);
    assert.match(file.sha256, /^[0-9a-f]{64}$/, file.path);
    assert.ok(['advanced', 'basic', 'builtin', 'direct'].includes(file.level), file.path);
    assert.ok(['tcp', 'udp'].includes(file.protocol), file.path);
    assert.equal(file.sourceOrder.length, file.physicalEntryCount, file.path);
  }

  for (const entry of fixture.physicalEntries) {
    assert.ok(Number.isInteger(entry.sourceOrdinal));
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.rawArgs, 'string');
    assert.equal(typeof entry.args, 'string');
    assert.equal(typeof entry.metadata, 'object');
    assert.equal(typeof entry.duplicateGroup, 'number');
    assert.equal(typeof entry.winner, 'boolean');
  }
});

test('manifest freezes exact set membership and featured IDs', () => {
  const fixture = manifest();
  for (const protocol of ['tcp', 'udp']) {
    for (const set of ['quick', 'standard', 'full']) {
      const ids = fixture.sets[protocol][set];
      assert.ok(Array.isArray(ids));
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every(id => typeof id === 'string'));
    }
    assert.ok(fixture.sets[protocol].quick.length <= 30);
    assert.ok(fixture.sets[protocol].standard.length <= 80);
    assert.ok(fixture.sets[protocol].full.length <= fixture.uniqueStrategyIdCount);
  }
  assert.equal(fixture.featuredIds.length, 2);
  assert.equal(new Set(fixture.featuredIds).size, fixture.featuredIds.length);
});

test('tokenizer fixture covers Avatar whitespace and quoting semantics', () => {
  const fixture = tokenizerCases();
  assert.equal(fixture.schema, 1);
  const required = [
    'spaces', 'tabs', 'cr', 'lf', 'quoted-whitespace',
    'single-quoted-inline-lua', 'double-quoted-inline-lua',
    'multiple-flags-per-line', 'unmatched-single-quote', 'unmatched-double-quote',
  ];
  const byId = new Map(fixture.cases.map(entry => [entry.id, entry]));
  for (const id of required) assert.ok(byId.has(id), id);
  for (const entry of fixture.cases) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.input, 'string');
    assert.ok(Array.isArray(entry.tokens), entry.id);
    assert.equal(typeof entry.unmatchedQuote, 'boolean', entry.id);
  }
});

test('domain fixture covers Strategy, compiler, list, and dependency cases', () => {
  const fixture = domainCases();
  assert.equal(fixture.schema, 1);
  const requiredGroups = [
    'enabled-defaulting', 'empty-profiles', 'zero-enabled',
    'builtin', 'user', 'duplicate', 'favorite', 'active',
    'autowrap', 'lists', 'dependencies',
  ];
  const groups = new Map(fixture.groups.map(group => [group.id, group]));
  for (const id of requiredGroups) {
    assert.ok(groups.has(id), id);
    assert.ok(groups.get(id).cases.length > 0, id);
  }

  const enabled = groups.get('enabled-defaulting').cases;
  assert.deepEqual(enabled.find(entry => entry.id === 'omitted').strategy.profiles[0], {
    id: 'p1',
    args: '--filter-tcp=443',
  });
  assert.equal(enabled.find(entry => entry.id === 'true').strategy.profiles[0].enabled, true);
  assert.equal(enabled.find(entry => entry.id === 'false').strategy.profiles[0].enabled, false);

  const autowrap = groups.get('autowrap').cases;
  assert.deepEqual(autowrap.map(entry => entry.id), [
    'tls-client-hello', 'http-request', 'http-reply', 'quic-initial',
    'existing-filter', 'missing-lua', 'unknown-payload', 'payload-all',
  ]);
  assert.deepEqual(groups.get('lists').cases.map(entry => entry.id), [
    'explicit-hostlist', 'missing-explicit-hostlist', 'none', 'hostlist',
    'autohostlist', 'auto', 'ipset', 'existing-hostlist', 'existing-ipset',
    'existing-exclude',
  ]);
  assert.deepEqual(groups.get('dependencies').cases.map(entry => entry.id), [
    'blob-present', 'blob-missing', 'lua-present', 'lua-missing',
    'hostlist-present', 'hostlist-missing', 'ipset-present', 'ipset-missing',
  ]);
});
