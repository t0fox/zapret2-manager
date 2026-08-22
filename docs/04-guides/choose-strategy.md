---
id: public-guide-choose-strategy
title: "Как выбрать и применить Strategy"
type: guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [guides, strategy]
---

# Как выбрать и применить Strategy

Откройте **Обход DPI → Стратегии** и начните с рекомендованных вариантов для
нужного протокола. Сравните Preview: profile boundaries, `--filter-tcp` /
`--filter-udp`, hostlist/IPSet, Lua/blob и exact args.

Затем нажмите Validate. Если syntax или asset не проходит проверку, исправьте
его в IDE; не заменяйте неизвестные raw-фрагменты приблизительными полями.
После Save нажмите Apply и дождитесь подтверждённого результата. В Управлении
проверьте, что applied Strategy identity совпадает с ожидаемой.
