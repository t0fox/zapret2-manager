---
task: apk-only-workflow-removal
status: delivered
implementation_commit: e112f4dc
---

# APK-only workflow removal

## Scope

The repository now keeps only `.github/workflows/apk-build.yml`. The clean-install,
knowledge, native-gate, Quartz Pages, and RC workflows were removed. The RC-only
`scripts/release/check-tag.mjs` helper was removed as well. Local test scripts,
release build tooling, package definitions, and runtime code were preserved.

Documentation and contracts were updated so they no longer reference removed
workflow paths. The release contract now asserts that the APK workflow is the
only repository workflow.

## Verification

- `node scripts/validate-knowledge.mjs` — PASS.
- `node --test tests/release/workflow-contract.test.mjs tests/knowledge/deepwiki-config.test.mjs tests/knowledge/quartz-pages.test.mjs` — 7/7 PASS.
- `wsl.exe -- bash -lc "cd /mnt/g/zapret2-manager && bash -n scripts/release/build-apk.sh"` — exit 0.
- `git diff --check` — PASS.
- No GitHub Actions run was requested; only the APK workflow remains.

The existing release contract baseline still reports the pre-existing package
identity mismatch (`luci-app-zapret2-manager` is `0.1.0-r153`, while the other
two package Makefiles are `0.1.0-r151`). The existing native package-helper
baseline also reports runtime mkdir patterns unrelated to this task. Neither
baseline was changed or hidden.

## Files changed in implementation commit

- `.devin/wiki.json`
- `.github/workflows/{clean-install-regression.yml,knowledge-ci.yml,native-gate.yml,quartz-pages.yml,release-rc.yml}` (deleted)
- `README.md`
- `docs/00-home/current-state.md`
- `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md`
- `docs/08-development/apk-build.md`
- `scripts/public-projection.mjs`
- `scripts/release/check-tag.mjs` (deleted)
- `tests/knowledge/deepwiki-config.test.mjs`
- `tests/knowledge/quartz-pages.test.mjs`
- `tests/native/package-helper.test.mjs`
- `tests/product/engine-producer-retirement.test.mjs`
- `tests/release/workflow-contract.test.mjs`
