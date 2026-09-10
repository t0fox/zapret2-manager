import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel) {
  return readFileSync(resolve(rel), 'utf8');
}

function expect(value) {
  return {
    toContain(expected) { assert.ok(value.includes(expected), `expected value to contain ${expected}`); },
    toBe(expected) { assert.equal(value, expected); },
    not: { toContain(expected) { assert.equal(value.includes(expected), false, `expected value not to contain ${expected}`); } }
  };
}

describe('Maintenance polish — product-owned Backup UX', () => {
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const navigation = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js');

  it('navigation contains no hidden Settings or compatibility route', () => {
    expect(navigation).not.toContain("id: 'settings'");
    expect(navigation).not.toContain('hidden: true');
    expect(navigation).not.toContain('ALIASES');
    expect(navigation).toContain("id: 'components'");
    expect(navigation).toContain("id: 'backups'");
  });

  it('maintenance owns only Components and Backups panes', () => {
    expect(maintenance).not.toContain('renderSettings');
    expect(maintenance).not.toContain("route === 'settings'");
    expect(maintenance).toContain("if (route === 'backups') return 'backups'");
  });

  it('Components does not expose a hidden advanced mode', () => {
    expect(maintenance).not.toContain('z2m-components-advanced-row');
    expect(maintenance).not.toContain('z2m-components-section--advanced');
    expect(maintenance).not.toContain('z2m-advanced-block');
    expect(maintenance).not.toContain('Расширенный режим');
    expect(maintenance).not.toContain('ui.advanced');
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

  it('Backup rows do not expose internal manifest hashes', () => {
    expect(maintenance).not.toContain('manifestSha256');
    expect(maintenance).not.toContain('SHA-256:');
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
