---
id: public-trouble-strategy
title: "Strategy не применяется"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, strategy]
---

# Strategy не применяется

**Симптом:** Save/Apply отклонён или applied identity не меняется.

**Проверить:** Preview → Validate, revision/digest, references на hostlist/IPSet,
Lua/blob и совместимость Engine.

**Ожидаемый результат:** validation green, revision не stale, snapshot verified.

**Следующее действие:** обновите карточку, разрешите stale revision через явное
решение и повторите канонический Apply. Не редактируйте runtime-файл вручную.
