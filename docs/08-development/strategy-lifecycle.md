---
id: strategy-lifecycle
title: "Жизненный цикл Strategy"
type: architecture
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [development, strategy, lifecycle]
code: [zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc#strategies_apply_method]
---

# Жизненный цикл Strategy

IDE вызывает canonical Strategy API. Полный путь: открыть → clone/create →
редактировать → validate → preview → test, если runtime предоставляет safe
test → save → apply. Stale revision и изменившийся catalog digest дают
conflict, а не silent overwrite.

Scanner result входит в тот же workflow через provenance и transient status;
новый permanent apply endpoint не создаётся.
