# zapret2 engine single-upstream audit

Status: architectural cleanup in progress; Avatar UI parity and P02 are paused.

## Root cause

The backend rewrite did not replace the original engine ownership boundary. Commit
`a2038ec8` introduced `providers/remittor.uc` and `providers/andrevich.uc` as
package contracts, while the later lifecycle commits reused that registry through
`engine-providers.uc`. The lifecycle rewrite added the official `bolvan` adapter,
but kept the generic adapter and selected-provider model. The result was a
single visible default backed by a multi-upstream runtime.

## Dependency graph before cleanup

```text
engine RPC
  -> engine-cli.uc
    -> engine-manager.uc
      -> engine-providers.uc
        -> providers/bolvan.uc
        -> providers/remittor.uc
        -> providers/andrevich.uc
      -> engine-operation-worker.sh
        -> provider/channel/candidate fields
        -> bol-van tar.gz, 1andrevich APK, Remittor ZIP branches
engine UI
  -> z2m-api.js engine_providers/check_updates/install/remove
  -> z2m-engine(-panel).js provider picker and switch action
state
  -> /etc/zapret2-manager/engine-provider.json
     { schema: engine-provider.v1, provider, ... }
package
  -> Makefile conffiles engine-provider.json
tests/docs
  -> provider selection, provider RPC and third-party provenance contracts
```

Classification:

| Component | Classification | Reason |
| --- | --- | --- |
| `engine-providers.uc` | LEGACY_WRAPPED | Generic adapter/registry, provider selection, provider state and third-party metadata remained after the rewrite. |
| `providers/remittor.uc` | LEGACY_REUSED | Active metadata, asset and installed detection adapter. |
| `providers/andrevich.uc` | LEGACY_REUSED | Active metadata, APK key and installed detection adapter. |
| `providers/bolvan.uc` | LEGACY_WRAPPED | Correct official release logic, but expressed as a provider adapter. |
| `engine-operation-worker.sh` | LEGACY_WRAPPED | Transactional lifecycle is reusable; source/package branches are not. |
| `engine-manager.uc` | LEGACY_WRAPPED | Durable jobs and rollback are reusable; provider-shaped public job/state are not. |
| engine RPC | LEGACY_WRAPPED | RPC exposed `engine_providers` and provider/channel arguments. |
| engine UI | LEGACY_WRAPPED | Provider picker and switch-provider action were still normal UI paths. |
| `engine-provider.json` | LEGACY_REUSED | Persisted selected provider and provider schema. |
| current official embedded tar flow | NEW_CANONICAL | `bol-van/zapret2` embedded release, checksum and Z2M-owned runtime paths. |
| runtime/status observer | NEW_CANONICAL | Observes the installed payload and one nfqws2 runtime contract. |
| migration detector | MIGRATION_ONLY | Read-only recognition of historical package provenance. |

## Cleanup contract

The active engine graph after cleanup is:

```text
engine RPC
  -> engine-manager.uc
    -> engine-catalog.uc
      -> bol-van/zapret2 GitHub Releases only
      -> engine-legacy-detect.uc (read-only historical evidence only)
    -> engine-operation-worker.sh (official tar.gz only)
engine UI
  -> releases/status/check(version)/install(version)/update(version)
     /downgrade(version)/reinstall(version)/uninstall()/operation_status(id)
state
  -> /etc/zapret2-manager/engine-state.json
     { schema, installedOrigin, installedRelease, ... }
```

`installedOrigin` is historical evidence (`OFFICIAL`, `LEGACY_REMITTOR`,
`LEGACY_ANDREVICH`, or `LEGACY_UNKNOWN`), never an installation source. Normal
runtime code contains no third-party catalog, fallback, source selector, channel,
or provider argument.

