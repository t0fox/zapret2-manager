# Task 5 report: stage one architecture-specific upstream Detect binary

Status: DONE_WITH_CONCERNS (focused Task 5 and update-transaction host gates passed; router/browser acceptance was not run).

## Scope and files

Changed only the Task 5 implementation/test files and this report:

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `tests/product/z2k-detect-artifact.test.mjs`
- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/task-5-report.md`

`resource-update-worker.uc` was inspected and remains an unmodified volatile coordinator; it does not fetch, stage, or write Registry assets.

## Implemented contract

- `z2k_detect_arch()` maps `aarch64→arm64`, `x86_64→amd64`, `mipsel→mipsle`, `mips→mips`, `riscv64→riscv64`; unsupported machines return `null`.
- `z2k_detect_candidate()` selects exactly `z2k-detect/builds/z2k-detect-linux-<mapped arch>` from the selected exact `sourceCommit` and selected manifest SHA-256, with stable target `/usr/libexec/zapret2-manager/z2k-detect`.
- `z2k_detect_stage()` fetches only that selected path, verifies exact bytes, marks the staged file executable, and performs a fixed internal executable preflight.
- Executable preflight accepts a valid executable's own nonzero usage result but rejects `ENOEXEC`/exec-format and permission failures. The seam accepts only the fixed path; no caller-provided argv is accepted.
- Resource Center prepare records the Detect candidate on the same Z2K target; apply stages and verifies it before the existing Registry transaction. No second Detect updater or old scanner fallback was added.

## TDD evidence

RED:

```text
node --test tests/product/z2k-detect-artifact.test.mjs
```

Exit `1`: the new architecture/candidate cases were skipped because Windows had no `UCODE_BIN`, and the production-owner assertion failed because `resource-update.uc` did not yet reference the Detect authority. This was the expected missing-implementation failure after the test syntax was corrected.

GREEN:

```text
wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs'
```

Exit `0`: `15` passed, `0` failed, `0` skipped, `0` todo (`6/6` Task 5 tests and `9/9` update-transaction tests).

Additional checks:

- `node --check tests/product/z2k-detect-artifact.test.mjs` — exit `0`.
- WSL ucode imports for `z2k-detect.uc` and `resource-update.uc` — both printed `ok` and exited `0`.
- Worker source parsed after its existing shebang was removed from the stdin validation stream; its import of `resource-update.uc` printed `ok` and exited `0`.
- `git diff --check` — exit `0`.

## Required gates and scope rulings

- Focused Task 5 gate: PASS.
- Required `z2k-update-transaction.test.mjs` gate: PASS.
- Syntax/ucode import checks: PASS, with the worker shebang handled as an executable-script boundary rather than an importable module header.
- Full repository harness: NOT RUN for this task. Existing SDD baseline records unrelated native/package/Avatar/Scanner/Quartz failures and WSL linked-worktree limitations; none were repaired or reclassified here.
- Knowledge/docs validators: run after this report append before commit; their result is recorded below.
- Router deployment, real Detect execution on OpenWrt, package E2E, browser acceptance, and visual approval: NOT RUN and not claimed.

## Commit

Planned commit message: `feat: stage upstream Z2K Detect with Core`

Implementation commit hash: `acb2259e26cd944097d8bd10b8864ac56b7fa7b7`.

The report is committed separately as a documentation-only follow-up so the implementation commit remains exact.
