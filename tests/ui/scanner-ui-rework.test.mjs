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

test('Scanner primary UI uses human product language and keeps advanced parameters disclosed', () => {
  const source = scanner();
  assert.match(source, /Подбор стратегии/);
  assert.match(source, /Найдём рабочую стратегию для сайта/);
  assert.match(source, /Сайт/);
  assert.match(source, /Режим проверки/);
  assert.match(source, /Найти стратегию/);
  assert.match(source, /Дополнительные параметры/);
  assert.match(source, /Проверяем/);
  assert.match(source, /Найдено рабочих/);
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
  assert.match(source, /z2m\.strategy\.scanner-handoff\.v1/);
});

test('Scanner history is humanized and hides technical identity behind details', () => {
  const source = product();
  assert.match(source, /Проверка сайта/);
  assert.match(source, /Дата и время/);
  assert.match(source, /Технические сведения/);
  assert.match(source, /scan-debug-/);
  assert.doesNotMatch(source, /item\.id\s*\+\s*['"]\s*·\s*['"]|item\.status\s*\+\s*['"]\s*·\s*['"]\s*\+\s*\(item\.phase/);
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
