'use strict';

// Strategies page — profiles & strategies of the zapret2 engine.
//
// DATA MODEL, not a hardcoded catalog: this page renders whatever the backend
// reports (docs/contracts/status.schema.json v2) and never embeds a strategy
// list of its own.
//
// Available TODAY (ubus `status`):
//   - runtime.instances[].cmdline — ground-truth argv per nfqws2 process
//     (protocol/ports, hostlist/ipset filters, --lua-desync options are
//     extracted as presentation hints; the raw argv is always shown verbatim)
//   - runtime.profileCount, runtime.strategies (list_table dump)
//   - applied.uci / applied.config* — the on-disk intent
//   - draft — the manager's staged state (free-form)
//   - drift — backend-computed RUNTIME-vs-APPLIED divergence
//   - passthrough — the only strategy-related MUTATION in the ubus contract
//     (docs/contracts/ubus.md), wired with the 90s rollback confirm flow.
//
// NOT available (no backend methods yet): create/edit/clone/delete/validate/
// apply of profiles. Those actions render DISABLED with the exact method
// names they wait for. No localStorage drafts, no direct UCI writes —
// configuration changes must go through a backend contract.

'require rpc';

// rpc.js wire semantics (verified on the router): a params ARRAY declaration
// is invoked POSITIONALLY — callPassthrough(flag) → { enabled: flag }; an
// object argument would nest. reject: true makes ubus errors reject into
// .catch() instead of resolving as a numeric code.
const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
const callProfilesList = rpc.declare({ object: 'zapret2-manager', method: 'profiles_list', reject: true });
const callProfilesCreate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_create', params: ['edit'], reject: true });
const callProfilesUpdate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_update', params: ['edit'], reject: true });
const callProfilesClone = rpc.declare({ object: 'zapret2-manager', method: 'profiles_clone', params: ['edit'], reject: true });
const callProfilesDelete = rpc.declare({ object: 'zapret2-manager', method: 'profiles_delete', params: ['edit'], reject: true });
const callProfilesValidate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_validate', params: ['edit'], reject: true });
const callProfilesImportApplied = rpc.declare({ object: 'zapret2-manager', method: 'profiles_import_applied', reject: true });
const callProfilesApply = rpc.declare({ object: 'zapret2-manager', method: 'profiles_apply', params: ['edit'], reject: true });
const callPassthrough = rpc.declare({
	object: 'zapret2-manager', method: 'passthrough', params: ['enabled'], reject: true
});
const callConfirmAlive = rpc.declare({ object: 'zapret2-manager', method: 'confirm_alive', reject: true });
const callRollback = rpc.declare({ object: 'zapret2-manager', method: 'rollback', reject: true });

// Every profiles_* method this page uses now EXISTS (Slices 1–3). Apply is
// wired below through the preview → confirm → apply → verify flow.

// collect all occurrences of an argv flag, e.g. --hostlist=… (presentation
// hint only; the raw cmdline stays the source of truth)
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
		// status and profiles_list are INDEPENDENT reads: one may fail while
		// the other succeeds, and each failure renders its own honest
		// "Unavailable" (never a fabricated empty list).
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
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var unavailable = envelope.loadError || data.error || null;
		var profData = envelope.profilesData || null;
		var profUnavailable = envelope.profilesError || (profData && profData.ok === false ? 'profiles_list failed' : null);

		var rt = data.runtime || {};
		var ap = data.applied || {};
		var drift = data.drift || { divergent: false };
		var insts = rt.instances || [];

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Strategies')),
			E('div', { 'class': 'cbi-value-description' },
				_('Profiles and desync strategies of the zapret2 engine. Applied profiles are parsed losslessly by the backend (profiles_list); editing waits for backend methods and is honestly disabled until then.'))
		]);

		if (unavailable) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('Status unavailable: ') + unavailable),
				E('p', {}, _('Fields below render as "Unavailable" — nothing here is fabricated.'))
			]));
		}

		// ---- summary -------------------------------------------------------
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Profiles')),
			this.row(_('Service state'), unavailable ? _('Unavailable') : this.serviceStateBadge(data.serviceState)),
			this.row(_('Profiles (runtime)'),
				(rt.profileCount != null) ? rt.profileCount : _('Unavailable')),
			this.row(_('Profiles (applied, backend)'),
				profUnavailable ? _('Unavailable')
					: (profData && profData.profileCount != null ? profData.profileCount : _('Unavailable'))),
			this.row(_('Engine instances'),
				unavailable ? _('Unavailable') : (rt.count != null ? rt.count : insts.length)),
			this.row(_('Source'), drift.divergent ? _('applied + draft (divergent — see below)') : _('applied'))
		]));

		// ---- applied profiles from the backend (profiles_list) -------------
		container.appendChild(this.backendProfilesSection(profData, profUnavailable));

		// ---- DRAFT manager (create/edit/clone/delete/validate — draft only) --
		container.appendChild(this.draftManagerSection(profData, profUnavailable));

		// ---- per-instance argv ----------------------------------------------
		container.appendChild(this.instancesSection(insts, unavailable));

		// ---- runtime strategies (list_table dump) ---------------------------
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Runtime strategies (engine table dump)')),
			(rt.strategies != null)
				? E('pre', { 'style': 'white-space:pre-wrap;max-height:240px;overflow:auto;font-family:monospace' }, rt.strategies)
				: E('div', { 'class': 'cbi-value-description' }, _('Unavailable — engine table dump not reported.'))
		]));

		// ---- applied / draft --------------------------------------------------
		container.appendChild(this.appliedSection(ap, unavailable));

		// ---- drift ------------------------------------------------------------
		if (drift.divergent) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('Runtime differs from the applied configuration: ') +
					(drift.reason || _('no reason reported')))
			]));
		}

		// ---- actions ------------------------------------------------------------
		container.appendChild(this.applySection(profData, profUnavailable));
		container.appendChild(this.passthroughSection(data.serviceState === 'passthrough', unavailable));

		return container;
	},

	// ---- backend profiles (profiles_list envelope, schema 1) -----------------
	backendProfilesSection: function (profData, profUnavailable) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Applied profiles (backend parse)'))
		]);
		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — profiles_list: ') + profUnavailable));
			return node;
		}
		if (!profData) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — no profiles data.')));
			return node;
		}
		var src = profData.source || {};
		var rt = profData.roundtrip || {};
		node.appendChild(this.row(_('Parse status'), profData.parseStatus || _('Unavailable')));
		node.appendChild(this.row(_('Preserve round trip'),
			rt.preserve === 'identical' ? _('identical (lossless)') : (rt.preserve || _('Unavailable'))));
		node.appendChild(this.row(_('Applied config'),
			(src.configPath || _('Unavailable')) +
			(src.configSha256 ? ' · sha256 ' + String(src.configSha256).substring(0, 12) + '…' : '')));

		var profiles = profData.profiles || [];
		if (!profiles.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				profData.parseStatus === 'unavailable'
					? _('NFQWS2_OPT is not set in the applied config — no profiles applied.')
					: _('No profiles in the applied options string.')));
		}
		profiles.forEach(function (p) { node.appendChild(this.profileCard(p)); }, this);

		var diags = profData.diagnostics || [];
		if (diags.length) {
			var list = E('div', { 'class': 'cbi-value' });
			diags.forEach(function (d) {
				var cls = d.severity === 'error' ? 'bad' : 'warn';
				list.appendChild(E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'zonebadge ' + cls }, d.severity || '?'),
					' ' + (d.code || '') + (d.profileIndex != null ? ' (profile ' + d.profileIndex + ')' : '') + ': ' + (d.message || '')
				]));
			});
			node.appendChild(E('h4', {}, _('Parse diagnostics')));
			node.appendChild(list);
		}
		return node;
	},

	profileCard: function (p) {
		var title = '#' + p.index + (p.name ? ' — ' + p.name : ' — ' + _('(unnamed)'));
		if (p.protocol) title += ' · ' + p.protocol;
		if (p.enabled === false) title += ' · ' + _('disabled (--skip)');
		var card = E('div', { 'class': 'cbi-section' }, [E('h4', {}, title)]);

		var ports = [];
		(p.tcpPorts || []).forEach(function (e) { ports.push('tcp: ' + e.value); });
		(p.udpPorts || []).forEach(function (e) { ports.push('udp: ' + e.value); });
		card.appendChild(this.row(_('Ports'), ports.length ? ports.join(' · ') : _('none')));

		var l7 = (p.l7Filters || []).map(function (e) { return e.value; });
		if (l7.length) card.appendChild(this.row(_('L7 filter'), l7.join(', ')));

		var lists = [];
		(p.hostlists || []).forEach(function (e) { lists.push(e.option + '=' + e.value); });
		(p.ipsets || []).forEach(function (e) { lists.push(e.option + '=' + e.value); });
		if (lists.length) card.appendChild(this.row(_('Lists'), lists.join(', ')));

		var desync = p.luaDesync || [];
		if (desync.length) {
			var dl = E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('lua-desync (opaque)'))
			]);
			var field = E('div', { 'class': 'cbi-value-field' });
			desync.forEach(function (e) {
				var nv = e.nativeValidation || {};
				field.appendChild(E('div', {}, [
					E('code', { 'style': 'word-break:break-all' }, e.raw),
					' ',
					E('span', { 'class': 'zonebadge' }, _('native: ') + (nv.status || 'not_checked'))
				]));
			});
			dl.appendChild(field);
			card.appendChild(dl);
		}

		var unk = p.unknownOptions || [];
		if (unk.length) {
			card.appendChild(this.row(_('Unknown/preserved'),
				unk.map(function (e) { return e.strayWord ? e.value : (e.option + (e.value != null ? '=' + e.value : '')); }).join(' ')));
		}
		return card;
	},

	instancesSection: function (insts, unavailable) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Running instances (argv → protocol/ports, filters, options)'))
		]);
		if (unavailable) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!insts.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No nfqws2 instances running.')));
			return node;
		}
		insts.forEach(function (p) {
			var cmd = p.cmdline || '';
			var tcp = argvFlags(cmd, '--filter-tcp');
			var udp = argvFlags(cmd, '--filter-udp');
			var hostlists = argvFlags(cmd, '--hostlist');
			var ipsets = argvFlags(cmd, '--ipset');
			var desync = argvFlags(cmd, '--lua-desync');
			var qnum = argvFlags(cmd, '--qnum');
			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h4', {}, _('PID ') + p.pid + (qnum.length ? _(' — NFQUEUE ') + qnum.join(', ') : '')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Protocol / ports')),
					E('div', { 'class': 'cbi-value-field' },
						(tcp.length ? 'tcp: ' + tcp.join(', ') : '') +
						(tcp.length && udp.length ? ' · ' : '') +
						(udp.length ? 'udp: ' + udp.join(', ') : '') ||
						_('not filtered in argv'))
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('hostlist / ipset filters')),
					E('div', { 'class': 'cbi-value-field' },
						(hostlists.length || ipsets.length)
							? hostlists.concat(ipsets).join(', ')
							: _('none in argv'))
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('argv/options (short)')),
					E('div', { 'class': 'cbi-value-field' },
						desync.length ? desync.join(' ; ') : _('no --lua-desync options in argv'))
				]),
				E('pre', { 'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.85em' }, cmd)
			]));
		});
		return node;
	},

	appliedSection: function (ap, unavailable) {
		var rows = [];
		if (unavailable) {
			rows.push(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
		} else {
			rows.push(this.row(_('Config path'), ap.configPath || _('Unavailable')));
			rows.push(this.row(_('Config present'),
				ap.configPresent == null ? _('Unavailable') : (ap.configPresent ? _('yes') : _('no'))));
			rows.push(this.row(_('Config mtime'), ap.configMtime || _('Unavailable')));
			rows.push(this.row(_('Config size (bytes)'),
				(ap.configSize != null) ? ap.configSize : _('Unavailable')));
			rows.push(E('h4', {}, _('Applied UCI')));
			rows.push(ap.uci != null
				? E('pre', { 'style': 'white-space:pre-wrap;max-height:200px;overflow:auto;font-family:monospace' }, ap.uci)
				: E('div', { 'class': 'cbi-value-description' }, _('Unavailable — no UCI config reported (confirmed absent on some installations).')));
		}
		return E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Applied (on-disk intent)'))].concat(rows));
	},

	// ---- DRAFT manager (SLICE 2) ---------------------------------------------
	// Drafts live only in /etc/zapret2-manager/state.json (the profiles_list
	// `draft` block). CRUD/validate are wired to real backend methods; APPLY
	// does not exist yet — drafts are staged, never applied.
	draftManagerSection: function (profData, profUnavailable) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Draft profiles (manager-staged, never applied yet)')),
			E('div', { 'class': 'cbi-value-description' },
				_('Drafts live only in the manager state (/etc/zapret2-manager/state.json). The engine never reads them. Applying them happens below via the preview → confirm → apply flow.'))
		]);

		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — profiles_list: ') + profUnavailable));
			return node;
		}
		var draft = (profData && profData.draft) || { present: false, malformed: false, profileCount: 0, profiles: [] };

		if (draft.malformed) {
			node.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Draft state is MALFORMED: ') + (draft.malformedReason || _('unknown'))),
				E('p', {}, _('The file is preserved and never overwritten. Fix or remove /etc/zapret2-manager/state.json manually, then reload.'))
			]));
			return node;
		}

		// ---- toolbar -------------------------------------------------------
		var newBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-draft-new' }, _('New draft profile'));
		newBtn.addEventListener('click', function () {
			self._editor = { mode: 'create', id: null, revision: null, name: '', opt: '', error: null, dirty: false };
			self.refresh();
		});
		var importBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-draft-import' }, _('Import applied profiles into drafts'));
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
		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [newBtn, importBtn]));
		if (this._flash) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, this._flash));
			this._flash = null;
		}

		// ---- draft list ------------------------------------------------------
		var profiles = draft.profiles || [];
		if (!profiles.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				draft.present ? _('(no draft profiles — create one or import the applied set)') : _('(no draft state yet)')));
		}
		profiles.forEach(function (p) { node.appendChild(self.draftRow(p)); });

		// ---- editor (create / edit) -----------------------------------------
		if (this._editor) node.appendChild(this.draftEditor());
		return node;
	},

	draftRow: function (p) {
		var self = this;
		var badges = [];
		badges.push(E('span', { 'class': 'zonebadge ' + (p.parseStatus === 'success' ? 'ok' : 'warn') }, p.parseStatus || 'unknown'));
		if (p.duplicateName) badges.push(E('span', { 'class': 'zonebadge warn' }, _('duplicate name')));
		badges.push(E('span', { 'class': 'zonebadge' }, p.source || 'created'));
		badges.push(E('span', { 'class': 'zonebadge' }, 'rev ' + (p.revision != null ? p.revision : '?')));

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
				if (res.ok !== true) {
					cloneBtn.disabled = false;
					self._flash = _('Clone failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
				}
				self.refresh();
			}).catch(function (err) {
				cloneBtn.disabled = false;
				self._flash = _('Clone call failed: ') + String(err);
				self.refresh();
			});
		});

		// delete is a TWO-STEP confirm (first click arms, second executes) —
		// exactly one confirmation, no modal dependency
		var armed = self._deleteArmed === p.id;
		var delBtn = E('button', { 'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-neutral'), 'type': 'button' },
			armed ? _('Confirm delete?') : _('Delete'));
		delBtn.addEventListener('click', function () {
			if (self._deleteArmed !== p.id) { self._deleteArmed = p.id; self.refresh(); return; }
			self._deleteArmed = null;
			delBtn.disabled = true;
			callProfilesDelete(JSON.stringify({ id: p.id })).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					delBtn.disabled = false;
					self._flash = _('Delete failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
				}
				self.refresh();
			}).catch(function (err) {
				delBtn.disabled = false;
				self._flash = _('Delete call failed: ') + String(err);
				self.refresh();
			});
		});

		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			valBtn.disabled = true;
			self._validateBusy = p.id;
			callProfilesValidate(JSON.stringify({ id: p.id })).then(function (res) {
				self._validateBusy = null;
				self._validateResult = { key: p.id, res: res || {} };
				self.refresh();
			}).catch(function (err) {
				self._validateBusy = null;
				self._validateResult = { key: p.id, error: String(err) };
				self.refresh();
			});
		});

		var row = E('div', { 'class': 'cbi-section', 'data-draft-id': p.id }, [
			E('h4', {}, (p.name || _('(unnamed)')) + ' · ' + p.id),
			E('div', { 'style': 'margin:.2em 0' }, badges),
			E('pre', { 'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.85em;max-height:120px;overflow:auto' }, p.opt || ''),
			E('div', { 'class': 'cbi-button-row' }, [editBtn, cloneBtn, delBtn, valBtn])
		]);
		if (this._validateResult && this._validateResult.key === p.id)
			row.appendChild(this.validateResultBox(this._validateResult));
		if (this._validateBusy === p.id)
			row.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Validating…')));
		return row;
	},

	// Guided safe-field whitelist for the "add option" row (top-level,
	// manager-owned structure only — no Lua is ever composed by the UI).
	SAFE_OPTION_NAMES: ['--filter-tcp', '--filter-udp', '--filter-l7', '--payload', '--hostlist', '--hostlist-exclude', '--ipset', '--ipset-exclude', '--out-range', '--in-range'],

	draftEditor: function () {
		var self = this;
		var ed = this._editor;
		var title = ed.mode === 'create' ? _('New draft profile') : (_('Edit draft ') + ed.id);

		var nameInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': 'z2m-editor-name', 'value': ed.name || '' });
		var optArea = E('textarea', {
			'class': 'cbi-input-textarea', 'id': 'z2m-editor-opt', 'rows': 8,
			'style': 'width:100%;font-family:monospace'
		});
		optArea.value = ed.opt || '';

		var dirtyBadge = E('span', { 'class': 'zonebadge warn', 'style': 'visibility:hidden', 'id': 'z2m-editor-dirty' }, _('unsaved changes'));
		function markDirty() { ed.dirty = true; dirtyBadge.style.visibility = 'visible'; }
		nameInput.addEventListener('input', markDirty);
		optArea.addEventListener('input', markDirty);

		// guided row: whitelist select + value + Add (appends to the raw editor)
		var sel = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-editor-addopt' });
		this.SAFE_OPTION_NAMES.forEach(function (o) { sel.appendChild(E('option', { 'value': o }, o)); });
		var valInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': 'z2m-editor-addval', 'placeholder': _('value') });
		var addBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Add option'));
		addBtn.addEventListener('click', function () {
			var optName = sel.value || sel.attrs.value || '--filter-tcp';
			var v = String(valInput.value != null ? valInput.value : (valInput.attrs.value || '')).trim();
			if (!v) return;
			var cur = String(optArea.value || '');
			optArea.value = cur + (cur.length && !/\s$/.test(cur) ? ' ' : '') + optName + '=' + v;
			markDirty();
		});

		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-editor-save' },
			ed.mode === 'create' ? _('Create draft') : _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var payload = { name: String(nameInput.value != null ? nameInput.value : ''), opt: String(optArea.value || '') };
			var call, body;
			if (ed.mode === 'create') {
				body = JSON.stringify(payload);
				call = callProfilesCreate;
			} else {
				payload.id = ed.id;
				payload.revision = ed.revision;
				body = JSON.stringify(payload);
				call = callProfilesUpdate;
			}
			call(body).then(function (res) {
				res = res || {};
				if (res.ok === true) {
					self._editor = null;
					self._flash = ed.mode === 'create' ? _('Draft created.') : _('Draft saved (revision ') + res.revision + ').';
					self.refresh();
				} else {
					saveBtn.disabled = false;
					var code = res.error && res.error.code;
					ed.error = (code === 'ECONFLICT')
						? (_('Conflict: ') + ((res.error && res.error.message) || _('changed elsewhere — reload and retry')))
						: (_('Save failed: ') + ((res.error && res.error.message) || res.error || _('unknown')));
					self.refresh();
				}
			}).catch(function (err) {
				saveBtn.disabled = false;
				ed.error = _('Save call failed: ') + String(err);
				self.refresh();
			});
		});

		var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, ed.dirty ? _('Discard changes') : _('Cancel'));
		cancelBtn.addEventListener('click', function () { self._editor = null; self.refresh(); });

		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			valBtn.disabled = true;
			callProfilesValidate(JSON.stringify({ opt: String(optArea.value || '') })).then(function (res) {
				self._validateResult = { key: 'editor', res: res || {} };
				self.refresh();
			}).catch(function (err) {
				self._validateResult = { key: 'editor', error: String(err) };
				self.refresh();
			});
		});

		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-draft-editor' }, [
			E('h4', {}, title),
			ed.error ? E('div', { 'class': 'alert-message danger' }, ed.error) : E('span', {}),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Name')),
				E('div', { 'class': 'cbi-value-field' }, [nameInput])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Options (raw NFQWS2_OPT fragment)')),
				E('div', { 'class': 'cbi-value-field' }, [optArea])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Add a safe option')),
				E('div', { 'class': 'cbi-value-field' }, [sel, valInput, addBtn])
			]),
			E('div', { 'class': 'cbi-button-row' }, [saveBtn, cancelBtn, valBtn, dirtyBadge])
		]);
		if (this._validateResult && this._validateResult.key === 'editor')
			box.appendChild(this.validateResultBox(this._validateResult));
		return box;
	},

	validateResultBox: function (vr) {
		if (vr.error) return E('div', { 'class': 'alert-message danger' }, _('Validate call failed: ') + vr.error);
		var res = vr.res || {};
		if (res.ok !== true) return E('div', { 'class': 'alert-message danger' }, _('Validate failed: ') + ((res.error && res.error.message) || res.error || _('unknown')));
		var mgr = res.manager || {};
		var native = res.native || {};
		var box = E('div', { 'class': 'cbi-section', 'data-validate-result': '1' }, [
			E('h4', {}, _('Validation result')),
			E('div', {}, [
				E('span', { 'class': 'zonebadge ' + (mgr.parseStatus === 'success' ? 'ok' : 'warn') }, _('manager: ') + (mgr.parseStatus || 'unknown')),
				' ',
				E('span', { 'class': 'zonebadge ' + (native.status === 'partial' ? 'ok' : (native.status === 'not_checked' ? '' : 'warn')) }, _('native: ') + (native.status || 'not_checked'))
			])
		]);
		(native.diagnostics || []).forEach(function (d) {
			box.appendChild(E('div', { 'class': 'cbi-value-description' }, (d.code || 'NATIVE') + ': ' + (d.message || '')));
		});
		(mgr.diagnostics || []).forEach(function (d) {
			box.appendChild(E('div', { 'class': 'cbi-value-description' },
				'[' + (d.severity || '?') + '] ' + (d.code || '') + ': ' + (d.message || '')));
		});
		box.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('Coverage is honest: a passing dry-run proves CLI syntax only (partial) — never full runtime validity.')));
		return box;
	},

	// ---- APPLY (SLICE 3): preview → one confirmation → apply → verify ---------
	applySection: function (profData, profUnavailable) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply drafts to the engine')),
			E('div', { 'class': 'cbi-value-description' },
				_('Preview renders the exact candidate and its diff against the applied config. Apply snapshots last-good, writes only NFQWS2_OPT through the sanctioned writer, restarts via upstream init, and verifies the engine — a failed verification rolls back immediately. The automatic 90s timer stays off; manual rollback remains available.'))
		]);
		if (profUnavailable) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — profiles_list: ') + profUnavailable));
			return node;
		}
		var draftCount = (profData && profData.draft && profData.draft.profileCount) || 0;

		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-apply-preview' }, _('Preview apply'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			self._apply = { busy: true };
			callProfilesApply(JSON.stringify({ mode: 'preview' })).then(function (res) {
				prevBtn.disabled = false;
				self._apply = { preview: res || {} };
				self.refresh();
			}).catch(function (err) {
				prevBtn.disabled = false;
				self._apply = { error: String(err) };
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [prevBtn]));

		var ap = this._apply;
		if (ap && ap.busy) node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Working…')));
		if (ap && ap.error) node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Apply call failed: ') + ap.error));
		if (ap && ap.preview) node.appendChild(this.applyPreviewBox(ap.preview, draftCount));
		if (ap && ap.result) node.appendChild(this.applyResultBox(ap.result));
		return node;
	},

	applyPreviewBox: function (pv, draftCount) {
		var self = this;
		if (pv.ok !== true) {
			var msg = (pv.error && pv.error.message) || pv.error || _('unknown');
			var box = E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Preview refused: ') + msg)
			]);
			(pv.failures || []).forEach(function (f) {
				box.appendChild(E('div', { 'class': 'cbi-value-description' },
					(f.id || '?') + ': ' + (f.diagnostics || []).map(function (d) { return d.code; }).join(', ')));
			});
			if (pv.native) box.appendChild(this.nativeCoverageRow(pv.native));
			return box;
		}
		var diff = pv.diff || {};
		var native = pv.native || {};
		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-apply-preview-box' }, [
			E('h4', {}, _('Apply preview')),
			this.row(_('Draft profiles'), pv.draftCount != null ? pv.draftCount : draftCount),
			this.row(_('Changed vs applied'), diff.changed == null ? _('Unavailable') : (diff.changed ? _('yes') : _('no (identical)'))),
			this.row(_('Applied sha256'), diff.currentSha256 ? String(diff.currentSha256).substring(0, 16) + '…' : _('Unavailable')),
			this.row(_('Candidate sha256'), diff.candidateSha256 ? String(diff.candidateSha256).substring(0, 16) + '…' : _('Unavailable')),
			this.nativeCoverageRow(native),
			E('h4', {}, _('Candidate NFQWS2_OPT')),
			E('pre', { 'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.85em;max-height:200px;overflow:auto' }, pv.candidate || _('(empty)'))
		]);

		if (!pv.wouldApply) {
			box.appendChild(E('div', { 'class': 'alert-message warning' },
				_('Apply is refused by validation: ') + (pv.refuseReason || _('unknown'))));
			return box;
		}

		var armed = this._apply && this._apply.armed;
		var applyBtn = E('button', {
			'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'),
			'type': 'button', 'id': 'z2m-apply-run'
		}, armed ? _('Confirm apply (engine will restart)?') : _('Apply drafts'));
		applyBtn.addEventListener('click', function () {
			if (!self._apply.armed) { self._apply.armed = true; self.refresh(); return; }
			applyBtn.disabled = true;
			self._apply = { busy: true };
			callProfilesApply(JSON.stringify({ mode: 'apply' })).then(function (res) {
				self._apply = { result: res || {}, preview: pv };
				self.refresh();
			}).catch(function (err) {
				self._apply = { error: String(err), preview: pv };
				self.refresh();
			});
		});
		box.appendChild(E('div', { 'class': 'alert-message warning' }, [
			E('p', {}, _('Applying restarts nfqws2 and may drop connectivity briefly. Exactly one confirmation follows.'))
		]));
		box.appendChild(E('div', { 'class': 'cbi-button-row' }, [applyBtn]));
		return box;
	},

	nativeCoverageRow: function (native) {
		var cov = native.coverage || {};
		var parts = [];
		var ks = ['cliSyntax', 'luaLoad', 'functionExistence', 'runtimeArguments'];
		ks.forEach(function (k) { parts.push(k + ': ' + (cov[k] || 'not_checked')); });
		return this.row(_('Native validation'),
			E('span', {}, [
				E('span', { 'class': 'zonebadge ' + (native.status === 'partial' ? 'ok' : (native.status === 'not_checked' ? '' : 'warn')) },
					native.status || 'not_checked'),
				' ' + _('(dry-run proves CLI syntax only — never full runtime validity) · ') + parts.join(' · ')
			]));
	},

	applyResultBox: function (res) {
		var self = this;
		if (res.ok !== true) {
			var msg = (res.error && res.error.message) || res.error || _('unknown');
			var cls = res.critical ? 'alert-message danger' : 'alert-message warning';
			var box = E('div', { 'class': cls }, [
				E('p', {}, _('Apply failed') + (res.stage ? ' (' + res.stage + ')' : '') + ': ' + msg)
			]);
			if (res.rolledBack) box.appendChild(E('p', {}, _('The last-good configuration was restored automatically.')));
			if (res.critical) box.appendChild(E('p', {}, _('CRITICAL: rollback failed — manual recovery required (see last-good under /tmp/zapret2-manager/last-good).')));
			if (res.verify) box.appendChild(this.verifyChecksRow(res.verify));
			return box;
		}
		var v = res.verify || {};
		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-apply-result' }, [
			E('h4', {}, _('Applied and verified')),
			this.row(_('Profiles applied'), (res.applied && res.applied.profiles) || _('Unavailable')),
			this.verifyChecksRow(v),
			E('div', { 'class': 'cbi-value-description' },
				_('The automatic 90s rollback timer is off. If the link dropped, use Roll back now — last-good is kept.'))
		]);

		var okBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Link OK'));
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Roll back now'));
		var status = E('div', { 'class': 'cbi-value-description' });
		okBtn.addEventListener('click', function () {
			okBtn.disabled = true; rbBtn.disabled = true;
			callConfirmAlive().then(function () {
				status.textContent = _('Confirmed. Change kept.');
			}).catch(function (err) {
				status.textContent = _('Confirm failed: ') + String(err);
			}).then(function () { self.refresh(); });
		});
		rbBtn.addEventListener('click', function () {
			okBtn.disabled = true; rbBtn.disabled = true;
			callRollback().then(function () {
				status.textContent = _('Rolled back to last-good.');
			}).catch(function (err) {
				status.textContent = _('Rollback failed: ') + String(err);
			}).then(function () { self.refresh(); });
		});
		box.appendChild(E('div', { 'class': 'cbi-button-row' }, [okBtn, rbBtn]));
		box.appendChild(status);
		return box;
	},

	verifyChecksRow: function (v) {
		var checks = (v && v.checks) || {};
		var names = ['processPresent', 'singleInstance', 'rulesPresent', 'queueRegistered', 'ownerMatch'];
		var parts = names.map(function (n) {
			return E('span', { 'class': 'zonebadge ' + (checks[n] ? 'ok' : 'bad') }, n);
		});
		return this.row(_('Post-restart verification'), E('span', {}, parts));
	},

	// Passthrough: the one strategy mutation the contract HAS (ubus.md).
	// Same 90s rollback discipline as the service-control page.
	passthroughSection: function (current, statusUnavailable) {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', {
			'class': 'cbi-button ' + (current ? 'cbi-button-negative' : 'cbi-button-apply'),
			'type': 'button'
		}, current ? _('Disable passthrough') : _('Enable passthrough (diagnostic)'));
		if (statusUnavailable) btn.disabled = true;

		btn.addEventListener('click', function () {
			btn.disabled = true;
			status.className = 'cbi-value-description';
			status.textContent = _('Restarting nfqws2 in passthrough mode…');
			callPassthrough(!current).then(function (res) {
				res = res || {};
				if (res.rollback_pending) {
					self.confirmFlow(res, status, btn);
				} else {
					btn.disabled = false;
					status.textContent = res.ok
						? _('Passthrough toggled.')
						: (_('Failed: ') + (res.error || ('rc=' + res.rc)));
					self.refresh();
				}
			}).catch(function (err) {
				btn.disabled = false;
				status.textContent = _('Call failed: ') + String(err);
				status.className = 'cbi-value-description alert-message danger';
			});
		});

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Passthrough (diagnostic)')),
			E('div', { 'class': 'cbi-value-description' },
				_('Runs nfqws2 with rules in place but without fake packets — answers "is zapret at fault?". Toggling restarts nfqws2 and arms a 90s backend rollback.')),
			btn,
			status
		]);
	},

	confirmFlow: function (res, statusEl, actionBtn) {
		var self = this;
		var ttl = res.rollback_ttl || 90;
		var remaining = ttl;
		var box = E('div', { 'class': 'alert-message warning', 'style': 'margin-top:.5em' }, [
			E('p', {}, _('Link still alive after the change?')),
			E('span', { 'class': 'zonebadge warn' }, '' + remaining)
		]);
		var okBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Link OK'));
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Roll back now'));
		var cd = box.querySelector('.zonebadge');
		var row = E('div', { 'style': 'margin-top:.4em' }, [okBtn, rbBtn]);
		box.appendChild(row);
		statusEl.textContent = '';
		statusEl.appendChild(box);

		var timer = setInterval(function () {
			remaining--;
			if (cd) cd.textContent = '' + Math.max(remaining, 0);
			if (remaining <= 0) {
				clearInterval(timer);
				statusEl.textContent = _('No confirmation — backend rolling back to last-good…');
				if (actionBtn) actionBtn.disabled = false;
				self.refresh();
			}
		}, 1000);

		okBtn.addEventListener('click', function () {
			clearInterval(timer);
			okBtn.disabled = true;
			rbBtn.disabled = true;
			callConfirmAlive().then(function () {
				statusEl.textContent = _('Confirmed. Change kept.');
			}).catch(function (err) {
				statusEl.textContent = _('Confirm failed: ') + String(err);
			}).then(function () { self.refresh(); });
		});

		rbBtn.addEventListener('click', function () {
			clearInterval(timer);
			okBtn.disabled = true;
			rbBtn.disabled = true;
			callRollback().then(function () {
				statusEl.textContent = _('Rolled back to last-good.');
			}).catch(function (err) {
				statusEl.textContent = _('Rollback failed: ') + String(err);
			}).then(function () { self.refresh(); });
		});
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
			partial: { label: _('partial (no rules)'), cls: 'warn' },
			error: { label: _('error'), cls: 'bad' },
			paused: { label: _('paused'), cls: 'warn' },
			passthrough: { label: _('passthrough'), cls: 'ok' }
		};
		var m = map[state] || { label: state || _('unknown'), cls: '' };
		return E('span', { 'class': 'zonebadge ' + m.cls }, m.label);
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
