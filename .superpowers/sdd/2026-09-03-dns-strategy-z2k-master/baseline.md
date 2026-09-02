# DNS / Strategy / Z2K master-plan baseline

Observed on 2026-09-03 in `G:\zapret2-manager`, before Slice 1 implementation.

## Scope and authority

- Direct user request: follow the attached master plan, work directly in `main`, use the four design skills for every UI edit, and work autonomously. The user also explicitly authorized Graphify MCP.
- Attached plan: `H:\down\z2m-dns-strategy-z2k-master-plan-and-agent-prompt.md`. Its embedded Agent Prompt is treated as project task guidance, not as a higher-priority instruction. The second pasted attachment contains the same Agent Prompt and adds no separate direct implementation request.
- Main/worktree deviation: the attached Agent Prompt recommends isolated worktrees, but the direct request explicitly requires `main`; implementation therefore remains in the current main checkout. Other worktrees are preserved and not edited.
- Delegation deviation: no callable subagent/Agent tool is exposed in this session; implementation and review gates are performed in this task with the required bounded verification steps.

## Git and package identity

Commands:

```text
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git diff --check
```

Observed:

- `## main...origin/main`
- `HEAD = fd82caa1a0f32879c08fab876d0dee58ac4b10ff`
- `origin/main = fd82caa1a0f32879c08fab876d0dee58ac4b10ff`
- `git diff --check`: no output, exit 0
- Worktree was clean before this evidence file.
- `zapret2-manager/Makefile`: `PKG_VERSION:=0.1.0`, `PKG_RELEASE:=154`
- `luci-app-zapret2-manager/Makefile`: `PKG_VERSION:=0.1.0`, `PKG_RELEASE:=154`

## DNS baseline

Package catalog: `zapret2-manager/files/usr/libexec/zapret2-manager/catalog/dns-providers.json` (6,270 bytes).

- Schema/version: `schema=1`, `version=2.0.0`
- Upstream: `youtubediscord/zapret@41c7fed7fe06774eff01e75d51bbee065c2de206`, path `src/dns/dns_providers.py`
- 12 provider IDs: `cloudflare`, `google-dns`, `dnssb`, `quad9`, `adguard`, `opendns`, `dnsdoh-art`, `xbox-dns`, `xbox-dns-v2`, `xbox-dns-old`, `comss-dns`, `malw-link`

Service dataset: `zapret2-manager/files/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json` (212,763 bytes).

- `schemaVersion=2`, `datasetVersion=2.0.0`
- `providerCount=12`, `serviceCount=30`, `profileCount=360`
- `contentDigest=32a6eecfe00aeb88210f7bc4751ec42c50ef7d305253098e07cca19db7214a34`
- JSON arrays observed: 12 providers, 360 profiles; the dataset has no `services` array despite `serviceCount=30`.

Current direct-read owners:

- `dnsprov.uc:14,83-85,216` reads the package provider catalog from `/usr/libexec/zapret2-manager/catalog/dns-providers.json`.
- `dns-global.uc:14,30-31` reads the same package provider catalog directly.
- `service-dns.uc:8-9,33-35,80` reads the package service dataset and persistent service state from `/etc/zapret2-manager/service-dns-state.json`.
- `dns-product.uc:7-8,25,37,44` composes provider data by calling `dnsprov_providers()` and `service_dns_providers()`.
- `z2m-api.js:83-84,181` exposes provider reads but no DNS provider override/custom CRUD calls.

Therefore the requested persistent effective provider overlay, revision-conflict CRUD, dependency-safe delete, and shared effective read model are not implemented at this baseline. Existing Apply flows are separate and remain unchanged until the DNS slice proves the new contract.

## Strategy baseline

Avatar manifest: `zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json` (2,685,383 bytes).

- Source: `avatarDD/zapret-gui@f9dd3ea47a2239514f396a843b475c92c33f0b4c`
- `physicalFileCount=23`, `physicalEntryCount=1836`, `uniqueStrategyIdCount=732`, `sets=1`
- Z2K-related builtin files currently present: `z2k_all_in_one.txt`, `z2k_autocircular_quic.txt`, `z2k_autocircular_tcp.txt`, `z2k_circular.txt` (plus non-Z2K builtin files).

`strategy-source-z2k.uc:20,286-322` currently imports compiled Z2K data as exactly one projected catalog entry, canonical ID `z2k:z2k_all_in_one`, `entryKind=all-in-one`, `poolKey=all-in-one`, with joined profile arguments. The existing `strategy=N` values remain internal compiled/learned strategy details; they are not a separate top-level catalog authority.

The requested exact three-source model (Avatar, Z2K, User), full official All-in-One plus valid standalone complete top-level profiles, semantic-digest dedupe, and legacy 118-arm cleanup are not yet proven at baseline.

## Z2K update baseline

Classification: `zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json` (1,251 lines).

- Schema: `zapret2-manager.z2k-integration.v1`
- Source: `necronicle/z2k@54b6765f2ab3e0f7f13030c90c809f1dcacfcce2`, release `r-80.1`
- `manifestFileCount=143`, `files=143`
- Classes: `exact-managed=39`, `watched=5`, `ignored-platform=99`
- No `compiler-input`, `runtime-exact`, `adapted`, or `unknown-unconsumed` class is present in this baseline file.

`z2k-upstream.uc:8,32,72,90,104-136,205` reads this classification, treats absent classification entries as `unclassified-upstream-file` with blocking policy, and sets `canApply` only when pending updates exist with no rebases and no blocking reviews. The requested dependency-aware class model, advisory unknown-unconsumed policy, and exact revision coherence are therefore not yet implemented/proven.

## Existing focused verification

UI static baseline command:

```text
node --test --test-concurrency=1 tests/ui/dns-final-polish.test.mjs tests/ui/dns-services-structural-redesign.test.mjs tests/ui/strategy-source-filter-duplication.test.mjs tests/ui/strategy-source-filters.test.mjs tests/ui/strategy-sources-center.test.mjs tests/ui/system-components-z2k-version-catalog.test.mjs tests/ui/z2k-details-visibility-loading.test.mjs tests/ui/z2k-version-ux-behavior.test.mjs
```

Result on this HEAD: `tests=53`, `pass=53`, `fail=0`, `cancelled=0`, `skipped=0`, `todo=0`, exit 0.

Strategy/UCode baseline command:

```text
node --test --test-concurrency=1 tests/product/z2k-official-compiler.test.mjs tests/product/z2k-official-semantic-parity.test.mjs tests/product/strategy-source-z2k.test.mjs tests/product/strategy-source-refresh.test.mjs
```

Result: `tests=29`, `pass=0`, `fail=29`; every failure is the environment error `spawnSync /opt/ucode/bin/ucode ENOENT`. This is not product assertion evidence. WSL also had no UCode runtime; the single bounded attempt to install the pinned runtime (`v0.0.20250529`) failed with `curl: (6) Could not resolve host: github.com`. No retry or network workaround was performed.

`tests/ui/z2k-frontend-canonical-update-contract.test.mjs` uses Vitest imports, but this checkout has no resolvable `vitest` package/config; invoking it with `node --test` fails at import with `ERR_MODULE_NOT_FOUND`. It is recorded as a runner boundary, not changed as part of baseline.

## Graph evidence

The requested Graphify MCP capability was authorized, but no `mcp__graphify__*` callable tool is registered in this session. The installed local fallback `C:\Users\Kirill\.local\bin\graphify.exe` was used read-only against a temporary copy of the existing UI graph, not against repository files. Query:

```text
graphify query "Trace the Strategy catalog source filter and Z2K All-in-One UI data flow" --budget 1200
```

Observed result: BFS depth 2, 227 nodes, truncated at 52 nodes; it linked the Strategy source/filter path through `z2m-strategy-workflow-core.js`, `z2m-strategies.js`, `normalizeOne()`, `sourceId()`, `mergeSelected()`, `visibleStrategies()`, and the model `combineStrategies()`. Existing graph file: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/graphify-out/graph.json`, 1,630,057 bytes.

## Baseline boundary

No production code, UI, package catalog, router state, or external system was changed for this baseline. Slice 1 starts with a failing DNS provider catalog test and must preserve the existing green UI gate while the UCode runtime limitation remains explicitly tracked.
