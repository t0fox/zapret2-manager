# Task 17 implementation report

Date: 2026-09-09

## RED

Command:

```text
node --test tests/product/z2k-detect-rpc-boundary.test.mjs
```

Expected failure observed before the production change: **4 tests, 3 pass,
1 fail**. The new `Detect RPC strips rpcd transport session metadata before
forwarding` test returned the existing `EINPUT` / `Detect request fields are
invalid.` result for a real `req.args` containing the exact operation fields
plus `ubus_rpc_session`.

## Implementation

- Commit: `cd970b40` (`fix(rpcd): ignore transport session in Detect input`)
- Added the focused regression for all five typed Detect operations.
- `z2k_detect_rpc_input()` now copies `req.args` while removing only the
  rpcd transport-only `ubus_rpc_session` key, then applies the existing exact
  field-count and field-name boundary. All other unknown, unsafe, missing, and
  wrongly typed input remains subject to the existing downstream validation.

## GREEN and verification

- `node --test tests/product/z2k-detect-rpc-boundary.test.mjs` — **4 pass, 0
  fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-detect-rpc.test.mjs"` — **15 pass, 0 fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/native/z2k-detect-helper.test.mjs"` — **8 pass, 0 fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs"` — **62 total, 61 pass, 1 fail, 0 skipped**. The one failure is the pre-existing
  `native-helper.test.mjs` TCP16 malformed-output assertion (`not-json`,
  `true !== false`), outside the Task 17 files and unchanged by this fix.
- `node --check tests/product/z2k-detect-rpc-boundary.test.mjs` — pass.
- `LD_LIBRARY_PATH=/opt/ucode/lib /opt/ucode/bin/ucode -c -s -o /tmp/task17-zapret2-manager.uc zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` — blocked by the source checkout's uninstalled absolute `/usr/libexec` imports/exports; no package/router staging was performed.
- `node scripts/validate-knowledge.mjs` — `Knowledge validation passed.`
- `git diff --check` — pass.

## Concerns

No router/live evidence was collected, per task scope; controller-owned live
proof is still needed. The existing native TCP16 baseline failure and the
uninstalled UCode module import boundary remain separate concerns.

## Follow-up: UCode array iteration root cause

The first fix removed rpcd session metadata but left a UCode semantic bug in
the exact-field loop. Direct UCode evidence:

```text
wsl.exe -d Ubuntu -- env LD_LIBRARY_PATH=/opt/ucode/lib /opt/ucode/bin/ucode -e 'let names=["domain","timeoutMs"]; for (let i in names) print("i=", i, " names[i]=", names[i], " type=", type(i), "\\n");'

i=domain names[i]= type=string
i=timeoutMs names[i]= type=string
```

Thus the old `for (let i in names) { let name = names[i]; ... }` passed empty
lookup names to `exists()` and returned `EINPUT` for every direct Detect call;
the JS VM harness had incorrectly hidden this by iterating array indices.

RED with the real UCode runtime, before the follow-up production change:

```text
wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/z2k-detect-rpc-boundary.test.mjs"

5 tests, 4 pass, 1 fail: Detect RPC validates allowed fields with UCode array
value iteration -> actual { ok:false, error:{ code:'EINPUT', ... } }.
```

Follow-up commit: `3b29a1d3` (`fix(rpcd): honor ucode array iteration in Detect boundary`).
The minimal fix iterates `for (let name in names)` and preserves the existing
exact field count, unknown-field rejection, type validation, and session-key
stripping.

GREEN:

```text
node --test tests/product/z2k-detect-rpc-boundary.test.mjs
5 pass, 0 fail, 0 skipped (WSL/UCode runtime)

node --test --test-concurrency=1 tests/product/z2k-detect-rpc-boundary.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-discovery-rpc-boundary.test.mjs tests/product/z2k-detect-discovery-service.test.mjs
37 total, 36 pass, 0 fail, 1 skipped

node --check tests/product/z2k-detect-rpc-boundary.test.mjs
git diff --check
node scripts/validate-knowledge.mjs
```

Live router redeploy/restart and direct ubus retest remain intentionally
NOT_RUN in this follow-up; no deploy, push, or merge was performed.

---

# Task 17 final-review UI fix update

Branch/worktree: `codex/z2k-recovery-v3` / `G:\zapret2-manager\\.worktrees\\z2k-recovery-v3`

## Scope

Implemented the smallest UI-only fix in `z2m-scanner.js`:

- classify hello options now render the typed native values `modern`, `legacy`,
  and `both`, while preserving the existing `both` default and Russian labels;
- classify host validation now accepts valid IPv4, IPv6, and single-label DNS
  hosts while retaining bounded DNS-label and whitespace validation.

Added focused behavioral coverage in
`tests/ui/scanner-final-review.test.mjs` for rendered hello values, valid host
submit behavior, and invalid host rejection.

## TDD evidence

RED was run before the production change:

```text
node --test tests/ui/scanner-final-review.test.mjs
```

After the harness-only context fix, the current Scanner implementation failed
all 3 focused assertions: rendered values were `both/client/server` instead of
`modern/legacy/both`; IPv6 was marked `aria-invalid=true`; and the initial
numeric-invalid fixture was accepted as a DNS-shaped hostname. The fixture was
then tightened to the existing invalid-input case `not a host`; the unchanged
production code still failed the hello enum assertion while the host cases
passed, proving the remaining production defect.

GREEN:

```text
node --test tests/ui/scanner-final-review.test.mjs
3 tests, 3 pass, 0 fail
```

## Verification

```text
node --test tests/ui/scanner-final-review.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/ui/scanner-p1-regressions.test.mjs tests/ui/scanner-product-lifecycle.test.mjs
21 tests, 21 pass, 0 fail

node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
exit 0

node --check tests/ui/scanner-final-review.test.mjs
exit 0

git diff --check
exit 0

node scripts/validate-knowledge.mjs
Knowledge validation passed.
```

Implementation commit: `8738b645`
(`fix(scanner): align classify UI with typed host contract`).

Committed files:

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `tests/ui/scanner-final-review.test.mjs`

No router deploy, APK build, push, merge, or worktree deletion was performed.

## UI-fix concerns / boundaries

This is host-side focused verification only. Router deployment, live LuCI
browser acceptance, APK packaging, and visual final approval were not run by
request.
