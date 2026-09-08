# SDD ledger — plan: docs/superpowers/plans/2026-09-08-z2k-recovery.md

| Task | State | Evidence |
| --- | --- | --- |
| 1 | VERIFIED | baseline, focused results, sizes, and exact execution-SHA CI APK evidence recorded in run 34233470570 |
| 2 | VERIFIED | final source deploy, authenticated LuCI Network/UI enable+disable, focused checks, and independent follow-up review `review-task-2-fix4-followup.md` |
| 3 | VERIFIED | exact-field Detect RPC boundary, positional LuCI API, focused tests, and independent review `review-task-3.md` |
| 4 | VERIFIED | implementation `4aaa5ac3`, four-skill UI/design review PASS, explicit-operation browser forms and Task 5 cleanup/lifecycle evidence in `task-5-report.md` |
| 5 | VERIFIED | implementation `4433f03b`, runtime fixes through `53da4c05`; 41/41 focused tests, deployed real-browser probe/Voice plus P1 browser evidence, and scoped four-skill follow-up review `review-task-5-followup.md`; four non-blocking P2 findings carried forward |
| 6 | VERIFIED | implementation `f7ea2c46` + retry fix `e2357c93`; focused suites, scoped re-review, source deploy, browser payload/state, enable, validated dnsmasq restart with new PID, and final disabled/auto restore recorded in `task-6-report.md` |
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

- Captured baseline/execution SHA is `4387345bc50d684214e8b5b97edc7c40acb7629f`; reviewed baseline and `origin/main` are `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`. Current documentation HEAD at fix-round-2 start was `b002c26a70d828d42d120c1ee95b92d015f9b947`.
- Drift is limited to the approved plan/spec documents: `docs/superpowers/plans/2026-09-08-z2k-recovery.md` and `docs/superpowers/specs/2026-09-08-z2k-recovery-design.md`; no production-path drift is present.
- Canonical WSL focused baseline: 145 tests, 98 pass, 13 fail, 34 skipped. Host Windows baseline: 145 tests, 91 pass, 20 fail, 34 skipped; native compile cases failed because `/opt/ucode/bin/ucode` is unavailable on Windows.
- Read-only router probe succeeded: `ssh.exe -o BatchMode=yes -o ConnectTimeout=5 root@192.168.1.1 'ubus -S call zapret2-manager status_fast'`, response `ok=true`, service `running`, `nfqws2` PID 3812, NFQUEUE 300 registered.
- Exact execution-SHA APK evidence is available from CI run `34233470570` on `docs/z2k-recovery-design` at `4387345bc50d684214e8b5b97edc7c40acb7629f`; artifact `z2m-full-apk-4387345bc50d684214e8b5b97edc7c40acb7629f` was recorded by the run API, with manifest gitCommit equal to the execution SHA.
- CI artifact identity: `zapret2-manager-full-0.1.0-r156.apk`, 2,645,317 bytes, SHA-256 `5018e250f4fd1ddeec6e1ca5ad6a262d5d2ae2922e89fd3f869f51fcc81c3f69`; CI-extracted helper 81,915 bytes, SHA-256 `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76`. `scripts/release/build-apk.sh` was not run locally.
- Ruling: Browser/router requirements are hard gates, not implied by static tests; tasks changing user-visible surfaces remain WORKING until deployed evidence exists — cost if wrong: task completion is delayed, but false product acceptance is avoided.
- Ruling: A missing live Discord call is a user-only gate only after all unrelated acceptance work is complete; the no-call typed result must be proven first — cost if wrong: an environment gap could be mistaken for a user dependency.
- Ruling: No merge, branch deletion, or worktree deletion occurs in this execution; final output stops at explicit user merge choice as required by the approved plan — cost if wrong: the completed branch remains unlanded pending user approval.

## Task 1 fix round 2 (2026-09-08)

- Scoped re-review finding addressed: line 84 now calls `4387345bc50d684214e8b5b97edc7c40acb7629f` the captured baseline/execution SHA, while separately recording the current documentation HEAD at fix-round-2 start.
- Covering checks recorded in `task-1-report.md`: no `Execution HEAD` label remains for the captured SHA; current documentation HEAD was verified as `b002c26a70d828d42d120c1ee95b92d015f9b947`; validator and diff checks passed.
- Scope: docs-only; no product files, local APK build, push, merge, branch/worktree deletion, or router mutation.

## Task 2 final verification (2026-09-08)

- Final reviewed closure: `cddc63deb83935379cea989d701258f27f2c0cd7`; source-only deploy used `RELOAD_RPCD=1 RESTART_RPCD=1` and remote SHA-256 matched both manifest targets.
- Authenticated LuCI Network/UI acceptance passed after that deploy: `enable({dnsSource:'auto'})` returned `ok:true, enabled:true, running:true`; UI showed `Autodiscovery: включено и запущено`; `disable({dnsSource:'auto'})` returned `ok:true, enabled:false, running:false`; final UI showed `Autodiscovery: выключено · DNS: auto · доменов: 2`.
- Boundary suite: `3 passed, 0 failed`; broader focused suite: `15 passed, 0 failed, 7 skipped`; syntax, deploy-script, knowledge, and diff checks passed.
- Independent follow-up review `reviews/review-task-2-fix4-followup.md`: SPEC COMPLIANCE PASS, CODE QUALITY PASS, no P0-P3 findings.
- Task 2 is complete; no APK build, merge, push, or branch/worktree deletion was performed.

## Task 3 verification (2026-09-08)

- Commit `51273767` adds one exact-field normalizer for probe/classify/quic/voice/tcp16; valid requests forward to the matching typed operation and extra/missing fields return `EINPUT`.
- Focused Task 3 suite: `13 passed, 0 failed, 11 skipped`; `git diff --check` passed.
- Native helper was not changed; Windows lacks `pkg-config`/`cc`, and WSL retains one pre-existing classify-schema failure. APK remains CI-only.
- Independent review `reviews/review-task-3.md`: SPEC COMPLIANCE PASS, CODE QUALITY PASS, no P0-P3 findings.

## Task 4 review evidence (2026-09-08)

- Commit `4aaa5ac3` replaces generic Scanner request state with explicit descriptors and hostless Voice/TCP16 invocation; focused UI suite: `10 passed, 0 failed`.
- Independent UI/design review `reviews/review-task-4.md`: SPEC COMPLIANCE PASS, CODE QUALITY PASS, no P0/P1; three P2 follow-ups are explicitly assigned to Task 5 (obsolete segmented CSS, complete numeric bounds/feedback, and deeper per-operation invocation assertions).
- Task 4 remains WORKING until the Task 5 real-browser Scanner gate observes the current build; no final UI acceptance is claimed from static tests alone.

## Task 1 completion evidence (2026-09-08)

- All brief gates now have evidence: Git truth/drift, focused baseline counts, source/file-size baseline, read-only router probe, exact execution-SHA CI artifact, and final documentation checks.
- Task 1 is marked `VERIFIED`; this does not imply product/router/browser acceptance for later tasks.

## Task 1 fix round 1 (2026-09-08)

- Reviewer findings from `reviews/review-task-1.md` addressed in the report: `d6ceee5c...` is labelled the baseline-artifact commit and `7b2bed0d...` the report-finalization/evidence commit.
- All report references to `4387345bc50d684214e8b5b97edc7c40acb7629f` are labelled the captured baseline/execution SHA; no current-HEAD claim is made for that evidence snapshot.
- Covering checks: `node scripts/validate-knowledge.mjs` -> `Knowledge validation passed.`; `git diff --check` -> exit 0; product-file exclusion check -> no output.
- Scope: docs-only; no product files, local APK build, push, merge, branch/worktree deletion, or router mutation.

## Task 2 evidence and review (2026-09-08)

- Implementation range: `aba32959..73eaac20`; reviewed fix range `d161f8b2..73eaac20`.
- Task 2 focused checks: `14 passed, 0 failed, 7 skipped`; JavaScript syntax, knowledge validator, and `git diff --check` passed.
- The typed RPC boundary now has an executable handler seam test; discovery control registrations declare `dnsSource: string`; procd imports the Detect module and supervises one fixed `z2k-detect run` instance after coherent authority checks.
- Source-only router deployment used the reviewed manifest with local/remote SHA equality. `enable(auto)` proved named `z2k-detect`, PID/executable identity, and exact argv; `restart(dnsmasq)` exited 1 because `/var/log/dnsmasq.log` is absent and remains unverified; final router state restored to `disabled/auto`.
- Independent reviews: `reviews/review-task-2.md` found P1 false-positive RPC test/procd evidence gaps; `reviews/review-task-2-fix1.md` confirms those fixes and reports no remaining code P1, but keeps Task 2 unverified because the mandatory credentialed LuCI/Network transition is not observed.
- Browser evidence: the available session can load the UI after `root` with an empty password, but privileged LuCI RPC calls return `-32002 Access denied`; components remain at `Загрузка: Компоненты`. No root password was created or changed. Task 2 stays `WORKING` pending an authenticated LuCI session supplied or enabled by the user.

## Task 4 implementation (2026-09-08)

- Commit `4aaa5ac3` replaces shared Scanner request state with the single `DETECT_FORMS` descriptor map and exposes `detectFields`, `detectDefaults`, and descriptor-driven `detectArguments`.
- TDD RED was observed: the new form-model suite plus `scanner-ui-rework.test.mjs` reported 6 passed and 4 failed on the pre-refactor source for the expected missing descriptor API/legacy assertion.
- GREEN closure: `node --test tests/ui/scanner-command-forms.test.mjs tests/ui/scanner-ui-rework.test.mjs` -> `10 passed, 0 failed`; `node --check` -> passed; commit diff check -> passed; Scanner size `32525` bytes.
- Voice emits only `repeats, timeoutMs`; TCP16 emits only `timeoutMs`; classify/QUIC retain explicit endpoint, port, hello/repeats, and timeout fields. Whole-source forbidden shared semantics check found no `protocol`, `mode`, `quick`, `standard`, or `full` tokens.
- Design review found no new scoped issues. Existing wrapped-label, inline-alert, focus-visible, and reduced-motion contracts remain; no browser/deploy/router/APK work was run by this task.

## Task 5 implementation and browser verification (2026-09-08)

- Commit `4433f03b` renders five explicit Detect operations; runtime regressions found by the real browser were fixed in `19fd2791` (flatten field nodes), `54d013d0` (preserve Detect generation across initial repaint), and `785fbbf0` (preserve the Scanner child across same-tab product rerender).
- Task 5 focused suite including accessibility, generation, product lifecycle, forms, history, API boundary, and UI rework: `36 passed, 0 failed`; both production files pass `node --check`; `git diff --check` passes.
- Source-only deployment of `785fbbf07d7d158ee6a83d093a62dc55c7dbb0d9` matched all three remote UI SHA-256 values recorded in `task-5-report.md`.
- Real CUA/Network gate passed: all five operation-specific forms were observed; `z2k_detect_probe({domain:'youtube.com',timeoutMs:6000})` returned `ok:true` and a typed `sni` result; `z2k_detect_voice({repeats:2,timeoutMs:6000})` returned `ok:true` with canonical `verdict:'no_call'` and actionable UI reason. APK was not built; CI-only APK rule remains intact.
- Independent four-skill UI/design review `reviews/review-task-5.md` and scoped follow-up `reviews/review-task-5-followup.md` are complete. The follow-up verdict is SPEC COMPLIANCE PASS / CODE QUALITY PASS WITH CONCERNS, with no P0/P1 findings; four P2 findings are carried forward to later Scanner cleanup where they overlap the plan.

## Task 5 P1 follow-up (2026-09-08)

- Current deployed source is `53da4c059ab5686a9f1fd8f0b4cdc089bebc157d`; remote SHA-256 matches are recorded in `task-5-report.md` for `z2m-scanner.js`, `z2m-scanner-product.js`, and `z2m-components.css`.
- Focused regression suite is `41 passed, 0 failed`; `node --check` for both Scanner production files and `git diff --check` pass.
- Real browser re-check proves `Discord Voice` no-call renders `is-warning` with `ЗВОНОК НЕ ОБНАРУЖЕН` and actionable retry guidance; invalid probe input focuses the replacement domain control after rerender and sets `aria-invalid=true`.
- P1 fixes are in `eb2ca695` and `53da4c05`; scoped four-skill re-review is `reviews/review-task-5-followup.md`, with P1-01 and P1-02 closed. Four non-blocking P2 findings (tab semantics, concise TCP16 primary reason, timer cleanup, duplicate CSS) remain tracked; Task 5 is now VERIFIED.

## Avatar Strategy Apply regression (2026-09-08)

- Browser reproduction before the fix: LuCI Avatar card `z2k всё-в-одном (TLS/HTTP + QUIC + Discord)` reached the confirmation dialog, then returned `Strategy Apply identity commit failed after exact rollback`; direct `strategies_apply` reproduced `identity.error.code=EINPUT` with `Strategy Apply selection identity is invalid.`
- Root cause: `strategy_apply_projection()` emitted `z2kCompatibilityIdentity` and `compatibilityIdentity` as null for every source, while strict selection provenance rejects those Z2K-only fields for Avatar/User identities.
- TDD implementation commit `770deedea11c7cd7338714b06380b57c61a3620f` scopes those fields to `sourceId == 'z2k'` and adds Avatar/Z2K regression coverage. Independent review `reviews/review-avatar-apply-fix.md` is PASS with no source-level findings; local UCode execution is unavailable because `/opt/ucode/bin/ucode` is absent on Windows.
- Source-only deploy verified remote `strategy-cli.uc` hash `1ea6089821e23915cb574750403723c379e87199ed1b07d4cd55474d4e11f72f`. Real browser apply now succeeds: active card is Avatar `z2k всё-в-одном (TLS/HTTP + QUIC + Discord)`, status says `Выбрана Применена Используется сейчас`, and source is `Avatar`. Router state revision is 11, `strategyStatus.id=avatar:z2k_all_in_one`, service is running, and `/tmp/zapret2-manager/applied.sha256` matches `/opt/zapret2/config`.
- APK was not built; CI-only APK rule remains intact. No merge, push, branch deletion, or worktree deletion was performed.
