---
id: z2k-update-lifecycle-evidence
title: "Z2K update lifecycle backend evidence"
type: doc
status: current
authority: evidence
updated: 2026-08-28
publish: false
tags: [z2k, backend, router, resources]
---

# Z2K update lifecycle backend evidence

## Scope

This delivery is backend-only. LuCI frontend production files and UI tests are
intentionally outside the change because another agent owns that work.

## Root cause

`z2k_upstream_plan()` previously collapsed exact-managed updates, adapted drift,
and all watched-file drift into one legacy precedence status. The changed
`files/z2k-config-validator.sh` entry is not a Z2M runtime asset and has no
production consumer, so its drift incorrectly hid update availability and
caused `EZ2K_REVIEW_REQUIRED`. The checked result also used static
classification release metadata instead of the validated `manifest.current`,
and `resources_update` performed a second network check, creating a check/apply
race.

## Backend changes

- Generated watched-file metadata now carries explicit `reviewPolicy`.
  `files/z2k-config-validator.sh`, `files/z2k-geosite.sh`, and
  `files/z2k-update-lists.sh` are bounded `advisory` entries; the two trust
  roots remain `blocking`. Missing or invalid policy is blocking in ucode.
- `z2k_upstream_plan()` is the canonical planner. It returns independent
  `updateState`, `attentionState`, `canApply`, review buckets, structured
  blocking reasons, and review details. Unknown future files fail closed.
- Component planning delegates policy to the canonical planner. The legacy
  component apply path also uses `manifest.current` for Asset Registry receipt
  and provenance version.
- Successful `resources_check` persists a deterministic bounded plan token with
  the checked snapshot. Z2K `resources_update` validates that exact snapshot and
  token, performs no second network check, and preserves the existing staging,
  SHA, candidate-gate, atomic apply, and postflight gates.
- Available release is derived from the validated `manifest.current`; `p-*`
  provenance remains technical provenance, not release identity.

## Router evidence

The final deployed backend hashes matched repository bytes:

| File | SHA-256 |
| --- | --- |
| `resource-update.uc` | `31679fc5fc14c5a8abb67c1a6bfa9ba2efd5decc627fcda1059a4c0fa6d63300` |
| `z2k-component.uc` | `43bd4f74f9c311afb5a73f08de3999ce2cd532bc0d00ed83920f3794fd10759e` |
| `z2k-upstream.uc` | `a54243eb3d4940e78615e060fcab416b481979286be2f7ac96b2636d4cabe578` |
| `z2k-integration.json` | `3e582d36ad1171ccf32a8ef6988d44359869dd27a4af7b6885b2fdd53d9176ab` |

Authenticated live `resources_check` returned:

- `ok=true`, `checkedAt=1787871660`;
- `planToken=z2k-plan-v1:1787871660:48:r-80.3`;
- `manifest.seq=48`, `manifest.current=r-80.3`, `availableRelease=r-80.3`;
- `status=current`, `updateState=current`, `attentionState=review-advisory`;
- `updates=[]`, `rebases=[]`, `blockingReviews=[]`, `blockingReasons=[]`;
- `reviews` and `advisoryReviews` contain only `files/z2k-config-validator.sh`;
- review reason is `watched-upstream-file-changed`, policy `advisory`, with the
  message that Z2M does not install this observed upstream file automatically;
- Z2K runtime is installed and healthy (Lua 7/7, integrity verified), while
  installed release identity remains explicitly unknown (`value=null`) because
  no valid activation receipt identifies it;
- source verification remains `allow-untrusted` with `verified=false`, as
  required by the existing contract.

Safe live action gates were also exercised. A wrong token returned
`ECHECK_STALE`; the current token returned `EUPDATE_NOT_AVAILABLE` because the
canonical snapshot had zero applicable updates. Neither path staged or mutated
assets. A successful update was not forced because the live checked snapshot
was already current; no artificial runtime drift was introduced merely to make
an update appear.

Runtime invariants after the check/gate probes: one `nfqws2` process (PID 7943),
QUEUE 300 registered with the expected nft rules, and
`/etc/zapret2-manager/state/autocircular/state.tsv` MD5 remained
`a7f2a248e5b99f8b06b32ff95cd68620`.

## Verification

- Focused backend suite: 25 passed, 0 failed.
- Final target ucode imports for all three changed runtime modules succeeded.
- `git diff --check`: passed.
- The broader suite has pre-existing unrelated Strategy catalog failures
  (`partial remote files are rejected`); CI was not awaited per instruction.
- Frontend/browser UI lifecycle acceptance is intentionally not claimed in this
  backend-only delivery.
