---
id: public-trouble-bug-report
title: "Что собрать для bug report"
type: troubleshooting
status: current
authority: user-guide
updated: 2026-08-22
publish: true
tags: [troubleshooting, diagnostics, bug-report]
---

# Что собрать для bug report

Приложите: версию Z2M и target, время события, страницу и действие, ожидаемый
результат, фактический статус, bounded tail Журналов и diagnostic report.

Проверьте report на отсутствие секретов, токенов, ключей, личных доменов и
полного конфига. Для Scanner добавьте stage, candidate count, cleanup evidence
и `best`; для Strategy — revision/digest и код Validate.
