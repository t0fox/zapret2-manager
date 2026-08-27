---
id: sdd-z2m-editor-platform-2026-08-27
title: "Z2M Editor Platform implementation evidence"
type: evidence
status: current
authority: implementation-evidence
updated: 2026-08-27
publish: false
tags: [editor, codemirror, strategy, resources, verification]
---

# Z2M Editor Platform implementation evidence

## Delivered

- Added the pinned CodeMirror 6 browser IIFE under
  `luci-app-zapret2-manager/.../vendor/z2m-codemirror.js`, exposing only
  `globalThis.Z2MCodeMirrorVendor`. The LuCI package copies the generated
  static asset; no npm or Node runtime is added to the router package.
- Added the shared `z2m-code-editor.js` lifecycle owner. CodeMirror owns the
  normal editor surface; the only textarea is the explicit unavailable-vendor
  fallback with a Russian warning.
- Added Lua and nfqws2 adapters. Completion, lint diagnostics, token help, and
  canonical Asset Registry metadata are CodeMirror extensions backed by the
  existing `Nfqws2Ide` domain functions.
- Moved Strategy editor lifecycle to `z2m-strategy-editor.js` with stable hosts,
  one reusable EditorView, multi-profile switching, profile add/remove, Visual
  and Code projections, circular editing, backend Problems mapping, selection,
  scroll, and undo preservation.
- Migrated Lua/hostlist/IPSet/Hosts text resources to the same editor platform
  while retaining binary resource branches and existing Asset RPC ownership.
- Removed the old Strategy overlay/highlighter/autocomplete DOM implementation,
  old Lua overlay/gutter/tokenizer code, and obsolete CSS. The page retains the
  donor surface and canonical Strategy RPC orchestration.

## Verification

- `npm ci --prefix frontend/editor`: passed; 26 packages installed, 0 npm
  vulnerabilities in the editor package.
- `npm run check --prefix frontend/editor`: passed.
- `npm test --prefix frontend/editor`: 7/7 passed.
- Focused editor contracts (vendor/core/adapters/Strategy/resources/responsive):
  14/14 passed.
- Combined editor, closure, P03, transplant, and UX focused gate: 54/54
  passed.
- Asset tooling/resource/install gate: 24/24 passed.
- Vendor build: passed; generated unminified bundle 823,972 bytes, minified
  bundle 377,499 bytes; source and shipped vendor files are byte-identical.
- LuCI dependency closure: local references and case-sensitive paths passed;
  the six new editor modules are reachable from `app.js`; vendor is checked as
  a nested static asset outside the top-level module closure.
- `docs.mjs verify`: passed.
- Internal Quartz build: passed, 123 input files and 508 emitted files.
- Public production Quartz build and `tests/knowledge/public-leak.test.mjs`:
  4/4 passed.
- `git diff --check`: passed.

## Known boundaries

- The broad Strategy/P03 host command finished 98/106. The eight remaining
  failures are pre-existing outside this change: two healthcheck contract
  expectations, four strategy-pool fallback expectations, one stale donor
  provenance heading expectation, and one missing `z2m-scanner-hub.js` fixture.
  The editor-specific failures were removed by updating contracts to the new
  platform ownership.
- `node scripts/validate-knowledge.mjs` remains non-green only for the known
  unrelated `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md` missing
  frontmatter; that document was not modified.
- No OpenWrt package build, router deployment, or real LuCI/browser acceptance
  was available in this run. Router behavior, production asset loading, and
  the 1280px/approximately 800px visual acceptance remain unverified.
