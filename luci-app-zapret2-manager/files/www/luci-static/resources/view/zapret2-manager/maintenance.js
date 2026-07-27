'use strict';

// Maintenance page — versions, backups, restore, diagnostics.
//
// Available TODAY (ubus `status`): upstream.nfqws2Version and
// system.upgradable. Everything else (manager/LuCI package versions,
// lua_compat_ver, backup state, restore preview, events, diagnostics) has NO
// ubus method yet — backup.uc exists as a library but is not wired to the
// bus. Those sections render honest "Unavailable" panels naming the exact
// methods they wait for.
//
// Dangerous actions (restore, upgrade, reset, delete backup) render DISABLED
// while their methods are absent — so they need no confirm dialogs yet. When
// the methods land, each dangerous action gets exactly ONE confirmation
// (ui.confirm), never stacked modals. No package update is ever run from the
// browser via shell — updates go through a backend contract.

'require rpc';

// reject: true — a ubus error must reject into .catch(); the default
// (reject:false) would resolve it as a numeric code and fake a healthy load.
const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });

// The four backup scopes (zapret2-manager/files/usr/libexec/zapret2-manager/
// backup.uc). Paths shown are the expected scope sources, marked as such.
const BACKUP_SCOPES = [
	{ id: 'engineConfig', paths: ['/opt/zapret2/config'], what: _('upstream engine config') },
	{ id: 'ourState', paths: ['/etc/zapret2-manager/state.json'], what: _('manager state') },
	{ id: 'lists', paths: ['/opt/zapret2/ipset/zapret-hosts-user.txt',
		'/opt/zapret2/ipset/zapret-hosts-user-exclude.txt'], what: _('user lists') },
	{ id: 'profiles', paths: ['/etc/zapret2-manager/profiles'], what: _('profiles') }
];

const MISSING_METHODS = [
	'maintenance_status', 'versions',
	'backup_list', 'backup_create', 'backup_restore_preview', 'backup_restore', 'backup_delete',
	'diagnostics_export', 'events_tail'
];

return L.view.extend({
	title: _('Maintenance'),

	load: function () {
		return callStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
	},

	render: function (envelope) {
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var statusError = envelope.loadError || data.error || null;
		var upstream = data.upstream || {};
		var system = data.system || {};

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Maintenance')),
			E('div', { 'class': 'cbi-value-description' },
				_('Versions, scoped backups with restore preview, and diagnostics export. Dangerous actions stay disabled until their backend methods exist.'))
		]);

		if (statusError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Status unavailable: ') + statusError)));
		}

		container.appendChild(this.versionsSection(upstream, system, statusError));
		container.appendChild(this.backupSection());
		container.appendChild(this.restoreSection());
		container.appendChild(this.eventsSection());
		container.appendChild(this.diagnosticsSection());

		return container;
	},

	versionsSection: function (upstream, system, statusError) {
		var upgradable = system.upgradable;
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Versions')),
			this.row(_('nfqws2 (engine)'),
				statusError ? _('Unavailable')
					: (upstream.nfqws2Version == null ? _('Unavailable — checked, none found') : upstream.nfqws2Version)),
			this.row(_('zapret2 (upstream package)'), _('Unavailable — requires backend method versions')),
			this.row(_('zapret2-manager (backend)'), _('Unavailable — requires backend method versions')),
			this.row(_('luci-app-zapret2-manager (UI)'), _('Unavailable — requires backend method versions')),
			this.row(_('lua_compat_ver'), _('Unavailable — requires backend method versions')),
			this.row(_('Update available'),
				statusError ? _('Unavailable')
					: (upgradable === true ? E('span', { 'class': 'zonebadge warn' }, _('update available'))
						: upgradable === false ? E('span', { 'class': 'zonebadge ok' }, _('up to date'))
							: _('Unavailable — unknown'))),
			this.row(_('Reboot required'),
				_('Unavailable — requires backend method maintenance_status'))
		]);
	},

	backupSection: function () {
		var rows = BACKUP_SCOPES.map(function (s) {
			return E('tr', {}, [
				E('td', {}, s.id),
				E('td', {}, s.what),
				E('td', { 'style': 'font-family:monospace;font-size:.85em;white-space:pre-wrap' },
					s.paths.join('\n')),
				E('td', {}, _('Unavailable — requires backup_list'))
			]);
		});
		var createBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Create backup now'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Backups (four independent scopes)')),
			E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('Scope')), E('th', {}, _('Contents')),
					E('th', {}, _('Expected source paths')), E('th', {}, _('Current / history'))])
			].concat(rows)),
			E('div', { 'class': 'cbi-value-description' },
				_('History is capped at 3 per scope; each backup carries a SHA-256 manifest and a syntax check. Restore always snapshots the current state first (pre-restore snapshot) and warns on downgrade.')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [createBtn]),
			E('div', { 'class': 'cbi-value-description' },
				_('Create requires backend method backup_create — not registered yet.'))
		]);
	},

	restoreSection: function () {
		var buttons = [_('Restore…'), _('Delete backup…')].map(function (n) {
			return E('button', {
				'class': 'cbi-button cbi-button-negative', 'type': 'button',
				'disabled': 'disabled', 'title': _('Backend method unavailable')
			}, n);
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Restore')),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — restore preview (diff, SHA-256 manifest verification, syntax check, downgrade warning) requires backend methods backup_restore_preview / backup_restore / backup_delete.')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, buttons),
			E('div', { 'class': 'cbi-value-description' },
				_('When the methods exist, restore/delete will each get exactly ONE confirmation dialog — never stacked modals. No button is active before that.'))
		]);
	},

	eventsSection: function () {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Maintenance events')),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — the maintenance event log (/tmp/zapret2-manager/events.ndjson) is not exposed over ubus. Requires backend method events_tail.'))
		]);
	},

	diagnosticsSection: function () {
		var btn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Export diagnostics'));
		var resetBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Reset manager state…'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Diagnostics & reset')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [btn, resetBtn]),
			E('div', { 'class': 'cbi-value-description' },
				_('Export requires backend method diagnostics_export; reset requires maintenance_status + a dedicated reset method. Package updates are never executed from the browser — they go through the backend.'))
		]);
	},

	row: function (label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, value)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
