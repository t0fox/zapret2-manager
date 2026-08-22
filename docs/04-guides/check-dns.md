---
id: public-guide-check-dns
title: "Как проверить DNS"
type: guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [guides, dns]
---

# Как проверить DNS

В **DNS** выберите профиль/provider и сначала откройте Preview. Применяйте
только после проверки exact dnsmasq changes. После async Apply дождитесь
результата и запустите проверку DNS.

Норма: dnsmasq доступен, local query получает ответ, upstream evidence свежий,
последний apply подтверждён. При timeout, external conflict или invalid config
сначала откройте Details и Журналы. Rollback используйте только для реально
доступного verified snapshot.
