---
id: public-control
title: "Обход DPI — Управление"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, dpi, nfqws2]
---

# Обход DPI — Управление

Страница показывает фактический runtime Engine: состояние `nfqws2`, PID,
NFQUEUE, firewall ownership, Strategy identity и автозапуск.

## Команды

- **Запустить** — запускает production Engine после preflight;
- **Остановить** — останавливает production runtime;
- **Перезапустить** — выполняет контролируемый restart;
- **Автозапуск** — меняет только политику старта, а не выбранную Strategy.

Установленный Engine, запущенный `nfqws2`, выбранная Strategy и применённая
Strategy — разные состояния. При `UNKNOWN` или отсутствии verified snapshot
страница должна fail closed и не маскировать это как OK.

Для подбора кандидата используйте [Scanner](./scanner/index.md), а для
постоянного изменения — [Strategy lifecycle](./strategy/index.md).
