---
id: product-strategy-source-provenance
title: "Источники и каноническая модель Strategy"
type: product
status: current
authority: canonical
updated: 2026-08-21
publish: true
tags: [product, strategy, provenance, catalog]
---

# Источники и каноническая модель Strategy

Strategy каталог собирается из закреплённых upstream-источников и проходит
один lossless путь:

```text
source records -> lossless importer -> canonical Strategy
               -> prepared catalog -> list/get -> Preview/Validate/Apply
```

## Закреплённые источники

| Роль | Источник | Revision |
|---|---|---|
| Engine base authority | `bol-van/zapret2` | `a0be7cbb40a4230e4b60fc33b7ea06102eb8ec15` |
| Strategy catalog authority | `avatarDD/zapret-gui` | `f9dd3ea47a2239514f396a843b475c92c33f0b4c` |
| Strategy UI donor | `avatarDD/zapret-gui` | `8c44df2bed98872d1348db053623ee6bf2902408` |
| Z2K engine delta reference | `necronicle/zapret2-z2k:z2k-master` | `8193742d8fde42fc646fbd10c0d2866572a54d3b` |
| Z2K signed runtime/data reference | `necronicle/z2k:z2k-enhanced` | `54b6765f2ab3e0f7f13030c90c809f1dcacfcce2` |

The installed runtime catalog is the verified, package-owned Avatar-derived
snapshot. Upstream metadata and donor references are provenance only; they do
not replace the Z2M runtime authority or change execution semantics.

The historical Forgejo catalog fixture under `catalog/forgejo/` is retained
only for archival comparison. It is not referenced by the resolver, Resource
Center, tests, or current manifests.

## Трассировка donor renderer

The current Avatar behavioral donor for the editor is
`avatarDD/zapret-gui@8c44df2bed98872d1348db053623ee6bf2902408`,
`web/js/pages/strategies.js`. The Z2M page keeps the donor renderer boundary
and adapts only the platform transport and safety contract:

| Donor renderer behavior | Z2M transplant boundary |
|---|---|
| `openEditor` opens `#strategy-modal` before editor work | `openEdit` opens the same modal with a loading/error state before one targeted `strategies_get` |
| `renderEditorForm` and `renderProfileEditor` own the editor surface | `z2m-strategies.js` keeps those surfaces and adds lossless Visual/Raw controls |
| profile filter/hostlist pickers and raw args editor | canonical Z2M Asset Registry and `profile-args` editor |
| Preview and Save operate on the aggregate Strategy | `strategies_preview`, `strategies_validate`, `strategies_create/update` |
| modal resize and editor lifecycle cleanup | v2 geometry migration, scoped workspace controls, and `unbindWorkspaceResize` |

This is a donor transplant with an OpenWrt/LuCI adapter, not a second Strategy
page or a second compiler. Unknown syntax remains Raw-only and the canonical
Strategy API remains the sole mutation authority.

## Lossless-идентичность

The semantic fingerprint includes globals, ordered profile boundaries,
`--filter-tcp`, `--filter-udp`, `--filter-l7`, host/IP targeting, ranges and
payload, Lua functions and parameters, `--lua-init`, `--blob`, `--new`, and
other execution-relevant options. Records with identical fingerprints are one
canonical Strategy with all provenance links. Records with different
fingerprints remain separate even when their names match.

## Представление и runtime

The Strategies renderer derives protocol tags and port ranges from each
canonical profile filter. The same normalized profile object feeds card tags,
details, Preview, Validate, and Apply. Unknown syntax remains raw-only and is
never rewritten. The persistent writer is Strategy; Scanner results are
transient evidence and enter the normal Strategy lifecycle through the
Strategies IDE.
