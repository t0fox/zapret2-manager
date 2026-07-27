# UI spec — luci-app-zapret2-manager (LuCI JS frontend)

This document is the source of truth for the LuCI frontend: the eight pages,
their data sources, the RPC methods they call, and the unavailable-state
contract. It reflects the actual repository layout
(`luci-app-zapret2-manager/files/…`), not a packaging-idealized one.

## Platform facts

- OpenWrt 25.12.5, LuCI JavaScript, luci.js 26.187.49110 on the target.
- **`L.ubus` does not exist** in this luci.js. Calling `L.ubus.call(...)`
  throws `TypeError: Cannot read properties of undefined (reading 'call')`.
  All RPC goes through `rpc.declare({ object, method, params })`.
- Views are plain JS files under
  `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/`
  installed to `/www/luci-static/resources/view/zapret2-manager/`.
- No external CDN/libraries, no inline secrets, no shell/SSH from the browser.
- DOM is built with `E()` helpers only — no HTML string concatenation of
  user-controlled data.

## RPC object

The only ubus object the UI talks to is `zapret2-manager`
(docs/contracts/ubus.md). Methods registered on the router today:

| Method | Used by | Notes |
|---|---|---|
| `status` | Overview, Strategies, Blockcheck, DNS, Monitor, Maintenance | Schema v2 (docs/contracts/status.schema.json). May return `{error: 'status unavailable'}` — pages render that as an unavailable state, not as data. |
| `lists_get` | Lists | Schema 2: `lists` (per-key `{entries, path, type, editable, engine, present, reason}`), `conflicts`, `provenance`. The path model is the router-derived `lists-model.json`; only `domainInclude`/`domainExclude` are editable — IP-semantic keys and the autohostlist are read-only with reasons. On failure: `{error}` — the page locks editing. |
| `lists_check_domain` | Lists | `params: ['domain']` — called positionally: `callListsCheck(d)`. |
| `lists_set` | Lists | `params: ['edit']` — called positionally: `callListsSet(JSON.stringify(edit))`. **The ubus signature declares `edit` as type string** (verified on the router: an object argument is rejected with "Invalid argument"), so the UI sends the edit as a JSON string. |
| `passthrough` | Strategies | `params: ['enabled']`; arms the 90s backend rollback. |
| `confirm_alive` | Strategies | Cancels a pending rollback ("Link OK"). |
| `rollback` | Strategies | Forces rollback now. |
| `start`, `stop`, `restart`, `restart_daemons`, `start_fw`, `reload_ifsets` | Overview only (backend agent's zone) | Not called by the seven pages here. |

## Shared page rules

Every page:

1. Loads without a JavaScript exception, with title + description.
2. `load()` **never rejects** — it resolves an envelope
   `{ loadError, data }`; a rejected RPC becomes visible UI, not an endless
   spinner.
3. A successful call returning an error payload (`{error}` / `{ok:false}`)
   renders an unavailable/error state.
4. Unknown or missing values render as **"Unavailable"** — never as a
   fabricated `0`, `false`, or empty string.
5. Every promise chain has a `.catch(` with a visible error path.
6. Action buttons disable while their call is in flight and re-enable after
   (success or error).
7. Buttons whose backend method does not exist render `disabled` with the
   method name in the caption — no fake save paths, no localStorage drafts,
   no direct UCI writes.
8. `handleSave`/`handleSaveApply`/`handleReset` are `null` unless a page
   truly needs them (none do today).
9. Standard LuCI `cbi-*` classes only, so narrow screens reflow the same way
   as the rest of LuCI.
10. Strings are built by **plain concatenation** (overview.js style).
    `String.prototype.format` lives in `cbi.js`, which these views do not
    require — calling `.format()` would throw at render time.
11. **rpc.js wire semantics** (verified against
    `/www/luci-static/resources/rpc.js` on the router): a `params` ARRAY
    declaration is invoked **positionally** — `fn(value)` forms
    `{ param: value }`; `fn({ param: value })` would double-nest
    `{ param: {…} }`. (The object-call form only pairs with a `params`
    OBJECT declaration, which these views do not use.)
12. Every `rpc.declare` carries **`reject: true`**: rpc.js defaults
    `reject` to false, and a ubus error reply then RESOLVES
    (`msg.result[1]`, else the numeric code) instead of rejecting — the
    `.catch()` error paths, the lists anti-wipe lock, and the monitor stale
    fallback all depend on real rejections.

## Menu

`luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`

Eight entries, tab style (parent + children), `depends.acl` is always a flat
array (an object form previously caused an HTTP 500 — regression-gated by
both `tools/smoke.sh menu_acl_shape` and `tests/ui/`):

| # | Menu key | Tab | View |
|---|---|---|---|
| 1 | `admin/services/zapret2-manager` | Zapret 2 Manager (order 90) | `zapret2-manager/overview` |
| 2 | `…/strategies` | Strategies (91) | `zapret2-manager/strategies` |
| 3 | `…/blockcheck` | Blockcheck (92) | `zapret2-manager/blockcheck` |
| 4 | `…/lists` | Lists (93) | `zapret2-manager/lists` |
| 5 | `…/dns` | DNS (94) | `zapret2-manager/dns` |
| 6 | `…/monitor` | Monitor (95) | `zapret2-manager/monitor` |
| 7 | `…/proxy` | Proxy (96) | `zapret2-manager/proxy` |
| 8 | `…/maintenance` | Maintenance (97) | `zapret2-manager/maintenance` |

## Pages

### 1. Overview
Backend agent's zone — not covered here.

### 2. Strategies (`strategies.js`)
Profile/strategy management as a **data model**, not an embedded catalog.

- Shows: service state; profile count (`runtime.profileCount`); per-instance
  argv parsed into protocol/ports (`--filter-tcp/--filter-udp`),
  hostlist/ipset filters, `--lua-desync` options (presentation hints; raw
  argv always verbatim); runtime strategy table dump
  (`runtime.strategies`); applied UCI + config facts; draft block; drift
  warning (`drift.divergent`); validation panel.
- Active action: **passthrough toggle** (the only strategy mutation in the
  ubus contract), with the 90s rollback confirm flow (Link OK / Roll back).
- Disabled actions (method names shown): `profiles_list`, `profiles_create`,
  `profiles_update`, `profiles_clone`, `profiles_delete`, `profiles_validate`,
  `profiles_apply`.

### 3. Blockcheck (`blockcheck.js`)
- Shows: the three modes with honest durations (quick — short; domains —
  15–40 min; full — 30–45 min); the state machine
  (queued/running/cancelling/cancelled/succeeded/failed) as a legend;
  current job + recent jobs from `status.jobs`; elapsed time ticking for an
  active job (no progress percentage is faked — the backend reports none);
  log tail / recommendations panel (unavailable).
- Disabled actions: start/cancel — wait for `blockcheck_start`,
  `blockcheck_status`, `blockcheck_cancel`. At-most-one is enforced
  backend-side (tests/lib/jobs-logic.mjs is the reference).

### 4. Lists (`lists.js`)
- Shows: five user lists (domain include/exclude, IP include/exclude/block)
  as editable textareas with entry counts, per-list client-side filter,
  source file paths; engine-owned autohostlist as read-only with source
  path; include/exclude conflict banner (backend-computed, plus a
  client-side pre-apply hint mirroring `normalize_domain`); domain check.
- RPC: `lists_get`, `lists_check_domain`, `lists_set` (edit sent as JSON
  string — see RPC table).
- Safety: when `lists_get` fails, the page locks all editing (read-only
  textareas, disabled Apply/Check) so a failed load can never erase a list
  by applying empty textareas.
- IPv6 lists: noted as not present in the current backend list set.

### 5. DNS (`dns.js`)
- Shows: the `dns_consistency` health check from `status.health.checks`
  (the only real DNS fact today; absent = not checked vs null = no value are
  rendered distinctly).
- Unavailable panels (method names shown): current upstreams/peer
  DNS/dnsmasq servers, domain rules + per-site DNS, DoH endpoint,
  applied/draft — all wait for `dns_get`; edits wait for `dns_set`,
  `dns_validate`, `dns_apply`, `dns_check`.
- COMSS DNS and a DoH endpoint shape are shown as **example presets only**,
  with no hardcoded addresses. No `/etc/config/dhcp` or network UCI writes
  from the browser, ever.

### 6. Monitor (`monitor.js`)
The detailed technical screen (does not duplicate Overview's control plane).

- Shows: service state + pause/passthrough; `generatedAt`, `generation`,
  `profileCount`; instances table (PID, qnum, start time, RSS — CPU is not
  in the schema and renders Unavailable); NFQUEUE detail (registered,
  queueTotal, copyRange, queueDropped, queueUserDropped, cumulative-counter
  note, cycle `updatedAt`); qlen health (state, consecutiveOverThreshold,
  threshold 50 / crit turns 3 as backend constants); health checks table;
  active warnings; recent jobs; events panel (unavailable — needs
  `events_tail`).
- Polling: 5 s interval; never overlaps an in-flight RPC; stops when the
  view DOM leaves the document and on window unload; a failed poll keeps the
  last good data with a STALE banner + timestamp and keeps polling.

### 7. Proxy (`proxy.js`)
Honest empty state for the planned TG WebSocket Proxy (Rust/Go).

- All fields (installed, state, implementation, listen address, port,
  upstream, connections, counters, autostart, last error) render
  Unavailable; start/stop/restart disabled; the page lists the methods it
  waits for: `proxy_status`, `proxy_install`, `proxy_start`, `proxy_stop`,
  `proxy_restart`. The proxy itself is never implemented here.

### 8. Maintenance (`maintenance.js`)
- Shows: versions — `nfqws2` from `status.upstream.nfqws2Version`,
  update-available badge from `status.system.upgradable`; manager / LuCI
  package / zapret2 package versions, `lua_compat_ver`, reboot-required —
  Unavailable (need `versions` / `maintenance_status`).
- Backups: the four scopes (engineConfig, ourState, lists, profiles) with
  expected source paths; history cap 3; SHA-256 manifest + syntax check +
  pre-restore snapshot + downgrade warning described; current/history
  Unavailable (need `backup_list`); create disabled (need `backup_create`).
- Restore: preview/SHA-256/syntax-check/downgrade-warning Unavailable (need
  `backup_restore_preview`, `backup_restore`, `backup_delete`). Dangerous
  buttons disabled, so no confirm dialogs exist yet; when methods land each
  dangerous action gets exactly one `ui.confirm` — never stacked modals.
- Diagnostics export disabled (`diagnostics_export`); maintenance events
  Unavailable (`events_tail`). No package update from the browser.

## Missing backend methods (dependency list for the backend agent)

| Page | Methods waited for |
|---|---|
| Strategies | `profiles_list`, `profiles_create`, `profiles_update`, `profiles_clone`, `profiles_delete`, `profiles_validate`, `profiles_apply` |
| Blockcheck | `blockcheck_start`, `blockcheck_status`, `blockcheck_cancel` |
| DNS | `dns_get`, `dns_set`, `dns_validate`, `dns_apply`, `dns_check` |
| Monitor | `events_tail` (events log over ubus) |
| Proxy | `proxy_status`, `proxy_install`, `proxy_start`, `proxy_stop`, `proxy_restart` |
| Maintenance | `maintenance_status`, `versions`, `backup_list`, `backup_create`, `backup_restore_preview`, `backup_restore`, `backup_delete`, `diagnostics_export`, `events_tail` |
| Lists | `lists_set` arg-type alignment: the plugin declares `edit:string` and the UI sends a JSON string; the plugin body must parse it (it currently `sprintf %J`s it as a dict — double-encode bug, backend zone). |
| Packaging | `luci-app-zapret2-manager/Makefile` installs only `overview.js` today; it must install the other seven views (Makefile is the backend agent's zone). |

## Frontend tests

`tests/ui/` — independent of the backend suites. Run:

```
node --test "tests/ui/*.test.mjs"
```

13 gates + a module-load harness gate + a render harness (executes every
page's `render()` against healthy / rejected-RPC / error-payload fixtures
under a minimal DOM stub) + negative controls (an `L.ubus` injection and an
object-form `depends.acl` are each proven to go red on a mutated copy while
the real artifact stays green). See `tests/ui/lib/checks.mjs` for the
checker semantics.
