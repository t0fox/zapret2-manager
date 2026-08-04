# Task 6 Report

Date: 2026-08-04
Branch: `feat/holyversion-reference-parity`

## Scope

- Added packaging assertions in `tests/packaging.test.mjs` for both shipped pure model modules, LuCI r143, backend/meta r137, CSS locality, obsolete runtime files, countdown markers, demo catalogue values, and literal secret assignments.
- Changed only `luci-app-zapret2-manager/Makefile` release `142` to `143`.
- Removed the three obsolete standalone LuCI runtimes exposed by the packaging gate: `overview.js`, `catalog.js`, and `blockcheck.js`.
- Did not change backend/meta Makefiles, ACL JSON, menu JSON, workflows, or backend source.

## Strict RED/GREEN

The packaging assertions were added first. Before release/source changes:

```text
node --test tests/packaging.test.mjs
tests 9
pass 7
fail 2
```

The two RED failures were the expected `PKG_RELEASE:=143` mismatch and the expected countdown/obsolete-runtime match.

After the LuCI release bump and obsolete-runtime removal:

```text
node --test tests/packaging.test.mjs
tests 9
pass 9
fail 0
```

## Required Checks

Focused UI command:

```text
node --test tests/ui/draft-model.test.mjs tests/ui/services-model.test.mjs tests/ui/global-draft-apply.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-manager.test.mjs tests/ui/single-view-services-lists-dns.test.mjs tests/ui/video-drafts-service-dns-regressions.test.mjs tests/ui/render-harness.test.mjs
tests 88
pass 88
fail 0
```

LuCI syntax check:

```text
node --check: 29 shipped LuCI JS files passed
```

Packaging integrity checks:

```text
CSS brace balance: 2 files passed
JSON validity: menu and ACL passed
Local CSS assets: 2 authoritative stylesheets passed
```

The packaging test also passed checks for no legacy standalone runtime, no `rollback_ttl`, no `z2m-countdown`, no automatic-rollback marker, no `Flowseal ALT11` or demo record, and no literal API key/access token/password assignment.

Diff whitespace check:

```text
(no output)
```

Protected paths:

```text
Protected-path diff: none
Workflow diff: none
```

The temporary-file scan for `*.tmp`, `*.temp`, `*.bak`, and `*.orig` found no files.

## Full Repository Gate

`sh tools/run-all-tests.sh` could not start in PowerShell because `sh` is not installed there. The WSL-style `bash` invocation also could not see Windows Node and reported `node: command not found`. The equivalent Git Bash invocation completed:

```text
"C:\Program Files\Git\bin\bash.exe" tools/run-all-tests.sh
SUBTOTAL backend(root): pass=831 fail=9 (files=86)
SUBTOTAL ui:            pass=164 fail=2 (files=19)
SUBTOTAL strategy:      pass=117 fail=0 (files=8)
SUBTOTAL shell gates:   pass=10 fail=0 (files=10)
TOTAL node: pass=1112 fail=11 | shell: pass=10 fail=0 | ALL: pass=1122 fail=11
TOTAL one-line: 1122 green, 11 red
rc=1
```

The 11 failures are in nine existing test files outside the Task 6 diff:

- `auto-strategy-package.test.mjs`: 1 failure
- `orchestra-strategy-ui.test.mjs`: 2 failures
- `remastered-overview.test.mjs`: 1 failure
- `remastered-ui-foundation.test.mjs`: 2 failures
- `service-dns-contract.test.mjs`: 1 failure
- `t3-6-proxy-runtime.test.mjs`: 1 failure
- `t4-auto-strategy-ui.test.mjs`: 1 failure
- `tests/ui/rpc-semantics.test.mjs`: 1 failure
- `tests/ui/video-navigation-regressions.test.mjs`: 1 failure

All 10 shell gates passed. None of the failing test/source files is changed by this task; the focused Task 6 UI suite and packaging suite are green.

## Worktree and Branch Review

Before adding this report, the intended changes were:

```text
M  luci-app-zapret2-manager/Makefile
D  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/blockcheck.js
D  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/catalog.js
D  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/overview.js
M  tests/packaging.test.mjs
```

The pre-existing untracked plan file `docs/superpowers/plans/2026-08-04-holyversion-draft-services-parity.md` was not staged. No branch was created. The repository already contains other local branches; they were not modified or removed.

Commit requested by the brief: `build: release LuCI r143 for draft services parity`.
