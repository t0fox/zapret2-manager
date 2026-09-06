# Z2K Coherent Core + Detect Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the partially-coupled Z2K lifecycle and Manager-owned DPI scanner with one coherent Z2K Core release bundle whose runtime, official strategies, release-owned data, upstream `z2k-detect`, receipts, diagnostics and rollback all share one exact upstream identity.

**Architecture:** Keep Asset Registry and Resource Center as the mutation authorities, but add a shared release parser and a coherent-candidate boundary so all Z2K artifacts are prepared before activation. Treat upstream `z2k-detect` as an exact lifecycle-managed binary and the only production DPI measurement engine; Z2M only validates typed RPC input, executes allowlisted commands through the existing native helper boundary, validates JSON, supervises `run` through procd, and renders results in LuCI.

**Tech Stack:** OpenWrt/procd; ucode; C11 native helper/broker; LuCI JavaScript; Node.js `node:test`; Asset Registry; existing Resource Center update transaction; upstream `necronicle/z2k` `z2k-enhanced` release manifest and architecture-specific Go binaries.

**Spec:** `docs/superpowers/specs/2026-09-06-z2k-coherent-core-detect-integration-design.md`

## Global Constraints

- Support both historical `r-*` and current `p-*` Z2K releases end-to-end; authoritative `latest` comes from upstream release metadata, never prefix/lexical ordering.
- Core runtime, release-owned lists, compiler inputs, compiled official strategies and `z2k-detect` must share the same exact release/source commit before activation.
- Use the original upstream `z2k-detect` binary; do not port its algorithms to ucode and do not keep the old Manager scanner as a production fallback.
- Install exactly one `z2k-detect` binary matching the router architecture.
- The browser must never supply executable names, arbitrary argv, shell fragments, paths or environment variables; detect execution uses a fixed allowlisted native-helper protocol.
- One-shot detect results are authoritative only as bounded JSON. Human-readable stdout is not parsed for DPI results.
- `z2k-detect run` is supervised by procd and is not a long-lived RPC child.
- Preserve user/runtime-owned data across Core updates: active source selection, user strategies, exclusions, discovered domains and compatible dynamic datasets.
- Learned autocircular indexes survive only when their semantic pool digest is unchanged; legacy rows without provable pool identity are reset during one-time migration.
- Z2K Strategies, Detect, Lua and release-owned lists cannot be refreshed independently; direct attempts return `EMANAGED` with owner `z2k-core`.
- Candidate failure before commit leaves the current LKG physically untouched; activation failure restores the previous physical runtime, not metadata only.
- Upstream webpanel, Keenetic `ndm/*`, Keenetic `S99*` lifecycle and upstream product auto-updater remain excluded as parallel owners.
- Engineering difficulty, failed tests, regressions, refactoring and uncertainty remain `WORKING`. Only a proven user-only dependency may block, using exactly `REQUIRED_USER_INPUT`, `WHY_ONLY_USER_CAN_PROVIDE_IT`, then `[goal:blocked]`.

---

## File Structure

### New focused modules

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc` — one parser/validator for `r-*` and `p-*` release identities.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc` — immutable candidate assembly, digest identities and cross-artifact coherence checks.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc` — detect architecture mapping, installed-binary authority, typed command/result schemas and status projection.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc` — semantic pool digest generation and targeted learned-state invalidation.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc` — legacy evidence capture and V1/V2-to-coherent migration policy.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc` — coherent Z2K diagnostics projection.

### Existing lifecycle files to modify

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
- `tools/generate-z2k-classification.mjs`
- `zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json`
- `zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json`
- `zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json`

### Detect execution/service files to modify

- `zapret2-manager/src/z2m-core-helper/protocol.c`
- `zapret2-manager/src/z2m-core-helper/scanner.c`
- `zapret2-manager/src/z2m-core-helper/main.c`
- `zapret2-manager/src/z2m-helperd/supervise.c`
- `zapret2-manager/files/etc/init.d/zapret2-manager`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`

### LuCI files to modify

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

### Task 1: Unify Z2K release parsing across the authority chain

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-release-identity.test.mjs`

**Interfaces:**
- Produces: `z2k_release_parse(value) -> {version,family,major,minor}|null`
- Produces: `z2k_release_valid(value) -> bool`
- Produces: `z2k_release_same(a,b) -> bool`
- Consumed by: catalog, manifest validation, installed receipt validation and runtime composition validation.

- [ ] **Step 1: Write the failing release-identity tests**

```js
assert.deepEqual(parse('r-82.7'), { version: 'r-82.7', family: 'r', major: 82, minor: 7 });
assert.deepEqual(parse('p-82.14'), { version: 'p-82.14', family: 'p', major: 82, minor: 14 });
assert.equal(parse('x-82.14'), null);
assert.equal(parse('p-82.14.1'), null);
assert.equal(validInstalled('p-82.14'), true);
assert.equal(validRuntime('p-82.14'), true);
```

- [ ] **Step 2: Run the focused test and verify the current `r-*`-only code fails**

Run: `node --test tests/product/z2k-release-identity.test.mjs`

Expected: FAIL on `p-82.14` in at least `z2k-versions.uc`, `z2k-installed-release.uc` or `runtime-composition.uc`.

- [ ] **Step 3: Implement the shared parser and replace local regex parsers**

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

Use upstream manifest `current` as the authoritative latest value. For catalog display ordering, sort cross-family releases by resolved tag publication/commit evidence; use numeric `major/minor` only as a same-family fallback.

- [ ] **Step 4: Run the release tests plus existing version/runtime tests**

Run: `node --test tests/product/z2k-release-identity.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        tests/product/z2k-release-identity.test.mjs
git commit -m "fix: support current Z2K release identities"
```

### Task 2: Regenerate the upstream classification from current consumed semantics

**Files:**
- Modify: `tools/generate-z2k-classification.mjs`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc`
- Test: `tests/product/z2k-current-upstream-membership.test.mjs`

**Interfaces:**
- Produces classification entries for current six Lua modules, consumed lists, fake/blob assets, compiler inputs and the architecture-specific Detect artifact class.
- `unknown-consumed` remains blocking; unknown genuinely unconsumed platform files remain advisory/ignored according to explicit policy.

- [ ] **Step 1: Add a fixture manifest containing current Lua/list/Detect paths and assert their classes**

```js
assert.equal(byPath['files/lua/z2k-alert.lua'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/sni_wl_candidates.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/tcp16_targets.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['files/lists/tcp16_nets.txt'].dependencyClass, 'runtime-exact');
assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].dependencyClass, 'detect-arch');
assert.equal(byPath['files/lua/z2k-detectors.lua'], undefined);
```

- [ ] **Step 2: Run the test and verify stale classification assumptions fail**

Run: `node --test tests/product/z2k-current-upstream-membership.test.mjs`

Expected: FAIL because Detect and newly-consumed lists are not first-class lifecycle members and/or stale detector membership remains.

- [ ] **Step 3: Extend the generator with explicit dependency classes**

Use these classes:

```text
runtime-exact   current release-owned Lua/fake/list bytes consumed at runtime
detect-arch     architecture-specific z2k-detect build; exactly one selected per candidate
compiler-input  exact official compiler input
watched         semantic/trust review only
ignored-platform upstream owner intentionally excluded from Z2M
```

Do not classify every `files/lists/*` blindly as required; derive required list membership from actual current compiler/runtime/Detect references and preserve explicit classification for known optional data.

- [ ] **Step 4: Regenerate the classification and verify deterministic output**

Run: `node tools/generate-z2k-classification.mjs tests/fixtures/z2k-signed-update/UPDATES.json`

Then run it a second time and require `git diff --exit-code` for the generated file.

- [ ] **Step 5: Run classification/dependency tests**

Run: `node --test tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-canonical-plan-contract.test.mjs tests/product/z2k-removal-plan-parity.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/generate-z2k-classification.mjs \
        zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json \
        zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc \
        tests/product/z2k-current-upstream-membership.test.mjs
git commit -m "feat: classify complete current Z2K runtime"
```

### Task 3: Build one immutable coherent candidate and compatibility identity

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-coherent-candidate.test.mjs`

**Interfaces:**
- Produces: `z2k_candidate_build(input) -> {ok:true,candidate}|{ok:false,error}`
- Candidate fields: `release`, `sourceCommit`, `manifestSeq`, `manifestSha256`, `classificationSha256`, `runtimeMembership`, `detect`, `compilerInputsDigest`, `catalogDigest`, `runtimeBundleDigest`, `compatibilityIdentity`.
- Produces: `z2k_candidate_identity(candidate) -> 64-char sha256`.

- [ ] **Step 1: Add failure tests for mixed revisions and missing required members**

```js
assert.equal(build({ release: 'p-82.14', runtimeCommit: A, compilerCommit: B }).error.code, 'ECOMPATIBILITY');
assert.equal(build({ release: 'p-82.14', detect: null }).error.code, 'EDETECT_UNAVAILABLE');
assert.equal(build({ release: 'p-82.14', requiredLists: ['sni_wl_candidates.txt'], presentLists: [] }).ok, false);
```

- [ ] **Step 2: Run the new test and verify no current boundary can prove all identities together**

Run: `node --test tests/product/z2k-coherent-candidate.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic identity serialization**

Serialize sorted semantic rows only, for example:

```text
release|p-82.14
sourceCommit|<40hex>
manifestSha256|<64hex>
runtime|<runtimeBundleDigest>
detect|arm64|<sha256>|<bytes>
compiler|<compilerInputsDigest>
catalog|<catalogDigest>
```

Reject missing or cross-release/source identities before hashing. Do not include transient staging paths, timestamps or Registry revision counters in `compatibilityIdentity`.

- [ ] **Step 4: Make `resolveCandidate()` consume the coherent candidate instead of independently reconstructing release identity**

`runtime-composition.uc` may still own runtime ordering/CAS verification, but its candidate authority must be derived from the single coherent object.

- [ ] **Step 5: Run candidate, closure and runtime tests**

Run: `node --test tests/product/z2k-coherent-candidate.test.mjs tests/product/z2k-candidate-compatibility.test.mjs tests/product/z2k-runtime-summary.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        tests/product/z2k-coherent-candidate.test.mjs
git commit -m "feat: build coherent Z2K release candidates"
```

### Task 4: Make official Z2K strategies a derivative of Core release, not branch HEAD

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- Test: `tests/product/z2k-managed-strategy-source.test.mjs`

**Interfaces:**
- `strategies_source_refresh('z2k') -> EMANAGED owner=z2k-core`.
- Core candidate preparation receives compiler inputs from the selected exact source commit and returns the compiled catalog plus `catalogDigest`.

- [ ] **Step 1: Write tests proving direct Z2K refresh is rejected and Core prepare uses selected release commit**

```js
assert.deepEqual(refresh('z2k').error, { code: 'EMANAGED', owner: 'z2k-core' });
assert.equal(prepare.compilerSourceCommit, selected.sourceCommit);
assert.notEqual(prepare.compilerSourceCommit, branchHeadWhenDifferent);
```

- [ ] **Step 2: Run the tests and observe the current HEAD-oriented path fail**

Run: `node --test tests/product/z2k-managed-strategy-source.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Remove the Z2K branch-HEAD metadata request from production refresh**

Keep Avatar independent refresh unchanged. Z2K compiler file URLs must be built from the exact selected `sourceCommit` only.

- [ ] **Step 4: Run strategy-source/compiler tests**

Run: `node --test tests/product/z2k-managed-strategy-source.test.mjs tests/product/z2k-official-compiler*.test.mjs`

Expected: PASS with no network dependency in pure compiler fixtures.

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc \
        tests/product/z2k-managed-strategy-source.test.mjs
git commit -m "fix: bind Z2K strategies to Core release"
```

## Phase B — Detect artifact, receipts and transaction

### Task 5: Resolve, download and verify exactly one upstream `z2k-detect` binary

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Test: `tests/product/z2k-detect-artifact.test.mjs`

**Interfaces:**
- Produces: `z2k_detect_arch(machine) -> upstreamArch|null`.
- Produces: `z2k_detect_candidate(manifest, sourceCommit, machine) -> {sourcePath,runtimeTarget,sha256,byteSize?,arch}`.
- Stable runtime target: `/usr/libexec/zapret2-manager/z2k-detect`.

- [ ] **Step 1: Add architecture and digest tests**

```js
assert.equal(mapArch('aarch64'), 'arm64');
assert.equal(mapArch('x86_64'), 'amd64');
assert.equal(mapArch('mipsel'), 'mipsle');
assert.equal(mapArch('mips'), 'mips');
assert.equal(mapArch('riscv64'), 'riscv64');
assert.equal(mapArch('unsupported-cpu'), null);
```

Also assert that the candidate path is exactly `z2k-detect/builds/z2k-detect-linux-<arch>` and the expected SHA comes from the selected manifest.

- [ ] **Step 2: Run the tests and verify Detect is not currently candidate-owned**

Run: `node --test tests/product/z2k-detect-artifact.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Stage Detect with the same private-download/digest rules as other lifecycle bytes**

Do not package all architecture binaries. Fetch one exact commit path, verify SHA-256 before candidate admission, chmod `0755` only after digest verification, and include its digest in candidate identity.

- [ ] **Step 4: Add an executable-format post-stage check**

Execute the staged file through a fixed internal helper seam with no user argv and require that execution reaches the program rather than failing `ENOEXEC`/permission; an expected usage exit is acceptable for this self-check.

- [ ] **Step 5: Run Detect artifact and update staging tests**

Run: `node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc \
        tests/product/z2k-detect-artifact.test.mjs
git commit -m "feat: stage upstream Z2K Detect with Core"
```

### Task 6: Introduce coherent receipt V3 and legacy-readable installed authority

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Test: `tests/product/z2k-receipt-v3.test.mjs`

**Interfaces:**
- New schema: `asset-activation-receipt.v3`.
- Keep legacy bundle wire ID `z2k-curated-lua` for Registry migration compatibility, but V3 records full coherent Core identity rather than Lua-only semantics.
- `z2k_registry_receipt_state()` returns `COHERENT_VERIFIED`, `LEGACY_VERIFIED` or `unknown`.

- [ ] **Step 1: Write V3 validity tests**

```js
assert.equal(valid(v3Complete), true);
assert.equal(valid({ ...v3Complete, detect: null }), false);
assert.equal(valid({ ...v3Complete, compatibilityIdentity: '0'.repeat(64) }), false);
assert.equal(state(v2Complete).state, 'LEGACY_VERIFIED');
assert.equal(state(v3Complete).state, 'COHERENT_VERIFIED');
```

- [ ] **Step 2: Run the test and verify current V1/V2-only authority fails**

Run: `node --test tests/product/z2k-receipt-v3.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Define V3 fields exactly**

```json
{
  "schema": "asset-activation-receipt.v3",
  "bundleId": "z2k-curated-lua",
  "version": "p-82.14",
  "sourceCommit": "<40hex>",
  "manifestSeq": 76,
  "manifestSha256": "<64hex>",
  "classificationSha256": "<64hex>",
  "runtimeBundleDigest": "<64hex>",
  "compatibilityIdentity": "<64hex>",
  "detect": { "arch": "arm64", "sha256": "<64hex>", "runtimeTarget": "/usr/libexec/zapret2-manager/z2k-detect" },
  "compiler": { "inputsDigest": "<64hex>", "catalogDigest": "<64hex>" },
  "z2kMembership": [],
  "installedAuthorityRevision": 1
}
```

- [ ] **Step 4: Validate physical Registry membership and Detect bytes before accepting V3**

The installed authority must fail if an extra/missing lifecycle asset exists, Detect digest differs, or receipt source/release identity differs from member provenance.

- [ ] **Step 5: Run receipt/runtime tests**

Run: `node --test tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/z2k-update-transaction.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        tests/product/z2k-receipt-v3.test.mjs
git commit -m "feat: record coherent Z2K activation receipts"
```

### Task 7: Make prepare/commit/rollback atomic across runtime, catalog and Detect

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc`
- Test: `tests/product/z2k-coherent-transaction.test.mjs`

**Interfaces:**
- Prepare writes only staging/private candidate state.
- Commit publishes runtime membership + Detect + compiled catalog + V3 receipt in one lifecycle operation.
- Rollback restores prior Registry bytes, runtime materialization, active strategy config and service state.

- [ ] **Step 1: Write transaction tests for three failure points**

```text
A: Detect SHA failure before commit -> active X unchanged
B: candidate active strategy preflight failure -> active X unchanged
C: injected post-materialize readiness failure -> physical X restored
```

Assert runtime digests, catalog digest, active strategy ID and Detect SHA before/after.

- [ ] **Step 2: Run the test and verify current transaction does not cover the new artifacts**

Run: `node --test tests/product/z2k-coherent-transaction.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Extend the existing lifecycle lock/pending-activation state with coherent candidate fields**

Persist enough rollback evidence to restore:

```text
prior receipt
prior Registry revision/membership
prior runtime composition
prior Detect bytes/digest
prior compiled catalog/source snapshot
prior active strategy selection/config digest
prior enabled/runtime mode
```

- [ ] **Step 4: Gate active strategy compatibility against candidate runtime before commit**

Official Z2K: same canonical ID must exist in candidate catalog. Avatar/User: keep current source/ID and run candidate-runtime closure/native preflight; incompatibility returns `ECOMPATIBILITY`.

- [ ] **Step 5: Run coherent transaction plus existing readiness/rollback tests**

Run: `node --test tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-post-mutation-check-state.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc \
        tests/product/z2k-coherent-transaction.test.mjs
git commit -m "feat: activate Z2K as one coherent transaction"
```

## Phase C — Migration and runtime intelligence

### Task 8: Migrate legacy receipts/runtime and retire stale `z2k-detectors.lua`

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Test: `tests/product/z2k-legacy-migration.test.mjs`
- Test: `tests/product/z2k-current-lua-function-closure.test.mjs`

**Interfaces:**
- `z2k_migration_state(listed) -> LEGACY_Z2K|COHERENT_Z2K|NONE`.
- `z2k_legacy_evidence_capture(...)` returns immutable rollback evidence before migration.
- `z2k_current_lua_function_closure(catalog,runtime)` must prove all referenced functions without legacy detector.

- [ ] **Step 1: Add a function-closure test with the current six upstream Lua modules only**

Assert that official compiled strategy references resolve without `z2k-detectors.lua`, then add a negative fixture with one deliberately missing function and require candidate rejection.

- [ ] **Step 2: Add legacy migration tests**

```js
assert.equal(classify(v2Install), 'LEGACY_Z2K');
assert.equal(classify(v3Install), 'COHERENT_Z2K');
assert.equal(migrateFailure.activeReceipt.schema, 'asset-activation-receipt.v2');
assert.equal(migrateSuccess.activeReceipt.schema, 'asset-activation-receipt.v3');
assert.equal(migrateSuccess.discoveredDomainsPreserved, true);
```

- [ ] **Step 3: Run tests and verify stale package-static detector/migration assumptions fail**

Run: `node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Remove `z2k-detectors.lua` from package composition only after current function closure passes**

Do not keep a fallback load order. A missing current function is a blocking candidate error with the function and referencing strategy/profile in diagnostics.

- [ ] **Step 5: Preserve discovered domains, current source selection, exclusions and user strategies during migration**

Legacy learned autocircular rows are handled by Task 9, not wiped as generic configuration.

- [ ] **Step 6: Run migration/runtime tests**

Run: `node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-runtime-summary.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc \
        tests/product/z2k-current-lua-function-closure.test.mjs \
        tests/product/z2k-legacy-migration.test.mjs
git commit -m "feat: migrate legacy Z2K runtime coherently"
```

### Task 9: Bind learned autocircular state to semantic pool identity

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc`
- Modify: the existing autocircular state/control module that owns `state.tsv` projection and reset/freeze actions.
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Test: `tests/product/z2k-autocircular-pool-identity.test.mjs`

**Interfaces:**
- `z2k_pool_semantic_digest(pool) -> sha256` from ordered semantic arms, not labels or timestamps.
- `z2k_learned_state_reconcile(oldIdentity,newIdentity,rows) -> {preserve,reset}`.

- [ ] **Step 1: Write same-pool/changed-pool/legacy-row tests**

```js
assert.equal(digest(poolA), digest(clone(poolA)));
assert.notEqual(digest(poolA), digest(poolWithChangedArm));
assert.deepEqual(reconcile(A, A, rows).reset, []);
assert.deepEqual(reconcile(A, B, rows).reset, ['discord_udp']);
assert.equal(reconcile(null, B, legacyRows).resetAllLegacy, true);
```

- [ ] **Step 2: Run the focused test and verify current integer-only state has no semantic guard**

Run: `node --test tests/product/z2k-autocircular-pool-identity.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Persist pool identity alongside learned state using a backward-readable sidecar**

Use `/opt/zapret2/extra_strats/cache/autocircular/pool-identity.json` so upstream `state.tsv` remains upstream-compatible. Store `{schema:1, pools:{key:digest}}` atomically.

- [ ] **Step 4: Reconcile only affected keys during Core commit**

Same digest preserves state/frozen selection. Changed digest resets that key to automatic. Legacy rows without identity are reset once during legacy-to-coherent migration.

- [ ] **Step 5: Run autocircular tests including existing Discord tests**

Run: `node --test tests/product/z2k-autocircular-pool-identity.test.mjs tests/product/discord-voice-autocircular.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc \
        tests/product/z2k-autocircular-pool-identity.test.mjs
git add <existing-autocircular-state-owner-path>
git commit -m "feat: bind autocircular learning to pool identity"
```

Before executing this task, replace `<existing-autocircular-state-owner-path>` with the single production file returned by `git grep -l 'state.tsv' zapret2-manager/files/usr/libexec/zapret2-manager`; do not edit multiple owners.

## Phase D — Detect execution, RPC and service

### Task 10: Add fixed native-helper operations for one-shot `z2k-detect` commands

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `zapret2-manager/src/z2m-core-helper/scanner.c`
- Modify: `zapret2-manager/src/z2m-core-helper/main.c`
- Modify: `zapret2-manager/src/z2m-helperd/supervise.c`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Test: `tests/native/z2k-detect-helper.test.mjs`

**Interfaces:**
- Fixed operations: `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`.
- Executable is always `/usr/libexec/zapret2-manager/z2k-detect`.
- Request fields are typed values only; helper constructs final argv from allowlisted flags.

- [ ] **Step 1: Add protocol rejection tests**

Require rejection of request fields named `executable`, `argv`, `command`, `env`, `cwd`, unknown flags, over-limit `timeout`, over-limit `repeats`, invalid host/port and embedded NUL/newline.

- [ ] **Step 2: Add exact argv construction tests**

Example expected classify argv:

```text
/usr/libexec/zapret2-manager/z2k-detect classify example.com:443 -hello modern -repeats 3 -timeout 6s -json
```

The browser/RPC does not provide these strings; the helper builds them.

- [ ] **Step 3: Run native tests and verify no fixed Detect operations exist**

Run: `node --test tests/native/z2k-detect-helper.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implement fixed operation dispatch with existing fork/execve supervision**

Set stdout/stderr byte ceilings, wall-time ceilings per command, kill process group on timeout, and return structured `{exitCode,stdout,stderr,timedOut}` to ucode.

- [ ] **Step 5: Run native helper/broker regression suite**

Run: `node --test tests/native/z2k-detect-helper.test.mjs tests/native/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/src/z2m-core-helper/protocol.c \
        zapret2-manager/src/z2m-core-helper/scanner.c \
        zapret2-manager/src/z2m-core-helper/main.c \
        zapret2-manager/src/z2m-helperd/supervise.c \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc \
        tests/native/z2k-detect-helper.test.mjs
git commit -m "feat: execute Z2K Detect through fixed helper ops"
```

### Task 11: Expose typed Detect RPC and JSON schema validation

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Test: `tests/product/z2k-detect-rpc.test.mjs`

**Interfaces:**
- RPCs: `z2k_detect_status`, `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`.
- Canonical errors: `EZ2K_NOT_INSTALLED`, `EZ2K_INCOHERENT`, `EDETECT_UNAVAILABLE`, `EDETECT_INCOMPATIBLE`, `EDETECT_TIMEOUT`, `EDETECT_FAILED`, `EDETECT_SCHEMA`, `EDETECT_NO_TARGET`, `EDETECT_NO_ACTIVE_VOICE`.

- [ ] **Step 1: Add fixture JSON for each upstream command and malformed variants**

Require additive unknown fields to be tolerated, but missing required verdict/target/trace semantics or wrong field types to return `EDETECT_SCHEMA`.

- [ ] **Step 2: Run the test and verify the current RPC surface has no Detect contract**

Run: `node --test tests/product/z2k-detect-rpc.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement per-command input validators and result normalizers**

Do not expose a generic `run_detect(args)` RPC. Each method has an explicit declaration and translates helper result to a bounded product schema.

- [ ] **Step 4: Gate every command on coherent installed authority**

If receipt/runtime/Detect digest mismatch, return `EDETECT_INCOMPATIBLE`; never invoke the old scanner.

- [ ] **Step 5: Run RPC tests plus JavaScript syntax check**

Run: `node --test tests/product/z2k-detect-rpc.test.mjs && node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc \
        zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
        tests/product/z2k-detect-rpc.test.mjs
git commit -m "feat: expose typed Z2K Detect RPC"
```

### Task 12: Supervise `z2k-detect run` with procd and preserve discovered domains

**Files:**
- Modify: `zapret2-manager/files/etc/init.d/zapret2-manager`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Test: `tests/product/z2k-detect-discovery-service.test.mjs`

**Interfaces:**
- Persistent control file: `/etc/zapret2-manager/z2k-detect-discovery.json` with schema `{schema:1,enabled:boolean,dnsSource:"auto"|"agh"|"dnsmasq"|"pkt"}`.
- procd command: `/usr/libexec/zapret2-manager/z2k-detect run -publish /opt/zapret2/lists/discovered-domains.txt` plus optional fixed `-dns-source`.
- RPCs: `z2k_detect_discovery_status/enable/disable/restart`.

- [ ] **Step 1: Write service rendering/state tests**

Assert disabled config creates no Detect instance, enabled config creates exactly one fixed command, and discovered-domain file content is not truncated during Core update or service restart.

- [ ] **Step 2: Run the test and verify current init has only helperd/watchdog**

Run: `node --test tests/product/z2k-detect-discovery-service.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add a named `z2k-detect` procd instance after lifecycle recovery**

Use `respawn`, bounded `term_timeout`, stdout/stderr logging, and only start when coherent Detect is installed and discovery is enabled. Do not start during paused lifecycle activation.

- [ ] **Step 4: Make status report pid, restart state, configured DNS source and last known discovered-domain mtime/count**

Status `running` requires a live supervised process; do not infer health only from enabled config.

- [ ] **Step 5: Run service tests and shell syntax**

Run: `node --test tests/product/z2k-detect-discovery-service.test.mjs && sh -n zapret2-manager/files/etc/init.d/zapret2-manager`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/etc/init.d/zapret2-manager \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc \
        zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
        tests/product/z2k-detect-discovery-service.test.mjs
git commit -m "feat: supervise Z2K Detect autodiscovery"
```

## Phase E — Data, diagnostics and product UI

### Task 13: Integrate geosite/dynamic data and coherent diagnostics

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc`
- Modify: the existing resource/list updater that owns dynamic dataset refresh.
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Test: `tests/product/z2k-data-diagnostics.test.mjs`

**Interfaces:**
- Release-owned data changes only with Core activation and contributes to `runtimeBundleDigest`.
- Dynamic external dataset revisions are separately persisted and do not alter Core compatibility identity while schema-compatible.
- `z2k_diagnostics_run()` returns per-check `{id,status,evidence,error?}`.

- [ ] **Step 1: Write data-identity tests**

Assert changing `sni_wl_candidates.txt` in a release candidate changes Core identity; changing a schema-compatible dynamic geosite revision does not.

- [ ] **Step 2: Write diagnostics tests for at least these IDs**

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

- [ ] **Step 3: Run the new test and verify current watched-only data/fragmented diagnostics fail**

Run: `node --test tests/product/z2k-data-diagnostics.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Integrate geosite/list generation through controlled staging and atomic publish**

Use exact upstream script only when its invoked path does not take over update/init ownership; otherwise preserve the generated-data semantics in the existing Z2M data updater. Never execute upstream product auto-update logic.

- [ ] **Step 5: Implement diagnostics projection from existing authorities rather than re-checking state with duplicate rules**

Diagnostics reads V3 receipt, runtime composition, Detect status, Asset Registry, strategy catalog, NFQUEUE/firewall/process evidence and autocircular identity.

- [ ] **Step 6: Run diagnostics and existing list/resource tests**

Run: `node --test tests/product/z2k-data-diagnostics.test.mjs tests/product/*resource*.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Before commit, resolve the single production dynamic-data updater path with `git grep -l 'geosite\|update-lists' zapret2-manager/files/usr/libexec/zapret2-manager` and include only its actual owner file.

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc \
        zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
        tests/product/z2k-data-diagnostics.test.mjs
git add <resolved-dynamic-data-owner>
git commit -m "feat: integrate Z2K data and diagnostics"
```

### Task 14: Replace production Scanner backend and update Components/Resources/Scanner UI

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- Remove after import-closure proof: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- Remove after import-closure proof: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- Remove after import-closure proof: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc`
- Remove after import-closure proof: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Test: `tests/ui/z2k-coherent-ui.test.mjs`
- Test: `tests/product/z2k-old-scanner-unwired.test.mjs`

**Interfaces:**
- Components: one Z2K Core status with runtime/strategies/Detect/data coherence.
- Resources: Z2K shows `Управляется Z2K Core`; no independent Update; Update All skips it.
- Scanner: actions map to `probe`, `classify`, `quic`, `voice`, `tcp16`, autodiscovery.

- [ ] **Step 1: Add UI assertions for healthy/update/broken/managed states**

Require visible fields for installed release, strategy count, Detect architecture/status and synchronized compatibility. Require absence of a Z2K independent refresh control.

- [ ] **Step 2: Add Scanner UI assertions**

Require first-class sections/buttons for domain probe, DPI classify, QUIC, Discord Voice, TCP16 and automatic discovery. Remove legacy candidate-count/planner-complexity controls that have no Detect equivalent.

- [ ] **Step 3: Add production import-closure test**

Run `git grep` from the test and assert the four old probing modules are not imported by production RPC/CLI/UI code. `scanner-cli.uc` becomes a compatibility shell over typed Detect actions only.

- [ ] **Step 4: Run tests and verify old Scanner/UI assumptions fail**

Run: `node --test tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs`

Expected: FAIL.

- [ ] **Step 5: Rewire Scanner to Detect and remove old probing modules once the import-closure test passes**

There is no `try Detect -> fallback old scanner` branch. Detect unavailable/incoherent maps to the canonical Detect errors.

- [ ] **Step 6: Update Components and Resources projections**

Components healthy requires coherent V3 + runtime + Detect. Resources backend and frontend both enforce managed ownership. `Обновить всё` returns/skips Z2K with managed reason while still refreshing Avatar/other independent sources.

- [ ] **Step 7: Run UI/product regressions and syntax checks**

Run:

```bash
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
git rm zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc \
       zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc \
       zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc \
       zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc
git commit -m "feat: make Z2K Detect the Scanner engine"
```

## Phase F — Full verification and live-router acceptance

### Task 15: Run complete regression, failure injection and real-router acceptance

**Files:**
- Create: `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect/acceptance.md`
- Create: `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect/live-evidence.json`
- Update documentation that still describes the old Scanner/Z2K lifecycle after implementation is stable.

**Interfaces:**
- Final status: `PASS`, `DONE_WITH_CONCERNS` or `FAIL` using the design's evidence contract.

- [ ] **Step 1: Run focused suites by subsystem**

```bash
node --test tests/product/z2k-release-identity.test.mjs \
  tests/product/z2k-current-upstream-membership.test.mjs \
  tests/product/z2k-coherent-candidate.test.mjs \
  tests/product/z2k-managed-strategy-source.test.mjs \
  tests/product/z2k-detect-artifact.test.mjs \
  tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-coherent-transaction.test.mjs \
  tests/product/z2k-legacy-migration.test.mjs \
  tests/product/z2k-autocircular-pool-identity.test.mjs \
  tests/product/z2k-detect-rpc.test.mjs \
  tests/product/z2k-detect-discovery-service.test.mjs \
  tests/product/z2k-data-diagnostics.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs \
  tests/ui/z2k-coherent-ui.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run the full repository test harness and static checks**

Run the repository's documented full harness, then:

```bash
git diff --check
sh -n zapret2-manager/files/etc/init.d/zapret2-manager
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
```

Expected: no new failures. Any pre-existing failure must be demonstrated from baseline evidence rather than assumed.

- [ ] **Step 3: Exercise injected transaction failures**

Record evidence for pre-commit Detect SHA failure and post-materialization readiness failure. Prove prior V3/V2 receipt, runtime digest, Detect digest, catalog digest and active strategy are restored exactly.

- [ ] **Step 4: Deploy to the real router through the existing safe deployment workflow**

Capture before/after:

```text
hardware + arch
OpenWrt/Z2M version
installed Z2K release
sourceCommit + manifest seq/SHA
runtimeBundleDigest
compiler inputs/catalog digest
Detect arch/SHA
compatibilityIdentity
active strategy
nfqws2 pid + NFQUEUE 300 owner + nft queue rule
```

- [ ] **Step 5: Prove real release discovery and coherent update**

Fresh check must show current upstream `p-*` latest when newer than installed `r-*`; update must activate runtime + strategies + Detect together. Components must show synchronized state; Resources must have no independent Z2K Update; direct source refresh must return `EMANAGED`.

- [ ] **Step 6: Run all one-shot Detect commands on-router**

Capture raw JSON and normalized RPC result for:

```text
probe known-clear domain
probe suspected/known-blocked domain
classify blocked/suspected target
quic real UDP/443 target
tcp16 current curated targets
```

Do not reinterpret an inconclusive network verdict as implementation failure if execution/schema/marking are correct; record the actual verdict.

- [ ] **Step 7: Prove autodiscovery and procd recovery**

Enable discovery, capture detected DNS source, trigger an observed domain, prove append to `discovered-domains.txt`, prove nfqws2 sees the change, kill `z2k-detect`, prove procd respawns it with a new pid, and prove discovered domains survive restart.

- [ ] **Step 8: Run Discord Voice acceptance with a live call**

When a real Discord voice/video call is active, run `voice --json`; capture target, control STUN, Discord STUN, mark credibility, trace and working arm if found. At the same time capture autocircular key, pool digest and selected arm before/after failures.

If a live call is the only missing dependency, stop only with:

```text
REQUIRED_USER_INPUT:
Start or join a Discord voice/video call and keep it active for the acceptance probe.

WHY_ONLY_USER_CAN_PROVIDE_IT:
The upstream voice probe discovers the ephemeral Discord voice endpoint from the router's live connection table; there is no public DNS target that the agent can synthesize offline.

[goal:blocked]
```

- [ ] **Step 9: Prove real autocircular rotation**

Require observed runtime transition `arm N -> failure evidence -> arm N+1`. If Detect finds a working arm, verify autocircular can reach and stabilize on it. If Detect proves a working arm but runtime never reaches it, continue systematic debugging; final status may not be `PASS`.

- [ ] **Step 10: Record resource usage and reboot/service persistence**

Capture Detect binary size, idle/active RSS/CPU, especially on MIPS if available. Restart services and, when user-approved, reboot the router; verify coherent receipt, runtime, active strategy, Detect service, discovered domains, compatible autocircular state, NFQUEUE and nfqws2 recover.

- [ ] **Step 11: Request code review**

Use `superpowers:requesting-code-review` and explicitly ask the reviewer to check for: second lifecycle owners, hidden old-scanner fallback, Z2K HEAD fetches, stale `z2k-detectors.lua`, partial `p-*` support, metadata-only rollback, release/user-data mixing and dynamic-data contamination of Core identity.

- [ ] **Step 12: Write final evidence and commit documentation**

The acceptance report must contain the design's final fields: current HEAD/upstream release, Core identities, runtime counts, legacy-detector absence, Detect command results, strategy/catalog identities, autocircular before/after/working arm, autodiscovery evidence, migration/rollback evidence, UI state, focused/full test results and code-review result.

```bash
git add .superpowers/sdd/2026-09-06-z2k-coherent-core-detect/acceptance.md \
        .superpowers/sdd/2026-09-06-z2k-coherent-core-detect/live-evidence.json \
        docs
git commit -m "docs: record coherent Z2K acceptance evidence"
```

---

## Self-Review Checklist

- Every approved design section maps to a task: release model (1), complete upstream membership (2), coherent candidate (3), strategy/Core coupling (4), Detect artifact (5), V3 receipt (6), atomic lifecycle/rollback (7), migration/legacy detector (8), autocircular identity (9), safe one-shot execution (10), RPC (11), autodiscovery/procd (12), geosite/data/diagnostics (13), Components/Resources/Scanner replacement (14), real-router acceptance (15).
- No task allows independent Z2K strategy or Detect refresh.
- No task ports Detect algorithms into ucode.
- No production fallback to the old Scanner remains after Task 14.
- User/runtime data and dynamic datasets are not inserted into Core release identity.
- Receipt V3 binds Detect/compiler/catalog/runtime to one release identity.
- Rollback requirements cover physical runtime and Detect bytes, not metadata only.
- Discord Voice and real autocircular rotation are explicit acceptance gates rather than unit-test substitutes.
