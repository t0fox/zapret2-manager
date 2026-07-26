'use strict';

// Overview — read-only status for zapret2-manager.
// Renders the three-level state from the ubus `status` method (branch 02):
//   RUNTIME  (what is running)   APPLIED (on-disk config)   DRAFT (staged)
// plus the NFQUEUE-qlen third liveness signal. No mutation buttons here —
// service control lands in branch 04.

return L.view.extend({
	title: _('Overview'),

	load: function () {
		// Schema v2 (camelCase) fallback shape — see docs/contracts/status.schema.json.
		return L.resolveDefault(L.ubus.call('zapret2-manager', 'status'), {
			schema: 2, generatedAt: null, generation: null, serviceState: 'stopped',
			runtime: { present: false, count: 0, instances: [], rulesPresent: false },
			applied: {}, draft: {},
			health: { qlenHealth: { state: 'unknown', threshold: 50,
				consecutiveOverThreshold: 0, critTurns: 3 }, checks: [], queue: {} },
			drift: { divergent: false },
			system: { autostart: { enabled: false, symlinks: [] }, upgradable: null },
			upstream: { nfqws2Version: null, autohostlist: null },
			jobs: [], warnings: []
		});
	},

	// serviceState is a closed-enum STRING from the backend. The UI maps a value
	// to a label + CSS class — pure presentation, no state/threshold logic.
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
		return this.badge(m.label, m.cls);
	},

	render: function (data) {
		var rt = data.runtime || {};
		var ap = data.applied || {};
		var system = data.system || { autostart: { enabled: false, symlinks: [] }, upgradable: null };
		var upstream = data.upstream || { nfqws2Version: null, autohostlist: null };
		var health = data.health || { qlenHealth: {}, checks: [], queue: {} };
		var qh = health.qlenHealth || {};
		var queue = health.queue || {};
		// Backend-computed conclusions: the UI only renders these, it does not
		// recompute state/thresholds/drift. The watchdog reads the same status,
		// so it sees the same picture a human sees.
		var drift = data.drift || { divergent: false };

		var insts = rt.instances || [];
		var pidList = insts.map(function (p) { return p.pid; });
		var instances = rt.count || insts.length || 0;
		var profiles = (rt.profileCount != null) ? rt.profileCount : _('n/a');
		// null version = checked, no value (distinct from the key being absent =
		// not checked). The key is always present in status; render null as its
		// own thing, not as 'unknown'.
		var version = (upstream.nfqws2Version == null)
			? _('— (none found)')
			: upstream.nfqws2Version;
		var generation = (data.generation != null) ? data.generation : _('n/a');

		// ---- assemble --------------------------------------------------------
		var plaque = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service')),
			this.row(_('State'), this.serviceStateBadge(data.serviceState)),
			this.row(_('Instances'), instances),
			this.row(_('Profiles'), profiles),
			this.row(_('PIDs'), pidList.length ? pidList.join(', ') : _('none')),
			this.row(_('nfqws2 version'), version + this.updateBadge(system)),
			this.row(_('Config generation'), generation)
		]);

		var auto = system.autostart || { enabled: false, symlinks: [] };
		var autoNode = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Autostart')),
			this.row(_('rc.d symlinks'),
				auto.enabled ? this.badge(_('enabled'), 'ok') : this.badge(_('disabled'), 'bad')),
			E('div', { 'class': 'cbi-value-description' },
				auto.symlinks.length
					? auto.symlinks.join(', ')
					: _('no zapret2 symlinks in /etc/rc.d')),
			E('div', { 'class': 'cbi-value-description' },
				_('Informational. Authoritative check is a real reboot — see tools/smoke.sh autostart.'))
		]);

		var qlenNode = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('NFQUEUE 300')),
			this.row(_('Registered'), queue.registered
				? this.badge(_('yes'), 'ok')
				: this.badge(_('no — queue not in kernel'), 'bad')),
			this.row(_('Queue length (queueTotal)'),
				(queue.queueTotal != null) ? queue.queueTotal : _('—')),
			this.row(_('State'), this.qlenBadge(qh)),
			this.row(_('Consecutive over threshold'),
				(qh.consecutiveOverThreshold != null) ? qh.consecutiveOverThreshold : 0),
			this.row(_('Threshold / crit turns'),
				(qh.threshold != null ? qh.threshold : 50) + ' / ' + (qh.critTurns != null ? qh.critTurns : 3))
		]);

		if (queue.registered === false) {
			qlenNode.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('NFQUEUE 300 is not registered in the kernel — nfqws2 is not connected to it. This is diagnostically important and is NOT the same as an empty queue.'))));
		}

		var autohostlistNode = this.autohostlistSection(upstream.autohostlist);

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager')),
			plaque, autoNode, qlenNode, autohostlistNode
		]);

		if (drift.divergent) {
			container.appendChild(this.divergenceWarning(rt, ap, drift));
		}

		container.appendChild(this.controlSection());
		// passthrough is a self-standing serviceState now (not a separate flag).
		container.appendChild(this.passthroughSection(data.serviceState === 'passthrough'));

		return container;
	},

	// ---- service control (branch 04) -----------------------------------------

	controlSection: function () {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');

		function btn(label, cls, action, disruptive) {
			var b = E('button', { 'class': 'cbi-button ' + (cls || ''), 'type': 'button' }, label);
			b.addEventListener('click', function () {
				b.disabled = true;
				status.textContent = _('Working…');
				L.ubus.call('zapret2-manager', action).then(function (res) {
					b.disabled = false;
					res = res || {};
					if (disruptive && res.rollback_pending) {
						self.confirmFlow(res, status);
					} else {
						status.textContent = res.ok ? _('Done.') : (_('Failed: ') + (res.error || ('rc=' + res.rc)));
						self.refresh();
					}
				});
			});
			return b;
		}

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service control')),
			E('div', { 'class': 'cbi-value-description' },
				_('Stop sets a paused flag so hotplug/init/watchdog will not re-raise the service.')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [
				btn(_('Start'), 'cbi-button-apply', 'start', false),
				btn(_('Stop'), 'cbi-button-negative', 'stop', false),
				btn(_('Restart'), 'cbi-button-neutral', 'restart', true),
				btn(_('Restart daemons'), 'cbi-button-neutral', 'restart_daemons', true),
				btn(_('Install firewall rules'), 'cbi-button-neutral', 'start_fw', true),
				btn(_('Reload interface sets'), 'cbi-button-neutral', 'reload_ifsets', true)
			]),
			// 'Install firewall rules' = start_fw (install the zapret2 nft rules
			// when missing). 'Reload interface sets' = reload_ifsets (re-read
			// ifset membership after an interface came/went; rules already
			// installed). Two distinct operations, both delegated to upstream's
			// /etc/init.d/zapret2 — they touch only the zapret2 table.
			// DO NOT add a 'Restart firewall' button: a full firewall
			// stop/restart destroys other packages' nft tables and once reset
			// this router to factory defaults. That prohibition is absolute.
			E('div', { 'class': 'cbi-value-description' },
				_('Install firewall rules (start_fw) installs the zapret2 nft rules when missing. Reload interface sets (reload_ifsets) re-reads ifset membership after an interface change. A full firewall restart is intentionally not offered — it destroys other packages\' nft tables.')),
			status
		]);
	},

	confirmFlow: function (res, statusEl) {
		// Disruptive ops arm a 90s backend rollback. Ask the operator to confirm
		// the link is alive; otherwise the backend auto-rolls back at 90s.
		var ttl = res.rollback_ttl || 90;
		var remaining = ttl;
		var box = E('div', { 'class': 'alert-message warning', 'style': 'margin-top:.5em' }, [
			E('p', {}, _('Link still alive after the change?')),
			E('span', { 'class': 'zonebadge warn', 'id': 'z2m-countdown' }, '' + remaining),
			E('div', { 'style': 'margin-top:.4em' }, [])
		]);
		var okBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Link OK'));
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Roll back now'));
		box.lastChild.appendChild(okBtn);
		box.lastChild.appendChild(rbBtn);
		statusEl.textContent = '';
		statusEl.appendChild(box);

		var cd = box.querySelector('#z2m-countdown');
		var timer = setInterval(function () {
			remaining--;
			if (cd) cd.textContent = '' + Math.max(remaining, 0);
			if (remaining <= 0) {
				clearInterval(timer);
				statusEl.textContent = _('No confirmation — backend rolling back to last-good…');
				this.refresh();
			}
		}.bind(this), 1000);

		okBtn.addEventListener('click', function () {
			clearInterval(timer);
			L.ubus.call('zapret2-manager', 'confirm_alive').then(function () {
				statusEl.textContent = _('Confirmed. Change kept.');
			});
			this.refresh();
		}.bind(this));

		rbBtn.addEventListener('click', function () {
			clearInterval(timer);
			L.ubus.call('zapret2-manager', 'rollback').then(function () {
				statusEl.textContent = _('Rolled back to last-good.');
			});
			this.refresh();
		}.bind(this));
	},

	refresh: function () {
		// Re-render from a fresh status call after a mutation.
		var self = this;
		L.resolveDefault(L.ubus.call('zapret2-manager', 'status'), {})
			.then(function (data) {
				var old = document.querySelector('.cbi-map');
				if (old && old.parentNode)
					old.parentNode.replaceChild(self.render(data || {}), old);
			});
	},

	// ---- passthrough (branch 05) ---------------------------------------------

	passthroughSection: function (current) {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var cb = E('input', { 'type': 'checkbox', 'id': 'z2m-passthrough' });
		if (current) cb.checked = true;

		cb.addEventListener('change', function () {
			var on = cb.checked;
			cb.disabled = true;
			status.textContent = _('Restarting nfqws2 in passthrough mode…');
			L.ubus.call('zapret2-manager', 'passthrough', { enabled: on }).then(function (res) {
				cb.disabled = false;
				res = res || {};
				if (res.rollback_pending) {
					self.confirmFlow(res, status);
				} else {
					status.textContent = res.ok ? _('Passthrough ' + (on ? 'ON' : 'OFF') + '.') :
						(_('Failed: ') + (res.error || ('rc=' + res.rc)));
					self.refresh();
				}
			});
		});

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Passthrough (diagnostic)')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'z2m-passthrough' }, _('No fakes')),
				E('div', { 'class': 'cbi-value-field' }, cb)
			]),
			E('div', { 'class': 'cbi-value-description' },
				_('Runs nfqws2 with rules in place but does not send fake packets. ' +
				  'Use this to answer "is zapret at fault?": if connectivity returns ' +
				  'in passthrough, the bypass strategies are the cause; if not, the ' +
				  'problem is upstream of zapret. Toggling restarts nfqws2.'))
		]);
	},

	// ---- helpers -------------------------------------------------------------

	// qlenBadge maps the backend-computed qlen state string to a CSS class —
	// pure presentation, no threshold logic. The threshold logic (when state
	// becomes warn/critical) lives in the watchdog; the UI only renders.
	qlenBadge: function (qsig) {
		var map = { nominal: 'ok', warn: 'warn', critical: 'bad', unknown: '' };
		var label = (qsig && qsig.state) || 'unknown';
		return this.badge(label, map[label] || '');
	},

	badge: function (text, cls) {
		return E('span', { 'class': 'zonebadge ' + (cls || '') }, text);
	},

	// autohostlist vars are upstream's knobs, shown verbatim — NO manager
	// thresholds here (PART 2.2). null = the var is in the config but empty;
	// the whole block is null when /opt/zapret2/config is unreadable.
	autohostlistSection: function (vars) {
		if (vars == null) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Autohostlist (upstream)')),
				E('div', { 'class': 'cbi-value-description' },
					_('No AUTOHOSTLIST variables in /opt/zapret2/config, or config unreadable.'))
			]);
		}
		var rows = [];
		var keys = Object.keys(vars).sort();
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			rows.push(this.row(k, (vars[k] == null) ? _('(empty)') : vars[k]));
		}
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Autohostlist (upstream, shown as-is)')),
			E('div', { 'class': 'cbi-value-description' },
				_('These are upstream AUTOHOSTLIST* values from /opt/zapret2/config, displayed verbatim. The manager applies no thresholds of its own here.'))
		].concat(rows.length ? rows : [
			E('div', { 'class': 'cbi-value-description' }, _('No AUTOHOSTLIST variables set.'))
		]));
	},

	updateBadge: function (system) {
		var v = system ? system.upgradable : null;
		if (v === true) return ' ' + this.badge(_('update available'), 'warn');
		if (v === false) return ' ' + this.badge(_('up to date'), 'ok');
		return '';   // null = unknown → no badge
	},

	row: function (label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, value)
		]);
	},

	// divergenceWarning renders the backend drift block (status.drift). It
	// shows the backend's reason + basis and a toggleable raw view of runtime
	// argv vs applied. No drift computation here (REVIEW 2).
	divergenceWarning: function (rt, ap, drift) {
		var reason = drift.reason || _('Runtime does not match applied config.');
		var panel = E('div', { 'class': 'cbi-section', 'style': 'display:none' }, [
			E('h3', {}, _('Runtime vs applied')),
			E('div', { 'class': 'cbi-value-description' },
				_('Basis: ') + (drift.basis || '?') + ' — ' + reason),
			E('div', { 'class': 'cbi-value-description' },
				_('Applied sha256: ') + JSON.stringify(drift.appliedSha256 || {})),
			E('div', { 'class': 'cbi-value-description' },
				_('Current sha256: ') + JSON.stringify(drift.currentSha256 || {})),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('RUNTIME cmdline:\n') + (rt.instances || []).map(function (p) {
					return p.pid + ': ' + (p.cmdline || '');
				}).join('\n')),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('RUNTIME strategies:\n') + (rt.strategies || _('none'))),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('APPLIED uci:\n') + (ap.uci || _('none')))
		]);

		var btn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' },
			_('Show diff'));
		btn.addEventListener('click', function () {
			var hidden = panel.style.display === 'none';
			panel.style.display = hidden ? '' : 'none';
			btn.textContent = hidden ? _('Hide diff') : _('Show diff');
		});

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Divergence')),
			E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, reason),
				btn
			]),
			panel
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
