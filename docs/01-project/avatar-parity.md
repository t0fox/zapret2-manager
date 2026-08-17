---
id: project-avatar-parity
title: "Совместимость с avatarDD/zapret-gui"
type: project
status: current
authority: evidence
updated: 2026-08-17
publish: true
tags: [avatar, parity, provenance, compatibility]
---

# Совместимость с avatarDD/zapret-gui

Avatar используется как источник пользовательских presentation и behavior
contracts, а не как второй backend. Текущий donor authority:

`avatarDD/zapret-gui@38ed85ce487c6b3dbdf703a5be197795f7c0cad1`

Правило переноса:

```text
DONOR FILE -> DONOR COMPONENT/BEHAVIOR -> Z2M BOUNDARY ADAPTATION
```

Z2M сохраняет LuCI, горизонтальную навигацию, русский язык, собственные RPC,
state ownership и OpenWrt lifecycle. Donor HTTP API, sidebar и donor-only
products не входят в продукт. Несовместимые boundaries адаптируются к
каноническому Z2M RPC/state, а custom approximation не заменяет доступную
донорскую реализацию без зафиксированной технической причины.

Frontend provenance и MIT notice находятся в
[`docs/third-party/avatarDD-zapret-gui.md`](../third-party/avatarDD-zapret-gui.md).
Strategy source revisions и lossless semantic model описаны в
[`Strategy source provenance`](../03-products/strategy/source-provenance.md).

Текущая readiness определяется source, consumer и подходящим evidence в
текущем репозитории. Старые рабочие материалы не являются product authority.
