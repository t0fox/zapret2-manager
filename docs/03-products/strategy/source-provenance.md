---
id: product-strategy-source-provenance
title: "Источники и каноническая модель Strategy"
type: product
status: current
authority: canonical
updated: 2026-08-17
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
| Engine authority | `bol-van/zapret2` | `a8d24607a5ebae5f0a78aa066b35d0b7e66163ff` |
| Catalog metadata | `git.zapret.moe/zapretdiscordyoutube/zapretgui` | `6824294ee53421cc9c3e2a361f4976783ff62307` |
| Curated adaptation | `avatarDD/zapret-gui` | `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` |
| z2k extension/presets | `necronicle/z2k` | `11f5e77c48b87438567179ea763c635780a04b7b` |

Source metadata and license/provenance links are retained with the canonical
record. Presentation priority for semantically identical records is Avatar
curation, current catalog metadata, then raw z2k metadata. This priority never
changes execution semantics.

## Lossless identity

The semantic fingerprint includes globals, ordered profile boundaries,
`--filter-tcp`, `--filter-udp`, `--filter-l7`, host/IP targeting, ranges and
payload, Lua functions and parameters, `--lua-init`, `--blob`, `--new`, and
other execution-relevant options. Records with identical fingerprints are one
canonical Strategy with all provenance links. Records with different
fingerprints remain separate even when their names match.

## Presentation and runtime

### Donor renderer trace

The donor Strategies renderer derives protocol tags and port ranges from each
canonical profile filter. Z2M keeps that presentation rule in
`z2m-strategies-model.js`; the same normalized profile object feeds card tags,
details, Preview, Validate, and Apply.

The collapsed card reads protocol and port/range tags from the same canonical
profile object used by `get`, `Preview`, `Validate`, and `Apply`. A generic
`Профиль N` label is only valid when the profile has no protocol/range data.
Port labels are never hardcoded. The runtime dependency closure is synchronized
from the package-owned catalog and asset manifests before Apply.

The persistent writer is Strategy. Scanner results are transient evidence and
must be handed into the normal Strategy lifecycle before becoming durable.
