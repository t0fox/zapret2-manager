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

'require rpc';

const callBlockcheckStart = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_start', params: ['edit'], reject: true });
const callBlockcheckCancel = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_cancel', params: ['edit'], reject: true });
const callBlockcheckStatus = rpc.declare({ object: 'zapret2-manager', method: 'blockcheck_status', reject: true });
const callJobList = rpc.declare({ object: 'zapret2-manager', method: 'job_list', reject: true });
const callProfilesCreate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_create', params: ['edit'], reject: true });

const MODES = [
	{ id: 'quick', label: _('quick'), hint: _('short connectivity probe (up to ~5 min)') },
	{ id: 'domains', label: _('domains'), hint: _('per-domain scan, your domains (up to ~15 min)') },
	{ id: 'full', label: _('full'), hint: _('full sweep incl. TLS 1.3 + QUIC (up to ~30 min)') }
];

const TERMINAL = ['succeeded', 'failed', 'cancelled', 'rolled_back', 'expired'];

function isTerminal(status) {
	return TERMINAL.indexOf(status) >= 0;
}

function fmtElapsed(sec) {
	if (sec == null) return _('n/a');
	var m = Math.floor(sec / 60);
	return m > 0 ? (m + 'm ' + (sec % 60) + 's') : (sec + 's');
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
		envelope = envelope || {};
		var st = envelope.status || {};
		var statusError = envelope.statusError || (st.ok === false ? 'blockcheck_status failed' : null);
		var jobs = (envelope.list && envelope.list.jobs) || [];
		var job = st.job || null;

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Blockcheck')),
			E('div', { 'class': 'cbi-value-description' },
				_('Runs upstream blockcheck2 against test domains as a managed job and reports which strategies pass. No fabricated progress: elapsed time is the honest signal.'))
		]);

		if (statusError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Status unavailable: ') + statusError)));
		}

		container.appendChild(this.startSection(job, statusError));
		container.appendChild(this.currentJobSection(job, statusError));
		container.appendChild(this.recentSection(jobs, envelope.listError));
		container.appendChild(this.recommendationsSection(job));
		this.schedulePoll(job);
		return container;
	},

	// ---- run control ---------------------------------------------------------
	startSection: function (job, statusError) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Run control'))]);

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
			var mode = sel.value || sel.attrs.value || 'quick';
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

		node.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Mode')),
			E('div', { 'class': 'cbi-value-field' }, [sel])
		]));
		node.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Domains')),
			E('div', { 'class': 'cbi-value-field' }, [domArea])
		]));
		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [startBtn]));
		if (this._flash) {
			node.appendChild(E('div', { 'class': 'alert-message warning' }, this._flash));
			this._flash = null;
		}
		if (active) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('A job is active — Start is disabled (at most one blockcheck job; the backend refuses a second with ECONFLICT).')));
		}
		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('The scanner temporarily creates its own firewall table and test instances, and cleans them up on exit or cancel. For reliable results the bypass engine should be stopped first (upstream warning) — this page never stops it for you.')));
		return node;
	},

	// ---- current job ---------------------------------------------------------
	currentJobSection: function (job, statusError) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Current job'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!job) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No blockcheck jobs yet.')));
			return node;
		}
		var active = !isTerminal(job.status);
		var badgeCls = job.status === 'succeeded' ? 'ok' : (isTerminal(job.status) ? 'bad' : 'warn');
		node.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Job ') + job.id),
			E('div', { 'class': 'cbi-value-field' }, [
				E('span', { 'class': 'zonebadge ' + badgeCls }, job.status), ' ',
				E('span', { 'class': 'zonebadge' }, job.mode || '?'), ' ',
				_('elapsed: ') + fmtElapsed(job.elapsedSec) +
				(job.error ? _(' · error: ') + job.error : '')
			])
		]));
		node.appendChild(this.row(_('Domains'), (job.domains || []).join(' ') || _('Unavailable')));
		if (job.engineRunning === true) {
			node.appendChild(E('div', { 'class': 'alert-message warning' },
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
			node.appendChild(E('div', { 'class': 'cbi-button-row' }, [cancelBtn]));
		}

		if (job.logTail) {
			node.appendChild(E('h4', {}, _('Log tail')));
			node.appendChild(E('pre', {
				'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.8em;max-height:220px;overflow:auto'
			}, job.logTail));
		}
		return node;
	},

	recentSection: function (jobs, listError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Recent jobs'))]);
		if (listError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — job_list: ') + listError));
			return node;
		}
		if (!jobs.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('(none)')));
			return node;
		}
		var rows = jobs.map(function (j) {
			return E('tr', {}, [
				E('td', {}, j.id || _('n/a')),
				E('td', {}, j.status || _('n/a')),
				E('td', {}, j.mode || _('n/a')),
				E('td', {}, fmtElapsed(j.elapsedSec)),
				E('td', {}, j.error || '')
			]);
		});
		node.appendChild(E('table', { 'class': 'table' }, [
			E('tr', {}, [E('th', {}, _('ID')), E('th', {}, _('Status')), E('th', {}, _('Mode')), E('th', {}, _('Elapsed')), E('th', {}, _('Error'))])
		].concat(rows)));
		return node;
	},

	// ---- recommendations (Review / Save to Draft — NEVER auto-applied) --------
	recommendationsSection: function (job) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Recommendations')),
			E('div', { 'class': 'cbi-value-description' },
				_('Working strategies found by the upstream scanner, with provenance. Actions: Review the raw strategy or Save it to a DRAFT profile — nothing is ever applied automatically.'))
		]);
		var recs = (job && job.recommendations) || [];
		if (!recs.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				job && job.status === 'succeeded' ? _('The scan found no working strategies.') : _('Unavailable until a scan finishes.')));
			return node;
		}
		recs.forEach(function (r, i) {
			var card = E('div', { 'class': 'cbi-section', 'data-rec-index': '' + i }, [
				E('h4', {}, (r.domain || '?') + ' · ' + (r.test || '?') + ' · ' + (r.ipver || '?')),
				E('pre', { 'style': 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.85em' }, r.strategy || ''),
				E('div', { 'class': 'cbi-value-description' },
					_('provenance: ') + ((r.provenance && r.provenance.source) || 'upstream blockcheck2.sh') +
					' · mode ' + ((r.provenance && r.provenance.mode) || (job && job.mode) || '?'))
			]);
			var reviewBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Review raw'));
			var rawBox = null;
			reviewBtn.addEventListener('click', function () {
				if (rawBox) { card.removeChild(rawBox); rawBox = null; return; }
				rawBox = E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.8em;background:#f6f6f6;padding:.4em' }, r.raw || r.strategy || '');
				card.appendChild(rawBox);
			});
			var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Save to Draft'));
			saveBtn.addEventListener('click', function () {
				saveBtn.disabled = true;
				var name = 'blockcheck ' + (r.domain || '?') + ' ' + (r.test || '').replace('curl_test_', '');
				callProfilesCreate(JSON.stringify({ name: name, opt: r.strategy || '' })).then(function (res) {
					res = res || {};
					if (res.ok === true) {
						saveBtn.textContent = _('Saved as ') + res.id;
					} else {
						saveBtn.disabled = false;
						self._flash = _('Save to Draft failed: ') + ((res.error && res.error.message) || res.error || _('unknown'));
						self.refresh();
					}
				}).catch(function (err) {
					saveBtn.disabled = false;
					self._flash = _('Save call failed: ') + String(err);
					self.refresh();
				});
			});
			card.appendChild(E('div', { 'class': 'cbi-button-row' }, [reviewBtn, saveBtn]));
			node.appendChild(card);
		});
		return node;
	},

	// poll while a job is active (2s) — elapsed/log tail stay honest
	schedulePoll: function (job) {
		var self = this;
		if (this._polled || !job || isTerminal(job.status)) return;
		this._polled = true;
		setInterval(function () {
			callBlockcheckStatus().then(function (res) {
				self._polled = false;
				self.refresh();
			}).catch(function () { self._polled = false; });
		}, 2000);
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
