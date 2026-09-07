---
id: z2k-avatar-integration
title: "Интеграция Z2K и Avatar"
type: architecture
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [development, z2k, avatar, compatibility]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc#strategy_source_z2k_info]
---

# Интеграция Z2K и Avatar

Avatar предоставляет независимый catalog/донорский snapshot Strategy; Z2K
предоставляет coherent Core и runtime capabilities. Z2M связывает Z2K
runtime, Detect, compiler и official catalog через verified manifest, commit,
digest и capability checks, не превращая Avatar refresh в часть Core lifecycle.

Неизвестный raw syntax не переводится в Visual fields с потерей данных.
Несовместимость объявляется explicit error или Raw-only mode.
