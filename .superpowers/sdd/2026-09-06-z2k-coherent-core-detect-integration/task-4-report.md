# Task 4 report: Core-managed official Z2K strategies

Status: DONE_WITH_CONCERNS (focused host/native gates passed; no router or browser acceptance was run or claimed).

## Scope and files

Changed only the Task 4 implementation/test files, plus this report:

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- `tests/product/z2k-managed-strategy-source.test.mjs`
- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/task-4-report.md`

Z2K direct refresh and unbound source-snapshot installation now return
`EMANAGED` with owner `z2k-core`. The Core compiler plan is derived from the
selected exact `sourceCommit`; every compiler URL uses that commit and no
branch-HEAD metadata/content refresh remains in the independent strategy
source path. Avatar refresh remains independently refreshable.

## TDD evidence

RED command (native ucode in bounded WSL environment):

```text
wsl.exe -e sh -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/product/z2k-managed-strategy-source.test.mjs"
```

Outcome: exit 1, 0 passed, 2 failed. The direct refresh returned `ENETWORK`
instead of `EMANAGED`; the selected-commit compiler regression did not pass
against the pre-change path (`ECOMPILE`, because the old path was not the new
Core compiler-plan boundary).

GREEN command (bounded to 60 seconds):

```text
wsl.exe -e sh -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-managed-strategy-source.test.mjs tests/product/z2k-official-compiler*.test.mjs"
```

Outcome: exit 0, 10 passed, 0 failed, 0 skipped, 0 todo.

Additional focused evidence:

- Avatar independent refresh: `node --test --test-name-pattern='Avatar refresh validates accepted metadata' tests/product/strategy-source-refresh.test.mjs` under the same WSL ucode environment — 1 passed.
- `node --check tests/product/z2k-managed-strategy-source.test.mjs` — passed.
- Ucode imports for all three changed `.uc` modules — passed (`okokok`).
- `git diff --check` — passed.

## Required gates and boundaries

- Focused Task 4 and official compiler gates: PASS.
- Syntax/Ucode checks: PASS.
- Knowledge/docs validation: run after this report append before commit.
- Repository-wide/full harness: NOT RUN for this Task 4 closeout; prior SDD
  baseline records unrelated native/package/Avatar/Scanner/Quartz failures and
  WSL linked-worktree limitations. Those failures were not modified here.
- Router deployment, router runtime, browser acceptance, and visual approval:
  NOT RUN and not claimed.

## Scope rulings

No `resource-update.uc`, catalog reader, runtime updater, second catalog, or
second Z2K lifecycle authority was added or changed. Core continues to use the
exact selected commit through the existing compiler seam. `r-*`/`p-*` release
support remains owned by the existing `z2k-versions.uc` release authority.

## Commit

Commit message: `fix: bind Z2K strategies to Core release`

Commit hash: recorded after the final commit and clean-worktree verification.
