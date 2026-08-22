---
id: public-backups
title: "Резервные копии"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, backups, recovery]
---

# Резервные копии

Backup — средство safety/recovery, а не обязательная кнопка перед каждой
операцией. В текущем UI проверяйте доступные действия: создать, посмотреть
состав, проверить integrity, открыть restore preview, восстановить или удалить.

Ожидаемые persistent state включают выбранную Strategy, DNS/service-DNS state,
engine state и manager state; точный состав определяется текущим backup
manifest. После restore проверьте verified snapshot, revision/digest, Strategy,
DNS и runtime. Не включайте секреты в публичный diagnostic report.
