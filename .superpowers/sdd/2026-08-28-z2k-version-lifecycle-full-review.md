---
id: z2k-version-lifecycle-full-review
title: "Z2K version lifecycle full review"
type: doc
status: current
authority: evidence
updated: 2026-08-28
publish: false
tags: [z2k, lifecycle, runtime, rollback, catalog, ui, browser, router]
---

# Z2K version lifecycle full review

## Scope and verdict

This is a fresh adversarial review of the Z2K version lifecycle on
`codex/z2k-version-lifecycle`. The review covered the existing canonical
Resource Center flow, Asset Registry, runtime-assets bridge, catalog/details
RPCs, Components UI, and lifecycle tests. No parallel updater, catalog,
registry, route, or CHECK_STATE owner was introduced.

**Verdict: NOT READY.** The source and focused gates are repaired, but the
required live browser confirmation and current-code router lifecycle have not
been completed because the Codex in-app Browser currently shows the router's
`Authorization Required` form and there is no available authenticated tab.

## Initial repository state

- Branch: `codex/z2k-version-lifecycle`
- HEAD at review start: `2db63158f73a5569e8103934215c20dcb367b900`
- Worktree was clean at review start.
- The original `G:\zapret2-manager` checkout was not modified.
- Changes were made in the isolated `G:\z2m-z2k-version-lifecycle` worktree.

## Root-cause evidence

The mandatory P0 runtime probe was run before relying on implementation
claims. It showed a real activation gap:

- Registry-selected r79.7 Lua SHA values did not match the corresponding
  `/opt/zapret2/lua/*.lua` bytes.
- For example, `z2k-modern-core.lua` was registry SHA
  `5f4b5312...da08c7`, while the active runtime was
  `3ca245e8...6e91`; `z2k-detectors.lua` and `z2k-state-persist.lua` also
  differed.
- The running `nfqws2` PID `7943` command line explicitly loaded the active
  `/opt/zapret2/lua` paths and `/opt/zapret2/files/fake/quic_1.bin`.
- `quic_1.bin` happened to match, but that did not prove the changed Lua
  assets were active. The existing update flow had no activation bridge.
- `zapret2` and `zapret2-manager` were running and nftables had queue `300`,
  so the failure was specifically Registry-to-runtime activation, not merely
  service availability.

The review also found that the old receipt did not carry per-asset
`sourceCommit`, `sourcePath`, `bundleId`, and `version`, so a strict shared
installed-release authority must report the current historical identity as
unknown until a new-format lifecycle operation writes a receipt. This is
intentional fail-closed behavior, not an invented release baseline.

## Implemented repair

The existing canonical flow now performs:

1. immutable release/tag and manifest resolution;
2. prepared target creation with target version, operation, installed
   baseline, target gate, removal mappings, and local fingerprint;
3. explicit confirmation from that prepared target;
4. staged Registry update with source identity and per-asset receipt fields;
5. Registry postflight;
6. atomic materialization from Registry-selected bytes into the active
   `/opt/zapret2` runtime roots;
7. `zapret2` restart/reapply, `nfqws2` PID and nft queue postflight;
8. runtime byte/size postflight;
9. coordinated runtime plus Registry rollback on activation, postflight, or
   CHECK_STATE-clear failure.

The materialization bridge validates source root, SHA-256, byte size, safe
runtime target, and removal paths before an atomic swap. A fault-injection
hook proves the previous runtime remains intact when activation fails.

The installed-release authority is shared by catalog, status, details,
prepare, and apply. It returns `value`, `confidence`, and `authority`; it
requires the current Registry bytes and provenance to match the receipt and
rejects extra active assets from the managed Z2K bundle.

Prepare now resolves fresh catalog identity and verifies the selected target
gate. Apply rejects a changed operation or installed baseline, not just a
stale version/token. Thus an operation changed between details and prepare
cannot silently become a different operation at confirmation time.

`releaseChanges` now compares the full immutable `UPDATES.json` maps for the
actual previous upstream release. `installChanges` remains the exact-managed
comparison against the confirmed installed release. On live data, r80.2 to
r80.3 is `33 modified / 0 added / 0 removed`; the previous implementation
incorrectly reduced this to zero by filtering release history to exact-managed
files.

Catalog cache is volatile (`/tmp`) with a bounded TTL. Browse-only stale
data may be shown as stale; fresh prepare resolution fails closed. Human
changelog metadata uses the compact `/git/commits/<sha>` endpoint and the
selected release body is kept separate from technical details.

The UI changes use the four requested design reviews: Emil Design Engineering,
Design Consultation, Design Review, and Web Interface Guidelines. The result
keeps one primary operation action, uses semantic buttons and disclosure
attributes, exposes a real accessible release-details region only when there
are known non-zero release changes, avoids fake zero-history actions, uses
operation-specific confirmation/toast copy, and retains the existing
Components ownership and responsive layout.

## Focused verification

Passed:

- New full lifecycle review suite: **32/32**.
- Existing Z2K version/UI lifecycle focused suite after updating stale
  expectations to the prepare-before-confirm contract: **59/59**.
- Shell syntax check for
  `strategy-runtime-assets-sync.sh`: passed.
- JavaScript syntax checks for `z2m-maintenance.js` and
  `z2m-components-model.js`: passed.
- `git diff --check`: passed.
- `node scripts/validate-knowledge.mjs docs`: passed.
- Local activation sandbox: selected bytes copied into live roots.
- Local activation fault injection: previous runtime bytes remained intact.

The new 32 checks include Registry-to-runtime activation, PID/nft reapply
contracts, coordinated rollback, strict receipt identity, extra-asset
rejection, unknown install history, full upstream release diff, compact Git
endpoint, volatile cache, fresh resolve, prepare/apply TOCTOU protection,
target-specific gating, accessible Details behavior, and primary confirmation
semantics.

## Broad baseline comparison

The exact broad command was run in both worktrees:

`$files = @(Get-ChildItem tests/product,tests/ui -Filter 'z2k-*.test.mjs' -File | ForEach-Object FullName); node --test $files`

- Isolated baseline at `2db63158f73a5569e8103934215c20dcb367b900`:
  **78 total, 69 pass, 9 fail**.
- Current worktree after the review tests and repairs:
  **100 total, 91 pass, 9 fail**.

The nine baseline classes remain: one stale refresh-state assertion, five
native shell materialization checks that cannot launch `/bin/sh` on Windows,
one stale signed-fixture assertion, one pre-existing classification
expectation, and one UI contract file that cannot start because this checkout
has no `vitest` dependency. The current branch adds 22 behavioral checks and
does not add a broad failure class.

## Router evidence and current boundary

The reviewed files were deployed to `root@192.168.1.1` using the existing
staging/backup procedure. Local-to-installed SHA checks passed for the changed
frontend, Asset Registry, Resource Center, runtime bridge,
`z2k-installed-release.uc`, and `z2k-versions.uc`; the router shell syntax
check passed. The final `z2k-versions.uc` installed SHA was
`c0058e4c49b583a5e21f804f953f7cc1613b845cf78efc6f840ae80c5c28d63c`.

Read-only live details after that deployment prove the data contract:

- selected `r-80.3`, immutable commit
  `8f3787aa999dd00ffe76871c5f343a1c049973b1`;
- human release body is present;
- `previousVersion=r-80.2`;
- `releaseChanges.known=true`, `modified=33`, `added=0`, `removed=0`;
- compare URL is
  `https://github.com/necronicle/z2k/compare/r-80.2...r-80.3`;
- selected target is `targetCanApply=true` with a non-blocking advisory for
  `files/z2k-config-validator.sh`;
- the old receipt is rejected by the stricter authority, so
  `installChanges.known=false` and `installedVersion=null` until a new-format
  operation is successfully applied.

The read-only router projection still reports materialized integrity
`verified`, Lua `7/7`, Registry revision `7`, and r79.7 provenance from the
existing state, but the new receipt authority correctly reports unknown
confidence because that old receipt lacks the required per-asset identity.
No mutation was performed in this review after the new code deployment.

### Registry postflight versus runtime postflight

These are separate gates in the implementation and must not be conflated:

- Registry postflight is implemented and locally contract-tested, but has not
  been produced by a current-code router lifecycle in this review because the
  browser could not authenticate.
- Runtime postflight is implemented and locally sandbox-tested, but has not
  been produced by a current-code router lifecycle in this review. The P0
  mismatch above is the pre-fix evidence that made this gate necessary.

## Browser acceptance blocker

The required Codex in-app Browser URL is:

`http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager#/components`

A fresh in-app tab was opened and shows:

- `Authorization Required`
- Username
- Password
- Log in

`openTabs()` returned no existing authenticated user tab. No password or
stored credential was inspected or guessed. The required current-code browser
cases therefore remain unverified:

- install r79.7 to establish a new-format receipt;
- exact r79.7 installed / r80.3 selected case with the real human changelog,
  33 release changes, and a real accessible «Подробнее» region;
- upgrade r79.7 → r80.3;
- downgrade r80.3 → r79.7;
- reinstall r79.7;
- runtime bytes, selected Lua/strategy assets, queue/autocircular behavior,
  PID replacement, and rollback after a negative activation fault.

## Final verdict

**NOT READY.** The root-cause fixes and focused tests are in place, and live
read-only RPC data now exposes the intended immutable release/change contract.
The release cannot be called ready until an authenticated in-app Browser
session runs the requested upgrade/downgrade/reinstall flow on the router and
the resulting Registry postflight and runtime postflight evidence are
captured separately. Once the user logs into the open router tab, the exact
browser gate can continue without changing the implementation scope.
