# Native Clean Import Manifest

## Scope And Rules

- Main base: `304728c4fb5e49252247d9f80c27becec89cfe41`
- Donor: `backup/native-clean-donor@76df521e61acc188be8d9f59fcb67be9da90af02`
- Inventory command: `git diff --name-status origin/main..backup/native-clean-donor`
- Inventory size: 70 paths (`65 IMPORT`, `2 MAIN_WINS`, `3 EXCLUDE`)
- `IMPORT` means approved for the stated clean-transplant task, not necessarily
  imported by this commit. Task 1 imports only the four approved documents.
- `MAIN_WINS` means retain the current main file and independently make any
  narrowly required future edit. `EXCLUDE` means do not transplant the donor
  path or behavior.

Each donor status is followed by the donor Git blob ID. The destination consumer
is the reason the path may exist on the clean branch; a test is not a production
consumer unless explicitly stated.

## Path Decisions

| Decision | Donor status/blob | Path | Destination consumer | Reason | Intended task/commit |
|---|---|---|---|---|---|
| IMPORT | A `13808fd26dfc628294bf01b097b34ec463157c6d` | `docs/contracts/native-backend-v1.md` | Native result modules and future adapters | Frozen v1 state/RPC/ownership contract | Task 1, `docs(native): import foundation contracts` |
| IMPORT | A `ace23a54efa674d5e75ff856fb0fbb78edfef2f7` | `docs/contracts/z2m-canonical-json-v1.md` | Helper `atomic_write_json` and protocol tests | Frozen canonical byte contract | Task 1, `docs(native): import foundation contracts` |
| IMPORT | A `799c1abee7d5e1e5233f29b5511c0c5b9f290c37` | `docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md` | Tasks 2-4 implementation | Active reviewed helper implementation plan | Task 1, `docs(native): import foundation contracts` |
| EXCLUDE | A `a12f7065ff7fd4db85167130321da95195c890f1` | `docs/superpowers/plans/2026-08-07-sanitizer-launch-ownership-repair.md` | None | Historical repair plan; final tests carry evidence without donor history | Never |
| IMPORT | A `42a8288bf5019100ef9f834d0653d26ae976f352` | `docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md` | Tasks 2-4 implementation | Approved helper architecture and safety boundary | Task 1, `docs(native): import foundation contracts` |
| MAIN_WINS | M `8d5af99e8eb7abc1fb8e3fe807e191e28c46a8fc` | `docs/test-baseline.json` | Existing repository test baseline | Donor-wide count churn is stale and would hide main evolution; recalculate only from the final clean suite | Task 6 only if final measured baseline requires it |
| IMPORT | A `68f722fc41ad74812f603be812ac47db03c60601` | `tests/fixtures/gate-samples/tilde-binary-broken.uc` | Ucode compile-gate self-test | Negative scanner fixture required by the hardened gate | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `9a33f13c8745ef6334e07384d1ec4ad110f90c7c` | `tests/fixtures/gate-samples/tilde-call-binary-broken.uc` | Ucode compile-gate self-test | Negative call-expression fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e003ac76a4e77ad03247ab7ad2dc469f5626db6a` | `tests/fixtures/gate-samples/tilde-comment-valid.uc` | Ucode compile-gate self-test | Proves comments do not create false positives | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `22900e1eac4b79ab2181823b0c9727fa31d41eb5` | `tests/fixtures/gate-samples/tilde-control-regex-valid.uc` | Ucode compile-gate self-test | Proves regex after control conditions is accepted | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `9a98d4622fe14df4bb2d78570c8a6e380c114067` | `tests/fixtures/gate-samples/tilde-incdec-valid.uc` | Ucode compile-gate self-test | Proves increment/decrement token handling | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `ffb8e311d2da3859f57c6ddf494e886987ba1cd4` | `tests/fixtures/gate-samples/tilde-keyword-regex-valid.uc` | Ucode compile-gate self-test | Proves regex after keywords is accepted | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `3336a59d73400d70d104a8714baad36e6ca99ee1` | `tests/fixtures/gate-samples/tilde-multiline-valid.uc` | Ucode compile-gate self-test | Proves multiline valid syntax is accepted | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e59c439560724bd474d86b95228e1b9f04746b15` | `tests/fixtures/gate-samples/tilde-parenthesized-binary-broken.uc` | Ucode compile-gate self-test | Negative parenthesized binary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `96a24ea1e7495b601c9f4037f2aa35a018f80c2c` | `tests/fixtures/gate-samples/tilde-postfix-binary-broken.uc` | Ucode compile-gate self-test | Negative postfix binary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `ebd6df0b5cf134727ff60ad14c562b56c9021015` | `tests/fixtures/gate-samples/tilde-property-comment-binary-broken.uc` | Ucode compile-gate self-test | Negative property/comment boundary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `c6f2b74861e8ef1586058cba0320fd63984f0b9c` | `tests/fixtures/gate-samples/tilde-property-else-binary-broken.uc` | Ucode compile-gate self-test | Negative property/else boundary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `8769752e81281e01335a118f1b7f09138bc8f77e` | `tests/fixtures/gate-samples/tilde-property-in-binary-broken.uc` | Ucode compile-gate self-test | Negative property/in boundary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e8e203b031ca8b02c7275ba341699ff3ff32bf5f` | `tests/fixtures/gate-samples/tilde-property-keyword-valid.uc` | Ucode compile-gate self-test | Proves property keywords remain valid | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `0f4bfd5987fb2605339732b59f3bd20c874c0437` | `tests/fixtures/gate-samples/tilde-property-newline-binary-broken.uc` | Ucode compile-gate self-test | Negative property/newline boundary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e53e3673f82831b5635961edfc037925c835dbab` | `tests/fixtures/gate-samples/tilde-property-space-binary-broken.uc` | Ucode compile-gate self-test | Negative property/space boundary fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `db6e089e0bd8441d1c73933710970297dcc2f7f4` | `tests/fixtures/gate-samples/tilde-regex-binary-broken.uc` | Ucode compile-gate self-test | Negative regex/binary ambiguity fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `20abd96c1d7a8cefd9ed5b897365e4850d6c0ade` | `tests/fixtures/gate-samples/tilde-string-binary-broken.uc` | Ucode compile-gate self-test | Negative string/binary ambiguity fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `026a6a24312f163c1d28ddbc7eb5bef96d18212e` | `tests/fixtures/gate-samples/tilde-string-valid.uc` | Ucode compile-gate self-test | Proves tilde in string data is accepted | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `2422df8b9c2d87e414e3c46ca64b8a264020e1a3` | `tests/fixtures/gate-samples/tilde-trailing-decimal-binary-broken.uc` | Ucode compile-gate self-test | Negative decimal/binary ambiguity fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e03d47b4e160a87760a44228702406384ad56662` | `tests/fixtures/gate-samples/tilde-unary-valid.uc` | Ucode compile-gate self-test | Proves valid unary tilde is accepted | Task 3, `test(native): import helper verification harness` |
| IMPORT | M `06493313642048695f4ae0135dadcb5e30cd730b` | `tests/gate-ucode-compile.test.sh` | `tools/gate-ucode-compile.sh` | Candidate hardened-gate assertions; import only with all required fixtures after proving relevance on main | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `f360fbc086d9a1e275f15aa9dd9d0ec239c34f2d` | `tests/native/baseline.test.mjs` | Native recursive suite | Focused native suite presence/baseline assertion, not the broad repository baseline | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `fe47fa5224b01b8d3a1129b82305c9cda15797e1` | `tests/native/core/build-fs-helper-hygiene.test.mjs` | Helper package/build closure | Rejects in-tree outputs and test instrumentation in production | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `e8f825b78dc81f70eae5a9bf3efb14f12a75f213` | `tests/native/core/build-fs-helper.sh` | Native helper tests | Isolated host-test compiler wrapper | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `19d05343887451e4159a6cc4bad250b789ecbdcb` | `tests/native/core/fixtures/sanitizer-compile-failure.c` | Sanitizer harness | Controlled compiler-failure fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `8bc4db3bb026a4cd65e4801cfbefd06addcde739` | `tests/native/core/fixtures/sanitizer-pidfd-signal.py` | Sanitizer ownership tests | PID identity/signal fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `e915980290392fc869d85fa54bcdb0d3b529eadd` | `tests/native/core/fixtures/sanitizer-proc-group-scan.sh` | Sanitizer ownership tests | Process-group observation fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `31c5d3d4f27d132c9723934e764a5fe58872f311` | `tests/native/core/fixtures/sanitizer-process-group.sh` | Sanitizer ownership tests | Process-group lifecycle fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `65d0073928800211ed303fc5612596a220cb13a7` | `tests/native/core/fixtures/sanitizer-process-wrapper.sh` | Sanitizer ownership tests | Wrapper ownership fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `c1408c927e5524707dc036a388864feee8f3b37c` | `tests/native/core/fixtures/sanitizer-scenarios.c` | Sanitizer harness | Deterministic sanitizer outcome fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `635746decc4d12a5c1fe5d2f20410004c05e80da` | `tests/native/core/fixtures/unrelated-asan-compile-cc.sh` | Sanitizer ownership tests | Proves unrelated ASan compiler process is preserved | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `de0d65127c3f95244e932252a9ccd01842de87ed` | `tests/native/core/fixtures/unrelated-asan-library-cc.sh` | Sanitizer ownership tests | Proves unrelated ASan library process is preserved | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `9db3787cbac69cfb25652f0404c47668716498b0` | `tests/native/core/fixtures/unsupported-sanitizer-cc.sh` | Sanitizer harness | Unsupported compiler fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `5b1c9ce7e1e5df100f8f3d53c6a4f28420ec2a79` | `tests/native/core/fixtures/unsupported-sanitizer-runtime-cc.sh` | Sanitizer harness | Unsupported runtime fixture | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `6baa227c18f13bd2034c64523646198f9d7a4915` | `tests/native/core/fs-helper-mutation-transport-fixture.mjs` | Mutation transport test | Executes controlled helper transport outcomes | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `5d90c84f765e33198b39b97e219ea15b73629ef5` | `tests/native/core/fs-helper-mutation-transport.test.mjs` | Helper mutation transport | Verifies exit-74/recovery protocol behavior | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `9581f5a05b9526292ca17b09b4a1e76c640b48e6` | `tests/native/core/fs-helper-protocol.test.mjs` | Helper protocol implementation | Closed protocol and canonical JSON conformance | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `675376f6a22f232847ebd5342abeea3977cdf7fe` | `tests/native/core/fs-helper.test.mjs` | Helper production sources | Filesystem, lock, SHA, read, mkdir and atomic behavior | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `3c59c349218f6b191645896909aeaea95f3bf0c0` | `tests/native/core/result.test.mjs` | `core/errors.uc` and `core/result.uc` | Focused v1 result/error contract proof | Task 4, `feat(native): import result contract modules` |
| IMPORT | A `2a18eb3609d38d28eb9524c16af3c3b89a5db41a` | `tests/native/core/run-fs-helper-sanitizers.mjs` | Helper production sources | Sanitizer runner with bounded cleanup | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `8434823a6c09446f78750f4618fefc3a279a19da` | `tests/native/core/sanitizer-harness.test.mjs` | Sanitizer runner | Harness behavior and failure classification | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `d2fd2d557757142fdfa2fde57c23fbafbfa10968` | `tests/native/core/sanitizer-launch-ownership.mjs` | Sanitizer runner/tests | Shared launch identity implementation | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `2985969fe0bd8f6ebb8809ed0dfe07c9678c0e2a` | `tests/native/core/sanitizer-launch-ownership.test.mjs` | Sanitizer launch ownership module | Race and process-identity proof | Task 3, `test(native): import helper verification harness` |
| IMPORT | A `11a93c2b586b609c0734559fbb9783b028e2e7f1` | `tests/native/core/sanitizer-process-cleanup.mjs` | Sanitizer runner/tests | Shared safe process cleanup implementation | Task 3, `test(native): import helper verification harness` |
| EXCLUDE | A `dcfbaab2fa612ee6ddd4c94179e1aae642c3f84c` | `tests/native/ratings-helper.compile.test.mjs` | None | Main has no runtime consumer for the ratings-helper prototype; a test alone is not consumer proof | Never unless separately designed |
| IMPORT | M `c0c7fa9590a5c7b041ea4c29bd6cc5584f13a76f` | `tests/ucode-no-sugar.test.sh` | Imported result modules | Candidate no-sugar coverage; apply only the minimal proven main-compatible delta | Task 3/4, corresponding test or result commit |
| IMPORT | M `23eb0d2110287fe383793238cf81b17738644f90` | `tools/gate-ucode-compile.sh` | Shipped ucode including result modules | Candidate recursive/safe-path compile gate; import only after main compatibility proof | Task 3, `test(native): import helper verification harness` |
| MAIN_WINS | M `42666cb8d91d3a0ff97a4bd668629b82989243ac` | `tools/run-all-tests.sh` | Existing full repository suite | Broad donor runner replacement risks dropping current-main suites; wire native tests minimally after import | Task 3/6 independent edit only |
| IMPORT | A `5afad255e68cf1e621c24f0f07ae29318df5857b` | `zapret2-manager/files/usr/libexec/zapret2-manager/core/errors.uc` | `core/result.uc` and result tests | Canonical native error vocabulary | Task 4, `feat(native): import result contract modules` |
| IMPORT | A `f549ac7f7d017291d9856e2fb2d3f6f6f3cf3bc2` | `zapret2-manager/files/usr/libexec/zapret2-manager/core/result.uc` | Future native adapters and result tests | Canonical success/error envelope builder | Task 4, `feat(native): import result contract modules` |
| EXCLUDE | M `1b9ef52c3428c6442d9f0b50b3b7925d7c2879b7` | `zapret2-manager/files/usr/libexec/zapret2-manager/ratings-helper.uc` | None proven on current main | Stale prototype modification with no runtime/package caller | Never unless separately designed |
| IMPORT | A `9ab6a43b0933036d5d5164b13632e5a391a8bc15` | `zapret2-manager/src/z2m-core-helper/atomic.c` | Helper binary | Atomic byte/JSON publication implementation | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `e1004567cc1fb2221b92667953c393d63e0c00e2` | `zapret2-manager/src/z2m-core-helper/base64.c` | Helper protocol | Bounded payload decoding | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `638a273fc54b93e02616207f06ef82b14d415bcf` | `zapret2-manager/src/z2m-core-helper/errors.c` | Helper protocol/operations | Stable error envelope construction | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `f2507f4e0b83735eb34c78d45921bf6735b6cec1` | `zapret2-manager/src/z2m-core-helper/files.c` | Helper binary | Descriptor-safe read/hash operations | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `b6862158ba891471c41c30180b0c1e5e50e35380` | `zapret2-manager/src/z2m-core-helper/helper.h` | All helper translation units | Shared types, limits and function declarations | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `1a97295132bab0bda95e0121fdd8906e66a7d57d` | `zapret2-manager/src/z2m-core-helper/main.c` | Installed helper executable | Process entry point and transport exit semantics | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `64f3efdeb9302ed44566fd073d12b469799bbf22` | `zapret2-manager/src/z2m-core-helper/mkdir.c` | Helper binary | Private directory mutation | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `435fc8bb369f80a7d01589b9a8292bdec286af62` | `zapret2-manager/src/z2m-core-helper/paths.c` | Helper filesystem operations | Canonical relative-path validation | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `9643014a317b1262c5aeaa1c49c132db518d2b86` | `zapret2-manager/src/z2m-core-helper/protocol-v1.json` | Helper implementation/tests and future callers | Machine-readable operation/root/limit manifest | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `b2661a3f8d78c05072d3bf6f7ad516e626b3375f` | `zapret2-manager/src/z2m-core-helper/protocol.c` | Helper executable | Strict bounded request parser and dispatcher | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `bbf8814f02f119d1fe4ae30de26dc97ea160c16d` | `zapret2-manager/src/z2m-core-helper/roots.c` | Helper filesystem operations | Closed root mapping and descriptor acquisition | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `9081cf1960ffd549187f9b158a3637b3875ef8a1` | `zapret2-manager/src/z2m-core-helper/sha256.c` | Helper hash operations | Local SHA-256 implementation | Task 2, `feat(native): import filesystem helper foundation` |
| IMPORT | A `b8f66d14aea4b4823b40d63e5c0956b437a0c2f8` | `zapret2-manager/src/z2m-core-helper/test-audit.c` | Native atomic-write tests only | Test-only audit hooks; never compile or install in production | Task 3, `test(native): import helper verification harness` |

## DNS And Telegram Preservation Proof

The exact 70-path inventory above contains no production DNS or Telegram path.
This was checked independently with:

```powershell
git diff --name-only origin/main..backup/native-clean-donor |
  Where-Object { $_ -match '(?i)(^|/)(dns|telegram|tg|proxycfg|service-dns|dnsprov|dns-global)(/|\.|$)' }
```

The command produces no output. The donor therefore supplies no DNS/TG
production delta to transplant. Main remains authoritative for `dns.uc`,
`service-dns`, `dnsprov`, `dns-global`, `proxycfg.uc`, proxy/procd/secrets,
health/recovery behavior, packages, catalogs, characterization tests, and UI.
Task 1 modifies none of those paths. A final clean-tree check must also require
`git diff --name-only origin/main...HEAD` to contain no DNS/TG production path.

## Task 1 Import Ledger

Only these donor blobs are imported now:

| Path | Donor blob |
|---|---|
| `docs/contracts/native-backend-v1.md` | `13808fd26dfc628294bf01b097b34ec463157c6d` |
| `docs/contracts/z2m-canonical-json-v1.md` | `ace23a54efa674d5e75ff856fb0fbb78edfef2f7` |
| `docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md` | `799c1abee7d5e1e5233f29b5511c0c5b9f290c37` |
| `docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md` | `42a8288bf5019100ef9f834d0653d26ae976f352` |

No helper source, native test, compile-gate change, result module, ratings
prototype, historical repair plan, baseline churn, or broad runner change is
part of Task 1. Main has contract-style tests for executable interfaces and JSON
schemas, but no suitable non-native Markdown contract-link harness. Task 1
therefore uses direct local Markdown-link and fenced-JSON checks rather than
prematurely importing the donor native harness.
