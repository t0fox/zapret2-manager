# zapret2-manager architecture

## 1. Purpose and non-goals

zapret2-manager is a **management layer** over the upstream zapret2 DPI-bypass
engine. It does not bypass DPI. It does not rotate strategies, run blockcheck,
maintain hostlists, or own firewall rules. Upstream zapret2 does all of that.

What this feed owns:

- An honest UI in LuCI that reports real state, including failure.
- A **three-level state model** so the operator can tell running reality from
  applied config from an unapplied draft (see §3).
- Service control with a **paused flag** so a stopped service stays stopped
  across hotplug/init/watchdog events.
- A **watchdog** that recovers only from unexpected crashes.
- (Later branches) transactions with rollback, DNS-by-domain, monitoring.

**Invariants:**

- Any line duplicating an upstream function is a defect. Before adding code,
  check [upstream-mapping.md](upstream-mapping.md) — if upstream already does
  it, the manager reads it; it does not redo it.
- No Python or Lua in the UI. Backend is ucode + ash. Flash is small.
- No dependencies outside standard OpenWrt.

## 2. Target platform

Cudy WBR3000UAX v1, OpenWrt 25.12.5, aarch64_cortex-a53, **APK** packages,
IPv4 only, **NFQUEUE 300**. These are compile-time/runtime constants surfaced
in `usr/libexec/zapret2-manager/constants.uc` (added in branch 02) so they are
not sprinkled across the codebase.

## 3. The three-level state model

This is the core idea. There are three independent levels of "what state is the
service in", and they must never be blended into one field. They answer three
different questions, and each can disagree with the others — that disagreement
is the most important thing the UI shows.

### RUNTIME — "what is actually running right now?"

Sources, combined but not averaged:

- `ps` for the `nfqws2` process(es): present/absent, PID(s), CPU%, RSS.
- `list_table` output (upstream): the strategy table the daemon is actually
  cycling through right now.
- The **actual** command line of the running process, read from
  `/proc/<pid>/cmdline` (not from any config file). This is the ground truth
  of what flags the daemon was started with, regardless of what config says.

RUNTIME is recomputed on every status collection. It is never cached across
process restarts. If the process is gone, RUNTIME says gone — even if APPLIED
says it should be running.

### APPLIED — "what does the on-disk config say should run?"

Sources:

- `/opt/zapret2/config` — upstream's main config (the file the engine reads).
- `/etc/config/zapret2` — UCI config (OpenWrt-native view of the same intent).

APPLIED is the *intent that has been written to disk and that upstream will
honor on next start*. It is not necessarily what is running. If the operator
edited the file but did not restart, RUNTIME ≠ APPLIED and the UI must say so.

### DRAFT — "what has the operator staged in the manager but not applied?"

Source:

- `/etc/zapret2-manager/state.json` — the manager's own draft state. Edits made
  in the (later) strategy editor land here first. They are not written to
  `/opt/zapret2/config` or `/etc/config/zapret2` until an explicit apply.

DRAFT is purely the manager's concern. Upstream never reads it. It exists so
that an in-progress edit can survive a page reload without being mistaken for
applied config.

### Why three, not one

A single "status" field hides the failure modes that matter:

- **RUNTIME ≠ APPLIED** (yellow): the running daemon does not match on-disk
  config. Cause: edited-but-not-restarted, or upstream auto-rotated past the
  configured set, or a stale process. Operator action: review the diff, then
  restart or re-apply.
- **DRAFT ≠ APPLIED** (blue, informational): there are staged edits not yet
  applied. Operator action: apply or discard.
- **RUNTIME absent but APPLIED present** (red): the service should be running
  and isn't. This is what the watchdog keys on (§6), unless the paused flag is
  set (§5).

The Overview page (branch 03) renders all three and the divergences between
them. It does not paper over them.

## 4. The third liveness signal — NFQUEUE queue length

Process present + nft rules present is not enough. A wedged daemon can keep its
process and its rules while starving the queue. So a **third** liveness signal
is the NFQUEUE queue depth for queue **300**.

Read from `/proc/net/netfilter/nfnetlink_queue`, the row whose queue number is
300, the `qlen` field. (Parse with `awk`, not `grep` for the bracketed header —
see [hard rules](#7-hard-rules).)

- `qlen` ≤ 50: nominal.
- `qlen` > 50: warning. Start a consecutive-exceedance counter.
- Three consecutive collections with `qlen` > 50: **critical**, surfaced as a
  queue-jammed state on the Overview and recorded by the watchdog with source
  `qlen`.

This is deliberately a *third* signal. It catches the case where ps and the
rules table both look fine but packets are piling up unhandled — the exact
silent failure a process-only check would miss.

## 5. Pause (no service flap)

Pause = "I stopped this on purpose; do not let anything re-raise it." The
PRIMARY mechanism is upstream's variable `NFQWS2_ENABLE`: while the applied
config carries `NFQWS2_ENABLE=0`, upstream's `start` — called from init,
hotplug, another script, or by hand — is a no-op by upstream's own logic. No
flap, no duplicated firewall logic, no editing of upstream's files by us. The
change flows through the config-generation apply mechanism (same path as any
other change, including the 90s rollback), so pause is removed and rolled back
the same way as any edit.

`/tmp/zapret2-manager/paused` is now an **indicator only** (for the UI and the
watchdog), not the coercion mechanism. It lives in `/tmp` so a reboot clears
it: a paused state is not a persistent preference, it is a diagnostic stance
for this uptime.

While paused:

- The watchdog (§6) skips its **entire** cycle — not just the recovery step.
- The hotplug guard `90-zapret2-manager` is **telemetry-only** (fix/02-03):
  with `NFQWS2_ENABLE=0` effective, there is no running nfqws2 to find, so it
  does nothing. If it finds a running nfqws2 despite an active pause, the
  primary mechanism did not hold — a serious condition — and it emits a
  `source=hotplug`, `severity=crit` event. It does NOT stop the process: with
  the primary mechanism in place, stopping is upstream's job (a later start is
  a no-op while `NFQWS2_ENABLE=0`), and a guard that also stops would mask a
  broken primary mechanism instead of surfacing it. If this event fires, the
  operator must investigate why `NFQWS2_ENABLE=0` did not hold. The
  primary-form assumption is [VERIFY:ROUTER] via `tools/smoke.sh
  pause_fw_effect`; if it does not hold, revert to the fallback (active stop +
  `warn` event) and record the hole in `upstream-mapping.md`.

**Open question, one flag in one place.** Does `NFQWS2_ENABLE=0` stop only the
daemons, or also prevent firewall rule installation? If it stops only daemons,
`PAUSE_STOPS_FW=true` makes pause entry also call `stop_fw`. The answer is
produced on the live router by `tools/smoke.sh pause_fw_effect` (enter pause,
snapshot the zapret2 table via `list_table`, compare). `PAUSE_STOPS_FW` lives
in `constants.uc`.

> **Build status note.** Setting `NFQWS2_ENABLE` in the applied config is done
> by `usr/libexec/zapret2-manager/apply.uc` — the single sanctioned writer for
> `/opt/zapret2/config`, added in fix/02-01. `service.uc` calls `set_var` /
> `read_var` there; it never writes the file itself. The previous
> `NFQWS2_ENABLE` value is captured to `last-good/` before a pause and restored
> on resume (not hardcoded 1). The apply MECHANISM (write a var) is built; the
> full options-string CONSTRUCTOR from profiles remains deferred to the
> strategy-editor branch, which will extend `apply.uc` (call `set_var`) rather
> than bypass it. The guard hook's active stop is removed in fix/02-03 (the
> primary `NFQWS2_ENABLE=0` mechanism now holds by design; confirmed on target
> via `tools/smoke.sh pause_fw_effect`).

## 6. Watchdog

`/etc/init.d/zapret2-manager` runs a daemon (branch 06) on a 60-second cycle.
On each cycle, if the paused flag is **absent**, it checks:

- `nfqws2` process present.
- nft table `zapret2` integrity (the table exists and is non-empty; the
  manager never rebuilds it — it only checks it).
- NFQUEUE qlen (§4), with the three-consecutive rule.

Auto-recovery (restart the service) happens **only** on an unexpected crash
(process gone, not paused). It does not run on threshold breaches — thresholds
alert, they do not self-heal, because self-healing a CPU-spiking daemon can
thrash.

Thresholds:

- CPU: warn at 70% sustained over 180s; critical at 90% sustained over 60s.
- Free RAM: critical below 40 MB.
- `/overlay` usage: critical above 90%.
- Alert cooldown: 600s between repeated alerts for the same condition.
- qlen: §4 (50, three turns).

All events are appended to `/tmp/zapret2-manager/events.ndjson`, one JSON object
per line, each carrying a **`source`** field drawn from
`ui | watchdog | qlen | lists | hotplug`. The autohostlist log (upstream's)
is rotated by the manager when it exceeds 1 MB, trimmed to the last 500 lines.

## 7. Hard rules

These are non-negotiable. Each encodes a past incident.

- **No full firewall restart.** Never `service firewall stop` and never restart
  fw4 wholesale — that destroys the entire nft table (incident r12) and once
  reset this router to factory defaults. Only upstream's own
  `/etc/init.d/zapret2 start_fw` (install rules) and
  `/etc/init.d/zapret2 reload_ifsets` (re-read ifsets) — both touch the
  zapret2 table only. The UI must not expose a "restart firewall" button.
- **ssh rc=255 is a dropped connection**, not a check result. Every ssh call in
  the tools checks the return code and treats 255 as comms failure, never as a
  green check. (Past green tests were false this way.)
- **`grep` for bracketed patterns uses `-F`.** Square brackets are regex
  character classes. (Past code broke silently here with green tests.)
- **Autostart is verified by a real reboot**, not by the presence of an
  `/etc/rc.d` symlink. `enable` does not guarantee start.
- **Before applying a config change**, verify LuCI and ssh are reachable, and
  auto-rollback to `last-good` if the operator does not confirm "link alive"
  within 90 seconds.
- **Mock tests are not proof.** Each branch is verified on a live router via
  `tools/smoke.sh`.
- **A gate whose ability to go RED is unproven is considered absent.** Every
  gate has a self-test: run it on a known-broken sample (must return non-zero)
  and a known-good sample (must return zero); if either fails, the self-test
  reports the gate non-functional. Reason: this project once had a gate that
  never fired on green tests (the ucode syntax gate used `ucode -p FILE`, but
  `-p` takes an EXPRESSION and prints it — a filename-as-string evaluates to
  itself, rc=0 always, so the gate was degenerate always-green) and it cost a
  day. The ucode syntax flag is `-c` (compile), confirmed by the live-router
  fixture. Self-tests run before the gates they test
  (`tools/smoke.sh ucode_syntax_selftest` before `ucode_syntax_check`;
  `tests/gate-selftests.test.sh` for the local gates). Broken samples live in
  `tests/fixtures/gate-samples/` — they neither ship nor get checked by the
  normal gates.

## 8. ubus / rpcd interface

The backend exposes a ubus object `zapret2-manager` over rpcd, with a `status`
method returning the three-level state plus the queue signal, and mutating
methods for service control. The `status` response is cached for **3 seconds**
(the collector writes `/tmp/zapret2-manager/status.json` and stamps it; the
rpcd method serves the cached file when fresh and otherwise re-runs the
collector). The LuCI frontend calls these methods and renders; it does no state
collection of its own. The full method list, long-operation model, error form,
and caching rules are specified in [docs/contracts/ubus.md](contracts/ubus.md).

### Two rpcd plugin contracts — do not mix

rpcd loads plugins by **two different, incompatible contracts**. A file's
location determines which contract rpcd expects, and getting it wrong silently
breaks ubus registration.

- **Exec-plugin** — `/usr/libexec/rpcd/`. An executable that reads a JSON
  request on stdin, writes a JSON reply on stdout, and answers a `list` call.
  This is the classic rpcd plugin mechanism (C `.so` or a script behaving as
  one). We do **not** use this.
- **ucode signature plugin** — `/usr/share/rpcd/ucode/`. A ucode script that
  **returns a signature object** describing ubus objects and their methods.
  The top-level key of the returned object is the ubus object name; methods
  are nested under it. **This is what we use.**

Our plugin is `usr/share/rpcd/ucode/zapret2-manager.uc` and returns
`{ "zapret2-manager": { methods: { … } } }`. The top-level key
`zapret2-manager` must match, symbol for symbol, the ubus object name granted
in `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
— a mismatch registers the object but denies LuCI by permission, which renders
as an empty page with no error.

Internal ucode libraries (`constants.uc`, `qlen.uc`, `status.uc`, `service.uc`,
`watchdog.uc`) stay under `/usr/libexec/zapret2-manager/` — they are not rpcd
plugins. Only the ubus-registering script lives in `/usr/share/rpcd/ucode/`.
Do not move it back to `/usr/libexec/rpcd/`: that directory's exec-plugin
contract would not load a signature-returning script.

## 9. File layout

```
zapret2-manager/                       (feed root)
├── README.md  LICENSE  .gitignore
├── docs/
│   ├── architecture.md                (this file)
│   └── upstream-mapping.md
├── tools/
│   ├── deploy.sh                      (build + apk install + verify)
│   └── smoke.sh                       (per-branch live-router gates)
├── zapret2-manager/                   (backend package)
│   ├── Makefile
│   └── files/
│       ├── etc/zapret2-manager/state.json   (DRAFT state, empty {})
│       ├── etc/hotplug.d/iface/90-zapret2-manager  (paused enforcer)
│       ├── etc/init.d/zapret2-manager       (procd: watchdog daemon)
│       ├── usr/share/rpcd/ucode/zapret2-manager.uc  (ubus object, signature plugin)
│       └── usr/libexec/zapret2-manager/
│           ├── constants.uc           (NFQUEUE 300, paths, thresholds)
│           ├── qlen.uc                (shared nfnetlink_queue parser)
│           ├── status.uc              (collector → status.json)
│           ├── service.uc             (start/stop/…, paused flag, rollback)
│           ├── watchdog.uc            (60s cycle: process/rules/qlen/CPU/RAM/overlay)
│           └── log-rotate.sh          (autohostlist log >1 MB → last 500 lines)
└── luci-app-zapret2-manager/          (frontend package)
    ├── Makefile
    └── files/
        ├── usr/share/rpcd/acl.d/      (ACL)
        ├── usr/share/luci/menu.d/     (menu entry)
        └── www/luci-static/resources/view/zapret2-manager/
            └── overview.js            (LuCI JS view)
```

Paths marked with a verify-marker in [upstream-mapping.md](upstream-mapping.md)
are the ones to confirm against the target SDK on first build.

## 10. State model review (plan-eng-review)

This section is the engineering review of the whole state model, run once
before the fix/02-* implementation branches. It covers the three state
levels, pause, passthrough, config generations, the 90s rollback, and the
transitions between `serviceState` values, with a state diagram and a
catalog of failure modes. Findings that change the implementation are
called out inline and gathered at the end.

### 10.1 The three levels (recap, see §3)

```
        RUNTIME                 APPLIED                  DRAFT
  "what runs now"        "what disk says"        "what operator staged"
  ps + /proc/<pid>/      /opt/zapret2/config     /etc/zapret2-manager/
  cmdline + list_table   (+ /etc/config/zapret2  state.json
  nft table dump          IF it exists)           upstream never reads
  recompute each         upstream honors on      this; survives reload
  collect; never cached  next start              without being mistaken
  across restarts                                for applied
```

The three are NEVER blended into one field. Their disagreement IS the
signal the UI shows. Drift (RUNTIME vs APPLIED) is backend-computed in the
`drift` block; the UI only renders it.

**Fixture sample (UNCONFIRMED origin):** the fixtures in `tests/fixtures/`
were collected from a router by `tools/collect-fixtures.sh` before that
device was factory-reset. The engine is no longer on the device, so the
snapshots CANNOT be re-verified against the current target. They are samples
of the upstream config/rule format, NOT verified live-target readings. The
infra branch therefore does NOT close any [VERIFY:ROUTER] marker; all such
markers remain OPEN until a freshly installed engine is checked on the
device (see the interrupt rule). Treat as format samples only:

- `/etc/config/zapret2` was absent in the snapshot (`cat` rc=1). The APPLIED
  level is likely `/opt/zapret2/config` only on this installation. The drift
  code already handles an absent UCI source (`sha256_file` → null, divergence
  gates on `stored.uci != null && cur_uci != null`), so this is consistent,
  not a defect. CONFIRM ON DEVICE (do not assume from the snapshot).
- `/opt/zapret2/version` was absent (rc=1); version resolution falls back to
  the binary. CONFIRM ON DEVICE.
- The snapshot's NFQWS2_OPT uses one nfqws2 argument per line inside a
  double-quoted multi-line value (opening `"` alone, closing `"` alone). If
  the real config on a freshly installed engine lays out long values
  differently, the writer/stripper self-tests (built on this snapshot) must
  be re-run on the real sample; a format mismatch is a BLOCKER.

### 10.2 serviceState — closed enum, backend-computed

`serviceState` is a single scalar field with a CLOSED value set. The backend
(status collector) derives it; the UI maps a value to a badge (presentation
only — no threshold/state logic in the UI). `paused` and `passthrough` are
self-standing states, NOT flags layered on `running`.

```
                         serviceState state machine

   start/resume ─────► running ─────► stop/pause-enter ─────► paused
        ▲                  │                                  │
        │                  │ rules missing                    │ resume
        │                  ▼                                  │
        │                partial ◄──── (process up,           │
        │                  │            nft table absent)     │
        │                  │                                  ▼
        │                  │ queue not registered      passthrough
        │                  │ / queue jammed (3×)        (toggle on)
        │                  ▼                                  │
        │                error ◄────── collector failed       │ toggle off
        │                  │                                  │
        │                  │ process gone                     │
        ▼                  ▼                                  ▼
   running ◄──────────  stopped ◄──── stop (clean) ◄──── running/passthrough
```

Value set and how the backend picks it:

| value | when | cls |
|---|---|---|
| `running` | process present, rules present, qlen nominal | ok |
| `stopped` | process absent (and not paused/passthrough) | bad |
| `partial` | process present, nft table `zapret2` absent/empty | warn |
| `error` | queue not registered, OR queue jammed (3× critical), OR collector failed | bad |
| `paused` | `/tmp/zapret2-manager/paused` indicator present AND a pause was entered | warn |
| `passthrough` | active profile is the no-strategy passthrough profile | ok |

Note: the qlen `warn` (single cycle >50, not yet 3×) does NOT change
`serviceState` away from `running`; it is carried in `health.qlenHealth.state`.
This keeps `serviceState` stable across one-cycle blips while the qlen block
shows the detail. (The current collector emits `warn`/`degraded`/`unknown`
serviceState values; the fix/02-04 branch remaps them into the closed set
above — `degraded`→`error`, `warn`→`running` with qlenHealth=warn,
`unknown`→`error`.)

### 10.3 Pause and passthrough

```
PAUSE:  "I stopped this on purpose; do not re-raise it."
  primary mechanism  : NFQWS2_ENABLE=0 in /opt/zapret2/config
                       → upstream start is a no-op BY UPSTREAM'S LOGIC
                       (init, hotplug, manual — all no-op). No flap.
  indicator only     : /tmp/zapret2-manager/paused  (UI + watchdog read it)
  entry              : snapshot previous NFQWS2_ENABLE to last-good,
                       set NFQWS2_ENABLE=0 via the apply path, (optionally
                       stop_fw if NFQWS2_ENABLE=0 does not also clear fw
                       rules — PAUSE_STOPS_FW, one constant)
  exit               : restore the previous NFQWS2_ENABLE from last-good
                       (NOT a hardcoded 1), clear indicator
  rollback           : same path as any config change (§10.4). The AUTOMATIC
                       90s timer is OFF by default (ROLLBACK_TIMEOUT_ENABLED =
                       false); manual rollback via the 'rollback' ubus method
                       is available. See §10.4.

PASSTHROUGH:  "instance up, filters/ports in place, no fakes sent."
  mechanism          : the nfqws2 options string (NFQWS2_OPT) with EVERY
                       --lua-desync argument removed; the rest unchanged.
                       It is a property of the GENERATED argv, not a flag.
  no UCI flag        : a flag would desync from reality and create a 4th
                       state level. Passthrough is visible in the live argv
                       and in the config generation, not only in our state.
  entry              : snapshot current NFQWS2_OPT to last-good, strip
                       --lua-desync args, write the stripped string via the
                       apply path, restart
  exit               : restore the original NFQWS2_OPT from last-good
  visibility         : serviceState = passthrough; live argv has no
                       --lua-desync; generation counter advanced
```

**Apply mechanism — built (was absent).** Both pause and passthrough
require writing `/opt/zapret2/config` (set `NFQWS2_ENABLE`, replace
`NFQWS2_OPT`) through the sanctioned single write path. The task spec
states that path — `usr/libexec/zapret2-manager/apply.uc` — already exists
and can write `NFQWS2_ENABLE`/`NFQWS2_OPT`. **It did not exist**: no branch
(ui/00..06, main, fix/01, infra/01) contained a file named `apply.uc`; no
commit in history added one; it was referenced nowhere; and no code in the
repo wrote `/opt/zapret2/config` (every reference was a read). The project
memory and the old §5 "Build status note" stated the config-generation/apply
mechanism was deferred to a future strategy-editor branch.

A second opinion was run (codex CLI was unavailable in this environment —
no binary, no OpenAI auth — so a fresh independent agent review was used as
the substitute; see the branch report). It made the load-bearing
distinction the original [ASK] had fused: the spec defers TWO different
things — (1) the apply *mechanism* (write a var, snapshot, restart, arm
rollback), which the spec says EXISTS and is to be USED; (2) the full
options-string *constructor from profiles*, which is deferred to the
strategy editor. Point 1 writes `NFQWS2_ENABLE` (a single shell line — the
apply mechanism). Point 2 writes a *transformed* `NFQWS2_OPT` (strip
lua-desync from the existing string — also the apply mechanism, since the
spec says apply.uc "can write NFQWS2_OPT"; it is NOT the from-profiles
constructor). `apply.uc` is our own repo file, not an upstream fact, so the
"missing fact = [ASK]" rule (an upstream-fact rule) does not apply; and
building the sanctioned single-writer is the OPPOSITE of the "don't invent a
bypass" escape hatch. Most importantly, [ASK] would not close the pause
hole — the user's stated main goal.

Decision: BUILD a minimal `apply.uc` — a single-writer for
`/opt/zapret2/config` (`read_var`/`write_var`, surgical per-variable:
simple `VAR=value` line-replace for `NFQWS2_ENABLE`, multi-line quoted
value-replace for `NFQWS2_OPT`), composing the existing
`snapshot_last_good`/`restart`/`schedule_rollback`/`capture_applied_hash`
primitives in `service.uc`. The previous `NFQWS2_ENABLE` value is captured
to `last-good/` before entry and restored on exit (not hardcoded 1). The
API is narrow and designed for the strategy-editor branch to EXTEND (add
the from-profiles renderer that calls `write_var`) rather than rewrite.
The from-profiles constructor remains deferred and is NOT built here.

**Verification split.** ucode does not run in this environment (no binary;
only the router has it). So: the writer/stripper ALGORITHM is verified
locally via a node self-test against the real `/opt/zapret2/config` fixture
and the task's edge cases (red before the function exists, green after);
the ucode implementation is verified to match by review + the static gates
(no `?.`/`??`, no snake_case in collector JSON); its RUNTIME behavior is
confirmed on target via `tools/smoke.sh`. Per the task, nothing is claimed
to "work" on the strength of the node equivalent alone.

### 10.4 Config generations and the 90s rollback

```
  operator stages edit ──► DRAFT (/etc/zapret2-manager/state.json)
                                │
        explicit apply ─────────┤  (the apply mechanism; apply.uc)
                                ▼
  snapshot prior ──► APPLIED (/opt/zapret2/config)     last-good/
  state to last-good  generation = N → N+1              config, uci,
                                │                       applied.sha256
                                ▼
  upstream restart ──► RUNTIME reflects new APPLIED
                                │
        confirm_alive (manual) ─── removes pending marker
                                │
        rollback (manual, ubus) ─── restore last-good, restart, event crit
                                │
        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
        AUTOMATIC 90s timer path: OFF BY DEFAULT (ROLLBACK_TIMEOUT_ENABLED=false)
        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
        when enabled: confirm_alive within 90s? yes → commit
                                         no (timer fires) → rollback
        default: NOT armed. A premature rollback drops the device link, and a
        stale-timer defect was already found in this path. Enable only after
        the timer path is confirmed on the device (smoke.sh rollback_timer).
```

- The generation counter lives in the applied config; the manager does not
  bump it (upstream does, on its own apply). The manager READS it.
- `snapshot_last_good()` copies `/opt/zapret2/config` (+ UCI if present)
  into `/tmp/zapret2-manager/last-good/` and captures sha256 of both
  applied sources into `applied.sha256` (the drift intermediate basis).
  This ALWAYS runs, so manual rollback always has a baseline.
- `schedule_rollback()` arms the automatic timer ONLY when
  `ROLLBACK_TIMEOUT_ENABLED` is true (default false). The mechanism
  (`rollback`, `confirm_alive`, the marker, the detached timer) stays; only
  the default arming is off. Manual rollback via the `rollback` ubus method
  is always available.
- The automatic timer path is marked INACTIVE-BY-DEFAULT in the diagram
  above. Enable it (one constant) only after the timer is confirmed on the
  device.

### 10.5 Failure-mode catalog

| # | failure mode | detection | response | who owns |
|---|---|---|---|---|
| F1 | process gone, not paused | watchdog: no pids | recover via upstream `start` (the ONLY auto-recovery); event crit | watchdog |
| F2 | nft table `zapret2` missing/empty | watchdog: `nft list table` | alert only (never rebuild — upstream owns the table); event crit | watchdog |
| F3 | queue not registered (nfqws2 not connected) | collector + watchdog: field 1 != 300 | serviceState=error; event crit | collector/watchdog |
| F4 | queue jammed (queue_total >50 for 3 consecutive cycles) | watchdog consecutive counter | serviceState=error; event crit | watchdog |
| F5 | queue_dropped delta > 0 (kernel couldn't enqueue) | watchdog delta vs prev cycle | event warn (appears BEFORE queue_total grows) | watchdog |
| F6 | RUNTIME ≠ APPLIED (edited-but-not-restarted, or auto-rotated) | collector drift block (sha256 of both applied sources vs apply-time capture) | UI shows divergence + diff; no auto-action | collector |
| F7 | link breaks after a config change | 90s rollback timer fires (no confirm_alive) | restore last-good, restart, event crit | service.uc |
| F8 | pause does not hold (nfqws2 found running while paused) | hotplug guard on ifup | [depends on point 1] primary: NFQWS2_ENABLE=0 holds → guard is telemetry-only, event crit (primary failed). fallback (point 1 [ASK]): guard actively stops + event warn | hotplug guard |
| F9 | CPU spike / RAM low / overlay full | watchdog thresholds | alert only (never self-heal — self-healing a CPU-spiking daemon can thrash); cooldown 600s | watchdog |
| F10 | collector itself fails | try/catch per section | partial status with `error` in the failed block; serviceState=error | collector |
| F11 | apply path cannot write without side effects on NFQWS2_OPT | (the [ASK]) | stop + [ASK]; do not invent a bypass or a second write path | — (blocked) |
| F12 | ucode plugin fails to load (unsupported syntax) | blank LuCI page, no error | point 6 removes `?.`/`??` and reliance on unconfirmed interpreter semantics so load can't fail on sugar | all ucode |

### 10.6 Review findings (load-bearing)

1. **[ASK] apply.uc absent** — blocks points 1 & 2 at the write step. Not
   conjectured; surfaced. Points 1 & 2 deliver the apply-independent,
   test-first parts and document the [ASK]. Points 3 (fallback), 4, 5, 6
   are unaffected.
2. **Point 3 premise depends on point 1** — point 3's primary form (guard
   becomes telemetry-only) requires pause to be held by `NFQWS2_ENABLE=0`.
   With point 1 [ASK]-blocked, point 3 takes its fallback form: the guard
   stays active and the hole is documented in `upstream-mapping.md`. This
   deviation is reported, not silently forced into the primary form.
3. **`/etc/config/zapret2` absent on this installation** — drift code
   handles it; no change. Noted so future readers don't expect the UCI
   source to exist.
4. **`list_table` is an nft table dump, not a "strategy table"** — the
   current collector's `profile_count` (counting non-empty lines of an nft
   dump) is semantically wrong. Out of scope for fix/02-* (the strategy
   editor owns list_table→strategies); noted as a finding.
5. **ucode syntax gate uses the wrong flag** — `tools/smoke.sh` uses
   `ucode -p FILE`; the real interpreter's `-p` takes an EXPRESSION (prints
   result), not a file, so the gate is degenerate always-green. The real
   compile/syntax flag is `ucode -c FILE`. Point 5 replaces this with a
   self-tested gate that proves it can go red.
6. **nfqws2 binary path** — the real binary is `/opt/zapret2/nfq2/nfqws2`,
   not `nfqws2` from PATH. The version fallback in `status.uc` calls
   `nfqws2 <flag>` and may fail if the binary is not in PATH. Out of scope
   for fix/02-* (the version path is a pre-existing [VERIFY:ROUTER]); noted.

## GSTACK REVIEW REPORT

Runs: plan-eng-review (single run, whole state model).

Status: DONE_WITH_CONCERNS — the state model is coherent; one load-bearing
[ASK] (apply.uc absent) blocks the write step of points 1 & 2 and flips
point 3 to its fallback form. All other points proceed.

Findings:

| # | finding | severity | disposition |
|---|---|---|---|
| 1 | apply.uc did not exist; task premise false | block → resolved | BUILD minimal apply.uc (apply mechanism, not the deferred constructor); points 1 & 2 close; point 3 primary form |
| 2 | point 3 primary form depends on point 1 | dependency | point 1 closes → point 3 primary form (guard telemetry-only); [VERIFY:ROUTER] via smoke.sh |
| 3 | /etc/config/zapret2 absent on device | info | drift code handles it; noted |
| 4 | list_table is nft dump, profile_count wrong | info | out of scope (strategy editor); noted |
| 5 | ucode -p gate is degenerate always-green | bug | point 5 fixes + self-tests |
| 6 | nfqws2 binary not in PATH | info | out of scope; noted |

VERDICT: proceed with all six points. Points 1 & 2 build route through the
new minimal apply.uc (algorithm verified locally via node self-test on the
real fixture; ucode runtime confirmed on target via smoke.sh). Point 3
takes primary form (guard becomes telemetry-only) because point 1 closes
the primary pause mechanism; the primary-form assumption is [VERIFY:ROUTER]
(smoke.sh confirms NFQWS2_ENABLE=0 holds; if not, revert to fallback).
Points 4, 5, 6 as specified. codex CLI was unavailable; a fresh independent
agent review was used as the second opinion on finding 1 — it supplied the
apply-mechanism-vs-constructor distinction that flipped the decision from
[ASK] to BUILD.

NO UNRESOLVED DECISIONS
