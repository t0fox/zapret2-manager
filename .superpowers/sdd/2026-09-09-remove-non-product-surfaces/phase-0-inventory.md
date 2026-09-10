# Phase 0: current production reachability inventory

Date: 2026-09-09
Worktree: `G:\zapret2-manager\.worktrees\remove-non-product-surfaces`
Branch: `codex/remove-non-product-surfaces`
Base commit: `82e18ccab3e765836ece22539beea58596231779`

## Evidence boundary

The primary checkout contains an unrelated untracked completion note. This
worktree was created from `main` at the base commit above, so that file is not
part of this task.

The repository menu exposes one LuCI root entry, `admin/services/zapret2-manager`,
which loads `zapret2-manager/app`. Before this wave the navigation model had six
groups and the following canonical-looking entries:

- Home: `dashboard`
- DPI: `control`, `strategies`, `scan`
- Routing: hidden `unified-routing`, `warp`, `telegram-tunnel`
- Data: `services`, `resources`, `dns-routing`
- Diagnostics: hidden `diagnostics`, `monitor`, `logs`
- System: hidden `system`, `components`, `backups`, `settings`

The app also registered old aliases for `overview`, `strategy`, `dns`, `proxy`,
`lists`, `assets`, hostlist/blob/lua routes, `blockcheck`, `scanner`, WARP setup
routes, `zapret`, `autostart`, `maintenance`, `updates`, `engine`, `settings`,
and `unified-routing`. Those aliases were compatibility reachability rather than
finished current product routes.

## Current ownership findings

- `z2m-overview.js` starts and polls `ctx.api.orchestra.runStart` / `runStatus`
  for a dashboard domain check. The migration target is the existing bounded
  Z2K Detect probe contract.
- `z2m-services.js` calls `orchestra.probePreflight`, `orchestra.runStart`, and
  `orchestra.runStatus` for one catalog service. The migration target is a
  bounded service-owned health check; Domain Hub remains the Services transaction
  owner.
- `strategy-cli.uc` and `strategy-compiler.uc` call Apply primitives from
  `profiles-apply.uc`; `scanner-transient.uc` calls its transient lifecycle
  helpers. Profiles CRUD is not therefore removable until the retained Apply
  functions are extracted under Strategy ownership.
- `domain-hub.uc` imports the catalog load/status/preview/apply/ledger subset and
  uses it as an internal source for Services/domain transactions. `catalog-cli.uc`
  and public `catalog_*` RPC exposure must be audited separately before removal.
- The current typed Scanner UI calls the five Z2K Detect operations. Legacy
  BlockCheck families, Orchestra jobs, and old Profile UI are not current visible
  product owners based on the app import/module map.
- `scanner-runtime-adapter.sh` invokes `z2m-scanner-firewall-helper`; both are
  currently packaged and referenced by `profiles-apply.uc` and Scanner tests.
  They remain pending the Strategy Apply extraction and final transient-caller
  audit, as required by the user goal.

## Baseline limitations

The initial directory-based command `node --test --test-concurrency=1 tests/ui tests/product`
was invalid under the installed Node runtime because directories were treated as
modules. The corrected command enumerated `*.test.mjs` files under both
directories and started successfully, but was interrupted after bounded waits
because it produced no new output. It printed initial passes and then existing
Profile/Apply-related failures; no final test count is claimed. The complete
baseline is therefore `PARTIAL / INTERRUPTED`, not green or red as a whole.

## Graph evidence

The installed Graphify CLI was queried against the checked-in UI graph for
Orchestra, Profiles callers, and route aliases. It identified the direct UI
nodes, but the graph is heuristic and UI-focused; source `rg` reverse reachability
and package/runtime ownership are authoritative. No separate `mcp__graphify`
tool was registered in the current tool registry.
