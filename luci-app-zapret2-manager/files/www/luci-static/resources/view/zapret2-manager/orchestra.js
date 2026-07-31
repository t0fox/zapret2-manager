'use strict';
// Adaptive engine page (Orchestra v2) — read-only capability/observability
// adapter over upstream zapret-auto.lua. Simple Mode by default;
// Technical details collapsed. Honest about what is and isn't available.
'require rpc';

var callOrchCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
var callOrchStatus = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_status', reject: true });
var callOrchEvents = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_events', reject: true });
var callOrchHistory = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_history', reject: true });
var callOrchRatings = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_ratings_get', reject: true });
var callOrchRunId = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_runid', reject: true });
var callOrchParseWarnings = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_parse_warnings', reject: true });

function injectCSS() {
	if (document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

// lightweight Z2M helpers (cannot use Z2M. prefix since Z2M.js may not be loaded as module)
var htmlesc = function (s) {
	if (s == null) return '';
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

return L.view.extend({
	title: _('Adaptive engine'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
		}
		return Promise.all([
			grab(callOrchCapabilities), grab(callOrchStatus), grab(callOrchEvents), grab(callOrchHistory), grab(callOrchRatings), grab(callOrchRunId), grab(callOrchParseWarnings)
		]).then(function (r) {
			return {
				capError: r[0].loadError, capabilities: r[0].data,
				statusError: r[1].loadError, status: r[1].data,
				eventsError: r[2].loadError, events: r[2].data,
				historyError: r[3].loadError, history: r[3].data,
				ratingsError: r[4].loadError, ratings: r[4].data,
				runIdError: r[5].loadError, runId: r[5].data,
				parseWarningsError: r[6].loadError, parseWarnings: r[6].data
			};
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var st = envelope.status || {};
		var caps = envelope.capabilities || {};
		var ratings = envelope.ratings || {};
		var runId = envelope.runId || {};
		var parseWarnings = envelope.parseWarnings || {};

		if (envelope.statusError) {
			return E('div', { 'class': 'z2m-page' }, [
				E('h2', {}, _('Adaptive engine')),
				E('div', { 'class': 'alert-message danger' },
					E('p', {}, _('Status unavailable: ') + htmlesc(envelope.statusError)))
			]);
		}

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Adaptive engine')),
				E('p', {}, _('Powered by upstream zapret-auto.lua. Reports what is genuinely observable — and honestly says what is not.'))
			])
		]);

		container.appendChild(this.heroSection(st));
		container.appendChild(this.statusGrid(st));
		container.appendChild(this.adaptiveCard(st));
		container.appendChild(this.engineCard(st));
		container.appendChild(this.observabilityCard(st));
		container.appendChild(this.limitationsCard(st));
		container.appendChild(this.diagSection(st, envelope.events, envelope.eventsError));
		container.appendChild(this.historySection(envelope.history, envelope.historyError));
		container.appendChild(this.ratingsSection(ratings, envelope.ratingsError));
		container.appendChild(this.runIdSection(runId, envelope.runIdError));
		container.appendChild(this.parseWarningsSection(parseWarnings, envelope.parseWarningsError));
		container.appendChild(this.technicalDetails(st, caps));
		return container;
	},

	// ---- hero: overall adaptive state ----
	heroSection: function (st) {
		var state = st.adaptiveState || 'inactive';
		var label = 'Active';
		if (state === 'inactive') label = 'Inactive';
		else if (state === 'partial') label = 'Partial';

		var detail = '';
		if (st.engine && st.engine.auto) {
			detail = 'zapret-auto.lua is loaded in nfqws2';
			if (st.daemonPid) detail += ' (PID ' + st.daemonPid + ')';
		} else {
			detail = 'zapret-auto.lua is not in the live nfqws2 command line';
		}

		var cls = 'z2m-hero';
		if (state === 'active') cls += ' z2m-hero-active';
		else if (state === 'inactive') cls += ' z2m-hero-inactive';
		else cls += ' z2m-hero-partial';

		var icon = '\u25CF '; // ●
		if (state === 'inactive') icon = '\u25CB '; // ○
		else if (state === 'partial') icon = '\u25D0 '; // ◐

		return E('div', { 'class': cls }, [
			E('div', { 'class': 'z2m-hero-icon' }, icon),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, _('Adaptive engine: ') + _(label)),
				E('p', {}, htmlesc(detail))
			])
		]);
	},

	// ---- quick status grid ----
	statusGrid: function (st) {
		var grid = E('div', { 'class': 'z2m-card-grid' });

		function item(label, value) {
			var el = E('div', { 'class': 'z2m-card' });
			el.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, htmlesc(label)),
				E('span', { 'class': 'z2m-kv-value' }, typeof value === 'string' ? htmlesc(value) : value)
			]));
			return el;
		}

		var lua = st.luaLoaded || {};
		grid.appendChild(item('zapret-auto.lua', lua.auto || 'Unknown'));
		grid.appendChild(item('zapret-antidpi.lua', lua.antidpi || 'Unknown'));
		grid.appendChild(item('zapret-lib.lua', lua.lib || 'Unknown'));

		var daemon = st.daemonRunning ? ('Running, PID ' + st.daemonPid) : 'Not running';
		grid.appendChild(item('nfqws2', htmlesc(daemon)));

		var adaptiveState = st.adaptiveState || 'unknown';
		var stateBadge = (adaptiveState === 'active')
			? E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('Active'))
			: (adaptiveState === 'partial')
				? E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('Partial'))
				: E('span', { 'class': 'z2m-badge z2m-badge-bad' }, _('Inactive'));
		grid.appendChild(item('Adaptive state', stateBadge));

		var diag = st.diagnosticsAvailable
			? E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('Available'))
			: E('span', { 'class': 'z2m-badge z2m-badge-neutral' }, _('Off'));
		grid.appendChild(item('Diagnostics', diag));

		var thresholds = st.appliedThresholds != null ? String(st.appliedThresholds) : '0';
		grid.appendChild(item('Applied configuration', thresholds + ' thresholds'));

		return grid;
	},

	// ---- A. Adaptive behavior card ----
	adaptiveCard: function (st) {
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Adaptive behavior'))
		]);

		var sem = st.autohostlistSemantic || {};
		var f = sem.failure || {};
		var r = sem.retransmission || {};
		var u = sem.udp || {};

		if (f.threshold != null) node.appendChild(this.kv(_('Failure threshold'), f.threshold + ' failures'));
		if (f.windowSeconds != null) node.appendChild(this.kv(_('Failure observation window'), f.windowSeconds + ' s'));
		if (r.threshold != null) node.appendChild(this.kv(_('Retransmission threshold'), r.threshold + ' packets'));
		if (r.reset != null) node.appendChild(this.kv(_('Retransmission reset'), r.reset ? _('Enabled') : _('Disabled')));
		if (r.maxSequence != null) node.appendChild(this.kv(_('Max sequence'), String(r.maxSequence)));
		if (u.incomingMaxSeq != null) node.appendChild(this.kv(_('UDP incoming max seq'), String(u.incomingMaxSeq)));
		if (u.outgoingMaxSeq != null) node.appendChild(this.kv(_('UDP outgoing max seq'), String(u.outgoingMaxSeq)));

		var parseErr = sem.parseErrors || [];
		if (parseErr.length) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Parse errors: ') + parseErr.join('; ')));
		}

		node.appendChild(E('div', { 'class': 'cbi-value-description', 'style': 'margin-top:0.4em' },
			_('Raw AUTOHOSTLIST_* variable names are shown in Technical details. Values reflect the applied configuration.')));

		return node;
	},

	// ---- B. What the engine does card ----
	engineCard: function (st) {
		return E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('What the engine does')),
			E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('Evaluates traffic at packet time. Keeps adaptive state in nfqws2 process memory. Uses applied AUTOHOSTLIST settings. State resets when nfqws2 restarts. The manager does not replace this behavior.')),
			this.kv(_('Autostate model'), 'In-process Lua global (autostate.<askey>.<hostkey>)'),
			this.kv(_('Persistence'), _('Not persisted — memory-only')),
			this.kv(_('Upstream owner'), 'zapret-auto.lua')
		]);
	},

	// ---- C. Observability card ----
	observabilityCard: function (st) {
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Observability')),
		]);

		var detected = st.detected || {};
		node.appendChild(this.kv(_('Live argv verified'), st.engine && st.engine.auto ? _('Yes') : _('No')));
		node.appendChild(this.kv(_('Lua files verified'), st.luaFiles && st.luaFiles.length ? (String(st.luaFiles.length) + ' files') : _('None')));
		node.appendChild(this.kv(_('Package version'), htmlesc(detected.packageVersion || _('Undetected'))));
		node.appendChild(this.kv(_('Pinned upstream'), htmlesc(String(detected.pinnedUpstream || '').substring(0, 10) + '\u2026')));
		node.appendChild(this.kv(_('Diagnostics'), st.debugEnabled ? _('Enabled (--debug in argv)') : _('Disabled')));

		if (st.managerHistory && st.managerHistory.entries && st.managerHistory.entries.length) {
			node.appendChild(this.kv(_('Manager-observed events'), String(st.managerHistory.entries.length)));
			node.appendChild(this.kv(_('Last observation'), _('See History below')));
		}

		node.appendChild(this.kv(_('Data freshness'), _('Live query')));

		return node;
	},

	// ---- D. Limitations card ----
	limitationsCard: function (st) {
		return E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Limitations')),
			E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('Upstream adaptive ratings live inside nfqws2 memory and are not exposed through an external API in this version.'))
		]);
	},

	// ---- Diagnostics section ----
	diagSection: function (st, events, eventsError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Diagnostic observability'))
		]);

		if (eventsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Diagnostics unavailable: ') + htmlesc(eventsError)));
			return node;
		}

		var diagTail = st.diagnosticTail;
		if (!st.diagnosticsAvailable) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('Diagnostics are off. Enable AUTOHOSTLIST_DEBUGLOG in the applied configuration to collect observable events.')));
			return node;
		}

		if (!diagTail || diagTail.error) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('Diagnostics are configured but the log file is not yet readable. It will appear once the engine produces output.')));
			return node;
		}

		node.appendChild(this.kv(_('Log path'), htmlesc(diagTail.path || '')));
		node.appendChild(this.kv(_('Parsed events'), String(diagTail.parsed || 0)));
		node.appendChild(this.kv(_('Unknown lines'), String(diagTail.unknown || 0)));
		if (diagTail.truncated) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Log was truncated (bounded tail read).')));
		}

		return node;
	},

	// ---- Manager observation history ----
	historySection: function (history, historyError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Manager observation history'))
		]);

		if (historyError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('History unavailable: ') + htmlesc(historyError)));
			return node;
		}

		history = history || {};
		if (!history.available || !history.entries || !history.entries.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				_('Not collecting — upstream diagnostics are disabled')));
			return node;
		}

		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			htmlesc(history.label || '') + ' (' + history.total + ' entries)'));

		var rows = (history.entries || []).map(function (e) {
			return E('tr', {}, [
				E('td', {}, htmlesc(e.eventClass || '?')),
				E('td', {}, htmlesc(e.rawLineHash || '')),
				E('td', {}, e.timestamp ? (new Date(e.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19)) : '')
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [
					E('th', {}, _('Event class')),
					E('th', {}, _('Line hash')),
					E('th', {}, _('Timestamp'))
				])
			].concat(rows))));

		return node;
	},

	// ---- Ratings section ----
	ratingsSection: function (ratings, ratingsError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Adaptive engine ratings'))
		]);

		if (ratingsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Ratings unavailable: ') + htmlesc(ratingsError)));
			return node;
		}

		ratings = ratings || {};
		if (!ratings.available || !ratings.entries || !ratings.entries.length) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				_(ratings.note || 'Not collecting ratings — no manager observation history available')));
			return node;
		}

		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			htmlesc(ratings.label || '') + ' (' + ratings.total + ' entries)'));

		if (ratings.annotated) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-info' },
				htmlesc(ratings.note || 'Ratings are a read-only aggregation, not a learning engine.')));
		}

		var rows = (ratings.entries || []).map(function (e) {
			var domain = htmlesc(e.normalizedDomain || e.domain || '?');
			var askey = htmlesc(e.askey || 'N/A');
			var strategy = e.strategyId != null ? e.strategyId : '-';
			var prevStrategy = e.previousStrategyId != null ? e.previousStrategyId : '-';
			
			return E('tr', {}, [
				E('td', {}, domain),
				E('td', {}, askey),
				E('td', {}, strategy),
				E('td', {}, prevStrategy),
				E('td', {}, e.selectedCount != null ? String(e.selectedCount) : '-')
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [
					E('th', {}, _('Domain')),
					E('th', {}, _('Protocol')),
					E('th', {}, _('Strategy')),
					E('th', {}, _('Previous')),
					E('th', {}, _('Selections'))
				])
			].concat(rows))));

		if (ratings.bounded) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Showing limited view (bounded at 200 entries). Request full history through API if needed.')));
		}

		return node;
	},

	// ---- runId Section (Slice 3) ----
	runIdSection: function (runId, runIdError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Run ID'))
		]);

		if (runIdError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Run ID unavailable: ') + htmlesc(runIdError)));
			return node;
		}

		runId = runId || {};
		if (!runId.available) {
			node.appendChild(E('div', { 'class': 'z2m-empty' },
				_('Run ID not detected — zapret-auto.lua may not be loaded.')));
			return node;
		}

		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Run ID')),
			E('span', { 'class': 'z2m-kv-value' }, htmlesc(runId.runId || _('Unknown')))
		]));

		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Process PID')),
			E('span', { 'class': 'z2m-kv-value' }, htmlesc(runId.pid || _('Unknown')))
		]));

		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Detection Method')),
			E('span', { 'class': 'z2m-kv-value' }, htmlesc(runId.detectionMethod || _('Unknown')))
		]));

		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			htmlesc(runId.note || 'Run ID is inferred from the command line and resets on restart.')));

		return node;
	},

	// ---- Parse Warnings Section (Slice 3) ----
	parseWarningsSection: function (parseWarnings, parseWarningsError) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Parse Warnings'))
		]);

		if (parseWarningsError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Parse warnings unavailable: ') + htmlesc(parseWarningsError)));
			return node;
		}

		parseWarnings = parseWarnings || {};
		if (!parseWarnings.count) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('No parse warnings detected. System is running clean.')));
			return node;
		}

		node.appendChild(E('div', { 'class': 'z2m-callout' }, [
			E('strong', {}, String(parseWarnings.total) + ' warnings/errors detected'),
			E('br', {}),
			htmlesc(parseWarnings.note || 'Clear warnings by restarting nfqws2.')
		]));

		if (length(parseWarnings.warnings) > 0) {
			node.appendChild(E('div', { 'class': 'z2m-section-block', 'style': 'margin-top: 1em' }, [
				E('h4', {}, _('Warnings (' + length(parseWarnings.warnings) + ')')),
				E('div', { 'class': 'z2m-table-wrap' },
					E('table', { 'class': 'table' },
						parseWarnings.warnings.map(function (w) {
							return E('tr', {}, E('td', {}, htmlesc(w)));
						})))
			]));
		}

		if (length(parseWarnings.errors) > 0) {
			node.appendChild(E('div', { 'class': 'z2m-section-block', 'style': 'margin-top: 1em' }, [
				E('h4', {}, _('Errors (' + length(parseWarnings.errors) + ')')),
				E('div', { 'class': 'z2m-table-wrap' },
					E('table', { 'class': 'table' },
						parseWarnings.errors.map(function (e) {
							return E('tr', {}, E('td', {}, htmlesc(e)));
						})))
			]));
		}

		return node;
	},

	// ---- Technical details (collapsed by default) ----
	technicalDetails: function (st, caps) {
		var body = [];
		var self = this;

		body.push(E('h4', {}, _('Live process argv evidence')));
		if (st.daemonPid) {
			body.push(self.kv(_('PID'), String(st.daemonPid)));
			body.push(self.kv(_('cmdline source'), '/proc/' + st.daemonPid + '/cmdline'));
		}
		body.push(self.kv(_('zapret-auto.lua'), st.engine && st.engine.auto ? _('Loaded') : _('Not loaded')));
		body.push(self.kv(_('zapret-antidpi.lua'), st.engine && st.engine.antidpi ? _('Loaded') : _('Not loaded')));
		body.push(self.kv(_('zapret-lib.lua'), st.engine && st.engine.lib ? _('Loaded') : _('Not loaded')));

		body.push(E('h4', {}, _('Installed Lua bundle')));
		(st.luaFiles || []).forEach(function (f) {
			body.push(E('div', { 'class': 'cbi-value-description' },
				htmlesc(f.path) + ' · sha256 ' + htmlesc(String(f.sha256 || '').substring(0, 16) + '\u2026')));
		});

		body.push(E('h4', {}, _('File hashes')));
		var hashes = [];
		(st.luaFiles || []).forEach(function (f) {
			hashes.push(htmlesc(String(f.sha256 || '')));
		});
		if (hashes.length) body.push(E('pre', { 'class': 'z2m-mono' }, hashes.join('\n')));
		else body.push(self.desc(_('No Lua files detected.')));

		body.push(E('h4', {}, _('Capability matrix')));
		(caps.matrix || []).forEach(function (c) {
			var cls = c.available === true ? 'z2m-badge z2m-badge-ok' : 'z2m-badge z2m-badge-warn';
			body.push(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, htmlesc(c.capability)),
				E('span', { 'class': 'z2m-kv-value' }, [
					E('span', { 'class': cls }, c.available === true ? _('available') : _('unavailable')),
					c.reason ? E('div', { 'class': 'cbi-value-description' }, htmlesc(c.reason)) : E('span', {})
				])
			]));
		});

		body.push(E('h4', {}, _('Raw AUTOHOSTLIST variables')));
		var rawVars = st.autohostlistRaw || {};
		var keys = Object.keys(rawVars).sort();
		if (keys.length) {
			keys.forEach(function (k) {
				body.push(E('div', { 'class': 'cbi-value-description' }, htmlesc(k) + ' = ' + htmlesc(rawVars[k])));
			});
		} else {
			body.push(self.desc(_('None configured.')));
		}

		body.push(E('h4', {}, _('Parser diagnostics')));
		var sem = st.autohostlistSemantic || {};
		var parseErr = sem.parseErrors || [];
		if (parseErr.length) {
			parseErr.forEach(function (err) {
				body.push(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, htmlesc(err)));
			});
		}

		body.push(E('h4', {}, _('Unavailable upstream APIs')));
		body.push(self.desc(_('slm_preload_blocked, slm_preload_locked, slm_preload_history — do not exist in pinned upstream zapret-auto.lua.')));

		body.push(E('h4', {}, _('Exact upstream limitations')));
		body.push(self.desc(_('Autostate is in-process Lua global only, never persisted. No external API exists. The manager observes only what is externally readable without mutation.')));

		return self.collapsible(_('Technical details'), body, false);
	},

	collapsible: function (title, body, defaultOpen) {
		var id = 'z2m-tech-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
		var toggle = E('div', {
			'class': 'z2m-tech-toggle',
			'click': function () {
				var b = document.getElementById(id);
				if (b) b.hidden = !b.hidden;
			}
		}, (defaultOpen ? '\u25BC ' : '\u25B6 ') + htmlesc(title));

		var bodyEl = E('div', { 'class': 'z2m-tech-body', 'id': id }, body);
		if (!defaultOpen) bodyEl.hidden = true;
		return E('div', { 'class': 'z2m-tech-group' }, [toggle, bodyEl]);
	},

	kv: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, htmlesc(label)),
			E('span', { 'class': 'z2m-kv-value' }, typeof value === 'string' ? htmlesc(value) : value)
		]);
	},

	desc: function (text) {
		return E('div', { 'class': 'cbi-value-description' }, htmlesc(text));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});