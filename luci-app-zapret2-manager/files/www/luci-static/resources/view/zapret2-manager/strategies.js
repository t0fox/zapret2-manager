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

const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status' });
const callPassthrough = rpc.declare({
	object: 'zapret2-manager', method: 'passthrough', params: ['enabled']
});
const callConfirmAlive = rpc.declare({ object: 'zapret2-manager', method: 'confirm_alive' });
const callRollback = rpc.declare({ object: 'zapret2-manager', method: 'rollback' });

// Backend methods this page waits for (rendered as the reason edit actions
// are disabled — also the dependency list for the backend agent).
const MISSING_METHODS = [
	'profiles_list', 'profiles_create', 'profiles_update', 'profiles_clone',
	'profiles_delete', 'profiles_validate', 'profiles_apply'
];

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
		return callStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
	},

	render: function (envelope) {
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var unavailable = envelope.loadError || data.error || null;

		var rt = data.runtime || {};
		var ap = data.applied || {};
		var draft = data.draft || {};
		var drift = data.drift || { divergent: false };
		var insts = rt.instances || [];

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Strategies')),
			E('div', { 'class': 'cbi-value-description' },
				_('Profiles and desync strategies of the zapret2 engine. Read from the live status contract; editing waits for backend methods and is honestly disabled until then.'))
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
			this.row(_('Engine instances'),
				unavailable ? _('Unavailable') : (rt.count != null ? rt.count : insts.length)),
			this.row(_('Source'), drift.divergent ? _('applied + draft (divergent — see below)') : _('applied'))
		]));

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
		container.appendChild(this.draftSection(draft, unavailable));

		// ---- drift ------------------------------------------------------------
		if (drift.divergent) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('Runtime differs from the applied configuration: ') +
					(drift.reason || _('no reason reported')))
			]));
		}

		// ---- validation ---------------------------------------------------------
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Validation')),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — validation state requires backend method profiles_validate.'))
		]));

		// ---- actions ------------------------------------------------------------
		container.appendChild(this.editActionsSection());
		container.appendChild(this.passthroughSection(data.serviceState === 'passthrough', unavailable));

		return container;
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

	draftSection: function (draft, unavailable) {
		var body;
		if (unavailable) {
			body = E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.'));
		} else {
			var keys = Object.keys(draft || {});
			body = keys.length
				? E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace' }, JSON.stringify(draft, null, 2))
				: E('div', { 'class': 'cbi-value-description' }, _('(no staged draft)'));
		}
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Draft (manager-staged)')),
			E('div', { 'class': 'cbi-value-description' },
				_('The manager\'s own staged state. Upstream never reads this.')),
			body
		]);
	},

	// Edit actions: rendered but DISABLED — the backend methods do not exist
	// yet. The caption names the exact methods waited for; no fake save path.
	editActionsSection: function () {
		var names = [
			_('New draft'), _('Edit'), _('Clone'), _('Delete'), _('Validate'), _('Apply')
		];
		var buttons = names.map(function (n) {
			return E('button', {
				'class': 'cbi-button cbi-button-neutral', 'type': 'button',
				'disabled': 'disabled',
				'title': _('Backend method unavailable')
			}, n);
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Edit profiles')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, buttons),
			E('div', { 'class': 'cbi-value-description' },
				_('Editing requires backend methods that are not registered yet: ') +
				MISSING_METHODS.join(', ') +
				_('. Until then this page is read-only — it never saves to localStorage and never writes UCI directly.'))
		]);
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
			callPassthrough({ enabled: !current }).then(function (res) {
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
