# Z2K Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the Z2K product from the current partially-coherent state by preserving the proven Core lifecycle, repairing broken RPC/browser contracts, replacing the legacy Scanner UX with five explicit upstream Detect operations, removing the remaining native Scanner authority, simplifying Components/Resources, and proving the result on a real router and in a real browser.

**Architecture:** Keep the current Z2K Core/Asset Registry/Resource Center transaction authorities and receipt-v3 identity model. Make upstream `z2k-detect` the only production DPI measurement engine end-to-end, reduce LuCI to thin typed product projections, then delete legacy native Scanner code only after an explicit call-graph/package proof. Every user-visible mutation re-reads canonical backend state; no browser-local optimistic state is final authority.

**Tech Stack:** OpenWrt/procd; ucode; C11 native helper + helperd; LuCI JavaScript; Node.js `node:test`; Asset Registry; Resource Center; `z2k-detect`; GitHub Actions/OpenWrt SDK single-APK release pipeline.

**Spec:** `docs/superpowers/specs/2026-09-08-z2k-recovery-design.md`

**Reviewed baseline:** `main` at `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`. Execution must re-check current `main` before touching code and audit any drift from this reviewed baseline.

## Global Constraints

- This is recovery, not feature expansion: scope is only fix, simplify, remove, or verify.
- Preserve current `r-*` and `p-*` support, coherent candidate identity, receipt-v3 authority, exact architecture-specific Detect binding, LKG transaction/rollback, Core-managed official Z2K strategies, current six-Lua runtime membership, and autocircular semantic-pool identity.
- Do not add a new lifecycle owner, Scanner subsystem, page, compatibility layer, generic command executor, or alternative DPI classifier.
- Upstream `z2k-detect` is the sole production authority for `probe`, `classify`, `quic`, `voice`, `tcp16`, and long-running `run` discovery.
- Browser and RPC callers never select executables, argv, shell commands, environment, cwd, or arbitrary filesystem paths.
- Detect browser/RPC/native contracts are exact-field typed contracts; unexpected fields fail closed.
- `z2k-detect run` remains procd-owned; one-shot RPCs never own a long-lived Detect child.
- Components exposes one normal-flow Z2K Core product surface. Technical evidence may exist only behind details.
- Resources exposes Z2K inventory/provenance as Core-managed and has no independent Z2K mutation path. Avatar remains independently refreshable.
- `repair` is same-release recovery through the existing Core transaction model; do not create a second repair lifecycle.
- Failure before activation leaves LKG untouched. Failure after mutation begins must report both initiating failure and rollback outcome, and restore physical runtime/Detect/catalog/strategy state where the transaction owns them.
- Old native Scanner code is removed only after a call-graph/package proof identifies its exclusive consumers. Shared primitives such as `scanner-runtime-adapter.sh` remain when another production owner still consumes them.
- Product tests assert user outcomes and typed boundaries, not implementation phrases such as `Действие Detect`.
- Any task changing Components, Resources, Scanner, discovery controls, RPC wiring, or update progress is not `VERIFIED` until the deployed LuCI page is loaded against the current build and the relevant transition is observed.
- The implementation ledger uses only `TODO`, `WORKING`, `VERIFIED`, `BLOCKED_USER`. The `TODO` token here is the literal required state name, not an implementation placeholder.
- Engineering failures, regressions, missing code, build failures, router failures, refactoring, uncertainty, and review findings remain `WORKING`.
- A true user-only dependency uses exactly:

```text
REQUIRED_USER_INPUT: <specific input/action>
WHY_ONLY_USER_CAN_PROVIDE_IT: <why repository/router engineering cannot provide it>
[goal:blocked]
```

- Execute implementation in an isolated worktree created through `superpowers:using-git-worktrees`. Never reset/stash/overwrite unrelated concurrent work.
- Use TDD for every code bug/removal: prove RED or capture a reproducible current product failure before production edits, then prove GREEN.
- Each implementation slice gets its own evidence report under `.superpowers/sdd/2026-09-08-z2k-recovery/` and a narrow commit.
- Run `git diff --check` after every slice. Documentation edits additionally run `node scripts/validate-knowledge.mjs` and `node scripts/docs.mjs verify`.
- No automatic merge. Final acceptance ends with evidence and an explicit user merge decision.

---

## File Structure

### Recovery evidence created during execution

- `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md` — durable state table for Tasks 1-17.
- `.superpowers/sdd/2026-09-08-z2k-recovery/baseline.md` — exact Git/test/router/browser baseline and drift audit.
- `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json` — pre-recovery size/file-count measurements.
- `.superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md` — explicit native Scanner removal proof.
- `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md` — final automated/router/browser/review evidence.
- `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json` — bounded machine-readable final runtime identities and acceptance facts.

### Primary backend owners retained

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
- `zapret2-manager/src/z2m-core-helper/scanner.c` — current mixed legacy Scanner + Detect implementation; removal target after extraction.
- `zapret2-manager/src/z2m-core-helper/detect.c` — new focused native Detect operation implementation created during recovery.
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

### Focused recovery tests

- Create: `tests/product/z2k-detect-discovery-rpc-boundary.test.mjs`
- Create: `tests/product/z2k-detect-rpc-boundary.test.mjs`
- Create: `tests/ui/scanner-command-forms.test.mjs`
- Create: `tests/ui/z2k-core-single-surface.test.mjs`
- Create: `tests/ui/z2k-resources-managed-state.test.mjs`
- Create: `tests/ui/z2k-lifecycle-browser-state.test.mjs`
- Create: `tests/product/z2k-old-scanner-removal-closure.test.mjs`
- Modify existing focused suites instead of duplicating their coverage where practical.

---

## Phase A — Freeze truth and repair the P0 boundary

### Task 1: Establish the recovery ledger, drift audit, and size baseline

**Files:**
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md`
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/baseline.md`
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json`

**Interfaces:**
- Consumes: approved recovery spec and current Git worktree.
- Produces: immutable execution baseline SHA, overlapping-path drift decision, baseline test counts, and before-size numbers used by Task 15.

- [ ] **Step 1: Create the ledger with exact states**

```markdown
| Task | State | Evidence |
| --- | --- | --- |
| 1 | WORKING | baseline capture in progress |
| 2 | TODO | |
...
| 17 | TODO | |
```

The ellipsis above is not copied into the file: write rows 1 through 17 explicitly.

- [ ] **Step 2: Capture current Git truth and reviewed-baseline drift**

Run:

```bash
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -10 --oneline --decorate
git worktree list
git diff --name-status 9a4f0feeacbfd9d107385ffeffb5007b4bfadb39..HEAD
```

If `HEAD` differs from the reviewed baseline, classify every changed path overlapping this plan. Overlap is an engineering audit and remains `WORKING`; do not ask the user to resolve ordinary code drift.

- [ ] **Step 3: Capture baseline focused test results before any production edit**

Run:

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

Record pass/fail/skip counts verbatim. A missing host `ucode` binary is recorded as environment evidence and fixed/re-run in the canonical WSL environment; it is not a PASS.

- [ ] **Step 4: Capture source and artifact size baseline**

Run:

```bash
wc -c zapret2-manager/src/z2m-core-helper/scanner.c \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
      luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
find zapret2-manager/files luci-app-zapret2-manager/files -type f | sort | wc -l
```

Capture the exact current single APK size from a build/artifact tied to the execution baseline SHA. If `main-latest` does not point to that SHA, build the baseline SHA with `scripts/release/build-apk.sh` before any production changes and record the generated APK SHA-256 and byte size.

- [ ] **Step 5: Verify the evidence files and commit**

Run:

```bash
git diff --check
git add .superpowers/sdd/2026-09-08-z2k-recovery/ledger.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/baseline.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json
git commit -m "docs: record Z2K recovery baseline"
```

Set Task 1 to `VERIFIED` only after baseline SHA, drift audit, focused tests, and size evidence are present.

### Task 2: Repair discovery `dnsSource` across rpcd, ubus, LuCI, and procd

**Files:**
- Create: `tests/product/z2k-detect-discovery-rpc-boundary.test.mjs`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `tests/product/z2k-detect-discovery-service.test.mjs`
- Modify: `tests/ui/scanner-ui-rework.test.mjs`

**Interfaces:**
- Consumes: `z2k_detect_discovery_control(action, input)` from `z2k-detect.uc`.
- Produces: exact browser/RPC signature `dnsSource ∈ {auto,agh,dnsmasq,pkt}` for enable/disable/restart.

- [ ] **Step 1: Write the failing rpcd-signature test**

Assert the actual rpcd registration contains:

```ucode
z2k_detect_discovery_enable:  { args: { dnsSource: 'string' }, ... }
z2k_detect_discovery_disable: { args: { dnsSource: 'string' }, ... }
z2k_detect_discovery_restart: { args: { dnsSource: 'string' }, ... }
```

Also invoke the exported handler harness with `req.args.dnsSource = 'agh'` and prove the value reaches `z2k_detect_discovery_control()` unchanged.

- [ ] **Step 2: Prove RED on the reviewed baseline**

Run:

```bash
node --test tests/product/z2k-detect-discovery-rpc-boundary.test.mjs
```

Expected: FAIL because discovery control registrations do not currently declare the `dnsSource` argument.

- [ ] **Step 3: Fix the rpcd registrations and keep one positional LuCI contract**

The registration block must use exactly:

```ucode
z2k_detect_discovery_status: { call: function(req) { return z2k_detect_discovery_status_method(req); } },
z2k_detect_discovery_enable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_enable_method(req); } },
z2k_detect_discovery_disable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_disable_method(req); } },
z2k_detect_discovery_restart: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_restart_method(req); } },
```

LuCI continues to call `z2kDetectDiscoveryEnable(source)`, `Disable(source)`, and `Restart(source)`; do not add a second object-shaped browser contract.

- [ ] **Step 4: Prove GREEN in focused tests**

Run:

```bash
node --test \
  tests/product/z2k-detect-discovery-rpc-boundary.test.mjs \
  tests/product/z2k-detect-discovery-service.test.mjs \
  tests/ui/scanner-ui-rework.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Deploy this slice and prove the real product boundary**

On the target router run:

```sh
ubus -v list zapret2-manager | sed -n '/z2k_detect_discovery_status/,/z2k_detect_probe/p'
ubus -S call zapret2-manager z2k_detect_discovery_enable '{"dnsSource":"auto"}'
ubus -S call zapret2-manager z2k_detect_discovery_status '{}'
ubus -S call zapret2-manager z2k_detect_discovery_restart '{"dnsSource":"dnsmasq"}'
ubus -S call zapret2-manager z2k_detect_discovery_disable '{"dnsSource":"dnsmasq"}'
```

Load Scanner in real LuCI, exercise the same controls, and capture Network payloads proving `dnsSource` is transmitted. Restore the intended discovery state afterward.

- [ ] **Step 6: Commit and mark verified**

```bash
git add tests/product/z2k-detect-discovery-rpc-boundary.test.mjs \
        tests/product/z2k-detect-discovery-service.test.mjs \
        tests/ui/scanner-ui-rework.test.mjs \
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
- Produces these exact browser-facing request fields:
  - `probe(domain, timeoutMs)`
  - `classify(host, port, hello, repeats, timeoutMs)`
  - `quic(domain, port, repeats, timeoutMs)`
  - `voice(repeats, timeoutMs)`
  - `tcp16(timeoutMs)`

- [ ] **Step 1: Write strict RED tests for extra and malformed fields**

For the rpcd/UCode handler harness assert examples such as:

```js
assert.equal(call('probe', { domain: 'example.com', timeoutMs: 6000, argv: ['sh'] }).error.code, 'EINPUT');
assert.equal(call('voice', { domain: 'example.com', repeats: 2, timeoutMs: 6000 }).error.code, 'EINPUT');
assert.equal(call('tcp16', { port: 443, timeoutMs: 6000 }).error.code, 'EINPUT');
```

Valid exact requests must still reach the corresponding `z2k_detect_*` function.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/product/z2k-detect-rpc-boundary.test.mjs
```

Expected: at least the extra-field cases fail because current `z2k_detect_input(req)` returns the whole `req.args` object without operation-specific exact-field rejection at the rpcd layer.

- [ ] **Step 3: Add one small rpcd exact-field normalizer**

Inside `zapret2-manager.uc`, add a local helper with this contract:

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

Each handler supplies its own exact field list before calling `z2k-detect.uc`. Range, hostname, hello-mode, and JSON-result validation remain in the existing Detect authority.

- [ ] **Step 4: Keep LuCI declarations exactly aligned**

`z2m-api.js` must expose only the five existing positional calls with no generic `detect(operation, args)` public API.

- [ ] **Step 5: Prove GREEN**

Run:

```bash
node --test \
  tests/product/z2k-detect-rpc-boundary.test.mjs \
  tests/product/z2k-detect-rpc.test.mjs \
  tests/ui/scanner-detect-api-boundary.test.mjs \
  tests/native/z2k-detect-helper.test.mjs
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/product/z2k-detect-rpc-boundary.test.mjs \
        tests/product/z2k-detect-rpc.test.mjs \
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

**Interfaces:**
- Produces one internal operation descriptor map in `z2m-scanner.js`; no new module or new Scanner subsystem.

- [ ] **Step 1: Write RED tests for the five exact forms**

Require the model to expose exactly:

```js
{
  probe:    ['domain', 'timeoutMs'],
  classify: ['host', 'port', 'hello', 'repeats', 'timeoutMs'],
  quic:     ['domain', 'port', 'repeats', 'timeoutMs'],
  voice:    ['repeats', 'timeoutMs'],
  tcp16:    ['timeoutMs']
}
```

Also assert that production state no longer contains shared `protocol`, `mode`, `quick`, `standard`, or `full` semantics.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
```

Expected: FAIL because current state is `{ target, operation, protocol, mode }` and `detectArguments()` derives repeats/timeouts from `quick/standard/full`.

- [ ] **Step 3: Replace the state contract**

Use one operation descriptor table in the existing file, for example:

```js
var DETECT_FORMS = {
  probe:    { label: _('Проверка сайта'), fields: ['domain', 'timeoutMs'], defaults: { domain: 'youtube.com', timeoutMs: 6000 } },
  classify: { label: _('Анализ DPI'), fields: ['host', 'port', 'hello', 'repeats', 'timeoutMs'], defaults: { host: 'youtube.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000 } },
  quic:     { label: _('QUIC'), fields: ['domain', 'port', 'repeats', 'timeoutMs'], defaults: { domain: 'youtube.com', port: 443, repeats: 2, timeoutMs: 6000 } },
  voice:    { label: _('Discord Voice'), fields: ['repeats', 'timeoutMs'], defaults: { repeats: 2, timeoutMs: 6000 } },
  tcp16:    { label: _('TCP16'), fields: ['timeoutMs'], defaults: { timeoutMs: 6000 } }
};
```

Keep bounds compatible with backend validation. Remove `safeRequest()` fields and helpers whose only purpose is generic `protocol`/`mode` mapping.

- [ ] **Step 4: Make `detectInvoke()` consume exact operation state**

`voice` must never synthesize a domain. `tcp16` must never synthesize host/port/repeats. `classify` and `quic` keep explicit port/repeats fields instead of hidden mode-derived values.

- [ ] **Step 5: Prove GREEN and size reduction in this file**

Run:

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
wc -c luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
git diff --check
```

Expected: PASS, with no increase justified by retaining removed generic mode/protocol logic.

- [ ] **Step 6: Commit**

```bash
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

**Interfaces:** Scanner route remains unchanged; history remains `z2m-detect-history.v1` typed Detect evidence only.

- [ ] **Step 1: Add behavior-oriented RED assertions**

Require visible actions named:

```text
Проверка сайта
Анализ DPI
QUIC
Discord Voice
TCP16
```

Assert there is no `Действие Detect`, shared TCP/UDP selector, or `Быстро/Обычно/Тщательно` control. Assert operation-specific field presence/absence, especially no domain for Voice and no host/port for TCP16.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs
```

Expected: FAIL on the current generic selector UI.

- [ ] **Step 3: Render operation navigation and field-specific forms**

Keep one active operation state. Render only the descriptor's exact fields with bounded numeric inputs and the existing hostname normalization where the operation needs a domain/host.

Voice copy must state that a live Discord voice/video call is required. Map `EDETECT_NO_ACTIVE_VOICE` to a specific next step such as `Подключитесь к голосовому каналу Discord и повторите проверку.` without treating it as a recovery-wide blocker.

- [ ] **Step 4: Preserve canonical typed results and history**

The history record request becomes operation-specific and must not persist retired `protocol`/`mode` fields. Continue rejecting legacy/untrusted history entries and keep raw technical JSON only behind the existing details affordance.

- [ ] **Step 5: Prove GREEN**

Run:

```bash
node --test \
  tests/ui/scanner-command-forms.test.mjs \
  tests/ui/scanner-ui-rework.test.mjs \
  tests/ui/scanner-detect-history.test.mjs \
  tests/ui/scanner-detect-api-boundary.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js
git diff --check
```

- [ ] **Step 6: Real browser gate for this slice**

Deploy current files, hard reload LuCI Scanner with cache disabled, and capture screenshots/Network evidence showing all five operation forms. Execute at least one real `probe` through the page and one `voice` call with no active Discord call to prove the specific `EDETECT_NO_ACTIVE_VOICE` state.

- [ ] **Step 7: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-detect-history.test.mjs \
        tests/ui/scanner-detect-api-boundary.test.mjs \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "feat: make Scanner a thin Z2K Detect UI"
```

### Task 6: Make automatic discovery a compact, truthful Scanner control block

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/scanner-ui-rework.test.mjs`
- Modify: `tests/product/z2k-detect-discovery-service.test.mjs`

**Interfaces:** consumes Task 2's exact `dnsSource` RPC contract and canonical discovery status `{schema,enabled,running,dnsSource,discoveredDomains}`.

- [ ] **Step 1: Add RED UI-state tests**

Cover `disabled`, `enabled+running`, `enabled+not-running`, `changing`, and canonical error states. Require visible DNS source, discovered count, mtime when present, and one concise control/retry action.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-detect-discovery-service.test.mjs
```

- [ ] **Step 3: Simplify rendering around backend truth**

Do not infer `running` from `enabled`. Render the validated process state returned by `z2k-detect.uc`. Keep source selection limited to `auto`, `agh`, `dnsmasq`, `pkt`.

- [ ] **Step 4: Prove GREEN and browser control lifecycle**

Run focused tests, deploy, then in real LuCI prove:

```text
disabled -> enable(auto) -> running -> restart(dnsmasq) -> new validated pid/state -> disable -> stopped
```

Capture browser payloads and `ubus call service list '{"name":"zapret2-manager"}'` evidence. Confirm discovered-domain count survives restart/disable.

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

**Interfaces:** produces one Z2K Core component model with canonical fields for installed/available release, runtime health, Detect status/arch, strategy summary, discovery state, compatibility, lifecycle action, and technical evidence.

- [ ] **Step 1: Write RED state-model tests**

Require distinct model states for:

```text
missing
ready
update-available
degraded/incoherent
broken/repair-required
working
rollback-result
```

No model state may project `Работает` when receipt/runtime/Detect coherence is false.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-model.test.mjs tests/ui/system-components-z2k-truth-lifecycle.test.mjs
```

- [ ] **Step 3: Build the compact canonical facts in the existing model**

Project user facts separately from diagnostics:

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

Do not duplicate backend identity derivation in JavaScript; these fields are projections only.

- [ ] **Step 4: Prove GREEN**

Run the three focused model suites plus `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-model.test.mjs \
        tests/ui/system-components-z2k-truth-lifecycle.test.mjs \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js
git commit -m "refactor: define one Z2K Core component projection"
```

### Task 8: Remove the duplicate Components Z2K dashboard and keep technical evidence behind details

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/z2k-core-single-surface.test.mjs`
- Modify: `tests/ui/system-components-details-presentation.test.mjs`
- Modify: `tests/ui/z2k-compiled-dependency-summary.test.mjs`
- Modify: `tests/ui/components-resources-corrective-pass.test.mjs`

**Interfaces:** exactly one normal-flow `.z2m-component-card--z2k`; details remain subordinate to that card.

- [ ] **Step 1: Write RED structure tests**

Assert:

```js
assert.equal(countZ2KProductSurfaces(rendered), 1);
assert.equal(text.includes('УПРАВЛЕНИЕ РЕСУРСАМИ'), false);
assert.equal(primaryText.includes('runtimeBundleDigest'), false);
assert.equal(technicalDetailsText.includes('compatibilityIdentity'), true);
```

Replace old tests that require `Runtime bundle39` or a second large details dashboard as normal UI.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-details-presentation.test.mjs tests/ui/z2k-compiled-dependency-summary.test.mjs
```

Expected: FAIL on the duplicate current surface.

- [ ] **Step 3: Collapse rendering into one compact card**

The card shows status/version first, then only Strategy/Detect/Runtime/Discovery/Compatibility facts. Update available uses the same card. `Подробнее` expands one subordinate details region; technical digests/source/manifest/dependency evidence is nested under `Технические детали`.

- [ ] **Step 4: Remove CSS used only by the deleted dashboard hierarchy**

Delete selectors only after source/test search proves no remaining consumer. Do not redesign unrelated Manager visuals.

- [ ] **Step 5: Prove GREEN and real browser hierarchy**

Run:

```bash
node --test \
  tests/ui/z2k-core-single-surface.test.mjs \
  tests/ui/system-components-details-presentation.test.mjs \
  tests/ui/z2k-compiled-dependency-summary.test.mjs \
  tests/ui/components-resources-corrective-pass.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
git diff --check
```

Deploy and hard reload Components. Capture the healthy current Core showing one card and one subordinate details expansion; prove the deleted second management dashboard is absent.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
        tests/ui/z2k-core-single-surface.test.mjs tests/ui/system-components-details-presentation.test.mjs \
        tests/ui/z2k-compiled-dependency-summary.test.mjs tests/ui/components-resources-corrective-pass.test.mjs \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "refactor: collapse Components to one Z2K Core surface"
```

### Task 9: Make Resources a managed Z2K inventory, not a lifecycle controller

**Files:**
- Create: `tests/ui/z2k-resources-managed-state.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- Modify: `tests/product/z2m-resources-model.test.mjs`
- Modify: `tests/ui/components-resources-corrective-pass.test.mjs`
- Modify: `tests/product/resource-center-transaction.test.mjs`

**Interfaces:** Z2K group renders `Управляется Z2K Core`; direct Z2K source refresh remains backend `EMANAGED`; `Обновить все` skips Core-managed Z2K but continues independent Avatar refresh.

- [ ] **Step 1: Write RED ownership tests**

Assert no Z2K row/group exposes an update button or writable source mutation. Assert the bulk-update selection excludes Z2K and still includes Avatar when Avatar is independently stale.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/z2k-resources-managed-state.test.mjs tests/product/z2m-resources-model.test.mjs tests/product/resource-center-transaction.test.mjs
```

- [ ] **Step 3: Simplify the Z2K resource projection**

Render release/version, official strategy/resource identity, provenance/details if useful, and the ownership label. Do not mirror Components lifecycle buttons here.

- [ ] **Step 4: Prove backend ownership still fails closed**

Add/retain assertions that independent Z2K refresh returns:

```json
{"ok":false,"error":{"code":"EMANAGED","owner":"z2k-core"}}
```

while Avatar's independent refresh path remains available.

- [ ] **Step 5: Prove GREEN and real browser ownership**

Run focused tests and syntax check, deploy, then capture Resources showing Z2K managed-by-Core and Avatar still independently actionable. Trigger `Обновить все` in a safe stale fixture/state and prove no Z2K Core mutation request is sent.

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

## Phase D — Prove and delete the remaining old Scanner authority

### Task 10: Build the native Scanner call graph and lock the removal boundary

**Files:**
- Create: `.superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md`
- Create: `tests/product/z2k-old-scanner-removal-closure.test.mjs`
- Modify: `tests/product/z2k-old-scanner-unwired.test.mjs`

**Interfaces:** produces the exact keep/remove classification consumed by Task 11.

- [ ] **Step 1: Enumerate every production reference**

Run:

```bash
git grep -nE 'scanner_probe|z2m_scanner_probe|scanner\.c|scanner-runtime-adapter\.sh|scanner-transient|quick|standard|full' -- \
  ':(exclude)docs/**' ':(exclude).superpowers/**' ':(exclude)tests/**'
```

Classify each hit as `legacy-scanner-exclusive`, `detect-required`, `shared-non-scanner`, or `dead-reference` with owner/caller evidence.

- [ ] **Step 2: Explicitly prove the shared adapter boundary before deletion**

Trace `scanner-runtime-adapter.sh` callers, including `profiles-apply.uc` and any runtime apply path. If a production non-Scanner caller remains, mark the adapter `KEEP_SHARED`; do not delete or rename it in Task 11.

- [ ] **Step 3: Write the closure test RED against current production**

Require post-recovery production to have:

```text
no operation named scanner_probe in protocol-v1.json
no z2m_scanner_probe symbol
no scanner.c compilation
no native-helper scanner_probe success-shape branch
all five z2k_detect_* operations still present
```

- [ ] **Step 4: Prove RED**

Run:

```bash
node --test tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Expected: FAIL because current native helper still contains `scanner_probe` and compiles `scanner.c`.

- [ ] **Step 5: Record the reviewed removal set and commit evidence/test only**

The evidence file must name exact files/symbols to remove in Task 11 and exact shared files to retain.

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/scanner-callgraph.md \
        tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
git commit -m "test: lock old Scanner removal boundary"
```

Task 10 is `VERIFIED` when the call graph is explicit and the closure test is intentionally RED for only the identified legacy code.

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

**Interfaces:** keep exactly `z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`; delete `scanner_probe` and its exclusive profile/TLS/body/STUN machinery.

- [ ] **Step 1: Move only the five typed Detect implementations into `detect.c`**

Preserve the current fixed executable `/usr/libexec/zapret2-manager/z2k-detect`, bounded timeout/output behavior, safe argv construction, canonical JSON/result envelope, and process supervision. Do not copy legacy scanner profile/body/STUN code.

- [ ] **Step 2: Remove the legacy protocol operation**

Delete `scanner_probe` from:

```text
protocol-v1.json operation enum/schema
protocol.c operation registry
main.c dispatch
helper.h symbol declarations
core/native-helper.uc operation/success-shape handling
```

- [ ] **Step 3: Remove `scanner.c` from both package builds and compile `detect.c`**

Both Makefiles must compile the focused Detect source. Update native tests that currently assert `scanner.c` exists.

- [ ] **Step 4: Prove native GREEN**

Run:

```bash
export UCODE_BIN=${UCODE_BIN:-/opt/ucode/bin/ucode}
export LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-/opt/ucode/lib}
node --test \
  tests/native/z2k-detect-helper.test.mjs \
  tests/native/package-helper.test.mjs \
  tests/native/core/fs-helper-protocol.test.mjs \
  tests/product/z2k-old-scanner-removal-closure.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs
git grep -nE 'scanner_probe|z2m_scanner_probe' -- \
  'zapret2-manager/src/**' 'zapret2-manager/files/**' 'luci-app-zapret2-manager/files/**'
git diff --check
```

Expected: tests PASS and production grep returns no legacy `scanner_probe` semantic authority.

- [ ] **Step 5: Build both native helper variants used by tests/package gates**

Use the repository's existing native test compile path and then run the package release contract tests. `-Wall -Wextra -Werror` must remain clean.

- [ ] **Step 6: Deploy and prove runtime absence**

On the router prove `ubus -v list` has no old Scanner RPC, the installed helper still runs all five typed Detect operations, and package/runtime searches contain no legacy `scanner_probe` protocol entry.

- [ ] **Step 7: Commit**

```bash
git add zapret2-manager/src/z2m-core-helper/detect.c \
        zapret2-manager/src/z2m-core-helper/helper.h \
        zapret2-manager/src/z2m-core-helper/main.c \
        zapret2-manager/src/z2m-core-helper/protocol.c \
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

### Task 12: Make lifecycle failure/rollback results explicit and same-release repair canonical

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

**Interfaces:** mutation result must expose initiating failure separately from rollback evidence; `repair` resolves to same installed release and existing `reinstall` transaction semantics.

- [ ] **Step 1: Add RED transaction-result tests**

Require a post-activation failure result shaped along these lines:

```js
{
  ok: false,
  error: { code: '...', message: '...' },
  rollback: {
    attempted: true,
    ok: true,
    restored: {
      release: 'p-82.x',
      runtimeBundleDigest: '...',
      detectSha256: '...',
      catalogDigest: '...',
      strategyIdentity: '...'
    }
  }
}
```

Pre-commit failure must report `rollback.attempted === false` and prove original LKG was never mutated.

- [ ] **Step 2: Add same-release repair tests**

Given installed release `R`, a repair request must prepare `R`, not `latest`, and use the same coherent candidate/staging/activation path as reinstall. It may not bypass receipt-v3, Detect digest, compiler/catalog, dependency closure, or active strategy compatibility.

- [ ] **Step 3: Prove RED**

Run the five focused transaction suites above and capture exact failures.

- [ ] **Step 4: Implement the smallest result-contract change in the existing coordinator**

Do not add another lifecycle module. Preserve existing pending-activation recovery and physical rollback owners. Add bounded rollback evidence to the current operation result and same-release resolution for repair.

- [ ] **Step 5: Inject both failure classes and prove physical identity**

Tests must compare before/after receipt, runtime digest, Detect bytes/digest, catalog digest, and selected strategy identity.

- [ ] **Step 6: Prove GREEN and commit**

```bash
node --test \
  tests/product/z2k-coherent-transaction.test.mjs \
  tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-detect-artifact.test.mjs \
  tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-target-lifecycle-contract.test.mjs
git diff --check
git add zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc \
        zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc \
        tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs \
        tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs \
        tests/product/z2k-target-lifecycle-contract.test.mjs
git commit -m "fix: expose complete Z2K rollback outcomes"
```

### Task 13: Rebuild Components lifecycle UX around canonical re-read

**Files:**
- Create: `tests/ui/z2k-lifecycle-browser-state.test.mjs`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `tests/ui/system-components-details-presentation.test.mjs`
- Modify: `tests/ui/z2k-version-ux-behavior.test.mjs`
- Modify: `tests/ui/z2k-frontend-canonical-update-contract.test.mjs`

**Interfaces:** lifecycle operations cover check/install/upgrade/reinstall/repair/downgrade; terminal UI always refreshes from canonical backend state and renders rollback result separately.

- [ ] **Step 1: Write RED browser-state tests**

Cover:

```text
idle -> accepted operationId -> polling -> terminal success -> canonical reload
idle -> accepted operationId -> terminal failure + rollback success -> canonical reload
page reload while operation active -> resume from operation status
browser revisit after completion -> reconstruct only from backend state
```

Assert no endless spinner and no stale selected release survives terminal refresh.

- [ ] **Step 2: Prove RED**

Run:

```bash
node --test tests/ui/z2k-lifecycle-browser-state.test.mjs tests/ui/z2k-version-ux-behavior.test.mjs tests/ui/system-components-details-presentation.test.mjs
```

- [ ] **Step 3: Make one operation-state owner in `z2m-maintenance.js`**

The UI may keep transient `operationId/phase` for polling, but after any terminal result it must call the existing Core status/check load path and render installed/available state from that response. Do not synthesize installed state from the selected target.

- [ ] **Step 4: Render repair and rollback outcomes explicitly**

Broken installed Core shows `Восстановить` for same-release repair. A failed operation with successful rollback says the operation failed and the previous version was restored. Failed/uncertain rollback remains a distinct high-severity state and cannot be replaced by a generic network/session message.

- [ ] **Step 5: Prove GREEN**

Run the new suite plus existing version/Components contract suites and JS syntax checks.

- [ ] **Step 6: Real browser mutation gate**

Deploy the slice. Perform at least one safe same-release reinstall/repair transaction on the target router, observe operation progress, hard reload the page while/after the operation, and prove the final card is reconstructed from receipt/runtime truth. Capture a controlled injected/preflight failure and verify no endless spinner or stale selected version.

- [ ] **Step 7: Commit**

```bash
git add tests/ui/z2k-lifecycle-browser-state.test.mjs tests/ui/system-components-details-presentation.test.mjs \
        tests/ui/z2k-version-ux-behavior.test.mjs tests/ui/z2k-frontend-canonical-update-contract.test.mjs \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
        luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "fix: recover canonical Z2K lifecycle browser state"
```

---

## Phase F — Documentation/projection cleanup and reduction

### Task 14: Remove stale Scanner/Z2K product documentation and projection references

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
- Modify: knowledge/public-projection tests that directly reference retired files/symbols.

**Interfaces:** docs describe only the recovered product: explicit Detect operations, one Components surface, Core-managed Z2K resources, no native Scanner authority.

- [ ] **Step 1: Find stale production/documentation claims**

Run:

```bash
git grep -nE 'Действие Detect|quick|standard|full|candidate|scanner_probe|scanner\.c|УПРАВЛЕНИЕ РЕСУРСАМИ' -- docs scripts router-deploy-runtime-composition.manifest
```

Classify historical/archive references separately; current/normative/public docs must match recovered truth.

- [ ] **Step 2: Update current docs and code-evidence projection**

Point Scanner evidence to `z2k-detect.uc`, typed RPC, and the focused native Detect helper where appropriate. Remove current docs that describe candidate scanning/Strategy handoff from the retired Scanner model. Components/Resources docs must state the single-surface/Core-managed ownership contract.

- [ ] **Step 3: Update deployment manifest closure**

Replace removed production file references with current files (`detect.c` is build source, not router runtime). Remove any stale runtime entry that no longer exists; retain shared `scanner-runtime-adapter.sh` if Task 10 proved a non-Scanner production consumer.

- [ ] **Step 4: Run documentation gates**

```bash
node --test tests/knowledge/public-projection.test.mjs tests/knowledge/validator.test.mjs tests/knowledge/docs-cli.test.mjs
node scripts/validate-knowledge.mjs
node scripts/docs.mjs verify
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs scripts/public-projection.mjs router-deploy-runtime-composition.manifest tests/knowledge \
        .superpowers/sdd/2026-09-08-z2k-recovery
git commit -m "docs: align product knowledge with Z2K recovery"
```

### Task 15: Perform the dedicated size/complexity reduction pass

**Files:**
- Modify only files proven dead by Task 10-14 searches.
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json` with an `after` section.
- Update affected tests when a deleted internal seam had test-only references.

**Interfaces:** final APK must be `<=` baseline APK bytes; preferred native helper/JS/UCode/file-count values decrease.

- [ ] **Step 1: Generate a dead-code candidate list from production imports/callers**

Run targeted `git grep` for:

```text
retired scanner CSS classes
retired generic Scanner state helpers
unused RPC methods
removed native protocol helpers
second Components dashboard helpers
obsolete compatibility fallbacks
```

For each deletion candidate record all production and test callers before deletion. Byte count alone is not authorization.

- [ ] **Step 2: Remove only proven dead code**

Do not weaken rollback, receipt validation, Detect schema validation, diagnostics, or current migration compatibility merely to reduce size.

- [ ] **Step 3: Re-run focused suites after each deletion batch**

At minimum rerun Scanner, Components, Resources, native helper, lifecycle transaction, package, and knowledge suites touched by the batch.

- [ ] **Step 4: Capture after measurements**

Repeat Task 1 source/file-count commands and build the current single APK using the same canonical release path used for the baseline. Record:

```json
{
  "apkBytes": 0,
  "apkSha256": "64-hex",
  "nativeHelperBytes": 0,
  "scannerJsBytes": 0,
  "maintenanceJsBytes": 0,
  "assetsJsBytes": 0,
  "productionFileCount": 0
}
```

The zeros above are schema examples only; write measured positive values.

- [ ] **Step 5: Enforce the hard budget**

Fail the task if `after.apkBytes > before.apkBytes`. Continue engineering reduction until the budget is satisfied without weakening required behavior.

- [ ] **Step 6: Commit**

```bash
git add -u
git add .superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json
git diff --check
git commit -m "refactor: reduce recovered Z2K production surface"
```

---

## Phase G — Full verification, artifact proof, live acceptance, review

### Task 16: Run the canonical full harness and produce a fresh single APK

**Files:**
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json`

**Interfaces:** produces the exact commit/artifact that Task 17 deploys. No later code change is allowed without invalidating and re-running this task.

- [ ] **Step 1: Run every focused recovery suite together**

```bash
export UCODE_BIN=${UCODE_BIN:-/opt/ucode/bin/ucode}
export LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-/opt/ucode/lib}
node --test \
  tests/product/z2k-detect-discovery-rpc-boundary.test.mjs \
  tests/product/z2k-detect-rpc-boundary.test.mjs \
  tests/product/z2k-detect-rpc.test.mjs \
  tests/product/z2k-detect-discovery-service.test.mjs \
  tests/product/z2k-coherent-transaction.test.mjs \
  tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-detect-artifact.test.mjs \
  tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-target-lifecycle-contract.test.mjs \
  tests/product/z2k-old-scanner-removal-closure.test.mjs \
  tests/product/z2k-old-scanner-unwired.test.mjs \
  tests/native/z2k-detect-helper.test.mjs \
  tests/native/package-helper.test.mjs \
  tests/native/core/fs-helper-protocol.test.mjs \
  tests/ui/scanner-command-forms.test.mjs \
  tests/ui/scanner-ui-rework.test.mjs \
  tests/ui/scanner-detect-history.test.mjs \
  tests/ui/scanner-detect-api-boundary.test.mjs \
  tests/ui/z2k-core-single-surface.test.mjs \
  tests/ui/z2k-resources-managed-state.test.mjs \
  tests/ui/z2k-lifecycle-browser-state.test.mjs
```

Expected: PASS with zero unexplained skips.

- [ ] **Step 2: Run the repository-wide Node test harness in the canonical environment**

```bash
find tests -name '*.test.mjs' -print0 | sort -z | xargs -0 node --test
```

If command-line chunking creates multiple Node invocations, aggregate all exit codes and counts. Any product failure remains `WORKING`; no `pre-existing` label is accepted without Task 1 baseline proof.

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

- [ ] **Step 4: Build and verify the single APK from the exact candidate SHA**

Use `scripts/release/build-apk.sh`, then `scripts/release/verify-artifacts.mjs`. Record candidate Git SHA, APK filename, APK SHA-256, APK bytes, `build-manifest.json`, and `SHA256SUMS`. The build must contain exactly one `zapret2-manager-full-*.apk` Manager artifact.

- [ ] **Step 5: If repository policy requires CI artifact proof, push the execution branch and run the existing APK workflow**

Do not merge. Record workflow run ID/status and downloaded artifact hashes; verify they correspond to the exact candidate SHA.

- [ ] **Step 6: Commit only evidence updates**

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json
git commit -m "docs: record Z2K recovery build evidence"
```

### Task 17: Perform final router/browser acceptance, independent review, and stop before merge

**Files:**
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json`
- Update: `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md`

**Interfaces:** final result is evidence-backed `PASS` only when all non-user-only gates are complete; final action is STOP and ask the user whether to merge.

- [ ] **Step 1: Deploy exactly Task 16's verified artifact**

Record router model/arch, OpenWrt version, package version/release, candidate Git SHA, installed APK hash where derivable, and prove no stale source deployment is shadowing the package.

- [ ] **Step 2: Prove canonical Core identity on the real router**

Capture installed release, sourceCommit, manifest seq/SHA, runtimeBundleDigest, compilerInputsDigest, catalogDigest, Detect arch/SHA, compatibilityIdentity, receipt-v3 identity, active strategy, autocircular pool identity, one `nfqws2`, NFQUEUE 300 owner, and relevant nft queue rule.

- [ ] **Step 3: Prove all one-shot Detect operations through Manager RPC**

Execute and save raw/normalized evidence for:

```text
probe
classify
quic
tcp16
voice with no active call -> EDETECT_NO_ACTIVE_VOICE
```

Do not rewrite inconclusive network verdicts as pass/fail. The contract itself must execute correctly.

- [ ] **Step 4: Prove discovery end-to-end**

From LuCI enable discovery, observe validated procd process, change DNS source, generate a domain observation, prove append/update of `/opt/zapret2/lists/discovered-domains.txt`, restart/kill Detect, prove procd respawn, then disable. Prove discovered domains survive service restart and are not classified as release-owned data.

- [ ] **Step 5: Run the complete lifecycle matrix**

Exercise, as applicable to the current router state:

```text
check current state
install or prove clean-install path on controlled state
upgrade
a same-release reinstall
repair of a controlled broken state
downgrade to a known compatible release
pre-commit injected failure
post-activation injected failure + physical rollback
page hard reload during operation
browser revisit after completion
```

Before each mutation record LKG identity. After each mutation re-read canonical receipt/runtime/Detect/catalog/strategy identity.

- [ ] **Step 6: Run the final browser matrix**

Capture deployed-build screenshots/Network evidence for:

```text
Components healthy Core: one product surface
Components update available
Components in progress
Components failed mutation + rollback result
Components broken/incoherent + repair action
Scanner all five operation forms
Scanner canonical error rendering
Discovery enabled/running/disabled/error
Resources Z2K managed by Core
Resources Avatar independent
hard reload/revisit after mutation
```

No static mock counts as browser proof.

- [ ] **Step 7: Run Discord Voice live-call acceptance when the user supplies the only external prerequisite**

First prove the no-call state without blocking any other recovery work. When live-call acceptance is the only remaining gate, use exactly:

```text
REQUIRED_USER_INPUT: Start or join a Discord voice/video call and keep it active for the acceptance probe.
WHY_ONLY_USER_CAN_PROVIDE_IT: The upstream voice probe discovers the ephemeral Discord voice endpoint from the router's live connection table; repository code, tests, and the router cannot synthesize the user's real active Discord call.
[goal:blocked]
```

With the call active, capture Detect voice JSON, target/control evidence, recommended/working arm when present, and the real autocircular transition `arm N -> failure evidence -> arm N+1`. If Detect identifies a working arm, prove runtime reaches/stabilizes on it.

- [ ] **Step 8: Re-check size and installed resource use**

Confirm final APK is not larger than Task 1 baseline. Capture installed size, native helper bytes, Detect binary bytes, idle/active RSS/CPU where available, and production file count.

- [ ] **Step 9: Request independent code review**

Use `superpowers:requesting-code-review`. Reviewer must inspect the final diff and verify:

```text
no second Z2K lifecycle owner
no old Scanner semantic authority or fallback
no generic executable/argv browser capability
no independent Z2K Resource mutation
no duplicate Components Z2K product surface
no stale quick/standard/full Scanner semantics
no stale production z2k-detectors.lua ownership
full r-*/p-* Core identity remains intact
receipt-v3/Detect/runtime/compiler/catalog identity remains coherent
pre-commit and post-activation rollback are physical, not metadata-only
browser terminal state always re-reads backend authority
```

Critical/Important review findings keep the task `WORKING`; fix and re-run affected gates before another review.

- [ ] **Step 10: Run `superpowers:verification-before-completion` and write final evidence**

Record exact commands, results, candidate SHA, artifact hashes, router identities, browser evidence locations, focused/full test counts, size comparison, and review outcome. Mark every ledger row `VERIFIED` except a true live-call `BLOCKED_USER` gate.

- [ ] **Step 11: Commit final evidence and STOP**

```bash
git add .superpowers/sdd/2026-09-08-z2k-recovery/acceptance.md \
        .superpowers/sdd/2026-09-08-z2k-recovery/live-evidence.json \
        .superpowers/sdd/2026-09-08-z2k-recovery/ledger.md
git commit -m "docs: record final Z2K recovery acceptance"
```

Do not merge. Report the final branch/SHA and ask the user to review the evidence and explicitly choose whether to merge.

---

## Self-Review Checklist

### Spec coverage

- Purpose/feature freeze/subtraction: Global Constraints + Tasks 10-15.
- Preserve coherent Core foundations: Global Constraints + Tasks 12-13 regression gates.
- Discovery P0 `dnsSource`: Task 2.
- Exact Detect typed contracts/errors: Task 3.
- Five command-specific Scanner operations: Tasks 4-5.
- Voice no-call semantics: Tasks 5 and 17.
- Compact autodiscovery block/procd truth: Task 6.
- One Components Z2K Core surface: Tasks 7-8.
- Resources Core-managed/Avatar independent: Task 9.
- Explicit call-graph proof before deletion: Task 10.
- Complete native `scanner_probe` retirement while preserving required shared primitives: Task 11.
- Install/upgrade/reinstall/repair/downgrade and rollback: Tasks 12-13 and 17.
- Browser re-read after mutation/hard reload/revisit: Task 13 and Task 17.
- Current docs/projection truth: Task 14.
- Mandatory size reduction gate/no APK increase: Task 15 and Task 17.
- Full harness/fresh verified single APK: Task 16.
- Real router/browser acceptance and live Discord Voice: Task 17.
- Independent final review and no automatic merge: Task 17.

### Placeholder scan

The plan contains no `TBD`, no unspecified "add error handling", no "write tests for the above", and no undefined later function names. The only literal `TODO` occurrences are the four-state ledger values required verbatim by the approved spec and the initial ledger rows.

### Type/signature consistency

- `probe(domain, timeoutMs)` is consistent in Tasks 3-5.
- `classify(host, port, hello, repeats, timeoutMs)` is consistent in Tasks 3-5.
- `quic(domain, port, repeats, timeoutMs)` is consistent in Tasks 3-5.
- `voice(repeats, timeoutMs)` is consistent in Tasks 3-5 and intentionally has no domain.
- `tcp16(timeoutMs)` is consistent in Tasks 3-5 and intentionally has no host/port/repeats.
- Discovery controls always use one `dnsSource` string and the four canonical values.
- Task 11 preserves the five `z2k_detect_*` native operations while deleting only `scanner_probe` semantics.
- `repair` always resolves the installed release and reuses the existing coherent transaction; no second lifecycle is introduced.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-z2k-recovery.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — use `superpowers:subagent-driven-development`, a fresh implementer per task, then spec-compliance review and code-quality review before advancing.

**2. Inline Execution** — use `superpowers:executing-plans`, execute in bounded batches with checkpoints and the same evidence/verification gates.

In either mode, create an isolated worktree through `superpowers:using-git-worktrees` before Task 1 and do not merge automatically after Task 17.