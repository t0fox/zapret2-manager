import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');

const drafts = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-draft.uc');
const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-cli.uc');
const apply = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');

function composeProfiles(profiles) {
  if (!profiles.length) return { ok: false, code: 'ESTATE' };

  const fragments = profiles.map(profile => profile.opt.trim());
  if (fragments.some(fragment => !fragment || /[\r\n]/.test(fragment)
      || /(^|\s)--new(?:\s|$)/.test(fragment))) {
    return { ok: false, code: 'EINPUT' };
  }

  return { ok: true, candidate: fragments.join(' --new ') };
}

function reorderProfiles(state, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
      || !Array.isArray(input.ids) || input.revisions === null
      || typeof input.revisions !== 'object' || Array.isArray(input.revisions)) {
    return { ok: false, error: { code: 'EINPUT' } };
  }
  if (input.ids.length !== state.profiles.length || new Set(input.ids).size !== input.ids.length)
    return { ok: false, error: { code: 'ESTATE' } };

  const current = new Map(state.profiles.map(profile => [profile.id, profile]));
  if (input.ids.some(id => typeof id !== 'string' || !current.has(id)))
    return { ok: false, error: { code: 'ESTATE' } };

  for (const profile of state.profiles) {
    const revision = input.revisions[profile.id];
    if (!Number.isInteger(revision) || revision !== profile.revision)
      return { ok: false, error: { code: 'ECONFLICT' } };
  }

  return {
    ok: true,
    ids: [...input.ids],
    state: { ...state, profiles: input.ids.map(id => current.get(id)) },
  };
}

const state = {
  profiles: [
    { id: 'p000001', revision: 1, opt: '--filter-tcp=80' },
    { id: 'p000002', revision: 3, opt: '--filter-tcp=443' },
  ],
};

const validInput = {
  ids: ['p000002', 'p000001'],
  revisions: { p000001: 1, p000002: 3 },
};

test('reorder changes only profile order', () => {
  const result = reorderProfiles(state, validInput);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ids, ['p000002', 'p000001']);
  assert.deepEqual(result.state.profiles, [state.profiles[1], state.profiles[0]]);
  assert.strictEqual(result.state.profiles[0], state.profiles[1]);
  assert.strictEqual(result.state.profiles[1], state.profiles[0]);
});

for (const { name, input, code } of [
  {
    name: 'duplicate IDs are rejected as invalid state',
    input: { ids: ['p000001', 'p000001'], revisions: validInput.revisions },
    code: 'ESTATE',
  },
  {
    name: 'omitted IDs are rejected as invalid state',
    input: { ids: ['p000001'], revisions: validInput.revisions },
    code: 'ESTATE',
  },
  {
    name: 'unknown IDs are rejected as invalid state',
    input: { ids: ['p000001', 'p999999'], revisions: validInput.revisions },
    code: 'ESTATE',
  },
  {
    name: 'missing revisions are rejected as conflicts',
    input: { ids: validInput.ids, revisions: { p000001: 1 } },
    code: 'ECONFLICT',
  },
  {
    name: 'non-integer revisions are rejected as conflicts',
    input: { ids: validInput.ids, revisions: { p000001: 1, p000002: 3.5 } },
    code: 'ECONFLICT',
  },
  {
    name: 'stale revisions are rejected as conflicts',
    input: { ids: validInput.ids, revisions: { p000001: 1, p000002: 2 } },
    code: 'ECONFLICT',
  },
]) {
  test(name, () => {
    assert.equal(reorderProfiles(state, input).error.code, code);
  });
}

test('production exports reorder and routes it through the state lock', () => {
  assert.match(drafts, /export const profiles_reorder = function\(input\)/);
  assert.match(cli, /import \{[^}]*profiles_reorder[^}]*\} from '\.\/profiles-draft\.uc'/);
  assert.match(cli, /mode == 'reorder'/);
  assert.match(cli, /profiles_reorder\(read_args\(ARGV\[1\]\)\)/);
  assert.match(cli, /let lock = mode == 'apply' \? CONFIG_LOCK : STATE_LOCK/);
});

test('compiler deterministically composes ordered profile fragments', () => {
  const special = '--hostlist=\"$HOME`cmd`\\list\"';
  const cases = [
    { profiles: [{ opt: '--filter-tcp=80' }], candidate: '--filter-tcp=80' },
    {
      profiles: [{ opt: '--filter-tcp=80' }, { opt: '--filter-tcp=443' }],
      candidate: '--filter-tcp=80 --new --filter-tcp=443',
    },
    {
      profiles: [{ opt: '--filter-tcp=443' }, { opt: '--filter-tcp=80' }],
      candidate: '--filter-tcp=443 --new --filter-tcp=80',
    },
    { profiles: [{ opt: ' \t--filter-tcp=80\r\n' }], candidate: '--filter-tcp=80' },
    { profiles: [{ opt: special }], candidate: special },
  ];

  for (const { profiles, candidate } of cases)
    assert.deepEqual(composeProfiles(profiles), { ok: true, candidate });

  assert.notEqual(composeProfiles(cases[1].profiles).candidate,
    composeProfiles(cases[2].profiles).candidate);
});

for (const { name, profiles, code } of [
  { name: 'empty profile sets are refused', profiles: [], code: 'ESTATE' },
  { name: 'multiline fragments are refused', profiles: [{ opt: '--foo\n--bar' }], code: 'EINPUT' },
  { name: 'embedded profile separators are refused', profiles: [{ opt: '--foo --new --bar' }], code: 'EINPUT' },
]) {
  test(name, () => assert.deepEqual(composeProfiles(profiles), { ok: false, code }));
}

test('production compiler enforces the executable composition matrix', () => {
  assert.match(apply, /let frag = trim_ws\(p\.opt != null \? p\.opt : ''\)/);
  assert.match(apply, /index\(frag, '\\n'\) >= 0 \|\| index\(frag, '\\r'\) >= 0/);
  assert.match(apply, /length\(model\.profiles\) != 1 \|\| length\(model\.trailingTokens\) > 0/);
  assert.match(apply, /let candidate = join\(' --new ', frags\)/);
  assert.match(apply, /candidate_round_trip\(rc\.candidate, rc\.fragments\)/);
});
