---
id: z2k-final-lifecycle-resource-ownership
title: "Z2K final lifecycle and resource ownership gate"
type: plan
status: active
authority: approved-plan
updated: 2026-08-28
publish: false
tags: [z2k, lifecycle, resources, ownership]
---

# Z2K Final Lifecycle + Resource Ownership Gate Implementation Plan

Goal: завершить Z2K version lifecycle, сделать fresh target resolution
rate-limit-efficient, закрыть второй mutation path из Resources, доказать
единственное владение lifecycle assets и выполнить live upgrade/downgrade/
reinstall с Registry/runtime proof.

The existing Z2K lifecycle architecture is authoritative and must not be
re-designed. Browse remains cache-first and read-oriented. Mutation prepare
resolves only the selected tag to an immutable commit. Asset Registry remains
the sole writer of managed asset bytes and metadata. Generic Resources API
cannot mutate lifecycle-owned `z2k-curated-lua` assets. Components, Resources,
Registry and runtime must agree after every lifecycle operation.

## Global constraints

- Work only from the actual `codex/z2k-version-lifecycle` HEAD; verify it before editing.
- Do not create a second updater, Registry, CHECK_STATE, or resource store.
- Asset Registry remains the only writer of managed asset bytes/metadata.
- `asset.mutable` is internal lifecycle mutation capability, never generic Resources permission.
- A lifecycle Z2K asset is exactly `provenance.kind == catalog/upstream` and `provenance.bundleId == z2k-curated-lua`.
- Generic Resources mutation of lifecycle assets is forbidden in frontend and backend.
- User-created/imported/generated resources retain existing edit/delete behavior.
- Browse cache is not mutation authority; fresh prepare does not trust cached tag-to-commit mappings.
- No GitHub PAT requirement and no retry loop against rate limits.
- Do not perform destructive live mutation before automated conflict gates pass.
- Strategy and autocircular state must survive Z2K version operations.
- Do not force-push and do not discard unrelated changes.

## Task 1 - Baseline and ownership map

Inspect the Asset Registry, version lifecycle, resource update, and Resources
UI/model files. Record `git status --short`, branch, HEAD, recent log,
`git diff --check`, and the real mutation matrix:

`Components -> resources.prepareVersion/resources.update ->
asset_registry_apply_bundle -> runtime activation`; generic Resources update and
delete go through `asset_registry_update` and `asset_registry_delete`.

Reproduce with a fixture that a manager-owned mutable asset with provenance
`catalog/upstream`, bundle `z2k-curated-lua`, and version `r-79.7` is currently
treated by Resources as editable. Add the failing contract test before changing
the UI.

## Task 2 - Single-target fresh resolver

In `z2k-versions.uc`, add a focused `z2k_resolve_tag_fresh(version)` flow:
validate `r-X`; GET `/repos/necronicle/z2k/git/ref/tags/<version>`; require the
exact `refs/tags/<version>`; resolve lightweight `object.type == commit` in one
REST request, or annotated `object.type == tag` through `/git/tags/<tagSha>` in
two requests and require the final object to be a commit. Fetch
`raw/<commitSha>/UPDATES.json` and require `manifest.current == version`.

Mutation resolution must not call `z2k_versions({fresh:true})` to build a full
catalog. Browse remains warm/cache-first. Test lightweight=1 REST request,
annotated=2, malformed ref fail-closed, unavailable/403 as `EUNAVAILABLE` with
no prepared target, and fresh moved-tag resolution winning over an old cache.

## Task 3 - Derived lifecycle management policy

In `asset-registry.uc`, add one canonical backend-derived management projection
for the lifecycle predicate. It must expose an equivalent of:

`management: { owner: "z2k-core", mode: "lifecycle", editable: false, deletable: false }`

for lifecycle assets, while preserving `mutable=true` internally so
`asset_registry_apply_bundle()` remains legal. User/imported mutable assets stay
generic-editable; package assets remain immutable. Do not persist redundant
derived flags.

## Task 4 - Backend generic mutation policy

`asset_registry_update()` and `asset_registry_delete()` must reject lifecycle
Z2K assets before mutation with `EPOLICY` and the message:

`Ресурс управляется Z2K Core. Измените версию Z2K в разделе «Компоненты».`

This remains true with no references. Revision, SHA, and existence must remain
unchanged. User-created/imported update and delete still succeed. Canonical
`asset_registry_apply_bundle()` for `z2k-curated-lua` remains allowed.

## Task 5 - Resources read-only presentation

In `z2m-assets.js` and `z2m-resources-model.js`, separate internal Registry
mutability from generic workspace editability and consume backend management
projection, not asset name guesses. Lifecycle rows/cards show `Управляется Z2K
Core`, version and source, are read-only, hide Validate/Save/update/delete, and
retain view, usage, details, and duplicate-as-user-copy. Workspace callout:

`Этот ресурс входит в установленную версию Z2K. Изменения выполняются через System → Components → Z2K Core.`

Do not add a new routing subsystem merely for a management link.

## Task 6 - Import collision

When import receives an existing lifecycle asset ID, do not call `assets.update`
and show:

`Этот ID принадлежит Z2K Core и не может быть перезаписан в Ресурсном центре.`

Backend `EPOLICY` remains mandatory.

## Task 7 - Prepare-time resource/reference conflict

In `resource-update.uc`, after computing `removeIds`, inspect current Registry
references. If the selected target removes an asset referenced by a Strategy or
other consumer, fail before confirmation with `EZ2K_RESOURCE_CONFLICT`, bounded
`conflictingAssets` containing IDs/references, and user text:

`Эта версия Z2K не может быть установлена, пока один из её ресурсов используется текущей стратегией.`

Do not persist `preparedTarget`, open confirmation, or block an unrelated safe
target. A referenced asset that remains in target is not automatically blocked
when replacement/restart is part of the existing contract.

## Task 8 - Prepared-target and cross-tab consistency

Preserve the existing fingerprint scope of target assets plus remove IDs.
Protected generic edit fails with `EPOLICY` and does not stale a token because
no mutation occurred. An unrelated user-resource edit succeeds and leaves the
Z2K fingerprint unchanged. A real canonical Z2K state change invalidates the old
token with `ECHECK_STALE`.

## Task 9 - Registry/Resources/runtime truth

Add integration/sandbox coverage proving that after apply the Components
installed release, Registry provenance/version/sourceCommit, Resources
management/read-only projection, and materialized runtime bytes all identify the
same selected target. A Registry/runtime SHA mismatch must prevent successful
runtime postflight reporting.

## Task 10 - Rate-limit-safe network acceptance

After quota availability, record exact selected-tag HTTP status, REST request
count, object type, tag/object SHA, and resolved commit SHA. Expected budget is
one REST request for a lightweight tag and two for an annotated tag. A 403 or
rate limit fails closed without Registry mutation or fake prepared success.

## Task 11 - Read-only Resources acceptance before mutation

With confirmed installed `r-79.7`, inspect `z2k-modern-core`, `z2k-detectors`,
`z2k-state-persist`, and one lifecycle blob in the real Resources browser.
Prove management owner, read-only editor, absent Save/Delete, optional
duplicate, and `provenance.version`. Run a safe negative `assets.update()` and
prove Registry revision/SHA and runtime SHA are unchanged. Do not mutate real
user content for the positive fixture.

## Task 12 - Full live mutation cycle

Only after Tasks 1-11 pass, use the real Components UI for:

- Upgrade `r-79.7 -> r-80.3` through select, fresh prepare, confirmation, apply.
- Downgrade `r-80.3 -> r-79.7`, proving no newer-only hybrid assets remain.
- Reinstall `r-79.7 -> r-79.7` as a real download/verify/Registry/materialize/
  restart/postflight/receipt transaction, not `EUPDATE_NOT_AVAILABLE`.

For each operation capture prepared commit, receipt, Registry SHA, runtime SHA,
nfqws2 health, queue 300, Strategy, autocircular, and Resources version.

## Task 13 - Strategy/autocircular regression gate

Before the first live mutation record Strategy identity/config SHA, nfqws2
PID/cmdline and canonical LUAOPT/load chain, autocircular `state.tsv` SHA and
line count, optional discord state, and queue/rules. After every operation
prove Strategy/config unchanged, nfqws2 running with queue 300, and state not
wiped. Do not infer autocircular functionality merely from file existence.

## Task 14 - Automated verification

Focused suites must cover resolver request budgets and fail-closed behavior,
legacy/new receipts, ownership projection, protected update/delete/import,
canonical apply_bundle, user edit/delete, prepare conflict/no confirmation,
cross-tab fingerprint semantics, Resources read-only presentation, duplicate,
upgrade/downgrade/reinstall, runtime rollback, and postflight. Then run the
same broad command on baseline/current to classify regressions; never call a
failure pre-existing without identical baseline evidence.

## Task 15 - Final adversarial gate

Answer with evidence whether Resources can update/delete lifecycle assets,
whether canonical apply_bundle can, whether user assets still work, referenced
removals stop before confirmation, unrelated edits do not stale tokens, real Z2K
changes do, fresh REST counts are 1/2, stale browse cache cannot authorize
mutation, and all three live operations agree across Registry/runtime/Resources
while preserving Strategy/autocircular.

## Task 16 - Final report

Report `BASE_SHA`, implementation SHA, branch SHA, changed files, before/after
ownership matrix, resolver request-count evidence, exact focused command/count,
broad baseline/current comparison, and a per-operation evidence table including
operation, from/to, prepared commit, receipt version, Registry/runtime SHA,
nfqws2, queue, Strategy, autocircular, Resources version, and result. Include
frontend repo/router/HTTP hashes. Do not declare READY from tests alone.

## Task 17 - Verdict and delivery

Verdict is exactly `Z2K VERSION LIFECYCLE READY` only when all lifecycle,
ownership, conflict, snapshot, live, runtime, Resources, Strategy/autocircular,
and regression gates have evidence. Otherwise use
`Z2K VERSION LIFECYCLE NOT READY` with exact remaining blockers. Commit and push
without force, then prove:

`git rev-parse HEAD == git rev-parse origin/codex/z2k-version-lifecycle`.
