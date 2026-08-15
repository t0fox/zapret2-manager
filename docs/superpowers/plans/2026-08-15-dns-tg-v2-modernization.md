# DNS and Telegram Proxy v2 Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing DNS and Telegram Proxy functionality through canonical typed contracts and migrate both product pages to those contracts without creating a second runtime writer.

**Architecture:** Add two bounded coordinator layers in the manager backend. The DNS coordinator delegates global, override, and Service DNS mutations to the existing writers; the Telegram Proxy coordinator normalizes Go/Rust state and owns the transactional orchestration around the existing signed provider lifecycle and exact procd runtime. The frontend receives only the new product RPCs through thin adapters and keeps the existing Avatar-derived shell.

**Tech Stack:** OpenWrt ucode, rpcd/ubus, LuCI JavaScript, Node.js `node:test`, shell target probes, existing package Makefiles and ACL JSON.

**Spec:** `docs/superpowers/specs/2026-08-15-dns-tg-v2-modernization-design.md`

## Global Constraints

- `G:\zapret2-manager` is dirty and must not be edited; all implementation is in `G:\z2m-dns-tg-v2`.
- DNS existing writers (`dns-global.uc`, `dns.uc`, `service-dns.uc`, `service-dns-apply-worker.uc`) remain the only DNS mutation owners.
- Telegram Proxy is one product with provider IDs `go` and `rust`; no provider-specific page or duplicate product writer is introduced.
- Preview and read/status operations are pure; Apply is revision-checked and delegates to one owner.
- RPC methods accept bounded typed JSON strings only; no shell commands, arbitrary paths, package names, or init script names are accepted.
- Shared configuration is copied only for fields proven equivalent in both provider implementations; unsupported extensions are preserved as typed provider-specific data or rejected.
- Exact process/service ownership is required; approximate process killing and foreign runtime mutation are forbidden.
- First target read remains read-only; target mutations use exact backup/hash/mode/owner records under `/tmp/z2m-dns-tg-v2-<session>/` and restore the baseline.
- Do not touch M7, WARP/usque, generic tunnels, failover, auto-remediation, Scanner, or Strategy.

---

### Task 1: Establish characterization fixtures and regression inventory

**Files:**
- Create: `tests/fixtures/dns-tg-v2/target-baseline.json`
- Create: `tests/product/dns-tg-v2-characterization.test.mjs`
- Create: `tests/product/dns-tg-v2-fixtures.mjs`
- Modify: `docs/superpowers/specs/2026-08-15-dns-tg-v2-modernization-design.md`

**Interfaces:**
- Consumes: existing DNS/proxy fixture conventions and the read-only target evidence recorded in the spec.
- Produces: deterministic local fixtures for DNS revisions/ownership, Rust-active TG state, Go-not-installed state, and provider-RPC registration classification.

- [ ] **Step 1: Write failing characterization assertions**

  Assert stable DNS provider/profile/service IDs, Service DNS revision `9`, Rust target provider identity, and the distinction between provider RPC source presence and ubus registration.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run `node --test tests/product/dns-tg-v2-characterization.test.mjs`.
  Expected: FAIL because the fixture and canonical characterization helpers do not exist.

- [ ] **Step 3: Add fixture and pure characterization helpers**

  Store only non-secret state. Implement `loadDnsTgBaseline()`, `classifyProviderRpcRegistration()`, and `assertNoSecretFields()` in `tests/product/dns-tg-v2-fixtures.mjs`; fixture values must explicitly represent `selectedProvider`, `installedProviders`, `observedRunningProvider`, `desiredEnabled`, `observedStatus`, and revisions.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run `node --test tests/product/dns-tg-v2-characterization.test.mjs` and record the exit code and test count in the work log.

- [ ] **Step 5: Commit the characterization boundary**

  Run `git add tests/fixtures/dns-tg-v2 tests/product/dns-tg-v2-characterization.test.mjs tests/product/dns-tg-v2-fixtures.mjs docs/superpowers/specs/2026-08-15-dns-tg-v2-modernization-design.md` and commit with `test: characterize dns and telegram proxy v2 baseline`.

### Task 2: Implement the canonical DNS model and coordinator

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/dns-product-cli.uc`
- Create: `tests/product/dns-v2-contract.test.mjs`
- Create: `tests/product/dns-v2-delegation.test.mjs`

**Interfaces:**
- Consumes: `dns-global.uc`, `dns.uc`, `dnsprov.uc`, `service-dns.uc`, `service-dns-apply-worker.uc`.
- Produces: `dns_product_get()`, `dns_product_providers()`, `dns_product_status()`, `dns_product_preview(input)`, `dns_product_validate(input)`, `dns_product_apply(input)`, and `dns_product_rollback(input)` plus CLI subcommands with the same names.

- [ ] **Step 1: Write failing model and purity tests**

  Cover stable IDs, canonical state shape, no raw path identity, no secret leakage, Preview not calling any writer, invalid scope/provider/service rejection, and stale revision rejection.

- [ ] **Step 2: Run the focused DNS tests and verify failure**

  Run `node --test tests/product/dns-v2-contract.test.mjs tests/product/dns-v2-delegation.test.mjs`.
  Expected: FAIL because `dns-product.uc` does not exist.

- [ ] **Step 3: Implement pure normalization and typed errors**

  Add bounded request decoding, scope validation for `global`, `overrides`, and `service_dns`, stable error categories, and canonical projections for desired/applied/observed state. Keep provider/profile/service IDs from the existing catalogs.

- [ ] **Step 4: Implement read, preview, validate, apply, and rollback delegation**

  `get/status/providers` call existing read paths. `preview/validate` call the corresponding existing pure methods. `apply/rollback` dispatch by scope to the existing global/override/Service DNS writers and return ownership/delegation metadata. Never write a new DNS state file.

- [ ] **Step 5: Implement the CLI boundary**

  Use request files for JSON inputs, bounded output, and the same error envelope as the library. No request value becomes a shell fragment.

- [ ] **Step 6: Run the focused DNS tests and verify green**

  Run `node --test tests/product/dns-v2-contract.test.mjs tests/product/dns-v2-delegation.test.mjs`; inspect all failures rather than weakening assertions.

- [ ] **Step 7: Commit the DNS coordinator**

  Commit with `refactor(dns): introduce canonical product contract`.

### Task 3: Expose DNS v2 through rpcd and ACL

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `tests/product/dns-v2-rpc.test.mjs`
- Create: `tests/product/dns-v2-acl.test.mjs`

**Interfaces:**
- Consumes: the DNS product CLI from Task 2.
- Produces: `dns_product_get`, `dns_product_providers`, `dns_product_status`, `dns_product_preview`, `dns_product_validate`, `dns_product_apply`, and `dns_product_rollback` on the canonical `zapret2-manager` object with read/write ACL separation.

- [ ] **Step 1: Write failing RPC and ACL tests**

  Assert every new method is registered exactly once, has `edit: string` only where required, uses the bounded CLI path, and is present in the correct read or write ACL group.

- [ ] **Step 2: Run the focused tests and verify failure**

  Run `node --test tests/product/dns-v2-rpc.test.mjs tests/product/dns-v2-acl.test.mjs`.
  Expected: FAIL because the methods are not registered.

- [ ] **Step 3: Add RPC wrappers and ACL entries**

  Reuse the repository's existing `cli_action`/`cli_edit_action` conventions and add only the canonical methods. Leave all legacy methods available for M6 and compatibility.

- [ ] **Step 4: Run the focused tests and verify green**

  Run the same focused command and then `node --check tests/product/dns-v2-rpc.test.mjs`.

- [ ] **Step 5: Commit the DNS RPC surface**

  Commit with `feat(dns): expose canonical product rpc`.

### Task 4: Implement the canonical Telegram Proxy state model

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc`
- Create: `tests/product/tg-v2-contract.test.mjs`
- Create: `tests/product/tg-v2-provider-model.test.mjs`

**Interfaces:**
- Consumes: `proxy.uc`, `proxycfg.uc`, `proxy-provider.uc`, `proxy-provider-preflight.uc`, `proxy-provider-cli.uc`, package metadata, and exact init/procd identity.
- Produces: `tg_product_get()`, `tg_product_catalog()`, `tg_product_status()`, `tg_product_preview(input)`, `tg_product_validate(input)`, `tg_product_apply(input)`, and typed provider lifecycle helpers.

- [ ] **Step 1: Write failing canonical state tests**

  Assert catalog IDs exactly `go` and `rust`; selected, installed, observed, desired, status, shared config, provider-specific config, version, readiness, and health are separate fields; Rust-active/Go-absent fixture is represented truthfully.

- [ ] **Step 2: Run the focused TG tests and verify failure**

  Run `node --test tests/product/tg-v2-contract.test.mjs tests/product/tg-v2-provider-model.test.mjs`.
  Expected: FAIL because the canonical module does not exist.

- [ ] **Step 3: Add the fixed provider catalog and normalization**

  Map `go` and `rust` to verified package IDs, binary/service identity, config ownership, supported fields, and readiness probes. Return package/version facts without inventing latest versions.

- [ ] **Step 4: Add canonical read/status and bounded config validation**

  Read existing provider state and runtime evidence; detect stopped, running selected, mismatch/foreign, unhealthy, missing dependency, and not-installed states. Strip secret content from returned configuration.

- [ ] **Step 5: Run focused TG tests and verify green**

  Run the two focused test files and verify all state distinctions are asserted.

- [ ] **Step 6: Commit the TG canonical model**

  Commit with `refactor(proxy): introduce canonical telegram proxy product model`.

### Task 5: Add transactional Go/Rust lifecycle and rollback

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc`
- Create: `tests/product/tg-v2-switch.test.mjs`
- Create: `tests/product/tg-v2-runtime-ownership.test.mjs`
- Create: `tests/fixtures/tg-v2/go-active.json`
- Create: `tests/fixtures/tg-v2/rust-active.json`
- Create: `tests/fixtures/tg-v2/switch-failure.json`

**Interfaces:**
- Consumes: Task 4 canonical provider model and existing signed provider lifecycle.
- Produces: `tg_product_preview`, `tg_product_validate`, `tg_product_switch`, `tg_product_install`, `tg_product_update`, `tg_product_remove`, `tg_product_start`, `tg_product_stop`, and `tg_product_restart` with typed transaction results.

- [ ] **Step 1: Write failing switch and rollback tests**

  Use an injected fixture executor with exact service/process identity. Cover Go→Rust and Rust→Go Preview purity, successful switch, shared config preservation, provider-specific rejection, failed target health, target cleanup, old-provider restoration, rollback failure, and foreign-runtime refusal.

- [ ] **Step 2: Run the focused switch tests and verify failure**

  Run `node --test tests/product/tg-v2-switch.test.mjs tests/product/tg-v2-runtime-ownership.test.mjs`.
  Expected: FAIL because switch orchestration is not implemented.

- [ ] **Step 3: Implement preview/validate and runtime snapshot**

  Validate target ID against the catalog, compare revision, snapshot config hash and runtime identity, and reject ambiguity before stopping anything. Preview must call no executor mutation method.

- [ ] **Step 4: Implement exact stop/activate/health/commit sequence**

  Delegate install/update/remove to the existing provider lifecycle and start/stop/restart to exact procd identity. Verify process executable, service state, listener address/port, and provider identity before committing selection.

- [ ] **Step 5: Implement failure cleanup and rollback**

  Cleanup only target-owned runtime, restore shared config through the existing config owner, restore the prior provider through the exact lifecycle, reread health, and return `switch_failed` or `rollback_failed` with nested evidence.

- [ ] **Step 6: Run focused switch tests and verify green**

  Run the two focused test files; also run `node --test tests/product/tg-v2-contract.test.mjs tests/product/tg-v2-provider-model.test.mjs` for model regressions.

- [ ] **Step 7: Commit transactional lifecycle**

  Commit with `feat(proxy): add transactional go rust provider switching`.

### Task 6: Expose canonical Telegram Proxy RPC and repair registration coverage

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc`
- Create: `tests/product/tg-v2-rpc.test.mjs`
- Create: `tests/product/tg-v2-acl.test.mjs`
- Create: `tests/product/tg-v2-provider-registration.test.mjs`

**Interfaces:**
- Consumes: Task 5 CLI and the existing provider-object compatibility file.
- Produces: canonical `tg_product_*` methods on `zapret2-manager`; provider-object compatibility methods remain available but are not used by the new UI.

- [ ] **Step 1: Write failing RPC/ACL/registration tests**

  Assert canonical method registration, bounded input signatures, read/write ACL separation, absence of arbitrary package/path fields, and packaging inclusion of the provider-object source.

- [ ] **Step 2: Run focused tests and verify failure**

  Run `node --test tests/product/tg-v2-rpc.test.mjs tests/product/tg-v2-acl.test.mjs tests/product/tg-v2-provider-registration.test.mjs`.

- [ ] **Step 3: Register canonical methods and preserve compatibility object**

  Add main-object wrappers through the canonical CLI. Keep the old provider object as compatibility-only. Ensure package installation copies the object and post-install reloads rpcd where required by existing package conventions; do not create a second lifecycle writer.

- [ ] **Step 4: Run focused tests and verify green**

  Run the focused command and `git diff --check`.

- [ ] **Step 5: Commit canonical TG RPC**

  Commit with `feat(proxy): expose canonical telegram proxy rpc`.

### Task 7: Migrate DNS UI to the canonical adapter

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-product.js`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-product-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-page.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/dns-v2-ui.test.mjs`

**Interfaces:**
- Consumes: canonical DNS RPC methods from Task 3 and existing Avatar UI primitives.
- Produces: a page → thin DNS adapter → canonical RPC dependency graph with overview, global, providers/profiles, Service DNS, diagnostics, loading, empty, confirmation, and typed error states.

- [ ] **Step 1: Write failing UI contract tests**

  Assert the page imports only the canonical DNS adapter, does not declare legacy DNS RPC methods, uses stable IDs rather than array positions/display names, and renders Apply through Preview/Validate feedback.

- [ ] **Step 2: Run the focused UI test and verify failure**

  Run `node --test tests/ui/dns-v2-ui.test.mjs`.

- [ ] **Step 3: Add API declarations and pure UI model**

  Add canonical RPC declarations, normalized status/error helpers, and stable-ID rendering model. Keep mutation handlers free of business logic beyond presentation and request shaping.

- [ ] **Step 4: Replace DNS page runtime calls**

  Rebuild the internal DNS panes on existing shared cards/modals/toasts, preserving the top navigation and Graphite CSS. Route global and Service DNS actions through the canonical adapter only.

- [ ] **Step 5: Run focused UI test and syntax checks**

  Run `node --test tests/ui/dns-v2-ui.test.mjs`; run `node --check` on each changed JavaScript file.

- [ ] **Step 6: Commit DNS UI migration**

  Commit with `refactor(ui): migrate dns page to canonical product api`.

### Task 8: Migrate Telegram Proxy UI to the canonical adapter

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-tg-product.js`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-tg-product-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/tg-v2-ui.test.mjs`

**Interfaces:**
- Consumes: canonical TG RPC methods from Task 6 and shared Avatar UI primitives.
- Produces: first-class Go/Rust selector, summary card, overview/configuration/provider lifecycle/activity sections, and Preview + shared confirmation modal switch flow.

- [ ] **Step 1: Write failing TG UI tests**

  Assert selected/installed/observed status labels are distinct, both provider IDs render from canonical catalog, switch confirmation shows shared-config preservation and rollback, and legacy provider API is not on the runtime path.

- [ ] **Step 2: Run the focused UI test and verify failure**

  Run `node --test tests/ui/tg-v2-ui.test.mjs`.

- [ ] **Step 3: Add canonical API/model adapter**

  Implement read/preview/validate/apply/switch/install/update/remove/start/stop/restart calls with typed error projection. Never parse stderr or infer install state from a config-file boolean.

- [ ] **Step 4: Replace proxy page runtime path**

  Keep the existing shell and shared components while making provider choice and lifecycle state immediately visible. Use only shared modal confirmation; do not use browser-native confirm.

- [ ] **Step 5: Run focused UI tests and syntax checks**

  Run `node --test tests/ui/tg-v2-ui.test.mjs`; run `node --check` on all changed JavaScript files.

- [ ] **Step 6: Commit TG UI migration**

  Commit with `refactor(ui): migrate telegram proxy page to canonical product api`.

### Task 9: Complete docs, local gates, and target acceptance

**Files:**
- Create: `docs/dns-v2-architecture.md`
- Create: `docs/telegram-proxy-v2-architecture.md`
- Modify: `docs/architecture.md`
- Modify: `docs/contracts/ubus.md`
- Modify: `docs/frontend-backend-contract.md`
- Create: `tools/dns-tg-v2-target-acceptance.sh`
- Create: `tests/product/dns-tg-v2-docs.test.mjs`

**Interfaces:**
- Consumes: all canonical backend/UI contracts and the existing deployment/verification tooling.
- Produces: explicit ownership/migration docs, bounded target acceptance script, and final gate evidence.

- [ ] **Step 1: Write failing docs and acceptance tests**

  Assert the docs state one TG product/two providers, DNS single-writer ownership, migration read-only behavior, provider-object classification, and target evidence levels. Assert the target script records path/hash/mode/owner before deployment and restores baseline.

- [ ] **Step 2: Run focused docs tests and verify failure**

  Run `node --test tests/product/dns-tg-v2-docs.test.mjs`.

- [ ] **Step 3: Write docs and bounded target script**

  The script must capture DNS/TG/M6 baseline, stage files only under `/tmp/z2m-dns-tg-v2-<session>/`, perform read-only canonical calls first, use one reversible Service DNS canary, classify Go availability from signed package lifecycle, and restore the captured state. It must report `ROUTER_E2E: NOT RUN` rather than fabricating a pass when a live prerequisite is unavailable.

- [ ] **Step 4: Run full relevant local gates**

  Run `node --test tests/product/dns-tg-v2-characterization.test.mjs tests/product/dns-v2-contract.test.mjs tests/product/dns-v2-delegation.test.mjs tests/product/dns-v2-rpc.test.mjs tests/product/dns-v2-acl.test.mjs tests/product/tg-v2-contract.test.mjs tests/product/tg-v2-provider-model.test.mjs tests/product/tg-v2-switch.test.mjs tests/product/tg-v2-runtime-ownership.test.mjs tests/product/tg-v2-rpc.test.mjs tests/product/tg-v2-acl.test.mjs tests/product/tg-v2-provider-registration.test.mjs tests/ui/dns-v2-ui.test.mjs tests/ui/tg-v2-ui.test.mjs tests/product/dns-tg-v2-docs.test.mjs`.

  Then run the current DNS/Service DNS/proxy/provider/M6/M2/Strategy/Scanner/M5/RPC/UI/native suites discovered from the repository, `git diff --check`, and JavaScript syntax checks. Record exact commands, exit codes, and observed counts.

- [ ] **Step 5: Run target acceptance read-only phase**

  Run `ROUTER=root@192.168.1.1 SESSION=dns-tg-v2-20260815 tools/dns-tg-v2-target-acceptance.sh read-only`; compare canonical state to the saved baseline and verify target RPC registration after a bounded rpcd reload only if the script has already backed up affected files.

- [ ] **Step 6: Run reversible target canaries when prerequisites are present**

  Perform DNS Preview/Validate/Apply/Status/Rollback on a dedicated safe Service DNS selection and restore revision `9`. Exercise TG read/status/config and Go lifecycle only through the signed package/provider owner if the artifact is available; otherwise record the exact external reason and retain fixture switch evidence.

- [ ] **Step 7: Integrate latest main and rerun changed gates**

  Run `git fetch origin`, inspect incoming commits, merge/rebase the branch onto the new `origin/main` without resetting user work, rerun affected local and target gates, and resolve conflicts semantically.

- [ ] **Step 8: Commit docs and acceptance evidence**

  Commit with `test: close dns and telegram proxy v2 acceptance`.

- [ ] **Step 9: Integrate and push only after fresh verification**

  Verify `git status`, `git diff --check`, all required gates, and target baseline restoration. Fast-forward/merge into `main` without force push, push `main`, verify `git rev-parse origin/main`, and report BASE_HEAD, INTEGRATED_BASE_HEAD, FINAL_HEAD, commits, target files/backups, and every gate command with exit code/result.
