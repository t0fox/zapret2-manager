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
