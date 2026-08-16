# Avatar page parity workflow

## Z2M Browser Acceptance Priority

For zapret2-manager browser acceptance, use these paths in order:

1. Codex built-in Browser.
2. A connected user Browser extension or existing browser context.
3. An existing authenticated CDP context.
4. A fresh manual Chrome/Edge CDP profile only as a last fallback.

Never declare authenticated LuCI browser acceptance blocked merely because a
newly launched clean browser profile receives HTTP 403. Prefer reusing an
existing authenticated browser context, and do not extract or print passwords
or cookies. A frontend/UI change cannot be marked `COMPLETE` without real
browser acceptance at the required exact viewports and its console, network,
overflow, and interaction evidence.

This workflow is evidence-first and page-scoped. It does not authorize
implementation of the next page in the queue.

1. Inventory the frozen donor page at its pinned SHA with
   `node scripts/inventory-avatar-page.mjs <donor-file>`. Treat the output as
   evidence only; record sections, dependent components, tabs, and donor files
   manually in the page manifest.
2. Compare ordered `DONOR_SECTIONS` and `Z2M_SECTIONS`. Every missing donor
   section and every extra Z2M section must be either fixed or explicitly named
   in `intentional_extensions` / `intentional_deviations`.
3. Implement only the selected page and preserve the existing Z2M RPC, LuCI,
   ACL, and navigation authority. No donor HTTP API or sidebar is imported.
4. Run the page contract tests, JavaScript syntax checks, affected RPC/ACL
   checks, and dependency closure. The closure checks LuCI `require` modules,
   case-sensitive paths, and local CSS assets before deployment.
5. Deploy the current candidate directly to the target with the page-scoped
   SCP-compatible script. Back up target files first, then prove local SHA ==
   target SHA, `root:root`, and mode `0644`. Reload only the required rpcd
   process; do not build/install an APK or reboot the router.
6. Hard-refresh the real browser at 1280, 768, and 390 when the environment
   supports exact viewport control. Record a separate JSON evidence item per
   viewport using `browser-evidence.template.json`: structure, controls,
   runtime data, console, network 404s, overflow, clipping, and screenshots.
7. Run `validate-page-parity.mjs --manifest <manifest>`. A page is not complete
   until it reports `COMPLETE`; `NOT_RUN`, `PARTIAL`, missing donor sections,
   unexplained extras, or `BACKEND_NOT_READY` for a supported backend remain
   explicit failures.

The Dashboard fixture is intentionally `NOT_COMPLETE` while its exact
viewport evidence is unavailable. Future pages remain queued until P01 is
accepted; the queue is not an implementation plan.
