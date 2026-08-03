'use strict';

'require rpc';
'require view.zapret2-manager.maintenance-legacy as LegacyMaintenance';

/* Frozen RPC declarations: the legacy view owns all actions and payloads. */
const callVersions = rpc.declare({ object: 'zapret2-manager', method: 'versions', reject: true });
const callMaintStatus = rpc.declare({ object: 'zapret2-manager', method: 'maintenance_status', reject: true });
const callBackupList = rpc.declare({ object: 'zapret2-manager', method: 'backup_list', reject: true });
const callBackupCreate = rpc.declare({ object: 'zapret2-manager', method: 'backup_create', params: ['edit'], reject: true });
const callBackupPreview = rpc.declare({ object: 'zapret2-manager', method: 'backup_restore_preview', params: ['edit'], reject: true });
const callBackupRestore = rpc.declare({ object: 'zapret2-manager', method: 'backup_restore', params: ['edit'], reject: true });
const callBackupDelete = rpc.declare({ object: 'zapret2-manager', method: 'backup_delete', params: ['edit'], reject: true });
const callEventsTail = rpc.declare({ object: 'zapret2-manager', method: 'events_tail', params: ['edit'], reject: true });
const callDiagnostics = rpc.declare({ object: 'zapret2-manager', method: 'diagnostics_export', reject: true });

function latestBackup(backups) {
	var latest = null;
	var scopes = backups && backups.scopes || {};
	Object.keys(scopes).forEach(function (scope) {
		var current = scopes[scope] && scopes[scope].current;
		if (current && current.takenAt != null && (latest == null || current.takenAt > latest)) latest = current.takenAt;
	});
	return latest;
}

function timeLabel(unix) {
	if (unix == null) return _('резервных копий ещё нет');
	var date = new Date(Number(unix) * 1000);
	return isNaN(date.getTime()) ? String(unix) : date.toLocaleString();
}

var legacyRender = LegacyMaintenance.render;
LegacyMaintenance.title = _('Обслуживание');
LegacyMaintenance.render = function (envelope) {
	var root = legacyRender.call(this, envelope);
	root.classList.add('z2m-page', 'z2m-maintenance-page');

	var header = root.querySelector('.z2m-page-header');
	if (header) {
		var heading = header.querySelector('h2');
		var description = header.querySelector('p');
		if (heading) heading.textContent = _('Обслуживание');
		if (description) description.textContent = _('Резервные копии, версии, события и диагностический отчёт.');

		var backups = envelope && envelope.backups || {};
		var latest = latestBackup(backups);
		var versions = envelope && envelope.versions || {};
		var managerVersion = versions.manager && versions.manager.version || _('не определена');
		var hero = E('section', { 'class': 'z2m-hero z2m-maintenance-hero' }, [
			E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, '↻'),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, _('Последняя резервная копия: ') + timeLabel(latest)),
				E('p', {}, _('Версия менеджера: ') + String(managerVersion))
			])
		]);
		header.parentNode.insertBefore(hero, header.nextSibling);
	}

	Array.prototype.forEach.call(root.querySelectorAll('.cbi-section'), function (section) {
		section.classList.add('z2m-card');
	});
	var cards = Array.prototype.slice.call(root.children).filter(function (node) {
		return node.classList && node.classList.contains('z2m-card');
	});
	cards.forEach(function (card) {
		var title = card.querySelector('h4');
		if (title && /delete|restore|удал|восстанов/i.test(title.textContent || ''))
			card.classList.add('z2m-danger-zone');
	});
	if (cards.length) {
		var grid = E('div', { 'class': 'z2m-card-grid z2m-maintenance-grid' });
		cards[0].parentNode.insertBefore(grid, cards[0]);
		cards.forEach(function (card) { grid.appendChild(card); });
	}
	Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
		table.classList.add('z2m-table');
		if (table.parentNode && !table.parentNode.classList.contains('z2m-table-wrap'))
			table.parentNode.classList.add('z2m-table-wrap');
	});
	Array.prototype.forEach.call(root.querySelectorAll('pre'), function (node) {
		node.classList.add('z2m-console');
	});
	return root;
};

return LegacyMaintenance;
