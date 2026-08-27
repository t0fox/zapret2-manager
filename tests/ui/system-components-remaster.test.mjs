import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css'), 'utf8');
const MODEL_SRC = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');

// 1. Icon system — должен использовать существующий z2m-icons, не emoji
test('remaster uses existing z2m-icons system for all component cards', () => {
  assert.match(SRC, /z2m-icons/, 'must require z2m-icons');
  assert.match(SRC, /Icons\.wrappedNode|Icons\.html|Icons\.node/, 'must use Icons.*');
  // Engine, Z2K, Telegram, WARP, System header — каждый с иконкой
  assert.match(SRC, /wrappedNode.*cpu|wrappedNode.*nfqws/, 'Engine must have icon (cpu/nfqws)');
  assert.match(SRC, /wrappedNode.*workflow|wrappedNode.*strategy|wrappedNode.*shield/, 'Z2K must have icon');
  assert.match(SRC, /service:telegram|telegram/i, 'Telegram must use service:telegram icon');
  // Не должно быть emoji вместо иконок
  assert.doesNotMatch(SRC, /['"]⚙['"]|['"]🧩['"]/);
});

// 2. Новый верх — hero status panel с двумя раздельными действиями
test('hero status panel has two distinct actions, not ambiguous Проверить', () => {
  assert.match(SRC, /Обновить состояние/, 'must have [Обновить состояние] (local health)');
  assert.match(SRC, /Проверить обновления/, 'must have [Проверить обновления] (upstream)');
  // Старая неоднозначная кнопка должна исчезнуть как единственная
  const hasOldAmbiguous = /shell\.button\(_\('Проверить'\), 'sm'/.test(SRC) && !/Обновить состояние/.test(SRC);
  assert.equal(hasOldAmbiguous, false, 'ambiguous single Проверить must be replaced');
  assert.match(SRC, /Последняя проверка|последняя проверка/i, 'hero must show last check time');
});

// 3. Section headers как в Обход DPI — uppercase, динамические счётчики
test('section headers are uppercase and dynamic, not hardcoded', () => {
  assert.match(SRC, /ОБЯЗАТЕЛЬНЫЕ КОМПОНЕНТЫ/, 'must have uppercase section header');
  assert.match(SRC, /ДОПОЛНИТЕЛЬНЫЕ КОМПОНЕНТЫ/, 'must have optional section header');
  assert.doesNotMatch(SRC, /['"]2 из 2 готовы['"]/, 'must not have hardcoded 2 из 2');
  // Динамический счётчик справа
  assert.match(SRC, /работают|работает|требует внимания/, 'must have dynamic counter like "2 работают · 1 обновление"');
  assert.match(SRC, /page\.health\.ready/, 'must derive counter from page.health');
});

// 4. Engine — one Components-owned details presentation, not URL hack
test('Engine management is a full-width Components details sibling, not a nested panel', () => {
  assert.doesNotMatch(SRC, /#\/components\?component=engine/, 'must not use URL hack');
  assert.doesNotMatch(SRC, /engineRouteIsOpen/, 'must not use engineRouteIsOpen');
  assert.doesNotMatch(SRC, /engineManagementAttrs\.open/, 'must not use detached engineManagementAttrs');
  assert.match(SRC, /renderEngineDetails\s*\(/, 'must have a Components-owned details renderer');
  assert.match(SRC, /z2m-component-details/, 'details must have a scoped presentation root');
  assert.doesNotMatch(SRC, /EnginePanel\.render\(engineCtx/, 'Components must not embed the standalone EnginePanel');
  assert.match(SRC, /engineExpanded|engineOpen/, 'must have local disclosure state');
  assert.match(SRC, /Управление[\s\S]*▾|Управление[\s\S]*chevronDown/, 'must have Управление disclosure button');
  assert.match(SRC, /state\.engineExpanded\s*\?\s*renderEngineDetails/, 'details must render below the mandatory grid');
});

// 5. Engine — contextual actions
test('Engine card has contextual actions based on state', () => {
  assert.match(SRC, /Проверить обновления|Проверить обновления/, 'Engine must offer Проверить обновления when ready');
  // Когда доступно обновление — должна быть кнопка Обновить рядом
  // Проверяем что есть ветка для update-available
  assert.match(SRC, /update-available|Доступно обновление/, 'must handle update-available state');
  assert.match(SRC, /Обновить/, 'must have [Обновить] action when update available');
});

// 6. Z2K — first-class карточка with one coherent details language
test('Z2K is first-class card with facts, updates, and review callout', () => {
  assert.match(SRC, /Z2K Core|z2k-core/, 'must have Z2K Core card');
  // Иконка уже проверена выше, но дополнительно проверим что Z2K не безликая
  assert.match(SRC, /z2k|Z2K/i, 'must reference Z2K');
  assert.match(SRC, /renderZ2KDetails\s*\(/, 'must have a coherent Z2K details renderer');
  assert.match(SRC, /renderFactGrid|renderUpdateSection/, 'must use semantic facts/update sections');
  assert.match(SRC, /renderReviewCallout/, 'review reason must be a standalone callout');
  assert.doesNotMatch(SRC, /Локально.*UPSTREAM|UPSTREAM.*Локально/, 'must not keep the old debug-column hierarchy');
  // Contextual actions
  assert.match(SRC, /Подробнее.*▾|Подробнее/, 'Z2K must have Подробнее disclosure');
});

// 7. Z2K update — без обновления нет фейка, с обновлением есть действие
test('Z2K update state never without action', () => {
  // Если updateState === update-available, рядом должен быть Обновить
  const hasUpdateAction = /updateState.*update-available[\s\S]*?Обновить/.test(SRC) || /Доступно обновление[\s\S]*?Обновить/.test(SRC);
  assert.equal(hasUpdateAction, true, 'update-available must have adjacent [Обновить]');
});

// 8. Optional — правильные названия и нейтральные состояния
test('optional components have correct naming and neutral OFF states', () => {
  assert.doesNotMatch(SRC, /Обновление TG Proxy/, 'must not use old name Обновление TG Proxy');
  assert.match(SRC, /Telegram Proxy/, 'must have Telegram Proxy (correct name)');
  assert.match(SRC, /WARP \/ MASQUE|WARP/, 'must have WARP');
  // Нейтральные состояния
  assert.match(SRC, /Не установлен/, 'must have neutral Не установлен');
  // Не должно быть warning для отсутствующего optional
  // Проверяем что optional карточки используют chip o/muted, не r
  assert.match(SRC, /Опционально|Недоступен/, 'must have optional/unsupported labels');
});

// 9. WARP — нейтральное Недоступен, не ERROR/UNKNOWN warning
test('WARP shows neutral Недоступен, not ERROR', () => {
  assert.match(SRC, /Недоступен/, 'WARP must be Недоступен');
  assert.doesNotMatch(SRC, /WARP.*UNKNOWN|UNKNOWN.*WARP/, 'WARP must not be UNKNOWN warning');
  assert.doesNotMatch(SRC, /WARP.*ERROR|ERROR.*WARP/, 'WARP must not be ERROR');
});

// 10. Visual primitives — использует существующие классы, не generic dashboard
test('uses existing Z2M visual primitives, not generic dashboard', () => {
  assert.match(SRC, /z2m-panel|z2m-phead/, 'must use z2m-panel/phead');
  assert.match(SRC, /z2m-chip/, 'must use z2m-chip for badges');
  assert.match(SRC, /z2m-btn/, 'must use z2m-btn');
  assert.match(SRC, /z2m-acc|details/, 'must use disclosures');
  // Не должен быть generic admin dashboard стиль
  assert.doesNotMatch(SRC, /class=['"]card shadow|bootstrap.*card/, 'must not use generic bootstrap card');
});

// 11. Нет гигантских пустых областей, детальная инфа под Технические сведения
test('detailed info is under Технические сведения, not in default view', () => {
  assert.match(SRC, /Технические детали/, 'must have Технические детали disclosure');
  assert.match(SRC, /z2m-component-technical/, 'technical details must be scoped to Components');
  // SHA, manifest seq, paths не в дефолте
  assert.doesNotMatch(SRC, /SHA-256.*default|manifest.*seq.*default/, 'detailed tech should be hidden by default');
});

// 12. Actions рядом с состоянием (contextual)
test('actions are contextual to state', () => {
  // Готов → Проверить обновления рядом
  // Доступно обновление → Обновить рядом — уже проверено выше
  // Не установлен → Установить/Настроить рядом
  assert.match(SRC, /Настроить →|Установить|Управление →/, 'must have contextual action near state');
});

// 13. Hover/disclosure — не перезагружает страницу, не меняет URL
test('disclosures do not change URL or reload', () => {
  assert.doesNotMatch(SRC, /window\.location\.hash.*component=engine/, 'disclosure must not change hash');
  assert.doesNotMatch(SRC, /ctx\.refresh.*component/, 'must not refresh with component param');
});

// 14. Responsive — использует существующие breakpoints
test('responsive layout uses existing breakpoints', () => {
  // CSS должен иметь @media для компонентов, как в z2m-ui.css (900px, 768px, 560px)
  const hasResponsive = /@media.*max-width.*900px/.test(CSS) || /grid-template-columns.*1fr/.test(CSS);
  assert.equal(hasResponsive, true, 'CSS must have responsive grid');
});
