# Monitoring health center evidence

Date: 2026-08-21
Worktree: `G:\\z2m-monitoring-health-center`
Baseline: `2ab9eb2b3b43eafe5b306bb7836033cd113af175`

## Inventory and authority map

| UI surface | RPC | Evidence source | Freshness | Owner |
| --- | --- | --- | --- | --- |
| Diagnostics / Monitoring | `service.status_fast`, `maintenance_status`, `engine_status`, `dns_product_status`, `proxy_health`, `tg_product_status` | `status-fast.v1`; maintenance system facts; canonical engine/DNS/TG/proxy status | `generatedAt`/`updatedAt` when supplied; missing or stale is not OK | existing Engine/System/Scanner/DNS/TG pages |
| Diagnostics / Logs | `events_tail` | canonical maintenance event journal | bounded tail, sequence-aware viewer poller | Diagnostics → Logs |
| Scanner readiness card | no Scanner job-status call without an id | `status-fast.v1.generation` / snapshot identity | fast evidence timestamp | Scanner (`#/scan`) |
| Diagnostic report | `diagnostics_export` | existing redacted backend bundle: system, versions, status, events, hashes | report `generatedAt` | Diagnostics |
| WARP | no production WARP RPC found | capability absent | UNKNOWN | WARP (`#/warp`) |

The activity monitor remains reachable as an existing module for closure, but the canonical Diagnostics health load no longer starts its activity poller. The production route remains `app.js` → `Diagnostics` for `diagnostics`, `monitor`, and `logs`; `scanner-orchestrator` is untouched.

## Before → after source evidence

Before: Diagnostics used `Monitor.load(ctx)`, a monitor activity snapshot, and `ctx.api.scanner.status()` without the required Scanner id. `stateOf()` collapsed missing evidence to “получено” and displayed a WARP placeholder.

After: Diagnostics uses existing cheap `service.statusFast()` plus bounded component status reads. `normalizeHealth()` projects `OK`, `OFF`, `DEGRADED`, `UNKNOWN`, and `ERROR`, carries reason/action/freshness/evidence, and renders technical details behind disclosure. `UNKNOWN` and stale evidence cannot become OK.

## Verification

- Final focused health/Diagnostics/log set: **15/15 passed**.
- Full UI set in isolated worktree: **251 passed, 19 failed**. The same 19 failures reproduce on untouched `G:\\zapret2-manager` baseline (`246 passed, 19 failed`); they are unrelated pre-existing parity/ACL/deploy/runtime-contract failures. The new Monitoring tests are not among the failures.
- Knowledge validator: only existing repository findings remain: `docs/05-parity/z2k-p5-parity-matrix.md` missing frontmatter and `docs/05-parity/z2k-parity.md` unreachable authority document.
- JS parse check for modified LuCI modules: **PARSE_OK**.
- `git diff --check`: clean.

## Runtime boundary

No live LuCI/browser or router endpoint was available in this worktree, so no screenshot or router health claim is fabricated. Production acceptance still requires deployment and a live screenshot/evidence pass for component states, owner links, report action, and canonical Logs lifecycle.
