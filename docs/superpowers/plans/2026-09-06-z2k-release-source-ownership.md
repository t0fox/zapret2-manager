---
id: z2k-release-source-ownership
title: "Z2K release/source ownership regression repair"
type: plan
status: active
authority: user-approved-contract
updated: 2026-09-06
publish: false
tags: [z2k, lifecycle, rpc, ui, router]
---

# Z2K release/source ownership regression repair

This plan executes the approved design in
`docs/superpowers/specs/2026-09-06-z2k-release-source-ownership-design.md`.
It is intentionally main-only, APK-free, and preserves current runtime/LKG
state on any failed mutation.

## 1. Baseline and root cause

- Record `main`/`origin/main`, package versions, `ubus -v list`, browser
  Network/Console, `logread -e rpcd`, and direct calls for every affected RPC.
- Map each affected LuCI call through `z2m-api.js`, rpcd, UCode, and CLI.
- Capture current release/source/runtime identities and current/LKG pointers.

## 2. RED tests

Add focused tests before production edits for:

- `r-*` and `p-*` parsing, authoritative numeric/chronology ordering,
  installed-outside-window behavior, and fresh manifest/tag inconsistency.
- Z2K direct source refresh returning `EMANAGED`; Core coordinator being the
  only source activation path.
- Compatibility identity propagation and strategy apply mismatch rejection.
- Atomic candidate/LKG rollback and semantic active-pool preservation.
- Bounded read-only JSON and UI error/loading settlement, including Telegram
  health and separator encoding.

Run each new test and preserve the RED output before changing production code.

## 3. Minimal implementation

- Extend `z2k-versions.uc` release parsing, authoritative catalog metadata,
  latest derivation, manifest validation, and operation comparisons.
- Add Core-owned identity/provenance to source snapshots, compiled entries,
  resource activation, receipts, and strategy state/apply checks.
- Reject the independent Z2K refresh RPC and route Core lifecycle preparation
  through the existing transaction coordinator.
- Keep generation, Asset Registry, runtime activation, and rollback as the
  existing single authorities.
- Normalize rpcd/UCode exception boundaries to bounded JSON errors.
- Fix LuCI promise settlement and error rendering in `z2m-api.js` and the
  affected strategy/resource/Telegram/log views; remove mojibake.

After each logical change, run the new test first, then the related existing
suite. Never hide a backend error with a network placeholder.

## 4. Verification

Run focused product/UI/RPC/Z2K suites, the validator, `git diff --check`, and
the repository's non-APK build/static checks. Explicitly do not run or publish
an APK build.

Perform adversarial self-review against the design and inspect the final diff.
Because the requested execution is no-agent/main-only, no reviewer agent is
created; review evidence is recorded as local self-review.

## 5. Router delivery and acceptance

- Push the verified source to `main`, prove `HEAD == origin/main`, and deploy
  only the assembled current manager files/package through the normal safe
  path. Do not erase the current/LKG runtime and do not full-reboot the
  router.
- Re-run all baseline RPCs and browser checks, then use the normal Z2K Core
  lifecycle to update/reconcile `z2k:z2k_all_in_one`.
- Prove eight catalog records, canonical ID/`entryKind`, complete effective
  `NFQWS2_OPT`, dependency closure, native checks, one `nfqws2`, NFQUEUE 300,
  nft rules, clean Lua/blob/hostlist/ipset logs, and strategy persistence.
- Capture timestamped LAN evidence for TLS/RKN, YouTube, GoogleVideo,
  UDP/443 QUIC, and Discord Voice: client result plus router counters,
  conntrack, and brief packet evidence. Page/HTTP success alone is not proof.
- Report any unavailable gate as NOT_RUN/BLOCKED; use no `PASS` or READY
  verdict without all required evidence.

## 6. Delivery

Commit task-owned changes directly on `main`, push without force, and report
root cause, changed files, exact commands, commit/digests, test counts,
router/browser evidence, and remaining blockers. On any failed live mutation,
retain and verify current/LKG state before stopping.
