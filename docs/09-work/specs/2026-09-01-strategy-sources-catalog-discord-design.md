---
id: spec-strategy-sources-catalog-discord
title: "Multi-Source Strategy Catalog + Discord Design"
type: spec
status: planned
authority: approved-spec
updated: 2026-09-01
publish: false
tags: [spec, strategy, catalog, discord, z2k]
---

# Multi-Source Strategy Catalog + Discord Design

This canonical vault spec is extracted from the approved implementation plan committed at `docs/09-work/plans/2026-09-01-strategy-sources-catalog-discord-implementation-plan.md`.
# 1. Approved Design Contract

## 1.1 Canonical Strategy sources

Exactly two upstream Strategy sources:

```text
avatar → avatarDD/zapret-gui
z2k    → necronicle/z2k
```

Canonical IDs:

```text
avatar:<upstream-id>
z2k:<upstream-id>
user:<local-id>
```

If Avatar and Z2K contain the same upstream ID or display name, BOTH remain visible. There is no cross-source winner.

## 1.2 One unified catalog

```text
Avatar verified snapshot ─┐
                          ├→ canonical catalog generation
Z2K verified snapshot ────┤          ↓
User strategies ──────────┘   unified read index
                                   ↓
                         list/get/Preview/Validate/Apply
```

Normal catalog reads must perform **no network work**.

The canonical reader never scans arbitrary “newest” source directories to infer authority. It reads one atomically published generation/index identity.

## 1.3 Existing “Обновить стратегии” stays

The existing top-level button becomes:

```text
refresh ALL enabled sources
→ verify each source
→ use refreshed snapshot or that source's verified LKG
→ normalize
→ build complete unified index
→ verify index
→ publish new generation atomically
→ refresh UI
```

Current behavior only verifies/reindexes the existing Avatar snapshot; that is insufficient.

Per-source update also exists in Resource Center:

```text
Avatar [Обновить]
Z2K    [Обновить]
      [Обновить все]
```

After a single-source update, rebuild a complete generation using the new source snapshot plus current LKG of the other enabled source.

## 1.4 Refresh never mutates runtime

Source refresh, source disable, or upstream removal must NOT automatically change the active Strategy or restart nfqws2.

If active runtime came from `z2k:foo@snapshot-S1` and upstream now has S2:

```text
catalog → S2
runtime → still S1
```

Only normal:

```text
Preview → Validate → Apply
```

may move runtime to S2.

## 1.5 Disable semantics

If Z2K source is disabled:

- `z2k:*` is unavailable for new catalog browsing/Preview/Apply;
- the verified Z2K LKG snapshot is retained;
- an already-applied Z2K Strategy continues working from its immutable applied snapshot;
- UI can say “Источник Z2K отключён; используется ранее применённый snapshot”.

Re-enable may expose LKG again, then refresh. No auto-apply.

## 1.6 Strategy Sources ≠ Z2K Resources

`Z2K Resources` remains Asset Registry/runtime assets:

- Lua;
- blobs;
- lists;
- runtime files.

`Z2K Strategy Source` owns Strategy definitions and provenance.

Do not merge these lifecycles merely because both come from `necronicle/z2k`.

## 1.7 Source filters

Main Strategy UI stays one page with composable filters:

```text
Все | Avatar | Z2K | Пользовательские
```

Existing filters such as:

```text
Авто (circular) | Избранные | Рекомендуемые
```

compose with source filter, e.g. `Z2K + Авто`.

Each card shows source badge without replacing the normal human name.

## 1.8 Atomic publication / LKG

Source snapshots are immutable after verification.

Conceptual durable layout:

```text
/etc/zapret2-manager/catalog/
  sources/avatar/snapshots/
  sources/z2k/snapshots/
  generations/
  active.json

/etc/zapret2-manager/strategy-sources.json
/etc/zapret2-manager/strategy-catalog-index.json
```

A generation binds exact source snapshot IDs + user revision + exact index digest.

Partial refresh rules:

```text
Avatar PASS + Z2K PASS → new A + new Z
Avatar PASS + Z2K FAIL → new A + previous Z LKG
Avatar FAIL + Z2K PASS → previous A LKG + new Z
both FAIL               → previous generation stays active
index/generation FAIL   → previous generation stays active
```

Publication pointer is last. Unpublished directories do not become active after reboot.

## 1.9 Discord

Current hardcoded donor behavior is retired.

Do NOT use:

```text
strategy_catalog_get_detail('z2k_all_in_one')
source: avatar-catalog
```

as production authority.

Discord compatibility is semantic/capability-based. Canonical `discord_udp` remains the new runtime key.

A compatible profile is derived from real semantics, including the current contract around:

- Discord/STUN UDP filtering;
- circular Lua desync;
- `key=discord_udp`;
- `hostkey=z2k_nohost_key`.

If current applied/running Strategy already contains valid Discord, UI must show **Активно** and must not offer “Включить Discord”.

If Discord is absent, the button opens a compatible donor picker:

```text
Все | Avatar | Z2K
```

After donor selection:

```text
merge donor into current Strategy draft
→ normal Preview
→ normal Validate
→ native preflight
→ normal Strategy Apply transaction
→ runtime/process postflight
```

Discord must not own a second production writer.

## 1.10 Hard invariants

1. One production Strategy Apply writer.
2. One published canonical catalog generation.
3. Avatar and Z2K remain separate source identities.
4. No cross-source winner.
5. No network in normal list/get.
6. Refresh never auto-applies runtime.
7. Disable never destroys already-applied runtime.
8. Failed source refresh retains LKG.
9. Failed generation/index publication exposes no partial state.
10. Z2K Strategy source is not Asset Registry/Z2K Resources.
11. Discord is a catalog/Strategy-lifecycle consumer, not a parallel updater.
12. No `discord_voice` resurrection as competing canonical key.

---

