# upstream-mapping — what the manager reads vs. controls

This document is the guardrail against the cardinal sin of this project:
duplicating an upstream function. For every concern the manager has, this
table names the upstream component that already handles it and whether the
manager **reads** it (observes), **controls** it (invokes upstream's own
mechanism), or **stays out** (upstream owns it entirely).

> **Provenance.** Facts marked *confirmed (external source)* are stated by this
> project's task spec and are not to be re-derived or guessed. Facts marked
> **[VERIFY:ROUTER]** still need the live router; each carries the exact
> `tools/smoke.sh` check that answers it. The three wrong facts from the first
> build (the qlen field index, the rpcd plugin load path, and the firewall
> refresh command) are corrected below and no longer carry a marker.

## Daemon & process

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| Is the daemon running? PID/CPU/RSS | `nfqws2` process | read | `ps` + `/proc/<pid>/stat`; manager never spawns its own worker |
| Actual flags the daemon uses | `/proc/<pid>/cmdline` of `nfqws2` | read | ground truth, not config — catches edited-but-not-restarted |
| Start the daemon | `/etc/init.d/zapret2 start` | control | manager calls upstream's start, never re-implements launch flags |
| Stop the daemon | `/etc/init.d/zapret2 stop` | control | plus the paused indicator (manager-only, §5 arch) |
| Pause = upstream start is a no-op | `NFQWS2_ENABLE=0` in the applied config | control | upstream honors its own variable; see REVIEW 1. *confirmed (external source)* that the variable exists; **[VERIFY:ROUTER]** whether it also stops fw rules → smoke.sh `pause_fw_effect`. |
| Daemon version | `/opt/zapret2/version` (file), else `nfqws2 <flag>`, else null | read | *confirmed (external source)*: read the version file first. The binary flag is **[VERIFY:ROUTER]** → smoke.sh 02 (`status.nfqws2_version` non-null on a device without the version file). |

## Strategy & rotation

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| What strategies are cycling now | `/etc/init.d/zapret2 list_table` | read | RUNTIME level; the manager parses, it does not rotate. *confirmed (external source)* — list_table is an init subcommand. |
| Rotation orchestration | upstream rotation (circular) | stay out | upstream owns rotation; manager only reports current generation |
| Strategy set in config | `/opt/zapret2/config` | read (APPLIED) | *confirmed (external source)*. Manager reads; the (later) editor writes via the config-generation apply path. |
| Config generation number | generation in the applied config | read | shown on Overview; manager does not bump it. **[VERIFY:ROUTER]** exact storage location → smoke.sh 03 (Overview shows a generation; if null, locate it and wire `applied.generation`). |

## Config sources (APPLIED level)

| Path | Role | Direction |
|---|---|---|
| `/opt/zapret2/config` | upstream main config the engine reads (shell-style VAR=value) | read |
| `/etc/config/zapret2` | UCI-native view of intent | read |
| `/opt/zapret2/version` | nfqws2 version file | read |

Both config sources are *confirmed (external source)*. The manager reads both
for the APPLIED level and for drift (REVIEW 2 uses BOTH, never one alone). It
does not write either directly; writes go through the config-generation apply
mechanism (later branch), never a raw file stomp.

## Firewall / nftables

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| nft table existence/integrity | nft table `zapret2` | read only | manager checks the table is present and non-empty; **never** rebuilds it |
| Install the zapret2 rules | `/etc/init.d/zapret2 start_fw` | control | installs the zapret2 nft rules when missing. Touches the zapret2 table only. |
| Re-read interface sets | `/etc/init.d/zapret2 reload_ifsets` | control | re-reads ifset membership after an interface came/went. Distinct from start_fw. |
| Raise rules on interface events | hotplug hook `90-zapret2` | stay out | upstream owns it; pause uses NFQWS2_ENABLE so its start is a no-op (REVIEW 1) |
| Full firewall restart | — | **forbidden** | never a wholesale firewall stop/restart (incident r12 + a factory reset) |

*Confirmed (external source)*: the full, exhaustive list of
`/etc/init.d/zapret2` subcommands is `start`, `stop`, `restart`,
`start_daemons`, `stop_daemons`, `restart_daemons`, `start_fw`, `stop_fw`,
`restart_fw`, `reload_ifsets`, `list_ifsets`, `list_table`. No others are
invented. `fw4` has no `reload_ifsets` subcommand; that is a zapret2 init
subcommand.

## NFQUEUE

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| Queue depth | `/proc/net/netfilter/nfnetlink_queue`, row selected by field 1 == 300 | read | fields: queue_total (3), copy_range (5), queue_dropped (6), queue_user_dropped (7). *confirmed (external source)*. |
| Queue number | 300 | constant | upstream binds it; manager matches field 1, not row order |

queue_total is instantaneous (threshold 50, three-consecutive → critical).
queue_dropped / queue_user_dropped are cumulative monotonic counters —
consumed as per-cycle deltas only, never compared to a threshold. If the queue
is not registered at all → null + `queue_not_registered` warning.

## Lists & blockcheck (present upstream, untouched this stage)

| Upstream component | Manager action this stage |
|---|---|
| autohostlists | none, except: watchdog rotates the autohostlist log (>1 MB → last 500 lines). The log path is read from `AUTOHOSTLIST_DEBUGLOG` in `/opt/zapret2/config` — *confirmed (external source)*, never hardcoded. All `AUTOHOSTLIST*` vars are surfaced in `status.meta.autohostlist` verbatim, with no manager thresholds. |
| `blockcheck2` | none (not built this stage; later branch may invoke it) |

The manager does not generate, merge, or serve hostlists. The log-rotation is
the only list-adjacent thing it does, and only because unbounded logs fill
`/overlay` on a flash-constrained device. If `AUTOHOSTLIST_DEBUGLOG` is unset
or the file is absent, rotation is a skip — not an error, not a warning.

## Passthrough (manager entity, no upstream option)

Passthrough is OURS — upstream has no passthrough UCI option and will not grow
one. It is a property of the nfqws2 options string: instance up, filters and
ports in place, no `--lua-desync` argument passed. It is NOT a UCI flag (would
desync from reality and create a 4th state level). The active profile is
recorded in DRAFT state for the UI, but the ENFORCEMENT is on the applied
config and the live argv, not on a flag.

ON takes the CURRENT applied `NFQWS2_OPT`, strips every `--lua-desync` arg
from it (keeping `--lua-init`, `--blob`, `--filter-tcp`, ports, etc. unchanged
— order and separators preserved), and writes the stripped string back to
`/opt/zapret2/config` through `apply.uc` (the single writer). The original
string is saved to `last-good/` so OFF restores it. Both ON and OFF snapshot +
arm the 90s rollback, so a passthrough that breaks the link auto-reverts. This
is a TRANSFORM of the existing string, not the from-profiles CONSTRUCTOR (that
renderer is still deferred to the strategy-editor branch, which will extend
`apply.uc`).

**[VERIFY:ROUTER]** enforcement is now wired (the applied `NFQWS2_OPT` carries
no `--lua-desync` after ON; the live argv reflects it after the restart) →
smoke.sh 05: `ubus call zapret2-manager passthrough '{"enabled":true}'`, then
read `/proc/<pid>/cmdline` (or `nfqws2-cmdline`) and assert NO `--lua-desync`
token is present while the daemon is up and the nft table is installed; OFF
restores the original and the `--lua-desync` args return.

## Draft state (manager-only)

| Path | Role |
|---|---|
| `/etc/zapret2-manager/state.json` | DRAFT level — manager's own staged edits (profiles, active profile, passthrough). Upstream never reads this. |

This path is not upstream. It exists so staged edits are not mistaken for
applied config (§3 arch).

## Events & runtime artifacts (manager-only)

| Path | Purpose |
|---|---|
| `/tmp/zapret2-manager/status.json` | cached three-level status (3 s TTL) |
| `/tmp/zapret2-manager/events.ndjson` | append-only telemetry, ndjson, events.v1 schema |
| `/tmp/zapret2-manager/paused` | paused indicator (presence = paused). Indicator only since REVIEW 1; coercion is NFQWS2_ENABLE. |
| `/tmp/zapret2-manager/qlen.state.json` | watchdog's queue signal state (consecutive, dropped baselines/deltas) |
| `/tmp/zapret2-manager/watchdog.state.json` | watchdog cycle state (cpu samples, last_alert timestamps) |
| `/tmp/zapret2-manager/applied.sha256` | applied-config hashes captured at apply time (drift, REVIEW 2) |
| `/tmp/zapret2-manager/last-good/` | snapshot for 90s rollback |
| `/tmp/zapret2-manager/pending-rollback` | marker + expiry for the 90s rollback timer |

All under `/tmp` (volatile) except the DRAFT state under `/etc`.

## How to use this table

Before writing any backend code, find your concern in the left column. If the
Direction is **read**, parse upstream's output — do not recompute it. If it is
**control**, call upstream's command — do not re-implement the effect. If it is
**stay out** or **forbidden**, do not write that code at all. A
**[VERIFY:ROUTER]** row names the smoke.sh check that confirms it on the live
device; remove the marker only after that check passes.

