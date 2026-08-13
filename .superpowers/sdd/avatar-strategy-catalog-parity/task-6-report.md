# Task 6 Report: Compile Avatar Strategies Through Profiles

## Status

COMPLETE

## Scope

Implemented only the Task 6 compiler adapter, its focused product contract, and
the smallest pure round-trip hook needed to reuse the existing Profile renderer.
No plan, ledger, package asset, state, RPC, UI, or Apply transaction behavior
was changed.

## Compiler Contract

- Added `strategy_compile(strategy, environment)` to
  `strategy-compiler.uc`. It normalizes the Strategy through the existing
  Avatar model, keeps enabled Profiles in original order, and treats omitted
  `enabled` as true through the authoritative model.
- Disabled Profiles are removed before rendering. Adjacent enabled fragments
  are joined only by `profiles_render_candidate()` with the exact existing
  ` --new ` separator. Zero enabled Profiles return a successful empty
  structural result without invoking the non-empty Apply renderer.
- Avatar tokenizer values remain the source token stream. Canonical fragments
  are single-line, quote-preserving, and are checked with `z2m_parse()` and
  `z2m_validate()` before and after global declarations.
- Bare-trick autowrap matches the pinned cases: TLS client hello, HTTP request
  or reply, and QUIC initial payloads wrap only with Lua desync, no existing
  TCP/UDP/L7 filter, exact case-sensitive first payload, and no `all` or
  unknown payload wrapping.
- List injection is mode-driven and placed after the last filter and before
  the first payload. Existing hostlist/ipset/exclusion options suppress only
  their corresponding injected flags. Explicit missing paths do not invent a
  replacement.
- Catalog Blob declarations are added once before the first enabled fragment
  when metadata supplies a bounded native path. Repeated metadata or existing
  declarations do not duplicate the declaration.
- `@lua/`, `@bin/`, `lists/`, and `ipset` references resolve only through the
  supplied native roots. Missing roots preserve the original token instead of
  erasing it. Unknown options remain intact and Profile manager diagnostics are
  exposed.
- `dependencies` records bounded Blob/Lua availability and missing references.
  Missing dependencies keep the structural candidate inspectable and set
  `applicable: false`; they do not get silently removed or treated as native
  success.
- Added `strategy_candidate()` as the full candidate projection consumed by
  later server-side Apply work.
- Added `strategy_effective_argv()` as a pure composition path requiring the
  pinned engine and captured `source: 'live'` runtime inputs. It rejects
  client-composed `argv`/`command`, then combines live base args, Lua-init,
  hostlist inputs, and canonical Strategy tokens into one argv and shell command
  representation.

## Existing Renderer Boundary

`profiles-apply.uc` exports only `profiles_candidate_round_trip`, an alias of
its existing pure proof function. The compiler delegates full-set joining and
round-trip verification to that module. The transactional pipeline,
`profiles_apply_candidate`, CAS writes, preflight admission, restart, verify,
and rollback remain unchanged.

## Tests

RED evidence:

- `node --test tests/product/avatar-strategy-compiler.test.mjs` failed before
  implementation because `strategy-compiler.uc` was absent.

Focused GREEN command:

```text
node --test tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs tests/product/profiles-contract.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-catalog.test.mjs
```

Result: 64 tests passed, 0 failed.

Additional checks:

- `git diff --check`: clean.
- Duplicate-logic audit: compiler contains no `--new` join, filesystem write,
  Apply, or native-preflight call; only `profiles-apply.uc` owns full-set
  joining and transaction admission.

## Changed Files

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`
- `tests/product/avatar-strategy-compiler.test.mjs`
- `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`

## Concerns

- The effective command adapter is pure and guarded by live-input provenance,
  but the repository does not contain the upstream `/etc/init.d/zapret2`
  implementation itself. Later Preview work must supply its captured runtime
  composition inputs from the authoritative live path; it must not let a UI or
  RPC caller construct them.
- The compiler candidate digest now uses the exact SHA-256 of the rendered
  candidate, matching the existing Apply CAS hash. The compiler invokes only
  the existing text hashing utility path and does not write config or state.
- Dependency probing is intentionally bounded metadata inspection. Native
  preflight remains the only execution validity gate.

## Fix Round 1

The review follow-up closed the Important findings without changing the
Profile renderer or Apply transaction boundary:

- List suppression is independent: explicit hostlists, auto hostlists,
  ipsets, and exclusion flags no longer suppress unrelated injections. List
  placement remains after the last filter and before the first payload.
- Dependency collection now scans explicit hostlist/ipset options as well as
  Blob and Lua metadata, preserving missing references and setting
  `applicable: false` instead of silently treating them as available.
- Relative descriptor paths resolve only below the supplied native roots.
  Traversal, unsafe-character, and symlink-marked Blob/Lua/list descriptors
  are rejected without generating unsafe declarations; absolute list paths
  are accepted only through bounded descriptor metadata.
- `strategy_candidate()` now carries the canonical candidate, SHA-256 digest,
  `candidateSha256`, `expectedHash`, dependencies, applicability, and the
  compiled strategy args needed by later Apply work.
- Effective argv inputs retain live-runtime provenance checks, reject client
  `argv`/`command` composition, validate captured argument types, and shell
  quote every rendered argument.
- Regression coverage was added for each of the above paths, including an
  absolute `listPath`, relative list descriptors, malformed Blob paths,
  unsafe Blob sources, and symlink-marked metadata.

## Fix Round 1 Verification

- RED focused run: 5 new regression cases failed against the pre-fix
  implementation, confirming the reported defects were exercised.
- Focused compiler suite: 15 passed, 0 failed.
- Profile model and contract suites: 30 passed, 0 failed.
- Full product suite: 92 passed, 0 failed.
- `git diff --check`: clean.

## Fix Round 2

The second scoped review follow-up closed the remaining compiler findings:

- Invalid relative list and ipset resolutions now retain their original
  inspectable option values instead of concatenating `null`. Missing native
  roots remain unavailable and non-applicable through dependency metadata.
- Explicit list options do not receive trusted absolute-path treatment.
  Absolute and traversal references remain visible but cannot become
  applicable executable paths; trusted absolute descriptor resolution is
  limited to the environment-owned list selection path, and symlink-marked
  descriptors remain unavailable.
- Inline hexadecimal Blob declarations such as `name:0xA1B2C3` are admitted
  without catalog file descriptors. References to those inline names inherit
  the same inline availability during dependency collection.
- List injection is anchored to the first payload and only considers filters
  before that payload. A later filter cannot move injected lists after the
  payload.
- Added regressions for missing roots, unsafe explicit list options,
  symlinked descriptors, inline hex Blobs, and payload-before-later-filter
  placement.

## Fix Round 2 Verification

- RED focused run: 4 new regression cases failed against the pre-fix
  implementation.
- Focused compiler suite: 20 passed, 0 failed.
- Full product/Profile/catalog/model suite: 97 passed, 0 failed.
- Native package suites (`package-helper` and `avatar-strategy-package`): 46
  passed, 0 failed.
- `git diff --check`: clean.

## Fix Round 3

The third review round closes the scanner lifecycle, fixed-probe, recovery, and
request-boundary findings without expanding Task 6 scope:

- Claim publication now records the claimed identity before the first
  checkpoint. If that checkpoint fails before a record exists, the worker
  releases the marker directly from the retained claim identity, so no active
  scan is leaked.
- Active release is an atomic revision-checked transition to an explicit
  `absent` marker in the production native store and an unlink in the test
  store. Absent/released markers are idempotent and the next claim consumes the
  revision. Two sequential claims are covered.
- Stop control uses compare-publish with `allowCreate=true` and expected absent
  revision `-1` for first stop admission. Terminal stop retries reread the
  control and return the published terminal control idempotently.
- The production probe executor no longer fabricates status, body size,
  latency, mapped family, or success from an exit code. It uses only the fixed
  packaged `/usr/bin/ncat` primitive, parses actual HTTP response status/body
  bytes and elapsed time, parses STUN XOR-mapped IPv4 response data, enforces
  the outer descriptor deadline plus remaining per-host time, rejects caller
  executable/raw/path fields, and returns infrastructure/indeterminate for
  missing, malformed, or incomplete observations.
- Recovery and terminal finish merge evidence instead of replacing it. Active
  activation identity, candidate cleanup, session cleanup, lock release, and
  reconciliation evidence remain available together when recovery is uncertain.
- CLI request validation checks every fixed private ancestor for directory,
  ownership, mode, and no-symlink properties before opening the leaf, while the
  leaf remains no-follow and identity-checked.
- Runtime test seams remain gated by `Z2M_SCANNER_SERVER_TEST`; no permanent
  config, Strategy state, Task 5 restoration, Task 7 behavior, raw command,
  DNS/TG/router/LuCI/Orchestra behavior was added.

## Fix Round 3 Verification

RED evidence:

- The new claim-release, sequential-claim, real-observation parser, deadline,
  and evidence-retention tests failed against the round-2 implementation.
  The initial focused run also confirmed the environment lacked ucode on the
  Windows host; the pinned interpreter was built in WSL before rerunning.

GREEN and scope checks:

- Focused production-shaped Scanner worker suite under pinned ucode: **27
  passed, 0 failed**.
- `git diff --check`: clean.
- JavaScript syntax check for the changed test file: passed.
- Static forbidden-surface audit: changed Scanner state/worker/CLI/executor
  contain no `eval`, `system`, `nft flush`, Strategy state writer,
  Orchestra/DNS/LuCI/router/TG path, or caller-provided executable/raw argv
  execution.
- A broad product run was attempted under pinned ucode. It exceeded the
  120-second command bound. Isolated pre-existing Scanner model/target tests
  still fail on their existing invalid generated ucode call and null
  comparison; those files are unchanged. The full product sweep therefore is
  not claimed as complete.

## Changed Files Round 3

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`

## Concerns Round 3

- Physical-router network acceptance was not available in this workspace. The
  fixed executor is tested through strict production-shaped parser and
  deadline behavior, but live TLS/STUN reachability remains deployment
  dependent.
- The broad product suite remains time-bound and has unrelated baseline
  failures in `avatar-strategy-scanner-model.test.mjs` and
  `avatar-strategy-scanner-integration.test.mjs`; no changes were made to
  those failing modules.

## Fix Round 6

The sixth scoped review follow-up closes the native scanner and fixed-executor
findings while preserving the Task 4/5/7 boundaries:

- Native `scanner_probe` accepts only the server-owned fixed executable and
  validates the adapter digest, target-profile digest, canonical host and URL
  path, profile-owned TCP/UDP port ranges, modes, retries, TLS/body settings,
  markers, read limits, and the fixed STUN transaction ID. Caller executable,
  path, raw argv, forged URL/path, and forged transport settings are rejected
  before spawn.
- The scanner adapter derives ports and probe settings from the retained target
  profile instead of accepting caller-selected values. The protocol manifest,
  C registry, and native helper expose one closed `scanner_probe` contract with
  no filesystem root capability and no Task 5 operation changes.
- Native and ucode execution now preserve typed dependency and indeterminate
  failures. The worker stops with the executor's error instead of fabricating
  `NET_UNREACH`, `TIMEOUT`, or candidate evidence when the broker, child, or
  observation is unavailable.
- The request deadline is enforced through the ucode helper, native child
  runner, and per-operation remaining timeout. Native responses retain bounded
  start and finish timestamps, which are used for latency and throughput
  rather than wall-clock reconstruction in the parser.
- HTTP parsing rejects invalid or duplicate headers, invalid content lengths,
  unsupported transfer encodings, conflicting framing, malformed chunk
  extensions or trailers, truncated bodies, and non-canonical Content-Range
  evidence. Chunked trailers and exact range satisfaction are supported.
- STUN parsing requires the fixed Binding response and exact transaction
  identity. UDP descriptors remain IPv4/STUN-only with fixed retry and receive
  limits; incomplete or mismatched responses remain typed infrastructure or
  indeterminate outcomes.
- Native child supervision checks nonblocking setup, process-group creation,
  signal and cleanup errors, and `SIGPIPE`/`EPIPE` handling. It kills and reaps
  the fixed process group without extending the request deadline and retains
  deterministic failure state.

## Fix Round 6 Verification

- Focused native and product Scanner gate under pinned WSL ucode: **108
  passed, 0 failed**.
- Native scanner behavioral coverage: fixed argv/transport, profile authority,
  forged descriptor rejection, digest validation, child status, deadline
  cleanup, HTTP framing, STUN parsing, supervision, and protocol-manifest
  consistency all passed.
- Product Scanner coverage: adapter bounds and authority, parser and evidence
  validation, typed executor failures, worker lifecycle, cleanup/recovery,
  resume authority, and terminal stop idempotency all passed.
- `git diff --check`: clean.
- Changed JavaScript test syntax and protocol JSON parsing checks passed.
- The broader Scanner glob still contains pre-existing model/target failures
  in unchanged modules and is not claimed as a clean full-repository sweep.

## Changed Files Round 6

- `zapret2-manager/src/z2m-core-helper/scanner.c`
- `zapret2-manager/src/z2m-helperd/supervise.c`
- `zapret2-manager/src/z2m-core-helper/protocol.c`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- `tests/native/core/fs-helper-protocol.test.mjs`
- `tests/native/core/native-helper.test.mjs`
- `tests/native/core/scanner-probe-native.test.mjs`
- `tests/product/avatar-strategy-scanner-probes.test.mjs`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`

## Concerns Round 6

- Physical-router reachability and live TLS/STUN acceptance remain deployment
  dependent and were not available in this workspace. The fixed executor was
  verified through production-shaped native fixtures and strict parser,
  deadline, supervision, and typed-failure behavior.
- The repository's unrelated Scanner model/target baseline failures remain
  unchanged; the focused round-6 gate is the claimed verification boundary.

## Fix Round 7

The latest review follow-up closes the remaining Task 6 boundary findings while
keeping Task 7 and Task 5 explicit dependencies:

- Baseline adapter requests now carry the validated worker mode. Every native
  TLS, HTTP-body, and STUN request carries mode, retries, profile port range,
  native limits, and the outer deadline. Native helper requests are capped at
  the scanner operation input/output limits.
- Native validation recursively rejects unknown fields in the target profile,
  transport settings, request, TLS/body settings, markers, and candidate-free
  request shapes. A descriptor portRange must exactly equal the server target
  profile range; an merely in-range forged range is rejected.
- Typed helper, transport, child, and incomplete-observation failures remain
  dependency failures. They are not converted into unavailable observations or
  candidate evidence that lets the worker proceed.
- Per-probe metrics use native startedAt/finishedAt values. Worker results retain
  throughput, latency, success-rate, and native timing evidence.
- HTTP 204/205/304 no-body responses reject conflicting framing and body bytes;
  chunked trailers reject duplicate names. SIGPIPE is ignored only around the
  fixed child pump and restored afterward, including in the child.
- Missing Task 7 reconciliation is recorded as an explicit EDEPENDENCY recovery
  result. The worker never reports terminal completed/cancelled without the
  required verified provider and still performs session cleanup and active-marker
  release. Task 7 implementation remains absent.

## Fix Round 7 Verification

- Pinned WSL product Scanner gate: **61 passed, 0 failed**.
- Native scanner, protocol-manifest, and helper gate: **53 passed, 0 failed**.
- `git diff --check`: clean.
- Task 5 reserved operations retain `EUNSUPPORTED`; no Task 7 implementation,
  permanent config/Strategy state, raw command, DNS/TG/router/LuCI/Orchestra
  surface was added.

## Changed Files Round 7

- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- `zapret2-manager/src/z2m-core-helper/scanner.c`
- `tests/native/core/scanner-probe-native.test.mjs`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`

## Concerns Round 7

- Physical-router reachability and live TLS/STUN acceptance remain deployment
  dependent and were not available in this workspace.
- The broader repository still contains the previously documented unrelated
  Scanner model/target compatibility failures; this round claims only the
  focused native and product gates above.

## Fix Round 8

The latest Task 6 review fixes are applied without implementing Task 7 or
expanding the reserved Task 5 boundary:

- All server-owned UDP target profiles and planner fallbacks now use
  `transport: stun`, `l7: stun`, `payload: binding`, IPv4, the fixed Binding
  transaction ID, and the native adapter contract. No Scanner QUIC/HTTP3 probe
  exists; catalog Strategy tokens may still contain unrelated QUIC strategy
  data because Task 4 catalog/compiler semantics remain unchanged.
- HTTP parser EINDETERMINATE, malformed, truncated, child, supervision, and
  incomplete observation outcomes are returned as EDEPENDENCY and stop worker
  progression. They never become candidate failure rows or advance the cursor.
- Zero-chunk framing accepts only the terminal CRLF or valid unique trailers
  followed by exactly the final CRLF. Any bytes after termination are rejected.
- Baseline family observations and native helper observations require complete
  bounded status, byte, exit/signal, and monotonic timestamp evidence before
  classification or dereference.
- Session cleanup, checkpoint publication, active release, and worker exception
  paths retain explicit `Task 7 reconciliation` EDEPENDENCY evidence, publish
  non-terminal error/recovery state, and never silently bypass recovery.
- Native profile and nested candidate schemas require exact fields and reject
  arbitrary nested command, path, args, executable, or raw fields. The protocol
  manifest documents the closed candidate/profile shape.
- SIGPIPE restoration is checked for failure in native supervision and the
  source-level regression verifies that restoration is not ignored.

## Fix Round 8 Verification

- RED coverage was added for planner/adapter/native UDP agreement, post-zero
  chunk bytes, incomplete baseline evidence, nested candidate fields, and
  SIGPIPE restoration.
- Focused product Scanner gate under pinned WSL ucode: **45 passed, 0 failed**
  for characterization, integration, worker, and executor coverage.
- Focused planner gate: **38 passed, 0 failed**.
- Focused native helper/scanner gate: **46 passed, 0 failed**.
- Extended native protocol/helper/scanner gate: **55 passed, 0 failed**.
- `git diff --check`: clean.
- The broader Scanner model tests retain the previously documented WSL
  harness incompatibilities. The package byte-identity test retains its
  pre-existing mode baseline mismatch. Neither was changed by this fix round.

## Changed Files Round 8

- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- `zapret2-manager/src/z2m-core-helper/scanner.c`
- `tests/fixtures/avatar-strategy-scanner/targets.json`
- `tests/native/core/scanner-probe-native.test.mjs`
- `tests/product/avatar-strategy-scanner-characterization.test.mjs`
- `tests/product/avatar-strategy-scanner-planner.test.mjs`
- `tests/product/avatar-strategy-scanner-probes.test.mjs`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`

## Concerns Round 8

- Physical-router reachability and live TLS/STUN acceptance were not available
  in this workspace. `ROUTER_E2E: NOT RUN`.
- Task 7 reconciliation implementation remains intentionally absent; the
  worker records it as an explicit dependency and refuses terminal success
  without a verified provider.
- Task 5 reserved operations remain EUNSUPPORTED. No permanent Strategy/config
  writer, raw command, DNS/TG/router/LuCI/Orchestra implementation was added.

## Latest Task 6 Review Fixes

The final review follow-up closes the remaining Important findings without
expanding the Task 5 or Task 7 boundaries:

- Generic target profiles now include the validated target as a server-owned
  test host. Planner authority rejects an empty generic test-host list before
  the worker can start.
- UDP adapter descriptors preserve exact server-owned ranges such as
  `50000-65535` while selecting only a fixed server-owned endpoint; callers do
  not choose arbitrary ports.
- Worker result rows retain verdict score, latency, throughput, per-probe
  timestamps, bytes, and marker evidence. No default score is synthesized.
- Stop admission publishes an id-scoped cancellation token. Native supervision
  checks that owned token during the active probe, terminates the process group,
  and reaps the child within the bounded deadline.
- Terminal checkpoint failure releases the active marker using retained claim
  identity and keeps Task 7 reconciliation evidence even if no record was
  successfully published.
- Baseline classification requires bytes, exit code, signal, and monotonic
  start/finish timestamps at the classifier boundary; missing evidence is a
  typed dependency result.
- Protocol-v1 nested scanner profile, transport, request, and candidate schemas
  are explicitly closed with `additionalProperties: false` and exact fields.
- SIGPIPE restoration failures are handled on child and all early native paths.

Focused latest verification:

- Product Scanner worker/probe/integration suites: **72 passed, 0 failed**.
- Native helper/protocol/scanner suites: **56 passed, 0 failed**.

Task 5 remains `EUNSUPPORTED` for production compare-delete. Task 7 remains a
non-terminal reconciliation dependency. No permanent config/Strategy/raw
command/DNS/TG/router/LuCI/Orchestra behavior was added.
