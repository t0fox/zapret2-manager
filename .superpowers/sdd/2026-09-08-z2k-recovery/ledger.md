# SDD ledger — plan: docs/superpowers/plans/2026-09-08-z2k-recovery.md

| Task | State | Evidence |
| --- | --- | --- |
| 1 | WORKING | baseline.md and size-baseline.json captured; exact execution-SHA APK remains blocked because branch is not published and local build is prohibited |
| 2 | TODO | |
| 3 | TODO | |
| 4 | TODO | |
| 5 | TODO | |
| 6 | TODO | |
| 7 | TODO | |
| 8 | TODO | |
| 9 | TODO | |
| 10 | TODO | |
| 11 | TODO | |
| 12 | TODO | |
| 13 | TODO | |
| 14 | TODO | |
| 15 | TODO | |
| 16 | TODO | |
| 17 | TODO | |

## Pre-flight cross-task/interface scan

The approved spec is binding. The rows below record every plan-listed shared
file/interface and every task's internal consistency before Task 1.

### Shared files and interfaces

| Tasks | Shared file/interface | Finding / ruling |
| --- | --- | --- |
| 1 -> 15 | `size-baseline.json` | Task 1 owns immutable `before`; Task 15 owns measured `after` and must enforce `after.apkBytes <= before.apkBytes`. |
| 1 -> 17 | `ledger.md` | Task 1 initializes the plan ledger; Task 17 is the only later final-state writer. |
| 2 <-> 3 | rpcd `zapret2-manager.uc`, LuCI `z2m-api.js` | Discovery argument declarations and one-shot Detect declarations are disjoint; both must remain typed and must not introduce a generic API. |
| 2 -> 4 | `scanner-ui-rework.test.mjs` | Task 2 adds the discovery boundary; Task 4 replaces Scanner request state. Existing assertions must be updated toward product behavior, not preserve legacy selectors. |
| 2 -> 6 | discovery service test and discovery RPC interface | Task 2 establishes `dnsSource`; Task 6 consumes canonical status and proves runtime truth. |
| 2 -> 13 | `z2m-api.js` | Task 2 preserves positional discovery calls; Task 13 may add lifecycle polling calls without changing discovery signatures. |
| 3 -> 5 | `scanner-detect-api-boundary.test.mjs` | Task 3 owns exact five-method RPC boundary; Task 5 only renders/invokes those methods and must not add a generic `detect(operation,args)`. |
| 4 -> 5 | `z2m-scanner.js`, `scanner-command-forms.test.mjs` | Task 4 owns the descriptor map and exact fields; Task 5 consumes it for rendering/history. |
| 4 -> 6 | `z2m-scanner.js` | Task 6 adds only the compact discovery block and must not reintroduce shared protocol/mode/depth state. |
| 5 <-> 6 | `z2m-components.css` | Task 5 owns operation/result presentation; Task 6 owns discovery presentation. CSS removal must prove no remaining consumer. |
| 7 -> 8 | `z2k-core-single-surface.test.mjs` | Task 7 defines the canonical projection; Task 8 collapses normal-flow rendering to one card while retaining technical details. |
| 8 -> 13 | `z2m-maintenance.js`, `system-components-details-presentation.test.mjs` | Task 8 removes duplicate dashboard; Task 13 adds canonical lifecycle transitions inside the remaining surface. |
| 8 <-> 9 | `components-resources-corrective-pass.test.mjs` | Task 8 removes duplicate Components controls; Task 9 proves Resources ownership. Neither may create a second Z2K lifecycle. |
| 10 -> 11 | old-Scanner closure test and call-graph proof | Task 10 records `KEEP_SHARED`/`REMOVE_LEGACY`; Task 11 deletes only proven exclusive native Scanner authority. |
| 11 -> 14 | native removal and deployment closure | Task 14 updates current docs/manifest only after Task 11 proves the final production file ownership. |
| 12 -> 13 | lifecycle transaction/result interface | Task 12 exposes separate initiating failure and rollback evidence plus same-release repair; Task 13 renders terminal state from canonical re-read. |
| 12 -> 16 | transaction/receipt/Detect artifact suites | Task 16 reruns the lifecycle contract after all implementation changes; no later code change may invalidate its artifact. |
| 13 -> 17 | browser lifecycle interface | Task 13 defines canonical reload/revisit behavior; Task 17 proves it on the deployed build. |
| 14 -> 16 | documentation/projection gates | Task 14 establishes current normative docs; Task 16 runs repository knowledge/package gates against the final docs. |
| 15 -> 16 | size and artifact interface | Task 15 records final reduction measurements; Task 16 builds the exact candidate through CI and records artifact identity. |
| 16 -> 17 | `acceptance.md`, `live-evidence.json` | Task 16 binds evidence to exact candidate SHA/artifact; Task 17 deploys only that verified artifact and appends live proof. |
| 16 -> 17 | branch/CI contract | Task 16 may push only the dedicated execution branch for CI; Task 17 must not merge or delete branch/worktree and must stop for explicit user merge choice. |

### Per-task self-consistency

| Task | Result |
| --- | --- |
| 1 | AGREES: creates the ledger/baseline artifacts, captures drift/tests/sizes, and provides inputs to Task 15. |
| 2 | AGREES: RED registration test, exact rpcd fix, LuCI positional calls, then router/browser proof. |
| 3 | AGREES: exact-field RED/GREEN coverage matches the five method signatures and no generic API. |
| 4 | AGREES: descriptor-map RED tests match the specified command fields and state replacement. |
| 5 | AGREES: operation-specific rendering, typed history/results, then real browser proof. |
| 6 | AGREES: canonical discovery states, typed source, procd lifecycle, and browser proof are aligned. |
| 7 | AGREES: projection model separates product facts from technical evidence and defines all required states. |
| 8 | AGREES: one-card rendering and subordinate details consume Task 7's projection without dropping diagnostics. |
| 9 | AGREES: Resources ownership tests and browser proof keep Z2K managed and Avatar independent. |
| 10 | AGREES: call-graph proof precedes the closure test and deletion task. |
| 11 | AGREES: `detect.c` retains exactly five typed Detect operations while removing `scanner_probe` and exclusive legacy code. |
| 12 | AGREES: rollback evidence and same-release repair stay in the existing coordinator. |
| 13 | AGREES: transient operation state is non-authoritative and terminal/revisit paths re-read backend truth. |
| 14 | AGREES: current docs/projection are updated only after implementation ownership is settled and run required docs gates. |
| 15 | AGREES: deletion is caller-proven, affected suites rerun, and APK size is hard-bounded against Task 1. |
| 16 | AGREES: full harness, static gates, exact candidate artifact, and CI workflow precede acceptance. |
| 17 | AGREES: non-destructive live acceptance comes first; destructive clean-state proof may be `BLOCKED_USER`; final action is independent review, evidence commit, and stop before merge. |

## Rulings

- Ruling: Task 1 APK baseline will use an existing CI artifact for the exact baseline SHA, or a CI-generated artifact only; `scripts/release/build-apk.sh` will never run locally because the user requires CI-only APK builds — cost if wrong: the size gate remains WORKING until a matching CI artifact is available.
- Ruling: The existing clean `codex/z2k-recovery-v2` worktree at the exact approved docs HEAD is reused instead of creating a duplicate worktree — cost if wrong: work could target stale docs, mitigated by the verified ref/status above.

## Task 1 evidence update (2026-09-08)

- Execution `HEAD` is `4387345bc50d684214e8b5b97edc7c40acb7629f`; reviewed baseline and `origin/main` are `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`.
- Drift is limited to the approved plan/spec documents: `docs/superpowers/plans/2026-09-08-z2k-recovery.md` and `docs/superpowers/specs/2026-09-08-z2k-recovery-design.md`; no production-path drift is present.
- Canonical WSL focused baseline: 145 tests, 98 pass, 13 fail, 34 skipped. Host Windows baseline: 145 tests, 91 pass, 20 fail, 34 skipped; native compile cases failed because `/opt/ucode/bin/ucode` is unavailable on Windows.
- Read-only router probe succeeded: `ssh.exe -o BatchMode=yes -o ConnectTimeout=5 root@192.168.1.1 'ubus -S call zapret2-manager status_fast'`, response `ok=true`, service `running`, `nfqws2` PID 3812, NFQUEUE 300 registered.
- Existing CI APK evidence is exact for `9a4f0fee` only: `zapret2-manager-full-0.1.0-r156.apk`, 2,645,317 bytes, SHA-256 `5018e250f4fd1ddeec6e1ca5ad6a262d5d2ae2922e89fd3f869f51fcc81c3f69`; extracted helper 81,915 bytes, SHA-256 `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76`.
- Exact execution-SHA APK was not obtainable: `gh workflow run apk-build.yml --repo t0fox/zapret2-manager --ref codex/z2k-recovery-v2` returned HTTP 422 `No ref found for: codex/z2k-recovery-v2`; `scripts/release/build-apk.sh` was not run.
- Ruling: Browser/router requirements are hard gates, not implied by static tests; tasks changing user-visible surfaces remain WORKING until deployed evidence exists — cost if wrong: task completion is delayed, but false product acceptance is avoided.
- Ruling: A missing live Discord call is a user-only gate only after all unrelated acceptance work is complete; the no-call typed result must be proven first — cost if wrong: an environment gap could be mistaken for a user dependency.
- Ruling: No merge, branch deletion, or worktree deletion occurs in this execution; final output stops at explicit user merge choice as required by the approved plan — cost if wrong: the completed branch remains unlanded pending user approval.
