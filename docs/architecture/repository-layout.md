# Repository layout and ownership

This document describes the repository as it exists during the OpenWrt-native structural migration. It is intentionally conservative: existing public RPC names and working legacy behavior remain compatible while implementation ownership moves behind domain boundaries.

## Top-level ownership

- `.github/` — CI only. CI must call repository scripts or focused tests; it does not own product behavior.
- `docs/` — current contracts and architecture. Historical task plans, generated reports and acceptance artifacts do not belong in `main`.
- `scripts/` — reusable build/test/release/development tooling. One-off debug and bisect scripts stay out of `main`.
- `tests/` — preserved behavioral, contract, UI, integration and native coverage. Tests are migrated by purpose only when path changes are safe and reviewable.
- `zapret2-manager/` — OpenWrt backend package and native helper.
- `luci-app-zapret2-manager/` — LuCI JavaScript frontend, menu and ACL data. It does not own backend business logic.
- `zapret2-manager-full/` — target meta-package.
- `tg-ws-proxy-rs/`, `tg-ws-proxy-go/` — optional Telegram proxy providers. They remain separate from the manager package.

Generated APK/IPK/build output, screenshots, agent state and temporary audit output are not source.

## Dependency direction

```text
LuCI
  ↓
RPC / rpcd facade
  ↓
domain modules
  ↓
core abstractions
  ↓
native / OpenWrt primitives
```

Forbidden dependencies:

- `core -> LuCI`
- C helper -> DNS/Telegram/strategy/routing/UI business logic
- DNS -> Telegram internals
- Telegram -> DNS internals
- future WARP -> Telegram internals
- domain modules -> arbitrary frontend code

Allowed domain coupling is through a public owner API, for example DNS/Telegram/WARP -> routing public API once routing ownership is introduced.

## Native helper

`zapret2-manager/src/z2m-core-helper/` is the narrow privileged filesystem primitive layer. It owns fixed-root validation, descriptor-relative traversal, stat/read, SHA-256, private mkdir and atomic-write primitives. It is not the application backend and must not absorb DNS, Telegram, routing or UI policy.

The current contracts are:

- `docs/contracts/native-backend-v1.md`
- `docs/contracts/z2m-canonical-json-v1.md`

## Backend domain boundaries

The installed backend root is `zapret2-manager/files/usr/libexec/zapret2-manager/`.

### `core/`

Currently contains shared result/error primitives. Legacy state and transaction implementations remain at their existing paths until they can be moved without changing schemas or mutation semantics.

### `dns/`

Current structural mapping:

| Old public path | Domain implementation | Ownership |
| --- | --- | --- |
| `dns.uc` | `dns/overrides.uc` | manager-owned DNS overrides and apply/rollback |
| `dnsprov.uc` | `dns/providers.uc` | provider discovery and diagnostics |
| `service-dns.uc` | `dns/services.uc` | per-service DNS model, queue/status/apply contracts |
| `dns-global.uc` | `dns/legacy-global.uc` | transitional mixed resolver/WAN/cache/hijack implementation |

The old root modules are compatibility facades and keep their public export names. Existing CLI and rpcd paths therefore remain unchanged.

`dns/profiles-draft.uc` is a transitional dependency bridge to the existing state implementation; it does not create a second state format.

`service-dns-apply-worker.uc` intentionally remains at the legacy root path for now because `service-dns` starts it by absolute installed path. Moving it is a later focused migration that must update process launch, tests and recovery behavior together.

`dns/legacy-global.uc` is deliberately not named `resolver.uc`: the current code mixes resolver mode, provider selection, dnsmasq UCI, WAN peerdns, cache policy and hijack/firewall behavior. Splitting those responsibilities is semantic work and is not hidden inside this structural move.

### `telegram/`

`proxycfg.uc -> telegram/proxycfg.uc` is currently a move behind a compatibility facade. The implementation remains whole because it currently owns config, validation, preview/apply/rollback, lifecycle, autostart, secret rotation, health, logs and tg:// link behavior. Future extraction of config/provider/lifecycle/health/secret/link modules must preserve the existing security invariants and RPC behavior.

### `jobs/`

`jobs.uc -> jobs/legacy.uc` is the current compatibility boundary. The implementation still combines generic job storage/lifecycle with BlockCheck and health-matrix orchestration, so it is not falsely split into queue/status/worker files yet. `jobs/catalog.uc` is a transitional bridge to the existing catalog owner.

### `zapret/`, `system/`, `routing/`, `warp/`

These namespaces are not created as empty placeholders. Existing responsibilities will move only after their import/absolute-path/RPC/test references are mapped. In particular, routing ownership must be introduced without silently changing current firewall or Service DNS behavior. WARP remains future usque/MASQUE scope and has no fake implementation.

## Public compatibility boundary

The following remain stable during this refactor:

- installed rpcd plugin names;
- public ubus/RPC method names;
- existing `*-cli.uc` installed paths used by rpcd;
- state schemas and existing state file locations unless a dedicated migration explicitly changes them;
- Telegram provider package identities;
- DNS and Telegram behavior.

Pattern:

```text
legacy/public module path
        ↓
compatibility facade
        ↓
domain implementation
```

Facades are removed only in a later explicit breaking/changeover migration after every caller is updated and parity is verified.

## Tooling

Reusable test tooling lives in `scripts/test/`. Other old `tools/` content is classified before migration:

- reusable generator/build logic -> `scripts/build/` with repository-root resolution updated;
- release/deploy logic -> `scripts/release/` only if still current and non-target-specific;
- developer diagnostics -> `scripts/dev/` only if generally reusable;
- one-off `bisect*`, emergency `fix-*`, hard-coded router debug scripts and obsolete manual APK workarounds -> not restored to `main`.

The historical manual APK builder is obsolete as a package-build workaround because the current `zapret2-manager/Makefile` builds `z2m-core-helper` with the OpenWrt target toolchain and no longer hard-depends on building the zapret2 engine.

## Tests

No test coverage is intentionally dropped by this structural migration. The pre-cleanup test tree has been restored. Existing test paths are kept while tooling/module paths are migrated; tests are then updated in the same logical batch as the path they exercise.

Long-term organization may converge toward contract/unit/native/integration/target groups, but mass-moving tests solely for visual symmetry is not a goal.

## Migration map

Completed structural moves:

```text
tools/run-all-tests.sh
→ scripts/test/run-all-tests.sh
→ runner root calculation and README/CI references

tools/gate-ucode-compile.sh
→ scripts/test/gate-ucode-compile.sh
→ runner root calculation; scan one-level domain subdirectories

dns.uc
→ dns/overrides.uc
→ root dns.uc facade; dns-cli/rpcd unchanged

dnsprov.uc
→ dns/providers.uc
→ root dnsprov.uc facade; existing callers unchanged

service-dns.uc
→ dns/services.uc
→ root service-dns.uc facade; worker path intentionally unchanged

dns-global.uc
→ dns/legacy-global.uc
→ root dns-global.uc facade; semantic split deferred

proxycfg.uc
→ telegram/proxycfg.uc
→ root proxycfg.uc facade; proxy-cli/rpcd unchanged

jobs.uc
→ jobs/legacy.uc
→ root jobs.uc facade; jobs-cli/rpcd unchanged
```

Pending, requiring focused reference mapping before movement:

- remaining reusable catalog/StressOzz tooling from old `tools/`;
- system/service/status ownership;
- zapret profiles/lists/apply/runtime grouping;
- routing ownership/reconcile boundary;
- Service DNS worker installed-path migration;
- gradual Telegram `proxycfg` decomposition;
- common state/transaction boundaries without schema rewrite;
- test directory reorganization after path-based contracts are stable.

## Change rule

For structural work prefer:

```text
move + compatibility + focused verification
```

over:

```text
rewrite from scratch
```

A move must not be combined with an unrelated semantic rewrite or formatting wave. When behavior must change, it belongs in a separately reviewable change with its own tests and migration notes.
