---
id: public-guide-collect-diagnostics
title: "Как собрать диагностику"
type: guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [guides, diagnostics]
---

# Как собрать диагностику

Откройте **Диагностика → Мониторинг**, затем используйте кнопку сбора отчёта,
если она доступна. В отчёт должны входить component status, Engine/Strategy,
firewall/NFQUEUE, Scanner readiness, DNS, TG, logs, version, memory и storage.

Перед отправкой проверьте, что secrets не включены. Для bug report приложите
время, симптом, ожидаемый результат и relevant log tail. Domain probe запускайте
из Scanner Diagnostics, а не дублируйте его в Monitoring.
