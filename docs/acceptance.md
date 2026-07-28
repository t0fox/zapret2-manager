# Production acceptance — r-series (supervised session 2026-07-28)

All six phases executed on the live Cudy WBR3000UAX v1 (OpenWrt 25.12.5,
IPv4, NFQUEUE 300) against `zapret2-manager` r8→r19. Every mutating step went
through production backend methods only; every failure followed the
root-cause protocol (evidence → RED regression test → minimal fix → full
suite → rebuild → trusted reinstall → re-drill). No firewall stop/restart,
no nft flush, no broad apk upgrade, no automatic rollback timer.

## Phase 0 — baseline

- Local suite: 409 green, 0 red (backend/UI/strategy/shell dynamic totals).
- Git: HEAD == origin/main == 84b1e30, clean, LF enforced by .gitattributes.
- Router: OpenWrt 25.12.5, r8 both packages, pid 20639 (`nfqws2`) owning
  queue 300, nft table 102 lines, no jobs, no pending rollback, hashes
  recorded (`docs` baseline file preserved outside git).
- Package files byte-identical to the worktree.

## Phase 1 — APK trust chain: VERIFIED

- Signing key: SDK `private-key.pem` (EC); public key sha256
  `c885bf8fa1cb0f0e501bd405ab3af21614f108c8ab2dbb78814656ce34b82998`,
  installed as `/etc/apk/keys/z2m-build.pub` (root:root 0644, alongside
  `openwrt-25.12.pem`).
- `apk verify` on both r8 APKs on the router: **OK** without any bypass.
- `packages.adb` (signed index) accepted without `--allow-untrusted`.
- Targeted `--force-reinstall` executed **without** `--allow-untrusted`;
  only the two manager packages touched (no dependency changes); installed
  hashes match the worktree; config/dhcp/lists hashes unchanged.
- The temporary `--allow-untrusted` development bypass is RETIRED.

## Phase 2 — backup/restore drill (ourState): VERIFIED

- Synthetic draft `z2m-restore-drill` → backup (format 2, SHA-256 manifest
  `ab6b1d20…`) → marker modified → restore preview (integrity OK, allowlist
  valid, expected diff, `restorable: true`, **zero writes during preview**)
  → restore (pre-snapshot automatic) → marker reverted exactly →
  config/dhcp/lists hashes unchanged → cleanup complete (current-baseline
  delete correctly REFUSED).

## Phase 3 — strategy apply + rollback: VERIFIED (2 fixes)

- `profiles_import_applied` (3 profiles, preserve-identical), native
  dry-run `partial`/`cliSyntax: passed`, preview diff = 3 edge-whitespace
  bytes only (semantically no-op).
- Apply: all five runtime checks passed (process present, exactly one
  nfqws2, rules present, queue 300 registered, owner == daemon PID);
  connectivity survived throughout (independent ping monitor).
- Fix 1 (r9 defect): verify trusted a racing status-collector queue read —
  now the direct `/proc` parse is authoritative + 2s settle.
- Fix 2 (double-apply anomaly): an apply ran twice 21s apart from one
  operator call; run #2 overwrote the rollback baseline. Root cause not
  reproduced on demand (no duplicate signature, single CLI execution on
  re-test) — hardened with a 60s candidate-sha idempotency guard (proven:
  immediate re-apply is a no-op preserving the rollback baseline).
- Baseline bytes restored via production `backup_restore` (engineConfig
  scope) → config hash back to `833c73a5…` byte-for-byte; drafts cleaned.

## Phase 4 — DNS apply + rollback (z2m-smoke.test → 192.0.2.1): VERIFIED (4 fixes)

- `z2m-smoke.test` (TEST-NET-1 `192.0.2.1`) draft → validate → preview →
  apply → resolves via dnsmasq (`Address: 192.0.2.1`), external DNS intact.
- Rollback: NXDOMAIN restored, `/etc/config/dhcp` back to baseline
  (`c43757c2…`), overrides file removed, dnsmasq alive, no DNS outage.
- Fixes: (1) `uci commit dhcp` restarts dnsmasq — verify retries bounded
  (5×2s); (2) generated conf only regenerates on FULL restart — restart
  when registration changes; (3) ucode writefile is 0600 root-only — chmod
  0644 (dnsmasq unprivileged); (4) HUP does not clear resolver cache —
  restart on any override-set change; rollback removes overrides absent at
  snapshot time.
- Final state: unregistered, no overrides file, empty draft.

## Phase 5 — blockcheck quick end-to-end: VERIFIED (2 fixes + 1 feature)

- `job-1785222543-3` (quick + custom, rutracker.org): pending → running →
  **succeeded in 18s** (rc 0). 3 recommendations with verbatim strategies
  and provenance (`upstream blockcheck2.sh`). Explicit Save-to-Draft worked
  (then cleaned). No automatic apply anywhere (config hash unchanged).
- Fixes: timeout budgets empirically grounded (quick was still mid-set at
  304s — now quick 600 / domains 1200 / full 2400); runner removes an
  orphaned `blockcheck<pid>(/_test)` table when a kill lands before the
  scanner's unprepare (proven: 0 tables/0 processes after timeout kill).
- Feature: whitelisted `test: standard|custom` param (custom = bounded
  10-list.sh surface; standard completes but needs 15-20+ min with the
  engine running).
- Engine intact post-run: pid 3081 owned queue 300, zapret2 table intact,
  config/lists hashes unchanged.

## Phase 6 — reboot acceptance: VERIFIED — closes the autostart
## [VERIFY:ROUTER] item for good

- ONE reboot. Timings: **ping 23s, SSH 33s, ubus 33s, serviceState running
  33s**.
- New boot_id (`f9b33c31…` ≠ pre-reboot `1d2841e6…`), uptime confirms.
- Autostart proven by the real reboot: fresh nfqws2 pid 2115 owns queue
  300; watchdog daemon up (S99zapret2-manager); zapret2 up (S21zapret2);
  nft table 102 lines; all 10 read-only ubus methods `ok: true`; all 8 LuCI
  views present; trusted key intact; r19 both packages; config/dhcp/lists/
  state hashes byte-identical to pre-reboot; no stale jobs/rollback/drafts.
- 2.5 watchdog cycles observed (150s): stable pid, queueTotal 0, running —
  no flap, no duplicate process. The two boot-race events (process_gone/
  rules_gone at the first cycle before zapret2 finished init) are the
  designed F1 recovery and self-resolved.

## Trust state after acceptance

- Installed: `zapret2-manager-0.1.0-r19`, `luci-app-zapret2-manager-0.1.0-r19`
  (signed, trusted without `--allow-untrusted`).
- Known-good rollback set: `/tmp/z2mrepo-rollback` (r3) on the router.
- Automatic 90s rollback timer: still DISABLED (no timer drill yet — per
  the rules it is enabled only after a separate successful timer drill).
