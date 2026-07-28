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
(docs/contracts/ubus.md). Methods registered on the router today (r19):

| Method | Used by | Notes |
|---|---|---|
| `status` | Overview, Strategies, Monitor | Schema v2 (docs/contracts/status.schema.json). May return `{error: 'status unavailable'}` — pages render that as an unavailable state, not as data. |
| `start`, `stop`, `restart`, `restart_daemons`, `start_fw`, `reload_ifsets`, `confirm_alive`, `rollback`, `passthrough` | Overview, Strategies | Sanctioned service control; manual rollback flow (auto timer stays disabled). |
| `lists_get`, `lists_check_domain`, `lists_set` | Lists | List model + editing (edit sent as JSON string). |
| `profiles_list` | Strategies | Lossless applied-profile parse + draft block (schema 1). |
| `profiles_create`, `profiles_update`, `profiles_clone`, `profiles_delete`, `profiles_validate`, `profiles_import_applied`, `profiles_apply` | Strategies | Draft CRUD (optimistic concurrency), native `--dry-run` validation, safe apply pipeline with rollback. |
| `job_get`, `job_list`, `blockcheck_start`, `blockcheck_status`, `blockcheck_cancel` | Blockcheck | Generic job model + upstream scanner wrapper (`test: standard\|custom`). |
| `versions`, `maintenance_status`, `events_tail`, `diagnostics_export`, `backup_list`, `backup_create`, `backup_restore_preview`, `backup_restore`, `backup_delete` | Maintenance | Versions, events, scoped backups with preview/restore, redacted export. |
| `dns_get`, `dns_set`, `dns_validate`, `dns_apply`, `dns_check`, `dns_rollback` | DNS | Domain→IPv4 overrides through the manager-owned addnhosts file with apply/rollback. |

Not registered yet (honest unavailable states where a page references them):
`proxy_*` (TG WS proxy adapter), `catalog_*`, `health_matrix_*`,
`orchestra_*`, `dns_provider_*`.

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
Profile/strategy management, fully wired (r19).

- Shows: service state; runtime profile count; applied profiles from the
  backend lossless parse (`profiles_list`: names, protocols, ports, L7
  filters, opaque `--lua-desync` with native-status chips, preserved unknowns
  such as `<HOSTLIST>`, diagnostics, preserve round-trip state); per-instance
  argv; runtime strategy dump; applied facts; drift warning.
- Draft manager: list with id/source/revision/parseStatus/duplicate badges,
  per-row Edit/Clone/(two-step)Delete/Validate, New-draft editor (raw
  advanced textarea + whitelisted guided add-option row), unsaved indicator,
  ECONFLICT keeps the editor open, malformed state shows a loud preserved
  warning with no CRUD, Import-applied button.
- Apply: Preview (exact candidate, sha256 diff, native coverage note) →
  arm→confirm → apply → five-check verification row → manual Link OK /
  Roll back. Refused previews keep Apply disabled with the reason.
- Passthrough toggle with the manual rollback confirm flow.

### 3. Blockcheck (`blockcheck.js`)
Fully wired (r19).

- Shows: mode select (quick/domains/full + `test: standard|custom`), domains
  input, Start (disabled while active; ECONFLICT renders the backend
  message), current job with status badge + honest elapsed (no fabricated
  percentage) + log tail, real Cancel, engine-running warning, recent jobs
  table, recommendations with Review-raw and Save-to-Draft (verbatim via
  `profiles_create`; never auto-applied), 2s polling while active.

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
Fully wired (r19).

- Shows: resolver components + conflict banners, upstream nameservers from
  the real resolvfile; applied overrides (manager-owned addnhosts) with a
  live Check button (per-entry match results); draft rows editor
  (add/remove/save-with-revision, unsaved rows), Validate with backend error
  detail; Preview (diff + candidate + registration flag) → arm→confirm →
  apply with verification rendering; manual rollback.
- The manager owns only `/etc/zapret2-manager/dns-overrides.hosts`;
  dnsmasq's own option lists and `/etc/config/dhcp` structure are never
  edited beyond the one-time addnhosts registration.
- DoH/provider management is NOT implemented (see Phase E roadmap); no
  hardcoded third-party endpoints.

### 6. Monitor (`monitor.js`)
The detailed technical screen (does not duplicate Overview's control plane).

- Shows: service state + pause/passthrough; `generatedAt`, `generation`,
  `profileCount`; instances table (PID, qnum, start time, RSS — CPU is not
  in the schema and renders Unavailable); NFQUEUE detail (registered,
  queueTotal, copyRange, queueDropped, queueUserDropped, cumulative-counter
  note, cycle `updatedAt`); qlen health (state, consecutiveOverThreshold,
  threshold 50 / crit turns 3 as backend constants); health checks table;
  active warnings; recent jobs; events via `events_tail` (wired).
- Polling: 5 s interval; never overlaps an in-flight RPC; stops when the
  view DOM leaves the document and on window unload; a failed poll keeps the
  last good data with a STALE banner + timestamp and keeps polling.

### 7. Proxy (`proxy.js`)
READ-ONLY TG WS Proxy adapter (Phase F, r31) over `proxy_capabilities` +
`proxy_status`. The proxy itself is a separate optional package — never
implemented here.

- Canonical provider panel: tg-ws-proxy-rs v1.6.5 (commit pin, MIT,
  asset + SHA-256, `aarch64-unknown-linux-musl` ABI), protocol **MTProto**
  with an explicit "SOCKS5: not supported" badge (the Rust binary has no
  `--mode` flag), default port 1443 shown as provider knowledge — never as
  an active listener, rejected alternatives, ADR reference.
- State: installed / detected provider / package version / binary path /
  process state (running / stopped / unknown — never a fake "stopped") /
  PIDs / init presence / enabled / mode; nothing-installed renders
  "adapter operational + proxy not installed", not an error.
- Listeners: actual rows with loopback / wildcard / lan / specific
  classification; wildcard carries the explicit "all local interfaces —
  WAN reachability not tested, depends on firewall policy" note; probe
  unavailable is distinguished from "no listeners".
- Files (metadata only): config presence/size + allowlisted parsed keys
  (a second fence drops any secret-shaped key even if a backend ever sent
  one), secret existence + permission verdict (0600 expected, never the
  value), log metadata.
- Structured warnings (MULTIPLE_BINARIES … STATUS_PARTIAL) with codes.
- Control section is an honest read-only statement: install/start/stop/
  config/secret-rotation methods intentionally do not exist in this slice
  (no disabled buttons pretending to work, no missing-method load error).

### 8. Maintenance (`maintenance.js`)
Fully wired (r19).

- Shows: real versions/system panel (manager/LuCI/upstream apk, nfqws2,
  lua_compat_ver, OS, uptime, memory, storage, rebootRequired=false);
  per-scope backup cards with manifest briefs + history, Create backup
  (scoped or all), Preview with integrity/diff/version-gate and a
  restorable verdict (reason shown, no restore button on integrity failure),
  Restore arm→confirm, Delete arm→confirm; events with severity badges +
  malformed-line reporting; diagnostics export (redacted JSON download).
- Restore always snapshots first; only allowlisted paths through sanctioned
  writers; downgrade warning.

## Backend method coverage (current state)

Every method the pages use is registered and granted in the ACL (the
packaging gate asserts plugin↔ACL coherence). Since r30/r31 the
`catalog_*`, `health_matrix_*`, `orchestra_*`, `dnsprov_*`, and the
READ-ONLY `proxy_capabilities` / `proxy_status` families are all wired.
Remaining unimplemented surfaces (pages render honest unavailable states
or explicit read-only statements for them): TG WS Proxy MUTATIONS
(install/start/stop/config/secret rotation — future trusted package
slice), Telegram alerts, automatic rollback timer.

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
