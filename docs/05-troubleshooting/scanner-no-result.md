---
id: public-trouble-z2k-detect
title: "Z2K Detect не даёт результата"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, z2k-detect]
---

# Z2K Detect не даёт результата

**Проверить:** target, DNS, readiness, результат операции и Журналы.

**Норма:** операция завершается typed verdict (`detected`, `clear`, `observed`,
`inconclusive` или `unavailable`) и сохраняет техническое evidence. Это
измерение не создаёт permanent Strategy.

**Следующее действие:** проверьте target и DNS, затем повторите только после
устранения ошибки `EBOOTSTRAP`/`EDEPENDENCY`. При `inconclusive` или
`unavailable` не применяйте случайный результат; настройте Strategy отдельно
через Preview → Validate → Save → Apply.
