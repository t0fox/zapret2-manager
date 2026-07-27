# ubus contract — `zapret2-manager`

This is the wire contract for the ubus object exposed by the rpcd ucode plugin
at `usr/share/rpcd/ucode/zapret2-manager.uc` (signature-plugin contract — see
docs/architecture.md §8). Parallel agents and future branches build against
this. The contract is **extend-only by addition** (see Compatibility).

The ubus object name is `zapret2-manager`. The ACL group
`luci-app-zapret2-manager` grants read/write on it; the object name must match
the signature's top-level key symbol for symbol or LuCI gets a permission
denial (empty page, no error).

## Methods

| Method | Args | Direction | UI confirm? | Description |
|---|---|---|---|---|
| `status` | none | read | no | Schema v2 (camelCase): the mandatory top-level blocks schema, generatedAt, generation, serviceState, runtime, applied, draft, drift, health, system, upstream, jobs, warnings. See docs/contracts/status.schema.json. 3s cached. |
| `start` | none | mutate | no | Clear paused indicator + NFQWS2_ENABLE=1 intent; upstream start. |
| `stop` | none | mutate | yes (90s) | Pause: NFQWS2_ENABLE=0 intent + (optionally stop_fw) + upstream stop; snapshot + 90s rollback. |
| `restart` | none | mutate | yes (90s) | Clear paused; upstream restart; snapshot + 90s rollback. |
| `restart_daemons` | none | mutate | yes (90s) | Upstream daemon-only restart; snapshot + 90s rollback. |
| `start_fw` | none | mutate | yes (90s) | Install zapret2 nft rules (`/etc/init.d/zapret2 start_fw`); 90s rollback. Never a full fw restart. |
| `reload_ifsets` | none | mutate | yes (90s) | Re-read ifset membership (`/etc/init.d/zapret2 reload_ifsets`); 90s rollback. Distinct from start_fw. |
| `passthrough` | `{enabled: bool}` | mutate | yes (90s) | Toggle the no-strategy profile; 90s rollback. |
| `confirm_alive` | none | mutate | — | Cancel a pending 90s rollback (the "link OK" button). |
| `rollback` | none | mutate | — | Force rollback to last-good now (manual). |
| `profiles_list` | none | read | no | Applied `NFQWS2_OPT` parsed LOSSLESSLY into profiles (schema 1): per-profile name/protocol/filters/hostlists/opaque `luaDesync` hints/raw `fragment`, manager diagnostics, preserve round-trip state, native-validation vocabulary (`not_checked`/`partial`/`rejected`/`unavailable` — never `valid`), provenance, plus the `draft` block (draft profiles with per-fragment diagnostics; `malformed` reported honestly, never overwritten). Read-only; parse errors degrade to `parseStatus: partial`, a missing config to `ETARGET`, an unset opt to `parseStatus: unavailable`. |
| `profiles_create` | `{edit: string}` | mutate (draft only) | no | Create a DRAFT profile (`edit` = JSON string `{name, opt}`). Writes ONLY `/etc/zapret2-manager/state.json` (atomic, locked, rolling backup ×3). Stable id `pNNNNNN`, `revision: 1`. Never touches applied config or runtime. |
| `profiles_update` | `{edit: string}` | mutate (draft only) | no | Update a draft (`{id, revision, name?, opt?}`). Optimistic concurrency: stale `revision` → `ECONFLICT`; unknown id → `ESTATE`. |
| `profiles_clone` | `{edit: string}` | mutate (draft only) | no | Clone a draft (`{id}`) → NEW stable id, name + ` (copy)`, `revision: 1`. |
| `profiles_delete` | `{edit: string}` | mutate (draft only) | yes | Delete a draft (`{id}`). Runtime/applied are never affected (drafts are not referenced by the engine). |
| `profiles_validate` | `{edit: string}` | read | no | Validate `{id}` or `{opt}`: (1) manager structural diagnostics; (2) native `nfqws2 --dry-run` with every token one POSIX-escaped argv element (no shell interpolation, no Lua execution). Result vocabulary `not_checked`/`partial`/`rejected`/`unavailable`; binary absent → `unavailable`. No claim of full runtime validity. |
| `profiles_import_applied` | none | mutate (draft only) | yes | Import every APPLIED profile into drafts with its raw fragment preserved (read path is the sanctioned `apply.uc read_var`). |

**Read vs mutate.** `status` is the only read. Everything else changes state
and arms the 90s rollback snapshot. Mutating calls do not block the link they
might disrupt; they return immediately and the operator confirms via
`confirm_alive` within 90s or the backend auto-rolls back.

**UI confirm.** Disruptive ops (those that can drop the link: restart,
restart_daemons, start_fw, reload_ifsets, passthrough, stop) arm the 90s
rollback and the UI MUST show the "link alive? / roll back" prompt with a
countdown. `start` and `confirm_alive`/`rollback` do not.

## Long operations (job model)

State-changing calls do NOT block the caller. They return a **job id**
immediately; the caller polls job state with `job_get`. (The current impl is
synchronous via the service.uc CLI and returns `{ok, rc, out, rollback_pending}`;
it will migrate to the job model. This section is the contract future branches
build against.)

Methods:

| Method | Args | Direction | Description |
|---|---|---|---|
| `job_get` | `{id: string}` | read | Poll a job: returns `{id, status, result, created_at, updated_at}`. |
| `job_list` | none | read | List recent jobs (see lifetime). |

Job statuses (closed enum) and allowed transitions:

```
pending -> running -> succeeded
                  \-> failed
          (any) -> rolled_back        # 90s rollback fired
          (succeeded|failed) -> expired   # record aged out
```

- `pending` — accepted, not yet executing.
- `running` — executing.
- `succeeded` — completed; the change is applied (awaiting `confirm_alive` for
  disruptive ops, else the 90s rollback fires → `rolled_back`).
- `failed` — completed with an error; `result.error` carries the code/message.
- `rolled_back` — the 90s rollback fired because the link was not confirmed.
- `expired` — the record aged out (see lifetime).

Transitions are forward-only; no status goes back to `pending`/`running`.

**Storage + lifetime.** Job records live in `/tmp/zapret2-manager/jobs/` (one
JSON file per job, volatile). A record in a terminal status
(`succeeded`/`failed`/`rolled_back`) is kept for **10 minutes** after
`updated_at`, then moved to `expired` and the file removed. Non-terminal jobs
are never expired. The job id is opaque (a string); do not parse it.

## Error form

Every error is an object with this shape (successes do not carry it):

```json
{ "ok": false, "error": { "code": "<CODE>", "message": "<human text>" } }
```

- `ok` — boolean; false on any error.
- `error.code` — a closed enum (below). Stable, machine-readable, the ONLY
  field a caller may branch on.
- `error.message` — human-readable, locale-aware, NOT parsed by callers. May
  change between versions; never pattern-match it.

Error codes:

| Code | Meaning | Class |
|---|---|---|
| `EPERM` | permission denied (ACL mismatch, not granted) | permission |
| `ESTATE` | action not valid in the current state (e.g. passthrough while paused in a way that conflicts) | state |
| `ETARGET` | the target (upstream init, nfqws2, a file) did not respond as expected (non-zero rc, missing binary) | target |
| `ECONFLICT` | a job is already running for this target | state |
| `EINPUT` | bad arguments (missing/typed wrong) | input |
| `EINTERNAL` | unexpected internal failure | internal |

**Permission vs state vs target.** `EPERM` is about whether the caller may do
this at all (ACL). `ESTATE`/`ECONFLICT` are about whether the action makes
sense right now (the system is in the wrong state, or a conflicting job is
running) — retrying later may succeed. `ETARGET` is about the upstream/init/
daemon not behaving (the manager's logic was fine; the target failed) —
`error.message` includes the rc where available. `EINPUT` is a caller bug.
`EINTERNAL` is a manager bug.

The current impl returns the simpler `{ok:false, error:"<text>", rc:N}` for
target failures; it will migrate to this structured form. Callers MUST treat a
string `error` as `ETARGET`-class for now and not pattern-match the text.

## Caching

| Method | Cache |
|---|---|
| `status` | 3s snapshot. Serves `/tmp/zapret2-manager/status.json` if its mtime is within 3s; otherwise re-runs the collector. |
| all others | never cached — always hit the system. |

**Forced invalidation.** Every mutating method (start, stop, restart,
restart_daemons, start_fw, reload_ifsets, passthrough, rollback) deletes
`/tmp/zapret2-manager/status.json` after acting, so the next `status` call
re-runs the collector and reflects the new reality. (The current impl relies on
the 3s TTL expiring; the explicit delete is the contract — wire it if a mutating
method returns before the TTL would naturally expire on a fast UI round-trip.)

## Compatibility

**Extend only by addition.** New methods, new job statuses, new error codes,
and new `status` fields may be added. Existing names MUST NOT be renamed or
removed, and existing `status` fields MUST NOT change type or semantics —
parallel agents and persisted job records depend on them. A rename breaks
every consumer at once; version new shapes under a new key instead
(e.g. `status2` is forbidden; add `status.new_field`).

**The v2 camelCase rename (fix/02-04) is the LAST permitted rename.** It
renamed the status fields from snake_case to camelCase (collected_at →
generatedAt, service_state → serviceState, queues → health, meta → split into
system + upstream, pids → instances, etc.) and bumped `schema` to 2. It was a
one-time, authorized break of the "no renames" rule, taken because the schema
was agreed before any parallel consumer shipped. From v2 forward the
no-rename rule applies in full: extend by adding fields and bumping `schema`.
