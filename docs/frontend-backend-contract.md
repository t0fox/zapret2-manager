# Zapret2 Manager Frontend ↔ Backend Contract

Status: frozen for the `feat/strategy-first-integration` single-view frontend.

This document defines the backend surface consumed by the LuCI application. The next backend implementation may be rewritten internally, but it must preserve these method names, transport rules, response semantics, and error behavior until the frontend contract is deliberately versioned.

## Global wire rules

- Ubus object: `zapret2-manager`.
- Methods with `params: ['edit']` receive **one positional JSON string**. The backend parses that string into an object. Passing an object directly would produce a nested positional value and is not supported.
- Other positional methods receive the exact scalar declared in `z2m-api.js`, such as `domain` or `enabled`.
- All declarations use `reject: true`. Ubus transport errors must reject and retain a structured code/message.
- Mutations return `{ ok: true, ... }` on acceptance/success or `{ ok: false, error: { code, message, details? } }`.
- Unknown or unavailable values are represented by `null`, omitted fields, or explicit capability flags. They must not be fabricated as zero, empty success, or `healthy`.
- Long-running operations expose an ID and a pollable status method. Status polling must be idempotent and safe to repeat.
- A successful mutation may return `rollback_ttl` in seconds. The frontend shows its confirmation bar only when that field is present and positive. Confirmation uses `confirm_alive`; immediate rollback uses `rollback`.
- Secrets are masked by default. Full Telegram proxy links require the explicit `proxy_link_info` reveal request.

## Overview and global strategy

### Read methods

- `status`
- `discord_profile_preview`
- `orchestra_run_history`
- `orchestra_status`
- `service_dns_status`

`status` should expose honest runtime evidence: service state, nfqws2 process evidence, NFQUEUE evidence, applied/runtime match, and explicit unknown fields when unavailable.

`discord_profile_preview` should expose:

- `comboCatalog.candidates[]`
- `strategyState.active`
- `overrides.rules[]` when supported

Candidate rows may contain `candidateId` or `managerId`, `name`/`displayName`, `description`, `digest`, profile/port metadata, and backend-computed evidence. The frontend does not rank candidates locally.

### Apply and rollback

- `discord_profile_apply`
- `discord_profile_rollback`
- `confirm_alive`
- `rollback`

Global apply payload:

```json
{
  "candidateId": "backend candidate id",
  "expectedDigest": "optional backend digest",
  "wideAcknowledged": true,
  "includeOverrides": true,
  "idempotencyToken": "luci-global-..."
}
```

Point override payloads use the same method and are staged in the browser before explicit application:

```json
{
  "action": "override_set",
  "target": "example.com",
  "strategyId": "candidate id",
  "enabled": true,
  "priority": 10,
  "applyNow": true,
  "idempotencyToken": "luci-override-..."
}
```

or:

```json
{
  "action": "override_delete",
  "id": "override id",
  "applyNow": true,
  "idempotencyToken": "luci-override-..."
}
```

## Orchestra runs

### Discovery and lifecycle

- `orchestra_capabilities`
- `orchestra_status`
- `orchestra_events`
- `orchestra_history`
- `orchestra_ratings_get`
- `orchestra_run_start`
- `orchestra_run_status`
- `orchestra_run_history`
- `orchestra_run_continue`
- `orchestra_run_pause`
- `orchestra_run_resume`
- `orchestra_run_stop`
- `orchestra_probe_preflight`

`orchestra_run_status` accepts an edit object containing `{ "runId": "..." }`; an empty object may be used to discover the active run.

A run envelope is `{ ok: true, run }`. History is `{ ok: true, runs: [] }`. Invalid/missing envelopes are treated as unavailable, never successful empty results.

Run fields consumed by the frontend include:

- `runId`, `phase`, `target`, `targetType`, `protocols`
- `candidateIds`, `totalCandidates`, `completedCount`
- `results` or `candidateJournal`
- `targets` and `targetProgress[].testedCandidateIds`
- `selectedWinner`
- `serviceVerdict` / `applyAllowed`
- `continuable`, `continuationCount`
- timestamps, `error`, and bounded evidence fields

Terminal run phases:

`completed`, `applied`, `rolled-back`, `restored`, `timeout`, `timed-out`, `partial`, `infrastructure-error`, `cancelled`, `canceled`, `stopped`, `failed`, `interrupted`, `stale`.

Continuation payload is deliberately narrow:

```json
{
  "runId": "existing run id",
  "additionalTimeoutSec": 900
}
```

The browser must not resubmit candidate IDs, profiles, targets, generation, or compiled configuration.

### Run start payloads

Domain/corpus strategy run:

```json
{
  "targetType": "domain or corpus",
  "domain": "present only for domain mode",
  "protocols": ["tcp_https"],
  "candidateMode": "selected or zapret2gui-only",
  "candidateIds": [],
  "repeats": 2,
  "perAttemptTimeoutSec": 20,
  "totalTimeoutSec": 90,
  "maxCandidates": 1,
  "maxAttempts": 3
}
```

The “all candidates” mode uses bounded values `totalTimeoutSec: 600`, `maxCandidates: 20`, `maxAttempts: 60`.

Service run:

```json
{
  "targetType": "service",
  "targetId": "service catalog id",
  "protocols": ["backend catalog protocols"],
  "candidateMode": "zapret2gui-only",
  "candidateIds": [],
  "repeats": 1,
  "perAttemptTimeoutSec": 15,
  "totalTimeoutSec": 180,
  "maxCandidates": 4,
  "maxAttempts": 12
}
```

Service targets/domains and candidate definitions remain backend-owned.

### Apply a run winner

- `orchestra_preview_best`
- `orchestra_apply_best`
- `orchestra_apply_status`
- `orchestra_restore_previous`

Apply is enabled only when the run is completed and the backend verdict is ready (`serviceVerdict.status == "ready"`, equivalent ready verdict, or `applyAllowed == true`).

Preview payload: `{ "runId": "..." }`.

Apply payload:

```json
{
  "runId": "...",
  "changeHash": "hash returned by preview",
  "idempotencyToken": "luci-run-apply-..."
}
```

Apply status accepts `{ "operationId": "..." }` and returns an operation with a phase. Terminal apply phases are `applied`, `failed`, `rolled-back`, and `restored`.

## Auto Strategy

- `orchestra_auto_status`
- `orchestra_auto_enable`
- `orchestra_auto_disable`
- `orchestra_auto_run`
- `orchestra_auto_stop`
- `orchestra_auto_restore`

Status is read-only and should expose `revision`, `enabled`, `phase`, `serviceIds`, `capabilities`, `activeRunId`, `lastGood`, and bounded error/evidence fields.

Every mutation receives:

```json
{
  "expectedRevision": 4,
  "requestId": "luci-auto-...",
  "serviceIds": ["deduplicated backend service ids; maximum 16"]
}
```

The frontend never sends candidate/profile configuration to Auto Strategy restore.

Known phases: `disabled`, `waiting-network`, `healthy`, `degraded`, `scanning`, `applying`, `verifying`, `recovering`, `rollback`, `rolling-back`, `cooldown`, `failed`, `cancellation-requested`. Unknown phases are not healthy.

## Profile drafts

- `profiles_list`
- `profiles_create`
- `profiles_update`
- `profiles_clone`
- `profiles_delete`
- `profiles_validate`
- `profiles_import_applied`
- `profiles_apply`
- `passthrough`

Create payload: `{ "name": "...", "opt": "..." }`.

Update payload includes `{ "id": "...", "revision": <profile revision>, "name": "...", "opt": "..." }`.

Clone/delete/validate identify a profile by `id`. Text validation may pass `{ "opt": "..." }`.

Apply supports `{ "mode": "preview" }` and `{ "mode": "apply" }`. Apply may return `rollback_ttl`.

## Service catalog

- `catalog_list`
- `catalog_status`
- `catalog_get`
- `catalog_preview`
- `catalog_apply`
- `health_matrix_get`

Catalog preview receives `{ "enabled": ["service ids"] }`.

Catalog apply receives the selected IDs plus the preview precondition:

```json
{
  "enabled": ["service ids"],
  "revision": "ledgerRevision returned by preview",
  "fileSha256": "fileSha256 returned by preview"
}
```

Digest/precondition mismatch blocks application.

## Lists

- `lists_get`
- `lists_check_domain`
- `lists_set`

`lists_check_domain` receives one positional domain string.

`lists_set` receives one JSON edit object containing only editable list keys. Current frontend keys are `domainInclude`, `domainExclude`, `ipInclude`, `ipExclude`, `ipBlock`, and `autohostlist`. Engine-owned/read-only lists remain non-editable. Backend conflicts block apply.

## DNS and provider diagnostics

- `dns_get`
- `dns_set`
- `dns_validate`
- `dns_apply`
- `dns_check`
- `dns_rollback`
- `dns_restore_auto`
- `dnsprov_components`
- `dnsprov_providers`
- `dnsprov_diagnose`
- `dns_select_provider`

Manual override validation/set payload: `{ "entries": [{ "domain": "example.com", "ip": "1.1.1.1", "enabled": true }] }`; set may include the current revision. Apply receives `{ "mode": "apply" }`.

`dns_get.rollbackAvailable == true` is required before the rollback button is enabled.

Provider diagnose receives `{ "provider": "provider id" }`. A diagnostic result with `ok: false` is a completed diagnostic failure; an RPC rejection is displayed separately as an RPC error.

Provider selection receives `{ "providerId": "...", "apply": true }` and may return `rollback_ttl`.

## Service DNS

- `service_dns_providers`
- `service_dns_status`
- `service_dns_preview`
- `service_dns_set`
- `service_dns_apply`
- `service_dns_apply_async`
- `service_dns_apply_status`
- `service_dns_rollback`

Set payload: `{ "selections": { "service-id": "provider-id" } }`.

The frontend must pass the exact `draftRevision` returned by `service_dns_set` to async apply:

```json
{
  "operationId": "dns-ui-...",
  "draftRevision": "returned revision"
}
```

Status accepts `{ "operationId": "..." }`. Terminal states include `completed`, `applied`, `failed`, `rolled-back`, `cancelled`, `canceled`, and `stopped`. RPC errors and terminal failures clear the pending browser operation.

`service_dns_status.rollbackAvailable == true` is required before rollback is enabled.

## Telegram Proxy

- `proxy_capabilities`
- `proxy_status`
- `proxy_config_get`
- `proxy_config_validate`
- `proxy_config_preview`
- `proxy_config_apply`
- `proxy_start`
- `proxy_stop`
- `proxy_restart`
- `proxy_autostart_set`
- `proxy_secret_rotate`
- `proxy_logs_tail`
- `proxy_health`
- `proxy_link_info`
- `proxy_quick_install`

Link reveal payload: `{ "reveal": true, "confirm": "REVEAL" }`.

Logs must already be redacted by the backend. The frontend renders text nodes only.

Config mutation is draft-first and follows validate → preview → apply. The exact config object is the draft returned by `proxy_config_get`; the frontend preserves backend-owned fields rather than inventing defaults for unknown values.

## Monitoring and maintenance

- `status`
- `events_tail`
- `maintenance_status`
- `versions`
- `backup_list`
- `backup_create`
- `backup_restore_preview`
- `backup_restore`
- `backup_delete`
- `diagnostics_export`

`events_tail` may be unsupported. Once the backend returns an unsupported-method error, the frontend stops repeated capability probes and renders a stable unavailable state.

Backup preview returns data rendered in `#z2m-backup-preview`; RPC errors render a visible callout. Destructive restore/delete actions require the shared modal.

## Known backend gaps for the next agent

These are not frontend-success conditions and must not be hidden as green:

1. `events_tail` is unavailable on the current router backend.
2. The manager-owned DNS overrides file may not be registered in dnsmasq `addnhosts`.
3. Orchestra may start with zero targets or time out all candidates; a zero-target run is an error/unavailable evidence state, not success.
4. `profiles_import_applied` has been observed returning without creating visible draft profiles and without a useful error.
5. Watchdog evidence has reported `nft table zapret2 missing or empty` and `nfqws2 process gone`.
6. StressOzz/Flowseal repository fixture tests still reference historical pinned source layouts and are backend/research fixture work, not single-view frontend behavior.
7. Some old standalone remastered pages remain shipped but are not part of the single-view module graph. The active app must not import them.

The backend rewrite should address these gaps while preserving the method and payload contract above, or introduce an explicitly versioned replacement contract together with frontend changes.

### Dedicated Orchestra catalogue reads

The central facade also exposes the read-only dedicated Orchestra methods
`orchestra_catalog` and `orchestra_corpus_get`. They are backed by the packaged
`zapret2-manager-orchestra` rpcd companion and retain rejected ubus error
semantics; absence of that companion is an unavailable backend, never success.
