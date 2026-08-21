---
id: system-components-ia-design
title: "System Components information architecture"
type: spec
status: planned
authority: proposed
updated: 2026-08-21
publish: false
tags: [system, components, navigation, engine, z2k, backups, settings]
---

# System Components information architecture

Status: approved for implementation
Date: 2026-08-21

## Goal

Make `Система → Компоненты` a clear health and lifecycle surface for the two
mandatory foundations of Zapret2 Manager: `Zapret2 Engine` and `Z2K Core`.
Keep every optional product and every independent resource updater with its
canonical owner.

## Evidence and current ownership

- `z2m-navigation.js` currently exposes `updates`, `engine`, `backups`, and
  `settings` beneath `Система`.
- `app.js` maps those routes to one `Maintenance` module. This is a useful
  compatibility mechanism, but the visible IA still presents four system
  concepts instead of one Components surface plus two independent pages.
- `z2m-maintenance.js` loads installed versions for Updates, delegates the
  complete Engine experience to `z2m-engine-panel.js`, loads backup history,
  and stores the Advanced mode flag in browser state.
- `z2m-api.js` already exposes the Manager maintenance RPCs, the separate
  `zapret2-manager-engine` RPC family, and the canonical Resource Center RPCs.
- `resource-update.uc` and `z2k-component.uc` keep Asset Registry as the byte
  owner and classify Z2K upstream changes as safe updates, adapted-file
  rebase requirements, or semantic review requirements.
- `backup.uc` already owns backup creation, integrity checks, preview identity,
  version gates, restore, and reread verification.
- Telegram Proxy, Avatar/resources, and WARP are separate product or resource
  owners and must not be copied into the Components lifecycle.

## Product model

The Components page has three levels of information:

1. Manager metadata: current Manager version, overall mandatory-component
   health, and a single `Проверить` action. Manager metadata is not a third
   component card.
2. `Zapret2 Engine`: base traffic-processing engine with compact health,
   version, source, compatibility, capabilities, service state, and an
   expandable management surface.
3. `Z2K Core`: one user-facing integration entity aggregating runtime, Lua
   assets, detectors, autocircular support, engine delta, compatibility, and
   provenance. Internal files remain backend implementation details.

Health, update state, and compatibility are independent fields. The UI must
be able to represent a ready component with an available safe update, or a
ready component whose upstream change requires engineering integration.

The normalized read model is:

```text
componentsPage {
  manager: { version, updateState, updateVersion, selfUpdateAvailable },
  health: { ready, total, state, message },
  checkedAt,
  components: [
    {
      id: 'engine' | 'z2k-core',
      health: 'ready' | 'missing' | 'degraded' | 'broken' | 'checking',
      updateState: 'current' | 'update-available' | 'integration-required' | 'unknown',
      compatibility: 'compatible' | 'unverified' | 'incompatible',
      summary, version, actions, counters, details
    }
  ],
  notices: []
}
```

Backend error codes are converted to human state and a safe next action in
the UI model. Raw stack traces and internal RPC messages remain Advanced
details only.

## Navigation contract

Canonical visible System items are:

```text
Система
├── Компоненты
├── Резервные копии
└── Настройки
```

`Движок` and `Обновления` disappear from the visible navigation. Existing
bookmarks remain reachable through aliases:

- `#/engine` redirects to `#/components?component=engine` and opens Engine
  management.
- `#/updates` and `#/maintenance` redirect to `#/components`.
- Existing `#/backups` and `#/settings` remain canonical independent pages.

Aliases must resolve to the single System module and must not create duplicate
component lifecycles. The route parser remains the sole navigation authority.

## Data flow and ownership

The preferred implementation is a thin read-model composition over existing
owners. No second installer, updater, Asset Registry writer, Engine lifecycle,
or Z2K lifecycle is introduced.

```text
Components view
  ├─ Engine status/gate/releases/check → zapret2-manager-engine RPC
  ├─ Z2K/resource status/check         → canonical Resource Center RPC
  └─ Manager version/status             → existing maintenance RPC

Engine management actions → existing EnginePanel/API
Z2K safe update/repair      → existing Resource Center/Z2K component API
Avatar/resource updates     → Resources page
Telegram Proxy lifecycle    → Telegram Proxy page
Backup lifecycle            → backup RPCs
Advanced mode               → existing browser UI state
```

If the existing payloads cannot express an exact required state, add the
smallest read-only enrichment at the existing owner boundary. The enrichment
may expose Z2K classification/provenance and checked state, but it must not
move mutation authority or create a parallel lifecycle.

## Engine card and management

The compact Engine card shows:

- human health (`Работает`, `Не установлен`, `Требуется проверка`, or a
  precise recovery state);
- installed version and source (`bol-van/zapret2`);
- Z2K compatibility;
- capabilities count;
- service/autostart state;
- the context-appropriate primary action.

The normal card does not expose the full technical Engine panel. `Управление`
reveals the existing EnginePanel unchanged in capability, including installed
and latest compatible versions, source, compatibility, service state,
autostart, check, install, reinstall, uninstall, operation progress, and
diagnostics already owned by that panel.

Engine update candidates must pass the existing compatibility gate. An
upstream `bol-van/zapret2` version without a compatible Z2M build is displayed
as an informational/update notice with `Подробнее`, never as an installable
vanilla candidate.

## Z2K Core card and details

Z2K is rendered as one lifecycle entity. The compact card can show runtime
version, engine delta, Lua asset count, compatibility, and the next safe action.

The details view discloses, when present:

- `necronicle/z2k` runtime repository and commit;
- `necronicle/zapret2-z2k` engine-delta provenance;
- `bol-van/zapret2` base provenance;
- Lua/blob/list counts;
- integrity, expected/actual hashes, compatibility manifest, build ID, last
  verification, and installed paths in Advanced mode.

The state mapping is explicit:

```text
current                  → Готово / no action
update-available         → Доступно безопасное обновление
rebase-required          → Требуется интеграция
review-required          → Требуется проверка интеграции
missing/broken           → Требуется восстановление
```

`rebase-required` and `review-required` never expose a normal automatic
update button. Z2K Core has no user-facing `Удалить` action; repair,
reinstall, check, or restore are allowed only when backed by existing
contracts.

## Check action

`Проверить` is a real bounded check, not only a visual refresh. It reuses the
existing Engine status/gate and Resource Center check contracts, updates
service/compatibility/capability information, refreshes Z2K runtime/assets,
and recomputes page health. The UI disables duplicate checks and displays a
pending state. A failed check preserves the last known state and presents a
human explanation with Advanced technical details.

## Backups

Backups remain a separate page. The default create action means `Всё`, mapping
only to supported backend scopes. Advanced options expose the real scopes
(`Manager state`, `Strategies`, `Lists`, and `Profiles`) without inventing
unsupported domains.

Restore always follows `preview → explicit confirmation → restore → reread
verification`. The preview shows integrity, version compatibility, affected
objects, and blockers before restore. An incompatible or corrupt backup cannot
be restored blindly.

## Settings

Settings contains only the working `Расширенный режим` UI preference. It
controls visibility of technical IDs, SHA/provenance, argv, and diagnostics.
Developer notes about missing server settings RPCs are removed from the
user-facing page; absence of a settings RPC remains an implementation
boundary, not user copy.

## Testing and verification

Browser confirmation is a mandatory acceptance gate. Host contract tests alone
cannot establish that the LuCI navigation, card hierarchy, disclosures, and
responsive layout work together. The browser run must exercise the built or
served LuCI preview and capture evidence for Components, legacy deep-links,
Engine management, Backups, and Settings.

Focused tests must cover:

- canonical Components navigation, hidden legacy items, aliases, and
  deep-link opening;
- normalization of ready, missing, degraded, broken, checking, update,
  integration-required, and compatibility states;
- Engine card actions and preservation of the existing management surface;
- Z2K aggregation, provenance details, safe-update versus integration states,
  and absence of a delete action;
- real check pending/deduplication and error normalization;
- backup `Всё` default, advanced scope selection, preview blockers, and
  restore verification;
- Advanced mode visibility and removal of developer notes;
- absence of Avatar, Telegram Proxy, WARP, and resource catalogs from
  Components.

Verification must distinguish focused tests, full host tests, package tests,
and deployed-router smoke. No broader gate is called green unless its actual
command output proves it.
