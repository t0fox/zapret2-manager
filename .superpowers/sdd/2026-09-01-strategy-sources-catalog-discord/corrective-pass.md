# Corrective implementation and acceptance pass

Дата: 2026-09-01

## Итоговый статус

`DONE_WITH_CONCERNS`

Работа продолжена с текущего состояния `main`. План был заранее помещён в
`docs/09-work/plans/2026-09-01-strategy-sources-catalog-discord-implementation-plan.md`.
В этом корректирующем проходе новых commit/push не выполнялось:

- `HEAD_BEFORE/AFTER`: `198055d077a51c3c087b1bb47768fd2971847a4e`;
- `origin/main`: `363ea01d40e8db7eec2cb57f61474a0f051a4523`;
- `COMMIT`: `NO`;
- `PUSH`: `NO`;
- `APK BUILD/INSTALL`: `NO`.

Статус намеренно не `DONE`: живой Discord runtime не подтверждён, а
проверка mutation-flow источников и reboot acceptance не выполнялась.

## Что было исправлено

1. Avatar refresh больше не переиспользует package baseline. При refresh он
   получает архив точного `sourceCommit`, проверяет безопасные tar paths,
   извлекает полный каталог, проверяет manifest/content digest и только затем
   публикует snapshot. При mismatch или network failure сохраняется prior LKG.
2. Normal Strategy reads теперь используют active generation как authority:
   legacy user rows нормализуются в `sourceId: user`, embedded user entries не
   дублируются, `get` сначала читает active generation.
3. После source-only deployment явно выполнен idempotent catalog bootstrap/
   migration; он переиспользовал уже проверенное поколение.
4. Два визуально похожих фильтра объединены в одну подписанную поверхность:
   `Источник` управляет источником (`Все/Avatar/Z2K/Пользовательские`), а
   `Тип` — типом/поиском списка. Это две независимые оси, а не два дубликата
   одного поиска.

Изменённые файлы:

- `tests/product/strategy-source-refresh.test.mjs`;
- `tests/fixtures/strategy-source-refresh/transport.sh`;
- `tests/product/strategy-catalog-authority.test.mjs`;
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`;
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`.

## Матрица задач 0–18

| Задача | Статус | Доказательство / граница |
| --- | --- | --- |
| 0. План и baseline | PASS | План в `docs/09-work/plans`; baseline в `.superpowers/sdd/.../baseline.md`. |
| 1. Source config/ownership | PASS | Source config RPC и локальные owner/adapter тесты. |
| 2. Avatar adapter | PASS | Фокусные тесты; live LKG: commit `8c44df2...`, 1836 entries, 732 normalized. |
| 3. Z2K adapter | PASS | Фокусные тесты; live LKG: commit `bb1ad5f...`, 3 entries, 3 normalized. |
| 4. Exact Avatar refresh | PASS (local) | RED `ESTALE` для exact-revision case → archive extraction/content-bound fix → GREEN. Live refresh mutation не выполнялся. |
| 5. Source state/CAS/LKG | PASS | Refresh lifecycle, mismatch и network-failure tests; prior LKG retained. |
| 6. Merge/publish generation | PASS | Generation tests; live generation `8719adc8...`. |
| 7. Migration | PASS | Explicit router migration returned `migrated:false, reused:true`, same generation/digest. |
| 8. Catalog read authority | PASS | Authority regression suite 6/6; live catalog `verified:true`, `fallbackUsed:false`. |
| 9. Source filters | PASS | UI focused suite; live DOM has one source group and correct counts. |
| 10. Resource Center | PASS | UI tests; live cards show Avatar/Z2K status, revisions and snapshot IDs. |
| 11. Discord flow | PARTIAL | Preview/Validate flow exists, but current Apply contract requires persisted identity; see concern below. |
| 12. Shared compiler/preview | PASS (local) | Product/UI suites cover shared preview/validation path. |
| 13. Import/editor | PASS (local) | Existing product/UI coverage remains green in the focused run. |
| 14. Provenance | PASS | Source-specific provenance tests and live `sourceId` counts. |
| 15. Focused and broad verification | PASS with known baseline failures | Exact results below. |
| 16. Static checks | PASS | `git diff --check`; UI `node --check` 77/77. |
| 17. Router source-only deploy | PASS (bounded) | Backup, stage/live SHA parity, explicit bootstrap and catalog status; refresh/disable/re-enable/reboot mutation acceptance not performed. |
| 18. Live Discord runtime | FAIL / BLOCKED | Donor RPC returned `EUNAVAILABLE`; required compiled corpus is absent and service is stopped. |

## TDD evidence

- Exact Avatar revision: the new test first failed with
  `ESTALE Avatar metadata revision does not match its verified complete
  snapshot`; exact archive extraction and content verification made the test
  pass.
- Active-generation user authority: the regression first exposed missing user
  schema fields, then duplicate IDs between generation projection and direct
  user storage; canonical wire normalization, generation-first `get`, and
  ID de-duplication made the authority suite pass 6/6.
- Legacy user wire identity: the regression exposed missing `sourceId`; the
  compatibility normalization now returns `sourceId: user` and the suite is
  green.

## Local verification

Focused UI:

```text
9 tests, 9 pass, 0 fail
```

Focused product/source/catalog/Discord suite:

```text
105 tests, 105 pass, 0 fail, 0 cancelled
```

UI syntax:

```text
77 files, 77 passed by node --check
```

Expanded related UI selection:

```text
82 tests, 78 pass, 4 fail
```

The four failures are existing/unrelated baseline mismatches: a stale shell
cache-bust expectation, a separate Resource Center trust-mode expectation,
two Strategy IDE expectations (including an environment ENOENT for
`z2m-scanner-hub.js`). They were not changed in this pass. `git diff --check`
is clean.

## Router deployment and runtime evidence

Deployment was source-only and manual because the repository was intentionally
dirty and the package deploy script requires a clean expected commit. No APK
was built or installed. Every replaced file was backed up before install.

Latest deployment:

- backup: `/tmp/z2m-corrective-20260901-101500/backup/usr/libexec/zapret2-manager/strategy-cli.uc`;
- local/stage/live SHA-256: `523f7d8354b1816d9eec1fb959c3634dd45eec3f240330d84f36b3e96376f9c3`;
- previous live backup SHA-256: `9a0e8d54e707a6ce4260b28be9a05076829d051a6ec5c7e5812a82d3a847cff6`;
- only `rpcd reload` was requested after install;
- uptime stayed continuous: `12438.45` before and `12438.97` after.

Earlier source-only deployment of `strategy-source-refresh.uc`,
`strategy-cli.uc`, and `z2m-strategies.js` likewise had backups and exact
stage/live parity. No deployment in this pass rebooted the router. Current
boot evidence is `uptime -s: 2026-09-01 07:13:35`; the exact cause of the
earlier user-reported reboot is not proven by current logs.

Live source/catalog evidence:

- `strategies_list`: 737 total = 732 Avatar + 3 Z2K + 2 user; missing
  `sourceId`: 0;
- catalog status: generation digest
  `8719adc83f0a54e618555b9dbcf7dbe306e39833b56352713fd55cc277f313d8`,
  `verified:true`, `fallbackUsed:false`, 737 unique entries, 0 duplicate
  groups;
- active pointer/index and both source snapshots agree on generation/digest;
- live Strategies DOM: one `strategy-filters-surface`, labels `Источник` and
  `Тип`, buttons `Все737`, `Avatar732`, `Z2K3`, `Пользовательские2`; Z2K and
  user filtering each showed the expected cards and provenance.
- browser auth used the built-in Codex browser and only the Login button;
  no username or password was entered.

## Discord and unresolved concerns

The local Discord integration tests prove semantic donor discovery,
`discord_udp`, `nohost`, `STUN`, `z2k_nohost_key`, the all-in-one parser and
runtime checks. The live donor dispatch returned:

```json
{"ok":false,"error":{"code":"EUNAVAILABLE","message":"no verified Discord donor passed dependency and native checks"}}
```

The router is missing `/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json`,
and the clean runtime process check found no running `nfqws2`; the UI showed
the service stopped. Therefore live Discord Apply/native runtime acceptance is
not proven.

There is also an approved-interface conflict: normal Strategy Apply currently
requires persisted identity, while the desired Discord flow says to merge into
the current full draft and use normal Apply without a hidden persistent helper
strategy. The current UI creates a temporary user strategy for that transport
and cleans it up when Apply fails. Changing this would require a coordinated
change to the authoritative Apply/identity contract, so no second writer or
silent persistence path was invented.

Remaining concerns are the unperformed source mutation acceptance (refresh,
disable/re-enable), live Discord runtime/Apply, and one separate browser
console `uci/get` access-denied error. These boundaries prevent a `DONE` claim.
