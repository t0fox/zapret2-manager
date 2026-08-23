# Task Report: CI diagnostics rework (Knowledge CI manual-only, Quartz decoupling, native aggregation)

- Date: 2026-08-23
- Head: 2e0d263 (CI commits: c116cc8, 8d7d91d, 55b6c7d)
- Repository: t0fox/zapret2-manager

## Changed

- `.github/workflows/knowledge-ci.yml` — workflow_dispatch-only; 5 независимых
  проверок (validate, build-independent contracts, internal docs, public docs,
  artifact-gated privacy smoke) + final aggregation gate (`if: always()`,
  needs-все, `$GITHUB_STEP_SUMMARY` таблица PASS/FAIL/SKIPPED, exit 1 при любом
  required failure/cancellation). Контрактные тесты гоняются одним
  `node --test` вызовом по всем файлам — первый фейл больше ничего не скрывает.
- `.github/workflows/quartz-pages.yml` — отвязан от Knowledge CI
  (`workflow_run` удалён); собственный `push` в main c `paths:` по реальным
  входам public-docs pipeline (docs/**, scripts/docs.mjs,
  scripts/public-projection.mjs, tools/docs-site/**, leak-test, сам workflow);
  jobs: build (verify + production build + embedded smoke + independent leak
  smoke + artifact upload) → deploy (needs build success + artifact presence
  guard).
- `.github/workflows/apk-build.yml` — добавлен step summary манифеста;
  цепочка build → verify → publish не менялась.
- `scripts/test/native.sh` — фазовая оркестрация без межфазного fail-fast:
  per-file статусы всей матрицы, broker-build как явный prerequisite,
  native-root как отдельный PASS/FAIL/SKIPPED, `$GITHUB_STEP_SUMMARY`
  таблица + counts + RESULT, exit 1 при любом FAIL; пустая таблица результатов
  = orchestration error → FAILED. Параллелизация/серийность исполнения
  сохранена как в оригинале.
- `tests/knowledge/quartz-pages.test.mjs` — контракт мигрирован на новую
  архитектуру (manual-only knowledge, paths-trigger Pages, deploy gate).
- `docs/08-development/apk-build.md` — обновлены устаревшие ссылки на
  Knowledge CI.

## Verification (evidence)

- YAML: все 5 workflows parse OK (python3-yaml).
- Knowledge pipeline локально (WSL): validator ✅, quartz verify ✅,
  internal build ✅, public build+embedded smoke ✅, independent leak smoke
  4/4 ✅, contracts 35/35 ✅.
- native.sh clean run: EXIT=0, Passed 90 / Failed 0 / Skipped 0; native-root
  выполнен реально под sudo (PASS), не SKIPPED.
- Controlled multi-failure: две инъекции в разных зонах матрицы → обе видны
  поимённо, 90 остальных проверок отработали, RESULT FAILED; cleanup
  подтверждён (0 modified), повторный чистый прогон EXIT=0.
- CI live: на push 4210e10/2e0d263 Knowledge CI НЕ запускается; Quartz Pages
  запустился только на push с docs/** и задеплоил успешно; на 2e0d263 native
  gate показал 97 записанных проверок (94 pass / 3 fail поимённо) и красный
  итог вместо прежнего ложного зелёного.
- git diff --check: чисто. validate-knowledge.mjs: passed.

## Known reds outside this task

- На 2e0d263 Native gate честно показывает регрессии параллельной сессии
  (catalog/engine commits ab9c049..7669c3b): package-helper,
  avatar-strategy-package, engine-worker-rollback-sandbox. Это кодовые
  регрессии этой работы, а не CI-архитектуры; правки в процессе в той же
  рабочей копии.
