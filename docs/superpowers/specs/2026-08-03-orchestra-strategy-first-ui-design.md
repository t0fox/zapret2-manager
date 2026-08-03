# Orchestra Strategy-First UI Design

**Date:** 2026-08-03  
**Branch:** `feat/strategy-first-integration`

## Goal

Make `Orchestra` the primary strategy-first control surface for Zapret2 Manager. The page must combine global strategy selection, mass and targeted testing, ranked results, and domain/service overrides while preserving the existing advanced Orchestra controls.

## Product model

- One **global active strategy** handles ordinary traffic.
- Selecting a strategy only creates a UI-side pending choice. Runtime changes only after an explicit **Apply strategy** action.
- **Override rules** are evaluated before the global strategy and can use another built-in strategy for one domain or one named service.
- Built-in combo strategies are not copied into user `Profiles`.
- Every mutation uses the existing verified apply path: preflight, full snapshot, `nfqws2 --dry-run`, sequential TCP/UDP/OPT write, restart, verification, and rollback on failure.

## Simple mode

The simple page follows the approved mockup:

1. Top cards: service truth, start/stop control, active global strategy, quick actions.
2. Built-in strategy list with recommended and active badges.
3. Selected strategy details and explicit global apply button.
4. Targeted test card for a domain/URL or named service.
5. Latest full-test summary and ranked strategies.
6. Override rule list with enable/edit/delete/reorder controls.
7. A mode switch opens the preserved advanced Orchestra view.

The separate `Combo presets` menu entry is removed.

## Strategy catalog

The built-in catalog contains seven current Zapret2UI combo strategies:

1. Combo recommended.
2. Domestic VK-targeted combo.
3. Flowseal ALT10.
4. Flowseal ALT11.
5. Flowseal Multisplit.
6. Flowseal ALT/Fakedsplit.
7. Flowseal wssize.

Each combo keeps the shared seven-profile skeleton:

- Discord TLS;
- YouTube TLS;
- remaining TLS;
- YouTube QUIC;
- Discord QUIC;
- remaining QUIC;
- Discord voice/STUN.

The remaining-traffic profiles are catch-all profiles with an exclude hostlist. They must not be converted into a positive user hostlist.

## Overrides

An override is a small persistent rule, not a Profile:

```json
{
  "id": "ov-000001",
  "enabled": true,
  "priority": 10,
  "targetType": "domain",
  "target": "store.steampowered.com",
  "strategyId": "z2gui-flowseal-alt10-combo"
}
```

Initial supported targets:

- normalized domain or URL hostname;
- named service backed by a packaged domain manifest.

The compiler places enabled override profiles before the global specialized and fallback profiles. For an arbitrary domain, the selected strategy's fallback TLS bundle is used. Named Discord/YouTube services may use their service-specific bundle.

One active rule is allowed per normalized target. Writes are atomic and idempotent.

## Testing and ranking

### Targeted test

The user can:

- test the current strategy for one domain/service;
- test all compatible built-in strategies for that domain/service;
- apply the winning strategy globally;
- create an override for the tested target.

The existing persistent Orchestra run API is reused. URL input is normalized to hostname before starting a run.

### Full test

The existing Orchestra/StressOzz-derived corpus and run history are reused. The UI must show raw results rather than a decorative star-only score:

- tested targets;
- improved relative to baseline;
- regressed relative to baseline;
- still unavailable;
- inconclusive;
- latency and repeat stability;
- ranked candidates.

A web/API probe proves only that endpoint. It does not claim that gameplay UDP, matchmaking, or voice works unless those endpoints were actually probed.

## Active and pending state

- `activeStrategy` comes only from backend-persisted operation metadata and applied configuration truth.
- `pendingStrategy` is local UI state.
- Applying sends an idempotency token.
- Successful verification publishes the new active strategy.
- Failure restores the complete previous configuration and leaves active state unchanged.

## Backend facade

Add a small strategy-first CLI and RPC facade while keeping all existing RPC methods:

Read:

- `orchestra_strategy_state`
- `orchestra_override_list`

Write:

- `orchestra_strategy_apply`
- `orchestra_strategy_rollback`
- `orchestra_override_set`
- `orchestra_override_delete`
- `orchestra_override_reorder`

The facade delegates global mutation to the existing combo/provider apply code. Existing `orchestra_run_*`, ratings, history, health matrix, and automatic-mode RPCs remain the advanced backend.

## Navigation

- The application root and `Orchestra` menu item open the new simple page.
- `Combo presets` is removed.
- The existing Orchestra page remains available as the advanced mode target.
- `Profiles` remains separate for manually authored profiles.

## Safety and validation

- Validate normalized hostnames and service IDs; never interpolate user content into a shell command.
- Requests travel as JSON files using the repository's existing rpcd adapter pattern.
- Validate strategy IDs and dependency files.
- Apply only after native dry-run.
- Keep rollback available from the simple page.
- Do not auto-apply a test winner.
- Bound output, candidate count, attempts, and timeouts.

## Acceptance criteria

1. The new page matches the approved information hierarchy and is responsive in LuCI.
2. Clicking a strategy does not mutate runtime.
3. Seven built-in strategies are shown without creating Profiles.
4. Global apply and rollback work through backend RPCs.
5. Targeted domain/service runs use the existing Orchestra run state machine and display real ranking data.
6. A winning strategy can become global or a target override.
7. Overrides are compiled before global fallback and survive reboot.
8. Full-test summary distinguishes improvements and regressions.
9. Advanced Orchestra controls remain accessible from the mode switch.
10. The separate Combo presets navigation entry is gone.
11. Focused host tests and existing combo tests pass.
12. Router-only acceptance is reported honestly and is not inferred from host tests.

## Provenance

- UI and combo skeleton: `Asterlike/zapret2UI` pinned to commit `a937d6539911d45da20fd92568aa59bb0e688e5a`, MIT.
- Domain-test workflow inspiration: `StressOzz/Zapret-Manager`.
- Apply, run journal, verification and rollback: existing `t0fox/zapret2-manager` implementation.
