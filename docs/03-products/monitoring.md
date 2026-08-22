---
id: public-monitoring
title: "Мониторинг"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, monitoring, health]
---

# Мониторинг

Мониторинг отвечает на три вопроса: всё ли работает, что именно сломано и куда
перейти для исправления. Статусы: **OK**, **OFF**, **DEGRADED**, **UNKNOWN** и
**ERROR**. `UNKNOWN` не равен OK: read failure или устаревшее evidence не
маскируются зелёной галочкой.

Проверяйте `nfqws2`, active/applied Strategy, firewall/NFQUEUE, Scanner
readiness, DNS, Telegram Proxy, WARP (если установлен), память, CPU, uptime и
storage. Каждое evidence имеет timestamp/freshness.

Примеры actionable warning: «snapshot generation отсутствует» ведёт к
bootstrap/Компонентам; «dnsmasq работает, но apply не подтверждён» ведёт к DNS;
«provider установлен, процесс остановлен» ведёт к Telegram Proxy. Подробности
PID, queue, revision и digest доступны через disclosure.
