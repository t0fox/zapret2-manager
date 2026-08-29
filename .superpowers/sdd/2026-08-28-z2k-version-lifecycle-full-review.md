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

**Verdict: NOT READY.** The source and focused gates are repaired, and the
authenticated Codex in-app Browser now verifies the release details UI. The
required mutation lifecycle is currently stopped by the router's unavailable
fresh catalog network path; the fail-closed prepare contract correctly
performed no mutation.

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
changelog uses immutable `history[].desc` first and the compact
`/git/commits/<sha>` endpoint as fallback; the selected release body is kept
separate from technical details.

The UI changes use the four requested design reviews: Emil Design Engineering,
Design Consultation, Design Review, and Web Interface Guidelines. The result
keeps one primary operation action, uses semantic buttons and disclosure
attributes, exposes a real accessible release-details region only when there
are known non-zero release changes, avoids fake zero-history actions, uses
operation-specific confirmation/toast copy, and retains the existing
Components ownership and responsive layout.

## Focused verification

Passed:

- New full lifecycle review suite: **33/33**.
- Existing Z2K version/UI lifecycle focused suite after updating stale
  expectations to the prepare-before-confirm contract: **59/59**.
- Legacy receipt and cache-fanout regression assertions: **2/2** on this
  Windows checkout; the two native ucode behavioral tests are explicitly
  skipped locally because `/opt/ucode/bin/ucode` is absent and were run
  against the deployed router separately below.
- Shell syntax check for
  `strategy-runtime-assets-sync.sh`: passed.
- JavaScript syntax checks for `z2m-maintenance.js` and
  `z2m-components-model.js`: passed.
- `git diff --check`: passed.
- `node scripts/validate-knowledge.mjs docs`: passed.
- Local activation sandbox: selected bytes copied into live roots.
- Local activation fault injection: previous runtime bytes remained intact.

The new 33 checks include Registry-to-runtime activation, PID/nft reapply
contracts, coordinated rollback, strict receipt identity, extra-asset
rejection, unknown install history, full upstream release diff, compact Git
endpoint, volatile cache, fresh resolve, prepare/apply TOCTOU protection,
target-specific gating, accessible Details behavior, and primary confirmation
semantics.

The combined focused command is **90 total, 88 pass, 0 fail, 2 skipped**;
the skips are only the native ucode receipt cases unavailable on Windows.

## Broad baseline comparison

The exact broad command was run in both worktrees:

`$files = @(Get-ChildItem tests/product,tests/ui -Filter 'z2k-*.test.mjs' -File | ForEach-Object FullName); node --test $files`

- Isolated baseline at `2db63158f73a5569e8103934215c20dcb367b900`:
  **78 total, 69 pass, 9 fail**.
- Current worktree after the review tests and repairs:
  **105 total, 94 pass, 9 fail, 2 skipped**.

The nine baseline classes remain: one stale refresh-state assertion, five
native shell materialization checks that cannot launch `/bin/sh` on Windows,
one stale signed-fixture assertion, one pre-existing classification
expectation, and one UI contract file that cannot start because this checkout
has no `vitest` dependency. The current branch adds 27 checks (including two
native-only skips) and does not add a broad failure class.

## Root cause: GitHub request result and catalog fanout

The exact router reproduction was run without `-q`:

`uclient-fetch -v -T 20 -O /tmp/z2k-refs.json "https://api.github.com/repos/necronicle/z2k/git/refs/tags?per_page=100"`

It returned `rc=8`, no response body, and this complete stderr:

```text
Downloading 'https://api.github.com/repos/necronicle/z2k/git/refs/tags?per_page=100'
Connecting to 140.82.121.6:443
HTTP error 403
```

This is not evidence of a transport/TLS/DNS failure: the router resolved
`api.github.com` and established HTTPS, and the separate `/rate_limit` request
returned `rc=0` with a JSON body. Its relevant values were `rate.limit=60`,
`rate.remaining=0`, `core.remaining=0`, `core.used=60`, and
`core.reset=1787930573` (`2026-08-28 15:22:53Z`). There was no `429` or
`secondary-rate-limit` message, so the classification is **A: primary GitHub
rate limit**. No retry loop and no GitHub PAT/token requirement were added.

Before this repair, every non-fresh `z2k_versions()` call fetched the refs
endpoint even when a usable `/tmp` cache existed; on a cold cache, annotated
tags could add up to ten `/git/tags/<sha>` requests for the visible window.
Non-fresh browse now returns a warm cache first with router evidence
`requestCount=0`, `cache=warm`, `stale=false`; `fresh:true` still bypasses the
cache and remains fail-closed for prepare.

## Backward compatibility: legacy activation receipt

The deployed router's current receipt was read without mutation. Its exact
shape is `receiptKeys=[schema,bundleId,version,source,sourceCommit,activatedAt,assets]`
and `assetKeys=[id,type,sha256,byteSize]`, matching the pre-migration receipt.
The new validator accepts that legacy form only when each current Registry
asset and its `catalog/upstream` provenance prove the top-level bundle,
version, commit, and source path; extra active assets from the same bundle
invalidate it. New receipts still require the full per-asset identity.

Router behavioral proof after deploying the validator:

- real existing receipt: `{value:"r-79.7", confidence:"confirmed", authority:"activation-receipt"}`;
- read-only `details r-79.7`: `installed=true`, `installedVersion=r-79.7`,
  `operation=reinstall`;
- isolated negative copies: hash mismatch, wrong provenance version, wrong
  provenance sourceCommit, and extra same-bundle asset all returned
  `{value:null, confidence:"unknown", authority:null}`.

The operation helper used by `versionDetails` is also covered by the native
behavioral regression (`r-79.7` against `r-79.7` → `reinstall`). No Registry,
runtime, service, or receipt metadata was rewritten.

## Router evidence and current boundary

The reviewed files were deployed to `root@192.168.1.1` using the existing
staging/backup procedure. Local-to-installed SHA checks passed for the changed
frontend, Asset Registry, Resource Center, runtime bridge,
`z2k-installed-release.uc`, and `z2k-versions.uc`; the router shell syntax
check passed. The final `z2k-versions.uc` installed SHA was
`597045e375f52902c432796752187861b758d25e602671c61b7e41ca9edc8698`.

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
  fresh catalog request is unavailable.
- Runtime postflight is implemented and locally sandbox-tested, but has not
  been produced by a current-code router lifecycle in this review. The P0
  mismatch above is the pre-fix evidence that made this gate necessary.

## Browser acceptance and current blocker

The required Codex in-app Browser URL is:

`http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager#/components`

A fresh in-app tab initially showed `Authorization Required`. Clicking
`Log in` with the empty password field succeeded; the router explicitly shows
`No password set!`. No password or stored credential was inspected or guessed.

The authenticated browser now verifies:

- r80.3 has a clean human changelog body beginning `WARP больше не меняет
  настройки обхода...`, with no replacement-character prefix;
- `releaseChanges` exposes `Изменено 33`, `Добавлено 0`, `Удалено 0`;
- the `Подробнее` control expands a real DOM region
  `#z2m-z2k-release-details` with `role=region`, `aria-labelledby`, and
  `aria-expanded/aria-controls` linkage;
- selecting r79.7 displays `targetCanApply=true` behavior in the UI: the
  mutation action is enabled, with advisory-only review state and no blocking
  reason.

The earlier browser click on `Установить r-79.7` invoked `z2k_prepare_version`.
The live RPC returned `EUNAVAILABLE: Не удалось получить каталог Z2K releases.`
because fresh resolve correctly bypasses the stale browse cache. The exact
verbose router reproduction and `/rate_limit` classification above identify
the cause as primary GitHub rate limiting. No Registry/runtime mutation
occurred after this failure, and the current instruction explicitly keeps all
install/upgrade/downgrade/reinstall cases unlaunched.

The required current-code browser mutation cases therefore remain intentionally
unverified until fresh resolve is available and mutation is authorized:

- install r79.7 to establish a new-format receipt;
- exact r79.7 installed / r80.3 selected case after establishing the new
  receipt;
- upgrade r79.7 → r80.3;
- downgrade r80.3 → r79.7;
- reinstall r79.7;
- runtime bytes, selected Lua/strategy assets, queue/autocircular behavior,
  PID replacement, and rollback after a negative activation fault.

## Final verdict

**NOT READY.** The root-cause fixes and focused tests are in place, and the
authenticated browser now verifies the real r80.3 human changelog and
accessible Details region. The release cannot be called ready until the
router's fresh catalog network path is available and the authenticated browser
runs the requested install/upgrade/downgrade/reinstall flow. The resulting
Registry postflight and runtime postflight evidence must still be captured
separately.
