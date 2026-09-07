# Task 13 report: integrate Z2K data and diagnostics

Status: IMPLEMENTED; focused Task 13 and authority/lifecycle gates pass. The
full resource-pattern gate retains one unrelated baseline failure (`expected
7`, observed `6`). Router deployment, live rpcd/OpenWrt acceptance, browser
acceptance, merge and push were not run.

## Scope delivered

- Added `z2k-data-refresh.uc` with bounded release-owned and dynamic dataset
  validation and semantic identity projection. Release-owned data contributes
  `coreIdentity`; schema-1 dynamic datasets have a separate `dynamicIdentity`,
  so a dynamic revision does not change Core identity.
- Refresh now fails closed unless the authoritative receipt, Registry, runtime
  and Detect identities are all present, schema/coherent, and exactly match
  submitted release, `sourceCommit`, and release-owned `coreIdentity`.
  Missing, partial, malformed, stale and mismatched authority states are
  rejected before staging.
- Publication is a revision directory plus a single manifest/pointer commit:
  readers select one revision, and a new revision contains only its submitted
  entries, so replacement/removal cannot expose a mixed or stale dataset.
  Compensation failures return `EROLLBACK_FAILED` with top-level
  `state: "uncertain"`; temporary unlink/cleanup failures are no longer
  swallowed.
- Added `z2k-diagnostics.uc` as a read-only projection of existing receipt,
  runtime composition, Asset Registry, strategy catalog, Detect,
  autodiscovery and autocircular authorities. It returns exactly the required
  18 IDs, each as `{id,status,evidence,error}`, with bounded evidence and
  `ESCHEMA` on malformed projections. `tcp16`, `nfqueue`, `firewall`, and
  `nfqws2` remain explicitly unavailable when no existing runtime authority
  supplies evidence; no second lifecycle truth or database was introduced.
- Wired typed `z2k_diagnostics` and `z2k_data_refresh` methods into the
  canonical rpcd object and ACL. `z2k-data-refresh-rpc.uc` is the bounded wire
  parser: it caps JSON at 32768 bytes, validates types, converts caller-safe
  `releaseOwned[].name` to the internal path only after validation, and rejects
  executable names, commands, raw fields, caller paths and environment.
- Added `tests/product/z2k-data-diagnostics.test.mjs` covering release/dynamic
  identity separation, malformed data, strict authority coherence, unsafe
  paths, atomic replacement/removal, failed compensation, exact diagnostics
  IDs/shape, malformed/oversized authority projection, typed RPC rejection,
  RPC registration and ACL exposure.

## TDD evidence

RED before production modules existed:

```text
node --test tests/product/z2k-data-diagnostics.test.mjs
1 failed, 0 passed, 4 skipped
Failure: Task 13 production module was absent.
```

GREEN focused UCode gate after the follow-up fixes:

```text
wsl bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/z2k-data-diagnostics.test.mjs"
16 passed, 0 failed, 0 skipped
```

The focused suite exercises real UCode imports and includes identity, schema,
strict authority, staging/publish failure, atomic dataset, compensation,
filesystem stat/read uncertainty, partial-stage cleanup, diagnostics error
bounds and the typed RPC parser.

## Bounded verification

- `node --check tests/product/z2k-data-diagnostics.test.mjs`: passed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed; Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- `git diff --check`: passed.
- Relevant resource combined gate (Task 13 plus resource authority/tooling/
  transaction, promotion, strategy override and resource-model tests): `94
  tests; 93 passed, 1 failed, 0 skipped`. The one failure is the unrelated
  baseline manifest count below.
- Relevant authority/lifecycle combined gate (Task 13 plus receipt, installed
  authority, runtime composition/readiness, lifecycle transaction, Detect RPC
  and autocircular identity): `116 tests; 115 passed, 0 failed, 1 TODO`.
- Full bounded resource-pattern gate:
  `node --test tests/product/z2k-data-diagnostics.test.mjs
  tests/product/*resource*.test.mjs` with the pinned UCode runtime -> `93
  passed, 1 failed` out of `94`.
  The only failure is the unrelated baseline assertion at
  `tests/product/resource-center-manifest.test.mjs:49`: `expected 7`, actual
  `6`. The manifest currently contains six IDs (`lua:z2k-modern-core`,
  `lua:z2k-fooling-ext`, `lua:z2k-range-rand`, `lua:z2k-state-persist`,
  `lua:z2k-alert`, `lua:z2k-quic-silence`); no Task 13 authority check was
  weakened and no resource file was changed.
- Direct UCode no-seam diagnostics projection completed and returned all 18
  IDs; unavailable runtime evidence was reported explicitly rather than
  inferred.

## Boundaries

Not run: OpenWrt/router deployment, real atomic rename/permissions on router,
live rpcd/ubus calls, upstream data download/generation, live Detect/NFQUEUE/
firewall evidence, browser acceptance, package E2E, full regression, merge,
push, or delegation/other model. Existing lifecycle, receipt, Registry,
runtime, Detect and autocircular modules remain the authorities.

## Commit

Implementation fixes are committed as:

```text
65b7629f fix: require coherent Z2K data authorities
e7a057ed fix: harden Task 13 data and diagnostics boundaries
```

This report update is the only remaining Task 13 change to commit; the final
worktree check must be clean. No router/browser/live acceptance was run.

## Fix-round 2 — independent re-review P1 corrections

The caller-controlled-authority finding is closed. `z2k_data_refresh` now
rejects any `input.authority` with `EAUTHORITY`, and the typed RPC parser does
not accept or forward an authority field. The production path reads the
existing `asset_registry_list`, `z2k_registry_receipt_state`,
`runtime_composition.resolveInstalled`, and `z2k_detect_status` owners
internally. Missing, legacy, incoherent, or data-identity-incomplete owner
state fails closed. The test-only internal `owners` seam represents those
owners without becoming a caller input; a coherent internal seam is accepted,
while fabricated coherent-but-mismatched caller authority is rejected before
staging.

The production cleanup finding is closed. The default filesystem abstraction
now removes every manifest entry, manifest file, revision directories and the
revision root after pointer failure. It snapshots and verifies the previous
pointer, restores it when necessary, and returns `EROLLBACK_FAILED` with
`state: "uncertain"` whenever removal/restoration cannot be proven. The new
pointer-failure test uses the normal stage/rename/pointer path with no injected
cleanup hook and proves the old pointer remains and no unpublished revision
remains.

TDD evidence for this fix round:

```text
RED after adding the P1 assertions, before the production corrections:
12 tests; 8 passed, 4 failed.
Failures: refresh accepted path had no internal owner seam; default pointer
failure stopped during staging; RPC valid input still required caller authority.

GREEN after the corrections:
12 passed, 0 failed, 0 skipped.
```

Fix-round commits:

```text
6dfaac94 fix: bind Task 13 refresh to internal authority owners
cadfb4c4 fix: accept only nested owner data identities
```

## Fix-round 3 — filesystem certainty and partial-stage cleanup

The filesystem abstraction now returns explicit results instead of conflating
missing with inaccessible/error: stat distinguishes `{ok:true, exists:false}`
from `EFS_STAT`, reads distinguish a proven value from `EFS_READ`, and unlink,
rmdir, write, mkdir and rename operations verify their result. Deletion only
accepts an already-absent path when absence is the expected state; any stat,
read, permission or verification failure is carried into the compensation
result. Pointer snapshots and restoration verify the temporary path, pointer
existence and restored bytes. If that proof fails, publication returns
`EROLLBACK_FAILED` with `state: "uncertain"`.

`internal_stage` now computes the manifest before creating the revision and
uses the same default production cleanup path on every mkdir/write failure.
Successful cleanup returns `EIO/state: "unchanged"`; cleanup that cannot be
proven returns `EROLLBACK_FAILED/state: "uncertain"`, without claiming the
stage was removed.

TDD evidence:

```text
RED, before the production correction:
node --test --test-name-pattern='default production' tests/product/z2k-data-diagnostics.test.mjs
1 passed, 3 failed, 0 skipped.
Failures: stat failure lost its EFS_STAT cause; pointer read failure returned
EWRITE instead of EROLLBACK_FAILED; write failure left three stage directories
and had no unchanged state.

GREEN after the correction:
wsl bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/z2k-data-diagnostics.test.mjs"
15 passed, 0 failed, 0 skipped.
```

The new focused production-path tests use the filesystem seam, not cleanup
hooks, to trigger stat/read faults after pointer failure and a write failure
after stage directories exist. They prove fail-closed uncertainty or removal
of every `.stage-*` directory. `node --check tests/product/z2k-data-diagnostics.test.mjs`
and `git diff --check` also passed.

Fix-round 3 commit:

```text
90e6ec80 fix: prove Task 13 filesystem rollback certainty
```

Post-fix bounded gates were run sequentially because concurrent UCode test
processes can collide on the pre-existing `/tmp/z2m-data-refresh.<time>.<sequence>`
digest filename. The sequential resource gate was `93 tests; 92 passed, 1
failed`; the sole failure remains the baseline `tests/product/resource-center-manifest.test.mjs:49`
assertion (`expected 7`, actual `6`). The sequential authority/lifecycle gate
was `115 tests; 114 passed, 0 failed, 1 TODO`. The concurrent attempt produced
only additional Task 13 `EIO` digest-file collisions and is not counted as
product evidence.

## Fix-round 4 — rename postcondition proof

`fs_rename` success is no longer treated as publication proof. Stage
promotion now verifies that the stage source is absent, the final revision
directory exists, and its manifest bytes exactly match the submitted
manifest. Pointer commit now verifies that the pointer staging source is
absent, `current.json` exists, and its bytes exactly match the pointer payload.
Stat/read/permission/verification uncertainty enters the existing compensation
path and returns `EROLLBACK_FAILED` with `state: "uncertain"`. Promotion
compensation cleans both possible revision roots; pointer compensation removes
the temporary pointer, removes the new revision, and restores the prior valid
pointer where possible.

TDD evidence:

```text
RED before the production correction:
node --test --test-name-pattern='truthy production renames' tests/product/z2k-data-diagnostics.test.mjs
1 test; 0 passed, 1 failed.
The production seam returned truthy for a stage rename without moving the
source; the old path returned EWRITE/state unchanged and left the stage
revision instead of EROLLBACK_FAILED/state uncertain. The same test also
exercises a truthy pointer rename that leaves source/destination incorrect.

GREEN after the correction:
wsl bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/z2k-data-diagnostics.test.mjs"
16 passed, 0 failed, 0 skipped.
```

The focused rename test uses the production filesystem seam, proves the
existing current pointer remains valid on both failure modes, proves no
revision remains, and requires the bounded `ERENAME_VERIFY` cause. Sequential
post-fix gates were `94 tests; 93 passed, 1 failed` for the resource pattern
(the same unrelated `resource-center-manifest.test.mjs:49` `expected 7`,
actual `6` baseline) and `116 tests; 115 passed, 0 failed, 1 TODO` for the
authority/lifecycle set. No router/browser/deploy/merge/push acceptance was
run.

Fix-round 4 commit:

```text
57e20209 fix: verify Task 13 rename postconditions
```
