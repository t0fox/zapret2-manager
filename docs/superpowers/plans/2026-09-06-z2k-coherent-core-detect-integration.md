# Z2K Coherent Core + Detect Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the partially-coupled Z2K lifecycle and Manager-owned DPI scanner with one coherent Z2K Core release bundle whose runtime, official strategies, release-owned data, upstream `z2k-detect`, receipts, diagnostics and rollback share one exact upstream identity.

**Architecture:** Keep Asset Registry and Resource Center as mutation authorities. Add one shared release parser and one coherent-candidate boundary so every release-owned Z2K artifact is prepared before activation. Use the exact upstream `z2k-detect` binary as the only production DPI measurement engine; Z2M only owns typed orchestration, fixed native-helper execution, JSON validation, procd supervision, transactionality and LuCI presentation.

**Tech Stack:** OpenWrt/procd; ucode; C11 helper/broker; LuCI JavaScript; Node.js `node:test`; Asset Registry; Resource Center; upstream `necronicle/z2k` `z2k-enhanced` release manifests and Go binaries.

**Spec:** `docs/superpowers/specs/2026-09-06-z2k-coherent-core-detect-integration-design.md`

## Global Constraints

- Support both `r-*` and `p-*` release identities through catalog, manifest validation, receipts and runtime composition.
- Authoritative `latest` comes from upstream manifest/release metadata, not prefix or lexical ordering.
- Runtime, release-owned lists, compiler inputs, official catalog and `z2k-detect` must share one exact release/source commit before activation.
- Install one upstream `z2k-detect` binary for the router architecture; do not port its algorithms into ucode.
- Do not keep the Manager scanner as a production fallback.
- Browser/RPC clients never supply executable names, raw argv, shell commands, environment variables, cwd or arbitrary paths.
- One-shot Detect results are authoritative only as bounded JSON.
- `z2k-detect run` is a procd-managed service, not a long-lived RPC child.
- Preserve active source selection, user strategies, exclusions, discovered domains and compatible dynamic datasets across Core updates.
- Autocircular learned indexes survive only when the semantic pool digest is unchanged.
- Direct Z2K Strategy/Detect/runtime refresh returns `EMANAGED` with owner `z2k-core`.
- Failure before commit leaves the current LKG untouched; activation failure restores physical runtime, Detect bytes, catalog and strategy state.
- Z2K webpanel, Keenetic `ndm/*`, Keenetic `S99*` lifecycle and upstream product auto-updater remain excluded parallel owners.
- Engineering difficulty, failed tests, regressions, refactoring and uncertainty remain `WORKING`. A real user-only dependency uses exactly `REQUIRED_USER_INPUT`, `WHY_ONLY_USER_CAN_PROVIDE_IT`, then `[goal:blocked]`.

---

## File Structure

### New modules

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc` — shared `r-*`/`p-*` identity parser.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc` — immutable candidate and compatibility identity.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc` — Detect artifact authority, schemas and status.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc` — semantic pool digests and reconciliation.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc` — legacy evidence and V1/V2 migration.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh.uc` — controlled geosite/dynamic dataset staging and atomic publish.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc` — coherent diagnostic projection.

### Main existing owners

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc`
- `tools/generate-z2k-classification.mjs`
- `zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json`
- `zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json`
- `zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json`

### Detect execution/service

- `zapret2-manager/src/z2m-core-helper/protocol.c`
- `zapret2-manager/src/z2m-core-helper/scanner.c`
- `zapret2-manager/src/z2m-core-helper/main.c`
- `zapret2-manager/src/z2m-helperd/supervise.c`
- `zapret2-manager/files/etc/init.d/zapret2-manager`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`

### LuCI

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`

---

## Phase A — Coherent release foundation

### Task 1: Unify release parsing across every authority

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-release-identity.test.mjs`

**Interfaces:** `z2k_release_parse(value)`, `z2k_release_valid(value)`, `z2k_release_same(a,b)`.

- [ ] **Step 1: Write failing tests**

```js
assert.deepEqual(parse('r-82.7'), { version: 'r-82.7', family: 'r', major: 82, minor: 7 });
assert.deepEqual(parse('p-82.14'), { version: 'p-82.14', family: 'p', major: 82, minor: 14 });
assert.equal(parse('x-82.14'), null);
assert.equal(parse('p-82.14.1'), null);
assert.equal(validInstalled('p-82.14'), true);
assert.equal(validRuntime('p-82.14'), true);
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-release-identity.test.mjs`

Expected: FAIL on current `r-*`-only validation.

- [ ] **Step 3: Implement shared parser and remove duplicate release regexes**

```ucode
export const z2k_release_parse = function(value) {
	if (type(value) != 'string') return null;
	let m = match(value, /^([rp])-([0-9]+)(?:\.([0-9]+))?$/);
	if (!m) return null;
	return { version: value, family: m[1], major: +m[2], minor: m[3] == null ? 0 : +m[3] };
};
export const z2k_release_valid = function(value) { return z2k_release_parse(value) != null; };
export const z2k_release_same = function(a, b) { return a == b && z2k_release_valid(a); };
```

Catalog `latest` must be the manifest `current`. Cross-family browsing order uses resolved publication/commit evidence; numeric comparison is only a same-family fallback.

- [ ] **Step 4: Prove green**

Run: `node --test tests/product/z2k-release-identity.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc tests/product/z2k-release-identity.test.mjs
git commit -m "fix: support current Z2K release identities"
```

### Task 2: Regenerate classification from current consumed semantics

**Files:**
- Modify: `tools/generate-z2k-classification.mjs`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc`
- Test: `tests/product/z2k-current-upstream-membership.test.mjs`

**Interfaces:** dependency classes are `runtime-exact`, `detect-arch`, `compiler-input`, `watched`, `ignored-platform`.

- [ ] **Step 1: Add current membership assertions**

```js
assert.equal(byPath['files/lua/z2k-alert.lua'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/sni_wl_candidates.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/tcp16_targets.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/tcp16_nets.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].dependencyClass, 'detect-arch');
assert.equal(byPath['files/lua/z2k-detectors.lua'], undefined);
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-current-upstream-membership.test.mjs`

Expected: FAIL because Detect/new consumed lists are not complete lifecycle members and stale detector assumptions remain.

- [ ] **Step 3: Update classification rules**

Current six Lua modules are exact runtime. `sni_wl_candidates.txt`, `tcp16_targets.txt`, `tcp16_nets.txt` and other proven current consumers are exact runtime. Detect builds are `detect-arch`. Unknown consumed files are blocking; explicit platform files stay ignored.

- [ ] **Step 4: Regenerate deterministically**

Run twice: `node tools/generate-z2k-classification.mjs tests/fixtures/z2k-signed-update/UPDATES.json`

After the second run: `git diff --exit-code zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json`

- [ ] **Step 5: Prove green**

Run: `node --test tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-canonical-plan-contract.test.mjs tests/product/z2k-removal-plan-parity.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/generate-z2k-classification.mjs zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc tests/product/z2k-current-upstream-membership.test.mjs
git commit -m "feat: classify complete current Z2K runtime"
```

### Task 3: Build one immutable coherent candidate

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-coherent-candidate.test.mjs`

**Interfaces:** `z2k_candidate_build(input)` returns release, sourceCommit, manifestSeq, manifestSha256, classificationSha256, runtimeMembership, Detect identity, compilerInputsDigest, catalogDigest, runtimeBundleDigest and compatibilityIdentity.

- [ ] **Step 1: Add mixed-revision/missing-member failures**

```js
assert.equal(build({ release: 'p-82.14', runtimeCommit: commitA, compilerCommit: commitB }).error.code, 'ECOMPATIBILITY');
assert.equal(build({ release: 'p-82.14', detect: null }).error.code, 'EDETECT_UNAVAILABLE');
assert.equal(build({ requiredLists: ['sni_wl_candidates.txt'], presentLists: [] }).ok, false);
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-coherent-candidate.test.mjs`

Expected: FAIL because no current boundary proves all identities together.

- [ ] **Step 3: Implement deterministic semantic identity**

Hash sorted rows for release, sourceCommit, manifest digest, runtime bundle digest, Detect arch/digest/size, compiler input digest and catalog digest. Never hash staging paths, timestamps or Registry revision numbers into compatibility identity.

- [ ] **Step 4: Make `resolveCandidate()` consume this authority**

`runtime-composition.uc` remains the runtime ordering/CAS owner but no longer reconstructs a second candidate identity.

- [ ] **Step 5: Prove green**

Run: `node --test tests/product/z2k-coherent-candidate.test.mjs tests/product/z2k-candidate-compatibility.test.mjs tests/product/z2k-runtime-summary.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc tests/product/z2k-coherent-candidate.test.mjs
git commit -m "feat: build coherent Z2K release candidates"
```

### Task 4: Make official Z2K strategies Core-managed

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- Test: `tests/product/z2k-managed-strategy-source.test.mjs`

**Interfaces:** direct `strategies_source_refresh('z2k')` returns `EMANAGED`; candidate compilation consumes exact selected sourceCommit.

- [ ] **Step 1: Add tests**

```js
assert.equal(refresh('z2k').error.code, 'EMANAGED');
assert.equal(refresh('z2k').error.owner, 'z2k-core');
assert.equal(prepare.compilerSourceCommit, selected.sourceCommit);
assert.notEqual(prepare.compilerSourceCommit, branchHeadWhenDifferent);
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-managed-strategy-source.test.mjs`

Expected: FAIL on current HEAD-oriented Z2K source path.

- [ ] **Step 3: Remove branch-HEAD refresh for Z2K**

Build compiler URLs only from exact selected sourceCommit. Avatar remains independently refreshable.

- [ ] **Step 4: Prove green**

Run: `node --test tests/product/z2k-managed-strategy-source.test.mjs tests/product/z2k-official-compiler*.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc tests/product/z2k-managed-strategy-source.test.mjs
git commit -m "fix: bind Z2K strategies to Core release"
```

## Phase B — Detect artifact, receipt and transaction

### Task 5: Stage one architecture-specific upstream Detect binary

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Test: `tests/product/z2k-detect-artifact.test.mjs`

**Interfaces:** `z2k_detect_arch(machine)` and `z2k_detect_candidate(manifest,sourceCommit,machine)`; stable runtime target `/usr/libexec/zapret2-manager/z2k-detect`.

- [ ] **Step 1: Add architecture tests**

```js
assert.equal(mapArch('aarch64'), 'arm64');
assert.equal(mapArch('x86_64'), 'amd64');
assert.equal(mapArch('mipsel'), 'mipsle');
assert.equal(mapArch('mips'), 'mips');
assert.equal(mapArch('riscv64'), 'riscv64');
assert.equal(mapArch('unsupported-cpu'), null);
```

Assert the source path is exactly `z2k-detect/builds/z2k-detect-linux-` plus the mapped arch and the SHA is read from the selected manifest.

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-detect-artifact.test.mjs`

Expected: FAIL because Detect is not candidate-owned.

- [ ] **Step 3: Stage and verify exact bytes**

Fetch only the selected architecture from the selected commit, verify manifest SHA-256, then mark executable and add its identity to the candidate.

- [ ] **Step 4: Add executable-format check**

Execute the staged file through a fixed internal seam with no user-provided argv; `ENOEXEC` or permission failure rejects the candidate.

- [ ] **Step 5: Prove green**

Run: `node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc tests/product/z2k-detect-artifact.test.mjs
git commit -m "feat: stage upstream Z2K Detect with Core"
```

### Task 6: Add coherent activation receipt V3

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-receipt-v3.test.mjs`

**Interfaces:** V3 stores release/source/manifest/classification, runtime membership, Detect identity, compiler input digest, catalog digest, compatibility identity and installed authority revision. V1/V2 remain readable as `LEGACY_VERIFIED`; V3 is `COHERENT_VERIFIED`.

- [ ] **Step 1: Add receipt tests**

```js
assert.equal(valid(v3Complete), true);
assert.equal(valid({ ...v3Complete, detect: null }), false);
assert.equal(state(v2Complete).state, 'LEGACY_VERIFIED');
assert.equal(state(v3Complete).state, 'COHERENT_VERIFIED');
```

Use valid fixed fixture digests such as `a`.repeat(40) for commits and `b`.repeat(64) for SHA-256 values.

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-receipt-v3.test.mjs`

Expected: FAIL on V1/V2-only authority.

- [ ] **Step 3: Implement V3 physical verification**

Reject extra/missing lifecycle assets, Detect digest mismatch, or source/release provenance mismatch. Preserve the existing Registry bundle wire ID `z2k-curated-lua` for migration compatibility while the receipt represents the full Core.

- [ ] **Step 4: Prove green**

Run: `node --test tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc tests/product/z2k-receipt-v3.test.mjs
git commit -m "feat: record coherent Z2K activation receipts"
```

### Task 7: Make prepare/commit/rollback atomic across runtime, catalog and Detect

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc`
- Test: `tests/product/z2k-coherent-transaction.test.mjs`

**Interfaces:** prepare is staging-only; commit publishes runtime + Detect + catalog + receipt; rollback restores prior Registry/runtime/Detect/catalog/active strategy/service state.

- [ ] **Step 1: Add three failure-injection cases**

```text
Detect SHA failure before commit -> active X unchanged
active-strategy candidate preflight failure -> active X unchanged
post-materialize readiness failure -> physical X restored
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-coherent-transaction.test.mjs`

Expected: FAIL because current transaction does not cover every new artifact.

- [ ] **Step 3: Extend pending-activation rollback evidence**

Store prior receipt, Registry membership/revision, runtime composition, Detect digest/bytes authority, compiled catalog identity, active strategy/config digest and runtime enable state.

- [ ] **Step 4: Gate active strategy before commit**

Official Z2K must preserve canonical ID in candidate catalog. Avatar/User remain selected and must pass candidate-runtime closure/native preflight; mismatch returns `ECOMPATIBILITY`.

- [ ] **Step 5: Prove green**

Run: `node --test tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-post-mutation-check-state.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc tests/product/z2k-coherent-transaction.test.mjs
git commit -m "feat: activate Z2K as one coherent transaction"
```

## Phase C — Migration and autocircular identity

### Task 8: Migrate legacy state and remove stale `z2k-detectors.lua`

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Test: `tests/product/z2k-legacy-migration.test.mjs`
- Test: `tests/product/z2k-current-lua-function-closure.test.mjs`

**Interfaces:** `z2k_migration_state()` returns `LEGACY_Z2K`, `COHERENT_Z2K` or `NONE`; current Lua function closure must succeed without legacy detector.

- [ ] **Step 1: Add current-six-Lua function closure test**

Compile current official catalog, enumerate Lua function references, prove every reference resolves from the current six modules, then remove one fixture function and require rejection.

- [ ] **Step 2: Add migration tests**

```js
assert.equal(classify(v2Install), 'LEGACY_Z2K');
assert.equal(classify(v3Install), 'COHERENT_Z2K');
assert.equal(migrateFailure.activeReceipt.schema, 'asset-activation-receipt.v2');
assert.equal(migrateSuccess.activeReceipt.schema, 'asset-activation-receipt.v3');
assert.equal(migrateSuccess.discoveredDomainsPreserved, true);
```

- [ ] **Step 3: Prove red**

Run: `node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs`

Expected: FAIL on stale package composition/missing migration contract.

- [ ] **Step 4: Remove `z2k-detectors.lua` from production composition after closure passes**

No hidden fallback. Missing function becomes a blocking candidate error including function and referencing strategy/profile.

- [ ] **Step 5: Preserve user/runtime data**

Preserve discovered domains, source selection, exclusions and user strategies. Autocircular legacy rows are reconciled in Task 9.

- [ ] **Step 6: Prove green and commit**

Run: `node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-runtime-summary.test.mjs`

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs
git commit -m "feat: migrate legacy Z2K runtime coherently"
```

### Task 9: Bind learned autocircular state to semantic pool identity

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Test: `tests/product/z2k-autocircular-pool-identity.test.mjs`

**Interfaces:** `z2k_pool_semantic_digest(pool)` and `z2k_learned_state_reconcile(oldIdentity,newIdentity,rows)`.

- [ ] **Step 1: Add same/changed/legacy tests**

```js
assert.equal(digest(poolA), digest(clone(poolA)));
assert.notEqual(digest(poolA), digest(poolWithChangedArm));
assert.deepEqual(reconcile(identityA, identityA, rows).reset, []);
assert.deepEqual(reconcile(identityA, identityB, rows).reset, ['discord_udp']);
assert.equal(reconcile(null, identityB, legacyRows).resetAllLegacy, true);
```

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-autocircular-pool-identity.test.mjs`

Expected: FAIL because integer state has no semantic identity.

- [ ] **Step 3: Persist backward-compatible sidecar identity**

Use `/etc/zapret2-manager/state/autocircular/pool-identity.json`, next to the Manager-owned `state.tsv` projection. Write `{schema:1,pools:{key:digest}}` atomically. Do not alter upstream TSV column semantics.

- [ ] **Step 4: Reconcile only affected keys during Core commit**

Same digest preserves learned/frozen state; changed digest resets that key; legacy rows without identity reset once during legacy migration.

- [ ] **Step 5: Prove green and commit**

Run: `node --test tests/product/z2k-autocircular-pool-identity.test.mjs tests/product/discord-voice-autocircular.test.mjs`

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc tests/product/z2k-autocircular-pool-identity.test.mjs
git commit -m "feat: bind autocircular learning to pool identity"
```

## Phase D — Detect execution, RPC and service

### Task 10: Add fixed native-helper Detect operations

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `zapret2-manager/src/z2m-core-helper/scanner.c`
- Modify: `zapret2-manager/src/z2m-core-helper/main.c`
- Modify: `zapret2-manager/src/z2m-helperd/supervise.c`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Test: `tests/native/z2k-detect-helper.test.mjs`

**Interfaces:** fixed operations `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`; executable is always `/usr/libexec/zapret2-manager/z2k-detect`.

- [ ] **Step 1: Add protocol rejection tests**

Reject request fields named `executable`, `argv`, `command`, `env`, `cwd`, unknown flags, oversized timeout/repeats, invalid host/port and embedded NUL/newline.

- [ ] **Step 2: Add exact argv test**

```text
/usr/libexec/zapret2-manager/z2k-detect classify example.com:443 -hello modern -repeats 3 -timeout 6s -json
```

The helper constructs this argv from typed fields; clients never submit the raw string.

- [ ] **Step 3: Prove red**

Run: `node --test tests/native/z2k-detect-helper.test.mjs`

Expected: FAIL because fixed Detect operations do not exist.

- [ ] **Step 4: Implement fixed execve dispatch**

Reuse existing broker supervision; bound stdout/stderr, wall time and concurrency, kill child/process group on timeout, return `{exitCode,stdout,stderr,timedOut}`.

- [ ] **Step 5: Prove green and commit**

Run: `node --test tests/native/z2k-detect-helper.test.mjs tests/native/*.test.mjs`

```bash
git add zapret2-manager/src/z2m-core-helper/protocol.c zapret2-manager/src/z2m-core-helper/scanner.c zapret2-manager/src/z2m-core-helper/main.c zapret2-manager/src/z2m-helperd/supervise.c zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc tests/native/z2k-detect-helper.test.mjs
git commit -m "feat: execute Z2K Detect through fixed helper ops"
```

### Task 11: Expose typed Detect RPC and validate JSON schemas

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Test: `tests/product/z2k-detect-rpc.test.mjs`

**Interfaces:** RPCs `z2k_detect_status`, `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`.

- [ ] **Step 1: Add valid/malformed JSON fixtures for all commands**

Unknown additive fields may survive normalization. Missing/wrong required semantic fields return `EDETECT_SCHEMA`.

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-detect-rpc.test.mjs`

Expected: FAIL because no typed Detect RPC exists.

- [ ] **Step 3: Implement per-command validators/normalizers**

Canonical errors: `EZ2K_NOT_INSTALLED`, `EZ2K_INCOHERENT`, `EDETECT_UNAVAILABLE`, `EDETECT_INCOMPATIBLE`, `EDETECT_TIMEOUT`, `EDETECT_FAILED`, `EDETECT_SCHEMA`, `EDETECT_NO_TARGET`, `EDETECT_NO_ACTIVE_VOICE`.

- [ ] **Step 4: Gate invocation on coherent installed authority**

Receipt/runtime/Detect mismatch returns `EDETECT_INCOMPATIBLE`; never call the old scanner.

- [ ] **Step 5: Prove green and commit**

Run: `node --test tests/product/z2k-detect-rpc.test.mjs && node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js tests/product/z2k-detect-rpc.test.mjs
git commit -m "feat: expose typed Z2K Detect RPC"
```

### Task 12: Supervise Detect autodiscovery with procd

**Files:**
- Modify: `zapret2-manager/files/etc/init.d/zapret2-manager`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Test: `tests/product/z2k-detect-discovery-service.test.mjs`

**Interfaces:** control file `/etc/zapret2-manager/z2k-detect-discovery.json` with `{schema:1,enabled:boolean,dnsSource:'auto'|'agh'|'dnsmasq'|'pkt'}`; RPC status/enable/disable/restart.

- [ ] **Step 1: Add service-state tests**

Disabled creates no Detect instance. Enabled creates exactly one fixed `run` command publishing to `/opt/zapret2/lists/discovered-domains.txt`. Core update/service restart never truncates discovered domains.

- [ ] **Step 2: Prove red**

Run: `node --test tests/product/z2k-detect-discovery-service.test.mjs`

Expected: FAIL because current init has only helperd/watchdog.

- [ ] **Step 3: Add named `z2k-detect` procd instance**

Start after lifecycle recovery only when coherent Detect is installed, discovery is enabled and lifecycle is not paused. Configure respawn and bounded term timeout.

- [ ] **Step 4: Report actual health**

Status reports pid, configured DNS source, discovered-domain count/mtime and running state from the supervised process, not config alone.

- [ ] **Step 5: Prove green and commit**

Run: `node --test tests/product/z2k-detect-discovery-service.test.mjs && sh -n zapret2-manager/files/etc/init.d/zapret2-manager`

```bash
git add zapret2-manager/files/etc/init.d/zapret2-manager zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc tests/product/z2k-detect-discovery-service.test.mjs
git commit -m "feat: supervise Z2K Detect autodiscovery"
```

## Phase E — Data, diagnostics and product UI

### Task 13: Integrate geosite/dynamic datasets and diagnostics

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Test: `tests/product/z2k-data-diagnostics.test.mjs`

**Interfaces:** release-owned data affects Core identity; schema-compatible dynamic dataset revisions do not. `z2k_diagnostics_run()` returns `{id,status,evidence,error}` entries.

- [ ] **Step 1: Add data-identity tests**

Changing release-owned `sni_wl_candidates.txt` changes Core identity. Changing a schema-compatible dynamic geosite revision leaves Core identity unchanged.

- [ ] **Step 2: Add diagnostics IDs**

```text
release_identity
activation_receipt
runtime_composition
lua_function_closure
runtime_assets
runtime_lists
compiler_snapshot
strategy_catalog
compatibility_identity
detect_binary
detect_json_contract
autodiscovery
discovered_domains
autocircular
tcp16
nfqueue
firewall
nfqws2
```

- [ ] **Step 3: Prove red**

Run: `node --test tests/product/z2k-data-diagnostics.test.mjs`

Expected: FAIL because current geosite/list scripts are only watched and diagnostics are fragmented.

- [ ] **Step 4: Implement controlled dynamic refresh**

`z2k-data-refresh.uc` stages download/generation, validates output and atomically publishes data. It may invoke exact upstream `z2k-geosite.sh`/`z2k-update-lists.sh` only through fixed internal operations that cannot execute upstream auto-update/init ownership; otherwise it implements only their data-generation semantics.

- [ ] **Step 5: Implement diagnostics as projection of existing authorities**

Read V3 receipt, runtime composition, Asset Registry, strategy catalog, Detect status, autocircular identity, NFQUEUE/firewall/process state. Do not create duplicate lifecycle truth.

- [ ] **Step 6: Prove green and commit**

Run: `node --test tests/product/z2k-data-diagnostics.test.mjs tests/product/*resource*.test.mjs`

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc tests/product/z2k-data-diagnostics.test.mjs
git commit -m "feat: integrate Z2K data and diagnostics"
```

### Task 14: Replace production Scanner and update Components/Resources/Scanner UI

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- Remove: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- Remove: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- Remove: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc`
- Remove: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Test: `tests/ui/z2k-coherent-ui.test.mjs`
- Test: `tests/product/z2k-old-scanner-unwired.test.mjs`

**Interfaces:** Components shows one coherent Z2K Core. Resources shows `Управляется Z2K Core` with no independent update. Scanner exposes probe/classify/quic/voice/tcp16/autodiscovery.

- [ ] **Step 1: Add UI tests for healthy/update/broken/managed states**

Require release, strategy count, Detect architecture/status and synchronized compatibility. Require no independent Z2K refresh control.

- [ ] **Step 2: Add Scanner UI tests**

Require first-class domain probe, DPI classify, QUIC, Discord Voice, TCP16 and automatic discovery. Remove legacy candidate-count/planner-complexity controls.

- [ ] **Step 3: Add production import-closure test**

Assert production RPC/CLI/UI no longer import the four old probing modules. `scanner-cli.uc` is a compatibility shell over typed Detect actions only.

- [ ] **Step 4: Prove red**

Run: `node --test tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs`

Expected: FAIL on old Scanner/UI behavior.

- [ ] **Step 5: Rewire and remove old probing modules**

There is no Detect-to-old-scanner fallback. Detect unavailable/incoherent uses canonical Detect errors.

- [ ] **Step 6: Update Components/Resources ownership**

Healthy Components requires coherent V3 + runtime + Detect. Backend and frontend both reject/skip independent Z2K refresh while Avatar and other independent sources still refresh.

- [ ] **Step 7: Prove green**

```bash
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
git rm zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc
git commit -m "feat: make Z2K Detect the Scanner engine"
```

## Phase F — Verification and live-router acceptance

### Task 15: Full regression, failure injection and real-router proof

**Files:**
- Create: `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect/acceptance.md`
- Create: `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect/live-evidence.json`
- Update: docs that still describe the old Scanner/Z2K lifecycle after implementation stabilizes.

**Interfaces:** final status is `PASS`, `DONE_WITH_CONCERNS` or `FAIL` using the design evidence contract.

- [ ] **Step 1: Run all new focused suites**

```bash
node --test tests/product/z2k-release-identity.test.mjs tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-coherent-candidate.test.mjs tests/product/z2k-managed-strategy-source.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-autocircular-pool-identity.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-data-diagnostics.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/ui/z2k-coherent-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the repository full harness and static checks**

Run the repository's documented full harness, then:

```bash
git diff --check
sh -n zapret2-manager/files/etc/init.d/zapret2-manager
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
```

No new failure may be called pre-existing without baseline evidence.

- [ ] **Step 3: Prove rollback with injected failures**

Exercise pre-commit Detect SHA failure and post-materialization readiness failure. Record before/after receipt, runtime digest, Detect digest, catalog digest and active strategy; require exact LKG restoration.

- [ ] **Step 4: Deploy through the existing safe router workflow and capture baseline**

Record hardware/arch, OpenWrt/Z2M version, installed Z2K release, sourceCommit, manifest seq/SHA, runtimeBundleDigest, compiler/catalog digests, Detect arch/SHA, compatibilityIdentity, active strategy, nfqws2 pid, NFQUEUE 300 owner and nft queue rule.

- [ ] **Step 5: Prove current release discovery and coherent update**

Fresh check must expose current upstream `p-*` when newer than installed `r-*`. One update activates runtime + strategies + Detect together. Components shows synchronized state. Resources has no independent Z2K update. Direct source refresh returns `EMANAGED`.

- [ ] **Step 6: Run real one-shot Detect commands**

Capture raw JSON and normalized RPC results for a known-clear domain probe, suspected/known-blocked probe, classify target, real UDP/443 QUIC target and TCP16 curated targets. Record actual verdicts; an inconclusive network verdict is not rewritten as success or failure.

- [ ] **Step 7: Prove autodiscovery and procd recovery**

Enable discovery, capture DNS source, trigger a domain observation, prove append to `discovered-domains.txt`, prove nfqws2 observes the list update, kill Detect, prove procd respawns with a new pid, and prove discovered domains survive restart.

- [ ] **Step 8: Run Discord Voice acceptance**

With a live Discord call, run `voice --json`; capture target, control STUN, Discord STUN, mark credibility, trace and working arm when found. Capture autocircular key, pool digest and selected arm before/after failures.

If the live call is the only unavailable dependency, the only blocker text is:

```text
REQUIRED_USER_INPUT:
Start or join a Discord voice/video call and keep it active for the acceptance probe.

WHY_ONLY_USER_CAN_PROVIDE_IT:
The upstream voice probe discovers the ephemeral Discord voice endpoint from the router's live connection table; there is no public DNS target the agent can synthesize offline.

[goal:blocked]
```

- [ ] **Step 9: Prove real autocircular rotation**

Require observed `arm N -> failure evidence -> arm N+1`. If Detect finds a working arm, verify runtime reaches and stabilizes on it. If not, continue systematic debugging; final status cannot be `PASS`.

- [ ] **Step 10: Record resource usage and persistence**

Capture Detect binary size, idle/active RSS/CPU, especially on MIPS when available. Restart services and, with user approval, reboot; verify receipt, runtime, active strategy, Detect service, discovered domains, compatible autocircular state, NFQUEUE and nfqws2 recover.

- [ ] **Step 11: Request code review**

Use `superpowers:requesting-code-review`. Reviewer checks for second lifecycle owners, hidden old-scanner fallback, Z2K HEAD fetches, stale `z2k-detectors.lua`, partial `p-*` support, metadata-only rollback, release/user-data mixing and dynamic-data contamination of Core identity.

- [ ] **Step 12: Record final evidence and commit**

Acceptance must include current HEAD/upstream release, Core identities, runtime membership, legacy detector absence, Detect results, strategy/catalog identities, autocircular before/after/working arm, autodiscovery evidence, migration/rollback evidence, UI states, focused/full test results and review result.

```bash
git add .superpowers/sdd/2026-09-06-z2k-coherent-core-detect/acceptance.md .superpowers/sdd/2026-09-06-z2k-coherent-core-detect/live-evidence.json docs
git commit -m "docs: record coherent Z2K acceptance evidence"
```

---

## Self-Review Checklist

- Release model: Task 1.
- Complete current upstream membership: Task 2.
- Coherent identity: Task 3.
- Core-managed strategies: Task 4.
- Detect artifact: Task 5.
- Receipt V3: Task 6.
- Atomic lifecycle/rollback: Task 7.
- Legacy migration and detector removal: Task 8.
- Autocircular semantic identity: Task 9.
- Safe Detect execution: Task 10.
- Typed RPC: Task 11.
- Autodiscovery/procd: Task 12.
- Geosite/dynamic data/diagnostics: Task 13.
- Components/Resources/Scanner replacement: Task 14.
- Real-router proof: Task 15.
- No task permits independent Z2K Strategy or Detect refresh.
- No task ports Detect algorithms into ucode.
- No production old-scanner fallback remains after Task 14.
- User/runtime data and schema-compatible dynamic datasets remain outside Core release identity.
- Receipt V3 binds Detect, compiler, catalog and runtime to one release.
- Rollback covers physical runtime and Detect bytes.
- Discord Voice and real autocircular rotation are explicit acceptance gates.
