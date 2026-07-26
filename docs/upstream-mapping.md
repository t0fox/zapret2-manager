# upstream-mapping — what the manager reads vs. controls

This document is the guardrail against the cardinal sin of this project:
duplicating an upstream function. For every concern the manager has, this
table names the upstream component that already handles it and whether the
manager **reads** it (observes), **controls** it (invokes upstream's own
mechanism), or **stays out** (upstream owns it entirely).

> **Provenance note.** The upstream `docs/manual.md` could not be fetched in the
> environment this repo was first written in (web search returned no results).
> Rows marked **[VERIFY]** are inferred from the task spec's stated integration
> contract plus knowledge of the original bol-van/zapret architecture; they
> must be confirmed against the real zapret2 `docs/manual.md` on first build and
> corrected here. Rows without the marker are stated directly by the task spec.

## Daemon & process

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| Is the daemon running? PID/CPU/RSS | `nfqws2` process | read | `ps` + `/proc/<pid>/stat`; manager never spawns its own worker |
| Actual flags the daemon uses | `/proc/<pid>/cmdline` of `nfqws2` | read | ground truth, not config — this is what catches edited-but-not-restarted |
| Start the daemon | upstream init script / `zapret2` service | control | manager calls upstream's start, never re-implements launch flags |
| Stop the daemon | upstream init script stop | control | plus sets paused flag (manager-only, §5 arch) |
| Daemon binary version | `nfqws2 --version` [VERIFY exact flag] | read | for the upstream-update badge on Overview |

[VERIFY]: the exact `--version`/`-v` flag and output format of `nfqws2`.
Confirm against upstream `docs/manual.md` and record here.

## Strategy & rotation

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| What strategies are cycling now | `list_table` command/output [VERIFY exact invocation] | read | RUNTIME level; the manager parses, it does not rotate |
| Rotation orchestration | `zapret-auto.lua` (mode `circular`) [VERIFY] | stay out | upstream owns rotation; manager only reports current generation |
| Strategy set in config | `/opt/zapret2/config` [VERIFY path] | read (APPLIED) | manager reads; the (later) editor writes via upstream's apply path |
| Config generation number | a generation marker in `/opt/zapret2/config` or a sidecar [VERIFY] | read | shown on Overview; manager does not bump it |

[VERIFY]: exact `list_table` invocation and output schema; the on-disk location
of the config generation counter; whether `zapret-auto.lua` is the real
rotation entrypoint in zapret2 (it is in zapret). Confirm and record.

## Config sources (APPLIED level)

| Path | Role | Direction |
|---|---|---|
| `/opt/zapret2/config` [VERIFY] | upstream main config the engine reads | read |
| `/etc/config/zapret2` [VERIFY] | UCI-native view of intent | read |

The manager reads both for the APPLIED level. It does not write either in this
stage. Writes come with the (later) strategy editor and go through upstream's
own apply/reload path, never as a direct file stomp.

## Firewall / nftables

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| nft table existence/integrity | nft table `zapret2` [VERIFY table name] | read only | manager checks the table is present and non-empty; **never** rebuilds it |
| Raise rules on interface events | hotplug hook `90-zapret2` [VERIFY] | stay out | upstream owns it; paused flag makes it no-op (manager writes the flag, not the rules) |
| Reload interface sets | `fw4 reload_ifsets` | control (service-control branch) | the *only* firewall-touching command the manager issues |
| Full firewall restart | — | **forbidden** | never `service firewall stop` / fw4 wholesale restart (incident r12) |

[VERIFY]: exact nft table name (`zapret2` per spec) and the hotplug script
path/filename. Confirm the `fw4 reload_ifsets` subcommand name on 25.12.5.

## NFQUEUE

| Manager concern | Upstream artifact | Direction | Notes |
|---|---|---|---|
| Queue depth | `/proc/net/netfilter/nfnetlink_queue`, row queue 300, field `qlen` | read | third liveness signal; manager never creates or binds the queue |
| Queue number | 300 | constant | upstream binds it; manager matches it for reading |

## Lists & blockcheck (present upstream, untouched this stage)

| Upstream component | Manager action this stage |
|---|---|
| autohostlists (auto-maintained host lists) | none, except: watchdog rotates the autohostlist log (>1 MB → last 500 lines) |
| `blockcheck2` | none (not built this stage; later branch may invoke it) |

The manager does not generate, merge, or serve hostlists. The log-rotation is
the only list-adjacent thing it does, and only because unbounded logs fill
`/overlay` on a flash-constrained device.

## Draft state (manager-only)

| Path | Role |
|---|---|
| `/etc/zapret2-manager/state.json` | DRAFT level — manager's own staged edits. Upstream never reads this. |

This path is not upstream. It exists so staged edits are not mistaken for
applied config (§3 arch).

## Events & runtime artifacts (manager-only)

| Path | Purpose |
|---|---|
| `/tmp/zapret2-manager/status.json` | cached three-level status (3 s TTL) |
| `/tmp/zapret2-manager/events.ndjson` | append-only event log with `source` field |
| `/tmp/zapret2-manager/paused` | paused flag file (presence = paused) |

All under `/tmp` (volatile) except the DRAFT state under `/etc`.

## How to use this table

Before writing any backend code, find your concern in the left column. If the
Direction is **read**, parse upstream's output — do not recompute it. If it is
**control**, call upstream's command — do not re-implement the effect. If it is
**stay out** or **forbidden**, do not write that code at all. If a row is
**[VERIFY]**, the path/flag/output shape must be confirmed on the target device
and the marker removed once confirmed.
