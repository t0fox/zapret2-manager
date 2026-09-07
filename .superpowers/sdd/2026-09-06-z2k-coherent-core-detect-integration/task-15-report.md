# Task 15 report — artifact bookkeeping

## Final status

`DONE_WITH_CONCERNS`.

This report records captured evidence only. It does not add router, Discord,
deployment, or full-harness results. No PASS is claimed for any unverified
live gate.

## Source state

- Worktree: `G:\zapret2-manager\.worktrees\z2k-coherent-core-detect`
- Branch: `codex/z2k-coherent-core-detect`
- Current HEAD: `9eacd8b337452bd5897187ccbff52c184ddf0681`
- No merge or push.
- No router mutation or deployment.
- Task-owned artifacts: `acceptance.md`, `live-evidence.json`, and this report.

## Exact captured commands and results

Focused suite command:

`wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-release-identity.test.mjs tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-coherent-candidate.test.mjs tests/product/z2k-managed-strategy-source.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-autocircular-pool-identity.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-data-diagnostics.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/ui/z2k-coherent-ui.test.mjs'`

Result: `143 passed, 0 failed, 1 skipped, 0 TODO`. The skip was the safe WSL
dangling-symlink probe because its control directory was not writable.

Rollback/failure-injection command:

`wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-autocircular-pool-identity.test.mjs'`

Result: `32 passed, 0 failed, 0 skipped`. Captured assertions cover
pre-commit Detect SHA failure, post-materialization readiness failure,
compensation, crash windows, and exact LKG restoration across Registry,
runtime, source/catalog, strategy/config, Detect, and learned state.

Static/knowledge commands and results:

- `git diff --check` — exit 0.
- `git diff --find-renames --stat` — exit 0.
- `sh -n zapret2-manager/files/etc/init.d/zapret2-manager` — exit 0.
- Required `node --check` for `z2m-maintenance.js`, `z2m-assets.js`, and
  `z2m-scanner.js` — all exit 0.
- `node scripts/validate-knowledge.mjs` — exit 0, `Knowledge validation passed.`
- `node scripts/docs.mjs verify` — exit 0, Quartz SHA verified.

Full harness was previously run, not rerun for this bookkeeping turn:

`wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && scripts/test/native.sh'`

Captured result: exit 1/incomplete after native/package and product matrix
failures, including the WSL linked-worktree error
`fatal: not a git repository: /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect/G:/zapret2-manager/.git/worktrees/z2k-coherent-core-detect`.
Observed failure classes included package-helper, Avatar, Profiles, Scanner,
DNS, Resource Center, and Strategy Catalog suites. The run stopped after the
bounded no-progress interval; it is not treated as green.

## Router and Discord blockers

Captured read-only router baseline: `root@192.168.1.1` reachable; OpenWrt
25.12.5 revision `r33051-f5dae5ece4`, mediatek/filogic,
aarch64_cortex-a53, kernel 6.12.94, installed `zapret2-manager-full`, nfqws2
PID 6545, NFQUEUE 300 present, manager `running`, empty discovered-domains,
and 1464-byte autocircular state.

The safe builder attempts were captured as follows:

- `tools/build-apk-manual.sh` — exit 1, file not found.
- `scripts/release/build-apk.sh` — exit 1, WSL linked-worktree Git pointer
  unresolved.
- The same builder with explicit `GIT_DIR`/`GIT_WORK_TREE` — exit 1,
  `curl: (6) Could not resolve host: downloads.openwrt.org` after bounded
  retries.

No old APK was installed. The target lacks
`/usr/libexec/zapret2-manager/z2k-detect.uc` and its executable;
`ubus call zapret2-manager z2k_detect_status {}` returned `Method not found`
(rc 253). The legacy detector remains. Therefore p-over-r discovery, coherent
update, raw Detect JSON/RPC, autodiscovery/procd recovery, persistence,
Discord Voice, real autocircular rotation, and browser acceptance remain
`NOT_RUN`. The Discord-only required-user-input marker is not used because
package deployment is also blocked.

## Commit boundary

The separate Luna reviewer will perform code review after this commit. This
turn performs no review approval, merge, or push. The intended commit contains
only these three files with message:

`docs: record coherent Z2K acceptance evidence`
