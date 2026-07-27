'use strict';

// Blockcheck page — drive the engine's blockcheck2 runs and show results.
//
// Backend reality (verified on the router): the blockcheck job state machine
// exists only as a reference (tests/lib/jobs-logic.mjs); NO ubus methods are
// registered for it yet. Therefore:
//   - Start / Cancel render DISABLED with the exact method names they wait for
//     (no fake runs, no simulated progress).
//   - The generic job list from the status contract (status.jobs) IS rendered
//     when the backend populates it.
//   - A job without a backend progress field shows elapsed time and an
//     indeterminate state — never a timer-faked percentage.
//
// State machine (tests/lib/jobs-logic.mjs, mirrored by the future ucode):
//   queued → running → succeeded | failed
//          ↘ cancelled (cancel is real: the process is killed)
// At most ONE blockcheck job runs at a time — the backend refuses a second;
// the UI start button is single-shot disabled while a call is in flight.

'require rpc';

// reject: true — a ubus error must reject into .catch(); the default
// (reject:false) would resolve it as a numeric code and fake a healthy load.
const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });

const MISSING_METHODS = ['blockcheck_start', 'blockcheck_status', 'blockcheck_cancel'];

const MODES = [
	{ id: 'quick', label: _('quick'), hint: _('short connectivity probe') },
	{ id: 'domains', label: _('domains'), hint: _('per-domain scan — expect 15–40 minutes') },
	{ id: 'full', label: _('full'), hint: _('full strategy sweep — expect 30–45 minutes') }
];

const STATES = ['queued', 'running', 'cancelling', 'cancelled', 'succeeded', 'failed'];

function fmtElapsed(fromIso) {
	var t = Date.parse(fromIso || '');
	if (isNaN(t)) return null;
	var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
	var m = Math.floor(s / 60);
	return m > 0 ? (m + 'm ' + (s % 60) + 's') : (s + 's');
}

return L.view.extend({
	title: _('Blockcheck'),

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
		var statusError = envelope.loadError || data.error || null;
		var jobs = (data && data.jobs) || [];

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Blockcheck')),
			E('div', { 'class': 'cbi-value-description' },
				_('Runs the engine\'s blockcheck2 against test domains and reports which strategies pass. Long-running: the page polls job state instead of blocking.'))
		]);

		if (statusError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Status unavailable: ') + statusError)));
		}

		container.appendChild(this.modeSection());
		container.appendChild(this.stateMachineSection());
		container.appendChild(this.currentJobSection(jobs, statusError));
		container.appendChild(this.actionsSection(jobs));
		container.appendChild(this.resultsSection());

		return container;
	},

	modeSection: function () {
		var rows = MODES.map(function (m) {
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, m.label),
				E('div', { 'class': 'cbi-value-field' }, m.hint)
			]);
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Modes')),
			E('div', { 'class': 'cbi-value-description' },
				_('Tested domains come from the backend domain set when the run methods exist. Mode selection is disabled until then.')),
			E('div', {}, rows),
			E('textarea', { 'class': 'cbi-input-textarea', 'disabled': 'disabled',
				'style': 'width:100%;min-height:80px;font-family:monospace',
				'placeholder': _('Domains to test — requires backend method blockcheck_start') }, '')
		]);
	},

	stateMachineSection: function () {
		var badges = STATES.map(function (s) {
			var cls = (s === 'succeeded') ? 'ok' : ((s === 'failed' || s === 'cancelled') ? 'bad' : 'warn');
			return E('span', { 'class': 'zonebadge ' + cls, 'style': 'margin-right:.4em' }, s);
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Job state machine')),
			E('div', {}, badges),
			E('div', { 'class': 'cbi-value-description' },
				_('queued → running → succeeded/failed; any non-terminal state → cancelling → cancelled. Transitions are forward-only. At most one blockcheck job runs at a time (the backend refuses a second).'))
		]);
	},

	currentJobSection: function (jobs, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Current job'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		var active = jobs.filter(function (j) { return j.status === 'pending' || j.status === 'running'; });
		if (!active.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				jobs.length ? _('No active job. Recent jobs are listed below.') : _('No jobs reported by the backend yet.')));
		} else {
			var j = active[0];
			var elapsedHost = E('span', {}, _('n/a'));
			var from = j.updatedAt || j.createdAt;
			var tick = function () {
				var e = fmtElapsed(from);
				elapsedHost.textContent = e || _('n/a');
				if (!document.body.contains(elapsedHost)) clearInterval(timer);
			};
			var timer = setInterval(tick, 1000);
			tick();
			node.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Job ') + (j.id || '')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'zonebadge warn' }, j.status || _('unknown')), ' ',
					_('elapsed: '), elapsedHost
				])
			]));
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('The backend does not report a progress percentage — the state above is indeterminate by design and the elapsed time is the honest signal.')));
		}

		if (jobs.length) {
			var rows = jobs.map(function (j) {
				return E('tr', {}, [
					E('td', {}, j.id || _('n/a')),
					E('td', {}, j.status || _('n/a')),
					E('td', {}, j.createdAt || _('Unavailable')),
					E('td', {}, j.updatedAt || _('Unavailable'))
				]);
			});
			node.appendChild(E('h4', {}, _('Recent jobs')));
			node.appendChild(E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('ID')), E('th', {}, _('Status')),
					E('th', {}, _('Created')), E('th', {}, _('Updated'))])
			].concat(rows)));
		}
		return node;
	},

	actionsSection: function (jobs) {
		var startBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Start blockcheck'));
		var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Cancel'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Run control')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [startBtn, cancelBtn]),
			E('div', { 'class': 'cbi-value-description' },
				_('Start and Cancel require backend methods that are not registered yet: ') +
				MISSING_METHODS.join(', ') +
				_('. When they exist, Start refuses while another job is non-terminal (at-most-one) and Cancel kills the running process.'))
		]);
	},

	resultsSection: function () {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Log tail & recommendations')),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — the last log lines and the found strategy recommendations are part of the job result, which requires backend method blockcheck_status.'))
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
