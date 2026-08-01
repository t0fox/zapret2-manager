'use strict';
'require rpc';

/* Orchestra is deliberately an adapter over the transactional RPC contract.
 * It owns no strategy or Apply semantics; it only presents the workflow. */
const callCaps = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
const callAdaptive = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_status', reject: true });
const callLegacyEvents = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_events', reject: true });
const callLegacyHistory = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_history', reject: true });
const callLegacyRatings = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_ratings_get', reject: true });
const callRunHistory = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });
const callRunStatus = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const callRunEvents = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_events', params: ['edit'], reject: true });
const callRunStart = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const callRunPause = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_pause', reject: true });
const callRunResume = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_resume', reject: true });
const callRunStop = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_stop', reject: true });
const callPreview = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_preview_best', params: ['edit'], reject: true });
const callApply = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_best', params: ['edit'], reject: true });
const callApplyStatus = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_status', params: ['edit'], reject: true });
const callApplyEvents = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_events', params: ['edit'], reject: true });
const callRestore = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_restore_previous', params: ['edit'], reject: true });

function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function json(v) { try { return JSON.stringify(v || {}); } catch (e) { return '{}'; } }
function errorText(e) {
	if (!e) return _('Unknown error');
	if (typeof e === 'string') return e;
	if (e.message) return e.code ? e.code + ': ' + e.message : e.message;
	if (e.error) return errorText(e.error);
	try { return JSON.stringify(e); } catch (x) { return String(e); }
}
function call(fn, value) { return fn(value).catch(function (e) { throw new Error(errorText(e)); }); }
function injectCSS() {
	if (!document || !document.createElement || !document.head || document.getElementById('z2m-ui-css')) return;
	var l = document.createElement('link'); l.id = 'z2m-ui-css'; l.rel = 'stylesheet'; l.href = L.resource('view/zapret2-manager/z2m-ui.css'); document.head.appendChild(l);
}
function terminalRun(p) { return ['completed', 'failed', 'stopped'].indexOf(p) >= 0; }
function terminalApply(p) { return ['applied', 'failed', 'rolled-back', 'restored'].indexOf(p) >= 0; }
function textNode(t) { return E('span', {}, esc(t)); }
function kv(k, v) { return E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, esc(k)), E('span', { 'class': 'z2m-kv-value' }, typeof v === 'object' ? v : esc(v))]); }
function badge(t, kind) { return E('span', { 'class': 'z2m-badge z2m-badge-' + (kind || 'neutral') }, esc(t)); }
function button(label, fn, disabled, cls) { var b = E('button', { 'class': 'cbi-button ' + (cls || 'cbi-button-neutral'), 'type': 'button', 'disabled': !!disabled }, esc(label)); b.addEventListener('click', fn); return b; }
function alertBox(message, kind) { return E('div', { 'class': 'z2m-callout z2m-callout-' + (kind || 'bad') }, esc(message)); }
function section(title, body) { return E('section', { 'class': 'z2m-section-block z2m-orchestra-section' }, [E('h3', {}, esc(title)), body]); }

return L.view.extend({
	title: _('Orchestra'),
	_polling: false,
	_poll: null,
	_state: { run: null, history: [], preview: null, operation: null, adaptive: null, caps: null, legacyEvents: null, legacyHistory: null, legacyRatings: null, error: null },

	load: function () {
		var self = this, get = function (fn, arg) { return call(fn, arg).then(function (v) { return v || {}; }).catch(function (e) { return { _error: errorText(e) }; }); };
		return Promise.all([get(callCaps), get(callAdaptive), get(callRunHistory), get(callLegacyEvents), get(callLegacyHistory), get(callLegacyRatings), get(callRunStatus, json({}))]).then(function (a) {
			self._state.caps = a[0]._error ? null : a[0]; self._state.adaptive = a[1]._error ? null : a[1];
			self._state.history = a[2].runs || [];
			self._state.legacyEvents = a[3]; self._state.legacyHistory = a[4]; self._state.legacyRatings = a[5];
			if (a[6].run) self._state.run = a[6].run;
			self._state.capError = a[0]._error || null; self._state.error = a[0]._error ? _('Capabilities unavailable: ') + a[0]._error : null;
			return self._state;
		});
	},

	render: function (state) {
		injectCSS(); this._state = state || this._state; this._state.run = this._state.run || null;
		var self = this, root = E('div', { 'class': 'z2m-page z2m-orchestra', 'id': 'z2m-orchestra-page' });
		root.appendChild(E('div', { 'class': 'z2m-page-header' }, [E('h2', {}, _('Orchestra')), E('p', {}, _('Find, compare and safely apply a verified strategy.'))]));
		var content = E('div', { 'class': 'z2m-orchestra-content' }); root.appendChild(content);
		this._renderContent(content);
		this._startPolling();
		if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', function () { self._stopPolling(); }, { once: true });
		return root;
	},

	_renderContent: function (content) {
		var self = this, s = this._state;
		if (content.replaceChildren) content.replaceChildren(); else if (content.firstChild) while (content.firstChild) content.removeChild(content.firstChild); else content.children.length = 0;
		content.appendChild(this._findSection()); content.appendChild(this._resultsSection()); content.appendChild(this._adaptiveSection());
		if (s.error) content.appendChild(alertBox(s.error));
	},

	_findSection: function () {
		var self = this, s = this._state, r = s.run || {}, form = E('div', { 'class': 'z2m-orchestra-form z2m-card' });
		form.appendChild(E('h4', {}, _('Run parameters')));
		var domain = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-domain', 'type': 'text', 'value': r.target || 'youtube.com', 'placeholder': 'youtube.com' });
		var repeats = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-repeats', 'type': 'number', 'min': '1', 'max': '3', 'value': r.repeats || 2 });
		var timeout = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-timeout', 'type': 'number', 'min': '1', 'max': '120', 'value': r.perAttemptTimeoutSec || 20 });
		var total = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-total-timeout', 'type': 'number', 'min': '20', 'max': '1800', 'value': r.totalTimeoutSec || 600 });
		var mode = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-orchestra-mode' }, ['recommended', 'all', 'zapret2gui-only'].map(function (v) { return E('option', { 'value': v, 'selected': (r.candidateMode || 'recommended') === v }, esc(v)); }));
		form.appendChild(kv(_('Target domain'), domain)); form.appendChild(kv(_('Candidate set'), mode)); form.appendChild(kv(_('Repeats'), repeats)); form.appendChild(kv(_('Per-attempt timeout (s)'), timeout)); form.appendChild(kv(_('Total timeout (s)'), total));
		var active = !!s.run && !terminalRun(s.run.phase), actions = E('div', { 'class': 'z2m-actions' });
		function start() { var p = { targetType: 'domain', domain: domain.value.trim(), protocols: ['tcp_https', 'quic_udp'], candidateMode: mode.value, repeats: +repeats.value, perAttemptTimeoutSec: +timeout.value, totalTimeoutSec: +total.value }; self._busy(actions, true); call(callRunStart, json(p)).then(function (x) { self._state.run = x.run; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._busy(actions, false); self._refresh(); }); }
		actions.appendChild(button(_('Start'), start, active, 'cbi-button-action'));
		actions.appendChild(button(_('Pause'), function () { self._runAction(callRunPause); }, !active || s.run.phase === 'paused'));
		actions.appendChild(button(_('Resume'), function () { self._runAction(callRunResume); }, !active || s.run.phase !== 'paused'));
		actions.appendChild(button(_('Stop'), function () { self._runAction(callRunStop); }, !active, 'cbi-button-negative'));
		form.appendChild(actions);
		if (s.run) {
			var p = Math.max(0, Math.min(100, +(s.run.progress || 0))), live = E('div', { 'class': 'z2m-orchestra-live' });
			live.appendChild(kv(_('State'), badge(s.run.phase || 'unknown', terminalRun(s.run.phase) ? 'neutral' : 'warn')));
			live.appendChild(kv(_('Progress'), p + '%')); live.appendChild(E('progress', { 'value': String(p), 'max': '100', 'class': 'z2m-orchestra-progress' }));
			live.appendChild(kv(_('Current attempt'), (s.run.currentCandidate || _('None')) + (s.run.currentAttempt ? ' · #' + s.run.currentAttempt : '')));
			if (s.run.error) live.appendChild(alertBox(errorText(s.run.error)));
			if (s.run.events && s.run.events.length) live.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, s.run.events.slice(-8).map(function (e) { return (e.phase || '') + ': ' + (e.message || ''); }).join('\n')));
			form.appendChild(live);
		}
		return section(_('Find strategy'), form);
	},

	_resultsSection: function () {
		var self = this, s = this._state, body = E('div', { 'class': 'z2m-orchestra-results' }), rows = s.history || [];
		if (!rows.length) body.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — no runs yet. Start a strategy search to build history.')));
		else rows.forEach(function (r) { var card = E('div', { 'class': 'z2m-card z2m-orchestra-run' }, [E('h4', {}, esc(r.target || r.runId)), kv(_('Run'), r.runId), kv(_('State'), badge(r.phase || 'unknown', r.phase === 'completed' ? 'ok' : 'neutral')), kv(_('Progress'), (r.completedCount || 0) + (r.totalCount ? ' / ' + r.totalCount : '')), kv(_('Winner'), r.winnerCandidateId || _('None'))]); card.appendChild(E('div', { 'class': 'z2m-actions' }, [button(_('Load results'), function () { self._loadRun(r.runId); }, false)])); body.appendChild(card); });
		var run = s.run, ranked = run && run.rankedResults || [];
		if (run && ranked.length) {
			body.appendChild(E('h4', {}, _('Ranking and evidence')));
			ranked.forEach(function (x, i) { var card = E('div', { 'class': 'z2m-card z2m-orchestra-ranking' }, [kv('#' + (i + 1), x.displayName || x.name || x.candidateId), kv(_('Score'), x.score), kv(_('Evidence'), (x.successCount || 0) + ' / ' + (x.attemptCount || 0)), kv(_('Protocols'), (x.passedProtocols || []).join(', ') || _('None'))]); if (run.selectedWinner && run.selectedWinner.candidateId === x.candidateId) card.appendChild(badge(_('Winner'), 'ok')); body.appendChild(card); });
			var actions = E('div', { 'class': 'z2m-actions' }); actions.appendChild(button(_('Preview best'), function () { self._preview(run); }, false, 'cbi-button-action')); if (s.preview) actions.appendChild(button(_('Apply best'), function () { self._apply(); }, !!s.operation, 'cbi-button-action')); body.appendChild(actions);
		}
		if (s.preview) body.appendChild(this._previewCard());
		if (s.operation) body.appendChild(this._operationCard());
		return section(_('Runs & results'), body);
	},

	_previewCard: function () { var p = this._state.preview, body = E('div', { 'class': 'z2m-card z2m-orchestra-preview' }, [E('h4', {}, _('Preview best')), kv(_('Candidate'), p.candidateId), kv(_('Positive evidence'), p.positiveEvidenceCount), kv(_('Change hash'), p.changeHash), kv(_('Scope'), (p.target || '') + ' · ' + (p.protocol || '')), E('pre', { 'class': 'z2m-mono' }, esc(p.proposedConfiguration || ''))]); body.appendChild(alertBox(_('Preview is read-only. Apply uses this exact change hash and will keep rollback support.'), 'info')); return body; },
	_operationCard: function () { var o = this._state.operation, body = E('div', { 'class': 'z2m-card z2m-orchestra-operation' }, [E('h4', {}, _('Apply progress')), kv(_('Operation'), o.operationId), kv(_('State'), badge(o.phase || 'unknown', terminalApply(o.phase) ? (o.phase === 'applied' ? 'ok' : 'bad') : 'warn'))]); if (o.events && o.events.length) body.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, o.events.map(function (e) { return e.phase + ': ' + e.message; }).join('\n'))); if (o.error) body.appendChild(alertBox(errorText(o.error))); if (o.phase === 'applied') body.appendChild(E('div', { 'class': 'z2m-actions' }, [button(_('Restore previous'), this._restore.bind(this), false, 'cbi-button-negative')])); return body; },

	_adaptiveSection: function () { var s = this._state, a = s.adaptive || {}, caps = s.caps || {}, body = E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Adaptive engine state'))]); if (a._error) body.appendChild(alertBox(a._error)); else { var engine = a.engine || a.engineInArgv || {}; body.appendChild(kv(_('State'), badge(a.adaptiveState || _('Unknown'), a.adaptiveState === 'active' ? 'ok' : 'neutral'))); body.appendChild(kv(_('nfqws2'), a.daemonRunning === true ? _('Running') + (a.daemonPid ? ' · PID ' + a.daemonPid : '') : _('Not running'))); body.appendChild(kv(_('zapret-auto.lua'), engine.auto ? _('loaded') : _('not loaded'))); if (a.luaCompatVer != null) body.appendChild(kv(_('lua_compat_ver'), a.luaCompatVer)); body.appendChild(kv(_('Diagnostics'), a.diagnosticsAvailable ? _('Available') : _('Off'))); var sem = a.autohostlistSemantic || {}, raw = a.autohostlist || {}; if (sem.failure && sem.failure.threshold != null) body.appendChild(kv(_('Failure threshold'), sem.failure.threshold)); if (sem.retransmission && sem.retransmission.threshold != null) body.appendChild(kv(_('Retransmission threshold'), sem.retransmission.threshold)); Object.keys(raw).forEach(function (k) { body.appendChild(kv(k, raw[k])); }); if (caps.totalCandidates != null) body.appendChild(kv(_('Trusted candidates'), caps.totalCandidates)); (a.autohostlistVars || []).forEach(function (v) { body.appendChild(kv(v.name || v.key || 'AUTOHOSTLIST', v.value)); }); (caps.matrix || []).forEach(function (v) { body.appendChild(kv(v.capability || 'capability', v.available === true ? _('available') : _('unavailable'))); if (v.reason) body.appendChild(E('div', { 'class': 'cbi-value-description' }, esc(v.reason))); }); body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Values are read-only and reflect the applied adaptive configuration. IN-PROCESS MEMORY ONLY; preload APIs do NOT exist in the pinned upstream.'))); } if (s.legacyHistory && s.legacyHistory.available === false) { body.appendChild(alertBox((s.legacyHistory.reason || '') + ' ' + ((s.legacyHistory.evidence || []).join('; ')) + ' ' + (s.legacyHistory.upstreamVersion || ''), 'info')); } if (s.legacyEvents && s.legacyEvents.available === false) body.appendChild(alertBox(s.legacyEvents.reason || _('Events unavailable'), 'info')); return section(_('Adaptive engine'), body); },

	_busy: function (node, busy) { if (!node) return; node.querySelectorAll('button').forEach(function (b) { if (busy) b.disabled = true; else b.disabled = false; b.setAttribute('aria-busy', busy ? 'true' : 'false'); }); },
	_refresh: function () { var root = document.getElementById('z2m-orchestra-page'), content = root && root.querySelector('.z2m-orchestra-content'); if (content) this._renderContent(content); },
	_runAction: function (fn) { var self = this; call(fn).then(function (x) { if (x && x.run) self._state.run = x.run; self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._refresh(); }); },
	_loadRun: function (id) { var self = this; call(callRunStatus, json({ runId: id })).then(function (x) { self._state.run = x.run; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._refresh(); }); },
	_preview: function (run) { var self = this; self._state.preview = null; call(callPreview, json({ runId: run.runId, candidateId: run.selectedWinner && run.selectedWinner.candidateId })).then(function (x) { self._state.preview = x; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._refresh(); }); },
	_apply: function () { var self = this, p = this._state.preview; if (!p) return; var payload = { runId: p.runId, candidateId: p.candidateId, changeHash: p.changeHash, idempotencyToken: 'ui-' + Date.now().toString(36) }; call(callApply, json(payload)).then(function (x) { self._state.operation = { operationId: x.operationId, phase: x.phase, events: [] }; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._refresh(); }); },
	_restore: function () { var self = this, o = this._state.operation; call(callRestore, json({ operationId: o.operationId })).then(function (x) { self._state.operation = Object.assign({}, o, x); self._refresh(); }).catch(function (e) { self._state.error = errorText(e); self._refresh(); }); },
	_startPolling: function () { var self = this; if (this._polling) return; this._polling = true; this._poll = setInterval(function () { if (!self._polling) return; var r = self._state.run, o = self._state.operation; if (r && !terminalRun(r.phase)) call(callRunStatus, json({ runId: r.runId })).then(function (x) { if (x.run) self._state.run = x.run; self._refresh(); }).catch(function () {}); if (o && !terminalApply(o.phase)) call(callApplyStatus, json({ operationId: o.operationId })).then(function (x) { if (x.operation) self._state.operation = x.operation; self._refresh(); }).catch(function () {}); if ((!r || terminalRun(r.phase)) && (!o || terminalApply(o.phase))) self._stopPolling(); }, 2000); },
	_stopPolling: function () { if (this._poll) clearInterval(this._poll); this._poll = null; this._polling = false; },
	handleSaveApply: null, handleSave: null, handleReset: null
});
