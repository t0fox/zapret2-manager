---
id: product-scanner-index
title: "Сканер"
type: product
status: current
authority: index
updated: 2026-08-13
publish: true
tags: [product, scanner, parity]
---

# Сканер

Scanner проверяет цель ограниченным набором кандидатов и возвращает evidence,
а не мгновенно меняет production runtime.

## Рабочий процесс

1. Укажите target и scan profile.
2. Запустите сканирование и наблюдайте стадии normalize → planning → candidate
   → temporary test → probe → cleanup.
3. Дождитесь `best` и проверьте score, latency, protocol и evidence.
4. Откройте candidate в Strategy IDE, при необходимости измените его и выполните
   Preview/Validate.
5. Сохраните и примените через Strategy.

Временный NFQUEUE/helper принадлежит Scanner только на время теста. До и после
проверяйте, что production queue и `nfqws2` сохранены, а temporary ownership
удалён. `best: null` означает отсутствие доказанного результата, а не повод
применять последний кандидат вслепую.

Полномочия runtime и доказательства discovery записаны в документе
[«Полномочия runtime сканера»](../../02-architecture/scanner-runtime-authority.md).
