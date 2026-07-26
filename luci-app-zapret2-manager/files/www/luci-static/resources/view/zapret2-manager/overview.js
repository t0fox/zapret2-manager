'use strict';

// Overview — read-only status for zapret2-manager.
// Renders the three-level state from the ubus `status` method (branch 02):
//   RUNTIME  (what is running)   APPLIED (on-disk config)   DRAFT (staged)
// plus the NFQUEUE-qlen third liveness signal. No mutation buttons here —
// service control lands in branch 04.

return L.view.extend({
	title: _('Overview'),

	load: function () {
		return L.resolveDefault(L.ubus.call('zapret2-manager', 'status'), {
			runtime: {}, applied: {}, draft: {}, meta: {},
			signals: { process_present: false, rules_present: false, qlen: {} }
		});
	},

	render: function (data) {
		var rt = data.runtime || {};
		var ap = data.applied || {};
		var meta = data.meta || {};
		var sig = data.signals || {};
		var qlen = sig.qlen || {};

		// ---- service state ---------------------------------------------------
		var state = this.deriveState(rt, sig, qlen);
		var pids = (rt.pids || []).map(function (p) { return p.pid; });
		var instances = rt.count || pids.length || 0;
		var profiles = this.countProfiles(rt.strategies);
		var version = meta.nfqws2_version || _('unknown');
		var generation = (ap.generation != null) ? ap.generation : _('n/a');

		// ---- divergence: edited-but-not-restarted ----------------------------
		var divergent = this.detectDivergence(rt, ap);

		// ---- assemble --------------------------------------------------------
		var plaque = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service')),
			this.row(_('State'), this.badge(state.label, state.cls)),
			this.row(_('Instances'), instances),
			this.row(_('Profiles'), profiles),
			this.row(_('PIDs'), pids.length ? pids.join(', ') : _('none')),
			this.row(_('nfqws2 version'), version + this.updateBadge(meta)),
			this.row(_('Config generation'), generation)
		]);

		var auto = meta.autostart || { enabled: false, symlinks: [] };
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
			this.row(_('Queue length'), (qlen.qlen != null) ? qlen.qlen : _('unknown')),
			this.row(_('State'), this.qlenBadge(qlen)),
			this.row(_('Consecutive over threshold'), qlen.consecutive != null ? qlen.consecutive : 0)
		]);

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager')),
			plaque, auto, qlenNode
		]);

		if (divergent) {
			container.appendChild(this.divergenceWarning(rt, ap));
		}

		container.appendChild(this.controlSection());
		container.appendChild(this.passthroughSection(data.passthrough));

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
				btn(_('Reload interface sets'), 'cbi-button-neutral', 'start_fw', true)
			]),
			E('div', { 'class': 'cbi-value-description' },
				_('Reload interface sets runs `fw4 reload_ifsets` only. A full firewall restart is intentionally not offered — it destroys the nft table.')),
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

	deriveState: function (rt, sig, qlen) {
		if (!sig.process_present)
			return { label: _('stopped'), cls: 'bad' };
		if (qlen.state === 'critical')
			return { label: _('degraded: queue jammed'), cls: 'bad' };
		if (!sig.rules_present)
			return { label: _('partial: no rules'), cls: 'warn' };
		if (qlen.state === 'warn')
			return { label: _('running (qlen warn)'), cls: 'warn' };
		return { label: _('running'), cls: 'ok' };
	},

	countProfiles: function (strategies) {
		if (!strategies || !strategies.length) return _('n/a');
		var n = strategies.split('\n').filter(function (l) { return l.trim().length; }).length;
		return n || _('n/a');
	},

	detectDivergence: function (rt, ap) {
		// Edited-but-not-restarted: the config file was modified after the
		// running process started. Honest, concrete, not a heuristic guess.
		if (!rt.present || !ap.config_present || ap.config_mtime == null) return false;
		var starts = (rt.pids || []).map(function (p) { return p.start_time; })
			.filter(function (t) { return t != null; });
		if (!starts.length) return false;
		var earliest = Math.min.apply(null, starts);
		return ap.config_mtime > earliest;
	},

	badge: function (text, cls) {
		return E('span', { 'class': 'zonebadge ' + (cls || '') }, text);
	},

	qlenBadge: function (qlen) {
		var map = { nominal: 'ok', warn: 'warn', critical: 'bad', unknown: '' };
		var label = qlen.state || 'unknown';
		return this.badge(label, map[label] || '');
	},

	updateBadge: function (meta) {
		var v = (meta.versions && meta.versions.upgradable);
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

	divergenceWarning: function (rt, ap) {
		var panel = E('div', { 'class': 'cbi-section', 'style': 'display:none' }, [
			E('h3', {}, _('Runtime vs applied')),
			E('div', { 'class': 'cbi-value-description' },
				_('The config was modified after the running process started — a restart is needed to apply it.')),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('RUNTIME cmdline:\n') + (rt.pids || []).map(function (p) {
					return p.pid + ': ' + (p.cmdline || '');
				}).join('\n')),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('RUNTIME strategies:\n') + (rt.strategies || _('none'))),
			E('pre', { 'style': 'white-space:pre-wrap;margin:.5em 0' },
				_('APPLIED uci:\n') + (ap.uci || _('none'))),
			E('div', { 'class': 'cbi-value-description' },
				_('APPLIED config: ') + (ap.config_path || '?') +
				'  mtime=' + (ap.config_mtime || '?') +
				'  size=' + (ap.config_size || '?'))
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
				E('p', {}, _('Runtime does not match applied config.')),
				btn
			]),
			panel
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
