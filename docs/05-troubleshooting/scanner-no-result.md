---
id: public-trouble-scanner
title: "Scanner не находит результат"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, scanner]
---

# Scanner не находит результат

**Проверить:** target, DNS, readiness snapshot, progress/stage и Журналы.

**Норма:** plan complete, candidates executed, probe evidence present, cleanup
PASS. `best: null` — корректный результат отсутствия успеха.

**Следующее действие:** проверьте dependency preflight и повторите только после
устранения `EBOOTSTRAP`/`EDEPENDENCY`. При `uncertain` считайте runtime
восстановление недоказанным и не применяйте candidate.
