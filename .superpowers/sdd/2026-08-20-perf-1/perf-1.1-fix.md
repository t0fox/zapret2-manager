# PERF-1.1 Fix Report

## Scope

Fix fresh TTL navigation in `app.js` only. The existing TTL cache, force-refresh,
mutation invalidation, session invalidation, and inflight deduplication contracts
remain unchanged.

## Root cause

`activate()` rendered a fresh cache entry optimistically, then continued into
`loadTabData()`. `tabCache.load()` returned the same fresh value, so the promise
continuation rendered and mounted it a second time. On Strategies that second
mount repeated `refreshHealthcheck()`, `refreshLearned()`, and
`refreshDebugToggle()`.

## Fix and call counts

For a fresh entry with `force !== true`, `activate()` now stores the cached
snapshot in `tabDataCache`, clears busy state, and returns the cached result
without calling `loadTabData()`.

| Scenario | Loader calls | Render calls | Mount calls | Strategies read-only RPCs per RPC |
| --- | ---: | ---: | ---: | ---: |
| Before: fresh cache | 0 | 2 | 2 | 2 |
| After: fresh cache | 0 | 1 | 1 | 1 |
| After: force refresh | 1 | 1 | 1 | loader-defined |
| After: expired cache | 1 | 1 | 1 | loader-defined |

## Verification

- `node --test tests/ui/perf-1-contract.test.mjs`: **14/14 PASS**.
- Related Control/Scanner/Strategies tests: **11/11 PASS**.
- `node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`: PASS.
- `git diff --check`: PASS.
- Clean `origin/main` baseline reproduces two unrelated pre-existing P03 failures:
  `P03 backend list path reuses one catalog snapshot and reload stays explicit`
  and `the single target deploy path requires an explicit reviewed closure`.
- No router benchmark was run; no percentage speedup is claimed.

## Commit

Pending final commit SHA.
