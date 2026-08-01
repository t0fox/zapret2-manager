'use strict';

// Maintenance page — versions, scoped backups with restore preview, events,
// diagnostics export (SLICE 5, r38).
// All sections wired to backend; dangerous actions arm→confirm.
// Restore preview shows honest diff before writing.

'require rpc';

const callVersions     = rpc.declare({ object: 'zapret2-manager', method: 'versions', reject: true });
const callMaintStatus  = rpc.declare({ object: 'zapret2-manager', method: 'maintenance_status', reject: true });
const callBackupList   = rpc.declare({ object: 'zapret2-manager', method: 'backup_list', reject: true });
const callBackupCreate = rpc.declare({ object: 'zapret2-manager', method: 'backup_create', params: ['edit'], reject: true });
const callBackupPreview= rpc.declare({ object: 'zapret2-manager', method: 'backup_restore_preview', params: ['edit'], reject: true });
const callBackupRestore= rpc.declare({ object: 'zapret2-manager', method: 'backup_restore', params: ['edit'], reject: true });
const callBackupDelete = rpc.declare({ object: 'zapret2-manager', method: 'backup_delete', params: ['edit'], reject: true });
const callEventsTail   = rpc.declare({ object: 'zapret2-manager', method: 'events_tail', params: ['edit'], reject: true });
const callDiagnostics  = rpc.declare({ object: 'zapret2-manager', method: 'diagnostics_export', reject: true });

var SCOPE_LABELS = {
	engineConfig: _('upstream engine config'),
	ourState:     _('manager state (state.json)'),
	lists:        _('user lists'),
	profiles:     _('draft profiles')
};

var EVENTS_LIMIT = 20;

function esc(s) { return (s == null) ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function h(c) { return document.createTextNode(c); }
function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
}
function fmtTime(t) {
	if (t == null) return _('n/a');
	var d = new Date(t * 1000);
	return isNaN(d.getTime()) ? ('' + t) : d.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
}
function injectCSS() {
	if (document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

return L.view.extend({
	title: _('Maintenance'),

	load: function () {
		function grab(call) {
			return call().then(function (res) { return { loadError: null, data: res || null }; })
				.catch(function (err) { return { loadError: String(err), data: null }; });
		}
		return Promise.all([
			grab(callVersions), grab(callMaintStatus), grab(callBackupList),
			grab(function () { return callEventsTail('{}'); })
		]).then(function (r) {
			return {
				versionsError: r[0].loadError, versions: r[0].data,
				maintError: r[1].loadError, maint: r[1].data,
				backupsError: r[2].loadError, backups: r[2].data,
				eventsError: r[3].loadError, events: r[3].data
			};
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Maintenance')),
				E('p', {}, _('Versions, scoped backups with restore preview, events, and diagnostics export.'))
			])
		]);

		container.appendChild(this.legacyToolsSection());
		container.appendChild(this.versionsCard(envelope));
		container.appendChild(this.backupSection(envelope));
		container.appendChild(this.eventsSection(envelope));
		container.appendChild(this.diagnosticsSection());

		if (this._flash) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	legacyToolsSection: function () {
		return E('div', { 'class': 'z2m-card z2m-legacy-tools' }, [
			E('h4', {}, _('Legacy tools')),
			E('p', { 'class': 'cbi-value-description' }, _('Older diagnostic workflows remain available here without taking space in the main navigation.')),
			E('div', { 'class': 'z2m-actions' }, [
				E('a', { 'class': 'cbi-button cbi-button-neutral', 'href': L.url('admin/services/zapret2-manager/blockcheck') }, _('Blockcheck'))
			])
		]);
	},

	versionsCard: function (envelope) {
		var v = envelope.versions || {};
		var m = envelope.maint || {};
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Versions & system'))
		]);

		if (envelope.versionsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Unavailable: ') + esc(envelope.versionsError)));
		} else {
			node.appendChild(this.kvRow(_('Backend'), esc((v.manager && v.manager.version) || '?')));
			node.appendChild(this.kvRow(_('LuCI UI'), esc((v.luciApp && v.luciApp.version) || '?')));
			node.appendChild(this.kvRow(_('zapret2 upstream'), esc((v.upstreamPkg && v.upstreamPkg.version) || '?')));
			node.appendChild(this.kvRow(_('nfqws2 engine'), esc(v.nfqws2 || '?')));
			node.appendChild(this.kvRow(_('OpenWrt'), esc(v.os || '?')));
		}

		if (envelope.maintError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('System info unavailable: ') + esc(envelope.maintError)));
		} else if (m.ok === true) {
			node.appendChild(this.kvRow(_('Uptime'), m.uptimeSec != null ? Math.floor(m.uptimeSec / 60) + _(' min') : '?'));
			node.appendChild(this.kvRow(_('Memory avail'), (m.memory && m.memory.availableKb != null) ? Math.floor(m.memory.availableKb / 1024) + ' MB' : '?'));
			node.appendChild(this.kvRow(_('Storage overlay/tmp'),
				((m.storage && m.storage.overlayPercent) != null ? m.storage.overlayPercent + '%' : '?') + ' / ' +
				((m.storage && m.storage.tmpPercent) != null ? m.storage.tmpPercent + '%' : '?')));
			node.appendChild(this.kvRow(_('Reboot'), _('not required')));
		}

		node.appendChild(this.kvRow(_('Update available'),
			_('unknown') + (v.note ? ' — ' + esc(v.note) : '')));
		return node;
	},

	backupSection: function (envelope) {
		var self = this;
		var b = envelope.backups || {};
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Backups')),
			E('p', { 'class': 'cbi-value-description' },
				_('Four independent scopes, capped at 3 each. Every archive has a SHA-256 manifest.'))
		]);

		if (envelope.backupsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Unavailable: ') + esc(envelope.backupsError)));
			return node;
		}

		// create row
		var sel = E('select', { 'class': 'cbi-input-select' });
		['all', 'engineConfig', 'ourState', 'lists', 'profiles'].forEach(function (s) {
			sel.appendChild(E('option', { value: s }, s));
		});
		var createBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Create backup'));
		createBtn.addEventListener('click', function () {
			createBtn.disabled = true;
			callBackupCreate(JSON.stringify({ scope: sel.value || 'all' })).then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Backup created.') : (_('Backup failed: ') + esc((res.error && res.error.message) || res.reason || res.error));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Backup call failed: ') + String(err); self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [sel, createBtn]));

		// per-scope history
		var scopes = b.scopes || {};
		Object.keys(SCOPE_LABELS).forEach(function (scope) {
			var entry = scopes[scope] || { current: null, history: [] };
			node.appendChild(E('h5', {}, esc(scope) + ' — ' + SCOPE_LABELS[scope]));
			if (entry.current) {
				node.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('Current: ') + fmtTime(entry.current.takenAt) +
					(entry.current.manifestSha256 ? ' · ' + String(entry.current.manifestSha256).substring(0, 12) + '…' : '')));
			}
			(entry.history || []).forEach(function (h) {
				var row = E('div', { 'class': 'z2m-kv', 'style': 'padding:.2em 0' });
				row.appendChild(E('span', { 'class': 'z2m-kv-label' }, [
					badge('v' + (h.version != null ? h.version : '?'), 'neutral'),
					' ' + fmtTime(h.takenAt)
				]));
				var field = E('span', { 'class': 'z2m-kv-value' });

				var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview'));
				prevBtn.addEventListener('click', function () {
					prevBtn.disabled = true;
					callBackupPreview(JSON.stringify({ scope: scope, takenAt: h.takenAt })).then(function (res) {
						self._preview = { scope: scope, takenAt: h.takenAt, res: res || {} }; self.refresh();
					}).catch(function (err) {
						self._preview = { scope: scope, takenAt: h.takenAt, error: String(err) }; self.refresh();
					});
				});

				var delKey = scope + ':' + h.takenAt;
				var delBtn = E('button', {
					'class': 'cbi-button ' + (self._deleteArmed === delKey ? 'cbi-button-negative' : 'cbi-button-neutral'),
					'type': 'button'
				}, self._deleteArmed === delKey ? _('Confirm delete?') : _('Delete'));
				delBtn.addEventListener('click', function () {
					if (self._deleteArmed !== delKey) { self._deleteArmed = delKey; self.refresh(); return; }
					self._deleteArmed = null; delBtn.disabled = true;
					callBackupDelete(JSON.stringify({ scope: scope, takenAt: h.takenAt })).then(function (res) {
						res = res || {};
						self._flash = (res.ok === true) ? _('Deleted.') : (_('Delete failed: ') + esc((res.error && res.error.message) || res.error));
						self.refresh();
					}).catch(function (err) {
						self._flash = _('Delete call failed: ') + String(err); self.refresh();
					});
				});

				field.appendChild(E('div', { 'class': 'z2m-actions' }, [prevBtn, delBtn]));
				row.appendChild(field);
				node.appendChild(row);
			});
		});

		if (this._preview) node.appendChild(this.previewPanel(this._preview));
		return node;
	},

	previewPanel: function (pv) {
		var self = this;
		if (pv.error) return E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Preview failed: ') + esc(pv.error));
		var res = pv.res || {};
		if (res.ok !== true) return E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Preview refused: ') + esc((res.error && res.error.message) || res.error));

		var box = E('div', { 'class': 'z2m-card', 'id': 'z2m-backup-preview' }, [
			E('h4', {}, _('Restore preview — ') + esc(pv.scope) + ' @ ' + fmtTime(pv.takenAt)),
			this.kvRow(_('Integrity'), res.integrity && res.integrity.ok
				? badge(_('SHA-256 OK'), 'ok')
				: badge((res.integrity && res.integrity.reason) || _('failed'), 'bad')),
			this.kvRow(_('Version gate'),
				res.versionGate === 'ok' ? badge(_('ok'), 'ok') :
				res.versionGate === 'downgrade' ? badge(_('downgrade'), 'warn') :
				badge(_('refuse'), 'bad'))
		]);

		(res.diffs || []).forEach(function (d) {
			box.appendChild(this.kvRow(esc(d.path),
				(d.presentNow ? (d.changed ? _('changed') : _('identical')) : _('not present')) +
				' · ' + (d.currentSize != null ? d.currentSize : '—') + 'B → ' + d.archiveSize + 'B'));
		});

		(res.syntax || []).forEach(function (s) {
			box.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Syntax: ') + esc(s.path) + ': ' + esc(s.reason)));
		});

		if (res.restorable) {
			var armed = this._restoreArmed === pv.scope + ':' + pv.takenAt;
			var restoreBtn = E('button', {
				'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'), 'type': 'button'
			}, armed ? _('Confirm restore (current state snapshotted first)?') : _('Restore'));
			restoreBtn.addEventListener('click', function () {
				var key = pv.scope + ':' + pv.takenAt;
				if (self._restoreArmed !== key) { self._restoreArmed = key; self.refresh(); return; }
				self._restoreArmed = null; restoreBtn.disabled = true;
				callBackupRestore(JSON.stringify({ scope: pv.scope, takenAt: pv.takenAt })).then(function (r2) {
					r2 = r2 || {};
					self._preview = null;
					self._flash = (r2.ok === true) ? (_('Restored.') + (r2.downgradeWarning ? ' ' + r2.downgradeWarning : ''))
						: (_('Restore failed: ') + esc((r2.error && r2.error.message) || r2.reason || r2.error));
					self.refresh();
				}).catch(function (err) {
					self._preview = null;
					self._flash = _('Restore call failed: ') + String(err); self.refresh();
				});
			});
			box.appendChild(E('div', { 'class': 'z2m-actions' }, [restoreBtn]));
		} else {
			box.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Not restorable.')));
		}
		return box;
	},

	eventsSection: function (envelope) {
		var self = this;
		var ev = envelope.events || {};
		var allEvents = ev.events || [];
		var malformed = ev.malformed || [];

		if (!this._eventsLimit) this._eventsLimit = EVENTS_LIMIT;
		var limit = this._eventsLimit;
		var shown = allEvents.slice().reverse().slice(0, limit);

		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Events') + ' (' + Math.min(shown.length, allEvents.length) + '/' + allEvents.length + ')')
		]);

		if (envelope.eventsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Unavailable: ') + esc(envelope.eventsError)));
			return node;
		}

		if (!shown.length && !malformed.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No events recorded.')));
			return node;
		}

		shown.forEach(function (e) {
			var sevMap = { crit: 'bad', warn: 'warn' };
			node.appendChild(E('div', { 'class': 'z2m-kv', 'style': 'font-size:.85em' }, [
				E('span', { 'class': 'z2m-kv-label', 'style': 'flex:0 0 140px;font-family:monospace' }, esc(e.ts || '?')),
				E('span', { 'class': 'z2m-kv-value' }, [
					badge(e.severity || '?', sevMap[e.severity] || 'neutral'),
					' [' + esc(e.source || '?') + '] ' + esc(e.msg || '')
				])
			]));
		});

		malformed.forEach(function (m) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Malformed: ') + esc(m.preview || '')));
		});

		if (allEvents.length > limit) {
			var moreBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' },
				_('Load more (' + (allEvents.length - limit) + ' remaining)'));
			moreBtn.addEventListener('click', function () {
				self._eventsLimit = (self._eventsLimit || EVENTS_LIMIT) + EVENTS_LIMIT; self.refresh();
			});
			node.appendChild(E('div', { 'class': 'z2m-actions' }, [moreBtn]));
		}

		return node;
	},

	diagnosticsSection: function () {
		var self = this;
		var btn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Export diagnostics'));
		btn.addEventListener('click', function () {
			btn.disabled = true;
			callDiagnostics().then(function (res) {
				btn.disabled = false; res = res || {};
				if (res.ok !== true) { self._flash = _('Export failed'); self.refresh(); return; }
				var json = JSON.stringify(res.export, null, 2);
				var note = _('Diagnostics collected') + (res.export && res.export.redactedFields ? _(' — ') + res.export.redactedFields + _(' fields redacted') : '');
				if (typeof URL !== 'undefined' && URL.createObjectURL && typeof Blob !== 'undefined') {
					var blob = new Blob([json], { type: 'application/json' });
					var a = E('a', { href: URL.createObjectURL(blob), download: 'zapret2-manager-diagnostics.json' }, '');
					if (a && a.click) a.click();
					self._flash = note + _('. Downloaded.');
				} else {
					self._flash = note;
					self._diagText = json;
				}
				self.refresh();
			}).catch(function (err) {
				btn.disabled = false;
				self._flash = _('Export call failed: ') + String(err); self.refresh();
			});
		});

		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Diagnostics')),
			E('p', { 'class': 'cbi-value-description' },
				_('Bundles versions, status, events and config hashes. Secret fields are redacted.'))
		]);

		node.appendChild(E('div', { 'class': 'z2m-actions' }, [btn]));

		if (this._diagText) {
			node.appendChild(E('pre', { 'class': 'z2m-mono' }, this._diagText));
			this._diagText = null;
		}
		return node;
	},

	refresh: function () {
		var self = this;
		this.load().then(function (envelope) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode) old.parentNode.replaceChild(self.render(envelope), old);
		});
	},

	kvRow: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, label),
			E('span', { 'class': 'z2m-kv-value' }, value)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
