---
id: scanner-architecture
title: "Архитектура Scanner"
type: architecture
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [development, scanner, e2e]
code: [zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc#scanner_edit_action]
---

# Архитектура Scanner

RPC создаёт bounded request, `scanner-cli-entry` передаёт его в typed Detect
authority, а focused native helper выполняет ровно одну из пяти команд
`probe`, `classify`, `quic`, `voice` или `tcp16`.

Detect валидирует JSON envelope и возвращает typed evidence. Он не materializes
candidate, не владеет temporary NFQUEUE и не меняет permanent Strategy;
Strategy Apply остаётся отдельным canonical workflow.
