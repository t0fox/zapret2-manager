# Task 10 — native Scanner removal boundary

Status: VERIFIED

## Proof artifact

`scanner-callgraph.md` records the production grep and separates the exact `REMOVE_LEGACY` native `scanner_probe` closure from `KEEP_SHARED` profile activation and typed Detect paths.

The important ownership result is that `scanner-runtime-adapter.sh` is used by `profiles-apply.uc` for activate, session-cleanup, stabilize, and cleanup. It is therefore shared non-Scanner runtime authority and is explicitly kept for Task 11.

## RED closure evidence

Command:

```text
node --test tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Result: **7 passed, 1 failed**. The only failure is the intentional Task 11 closure assertion that currently-present `scanner_probe` and `scanner.c` authority must be absent. The pre-existing unwired suite and the retained Detect/shared-adapter checks pass.

The closure contract locks:

- no `scanner_probe` operation in `protocol-v1.json`;
- no `z2m_scanner_probe` declaration/dispatch;
- no `scanner.c` package compilation;
- no `native-helper.uc` scanner success-shape branch;
- exactly five retained `z2k_detect_*` operations;
- unchanged shared `scanner-runtime-adapter.sh` ownership for profile activation.

No production deletion was performed in Task 10; that mutation belongs to Task 11. No APK build, router deployment, merge, push, or branch deletion was performed.
