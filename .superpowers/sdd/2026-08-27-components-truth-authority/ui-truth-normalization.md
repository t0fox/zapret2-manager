# Components / Resources truth normalization

Date: 2026-08-27
Base after requested pull: `268b554b805ceabf8e0b94fb24407e3e5a7f5daa`
Implementation commit: `dbec4e7a96b4bf1de46e6fcf701dfbc02d71f110`

## Outcome

Engine, Z2K Core, Components, Resources, Engine management, and Home now consume one explicit presentation contract. Runtime health, artifact identity, installed release, available release, update state, compatibility, timestamp, and provenance remain independent. Technical commits such as `p-*` are not rendered as product releases. Z2K installed-release authority is an activation receipt first, bounded manifest inference second, otherwise explicit unknown/inconsistent.

The update presentation mapper is canonical for `current`, `update-available`, `review-required`, `rebase-required`, `integration-required`, `broken`, `failed`, and `unknown`. Legacy aliases are accepted only at the boundary. Components owns component lifecycle; Resources remains the Asset Registry view and does not become a second product catalog.

## Runtime delivery

The reviewed closure was deployed to `root@192.168.1.1` with the repository deployment script, backup enabled at `/tmp/z2m-deploy/backup`, and `rpcd` reloaded. Thirteen runtime files were compared local -> staged -> installed; all final installed hashes matched the local commit (`HASH_BAD=0`). No user data, service configuration, or runtime strategy was changed.

Read-only router evidence after deployment:

- `engine_releases`: `ok=true`, `updateState=current`, installed and available `v1.0.4`, both `vanilla-bol-van-release`.
- `engine_status`: `ok=true`, service state `running`.
- `resources_status`: `ok=true`, Z2K `updateState=review-required`; installed release is explicitly `unknown` because the current registry has no valid activation receipt or unique known-manifest match. The technical provenance commit remains `p-79.18` and is not used as a release identity.
- `status_fast`: `serviceState=running`, runtime process and NFQUEUE evidence present.

The embedded Codex browser reached LuCI at `http://192.168.1.1/cgi-bin/luci/` but showed `Authorization Required`; no credentials were entered. Browser DOM/viewport and console acceptance therefore remain unverified pending an authenticated in-app browser session.

## Verification

Passing focused gate after deployment:

```text
node --test --test-concurrency=1 [17 Components/Resources/Dashboard files]
127 pass, 0 fail
```

Additional passing gates:

- components truth/resource focused subset: `31 pass, 0 fail`;
- installed-release authority source contract: `4 pass, 0 fail`;
- JavaScript syntax check for all changed/new JS modules: `8 pass, 0 fail`;
- `git diff --check`: clean;
- package wildcard contract confirms the new mapper is included by the LuCI Makefile.

The attempted aggregate run covered 244 Node test files excluding Vitest-only files. It was stopped by the bounded watchdog after about five minutes while `tests/product/avatar-strategy-apply.test.mjs` was waiting on unavailable `/opt/ucode/bin/ucode`; it is not a full-suite PASS. The frontend Vitest gate was not run because `frontend/editor/node_modules` is absent.

Known baseline/environment limits, not introduced by this change:

- `node scripts/validate-knowledge.mjs` exits 1 on existing `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md: missing frontmatter`.
- `node scripts/release/verify-artifacts.mjs` exits 1 because the checkout contains zero built APKs while the verifier expects three.
- The supplementary 16-file run was `70 pass / 12 fail`: eight UCODE-dependent failures due to missing host binary, and four post-pull-main source-contract drifts confirmed present in `HEAD` before this commit.

## Files in implementation commit

```text
docs/03-products/components.md
docs/03-products/resources.md
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js
tests/fixtures/components-truth/cases.json
tests/product/system-components-z2k-contract.test.mjs
tests/product/z2k-installed-release-authority.test.mjs
tests/product/z2m-resources-model.test.mjs
tests/ui/component-status-semantics.test.mjs
tests/ui/components-truth-normalization.test.mjs
tests/ui/health-desync-regression.test.mjs
tests/ui/system-components-model.test.mjs
tests/ui/update-presentation.test.mjs
zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc
zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc
zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc
```

The unrelated untracked `` directory was preserved and is not part of either commit.
