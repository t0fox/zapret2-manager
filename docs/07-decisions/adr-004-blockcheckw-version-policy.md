---
id: adr-004-blockcheckw-version-policy
title: "Политика версий BlockCheckW"
type: adr
status: planned
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [adr, blockcheckw, dependency]
---

# Политика версий BlockCheckW

Стабильные версии выбираются и устанавливаются вручную. Фоновые проверки никогда
не устанавливают обновления автоматически. Состояния установленной, последней upstream,
последней совместимой и выбранной версии, а также VERIFIED/UNKNOWN/INCOMPATIBLE,
остаются раздельными; откат поддерживается там, где это практически возможно.
