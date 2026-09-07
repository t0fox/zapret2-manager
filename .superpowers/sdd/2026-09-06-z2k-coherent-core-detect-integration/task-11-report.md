# Task 11 report: typed Detect RPC and schema-gated adapter

Status: IMPLEMENTED. No router deployment, live RPC/Detect execution, browser
acceptance, merge, or push was run. Unrelated UI and Scanner work was not
modified.

## Scope

Added the canonical `z2k_detect_status` RPC plus typed probe/classify/quic/
voice/tcp16 RPC wiring, ACL permission, and matching LuCI API methods. The
adapter now resolves the existing Registry receipt and runtime-composition
authority before production native invocation. Missing installation, legacy or
incoherent authority, unavailable Detect bytes, and Detect identity mismatch
are fail-closed with canonical errors; no `scanner_*` fallback is reachable.

The existing Task 10 bounded result validator remains the sole result-schema
authority. All five command fixtures cover malformed, truncated, non-object,
wrong-type, missing-required, valid, additive-field, timeout, and bounded
output cases. Additive fields inside valid upstream result objects survive;
missing or semantically wrong required fields return `EDETECT_SCHEMA`.

## TDD evidence

RED after adding Task 11 assertions and fixtures, before production changes:

```text
node --test tests/product/z2k-detect-rpc.test.mjs
1 failed, 1 passed, 9 skipped
Failure: missing z2k_detect_status RPC registration (expected).
```

GREEN focused command:

```text
wsl.exe -e bash -lc 'set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs'
```

Result: `58 passed, 0 failed`.

## Verification

- Receipt/authority/lifecycle/runtime support suites: `110 tests, 109 passed,
  0 failed, 1 existing TODO`.
- `node --check` passed for `z2m-api.js` and `z2k-detect-rpc.test.mjs`.
- ACL and protocol JSON parsing passed.
- `git diff --check` passed.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `node scripts/docs.mjs verify`: Quartz SHA verified
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- UCode imports and adapter seams passed through the WSL focused run with
  `/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`.

## Files and commits

Task-owned files:

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `tests/product/z2k-detect-rpc.test.mjs`

Implementation commit: `915816c72cc8c329853704eaa4a1aaf42c7e4c0e`
  (`feat: expose typed Z2K Detect RPC`).
Report commit: `5511cf311dc3113faf04342584ad980068b407ae` before this final
evidence-only amend; the final HEAD is reported by the handoff below.

## Boundaries

Router/OpenWrt deployment, live network Detect, authenticated ubus/RPC
acceptance, browser acceptance, package-E2E, merge, and push remain NOT_RUN.
