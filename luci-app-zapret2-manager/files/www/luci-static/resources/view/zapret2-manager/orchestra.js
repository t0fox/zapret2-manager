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
const runContinueRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_continue', params: ['edit'], reject: true });
const runPauseRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_pause', reject: true });
const runResumeRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_resume', reject: true });
const runStopRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_preview_best', params: ['edit'], reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_best', params: ['edit'], reject: true });
const applyStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_status', params: ['edit'], reject: true });
const restoreRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_restore_previous', params: ['edit'], reject: true });
const catalogListRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_list', reject: true });
const catalogStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_status', reject: true });
const catalogGetRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_get', params: ['edit'], reject: true });
const catalogPreviewRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_preview', params: ['edit'], reject: true });
const catalogApplyRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_apply', params: ['edit'], reject: true });
const healthGetRpc = rpc.declare({ object: 'zapret2-manager', method: 'health_matrix_get', reject: true });

function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pack(v) { try { return JSON.stringify(v || {}); } catch (e) { return '{}'; } }
function structuredError(e) {
	if (!e) return _('Unknown error');
	if (typeof e === 'string') return e;
	if (e.error) return structuredError(e.error);
	if (e.code && e.message) {
		var details = '';
		try { if (e.details && Object.keys(e.details).length) details = ' · ' + JSON.stringify(e.details); } catch (err) {}
		return e.code + ': ' + e.message + details;
	}
	if (e.message) return e.message;
	try { return JSON.stringify(e); } catch (x) { return String(e); }
}
function rpcCall(fn, arg) { return fn(arg).catch(function (e) { throw new Error(structuredError(e)); }); }
var FALLBACK_TERMINAL_PHASES = ['completed', 'applied', 'rolled-back', 'restored', 'timeout', 'timed-out', 'partial', 'infrastructure-error', 'cancelled', 'canceled', 'stopped', 'failed', 'interrupted'];
function terminalRun(p, phases) { return (phases || FALLBACK_TERMINAL_PHASES).indexOf(p) >= 0; }
function terminalApply(p) { return ['applied', 'failed', 'rolled-back', 'restored'].indexOf(p) >= 0; }
function runError(response) { return response && response.ok === false ? structuredError(response.error || response) : null; }
function runSummary(run) {
	if (!run || !run.runId) return null;
	return { runId: run.runId, createdAt: run.createdAt || null, startedAt: run.startedAt || null, finishedAt: run.finishedAt || null, phase: run.phase || null, target: run.target || null, targetType: run.targetType || null, protocols: run.protocols || [], candidateMode: run.candidateMode || null, candidateCount: run.totalCandidates || (run.candidateIds || []).length || 0, completedCount: run.completedCount || 0, totalCount: run.totalCount || null, winnerCandidateId: run.selectedWinner && run.selectedWinner.candidateId || null, winnerScore: run.selectedWinner && run.selectedWinner.score || null, appliedOperationId: run.appliedOperationId || null, errorCode: run.error && run.error.code || null };
}
function injectCSS() {
	if (!document || !document.createElement || !document.head || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link'); link.id = 'z2m-ui-css'; link.rel = 'stylesheet'; link.href = L.resource('view/zapret2-manager/z2m-ui.css'); document.head.appendChild(link);
}
function badge(value, kind) { return E('span', { 'class': 'z2m-badge z2m-badge-' + (kind || 'neutral') }, esc(value)); }
function kv(label, value) { return E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, esc(label)), E('span', { 'class': 'z2m-kv-value' }, typeof value === 'object' ? value : esc(value))]); }
function alertBox(message, kind) { return E('div', { 'class': 'z2m-callout z2m-callout-' + (kind || 'bad') }, esc(message)); }
function btn(label, onClick, disabled, cls, reason) { var attrs = { 'type': 'button', 'class': 'cbi-button ' + (cls || 'cbi-button-neutral') }; if (disabled) { attrs.disabled = true; attrs['aria-disabled'] = 'true'; if (reason) attrs.title = reason; } var b = E('button', attrs, esc(label)); b.addEventListener('click', function () { if (!b.disabled) onClick(b); }); return b; }
function heading(title, id, note) { return E('div', { 'class': 'z2m-orchestra-heading' }, [E('h3', { 'id': id }, esc(title)), note ? E('p', {}, esc(note)) : E('span', {})]); }
function section(title, id, body, note) { return E('section', { 'class': 'z2m-orchestra-section', 'aria-labelledby': id }, [heading(title, id, note), body]); }
function details(title, body) { return E('details', { 'class': 'z2m-orchestra-details' }, [E('summary', {}, esc(title)), body]); }

return L.view.extend({
	title: _('Orchestra'),
	_poll: null,
	_polling: false,
	_state: { runHistory: [], activeRun: null, selectedRun: null, selectedRunId: null, selectedByUser: false, selectedLoading: false, selectedError: null, protocol: null, adaptive: null, caps: null, legacyEvents: null, legacyHistory: null, legacyRatings: null, catalogList: null, catalogStatus: null, catalogHealth: null, catalogError: null, preview: null, operation: null, error: null },
	_panel: 'orchestra-services',
	_panelListenersBound: false,

	load: function () {
		var self = this;
		function get(fn, arg) { return rpcCall(fn, arg).then(function (v) { return v || {}; }).catch(function (e) { return { _error: structuredError(e) }; }); }
		return Promise.all([get(capsRpc), get(adaptiveRpc), get(historyRpc), get(legacyEventsRpc), get(legacyHistoryRpc), get(legacyRatingsRpc), get(runStatusRpc, pack({})), get(catalogListRpc), get(catalogStatusRpc), get(healthGetRpc)]).then(function (a) {
			self._state.caps = a[0]._error ? null : a[0]; self._state.adaptive = a[1]._error ? null : a[1];
			self._state.runHistory = a[2].runs || []; self._state.legacyEvents = a[3]; self._state.legacyHistory = a[4]; self._state.legacyRatings = a[5];
			self._state.activeRun = a[6].run || null;
			self._state.selectedRunId = self._state.selectedRunId || (self._state.activeRun && self._state.activeRun.runId) || (self._state.runHistory[0] && self._state.runHistory[0].runId) || null;
			if (self._state.activeRun) self._acceptRun(self._state.activeRun, true);
			self._state.protocol = self._preferredProtocol(self._state.selectedRun || self._state.activeRun || self._state.runHistory[0]);
			self._state.error = a[0]._error ? _('Capabilities unavailable: ') + a[0]._error : null;
			if (a[6]._error || runError(a[6])) self._state.selectedError = a[6]._error || runError(a[6]);
			self._state.catalogList = a[7]._error ? null : a[7]; self._state.catalogStatus = a[8]._error ? null : a[8]; self._state.catalogHealth = a[9]._error ? null : a[9]; self._state.catalogError = (a[7] && (a[7]._error || (a[7].ok === false && structuredError(a[7].error || a[7])))) || (a[8] && (a[8]._error || (a[8].ok === false && structuredError(a[8].error || a[8])))) || (a[9] && (a[9]._error || (a[9].ok === false && structuredError(a[9].error || a[9])))) || null;
			if (self._state.selectedRunId && (!self._state.selectedRun || self._state.selectedRun.runId !== self._state.selectedRunId)) { self._state.selectedLoading = true; return rpcCall(runStatusRpc, pack({ runId: self._state.selectedRunId })).then(function (x) { if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.selectedRun = x.run || null; self._state.selectedLoading = false; self._state.selectedError = self._state.selectedRun ? null : _('EIO: selected run response did not contain details'); return self._state; }).catch(function (e) { self._state.selectedLoading = false; self._state.selectedError = structuredError(e); return self._state; }); }
			return self._state;
		});
	},
	_upsertRunHistory: function (run) {
		var summary = runSummary(run); if (!summary) return;
		var rows = this._state.runHistory || [], found = false;
		rows = rows.map(function (row) { if (row.runId !== summary.runId) return row; found = true; return Object.assign({}, row, summary); });
		if (!found) rows.unshift(summary);
		this._state.runHistory = rows;
	},
	_acceptRun: function (run, discover) {
		if (!run || !run.runId) return;
		this._state.activeRun = run; this._upsertRunHistory(run);
		if (discover && !this._state.selectedByUser) this._state.selectedRunId = run.runId;
		if (this._state.selectedRunId === run.runId) this._state.selectedRun = run;
	},
	_refreshSelectedRun: function (id) {
		var self = this;
		return rpcCall(runStatusRpc, pack({ runId: id })).then(function (x) {
			if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x));
			if (self._state.selectedRunId === id) { self._state.selectedRun = x.run || null; self._state.selectedLoading = false; self._state.selectedError = self._state.selectedRun ? null : _('EIO: selected run response did not contain details'); if (self._state.selectedRun) self._upsertRunHistory(self._state.selectedRun); }
			return x;
		}).catch(function (e) { if (self._state.selectedRunId === id) { self._state.selectedLoading = false; self._state.selectedError = structuredError(e); } return null; });
	},

	_preferredProtocol: function (run) { var ps = run && run.protocols || []; return ps.indexOf('tcp_https') >= 0 ? 'tcp_https' : ps[0] || 'tcp_https'; },
	_protocolLabel: function (p) { return p === 'quic_udp' ? 'QUIC / UDP' : p === 'tcp_https' ? 'HTTPS / TCP' : p || _('Unknown protocol'); },
	_short: function (v, n) { v = String(v || ''); return v.length > (n || 28) ? v.slice(0, n || 28) + '…' : v; },
	_panelFromHash: function () {
		var hash = (typeof window !== 'undefined' && window.location && window.location.hash || '').replace(/^#/, '');
		return ['orchestra-services', 'orchestra-find', 'orchestra-results', 'orchestra-adaptive'].indexOf(hash) >= 0 ? hash : 'orchestra-services';
	},
	_bindPanelNavigation: function () {
		var self = this;
		if (this._panelListenersBound || typeof window === 'undefined' || !window.addEventListener) return;
		this._panelListenersBound = true;
		this._onPanelNavigation = function () {
			self._stopPolling(); self._panel = self._panelFromHash();
			var done = function () { self._refresh(); self._startPolling(); };
			if (self._panel === 'orchestra-find' || self._panel === 'orchestra-results') self._discoverActiveRun().then(done); else done();
		};
		this._onPanelPageHide = function () { self._stopPolling(); };
		window.addEventListener('hashchange', this._onPanelNavigation);
		window.addEventListener('popstate', this._onPanelNavigation);
		window.addEventListener('pagehide', this._onPanelPageHide);
	},
	_setPanel: function (panel) {
		if (['orchestra-services', 'orchestra-find', 'orchestra-results', 'orchestra-adaptive'].indexOf(panel) < 0) return;
		this._stopPolling(); this._panel = panel;
		if (typeof window !== 'undefined' && window.history && window.history.pushState) window.history.pushState({ orchestraPanel: panel }, '', '#' + panel);
		else if (typeof window !== 'undefined' && window.location) window.location.hash = panel;
		if (panel === 'orchestra-find' || panel === 'orchestra-results') this._discoverActiveRun().then(function () { this._refresh(); this._startPolling(); }.bind(this)); else { this._refresh(); this._startPolling(); }
	},
	_shouldPoll: function () {
		var r = this._state.activeRun, o = this._state.operation, activePanel = this._panel === 'orchestra-find' || this._panel === 'orchestra-results';
		return (activePanel && r && !terminalRun(r.phase, (this._state.caps || {}).terminalPhases)) || (this._panel === 'orchestra-results' && o && !terminalApply(o.phase));
	},
	_discoverActiveRun: function () {
		var self = this;
		return rpcCall(runStatusRpc, pack({})).then(function (x) { if (x && x.run) { self._acceptRun(x.run, true); } else if (x && x.ok === false && structuredError(x.error || x).indexOf('ENOENT') < 0) self._state.selectedError = runError(x) || structuredError(x.error || x); return historyRpc().then(function (h) { if (h && h.runs) self._state.runHistory = h.runs; }); }).catch(function (e) { self._state.selectedError = structuredError(e); return null; });
	},

	render: function (state) {
		injectCSS(); this._state = state || this._state; this._panel = this._panelFromHash(); this._bindPanelNavigation();
		if (typeof window !== 'undefined' && window.location && !window.location.hash && window.history && window.history.replaceState) window.history.replaceState({ orchestraPanel: this._panel }, '', '#' + this._panel);
		var self = this, root = E('div', { 'class': 'z2m-page z2m-orchestra', 'id': 'z2m-orchestra-page' });
		root.appendChild(E('div', { 'class': 'z2m-page-header z2m-orchestra-header' }, [E('h2', {}, _('Orchestra')), E('p', {}, _('Find, compare and safely apply a verified strategy.'))]));
		root.appendChild(E('nav', { 'class': 'z2m-tabs z2m-orchestra-nav', 'aria-label': _('Orchestra sections') }, [
			this._panelLink('orchestra-services', _('Services')),
			this._panelLink('orchestra-find', _('Find strategy')),
			this._panelLink('orchestra-results', _('Runs & results')),
			this._panelLink('orchestra-adaptive', _('Adaptive engine'))
		]));
		var content = E('div', { 'class': 'z2m-orchestra-content' }); root.appendChild(content); this._renderContent(content);
		this._startPolling();
		return root;
	},
	_panelLink: function (panel, label) {
		var self = this, active = this._panel === panel, attrs = { 'class': 'z2m-tab' + (active ? ' z2m-tab-active' : ''), 'href': '#' + panel }; if (active) attrs['aria-current'] = 'page';
		var link = E('a', attrs, label);
		link.addEventListener('click', function (event) { if (event && event.preventDefault) event.preventDefault(); self._setPanel(panel); }); return link;
	},

	_renderContent: function (content) {
		if (content.replaceChildren) content.replaceChildren(); else if (content.firstChild) while (content.firstChild) content.removeChild(content.firstChild); else content.children.length = 0;
		if (this._panel === 'orchestra-services') content.appendChild(this._servicesSection());
		else if (this._panel === 'orchestra-find') content.appendChild(this._findSection());
		else if (this._panel === 'orchestra-results') content.appendChild(this._resultsSection());
		else content.appendChild(this._adaptiveSection());
		if (this._state.error) content.appendChild(alertBox(this._state.error));
	},
	_servicesSection: function () {
		var self = this, s = this._state, list = s.catalogList || {}, status = s.catalogStatus || {}, body = E('div', { 'class': 'z2m-orchestra-services' });
		var discord = (list.services || []).filter(function (service) { return service.id === 'discord'; })[0];
		if (discord) {
			var discordButton = btn(_('Find Discord strategies'), function (b) {
				self._busy(b, _('Starting…'));
				rpcCall(runStartRpc, pack({ targetType: 'service', targetId: discord.id, repeats: 1, perAttemptTimeoutSec: 15, totalTimeoutSec: 1800 })).then(function (x) {
					if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x));
					self._state.activeRun = x.run; self._state.selectedRun = x.run; self._state.selectedRunId = x.run.runId; self._panel = 'orchestra-results'; self._refresh(); self._startPolling();
				}).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Find Discord strategies'), true); self._refresh(); });
			}, !!(self._state.activeRun && !terminalRun(self._state.activeRun.phase, (self._state.caps || {}).terminalPhases)), 'cbi-button-action');
			body.appendChild(E('div', { 'class': 'z2m-card z2m-discord-service-card' }, [E('h4', {}, _('Discord TCP/443')), E('p', {}, _('Dynamically test Web, Gateway and CDN against the packaged Zapret2GUI registry.')), E('div', { 'class': 'z2m-actions' }, [discordButton])]));
		}
		if (s.catalogError || list.ok === false) { body.appendChild(alertBox(s.catalogError || structuredError(list.error || list))); return section(_('Services'), 'orchestra-services', body, _('Reviewed service domains with ownership-safe changes.')); }
		var ledger = status.ledger || {}, enabled = {}; (ledger.enabled || []).forEach(function (id) { enabled[id] = true; }); self._catalogChecks = self._catalogChecks || {};
		(list.services || []).forEach(function (service) { if (self._catalogChecks[service.id] == null) self._catalogChecks[service.id] = !!enabled[service.id]; });
		var catalogStatus = status.catalog || {}, digestMismatch = list.digestOk === false || catalogStatus.digestOk === false, catalogValid = catalogStatus.valid === true && !digestMismatch, catalogVerdict = digestMismatch ? _('Invalid · digest mismatch') : catalogValid ? _('Valid') : _('Unavailable'); self._catalogMutationBlocked = digestMismatch || !catalogValid;
		var state = E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('Catalog version'), list.catalogVersion || _('Unavailable')), kv(_('Catalog validity'), badge(catalogVerdict, catalogValid ? 'ok' : 'bad')), kv(_('Catalog digest'), badge(digestMismatch ? _('Mismatch') : catalogValid ? _('Verified') : _('Unavailable'), catalogValid ? 'ok' : 'bad')), kv(_('Enabled services'), (ledger.enabled || []).join(', ') || _('None')), kv(_('Catalog-owned domains'), status.ownedDomains == null ? '—' : status.ownedDomains), kv(_('Ownership / drift'), status.drift && status.drift.divergent ? badge(status.drift.reason || _('Drift detected'), 'warn') : badge(_('In sync'), 'ok'))]); body.appendChild(state);
		if (digestMismatch) body.appendChild(alertBox(_('Catalog digest mismatch; catalog mutations are disabled until the catalog is repaired.')));
		var byCategory = {}; (list.services || []).forEach(function (service) { (byCategory[service.category] = byCategory[service.category] || []).push(service); });
		(list.categories || Object.keys(byCategory)).forEach(function (category) { var grid = E('div', { 'class': 'z2m-card-grid' }); (byCategory[category] || []).forEach(function (service) { var check = E('input', { 'type': 'checkbox', 'id': 'z2m-orchestra-catalog-' + service.id }); check.checked = !!self._catalogChecks[service.id]; check.addEventListener('change', function () { self._catalogChecks[service.id] = !!check.checked; }); var card = E('div', { 'class': 'z2m-card' }, [E('h4', {}, [check, ' ' + esc(service.name)]), kv(_('Domains'), (service.domainCount == null ? '—' : service.domainCount) + ' ' + _('domains')), kv(_('Mechanisms'), (service.mechanisms || []).join(', ') || '—'), kv(_('Stability'), badge(service.stability || _('Unknown'), service.stability === 'reviewed' ? 'ok' : 'warn')), E('div', { 'class': 'cbi-value-description' }, esc(service.limitations || ''))]); var expanded = self._catalogDomains && self._catalogDomains[service.id]; var domainButton = btn(expanded ? _('Hide domains') : _('Show domains'), function (b) { if (expanded) { delete self._catalogDomains[service.id]; self._refresh(); return; } self._busy(b, _('Loading…')); rpcCall(catalogGetRpc, pack({ id: service.id })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogDomains = self._catalogDomains || {}; self._catalogDomains[service.id] = res.service && res.service.domains || []; self._busy(b, _('Show domains'), true); self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Show domains'), true); self._refresh(); }); }, false); var findDisabled = !enabled[service.id] || !!(self._state.activeRun && !terminalRun(self._state.activeRun.phase, (self._state.caps || {}).terminalPhases)), findReason = !enabled[service.id] ? _('Enable and apply first') : _('A live run is already active'); var findButton = btn(_('Find strategies'), function (b) { self._busy(b, _('Calculating…')); rpcCall(catalogGetRpc, pack({ id: service.id })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._servicePlan = { id: service.id, name: service.name, domains: res.service.domains || [], attempts: (res.service.domains || []).length * 5 }; self._busy(b, _('Find strategies'), true); self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Find strategies'), true); self._refresh(); }); }, findDisabled, 'cbi-button-action', findReason); card.appendChild(E('div', { 'class': 'z2m-actions' }, [domainButton, findButton])); if (expanded) card.appendChild(E('pre', { 'class': 'z2m-mono' }, esc(expanded.join('\n')))); grid.appendChild(card); }); body.appendChild(E('section', { 'class': 'z2m-orchestra-section' }, [E('h4', {}, esc(category)), grid])); });
		if (self._servicePlan) { var plan = self._servicePlan, confirm = btn(_('Start service run'), function (b) { self._busy(b, _('Starting…')); rpcCall(runStartRpc, pack({ targetType: 'service', targetId: plan.id, protocols: ['tcp_https'], candidateMode: 'recommended', repeats: 1, perAttemptTimeoutSec: 20, totalTimeoutSec: Math.max(60, Math.min(1800, plan.attempts * 20)) })).then(function (x) { if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.activeRun = x.run; self._state.selectedRun = x.run; self._state.selectedRunId = x.run.runId; self._panel = 'orchestra-results'; if (typeof window !== 'undefined' && window.history && window.history.pushState) window.history.pushState({ orchestraPanel: self._panel }, '', '#' + self._panel); self._refresh(); self._startPolling(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._refresh(); }); }, false, 'cbi-button-action'); body.appendChild(E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('h4', {}, _('Service run plan')), kv(_('Service'), plan.name), kv(_('Domains'), plan.domains.length), kv(_('Bounded attempts'), plan.attempts + ' · HTTPS / TCP · 1 repeat · recommended candidates'), E('pre', { 'class': 'z2m-mono' }, esc(plan.domains.join('\n'))), E('div', { 'class': 'z2m-actions' }, [confirm])])); }
		var health = s.catalogHealth && s.catalogHealth.matrix; body.appendChild(E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Latest Health Matrix')), health ? kv(_('State'), badge(health.status || _('Unknown'), health.status === 'succeeded' ? 'ok' : health.status === 'failed' ? 'bad' : 'warn')) : E('div', { 'class': 'z2m-empty' }, _('No health matrix run yet.'))]));
		var previewButton = btn(_('Preview changes'), function (b) { var desired = self._catalogEnabled(); self._busy(b, _('Previewing…')); rpcCall(catalogPreviewRpc, pack({ enabled: desired })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogPreview = res; self._catalogApplyArmed = false; self._state.catalogError = null; self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Preview changes'), true); self._refresh(); }); }, digestMismatch, 'cbi-button-action', digestMismatch ? _('Catalog digest mismatch') : null); body.appendChild(E('div', { 'class': 'z2m-actions' }, [previewButton]));
		if (self._catalogPreview) body.appendChild(self._catalogPreviewCard());
		return section(_('Services'), 'orchestra-services', body, _('Reviewed service domains with ownership-safe changes.'));
	},
	_catalogEnabled: function () { var out = [], checks = this._catalogChecks || {}; Object.keys(checks).forEach(function (id) { if (checks[id]) out.push(id); }); return out; },
	_catalogPreviewCard: function () { var self = this, p = this._catalogPreview, body = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('h4', {}, _('Exact change preview'))]); function lines(title, rows, render) { rows = rows || []; body.appendChild(E('h5', {}, esc(title + ' (' + rows.length + ')'))); body.appendChild(E('pre', { 'class': 'z2m-mono' }, esc(rows.length ? rows.map(render).join('\n') : _('None')))); } lines(_('Additions'), p.additions, function (x) { return '+ ' + x.domain + ' [' + (x.owners || []).join(', ') + ']'; }); lines(_('Removals (solely catalog-owned)'), p.removals, function (x) { return '- ' + x.domain + ' [' + (x.previousOwners || []).join(', ') + ']'; }); lines(_('Shared domains kept'), p.keepShared, function (x) { return '= ' + x.domain; }); lines(_('User-owned entries kept'), p.alreadyUserOwned, function (x) { return '= ' + x.domain; }); var pre = p.precondition || {}; var blocked = self._catalogMutationBlocked; var apply = btn(self._catalogApplyArmed ? _('Confirm apply') : _('Apply this plan'), function (b) { if (!self._catalogApplyArmed) { self._catalogApplyArmed = true; self._refresh(); return; } self._busy(b, _('Applying…')); rpcCall(catalogApplyRpc, pack({ enabled: self._catalogEnabled(), revision: pre.ledgerRevision, fileSha256: pre.fileSha256 })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogPreview = null; self._catalogApplyArmed = false; self.load().then(function () { self._refresh(); }); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Confirm apply'), true); self._refresh(); }); }, blocked, self._catalogApplyArmed ? 'cbi-button-negative' : 'cbi-button-action', blocked ? _('Catalog digest mismatch') : null); body.appendChild(E('div', { 'class': 'z2m-actions' }, [apply])); return body; },

	_findSection: function () {
		var self = this, s = this._state, run = s.activeRun || {}, active = !!s.activeRun && !terminalRun(run.phase, (s.caps || {}).terminalPhases), form = E('div', { 'class': 'z2m-orchestra-find-panel' });
		var fields = E('div', { 'class': 'z2m-orchestra-fields' });
		function field(label, input, hint) { return E('label', { 'class': 'z2m-orchestra-field' }, [E('span', {}, esc(label)), input, E('small', {}, esc(hint))]); }
		var domain = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-domain', 'type': 'text', 'value': run.target || 'youtube.com', 'placeholder': 'youtube.com' });
		var mode = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-orchestra-mode' }, ['recommended', 'all', 'zapret2gui-only'].map(function (v) { return E('option', { 'value': v, 'selected': (run.candidateMode || 'recommended') === v }, esc(v)); }));
		var repeats = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '3', 'value': run.repeats || 2 });
		var timeout = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '120', 'value': run.perAttemptTimeoutSec || 20 });
		var total = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '20', 'max': '1800', 'value': run.totalTimeoutSec || 600 });
		fields.appendChild(field(_('Target domain'), domain, _('Hostname to test'))); fields.appendChild(field(_('Candidate set'), mode, _('Trusted catalog only'))); fields.appendChild(field(_('Repeats'), repeats, _('1–3 attempts'))); fields.appendChild(field(_('Attempt timeout'), timeout, _('Seconds per attempt'))); fields.appendChild(field(_('Run timeout'), total, _('Maximum total seconds'))); form.appendChild(fields);
		var actions = E('div', { 'class': 'z2m-actions z2m-orchestra-actions' });
		function start(b) { var payload = { targetType: 'domain', domain: domain.value.trim(), protocols: ['tcp_https', 'quic_udp'], candidateMode: mode.value, repeats: +repeats.value, perAttemptTimeoutSec: +timeout.value, totalTimeoutSec: +total.value }; self._busy(b, _('Starting…')); rpcCall(runStartRpc, pack(payload)).then(function (x) { self._state.activeRun = x.run || null; self._state.selectedRun = x.run || null; self._state.selectedRunId = x.run && x.run.runId; self._state.selectedLoading = false; self._state.selectedError = null; self._state.protocol = self._preferredProtocol(x.run); self._state.error = null; self._refresh(); self._startPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Start'), true); self._refresh(); self._stopPolling(); }); }
		actions.appendChild(btn(_('Start'), start, active, 'cbi-button-action', active ? _('A live run is already active') : null));
		actions.appendChild(btn(_('Pause'), function (b) { self._action(b, runPauseRpc, _('Pause')); }, !active || run.phase === 'paused', null, !active ? _('No live run is executing') : _('Run is already paused')));
		actions.appendChild(btn(_('Resume'), function (b) { self._action(b, runResumeRpc, _('Resume')); }, !active || run.phase !== 'paused', null, !active ? _('No live run is paused') : _('Resume is available only while paused')));
		actions.appendChild(btn(_('Stop'), function (b) { self._action(b, runStopRpc, _('Stop')); }, !active, 'cbi-button-negative', !active ? _('No live run to stop') : null)); form.appendChild(actions);
		if (active) form.appendChild(this._liveProgress(run));
		return section(_('Find strategy'), 'orchestra-find', form, _('Run a bounded search against the trusted strategy catalog.'));
	},

	_liveProgress: function (run) { var p = Math.max(0, Math.min(100, +(run.progress || 0))), live = E('div', { 'class': 'z2m-orchestra-live' }, [E('div', { 'class': 'z2m-orchestra-live-top' }, [badge(run.phase || 'queued', 'warn'), E('span', {}, esc((run.completedCount || 0) + (run.totalCount ? ' / ' + run.totalCount : '') + ' attempts'))]), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(p), 'max': '100' }), kv(_('Current attempt'), (run.currentCandidate ? this._short(run.currentCandidate, 24) : _('Preparing')) + (run.currentAttempt ? ' · #' + run.currentAttempt : ''))]); if (run.targetType === 'service') live.appendChild(kv(_('Service target'), (run.serviceId || run.target || '—') + (run.currentDomain ? ' · ' + run.currentDomain : '') + (run.currentProtocol ? ' · ' + this._protocolLabel(run.currentProtocol) : ''))); if (run.error) live.appendChild(alertBox(structuredError(run.error))); if (run.events && run.events.length) live.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, run.events.slice(-6).map(function (e) { return (e.phase || '') + ': ' + (e.message || ''); }).join('\n'))); return live; },

	_resultsSection: function () {
		var self = this, s = this._state, selected = s.selectedRun && s.selectedRun.runId === s.selectedRunId ? s.selectedRun : null, body = E('div', { 'class': 'z2m-orchestra-results-layout' });
		var list = E('div', { 'class': 'z2m-orchestra-run-list', 'role': 'listbox', 'aria-label': _('Runs') });
		if (!(s.runHistory || []).length) list.appendChild(E('div', { 'class': 'z2m-empty' }, _('No runs yet.')));
		(s.runHistory || []).forEach(function (r) { var isSelected = r.runId === s.selectedRunId, item = E('button', { 'type': 'button', 'class': 'z2m-orchestra-run-item' + (isSelected ? ' is-selected' : ''), 'role': 'option', 'aria-selected': String(isSelected) }, [E('strong', {}, esc(r.target || _('Unknown target'))), E('span', {}, [badge(r.phase || 'unknown', terminalRun(r.phase, (s.caps || {}).terminalPhases) ? 'ok' : 'neutral'), E('small', {}, esc(r.winnerCandidateId ? _('Winner confirmed') : _('No winner')))])]); item.addEventListener('click', function () { self._selectRun(r.runId); }); list.appendChild(item); });
		body.appendChild(E('aside', { 'class': 'z2m-orchestra-master' }, [E('div', { 'class': 'z2m-orchestra-master-title' }, [E('strong', {}, _('Runs')), E('span', {}, esc(String((s.runHistory || []).length))) ]), list]));
		var detail = s.selectedLoading ? E('div', { 'class': 'z2m-empty', 'aria-live': 'polite' }, _('Loading selected run…')) : s.selectedError ? E('div', { 'class': 'z2m-orchestra-detail-error' }, [alertBox(s.selectedError), btn(_('Retry'), function () { self._selectRun(s.selectedRunId); }, false)]) : selected ? this._runDetail(selected) : E('div', { 'class': 'z2m-empty' }, _('Select a run to inspect its ranking.'));
		body.appendChild(E('div', { 'class': 'z2m-orchestra-detail' }, detail));
		return section(_('Runs & results'), 'orchestra-results', body, _('Select one run; details and ranking stay scoped to its target.'));
	},

	_runDetail: function (run) {
		if (run.targetType === 'service') return E('div', {}, [this._serviceRunSummary(run), this._serviceRunDetail(run), this._serviceProgress(run), this._serviceActions(run), this._state.preview && this._state.preview.runId === run.runId ? this._previewCard() : '']);
		var self = this, s = this._state, protocol = s.protocol || this._preferredProtocol(run), protocols = run.protocols || [protocol], body = E('div', { 'class': 'z2m-orchestra-run-detail' });
		var top = E('div', { 'class': 'z2m-orchestra-detail-top' }, [E('div', {}, [E('h4', {}, esc(run.target || _('Unknown target'))), E('p', {}, esc(_('Only this domain and selected protocol are shown.')))]), E('select', { 'class': 'cbi-input-select', 'aria-label': _('Ranking protocol') }, protocols.map(function (p) { return E('option', { 'value': p, 'selected': p === protocol }, esc(self._protocolLabel(p))); }))]);
		var select = top.querySelector('select'); if (select) select.addEventListener('change', function () { self._state.protocol = select.value; self._state.preview = null; self._refresh(); }); body.appendChild(top);
		body.appendChild(this._rankingTable(run, protocol));
		if (s.preview && s.preview.runId === run.runId) body.appendChild(this._previewCard());
		if (s.operation && s.operation.runId === run.runId) body.appendChild(this._operationCard());
		var raw = { runId: run.runId, candidateIds: run.candidateIds, protocols: run.protocols, results: run.results, rankedResults: run.rankedResults }; body.appendChild(details(_('Technical details'), E('pre', { 'class': 'z2m-mono' }, esc(pack(raw)))));
		return body;
	},
	_serviceRunSummary: function (run) {
		var self = this, rows = run.targetProgress || [], targets = run.targets || [], last = run.events && run.events.length ? run.events[run.events.length - 1] : null, p = run.totalCount ? Math.max(0, Math.min(100, (run.completedCount || 0) * 100 / run.totalCount)) : 0;
		var targetRows = targets.map(function (target) { var progress = rows.filter(function (x) { return x.targetId === target.id || x.domain === target.domain; })[0] || {}, tested = (progress.testedCandidateIds || []).length, total = run.totalCandidates || 0; return E('div', { 'class': 'z2m-card' }, [E('strong', {}, esc(target.id || target.domain)), E('span', {}, esc(' · ' + tested + ' / ' + total + ' · ' + (progress.winner ? 'winner' : progress.exhausted ? 'no-winner' : 'pending')))]); });
		var body = [kv(_('Service / target'), run.serviceId || run.target || '—'), kv(_('Phase'), badge(run.phase || 'unknown', terminalRun(run.phase, (this._state.caps || {}).terminalPhases) ? 'ok' : 'warn')), kv(_('Current target'), run.currentDomain || '—'), kv(_('Completed / total attempts'), (run.completedCount || 0) + ' / ' + (run.totalCount || 0)), kv(_('Continuation count'), run.continuationCount || 0), kv(_('Worker'), run.workerPid ? 'PID ' + run.workerPid : 'not running'), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(p), 'max': '100', 'aria-label': _('Run progress') }), E('div', { 'class': 'z2m-orchestra-target-rows' }, targetRows)];
		if (last) body.push(E('div', { 'class': 'cbi-value-description' }, esc(_('Last event: ') + (last.type || last.phase || 'event') + ' · ' + (last.message || ''))));
		if (run.error) body.push(alertBox(structuredError(run.error)));
		return E('div', { 'class': 'z2m-card z2m-orchestra-service-summary' }, body);
	},
	_serviceRunDetail: function (run) { var body = E('div', { 'class': 'z2m-orchestra-run-detail' }), verdict = run.serviceVerdict || {}, groups = run.serviceResults || []; body.appendChild(E('div', { 'class': 'z2m-orchestra-detail-top' }, [E('div', {}, [E('h4', {}, esc(run.serviceId || run.target || _('Service'))), E('p', {}, _('Apply is available only for the verified domain workflow.'))]) ])); body.appendChild(E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('Domains'), (verdict.finishedDomains || 0) + ' / ' + (verdict.totalDomains || (run.targets || []).length)), kv(_('Confirmed winners'), verdict.domainsWithConfirmedWinner || 0), kv(_('Without winner'), verdict.domainsWithoutWinner || 0), kv(_('Failed / indeterminate'), (verdict.failedDomains || 0) + ' / ' + (verdict.indeterminateDomains || 0))])); if (!groups.length) body.appendChild(E('div', { 'class': 'z2m-empty' }, terminalRun(run.phase) ? _('No per-domain result was recorded.') : _('Per-domain results will appear while the service run progresses.'))); groups.forEach(function (group) { var box = E('div', { 'class': 'z2m-card' }, [E('h4', {}, esc(group.domain))]); (group.protocols || []).forEach(function (protocol) { var winner = protocol.winner; box.appendChild(E('div', { 'class': 'z2m-orchestra-result-panel' }, [kv(_('Protocol'), protocol.protocol === 'tcp_https' ? _('HTTPS / TCP') : _('QUIC / UDP')), kv(_('Winner'), winner ? winner.candidateId : _('No confirmed winner')), E('pre', { 'class': 'z2m-mono' }, esc((protocol.rankedResults || []).map(function (r) { return (r.candidateId || '—') + ' · ' + (r.successCount || 0) + ' / ' + (r.attemptCount || 0) + ' · ' + (r.verdict || 'unknown'); }).join('\n') || _('No candidate evidence.')))])); }); body.appendChild(box); }); body.appendChild(details(_('Technical details'), E('pre', { 'class': 'z2m-mono' }, esc(pack({ serviceId: run.serviceId, catalogVersion: run.catalogVersion, catalogDigest: run.catalogDigest, targets: run.targets, serviceVerdict: run.serviceVerdict }))))); return body; },

	_serviceActions: function (run) { var self = this, ready = run.phase === 'completed' && run.serviceVerdict === 'ready', box = E('div', { 'class': 'z2m-actions' }); box.appendChild(btn(_('Preview service apply'), function (b) { self._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId })).then(function (x) { self._state.preview = x; self._state.error = null; self._busy(b, _('Preview service apply'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Preview service apply'), true); self._refresh(); }); }, !ready || !!this._state.operation)); if (this._state.preview && this._state.preview.runId === run.runId) box.appendChild(btn(_('Apply service preview'), function () { self._apply(); }, !!self._state.operation, 'cbi-button-action')); return box; },
	_serviceProgress: function (run) { var self = this, rows = run.targetProgress || [], total = run.totalCandidates || 0, can = run.continuable === true; var box = E('div', { 'class': 'z2m-card z2m-orchestra-service-progress' }, [E('h4', {}, _('Bounded scan progress')), kv(_('Current target'), run.currentDomain || _('None')), kv(_('Continuation count'), run.continuationCount || 0), E('pre', { 'class': 'z2m-mono' }, esc((run.targets || []).map(function (t) { var p = rows.filter(function (x) { return x.targetId === t.id || x.domain === t.domain; })[0] || {}; var tested = (p.testedCandidateIds || []).length; return t.domain + ' · ' + tested + ' / ' + total + ' · remaining ' + Math.max(0, total - tested) + ' · ' + (p.winner ? 'winner ' + p.winner.candidateId : p.exhausted ? 'no-winner' : 'pending'); }).join('\n')))]); box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Continue scan'), function (b) { self._busy(b, _('Continuing…')); rpcCall(runContinueRpc, pack({ runId: run.runId, additionalTimeoutSec: 900 })).then(function (x) { if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.selectedRun = x.run; self._busy(b, _('Continue scan'), true); self._refresh(); self._startPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Continue scan'), true); self._refresh(); }); }, !can)])); return box; },
	_rankingTable: function (run, protocol) {
		var self = this, s = this._state, rows = E('tbody', {}), ranked = run.rankedResults || [];
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
		return section(_('Adaptive engine'), 'orchestra-adaptive', body, _('Runtime status (read-only); adaptive controls are not available in this workflow.'));
	},
	_confirmedWinners: function () { var rows = (this._state.runHistory || []).filter(function (r) { return r.winnerCandidateId; }).map(function (r) { return E('tr', {}, [E('td', {}, esc(r.target || '—')), E('td', {}, esc((r.protocols || []).map(function (p) { return p === 'tcp_https' ? 'HTTPS' : 'QUIC'; }).join(' · '))), E('td', {}, esc(r.winnerCandidateId)), E('td', {}, badge(_('Confirmed'), 'ok'))]); }); if (!rows.length) return E('div', { 'class': 'z2m-empty' }, _('No confirmed winner per domain and protocol yet.')); return E('div', { 'class': 'z2m-orchestra-confirmed' }, [E('h4', {}, _('Best confirmed strategies')), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 'table' }, [E('thead', {}, E('tr', {}, ['Domain', 'Protocol', 'Strategy', 'Status'].map(function (h) { return E('th', {}, esc(_(h))); }))), E('tbody', {}, rows)]))]); },

	_selectRun: function (id) { var self = this; this._state.selectedByUser = true; this._state.selectedRunId = id; this._state.selectedRun = null; this._state.selectedLoading = true; this._state.selectedError = null; this._state.preview = null; this._state.operation = null; this._refresh(); rpcCall(runStatusRpc, pack({ runId: id })).then(function (x) { if (self._state.selectedRunId !== id) return; if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.selectedRun = x.run || null; self._state.selectedLoading = false; self._state.selectedError = self._state.selectedRun ? null : _('EIO: selected run response did not contain details'); self._state.protocol = self._preferredProtocol(self._state.selectedRun); if (self._state.selectedRun) self._upsertRunHistory(self._state.selectedRun); self._refresh(); }).catch(function (e) { if (self._state.selectedRunId !== id) return; self._state.selectedLoading = false; self._state.selectedError = structuredError(e); self._refresh(); }); },
	_preview: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._state.error = null; self._busy(b, _('Preview'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Preview'), true); self._refresh(); }); },
	_previewThenApply: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._apply(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Apply'), true); self._refresh(); }); },
	_apply: function () { var self = this, p = this._state.preview; if (!p) return; rpcCall(applyRpc, pack({ runId: p.runId, candidateId: p.candidateId, changeHash: p.changeHash, idempotencyToken: 'ui-' + Date.now().toString(36) })).then(function (x) { self._state.operation = { operationId: x.operationId, runId: x.runId || p.runId, phase: x.phase, events: [] }; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); }); },
	_restore: function (b) { var self = this, o = this._state.operation; this._busy(b, _('Restoring…')); rpcCall(restoreRpc, pack({ operationId: o.operationId })).then(function (x) { self._state.operation = Object.assign({}, o, x); self._busy(b, _('Restore previous'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Restore previous'), true); self._refresh(); }); },
	_action: function (b, fn, label) { var self = this; this._busy(b, label + '…'); rpcCall(fn).then(function (x) { if (x && x.run) { self._state.activeRun = x.run; if (self._state.selectedRunId === x.run.runId) self._state.selectedRun = x.run; } self._busy(b, label, true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, label, true); self._refresh(); }); },
	_busy: function (b, label, done) { if (!b) return; if (done) { b.disabled = false; if (b.removeAttribute) b.removeAttribute('disabled'); if (b.removeAttribute) b.removeAttribute('aria-disabled'); } else { b.disabled = true; if (b.setAttribute) b.setAttribute('disabled', 'disabled'); if (b.setAttribute) b.setAttribute('aria-disabled', 'true'); } b.setAttribute('aria-busy', done ? 'false' : 'true'); b.textContent = label; },
	_refresh: function () { var root = document.getElementById('z2m-orchestra-page'), content = root && root.querySelector('.z2m-orchestra-content'); if (root && root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('.z2m-orchestra-nav .z2m-tab'), function (link) { var active = link.getAttribute('href') === '#' + this._panel; link.classList.toggle('z2m-tab-active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }, this); if (content) this._renderContent(content); },
	_pollActiveRun: function () {
		var self = this, known = this._state.activeRun;
		return rpcCall(runStatusRpc, pack({})).then(function (x) {
			if (x && x.run) { self._acceptRun(x.run, false); if (terminalRun(x.run.phase, (self._state.caps || {}).terminalPhases)) return self._refreshSelectedRun(x.run.runId).then(function () { return historyRpc().then(function (h) { self._state.runHistory = h && h.runs || self._state.runHistory; }); }); return x; }
			if (known && known.runId && !terminalRun(known.phase, (self._state.caps || {}).terminalPhases)) return self._refreshSelectedRun(known.runId).then(function () { return historyRpc().then(function (h) { self._state.runHistory = h && h.runs || self._state.runHistory; self._state.activeRun = null; }); });
			return x;
		});
	},
	_startPolling: function () { var self = this; if (this._polling || !this._shouldPoll()) return; this._polling = true; this._poll = setInterval(function () { if (!self._shouldPoll()) { self._stopPolling(); return; } var activePanel = self._panel === 'orchestra-find' || self._panel === 'orchestra-results'; if (activePanel && self._state.activeRun && !terminalRun(self._state.activeRun.phase, (self._state.caps || {}).terminalPhases)) self._pollActiveRun().then(function () { self._refresh(); if (!self._shouldPoll()) self._stopPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); self._stopPolling(); }); else if (self._panel === 'orchestra-results' && self._state.operation && !terminalApply(self._state.operation.phase)) rpcCall(applyStatusRpc, pack({ operationId: self._state.operation.operationId })).then(function (x) { if (x.operation) self._state.operation = x.operation; self._refresh(); if (!self._shouldPoll()) self._stopPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); self._stopPolling(); }); }, 2000); },
	_stopPolling: function () { if (this._poll) clearInterval(this._poll); this._poll = null; this._polling = false; },
	handleSaveApply: null, handleSave: null, handleReset: null
});
