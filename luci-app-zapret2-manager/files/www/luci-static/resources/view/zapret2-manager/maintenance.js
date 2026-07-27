'use strict';

// Maintenance page — versions, scoped backups with restore preview, events,
// diagnostics export (SLICE 5). All sections are wired to real backend
// methods; dangerous actions (restore, delete) use exactly ONE arm→confirm
// step. Restore preview shows the honest diff BEFORE anything is written.
// No browser-direct filesystem access; no package updates from the browser.

'require rpc';

const callVersions = rpc.declare({ object: 'zapret2-manager', method: 'versions', reject: true });
const callMaintStatus = rpc.declare({ object: 'zapret2-manager', method: 'maintenance_status', reject: true });
const callBackupList = rpc.declare({ object: 'zapret2-manager', method: 'backup_list', reject: true });
const callBackupCreate = rpc.declare({ object: 'zapret2-manager', method: 'backup_create', params: ['edit'], reject: true });
const callBackupPreview = rpc.declare({ object: 'zapret2-manager', method: 'backup_restore_preview', params: ['edit'], reject: true });
const callBackupRestore = rpc.declare({ object: 'zapret2-manager', method: 'backup_restore', params: ['edit'], reject: true });
const callBackupDelete = rpc.declare({ object: 'zapret2-manager', method: 'backup_delete', params: ['edit'], reject: true });
const callEventsTail = rpc.declare({ object: 'zapret2-manager', method: 'events_tail', params: ['edit'], reject: true });
const callDiagnostics = rpc.declare({ object: 'zapret2-manager', method: 'diagnostics_export', reject: true });

const SCOPE_LABELS = {
	engineConfig: _('upstream engine config'),
	ourState: _('manager state (state.json)'),
	lists: _('user lists'),
	profiles: _('draft profiles (portable export)')
};

function fmtTime(t) {
	if (t == null) return _('n/a');
	var d = new Date(t * 1000);
	return isNaN(d.getTime()) ? ('' + t) : d.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
}

return L.view.extend({
	title: _('Maintenance'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
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
		envelope = envelope || {};
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Maintenance')),
			E('div', { 'class': 'cbi-value-description' },
				_('Versions, scoped backups with restore preview, events, and diagnostics export. Dangerous actions confirm exactly once; restore always previews first.'))
		]);
		container.appendChild(this.versionsSection(envelope));
		container.appendChild(this.backupSection(envelope));
		container.appendChild(this.eventsSection(envelope));
		container.appendChild(this.diagnosticsSection());
		if (this._flash) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	// ---- versions + status ------------------------------------------------------
	versionsSection: function (envelope) {
		var v = envelope.versions || {};
		var m = envelope.maint || {};
		var verr = envelope.versionsError;
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Versions & system'))]);
		if (verr) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — versions: ') + verr));
		} else {
			node.appendChild(this.row(_('zapret2-manager (backend)'), (v.manager && v.manager.version) || _('Unavailable — not reported by apk')));
			node.appendChild(this.row(_('luci-app-zapret2-manager (UI)'), (v.luciApp && v.luciApp.version) || _('Unavailable')));
			node.appendChild(this.row(_('zapret2 (upstream package)'), (v.upstreamPkg && v.upstreamPkg.version) || _('Unavailable')));
			node.appendChild(this.row(_('nfqws2 (engine)'), v.nfqws2 || _('Unavailable')));
			node.appendChild(this.row(_('lua_compat_ver'), v.luaCompatVer != null ? v.luaCompatVer : _('Unavailable')));
			node.appendChild(this.row(_('OpenWrt'), v.os || _('Unavailable')));
			node.appendChild(this.row(_('Update available'),
				E('span', {}, [_('unknown'), E('span', { 'class': 'cbi-value-description' }, ' — ' + (v.note || ''))])));
		}
		if (envelope.maintError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — maintenance_status: ') + envelope.maintError));
		} else if (m.ok === true) {
			node.appendChild(this.row(_('Uptime'), m.uptimeSec != null ? Math.floor(m.uptimeSec / 60) + _(' min') : _('Unavailable')));
			node.appendChild(this.row(_('Memory available'), (m.memory && m.memory.availableKb != null) ? Math.floor(m.memory.availableKb / 1024) + ' MB' : _('Unavailable')));
			node.appendChild(this.row(_('Storage /overlay · /tmp'),
				((m.storage && m.storage.overlayPercent) != null ? m.storage.overlayPercent + '%' : _('?')) + ' · ' +
				((m.storage && m.storage.tmpPercent) != null ? m.storage.tmpPercent + '%' : _('?'))));
			node.appendChild(this.row(_('Reboot required'), _('no — this manager never requires one for its own changes')));
		}
		return node;
	},

	// ---- backups ----------------------------------------------------------------
	backupSection: function (envelope) {
		var self = this;
		var b = envelope.backups || {};
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Backups (four independent scopes)')),
			E('div', { 'class': 'cbi-value-description' },
				_('History capped at 3 per scope; every archive carries a SHA-256 manifest and a syntax check. Restore snapshots the current state first, restores only allowlisted paths through sanctioned writers, and warns on downgrade.'))
		]);
		if (envelope.backupsError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — backup_list: ') + envelope.backupsError));
			return node;
		}

		// create row
		var sel = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-backup-scope' });
		['all', 'engineConfig', 'ourState', 'lists', 'profiles'].forEach(function (s) {
			sel.appendChild(E('option', { 'value': s }, s));
		});
		var createBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-backup-create' }, _('Create backup now'));
		createBtn.addEventListener('click', function () {
			createBtn.disabled = true;
			var scope = sel.value || sel.attrs.value || 'all';
			callBackupCreate(JSON.stringify({ scope: scope })).then(function (res) {
				res = res || {};
				if (res.ok !== true) self._flash = _('Backup failed: ') + ((res.error && res.error.message) || res.reason || res.error || _('unknown'));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Backup call failed: ') + String(err);
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [sel, createBtn]));

		var scopes = b.scopes || {};
		Object.keys(SCOPE_LABELS).forEach(function (scope) {
			var entry = scopes[scope] || { current: null, history: [] };
			var card = E('div', { 'class': 'cbi-section' }, [
				E('h4', {}, scope + ' — ' + SCOPE_LABELS[scope]),
				E('div', { 'class': 'cbi-value-description' },
					(entry.current)
						? _('current: ') + fmtTime(entry.current.takenAt) + ' · manifest ' + (entry.current.manifestSha256 ? String(entry.current.manifestSha256).substring(0, 12) + '…' : _('none'))
						: _('(no backup yet)'))
			]);
			(entry.history || []).forEach(function (h) {
				var rowBox = E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, fmtTime(h.takenAt)),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'class': 'zonebadge' }, 'v' + (h.version != null ? h.version : '?')),
						' ' + (h.files || []).length + _(' file(s)'),
						h.manifestSha256 ? ' · sha256 ' + String(h.manifestSha256).substring(0, 10) + '…' : ''
					])
				]);
				var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview'));
				prevBtn.addEventListener('click', function () {
					prevBtn.disabled = true;
					callBackupPreview(JSON.stringify({ scope: scope, takenAt: h.takenAt })).then(function (res) {
						self._preview = { scope: scope, takenAt: h.takenAt, res: res || {} };
						self.refresh();
					}).catch(function (err) {
						self._preview = { scope: scope, takenAt: h.takenAt, error: String(err) };
						self.refresh();
					});
				});
				var delBtn = E('button', {
					'class': 'cbi-button ' + (self._deleteArmed === scope + ':' + h.takenAt ? 'cbi-button-negative' : 'cbi-button-neutral'),
					'type': 'button'
				}, self._deleteArmed === scope + ':' + h.takenAt ? _('Confirm delete?') : _('Delete'));
				delBtn.addEventListener('click', function () {
					var key = scope + ':' + h.takenAt;
					if (self._deleteArmed !== key) { self._deleteArmed = key; self.refresh(); return; }
					self._deleteArmed = null;
					delBtn.disabled = true;
					callBackupDelete(JSON.stringify({ scope: scope, takenAt: h.takenAt })).then(function (res) {
						res = res || {};
						if (res.ok !== true) self._flash = _('Delete failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
						self.refresh();
					}).catch(function (err) {
						self._flash = _('Delete call failed: ') + String(err);
						self.refresh();
					});
				});
				rowBox.appendChild(E('div', { 'class': 'cbi-button-row' }, [prevBtn, delBtn]));
				card.appendChild(rowBox);
			});
			node.appendChild(card);
		});

		// preview/restore panel
		if (this._preview) node.appendChild(this.previewPanel(this._preview));
		return node;
	},

	previewPanel: function (pv) {
		var self = this;
		if (pv.error) return E('div', { 'class': 'alert-message danger' }, _('Preview failed: ') + pv.error);
		var res = pv.res || {};
		if (res.ok !== true) return E('div', { 'class': 'alert-message danger' }, _('Preview refused: ') + ((res.error && res.error.message) || res.error || _('unknown')));
		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-backup-preview' }, [
			E('h4', {}, _('Restore preview — ') + pv.scope + ' @ ' + fmtTime(pv.takenAt)),
			this.row(_('Integrity'), res.integrity && res.integrity.ok
				? E('span', { 'class': 'zonebadge ok' }, (res.integrity.manifest ? 'sha256 manifest OK' : 'legacy checksum OK'))
				: E('span', { 'class': 'zonebadge bad' }, (res.integrity && res.integrity.reason) || _('failed'))),
			this.row(_('Version gate'), res.versionGate === 'ok'
				? E('span', { 'class': 'zonebadge ok' }, _('ok'))
				: res.versionGate === 'downgrade'
					? E('span', { 'class': 'zonebadge warn' }, _('downgrade (will restore with warning)'))
					: E('span', { 'class': 'zonebadge bad' }, _('refuse (newer archive)')))
		]);
		(res.diffs || []).forEach(function (d) {
			box.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'font-family:monospace' }, d.path),
				E('div', { 'class': 'cbi-value-field' },
					(d.presentNow ? (d.changed ? _('changed') : _('identical')) : _('not present now')) +
					' · now ' + (d.currentSize != null ? d.currentSize : '—') + 'B → archive ' + d.archiveSize + 'B')
			]));
		});
		(res.syntax || []).forEach(function (s) {
			box.appendChild(E('div', { 'class': 'alert-message danger' }, _('syntax: ') + s.path + ': ' + s.reason));
		});

		if (res.restorable) {
			var armed = this._restoreArmed === pv.scope + ':' + pv.takenAt;
			var restoreBtn = E('button', {
				'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'),
				'type': 'button', 'id': 'z2m-backup-restore'
			}, armed ? _('Confirm restore (current state is snapshotted first)?') : _('Restore this archive'));
			restoreBtn.addEventListener('click', function () {
				var key = pv.scope + ':' + pv.takenAt;
				if (self._restoreArmed !== key) { self._restoreArmed = key; self.refresh(); return; }
				self._restoreArmed = null;
				restoreBtn.disabled = true;
				callBackupRestore(JSON.stringify({ scope: pv.scope, takenAt: pv.takenAt })).then(function (r2) {
					r2 = r2 || {};
					self._preview = null;
					self._flash = (r2.ok === true)
						? (_('Restored.') + (r2.downgradeWarning ? ' ' + r2.downgradeWarning : '') + (r2.note ? ' ' + r2.note : ''))
						: (_('Restore failed: ') + ((r2.error && r2.error.message) || r2.reason || r2.error || _('unknown')));
					self.refresh();
				}).catch(function (err) {
					self._preview = null;
					self._flash = _('Restore call failed: ') + String(err);
					self.refresh();
				});
			});
			box.appendChild(E('div', { 'class': 'cbi-button-row' }, [restoreBtn]));
		} else {
			box.appendChild(E('div', { 'class': 'alert-message warning' },
				_('Not restorable: ') + ((res.integrity && !res.integrity.ok) ? _('integrity failed') :
					(res.syntax && res.syntax.length) ? _('syntax errors') :
					res.versionGate === 'refuse' ? _('newer archive') : _('unknown'))));
		}
		return box;
	},

	// ---- events -----------------------------------------------------------------
	eventsSection: function (envelope) {
		var ev = envelope.events || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Events'))]);
		if (envelope.eventsError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — events_tail: ') + envelope.eventsError));
			return node;
		}
		var events = ev.events || [];
		if (!events.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, (ev.note) || _('(no events)') ));
		}
		events.slice().reverse().forEach(function (e) {
			var cls = e.severity === 'crit' ? 'bad' : (e.severity === 'warn' ? 'warn' : '');
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, [
				E('span', { 'class': 'zonebadge ' + cls }, e.severity || '?'),
				' ' + (e.ts || '') + ' [' + (e.source || '?') + '] ' + (e.msg || '')
			]));
		});
		(ev.malformed || []).forEach(function (m) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				E('span', { 'class': 'zonebadge bad' }, _('malformed line: ')) , ' ' + (m.preview || '')));
		});
		return node;
	},

	// ---- diagnostics ---------------------------------------------------------------
	diagnosticsSection: function () {
		var self = this;
		var btn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-diagnostics' }, _('Export diagnostics'));
		btn.addEventListener('click', function () {
			btn.disabled = true;
			callDiagnostics().then(function (res) {
				btn.disabled = false;
				res = res || {};
				if (res.ok !== true) { self._flash = _('Export failed'); self.refresh(); return; }
				var json = JSON.stringify(res.export, null, 2);
				var note = _('Diagnostics collected') + (res.export && res.export.redactedFields ? _(' — ') + res.export.redactedFields + _(' secret field(s) redacted') : _(' (no secrets found)'));
				if (typeof URL !== 'undefined' && URL.createObjectURL && typeof Blob !== 'undefined') {
					var blob = new Blob([json], { type: 'application/json' });
					var a = E('a', { 'href': URL.createObjectURL(blob), 'download': 'zapret2-manager-diagnostics.json' }, '');
					if (a && a.click) a.click();
					self._flash = note + _('. Downloaded as JSON.');
				} else {
					self._flash = note;
					self._diagText = json;
				}
				self.refresh();
			}).catch(function (err) {
				btn.disabled = false;
				self._flash = _('Export call failed: ') + String(err);
				self.refresh();
			});
		});
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Diagnostics')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [btn]),
			E('div', { 'class': 'cbi-value-description' },
				_('The export bundles versions, maintenance status, the last status snapshot, events and config hashes. Secret-shaped fields are redacted before anything leaves the router.'))
		]);
		if (this._diagText) {
			node.appendChild(E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.8em;max-height:300px;overflow:auto' }, this._diagText));
			this._diagText = null;
		}
		return node;
	},

	refresh: function () {
		var self = this;
		this.load().then(function (envelope) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render(envelope), old);
		});
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
