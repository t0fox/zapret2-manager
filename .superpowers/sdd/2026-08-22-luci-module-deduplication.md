# LuCI module deduplication — 2026-08-22

## Scope

Remove byte-for-byte duplicate LuCI implementations while preserving the
existing module import paths used by the application.

## Result

The system API, navigation, and maintenance compatibility modules now forward
to their canonical implementations. Documentation evidence for `GROUPS` now
points to the canonical navigation module.

## Implementation

- Commit: `28e0ff8d71666f18ebf7136eab25db4d197a24a8`
- Pull request: `#91`
- Merge commit: `9f010a0`

Files:

- `docs/08-development/architecture.md`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api-system-components.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-components.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation-system.js`
- `scripts/public-projection.mjs`

## Evidence

- `node --check` passed for all modified JavaScript modules and the projection
  script.
- `git diff --check` passed.
- The cumulative change removed 710 duplicated lines with no application import
  path changes.
- Graphify passed on the pull request.
- The native gate reported 35/36 passing checks. Its failing managed-root
  ownership assertion reproduces unchanged on the exact `origin/main` base
  commit `f9fc83a`, outside this frontend-only diff.
