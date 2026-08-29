---
id: global-update-source-phase-a
title: "Global Update Source Phase A Evidence"
type: doc
status: current
authority: evidence
updated: 2026-08-29
publish: false
tags: [update-source, phase-a, evidence, telegram, engine, blockcheckw]
---

# Global Update Source — Phase A

```yaml
verdict: GLOBAL UPDATE SOURCE PHASE A READY
full_architecture_verdict: DEFERRED_Z2K
base_sha: bf3b56c63641d582a3dbad3bdaf4b7db9d0aa857
branch: codex/global-update-source
worktree: G:\\zapret2-manager\\.worktrees\\global-update-source
z2k_lifecycle_changes: NONE
live_router_mutation: NOT_RUN_BY_TASK_BOUNDARY
browser_mutation: NOT_RUN_BY_TASK_BOUNDARY
credentials_added: false
retry_loop_added: false
```

## Architecture contract

`zapret2-manager/files/usr/libexec/zapret2-manager/update-source.uc` owns
remote update metadata transport, validation, ephemeral LKG cache, origin
cooldown state, bounded per-source locking, and status projection. Its public
operations are `update_source_browse`, `update_source_refresh`,
`update_source_fresh`, and `update_source_status`.

The migrated source identities are:

| Consumer | `sourceKey` shape | Origin | BROWSE | REFRESH | FRESH |
| --- | --- | --- | --- | --- | --- |
| Telegram Rust/Go | `telegram:<id>:<repo>:arch=<arch>:endpoint=releases` | `github-rest` | provider choices and cached releases | explicit check | mutation preflight |
| Official Engine | `engine:bol-van/zapret2:arch=<arch>:endpoint=releases` | `github-rest` | catalog | explicit check | checked mutation candidate |
| BlockCheckW | `blockcheckw:rcd27/blockcheckw:arch=all:endpoint=latest-release` | `github-rest` | status/display | explicit check | installer preflight |

Semantics are strict: BROWSE returns fresh or stale valid LKG without
mandatory network; REFRESH makes one targeted attempt and atomically replaces
LKG only after validation; FRESH never authorizes a mutation from stale LKG
and fails closed on unavailable upstream metadata.

## Cache and rate state

The default metadata cache is `/tmp/zapret2-manager/update-cache/`. Each entry
contains `schemaVersion`, `sourceKey`, `origin`, `url`, `fetchedAt`,
`validatedAt`, and validated `payload`; ETag and Last-Modified are retained
when provided. Cache identity is a SHA-256 of source identity, origin, and
URL, so provider and architecture entries cannot alias. Writes stage, validate,
chmod 600, and `mv` atomically. Invalid, truncated, wrong-source, and
wrong-schema entries are treated as misses.

Transient per-source status and per-origin rate state are also under `/tmp`.
The bounded projection exposes `sourceKey`, `origin`, `cacheState`, `stale`,
`lastSuccessAt`, `lastAttemptAt`, `lastErrorClass`, `payloadAvailable`, and
`cooldown` with limit/remaining/reset data where known. No `/rate_limit` request,
PAT, token, or unbounded retry was added.

Singleflight is per cache identity: lock acquisition waits at most 12 seconds,
removes locks older than 30 seconds, rechecks LKG after waiting/acquiring, and
lets independent source keys proceed independently.

## Request-budget evidence

All rows below use the fixture transport and exact request-count log; no live
GitHub request is part of the product tests.

| Area | Required budget | Evidence | Result |
| --- | --- | --- | --- |
| Telegram cold page | Rust + Go <= 2 | `tests/product/tg-provider-transaction.test.mjs` | PASS |
| Telegram warm/repeated warm | 0 | same suite | PASS |
| Telegram manual refresh both/one | <= 2 / <= 1 | same suite | PASS |
| Telegram 403 + LKG/no LKG | no hammering during cooldown | same suite and `update-source.test.mjs` | PASS |
| Engine cold/warm/fresh | <= 1 / 0 / <= 1 | `tests/product/engine-update-source.test.mjs` | PASS |
| BlockCheckW cold/warm/refresh | <= 1 / 0 / <= 1 | `tests/product/blockcheckw-update-source.test.mjs` | PASS |
| Same-key singleflight | 10 callers => 1 fetch | `tests/product/update-source.test.mjs` | PASS |

## RED → GREEN evidence

The implementation was driven by focused failing contracts before the related
production fixes. Recorded red cases included inferred transport `403`
classified as `ENETWORK` instead of `ERATELIMIT`, missing Telegram/Engine
stale or unavailable notices, and lost `lastErrorClass` in product source
projections. The corresponding green reruns were the inferred-403 test,
13/13 UI source tests, and the targeted last-error test (1/1), followed by the
full focused suite.

## Verification results

Focused product/native gate:

```text
node --test tests/product/update-source.test.mjs tests/product/tg-provider-transaction.test.mjs tests/product/blockcheckw-update-source.test.mjs tests/product/engine-update-source.test.mjs tests/product/update-source-migration-contract.test.mjs tests/native/engine-release-cache-performance.test.mjs
42 tests, 42 pass, 0 fail, 0 skip, exit 0 (WSL UCode)
```

Broader affected gate:

```text
node --test tests/product/tg-provider-transaction.test.mjs tests/product/tg-install-owner-contract.test.mjs tests/product/engine-check-regression.test.mjs tests/product/engine-stock-authority.test.mjs tests/product/engine-worker-transaction.test.mjs tests/product/engine-state-permissions.test.mjs tests/ui/tg-version-contract.test.mjs tests/ui/tg-installation-ux-contract.test.mjs tests/ui/tg-runtime-rpc-regression.test.mjs tests/ui/telegram-proxy-card-regression.test.mjs
61 tests, 61 pass, 0 fail, 0 skip, exit 0 (WSL UCode)
```

Static UI/source gate: `node --test` over the five directly affected UI
contract files passed 27/27. `node --check` passed for 10 changed JS/MJS
files. `sh -n` passed for the fixture, Engine worker, and BlockCheckW
installer. `git diff --check` passed. Windows native UCode was not counted:
the configured `/opt/ucode/bin/ucode` is unavailable there; native product
execution was run in WSL with the repository UCode runtime.

Knowledge/documentation gates were bounded and recorded separately:
`node scripts/docs.mjs verify` passed with the pinned Quartz SHA. The full
`node scripts/validate-knowledge.mjs` run reports one pre-existing baseline
error, `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md: missing
frontmatter`; `git show origin/main:<that path>` confirms the same source state,
and that unrelated file is intentionally untouched. The public Quartz build
could not complete because its plugin bootstrap repeatedly hit `fatal:
ambiguous argument 'HEAD'` in shallow plugin copies; after the bounded stop,
`tests/knowledge/public-leak.test.mjs` correctly reported its required public
output as absent. No new evidence note was published.

See [direct-fetch-audit.md](direct-fetch-audit.md) and
[flash-write-audit.md](flash-write-audit.md). The future Z2K adapter contract
is intentionally separate in [Z2K-INTEGRATION-NOTE.md](Z2K-INTEGRATION-NOTE.md).

## Adversarial review

| Question | Result |
| --- | --- |
| Can Telegram page load issue automatic `checkUpdates`? | NO; load is BROWSE-only and manual action owns REFRESH. |
| Can warm Telegram reload hit GitHub REST? | NO; fixture budget is 0. |
| Can Rust/Go or architecture caches alias? | NO; identity is in source key/hash. |
| Can same-key callers double-fetch? | NO; 10-way test records one fetch. |
| Can stale metadata authorize mutation? | NO; Telegram, Engine, and BlockCheckW mutation paths use FRESH. |
| Does 403 destroy LKG or hammer on reload? | NO; LKG survives and origin cooldown blocks attempts. |
| Does REST cooldown block raw/release-download origins? | NO; origin state is separated. |
| Do browse metadata writes go to `/etc`? | NO; migrated metadata is ephemeral; see flash audit. |
| Can malformed cache crash callers? | NO; corruption is a cache miss. |
| Does remote failure hide installed local truth? | NO; local product state remains rendered. |
| Is official Engine authority singular? | YES; legacy alternate providers remain non-production. |
| Are artifact downloads still independently verified? | YES; mutation content paths retain digest/checksum/rollback ownership. |
| Are migrated metadata direct-fetch bypasses unexplained? | NO; see direct-fetch audit. |

No router deployment, rpcd reload, service restart, browser mutation, APK
operation, package install, SSH, or Z2K lifecycle edit was performed.
