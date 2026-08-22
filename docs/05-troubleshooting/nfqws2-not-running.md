---
id: public-trouble-nfqws2
title: "nfqws2 не запускается"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, nfqws2]
---

# nfqws2 не запускается

**Симптом:** Управление показывает stopped/error.

**Проверить:** Компоненты → Engine installed/compatible; затем Strategy
identity, NFQUEUE и Журналы.

**Ожидаемый результат:** Engine verified, Strategy validated, queue принадлежит
production `nfqws2`, ошибок preflight нет.

**Следующее действие:** исправьте компонент или Strategy на owner page и повторите
запуск. Не удаляйте чужой queue и не включайте bypass при `UNKNOWN` ownership.
