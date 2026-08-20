---
title: Engine authority cleanup
date: 2026-08-21
status: verified-live
---

# Engine authority cleanup

## Architecture evidence

Before this slice the live production path was:

`Engine UI -> engine_providers -> engine-providers.uc -> Remittor / 1andrevich`

The canonical path after this slice is:

`Engine UI -> engine_releases/check/update lifecycle -> zapret2-manager-engine RPC -> engine-manager.uc -> engine-catalog.uc -> bol-van/zapret2`

The operation worker consumes only the official embedded `tar.gz` candidate and writes the canonical `engine-state.v2` record. It does not install an APK asset.

## Legacy audit

| Item | Classification | Evidence / reason |
|---|---|---|
| `engine-providers.uc` | C: legacy/unwired | No import or RPC exposure remains in the production manager/RPC/ACL path. Retained to avoid blind deletion. |
| `providers/remittor.uc` | C: legacy/unwired | Only imported by `engine-providers.uc`; no production consumer. |
| `providers/andrevich.uc` | C: legacy/unwired | Only imported by `engine-providers.uc`; no production consumer. |
| `z2m-engine.js` | C: legacy/unwired UI | No navigation/module consumer found; canonical page uses `z2m-engine-panel.js`. Retained for explicit follow-up removal. |
| `engine-gate.uc` | C: legacy/unwired helper | `engine_gate_status` is no longer exposed by the official RPC module. Retained pending broader cleanup. |
| `/etc/zapret2-manager/engine-provider.json` | B: migration compatibility state | No longer read by `engine-catalog.uc`; not deleted from the router in this slice. Package conffiles now name `engine-state.json`. |
| `engine-state.v2` | A: canonical | Official manager writes and reads this state with `installedOrigin=OFFICIAL`. |

No Forgejo, Scanner, DNS, Telegram Proxy, or second Scanner runtime was changed.

## Verification

- TDD RED was observed for the old provider contract and for the shadowed UI release-check handler; both regressions were fixed.
- Focused UI suite: 37/37 passed.
- `runtime-state-contract.test.mjs`: 6/8 passed; the two failures are pre-existing unrelated assertions for watchdog NUL parsing and legacy `runtime-status` service-state wording. Engine assertions passed.
- JavaScript syntax checks: `z2m-api.js` and `z2m-engine-panel.js` passed.
- `git diff --check`: passed.
- Live deployment: SCP protocol with temporary files and atomic `mv` replacement; no package install, reboot, or manual `insmod`.
- Live RPC after replacement exposes only `engine_releases`, `engine_status`, `engine_check`, install/update/downgrade/reinstall/uninstall, and operation methods. `engine_providers` is unavailable.
- Live status: `installedOrigin=OFFICIAL`, `installedRelease=v1.0.4`, runtime running, `bol-van/zapret2`.
- Live release check: `ok=true`, candidate `v1.0.4`, `updateAvailable=false`.
- Browser evidence: one visible System tab bar; Engine pane shows official provenance and no provider selector.
- `nfqws2` PID remained `4917`; NFQUEUE 300 was absent both before and after this Engine-only deployment and was not modified.
- DNS resolution and HTTPS fetch to the official GitHub API passed.

## Commits

- `8e0549c6` — official Engine UI/API/RPC/worker and package ACL wiring
- `482bd235` — official authority regression coverage
- `524e3cf9` — actionable UI release-check handler

This report deliberately does not claim the broader Scanner package/reboot/NFQUEUE lifecycle acceptance, because that work was outside this focused Engine slice.
