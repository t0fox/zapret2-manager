'use strict';

// Monitor page — the detailed technical screen: instances, NFQUEUE counters,
// qlen health, checks, jobs, warnings. Read-only (service control lives on
// Overview; this page deliberately does not duplicate it).
//
// Polling discipline:
//   - one 5s interval per page view; a new RPC is never started while the
//     previous one is in flight;
//   - polling stops when the view DOM leaves the document (navigation) and on
//     window unload;
//   - a failed poll keeps the last good data on screen, marks it STALE with
//     the error and the timestamp, and keeps polling;
//   - null renders as "Unavailable", never as a fabricated 0.
//
// Events: /tmp/zapret2-manager/events.ndjson is not exposed over ubus, so the
// events section is an honest unavailable panel (method events_tail needed).

'require rpc';

// reject: true — CRITICAL for the stale path: without it a failed poll would
// RESOLVE a numeric ubus code, the number would be rendered as if it were
// status data, and the STALE banner would never appear.
const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });

const POLL_MS = 5000;

function argvQnum(cmdline) {
	var m = /--qnum=(\d+)/.exec(cmdline || '');
	return m ? m[1] : null;
}

return L.view.extend({
	title: _('Monitor'),

	load: function () {
		return callStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
	},

	render: function (envelope) {
		// capture ANY good data arrival as the stale fallback — including the
		// initial load (previously only the poller captured it, so a first
		// failed poll right after a good load had nothing to fall back to).
		if (envelope && envelope.loadError == null && envelope.data && !envelope.data.error)
			this._lastGood = { data: envelope.data, at: new Date() };
		var container = this.buildContainer(envelope || { loadError: 'no data', data: null }, null);
		this.startPoller();
		return container;
	},

	// ---- polling ------------------------------------------------------------

	startPoller: function () {
		var self = this;
		if (this._pollTimer) return;   // one interval per view instance
		this._pollTimer = setInterval(function () {
			var root = document.getElementById('z2m-monitor-root');
			if (!root) { self.stopPoller(); return; }
			if (self._inflight) return;   // never overlap RPC calls
			self._inflight = true;
			callStatus().then(function (res) {
				self._lastGood = { data: res || {}, at: new Date() };
				self.replaceRoot(self.buildContainer({ loadError: null, data: res || null }, null));
			}).catch(function (err) {
				self.replaceRoot(self.buildContainer(null, String(err)));
			}).then(function () { self._inflight = false; });
		}, POLL_MS);
		// belt and suspenders: stop on real page unload too
		if (!this._unloadBound) {
			this._unloadBound = true;
			window.addEventListener('pagehide', function () { self.stopPoller(); });
			window.addEventListener('unload', function () { self.stopPoller(); });
		}
	},

	stopPoller: function () {
		if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
	},

	replaceRoot: function (node) {
		var old = document.getElementById('z2m-monitor-root');
		if (old && old.parentNode) old.parentNode.replaceChild(node, old);
	},

	// ---- view ---------------------------------------------------------------

	buildContainer: function (envelope, pollError) {
		// stale path: poll failed but we have a last-good snapshot
		var stale = null;
		if (pollError && this._lastGood) {
			stale = { error: pollError, at: this._lastGood.at };
			envelope = { loadError: null, data: this._lastGood.data };
		} else if (pollError) {
			envelope = { loadError: pollError, data: null };
		}
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var statusError = envelope.loadError || data.error || null;

		var rt = data.runtime || {};
		var health = data.health || {};
		var qh = health.qlenHealth || {};
		var queue = health.queue || {};
		var checks = health.checks || [];
		var jobs = data.jobs || [];
		var warnings = data.warnings || [];
		var insts = rt.instances || [];

		var container = E('div', { 'class': 'cbi-map', 'id': 'z2m-monitor-root' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Monitor')),
			E('div', { 'class': 'cbi-value-description' },
				_('Live technical state, refreshed every ') + (POLL_MS / 1000) + _(' seconds. Read-only — service control is on Overview.'))
		]);

		if (stale) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('Live update failed: ') + stale.error),
				E('p', {}, _('Showing STALE data collected at ') + stale.at.toLocaleTimeString() + _('. Polling continues.'))
			]));
		}
		if (statusError) {
			container.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Status unavailable: ') + statusError),
				E('p', {}, _('All fields below render as "Unavailable" — nothing is fabricated.'))
			]));
		}

		// ---- service ---------------------------------------------------------
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service')),
			this.row(_('State'), statusError ? _('Unavailable') : this.serviceStateBadge(data.serviceState)),
			this.row(_('Pause / passthrough'),
				statusError ? _('Unavailable') : this.pauseBadge(data.serviceState)),
			this.row(_('Collected at'), data.generatedAt || _('Unavailable')),
			this.row(_('Config generation'),
				(data.generation != null) ? data.generation : _('Unavailable')),
			this.row(_('Profiles (runtime)'),
				(rt.profileCount != null) ? rt.profileCount : _('Unavailable')),
			this.row(_('Last local update'), new Date().toLocaleTimeString())
		]));

		// ---- instances ---------------------------------------------------------
		container.appendChild(this.instancesSection(insts, queue, statusError));

		// ---- NFQUEUE ------------------------------------------------------------
		container.appendChild(this.queueSection(queue, qh, statusError));

		// ---- health checks -------------------------------------------------------
		container.appendChild(this.checksSection(checks, statusError));

		// ---- warnings --------------------------------------------------------------
		if (warnings.length) {
			var list = warnings.map(function (w) {
				return E('div', { 'class': 'alert-message ' + (w.severity === 'crit' ? 'danger' : 'warning') },
					E('p', {}, (w.code || '?') + ': ' + (w.message || '')));
			});
			container.appendChild(E('div', { 'class': 'cbi-section' },
				[E('h3', {}, _('Active warnings'))].concat(list)));
		}

		// ---- jobs --------------------------------------------------------------------
		container.appendChild(this.jobsSection(jobs, statusError));

		// ---- events --------------------------------------------------------------------
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Recent events')),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — the telemetry log (/tmp/zapret2-manager/events.ndjson) is not exposed over ubus. Requires backend method events_tail. Active warnings above come from the status contract.'))
		]));

		return container;
	},

	instancesSection: function (insts, queue, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Instances')),
			this.row(_('CPU'), _('Unavailable — not reported by the backend status schema'))
		]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!insts.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No nfqws2 instances running.')));
			return node;
		}
		var rows = insts.map(function (p) {
			var qn = argvQnum(p.cmdline) || (queue.number != null ? String(queue.number) : null);
			return E('tr', {}, [
				E('td', {}, String(p.pid)),
				E('td', {}, qn || _('Unavailable')),
				E('td', {}, p.startTime || _('Unavailable')),
				E('td', {}, (p.rssKb != null) ? (p.rssKb + ' KB') : _('Unavailable')),
				E('td', { 'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.85em' }, p.cmdline || _('Unavailable'))
			]);
		});
		node.appendChild(E('table', { 'class': 'table' }, [
			E('tr', {}, [
				E('th', {}, _('PID')), E('th', {}, _('qnum')), E('th', {}, _('Started')),
				E('th', {}, _('RSS')), E('th', {}, _('argv'))
			])
		].concat(rows)));
		return node;
	},

	queueSection: function (queue, qh, statusError) {
		var num = (queue.number != null) ? queue.number : 300;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('NFQUEUE ') + num),
			this.row(_('Registered'), statusError ? _('Unavailable') :
				(queue.registered
					? E('span', { 'class': 'zonebadge ok' }, _('yes'))
					: E('span', { 'class': 'zonebadge bad' }, _('no — queue not in kernel')))),
			this.row(_('queueTotal (instant length)'),
				(queue.queueTotal != null) ? queue.queueTotal : _('Unavailable')),
			this.row(_('copyRange'),
				(queue.copyRange != null) ? queue.copyRange : _('Unavailable')),
			this.row(_('queueDropped (cumulative)'),
				(queue.queueDropped != null) ? queue.queueDropped : _('Unavailable')),
			this.row(_('queueUserDropped (cumulative)'),
				(queue.queueUserDropped != null) ? queue.queueUserDropped : _('Unavailable')),
			this.row(_('Counters note'),
				_('drop counters are cumulative monotonic — consume as deltas only')),
			this.row(_('qlen state'), this.qlenBadge(qh)),
			this.row(_('consecutiveOverThreshold'),
				(qh.consecutiveOverThreshold != null) ? qh.consecutiveOverThreshold : _('Unavailable')),
			this.row(_('threshold / crit turns'),
				(qh.threshold != null ? qh.threshold : 50) + ' / ' + (qh.critTurns != null ? qh.critTurns : 3) +
				_(' (backend constants)')),
			this.row(_('Queue cycle updated at'), queue.updatedAt || _('Unavailable'))
		]);
		if (queue.registered === false && !statusError) {
			node.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, queue.reason || _('NFQUEUE is not registered — nfqws2 is not connected to it. Distinct from an empty queue.'))));
		}
		return node;
	},

	checksSection: function (checks, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Health checks'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!checks.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No checks reported in this collection.')));
			return node;
		}
		var rows = checks.map(function (c) {
			var fields = [];
			Object.keys(c || {}).forEach(function (k) {
				if (k === 'id') return;
				var v = c[k];
				fields.push(k + '=' + (v == null ? _('Unavailable') : (typeof v === 'object' ? JSON.stringify(v) : String(v))));
			});
			return E('tr', {}, [
				E('td', {}, (c && c.id) || _('n/a')),
				E('td', {}, fields.length ? fields.join(' · ') : _('checked, no result fields (absent = not checked)'))
			]);
		});
		node.appendChild(E('table', { 'class': 'table' }, [
			E('tr', {}, [E('th', {}, _('Check')), E('th', {}, _('Result'))])
		].concat(rows)));
		return node;
	},

	jobsSection: function (jobs, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Recent jobs'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!jobs.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No jobs reported (the block is empty until the job model lands).')));
			return node;
		}
		var rows = jobs.map(function (j) {
			return E('tr', {}, [
				E('td', {}, j.id || _('n/a')),
				E('td', {}, j.status || _('n/a')),
				E('td', {}, j.createdAt || _('Unavailable')),
				E('td', {}, j.updatedAt || _('Unavailable'))
			]);
		});
		node.appendChild(E('table', { 'class': 'table' }, [
			E('tr', {}, [E('th', {}, _('ID')), E('th', {}, _('Status')),
				E('th', {}, _('Created')), E('th', {}, _('Updated'))])
		].concat(rows)));
		return node;
	},

	// ---- helpers -------------------------------------------------------------

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

	pauseBadge: function (state) {
		if (state === 'paused') return E('span', { 'class': 'zonebadge warn' }, _('paused (service held down)'));
		if (state === 'passthrough') return E('span', { 'class': 'zonebadge ok' }, _('passthrough (no fakes)'));
		return E('span', { 'class': 'zonebadge' }, _('neither'));
	},

	qlenBadge: function (qsig) {
		var map = { nominal: 'ok', warn: 'warn', critical: 'bad', unknown: '' };
		var label = (qsig && qsig.state) || 'unknown';
		return E('span', { 'class': 'zonebadge ' + (map[label] || '') }, label);
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
