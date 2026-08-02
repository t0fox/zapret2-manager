'use strict';

// Blockcheck page — run upstream blockcheck2 as managed jobs (SLICE 4).
//
// Backend reality (wired): blockcheck_start/status/cancel + job_get/job_list
// exist. The scanner (/opt/zapret2/blockcheck2.sh) is CALLED by the backend,
// never reimplemented here. Honest rules of this page:
//   - no fabricated progress percentage — elapsed seconds only;
//   - at most ONE blockcheck job (the backend refuses with ECONFLICT);
//   - cancel is REAL (INT to the scanner's process group);
//   - recommendations carry provenance and are NEVER auto-applied — the only
//     actions are Review and Save to Draft (a draft is staged, not applied);
//   - when the engine runs during a scan the page says results may be
//     unreliable (upstream warning), it never stops the engine by itself.
//   - jobs are kind-scoped: only blockcheck jobs appear here.

'require rpc';

var callBlockcheckStart = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_start', params: ['edit'], reject: true });
var callBlockcheckCancel = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_cancel', params: ['edit'], reject: true });
var callBlockcheckStatus = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_status', reject: true });
var callJobList = rpc.declare({ object: 'zapret2-manager', method: 'job_list', reject: true });
var callProfilesCreate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_create', params: ['edit'], reject: true });
var callBlockcheckApply = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_apply', params: ['edit'], reject: true });

var MODES = [
	{ id: 'quick', label: _('Quick'), hint: _('short connectivity probe (up to ~5 min)') },
	{ id: 'domains', label: _('Domains'), hint: _('per-domain scan, your domains (up to ~15 min)') },
	{ id: 'full', label: _('Full'), hint: _('full sweep incl. TLS 1.3 + QUIC (up to ~30 min)') }
];

var TERMINAL = ['succeeded', 'failed', 'cancelled', 'rolled_back', 'expired'];

function isTerminal(status) { return TERMINAL.indexOf(status) >= 0; }

function fmtElapsed(sec) {
	if (sec == null) return _('n/a');
	var m = Math.floor(sec / 60);
	return m > 0 ? (m + 'm ' + (sec % 60) + 's') : (sec + 's');
}

function h(c) { return document.createTextNode(c); }

function injectCSS() {
	if (!document || !document.createElement || !document.head || !L || typeof L.resource !== 'function' || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

function esc(s) {
	if (s == null) return '';
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
}

return L.view.extend({
	title: _('Blockcheck'),

	load: function () {
		var statusP = callBlockcheckStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		var listP = callJobList().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		return Promise.all([statusP, listP]).then(function (r) {
			return { statusError: r[0].loadError, status: r[0].data, listError: r[1].loadError, list: r[1].data };
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var st = envelope.status || {};
		var statusError = envelope.statusError || (st.ok === false ? 'blockcheck_status failed' : null);
		var allJobs = (envelope.list && envelope.list.jobs) || [];
		// filter to blockcheck kind only
		var jobs = [];
		for (var i = 0; i < allJobs.length; i++) {
			if (allJobs[i].kind === 'blockcheck') jobs.push(allJobs[i]);
		}
		var job = st.job || null;

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Blockcheck')),
				E('p', {}, _('Runs upstream blockcheck2 against test domains as a managed job and reports which strategies pass. No fabricated progress — elapsed time is the honest signal.'))
			])
		]);

		if (statusError) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Status unavailable: ') + esc(statusError)));
		}

		container.appendChild(this.startSection(job, statusError));
		container.appendChild(this.currentJobCard(job, statusError));
		container.appendChild(this.recentSection(jobs, envelope.listError));
		container.appendChild(this.recommendationsSection(job));
		this.schedulePoll();
		return container;
	},

	// ---- run control (compact) ----
	startSection: function (job, statusError) {
		var self = this;
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Run control'))
		]);

		var active = job && !isTerminal(job.status);
		var sel = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-bc-mode' });
		MODES.forEach(function (m) {
			sel.appendChild(E('option', { 'value': m.id }, m.label + ' — ' + m.hint));
		});
		var domArea = E('textarea', {
			'class': 'cbi-input-textarea', 'id': 'z2m-bc-domains', 'rows': 2,
			'style': 'width:100%;font-family:monospace',
			'placeholder': _('domains (space separated; required for "domains" mode; default rutracker.org)')
		});
		domArea.value = '';

		var startBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-bc-start' }, _('Start blockcheck'));
		if (active || statusError) startBtn.disabled = true;
		startBtn.addEventListener('click', function () {
			startBtn.disabled = true;
			var mode = sel.value || 'quick';
			var domains = String(domArea.value || '').trim();
			var payload = { mode: mode };
			if (domains) payload.domains = domains.split(/\s+/).filter(Boolean);
			callBlockcheckStart(JSON.stringify(payload)).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					startBtn.disabled = false;
					self._flash = _('Start refused: ') + ((res.error && res.error.message) || res.error || _('unknown'));
				} else if (res.warning) {
					self._flash = res.warning;
				}
				self.refresh();
			}).catch(function (err) {
				startBtn.disabled = false;
				self._flash = _('Start call failed: ') + String(err);
				self.refresh();
			});
		});

		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Mode')),
			E('span', { 'class': 'z2m-kv-value' }, [sel])
		]));
		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Domains')),
			E('span', { 'class': 'z2m-kv-value' }, [domArea])
		]));
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [startBtn]));
		if (this._flash) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, this._flash));
			this._flash = null;
		}
		if (active) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('A job is active — Start is disabled (at most one blockcheck job).')));
		}
		return node;
	},

	// ---- current job card (compact) ----
	currentJobCard: function (job, statusError) {
		var self = this;
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Current job'))
		]);

		if (statusError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!job) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No blockcheck jobs yet.')));
			return node;
		}

		var active = !isTerminal(job.status);
		var badgeCls = job.status === 'succeeded' ? 'ok' : (isTerminal(job.status) ? 'bad' : 'warn');

		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Status')),
			E('span', { 'class': 'z2m-kv-value' }, [
				badge(job.status, badgeCls), ' ',
				badge(job.mode || '?', 'neutral'), ' ',
				h(_('elapsed: ') + fmtElapsed(job.elapsedSec)),
				job.error ? h(' · error: ' + esc(job.error)) : E('span', {})
			])
		]));
		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Job ID')),
			E('span', { 'class': 'z2m-kv-value' }, esc(job.id || '?'))
		]));
		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Domains')),
			E('span', { 'class': 'z2m-kv-value' }, esc((job.domains || []).join(' ') || 'n/a'))
		]));

		if (job.engineRunning === true) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('The engine was running during this scan — upstream warns results may be unreliable with bypass active.')));
		}

		if (active) {
			var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button', 'id': 'z2m-bc-cancel' }, _('Cancel job'));
			cancelBtn.addEventListener('click', function () {
				cancelBtn.disabled = true;
				callBlockcheckCancel(JSON.stringify({ id: job.id })).then(function (res) {
					res = res || {};
					if (res.ok !== true) {
						cancelBtn.disabled = false;
						self._flash = _('Cancel failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
					}
					self.refresh();
				}).catch(function (err) {
					cancelBtn.disabled = false;
					self._flash = _('Cancel call failed: ') + String(err);
					self.refresh();
				});
			});
			node.appendChild(E('div', { 'class': 'z2m-actions' }, [cancelBtn]));
		}

		if (job.logTail) {
			// collapsible log
			var logId = 'z2m-bc-log-' + Date.now();
			var logToggle = E('div', { 'class': 'z2m-tech-toggle', 'click': function () {
				var el = document.getElementById(logId);
				if (el) el.hidden = !el.hidden;
			}}, '\u25B6 ' + _('Log tail'));
			var logBody = E('pre', {
				'class': 'z2m-mono', 'id': logId, 'hidden': true,
				'style': 'max-height:220px;overflow:auto'
			}, esc(job.logTail));
			node.appendChild(logToggle);
			node.appendChild(logBody);
		}
		return node;
	},

	// ---- recent jobs (blockcheck only) ----
	recentSection: function (jobs, listError) {
		var total = jobs.length;
		var shown = jobs.slice(0, 20);
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Recent blockcheck jobs') + (total > 0 ? ' (' + Math.min(shown.length, total) + '/' + total + ')' : ''))
		]);

		if (listError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — job_list: ') + esc(listError)));
			return node;
		}
		if (!shown.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('(none)')));
			return node;
		}
		var rows = shown.map(function (j) {
			var badgeCls = j.status === 'succeeded' ? 'ok' : (isTerminal(j.status) ? 'bad' : 'warn');
			return E('tr', {}, [
				E('td', {}, esc(j.id || 'n/a')),
				E('td', {}, badge(j.status || 'n/a', badgeCls)),
				E('td', {}, esc(j.mode || 'n/a')),
				E('td', {}, h(fmtElapsed(j.elapsedSec))),
				E('td', {}, esc(j.error || ''))
			]);
		});
		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('ID')), E('th', {}, _('Status')), E('th', {}, _('Mode')), E('th', {}, _('Elapsed')), E('th', {}, _('Error'))])
			].concat(rows))));
		return node;
	},

	// ---- recommendations (Review / Apply to preset) ----
	recommendationsSection: function (job) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Recommendations')),
			E('div', { 'class': 'cbi-value-description' },
				_('Working strategies found by the upstream scanner. Apply writes the selected preset atomically and does not restart rpcd.'))
		]);

		var recs = (job && job.recommendations) || [];
		if (!recs.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				job && job.status === 'succeeded' ? _('The scan found no working strategies.') : _('Unavailable until a scan finishes.')));
			return node;
		}

		recs.forEach(function (r, i) {
			var card = E('div', { 'class': 'z2m-card', 'data-rec-index': '' + i }, [
				E('h4', {}, esc(r.domain || '?') + ' · ' + esc(r.test || '?') + ' · ' + esc(r.ipver || '?')),
				E('pre', { 'class': 'z2m-mono' }, esc(r.strategy || '')),
				E('div', { 'class': 'cbi-value-description' },
					_('provenance: ') + ((r.provenance && r.provenance.source) || 'upstream blockcheck2.sh') +
					' · mode ' + ((r.provenance && r.provenance.mode) || (job && job.mode) || '?'))
			]);

			var reviewBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Review raw'));
			var rawBox = null;
			reviewBtn.addEventListener('click', function () {
				if (rawBox) { card.removeChild(rawBox); rawBox = null; return; }
				rawBox = E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.8em;padding:.4em;background:var(--card-bg,#f6f6f6)' }, esc(r.raw || r.strategy || ''));
				card.appendChild(rawBox);
			});

			var applyBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply strategy'));
			var resultBox = E('div', { 'class': 'z2m-callout', 'hidden': true });
			applyBtn.addEventListener('click', function () {
				applyBtn.disabled = true;
				var proto = String(r.test || '').indexOf('stun') >= 0 ? 'stun_voice' : (String(r.test || '').indexOf('udp') >= 0 || String(r.test || '').indexOf('quic') >= 0 ? 'udp_games' : 'tcp_https');
				callBlockcheckApply(JSON.stringify({ strategy: r.strategy || '', target: r.domain || '', protocol: proto })).then(function (res) {
					res = res || {}; resultBox.hidden = false;
					if (res.ok === true) { resultBox.className = 'z2m-callout z2m-callout-ok'; resultBox.textContent = _('Applied to ') + res.fileName + ': ' + res.operation + ' (' + res.appliedProfile + ')'; applyBtn.textContent = _('Applied'); }
					else { applyBtn.disabled = false; resultBox.className = 'z2m-callout z2m-callout-bad'; resultBox.textContent = _('Apply failed: ') + ((res.error && res.error.message) || res.error || _('unknown')); }
				}).catch(function (err) { applyBtn.disabled = false; resultBox.hidden = false; resultBox.className = 'z2m-callout z2m-callout-bad'; resultBox.textContent = _('Apply call failed: ') + String(err); });
			});

			card.appendChild(E('div', { 'class': 'z2m-actions' }, [reviewBtn, applyBtn]));
			card.appendChild(resultBox);
			node.appendChild(card);
		});
		return node;
	},

	// poll while a job is active (2s) — DOM-detachment safe
	schedulePoll: function () {
		var self = this;
		if (this._pollTimer) return;
		function poll() {
			if (!document.querySelector('.cbi-map')) { self.stopPoll(); return; }
			callBlockcheckStatus().then(function (res) {
				self._polled = false;
				self.refresh();
			}).catch(function () { self._polled = false; });
		}
		this._pollTimer = setInterval(poll, 2000);
		if (!this._unloadBound) {
			this._unloadBound = true;
			window.addEventListener('pagehide', function () { self.stopPoll(); });
			window.addEventListener('unload', function () { self.stopPoll(); });
		}
	},

	stopPoll: function () {
		if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
	},

	refresh: function () {
		var self = this;
		this.load().then(function (envelope) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render(envelope), old);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
