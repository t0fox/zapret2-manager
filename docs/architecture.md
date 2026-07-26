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

## 5. The paused flag

`/tmp/zapret2-manager/paused` is an intentionally-empty flag file. While it
exists:

- The hotplug hook `90-zapret2` does **not** raise the service.
- The init script does **not** start the service on boot/reload.
- The watchdog (§6) skips its **entire** cycle — not just the recovery step.

The flag is set by an explicit Stop from the UI (branch 04) and removed by an
explicit Start. It is the mechanism that makes "I stopped this on purpose"
stick across the events that would otherwise auto-raise it. It lives in `/tmp`
so a reboot clears it: a paused state is not a persistent preference, it is a
diagnostic stance for this uptime.

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
  fw4 wholesale — that destroys the entire nft table (incident r12). Use
  `fw4 reload_ifsets` and surgical edits inside table `zapret2` only. The UI
  must not expose a "restart firewall" button.
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

## 8. ubus / rpcd interface

The backend exposes a ubus object `zapret2-manager` over rpcd, with a `status`
method returning the three-level state plus the qlen signal. The response is
cached for **3 seconds** (the collector writes `/tmp/zapret2-manager/status.json`
and stamps it; the rpcd method serves the cached file when fresh and otherwise
re-runs the collector). The LuCI frontend calls this method and renders; it
does no state collection of its own.

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
│       ├── usr/libexec/zapret2-manager/
│       │   ├── constants.uc
│       │   ├── status.uc              (collector → status.json)
│       │   └── service.uc             (start/stop/…, paused flag)
│       ├── usr/libexec/rpcd/          (ubus object registration)
│       └── etc/init.d/zapret2-manager (watchdog daemon)
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
