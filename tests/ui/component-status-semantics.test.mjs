import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel) {
  return readFileSync(resolve(rel), 'utf8');
}

describe('Component status semantics — unified GREEN/AMBER/RED/MUTED', () => {
  const js = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');

  it('defines unified SEMANTIC_KIND table', () => {
    expect(js).toContain('SEMANTIC_KIND');
    expect(js).toContain("'Система готова': 'g'");
    expect(js).toContain("'Работает': 'g'");
    expect(js).toContain("'Актуален': 'g'");
    expect(js).toContain("'Доступно обновление': 'o'");
    expect(js).toContain("'Требует внимания': 'o'");
    expect(js).toContain("'Ошибка': 'r'");
    expect(js).toContain("'Несовместим': 'r'");
    expect(js).toContain("'Не установлен': ''");
    expect(js).toContain("'Остановлен': ''");
    expect(js).toContain("'Недоступен': ''");
    expect(js).toContain('function kindForLabel');
  });

  it('Engine healthy must be Работает green, not Готов yellow', () => {
    // componentStateLabel for engine must return Работает when healthy
    expect(js).toContain("if (component.id === 'engine')");
    expect(js).toContain("return _('Работает')");
    // Should not return Готов for healthy engine
    const engineSection = js.slice(js.indexOf("if (component.id === 'engine')"), js.indexOf("if (component.id === 'z2k-core')"));
    expect(engineSection).not.toContain("return _('Готов')");
    // Kind must be via kindForLabel, which maps Работает -> g
    expect(js).toContain('function componentStateKind');
    expect(js).toContain('kindForLabel(label)');
  });

  it('Z2K current must be Актуален green, not Готов', () => {
    expect(js).toContain("if (component.id === 'z2k-core')");
    // Must have Актуален for ready+current+compatible
    expect(js).toContain("return _('Актуален')");
    // Must handle update-available as Доступно обновление amber
    expect(js).toContain("if (component.updateState === 'update-available') return _('Доступно обновление')");
    // Must handle integration-required as Требует внимания
    expect(js).toContain("if (component.updateState === 'integration-required') return _('Требует внимания')");
    // Broken must be Ошибка red
    const z2kSection = js.slice(js.indexOf("if (component.id === 'z2k-core')"), js.indexOf("var health = component.health;"));
    expect(z2kSection).toContain("return _('Ошибка')");
  });

  it('Telegram running must be Работает green, stopped/not-installed muted', () => {
    expect(js).toContain('function telegramCardState');
    // Should use kindForLabel for all branches
    expect(js).toContain("kind: kindForLabel(_('Работает'))");
    expect(js).toContain("kind: kindForLabel(_('Не установлен'))");
    expect(js).toContain("kind: kindForLabel(_('Остановлен'))");
    expect(js).toContain("kind: kindForLabel(_('Требует внимания'))");
    // Should not have hardcoded kind: 'o' for off states
    const tgSection = js.slice(js.indexOf('function telegramCardState'), js.indexOf('function load(ctx)'));
    // Count occurrences of "kind: 'o'" in that section — should be 0 for off (only degraded should be via kindForLabel)
    const offKindO = (tgSection.match(/kind: 'o'/g) || []).length;
    // Degraded is amber via kindForLabel, not hardcoded 'o', so there should be 0 hardcoded
    expect(offKindO).toBe(0);
  });

  it('WARP unavailable must be muted, not warning', () => {
    expect(js).toContain("id: 'warp'");
    // Must use kindForLabel for Недоступен, not hardcoded 'o'
    const warpIdx = js.indexOf("id: 'warp'");
    const warpSnippet = js.slice(warpIdx, warpIdx + 500);
    expect(warpSnippet).toContain("kindForLabel(_('Недоступен'))");
    expect(warpSnippet).not.toContain("statusKind: 'o'");
  });

  it('hero dots must use same semantic colors as cards', () => {
    expect(js).toContain("z2m-components-hero-dots");
    const heroDotsIdx = js.indexOf('z2m-components-hero-dots');
    const heroSnippet = js.slice(heroDotsIdx, heroDotsIdx + 800);
    expect(heroSnippet).toContain('componentStateKind(c)');
    // Must NOT contain old separate logic with hardcoded g/o/r
    expect(heroSnippet).not.toContain("c.health === 'ready'");
  });

  it('same label must always have same kind (no Готов yellow/green divergence)', () => {
    // Ensure SEMANTIC_KIND maps Готов to single kind (g) and not used for components
    // Check that componentStateLabel no longer returns Готов for components (except maybe system)
    const compLabelSection = js.slice(js.indexOf('function componentStateLabel'), js.indexOf('function componentStateKind'));
    // Should not return _('Готов') for engine/z2k healthy
    const gotovCount = (compLabelSection.match(/_\(\'Готов\'\)/g) || []).length;
    expect(gotovCount).toBe(0);
    // System hero still uses Система готова green, which is fine
    expect(js).toContain("_('Система готова')");
  });

  it('color table is consistent per spec', () => {
    // GREEN
    expect(js).toContain("'Работает': 'g'");
    expect(js).toContain("'Актуален': 'g'");
    // AMBER
    expect(js).toContain("'Доступно обновление': 'o'");
    expect(js).toContain("'Требует внимания': 'o'");
    // RED
    expect(js).toContain("'Ошибка': 'r'");
    expect(js).toContain("'Несовместим': 'r'");
    // MUTED - empty string
    expect(js).toContain("'Не установлен': ''");
    expect(js).toContain("'Недоступен': ''");
    expect(js).toContain("'Остановлен': ''");
  });
});
