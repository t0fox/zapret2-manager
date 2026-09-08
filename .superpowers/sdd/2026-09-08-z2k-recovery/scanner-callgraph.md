# Task 10 — legacy Scanner call graph and removal boundary

Status: PROOF_RECORDED

This document is the Task 11 deletion boundary. It records production references found by the Task 10 production grep and separates the legacy native Scanner authority from retained Detect and shared profile-activation code.

## REMOVE_LEGACY

These references are exclusively the old native Scanner authority and are the only Task 11 removal targets:

| Reference | Current owner / caller | Task 11 action |
| --- | --- | --- |
| `zapret2-manager/src/z2m-core-helper/scanner.c` | native helper implementation of `z2m_scanner_probe` | remove file |
| `z2m_scanner_probe` declaration in `helper.h` | native dispatch ABI for `scanner_probe` | remove declaration |
| `scanner_probe` dispatch in `main.c` | native operation dispatcher | remove branch and allow-list entry |
| `scanner_probe` operation names/shape in `protocol.c` | native protocol validation and result shaping | remove operation-specific branches |
| `scanner_probe` enum/schema in `protocol-v1.json` | public helper protocol | remove operation and schema |
| `scanner_probe` success/error branches in `core/native-helper.uc` | UCode native-helper adapter | remove scanner-specific result shape and invoke export |
| `scanner.c` source entries in `zapret2-manager/Makefile` and `zapret2-manager-full/Makefile` | package native build closure | replace with retained `detect.c` |

The closure test intentionally fails on these current remnants and turns green only after Task 11 removes them.

## KEEP_SHARED

These references are not removable with the old native Scanner:

| Reference | Evidence / owner | Task 11 ruling |
| --- | --- | --- |
| `scanner-runtime-adapter.sh` | invoked by `profiles-apply.uc` through `SCANNER_RUNTIME_ADAPTER`; the callers include `activate`, `session-cleanup`, `stabilize`, and `cleanup` | keep path and interface unchanged |
| `profiles-apply.uc` scanner runtime calls | profile activation lifecycle, not native `scanner_probe`; it stages, activates, stabilizes, and cleans scanner runtime candidates | keep shared adapter integration |
| `scanner-cli.uc` / `scanner-cli-entry.uc` | compatibility shell dispatches the five typed `z2k_detect_*` actions and discovery operations | keep, with no legacy operation reintroduced |
| `z2k-detect.uc` and Detect RPC calls | current typed Detect product boundary | keep exactly `probe`, `classify`, `quic`, `voice`, and `tcp16` |
| `scanner-transient` references in apply/lifecycle code | transient lock/state used by profile activation and rollback | inspect with caller evidence; do not delete as part of native protocol removal |
| `quick`, `standard`, and `full` in blockcheck/orchestra/runtime Lua | product modes outside the old native `scanner_probe` protocol | keep unless a later caller-specific proof assigns a hit to legacy Scanner |

## DEAD_REFERENCE / OUT-OF-SCOPE

- Historical design/audit documents and tests are excluded from the production call graph; they are not deletion targets.
- `scanner.c` mentions in archived or audit documents are historical references, not package build ownership.
- Generic `full`/`standard` terms in vendor CodeMirror, proxy, blockcheck, orchestra, and runtime Lua are unrelated mode names and must not be removed under Task 11.

## Retained protocol contract

The post-recovery native helper must expose exactly these five Detect operations in addition to existing file/ownership operations:

`z2k_detect_probe`, `z2k_detect_classify`, `z2k_detect_quic`, `z2k_detect_voice`, `z2k_detect_tcp16`.

The Task 11 closure test asserts that `scanner_probe`, `z2m_scanner_probe`, `scanner.c` compilation, and the `native-helper.uc` scanner success-shape branch are absent while all five retained operations remain present.
