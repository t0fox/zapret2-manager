# Task 11 report: typed Detect RPC and schema-gated adapter

Status: IMPLEMENTED. No router deployment, live RPC/Detect execution, browser
acceptance, merge, or push was run. Unrelated UI and Scanner work was not
modified.

## Scope

Added the canonical `z2k_detect_status` RPC plus typed probe/classify/quic/
voice/tcp16 RPC wiring, ACL permission, and matching LuCI API methods. The
adapter now resolves the existing Registry receipt and runtime-composition
authority before production native invocation. Missing installation, legacy or
incoherent authority, unavailable Detect bytes, and Detect identity mismatch
are fail-closed with canonical errors; no `scanner_*` fallback is reachable.

The existing Task 10 bounded result validator remains the sole result-schema
authority. All five command fixtures cover malformed, truncated, non-object,
wrong-type, missing-required, valid, additive-field, timeout, and bounded
output cases. Additive fields inside valid upstream result objects survive;
missing or semantically wrong required fields return `EDETECT_SCHEMA`.

## TDD evidence

RED after adding Task 11 assertions and fixtures, before production changes:

```text
node --test tests/product/z2k-detect-rpc.test.mjs
1 failed, 1 passed, 9 skipped
Failure: missing z2k_detect_status RPC registration (expected).
```

GREEN focused command:

```text
wsl.exe -e bash -lc 'set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs'
```

Result: `58 passed, 0 failed`.

## Verification

- Receipt/authority/lifecycle/runtime support suites: `110 tests, 109 passed,
  0 failed, 1 existing TODO`.
- `node --check` passed for `z2m-api.js` and `z2k-detect-rpc.test.mjs`.
- ACL and protocol JSON parsing passed.
- `git diff --check` passed.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `node scripts/docs.mjs verify`: Quartz SHA verified
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- UCode imports and adapter seams passed through the WSL focused run with
  `/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`.

## Files and commits

Task-owned files:

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `tests/product/z2k-detect-rpc.test.mjs`

Implementation commit: `915816c72cc8c329853704eaa4a1aaf42c7e4c0e`
  (`feat: expose typed Z2K Detect RPC`).
Report commit: `5511cf311dc3113faf04342584ad980068b407ae` before this final
evidence-only amend; the final HEAD is reported by the handoff below.

## Boundaries

Router/OpenWrt deployment, live network Detect, authenticated ubus/RPC
acceptance, browser acceptance, package-E2E, merge, and push remain NOT_RUN.

## Fix-round 1 — independent-review corrections

### Findings addressed

- Removed the production rpcd Scanner adapter/import, all eight legacy Scanner
  registrations, their ACL entries, and the LuCI RPC declarations. The existing
  Scanner compatibility surface now returns a local canonical
  `EDETECT_UNAVAILABLE` result and cannot invoke the removed RPC or raw shell.
  Scanner state/worker modules remain untouched for the later UI/compatibility
  slice; the one changed Scanner UI line only removes stale legacy `nfqws2`
  wording from the bounded error hint.
- Replaced exact-field rejection with per-operation input normalization. Missing
  or mistyped required semantic fields return `EDETECT_SCHEMA`; safe additive
  fields survive the adapter result but are excluded from the fixed native
  argument object. Executable/argv/command/env/cwd/raw/shell/flags/path fields
  remain rejected as `EINPUT`.
- Added a bounded status normalizer requiring real `ok/coherent/schema/state`,
  installed release/source identity, fixed Detect path/architecture/digest,
  matching source commit, and runtime compatibility/bundle digests. Malformed
  or fake success cannot pass; bounded additive status fields survive. Unknown
  native error codes normalize to `EDETECT_FAILED`, while the nine canonical
  Detect/Z2K error codes are preserved.
- Removed duplicate `detectStatus`/`detectProbe`/`detectClassify`/
  `detectQuic`/`detectVoice`/`detectTcp16` client declarations. The six typed
  client methods now each declare exactly one canonical `z2k_detect_*` RPC.

### Fix-round TDD evidence

RED after adding the independent-review fixtures/assertions and before the
fix-round production changes:

```text
wsl.exe -e bash -lc "set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 180s node --test tests/product/z2k-detect-rpc.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs"
exit 1; 20 tests: 14 passed, 6 failed.
Failures were the still-registered legacy Scanner/raw-shell boundary, the
missing input normalizer export, and status success accepted without typed
identity validation (plus dependent assertions).
```

GREEN focused RPC/Scanner command after the fixes:

```text
20 passed, 0 failed
node --test tests/product/z2k-detect-rpc.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs
```

GREEN Scanner production-boundary/package regressions:

```text
17 passed, 0 failed
node --test tests/native/avatar-strategy-scanner-package.test.mjs tests/product/scanner-history-nfqueue-contract.test.mjs tests/product/scanner-start-order.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs
```

GREEN bounded Task 10/helper and receipt/lifecycle/runtime support gates:

```text
146 tests: 145 passed, 0 failed, 1 existing TODO
node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-runtime-readiness.test.mjs tests/product/z2k-runtime-summary.test.mjs
```

Additional checks passed: `node --check` for the changed client and focused
tests; ACL JSON parse; `git diff --check`; `node scripts/validate-knowledge.mjs`
(`Knowledge validation passed.`); and `node scripts/docs.mjs verify`
(`Quartz SHA verified: ab346fa66a895e12d63a308e70ce330ba795822a`). The focused
WSL runs imported the changed UCode adapter with
`/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`.

### Fix-round files

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `tests/product/z2k-detect-rpc.test.mjs`
- `tests/product/avatar-strategy-scanner-rpc.test.mjs`
- `tests/native/avatar-strategy-scanner-package.test.mjs`
- `tests/product/scanner-history-nfqueue-contract.test.mjs`
- `tests/product/scanner-start-order.test.mjs`
- this report

Implementation commit: `59d636e8` (`fix: close Task 11 Detect RPC review findings`).
The report is committed separately as the final handoff commit shown below.

### Fix-round boundaries

No router/OpenWrt deployment, live RPC/ubus invocation, live network Detect,
browser acceptance, package-E2E, merge, push, or model delegation was run.
The worktree remains limited to the typed Detect production boundary, its ACL/
client wiring, the required legacy-boundary assertions, and this evidence.

## Fix-round 2 — typed Detect-only Scanner UI boundary

### Findings addressed

- Removed the last `scannerUnavailable` helper and `api.scanner` object from
  `z2m-api.js`; the LuCI API now exposes no legacy Scanner compatibility
  surface.
- Replaced the Scanner view's old start/status/results/stop/resume/save flow
  with a bounded one-shot typed Detect flow. Every Detect invocation first
  calls `z2kDetectStatus` and requires the real coherent installed authority,
  then dispatches only to `z2kDetectProbe`, `z2kDetectClassify`,
  `z2kDetectQuic`, `z2kDetectVoice`, or `z2kDetectTcp16` with typed positional
  arguments. The UI parses only the bounded typed result envelope and renders
  actual returned fields; it does not synthesize strategy success or invoke a
  Scanner fallback.
- Removed all `ctx.api.scanner` consumers from `z2m-scanner.js` and
  `z2m-scanner-product.js`. History is now a bounded session projection of
  results produced by the typed Detect flow; generated-result handoff is local
  and explicit, while Strategy remains the owner of later mutation.
- Preserved canonical Detect error codes and bounded timeout/schema handling in
  the Scanner UI. Existing broad Scanner characterization assertions were not
  weakened.

### Fix-round TDD evidence

RED after adding the production-shaped UI/API assertions and before the
production migration:

```text
node --test tests/ui/scanner-detect-api-boundary.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs
exit 1; 9 tests: 5 passed, 4 failed.
Failures: scannerUnavailable/api.scanner still present and the Scanner
consumers had no typed Detect calls.
```

GREEN focused UI/API boundary:

```text
node --test tests/ui/scanner-detect-api-boundary.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs
9 passed, 0 failed
```

GREEN bounded WSL RPC/helper/authority/lifecycle/Scanner gate:

```text
wsl.exe -e bash -lc "set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-runtime-readiness.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs"
149 tests: 148 passed, 0 failed, 1 existing TODO.
```

GREEN Scanner package/history/start-order regressions:

```text
node --test tests/native/avatar-strategy-scanner-package.test.mjs tests/product/scanner-history-nfqueue-contract.test.mjs tests/product/scanner-start-order.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs
20 passed, 0 failed
```

The unchanged broad Scanner characterization command remained non-green:

```text
node --test tests/ui/scanner-start-race.test.mjs tests/ui/perf-2-regression.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/scanner-budget-contract.test.mjs tests/product/scanner-start-envelope.test.mjs
39 tests: 29 passed, 10 failed.
```

Those failures are recorded as baseline/legacy characterization boundaries,
not hidden: they assert the removed asynchronous Scanner record polling,
cancel/resume lifecycle, old Avatar layout/result strings, or a missing
BlockCheck child artifact; one PERF-2 Telegram-navigation failure is unrelated
to the touched Scanner/API files. No assertions were weakened to make the
typed boundary green.

### Additional checks and boundaries

- `node --check` passed for `z2m-api.js`, `z2m-scanner.js`,
  `z2m-scanner-product.js`, and all changed focused test files.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `node scripts/docs.mjs verify`: Quartz SHA verified
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- `git diff --check` passed.
- No router/OpenWrt deployment, live RPC/ubus invocation, live network Detect,
  browser acceptance, package-E2E, merge, push, delegation, or other model was
  run.

### Fix-round 2 files and commit

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- `tests/product/z2k-detect-rpc.test.mjs`
- `tests/product/avatar-strategy-scanner-rpc.test.mjs`
- `tests/ui/scanner-detect-api-boundary.test.mjs`
- this report

Implementation commit: `ef1e6d3d` (`fix: migrate Scanner UI to typed Detect API`).
The report is committed in the final documentation commit immediately after
this implementation commit; the exact final HEAD is recorded in the handoff.

## Fix-round 3 — stale Detect result race and typed-only evidence

### Findings addressed

- Added a monotonic Detect generation token to the Scanner start path. A new
  run increments the token and supersedes an older in-flight run; unmount marks
  the module disposed and invalidates all pending generations.
- Added generation/disposed checks after the coherent status/native Detect
  awaits and before every asynchronous state, history, evidence, and repaint
  mutation. History now records the request belonging to the completing
  generation rather than the mutable current request. Late or superseded
  completions are discarded without a refresh.
- Made `renderEvidence()` accept only the canonical `{ typedDetect: true,
  data: object }` envelope. Arbitrary legacy Scanner-shaped reports now fail
  closed to the bounded unavailable state panel; no legacy evidence row or
  strategy-result fallback is rendered.
- Added a faithful-loader test seam for injected DOM/session-storage/timer
  dependencies and production-shaped async UI tests for out-of-order
  completion, disposed unmount, and legacy evidence rejection. Existing
  assertions were preserved.

### Fix-round TDD evidence

RED on the reviewed base `d6128e76` after adding the generation/evidence
boundary tests and before the implementation:

```text
node --test tests/ui/scanner-detect-api-boundary.test.mjs tests/ui/scanner-detect-generation.test.mjs
7 tests: 3 passed, 4 failed.
Failures: renderEvidence had no typed envelope guard; runDetect/start had no
generation/disposed protection; a second in-flight run was blocked by the old
running guard; and an unmounted completion wrote Detect history.
```

GREEN focused UI/API and production-shaped async regression gate after the
implementation:

```text
node --test tests/ui/scanner-detect-api-boundary.test.mjs tests/ui/scanner-detect-generation.test.mjs
8 passed, 0 failed
```

### Bounded verification

The bounded WSL gate imported the UCode adapter/helper with the pinned UCode
runtime and ran RPC, native helper, receipt, authority, lifecycle, runtime,
Scanner boundary, and the new async UI tests:

```text
wsl.exe -e bash -lc "set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-runtime-readiness.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs tests/ui/scanner-detect-generation.test.mjs"
154 tests: 153 passed, 0 failed, 1 existing TODO.
```

The focused Scanner/package/history/start-order gate passed `25/25`. Node
syntax checks for the changed Scanner/test/harness modules, `git diff --check`,
`node scripts/validate-knowledge.mjs` (`Knowledge validation passed.`), and
`node scripts/docs.mjs verify` (`Quartz SHA verified:
ab346fa66a895e12d63a308e70ce330ba795822a`) passed.

The unchanged broad Scanner characterization gate remains non-green:

```text
node --test tests/ui/scanner-start-race.test.mjs tests/ui/perf-2-regression.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/scanner-budget-contract.test.mjs tests/product/scanner-start-envelope.test.mjs
39 tests: 29 passed, 10 failed.
```

The ten failures are existing characterization boundaries for the retired
Scanner record/polling/cancel lifecycle, old Avatar layout/result strings, and
the old Scanner-product BlockCheck import expectation. The one Telegram
navigation PERF-2 failure is unrelated to this Task 11 fix-round. A separate
module-factory characterization still reports the pre-existing missing
external `request` dependency in the unchanged `z2m-api` harness. The WSL
TODO is the existing Task 4 transaction-slice TODO (`candidate CAS
distinguishes unrelated revision changes`). The separate Scanner Hub UI
characterization also reports pre-existing ENOENT failures because
`z2m-scanner-hub.js` is absent from this checkout; it was not recreated or
substituted. No assertion was weakened and no production fallback was
restored.

### Fix-round files and commits

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `tests/ui/scanner-detect-api-boundary.test.mjs`
- `tests/ui/scanner-detect-generation.test.mjs`
- `tests/ui/support/luci-loader-harness.mjs`
- this report

Implementation commit: `ae855bab63695eda87338fe9b5c0de6be8ab015b`
(`fix: guard Task 11 Detect Scanner generations`).
The fix-round report is committed separately immediately after this
implementation commit; the final HEAD and worktree state are recorded in the
handoff.

### Fix-round boundaries

No router/OpenWrt deployment, live RPC/ubus invocation, live network Detect,
browser acceptance, package-E2E, merge, push, delegation, or other model was
run. Task 14 remains the owner of broader Scanner/shell compatibility cleanup;
this round only closed the Task 11 async UI boundary and typed evidence
rendering.
