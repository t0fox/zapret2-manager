# PERF-1 Report

## Status

Implementation is complete in isolated worktree `G:\\z2m-perf1` on branch `codex/perf-1`. No commit was created and the original `main` checkout was not modified.

## Root cause

The LuCI hot path mixed diagnostic reads with frequent runtime reads. Engine-gated modules called the heavy `engine_status` path, Control used the full service status and catalog list to resolve one active Strategy, tab data was retained only in an unbounded in-memory object, and Scanner Hub repeated the two status RPCs during render after `load()` had already fetched them. The full status collector performs process, UCI, nft, checksum, package/version, and Strategy-catalog discovery; engine status performs package/provider/version/file discovery.

## Implementation

- Added independent filesystem-only `engine_gate_status` and wired EngineGate/API/rpcd/ACL to it. The existing full engine status remains available for engine management. The target had an older engine backend, so the final helper intentionally does not import engine-manager or provider discovery.
- Added bounded `status-fast.v1` runtime collector using `/proc`, NFQUEUE, and readonly durable active-Strategy identity. The full compatibility collector remains unchanged and authoritative for diagnostic fields.
- Switched Control and frequent Strategies status reads to `status_fast`, and resolved Control's active Strategy with targeted `strategies.get` before the compatibility list fallback.
- Added per-tab TTL cache with explicit invalidation, force refresh, inflight dedupe, session-key invalidation, stale-inflight protection, and TTL 0 for active pages.
- Scanner Hub now reuses `load()` status results, starts one bounded poller, and clears stale job state and timers on lifecycle transitions.
- Added regression contracts and fast-status Control fixtures.

## TDD and verification evidence

The new PERF-1 contract suite was first run against the baseline and produced 6 expected failures: missing cheap gate, missing fast collector/API, list-first Control resolution, repeated Scanner status calls, and missing TTL helper behavior. After implementation:

```text
node --test tests/ui/perf-1-contract.test.mjs \
  tests/ui/p02-control-model.test.mjs \
  tests/ui/scanner-hub-ui.test.mjs \
  tests/ui/scanner-workspace-history-handoff.test.mjs \
  tests/ui/scanner-workspace-multi-engine.test.mjs \
  tests/ui/p02-v3-control-visual-contract.test.mjs
tests 24
pass 24
fail 0
```

All changed frontend JavaScript passed `node --check`; both ACL files parsed as JSON; `git diff --check` passed.

The complete existing UI corpus was also run: baseline `201/224` passed with `23` known failures, and the PERF-1 worktree `211/234` passed with the same `23` failures plus the ten new PERF-1 tests. The known failures include pre-existing frontend closure/orphan checks and a brittle ACL expectation for `zapret2-manager-engine` in the main ACL object; they are outside this slice.

## Call-count evidence

These are source-contract counts per initial navigation, not claims of measured latency:

| Path | Before | After |
| --- | --- | --- |
| Engine-gated view | 1 heavy `engine_status` | 1 cheap `engine_gate_status`, then core load |
| Control status / active Strategy | 1 full `service.status` + 1 catalog list | 1 `status_fast` + 1 targeted `strategies.get` |
| Scanner initial statuses | 2 in `load` + 2 repeated in `render` | 2 in `load`, reused by `render` |
| Strategies initial status | 1 full `service.status` | 1 `status_fast` |

## Router deployment and benchmark

Read-only router identity was confirmed as OpenWrt 25.12.5, aarch64/mediatek-filogic. The deployed package is the pre-PERF-1 version: `status_fast` and `engine_gate_status` are absent. A read-only baseline over 20 calls measured:

- `zapret2-manager status`: 2.05 s batch time, 860 KB peak RSS;
- `zapret2-manager-engine engine_status`: 5.25 s batch time, 956 KB peak RSS.

The worktree was deployed as a controlled overlay to the exact package paths; no APK build was available on the Windows host (`OPENWRT_SDK` and `make` were absent). A rollback copy was retained on the target at `/tmp/z2m-perf1-backup-20260820-1`. The final PERF overlay files matched local SHA-256 hashes. Because the target carried an older engine backend, its pre-existing `engine-cli.uc` and `engine-manager.uc` were restored from that rollback copy; the independent gate helper does not depend on them. `rpcd reload` registered the new methods, `status_fast` returned `status-fast.v1/running`, and `engine_gate_status` returned `installed/runtimeContract=true`. The existing `status` and `engine_status` calls remained successful.

AFTER read-only batch benchmark over 20 calls:

- `zapret2-manager status`: 0.89 s, 952 KB peak RSS;
- `zapret2-manager-engine engine_status`: 5.47 s, 940 KB peak RSS;
- `zapret2-manager status_fast`: 1.80 s, 992 KB peak RSS;
- `zapret2-manager-engine engine_gate_status`: 0.07 s, 944 KB peak RSS.

The BEFORE and AFTER batches use the same target and 20-call command shape. Full `status` is cache-backed, so its wall time is sensitive to whether the existing status snapshot was fresh; this is reported as an observation, not a causal percentage claim. The measured result is that the new gate is substantially cheaper than full engine status, while the frequent status path is now bounded and avoids heavyweight discovery. The full status and engine status contracts remained operational after deployment.

## Scope boundaries

No package/release pipeline, Scanner top-K redesign, Strategy ownership change, or transaction/rollback change was performed. Router mutation was limited to the controlled overlay deployment and `rpcd reload`; the rollback copy remains on-target. The host has no `ucode` executable, so target ucode execution remains unrun locally.
