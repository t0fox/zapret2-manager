# Native State and Storage Foundation Design

Date: 2026-08-08
Status: approved for implementation
Starting main: `bb95ae4e67335ae3d418bf87d2077c5882282642`

## Goal

Turn the existing `z2m-core-helper` into the production storage foundation for
the native backend. Work proceeds as vertical milestone slices. Every slice
must be green before a dependent slice begins.

The target flow is:

```text
Linux-native tests
  -> managed-root bootstrap
  -> typed ucode helper adapter
  -> canonical atomic_write_json
  -> authoritative native state store
  -> legacy status compatibility adapter
  -> storage inventory
  -> one evidence-selected legacy migration
```

The frozen contracts remain authoritative:

- `docs/contracts/native-backend-v1.md`
- `docs/contracts/z2m-canonical-json-v1.md`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`

This work does not redesign DNS, Telegram, WARP, routing, or the UI.

## Baseline Evidence

The starting checkout is current `main` at
`bb95ae4e67335ae3d418bf87d2077c5882282642`. The initial native command ran
102 tests: 9 passed and 93 failed.

The dominant failures are test infrastructure defects rather than established
C defects:

- Native tests invoke `wsl.exe` from inside Linux and transform
  `/home/kirill/...` into invalid `/mnt//ome/kirill/...` paths.
- A protocol test requires removed historical design and plan files.
- A package test requires removed `tools/build-apk-manual.sh` content.

The missing historical files will not be restored. Tests will instead assert
the current production contracts, package Makefile, and installed artifacts.

The helper currently implements `stat_regular`, `read_regular`,
`mkdir_private`, `sha256_regular`, and `atomic_write`. `atomic_write_json`,
owned rename/unlink, and public lock operations remain reserved. No production
lifecycle hook currently creates all protocol-managed base roots.

## Milestone Gates

The required dependency order is strict:

```text
M1 Linux-native tests -> GREEN
M2 managed-root bootstrap -> GREEN
M3 ucode adapter -> GREEN
M4 atomic_write_json -> GREEN
M5 state store and its behavior tests -> GREEN
M6 status integration -> GREEN
M7 inventory and one selected migration
```

A milestone is green only after its focused tests and the shared native gate
pass. A fundamental contract or architecture contradiction blocks dependent
milestones; no new layer is built on a red foundation. Independent work may
continue when it does not rely on the blocked layer.

## Linux-Native Test Infrastructure

Production and native test files must not invoke `wsl.exe`, use Windows paths,
or assume `/mnt/<drive>`. Tests run directly under Linux using Node
`spawn`/`spawnSync`, environment variables, Linux filesystem paths, and process
signals.

Build and filesystem tests use a Linux-native workspace under `TMPDIR` or
`~/z2m-work`. Tests that specifically validate temporary or tmpfs behavior may
use real Linux `/tmp`. Root-required test processes may be launched through
`sudo`; helper calls are not individually hidden behind WSL or shell wrappers.

The existing security, race, crash, transport, and fault-injection coverage is
retained. Stale assertions about removed design plans and the removed manual
APK builder are replaced by assertions about current production sources and
package behavior, not skipped.

A single script under `scripts/test/` becomes the local and CI source of truth.
The workflow installs dependencies and invokes that script. It does not
duplicate test discovery or contract logic.

## Managed-Root Bootstrap

One production bootstrap program owns only the lifecycle and verification of
the protocol base directories. It does not own or mutate files below those
roots after bootstrap.

The exact roots come from `protocol-v1.json`:

- Persistent: `/etc/zapret2-manager/state`, `snapshots`, `registry`, `secrets`
- Runtime: `/tmp/zapret2-manager/runtime`, `jobs`, `locks`, `staging`

The bootstrap also verifies the required ancestors, including the special
protocol policy for `/tmp` and the private `/tmp/zapret2-manager` parent.

For every existing managed root, bootstrap requires:

- directory type;
- no symlink traversal;
- owner and group `root:root`;
- exact mode `0700`;
- no silent chmod, chown, replacement, or repair.

A missing root may be created as `root:root` mode `0700`. A correct existing
root is idempotent success. Any unsafe existing object fails closed and remains
untouched.

Persistent root bootstrap runs on live package install and upgrade. Startup
also verifies persistent roots, covering image installation and later damage.
Runtime roots are recreated or verified at the beginning of every service
startup, before the watchdog or backend can use them.

Both package and startup hooks call the same bootstrap implementation to avoid
policy drift. Shell hooks only sequence execution and propagate failure; they
do not contain permissive `mkdir/chmod/chown || true` policy.

## Typed Ucode Helper Adapter

`core/native-helper.uc` is the only backend boundary to
`/usr/libexec/zapret2-manager/z2m-core-helper`.

Its public exports are typed methods only:

- `stat_regular`
- `read_regular`
- `mkdir_private`
- `sha256_regular`
- `atomic_write`
- `atomic_write_json` after M4

A generic invoke function may exist only as a private implementation detail to
share transport and response validation. No caller can select an executable,
operation name, arbitrary command, or shell fragment.

The adapter uses a direct ucode process primitive with stdin/stdout pipes. It
does not construct `echo ... | helper` or place payload content on a command
line. Before implementation, tests and code must establish the actual ucode
process API available in the target environment. Payloads and secrets are not
logged.

Every response is bounded and validated for exactly one JSON document,
protocol version, exact request ID, boolean `ok`, exclusive success/error
member, required error metadata, and consistency with the helper exit category.
Empty output, malformed JSON, trailing output, partial output, timeout, wrong
identity/version, and envelope/exit contradictions are never success.

Production always uses the fixed binary. Tests may provide a narrowly scoped
fake-helper seam to generate transport and protocol faults; this seam must not
expose caller-selected production execution.

## Error and Uncertainty Model

Three outcome classes remain distinct.

### Helper Semantic Failure

The helper emitted a complete, valid protocol failure envelope consistent with
its exit category. Its `code`, `retryable`, `committed`, `durability`, `stage`,
and bounded details are preserved for mapping. `ECOMMITUNKNOWN` remains the
specific helper semantic result for publication that may be visible while
durability is unknown. It is never blindly retried.

### Proven Not Started

Caller validation rejected the request before invocation, or process creation
demonstrably failed before the helper started. Mutation did not start. This is
not commit uncertainty.

### Adapter Transport Uncertainty

After successful process start, a mutation may have begun. Empty, malformed,
truncated, contradictory, timed-out, or otherwise unverifiable output is an
adapter transport failure with unknown commit state unless evidence proves the
mutation could not start. It is not relabeled `ECOMMITUNKNOWN`; helper semantic
uncertainty and adapter transport uncertainty remain distinguishable.

Read-only calls map damaged transport to dependency/internal errors without a
commit dimension. Mutation callers receive enough structured evidence to
reconcile and must not automatically retry.

## Canonical atomic_write_json

`atomic_write_json` implements `z2m-canonical-json-v1` without changing the
contract for implementation convenience.

Its pipeline is:

```text
strict request/token validation
  -> canonical value-domain validation
  -> bounded canonical encoding
  -> existing atomic_write byte engine
```

Token validation occurs before json-c semantic construction wherever semantic
construction could erase required evidence. It rejects duplicate decoded keys,
float/exponent lexical forms, integer overflow, invalid UTF-8, invalid or lone
surrogates, trailing data, and unsupported values before filesystem mutation.

The canonicalizer implements recursive unsigned UTF-8 key ordering, preserved
array order, signed int64 values, `-0` normalization, raw valid non-ASCII UTF-8,
the specified control escapes, and every frozen resource bound. The canonical
buffer is complete before root locking, target traversal, candidate creation,
or publication.

There is no second publication implementation. The completed bytes are passed
to a shared `atomic_write_bytes()` engine that retains existing lock,
precondition, cleanup, race, fsync, and uncertainty behavior. The machine
protocol changes `atomic_write_json` from reserved to implemented only when
implementation and manifest parity tests pass.

## Authoritative State Store

`core/state-store.uc` stores one authoritative native backend document at
`persistent_state/manager-state.json`. It uses only typed native-helper methods
for managed storage and uses `atomic_write_json` for writes.

The store owns the frozen native backend envelope and its coordination
metadata: schema version, generation, timestamp, service state, runtime
ownership metadata, transactions, jobs, and warnings. It is not a general
feature-configuration database. DNS, Telegram, strategy, UCI, nftables, and
other feature configuration do not move into this file automatically.

Fresh runtime observations are composed for reads but are not persisted after
every observation. Observation alone never changes generation.

Initialization creates a valid schema-v1 state at generation zero when the
file is absent. Reads reject malformed JSON, unsupported schema versions,
oversized content, invalid field types, and invalid enums rather than silently
defaulting authoritative evidence.

Mutation is compare-and-swap against a required expected generation. A stale
generation returns conflict. A validated candidate carries exactly
`previous generation + 1`, but the in-memory authoritative generation is not
advanced until publication is confirmed or reconciled as visible.

### Mutation Reconciliation

Before writing, the store retains the previously confirmed canonical state and
its hash. It also canonicalizes the expected candidate and records its hash.

On helper `ECOMMITUNKNOWN` or adapter mutation transport uncertainty, the store
rereads the authoritative file and validates/canonicalizes it before deciding:

- Reread equals the expected candidate: the mutation is visible committed.
  The candidate generation is used exactly once and no write is retried.
- Reread equals the previously confirmed state: the mutation is not visible.
  The previous generation remains authoritative.
- Reread equals neither, is absent unexpectedly, or cannot be validated: return
  unresolved conflict/dependency failure. Do not retry blindly.

The expected previous generation and previous/candidate hashes are additional
evidence and are included in bounded internal error details where safe. They do
not replace exact canonical byte comparison.

## Legacy Status Compatibility

The current production collector emits schema 3 in `status.uc`; tests first
freeze the actual public status shape used by RPC/LuCI before integration.

The integration boundary is explicit:

```text
authoritative native state
  + fresh runtime observations
  -> legacy status compatibility adapter
  -> existing schema-3 RPC/LuCI response
```

The native state contract and legacy schema are not merged implicitly. The
compatibility adapter maps native authoritative fields and fresh observations
into the existing response without changing public UI/RPC behavior. At least
one production status read path must use the state store after M6. Existing
cache behavior may remain if it stores only the compatibility output and does
not become authoritative state.

## Storage Inventory and First Migration

Only after M1 through M6 are green, audit direct filesystem mutation and write
`docs/architecture/native-storage-migration.md`. Each writer is classified:

- A: manager state, future native state-store or purpose-specific native state;
- B: secret, secrets namespace;
- C: runtime/job, runtime or jobs namespace;
- D: external OpenWrt configuration owned by UCI/nft/DNS or another subsystem;
- E: legacy or dead.

The table records current writer, current path, ownership, target subsystem,
and migration priority.

No first consumer is selected in advance. Candidates are scored by manager
ownership, absence of secrets and external system mutation, small schema,
existing tests, blast radius, and clear rollback/compatibility behavior.
`engine-provider.json` is only a candidate.

One migration proceeds only when the inventory identifies a safe consumer. If
legacy import is required, the flow is validate legacy, write native, reread
and verify native, then consider migration successful. The source is not
deleted before verification. Public behavior remains unchanged.

## Testing Model

Every new behavior or bug fix follows RED, minimal implementation, focused
GREEN, then the shared native gate.

Bootstrap tests cover missing and correct roots, idempotence, exact mode and
ownership, symlinks, regular files, wrong ownership/mode, persistent lifecycle,
startup recreation, and proof that unsafe objects remain untouched.

Adapter tests cover typed argument validation, fixed executable behavior,
request framing, exact response count, every identity/version mismatch,
malformed and partial output, trailing output, timeout/process failure, all
exit/envelope contradictions, helper semantic `ECOMMITUNKNOWN`, and adapter
mutation transport uncertainty.

Canonical JSON tests use exact conformance vectors from the frozen contract,
filesystem no-side-effect assertions for validation failures, exact and
one-over output limits, depth/container/node/member/key limits, and bounded
properties:

```text
canonicalize -> parse -> canonicalize = identical bytes
object insertion permutation = identical bytes and SHA-256
```

State-store tests cover absent-state initialization and mode/root placement;
valid, malformed, oversized, wrong-type, and unsupported-version reads;
matching/stale generation; exactly-once increment; validation and write
failure; visible and non-visible uncertainty; and third-state unresolved
conflict. Fault injection includes publication visible followed by durability
or response uncertainty.

Status tests first snapshot the current schema-3 compatibility contract, then
prove the same public shape after native-state plus fresh-observation
composition.

The final native gate covers strict C compilation, helper tests, machine
protocol parity, canonical conformance, bootstrap, ucode adapter, state store,
status compatibility, touched regressions, and package metadata. OpenWrt SDK
build is reported separately and never claimed when the SDK is unavailable.

## Commit Decomposition

Commits remain small and milestone-aligned:

1. `test(native): make helper suite Linux-native`
2. `fix(package): bootstrap native managed roots`
3. `feat(core): add typed native helper adapter`
4. `feat(native): implement canonical atomic_write_json`
5. `feat(core): add native state store`
6. `feat(core): compose native state into legacy status`
7. `docs(native): inventory legacy storage mutations`
8. One migration commit only if an evidence-backed low-risk consumer exists

Before each commit, run `git diff --check` and the milestone's focused tests.
After each milestone, run the shared native gate. Do not commit unrelated
cleanup or speculative C refactoring.

## Completion Criteria

The work is complete when the shared Linux-native CI command passes the
implemented gates, production lifecycle creates/verifies all managed base
roots, backend code reaches the helper only through typed methods, canonical
JSON uses the existing publication engine, authoritative state provides
generation and uncertainty reconciliation, an unchanged legacy status path
consumes native state, and the inventory either supports one verified migration
or records a concrete evidence-based blocker.
