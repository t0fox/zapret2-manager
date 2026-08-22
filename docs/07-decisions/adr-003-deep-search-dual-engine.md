---
id: adr-003-deep-search-dual-engine
title: "Два движка глубокого поиска"
type: adr
status: planned
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [adr, deep-search, blockcheckw]
---

# Два движка глубокого поиска

Глубокий поиск предоставляет разные движки `BlockCheckW Fast` и `BlockCheck2 Official`.
Они не являются взаимозаменяемыми эквивалентами; оба передают результаты стратегиям
для постоянного применения.
