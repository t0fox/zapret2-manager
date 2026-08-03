# Router Validation Report

## Tested revision

- Repository: `t0fox/zapret2-manager`
- Tested base revision: `0dda3dcfa70773c35ea4b44bece69ab54952f850`
- Validation branch: `codex/router-validation-luci-baseclass`
- Fixes in this branch are limited to the validation worktree; the original dirty worktree was not changed.

## Date and duration

- Date: 2026-08-03 (Europe/Moscow)
- Duration: multi-stage live-router session; wall-clock duration was not separately instrumented.
- Constraint: no reboot was performed after the user’s instruction; the final fix was installed over the running router.

## Router model and target

- Cudy WBR3000UAX v1, board `cudy,wbr3000uax-v1-ubootmod`
- MediaTek Filogic, `aarch64`, package architecture `aarch64_cortex-a53`
- LAN management address: `192.168.1.1`
- WAN address observed during validation: `10.12.147.75`

## OpenWrt version

- OpenWrt `25.12.5 r33051-f5dae5ece4`
- Linux `6.12.94`, `aarch64`

## Package manager

- APK packages were built with the repository’s manual build script and installed through signed APK feed packages.
- Install command used `apk add --force-reinstall --upgrade`; `--allow-untrusted` was not used.
- Final target package listing:

```text
luci-app-zapret2-manager-0.1.0-r137 aarch64_cortex-a53
tg-ws-proxy-rs-1.6.5-r2 aarch64_cortex-a53
zapret2-manager-0.1.0-r136 aarch64_cortex-a53
zapret2-manager-full-0.1.0-r136 aarch64_cortex-a53
```

## Installed package versions

All four expected packages are installed and enabled. The proxy status RPC reported the pinned `tg-ws-proxy-rs` provider running on `192.168.1.1:1443`; its secret permissions were `0600`.

## Backup and recovery path

- Required pre-test backup: `/tmp/z2m-pretest-backup.tar.gz`, 10,457 bytes.
- Host copy: `C:\Users\Kirill\AppData\Local\Temp\z2m-router-validation\z2m-pretest-backup.tar.gz`.
- Additional final backups were created at `/tmp/z2m-pretest-backup-finalfix.tar.gz` and `/tmp/z2m-pretest-backup-aclfix.tar.gz`.
- Pre/post configuration hashes were compared. Final `/etc/config/zapret2` SHA-256 was `52a507de793b33bd254c762867e7936aad5c6c740c62ebaa96dafd9cc38c640a`.
- A second SSH session was available for recovery. Physical/failsafe recovery was not independently exercised, so this report does not claim physical recovery coverage.

## Build results

Command:

```text
wsl.exe -d Ubuntu -- bash -lc "REPO=/mnt/g/z2m-validation-0dda3dc bash /mnt/g/z2m-validation-0dda3dc/tools/build-apk-manual.sh"
```

Final build output from the SDK package directory:

| Package | Size | SHA-256 |
|---|---:|---|
| `zapret2-manager-0.1.0-r136.apk` | 2,160,359 | `420be21eb01d12623e7195f6cc8092f85c8cf14854abbacb986cad8e4addea01` |
| `luci-app-zapret2-manager-0.1.0-r137.apk` | 77,588 | `aaa8672b4fb41c1327aea722947823f6cee1bc163a81c69f0f198fb153f7c4f9` |
| `zapret2-manager-full-0.1.0-r136.apk` | 412 | `566353699579eceb697286bbe2142cec2923fd6896dbf93b2df3f50b073c2284` |
| `tg-ws-proxy-rs-1.6.5-r2.apk` | 1,930,789 | `a781b063f4c34379968405999f860607898cf6f8dcf897e597891b6e590849c5` |

Host gate:

```text
GIT_DIR=/mnt/g/zapret2-manager/.git GIT_WORK_TREE=/mnt/g/z2m-validation-0dda3dc bash /mnt/g/z2m-validation-0dda3dc/tools/run-all-tests.sh
TOTAL node: pass=1026 fail=0 | shell: pass=10 fail=0 | ALL: pass=1036 fail=0
TOTAL one-line: 1036 green, 0 red
```

The linked-worktree environment variables are required for the StressOzz corpus tests; the original worktree remained untouched.

## Package contents

The built packages contain the manager backend, LuCI application, full meta-package, and pinned aarch64 Telegram proxy provider. The target loaded the installed backend through ubus, the CLI module through ucode, and all manager LuCI views through authenticated LuCI.

## Target syntax checks

- `ucode -c` over target `.uc` files: `21` passed, `25` failed because module-mode files use top-level `export` and cannot be checked as standalone scripts by this invocation. This is a checker limitation, not a claimed runtime pass.
- Actual module execution: `ucode /usr/libexec/zapret2-manager/orchestra-cli.uc capabilities` returned `ok:true` and matching pinned upstream version.
- Target shell gates: `10/10` passed on host; router lifecycle and ubus loading also passed.
- Verdict: **BLOCKED under the strict “every file with `ucode -c`” criterion**, while actual module-loader execution passed.

## RPC and ACL checks

- `ubus list zapret2-manager` exposed the expected manager RPC surface; unknown methods returned the normal “Method not found” error.
- `status` returned schema 3, `serviceState=running`, one verified nfqws2 process, seven profiles, rules present, and queue ownership verified.
- `orchestra_capabilities` returned `ok:true`, version match, live engine and Lua bundle evidence, and explicit unavailable reasons for unsupported upstream preload/event APIs.
- `dns_validate {}` and `proxy_config_validate {}` returned bounded missing-input errors rather than mutating state.
- ACL inspection showed `discord_profile_rollback` and `discord_profile_restore_previous` only in `write`, not in `read`. Host contract coverage includes this regression.

## LuCI checks

- Authenticated route: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager` returned HTTP 200.
- All eight views loaded: Overview, Strategy, Services, Lists, DNS, Telegram Proxy, Monitoring, and Maintenance.
- The original plain AMD exports caused target constructor errors; all manager support modules were converted to `baseclass.extend(...)`, and the target loader smoke test now instantiates them successfully.
- Final authenticated browser run showed no manager asset 404s, no external CDN dependency, and no runtime console errors in the final run. The browser history contains earlier expected 403 responses from the session that expired during reboot; those were followed by successful re-authentication.
- Local screenshots: `C:\Users\Kirill\AppData\Local\Temp\z2m-router-validation\luci-overview-final.png`, `luci-strategy-loaded.png`, `luci-services-loaded.png`, `luci-lists-loaded.png`, `luci-dns-loaded.png`, `luci-proxy-loaded.png`, `luci-monitor-loaded-final.png`, `luci-maintenance-loaded.png`, and `luci-aclfix-final.png`.

## Service lifecycle

- Before the final install, start, stop, restart, duplicate start, duplicate stop, and SSH continuity were exercised; all lifecycle return codes were zero and the services recovered to running.
- After the final install, `rpcd reload` and `/etc/init.d/zapret2-manager restart` completed successfully without reboot.
- Final status: `/etc/init.d/zapret2-manager status` = `running`; `/etc/init.d/zapret2 status` = `running`.
- Duplicate stop emits a harmless `ubus service delete ... Not found` warning while returning zero; this is recorded as a minor lifecycle polish item, not a service failure.

## Runtime process and nft evidence

- One manager-owned `/opt/zapret2/nfq2/nfqws2` process was live after the reboot and subsequent no-reboot reinstall, with queue `300`.
- `nft list table inet zapret2` showed the `inet zapret2` table, LAN/WAN sets, and TCP/UDP post-NAT queue rules targeting queue `300`.
- `status` reported `rulesPresent=true`, `queue.registered=true`, `ownerConflict=false`, and `appliedMatch=true`.
- The manager watchdog process `/usr/bin/ucode /usr/libexec/zapret2-manager/watchdog.uc` was live.

## Standard strategy apply

- Preflight reported scanner, ncat, curl, service catalog, and all three Discord targets ready.
- The fixed candidate runner accepted real catalog IDs. Run `or-6a70fb8d-1109` completed 20/21 attempts before the immutable 300-second deadline, with `infrastructureErrorCount=0`, but no trusted winner was confirmed; all observed attempts were timeouts while the production DPI path was active.
- `applyAllowed=false`; standard Apply was correctly not invoked without positive target evidence.
- Verdict: **BLOCKED**, not a false success.

## Flowseal preview and native dry-run

- `discord_profile_preview {}` returned `ok:true`, the pinned StressOzz source/commit, two native-adapted records, required Lua/blob files, native status `rc=0`, preserved sections, and the expected constraints.
- Full candidate options are intentionally omitted from this report.
- Verdict: **PASS** for bounded preview/native dry-run evidence.

## Flowseal real apply

- Flowseal apply used the exact preview change hash and the existing idempotency contract.
- The existing production writer applied the profile and returned native `rc=0`.
- Verification reported `processPresent`, `singleInstance`, `rulesPresent`, `queueRegistered`, and `ownerMatch` all true.
- The real external probes did not prove service availability: YouTube timed out and Discord had DNS failure. Therefore this is a successful writer/runtime verification, not a claim that Discord connectivity was restored.

## Rollback

- Positive rollback: after the Flowseal apply, the existing rollback path returned `ok:true`, `rc=0`, and restored the pre-apply UCI SHA `52a507de...` while manager and SSH stayed available.
- Reboot persistence check: `/tmp` last-good files were absent after reboot, as expected for a tmpfs snapshot.
- Defect found and fixed in this branch: both `discord_profile_rollback` and `discord_profile_restore_previous` previously returned false success when no snapshot existed. The fixed package was installed without reboot; both now return:

```json
{"ok":false,"action":"rollback","code":"ENOLASTGOOD","error":"no last-good snapshot"}
```

- The no-snapshot test left `/etc/config/zapret2` unchanged at SHA `52a507de...`; manager, zapret2, and watchdog remained running.

## Reboot persistence

- One planned reboot was performed before the user’s “без ребутов” instruction; no reboot was performed afterward.
- SSH returned within seconds, LuCI was re-authenticated, ubus was available, manager and zapret2 were running, and `/etc/config/zapret2` retained its expected hash.
- Runtime queue `300`, nft table, package installation, and watchdog were verified after reboot and again after the final no-reboot package install.
- The `/tmp` rollback journal/snapshot did not persist across reboot; the new explicit `ENOLASTGOOD` behavior covers this state.

## Watchdog and events

- Watchdog process was present after reboot and final reinstall.
- Manager status returned bounded event/job data and did not hang the LuCI initial load.
- No claim is made that upstream zapret-auto provides an event stream: the capability RPC correctly reported it unavailable for the pinned upstream.

## Jobs and health matrix

- Health-matrix crash recovery initially failed because `mark_running` stored the blockcheck fingerprint for a health runner. The branch now stores and checks the kind-specific `health-run.sh` fingerprint.
- Final target job `job-1785791057-42` completed with `status=succeeded`, `rc=0`, one service row, and no malformed rows.
- The matrix classified Discord as `dns`: local DNS failed, external DNS returned an address, and bounded TCP/TLS/HTTP probes returned curl `28`. The matrix is diagnostics per layer, not a service-availability verdict.
- Host regression coverage for the fingerprint fix passed.

## Lists security

- Normal `lists_check_domain` returned the expected bounded flags for `example.com`.
- Injection probe domain `example.com;touch /tmp/z2m-list-injection-marker` was returned as data; `marker_created=no`.
- Root cause was unquoted shell interpolation in `lists_check_domain_method`; the branch now applies shell escaping and includes a regression test.

## Config escaping

- `git diff --check` passed.
- Target shell gates passed `10/10`.
- The lists injection regression and candidate-ID path validation were both exercised in host tests; no user-controlled candidate path was accepted.

## DNS

- `service_dns_check` returned `ok:true`, active UCI section `cfg01411c`, the discovered effective dnsmasq config path, `uciMatches=true`, `legacyIncluded=false`, local query success, and `allMatch=true`.
- `service_dns_status` reported active native UCI dnsmasq routing and a running dnsmasq process. Its `runtimeForwardingVerified=false` field was preserved and is not promoted to a stronger success claim.
- DNS provider and preview RPCs returned bounded results without exposing secrets or taking an unintended write path.

## Failure injection

- Unknown RPC method: structured ubus method-not-found response.
- Missing RPC input: bounded validation error.
- Missing last-good snapshot: explicit `ENOLASTGOOD`, no config mutation, no restart.
- Lists shell-injection marker: not created.
- Standard strategy timeout: honest timed-out state with no winner and no Apply.

## Resource usage

- Overlay: 89.4 MiB total, 8.9 MiB used at validation.
- `/tmp`: 242.5 MiB total, approximately 46 MiB used at validation.
- RAM: 496,716 KiB total, approximately 305,948 KiB free at the captured check.
- Swap: none.
- No recursive broad cleanup or destructive reset was used.

## Connectivity matrix

| Path | Result | Evidence |
|---|---|---|
| SSH to router | PASS | Reconnected after reboot and remained available during final no-reboot install. |
| LuCI from management host | PASS | Authenticated HTTP 200 route; all eight views loaded. |
| Router local DNS/dnsmasq path | PASS | `service_dns_check`: local query and `allMatch=true`. |
| External DNS control probe | PARTIAL | Health matrix external DNS succeeded for Discord. |
| External TCP/TLS/HTTP control probes | FAIL/BLOCKED | Bounded curl probes returned `28`; Discord local DNS failed. |
| LAN client traffic | NOT RUN | No independent LAN client/browser was available for a separate client-side proof. |
| Standard strategy positive apply | BLOCKED | No trusted winner before immutable run deadline. |

## Discovered defects

All defects below were fixed in this validation branch and covered by host regression tests unless noted otherwise:

1. LuCI support modules exported plain objects; the target loader requires `baseclass.extend`. Fixed across the support modules and verified in the target-loaded UI.
2. Rollback/restore RPCs were readable under the shipped ACL. Moved them to write-only ACL and added contract coverage.
3. Real catalog candidate IDs such as `combo-recommended` were rejected by an overly restrictive runner check. Validation now rejects path-like IDs while accepting catalog IDs.
4. Health-matrix jobs used the wrong process fingerprint during crash recovery. The runner fingerprint is now kind-specific.
5. `lists_check_domain` allowed shell metacharacters to reach the command path. Shell escaping is now applied and the target marker probe passed.
6. Manual rollback restarted the service and returned success without a snapshot. It now returns explicit `ENOLASTGOOD` before any copy/restart.

## Fix commits and PRs

- Working branch: `codex/router-validation-luci-baseclass`.
- Fix commit: `a5495d4a01caa9c772d01698ae98c9da61a1643d` (`fix: validate router integration regressions`).
- Report-link commit: recorded after the fix commit; both commits are pushed to the branch.
- Pull request: [#17 — fix: close router validation integration regressions](https://github.com/t0fox/zapret2-manager/pull/17), open and not draft at report finalization.

## Remaining target-only limitations

- Strict standalone `ucode -c` gives `21/25` because it is not a module-loader check for exported modules; actual target module loading and ubus/CLI execution passed.
- Standard strategy Apply remains unexecuted because the target did not produce a trusted positive winner; this is the correct safety gate behavior.
- External service availability was not proven: DNS/TCP/TLS/HTTP evidence is mixed and bounded failures were observed.
- A separate LAN client test, physical recovery/failsafe test, and browser test from a second client were not available.

## Final verdict

**PARTIAL — the merged revision is installable and operational on the target after the branch fixes, with 1,036 green host checks and successful authenticated LuCI/RPC/runtime validation.**

The branch fixes the concrete integration, ACL, candidate-runner, job-recovery, shell-injection, and no-snapshot rollback defects found during live validation. It is not a full end-to-end PASS because strict standalone target syntax remains checker-blocked, standard strategy Apply has no trusted winner, and external connectivity was not established by the bounded control probes.
