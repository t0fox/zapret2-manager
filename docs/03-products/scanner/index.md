---
id: product-z2k-detect-index
title: "Обнаружение Z2K Detect"
type: product
status: current
authority: index
updated: 2026-08-13
publish: true
tags: [product, z2k-detect]
---

# Z2K Detect

Z2K Detect — это пользовательская оболочка для пяти upstream Detect-операций.
Каждая операция возвращает bounded typed evidence и не меняет permanent
Strategy или production runtime.

## Рабочий процесс

1. Выберите одну команду: `probe`, `classify`, `quic`, `voice` или `tcp16`.
2. Заполните только поля, которые нужны этой команде, и запустите Detect.
3. Проверьте typed verdict, reason и raw evidence; inconclusive/unavailable
   результат не превращается в успешный bypass.
4. Если результат требует постоянного изменения Strategy, откройте обычный
   каталог Strategy и отдельно пройдите Preview → Validate → Save → Apply.

Detect не является владельцем NFQUEUE, `nfqws2` или permanent Strategy. Эти
границы остаются у Engine и Strategy соответственно. Ошибка Detect всегда
показывается как typed result, а не маскируется под последний удачный вариант.

Runtime authority остаётся у Z2K Detect: UI вызывает только типизированные
`z2k_detect_*` RPC, а permanent Strategy Apply выполняется отдельным Strategy
journey.
