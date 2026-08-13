---
id: plan-avatar-strategy-catalog-parity
title: "Avatar Strategy Catalog Parity Implementation Plan"
type: plan
status: planned
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [plan, strategy, catalog, parity]
---

# Avatar Strategy Catalog Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Avatar-compatible Strategy aggregate and complete pinned Strategy catalog over the existing safe Profiles compiler and transactional Apply substrate.

**Architecture:** The public product/domain behavior follows pinned
`avatarDD/zapret-gui`. Strategies own ordered Profiles. The full pinned physical
catalog is parsed natively and remains immutable product data. Existing
`zapret2-manager` Profile validation/compiler/preflight/transaction/rollback
remains the sole runtime mutation substrate.

**Tech Stack:** OpenWrt, ucode, rpcd/ubus, LuCI JavaScript, procd, UCI/native
configuration, existing narrow native helper, Node-based repository test
harness where already established.

## Global Constraints

- Behavioral source is `avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`.
- Continue on `m5-native-state-store`; use existing PR #32; create zero branches and zero PRs.
- Do not modify `main`, merge PR #32, revive Task 11/12, or perform repository-wide migration.
- Do not implement Scanner, Orchestra winner integration, BlockCheck, BlockCheck2, Auto-remediation, online catalog update, full Lua/Blob registries, DNS, Telegram, WARP/routing, or schema 4.
- Do not add Python/Bottle, arbitrary shell RPC, a second compiler, a second Apply engine, or a second Strategy page.
- `Strategy` owns ordered `profiles[]`; Profile input requires only `id` and `args`; `enabled` is optional and defaults to `true`.
- Disabled Profiles remain stored and visible; only enabled Profiles compile in array order; exactly one `--new` joins adjacent enabled Profiles.
- Zero enabled Profiles compile successfully to `args: []`; pure Preview succeeds as non-executable; Validate and Apply reject.
- Avatar list and detail responses are full Strategy objects by default; a list projection requires measured OpenWrt evidence and `OPENWRT_NATIVE` classification.
- Avatar Preview accepts persisted `strategy_id` and inline `strategy_data`; `validate=true` is optional; Apply accepts only authoritative persisted/revision-bound identity.
- Preview returns Strategy args, full effective command/argv, profile count, digest, dependency availability and executable/applicable state; LuCI never composes commands.
- Avatar-facing args accept spaces, tabs, CR/LF and quoted values; token-semantic equality is required after native canonicalization.
- Canonical Strategy protocol is only `tcp` or `udp`; HTTP80, QUIC/HTTP3 and Discord Voice remain source/category/filter distinctions.
- The physical snapshot is `advanced/`, `basic/`, `builtin/`, `direct/`; there is no packaged `catalogs/presets/` directory; `builtin/winws2_presets.txt` is included.
- Preserve 23 files, 1,836 physical entries, 732 unique IDs, duplicate occurrences, aggregate digest `5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1`, and exact winner traversal.
- User Strategies live under `/etc/zapret2-manager/strategies/`; persisted selection/favorites live in `/etc/zapret2-manager/strategy-state.json`; existing drafts remain in `/etc/zapret2-manager/state.json`.
- Strategy feature documents never persist current drift, dependency availability, runtime health, process state or queue state; status derives those observations read-only.
- Existing `profiles.uc`, `profiles-apply.uc`, `apply.uc`, native preflight, schema-3 status and rollback are reused; Strategy code never directly writes `/opt/zapret2/config`.
- Apply is Replace Full Set and must produce coherent config/runtime/identity outcome; active-identity reconciliation remains volatile and not reboot-durable.
- Every behavior task uses RED → GREEN → adjacent regression tests → `git diff --check` → focused commit.
- Final verification uses repository-discovered commands, not invented test runners.

## File / Module Map

### Existing files to reuse or modify

| Path | Responsibility | Interfaces consumed/produced | Why it changes or stays |
|---|---|---|---|
| `zapret2-manager/files/usr/libexec/zapret2-manager/profiles.uc` | Applied NFQWS2 parser, tokenizer, diagnostics, lossless fragment extraction | `z2m_tokenize`, `z2m_parse`, `z2m_validate`, `z2m_fragment` | Reuse unchanged initially; only extend if a proven shared token helper is required without changing Profile wire behavior. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-draft.uc` | Legacy draft CRUD in `/etc/zapret2-manager/state.json` | Profile CRUD/revision/import | Preserve as compatibility tooling; do not reinterpret its state schema. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-cli.uc` | Locked Profile request-file dispatch | `flock_wrap`, `full_native_verified` | Reuse locking conventions; do not route Strategy requests through Profile-only modes. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc` | Full-set renderer, preflight, CAS, restart, verification, rollback | `profiles_render_candidate`, `profiles_apply_candidate` | Extend only with the narrow Strategy identity commit hook needed for coherent Apply. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply-cli.uc` | Locked typed-candidate execution | candidate JSON request | Reuse as the sole config transaction worker. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc` | Sole `/opt/zapret2/config` writer | `read_var`, `set_var_cas`, `restore_whole_file`, hashes | Remains authoritative; no Strategy direct write. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc` | Pinned engine/Lua/dry-run admission | `native_preflight(candidate)` | Reuse for Validate/Apply; pure Preview reports dependency status without requiring it. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/constants.uc` | Current paths and native limits | `PATHS` | Add only bounded Strategy path constants if the existing object cannot own them. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc` | Runtime/applied/observation collection | `collect_observations`, `collect` | Add read-only Strategy projection input; no feature writes. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc` | Schema-3 projection | `legacy_status_v3` | Preserve pure schema-3 fields; consume derived Strategy projection. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-observations.uc` | Derived runtime observations | `derive_runtime_observation` | Add derived Strategy match/drift/availability projection without persistence. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/catalog.uc` | Existing service/domain catalog | `catalog_list/get/status/preview/apply` | Do not overload or rename; tests assert separate domains. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc` | Existing Orchestra jobs/candidate Apply | Orchestra runner interfaces | Leave operational and non-authoritative; only add negative boundary tests. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-corpus.uc` | Existing corpus catalog | `orchestra_catalog_get` | Leave unchanged; Strategy catalog never reads its registry. |
| `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-evidence.uc` | Existing evidence | evidence IDs/winner records | Leave unchanged. |
| `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` | Primary rpcd registration and private JSON transport | `{ edit: string }`, method registration | Add bounded `strategies_*` registrations in the existing object. |
| `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json` | Read/write ACL | ubus method lists | Add exact Strategy read/write methods; test ACL reachability. |
| `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js` | LuCI rpc declarations | `api.strategyCatalog`, `api.profiles` | Add Strategy methods while retaining Discord/Orchestra and Profile compatibility APIs. |
| `.../z2m-strategy.js` | Existing unified Strategy page and Profile pane | page rendering/actions | Make Strategy aggregate canonical; retain Profiles as Advanced/Compatibility. |
| `.../z2m-strategy-page.js` | Page module lifecycle | `load/render/mount/unmount/createAdapter` | Reuse page boundary; no new page. |
| `.../z2m-strategy-model.js` | Advanced workflow state/model | tabs and state | Remove Strategy-domain authority from Orchestra model without deleting Orchestra UI. |
| `.../z2m-strategy-workflow.js` | Workflow wrapper | core delegation | Keep as separate advanced tooling boundary. |
| `.../z2m-strategy-workflow-core.js` | Orchestra workflow | run/catalog/progress | Keep non-authoritative. |
| `.../z2m-profiles-workflow.js` | Profile compatibility editor workflow | CRUD/reorder/apply verification | Retain and expose under Advanced/Compatibility. |
| `zapret2-manager/Makefile` | Backend package installation and modes | `files/*`, postinst, conffiles | Install raw Avatar assets/manifest and create secure Strategy storage. |
| `tests/product/*.test.mjs` | Product contracts and UI/RPC source tests | Node test harness | Add focused Strategy tests beside existing Profile tests. |
| `tests/native/*.test.mjs` | Package/helper/status tests | `scripts/test/native.sh` | Add package asset/storage tests where native install behavior belongs. |
| `scripts/test/native.sh` / `scripts/test/native-root.sh` | Canonical test gates | Node/native/root execution | Reuse exact discovered commands; modify only if a new test needs registration. |

### New files to create

| Path | Single responsibility | Depends on | Later consumers |
|---|---|---|---|
| `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc` | Pure Strategy/Profile schema, Avatar tokenizer, token-semantic canonicalization and aggregate projections | ucode core types; existing Profile parser only at adapter boundary | catalog normalization, compiler, state, RPC, tests |
| `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc` | Physical snapshot read, manifest verification, traversal, CatalogEntry parsing and set lists | installed raw assets and manifest; `strategy-model.uc` | Strategy list/detail, compiler, tests |
| `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc` | Strategy transformations, list/blob/path handling, shared effective command composition and candidate digest | model, catalog, existing Profile validation and runtime inputs | Preview, Validate, Apply, status, tests |
| `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc` | User file CRUD, favorites, selection projection, revisions and volatile reconciliation record | fs/atomic patterns; existing helper roots | RPC, Apply, status, import, tests |
| `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc` | Private JSON request-file dispatch for Strategy operations | model, catalog, compiler, state, existing Apply | rpcd registration and tests |
| `zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/` | Immutable 23-file Avatar source snapshot | pinned Avatar checkout | `strategy-catalog.uc`, package tests |
| `zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json` | Provenance/integrity/set/winner manifest | generated from raw snapshot | catalog loader and package tests |
| `tests/product/avatar-strategy-characterization.test.mjs` | Pinned data/lexical/domain characterization expectations | generated fixture manifest and package snapshot | all implementation tasks |
| `tests/product/avatar-strategy-model.test.mjs` | Pure model/tokenizer/empty/ordering tests | `strategy-model.uc` | compiler/state tasks |
| `tests/product/avatar-strategy-catalog.test.mjs` | parser, traversal, normalization, sets and manifest tests | `strategy-catalog.uc` | compiler/RPC tasks |
| `tests/product/avatar-strategy-compiler.test.mjs` | transforms, dependencies, Preview command and candidate identity | model/catalog/compiler | Preview/Apply tasks |
| `tests/product/avatar-strategy-state.test.mjs` | storage/CAS/favorites/selection/reconciliation tests | `strategy-state.uc` | RPC/Apply/status tasks |
| `tests/product/avatar-strategy-rpc.test.mjs` | rpcd method/ACL/wire/error tests | CLI, rpc registration, ACL, API | LuCI/integration tasks |
| `tests/product/avatar-strategy-import.test.mjs` | explicit Profile draft import tests | state/model/Profile draft read | LuCI/integration tasks |
| `tests/product/avatar-strategy-ui.test.mjs` | canonical Strategy UI and compatibility-pane source contract | LuCI API/page/workflows | final integration |
| `tests/native/avatar-strategy-package.test.mjs` | installed asset/mode/storage/package upgrade tests | Makefile/assets/bootstrap | package task/final gate |

## Task 1: Pin Avatar Characterization Fixtures and Test Harness

**Files:**
- Create: `tests/product/avatar-strategy-characterization.test.mjs`
- Create: `tests/fixtures/avatar-strategy/manifest.expected.json`
- Create: `tests/fixtures/avatar-strategy/tokenizer-cases.json`
- Create: `tests/fixtures/avatar-strategy/domain-cases.json`
- Fixture-generation source: any verified local checkout supplied through optional `AVATAR_PINNED_SRC`; normal repository tests never require this variable or an external checkout.

**Interfaces:**
- Consumes: pinned Avatar catalog files and the already audited aggregate digest.
- Produces: generated expected manifest fields and fixture IDs consumed by Tasks 2–4.

- [ ] **Step 1: Write the failing characterization test**

```js
test('pinned Avatar fixture has the complete physical catalog contract', () => {
  const fixture = JSON.parse(readFixture('manifest.expected.json'));
  assert.equal(fixture.physicalFileCount, 23);
  assert.equal(fixture.physicalEntryCount, 1836);
  assert.equal(fixture.uniqueStrategyIdCount, 732);
  assert.equal(fixture.duplicateIdGroupCount, 503);
  assert.equal(fixture.aggregateDigest,
    '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-characterization.test.mjs`

Expected: FAIL because the fixture and packaged Avatar snapshot do not yet exist.

- [ ] **Step 3: Verify and generate the fixture from every pinned file**

When `AVATAR_PINNED_SRC` is provided, run
`git -C "$AVATAR_PINNED_SRC" rev-parse HEAD` and require
`f9dd3ea47a2239514f396a843b475c92c33f0b4c`; otherwise fail with a
fixture-regeneration-only message and do not affect normal tests. Generate
committed fixtures from exactly `advanced/`, `basic/`, `builtin/`, `direct/`
from that verified checkout. Record for each file: relative path, byte size,
SHA-256, level, inferred protocol, entry count and source order. Record every
physical section with source ordinal, ID, metadata, raw args and duplicate
group. Record TCP/UDP quick/standard/full ordered ID arrays and the two featured
IDs.

- [ ] **Step 4: Add tokenizer and domain fixtures**

Include spaces, tabs, CR, LF, quoted whitespace, single/double quoted inline
Lua, multiple flags per line, unmatched quotes, omitted/true/false enabled,
empty profiles, zero-enabled profiles, builtin/user/duplicate/favorite/active
cases, and all autowrap/list/dependency cases.

- [ ] **Step 5: Run GREEN and adjacent checks**

Run: `node --test tests/product/avatar-strategy-characterization.test.mjs`

Expected: PASS for fixture arithmetic and pinned source values.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add -- tests/product/avatar-strategy-characterization.test.mjs tests/fixtures/avatar-strategy
git commit -m "test: pin Avatar Strategy characterization fixtures"
```

## Task 2: Implement Avatar Tokenizer and Pure Strategy Model

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc`
- Create: `tests/product/avatar-strategy-model.test.mjs`
- Modify: `tests/product/avatar-strategy-characterization.test.mjs` only to consume the stable fixture schema if required.

**Interfaces:**
- Consumes: JSON Strategy objects and Profile args strings.
- Produces:
  - `avatar_tokenize(text) -> { ok: true, tokens: [{ value, start, end }] }`;
  - `strategy_validate(input, mode) -> { ok, error?, diagnostics? }`;
  - `strategy_normalize(input, origin) -> { ok, strategy?, error? }`;
  - `strategy_enabled_profiles(strategy) -> Profile[]`;
  - `strategy_profile_count(strategy) -> integer`.

- [ ] **Step 1: Write RED model/token fixtures**

```js
test('missing enabled defaults to true and preserves quoted tokens', () => {
  const result = model('strategy_normalize', {
    id: 's1', name: 'S1', profiles: [{ id: 'p1', args: "--lua-init=code='hello world'\n--x" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.strategy.profiles[0].enabled, true);
  assert.deepEqual(result.tokens, ["--lua-init=code='hello world'", '--x']);
});
```

Add tests for space/tab/CR/LF separators, whitespace inside quotes, preserved
quote characters, unmatched quote retention, unknown options, duplicate child
IDs, enabled false retention, array order, empty array structural validity and
invalid missing `id`/`args`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-model.test.mjs`

Expected: FAIL because `strategy-model.uc` is absent.

- [ ] **Step 3: Implement the pure tokenizer and model**

Use a single pass with `quote = null`, split only on ` \t\r\n` outside quotes,
append quote characters to token values, and append an unterminated final token
without inventing an error. Validate `id`, `name`, `profiles[]`, child `id` and
presence of `args`; resolve `enabled` with `p.enabled == null ? true : p.enabled`.
Keep user input multiline until tokenization, then expose canonical token values
without filesystem or runtime access.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `node --test tests/product/avatar-strategy-model.test.mjs tests/product/profiles-model.test.mjs`

Expected: PASS; existing Profile tests remain unchanged.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-characterization.test.mjs
git commit -m "feat: add Avatar Strategy model and tokenizer"
```

## Task 3: Vendor Physical Snapshot, Manifest, and Package Installation

**Files:**
- Create: `zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/` with all 23 pinned files.
- Create: `zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json`.
- Modify: `zapret2-manager/Makefile:70-92`.
- Create: `tests/native/avatar-strategy-package.test.mjs`.

**Interfaces:**
- Consumes: Task 1 expected manifest and pinned raw files.
- Produces: installed read-only Avatar source at `/usr/share/zapret2-manager/catalog/avatar/` and manifest path consumed by `strategy-catalog.uc`.

- [ ] **Step 1: Write RED package assertions**

```js
test('package source contains every pinned Avatar catalog file', () => {
  const manifest = readInstalledManifest();
  assert.equal(manifest.source.repository, 'avatarDD/zapret-gui');
  assert.equal(manifest.source.commit, PINNED_SHA);
  assert.equal(manifest.physicalFileCount, 23);
  for (const file of manifest.files) assert.equal(file.installed, true);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/native/avatar-strategy-package.test.mjs`

Expected: FAIL because package assets and manifest are absent.

- [ ] **Step 3: Copy raw files without normalization**

Copy exactly `advanced/`, `basic/`, `builtin/`, `direct/` from the committed
Task 1 evidence. Do not create `catalogs/presets/`. Include
`builtin/winws2_presets.txt`, attribution metadata and the generated manifest.

- [ ] **Step 4: Update package installation**

Keep package-owned raw assets under `/usr/share/zapret2-manager/catalog/avatar/`
with mode `0644`; do not add them to conffiles. A normal package upgrade may
replace/update these `/usr/share` builtin assets as part of an approved package
version. Extend post-install setup to create
`/etc/zapret2-manager/strategies/` and `strategy-state.json` with root ownership,
directory mode `0700` and file mode `0600` only when absent. The installer must
never replace user Strategy files, favorites/selection state, or the existing
`/etc/zapret2-manager/state.json` Profile compatibility document.

- [ ] **Step 5: Run GREEN and package regression**

Run: `node --test tests/native/avatar-strategy-package.test.mjs tests/native/package-helper.test.mjs`

Expected: PASS for file inventory, modes, upgrade preservation and no network
dependency.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar zapret2-manager/Makefile tests/native/avatar-strategy-package.test.mjs
git commit -m "feat: vendor pinned Avatar Strategy catalog"
```

## Task 4: Implement Catalog Parsing, Exact Traversal, and Set Membership

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc`.
- Create: `tests/product/avatar-strategy-catalog.test.mjs`.
- Modify: `tests/product/avatar-strategy-characterization.test.mjs` only for installed-manifest assertions.

**Interfaces:**
- Consumes: `/usr/share/zapret2-manager/catalog/avatar/manifest.json` and raw files.
- Produces:
  - `strategy_catalog_load() -> { ok, catalog, error? }`;
  - `strategy_catalog_list(protocol, set) -> CatalogEntry[]`;
  - `strategy_catalog_get(id) -> CatalogEntry|{error}`;
  - `strategy_catalog_status() -> { ok, digest, counts, source }`;
  - `strategy_catalog_reload() -> status`.

- [ ] **Step 1: Write RED parser/traversal tests**

```js
test('runtime winner follows level/file/source/cache-key traversal', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.winnerOrder.slice(0, 3), expected.winnerOrder.slice(0, 3));
  assert.equal(catalog.winners['z2k_all_in_one'].winner, true);
  assert.equal(catalog.physicalEntries.length, 1836);
});
```

Cover metadata, labels, featured IDs, WinDivert-only catalog filtering,
physical duplicates, source ordinals, `level/protocol` cache keys, winner flags,
TCP/UDP inference and exact set lists.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-catalog.test.mjs`

Expected: FAIL because the native catalog module is absent.

- [ ] **Step 3: Implement bounded physical parser**

Read only manifest-listed regular files. Parse section headers/source order,
metadata and argument lines. Infer protocol using pinned filename rules. Remove
`--wf-*` only during catalog parsing. Reject manifest mismatch, path escape,
duplicate manifest ordinals and oversized content. Keep every physical entry.

- [ ] **Step 4: Implement exact runtime traversal**

Traverse sorted level names, sorted files, source entries; append to
`level/protocol`; sort cache keys; preserve accumulated order; choose first
unseen Strategy ID. Store `cacheKey`, `sourceOrdinal`, `cacheOrdinal`,
`effectiveOrdinal`, `duplicateGroup`, `winner` in the in-memory result.

- [ ] **Step 5: Implement set selection**

Build exact TCP/UDP quick/standard/full arrays from the manifest. Quick uses
recommended-first capped at 30. Standard uses basic, recommended advanced,
remaining advanced, deduplicated and capped at 80. Full uses all levels and
first winners. Keep protocol values only `tcp`/`udp`.

- [ ] **Step 6: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-characterization.test.mjs`

Expected: PASS for all counts, hashes, metadata, winner order and set arrays.

Run: `git diff --check`.

- [ ] **Step 7: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-characterization.test.mjs
git commit -m "feat: parse Avatar catalog with exact traversal"
```

## Task 5: Normalize CatalogEntry into Strategy Aggregates

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc`.
- Modify: `tests/product/avatar-strategy-catalog.test.mjs`.
- Modify: `tests/product/avatar-strategy-model.test.mjs`.

**Interfaces:**
- Consumes: `CatalogEntry` from `strategy_catalog_get/list`.
- Produces: `catalog_entry_to_strategy(entry) -> normalized builtin Strategy` with stable Avatar ID, metadata, ordered Profiles, `enabled: true`, `type`, `version`, `is_builtin`, `source`.

- [ ] **Step 1: Write RED conversion tests**

```js
test('exact --new conversion creates ordered enabled child Profiles', () => {
  const result = convert({ sectionId: 's1', args: '--filter-tcp=80 --x --new --filter-tcp=443 --y' });
  assert.deepEqual(result.profiles.map(p => p.enabled), [true, true]);
  assert.equal(result.type, 'combined');
  assert.equal(result.id, 's1');
  assert.match(result.profiles[0].args, /--filter-tcp=80/);
});
```

Cover no-args omission, empty separator segments, profile names/IDs from first
filter, metadata copying, canonical `tcp`/`udp`, presets, Blob/Lua references,
and no ID rewriting.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-model.test.mjs`

Expected: FAIL for missing conversion behavior.

- [ ] **Step 3: Implement Stage B only**

Split only exact `--new` tokens after catalog tokenization. Drop empty segments,
derive Profile IDs/names using the pinned first-filter rules, set
`enabled: true`, copy name/description/author/label/blobs/featured/protocol/
level, compute type/version/is_builtin/source, and retain physical provenance.
Do not apply generic WinDivert filtering to user input.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `node --test tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/profiles-model.test.mjs`

Expected: PASS without changing existing Profile behavior.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-model.test.mjs
git commit -m "feat: normalize Avatar catalog entries into Strategies"
```

## Task 6: Implement Strategy Compiler Adapter and Avatar Transforms

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`.
- Create: `tests/product/avatar-strategy-compiler.test.mjs`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc` only for shared token interface.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc` only if a pure renderer extraction is required by the tests.

**Interfaces:**
- Consumes: normalized Strategy, catalog dependency metadata, current list mode, native paths and existing `z2m_parse/z2m_validate/z2m_fragment`.
- Produces:
  - `strategy_compile(strategy, environment) -> { ok, strategyArgs, fragments, profilesCount, dependencies, digest, error? }`;
  - `strategy_effective_argv(strategyArgs, runtimeInputs) -> { ok, argv, command, error? }`;
  - `strategy_candidate(strategy, environment) -> full candidate input for `profiles_apply_candidate`.

- [ ] **Step 1: Write RED transform tests**

```js
test('compiler filters disabled Profiles, preserves order, and inserts separators', () => {
  const result = compile({ profiles: [
    { id: 'a', args: '--filter-tcp=80', enabled: true },
    { id: 'b', args: '--filter-tcp=443', enabled: false },
    { id: 'c', args: '--filter-udp=443', enabled: true },
  ]});
  assert.equal(result.ok, true);
  assert.equal(result.strategyArgs, '--filter-tcp=80 --new --filter-udp=443');
  assert.equal(result.profilesCount, 2);
});
```

Add autowrap, list placement, Blob declarations, path references, unknown
options, no-enabled empty candidate and token-semantic equality tests.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-compiler.test.mjs`

Expected: FAIL because `strategy-compiler.uc` is absent.

- [ ] **Step 3: Implement the adapter**

Tokenize Avatar args, canonicalize token streams to one-line fragments, apply
exact autowrap and list injection rules, add each required known Blob declaration
once, resolve only allowed native paths, validate each fragment with existing
Profile functions, then delegate ` --new ` joining and round-trip proof to the
existing full-set renderer. Leave missing dependencies visible in `dependencies`
and fail only execution admission.

- [ ] **Step 4: Extract one pure effective-command composition path**

Characterize the current `/etc/init.d/zapret2`/`NFQWS2_OPT` runtime composition
and live command-line evidence from existing `orchestra.uc` command-line
inspection. Add the smallest pure `strategy_effective_argv(strategyArgs,
runtimeInputs)` implementation that uses the same base args, Lua-init, hostlist
and engine path inputs as live execution. Route any existing reusable live
composition call through that function; do not add a display-only composer or a
second runtime manager.

- [ ] **Step 5: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs tests/product/profiles-contract.test.mjs`

Expected: PASS; Profile full-set tests prove existing join/CAS behavior remains.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc tests/product/avatar-strategy-compiler.test.mjs zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc
git commit -m "feat: compile Avatar Strategies through Profiles"
```

## Task 7: Add Dependency Availability and Pure Effective Preview Composition

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc` only for read-only dependency probes if required.
- Modify: `tests/product/avatar-strategy-compiler.test.mjs`.

**Interfaces:**
- Consumes: compiled Strategy args and dependency references.
- Produces: bounded `{ available, missing: [{kind,id,reason}], structurallyCompilable, nativeValidation }` without hiding catalog entries or installing assets.

- [ ] **Step 1: Write RED dependency/command tests**

```js
test('missing Blob remains inspectable but is not executable', () => {
  const preview = compileWithEnvironment(strategyWithBlob, { blobRoot: '/missing' });
  assert.equal(preview.ok, true);
  assert.equal(preview.dependencies.available, false);
  assert.equal(preview.applicable, false);
});
```

Test missing Lua/function/list path, pure Preview without dry-run, optional
`validate=true`, command aliases, profiles count, strategy args and full
effective command.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-compiler.test.mjs`

Expected: FAIL for missing availability projections and effective-command shape.

- [ ] **Step 3: Implement bounded availability**

Resolve known references without creating files. Return `available` only when
all required runtime inputs are present. Keep structurally valid missing
dependencies visible and make pure Preview successful when compilation is
possible. Call native preflight only when `validate=true` or execution admission
requires it.

- [ ] **Step 4: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-compiler.test.mjs tests/native/status-compat.test.mjs`

Expected: PASS with no writes from pure compile/availability reads.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc tests/product/avatar-strategy-compiler.test.mjs
git commit -m "feat: expose Strategy dependency availability"
```

## Task 8: Implement User Strategy Storage, Favorites, Selection, and CAS

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc`.
- Create: `tests/product/avatar-strategy-state.test.mjs`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/constants.uc` if named Strategy paths are needed by existing path imports.
- Modify: `zapret2-manager/Makefile:86-92` only for non-destructive directory bootstrap.

**Interfaces:**
- Consumes: normalized Strategy objects and expected revisions.
- Produces:
  - `strategy_user_list/get/create/update/delete(input)`;
  - `strategy_duplicate(input)`;
  - `strategy_favorite(input)`;
  - `strategy_selection_get/set(input)`;
  - `strategy_reconcile_record/get/clear(input)`.

- [ ] **Step 1: Write RED storage tests**

```js
test('stale Strategy revision is rejected without changing the file', () => {
  const first = updateStrategy({ id: 'u1', expectedRevision: 1, strategy: validUser() });
  const stale = updateStrategy({ id: 'u1', expectedRevision: 1, strategy: changedUser() });
  assert.equal(first.ok, true);
  assert.equal(stale.error.code, 'ECONFLICT');
  assert.equal(readUser('u1').revision, 2);
});
```

Cover schema/version bounds, path traversal, atomic replace, 0600/0700 modes,
builtin/extension collisions, ordered favorites, builtin favorite, delete
cleanup, duplicate ID/name proposal, persisted selection fields only and no
drift/runtime fields in `strategy-state.json`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-state.test.mjs`

Expected: FAIL because `strategy-state.uc` is absent.

- [ ] **Step 3: Implement dedicated storage**

Use `/etc/zapret2-manager/strategies/<id>.json` with `schema: 1`, stable `id`,
`revision`, `name`, metadata, ordered Profiles, `updatedAt`; use
`/etc/zapret2-manager/strategy-state.json` with `schema: 1`, store revision,
ordered favorites and durable selected identity/hash only. Use same-directory
temp + atomic rename, locks, bounded sizes and no last-writer-wins retries.
Keep runtime drift and dependency status derived.

- [ ] **Step 4: Implement duplicate/favorites/selection**

Duplicate proposes `id + '_copy'` and `name + ' (копия)'`, deep-copies only
metadata/Profiles the pinned UI copies, creates a user object and never unlocks
the builtin. Favorite writes preserve order and remove deleted user IDs.

- [ ] **Step 5: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-state.test.mjs tests/product/profiles-contract.test.mjs`

Expected: PASS; legacy `state.json` Profile contracts remain unchanged.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc zapret2-manager/files/usr/libexec/zapret2-manager/constants.uc zapret2-manager/Makefile tests/product/avatar-strategy-state.test.mjs
git commit -m "feat: add Strategy-owned user state"
```

## Task 9: Implement Strategy Preview and Validate Operations

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`.
- Modify: `tests/product/avatar-strategy-compiler.test.mjs`.
- Create: `tests/product/avatar-strategy-preview.test.mjs`.

**Interfaces:**
- Consumes: persisted `strategy_id` plus revision/catalog digest or bounded inline `strategy_data`.
- Produces:
  - `strategy_preview(input) -> { ok, strategyArgs, args, effectiveCommand, effectiveArgv, profiles_count, dependencies, digest, applicable, validation? }`;
  - `strategy_validate(input) -> { ok, validation, digest, error? }`.

- [ ] **Step 1: Write RED Preview tests**

```js
test('inline zero-enabled Preview is inspectable while Validate rejects', () => {
  const preview = preview({ strategy_data: zeroEnabledStrategy() });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.args, []);
  assert.equal(preview.profiles_count, 0);
  assert.equal(preview.applicable, false);
  assert.equal(validate({ strategy_data: zeroEnabledStrategy() }).error.code, 'ENOENABLED');
});
```

Add persisted/inline input, `command`/`args` aliases, full effective command,
optional `validate=true`, unavailable dependencies, no state writes, stale
revision and malformed request tests.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-preview.test.mjs`

Expected: FAIL because `strategy-cli.uc` and Strategy Preview exports are absent.

- [ ] **Step 3: Implement pure Preview**

Resolve one source only: `strategy_id` or `strategy_data`. Normalize and compile
server-side. Return empty `args` successfully for zero-enabled. Compose the full
effective command through `strategy_effective_argv`. Return dependency state
without dry-run unless `validate == true`. Never write user state, manager-state,
config or active identity.

- [ ] **Step 4: Implement Validate**

Accept persisted or bounded inline input without persistence mutation. Reuse the
same candidate/digest path, reject zero enabled with `ENOENABLED`, require
dependency availability and complete native dry-run/preflight, and return
bounded validation output.

- [ ] **Step 5: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs`

Expected: PASS; existing Profile Preview remains unchanged.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-compiler.test.mjs
git commit -m "feat: add server-side Strategy Preview and Validate"
```

## Task 10: Integrate Transactional Strategy Apply and Identity Reconciliation

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc`.
- Create: `tests/product/avatar-strategy-apply.test.mjs`.
- Modify: `tests/product/profiles-contract.test.mjs` only for optional hook ordering assertions.

**Interfaces:**
- Consumes: authoritative persisted Strategy ID/revision, compiler candidate/digest, current config hash and `strategy-state` selection projection.
- Produces: `strategy_apply(input)` and the existing `profiles_apply_candidate` transaction result with coherent active identity.

- [ ] **Step 1: Write RED Apply tests**

```js
test('Apply rejects inline input and stale persisted identity before mutation', () => {
  assert.equal(apply({ strategy_data: validStrategy() }).error.code, 'EINPUT');
  assert.equal(apply({ strategy_id: 'u1', expectedRevision: 1 }).error.code, 'ECONFLICT');
  assert.equal(readConfigBytes(), beforeConfig);
});
```

Test Replace Full Set, empty-enabled rejection, candidate digest recomputation,
client candidate ignored, native preflight requirement, successful selection
commit, rollback on restart/verification failure, identity write retry,
uncertain volatile record, Apply blocking and deterministic next-operation
reconciliation.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-apply.test.mjs`

Expected: FAIL because Strategy Apply and identity hook do not exist.

- [ ] **Step 3: Add the narrow verified-Apply hook**

Extend `profiles-apply.uc` with an optional internal projection context used
only by Strategy Apply. After existing config CAS, restart and verification pass,
atomically commit the selected identity through `strategy-state.uc`; on identity
failure retry under the current Apply lock/deadline, then use existing exact
rollback. Existing Profile/Orchestra callers pass no projection and retain their
current behavior.

- [ ] **Step 4: Implement Strategy Apply admission**

Resolve only persisted Strategy ID and expected revision/catalog digest. Compile
server-side; ignore any client `candidate`, `args` or command bytes; compare
candidate digest and current config hash; call the existing full-set transaction.
Reject zero enabled and missing dependencies before mutation.

- [ ] **Step 5: Implement volatile reconciliation**

On rollback/identity restoration failure, write a bounded record under
`/tmp/zapret2-manager/last-good/` with old/new hashes, identities and runtime
outcome; return `uncertain`, block normal Apply, and reconcile on the next
explicit Strategy operation using verified runtime plus old/new hashes. Never
write this record into manager-state or claim reboot durability.

- [ ] **Step 6: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-apply.test.mjs tests/product/profiles-contract.test.mjs tests/product/profiles-model.test.mjs`

Expected: PASS for Strategy and existing Profile transaction ordering,
rollback, CAS and no-direct-write assertions.

Run: `git diff --check`.

- [ ] **Step 7: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc tests/product/avatar-strategy-apply.test.mjs tests/product/profiles-contract.test.mjs tests/product/profiles-model.test.mjs
git commit -m "feat: apply Strategies through verified transaction"
```

## Task 11: Add Schema-3 Active Identity and Derived Drift Projection

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-observations.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc`.
- Create: `tests/native/avatar-strategy-status.test.mjs`.

**Interfaces:**
- Consumes: persisted selected identity/hash, current config hash, runtime observations and volatile reconciliation record.
- Produces: read-only `strategyStatus` projection with `id`, `name`, `origin`, revision/digest, candidate hash, `match`, `drift`, `availability`, `uncertain`.

- [ ] **Step 1: Write RED status tests**

```js
test('drift is derived from current config and never saved', () => {
  const result = deriveStrategyStatus(selectedState, { configSha256: 'different' }, runtime);
  assert.equal(result.drift, true);
  assert.equal(result.writes.length, 0);
  assert.doesNotMatch(result.persistedState, /drift/);
});
```

Cover matching, drift, unavailable runtime, uncertain reconciliation, absent
identity, schema-3 unchanged top-level fields and zero feature/manager-state
writes.

- [ ] **Step 2: Run RED**

Run: `node --test tests/native/avatar-strategy-status.test.mjs`

Expected: FAIL because Strategy status projection is absent.

- [ ] **Step 3: Implement read-only projection**

Load persisted selection only, hash current `/opt/zapret2/config` through the
existing read path, consume existing runtime observations, and derive status.
Do not mutate state from `status-compat.uc` or observation collection.

- [ ] **Step 4: Run GREEN and schema regression**

Run: `node --test tests/native/avatar-strategy-status.test.mjs tests/native/status-compat.test.mjs`

Expected: PASS with schema 3 retained.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc zapret2-manager/files/usr/libexec/zapret2-manager/core/status-observations.uc zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc tests/native/avatar-strategy-status.test.mjs
git commit -m "feat: expose active Strategy and derived drift"
```

## Task 12: Add rpcd/ubus Strategy API and ACL

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`.
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`.
- Create: `tests/product/avatar-strategy-rpc.test.mjs`.

**Interfaces:**
- Consumes: existing `{ edit: string }` private temp-file convention and Strategy CLI modes.
- Produces methods: `strategies_list`, `strategies_get`, `strategies_create`, `strategies_update`, `strategies_delete`, `strategies_duplicate`, `strategies_favorite`, `strategies_preview`, `strategies_validate`, `strategies_apply`, `strategies_catalog_status`, `strategies_catalog_reload`, `strategies_import_profiles`.

- [ ] **Step 1: Write RED RPC/ACL tests**

```js
test('Strategy methods use the existing rpcd object and bounded edit transport', () => {
  assert.match(rpc, /strategies_preview/);
  assert.match(rpc, /writefile\(tmp, edit\)/);
  assert.match(acl, /"strategies_preview"/);
  assert.doesNotMatch(rpc, /exec.*client/);
});
```

Test read/write ACL split, malformed JSON, bounded payloads, method registration
shape, explicit error codes, inline Preview/Validate and persisted-only Apply.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-rpc.test.mjs`

Expected: FAIL because Strategy methods are not registered.

- [ ] **Step 3: Implement CLI dispatch and rpc registration**

Use secure private request files for parametrized operations, `flock` for state
mutations and existing CLI error envelopes. Register no generic action endpoint.
Keep service `catalog_*` and Orchestra objects separate.

- [ ] **Step 4: Add exact ACL entries**

Read: list/get/preview/validate/catalog status/catalog reload and status
projection. `strategies_catalog_reload` only reparses/verifies immutable
package-owned files; it is not a persistent mutation and is not duplicated in
the write ACL. Write: create/update/delete/duplicate/favorite/apply/import.
Run ACL source assertions for every method.

- [ ] **Step 5: Run GREEN and adjacent tests**

Run: `node --test tests/product/avatar-strategy-rpc.test.mjs tests/product/profiles-contract.test.mjs`

Expected: PASS; existing Profile method names and ACL remain unchanged.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json tests/product/avatar-strategy-rpc.test.mjs
git commit -m "feat: expose Strategy ubus operations"
```

## Task 13: Add Explicit Profile-Draft to Strategy Import

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc`.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`.
- Create: `tests/product/avatar-strategy-import.test.mjs`.

**Interfaces:**
- Consumes: `profiles-draft.uc` `load_state()` and current ordered `state.profiles`.
- Produces: `strategy_import_profiles(input) -> preview/create result` with no runtime mutation.

- [ ] **Step 1: Write RED import tests**

```js
test('import creates one Strategy and never applies runtime config', () => {
  const result = importProfiles({ mode: 'preview' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.strategy.profiles.map(p => p.args), orderedDraftArgs);
  assert.equal(result.runtimeMutation, false);
});
```

Test lossless token semantics, ordering, invalid fragment blocking, no draft
deletion, no config hash change and explicit create after preview.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-import.test.mjs`

Expected: FAIL because import mode is absent.

- [ ] **Step 3: Implement previewable import**

Read legacy drafts through `load_state`, tokenize/canonicalize through the
Strategy model, reject invalid fragments with bounded diagnostics, and create
one user Strategy only after explicit create confirmation. Do not alter
`state.json`, NFQWS2_OPT or runtime.

- [ ] **Step 4: Run GREEN and Profile regressions**

Run: `node --test tests/product/avatar-strategy-import.test.mjs tests/product/profiles-contract.test.mjs tests/product/profiles-ui.test.mjs`

Expected: PASS with legacy Profile compatibility intact.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc tests/product/avatar-strategy-import.test.mjs
git commit -m "feat: import Profile drafts into user Strategies"
```

## Task 14: Make LuCI Strategy Aggregate Canonical

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`.
- Modify: `.../z2m-strategy.js`.
- Modify: `.../z2m-strategy-page.js`.
- Modify: `.../z2m-strategy-model.js` only to keep Orchestra tabs non-authoritative.
- Modify: `.../z2m-strategy-workflow.js` and `.../z2m-strategy-workflow-core.js` only for explicit advanced boundary labels.
- Modify: `.../z2m-profiles-workflow.js` only for compatibility-pane navigation.
- Create: `tests/product/avatar-strategy-ui.test.mjs`.

**Interfaces:**
- Consumes: Strategy rpc API responses and existing page lifecycle interface.
- Produces: canonical catalog/user editor with inline Preview, optional validation, persisted Apply and derived status; Advanced/Compatibility Profile pane remains available.

- [ ] **Step 1: Write RED UI contract tests**

```js
test('canonical page consumes Strategy RPC and never compiles NFQWS2 in JS', () => {
  assert.match(api, /strategies_preview/);
  assert.match(page, /strategies_list|strategies_get/);
  assert.doesNotMatch(page, /join\(['"] --new ['"]|NFQWS2_OPT/);
  assert.match(page, /Advanced|Compatibility/);
});
```

Cover list/full response, search/filter, metadata, availability, favorites,
builtin/user controls, Profile order/enabled, duplicate, create/edit/delete,
inline Preview, optional validate, effective command, Apply, active identity,
drift and compatibility pane reachability.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-ui.test.mjs`

Expected: FAIL because the page still treats Discord/Orchestra/Profile paths as
the Strategy authority.

- [ ] **Step 3: Add API declarations**

Add exact `calls` and `api.strategies` methods with JSON `edit` parameters where
required. Preserve existing `api.strategy` Discord operations and
`api.profiles` compatibility operations.

- [ ] **Step 4: Replace canonical data flow**

Load `strategies_list`, render complete Strategy objects, open details from the
same domain, edit user Profiles in order, preserve omitted enabled as true,
send inline `strategy_data` to Preview, send persisted ID/revision to Apply,
and render backend `effectiveCommand` without local compilation. Keep Orchestra
as an explicitly separate Advanced workflow.

- [ ] **Step 5: Run GREEN and UI regressions**

Run: `node --test tests/product/avatar-strategy-ui.test.mjs tests/product/profiles-ui.test.mjs`

Expected: PASS with canonical Strategy flow and existing compatibility workflow.

Run: `git diff --check`.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow-core.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-profiles-workflow.js tests/product/avatar-strategy-ui.test.mjs
git commit -m "feat: make Avatar Strategy the canonical LuCI flow"
```

## Task 15: Package Upgrade, Storage Security, and Full-List Measurement

**Files:**
- Modify: `zapret2-manager/Makefile` only if package tests reveal missing mode/bootstrap behavior.
- Modify: `tests/native/avatar-strategy-package.test.mjs`.
- Modify: `tests/product/avatar-strategy-rpc.test.mjs` for measured payload contract.

**Interfaces:**
- Consumes: installed catalog/manifest, Strategy storage and full list RPC response.
- Produces: evidence that package upgrades preserve user Strategy files/favorites/selection and a recorded full-list byte/memory/serialization measurement before any projection decision.

- [ ] **Step 1: Write RED upgrade/measurement tests**

```js
test('full list is measured before any projection is allowed', () => {
  const measurement = measureFullStrategyList(packagedCatalog);
  assert.ok(measurement.bytes > 0);
  assert.equal(measurement.projectionAuthorized, false);
});
```

Add upgrade-preservation, ownership/mode, malformed manifest, catalog tamper,
path traversal, oversized Strategy/Profile, extension collision, builtin
overwrite, shell metacharacter and stale hash tests.

- [ ] **Step 2: Run RED**

Run: `node --test tests/native/avatar-strategy-package.test.mjs tests/product/avatar-strategy-rpc.test.mjs`

Expected: FAIL until package and measurement assertions are present.

- [ ] **Step 3: Implement package checks**

Assert raw files/manifest are installed, user paths are private, upgrades do
not overwrite user state, and no network is used. Record actual full-list bytes,
serialization time and native message/memory limits in the test evidence. Keep
full list as default unless concrete evidence authorizes an explicit
`OPENWRT_NATIVE` projection.

- [ ] **Step 4: Run GREEN and security regressions**

Run: `node --test tests/native/avatar-strategy-package.test.mjs tests/product/avatar-strategy-rpc.test.mjs tests/native/package-helper.test.mjs`

Expected: PASS with full-list default and secure upgrade behavior.

Run: `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/Makefile tests/native/avatar-strategy-package.test.mjs tests/product/avatar-strategy-rpc.test.mjs
git commit -m "test: verify Strategy package and full-list bounds"
```

## Task 16: Fresh Parity Matrix and Integration Gate

**Files:**
- Modify: `docs/architecture/avatar-parity.md` only from fresh implementation evidence.
- Create: `tests/product/avatar-strategy-integration.test.mjs`.
- Modify: no production files unless the integration test exposes a defect in an earlier task.

**Interfaces:**
- Consumes: installed catalog, Strategy RPC/UI, compiler, state, status and transaction outputs.
- Produces: evidence-backed parity movement and final repository gate.

- [ ] **Step 1: Write RED integration assertions**

```js
test('Strategy identity survives catalog -> Preview -> Validate -> Apply -> status', () => {
  const result = runStrategyFlow({ id: 'pinned-id', revision: 1 });
  assert.equal(result.preview.profiles_count >= 0, true);
  assert.equal(result.apply.ok, true);
  assert.equal(result.status.strategy.id, 'pinned-id');
  assert.equal(result.status.strategy.drift, false);
});
```

Add catalog digest, duplicate winner, Preview/Validate/Apply, rollback,
identity reconciliation, drift derivation, RPC, UI reachability, import,
package assets, no-manager-state-write and no-Orchestra-authority assertions.

- [ ] **Step 2: Run RED**

Run: `node --test tests/product/avatar-strategy-integration.test.mjs`

Expected: FAIL until all previous interfaces are wired.

- [ ] **Step 3: Run the complete fresh gate**

First inspect `scripts/test/native.sh` and run its current exact command. Then
run:

```bash
node --test tests/product/avatar-strategy-characterization.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/avatar-strategy-state.test.mjs tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-apply.test.mjs tests/native/avatar-strategy-status.test.mjs tests/product/avatar-strategy-rpc.test.mjs tests/product/avatar-strategy-import.test.mjs tests/product/avatar-strategy-ui.test.mjs tests/product/avatar-strategy-integration.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: all focused tests pass, all product/native/root gates pass, and no
unrelated Strategy/Orchestra/Scanner changes appear in the diff.

- [ ] **Step 4: Update parity documentation from evidence**

Move only rows proven by tests and reachable UI: Strategy aggregate, Profile
ownership, ordered/enabled semantics, builtin/user, metadata, duplicate/copy,
Preview, Validate/Apply product behavior, hostlist/autowrap, full pinned
catalog, protocol sets, current Strategy display and Strategy→runtime→status.
Keep online updater, Scanner and Orchestra substitution non-PARITY.

- [ ] **Step 5: Run review gate and commit**

Run: `git diff --check` and the complete fresh gate above. Inspect `git status`,
`git diff`, `git log --oneline -10`, then invoke
`superpowers:requesting-code-review`. Resolve every Critical/Important finding
with fresh tests before committing.

```bash
git add docs/architecture/avatar-parity.md tests/product/avatar-strategy-integration.test.mjs
git commit -m "docs: record verified Avatar Strategy parity"
```

## Spec Coverage

| Spec section | Implementing task(s) | Verification |
|---|---|---|
| 1 Goal | Tasks 2–16 | Integration flow and parity matrix |
| 2 Source of truth | Tasks 1, 3–5 | Pinned fixtures and manifest |
| 3 Non-goals | All tasks | Negative boundary assertions |
| 4 Repository map/storage | Tasks 3, 8, 11, 15 | package/state/status tests |
| 5 Snapshot | Tasks 1, 3 | 23-file manifest |
| 6 Inventory | Tasks 1, 3 | size/hash/count checks |
| 7 Strategy contract | Task 2 | model tests |
| 8 Profile contract | Tasks 2, 6 | tokenizer/compiler tests |
| 9 Builtin | Tasks 4, 8 | winner/immutability tests |
| 10 User | Task 8 | CRUD/CAS tests |
| 11 Extensions | Task 8 | collision tests |
| 12 Identity/collision | Tasks 4, 8 | duplicate/protected-ID tests |
| 13 List/detail wire | Tasks 12, 15 | full-list measurement/RPC tests |
| 14 Parser | Task 4 | parser fixtures |
| 15 Provenance | Tasks 1, 3, 4 | manifest integrity |
| 16 Metadata | Tasks 4, 5 | conversion tests |
| 17 Protocol/sets | Tasks 4, 5 | TCP/UDP set arrays |
| 18 Presets | Tasks 3–5 | builtin preset fixtures |
| 19 Builder | Task 6 | candidate tests |
| 20 Autowrap | Task 6 | exact payload matrix |
| 21 Hostlists | Task 6 | injection positions/modes |
| 22 Lua/Blob | Task 7 | availability/preflight tests |
| 23 Adapter | Task 6 | Profile compiler regression |
| 24 Preview | Task 9 | persisted/inline/zero-enabled tests |
| 25 Validate | Task 9 | optional dry-run and admission tests |
| 26 Apply | Task 10 | Replace Full Set/CAS tests |
| 27 Active identity | Tasks 8, 10, 11 | selection/transaction tests |
| 28 Drift | Task 11 | read-only derived status |
| 29 Favorites | Task 8 | ordered toggle/cleanup |
| 30 Duplicate | Task 8 | exact copy behavior |
| 31 Persistence | Task 8 | atomic/CAS/mode tests |
| 32 RPC | Task 12 | registration/ACL/error tests |
| 33 LuCI | Task 14 | UI source/flow tests |
| 34 Compatibility | Task 13 | preview/import/no mutation |
| 35 Errors | Tasks 8–12 | bounded code assertions |
| 36 Security | Tasks 2, 3, 6–9, 12, 15 | injection/path/size tests |
| 37 Schema 3 | Task 11 | status compatibility tests |
| 38 Autostart | Tasks 10, 11 | boot/status identity checks |
| 39 Characterization | Tasks 1–7, 9 | focused fixtures |
| 40 Migration rollout | Tasks 8, 13, 15 | no automatic migration tests |
| 41 Scanner seam | Tasks 4, 6, 16 | no Orchestra authority assertions |
| 42 Out of scope | All tasks | negative boundary assertions |
| 43 Parity movement | Task 16 | fresh evidence matrix |
| 44 Classification | Task 16 | parity/deviation review |
| 45 Branch policy | Every commit | branch/PR checks |
| 46 Rollback boundary | Task 10 | same-boot rollback tests |
| 47 Router boundary | Task 15 | no package upgrade/router mutation |

## Plan Self-Review

- [x] Confirm the plan begins with the required header and checkbox syntax.
- [x] Confirm every task has exact Files, Interfaces, RED, GREEN, adjacent tests, `git diff --check`, and commit steps.
- [x] Confirm no task introduces Profile-first public authority, Strategy-as-template, Orchestra authority, rewritten Avatar IDs, generic WinDivert stripping, save-before-Preview, inline Apply, persisted drift, client candidate trust, a second compiler, a second Apply engine, manager-state feature configuration, schema 4, Scanner, or Task 11/12.
- [x] Confirm all 47 spec sections map to a task in the coverage table.
- [x] Confirm `enabled` is optional/default true and zero-enabled Preview succeeds while Validate/Apply reject.
- [x] Confirm full effective command, inline Preview, optional validation and dependency-inspectable Preview are explicit.
- [x] Confirm list projection requires measured native evidence.
- [x] Confirm multiline/quoted Avatar lexical semantics and unmatched-quote behavior are explicit.
- [x] Confirm canonical protocol is only `tcp`/`udp`.
- [x] Confirm drift is derived and not persisted; only volatile reconciliation exists under `/tmp/zapret2-manager/last-good/`.
- [x] Search the plan for unresolved omissions, deferred decisions, vague error instructions, vague test instructions, relational shortcuts, and unbounded shorthand; expected count is zero.

## Final Plan Gate

After the self-review above:

```bash
git diff --check
git status --short
git diff --name-only
```

Commit only:

```text
docs/superpowers/plans/avatar-strategy-catalog-parity.md
```

Push only `m5-native-state-store`, let normal CI run, verify local and remote
HEAD equality, and stop. Do not implement production code in the planning
session. The next decision is execution mode: Subagent-Driven Development or
Inline executing-plans.
