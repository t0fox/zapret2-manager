---
id: public-trouble-nfqueue
title: "NFQUEUE не готова"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, nfqueue, firewall]
---

# NFQUEUE не готова

**Проверить:** Мониторинг → queue number, owner, firewall rules и PID
`nfqws2`. Z2K Detect не владеет production queue и не заменяет Engine.

**Норма:** production queue сохраняется, temporary queue исчезает после cleanup,
firewall ownership совпадает с Engine.

**Следующее действие:** остановите повторные Apply/Detect, соберите Журналы и
исправьте owner mismatch через Управление. Не лечите проблему увеличением timeout.
