# DNS and Telegram Proxy v2 Modernization Design

**Status:** approved for implementation

**Base:** `origin/main` at `ace945a756aea596a85c7f83fa74d771cca172b6`

**Scope:** modernize the existing DNS and Telegram Proxy product areas behind canonical backend contracts and the existing Avatar-derived LuCI UI. This design preserves working low-level owners and excludes M7 cross-flow, WARP/usque, generic tunnels, failover, auto-remediation, Scanner refactoring, and Strategy refactoring.

## Evidence baseline

The implementation worktree is `G:\z2m-dns-tg-v2`; the dirty checkout `G:\zapret2-manager` is not part of this change.

The live OpenWrt target was inspected read-only before any mutation:

- Global DNS reports `mode=system`, draft/applied revision `0`, dnsmasq running, and no manager-owned global overrides.
- Service DNS reports applied revision `9`, effective backend `dnsmasq-uci`, rollback available, and existing selections for ChatGPT/OpenAI, Discord, Flowseal Discord, and TikTok.
- Telegram Proxy is Rust-backed and running as PID `2976` on `192.168.1.1:1443`; the target has no installed Go provider.
- The provider RPC source file is present, owned by `zapret2-manager-0.1.0-r146`, and passes `ucode -c`; the separate provider ubus object is absent from `ubus list`. This is classified as a stale RPC registration/deployment gap to verify with a bounded rpcd reload during target acceptance, not as a reason to add a parallel provider mechanism.

Secrets and secret file contents are not part of the canonical model or test output.

## Product boundaries

### DNS

The new DNS product facade is a coordinator/API layer only. It reads and normalizes state from the existing owners:

- `dns-global.uc` remains the global DNS writer.
- `dns.uc` remains the override writer.
- `service-dns.uc` and `service-dns-apply-worker.uc` remain the Service DNS writer and async worker.
- M6 continues to call the existing Service DNS authority; the facade never writes its state file, dnsmasq UCI, or runtime files directly.

No new duplicate DNS store is introduced. Stable identities remain existing provider, profile, and service IDs. The canonical product state contains desired/draft, applied, observed runtime, revision, ownership, and rollback information while preserving the underlying stores.

The frontend-facing DNS RPC surface is:

- `dns_product_get`: coherent read model with global, provider, profile, service, and runtime state.
- `dns_product_providers`: typed provider/profile catalog without secrets or raw paths.
- `dns_product_status`: reread of observed state and ownership.
- `dns_product_preview`: read-only diff for a bounded typed edit.
- `dns_product_validate`: typed validation without mutation.
- `dns_product_apply`: revision-checked mutation delegated by scope to the existing writer.
- `dns_product_rollback`: delegated rollback where the selected scope supports it.

The edit schema has a bounded `scope` (`global`, `overrides`, or `service_dns`) and rejects arbitrary commands, paths, or unknown service/provider IDs. Errors are normalized into the repository's existing error shape with stable categories for invalid input, stale revision, missing dependency, unavailable provider/runtime, apply failure, foreign state, and internal failure.

### Telegram Proxy

Telegram Proxy is one product with two provider IDs: `go` and `rust`. The canonical facade owns product orchestration but delegates package installation/removal and provider-specific lifecycle to the existing signed-feed/provider lifecycle implementation.

The canonical read model distinguishes:

- `selectedProvider`: desired provider identity;
- `installedProviders`: per-provider installed/version/compatibility state;
- `observedRunningProvider`: exact runtime identity derived from service, process, binary, and listener evidence;
- `desiredEnabled` and `observedStatus`;
- `sharedConfig` and provider-specific typed extensions;
- readiness, health, dependency, and typed error information.

The frontend-facing TG RPC surface is:

- `tg_product_get`, `tg_product_catalog`, `tg_product_status`;
- `tg_product_preview`, `tg_product_validate`, `tg_product_apply` for bounded config/provider edits;
- `tg_product_install`, `tg_product_update`, `tg_product_remove`;
- `tg_product_switch`, `tg_product_start`, `tg_product_stop`, `tg_product_restart`.

Provider IDs are validated against the fixed catalog. No method accepts a shell command, arbitrary path, package name, or init script. The old provider object remains compatibility/internal; the new main manager object is the only frontend authority.

The switch transaction is:

1. read and snapshot canonical state, runtime identity, config hashes, and selected provider;
2. preview and validate target provider readiness and shared/provider-specific config;
3. refuse foreign or ambiguous runtime ownership;
4. stop the exact current service/provider and verify it stopped;
5. activate the target using the existing provider lifecycle;
6. reread exact process/listener/service identity and perform health/readiness checks;
7. commit selected provider only after successful verification.

On failure, the facade removes only target-owned partial runtime, restores the prior shared configuration, restarts the previous provider through the exact service owner, verifies health, and returns a typed switch/rollback result. A failed rollback is reported separately and never hidden as a normal start error. No approximate process killing is permitted.

Common configuration is limited to fields proven equivalent in both provider implementations. Unsupported provider-specific fields remain in typed extensions and are not silently copied to the other provider.

## Frontend architecture

DNS and TG pages use the existing Avatar-derived shell, horizontal top navigation, Graphite theme, cards, badges, modals, toasts, loading states, and normalized error states. Each page calls a thin canonical adapter, and each adapter calls only the new canonical RPC methods.

DNS is organized into overview/runtime, global DNS, providers/profiles, Service DNS, and diagnostics sections. TG presents provider choice as a first-class Go/Rust selector and separates overview, configuration, provider lifecycle, and activity. Switching always uses preview plus the shared confirmation modal and displays preservation and rollback behavior.

Legacy frontend adapters/models that are no longer on the runtime path are classified and removed only after import tests are updated. Low-level DNS writers, the Service DNS worker, provider lifecycle, and init/procd integration are retained as internal implementation details.

## Migration and target safety

The first canonical read is strictly read-only and must not rewrite state, restart services, change DNS, or select a provider. Existing DNS state, Service DNS selections, TG state, and configuration are imported from their current stores without destructive migration.

Target acceptance uses a session directory under `/tmp/z2m-dns-tg-v2-<session>/`. Before any deployed file is replaced, record path, SHA-256, mode, and owner and create an exact backup. The target baseline is restored after reversible canaries. Rust target status is required; Go and live switching are proven when the signed package/artifact is available through the normal lifecycle. If Go is externally unavailable, fixture-based switch and rollback remain mandatory and target unavailability is reported with the exact dependency reason.

## Verification contract

Tests cover canonical models, stable IDs, preview purity, validation, stale revisions, apply/status/reread, dependency and foreign-state errors, DNS writer delegation, M6 compatibility, provider catalog, selected-versus-installed state, both switch directions, rollback, config preservation, exact process ownership, RPC, ACL, UI lifecycle, JS syntax, product/native gates, documentation freshness, and `git diff --check`.

Target evidence is reported separately as static/local, target runtime, and LAN/live evidence. `ROUTER_E2E: NOT RUN` is used when the stronger live gate cannot be completed; no fixture or local test is promoted to target PASS.
