# Dashboard P01 Avatar Parity Implementation Plan

> Scope: only the strict P01 «Главная» page. Do not start P02 or any backend
> milestone. Preserve the existing TG/DNS commits already present on this
> branch and keep the primary checkout untouched.

## Baseline and frozen references

- Worktree: `G:\zapret2-manager\.codex-avatar-parity`
- Branch: `codex/avatar-ui-parity`
- Z2M start HEAD: `618318492964aa923b0e5ec64a6e002a57f54817`
- Donor: `G:\avatarDD\zapret-gui@60bc16a5ddc5f43d97d414b99920c3d13da3151a`
- Donor HTTP API, router, Python, donor sidebar and donor backend are out of scope.
- Primary checkout `G:\zapret2-manager` must remain untouched.

## Inventory and acceptance contract

1. Complete `docs/05-parity/pages/dashboard.md` with the donor DOM/CSS/API
   inventory, current Z2M inventory, explicit gap matrix, donor-vs-Z2M
   adaptation decisions, file/dependency closure, and exact verification
   ledger. Record the clean start state and frozen donor SHA.
2. Treat the frozen donor order as authoritative for the Dashboard core:
   page header, five-card status grid, VPN/Tunnels section, Monitoring
   section, quick actions, recent events/logs. Add Z2M-only resource checking
   and strategy/rules controls after that core without removing their existing
   backend semantics.
3. Remove the redundant Home secondary «Обзор» tab. The canonical Home route
   remains `dashboard` and existing aliases/bookmarks continue to normalize to
   it. Other navigation groups must retain their secondary navigation.

## Implementation (TDD red-green-refactor)

1. Add focused UI contract tests before changing production code. They must
   prove the Dashboard composition/order markers, exact single lifecycle
   action set, loading/empty/error event states, canonical Z2M API usage,
   resource-checker preservation, and Home secondary-nav suppression. Run the
   new test file and record the expected RED failure.
2. Refactor `z2m-overview.js` into the Dashboard page while preserving the
   existing resource checker and strategy override flow. Use LuCI `E()` and
   `ctx.api`, not donor `/api/*` calls or donor module imports. Load only
   existing service/strategy/event/DNS/product status sources; unsupported
   optional data renders an explicit unavailable state rather than invented
   runtime truth. Include accessible loading, empty and error states.
3. Update `z2m-overview-model.js` only as needed for truthful Dashboard view
   models and stable status-card mapping. Do not alter backend contracts.
4. Update `z2m-navigation.js` and `z2m-shell.js` so Home has no redundant
   secondary tab while all non-Home groups continue to render as before.
5. Add only the CSS needed for donor composition and 1280/768/390 layouts in
   existing Z2M stylesheets; avoid unrelated page restyling. Keep the visual
   hierarchy, card grids, action order, and event log treatment aligned with
   the frozen donor.
6. Run the focused tests GREEN, then the relevant existing UI contract suite
   and the frontend module/dependency closure checks. Refactor only while the
   tests stay green.

## Target deployment and browser acceptance

1. Build the exact package from the committed P01 tree. Add/use a dedicated,
   guarded P01 target deployment script that transfers the complete changed
   frontend closure, verifies SHA-256 on the staged and final target files,
   and enforces root ownership and mode. Do not reuse a TG-only deploy gate.
2. Deploy only after the local checks pass. Verify target files and package
   provenance, then run Dashboard canaries: load, refresh, start/stop/restart
   action request wiring without inventing a new backend writer, and recent
   events state.
3. Run browser acceptance against that deployed build at 1280x900, 768x900,
   and 390x844. Check DOM/order, no horizontal overflow, screenshot/layout,
   console errors, network failures, resource checker, and action/event state.
   Record `PASS`, `PARTIAL`, `NOT_RUN`, or `BLOCKED` with exact evidence.

## Delivery boundary

- Create one focused commit for P01 only after verification.
- Do not start P02, WARP, failover, remediation, or other backend work.
- Update `docs/05-parity/pages/dashboard.md` with final commit SHA and evidence.
- Final status must state exactly what passed and what remains `NOT_RUN`; do not
  claim full Avatar parity from a P01-only result.
