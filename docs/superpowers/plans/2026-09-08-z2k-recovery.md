# Z2K Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the Z2K product by preserving the proven coherent Core lifecycle, repairing broken RPC/browser contracts, replacing the retired generic Scanner UX with five explicit upstream Detect operations, removing the remaining native Scanner authority, simplifying Components/Resources, and proving the exact shipped build on a real router and in a real browser.

**Architecture:** Keep Z2K Core, Asset Registry, Resource Center, receipt-v3, exact release/source/runtime/compiler/catalog/Detect identity, LKG rollback, and autocircular semantic identity as the existing mutation authorities. Make upstream `z2k-detect` the only production DPI measurement authority end-to-end. LuCI remains a typed projection of backend truth; after every terminal mutation it re-reads canonical Core state. Delete old native Scanner code only after explicit call-graph and package proof.

**Tech Stack:** OpenWrt/procd; ucode; C11 native helper/helperd; LuCI JavaScript; Node.js `node:test`; Asset Registry; Resource Center; upstream `z2k-detect`; GitHub Actions/OpenWrt SDK single-APK release pipeline.

**Spec:** `docs/superpowers/specs/2026-09-08-z2k-recovery-design.md`

**Reviewed baseline:** `main` at `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`. Task 1 must refresh Git truth and audit any later drift before production edits.

## Global Constraints

- Scope is only fix, simplify, remove, or verify. Do not add a new product subsystem, lifecycle owner, Scanner concept, page, or compatibility layer.
- Preserve `r-*` and `p-*` support, coherent candidate identity, receipt-v3 installed authority, exact architecture-specific Detect binding, atomic/LKG transaction structure, Core-managed official Z2K strategies, current upstream Lua membership, and autocircular semantic-pool identity.
- Upstream `z2k-detect` is the sole production authority for `probe`, `classify`, `quic`, `voice`, `tcp16`, and long-running `run` discovery.
- Browser/RPC callers never select executables, argv, shell commands, environment variables, cwd, or arbitrary filesystem paths.
- Detect browser/RPC/native contracts are exact-field typed contracts; unexpected fields fail closed.
- `z2k-detect run` remains procd-owned. One-shot RPCs never own a long-lived Detect child.
- Components has exactly one normal-flow Z2K Core product surface. Runtime/manifest/compiler/Registry evidence is hidden under subordinate technical details.
- Resources presents Z2K as Core-managed inventory/provenance. It has no independent Z2K mutation path. Avatar stays independently refreshable.
- `repair` is same-release recovery through the existing coherent transaction path; do not add a second repair lifecycle.
- Failure before activation leaves LKG untouched. Failure after mutation begins reports initiating failure and rollback result separately and restores physical owned state.
- Remove old native Scanner code only after Task 10 proves its exclusive callers. Keep `scanner-runtime-adapter.sh` when a non-Scanner production caller still uses it.
- Product tests assert behavior and typed boundaries, not implementation phrases such as `Действие Detect`.
- Any task changing Components, Resources, Scanner, discovery controls, RPC wiring, or lifecycle progress is not `VERIFIED` until the deployed LuCI page is loaded against the current build and the relevant state/transition is observed.
- The durable ledger uses only the literal states `TODO`, `WORKING`, `VERIFIED`, `BLOCKED_USER`.
- Engineering difficulty, failed tests, refactoring, missing implementation, broken build tooling, router regressions, and review findings remain `WORKING`.
- For a real user-only blocker, write the exact field names `REQUIRED_USER_INPUT` and `WHY_ONLY_USER_CAN_PROVIDE_IT`, each with a non-empty concrete value, immediately followed by `[goal:blocked]`.
- Execute in an isolated worktree created with `superpowers:using-git-worktrees`. Do not reset/stash/overwrite unrelated concurrent work.
- Every code bug/removal uses TDD: prove RED or capture the current failing product behavior, make the smallest production change, prove GREEN, then commit.
- Every slice writes evidence under `.superpowers/sdd/2026-09-08-z2k-recovery/` and ends with `git diff --check`.
- Documentation edits also run `node scripts/validate-knowledge.mjs` and `node scripts/docs.mjs verify`.
- No automatic final merge. Task 17 stops after final evidence and asks the user for an explicit merge decision.

---

## File Structure

### Recovery evidence created during execution

- `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md` — Tasks 1-17 state/evidence table.
- `.superpowers/sdd/2026-09-08-z2k-recovery/baseline.md` — exact Git/test/router/browser baseline and drift audit.
- `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json` — before/after size and production-file measurements.
- `.superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md` — native Scanner keep/remove proof.
- `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md` — final automated/router/browser/review evidence.
- `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json` — bounded machine-readable final runtime identities.

### Backend owners retained

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`

### Detect RPC/native boundary

- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/detect-result.uc`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- `zapret2-manager/src/z2m-core-helper/protocol.c`
- `zapret2-manager/src/z2m-core-helper/main.c`
- `zapret2-manager/src/z2m-core-helper/helper.h`
- `zapret2-manager/src/z2m-core-helper/scanner.c` — current mixed legacy Scanner + Detect implementation; removal target.
- `zapret2-manager/src/z2m-core-helper/detect.c` — new focused file for the five retained Detect operations.
- `zapret2-manager/Makefile`
- `zapret2-manager-full/Makefile`

### LuCI product surfaces

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`

### New focused recovery tests

- `tests/product/z2k-detect-discovery-rpc-boundary.test.mjs`
- `tests/product/z2k-detect-rpc-boundary.test.mjs`
- `tests/ui/scanner-command-forms.test.mjs`
- `tests/ui/z2k-core-single-surface.test.mjs`
- `tests/ui/z2k-resources-managed-state.test.mjs`
- `tests/ui/z2k-lifecycle-browser-state.test.mjs`
- `tests/product/z2k-old-scanner-removal-closure.test.mjs`

---

## Phase A — Freeze truth and repair the P0 boundary

### Task 1: Establish the recovery ledger, drift audit, and size baseline

**Files:**
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md`
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/baseline.md`
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json`

**Interfaces:**
- Consumes: approved spec and execution worktree.
- Produces: baseline SHA, drift classification, baseline test results, and before-size values used by Task 15.

- [ ] **Step 1: Create the ledger exactly**

```markdown
| Task | State | Evidence |
| --- | --- | --- |
| 1 | WORKING | baseline capture in progress |
| 2 | TODO | |
| 3 | TODO | |
| 4 | TODO | |
| 5 | TODO | |
| 6 | TODO | |
| 7 | TODO | |
| 8 | TODO | |
| 9 | TODO | |
| 10 | TODO | |
| 11 | TODO | |
| 12 | TODO | |
| 13 | TODO | |
| 14 | TODO | |
| 15 | TODO | |
| 16 | TODO | |
| 17 | TODO | |
```

- [ ] **Step 2: Capture Git truth and reviewed-baseline drift**

```bash
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -10 --oneline --decorate
git worktree list
git diff --name-status 9a4f0feeacbfd9d107385ffeffb5007b4bfadb39..HEAD
```

If `HEAD` differs from the reviewed baseline, classify each overlapping changed path in `baseline.md`. Ordinary drift remains engineering work.

- [ ] **Step 3: Capture focused baseline tests before production edits**

```bash
export UCODE_BIN=${UCODE_BIN:-/opt/ucode/bin/ucode}
export LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-/opt/ucode/lib}
node --test \
  tests/product/z2k-detect-rpc.test.mjs \
  tests/product/z2k-detect-discovery-service.test.mjs \
  tests/product/z2k-coherent-transaction.test.mjs \
  tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs \
  tests/native/z2k-detect-helper.test.mjs \
  tests/native/core/fs-helper-protocol.test.mjs \
  tests/ui/scanner-ui-rework.test.mjs \
  tests/ui/scanner-detect-api-boundary.test.mjs \
  tests/ui/system-components-details-presentation.test.mjs \
  tests/product/z2m-resources-model.test.mjs
```

Record exact pass/fail/skip counts. Missing host `ucode` is re-run in canonical WSL; it is not a product PASS.

- [ ] **Step 4: Capture source/file-count baseline**

```bash
wc -c zapret2-manager/src/z2m-core-helper/scanner.c \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
find zapret2-manager/files luci-app-zapret2-manager/files -type f | sort | wc -l
```

- [ ] **Step 5: Capture an APK baseline tied to the exact execution SHA**

If the rolling `main-latest` artifact targets another SHA, build the execution baseline before code edits with `scripts/release/build-apk.sh`. Record the APK filename, SHA-256, bytes, and baseline native helper bytes extracted from that APK.

- [ ] **Step 6: Commit evidence**

```bash
git diff --check
git add .superpowers/sdd/2026-09-08-z2k-recovery/ledger.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/baseline.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json
git commit -m "docs: record Z2K recovery baseline"
```

### Task 2: Repair discovery `dnsSource` across rpcd, ubus, LuCI, and procd

**Files:**
- Create: `tests/product/z2k-detect-discovery-rpc-boundary.test.mjs`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `tests/product/z2k-detect-discovery-service.test.mjs`
- Modify: `tests/ui/scanner-ui-rework.test.mjs`

**Interfaces:** `dnsSource` is one string in `{auto,agh,dnsmasq,pkt}` for enable/disable/restart.

- [ ] **Step 1: Write the failing registration/handler test**

Assert the three registrations equal the block implemented in Step 3 and that `req.args.dnsSource = 'agh'` reaches `z2k_detect_discovery_control()` as `agh`.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
```

Expected: FAIL because current discovery control registrations omit the `dnsSource` argument.

- [ ] **Step 3: Fix the rpcd registrations exactly**

```ucode
z2k_detect_discovery_status: { call: function(req) { return z2k_detect_discovery_status_method(req); } },
z2k_detect_discovery_enable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_enable_method(req); } },
z2k_detect_discovery_disable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_disable_method(req); } },
z2k_detect_discovery_restart: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_restart_method(req); } },
```

Keep the existing positional LuCI calls `z2kDetectDiscoveryEnable(source)`, `Disable(source)`, and `Restart(source)`.

- [ ] **Step 4: Prove GREEN**

```bash
node --test \
  tests/product/z2k-detect-discovery-rpc-boundary.test.mjs \
  tests/product/z2k-detect-discovery-service.test.mjs \
  tests/ui/scanner-ui-rework.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
git diff --check
```

- [ ] **Step 5: Deploy and prove real ubus/browser wiring**

```sh
ubus -v list zapret2-manager | sed -n '/z2k_detect_discovery_status/,/z2k_detect_probe/p'
ubus -S call zapret2-manager z2k_detect_discovery_enable '{"dnsSource":"auto"}'
ubus -S call zapret2-manager z2k_detect_discovery_status '{}'
ubus -S call zapret2-manager z2k_detect_discovery_restart '{"dnsSource":"dnsmasq"}'
ubus -S call zapret2-manager z2k_detect_discovery_disable '{"dnsSource":"dnsmasq"}'
```

In real LuCI capture the same Network payloads and restore the intended discovery state.

- [ ] **Step 6: Commit**

```bash
git add tests/product/z2k-detect-discovery-rpc-boundary.test.mjs \
        tests/product/z2k-detect-discovery-service.test.mjs tests/ui/scanner-ui-rework.test.mjs \
        zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "fix: restore typed Z2K discovery controls"
```

### Task 3: Make every one-shot Detect RPC an exact-field contract

**Files:**
- Create: `tests/product/z2k-detect-rpc-boundary.test.mjs`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `tests/product/z2k-detect-rpc.test.mjs`
- Modify: `tests/ui/scanner-detect-api-boundary.test.mjs`

**Interfaces:**
- `probe(domain, timeoutMs)`
- `classify(host, port, hello, repeats, timeoutMs)`
- `quic(domain, port, repeats, timeoutMs)`
- `voice(repeats, timeoutMs)`
- `tcp16(timeoutMs)`

- [ ] **Step 1: Write strict RED tests**

```js
assert.equal(call('probe', { domain: 'example.com', timeoutMs: 6000, argv: ['sh'] }).error.code, 'EINPUT');
assert.equal(call('voice', { domain: 'example.com', repeats: 2, timeoutMs: 6000 }).error.code, 'EINPUT');
assert.equal(call('tcp16', { port: 443, timeoutMs: 6000 }).error.code, 'EINPUT');
```

Valid exact requests must still call the matching `z2k_detect_*` function.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/product/z2k-detect-rpc-boundary.test.mjs
```

Expected: extra-field cases fail because current `z2k_detect_input(req)` forwards the whole args object.

- [ ] **Step 3: Add one local exact-field normalizer**

```ucode
function z2k_detect_rpc_input(req, names) {
	let input = req && req.args != null ? req.args : req;
	if (type(input) != 'object' || input == null || length(input) != length(names))
		return { ok: false, error: { code: 'EINPUT', message: 'Detect request fields are invalid.' } };
	for (let name in names)
		if (!exists(input, name))
			return { ok: false, error: { code: 'EINPUT', message: 'Detect request fields are invalid.' } };
	return { ok: true, input };
}
```

Each handler supplies its exact field list. Existing Detect range/hostname/hello/result-schema validation remains authoritative.

- [ ] **Step 4: Keep LuCI exact**

`z2m-api.js` exposes only the five positional methods above; do not add a generic `detect(operation,args)` API.

- [ ] **Step 5: Prove GREEN and commit**

```bash
node --test \
  tests/product/z2k-detect-rpc-boundary.test.mjs tests/product/z2k-detect-rpc.test.mjs \
  tests/ui/scanner-detect-api-boundary.test.mjs tests/native/z2k-detect-helper.test.mjs
git diff --check
git add tests/product/z2k-detect-rpc-boundary.test.mjs tests/product/z2k-detect-rpc.test.mjs \
        tests/ui/scanner-detect-api-boundary.test.mjs \
        zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
git commit -m "fix: enforce exact Z2K Detect RPC contracts"
```

---

## Phase B — Replace the retired Scanner product model

### Task 4: Replace generic Scanner request state with command-specific Detect state

**Files:**
- Create: `tests/ui/scanner-command-forms.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `tests/ui/scanner-ui-rework.test.mjs`

**Interfaces:** one descriptor map in the existing Scanner file; no new Scanner module/subsystem.

- [ ] **Step 1: Write RED form-model tests**

```js
assert.deepEqual(scanner.detectFields('probe'), ['domain', 'timeoutMs']);
assert.deepEqual(scanner.detectFields('classify'), ['host', 'port', 'hello', 'repeats', 'timeoutMs']);
assert.deepEqual(scanner.detectFields('quic'), ['domain', 'port', 'repeats', 'timeoutMs']);
assert.deepEqual(scanner.detectFields('voice'), ['repeats', 'timeoutMs']);
assert.deepEqual(scanner.detectFields('tcp16'), ['timeoutMs']);
```

Also assert production state contains no shared `protocol`, `mode`, `quick`, `standard`, or `full` semantics.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
```

Expected: FAIL because current request state is `{target,operation,protocol,mode}`.

- [ ] **Step 3: Replace state with explicit descriptors**

```js
var DETECT_FORMS = {
  probe:    { label: _('Проверка сайта'), fields: ['domain', 'timeoutMs'], defaults: { domain: 'youtube.com', timeoutMs: 6000 } },
  classify: { label: _('Анализ DPI'), fields: ['host', 'port', 'hello', 'repeats', 'timeoutMs'], defaults: { host: 'youtube.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000 } },
  quic:     { label: _('QUIC'), fields: ['domain', 'port', 'repeats', 'timeoutMs'], defaults: { domain: 'youtube.com', port: 443, repeats: 2, timeoutMs: 6000 } },
  voice:    { label: _('Discord Voice'), fields: ['repeats', 'timeoutMs'], defaults: { repeats: 2, timeoutMs: 6000 } },
  tcp16:    { label: _('TCP16'), fields: ['timeoutMs'], defaults: { timeoutMs: 6000 } }
};
function detectFields(operation) { return DETECT_FORMS[operation].fields.slice(); }
```

Remove helpers used only to derive repeats/timeouts from `quick/standard/full` or infer QUIC from a global protocol selector.

- [ ] **Step 4: Make invocation exact**

Voice never synthesizes a domain. TCP16 never synthesizes host/port/repeats. Classify/QUIC retain explicit port/repeats.

- [ ] **Step 5: Prove GREEN and commit**

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
wc -c luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
git diff --check
git add tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
git commit -m "refactor: model Scanner as explicit Detect operations"
```

### Task 5: Render five explicit Scanner operations and canonical results

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/scanner-command-forms.test.mjs`
- Modify: `tests/ui/scanner-detect-history.test.mjs`
- Modify: `tests/ui/scanner-detect-api-boundary.test.mjs`

**Interfaces:** route stays `Scanner`; history stays typed `z2m-detect-history.v1` only.

- [ ] **Step 1: Add RED user-outcome assertions**

Visible operation labels are exactly `Проверка сайта`, `Анализ DPI`, `QUIC`, `Discord Voice`, `TCP16`. Assert no `Действие Detect`, shared TCP/UDP selector, or `Быстро/Обычно/Тщательно`. Assert Voice has no domain input and TCP16 has no host/port input.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
```

- [ ] **Step 3: Render operation-specific forms**

Use the Task 4 descriptor fields and existing bounded hostname/numeric validation. Voice copy states that a live Discord voice/video call is required. `EDETECT_NO_ACTIVE_VOICE` renders `Подключитесь к голосовому каналу Discord и повторите проверку.` and does not block unrelated recovery work.

- [ ] **Step 4: Preserve typed results/history**

History request data becomes operation-specific and does not persist retired `protocol`/`mode`. Continue rejecting legacy-shaped history. Keep canonical raw technical JSON only under the existing details affordance.

- [ ] **Step 5: Prove GREEN**

```bash
node --test \
  tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs \
  tests/ui/scanner-detect-history.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js
git diff --check
```

- [ ] **Step 6: Real browser gate**

Deploy current files, hard reload Scanner with cache disabled, capture all five forms, execute a real `probe`, and execute Voice with no live call to prove the specific no-call state.

- [ ] **Step 7: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-detect-history.test.mjs \
        tests/ui/scanner-detect-api-boundary.test.mjs .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "feat: make Scanner a thin Z2K Detect UI"
```

### Task 6: Make automatic discovery a compact truthful control block

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/scanner-ui-rework.test.mjs`
- Modify: `tests/product/z2k-detect-discovery-service.test.mjs`

**Interfaces:** consumes Task 2 `dnsSource` and canonical status `{schema,enabled,running,dnsSource,discoveredDomains}`.

- [ ] **Step 1: Add RED states**

Cover `disabled`, `enabled+running`, `enabled+not-running`, `changing`, and canonical error. Require DNS source, discovered count, mtime when present, and one concise action.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-detect-discovery-service.test.mjs
```

- [ ] **Step 3: Render backend truth**

Never infer `running` from `enabled`. Source selector is only `auto`, `agh`, `dnsmasq`, `pkt`.

- [ ] **Step 4: Prove GREEN and browser lifecycle**

In real LuCI prove `disabled -> enable(auto) -> running -> restart(dnsmasq) -> validated new process state -> disable -> stopped`. Capture browser payloads plus:

```sh
ubus call service list '{"name":"zapret2-manager"}'
```

Prove discovered-domain count survives restart/disable.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-detect-discovery-service.test.mjs \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "fix: simplify Z2K discovery product state"
```

---

## Phase C — Collapse duplicate Z2K product surfaces

### Task 7: Define one canonical Components projection for Z2K Core

**Files:**
- Create: `tests/ui/z2k-core-single-surface.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- Modify: `tests/ui/system-components-model.test.mjs`
- Modify: `tests/ui/system-components-z2k-truth-lifecycle.test.mjs`

**Interfaces:** one component model with installed/available release, runtime health, Detect status/arch, strategy summary, discovery, compatibility, lifecycle action, and technical evidence.

- [ ] **Step 1: Add RED state-model tests**

Require distinct states `missing`, `ready`, `update-available`, `degraded`, `broken`, `working`, `rollback-result`. No state projects `Работает` when receipt/runtime/Detect coherence is false.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-model.test.mjs tests/ui/system-components-z2k-truth-lifecycle.test.mjs
```

- [ ] **Step 3: Separate user facts from technical evidence**

```js
facts: {
  strategies: { label, count },
  detect: { status, arch },
  runtime: { luaReady, luaTotal, listsReady, blobsReady },
  discovery: { enabled, running },
  compatibility: { synchronized }
},
technical: {
  sourceCommit,
  manifestSeq,
  manifestSha256,
  runtimeBundleDigest,
  compilerInputsDigest,
  catalogDigest,
  compatibilityIdentity,
  detectSha256,
  dependencyClosure,
  provenance
}
```

These are projections only; JavaScript never derives a second compatibility identity.

- [ ] **Step 4: Prove GREEN and commit**

```bash
node --test tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-model.test.mjs tests/ui/system-components-z2k-truth-lifecycle.test.mjs
git diff --check
git add tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-model.test.mjs \
        tests/ui/system-components-z2k-truth-lifecycle.test.mjs \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js
git commit -m "refactor: define one Z2K Core component projection"
```

### Task 8: Remove the duplicate Components Z2K dashboard

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/z2k-core-single-surface.test.mjs`
- Modify: `tests/ui/system-components-details-presentation.test.mjs`
- Modify: `tests/ui/z2k-compiled-dependency-summary.test.mjs`
- Modify: `tests/ui/components-resources-corrective-pass.test.mjs`

**Interfaces:** exactly one normal-flow `.z2m-component-card--z2k`; subordinate `Подробнее -> Технические детали` retains diagnostics.

- [ ] **Step 1: Add RED structure tests**

```js
assert.equal(countZ2KProductSurfaces(rendered), 1);
assert.equal(text.includes('УПРАВЛЕНИЕ РЕСУРСАМИ'), false);
assert.equal(primaryText.includes('runtimeBundleDigest'), false);
assert.equal(technicalDetailsText.includes('compatibilityIdentity'), true);
```

Replace assertions that require `Runtime bundle39` or the second dashboard in normal flow.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-details-presentation.test.mjs tests/ui/z2k-compiled-dependency-summary.test.mjs
```

- [ ] **Step 3: Collapse rendering**

Card hierarchy is status/version, Strategy/Detect/Runtime/Discovery/Compatibility facts, lifecycle action, `Подробнее`, then nested technical evidence. Delete the second normal-flow management section.

- [ ] **Step 4: Remove CSS only used by deleted hierarchy**

Use source/test grep to prove no remaining selector consumer. Do not redesign unrelated pages.

- [ ] **Step 5: Prove GREEN and browser hierarchy**

```bash
node --test \
  tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-details-presentation.test.mjs \
  tests/ui/z2k-compiled-dependency-summary.test.mjs tests/ui/components-resources-corrective-pass.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
git diff --check
```

Deploy/hard reload Components and capture a healthy Core showing one product card and one subordinate details expansion.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-details-presentation.test.mjs \
        tests/ui/z2k-compiled-dependency-summary.test.mjs tests/ui/components-resources-corrective-pass.test.mjs \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "refactor: collapse Components to one Z2K Core surface"
```

### Task 9: Make Resources managed Z2K inventory only

**Files:**
- Create: `tests/ui/z2k-resources-managed-state.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- Modify: `tests/product/z2m-resources-model.test.mjs`
- Modify: `tests/ui/components-resources-corrective-pass.test.mjs`
- Modify: `tests/product/resource-center-transaction.test.mjs`

**Interfaces:** Z2K renders `Управляется Z2K Core`; direct refresh remains `EMANAGED`; bulk update excludes Z2K but retains Avatar.

- [ ] **Step 1: Add RED ownership tests**

Assert no Z2K row/group has a write/update control. Assert bulk-update candidate selection excludes Z2K and includes an independently stale Avatar fixture.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/z2k-resources-managed-state.test.mjs tests/product/z2m-resources-model.test.mjs tests/product/resource-center-transaction.test.mjs
```

- [ ] **Step 3: Simplify projection**

Render Z2K release, official strategy/resource identity, provenance/details, and `Управляется Z2K Core`. No Components lifecycle button is duplicated here.

- [ ] **Step 4: Prove backend ownership**

Assert independent Z2K refresh returns exactly an `EMANAGED` error whose owner is `z2k-core`; Avatar independent refresh stays available.

- [ ] **Step 5: Prove GREEN and real browser state**

Run focused suites, deploy, hard reload Resources, and capture Z2K managed-by-Core plus Avatar independent ownership. Use browser Network evidence to prove opening/checking Resources sends no independent Z2K mutation.

- [ ] **Step 6: Commit**

```bash
git add tests/ui/z2k-resources-managed-state.test.mjs tests/product/z2m-resources-model.test.mjs \
        tests/ui/components-resources-corrective-pass.test.mjs tests/product/resource-center-transaction.test.mjs \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "refactor: make Z2K resources Core-managed only"
```

---

## Phase D — Prove and delete remaining old Scanner authority

### Task 10: Build the native Scanner call graph and lock the removal boundary

**Files:**
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md`
- Create: `tests/product/z2k-old-scanner-removal-closure.test.mjs`
- Modify: `tests/product/z2k-old-scanner-unwired.test.mjs`

**Interfaces:** exact `KEEP_SHARED` and `REMOVE_LEGACY` set for Task 11.

- [ ] **Step 1: Enumerate production references**

```bash
git grep -nE 'scanner_probe|z2m_scanner_probe|scanner\.c|scanner-runtime-adapter\.sh|scanner-transient|quick|standard|full' -- \
  ':(exclude)docs/**' ':(exclude).superpowers/**' ':(exclude)tests/**'
```

Classify every hit as `legacy-scanner-exclusive`, `detect-required`, `shared-non-scanner`, or `dead-reference` with caller/owner evidence.

- [ ] **Step 2: Prove shared adapter ownership**

Trace `scanner-runtime-adapter.sh`, including `profiles-apply.uc`. A non-Scanner production caller makes it `KEEP_SHARED`; Task 11 must not remove/rename it.

- [ ] **Step 3: Write the RED closure test**

Post-recovery requirements are: no `scanner_probe` operation in `protocol-v1.json`, no `z2m_scanner_probe`, no `scanner.c` compilation, no `native-helper.uc` scanner success-shape branch, and all five `z2k_detect_*` operations present.

- [ ] **Step 4: Prove RED**

```bash
node --test tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Expected: FAIL only on identified legacy native Scanner remnants.

- [ ] **Step 5: Commit proof/test**

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md \
        tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
git commit -m "test: lock old Scanner removal boundary"
```

### Task 11: Extract native Detect operations and delete legacy `scanner_probe`

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/detect.c`
- Remove: `zapret2-manager/src/z2m-core-helper/scanner.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Modify: `zapret2-manager/src/z2m-core-helper/main.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- Modify: `zapret2-manager/Makefile`
- Modify: `zapret2-manager-full/Makefile`
- Modify: `tests/native/z2k-detect-helper.test.mjs`
- Modify: `tests/native/package-helper.test.mjs`
- Modify: `tests/native/core/fs-helper-protocol.test.mjs`
- Modify: `tests/product/z2k-old-scanner-removal-closure.test.mjs`

**Interfaces:** retain exactly `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`; remove `scanner_probe` and exclusive profile/TLS/body/STUN logic.

- [ ] **Step 1: Move only retained Detect execution into `detect.c`**

Preserve fixed executable `/usr/libexec/zapret2-manager/z2k-detect`, bounded timeout/output, safe argv construction, canonical result envelope, and current supervision. Do not move legacy profile/body/STUN code.

- [ ] **Step 2: Delete the legacy protocol surface**

Remove `scanner_probe` from `protocol-v1.json`, `protocol.c`, `main.c`, `helper.h`, and `core/native-helper.uc`.

- [ ] **Step 3: Switch both package builds to `detect.c`**

Update `zapret2-manager/Makefile`, `zapret2-manager-full/Makefile`, and native test compile lists. Delete assertions requiring `scanner.c`.

- [ ] **Step 4: Prove native GREEN**

```bash
export UCODE_BIN=${UCODE_BIN:-/opt/ucode/bin/ucode}
export LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-/opt/ucode/lib}
node --test \
  tests/native/z2k-detect-helper.test.mjs tests/native/package-helper.test.mjs \
  tests/native/core/fs-helper-protocol.test.mjs tests/product/z2k-old-scanner-removal-closure.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs
! git grep -nE 'scanner_probe|z2m_scanner_probe' -- \
  'zapret2-manager/src/**' 'zapret2-manager/files/**' 'luci-app-zapret2-manager/files/**'
git diff --check
```

- [ ] **Step 5: Run package/native compile gates**

Compile through the repository's existing native helper test path and run the single-APK contract. `-Wall -Wextra -Werror` must remain clean.

- [ ] **Step 6: Deploy and prove runtime absence**

On router prove old Scanner RPC/protocol is absent and all five typed Detect operations still execute.

- [ ] **Step 7: Commit**

```bash
git add zapret2-manager/src/z2m-core-helper/detect.c zapret2-manager/src/z2m-core-helper/helper.h \
        zapret2-manager/src/z2m-core-helper/main.c zapret2-manager/src/z2m-core-helper/protocol.c \
        zapret2-manager/src/z2m-core-helper/protocol-v1.json \
        zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc \
        zapret2-manager/Makefile zapret2-manager-full/Makefile \
        tests/native/z2k-detect-helper.test.mjs tests/native/package-helper.test.mjs \
        tests/native/core/fs-helper-protocol.test.mjs tests/product/z2k-old-scanner-removal-closure.test.mjs \
        .superpowers/sdd/2026-09-08-z2k-recovery
git rm zapret2-manager/src/z2m-core-helper/scanner.c
git commit -m "refactor: remove legacy native Scanner authority"
```

---

## Phase E — Close Core lifecycle and browser recovery semantics

### Task 12: Make failure/rollback results explicit and same-release repair canonical

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Modify: `tests/product/z2k-coherent-transaction.test.mjs`
- Modify: `tests/product/z2k-update-transaction.test.mjs`
- Modify: `tests/product/z2k-detect-artifact.test.mjs`
- Modify: `tests/product/z2k-receipt-v3.test.mjs`
- Modify: `tests/product/z2k-target-lifecycle-contract.test.mjs`

**Interfaces:** initiating failure and rollback evidence are separate; repair resolves installed release and reuses coherent reinstall transaction.

- [ ] **Step 1: Add RED post-activation rollback result test**

Use concrete fixture values:

```js
const expected = {
  ok: false,
  error: { code: 'EPOSTFLIGHT', message: 'postflight failed' },
  rollback: {
    attempted: true,
    ok: true,
    restored: {
      release: 'p-82.18',
      runtimeBundleDigest: 'a'.repeat(64),
      detectSha256: 'b'.repeat(64),
      catalogDigest: 'c'.repeat(64),
      strategyIdentity: 'd'.repeat(64)
    }
  }
};
```

Pre-commit failure must return `rollback.attempted === false` and prove original LKG was never mutated.

- [ ] **Step 2: Add same-release repair test**

Installed `p-82.18` plus repair request must prepare `p-82.18`, not latest, and pass receipt-v3, Detect, compiler/catalog, dependency-closure, and active-strategy checks.

- [ ] **Step 3: Prove RED**

```bash
node --test \
  tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-target-lifecycle-contract.test.mjs
```

- [ ] **Step 4: Change only the existing coordinator/result contract**

Keep current pending-activation recovery and rollback owners. Add bounded rollback evidence and same-release repair resolution; do not create another lifecycle module.

- [ ] **Step 5: Prove physical rollback identity**

Tests compare before/after receipt, runtime digest, Detect bytes/digest, catalog digest, and selected strategy identity for pre-commit and post-activation injected failures.

- [ ] **Step 6: Prove GREEN and commit**

Run the same suites, `git diff --check`, then commit only the files above with message `fix: expose complete Z2K rollback outcomes`.

### Task 13: Rebuild Components lifecycle UX around canonical re-read

**Files:**
- Create: `tests/ui/z2k-lifecycle-browser-state.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `tests/ui/system-components-details-presentation.test.mjs`
- Modify: `tests/ui/z2k-version-ux-behavior.test.mjs`
- Modify: `tests/ui/z2k-frontend-canonical-update-contract.test.mjs`

**Interfaces:** check/install/upgrade/reinstall/repair/downgrade; terminal UI always refreshes canonical Core state and renders rollback separately.

- [ ] **Step 1: Add RED browser-state transitions**

```text
idle -> accepted operationId -> polling -> success -> canonical reload
idle -> accepted operationId -> failure + rollback success -> canonical reload
page reload while active -> resume from backend operation status
browser revisit after completion -> reconstruct from backend state only
```

Assert no endless spinner and no stale selected release after terminal refresh.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/z2k-lifecycle-browser-state.test.mjs tests/ui/z2k-version-ux-behavior.test.mjs tests/ui/system-components-details-presentation.test.mjs
```

- [ ] **Step 3: Keep transient operation state non-authoritative**

`operationId/phase` may drive polling. On terminal result, always call the existing Core load/check path and render installed/available state from the response. Never synthesize installed state from selected target.

- [ ] **Step 4: Render repair/rollback explicitly**

Broken Core shows `Восстановить`. Failed mutation plus successful rollback says previous version was restored. Failed/uncertain rollback is a distinct high-severity state, not generic network/session copy.

- [ ] **Step 5: Prove GREEN**

Run the new suite plus existing version/Components suites and JS syntax checks.

- [ ] **Step 6: Real browser mutation gate**

Deploy. Perform a same-release reinstall/repair, observe progress, hard reload while or immediately after the operation, and prove final card state comes from receipt/runtime truth. Inject a controlled preflight failure and prove spinner/selection settles correctly.

- [ ] **Step 7: Commit**

Commit the files above plus evidence with message `fix: recover canonical Z2K lifecycle browser state`.

---

## Phase F — Documentation/projection cleanup and reduction

### Task 14: Remove stale current Scanner/Z2K documentation and projection references

**Files:**
- Modify: `docs/03-products/scanner/index.md`
- Modify: `docs/03-products/scanner-runtime.md`
- Modify: `docs/02-architecture/scanner-runtime-authority.md`
- Modify: `docs/03-products/components.md`
- Modify: `docs/03-products/resources.md`
- Modify: `docs/03-products/z2k-core.md`
- Modify: `docs/00-home/current-state.md`
- Modify: `scripts/public-projection.mjs`
- Modify: `router-deploy-runtime-composition.manifest`
- Modify: affected `tests/knowledge/*.test.mjs`

**Interfaces:** current/public docs describe five explicit Detect operations, one Components surface, Core-managed Resources, and no native Scanner authority.

- [ ] **Step 1: Find stale current claims**

```bash
git grep -nE 'Действие Detect|quick|standard|full|candidate|scanner_probe|scanner\.c|УПРАВЛЕНИЕ РЕСУРСАМИ' -- docs scripts router-deploy-runtime-composition.manifest
```

Archive/history references remain historical; current/normative/public claims must match recovered behavior.

- [ ] **Step 2: Update docs/projection**

Scanner evidence points to `z2k-detect.uc`, typed RPC, and focused native Detect helper. Remove current candidate-scanning/Strategy-handoff claims. Components/Resources docs state single-surface/Core-managed ownership.

- [ ] **Step 3: Update deployment closure**

Remove deleted runtime references. Keep shared `scanner-runtime-adapter.sh` when Task 10 classified it `KEEP_SHARED`. `detect.c` is build source, not router runtime manifest content.

- [ ] **Step 4: Run documentation gates**

```bash
node --test tests/knowledge/public-projection.test.mjs tests/knowledge/validator.test.mjs tests/knowledge/docs-cli.test.mjs
node scripts/validate-knowledge.mjs
node scripts/docs.mjs verify
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add docs scripts/public-projection.mjs router-deploy-runtime-composition.manifest tests/knowledge \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "docs: align product knowledge with Z2K recovery"
```

### Task 15: Perform the mandatory size/complexity reduction pass

**Files:**
- Modify only files whose dead callers are proven by Tasks 10-14.
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json`
- Modify affected tests when a deleted internal seam had test-only references.

**Interfaces:** final APK bytes must be less than or equal to baseline; preferred native helper/JS/UCode/file-count values decrease.

- [ ] **Step 1: Produce a dead-code candidate list**

Search and record callers for retired Scanner CSS/state helpers, unused RPCs, removed native protocol helpers, duplicate Components helpers, and obsolete compatibility branches. Byte count alone is not deletion authority.

- [ ] **Step 2: Delete only proven dead code**

Never weaken rollback, receipt validation, Detect schemas, diagnostics, or required migration compatibility.

- [ ] **Step 3: Re-run affected focused suites after each deletion batch**

Scanner, Components, Resources, native helper, lifecycle, package, and knowledge suites touched by a batch must be green before the next batch.

- [ ] **Step 4: Build current APK and update measured `after` values**

```bash
APK=$(find dist -maxdepth 1 -type f -name 'zapret2-manager-full-*.apk' -print | sort | head -n 1)
test -n "$APK"
rm -rf /tmp/z2m-recovery-size-after
mkdir -p /tmp/z2m-recovery-size-after
apk extract --allow-untrusted --no-chown --destination /tmp/z2m-recovery-size-after "$APK"
APK_BYTES=$(stat -c '%s' "$APK")
APK_SHA=$(sha256sum "$APK" | awk '{print $1}')
NATIVE_BYTES=$(stat -c '%s' /tmp/z2m-recovery-size-after/usr/libexec/zapret2-manager/z2m-core-helper)
SCANNER_JS_BYTES=$(stat -c '%s' luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js)
MAINTENANCE_JS_BYTES=$(stat -c '%s' luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js)
ASSETS_JS_BYTES=$(stat -c '%s' luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js)
PRODUCTION_FILE_COUNT=$(find zapret2-manager/files luci-app-zapret2-manager/files -type f | wc -l)
jq --argjson apkBytes "$APK_BYTES" --arg apkSha256 "$APK_SHA" \
   --argjson nativeHelperBytes "$NATIVE_BYTES" --argjson scannerJsBytes "$SCANNER_JS_BYTES" \
   --argjson maintenanceJsBytes "$MAINTENANCE_JS_BYTES" --argjson assetsJsBytes "$ASSETS_JS_BYTES" \
   --argjson productionFileCount "$PRODUCTION_FILE_COUNT" \
   '.after={apkBytes:$apkBytes,apkSha256:$apkSha256,nativeHelperBytes:$nativeHelperBytes,scannerJsBytes:$scannerJsBytes,maintenanceJsBytes:$maintenanceJsBytes,assetsJsBytes:$assetsJsBytes,productionFileCount:$productionFileCount}' \
   .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json > /tmp/z2m-size.json
mv /tmp/z2m-size.json .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json
```

- [ ] **Step 5: Enforce the hard budget**

Read `before.apkBytes` and `after.apkBytes`; if after is larger, keep Task 15 `WORKING` and continue evidence-backed reduction without weakening required behavior.

- [ ] **Step 6: Commit**

```bash
git add -u
git add .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json
git diff --check
git commit -m "refactor: reduce recovered Z2K production surface"
```

---

## Phase G — Full verification, artifact proof, live acceptance, review

### Task 16: Run the full harness and produce a fresh CI-backed single APK

**Files:**
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json`

**Interfaces:** exact candidate SHA/artifact for Task 17. Any later code change invalidates Task 16.

- [ ] **Step 1: Run all focused recovery suites together**

```bash
export UCODE_BIN=${UCODE_BIN:-/opt/ucode/bin/ucode}
export LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-/opt/ucode/lib}
node --test \
  tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-rpc-boundary.test.mjs \
  tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-discovery-service.test.mjs \
  tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-target-lifecycle-contract.test.mjs tests/product/z2k-old-scanner-removal-closure.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs tests/native/z2k-detect-helper.test.mjs \
  tests/native/package-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs \
  tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs \
  tests/ui/scanner-detect-history.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs \
  tests/ui/z2k-core-single-surface.test.mjs tests/ui/z2k-resources-managed-state.test.mjs \
  tests/ui/z2k-lifecycle-browser-state.test.mjs
```

Expected: zero failures and zero unexplained skips.

- [ ] **Step 2: Run repository-wide Node tests in canonical environment**

```bash
find tests -name '*.test.mjs' -print0 | sort -z | xargs -0 node --test
```

Aggregate every invocation exit code/count. Any product failure remains `WORKING`; `pre-existing` requires Task 1 baseline evidence.

- [ ] **Step 3: Run static/documentation/package gates**

```bash
node scripts/validate-knowledge.mjs
node scripts/docs.mjs verify
node --test tests/release/single-apk-contract.test.mjs tests/release/workflow-contract.test.mjs
sh -n zapret2-manager/files/etc/init.d/zapret2-manager
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
git diff --check
```

- [ ] **Step 4: Build and verify locally from exact candidate SHA**

Run `scripts/release/build-apk.sh`, then `scripts/release/verify-artifacts.mjs`. Record candidate SHA, single APK filename/SHA-256/bytes, `build-manifest.json`, and `SHA256SUMS`.

- [ ] **Step 5: Push the execution branch and run the existing APK workflow**

Do not merge. Record workflow run ID/status, download the produced artifact, verify its commit SHA and hashes match the candidate recorded in Step 4, and record the proof in `acceptance.md`.

- [ ] **Step 6: Commit evidence only**

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json
git commit -m "docs: record Z2K recovery build evidence"
```

### Task 17: Final router/browser acceptance, independent review, and STOP before merge

**Files:**
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md`

**Interfaces:** evidence-backed PASS only after every non-user-only gate; final action is STOP and explicit merge question.

- [ ] **Step 1: Deploy exactly Task 16's verified artifact**

Record router model/arch, OpenWrt version, package version/release, candidate SHA, artifact SHA, and prove no stale source overlay shadows the package.

- [ ] **Step 2: Prove canonical Core identity**

Capture installed release, sourceCommit, manifest seq/SHA, runtimeBundleDigest, compilerInputsDigest, catalogDigest, Detect arch/SHA, compatibilityIdentity, receipt-v3 identity, active strategy, autocircular pool identity, one `nfqws2`, NFQUEUE 300 owner, and nft queue rule.

- [ ] **Step 3: Prove all one-shot Detect operations through Manager RPC**

Save raw/normalized evidence for `probe`, `classify`, `quic`, `tcp16`, and `voice` with no active call producing `EDETECT_NO_ACTIVE_VOICE`. Do not rewrite inconclusive network verdicts.

- [ ] **Step 4: Prove discovery end-to-end**

From LuCI enable discovery, observe validated procd process, change DNS source, generate a domain observation, prove update of `/opt/zapret2/lists/discovered-domains.txt`, kill/restart Detect, prove procd respawn, then disable. Prove discovered domains survive service restart and remain user/runtime data.

- [ ] **Step 5: Prove clean install on a reversible clean acceptance state**

Before destructive clean-state creation, export router config/LKG and verify recovery access. If the user has not authorized destructive clean-state creation on the only physical router, this install-only gate may become `BLOCKED_USER`; continue every non-destructive gate. With authorization, create a clean Z2K-Core-absent state using the project's supported recovery/install procedure, install through the normal Core workflow, then verify receipt/runtime/Detect/catalog identity before restoring the intended target release.

- [ ] **Step 6: Prove upgrade, same-release reinstall, repair, and downgrade**

For each operation record pre-mutation LKG identity, run through LuCI/RPC, wait for terminal result, then re-read canonical receipt/runtime/Detect/catalog/strategy identity. Repair uses a deliberately controlled broken Core state and targets the same installed release.

- [ ] **Step 7: Prove both failure classes and physical rollback**

Run one pre-commit injected failure and one post-activation injected failure. Compare before/after physical runtime digest, Detect bytes/digest, catalog digest, receipt-v3, and selected strategy. Post-activation failure must expose rollback result separately.

- [ ] **Step 8: Run final browser matrix**

Capture deployed-build screenshots/Network evidence for Components healthy/update/in-progress/failure+rollback/broken+repair; all five Scanner forms and canonical errors; discovery enabled/running/disabled/error; Resources Z2K managed and Avatar independent; hard reload during/after lifecycle; revisit after completion.

- [ ] **Step 9: Run live Discord Voice acceptance when it is the only remaining external prerequisite**

First prove the no-call state. When a real call is required, use exactly:

```text
REQUIRED_USER_INPUT: Start or join a Discord voice/video call and keep it active for the acceptance probe.
WHY_ONLY_USER_CAN_PROVIDE_IT: The upstream voice probe discovers the ephemeral Discord voice endpoint from the router's live connection table; repository code, tests, and the router cannot synthesize the user's real active Discord call.
[goal:blocked]
```

With the call active, capture Detect voice JSON, target/control evidence, recommended/working arm when present, and real autocircular `arm N -> failure evidence -> arm N+1`. If Detect finds a working arm, prove runtime reaches/stabilizes on it.

- [ ] **Step 10: Re-check final size/resource evidence**

Confirm final APK bytes are not greater than Task 1 baseline; capture installed size, native helper bytes, Detect bytes, idle/active RSS/CPU where available, and production file count.

- [ ] **Step 11: Request independent code review**

Use `superpowers:requesting-code-review`. Reviewer checks: no second Core owner; no old Scanner/fallback; no generic executable/argv capability; no independent Z2K Resources mutation; one Components surface; no quick/standard/full Scanner semantics; no stale `z2k-detectors.lua` production ownership; intact `r-*`/`p-*` and receipt-v3 identity; physical rollback; terminal browser re-read.

Critical/Important findings keep Task 17 `WORKING`; fix and re-run affected gates before review repeats.

- [ ] **Step 12: Run `superpowers:verification-before-completion` and write final evidence**

Record exact commands/results, candidate SHA, artifact hashes, router identities, browser evidence locations, focused/full counts, size comparison, and review result. Mark each ledger task `VERIFIED` except a true user-only gate explicitly marked `BLOCKED_USER`.

- [ ] **Step 13: Commit evidence and STOP**

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json \
        .superpowers/sdd/2026-09-08-z2k-recovery/ledger.md
git commit -m "docs: record final Z2K recovery acceptance"
```

Do not merge. Report final branch/SHA and ask the user to review evidence and explicitly choose whether to merge.

---

## Self-Review Checklist

### Spec coverage

- Recovery feature freeze/subtraction: Global Constraints + Tasks 10-15.
- Preserve coherent backend foundation: Global Constraints + Tasks 12-13 regression gates.
- Discovery P0 `dnsSource`: Task 2.
- Exact Detect RPC/error boundary: Task 3.
- Five command-specific Scanner operations: Tasks 4-5.
- Voice no-call state: Tasks 5 and 17.
- Compact truthful autodiscovery: Task 6.
- One Components Z2K surface: Tasks 7-8.
- Resources Core-managed/Avatar independent: Task 9.
- Call-graph proof before deletion: Task 10.
- Complete native `scanner_probe` retirement with shared primitives preserved: Task 11.
- Install/upgrade/reinstall/repair/downgrade and rollback: Tasks 12-13 and 17.
- Browser hard reload/revisit from backend authority: Tasks 13 and 17.
- Current docs/projection truth: Task 14.
- Mandatory no-APK-growth reduction gate: Task 15 and Task 17.
- Full harness + fresh CI-backed single APK: Task 16.
- Real router/browser acceptance and live Discord Voice: Task 17.
- Independent final review and no automatic merge: Task 17.

### Placeholder scan

No `TBD`, no incomplete code stubs, no omitted test definitions, and no undefined later interface names are permitted. The literal `TODO` tokens in this document are only the approved ledger state name and explicit initial ledger values.

### Type/signature consistency

- `probe(domain, timeoutMs)` is unchanged across Tasks 3-5.
- `classify(host, port, hello, repeats, timeoutMs)` is unchanged across Tasks 3-5.
- `quic(domain, port, repeats, timeoutMs)` is unchanged across Tasks 3-5.
- `voice(repeats, timeoutMs)` intentionally has no domain.
- `tcp16(timeoutMs)` intentionally has no host/port/repeats.
- Discovery controls always carry one `dnsSource` string with only `auto`, `agh`, `dnsmasq`, `pkt`.
- Task 11 preserves five `z2k_detect_*` native operations while deleting only `scanner_probe` semantics.
- Repair always resolves installed release and uses the existing coherent transaction; no second lifecycle is created.

---

## Execution Handoff

Plan is stored at `docs/superpowers/plans/2026-09-08-z2k-recovery.md`.

**1. Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, fresh implementer per task, spec-compliance review, then code-quality review before advancing.

**2. Inline Execution:** use `superpowers:executing-plans`, bounded batches with the same evidence/verification gates.

In either mode, create an isolated worktree via `superpowers:using-git-worktrees` before Task 1 and never merge automatically after Task 17.