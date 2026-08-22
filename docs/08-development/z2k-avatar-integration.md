---
id: z2k-avatar-integration
title: "Интеграция Z2K и Avatar"
type: architecture
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [development, z2k, avatar, compatibility]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc#AUTHORITY_MARKER]
---

# Интеграция Z2K и Avatar

Avatar предоставляет catalog/донорскую семантику Strategy; Z2K предоставляет
совместимые engine/runtime capabilities. Z2M связывает их через verified
manifest, commit, digest и capability checks.

Неизвестный raw syntax не переводится в Visual fields с потерей данных.
Несовместимость объявляется explicit error или Raw-only mode.
