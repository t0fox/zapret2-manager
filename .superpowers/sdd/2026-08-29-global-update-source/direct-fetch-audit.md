---
id: global-update-source-direct-fetch-audit
title: "Global Update Source Direct Fetch Audit"
type: doc
status: current
authority: evidence
updated: 2026-08-29
publish: false
tags: [update-source, direct-fetch, audit, metadata, artifacts]
---

# Direct-fetch audit

Scope: production code reachable from Telegram Proxy, the official stock
Engine CLI/RPC path, and BlockCheckW. A URL literal is not a fetch bypass; the
classification below distinguishes request descriptors from transport calls.

| Path | Remaining remote path | Classification | Evidence |
| --- | --- | --- | --- |
| `proxy-provider.uc` | GitHub releases URL is passed to `update-source.uc` | MIGRATED VIA COORDINATOR | `metadata_request` + `source_metadata` select BROWSE/REFRESH/FRESH. |
| `proxy-provider.uc` | `download_verified_artifact` downloads selected archive | INTENTIONAL MUTATION_CONTENT | Direct fetch remains bounded by artifact URL, digest/checksum validation, staging, and rollback. |
| `engine-catalog.uc` | Official `bol-van/zapret2` releases URL is passed to coordinator | MIGRATED VIA COORDINATOR | `catalog` selects BROWSE or FRESH/REFRESH through `update-source.uc`. |
| `engine-operation-worker.sh` | Selected Engine archive and checksum assets | INTENTIONAL MUTATION_CONTENT | Existing staged worker trust path remains separate from metadata cache. |
| `blockcheckw-cli.uc` | `rcd27/blockcheckw/releases/latest` is passed to coordinator | MIGRATED VIA COORDINATOR | `latest_release` selects BROWSE/REFRESH/FRESH. |
| `blockcheckw-install.sh` | Selected BlockCheckW archive/checksum | INTENTIONAL MUTATION_CONTENT | Existing installer archive and checksum verification remains authoritative. |
| `engine-providers.uc`, `providers/andrevich.uc`, `providers/remittor.uc` | Historical alternate API/raw feeds | LEGACY/DEAD | No import from official `engine-cli.uc` or `zapret2-manager-engine.uc`; official authority remains `engine-manager.uc` → `engine-catalog.uc`. |
| `z2k-versions.uc` | Z2K catalog, selected-tag resolution, immutable manifest, and Compare evidence | MIGRATED VIA COORDINATOR | Catalog/tag/manifest/Compare metadata uses `update-source.uc` with source-key and origin separation; Compare keeps only product-normalized evidence cache. |
| `z2k-upstream.uc` | Branch `UPDATES.json` used during untrusted candidate preparation | MIGRATED VIA COORDINATOR | Branch manifest metadata uses the shared `raw-content` source; selected candidate asset bytes remain mutation content. |
| `resource-update.uc` | Selected Z2K asset bytes by pinned commit | INTENTIONAL MUTATION_CONTENT | Asset downloads remain product-owned and are bounded by target manifest membership, digest verification, staging, postflight, and rollback. |
| `list-fetcher.uc` | ETag/Last-Modified content-data path | OUT-OF-SCOPE CONTENT_DATA | Keeps its own validation/LKG/304 contract. |

The static migration contract searches all three original metadata consumers,
the official Engine path, legacy provider reachability, artifact slices, flash
paths, and the Z2K coordinator adapter. The focused coordinator gate passed
29/29 in WSL UCode. There is no unexplained production metadata
`uclient-fetch` bypass for Telegram, Engine, BlockCheckW, or Z2K.

## Production transport evidence

The deployed router is OpenWrt 25.12.5 on `cudy,wbr3000uax-v1-ubootmod`.
Its `/bin/uclient-fetch` supports `-O`, `--header`, `--timeout`, and quiet
mode, but does not support curl's `-H` spelling and does not expose response
headers. The production coordinator therefore uses `--header=` only when
conditional request metadata exists and intentionally does not pass `-q`, so
`run()` can parse the transport's `HTTP error NNN` diagnostic.

The live probes were bounded: `/rate_limit` returned a valid 200 JSON response;
a safe missing GitHub resource returned `HTTP error 404`; an explicit fixture
429 is classified as rate limiting with nullable remaining/reset values. A
generic 403 without authoritative rate headers remains ordinary `EHTTP`; the
coordinator never fabricates rate remaining/reset data. Only explicit 429 or
authoritative remaining-zero evidence can activate an origin cooldown.

The coordinator intentionally owns metadata only. Release archives, checksum
files, binary staging, package installation, health gates, and rollback remain
with their product owners.
