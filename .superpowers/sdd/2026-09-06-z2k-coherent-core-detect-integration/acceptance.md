# Task 15 acceptance — coherent Z2K Core and Detect

## Final status

**DONE_WITH_CONCERNS**

Focused WSL gates and failure-injection proof are green. The full repository
harness is not green and did not complete before the bounded no-progress
boundary. Router deployment was not performed: the pinned SDK build could not
resolve `downloads.openwrt.org`, and the only local APK is an older CI
artifact. Router Detect, coherent update, autodiscovery/procd, Discord Voice,
autocircular rotation, persistence-after-restart, and browser acceptance are
therefore not proven for this HEAD.

## Exact state

- Worktree: `G:\zapret2-manager\.worktrees\z2k-coherent-core-detect`
- Branch: `codex/z2k-coherent-core-detect`
- evidenceBaseHead: `30f3c4e3d6c831966e68fec7856b22a7f3be79a7`.
- finalHead: `b02bcd3833a637caa7ab1d1f1ed2891816f2a746` (exact current HEAD before this metadata commit; the artifact commit SHA is reported separately because Git commits cannot self-reference their own SHA).
- metadataCommit: `fa3fa0fab22f91146013978595497681e5ce9eb4` (contains the metadata artifacts).
- Prior implementation HEAD: `9eacd8b337452bd5897187ccbff52c184ddf0681`.
- The final bookkeeping commit is reported separately because an artifact cannot contain its own commit SHA before that commit exists.
- No merge or push was performed.
- No router mutation was performed; router state was inspected read-only.
- Task-owned files are this file, `live-evidence.json`, and `task-15-report.md`.

## Focused and rollback evidence

The prescribed focused suite was run in WSL with `UCODE_BIN=/opt/ucode/bin/ucode`
and `LD_LIBRARY_PATH=/opt/ucode/lib`. Result: **143 passed, 0 failed, 1
skipped, 0 TODO**. The skip was the safe WSL dangling-symlink probe because
its control directory was not writable.

The separate transaction/autocircular run produced **32 passed, 0 failed**,
including pre-commit Detect SHA failure, post-materialization readiness
failure, compensation, crash-window, and captured-owner restoration
assertions. It does not prove receipt/runtimeBundleDigest equality.

### Exact LKG rollback evidence

The deterministic rollback fixture is
`tests/product/z2k-autocircular-pool-identity.test.mjs:165-192`, test
`failure after sidecar/state write restores every prior LKG owner including
Detect and learned state`. Its exact before-fixture values are:

- receipt identity: `priorReceipt: null`; no receipt identity is emitted by
  this rollback fixture, so receipt equality is **NOT_PROVEN**;
- runtime bundle digest: not present in the rollback fixture or its seam
  output, so runtime-bundle equality is **NOT_PROVEN**;
- Detect source identity: before `old-detect` and after restoration
  `old-detect`; equality **PROVEN** by the `detectRestore` seam at line 186 and
  the test assertion at line 192;
- catalog: before `{generationId:'old-catalog',indexDigest:'a' repeated 64
  times,sourceInputs:{}}`; after `{ok:true,generationId:'old-catalog',indexDigest:'a'
  repeated 64 times}` from line 184; equality **PROVEN**;
- active strategy: before `{id:'avatar:stable',sourceId:'avatar'}` and the
  same `priorActiveStrategy` captured at line 172; the strategy restore seam
  returns `restored:true` at line 185. Restoration is **PROVEN at the
  authority/restore-result level**, but no post-restore strategy object is
  emitted for byte-for-byte comparison.

The independent receipt fixture
`tests/product/z2k-receipt-v3.test.mjs:41-63` contains exact canonical
values, but is not rollback output: `receiptId:'receipt-v3'`,
`runtimeBundleDigest:'a' repeated 64 times`, `catalogDigest:'f' repeated 64
times`, Detect digest `'d' repeated 64 times`, and Detect source commit `'a'
repeated 40 times` (the fixture's `commit` is defined at line 20). These
values must not be treated as before/after rollback equality. The captured
rollback run did not print additional receipt or runtime-bundle values.

## Static and full harness evidence

These exited 0: `git diff --check`, `git diff --find-renames --stat`, init
script `sh -n`, all three required LuCI `node --check` commands,
`node scripts/validate-knowledge.mjs`, and `node scripts/docs.mjs verify`.

The documented full harness was run with `wsl.exe -d Ubuntu -- bash -lc
"cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect &&
scripts/test/native.sh"`. It exited 1 after native/package and product matrix
failures, including the WSL linked-worktree error:
`fatal: not a git repository: /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect/G:/zapret2-manager/.git/worktrees/z2k-coherent-core-detect`.
Observed failures included package-helper, Avatar, Profiles, Scanner, DNS,
Resource Center, and Strategy Catalog suites. After further catalog failures
there was no output during the bounded no-progress interval; the process was
interrupted. The exact pre-existing ledger baseline is
`.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/progress.md`
under `## Baseline`; it contains the same failure family, but this fresh run
is recorded as failed/incomplete, not green.

## Router baseline and deployment boundary

Read-only SSH to `root@192.168.1.1` succeeded. Baseline: OpenWrt 25.12.5,
revision `r33051-f5dae5ece4`, target `mediatek/filogic`, arch
aarch64_cortex-a53, kernel 6.12.94, installed `zapret2-manager-full`, nfqws2
PID 6545, NFQUEUE 300 rules present, manager init `running`, empty
`discovered-domains.txt`, and 1464-byte autocircular `state.tsv`.

Deployment attempts:

1. `wsl.exe ... tools/build-apk-manual.sh` — exit 1, file not found.
2. `wsl.exe ... scripts/release/build-apk.sh` — exit 1, WSL could not resolve
   the Windows linked-worktree Git pointer.
3. The same current builder with explicit `GIT_DIR` and `GIT_WORK_TREE` — exit
   1, `curl: (6) Could not resolve host: downloads.openwrt.org` after bounded
   retries.

No old APK was installed. The target lacks
`/usr/libexec/zapret2-manager/z2k-detect.uc` and its executable;
`ubus call zapret2-manager z2k_detect_status {}` returned `Method not found`
(rc 253), while the legacy `/opt/zapret2/lua/z2k-detectors.lua` remains.

## Unverified live gates

- `p-*` discovery over newer `r-*`, coherent update, synchronized Components,
  and no independent Resources updater: **NOT_RUN**.
- Raw JSON and normalized RPC for clear, blocked/suspected, classify, QUIC,
  and TCP16: **NOT_RUN**; no raw result is invented.
- Autodiscovery DNS source, list append/observation, Detect kill/respawn, and
  restart persistence: **NOT_RUN**.
- Discord Voice `voice --json` and real autocircular rotation:
  **NOT_RUN**. No active call was available, but package deployment is also a
  blocker, so the Discord-only required-user-input marker is not applicable.
- Detect size/RSS/CPU, reboot persistence, and browser acceptance: **NOT_RUN**.

## Review boundary

Code-review evidence: final artifact review is required before merge; no merge
approval is claimed.
