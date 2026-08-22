---
id: adr-002-blockcheck-execution-boundary
title: "Граница выполнения BlockCheck"
type: adr
status: planned
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [adr, blockcheck, architecture]
---

# Граница выполнения BlockCheck

ucode владеет семантикой продукта и оркестрацией; Rust отвечает за ограниченное
типизированное сетевое выполнение; C используется только как узкий системный примитив
в исключительных случаях. Это принятая целевая архитектура, а не утверждение о полной реализации.
