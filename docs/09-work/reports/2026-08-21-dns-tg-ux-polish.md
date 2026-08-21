# DNS and Telegram Proxy UX polish — 2026-08-21

## Scope

Presentation-only polish over the existing Z2M DNS and Telegram Proxy products.
No DNS writer, Telegram lifecycle, secret lifecycle, filesystem ownership, or
System update installer was added or replaced.

## Capability matrix

| Capability | Avatar reference | Z2M before | Z2M after |
|---|---|---|---|
| DNS health summary | task/status card | mixed raw status and generic RPC errors | shared OK/OFF/DEGRADED/UNKNOWN/ERROR semantics, dnsmasq and last-apply cards |
| DNS profile/provider workflow | task-first DNS routing | existing rich workflow | same profile/provider → Preview → Apply flow, with advanced panes retained |
| DNS ownership details | advanced diagnostics | existing history/advanced data | managed/external, provenance and revision disclosure retained in the first screen |
| DNS async apply | progress/job pattern | canonical Service DNS polling | unchanged canonical polling and unmount cleanup |
| Telegram status | dashboard/diagnostics | status, actions and health chain existed but were dispersed | explicit Installed / Provider / Running / Health / Version / Update / Settings summary |
| Telegram install/update | owner page | canonical product transaction and operation modal | same `checkUpdates`/`switch`/operation polling lifecycle; System → Updates links to owner |
| Errors | actionable component states | generic backend/RPC wording in several paths | human message plus expandable technical evidence |
| Polling teardown | lifecycle cleanup | DNS cleanup; TG timer could survive unmount | both paths clear timers; TG generation guard rejects late responses |

## Preserved authority evidence

DNS source still calls the existing product `validate`, `preview`, `apply` and
legacy `rollback` paths, plus the existing Service DNS async status flow.
Provider selection and dnsmasq/service ownership were not moved.

Telegram source still uses the existing catalog/status/versions/operationStatus
reads, `checkUpdates` + `switch` transaction, and canonical start/stop/restart,
remove and purge operations. System Updates adds only a link to
`#/telegram-tunnel`; it does not call Telegram install/update/switch methods.

## Verification

- Focused UX and ownership suite: **8/8 PASS** (`tests/ui/dns-tg-ux-polish.test.mjs`).
- DNS/TG/System regression subset: **17/17 PASS**.
- Packaging/lifecycle subset: **48/51 PASS**; the three reds reproduce on the
  clean baseline and are unrelated pre-existing closure/ACL failures.
- JavaScript syntax checks and `git diff --check`: PASS.
- Knowledge validator: only the two pre-existing findings remain:
  `z2k-p5-parity-matrix.md` missing frontmatter and `z2k-parity.md` unreachable.

## Screenshot evidence

No live LuCI/router endpoint is available in this workspace, so before/after
screenshots were not captured and are not claimed. The source-level evidence is
the shared health-card CSS and the DNS/TG/System render contracts above.
