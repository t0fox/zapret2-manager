'use strict';
'require rpc';

/* Orchestra UI only. Transactional run/apply semantics remain in the backend. */
const capsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
const adaptiveRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_status', reject: true });
const legacyEventsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_events', reject: true });
const legacyHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_history', reject: true });
const legacyRatingsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_ratings_get', reject: true });
const historyRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });
const runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const runStartRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const runPauseRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_pause', reject: true });
const runResumeRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_resume', reject: true });
const runStopRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_preview_best', params: ['edit'], reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_best', params: ['edit'], reject: true });
const applyStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_status', params: ['edit'], reject: true });
const restoreRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_restore_previous', params: ['edit'], reject: true });

function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pack(v) { try { return JSON.stringify(v || {}); } catch (e) { return '{}'; } }
function structuredError(e) {
	if (!e) return _('Unknown error');
	if (typeof e === 'string') return e;
	if (e.error) return structuredError(e.error);
	if (e.code && e.message) return e.code + ': ' + e.message;
	if (e.message) return e.message;
	try { return JSON.stringify(e); } catch (x) { return String(e); }
}
function rpcCall(fn, arg) { return fn(arg).catch(function (e) { throw new Error(structuredError(e)); }); }
function terminalRun(p) { return ['completed', 'failed', 'stopped', 'interrupted'].indexOf(p) >= 0; }
function terminalApply(p) { return ['applied', 'failed', 'rolled-back', 'restored'].indexOf(p) >= 0; }
function injectCSS() {
	if (!document || !document.createElement || !document.head || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link'); link.id = 'z2m-ui-css'; link.rel = 'stylesheet'; link.href = L.resource('view/zapret2-manager/z2m-ui.css'); document.head.appendChild(link);
}
function badge(value, kind) { return E('span', { 'class': 'z2m-badge z2m-badge-' + (kind || 'neutral') }, esc(value)); }
function kv(label, value) { return E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, esc(label)), E('span', { 'class': 'z2m-kv-value' }, typeof value === 'object' ? value : esc(value))]); }
function alertBox(message, kind) { return E('div', { 'class': 'z2m-callout z2m-callout-' + (kind || 'bad') }, esc(message)); }
function btn(label, onClick, disabled, cls) { var b = E('button', { 'type': 'button', 'class': 'cbi-button ' + (cls || 'cbi-button-neutral'), 'disabled': !!disabled }, esc(label)); b.addEventListener('click', function () { onClick(b); }); return b; }
function heading(title, id, note) { return E('div', { 'class': 'z2m-orchestra-heading' }, [E('h3', { 'id': id }, esc(title)), note ? E('p', {}, esc(note)) : E('span', {})]); }
function section(title, id, body, note) { return E('section', { 'class': 'z2m-orchestra-section', 'aria-labelledby': id }, [heading(title, id, note), body]); }
function details(title, body) { return E('details', { 'class': 'z2m-orchestra-details' }, [E('summary', {}, esc(title)), body]); }

return L.view.extend({
	title: _('Orchestra'),
	_poll: null,
	_polling: false,
	_state: { history: [], run: null, selectedRunId: null, protocol: null, adaptive: null, caps: null, legacyEvents: null, legacyHistory: null, legacyRatings: null, preview: null, operation: null, error: null },

	load: function () {
		var self = this;
		function get(fn, arg) { return rpcCall(fn, arg).then(function (v) { return v || {}; }).catch(function (e) { return { _error: structuredError(e) }; }); }
		return Promise.all([get(capsRpc), get(adaptiveRpc), get(historyRpc), get(legacyEventsRpc), get(legacyHistoryRpc), get(legacyRatingsRpc), get(runStatusRpc, pack({}))]).then(function (a) {
			self._state.caps = a[0]._error ? null : a[0]; self._state.adaptive = a[1]._error ? null : a[1];
			self._state.history = a[2].runs || []; self._state.legacyEvents = a[3]; self._state.legacyHistory = a[4]; self._state.legacyRatings = a[5];
			if (a[6].run) self._state.run = a[6].run;
			self._state.selectedRunId = self._state.run && self._state.run.runId || (self._state.history[0] && self._state.history[0].runId) || null;
			self._state.protocol = self._preferredProtocol(self._state.run || self._state.history[0]);
			self._state.error = a[0]._error ? _('Capabilities unavailable: ') + a[0]._error : null;
			if (self._state.selectedRunId && (!self._state.run || self._state.run.runId !== self._state.selectedRunId)) return rpcCall(runStatusRpc, pack({ runId: self._state.selectedRunId })).then(function (x) { self._state.run = x.run || null; return self._state; }).catch(function () { return self._state; });
			return self._state;
		});
	},

	_preferredProtocol: function (run) { var ps = run && run.protocols || []; return ps.indexOf('tcp_https') >= 0 ? 'tcp_https' : ps[0] || 'tcp_https'; },
	_protocolLabel: function (p) { return p === 'quic_udp' ? 'QUIC / UDP' : p === 'tcp_https' ? 'HTTPS / TCP' : p || _('Unknown protocol'); },
	_short: function (v, n) { v = String(v || ''); return v.length > (n || 28) ? v.slice(0, n || 28) + '…' : v; },

	render: function (state) {
		injectCSS(); this._state = state || this._state;
		var self = this, root = E('div', { 'class': 'z2m-page z2m-orchestra', 'id': 'z2m-orchestra-page' });
		root.appendChild(E('div', { 'class': 'z2m-page-header z2m-orchestra-header' }, [E('h2', {}, _('Orchestra')), E('p', {}, _('Find, compare and safely apply a verified strategy.'))]));
		root.appendChild(E('nav', { 'class': 'z2m-tabs z2m-orchestra-nav', 'aria-label': _('Orchestra sections') }, [
			E('a', { 'class': 'z2m-tab z2m-tab-active', 'href': '#orchestra-find' }, _('Find strategy')),
			E('a', { 'class': 'z2m-tab', 'href': '#orchestra-results' }, _('Runs & results')),
			E('a', { 'class': 'z2m-tab', 'href': '#orchestra-adaptive' }, _('Adaptive engine'))
		]));
		var content = E('div', { 'class': 'z2m-orchestra-content' }); root.appendChild(content); this._renderContent(content);
		this._startPolling();
		if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', function () { self._stopPolling(); }, { once: true });
		return root;
	},

	_renderContent: function (content) {
		if (content.replaceChildren) content.replaceChildren(); else if (content.firstChild) while (content.firstChild) content.removeChild(content.firstChild); else content.children.length = 0;
		content.appendChild(this._findSection()); content.appendChild(this._resultsSection()); content.appendChild(this._adaptiveSection());
		if (this._state.error) content.appendChild(alertBox(this._state.error));
	},

	_findSection: function () {
		var self = this, s = this._state, run = s.run || {}, active = !!run && !terminalRun(run.phase), form = E('div', { 'class': 'z2m-orchestra-find-panel' });
		var fields = E('div', { 'class': 'z2m-orchestra-fields' });
		function field(label, input, hint) { return E('label', { 'class': 'z2m-orchestra-field' }, [E('span', {}, esc(label)), input, E('small', {}, esc(hint))]); }
		var domain = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-domain', 'type': 'text', 'value': run.target || 'youtube.com', 'placeholder': 'youtube.com' });
		var mode = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-orchestra-mode' }, ['recommended', 'all', 'zapret2gui-only'].map(function (v) { return E('option', { 'value': v, 'selected': (run.candidateMode || 'recommended') === v }, esc(v)); }));
		var repeats = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '3', 'value': run.repeats || 2 });
		var timeout = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '120', 'value': run.perAttemptTimeoutSec || 20 });
		var total = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '20', 'max': '1800', 'value': run.totalTimeoutSec || 600 });
		fields.appendChild(field(_('Target domain'), domain, _('Hostname to test'))); fields.appendChild(field(_('Candidate set'), mode, _('Trusted catalog only'))); fields.appendChild(field(_('Repeats'), repeats, _('1–3 attempts'))); fields.appendChild(field(_('Attempt timeout'), timeout, _('Seconds per attempt'))); fields.appendChild(field(_('Run timeout'), total, _('Maximum total seconds'))); form.appendChild(fields);
		var actions = E('div', { 'class': 'z2m-actions z2m-orchestra-actions' });
		function start(b) { var payload = { targetType: 'domain', domain: domain.value.trim(), protocols: ['tcp_https', 'quic_udp'], candidateMode: mode.value, repeats: +repeats.value, perAttemptTimeoutSec: +timeout.value, totalTimeoutSec: +total.value }; self._busy(b, _('Starting…')); rpcCall(runStartRpc, pack(payload)).then(function (x) { self._state.run = x.run; self._state.selectedRunId = x.run && x.run.runId; self._state.protocol = self._preferredProtocol(x.run); self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Start')); self._refresh(); }); }
		actions.appendChild(btn(_('Start'), start, active, 'cbi-button-action'));
		actions.appendChild(btn(_('Pause'), function (b) { self._action(b, runPauseRpc, _('Pause')); }, !active || run.phase === 'paused'));
		actions.appendChild(btn(_('Resume'), function (b) { self._action(b, runResumeRpc, _('Resume')); }, !active || run.phase !== 'paused'));
		actions.appendChild(btn(_('Stop'), function (b) { self._action(b, runStopRpc, _('Stop')); }, !active, 'cbi-button-negative')); form.appendChild(actions);
		if (active) form.appendChild(this._liveProgress(run));
		return section(_('Find strategy'), 'orchestra-find', form, _('Run a bounded search against the trusted strategy catalog.'));
	},

	_liveProgress: function (run) { var p = Math.max(0, Math.min(100, +(run.progress || 0))), live = E('div', { 'class': 'z2m-orchestra-live' }, [E('div', { 'class': 'z2m-orchestra-live-top' }, [badge(run.phase || 'queued', 'warn'), E('span', {}, esc((run.completedCount || 0) + (run.totalCount ? ' / ' + run.totalCount : '') + ' attempts'))]), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(p), 'max': '100' }), kv(_('Current attempt'), (run.currentCandidate ? this._short(run.currentCandidate, 24) : _('Preparing')) + (run.currentAttempt ? ' · #' + run.currentAttempt : ''))]); if (run.error) live.appendChild(alertBox(structuredError(run.error))); if (run.events && run.events.length) live.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, run.events.slice(-6).map(function (e) { return (e.phase || '') + ': ' + (e.message || ''); }).join('\n'))); return live; },

	_resultsSection: function () {
		var self = this, s = this._state, selected = s.run && s.run.runId === s.selectedRunId ? s.run : null, body = E('div', { 'class': 'z2m-orchestra-results-layout' });
		var list = E('div', { 'class': 'z2m-orchestra-run-list', 'role': 'listbox', 'aria-label': _('Runs') });
		if (!(s.history || []).length) list.appendChild(E('div', { 'class': 'z2m-empty' }, _('No runs yet.')));
		(s.history || []).forEach(function (r) { var isSelected = r.runId === s.selectedRunId, item = E('button', { 'type': 'button', 'class': 'z2m-orchestra-run-item' + (isSelected ? ' is-selected' : ''), 'role': 'option', 'aria-selected': String(isSelected) }, [E('strong', {}, esc(r.target || _('Unknown target'))), E('span', {}, [badge(r.phase || 'unknown', r.phase === 'completed' || r.phase === 'applied' ? 'ok' : 'neutral'), E('small', {}, esc(r.winnerCandidateId ? _('Winner confirmed') : _('No winner')))])]); item.addEventListener('click', function () { self._selectRun(r.runId); }); list.appendChild(item); });
		body.appendChild(E('aside', { 'class': 'z2m-orchestra-master' }, [E('div', { 'class': 'z2m-orchestra-master-title' }, [E('strong', {}, _('Runs')), E('span', {}, esc(String((s.history || []).length))) ]), list]));
		body.appendChild(E('div', { 'class': 'z2m-orchestra-detail' }, selected ? this._runDetail(selected) : E('div', { 'class': 'z2m-empty' }, _('Select a run to inspect its ranking.'))));
		return section(_('Runs & results'), 'orchestra-results', body, _('Select one run; details and ranking stay scoped to its target.'));
	},

	_runDetail: function (run) {
		var self = this, s = this._state, protocol = s.protocol || this._preferredProtocol(run), protocols = run.protocols || [protocol], body = E('div', { 'class': 'z2m-orchestra-run-detail' });
		var top = E('div', { 'class': 'z2m-orchestra-detail-top' }, [E('div', {}, [E('h4', {}, esc(run.target || _('Unknown target'))), E('p', {}, esc(_('Only this domain and selected protocol are shown.')))]), E('select', { 'class': 'cbi-input-select', 'aria-label': _('Ranking protocol') }, protocols.map(function (p) { return E('option', { 'value': p, 'selected': p === protocol }, esc(self._protocolLabel(p))); }))]);
		var select = top.querySelector('select'); if (select) select.addEventListener('change', function () { self._state.protocol = select.value; self._state.preview = null; self._refresh(); }); body.appendChild(top);
		body.appendChild(this._rankingTable(run, protocol));
		if (s.preview && s.preview.runId === run.runId) body.appendChild(this._previewCard());
		if (s.operation && s.operation.runId === run.runId) body.appendChild(this._operationCard());
		var raw = { runId: run.runId, candidateIds: run.candidateIds, protocols: run.protocols, results: run.results, rankedResults: run.rankedResults }; body.appendChild(details(_('Technical details'), E('pre', { 'class': 'z2m-mono' }, esc(pack(raw)))));
		return body;
	},

	_rankingTable: function (run, protocol) {
		var self = this, rows = E('tbody', {}), ranked = run.rankedResults || [];
		if (!ranked.length) return E('div', { 'class': 'z2m-empty' }, terminalRun(run.phase) ? _('No ranked results for this run.') : _('Ranking will appear when the run completes.'));
		ranked.forEach(function (candidate, index) { var evidence = (candidate.evidence || []).filter(function (e) { return e.protocol === protocol; }), attempts = evidence.length || (candidate.supportedProtocols && candidate.supportedProtocols.indexOf(protocol) >= 0 ? candidate.attemptCount || 0 : 0), passes = evidence.filter(function (e) { return e.passed === true || e.verdict === 'pass'; }).length, stability = attempts ? passes / attempts : 0, durations = evidence.map(function (e) { return +e.durationMs || 0; }).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }), latency = durations.length ? durations[Math.floor(durations.length / 2)] : null, score = (protocol === 'tcp_https' ? 1000 : 200) + stability * 100 - (attempts - passes) * 50, winner = run.selectedWinner && run.selectedWinner.candidateId === candidate.candidateId, suitable = winner && passes > 0;
			var shortName = candidate.name || candidate.displayName || candidate.candidateId || _('Unnamed strategy'), source = candidate.source || (evidence[0] && evidence[0].source) || _('Unknown');
			var actionCell = E('td', { 'class': 'z2m-orchestra-ranking-actions' }); if (suitable) { actionCell.appendChild(btn(_('Preview'), function (b) { self._preview(run, candidate.candidateId, b); }, false)); actionCell.appendChild(btn(_('Apply'), function (b) { self._previewThenApply(run, candidate.candidateId, b); }, !!s.operation)); } else actionCell.appendChild(E('span', { 'class': 'z2m-orchestra-muted' }, winner ? _('Awaiting positive evidence') : _('Verified winner only')));
			rows.appendChild(E('tr', {}, [E('td', {}, esc('#' + (index + 1))), E('td', {}, [E('strong', {}, esc(self._short(shortName, 42))), details(_('Details'), E('div', {}, [kv(_('Candidate ID'), candidate.candidateId), kv(_('Parameters'), (evidence[0] && evidence[0].upstreamCustomInput) || candidate.opt || _('Hidden'))]))]), E('td', {}, esc(source)), E('td', {}, esc(passes + ' / ' + attempts)), E('td', {}, esc(Math.round(stability * 100) + '%')), E('td', {}, esc(latency == null ? '—' : Math.round(latency) + ' ms')), E('td', {}, esc(Math.round(score))), E('td', {}, badge(candidate.compatibilityStatus || 'compatible', candidate.compatibilityStatus === 'compatible' ? 'ok' : 'warn')), E('td', {}, winner ? badge(_('Winner'), 'ok') : ''), actionCell]));
		});
		return E('div', { 'class': 'z2m-orchestra-ranking-wrap' }, [E('div', { 'class': 'z2m-orchestra-table-caption' }, [_('Ranking · '), E('strong', {}, esc(this._protocolLabel(protocol)))]), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 'table z2m-orchestra-ranking-table' }, [E('thead', {}, E('tr', {}, ['#', 'Strategy', 'Source', 'PASS / attempts', 'Stability', 'Latency', 'Score', 'Compatibility', 'Winner', 'Actions'].map(function (h) { return E('th', {}, esc(_(h))); }))), rows]))]);
	},

	_previewCard: function () { var self = this, p = this._state.preview, box = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('div', { 'class': 'z2m-orchestra-panel-title' }, [E('h4', {}, _('Preview')), badge(_('Read-only'), 'neutral')]), kv(_('Scope'), (p.target || '') + ' · ' + this._protocolLabel(p.protocol)), kv(_('Positive evidence'), p.positiveEvidenceCount), kv(_('Change hash'), this._short(p.changeHash, 18)), E('pre', { 'class': 'z2m-mono' }, esc(p.proposedConfiguration || ''))]); box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Apply this preview'), function () { self._apply(); }, !!self._state.operation, 'cbi-button-action')])); return box; },
	_operationCard: function () { var self = this, o = this._state.operation, box = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('div', { 'class': 'z2m-orchestra-panel-title' }, [E('h4', {}, _('Apply / rollback status')), badge(o.phase || 'unknown', o.phase === 'applied' ? 'ok' : terminalApply(o.phase) ? 'bad' : 'warn')]), kv(_('State'), o.phase || _('Unknown'))]); if (o.events && o.events.length) box.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, o.events.map(function (e) { return e.phase + ': ' + e.message; }).join('\n'))); if (o.error) box.appendChild(alertBox(structuredError(o.error))); if (o.phase === 'applied') box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Restore previous'), function (b) { self._restore(b); }, false, 'cbi-button-negative')])); box.appendChild(details(_('Operation details'), E('pre', { 'class': 'z2m-mono' }, esc(pack(o))))); return box; },

	_adaptiveSection: function () { var s = this._state, a = s.adaptive || {}, caps = s.caps || {}, body = E('div', { 'class': 'z2m-orchestra-adaptive' });
		if (a._error) body.appendChild(alertBox(a._error)); else { var engine = a.engine || a.engineInArgv || {}, raw = a.autohostlistRaw || a.autohostlist || {}; body.appendChild(E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('State'), badge(a.adaptiveState || _('Unknown'), a.adaptiveState === 'active' ? 'ok' : 'neutral')), kv(_('nfqws2'), a.daemonRunning ? _('Running') + (a.daemonPid ? ' · PID ' + a.daemonPid : '') : _('Not running')), kv(_('zapret-auto.lua'), engine.auto ? _('loaded') : _('not loaded')), kv(_('lua_compat_ver'), a.luaCompatVer == null ? _('Unavailable') : a.luaCompatVer), kv(_('Diagnostics'), a.diagnosticsAvailable ? _('Available') : _('Off'))]));
			var rows = []; Object.keys(raw).forEach(function (k) { rows.push(kv(k, raw[k])); }); if (caps.totalCandidates != null) rows.push(kv(_('Trusted candidates'), caps.totalCandidates)); (caps.matrix || []).forEach(function (v) { rows.push(kv(v.capability || _('Capability'), v.available === true ? _('available') : _('unavailable'))); if (v.reason) rows.push(E('div', { 'class': 'cbi-value-description' }, esc(v.reason))); }); if (rows.length) body.appendChild(details(_('Applied adaptive configuration'), E('div', {}, rows))); if (caps.matrix && caps.matrix.length) body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('IN-PROCESS MEMORY ONLY; preload APIs do NOT exist in the pinned upstream.'))); body.appendChild(this._confirmedWinners()); }
		if (s.legacyHistory && s.legacyHistory.available === false) body.appendChild(alertBox((s.legacyHistory.reason || '') + ' ' + ((s.legacyHistory.evidence || []).join('; ')) + ' ' + (s.legacyHistory.upstreamVersion || ''), 'info'));
		if (s.legacyEvents && s.legacyEvents.available === false) body.appendChild(alertBox(s.legacyEvents.reason || _('Events unavailable'), 'info'));
		return section(_('Adaptive engine'), 'orchestra-adaptive', body, _('Live state and confirmed winners only; no synthetic controls.'));
	},
	_confirmedWinners: function () { var rows = (this._state.history || []).filter(function (r) { return r.winnerCandidateId; }).map(function (r) { return E('tr', {}, [E('td', {}, esc(r.target || '—')), E('td', {}, esc((r.protocols || []).map(function (p) { return p === 'tcp_https' ? 'HTTPS' : 'QUIC'; }).join(' · '))), E('td', {}, esc(r.winnerCandidateId)), E('td', {}, badge(_('Confirmed'), 'ok'))]); }); if (!rows.length) return E('div', { 'class': 'z2m-empty' }, _('No confirmed winner per domain and protocol yet.')); return E('div', { 'class': 'z2m-orchestra-confirmed' }, [E('h4', {}, _('Best confirmed strategies')), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 'table' }, [E('thead', {}, E('tr', {}, ['Domain', 'Protocol', 'Strategy', 'Status'].map(function (h) { return E('th', {}, esc(_(h))); }))), E('tbody', {}, rows)]))]); },

	_selectRun: function (id) { var self = this; this._state.selectedRunId = id; this._state.preview = null; this._state.operation = null; this._state.error = null; this._refresh(); rpcCall(runStatusRpc, pack({ runId: id })).then(function (x) { self._state.run = x.run || null; self._state.protocol = self._preferredProtocol(self._state.run); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); }); },
	_preview: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Preview'), true); self._refresh(); }); },
	_previewThenApply: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._apply(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Apply'), true); self._refresh(); }); },
	_apply: function () { var self = this, p = this._state.preview; if (!p) return; rpcCall(applyRpc, pack({ runId: p.runId, candidateId: p.candidateId, changeHash: p.changeHash, idempotencyToken: 'ui-' + Date.now().toString(36) })).then(function (x) { self._state.operation = { operationId: x.operationId, runId: x.runId || p.runId, phase: x.phase, events: [] }; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); }); },
	_restore: function (b) { var self = this, o = this._state.operation; this._busy(b, _('Restoring…')); rpcCall(restoreRpc, pack({ operationId: o.operationId })).then(function (x) { self._state.operation = Object.assign({}, o, x); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Restore previous'), true); self._refresh(); }); },
	_action: function (b, fn, label) { var self = this; this._busy(b, label + '…'); rpcCall(fn).then(function (x) { if (x && x.run) self._state.run = x.run; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, label, true); self._refresh(); }); },
	_busy: function (b, label, done) { if (!b) return; b.disabled = !done; b.setAttribute('aria-busy', done ? 'false' : 'true'); b.textContent = label; },
	_refresh: function () { var root = document.getElementById('z2m-orchestra-page'), content = root && root.querySelector('.z2m-orchestra-content'); if (content) this._renderContent(content); },
	_startPolling: function () { var self = this; if (this._polling) return; this._polling = true; this._poll = setInterval(function () { var r = self._state.run, o = self._state.operation; if (r && !terminalRun(r.phase)) rpcCall(runStatusRpc, pack({ runId: r.runId })).then(function (x) { if (x.run) self._state.run = x.run; self._refresh(); }).catch(function () {}); if (o && !terminalApply(o.phase)) rpcCall(applyStatusRpc, pack({ operationId: o.operationId })).then(function (x) { if (x.operation) self._state.operation = x.operation; self._refresh(); }).catch(function () {}); if ((!r || terminalRun(r.phase)) && (!o || terminalApply(o.phase))) self._stopPolling(); }, 2000); },
	_stopPolling: function () { if (this._poll) clearInterval(this._poll); this._poll = null; this._polling = false; },
	handleSaveApply: null, handleSave: null, handleReset: null
});
