'use strict';

// Monitor page — detailed technical screen: instances, NFQUEUE counters,
// qlen health, checks, jobs, warnings. Read-only (service control lives on
// Overview; this page deliberately does not duplicate it).
//
// Polling discipline:
//   - 5s interval per page view; non-overlapping RPC calls
//   - polling stops when the view DOM leaves the document
//   - failed poll keeps last good data with STALE banner, keeps polling
//   - null renders as "Unavailable", never fabricated 0

'require rpc';

const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
const POLL_MS = 5000;
const DISPLAY_LIMIT = 20;

function injectCSS() {
	if (!document || !document.createElement || !document.head || !L || typeof L.resource !== 'function' || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

function argvQnum(cmdline) {
	var m = /--qnum=(\d+)/.exec(cmdline || '');
	return m ? m[1] : null;
}

function esc(s) { return (s == null) ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function h(c) { return document.createTextNode(c); }
function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
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
		injectCSS();
		if (envelope && envelope.loadError == null && envelope.data && !envelope.data.error)
			this._lastGood = { data: envelope.data, at: new Date() };
		var container = this.buildContainer(envelope || { loadError: 'no data', data: null }, null);
		this.startPoller();
		return container;
	},

	startPoller: function () {
		var self = this;
		if (this._pollTimer) return;
		this._pollTimer = setInterval(function () {
			var root = document.getElementById('z2m-monitor-root');
			if (!root) { self.stopPoller(); return; }
			if (self._inflight) return;
			self._inflight = true;
			callStatus().then(function (res) {
				self._lastGood = { data: res || {}, at: new Date() };
				self.replaceRoot(self.buildContainer({ loadError: null, data: res || null }, null));
			}).catch(function (err) {
				self.replaceRoot(self.buildContainer(null, String(err)));
			}).then(function () { self._inflight = false; });
		}, POLL_MS);
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

	buildContainer: function (envelope, pollError) {
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
		var checks = (health.checks || []).slice(0, DISPLAY_LIMIT);
		var jobs = (data.jobs || []).slice(0, DISPLAY_LIMIT);
		var warnings = data.warnings || [];
		var insts = rt.instances || [];

		var container = E('div', { 'class': 'z2m-page', 'id': 'z2m-monitor-root' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Monitor')),
				E('p', {}, _('Live technical state, refreshed every ') + (POLL_MS / 1000) + _('s. Read-only — service control is on Overview.'))
			])
		]);

		if (stale) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('STALE — live update failed: ') + esc(stale.error) + ' · ' + _('Showing stale data from ') + stale.at.toLocaleTimeString()));
		}
		if (statusError) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Status unavailable: ') + esc(statusError) + _('. All fields below render as "Unavailable".')));
		}

		// ---- service summary cards ----
		var cards = E('div', { 'class': 'z2m-card-grid' });
		cards.appendChild(this.summaryCard(_('Service'), [
			this.kvRow(_('State'), statusError ? _('Unavailable') : this.serviceStateBadge(data.serviceState)),
			this.kvRow(_('Pause'), statusError ? _('Unavailable') : this.pauseBadge(data.serviceState)),
			this.kvRow(_('Collected'), esc(data.generatedAt || _('Unavailable'))),
			this.kvRow(_('Profiles'), String(rt.profileCount != null ? rt.profileCount : _('?'))),
			this.kvRow(_('Generation'), String(data.generation != null ? data.generation : '?'))
		]));
		cards.appendChild(this.summaryCard(_('NFQUEUE ' + (queue.number != null ? queue.number : 300)), [
			this.kvRow(_('Registered'), statusError ? _('Unavailable') :
				(queue.registered ? badge(_('yes'), 'ok') : badge(_('no'), 'bad'))),
			this.kvRow(_('qlen state'), this.qlenBadge(qh)),
			this.kvRow(_('Drops (cumul)'), String(queue.queueDropped != null ? queue.queueDropped : '?'))
		]));
		cards.appendChild(this.summaryCard(_('Health'), [
			this.kvRow(_('Checks'), String(health.checks ? health.checks.length : 0)),
			this.kvRow(_('Warnings'), String(warnings.length)),
			this.kvRow(_('Jobs'), String(jobs.length))
		]));
		container.appendChild(cards);

		if (queue.registered === false && !statusError) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				esc(queue.reason || _('NFQUEUE not registered — nfqws2 is not connected.'))));
		}

		// ---- instances ----
		container.appendChild(this.instancesSection(insts, queue, statusError));

		// ---- checks ----
		container.appendChild(this.checksSection(checks, statusError, health.checks ? health.checks.length : 0));

		// ---- jobs ----
		container.appendChild(this.jobsSection(jobs, statusError, (data.jobs || []).length));

		// ---- warnings ----
		if (warnings.length) {
			var warnCard = E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Active warnings') + ' (' + warnings.length + ')')]);
			warnings.slice(0, 10).forEach(function (w) {
				warnCard.appendChild(E('div', { 'class': (w.severity === 'crit' ? 'z2m-callout z2m-callout-bad' : 'z2m-callout z2m-callout-warn') },
					esc(w.code || '?') + ': ' + esc(w.message || '')));
			});
			container.appendChild(warnCard);
		}

		// ---- events (unavailable) ----
		container.appendChild(E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Recent events')),
			E('div', { 'class': 'z2m-empty' },
				_('Unavailable — requires backend method events_tail. Active warnings above come from the status contract.'))
		]));

		return container;
	},

	instancesSection: function (insts, queue, statusError) {
		var total = insts.length;
		var shown = insts.slice(0, DISPLAY_LIMIT);
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Instances') + (total > 0 ? ' (' + Math.min(shown.length, total) + '/' + total + ')' : ''))
		]);

		if (statusError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable.')));
			return node;
		}
		if (!shown.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No nfqws2 instances running.')));
			return node;
		}

		var rows = shown.map(function (p) {
			var qn = argvQnum(p.cmdline) || (queue.number != null ? String(queue.number) : null);
			return E('tr', {}, [
				E('td', {}, String(p.pid)),
				E('td', {}, qn || '?'),
				E('td', {}, esc(p.startTime || '?')),
				E('td', {}, (p.rssKb != null) ? (p.rssKb + ' KB') : '?'),
				E('td', {}, E('pre', { 'class': 'z2m-mono' }, esc(p.cmdline || '?')))
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [
					E('th', {}, _('PID')), E('th', {}, _('qnum')), E('th', {}, _('Started')),
					E('th', {}, _('RSS')), E('th', {}, _('Command'))
				])
			].concat(rows))));

		if (total > DISPLAY_LIMIT) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Showing ') + DISPLAY_LIMIT + _(' of ') + total + _(' instances.')));
		}
		return node;
	},

	checksSection: function (checks, statusError, totalCount) {
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Health checks') + (totalCount > 0 ? ' (' + checks.length + '/' + totalCount + ')' : ''))
		]);

		if (statusError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable.')));
			return node;
		}
		if (!checks.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No checks reported.')));
			return node;
		}

		var rows = checks.map(function (c) {
			var fields = [];
			Object.keys(c || {}).forEach(function (k) {
				if (k === 'id') return;
				var v = c[k];
				fields.push(k + '=' + (v == null ? '?' : (typeof v === 'object' ? JSON.stringify(v) : String(v))));
			});
			return E('tr', {}, [
				E('td', {}, esc((c && c.id) || '?')),
				E('td', {}, fields.length ? fields.join(' · ') : _('no results'))
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('Check')), E('th', {}, _('Result'))])
			].concat(rows))));

		if (totalCount > DISPLAY_LIMIT) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Showing ') + DISPLAY_LIMIT + _(' of ') + totalCount + _(' checks.')));
		}
		return node;
	},

	jobsSection: function (jobs, statusError, totalCount) {
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Recent jobs') + (totalCount > 0 ? ' (' + jobs.length + '/' + totalCount + ')' : ''))
		]);

		if (statusError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable.')));
			return node;
		}
		if (!jobs.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No jobs reported.')));
			return node;
		}

		var rows = jobs.map(function (j) {
			return E('tr', {}, [
				E('td', {}, esc(j.id || '?')),
				E('td', {}, esc(j.status || '?')),
				E('td', {}, esc(j.createdAt || '?')),
				E('td', {}, esc(j.updatedAt || '?'))
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('ID')), E('th', {}, _('Status')),
					E('th', {}, _('Created')), E('th', {}, _('Updated'))])
			].concat(rows))));

		if (totalCount > DISPLAY_LIMIT) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Showing ') + DISPLAY_LIMIT + _(' of ') + totalCount + _(' jobs.')));
		}
		return node;
	},

	summaryCard: function (title, rows) {
		return E('div', { 'class': 'z2m-card' }, [E('h4', {}, title)].concat(rows));
	},

	kvRow: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, label),
			E('span', { 'class': 'z2m-kv-value' }, value)
		]);
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
		var m = map[state] || { label: state || '?', cls: 'neutral' };
		return badge(m.label, m.cls);
	},

	pauseBadge: function (state) {
		if (state === 'paused') return badge(_('paused (service held down)'), 'warn');
		if (state === 'passthrough') return badge(_('passthrough (no fakes)'), 'ok');
		return badge(_('neither'), 'neutral');
	},

	qlenBadge: function (qsig) {
		var map = { nominal: 'ok', warn: 'warn', critical: 'bad', unknown: 'neutral' };
		var label = (qsig && qsig.state) || 'unknown';
		return badge(label, map[label] || 'neutral');
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
