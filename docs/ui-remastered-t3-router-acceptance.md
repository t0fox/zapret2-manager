# T3.5 target-router acceptance — 2026-08-02

## Verdict

**FAIL — reboot smoke.** The signed r123 package installed and the pre-reboot
T1–T3 checks passed, including the repaired Runs empty-state contract. After
the one controlled reboot, the target's upstream `zapret2` boot path did not
retain `nfqws2`; therefore this is not a target acceptance pass and T4 must
not start.

## Scope and release

- Target: Cudy WBR3000UAX v1; OpenWrt 25.12.5; `aarch64_cortex-a53`.
- Starting source: `2f90f94ca5d296e1724f64ce597a7c133b8b3093` (clean).
- Accepted source candidate: `97a5aed99e007f916a93a0259a03174faaa111cd`
  on `fix/zero-red-r120`.
- Release decision: r120 was already a distinct published artifact; r121 and
  r122 were consumed by target fixes, so the final candidate is r123.
- APK: `/home/kirill/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64/bin/packages/aarch64_cortex-a53/zapret2-manager/zapret2-manager-0.1.0-r123.apk`
  (2,237,187 bytes, SHA-256
  `0a15e51d0c70ab2fdc05e6bb72698d14b98485e80a78005e6ca7c17015fb614e`).
- LuCI APK SHA-256: `fde02407ca8baa216b4ccc6d733166e42bf87a369749bd9d286d67f2d81e621f`.
- Canonical build: `wsl.exe -d Ubuntu -- bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh`.
  SDK signature verification passed for all r123 APKs; package content audit
  confirmed Orchestra, `z2m-ui.js`, `z2m-ui.css`, RPCD, menu and ACL files and
  found no fixtures, captures, keys, credentials or Git metadata.

## Source and target fixes

- Target r121 exposed an invalid LuCI shared-module constructor. r122 loaded
  `z2m-ui.js` through the LuCI baseclass contract; hard reload rendered the
  remastered Overview.
- Target r122 exposed `orchestra_run_history` as `parse failed` with empty
  output because this BusyBox image has no `timeout` applet. r123 removes that
  unavailable wrapper while retaining the bounded output pipe.
- Regression test was RED then GREEN; actual r123 RPC returns canonical
  `{ ok: true, schemaVersion: 1, runs: [] }` and Runs renders its empty state
  without `parse failed` or raw response.
- Full source gate after the fix: **1039 green, 0 red** (69 backend, 4 UI,
  8 strategy and 10 shell-gate files); no discovery reduction.

## Install, cache and browser evidence

- Target verified both r123 APK signatures and upgraded manager and LuCI from
  r122 to r123; exactly one `rpcd reload` was used.
- Hard reload at the r123 query URL rendered `.z2m-remastered`; Overview was
  the default route and the only visible primary navigation item was Overview.
- Legacy Orchestra hashes `orchestra-adaptive`, `orchestra-services` and
  `orchestra-results` retained the query parameter, produced no redirect loop
  and rendered the shell. Other read-only legacy page checks completed before
  the final package change, which was backend-only.
- No new post-r122 module-load, `Z2M.ui`, CSS-404 or UI exception was observed.
  The browser log retained an earlier r121 module error, so it is not counted
  as an r123 error. The target itself displays a standard no-password warning;
  it is unrelated to this package.
- Desktop visual inspection passed at the browser's available desktop viewport:
  header, one shell, one Refresh action and collapsed technical details.
  The available in-app browser has no viewport/zoom emulation API, so 1024px,
  narrow mode and 80% zoom remain **VERIFY**, not claimed as pass.

## Runtime, Runs and refresh

- Before reboot, `nfqws2` PID 19174 owned registered NFQUEUE 300; queue
  counters were present and the RPC runtime summary was `running` with
  `ownerMatches: true`. Overview used the safe “state not confirmed” wording
  for unavailable applied/runtime comparison rather than a false healthy claim.
- Runs RPC and UI passed with a canonical empty list. No scan or run was
  created.
- Clicking Overview Refresh did not change PID, queue ownership, run history,
  Auto Strategy revision or configuration; it remained a read-only action.

## Reboot smoke failure

- A single controlled reboot was issued only after the preceding checks.
- After reboot, LuCI, rpcd, uhttpd, r123 package metadata and the manager
  watchdog returned. `orchestra_run_history` remained canonical-empty.
- `nfqws2` was absent after repeated bounded observations; the runtime summary
  correctly reported `stopped` / `process-confirmed-absent` rather than a false
  running status. NFQUEUE 300 therefore was not registered by the daemon.
- Target logs show upstream `/etc/init.d/zapret2` beginning its configured boot
  path, including nft/ipset setup, but it did not retain the daemon. No manual
  start/restart was used to mask this result. This is a target runtime defect
  outside the r123 UI/RPC package change and blocks acceptance.

## Deliberately not run

- ACL/read-only: **VERIFY**; no safe pre-existing read-only account was supplied
  and none was created.
- Full Auto Strategy lifecycle: **NOT RUN**; no safe live fixture was present.
- Do not start T4 until the target's upstream reboot lifecycle is repaired and
  this acceptance is repeated, including the unavailable responsive modes.
