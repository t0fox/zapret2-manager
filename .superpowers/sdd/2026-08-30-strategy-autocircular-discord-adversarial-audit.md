# Strategy / Autocircular / Discord adversarial audit

Date: 2026-08-30  
Repository: `t0fox/zapret2-manager`  
Target: `root@192.168.1.1`  
Scope: Strategy, learned Autocircular, Discord; no Resources, Components, update lifecycle, or backend redesign.

## Executive result

Two source-level contract violations were reproduced and fixed:

1. Discord enable used the legacy `discord_profile_preview` → `discord_profile_apply` path instead of the canonical donor → Strategy validate/create/apply lifecycle.
2. Discord live status used a stale hardcoded runtime signature and optimistic/local state, so it could disagree with the actual `status_fast` process.

The backend and RPC implementation were not changed. The frontend fix was deployed as one file and pushed to `main` in commits `2107c6596ffdf0f27e91f0154ce5ad12e8ffdd25` and `288f70d3a7237860a2de4bdb651957d19fac4767`.

## Evidence and verdicts

### Strategy surface

- `strategies_list`: live RPC returned `ok=true` and 735 strategy rows.
- `strategies_get(z2k_all_in_one)`: `ok=true`, three profiles, revision `0`.
- `strategies_preview` with the catalog-bound identity: `ok=true` and returned an effective command.
- `strategies_validate` was not treated as a failure of this change: the router returned `EPREFLIGHT / complete native Strategy preflight is required`.
- `strategies_apply` and any real Strategy mutation were intentionally not executed during this adversarial audit.

Verdict: `PASS` for the read-only Strategy path; mutation acceptance is `NOT FULLY VERIFIED` because it was unsafe to apply an unrelated live strategy.

### Autocircular state

A temporary `audit.invalid` row in the existing `circular_1_1` pool was used without restarting the service or generating target traffic.

| Transition | Result |
| --- | --- |
| `state_set(..., frozen)` | `ok=true`, persisted `mode=frozen` |
| `state_set(..., excluded)` | `ok=true`, persisted `mode=excluded` |
| `state_set(..., auto)` | `ok=true`, persisted `mode=auto` |
| `state_delete` | `ok=true`, temporary row removed |

The real Discord row remained one canonical `discord_udp / nohost / strategy 2 / auto` row. The `discord_voice` pool is an alias of `discord_udp`; nohost alias conflict was not observed.

Verdict: `PASS` for the audited AUTO/FROZEN/EXCLUDED/RESET persistence seam. Real rotation under Discord traffic is `NOT FULLY VERIFIED`; no traffic was generated.

### Discord lifecycle violation and fix

Before the fix, `enableDiscord()` read `state.ctx.api.strategy` and called `preview()` plus `apply()` with a client-created `changeHash` and `idempotencyToken`. This was confirmed in the source and by the historical regression commit that replaced the donor flow.

The fixed flow is:

```text
strategies.get
→ strategies.discordDonor
→ build a user Strategy draft from source + donor profiles
→ strategies.validate (inline canonical strategy_data)
→ strategies.create
→ strategies.apply (identity returned by create)
→ cleanup strategies.delete if create succeeded but apply failed
```

The browser safe probe blocked `discord_profile_apply`, `profiles_apply`, `strategies_create`, `strategies_apply`, and `strategies_delete`. After cache was cleared, the real live UI action emitted only:

```text
strategies_get
strategies_discord_donor
```

The router returned `EVERIFY / verified donor has no Discord autocircular pool` because its installed catalog is stale (see below). The failure was fail-closed; no mutation was sent.

Verdict: `PASS` for canonical frontend routing and fail-closed behavior; successful live donor/create/apply is `NOT FULLY VERIFIED` because the installed catalog cannot currently provide the canonical donor.

### Discord runtime detector violation and fix

Before the fix, the detector required:

```text
--filter-udp=19294-19344,50000-50100
--blob=blob_stressozz_stun:.../stun.bin
```

The actual running process had neither signature. The fixed detector requires backend runtime evidence:

- `serviceState == running`;
- `runtime.present == true`;
- `--filter-l7=discord,stun`;
- a UDP filter containing `50000-50100`;
- `circular` with `key=discord_udp` or `key=discord_voice` and `hostkey=z2k_nohost_key`.

The delimiter regression in the first fix was caught by a RED test using the real `key=discord_udp:nld=2` form and then fixed.

The live `status_fast` response confirmed process PID `31268`, running `nfqws2`, NFQUEUE `300`, `ownerConflict=false`, and the canonical Discord runtime command. After cache clear, the Browser learned panel showed `Discord Voice / Video`, `● Автоподбор`, and `#2 из 6`.

Verdict: `PASS` after the second RED/fix cycle.

## Installed router drift

The router has a separate deployment-parity problem that was not changed blindly:

- installed active catalog commit: `8c44df2bed98872d1348db053623ee6bf2902408`;
- installed active catalog digest: `5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1`;
- active catalog Discord source uses `discord_voice`, old ports, 12 candidates, and no `quic_dbankcloud`;
- running `/opt/zapret2/config` uses `discord_udp`, ports `50000-50100`, six `quic_dbankcloud` candidates;
- local `main` catalog source contains the newer canonical `discord_udp` six-candidate definition.

This is a live source/runtime/catalog parity concern, not a frontend fix. The router's `strategies_discord_donor` failure proves the installed catalog cannot currently authorize the canonical donor. Updating the active catalog requires its existing catalog rebuild/reload authority and was intentionally outside the one-file source-only deployment; no second catalog or direct overwrite was introduced.

Verdict: `CONTRACT VIOLATION` in installed deployment parity; source fix does not claim to resolve it.

## Direct-fetch audit

No new Strategy/Discord metadata fetch bypass was found:

- `z2k-versions.uc` routes catalog/tag/manifest/compare through `update_source_browse/refresh/fresh`;
- `z2k-upstream.uc` routes the manifest through `update_source_fresh`;
- Strategy, Discord donor, and Autocircular sources contain no `curl`, `wget`, or `uclient-fetch` metadata path.

Existing non-metadata network boundaries remain explicit: `z2k-upstream.fetch_file()` fetches an immutable candidate compatibility file; `resource-update.uc` fetches immutable assets during mutation; runtime diagnostic/orchestra scripts use curl for target probes. These were not changed by this task.

Verdict: `PASS` for the requested metadata bypass audit.

## Tests and deployment

Focused new/changed tests:

```text
node --test --test-name-pattern="Discord enable uses|DISCORD_RUNTIME_STATUS" \
  tests/product/autocircular-exclusion.test.mjs \
  tests/ui/learned-autocircular-contract.test.mjs
```

Result: `3 passed, 0 failed`.

Additional focused suite result: `36 passed, 4 failed`. The four failures are pre-existing unrelated baseline failures in Lua persistence, learned table layout, and the older P03 donor contract; none is touched by this fix.

Other checks:

- `node --check` for `z2m-strategies.js`: passed;
- `node scripts/validate-knowledge.mjs`: passed;
- single-file source deployment: local/staged/installed SHA-256 matched;
- installed file ownership/mode: `root:root`, `0644`;
- `rpcd reload`: completed;
- browser cache was cleared before final acceptance;
- no APK/package operation and no agent was used.

## Final status

```yaml
source_defects_fixed: 2
backend_changed: false
metadata_fetch_bypass: false
autocircular_safe_state_audit: pass
discord_live_detector: pass
discord_successful_mutation: not_fully_verified
router_catalog_runtime_parity: contract_violation
push: main
head_equals_origin_main: true
```
