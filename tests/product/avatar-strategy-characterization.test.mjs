import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy');
const readFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));

const manifest = () => readFixture('manifest.expected.json');
const tokenizerCases = () => readFixture('tokenizer-cases.json');
const domainCases = () => readFixture('domain-cases.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const EXPECTED_FILES = [
  ['advanced/discord_voice_zapret2_advanced.txt', 17822, 75, '5da32af9b03f005405a1c3aecb608354e81763895cd2396c6e0edb56042a8844', '9ad81008ac689d6f4690ca3d07b63cdeeb63ce75f9ba6a540fbdb075d2827b3b'],
  ['advanced/http80_blockcheckw.txt', 1216, 2, '3fe64a1df68247b62685f6d89663de19797e4794482bada49046fc2ea750f805', '89633ab90c9f80831dce4b63ae8967f99fdb4fe3038e8ed1e443f7bba751e65a'],
  ['advanced/http80_zapret2_advanced.txt', 31935, 127, '50769638b45bcb968e1edba2b9db6932c9bc4caaeae19e7a933e4200feddf3fe', 'a5023fc54799cc103603154e702c85a440e01c6e82a7f3ab8fe8a3a9fbcc0e15'],
  ['advanced/tcp_blockcheckw.txt', 3039, 6, 'bfe77d1610317182f1f86316aaaa17107e081e9b505bb704afe509d3c516d865', '900fe8fac4c4c8cb5fad4c41bc4d70c83e42dfc04dfdd05354999b123e7c1830'],
  ['advanced/tcp_fake_zapret2_advanced.txt', 6218, 24, 'f3d75636a7e9c686f71bef55b9af22efaaafd67bfb8d086386db04c0658293c9', '4d37865decfa4c50f2819a711526cd5d38caa8f4553d8ae87d72fad0c45d969a'],
  ['advanced/tcp_z2k_advanced.txt', 1502, 3, '8625f516ecb9993199d6bb96116b50b86128bb27301f6929148b481f8534f995', '60deb0b7e47e243a767e58837fd841e0cf99cca4a3ec3880b6f4ad937ca4bad8'],
  ['advanced/tcp_zapret2_advanced.txt', 64915, 253, '0a9b988e01a36abb3dc27eaa296b626186e620a62556b386edaec73afa907b14', '7a261fdca04c3fb03e723e9066dfbb2e0b1065584c1ace51471c710ff7fdef2e'],
  ['advanced/udp_z2k_advanced.txt', 1862, 5, 'd8a2bd471d3a5fbdff88ac94a02236e36719e68882796d7b1fda45991003a5fc', 'a33f31b8041072ddd7e95f53715944984b2c4f73a36779a199828760d7ba2214'],
  ['advanced/udp_zapret2_advanced.txt', 15654, 70, '95085372bca639eb8499b5fdd4c17dcfa4db46b84c45afe4f05c44fb10b185c2', 'a7c3d26bd101fe1306dbd8cb5220191350b72466b7f9ca428a04cf323c43b28c'],
  ['basic/discord_voice_zapret2_basic.txt', 17549, 73, '9feab1d06f15213bd1c3daac8910f7c3cc8e8af32075eaed2cad458152424f11', 'b6c234257c590194298d75d1b1b0b9a55da8e4504e789a1832acedb4d3f46817'],
  ['basic/http80_zapret2_basic.txt', 31802, 126, '9d7ce7c906f37494a05d511e6b56d430cef3c642145a1359101741c922acd3f9', '50446448c37f7751ccf4e275b2d4f8a06f6016375f816213a8359e268a3f1e67'],
  ['basic/tcp_zapret2_basic.txt', 59399, 235, '035dd277e62e8705784348e2fcc34fc68cda8440d7999cf7cfa99188d34ba1af', '85b718612db8ba452f0022508d5a8b1ec1592db7c4ba7fbe4736ad35f941c3a9'],
  ['basic/udp_zapret_basic.txt', 14193, 62, '8fbca351b3ed724fa84e20ff791461df69d69aba229663e69e349e40aeaf7ab6', 'd0bfdd06eaf61168517d0f82eb0e459030d2708b698a15c40e9b6090572b72b4'],
  ['builtin/winws2_presets.txt', 456467, 85, '87d33c2c202f365a48945a3326183a8e0bf638cd757dcbdbdde8f2c3c9768e8a', 'fb011937d040af2c3b1813d2542effee53516057a5a60f7ca1acaafd208b6540'],
  ['builtin/z2k_all_in_one.txt', 6809, 1, '83f79ba2f3566f9f5fa7e330c3b4e4b03b4afbfda1995f55f7b6133786d9ecaf', '4a0db8e10c82ae9f41b0aa7823313cbddadf9f56030767b5fa6ebaf54298b43c'],
  ['builtin/z2k_autocircular_quic.txt', 5269, 2, 'b52cc3af6779e6ea69614d4a3014d3bc864148ae321652856e51d5c6c03db143', 'cc014192cfcafdda6fddcab4f3d075d2c2dbbeace0a98131f1d1ab1a4a4ec154'],
  ['builtin/z2k_autocircular_tcp.txt', 25451, 3, '79b3df3aa7af7bfa440f2bb64cf3c8eb53c527900a8007b4213f5455af22b50d', '7d04345754546c4832d82c6f153d806f3b62e4c430c9fac432bf73da15ace7c9'],
  ['builtin/z2k_circular.txt', 3113, 1, 'd4e998e7a38c1232525c712f4d2411d64fe6f11ee22e2ed45be6dc0def348b7e', 'b776c4f7532b40602b2a99cb3d17ea7b627412f431af9d4717feedb35b6ffb77'],
  ['builtin/zapret_gui_defaults.txt', 5288, 8, '161aa598c2bdd860cc4c67123a78a32077722bdafbb907cfc12d7a17b9c4d7a9', 'c84363cbe88e255b989054473de70daed818cfc5dd9bd14a74eb1b9313d86dcd'],
  ['direct/http80.txt', 53439, 174, 'bce0dda3f008af8c6c3f3d6d51cfeb383226efcfea51baecb12c42f772436de3', '54e4b892cf4f4ad8a6ba62e36f1dea0c05ae96c8865e29c1640cbbb92a2ace15'],
  ['direct/tcp.txt', 104864, 354, '5d5a57b8a96010d20bfb8bdf10eed1c41a50b58fe5cb3bcf4fdbf75ac3b079e1', '0f9c35c1636134e8514a730fe7ec5d4edf34bb66d55411f2cf27f69b142f26e0'],
  ['direct/udp.txt', 16275, 71, 'c0d0239b8d4883ae7ddb49c316dfad00b6a6bf0be9c17a62804b2a9ea5e7894c', '1413d6cd719dfeec251d4e3ff7f303c228c6dcde04451781a7fb8cd7ba614327'],
  ['direct/voice.txt', 18148, 76, 'e4f444173a19e9364536b80c7df1197b50be225ba783b0947e1422bc78002b4b', '1f5581ca6ff62639ef2d3a01a33d6055e278988ae54c55463c9e0fbd1d3120a2'],
];

const EXPECTED_DIGESTS = {
  duplicateGroups: 'ab90abdeb9f5168a7858e9ed5d0e25fe7b2af0368b6676063b2cd1a2364433f4',
  winnerOrder: '596cc2ea5d4f1752f900cf54de869da73bdfda356775005aa844f6dafe452fd3',
  physicalEntries: '481a20145e5750f54e9409de2d58463884ff58dfa9ddd4f752a73b94354a9c05',
  sets: 'f43ca59e617f3e8d2f7f3e2edf71c76066a36f9b4a97f2610be7e3f8c1e80e66',
};

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
  assert.equal(fixture.aggregateDigestAlgorithm,
    'sha256(source-order lines "<file-sha256>  catalogs/<relative-path>\\n")');
  assert.deepEqual(fixture.featuredIds, ['z2k_all_in_one', 'z2k_tls_circular_smart']);
});

test('manifest inventory preserves audited files and physical arithmetic', () => {
  const fixture = manifest();
  assert.equal(fixture.files.length, fixture.physicalFileCount);
  assert.equal(fixture.physicalEntries.length, fixture.physicalEntryCount);
  assert.equal(fixture.physicalEntries.at(-1).sourceOrdinal, fixture.physicalEntryCount);
  assert.deepEqual(fixture.files.map(file => [
    file.path,
    file.byteSize,
    file.physicalEntryCount,
    file.sha256,
    digest(file.sourceOrder),
  ]), EXPECTED_FILES);
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
  assert.equal(digest(fixture.duplicateGroups), EXPECTED_DIGESTS.duplicateGroups);
  assert.equal(digest(fixture.winnerOrder), EXPECTED_DIGESTS.winnerOrder);
  assert.equal(digest(fixture.physicalEntries), EXPECTED_DIGESTS.physicalEntries);
  assert.equal(digest(fixture.sets), EXPECTED_DIGESTS.sets);
  assert.deepEqual(fixture.physicalEntries.map(entry => entry.sourceOrdinal),
    Array.from({ length: fixture.physicalEntryCount }, (_, index) => index + 1));
  assert.deepEqual([...fixture.physicalEntries].sort((a, b) => a.cacheOrdinal - b.cacheOrdinal)
    .map(entry => entry.cacheOrdinal),
    Array.from({ length: fixture.physicalEntryCount }, (_, index) => index + 1));
  const cacheTraversal = [...new Set([...new Set(fixture.physicalEntries.map(entry => entry.cacheKey))]
    .sort()
    .flatMap(cacheKey => fixture.physicalEntries
      .filter(entry => entry.cacheKey === cacheKey)
      .map(entry => entry.id)))];
  assert.deepEqual(fixture.winnerOrder, cacheTraversal);
  assert.equal(fixture.physicalEntries.filter(entry => entry.winner).length,
    fixture.uniqueStrategyIdCount);
  for (const group of fixture.duplicateGroups) {
    const occurrences = fixture.physicalEntries.filter(entry => entry.id === group.id);
    assert.deepEqual(occurrences.map(entry => entry.sourceOrdinal), group.occurrences, group.id);
    assert.equal(occurrences.find(entry => entry.winner)?.sourceOrdinal ?? null, group.winner, group.id);
  }

  for (const file of fixture.files) {
    assert.match(file.path, /^(advanced|basic|builtin|direct)\/[^/]+\.txt$/);
    assert.ok(Number.isInteger(file.byteSize) && file.byteSize > 0, file.path);
    assert.match(file.sha256, /^[0-9a-f]{64}$/, file.path);
    assert.ok(['advanced', 'basic', 'builtin', 'direct'].includes(file.level), file.path);
    assert.ok(['tcp', 'udp'].includes(file.protocol), file.path);
    assert.equal(file.sourceOrder.length, file.physicalEntryCount, file.path);
    assert.equal(digest(file.sourceOrder), EXPECTED_FILES.find(expected => expected[0] === file.path)[4], file.path);
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
  assert.deepEqual(Object.fromEntries(Object.entries(fixture.sets).map(([protocol, sets]) => [
    protocol, Object.fromEntries(Object.entries(sets).map(([name, ids]) => [name, ids.length])),
  ])), {
    tcp: { quick: 30, standard: 80, full: 630 },
    udp: { quick: 30, standard: 80, full: 104 },
  });
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
  for (const expected of [
    { id: 'spaces', input: '--filter-tcp=80   --payload=http_req', tokens: ['--filter-tcp=80', '--payload=http_req'], unmatchedQuote: false },
    { id: 'tabs', input: '--filter-tcp=80\t--filter-l7=http\t--payload=http_req', tokens: ['--filter-tcp=80', '--filter-l7=http', '--payload=http_req'], unmatchedQuote: false },
    { id: 'cr', input: '--filter-tcp=80\r--payload=http_req', tokens: ['--filter-tcp=80', '--payload=http_req'], unmatchedQuote: false },
    { id: 'lf', input: '--filter-tcp=80\n--payload=http_req', tokens: ['--filter-tcp=80', '--payload=http_req'], unmatchedQuote: false },
    { id: 'quoted-whitespace', input: "--lua-desync=luaexec:code='desync.x = 1 return' --payload=http_req", tokens: ["--lua-desync=luaexec:code='desync.x = 1 return'", '--payload=http_req'], unmatchedQuote: false },
    { id: 'single-quoted-inline-lua', input: "--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd') --lua-desync=wssize:wsize=1:scale=6 --payload=tls_client_hello", tokens: ["--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd')", '--lua-desync=wssize:wsize=1:scale=6', '--payload=tls_client_hello'], unmatchedQuote: false },
    { id: 'double-quoted-inline-lua', input: '--lua-init=x=f("rnd") --payload=tls_client_hello', tokens: ['--lua-init=x=f("rnd")', '--payload=tls_client_hello'], unmatchedQuote: false },
    { id: 'multiple-flags-per-line', input: '--filter-tcp=80,443 --filter-l7=tls,http --ipcache-hostname=1 --lua-desync=fake:strategy=1 --lua-desync=multisplit:strategy=1', tokens: ['--filter-tcp=80,443', '--filter-l7=tls,http', '--ipcache-hostname=1', '--lua-desync=fake:strategy=1', '--lua-desync=multisplit:strategy=1'], unmatchedQuote: false },
    { id: 'unmatched-single-quote', input: "--lua-init=code='desync.x = 1 --payload=http_req", tokens: ["--lua-init=code='desync.x = 1 --payload=http_req"], unmatchedQuote: true },
    { id: 'unmatched-double-quote', input: '--lua-init=code="desync.x = 1 --payload=http_req', tokens: ['--lua-init=code="desync.x = 1 --payload=http_req'], unmatchedQuote: true },
    { id: 'newline-inside-quote', input: "--lua-desync=luaexec:code='desync.x = 1\nreturn' --payload=http_req", tokens: ["--lua-desync=luaexec:code='desync.x = 1\nreturn'", '--payload=http_req'], unmatchedQuote: false },
    { id: 'empty', input: '', tokens: [], unmatchedQuote: false },
  ]) assert.deepEqual(byId.get(expected.id), expected, expected.id);
});

test('domain fixture covers Strategy, compiler, list, and dependency cases', () => {
  const fixture = domainCases();
  assert.equal(fixture.schema, 1);
  const requiredGroups = [
    'enabled-defaulting', 'empty-profiles', 'zero-enabled',
    'builtin', 'user', 'duplicate', 'favorite', 'active',
    'preview', 'validation', 'mutation',
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
  assert.deepEqual(enabled.map(entry => ({ id: entry.id, expectedEnabled: entry.expectedEnabled, expectedArgs: entry.expectedArgs })), [
    { id: 'omitted', expectedEnabled: [true], expectedArgs: ['--filter-tcp=443'] },
    { id: 'true', expectedEnabled: [true], expectedArgs: ['--filter-tcp=443'] },
    { id: 'false', expectedEnabled: [false], expectedArgs: [] },
  ]);

  assert.deepEqual(groups.get('empty-profiles').cases.map(entry => ({
    id: entry.id,
    expectedStructuralValid: entry.expectedStructuralValid,
    expectedCreateValid: entry.expectedCreateValid,
    expectedUpdateValid: entry.expectedUpdateValid,
  })), [
    { id: 'structurally-valid', expectedStructuralValid: true, expectedCreateValid: false, expectedUpdateValid: true },
    { id: 'missing-array', expectedStructuralValid: false, expectedCreateValid: undefined, expectedUpdateValid: undefined },
  ]);
  assert.deepEqual(groups.get('zero-enabled').cases.map(entry => ({
    id: entry.id,
    expectedPreview: entry.expectedPreview,
    expectedValidateError: entry.expectedValidateError,
    expectedApplyError: entry.expectedApplyError,
  })), [
    { id: 'all-disabled', expectedPreview: { ok: true, args: [], profiles_count: 0, applicable: false }, expectedValidateError: 'ENOENABLED', expectedApplyError: 'ENOENABLED' },
    { id: 'empty-array', expectedPreview: { ok: true, args: [], profiles_count: 0, applicable: false }, expectedValidateError: 'ENOENABLED', expectedApplyError: 'ENOENABLED' },
  ]);
  assert.deepEqual(groups.get('builtin').cases.map(entry => ({
    id: entry.id,
    expectedOrigin: entry.expectedOrigin,
    expectedMutationErrors: entry.expectedMutationErrors,
    expectedDuplicate: entry.expectedDuplicate,
  })), [
    { id: 'immutable', expectedOrigin: 'avatar_builtin', expectedMutationErrors: { create: 'ECONFLICT', update: 'EIMMUTABLE', delete: 'EIMMUTABLE' }, expectedDuplicate: { id: 'z2k_all_in_one_copy', name: 'All in one (copy)', origin: 'user' } },
  ]);
  assert.deepEqual(groups.get('user').cases.map(entry => ({
    id: entry.id,
    expectedOrigin: entry.expectedOrigin,
    expectedMutable: entry.expectedMutable,
    expectedRevision: entry.expectedRevision,
  })), [
    { id: 'crud', expectedOrigin: 'user', expectedMutable: true, expectedRevision: 1 },
  ]);
  assert.deepEqual(groups.get('duplicate').cases.map(entry => ({
    id: entry.id,
    expectedProfileIds: entry.expectedProfileIds,
    expectedOrder: entry.expectedOrder,
    expectedCompiledArgs: entry.expectedCompiledArgs,
  })), [
    { id: 'duplicate-child-ids-preserved', expectedProfileIds: ['p1', 'p1'], expectedOrder: ['--filter-tcp=80', '--filter-tcp=443'], expectedCompiledArgs: ['--filter-tcp=80'] },
  ]);
  assert.deepEqual(groups.get('favorite').cases.map(entry => ({
    id: entry.id,
    visibleIds: entry.visibleIds,
    initialFavorites: entry.initialFavorites,
    toggle: entry.toggle,
    deletedId: entry.deletedId,
    expectedFavorites: entry.expectedFavorites,
    expectedBuiltinFavorite: entry.expectedBuiltinFavorite,
  })), [
    { id: 'ordered-toggle', visibleIds: ['z2k_all_in_one', 'user-one'], initialFavorites: [], toggle: ['user-one', 'z2k_all_in_one'], deletedId: undefined, expectedFavorites: ['user-one', 'z2k_all_in_one'], expectedBuiltinFavorite: true },
    { id: 'delete-cleans-user', visibleIds: undefined, initialFavorites: ['user-one', 'z2k_all_in_one'], toggle: undefined, deletedId: 'user-one', expectedFavorites: ['z2k_all_in_one'], expectedBuiltinFavorite: undefined },
  ]);
  assert.deepEqual(groups.get('active').cases.map(entry => ({
    id: entry.id,
    selected: entry.selected,
    deletedId: entry.deletedId,
    expectedProjection: entry.expectedProjection,
    expectedSelection: entry.expectedSelection,
  })), [
    { id: 'selected-user', selected: { id: 'user-one', origin: 'user', revision: 3, candidateSha256: 'abc' }, deletedId: undefined, expectedProjection: { is_active: true, id: 'user-one', origin: 'user' }, expectedSelection: undefined },
    { id: 'deleted-active-user', selected: { id: 'user-one', origin: 'user' }, deletedId: 'user-one', expectedProjection: undefined, expectedSelection: null },
  ]);
  assert.deepEqual(groups.get('preview').cases, [
    { id: 'zero-enabled-inspection', expected: { ok: true, args: [], profiles_count: 0, applicable: false } },
  ]);
  assert.deepEqual(groups.get('validation').cases, [
    { id: 'zero-enabled-rejected', expectedError: 'ENOENABLED' },
  ]);
  assert.deepEqual(groups.get('mutation').cases, [
    { id: 'builtin-update-rejected', operation: 'update', expectedError: 'EIMMUTABLE' },
    { id: 'user-update-accepted', operation: 'update', expectedOk: true, expectedRevision: 1 },
  ]);

  const autowrap = groups.get('autowrap').cases;
  assert.deepEqual(autowrap.map(entry => entry.id), [
    'tls-client-hello', 'http-request', 'http-reply', 'quic-initial',
    'existing-filter', 'missing-lua', 'unknown-payload', 'payload-all',
  ]);
  assert.deepEqual(autowrap.map(entry => ({ id: entry.id, input: entry.input, expected: entry.expected })), [
    { id: 'tls-client-hello', input: ['--payload=tls_client_hello', '--lua-desync=fake:blob=fake_default_tls'], expected: ['--filter-tcp=443', '--filter-l7=tls', '--payload=tls_client_hello', '--lua-desync=fake:blob=fake_default_tls'] },
    { id: 'http-request', input: ['--payload=http_req', '--lua-desync=fake:blob=fake_default_http'], expected: ['--filter-tcp=80', '--filter-l7=http', '--payload=http_req', '--lua-desync=fake:blob=fake_default_http'] },
    { id: 'http-reply', input: ['--payload=http_reply', '--lua-desync=fake'], expected: ['--filter-tcp=80', '--filter-l7=http', '--payload=http_reply', '--lua-desync=fake'] },
    { id: 'quic-initial', input: ['--payload=quic_initial', '--lua-desync=fake'], expected: ['--filter-udp=443', '--filter-l7=quic', '--payload=quic_initial', '--lua-desync=fake'] },
    { id: 'existing-filter', input: ['--filter-tcp=443', '--filter-l7=tls', '--lua-desync=fake'], expected: ['--filter-tcp=443', '--filter-l7=tls', '--lua-desync=fake'] },
    { id: 'missing-lua', input: ['--payload=tls_client_hello'], expected: ['--payload=tls_client_hello'] },
    { id: 'unknown-payload', input: ['--payload=dns_query', '--lua-desync=fake'], expected: ['--payload=dns_query', '--lua-desync=fake'] },
    { id: 'payload-all', input: ['--payload=all', '--lua-desync=fake:blob=quic_google:repeats=6'], expected: ['--payload=all', '--lua-desync=fake:blob=quic_google:repeats=6'] },
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
  assert.deepEqual(groups.get('lists').cases.map(entry => ({
    id: entry.id,
    mode: entry.mode,
    path: entry.path,
    present: entry.present,
    excludePresent: entry.excludePresent,
    expectedFlags: entry.expectedFlags,
    args: entry.args,
    injected: entry.injected,
    expectedArgs: entry.expectedArgs,
  })), [
    { id: 'explicit-hostlist', mode: 'explicit', path: '/scan/other.txt', present: true, excludePresent: undefined, expectedFlags: ['--hostlist=/scan/other.txt'], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'missing-explicit-hostlist', mode: 'explicit', path: '/scan/missing.txt', present: false, excludePresent: undefined, expectedFlags: [], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'none', mode: 'none', path: undefined, present: undefined, excludePresent: true, expectedFlags: ['--hostlist-exclude=/lists/netrogat.txt'], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'hostlist', mode: 'hostlist', path: undefined, present: undefined, excludePresent: true, expectedFlags: ['--hostlist-exclude=/lists/netrogat.txt'], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'autohostlist', mode: 'autohostlist', path: undefined, present: undefined, excludePresent: true, expectedFlags: ['--hostlist-auto=/lists/auto.txt', '--hostlist-exclude=/lists/netrogat.txt'], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'auto', mode: 'auto', path: undefined, present: undefined, excludePresent: true, expectedFlags: ['--hostlist-auto=/lists/auto.txt', '--hostlist-exclude=/lists/netrogat.txt'], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'ipset', mode: 'ipset', path: undefined, present: undefined, excludePresent: true, expectedFlags: [], args: undefined, injected: undefined, expectedArgs: undefined },
    { id: 'existing-hostlist', mode: undefined, path: undefined, present: undefined, excludePresent: undefined, expectedFlags: undefined, args: ['--filter-tcp=443', '--hostlist=/custom/include.txt', '--lua-desync=multisplit'], injected: ['--hostlist-auto=/lists/auto.txt', '--hostlist-exclude=/lists/netrogat.txt'], expectedArgs: ['--filter-tcp=443', '--hostlist=/custom/include.txt', '--hostlist-exclude=/lists/netrogat.txt', '--lua-desync=multisplit'] },
    { id: 'existing-ipset', mode: undefined, path: undefined, present: undefined, excludePresent: undefined, expectedFlags: undefined, args: ['--filter-udp=443', '--ipset=/custom/ipset.txt', '--lua-desync=fake'], injected: [], expectedArgs: ['--filter-udp=443', '--ipset=/custom/ipset.txt', '--lua-desync=fake'] },
    { id: 'existing-exclude', mode: undefined, path: undefined, present: undefined, excludePresent: undefined, expectedFlags: undefined, args: ['--filter-tcp=443', '--hostlist-exclude=/custom/exclude.txt', '--lua-desync=multisplit'], injected: ['--hostlist-exclude=/lists/netrogat.txt'], expectedArgs: ['--filter-tcp=443', '--hostlist-exclude=/custom/exclude.txt', '--lua-desync=multisplit'] },
  ]);
  assert.deepEqual(groups.get('dependencies').cases.map(entry => ({
    id: entry.id,
    kind: entry.kind,
    reference: entry.reference,
    present: entry.present,
    expectedAvailable: entry.expectedAvailable,
  })), [
    { id: 'blob-present', kind: 'blob', reference: 'fake_default_tls', present: true, expectedAvailable: true },
    { id: 'blob-missing', kind: 'blob', reference: 'missing_blob', present: false, expectedAvailable: false },
    { id: 'lua-present', kind: 'lua', reference: 'desync.lua', present: true, expectedAvailable: true },
    { id: 'lua-missing', kind: 'lua', reference: 'missing.lua', present: false, expectedAvailable: false },
    { id: 'hostlist-present', kind: 'hostlist', reference: 'other.txt', present: true, expectedAvailable: true },
    { id: 'hostlist-missing', kind: 'hostlist', reference: 'missing.txt', present: false, expectedAvailable: false },
    { id: 'ipset-present', kind: 'ipset', reference: 'youtube.txt', present: true, expectedAvailable: true },
    { id: 'ipset-missing', kind: 'ipset', reference: 'missing.txt', present: false, expectedAvailable: false },
  ]);
});
