# Task 17 fix brief — rpcd transport session field at typed Detect boundary

Read this brief first. It is the complete requirement for this fix.

## Context

The exact candidate is already installed on router `192.168.1.1`. A real
`ubus -S call zapret2-manager z2k_detect_probe '{"domain":"example.com","timeoutMs":6000}'`
returns `{ok:false,error:{code:"EINPUT"...}}`, while the rpcd method is
registered with the correct typed fields. The existing discovery input
normalizer explicitly strips rpcd's transport-only `ubus_rpc_session` field.
The one-shot Detect normalizer does not, so the live rpcd request is rejected
before `z2k_detect_probe()` runs.

## Required behavior

1. Add a focused regression test that constructs the real rpcd-shaped request
   with the exact Detect fields plus `ubus_rpc_session`, and proves it is
   accepted and forwarded with only the operation fields.
2. Prove the new test RED before changing production code. The RED must be the
   current `EINPUT`/field-count behavior, not a syntax or fixture error.
3. Make the smallest production fix in the existing exact-field boundary:
   strip only the known transport-only `ubus_rpc_session` attribute before
   exact field-count/name validation. Continue rejecting every other unknown
   field, unsafe execution field, missing field, and wrong type through the
   existing downstream validation.
4. Run the focused Detect RPC boundary suite, existing Detect RPC suite,
   native helper boundary suite, JavaScript/UCode syntax checks as applicable,
   and `git diff --check`. Record exact commands and counts in the report.
5. Do not add a generic Detect API, executable/argv capability, new lifecycle,
   router package build, or unrelated refactor. APK builds remain CI-only.
6. Do not merge, push a shared branch, delete the worktree, or deploy from
   this implementer task. The controller will handle review and live proof.

## Files in scope

- `tests/product/z2k-detect-rpc-boundary.test.mjs`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `.superpowers/sdd/2026-09-08-z2k-recovery/task-17-report.md`

## Report contract

Append a concise implementation report to the report path above. Include:

- RED command and the expected failure;
- implementation commit(s);
- GREEN commands with pass/fail/skip counts;
- why the fix is limited to rpcd transport metadata;
- any concerns or remaining live-router evidence needed.

Return only status, commit SHA(s), one-line test summary, and concerns after
writing the report.
