import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel) {
  return readFileSync(resolve(rel), 'utf8');
}

describe('Maintenance polish — Settings removal and Backup UX', () => {
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const navigation = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js');

  it('Settings tab is hidden in visible subnav', () => {
    expect(navigation).toContain("id: 'settings'");
    // Must have hidden: true for settings
    const settingsSection = navigation.slice(navigation.indexOf("id: 'settings'") - 100, navigation.indexOf("id: 'settings'") + 200);
    expect(settingsSection).toContain('hidden: true');
    // System group should still have only two visible items: components and backups
    const systemGroup = navigation.slice(navigation.indexOf("id: 'system'"), navigation.indexOf("id: 'system'") + 800);
    // Count visible (non-hidden) items in system group — should be 2, not 3
    expect(systemGroup).toContain("id: 'components'");
    expect(systemGroup).toContain("id: 'backups'");
  });

  it('activePane maps /settings to components for compatibility', () => {
    expect(maintenance).toContain("if (route === 'settings') return 'components'");
    expect(maintenance).not.toContain("if (route === 'settings') return 'settings'");
  });

  it('Advanced toggle is available on Components as a simple row (not a separate section)', () => {
    expect(maintenance).toContain('z2m-components-advanced-row');
    expect(maintenance).not.toContain('z2m-components-section--advanced');
    expect(maintenance).not.toContain('z2m-advanced-block');
    expect(maintenance).toContain('Расширенный режим');
    expect(maintenance).toContain('Показывать технические данные и диагностические поля.');
    // Must use existing store semantics
    expect(maintenance).toContain('ctx.store.get().ui');
    expect(maintenance).toContain('ctx.store.update');
    expect(maintenance).toContain('ui.advanced');
    // Must be inside renderComponents, not only renderSettings
    const advancedRow = maintenance.slice(maintenance.indexOf('z2m-components-advanced-row') - 500, maintenance.indexOf('z2m-components-advanced-row') + 1000);
    expect(advancedRow).toContain('switchControl');
  });

  it('Backup top card uses Создать резервную копию and Создать полную копию', () => {
    expect(maintenance).toContain("shell.panel(_('Создать резервную копию')");
    expect(maintenance).toContain("Сохранит всё состояние Zapret2 Manager.");
    expect(maintenance).toContain("shell.button(_('Создать полную копию')");
    expect(maintenance).not.toContain("Создать полный backup");
    // Scoped create must be under Дополнительно
    const backupTop = maintenance.slice(maintenance.indexOf("Создать резервную копию") - 200, maintenance.indexOf("Создать резервную копию") + 1500);
    expect(backupTop).toContain('Дополнительно');
    expect(maintenance).toContain("Создать выбранную область");
  });

  it('SCOPE_LABELS has all -> Полная резервная копия', () => {
    expect(maintenance).toContain("all: _('Полная резервная копия')");
  });

  it('Backup rows use Восстановить not Предпросмотр and keep preview flow', () => {
    expect(maintenance).toContain("shell.button(_('Восстановить'), 'sm', previewBackup");
    expect(maintenance).not.toContain("shell.button(_('Предпросмотр')");
    // Must still call previewBackup, not restoreBackup directly
    const rowsSection = maintenance.slice(maintenance.indexOf('visibleRecords.map'), maintenance.indexOf('visibleRecords.map') + 1500);
    expect(rowsSection).toContain('previewBackup');
    expect(rowsSection).not.toContain('restoreBackup');
    // Preview panel title and button
    expect(maintenance).toContain("_('Восстановление резервной копии')");
    expect(maintenance).toContain("_('Восстановить копию')");
    expect(maintenance).not.toContain("_('Предпросмотр восстановления')");
    expect(maintenance).not.toContain("_('Восстановить этот архив')");
  });

  it('manifestSha256 hidden when advanced=false, visible when advanced=true', () => {
    expect(maintenance).toContain('var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced)');
    expect(maintenance).toContain("(advanced && record.manifestSha256)");
    expect(maintenance).toContain("'SHA-256: ' + record.manifestSha256.slice(0, 8)");
    // Should not show full sha unconditionally
    const shaLine = maintenance.slice(maintenance.indexOf('SHA-256:'), maintenance.indexOf('SHA-256:') + 200);
    expect(shaLine).toContain('slice(0, 8)');
  });

  it('Backup list shows only 5 initially with Показать все / Скрыть старые', () => {
    expect(maintenance).toContain('showAllBackups: false');
    expect(maintenance).toContain('visibleRecords = state.showAllBackups ? records : records.slice(0, 5)');
    expect(maintenance).toContain("Показать все (' + records.length + ')");
    expect(maintenance).toContain("Скрыть старые");
    expect(maintenance).toContain('state.showAllBackups = true');
    expect(maintenance).toContain('state.showAllBackups = false');
    // Should be frontend state, no new API
    expect(maintenance).not.toContain('api.maintenance.backupList({ limit: 5 })');
  });

  it('Terminology uses резервная копия not backup in user strings', () => {
    expect(maintenance).toContain("Резервная копия создана.");
    expect(maintenance).toContain("Резервная копия удалена.");
    expect(maintenance).toContain("Резервная копия восстановлена и проверена.");
    expect(maintenance).toContain("Удалить резервную копию?");
    expect(maintenance).toContain("Восстановить резервную копию?");
    expect(maintenance).toContain("История резервных копий пуста.");
    // Should not have user-visible "Backup" (capital B) in toasts/titles
    const userStrings = maintenance.match(/_\(\'[^']*Backup[^']*\'\)/g) || [];
    // Only internal API names like backupCreate etc are allowed, not user strings
    const backupUserStrings = userStrings.filter(s => s.includes('Backup') && !s.includes('backupCreate') && !s.includes('backupDelete'));
    expect(backupUserStrings.length).toBe(0);
  });

  it('Preview still goes through verification, not direct restore', () => {
    // Clicking Восстановить should call previewBackup which does backup-preview + verification
    expect(maintenance).toContain("mutation(ctx, 'backup-preview'");
    expect(maintenance).toContain('MaintenanceModel.restorePreview');
    expect(maintenance).toContain('MaintenanceModel.verifyRestore');
    // Final restore still requires confirmation and verification
    expect(maintenance).toContain("confirmAction(ctx, _('Восстановить резервную копию?')");
  });
});
