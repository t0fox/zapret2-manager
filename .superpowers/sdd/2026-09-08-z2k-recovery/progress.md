# SDD ledger — plan: docs/superpowers/plans/2026-09-08-z2k-recovery.md

This continuation resumes the recovered implementation at main HEAD 8ea89b0c.
Tasks 1-16 are treated as completed only where the repository recovery ledger,
reports, commits, and current evidence support their stated VERIFIED status.
Task 17 remains WORKING until the full canonical harness, live acceptance, and
independent whole-branch review are complete.

- Task 1: complete (existing recovery ledger and baseline evidence)
- Task 2: complete (existing implementation and router/browser evidence)
- Task 3: complete (existing exact Detect boundary evidence)
- Task 4: complete (existing Scanner descriptor evidence)
- Task 5: complete (existing browser and focused evidence)
- Task 6: complete (existing discovery lifecycle evidence)
- Task 7: complete (existing Components projection evidence)
- Task 8: complete (existing single-surface browser evidence)
- Task 9: complete (existing Resources ownership evidence)
- Task 10: complete (existing call-graph evidence)
- Task 11: complete (existing native closure and CI package evidence)
- Task 12: complete (existing rollback/repair evidence)
- Task 13: complete (existing lifecycle browser evidence)
- Task 14: complete (existing docs/projection evidence)
- Task 15: complete (existing size evidence)
- Task 16: complete (existing exact CI artifact evidence)
- Task 17: working (final acceptance and independent review incomplete)

## Final source-first/APK continuation (2026-09-09)

The final production candidate is `c6403068f9e59e1c75c631011c280ac08ede1dae`.
Its changed `apply.uc` was deployed and exercised on the router before CI: the
idempotent locked restore path returned `alreadyRestored`, the mismatched
restore returned `EROLLBACK` without changing config, and runtime stayed
healthy. CI then produced run `34341843538`, artifact digest
`aec88e01f21b610baa155f0ba962e191cb5e165bab0b01646220f26a3dad5999`, and APK
SHA-256 `2dc855df3ec9dac56a02154318f7e31ce611b079f15cf21a90c513299351a05c`.

The exact artifact was clean-installed after a hashed router backup. The old
package was removed and verified absent, installation succeeded, recovery was
`state: none`, and post-install status remained one healthy Avatar-backed
runtime with NFQUEUE 300 owner parity. Same-release `p-82.18` reinstall then
completed with `targetCanApply: true` and no blockers. WSL focused lifecycle
and async tests passed `53/53`; Detect passed `44/45` with one safe skip.
Scanner has `23/24` because of a pre-existing static path-regex false-positive
in the parent commit, not a c640 runtime failure. Task 17 remains working until
the independent final whole-branch review and the user-only live Discord call
condition are resolved or explicitly bounded by the objective.

Additional live checks recorded: p-82.17 downgrade apply failed before
mutation with typed `EUNAVAILABLE` on upstream fetch and cleanup succeeded;
the p-82.18 LKG/runtime was preserved. Discovery auto was killed and
successfully respawned by procd with four learned domains; dnsmasq-source
restart was externally unavailable and the final auto/running state was
restored. These do not close the required injected physical rollback or live
Discord Voice gates.

## Registry-bound fix and exact APK gate (2026-09-09)

Commit `84e6f791e428989d5c73c3302973f8c040efcad8` fixes the valid V3 registry
state rejection caused by the 1 MiB loader cap; the state reached 1,332,618
bytes with six full activation receipts. The new 4 MiB bound is covered by the
WSL/UCode receipt regression (`12/12` passed). Source-first deployment and
recovery were completed before CI; the fixed source hash on both sides is
`c10abf4728f286d88e939a1573d991af2ff403f7a44d4bf703ae61c51d917117`.

CI run `34354220544` produced the exact `r156` APK with SHA-256
`31d4610d47e6d60aca6ba603d62b47bc2cdf55eea5d88ccccdd849dc81d0ccc7` and
artifact digest
`sha256:5a87bd2d73bfc1fc782c1ada6bd317de88c4cf0fda189b9b79fcddffaa9b6f0c`.
The package was cleanly removed, absence verified, and reinstalled on the
router from that artifact. Post-install recovery was `state: none`, registry
loading succeeded at 1,332,616 bytes, runtime was `running` with NFQUEUE 300,
and `status-summary` was `p-82.18 / ready / verified / coherence aligned`.
The same-release prepare/reinstall had no blocking reasons and left no pending
journal. Fresh browser checks authenticated LuCI, Avatar selected/applied/
current on `#/strategies`, and typed scanner controls on `#/scanner`.

Task 17 remains working/not-ready because the objective still bounds the live
Discord Voice call and the independent whole-branch review as unresolved;
there was no merge or branch/worktree deletion.

## Runtime-contract symptom fix and exact CI APK (2026-09-09)

Commit `d4a233ff0b3f3a71838d18d1bb1bfdec4c2b7a89` fixes the source/UI contract
behind `Неизвестно — Сервис не подтвердил процесс`: the Components model now
retains canonical Detect evidence from the actual `resources_status` shape,
and the backend runtime summary includes `compatibilityIdentity`. The new
router-shaped regression passed `1/1`; focused UI passed `14/14`; runtime
summary passed with `0` failures; syntax and diff checks passed.

Source-first live evidence was healthy before APK installation. GitHub Actions
run `34368745542` then built the exact commit, producing a 2,630,232-byte APK
with SHA-256
`1c1c84e2517658affd7ce68469ca5d02f00674f0868f71557571fb989fd28e5b`.
The old package was removed and verified absent, the exact CI APK installed,
and post-install runtime remained healthy with Avatar `z2k_all_in_one`, one
`nfqws2`, and NFQUEUE 300 owner parity. Hard-reloaded browser evidence shows
`Работает`, Components `2 / 2`, Detect `Работает · arm64`, and Avatar
All-in-One selected/applied/current. Task 17 is still working/not-ready only
for the previously bounded physical injected rollback, live Discord Voice,
and independent final-review gates.
