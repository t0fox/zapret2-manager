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

test('Scanner primary UI mirrors Avatar scan.js layout card + bc-form + diag-progress in LuCI', () => {
  const source = scanner();
  assert.match(source, /Параметры сканирования/);
  assert.match(source, /Целевой домен/);
  assert.match(source, /Протокол/);
  assert.match(source, /Режим/);
  assert.match(source, /Быстрый/);
  assert.match(source, /Запустить/);
  assert.match(source, /Продолжить/);
  assert.match(source, /Остановить/);
  assert.match(source, /card/);
  assert.match(source, /bc-form/);
  assert.match(source, /bc-actions/);
  assert.match(source, /diag-progress/);
  assert.match(source, /scan-target/);
  assert.match(source, /scan-protocol/);
  assert.match(source, /scan-mode/);
  assert.match(source, /scan-progress-bar/);
  assert.match(source, /scan-phase/);
  assert.match(source, /scan-working-count/);
  assert.match(source, /scan-failed-count/);
  assert.match(source, /scan-success-rate/);
  assert.match(source, /scan-elapsed-time/);
  assert.match(source, /z2m-scanner-icon/);
  assert.match(source, /Найдено:/);
  assert.match(source, /Не подошло:/);
  assert.match(source, /Успешность:/);
  assert.doesNotMatch(source, /Scanner record is unavailable/);
  assert.doesNotMatch(source, /RPC недоступен/);
  assert.doesNotMatch(source, /\[object HTMLElement\]/);
  assert.doesNotMatch(source, /test contract compatibility/);
  assert.doesNotMatch(source, /z2m-scanner-options.*legacy/);
});

test('Scanner results show working, summary, best_strategy, per_host, score, throughput, body_passed', () => {
  const source = scanner();
  assert.match(source, /Найденные стратегии/);
  assert.match(source, /Работающие стратегии не найдены/);
  assert.match(source, /Протестировано:/);
  assert.match(source, /Рабочих:/);
  assert.match(source, /Успешность:/);
  assert.match(source, /Лучшая:/);
  assert.match(source, /score/);
  assert.match(source, /KB\/s/);
  assert.match(source, /body.?OK|body_passed/i);
  assert.match(source, /perHost|per_host|probe_per_host/);
  assert.match(source, /scan-results-summary/);
  assert.match(source, /scan-results-list/);
  assert.match(source, /z2m\.strategy\.scanner-handoff\.v1/);
  assert.match(source, /Применить/);
  assert.match(source, /scan-current-strategy/);
  assert.doesNotMatch(source, /Scanner record is unavailable/);
  assert.doesNotMatch(source, /\[object HTMLElement\]/);
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
