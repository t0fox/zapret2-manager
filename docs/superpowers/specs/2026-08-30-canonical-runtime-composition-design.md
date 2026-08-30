---
id: z2m-canonical-runtime-composition-design
title: "Canonical Runtime Composition and Resource Ownership"
type: spec
status: review
authority: approved-design
implementation: not-authorized
updated: 2026-08-30
publish: false
tags: [z2k, asset-registry, runtime-ownership, preflight, scanner, postflight]
---

# Canonical Runtime Composition and Resource Ownership

## Decision status

The architectural direction and the amendments in the approved design review
are accepted. This document records the written design for a separate spec
review. It authorizes documentation only. Production code, tests, package
metadata, runtime files, and deployment are not changed by this spec.

Implementation planning starts only after this written spec receives a
separate user approval. The implementation phase must use
superpowers:writing-plans and then baseline/TDD execution.

## Problem and evidence

The current runtime composition has several consumers that each carry part of
the runtime contract:

- native preflight has a static RUNTIME_LUA_FILES list;
- the shell runtime synchronizer has a different hard-coded LUAOPT order;
- scanner adaptation has another hard-coded Lua list;
- package synchronization can copy package Z2K Lua files when a lifecycle
  activation snapshot is absent;
- install proof and postflight do not yet prove that the running process uses
  the exact selected Registry closure;
- strategy validation can prove that a file exists without proving that its
  function/provider and auxiliary assets belong to the selected runtime
  snapshot.

This has already produced two concrete classes of failure:

1. The target Registry can be at r-80.3 while the running nfqws2 command line
   still contains a removed z2k-detectors.lua path.
2. Running package synchronization against a runtime without an activation
   snapshot can resurrect z2k-detectors.lua from package bytes, even though
   that lifecycle-managed asset is absent from the selected Registry closure.

The filesystem alone is therefore not evidence that the process uses the
current release. A package copy, a Registry row, a preflight list, and a
running process must be tied to one content-bound runtime snapshot.

The existing mutation path remains authoritative: fresh manifest resolution,
target validation, plan-token/check gates, immutable asset fetches, Registry
activation, postflight, and rollback. This design removes duplicated
composition decisions without weakening that path.

## Scope

### First-phase scope

This design covers:

- one canonical runtime composition resolver;
- package synchronization and package-resurrection prevention;
- native preflight against the selected snapshot;
- scanner/install-proof/postflight consumption of that snapshot;
- exact running-process closure and order verification;
- snapshot identity and compare-and-swap protection at Apply.

### Explicit non-goals

This phase does not:

- change the Global Update Source contract;
- change BROWSE, REFRESH, or FRESH semantics;
- create a second Registry, updater, receipt store, or cache;
- change the backend update transaction, plan-token semantics, staging, SHA
  verification, rollback ownership, or Asset Registry authority;
- redesign Strategy IDE or frontend behavior;
- fix Discord or autocircular runtime behavior;
- make a package fallback authoritative;
- add new upstream requests to resolve local runtime composition.

The separate acceptance flow for normal Strategy -> Autocircular -> Discord is
future work and is not a gate for this phase.

## Runtime ownership vocabulary

### Resolver lifecycle inputs

There is one resolver and one composition semantics, but it has two
authority-safe lifecycle entry points:

1. resolveInstalled() accepts only a confirmed activation receipt and a
   matching Asset Registry. It resolves the currently installed runtime
   identity and its expected closure.
2. resolveCandidate(preparedTarget) accepts only the FRESH-verified prepared
   target. The candidate input is bound to targetVersion, targetCommit,
   manifestSha256, classificationSha256, target assets and removals, and the
   existing planToken/content identity. A candidate is not required to have an
   installed receipt because it describes the expected target before
   activation.

Both entry points delegate to one pure composition function after validating
their lifecycle-specific authority. They do not represent two sources of
truth: installed state comes from the confirmed receipt/Registry, while
candidate state comes from the FRESH prepared target. Candidate promotion to
installed authority happens only after successful activation and postflight.

resolveInstalled() and resolveCandidate() return an expected closure even
when the runtime filesystem or process is currently missing or stale. Runtime
evidence is checked by the separate verification operations below. Authority,
receipt, target, or content identity inconsistency still fails resolution
closed.

### Authorities

The following authorities remain the only sources for their respective facts:

- The confirmed installed identity is read from the existing Registry/receipt
  lifecycle, including installed release, authority/provenance, Registry
  revision, source commit, manifest identity, and complete asset membership.
- The Asset Registry is the authority for lifecycle-managed materialized
  content, content SHA-256, byte size, runtime target, and Registry revision.
- The authoritative manifest and classification are the authority for
  upstream membership, source paths, asset roles, runtime targets, and
  provider metadata.
- The existing FRESH mutation resolver is the authority for preparing a
  mutation. A presentation/BROWSE result can never authorize Apply.
- The canonical runtime resolver defined below is the only authority for
  composing and ordering the runtime closure consumed by production,
  preflight, scanner, install proof, and postflight.

No consumer may infer lifecycle ownership from package presence, filesystem
existence, a stale receipt, a stale generated file, or a locally copied array.

### Closures

The canonical result does not use one undifferentiated base field. It exposes
these distinct collections:

1. runtimeAssets[] is the complete selected runtime inventory for the
   consumer's production closure: package-owned Engine/Manager assets plus
   selected exact-managed Z2K assets. It includes Lua, blobs, hostlists,
   ipsets, binaries, and other approved runtime assets.
2. luaInit[] is an ordered subset of runtimeAssets[] containing only Lua
   entries that may be emitted as --lua-init. A blob, list, ipset, binary,
   config, or scanner helper can never enter luaInit[].
3. dependencyIndex maps explicit Strategy/runtime references to entries in
   runtimeAssets[] and records their content-bound identity. It is an
   index, not an independently maintained provider/order list.
4. scannerOverlay[] is a separate, explicitly non-production collection
   for scanner diagnostics. It is not included in runtimeAssets[] or
   luaInit[].

Every entry has an explicit kind and type, at minimum:

~~~text
kind: lua | blob | hostlist | ipset | binary | config | other
type: package-static | lifecycle-managed | bootstrap | scanner-overlay
~~~

The normal production invocation is generated only from luaInit[]. Native
preflight receives the same runtimeAssets[] and luaInit[] plus the strategy's
resolved dependencies. Install proof and running-process postflight verify
the installed/candidate runtimeAssets[] and luaInit[]. The scanner receives
the same runtime collections plus scannerOverlay[].

The overlay boundary is explicit in the resolver result. A scanner or
preflight consumer must not persist its overlay as a production selection.
Scanner-only Lua must not enter the production --lua-init invocation.

## Content-bound snapshot contract

Every resolver result is a snapshot, not a live union of all current Registry
rows. Every resolver result is bound to exactly one validated lifecycle authority:
a confirmed installed identity or a FRESH prepared candidate, and one exact
membership. The minimum result shape is:

~~~text
{
  schemaVersion,
  snapshotId,
  state: installed | candidate,
  compositionStatus: canonical | incomplete,
  authority: {
    kind: installed | candidate,
    installed: {
      release,
      authority,
      registryRevision,
      receiptId,
      sourceCommit,
      manifestId,
      manifestSha256,
      classificationId,
      classificationSha256
    },
    candidate: {
      baseRegistryRevision,
      targetVersion,
      targetCommit,
      manifestSha256,
      classificationSha256,
      assets,
      removals,
      planToken,
      contentIdentity,
      committedRegistryRevision: null | revision
    }
  },
  membershipDigest,
  runtimeAssets: [entry...] | absent,
  luaInit: [luaEntry...] | absent,
  dependencyIndex: { reference: dependency... },
  scannerOverlay: [entry...],
  legacyMembership: [record...] | absent,
  strategyDependencies: [dependency...],
  warnings: [warning...],
  blockingReasons: [reason...]
}
~~~

Each runtime entry is content-addressed and must include, at minimum:

~~~text
{
  id,
  owner,
  role,
  sourcePath,
  runtimeTarget,
  contentSha256,
  byteSize,
  runtimeOrder,
  kind,
  type
}
~~~

For an installed result, only the installed authority branch is populated. For
a candidate result, only the FRESH prepared-target branch is populated; an
installed receipt is not required. baseRegistryRevision is the pre-mutation CAS
prerequisite. committedRegistryRevision is null while the candidate is being
prepared and is populated only with the exact revision returned/observed from
that candidate's own successful bundle commit. It is transaction evidence, not
part of the candidate's semantic snapshot identity.

The snapshotId is a deterministic serialization/fingerprint of the populated
lifecycle authority, Registry/target identity, manifest/classification
identities, complete selected membership, entry content identities, and
canonical luaInit order. For a candidate, its semantic snapshotId includes
baseRegistryRevision and target content identity but deliberately excludes the
expected revision transition caused by its own bundle commit. After commit,
the same candidate snapshotId is verified against committedRegistryRevision
and then promoted to an installed snapshot whose authority is bound to that
committed revision. Snapshot identity must not include UI state, process IDs,
timestamps, or an arbitrary filesystem listing. The membership digest is
likewise deterministic and content-bound.

A resolver result is invalid when any of these conditions holds:

- an installed result has a missing, incomplete, or inconsistent receipt;
- an installed receipt authority, source commit, manifest, classification, or
  membership does not match the Registry evidence;
- a candidate has a missing/invalid prepared target, FRESH identity,
  planToken/content identity, target membership, or removals;
- an installed Registry/receipt membership entry is absent, has a mismatched
  SHA/size, has a wrong runtime target, or is an extra lifecycle asset not
  authorized by the snapshot;
- a target contains an unknown or unclassified upstream asset;
- an entry lacks a valid owner, role, runtime target, content identity, or
  canonical order;
- the result would need package bytes as a substitute for a selected
  lifecycle-managed entry.

Unknown or inconsistent authority is FAIL CLOSED. It is never converted to a
valid package baseline or a successful active Z2K closure.

Missing or mismatched files in the runtime filesystem are not resolver
authority failures. They are expected-closure verification failures and are
reported by verifyMaterialized(snapshot).

## Installed receipt evolution and legacy reconciliation

The current asset-activation-receipt.v1 records useful Registry/asset
provenance, but it is not an authority for manifestSha256 or
classificationSha256. The new resolver must not infer those historical
identities from the current mutable package classification.

Successful activation promotes the verified candidate into an immutable
installed authority. The next receipt revision, v2, records at least:

- installed release/target version and target commit;
- activation identity and Registry revision;
- manifest ID and manifestSha256;
- classification ID and classificationSha256;
- immutable references to the exact manifest and classification snapshots used
  for the activation;
- membership digest;
- complete asset entries with id, owner, role, kind, type, sourcePath,
  runtimeTarget, contentSha256, byteSize, and runtimeOrder;
- historical activation process evidence (activation PID/starttime or
  equivalent, candidate config hash, argv, runtime hashes, and readiness).
  This evidence is not the persistent installed authority and is not required
  to equal the PID/starttime of a later steady-state process.

The manifest and classification references are content-addressed immutable
activation evidence. A later update to the package's mutable classification
cannot reinterpret an already installed release. resolveInstalled() reads the
v2 receipt and its immutable references, then matches every recorded entry to
the current Registry before composing the expected closure.

Promotion order is strict: the FRESH prepared target and its candidate
closure are activated, materialized, and postflight-verified first; only then
is the v2 installed authority committed atomically with the matching Registry
revision and membership digest. A failed postflight cannot promote a
candidate.

### V1_VERIFIED_MEMBERSHIP

An existing asset-activation-receipt.v1 can establish only this explicitly
limited legacy state:

~~~text
V1_VERIFIED_MEMBERSHIP {
  receipt membership matches Registry,
  trusted: version, sourceCommit, contentSha256, byteSize, sourcePath,
  compositionMetadata: incomplete,
  reconciliationRequired: true
}
~~~

V1 does not prove every role, runtimeTarget, runtimeOrder, or historical
classification identity required for a canonical runtimeAssets[]/luaInit[].
resolveInstalled() therefore returns compositionStatus=incomplete with
legacyMembership[] and does not claim complete runtimeAssets[] or luaInit[].
It must not invent missing order/role/classification semantics from the
current mutable package classification.

Existing v1 routers have a managed compatibility path:

1. v1 is accepted only as V1_VERIFIED_MEMBERSHIP when its recorded
   membership/provenance matches the Registry. No package fallback or guessed
   composition is allowed.
2. Before reconciliation, the following remain allowed: read-only status,
   receipt/Registry inspection, raw recorded path/SHA/size verification that
   does not require composition, and observation/continued use of an already
   active service when the existing service owner can safely leave it running.
   These operations must report the incomplete legacy state rather than claim
   canonical installed readiness.
3. Before reconciliation, the following block with
   RECONCILIATION_REQUIRED: Z2K materialization or activation, restart/reload
   that needs a newly composed luaInit[], native preflight, Strategy Apply,
   Z2K update/rollback, package synchronization that could activate lifecycle
   Z2K bytes, and install/process proof that requires canonical
   runtimeAssets[]/luaInit[].
4. An explicit reconciliation operation obtains the exact immutable historical
   manifest/classification through the existing authoritative update path,
   compares version/sourceCommit, target membership, paths, SHA values, roles,
   runtime targets, and order with the v1 receipt plus Registry, builds the
   canonical composition, and atomically promotes a v2 receipt only on exact
   proof.
5. If exact evidence is unavailable or mismatches, the state remains
   V1_VERIFIED_MEMBERSHIP with reconciliationRequired=true and the specific
   RECONCILIATION_REQUIRED error for blocked operations. The router is not
   silently converted to permanent unknown, and no package bytes are activated
   to escape the state.

This migration is one controlled authority upgrade, not a second receipt
store. Once v2 exists, its immutable references are the historical authority
for resolveInstalled().

## Canonical resolver and interface

### Single implementation authority

The implementation will introduce one UCode resolver module,
runtime-composition.uc, as the sole implementation authority for runtime
membership, roles, dependency indexing, and order. A bounded JSON CLI wrapper,
runtime-composition-cli.uc, will expose the same resolver for shell consumers.
These names are the planned interface names; an implementation plan may
refine file placement without changing the contract.

The resolver is pure with respect to runtime composition:

- it reads the existing Registry, receipt, manifest, classification, and
  static package baseline;
- it performs no upstream network request;
- it mutates no Registry, receipt, package, runtime, or process state;
- it returns a bounded structured result or a blocking error;
- it emits one ordered entry sequence, rather than one sequence per consumer.

The static package contract is represented once as resolver input. For an
installed state, dynamic Z2K membership and composition metadata come from
the confirmed v2 Registry/receipt and its immutable classification snapshot.
For a candidate state, they come from the FRESH prepared target and its
content-bound classification snapshot. Dynamic managed entries carry their
canonical runtimeOrder in that validated lifecycle input. A classified entry
with no valid order is REVIEW REQUIRED, not arbitrarily appended. Thus
classification data supplies validated metadata, while the resolver remains
the only code that interprets and emits the order. A legacy v1 result never
uses the current mutable package classification to fill missing facts.

Future classified additions become automatic for every consumer: once an
upstream asset is explicitly classified, assigned an owner/role/runtime
target/order, and is present in the confirmed membership, the resolver emits
it for all applicable consumers. No native-preflight, shell, scanner, or
install-proof source list is changed for that release. An unknown asset
remains REVIEW REQUIRED and blocks a valid closure.

### Consumer integration

The interface contract is:

~~~text
runtime-composition.uc.resolveInstalled()
  -> runtimeAssets, luaInit, dependencyIndex, scannerOverlay, snapshotId

runtime-composition.uc.resolveCandidate(preparedTarget)
  -> runtimeAssets, luaInit, dependencyIndex, scannerOverlay, snapshotId

runtime-composition.uc.resolve({consumer:"native-preflight",
                                strategy:<validated strategy>})
  -> runtimeAssets + luaInit + strategyDependencies

runtime-composition-cli.uc --json --consumer=scanner
  -> runtimeAssets + luaInit + scannerOverlay

runtime-composition-cli.uc --json --consumer=install-proof
  -> runtimeAssets + luaInit + snapshotId

runtime-composition-cli.uc --json --consumer=postflight
  -> runtimeAssets + luaInit + snapshotId + process-match requirements
~~~

The shell runtime synchronizer invokes the bounded CLI once for the applicable
installed or candidate lifecycle state, validates the snapshot and result
state, and builds its --lua-init invocation directly from the returned ordered
luaInit. It does not contain a Lua array, path list, fallback sort, or
existence-based append logic.

Native preflight imports the same UCode resolver module and receives the same
runtimeAssets and ordered luaInit; it then asks that resolver to resolve the
concrete Strategy dependency references. It does not reconstruct the order
from a manifest or package directory.

Scanner invokes the same CLI result and appends only the returned scanner
overlay to its diagnostic invocation. The scanner overlay is marked
non-production in the result and is never copied into the Registry selected
membership or production --lua-init.

Install proof and postflight consume the same resolver result. They verify the
result and runtime evidence; they do not create a second list or a second
composition algorithm.

Any generated invocation input or persisted closure must contain snapshotId,
membership digest, and the complete ordered entry identities. For an installed
result, its Registry revision must continue to match the installed authority.
For a candidate result, the recorded baseRegistryRevision is only the
pre-commit CAS prerequisite. A candidate closure is invalid before commit
when the current Registry revision differs from baseRegistryRevision.
The expected N-to-N+1 transition caused by its own bundle commit does not
invalidate the candidate semantic snapshot. The commit's returned
committedRegistryRevision is captured, the committed membership is verified
against the candidate, and only then is the candidate re-bound to the
installed authority at that committed revision.

### Expected closure versus runtime verification

Resolution and verification are separate operations with separate failure
contracts:

1. resolveInstalled() or resolveCandidate(preparedTarget) computes the
   expected content-bound closure from lifecycle authority. It does not require
   runtime files or a running process to exist.
2. verifyMaterialized(snapshot) compares the expected runtimeAssets[] and
   luaInit[] with materialized files, ownership, SHA-256, byte size, runtime
   target, and generated invocation input. Missing or mismatched runtime
   content is a verification failure, while the expected closure remains
   available for materialization.
3. Process verification compares the expected luaInit[] with the owned process
   argv, process generation, runtime hashes, and active configuration.
   Activation uses verifyActivationProcess(candidate,
   activationEvidence); steady state uses
   verifyInstalledProcess(installedSnapshot). A stale process is a
   verification failure even when its paths happen to match.

Authority/receipt/target inconsistency is a resolution failure and must fail
closed. Runtime file/process mismatch is a verification failure and must not
be misreported as an authority failure or used to produce a different
expected closure. Materialization consumes the expected candidate closure,
then calls both verification operations at their lifecycle boundaries.

## Package baseline and resurrection contract

Package synchronization may install only:

- Engine/package static assets;
- Manager sidecars that are explicitly package-owned;
- explicit bootstrap assets that are not lifecycle-managed Z2K membership.

It must not materialize, restore, or use as a fallback any lifecycle-managed
Z2K exact-managed asset. In particular, the package copy of
z2k-detectors.lua cannot become active merely because the Registry has no
current activation snapshot.

The package synchronizer has three distinct outcomes:

1. static-ready: static package assets are valid and no lifecycle-managed Z2K
   authority is required for this operation.
2. dynamic-ready: a valid resolver snapshot was supplied and the Registry
   overlay/materialization matches it.
3. blocked-unknown-authority: lifecycle-managed Z2K state is expected but
   receipt/Registry authority is missing or inconsistent. No package fallback
   is permitted; activation and success are blocked.

An adapter result equivalent to {ok:true, skipped:true} for unknown authority
is not an active-success result and must not be interpreted by the operation
worker as permission to leave package Z2K bytes in service. If existing
lifecycle bytes are present while authority is unknown, the system must fail
closed and prevent activation; it must not silently bless, replace, or report
those bytes as selected. Cleanup/remediation follows the existing safe
lifecycle boundary and is not delegated to package fallback.

The package baseline verification contract must therefore verify ownership,
not only file existence. A package-owned file and a lifecycle-managed file
with the same basename are different authorities.

## Mutation, snapshot CAS, and lifecycle boundary

The existing mutation flow remains:

~~~text
FRESH manifest/target resolution
  -> target validation
  -> planToken/check gates
  -> resolveCandidate(preparedTarget)
  -> snapshot-bound prepare
  -> immediate current Registry revision == baseRegistryRevision CAS
  -> immutable asset fetch and SHA verification
  -> asset_registry_apply_bundle
  -> capture committedRegistryRevision
  -> verify committed Registry exactly equals candidate membership
  -> runtime materialization/activation
  -> activation process postflight
  -> promote candidate to v2 installed authority at committedRegistryRevision
  -> success or rollback
~~~

The resolver is added as a composition gate inside this flow, not as a
replacement for FRESH resolution.

Prepare persists the complete candidate identity needed for Apply:

- candidate snapshotId;
- targetVersion and targetCommit;
- target manifestSha256 and classificationSha256;
- target assets/removals;
- Registry revision;
- planToken/content identity;
- membership digest;
- ordered entry identities and content SHA-256 values;

Immediately before Apply, the system calls resolveCandidate() from the
current FRESH prepared target and compares the persisted candidate identity
and all content-bound fields. It then performs the immediate pre-commit CAS:
current Registry revision must equal baseRegistryRevision. If the Registry
revision, prepared target, manifest/classification identity, target
membership, planToken, content SHA, or order differs before the bundle commit,
Apply returns ESTALE/equivalent and performs no activation. The successful
bundle commit is expected to advance the Registry revision; that own
N-to-N+1 transition is not an ESTALE. The returned committedRegistryRevision
is captured and the resulting Registry membership is compared exactly with
the candidate before materialization. A presentation cache or a stale
generated closure cannot satisfy this compare-and-swap gate.

After a successful Registry commit and activation, activation postflight must
verify the candidate snapshot. Only after postflight succeeds is the candidate
promoted to the new installed receipt/authority bound to
committedRegistryRevision. A mutation cannot report success based only on
files written or Registry rows updated.

On postflight failure, the existing rollback authority is used. Rollback must
restore the previous Registry/runtime/config/process state and then verify the
previous content-bound snapshot. If rollback verification fails, the result is
an explicit rollback failure, never a successful or partially-authorized
activation.

## Native preflight and Strategy dependencies

Native preflight must validate the concrete Strategy against the same
runtimeAssets[] and ordered luaInit[] selected for runtime. It must resolve,
at minimum:

- explicit lua-init references through snapshot entries;
- Lua-init dependency order;
- referenced blobs, hostlists, ipsets, and other list assets through snapshot
  entries;
- each dependency's Registry/content identity, runtime target, and ownership;
- strategy-specific runtime requirements that are not part of the base closure.

Static Lua function/provider metadata is not a correctness authority. Optional
provider metadata may be used for diagnostics only when it is
content-bound/derived from the selected snapshot. It must not require a
manually synchronized consumer map when exports in an existing Lua file
change.

Correctness is established by the exact native preflight command using the
exact selected luaInit[] and dependency closure. A removed provider, an
unselected explicit reference, or a mismatched dependency must make that
exact command fail, even if a package or stale filesystem copy happens to
exist. The resolver may use dependencyIndex to explain the failure, but
native preflight remains the final proof of Lua function existence and
compatibility.

The native command line used for the dry-run is generated from resolver
luaInit[]. Preflight must not add scanner-only assets and must not silently
add a package file to make a missing dependency pass.

## Process proof

The success invariant is:

~~~text
selected resolver runtimeAssets[]/luaInit[]
  == materialized runtime closure
  == running process argv closure
~~~

### Activation process proof

Activation uses verifyActivationProcess(candidate, activationEvidence). It
requires all of the following:

- the process was created/restarted for this activation;
- the candidate active-config hash is the one observed by the process;
- the candidate luaInit[] is present in the exact argv order;
- every candidate runtime asset has the expected runtime hash;
- queue/runtime readiness is owned by the activated process/runtime.

The activation proof sequence is:

~~~text
materialize candidate runtimeAssets[]
  -> verify materialized runtime SHA-256 and ownership
  -> generate active config from candidate luaInit[]
  -> hash active config and record activation evidence
  -> restart/reload as required
  -> observe a process created for this activation
  -> verify argv luaInit order
  -> verify runtime file hashes
  -> verify active config hash and generation
  -> verify queue/runtime readiness
~~~

The activation process evidence includes the observed PID/starttime (or
equivalent process-creation evidence), candidate snapshot identity, active
config hash, runtime hashes, argv, and readiness evidence. An old PID cannot
pass activation proof. It must detect and fail on:

- a removed Lua path still present in the old argv;
- a selected Lua entry absent from argv;
- wrong order;
- wrong runtime target, SHA, or ownership mapping;
- an old configuration or runtime generation;
- a process that predates the activation and was never restarted/reloaded;
- stale helper/process evidence that does not match the active snapshot.

Generation is evidence derived from the snapshot, active config hash, process
creation/start evidence, and observed process/runtime state. It is not a new
source of truth or an independently editable authority. The activation
boundary records enough evidence to correlate the process with this
activation; verifyActivationProcess verifies that correlation. If the runtime
closure changes, the old nfqws2 PID/generation cannot pass, even when all argv
paths and their order happen to look identical.

The regression case “old argv contains removed Lua while new target does not”
must fail activation proof and trigger rollback or an explicit failed
activation. Successful activation must prove the removed path is absent from
the running argv.

### Installed steady-state process proof

After candidate promotion, verifyInstalledProcess(installedSnapshot) is the
steady-state proof. It verifies the current process against the same installed
snapshot:

- current materialized runtime hashes and ownership;
- active config hash and composition;
- argv luaInit[] membership and order;
- queue owner and runtime readiness.

It deliberately permits a legitimate later service restart, router reboot,
new PID, or new process starttime. It does not require the activation PID or
activation starttime stored in the receipt to equal the current process. The
original activation PID/starttime and activation generation remain historical
evidence only; they are not persistent installed authority.

A current PID with stale config, stale runtime hashes, stale luaInit order,
wrong snapshot/composition, or missing readiness fails
verifyInstalledProcess(). A new PID is accepted only when its current
runtime/config/process evidence matches the same installed snapshot.

## Strategy Apply snapshot CAS

strategies_validate is a validation/diagnostic RPC. Its result is never
mutation authorization and a client-supplied snapshotId is never trusted as a
server authority.

strategies_apply must execute the following server-side sequence:

1. call resolveInstalled() and retain the complete installed snapshot identity;
   if compositionStatus=incomplete for V1_VERIFIED_MEMBERSHIP, return
   RECONCILIATION_REQUIRED before attempting Strategy mutation;
2. compile the candidate Strategy;
3. run complete native preflight against that exact installed
   runtimeAssets[]/luaInit[] and explicit dependency closure;
4. immediately before profiles_apply_candidate(), call resolveInstalled()
   again and compare Registry revision, receipt identity, membership digest,
   content identities, order, and composition snapshotId;
5. call profiles_apply_candidate() only when the compare succeeds.

If the Registry, receipt, content, or composition changed between the first
resolution/preflight and the final compare, strategies_apply returns
ESTALE/equivalent and does not call profiles_apply_candidate(). A stale
client-supplied snapshotId cannot bypass this server-side re-resolution.
The same rule applies when a Strategy change causes a new explicit dependency
closure: the final native preflight and CAS must use the same installed
snapshot.

## Scanner boundary

Scanner and production share exactly the same resolver-produced
runtimeAssets[] and luaInit[]. The scanner may receive a separate diagnostic
overlay for scanner-only instrumentation or helper Lua. The overlay:

- is explicit and ordered by the resolver;
- is not part of runtimeAssets[] or luaInit[];
- is not written to the production Registry membership;
- is not emitted into production --lua-init;
- is not used to authorize a mutation;
- must not hide a missing production dependency.

The comparison test is structural: scanner runtime entry IDs/order/content
identities must equal the normal production runtime entries, while scanner
overlay entries must be absent from runtimeAssets[] and luaInit[].

## Failure and safety semantics

The following states are blocking:

- unknown or inconsistent installed authority;
- unknown upstream classification;
- incomplete/mismatched receipt or Registry membership;
- snapshot/CAS mismatch;
- missing or mismatched runtime content;
- unresolved exact Strategy dependency/native preflight failure;
- package fallback required to form the selected closure;
- process argv/config/generation mismatch after activation;
- failed rollback verification.

No blocking state may be downgraded to warning merely to keep the service
running with an unproven closure. UI/reporting may describe the reason, but
the mutation and success boundaries remain fail-closed.

## Test-driven implementation matrix

The implementation must begin with RED regressions derived from this design.
Existing tests that assert duplicated static lists or direct source snippets
must be replaced with behavior/contract assertions, not made green by
preserving the duplicated architecture.

### Core resolver and authority

1. A confirmed receipt/Registry/manifest with one exact membership produces
   one deterministic snapshotId, one membership digest, and one ordered
   runtimeAssets[] plus its Lua-only luaInit[] subset.
2. Missing, incomplete, mismatched, extra, or stale receipt/Registry evidence
   fails closed and never falls back to package membership.
3. An unknown upstream asset blocks the snapshot as REVIEW REQUIRED.
4. Reordering or changing any entry content changes the snapshot identity.
5. A generated closure from Registry revision N is rejected after revision N+1
   before Apply with ESTALE; no Apply/activation occurs.
6. A prepared candidate resolves its expected closure without an installed
   receipt, while resolveInstalled() rejects an unconfirmed installed state.
7. A missing or mismatched runtime file leaves the expected candidate closure
   available, but verifyMaterialized() fails.
8. A blob, hostlist, ipset, binary, or config entry never appears in luaInit[].

### Required amendment matrix

| Case | Setup | Expected result |
| --- | --- | --- |
| A | Old running argv contains a Lua asset removed by the target snapshot | Postflight fails; activation is not reported successful |
| B | Preflight/prepare records revision N; Registry changes to N+1 before Apply | CAS/ESTALE; no Apply |
| C | Scanner and production resolve the same runtime inventory | Runtime IDs/order/content match; scanner-only overlay is not production |
| D | Exact Strategy command references a function whose provider was removed | Native preflight fails |
| E | Strategy blob is missing or SHA-mismatched | Native validation fails |
| F | Package sync sees unknown lifecycle authority | It does not resurrect lifecycle Z2K bytes and does not report active success |

### Spec-review regression matrix

| Case | Setup | Expected result |
| --- | --- | --- |
| G | Candidate target has targetVersion, targetCommit, manifestSha256, classificationSha256, assets/removals, and planToken but no installed receipt | resolveCandidate() returns the expected target runtimeAssets[] and luaInit[] |
| H | Candidate expected closure includes a runtime asset that is absent from the filesystem | Resolution succeeds; verifyMaterialized() fails with the missing content identity |
| I | Candidate inventory includes a blob/list/ipset/non-Lua entry | Entry remains in runtimeAssets[]/dependencyIndex and is absent from luaInit[] |
| J | strategies_validate uses snapshot N; Registry becomes N+1 before strategies_apply reaches profiles_apply_candidate() | Server-side recheck returns ESTALE; profiles_apply_candidate() is not called |
| K | Current v2 receipt and legacy v1 receipt are reconciled | v2 keeps immutable manifest/classification evidence; v1 follows the managed reconciliation path without package fallback |
| L | Mutable package classification changes after installed release activation | resolveInstalled() still uses the immutable installed classification snapshot; installed membership is not reinterpreted |
| M | Old and new processes expose the same argv Lua paths/order, but the old process generation predates activation | verifyActivationProcess() fails; old PID/generation cannot pass activation proof |
| N | Candidate is prepared at Registry revision N, then an unrelated Registry change occurs before bundle commit | Immediate pre-commit CAS returns ESTALE; asset_registry_apply_bundle is not called |
| O | Candidate is prepared at N, its own bundle commit returns N+1, and committed membership equals the candidate | No ESTALE; committedRegistryRevision=N+1 is captured, materialization/postflight run, and v2 is promoted at N+1 |
| P | Candidate activation succeeds with PID 100; later normal service restart creates PID 200 with matching closure/config/runtime/readiness | verifyInstalledProcess() passes; receipt activation PID/starttime is treated as historical evidence only |
| Q | PID 200 has stale config or runtime hashes despite matching paths/order | verifyInstalledProcess() fails |
| R | V1 receipt omits runtimeOrder; mutable current package classification supplies a different order | Result remains V1_VERIFIED_MEMBERSHIP with no invented canonical luaInit[]; RECONCILIATION_REQUIRED |

### Future release matrix

With release N containing A and B, and release N+1 removing B, modifying A,
and adding classified C:

- the resolver emits A(new) and C in runtimeAssets[] and luaInit[] for normal
  production, native preflight, scanner runtime, install proof, and postflight
  without consumer source-list changes;
- B is absent from the selected closure and must be absent from the running
  argv after activation;
- an unclassified upstream asset blocks as REVIEW REQUIRED;
- a Strategy that still references B fails dependency validation.

### Consumer integration matrix

- Shell synchronization consumes only the bounded resolver JSON and its order.
- UCode preflight calls the same resolver module and does not copy shell lists.
- Scanner consumes runtimeAssets[]/luaInit[] plus explicit scannerOverlay[].
- Install proof verifies the resolver result rather than inventing a list.
- Postflight compares process/config evidence with the resolver result.
- Package synchronization proves ownership and never uses dynamic package bytes
  as lifecycle fallback.

## Direct-fetch audit contract

Runtime composition is local and must not introduce metadata network access.
Existing FRESH immutable target-asset fetches remain within the mutation path.
Metadata/tag/manifest/Compare resolution remains behind the existing
Global Update Source authority.

Before implementation is accepted, a direct-fetch audit must show no new
metadata curl, wget, uclient-fetch, or equivalent bypass outside the existing
update-source-owned paths. Existing immutable asset fetches used by mutation
and independent official Engine provider metadata are outside this Z2K
composition change and must not be repurposed as a shortcut.

## Real-router acceptance after implementation

Router acceptance is a later implementation gate, not evidence supplied by
this documentation commit. It must include, on the real LuCI/OpenWrt router:

1. A read-only proof of the initial Registry revision, receipt/manifest
   identity, selected membership digest, runtime files, and running argv.
2. A safe activation of a release where one Lua asset is removed or changed,
   with no unrelated mutation.
3. Evidence that selected closure, materialized closure, and running argv are
   identical in membership, content identity, and order.
4. Evidence that the removed Lua path is absent from the running argv.
5. Evidence that activation proof accepts only the process created for the
   activation, then a normal service restart with a new PID/starttime passes
   steady-state verification when closure/config/runtime/readiness match.
6. Evidence that a new PID with stale config/runtime hashes fails
   steady-state verification.
7. A safe preflight/prepare followed by a deliberate Registry revision change,
   proving ESTALE and no Apply.
8. A Strategy referencing a removed provider or mismatched blob, proving
   native validation fails closed.
9. Package synchronization with unknown authority, proving lifecycle Z2K
   bytes are not resurrected or treated as active success.

All captures must identify the router, revision/snapshot identity, command
path, and exact result. No APK is involved.

## Self-review checklist

This spec was reviewed against the approved amendments:

- [x] One content-bound snapshot, not “all current Registry rows”.
- [x] Confirmed installed identity, Registry revision, source/manifest identity,
      membership digest, per-entry path/SHA/size/target, and fail-closed
      mismatch handling are explicit.
- [x] Snapshot/CAS is revalidated before update Apply and before Strategy
      Apply; the candidate's own expected revision transition is handled
      separately from unrelated pre-commit changes.
- [x] Candidate baseRegistryRevision is the pre-commit CAS prerequisite;
      committedRegistryRevision is captured from the candidate's own commit,
      which does not make the candidate semantic snapshot stale.
- [x] Expected resolution is separate from materialized/runtime/process
      verification.
- [x] runtimeAssets[], luaInit[], dependencyIndex, and scannerOverlay[] have
      distinct roles and explicit entry kind/type.
- [x] Native preflight uses the same runtimeAssets[]/luaInit[] plus concrete
      Strategy dependencies.
- [x] Scanner uses the same runtime inventory plus scanner-only overlay.
- [x] One resolver owns membership, dependency indexing, and order; no static
      Lua function/provider map is a correctness authority.
- [x] Shell and UCode consume the same bounded result; no hand-copied lists.
- [x] Generated/persisted closure cannot outlive Registry authority; candidate
      closure is invalidated by a pre-commit base revision mismatch and is
      explicitly rebound to the committed revision after its own commit.
- [x] Package sync cannot materialize lifecycle-managed Z2K assets as fallback.
- [x] {ok:true, skipped:true} is not permission to leave package Z2K bytes
      active.
- [x] Installed receipt evolution makes manifest/classification evidence
      immutable and defines V1_VERIFIED_MEMBERSHIP, its allowed/blocked
      operations, and explicit reconciliation.
- [x] Activation process proof requires this activation's process; installed
      steady-state proof accepts a later PID/starttime when current
      closure/config/runtime/readiness match.
- [x] Stale running argv, removed Lua, missing selected Lua, wrong order, and
      old generation are activation/steady-state verification failures; same
      paths with stale generation also fail.
- [x] Explicit Strategy dependencies are snapshot-bound, while exact native
      preflight proves Lua function existence/compatibility.
- [x] strategies_apply has its own server-side installed-snapshot CAS before
      profiles_apply_candidate().
- [x] Future classified additions flow to all consumers without consumer list
      edits; unknown additions remain review-required.
- [x] Test matrix contains cases A-R and the future-release behavior.
- [x] First phase excludes Discord/autocircular changes.
- [x] No Global Update Source or direct-fetch bypass is introduced.

## Review gate

The next action is for the user to review this written spec. After approval,
the implementation workflow is:

1. use superpowers:writing-plans to create the implementation plan;
2. run baseline tests and write RED regressions for the matrix above;
3. implement the resolver and consumer migrations incrementally;
4. run focused tests, router read-only checks, and safe router acceptance;
5. perform adversarial review and verification before any implementation
   delivery.

This commit contains no production implementation and must not be treated as
an implementation approval or a push authorization.
