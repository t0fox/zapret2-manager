import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viewDir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');
const read = (name) => fs.readFileSync(path.join(viewDir, name), 'utf8');
const scanner = () => read('z2m-scanner.js');
const product = () => read('z2m-scanner-product.js');
const diagnostics = () => read('z2m-blockcheck-page.js');
const uiCss = () => read('z2m-ui.css');

test('Scanner primary UI uses human product language and keeps advanced parameters disclosed', () => {
  const source = scanner();
  assert.match(source, /Подбор стратегии/);
  assert.match(source, /Найдём рабочий вариант для сайта/);
  assert.match(source, /Сайт/);
  assert.match(source, /Режим проверки/);
  assert.match(source, /Найти стратегию/);
  assert.match(source, /Дополнительные параметры/);
  assert.match(source, /z2m-scanner-search-body/);
  assert.match(source, /z2m-scanner-options/);
  assert.match(source, /z2m-scanner-icon/);
  assert.match(source, /Проверяем/);
  assert.match(source, /Рабочих найдено/);
  assert.doesNotMatch(source, /controls\.resume/);
  assert.match(source, /recordPending\(error\).*waiting-record/s);
  assert.match(source, /state\.status = \{ status: 'starting', phase: 'validating' \}[\s\S]*?refresh\(ctx\);/);
  assert.doesNotMatch(source, /Strategy Scanner|Server-owned candidate execution and evidence|Target\/domain|DPI hint\/filter|Start Scanner|Stop Scanner|Resume Scanner/);
});

test('Scanner result has explicit success and no-result product states', () => {
  const source = scanner();
  assert.match(source, /Рабочая стратегия не найдена/);
  assert.match(source, /Посмотреть результаты/);
  assert.match(source, /Открыть в Стратегиях/);
  assert.match(source, /Проверить ещё раз/);
  assert.match(source, /z2m-scanner-best-card/);
  assert.match(source, /z2m-scanner-no-best/);
  assert.match(source, /z2m-scanner-error-card/);
  assert.match(source, /z2m-scanner-retry-panel/);
  assert.match(source, /z2m\.strategy\.scanner-handoff\.v1/);
});

test('Scanner history is humanized and hides technical identity behind details', () => {
  const source = product();
  assert.match(source, /Подробности проверки/);
  assert.match(source, /z2m-scanner-history-row/);
  assert.match(source, /historyGroupLabel/);
  assert.match(source, /openModal/);
  assert.match(source, /Сегодня/);
  assert.match(source, /Технические сведения/);
  assert.match(source, /Диагностический запуск/);
  assert.match(source, /historyBest/);
  assert.doesNotMatch(source, /item\.id\s*\+\s*['"]\s*·\s*['"]|item\.status\s*\+\s*['"]\s*·\s*['"]\s*\+\s*\(item\.phase/);
  assert.doesNotMatch(source, /Проверка сайта:\s*['"]\s*\+\s*\(request\.target/);
  assert.doesNotMatch(source, /Bounded read-only Scanner state|JSON\.stringify\(detail, null, 2\)/);
});

test('Diagnostics has bounded loading and degraded/error retry states', () => {
  const source = diagnostics();
  const productSource = product();
  assert.match(source, /Состояние системы/);
  assert.match(source, /Повторить/);
  assert.match(source, /Не удалось получить/);
  assert.match(source, /degraded/);
  assert.match(source, /timeout/i);
  assert.match(source, /return Promise\.resolve\(\{\}\)/);
  assert.match(source, /function mount\(ctx\) \{ state\.disposed = false/);
  assert.match(source, /state\.loadState === 'loading' && ctx\.shell\.loadingState \?/);
  assert.match(source, /Часть диагностики недоступна/);
  assert.match(source, /Сервер отклонил запрос к диагностическому RPC/);
  assert.match(source, /Access denied/);
  assert.match(source, /diagnostic-task/);
  assert.match(productSource, /function boundedChildLoad/);
  assert.match(productSource, /Promise\.race/);
  assert.doesNotMatch(source, /BlockCheck family|upstream blockcheck2\.sh|Deep Search — BlockCheckW Fast|Fast engine|Block Detector — фоновый DNS-мониторинг/);
});

test('Scanner product keeps canonical tabs and child module authority', () => {
  const source = product();
  assert.match(source, /require view\.zapret2-manager\.z2m-scanner as Scanner/);
  assert.match(source, /require view\.zapret2-manager\.z2m-blockcheck-page as BlockCheck/);
  assert.match(source, /Подбор стратегии/);
  assert.match(source, /Диагностика/);
  assert.match(source, /История/);
});

test('Scanner V2 composition has canonical visual primitives without backend changes', () => {
  const css = uiCss();
  assert.match(css, /z2m-scanner-workflow/);
  assert.match(css, /z2m-scanner-history-row/);
  assert.match(css, /z2m-scanner-diagnostic-task/);
  assert.match(css, /z2m-scanner-detail-grid/);
  assert.match(css, /z2m-scanner-status-badge/);
});
