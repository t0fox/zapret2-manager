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
| `resource-update.uc`, `z2k-upstream.uc`, `z2k-versions.uc` | Z2K upstream/raw lifecycle sources | OUT-OF-SCOPE Z2K | Explicitly deferred to the parallel lifecycle branch. |
| `list-fetcher.uc` | ETag/Last-Modified content-data path | OUT-OF-SCOPE CONTENT_DATA | Keeps its own validation/LKG/304 contract. |

The static migration contract searches all three migrated metadata consumers,
the official Engine path, legacy provider reachability, artifact slices, and
flash paths. It passed as part of the 40/40 focused gate. There is no
unexplained production metadata `uclient-fetch` bypass for the three migrated
products.

The coordinator intentionally owns metadata only. Release archives, checksum
files, binary staging, package installation, health gates, and rollback remain
with their product owners.
