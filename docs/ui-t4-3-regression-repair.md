# T4.3 — UI regression repair and usable Auto Strategy page

## Scope and guardrails

T4.3 repairs the presentation layer only. The strategy corpus, probe semantics,
ranking, state machine, Apply/Rollback writers, RPC names, service contracts,
candidate IDs, ACLs, nfqws2 and NFQUEUE configuration were not changed. No
router reboot or service restart was performed.

## Root cause

The T4.2 Auto summary rendered six key/value nodes in a six-column grid while
the shared label rule reserved `flex-basis: 180px` in each cell. At normal
LuCI widths each cell therefore had no usable value width, so labels, numbers
and badges wrapped into individual symbols. The same render path also passed
arrays directly through the shared SummaryPanel/DetailsDisclosure helpers;
normalizing arrays to a wrapper node prevents nested child coercion. The
selector was appended before the operation and journal, which made the useful
evidence appear too low on the page.

## Repair

- Auto summary is exactly four fields in a 2-column desktop/tablet grid and a
  1-column mobile grid; labels and values stack with bounded wrapping.
- Header retains the single primary action. The active operation exposes
  service, strategy, checked count, attempts, elapsed/remaining time, phase and
  a secondary Stop action. Stale runs show an honest notice instead.
- Journal is directly after the current operation, uses fixed semantic desktop
  columns, bounded long technical names, and responsive row cards on mobile.
- Service selection is a closed disclosure by default, with localized category
  labels and 3/2/1 columns for desktop/tablet/mobile.
- Overview rows use a compact label/value grid and the CTA is `Открыть
  автоподбор`; technical and diagnostic data stay collapsed.

## Verification

Focused UI/compatibility set: 111/111 tests green. Full gate:
`tools/run-all-tests.sh` — 1117 Node tests green, 10 shell gates green, 0 red.

Browser fixture evidence was captured with the real Chromium browser at
1366×768, 1920×1080, 1024×768 and 390×844. All viewports reported no
horizontal overflow, four summary fields, closed selector, and 2/2/1 summary
columns as expected; console had no errors and network was empty. Screenshots
are `artifacts/t4-3-browser-*.png`. This is local DOM fixture evidence, not an
authenticated target acceptance result.

The target LuCI page was also checked directly. It returned HTTP 403 and the
browser showed `Authorization Required`; the target DOM could not be reached
without credentials. Evidence is `artifacts/t4-3-target-browser-auth-blocked.png`,
so the final browser verdict is PARTIAL rather than PASS.

## Release and target smoke

Built release r135. SHA-256:

- `zapret2-manager-0.1.0-r135.apk` — `ce826a7c520ffb1bbf37510325fd9dbbc3e5f3911a3bbd6c24c3d9c08b6d41ee`
- `luci-app-zapret2-manager-0.1.0-r135.apk` — `39046c47dd346b415621e52a3a05130162013f6590d087d398ded30ff328f63b`
- `zapret2-manager-full-0.1.0-r135.apk` — `2ab97dbaa4c2bbb1aa05a48aa613d015c662c4b4afea907d441739cd9f572e62`

Installed with `tools/deploy.sh install` only. Package state is r135 and all
three assets returned HTTP 200 with source/target MD5 matches. Before/after
target evidence: uptime 12089→12216 seconds; nfqws2 PIDs/starttimes stayed
2116/1363 and 17025/324438; uhttpd stayed PID 2588; NFQUEUE owners stayed
300→2116 and 15695→17025. `ubus status` remained schema 3, running, queue
nominal; `orchestra_auto_status` remained honest cooldown with no active run.

The implementation started from T4.2 commit `936184574d2dcd2b6203698f1700dd89e7ebbbf9`.
