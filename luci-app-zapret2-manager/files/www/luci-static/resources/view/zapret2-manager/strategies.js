'use strict';

// Strategies page — profiles & strategies of the zapret2 engine.
//
// v2: uses shared z2m-ui design system. Default view is concise: service state,
// profile cards, draft summary, primary actions. Raw dumps and technical data
// collapsed under Technical details.

'require rpc';

var callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
var callProfilesList = rpc.declare({ object: 'zapret2-manager', method: 'profiles_list', reject: true });
var callProfilesCreate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_create', params: ['edit'], reject: true });
var callProfilesUpdate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_update', params: ['edit'], reject: true });
var callProfilesClone = rpc.declare({ object: 'zapret2-manager', method: 'profiles_clone', params: ['edit'], reject: true });
var callProfilesDelete = rpc.declare({ object: 'zapret2-manager', method: 'profiles_delete', params: ['edit'], reject: true });
var callProfilesValidate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_validate', params: ['edit'], reject: true });
var callProfilesImportApplied = rpc.declare({ object: 'zapret2-manager', method: 'profiles_import_applied', reject: true });
var callProfilesApply = rpc.declare({ object: 'zapret2-manager', method: 'profiles_apply', params: ['edit'], reject: true });
var callPassthrough = rpc.declare({ object: 'zapret2-manager', method: 'passthrough', params: ['enabled'], reject: true });
var callConfirmAlive = rpc.declare({ object: 'zapret2-manager', method: 'confirm_alive', reject: true });
var callRollback = rpc.declare({ object: 'zapret2-manager', method: 'rollback', reject: true });

function esc(s) {
	if (s == null) return '';
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitize(s) {
	if (s == null) return '';
	return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

function injectCSS() {
	if (!document || !document.createElement || !document.head || !L || typeof L.resource !== 'function' || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
}

function h(c) { return document.createTextNode(c); }

function argvFlags(cmdline, flag) {
	var out = [];
	var re = new RegExp(flag + '=([^\\s]+)', 'g');
	var m;
	while ((m = re.exec(cmdline || '')) !== null) out.push(m[1]);
	return out;
}

return L.view.extend({
	title: _('Strategies'),

	load: function () {
		var statusP = callStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		var profilesP = callProfilesList().then(function (res) {
			res = res || {};
			if (res.ok === false) return { loadError: (res.error && res.error.message) || res.error || 'profiles_list failed', data: res };
			return { loadError: null, data: res };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		return Promise.all([statusP, profilesP]).then(function (r) {
			return { loadError: r[0].loadError, data: r[0].data, profilesError: r[1].loadError, profilesData: r[1].data };
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var data = envelope.data || {};
		var unavailable = envelope.loadError || data.error || null;
		var profData = envelope.profilesData || null;
		var profUnavailable = envelope.profilesError || (profData && profData.ok === false ? 'profiles_list failed' : null);

		var rt = data.runtime || {};
		var ap = data.applied || {};
		var drift = data.drift || { divergent: false };
		var insts = rt.instances || [];

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Strategies')),
				E('p', {}, _('Profiles and desync strategies of the zapret2 engine.'))
			])
		]);

		if (unavailable) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Status unavailable: ') + esc(unavailable)));
		}

		// ---- summary hero ----
		container.appendChild(this.summaryCard(data, profData, profUnavailable, unavailable));

		// ---- drift warning ----
		if (drift.divergent) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Runtime differs from the applied configuration: ') + esc(drift.reason || '')));
		}

		// ---- applied profiles ----
		container.appendChild(this.backendProfilesSection(profData, profUnavailable));

		// ---- draft manager ----
		container.appendChild(this.draftManagerSection(profData, profUnavailable));

		// ---- apply ----
		container.appendChild(this.applySection(profData, profUnavailable));

		// ---- passthrough ----
		container.appendChild(this.passthroughSection(data.serviceState === 'passthrough', unavailable));

		// ---- technical details (collapsed) ----
		container.appendChild(this.technicalDetails(insts, ap, rt, unavailable));

		return container;
	},

	// ---- summary card (hero replacement) ----
	summaryCard: function (data, profData, profUnavailable, unavailable) {
		var rt = data.runtime || {};
		var draft = profData && profData.draft;
		var draftCount = draft ? draft.profileCount || 0 : 0;
		var state = data.serviceState || 'unknown';

		var stateMap = {
			running: { label: 'Running', cls: 'ok' },
			stopped: { label: 'Stopped', cls: 'bad' },
			partial: { label: 'Partial', cls: 'warn' },
			error: { label: 'Error', cls: 'bad' },
			paused: { label: 'Paused', cls: 'warn' },
			passthrough: { label: 'Passthrough', cls: 'ok' }
		};
		var sm = stateMap[state] || { label: state || 'Unknown', cls: '' };

		var grid = E('div', { 'class': 'z2m-card-grid' });
		function item(label, value) {
			var el = E('div', { 'class': 'z2m-card' });
			el.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, esc(label)),
				E('span', { 'class': 'z2m-kv-value' }, typeof value === 'string' ? esc(value) : value)
			]));
			return el;
		}

		grid.appendChild(item(_('Service'), badge(_(sm.label), sm.cls)));
		grid.appendChild(item(_('Runtime profiles'), unavailable ? _('Unavailable') : String(rt.profileCount != null ? rt.profileCount : 0)));
		grid.appendChild(item(_('Applied profiles'), profUnavailable ? _('Unavailable') : String(profData && profData.profileCount != null ? profData.profileCount : 0)));
		grid.appendChild(item(_('Draft profiles'), String(draftCount)));
		grid.appendChild(item(_('Engine instances'), unavailable ? _('Unavailable') : String(rt.count != null ? rt.count : 0)));
		grid.appendChild(item(_('Drift'), data.drift && data.drift.divergent ? badge(_('Divergent'), 'warn') : badge(_('Clean'), 'ok')));

		return grid;
	},

	// ---- backend profiles (compact cards) ----
	backendProfilesSection: function (profData, profUnavailable) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Applied profiles'))
		]);

		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — profiles_list: ') + esc(profUnavailable)));
			return node;
		}
		if (!profData) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — no profiles data.')));
			return node;
		}

		var profiles = profData.profiles || [];
		if (!profiles.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				profData.parseStatus === 'unavailable'
					? _('NFQWS2_OPT is not set in the applied config — no profiles applied.')
					: _('No profiles in the applied options string.')));
			return node;
		}

		var grid = E('div', { 'class': 'z2m-card-grid' });
		profiles.forEach(function (p) {
			var card = E('div', { 'class': 'z2m-card' });
			var title = '#' + p.index + (p.name ? ' — ' + esc(p.name) : '');
			if (p.protocol) title += ' · ' + esc(p.protocol);
			if (p.enabled === false) title += ' · ' + _('disabled');
			card.appendChild(E('h4', {}, title));

			var ports = [];
			(p.tcpPorts || []).forEach(function (e) { ports.push('tcp:' + esc(e.value)); });
			(p.udpPorts || []).forEach(function (e) { ports.push('udp:' + esc(e.value)); });
			if (ports.length) card.appendChild(E('div', { 'class': 'cbi-value-description' }, ports.join(' · ')));

			var l7 = (p.l7Filters || []).map(function (e) { return esc(e.value); });
			if (l7.length) card.appendChild(E('div', { 'class': 'cbi-value-description' }, 'L7: ' + l7.join(', ')));

			var desync = p.luaDesync || [];
			if (desync.length) {
				desync.forEach(function (e) {
					card.appendChild(E('div', { 'class': 'cbi-value-description' }, esc(e.raw)));
				});
			}
			grid.appendChild(card);
		});
		node.appendChild(grid);
		return node;
	},

	// ---- draft manager (unchanged from original, but uses z2m-card where appropriate) ----
	draftManagerSection: function (profData, profUnavailable) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Draft profiles')),
			E('div', { 'class': 'cbi-value-description' },
				_('Drafts live in the manager state. Apply them below via the preview → confirm → apply flow.'))
		]);

		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — profiles_list: ') + esc(profUnavailable)));
			return node;
		}
		var draft = (profData && profData.draft) || { present: false, malformed: false, profileCount: 0, profiles: [] };

		if (draft.malformed) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Draft state is MALFORMED: ') + esc(draft.malformedReason || _('unknown'))));
			return node;
		}

		var newBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('New draft profile'));
		newBtn.addEventListener('click', function () {
			self._editor = { mode: 'create', id: null, revision: null, name: '', opt: '', error: null, dirty: false };
			self.refresh();
		});
		var importBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Import applied profiles into drafts'));
		importBtn.addEventListener('click', function () {
			importBtn.disabled = true;
			callProfilesImportApplied().then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					importBtn.disabled = false;
					self._flash = _('Import failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
				} else {
					self._flash = _('Imported ') + (res.imported || []).length + _(' profile(s) into drafts.');
				}
				self.refresh();
			}).catch(function (err) {
				importBtn.disabled = false;
				self._flash = _('Import call failed: ') + String(err);
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [newBtn, importBtn]));
		if (this._flash) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, this._flash));
			this._flash = null;
		}

		var profiles = draft.profiles || [];
		if (!profiles.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				draft.present ? _('(no draft profiles — create one or import the applied set)') : _('(no draft state yet)')));
		}
		profiles.forEach(function (p) { node.appendChild(self.draftRow(p)); });

		if (this._editor) node.appendChild(this.draftEditor());
		return node;
	},

	draftRow: function (p) {
		var self = this;
		var badges = [];
		badges.push(badge(p.parseStatus || 'unknown', p.parseStatus === 'success' ? 'ok' : 'warn'));
		if (p.duplicateName) badges.push(badge(_('duplicate name'), 'warn'));
		badges.push(badge(p.source || 'created', 'neutral'));
		badges.push(badge('rev ' + (p.revision != null ? p.revision : '?'), 'neutral'));

		var editBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Edit'));
		editBtn.addEventListener('click', function () {
			self._editor = { mode: 'edit', id: p.id, revision: p.revision, name: p.name, opt: p.opt, error: null, dirty: false };
			self.refresh();
		});
		var cloneBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Clone'));
		cloneBtn.addEventListener('click', function () {
			cloneBtn.disabled = true;
			callProfilesClone(JSON.stringify({ id: p.id })).then(function (res) {
				res = res || {};
				if (res.ok !== true) { cloneBtn.disabled = false; self._flash = _('Clone failed: ') + ((res.error && res.error.message) || res.error || _('unknown')); }
				self.refresh();
			}).catch(function (err) { cloneBtn.disabled = false; self._flash = _('Clone call failed: ') + String(err); self.refresh(); });
		});
		var armed = self._deleteArmed === p.id;
		var delBtn = E('button', { 'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-neutral'), 'type': 'button' },
			armed ? _('Confirm delete?') : _('Delete'));
		delBtn.addEventListener('click', function () {
			if (self._deleteArmed !== p.id) { self._deleteArmed = p.id; self.refresh(); return; }
			self._deleteArmed = null; delBtn.disabled = true;
			callProfilesDelete(JSON.stringify({ id: p.id })).then(function (res) {
				res = res || {};
				if (res.ok !== true) { delBtn.disabled = false; self._flash = _('Delete failed: ') + ((res.error && res.error.message) || res.error || _('unknown')); }
				self.refresh();
			}).catch(function (err) { delBtn.disabled = false; self._flash = _('Delete call failed: ') + String(err); self.refresh(); });
		});
		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			valBtn.disabled = true; self._validateBusy = p.id;
			callProfilesValidate(JSON.stringify({ id: p.id })).then(function (res) {
				self._validateBusy = null; self._validateResult = { key: p.id, res: res || {} }; self.refresh();
			}).catch(function (err) { self._validateBusy = null; self._validateResult = { key: p.id, error: String(err) }; self.refresh(); });
		});

		var row = E('div', { 'class': 'z2m-card', 'data-draft-id': p.id }, [
			E('h4', {}, esc(p.name || _('(unnamed)')) + ' · ' + esc(p.id)),
			E('div', { 'style': 'margin:.2em 0' }, badges),
			E('pre', { 'class': 'z2m-mono', 'style': 'max-height:120px;overflow:auto' }, sanitize(p.opt || '')),
			E('div', { 'class': 'z2m-actions' }, [editBtn, cloneBtn, delBtn, valBtn])
		]);
		if (this._validateResult && this._validateResult.key === p.id) row.appendChild(this.validateResultBox(this._validateResult));
		if (this._validateBusy === p.id) row.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Validating…')));
		return row;
	},

	SAFE_OPTION_NAMES: ['--filter-tcp', '--filter-udp', '--filter-l7', '--payload', '--hostlist', '--hostlist-exclude', '--ipset', '--ipset-exclude', '--out-range', '--in-range'],

	draftEditor: function () {
		var self = this;
		var ed = this._editor;
		var title = ed.mode === 'create' ? _('New draft profile') : (_('Edit draft ') + esc(ed.id));

		var nameInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': 'z2m-editor-name', 'value': ed.name || '' });
		var optArea = E('textarea', { 'class': 'cbi-input-textarea', 'id': 'z2m-editor-opt', 'rows': 8, 'style': 'width:100%;font-family:monospace' });
		optArea.value = ed.opt || '';

		var dirtyBadge = E('span', { 'class': 'z2m-badge z2m-badge-warn', 'style': 'visibility:hidden', 'id': 'z2m-editor-dirty' }, _('unsaved changes'));
		function markDirty() { ed.dirty = true; dirtyBadge.style.visibility = 'visible'; }
		nameInput.addEventListener('input', markDirty);
		optArea.addEventListener('input', markDirty);

		var sel = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-editor-addopt' });
		this.SAFE_OPTION_NAMES.forEach(function (o) { sel.appendChild(E('option', { 'value': o }, o)); });
		var valInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': 'z2m-editor-addval', 'placeholder': _('value') });
		var addBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Add option'));
		addBtn.addEventListener('click', function () {
			var optName = sel.value || '--filter-tcp';
			var v = String(valInput.value != null ? valInput.value : '').trim();
			if (!v) return;
			var cur = String(optArea.value || '');
			optArea.value = cur + (cur.length && !/\s$/.test(cur) ? ' ' : '') + optName + '=' + v;
			markDirty();
		});

		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' },
			ed.mode === 'create' ? _('Create draft') : _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var payload = { name: String(nameInput.value != null ? nameInput.value : ''), opt: String(optArea.value || '') };
			var call, body;
			if (ed.mode === 'create') { body = JSON.stringify(payload); call = callProfilesCreate; }
			else { payload.id = ed.id; payload.revision = ed.revision; body = JSON.stringify(payload); call = callProfilesUpdate; }
			call(body).then(function (res) {
				res = res || {};
				if (res.ok === true) {
					self._editor = null; self._flash = ed.mode === 'create' ? _('Draft created.') : _('Draft saved (revision ') + res.revision + ').'; self.refresh();
				} else {
					saveBtn.disabled = false;
					var code = res.error && res.error.code;
					ed.error = (code === 'ECONFLICT') ? (_('Conflict: ') + ((res.error && res.error.message) || _('changed elsewhere'))) : (_('Save failed: ') + ((res.error && res.error.message) || res.error || _('unknown')));
					self.refresh();
				}
			}).catch(function (err) { saveBtn.disabled = false; ed.error = _('Save call failed: ') + String(err); self.refresh(); });
		});

		var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, ed.dirty ? _('Discard changes') : _('Cancel'));
		cancelBtn.addEventListener('click', function () { self._editor = null; self.refresh(); });

		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			valBtn.disabled = true;
			callProfilesValidate(JSON.stringify({ opt: String(optArea.value || '') })).then(function (res) {
				self._validateResult = { key: 'editor', res: res || {} }; self.refresh();
			}).catch(function (err) { self._validateResult = { key: 'editor', error: String(err) }; self.refresh(); });
		});

		return E('div', { 'class': 'z2m-card', 'id': 'z2m-draft-editor' }, [
			E('h4', {}, title),
			ed.error ? E('div', { 'class': 'z2m-callout z2m-callout-bad' }, ed.error) : E('span', {}),
			E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, _('Name')), E('span', { 'class': 'z2m-kv-value' }, [nameInput])]),
			E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, _('Options')), E('span', { 'class': 'z2m-kv-value' }, [optArea])]),
			E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, _('Add safe option')), E('span', { 'class': 'z2m-kv-value' }, [sel, valInput, addBtn])]),
			E('div', { 'class': 'z2m-actions' }, [saveBtn, cancelBtn, valBtn, dirtyBadge])
		]);
	},

	validateResultBox: function (vr) {
		if (vr.error) return E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Validate call failed: ') + esc(vr.error));
		var res = vr.res || {};
		if (res.ok !== true) return E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Validate failed: ') + esc((res.error && res.error.message) || res.error || _('unknown')));
		var mgr = res.manager || {};
		var native = res.native || {};
		var box = E('div', { 'class': 'z2m-card', 'data-validate-result': '1' }, [
			E('h4', {}, _('Validation result')),
			badge(_('manager: ') + (mgr.parseStatus || 'unknown'), mgr.parseStatus === 'success' ? 'ok' : 'warn'),
			' ',
			badge(_('native: ') + (native.status || 'not_checked'), native.status === 'partial' ? 'ok' : 'neutral')
		]);
		return box;
	},

	// ---- apply section (same logic, styled consistently) ----
	applySection: function (profData, profUnavailable) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply drafts to the engine')),
			E('div', { 'class': 'cbi-value-description' }, _('Preview renders the exact candidate, then confirm to apply. A failed verification rolls back immediately.'))
		]);
		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — profiles_list: ') + esc(profUnavailable)));
			return node;
		}

		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview apply'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true; self._apply = { busy: true };
			callProfilesApply(JSON.stringify({ mode: 'preview' })).then(function (res) {
				prevBtn.disabled = false; self._apply = { preview: res || {} }; self.refresh();
			}).catch(function (err) { prevBtn.disabled = false; self._apply = { error: String(err) }; self.refresh(); });
		});
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [prevBtn]));

		var ap = this._apply;
		if (ap && ap.busy) node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Working…')));
		if (ap && ap.error) node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Apply call failed: ') + esc(ap.error)));
		if (ap && ap.preview) node.appendChild(this.applyPreviewBox(ap.preview));
		if (ap && ap.result) node.appendChild(this.applyResultBox(ap.result));
		return node;
	},

	applyPreviewBox: function (pv) {
		var self = this;
		if (pv.ok !== true) {
			return E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Preview refused: ') + esc((pv.error && pv.error.message) || pv.error || _('unknown')));
		}
		var diff = pv.diff || {};
		var box = E('div', { 'class': 'z2m-card', 'id': 'z2m-apply-preview-box' }, [
			E('h4', {}, _('Apply preview')),
			E('div', { 'class': 'z2m-kv' }, [h(_('Changed vs applied')), h(diff.changed ? _('yes') : _('no (identical)'))]),
			E('h4', {}, _('Candidate NFQWS2_OPT')),
			E('pre', { 'class': 'z2m-mono', 'style': 'max-height:200px;overflow:auto' }, sanitize(pv.candidate || _('(empty)')))
		]);

		if (!pv.wouldApply) {
			box.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Apply is refused by validation.')));
			return box;
		}

		var armed = this._apply && this._apply.armed;
		var applyBtn = E('button', {
			'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'), 'type': 'button'
		}, armed ? _('Confirm apply (engine will restart)?') : _('Apply drafts'));
		applyBtn.addEventListener('click', function () {
			if (!self._apply.armed) { self._apply.armed = true; self.refresh(); return; }
			applyBtn.disabled = true; self._apply = { busy: true };
			callProfilesApply(JSON.stringify({ mode: 'apply' })).then(function (res) {
				self._apply = { result: res || {}, preview: pv }; self.refresh();
			}).catch(function (err) { self._apply = { error: String(err), preview: pv }; self.refresh(); });
		});
		box.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Applying restarts nfqws2 and may drop connectivity briefly.')));
		box.appendChild(E('div', { 'class': 'z2m-actions' }, [applyBtn]));
		return box;
	},

	applyResultBox: function (res) {
		var self = this;
		if (res.ok !== true) {
			return E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Apply failed') + ': ' + esc((res.error && res.error.message) || res.error || _('unknown')));
		}
		var box = E('div', { 'class': 'z2m-card', 'id': 'z2m-apply-result' }, [
			E('h4', {}, _('Applied and verified')),
			E('div', { 'class': 'cbi-value-description' }, _('The automatic 90s rollback timer is off. If the link dropped, use Roll back now.'))
		]);
		var okBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Link OK'));
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Roll back now'));
		var status = E('div', { 'class': 'cbi-value-description' });
		okBtn.addEventListener('click', function () {
			okBtn.disabled = true; rbBtn.disabled = true;
			callConfirmAlive().then(function () { status.textContent = _('Confirmed.'); }).catch(function (err) { status.textContent = _('Confirm failed: ') + String(err); });
		});
		rbBtn.addEventListener('click', function () {
			okBtn.disabled = true; rbBtn.disabled = true;
			callRollback().then(function () { status.textContent = _('Rolled back to last-good.'); }).catch(function (err) { status.textContent = _('Rollback failed: ') + String(err); });
		});
		box.appendChild(E('div', { 'class': 'z2m-actions' }, [okBtn, rbBtn]));
		box.appendChild(status);
		return box;
	},

	// ---- passthrough section ----
	passthroughSection: function (current, statusUnavailable) {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', {
			'class': 'cbi-button ' + (current ? 'cbi-button-negative' : 'cbi-button-apply'), 'type': 'button'
		}, current ? _('Disable passthrough') : _('Enable passthrough (diagnostic)'));
		if (statusUnavailable) btn.disabled = true;

		btn.addEventListener('click', function () {
			btn.disabled = true;
			status.textContent = _('Restarting…');
			callPassthrough(!current).then(function (res) {
				res = res || {};
				if (res.rollback_pending) { self.confirmFlow(res, status, btn); }
				else { btn.disabled = false; status.textContent = res.ok ? _('Toggled.') : (_('Failed: ') + esc(res.error || '')); self.refresh(); }
			}).catch(function (err) { btn.disabled = false; status.textContent = _('Call failed: ') + String(err); });
		});

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Passthrough (diagnostic)')),
			E('div', { 'class': 'cbi-value-description' }, _('Runs nfqws2 without fake packets — answers "is zapret at fault?".')),
			btn, status
		]);
	},

	confirmFlow: function (res, statusEl, actionBtn) {
		var self = this;
		var ttl = res.rollback_ttl || 90;
		var remaining = ttl;
		var box = E('div', { 'class': 'z2m-callout z2m-callout-warn', 'style': 'margin-top:.5em' }, [
			E('p', {}, _('Link still alive?')),
			E('span', { 'class': 'z2m-badge z2m-badge-warn' }, '' + remaining)
		]);
		var okBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Link OK'));
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Roll back now'));
		var cd = box.querySelector('.z2m-badge');
		box.appendChild(E('div', { 'class': 'z2m-actions' }, [okBtn, rbBtn]));
		statusEl.textContent = '';
		statusEl.appendChild(box);

		var timer = setInterval(function () {
			remaining--;
			if (cd) cd.textContent = '' + Math.max(remaining, 0);
			if (remaining <= 0) { clearInterval(timer); statusEl.textContent = _('Rolling back…'); if (actionBtn) actionBtn.disabled = false; self.refresh(); }
		}, 1000);

		okBtn.addEventListener('click', function () {
			clearInterval(timer); okBtn.disabled = true; rbBtn.disabled = true;
			callConfirmAlive().then(function () { statusEl.textContent = _('Confirmed.'); })
				.catch(function (err) { statusEl.textContent = _('Confirm failed: ') + String(err); });
		});
		rbBtn.addEventListener('click', function () {
			clearInterval(timer); okBtn.disabled = true; rbBtn.disabled = true;
			callRollback().then(function () { statusEl.textContent = _('Rolled back.'); })
				.catch(function (err) { statusEl.textContent = _('Rollback failed: ') + String(err); });
		});
	},

	// ---- technical details (collapsed) ----
	technicalDetails: function (insts, ap, rt, unavailable) {
		var body = [];

		body.push(E('h4', {}, _('Running instances')));
		if (unavailable) {
			body.push(E('div', { 'class': 'cbi-value-description' }, _('Unavailable.')));
		} else if (!insts.length) {
			body.push(E('div', { 'class': 'cbi-value-description' }, _('No nfqws2 instances running.')));
		} else {
			insts.forEach(function (p) {
				body.push(E('pre', { 'class': 'z2m-mono' }, sanitize(p.cmdline || '')));
			});
		}

		body.push(E('h4', {}, _('Runtime strategies (engine table dump)')));
		body.push(rt.strategies != null
			? E('pre', { 'class': 'z2m-mono' }, sanitize(rt.strategies))
			: E('div', { 'class': 'cbi-value-description' }, _('Unavailable.')));

		body.push(E('h4', {}, _('Applied config')));
		body.push(E('div', { 'class': 'cbi-value-description' },
			_('Config path: ') + esc(ap.configPath || _('Unavailable')) + ' · ' +
			_('Present: ') + (ap.configPresent ? _('yes') : _('no')) + ' · ' +
			_('Size: ') + (ap.configSize != null ? ap.configSize : '?') + ' bytes'));
		body.push(ap.uci != null
			? E('pre', { 'class': 'z2m-mono' }, sanitize(ap.uci))
			: E('div', { 'class': 'cbi-value-description' }, _('No UCI config reported.')));

		body.push(E('h4', {}, _('Applied (on-disk intent)')));
		body.push(E('div', { 'class': 'cbi-value-description' },
			_('Config mtime: ') + esc(ap.configMtime || _('Unavailable'))));

		return this.collapsible(_('Technical details'), body, false);
	},

	collapsible: function (title, body, defaultOpen) {
		var id = 'z2m-tech-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
		var toggle = E('div', {
			'class': 'z2m-tech-toggle',
			'click': function () { var b = document.getElementById(id); if (b) b.hidden = !b.hidden; }
		}, (defaultOpen ? '\u25BC ' : '\u25B6 ') + esc(title));
		var bodyEl = E('div', { 'class': 'z2m-tech-body', 'id': id }, body);
		if (!defaultOpen) bodyEl.hidden = true;
		return E('div', { 'class': 'z2m-tech-group' }, [toggle, bodyEl]);
	},

	refresh: function () {
		var self = this;
		callStatus().then(function (data) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render({ loadError: null, data: data || {} }), old);
		}).catch(function (err) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render({ loadError: String(err), data: null }), old);
		});
	},

	serviceStateBadge: function (state) {
		var map = {
			running: { label: _('running'), cls: 'ok' },
			stopped: { label: _('stopped'), cls: 'bad' },
			partial: { label: _('partial'), cls: 'warn' },
			error: { label: _('error'), cls: 'bad' },
			paused: { label: _('paused'), cls: 'warn' },
			passthrough: { label: _('passthrough'), cls: 'ok' }
		};
		var m = map[state] || { label: state || _('unknown'), cls: '' };
		return badge(_(m.label), m.cls);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
