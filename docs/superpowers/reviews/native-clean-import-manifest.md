# Native Clean Import Manifest

## Scope And Rules

- Main base: `304728c4fb5e49252247d9f80c27becec89cfe41`
- Donor: `backup/native-clean-donor@76df521e61acc188be8d9f59fcb67be9da90af02`
- Inventory command: `git diff --name-status origin/main..backup/native-clean-donor`
- Inventory size: 70 paths (`42 IMPORT`, `5 MAIN_WINS`, `23 EXCLUDE`)
- `IMPORT` means approved for the stated clean-transplant task, not necessarily
  imported by this commit. Task 1 imported only the four approved documents;
  Task 2 imports the helper production sources and protocol listed below.
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
| EXCLUDE | A `68f722fc41ad74812f603be812ac47db03c60601` | `tests/fixtures/gate-samples/tilde-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `9a33f13c8745ef6334e07384d1ec4ad110f90c7c` | `tests/fixtures/gate-samples/tilde-call-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `e003ac76a4e77ad03247ab7ad2dc469f5626db6a` | `tests/fixtures/gate-samples/tilde-comment-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `22900e1eac4b79ab2181823b0c9727fa31d41eb5` | `tests/fixtures/gate-samples/tilde-control-regex-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `9a98d4622fe14df4bb2d78570c8a6e380c114067` | `tests/fixtures/gate-samples/tilde-incdec-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `ffb8e311d2da3859f57c6ddf494e886987ba1cd4` | `tests/fixtures/gate-samples/tilde-keyword-regex-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `3336a59d73400d70d104a8714baad36e6ca99ee1` | `tests/fixtures/gate-samples/tilde-multiline-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `e59c439560724bd474d86b95228e1b9f04746b15` | `tests/fixtures/gate-samples/tilde-parenthesized-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `96a24ea1e7495b601c9f4037f2aa35a018f80c2c` | `tests/fixtures/gate-samples/tilde-postfix-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `ebd6df0b5cf134727ff60ad14c562b56c9021015` | `tests/fixtures/gate-samples/tilde-property-comment-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `c6f2b74861e8ef1586058cba0320fd63984f0b9c` | `tests/fixtures/gate-samples/tilde-property-else-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `8769752e81281e01335a118f1b7f09138bc8f77e` | `tests/fixtures/gate-samples/tilde-property-in-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `e8e203b031ca8b02c7275ba341699ff3ff32bf5f` | `tests/fixtures/gate-samples/tilde-property-keyword-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `0f4bfd5987fb2605339732b59f3bd20c874c0437` | `tests/fixtures/gate-samples/tilde-property-newline-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `e53e3673f82831b5635961edfc037925c835dbab` | `tests/fixtures/gate-samples/tilde-property-space-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `db6e089e0bd8441d1c73933710970297dcc2f7f4` | `tests/fixtures/gate-samples/tilde-regex-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `20abd96c1d7a8cefd9ed5b897365e4850d6c0ade` | `tests/fixtures/gate-samples/tilde-string-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `026a6a24312f163c1d28ddbc7eb5bef96d18212e` | `tests/fixtures/gate-samples/tilde-string-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `2422df8b9c2d87e414e3c46ca64b8a264020e1a3` | `tests/fixtures/gate-samples/tilde-trailing-decimal-binary-broken.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| EXCLUDE | A `e03d47b4e160a87760a44228702406384ad56662` | `tests/fixtures/gate-samples/tilde-unary-valid.uc` | None proven | Donor gate fixture has no Native Foundation consumer or focused RED | Never; reconsider only with separate consumer proof |
| MAIN_WINS | M `06493313642048695f4ae0135dadcb5e30cd730b` | `tests/gate-ucode-compile.test.sh` | Existing main compile-gate tests | Donor rewrite is not Native Foundation dependency closure | Keep main; minimal future edit only after focused RED |
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
| MAIN_WINS | M `c0c7fa9590a5c7b041ea4c29bd6cc5584f13a76f` | `tests/ucode-no-sugar.test.sh` | Existing main no-sugar tests | Donor rewrite and tilde fixture bundle lack a Native Foundation consumer | Keep main; minimal future edit only after focused RED |
| MAIN_WINS | M `23eb0d2110287fe383793238cf81b17738644f90` | `tools/gate-ucode-compile.sh` | Existing main compile gate | Donor hardening rewrite is not proven necessary for imported native paths | Keep main; minimal future edit only after focused RED |
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

Task 2 likewise modifies no DNS, Telegram, or UI path. It independently adds the
main package build/install closure rather than importing an incomplete donor
Makefile.

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

## Task 2 Import Ledger

Task 2 imports these exact donor production blobs:

| Path | Donor blob |
|---|---|
| `zapret2-manager/src/z2m-core-helper/atomic.c` | `9ab6a43b0933036d5d5164b13632e5a391a8bc15` |
| `zapret2-manager/src/z2m-core-helper/base64.c` | `e1004567cc1fb2221b92667953c393d63e0c00e2` |
| `zapret2-manager/src/z2m-core-helper/errors.c` | `638a273fc54b93e02616207f06ef82b14d415bcf` |
| `zapret2-manager/src/z2m-core-helper/files.c` | `f2507f4e0b83735eb34c78d45921bf6735b6cec1` |
| `zapret2-manager/src/z2m-core-helper/helper.h` | `b6862158ba891471c41c30180b0c1e5e50e35380` |
| `zapret2-manager/src/z2m-core-helper/main.c` | `1a97295132bab0bda95e0121fdd8906e66a7d57d` |
| `zapret2-manager/src/z2m-core-helper/mkdir.c` | `64f3efdeb9302ed44566fd073d12b469799bbf22` |
| `zapret2-manager/src/z2m-core-helper/paths.c` | `435fc8bb369f80a7d01589b9a8292bdec286af62` |
| `zapret2-manager/src/z2m-core-helper/protocol-v1.json` | `9643014a317b1262c5aeaa1c49c132db518d2b86` |
| `zapret2-manager/src/z2m-core-helper/protocol.c` | `b2661a3f8d78c05072d3bf6f7ad516e626b3375f` |
| `zapret2-manager/src/z2m-core-helper/roots.c` | `bbf8814f02f119d1fe4ae30de26dc97ea160c16d` |
| `zapret2-manager/src/z2m-core-helper/sha256.c` | `9081cf1960ffd549187f9b158a3637b3875ef8a1` |

Task 2 left `test-audit.c` absent: it is test-only, production compilation
excludes `Z2M_TESTING`, and Task 3 owns its import with the native test harness.
No donor test, Makefile, DNS/TG/UI path, artifact, or generated output was
imported by Task 2.

## Task 3 Import Ledger

Task 3 imports 23 exact donor blobs: `tests/native/baseline.test.mjs`, every
manifest-approved path under `tests/native/core/` except
`tests/native/core/result.test.mjs`, and test-only
`zapret2-manager/src/z2m-core-helper/test-audit.c`. Their individual donor blob
IDs are recorded in the path-decision table above and all 23 worktree hashes
were rechecked against `backup/native-clean-donor` before commit.

At initial import, the package test was the only imported-harness-adjacent file
changed from its Task 2 state. Its obsolete assertion that `test-audit.c` was
still deferred was replaced by the Task 3 invariant: the audit source is
present for native tests but remains absent from production compilation and
installation.

`tests/native/ratings-helper.compile.test.mjs`, `result.test.mjs`, all tilde
fixtures, donor gate and broad-runner rewrites, and DNS, Telegram, and UI paths
remain absent. Task 3 does not modify any production helper source or package
rule.

### Task 3 Clean-Branch Adaptations

Review fix round 1 adapts three donor-origin harness files and adds one local
tracked fixture. The path-decision table retains each original donor blob for
provenance; these hashes identify the clean-branch versions:

| Path | Clean-branch blob | Adaptation |
|---|---|---|
| `tests/native/core/build-fs-helper-hygiene.test.mjs` | `e52c2fd93bdd4cf4f14a6f1995d6c89bc0a6c9cc` | Classify sanitizer-family paths using Git tracked status plus binary/type/name evidence; reject untracked textual reports without exempting documentation extensions |
| `tests/native/core/sanitizer-launch-ownership.test.mjs` | `e244fb890f294280e8441d4ef9dd9d25d0074bce` | Deterministic retained-identity success and contradictory-evidence matrix covering exact observations, survivors, scan failures, marker reappearance, partial markers, and unreaped launchers |
| `tests/native/core/sanitizer-process-cleanup.mjs` | `e02932382af3eba029067198a44f103943243829` | Reuse previously verified identity only for a double-observed missing marker and empty owned-group scan; never signal or claim disappearance/deletion before launcher reaping |
| `tests/native/core/fixtures/sanitizer-tracked-notes.md` | `c807f8e4ebef0996d458d622cece91755490327f` | Tracked documentation fixture proving legitimate sanitizer-family source text remains allowed |

These are clean-main verification fixes, not additional donor imports. No
timeout is increased, no blind signal or kill is added, and scan failure,
surviving members, partial markers, marker reappearance, or an unreaped launcher
still classify cleanup as uncertain.

Review fix round 2 adds strict coverage for every retained-identity predicate.
The unreaped-launcher RED exposed one accounting defect: cleanup was uncertain
but still claimed `groupGone` and `markerDeleted`. Those claims now remain false
until launcher reaping is proven. The fix changes no timeout or signal behavior.

## Task 4 Import Ledger

Task 4 imports these exact donor blobs:

| Path | Donor blob | Consumer |
|---|---|---|
| `zapret2-manager/files/usr/libexec/zapret2-manager/core/errors.uc` | `5afad255e68cf1e621c24f0f07ae29318df5857b` | `core/result.uc` and focused result tests |
| `zapret2-manager/files/usr/libexec/zapret2-manager/core/result.uc` | `f549ac7f7d017291d9856e2fb2d3f6f6f3cf3bc2` | Future native adapters and focused result tests |
| `tests/native/core/result.test.mjs` | `3c59c349218f6b191645896909aeaea95f3bf0c0` | Six canonical v1 result/error contract checks |

The package's existing `$(CP) ./files/* $(1)/` install rule recursively carries
both modules to `/usr/libexec/zapret2-manager/core/`. `result.uc` imports only
its colocated `./errors.uc`; no main RPC handler is replaced or changed. Task 4
does not import donor gate rewrites or tilde fixtures and does not modify DNS,
Telegram, UI, package, or broad-runner paths.

## Task 5 Preservation Ledger

Task 5 adds `tests/native/main-migration-preservation.test.mjs`, repairs only the
manual builder's recursive package staging, and changes no DNS, Telegram, UI,
donor-import, package Makefile, or helper production source. The test
pins main base `304728c4fb5e49252247d9f80c27becec89cfe41` and embeds the
reviewed Git blob IDs for 31 explicit DNS/TG migration paths. This keeps the
proof deterministic in a fresh checkout without requiring a fetch; when local
`origin/main`, `backup/native-clean-main-base`, or donor refs exist, it also
cross-checks their pinned SHAs and donor blob equality.

The preservation set covers DNS workers/CLIs/catalogs, TG proxycfg/proxy/provider
modules, rpcd/procd, both TG package definitions and their config/patch/licenses,
plus health and boot-recovery sources. It also characterizes the package
Makefile's recursive `files` install and the manual builder's backend, shell,
catalog, service and native-helper staging closure. The donor has zero delta for
all 31 paths.

This is not a blanket permanent freeze. A future intentional DNS/TG migration
must update focused behavior tests first, then review and update the explicit
path/blob characterization and this provenance ledger in the same change.

Task 5 review fix: recursive manual staging now applies an explicit executable
mode only to the seven package-owned runtime `.sh` entry points, then retains
the existing explicit `0755` init, hotplug, and native-helper overlays. A WSL
temp-root staging test starts those entry points at `0644`, proves all ten
installed executables are `0755`, and proves representative `0640` ipset data
and `0600` state/config data retain their source modes. No broad chmod applies
to package data, configuration, or secrets. The stale boot-recovery and Auto
Strategy package assertions now verify recursive staging, source existence,
and the installed-mode policy rather than the removed literal copy loops.

The ignored-import ledger remains unchanged: this review fix imports no donor
path and does not reconsider any `EXCLUDE` or `MAIN_WINS` decision. It modifies
only the existing manual builder, existing package tests, and this provenance
record; no DNS, Telegram, UI, hygiene-gate, package Makefile, or helper source
semantics change.

Focused Task 5 verification at `84d4391` plus the Task 5 worktree changes:

- DNS backend, service DNS, dnsprov, catalogs and preservation: 154 pass, 0 fail.
- TG proxycfg/proxy/procd/package/health/recovery: 185 pass, 0 fail.
- Native package/helper/core/sanitizer: 179 pass, 0 fail.
- Package/install/provenance follow-up after recursive staging repair: 53 pass, 0 fail.
- Shell gates: 10 pass, 0 fail (Windows Node path supplied to WSL); `ucode` binary unavailable.
- Known stale UI-only `dns-provider-contract` baseline remains 5 pass, 2 fail;
  no DNS UI or production change was made to force those assertions green.

## Task 6 Final Addition Ledger

This machine-readable ledger is the complete allowlist for paths added relative
to main. `EXACT` records an unchanged donor blob, `ADAPTED` records the donor
blob plus the clean-branch reason for divergence, and `LOCAL` records a path
created for the clean transplant with no donor provenance claim. The repository
hygiene gate requires exact agreement between this list and Git.

<!-- native-clean-final-ledger:start -->
```json
[
  {"path":"docs/contracts/native-backend-v1.md","class":"contract","state":"EXACT","donorBlob":"13808fd26dfc628294bf01b097b34ec463157c6d","consumer":"native result modules and future adapters"},
  {"path":"docs/contracts/z2m-canonical-json-v1.md","class":"contract","state":"EXACT","donorBlob":"ace23a54efa674d5e75ff856fb0fbb78edfef2f7","consumer":"atomic JSON helper and protocol tests"},
  {"path":"docs/superpowers/plans/2026-08-07-native-clean-transplant.md","class":"plan","state":"LOCAL","donorBlob":null,"consumer":"clean transplant execution"},
  {"path":"docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md","class":"plan","state":"EXACT","donorBlob":"799c1abee7d5e1e5233f29b5511c0c5b9f290c37","consumer":"helper implementation tasks"},
  {"path":"docs/superpowers/reviews/native-clean-import-manifest.md","class":"provenance","state":"LOCAL","donorBlob":null,"consumer":"repository hygiene and transplant review"},
  {"path":"docs/superpowers/specs/2026-08-07-native-clean-transplant-design.md","class":"spec","state":"LOCAL","donorBlob":null,"consumer":"clean transplant plan"},
  {"path":"docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md","class":"spec","state":"EXACT","donorBlob":"42a8288bf5019100ef9f834d0653d26ae976f352","consumer":"helper implementation plan"},
  {"path":"tests/native/baseline.test.mjs","class":"native-test","state":"EXACT","donorBlob":"f360fbc086d9a1e275f15aa9dd9d0ec239c34f2d","consumer":"native recursive suite"},
  {"path":"tests/native/core/build-fs-helper-hygiene.test.mjs","class":"native-test","state":"ADAPTED","donorBlob":"fe47fa5224b01b8d3a1129b82305c9cda15797e1","consumer":"helper build and artifact hygiene","adaptation":"uses tracked status and file evidence to reject generated sanitizer outputs without rejecting tracked documentation"},
  {"path":"tests/native/core/build-fs-helper.sh","class":"native-test","state":"EXACT","donorBlob":"e8f825b78dc81f70eae5a9bf3efb14f12a75f213","consumer":"native helper tests"},
  {"path":"tests/native/core/fixtures/sanitizer-compile-failure.c","class":"native-fixture","state":"EXACT","donorBlob":"19d05343887451e4159a6cc4bad250b789ecbdcb","consumer":"sanitizer compile-failure test"},
  {"path":"tests/native/core/fixtures/sanitizer-pidfd-signal.py","class":"native-fixture","state":"EXACT","donorBlob":"8bc4db3bb026a4cd65e4801cfbefd06addcde739","consumer":"sanitizer process identity tests"},
  {"path":"tests/native/core/fixtures/sanitizer-proc-group-scan.sh","class":"native-fixture","state":"EXACT","donorBlob":"e915980290392fc869d85fa54bcdb0d3b529eadd","consumer":"sanitizer process-group observation"},
  {"path":"tests/native/core/fixtures/sanitizer-process-group.sh","class":"native-fixture","state":"EXACT","donorBlob":"31c5d3d4f27d132c9723934e764a5fe58872f311","consumer":"sanitizer process-group lifecycle tests"},
  {"path":"tests/native/core/fixtures/sanitizer-process-wrapper.sh","class":"native-fixture","state":"EXACT","donorBlob":"65d0073928800211ed303fc5612596a220cb13a7","consumer":"sanitizer wrapper ownership tests"},
  {"path":"tests/native/core/fixtures/sanitizer-scenarios.c","class":"native-fixture","state":"EXACT","donorBlob":"c1408c927e5524707dc036a388864feee8f3b37c","consumer":"deterministic sanitizer outcomes"},
  {"path":"tests/native/core/fixtures/sanitizer-tracked-notes.md","class":"native-fixture","state":"LOCAL","donorBlob":null,"consumer":"tracked sanitizer documentation negative control"},
  {"path":"tests/native/core/fixtures/unrelated-asan-compile-cc.sh","class":"native-fixture","state":"EXACT","donorBlob":"635746decc4d12a5c1fe5d2f20410004c05e80da","consumer":"unrelated compiler preservation test"},
  {"path":"tests/native/core/fixtures/unrelated-asan-library-cc.sh","class":"native-fixture","state":"EXACT","donorBlob":"de0d65127c3f95244e932252a9ccd01842de87ed","consumer":"unrelated library process preservation test"},
  {"path":"tests/native/core/fixtures/unsupported-sanitizer-cc.sh","class":"native-fixture","state":"EXACT","donorBlob":"9db3787cbac69cfb25652f0404c47668716498b0","consumer":"unsupported sanitizer compiler test"},
  {"path":"tests/native/core/fixtures/unsupported-sanitizer-runtime-cc.sh","class":"native-fixture","state":"EXACT","donorBlob":"5b1c9ce7e1e5df100f8f3d53c6a4f28420ec2a79","consumer":"unsupported sanitizer runtime test"},
  {"path":"tests/native/core/fs-helper-mutation-transport-fixture.mjs","class":"native-fixture","state":"EXACT","donorBlob":"6baa227c18f13bd2034c64523646198f9d7a4915","consumer":"helper mutation transport test"},
  {"path":"tests/native/core/fs-helper-mutation-transport.test.mjs","class":"native-test","state":"EXACT","donorBlob":"5d90c84f765e33198b39b97e219ea15b73629ef5","consumer":"helper transport recovery proof"},
  {"path":"tests/native/core/fs-helper-protocol.test.mjs","class":"native-test","state":"EXACT","donorBlob":"9581f5a05b9526292ca17b09b4a1e76c640b48e6","consumer":"helper protocol conformance"},
  {"path":"tests/native/core/fs-helper.test.mjs","class":"native-test","state":"EXACT","donorBlob":"675376f6a22f232847ebd5342abeea3977cdf7fe","consumer":"helper filesystem behavior"},
  {"path":"tests/native/core/result.test.mjs","class":"native-test","state":"EXACT","donorBlob":"3c59c349218f6b191645896909aeaea95f3bf0c0","consumer":"native result modules"},
  {"path":"tests/native/core/run-fs-helper-sanitizers.mjs","class":"native-test","state":"EXACT","donorBlob":"2a18eb3609d38d28eb9524c16af3c3b89a5db41a","consumer":"helper sanitizer execution"},
  {"path":"tests/native/core/sanitizer-harness.test.mjs","class":"native-test","state":"EXACT","donorBlob":"8434823a6c09446f78750f4618fefc3a279a19da","consumer":"sanitizer harness behavior"},
  {"path":"tests/native/core/sanitizer-launch-ownership.mjs","class":"native-test","state":"EXACT","donorBlob":"d2fd2d557757142fdfa2fde57c23fbafbfa10968","consumer":"sanitizer launch identity tests"},
  {"path":"tests/native/core/sanitizer-launch-ownership.test.mjs","class":"native-test","state":"ADAPTED","donorBlob":"2985969fe0bd8f6ebb8809ed0dfe07c9678c0e2a","consumer":"sanitizer launch ownership proof","adaptation":"adds deterministic retained-identity and contradictory-evidence coverage"},
  {"path":"tests/native/core/sanitizer-process-cleanup.mjs","class":"native-test","state":"ADAPTED","donorBlob":"11a93c2b586b609c0734559fbb9783b028e2e7f1","consumer":"safe sanitizer process cleanup","adaptation":"requires retained identity and launcher reaping before cleanup success claims"},
  {"path":"tests/native/main-migration-preservation.test.mjs","class":"native-test","state":"LOCAL","donorBlob":null,"consumer":"main DNS and Telegram preservation proof"},
  {"path":"tests/native/package-helper.test.mjs","class":"native-test","state":"LOCAL","donorBlob":null,"consumer":"helper package and manual install closure"},
  {"path":"tests/native/repository-hygiene.test.mjs","class":"native-test","state":"LOCAL","donorBlob":null,"consumer":"clean transplant boundary gate"},
  {"path":"zapret2-manager/files/usr/libexec/zapret2-manager/core/errors.uc","class":"runtime-module","state":"EXACT","donorBlob":"5afad255e68cf1e621c24f0f07ae29318df5857b","consumer":"native result module"},
  {"path":"zapret2-manager/files/usr/libexec/zapret2-manager/core/result.uc","class":"runtime-module","state":"EXACT","donorBlob":"f549ac7f7d017291d9856e2fb2d3f6f6f3cf3bc2","consumer":"future native adapters and result tests"},
  {"path":"zapret2-manager/src/z2m-core-helper/atomic.c","class":"helper-source","state":"EXACT","donorBlob":"9ab6a43b0933036d5d5164b13632e5a391a8bc15","consumer":"native helper executable"},
  {"path":"zapret2-manager/src/z2m-core-helper/base64.c","class":"helper-source","state":"EXACT","donorBlob":"e1004567cc1fb2221b92667953c393d63e0c00e2","consumer":"native helper protocol"},
  {"path":"zapret2-manager/src/z2m-core-helper/errors.c","class":"helper-source","state":"EXACT","donorBlob":"638a273fc54b93e02616207f06ef82b14d415bcf","consumer":"native helper errors"},
  {"path":"zapret2-manager/src/z2m-core-helper/files.c","class":"helper-source","state":"EXACT","donorBlob":"f2507f4e0b83735eb34c78d45921bf6735b6cec1","consumer":"native helper file operations"},
  {"path":"zapret2-manager/src/z2m-core-helper/helper.h","class":"helper-source","state":"EXACT","donorBlob":"b6862158ba891471c41c30180b0c1e5e50e35380","consumer":"all native helper translation units"},
  {"path":"zapret2-manager/src/z2m-core-helper/main.c","class":"helper-source","state":"EXACT","donorBlob":"1a97295132bab0bda95e0121fdd8906e66a7d57d","consumer":"installed native helper executable"},
  {"path":"zapret2-manager/src/z2m-core-helper/mkdir.c","class":"helper-source","state":"EXACT","donorBlob":"64f3efdeb9302ed44566fd073d12b469799bbf22","consumer":"native helper directory operations"},
  {"path":"zapret2-manager/src/z2m-core-helper/paths.c","class":"helper-source","state":"EXACT","donorBlob":"435fc8bb369f80a7d01589b9a8292bdec286af62","consumer":"native helper path validation"},
  {"path":"zapret2-manager/src/z2m-core-helper/protocol-v1.json","class":"helper-source","state":"EXACT","donorBlob":"9643014a317b1262c5aeaa1c49c132db518d2b86","consumer":"helper implementation and protocol tests"},
  {"path":"zapret2-manager/src/z2m-core-helper/protocol.c","class":"helper-source","state":"EXACT","donorBlob":"b2661a3f8d78c05072d3bf6f7ad516e626b3375f","consumer":"native helper request dispatcher"},
  {"path":"zapret2-manager/src/z2m-core-helper/roots.c","class":"helper-source","state":"EXACT","donorBlob":"bbf8814f02f119d1fe4ae30de26dc97ea160c16d","consumer":"native helper root mapping"},
  {"path":"zapret2-manager/src/z2m-core-helper/sha256.c","class":"helper-source","state":"EXACT","donorBlob":"9081cf1960ffd549187f9b158a3637b3875ef8a1","consumer":"native helper hashing"},
  {"path":"zapret2-manager/src/z2m-core-helper/test-audit.c","class":"native-fixture","state":"EXACT","donorBlob":"b8f66d14aea4b4823b40d63e5c0956b437a0c2f8","consumer":"native atomic-write tests only"}
]
```
<!-- native-clean-final-ledger:end -->
