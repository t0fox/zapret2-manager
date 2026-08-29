---
id: global-update-source-phase-b-integration
title: "Global Update Source Phase B Integration Evidence"
type: doc
status: current
authority: evidence
updated: 2026-08-29
publish: false
tags: [update-source, phase-b, z2k, router, browser, lifecycle]
---

# Global Update Source — Phase B integration

This is the delivery record for the Z2K adapter that completes the Phase A
shared metadata architecture. The feature branch was based on
`bf3b56c63641d582a3dbad3bdaf4b7db9d0aa857`, included the normal
`--no-ff origin/main` synchronization, and was delivered as feature commit
`a01e8b7cb443ffb8a0e36dbcc1f84c5056f02464` followed by main merge commit
`6c00c222952d27d5eab10f845c9e25c01c69165a`.

## Delivered architecture

`update-source.uc` is now the single metadata coordinator for Telegram,
official Engine, BlockCheckW, and Z2K. Z2K catalog browsing, selected-tag
resolution, immutable `UPDATES.json` manifest validation, and Compare evidence
use source-keyed coordinator cache/status/lock/rate state. Product ownership
remains unchanged for selected asset downloads, staging, verification,
activation receipts, registry state, postflight, runtime health, and rollback.

The Z2K contract is explicit:

- BROWSE may return fresh or stale valid catalog LKG and performs zero network
  requests on a warm hit.
- REFRESH performs one bounded catalog attempt and retains valid LKG on failure.
- FRESH resolves the selected tag, dereferences an annotated tag only within
  the bounded REST budget, fetches the immutable manifest by commit, and fails
  closed on unavailable or incomplete metadata.
- Compare is fetched through the shared `github-rest` source and stores only
  product-normalized evidence; it is not a second transport/cache authority.
- `contentSha256`, source identity, repository, origin, and immutable commit
  binding are retained through validation and lifecycle planning.

The production router transport audit found that `/bin/uclient-fetch` supports
`--header` but not `-H`, and does not expose response headers. Production code
uses `--header=` conditionally and does not use `-q`, allowing `HTTP error NNN`
classification. Generic 403 without authoritative rate evidence remains
ordinary `EHTTP`; cooldown state is activated only by explicit 429 or
remaining-zero evidence, with nullable unknown fields.

## Local verification

The final scoped WSL UCode run passed 45/45 tests, including the coordinator,
Z2K integration, selected details, Compare budget, and lifecycle ownership
contracts. `node --check` passed for changed MJS tests, `sh -n` passed for the
transport fixture, `git diff --check` passed, and both knowledge gates passed:
`node scripts/validate-knowledge.mjs` and `node scripts/docs.mjs verify`.

The broader Z2K suite was compared against the starting main checkout:
153/158 passed on both feature and main, with the same five pre-existing
failures (`Refresh-state regression`, the paragraph-length presentation test,
the shared normalized Compare dataset test, the pinned-key fixture test, and
the adapted/ignored-file classification test). The affected UI suite likewise
had the same single pre-existing CSS expectation failure on both sides (98/99
feature versus 95/96 baseline because the feature adds three contracts).
Telegram, Engine, BlockCheckW, Resources, and the scoped UI/product gates
passed their recorded focused runs; no new failure was introduced by this
integration.

## Router source-only deployment

The live target was `root@192.168.1.1`, OpenWrt 25.12.5,
`cudy,wbr3000uax-v1-ubootmod`. Deployment used `scp -O` to a staged directory,
then installed files with `root:root` and mode `0644`. Backups were retained
at `/tmp/z2m-global-update-source-backup-20260829-160059` and the later
`z2m-global-update-source-backup-20260829-160734` for the corrected
`z2k-versions.uc`. The deployed file hashes were:

| File | SHA-256 |
| --- | --- |
| `update-source.uc` | `2ae806e150a1c7fb90c1392212339087eb1818801384f141f975925b598add6b` |
| `z2k-versions.uc` | `e8136b5f5faaed4afbcfd9002843a5930c1492a2cae22c2d5fbb7c7ce5677332` |
| `z2k-upstream.uc` | `45df93581af10e1af6ff5534fe661e68368ef49402a9c304a0eb51eba0fea690` |
| `resource-update-cli.uc` | `2493221cdc2bfa325564e4f64e853b17540de47aabbb2fadfd05f466ef33672f` |
| `zapret2-manager.uc` RPC plugin | `7d140eeea9103986f40ce6bf799b608a2d5839e31dc90e08b82e082e6779d828` |

The live CLI resolved `r-80.3` through the initialized exact-version export,
using `requestCount=3`, `restRequestCount=2`, and
`resolution=selected-tag`; its target plan was available and advisory review
was non-blocking. No rpcd reload was required: ubus used the deployed code,
the existing rpcd remained alive, and the running `nfqws2` process remained
healthy.

## Browser and real lifecycle acceptance

The authenticated LuCI Components page at `#/components` rendered the shared
Z2K version selector, immutable-manifest-backed details, change explanation,
and confirmation modal. The following real router operations completed:

| Operation | Router job | Result |
| --- | --- | --- |
| Upgrade `r-79.7` → `r-80.3` | `z2k-1788009028-756021d3c58e6323` | `ok=true`, 39 planned/downloaded/verified/applied, 6 removed, registry and runtime postflight matched |
| Downgrade `r-80.3` → `r-79.7` | `z2k-1788009161-d362c6c9e85f1d15` | `ok=true`, 43 planned/downloaded/verified/applied, 2 removed, registry and runtime postflight matched |
| Reinstall `r-79.7` | `z2k-1788009275-1d7ba496665bdd7d` | `ok=true`, revision 13, 43 planned/downloaded/verified/applied, zero removed, registry and runtime postflight matched |

After reinstall, `resources_status` reported installed release `r-79.7`,
revision 13, `preparedTarget=null`, confirmed activation provenance, and
integrity-verified assets. Pause and lifecycle lock were cleared, and `nfqws2`
was still running. The browser then showed `r-79.7` as installed with the
correct `Переустановить r-79.7` action. A separate check-only refresh updated
the check timestamp; the remaining `Доступно обновление` state is correct
because the selected installed release is older than the listed latest
release. The router's unrelated LuCI “No password set!” warning remains
outside this task.

No APK/package operation, package installation, force push, or second Z2K
database/receipt authority was introduced.
