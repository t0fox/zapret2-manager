'use strict';

// Orchestra page (Phase D) — read-only capability/observability adapter over
// upstream zapret-auto.lua. The engine's packet-time orchestration is
// upstream's; this page REPORTS capabilities and honest unavailable states.
// Nothing here creates a second orchestration layer, and nothing pretends
// autostate/history/events are readable when they are not.

'require rpc';

const callOrchCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
const callOrchStatus = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_status', reject: true });
const callOrchEvents = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_events', reject: true });
const callOrchHistory = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_history', reject: true });

return L.view.extend({
	title: _('Orchestra'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
		}
		return Promise.all([
			grab(callOrchCapabilities), grab(callOrchStatus), grab(callOrchEvents), grab(callOrchHistory)
		]).then(function (r) {
			return {
				capError: r[0].loadError, capabilities: r[0].data,
				statusError: r[1].loadError, status: r[1].data,
				eventsError: r[2].loadError, events: r[2].data,
				historyError: r[3].loadError, history: r[3].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var caps = envelope.capabilities || {};
		var st = envelope.status || {};

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Orchestra')),
			E('div', { 'class': 'cbi-value-description' },
				_('Upstream zapret-auto.lua owns packet-time orchestration (autostate in-process). This page reports what is genuinely observable without mutation — and honestly says what is not. No second orchestration layer exists here.'))
		]);

		if (envelope.capError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Capabilities unavailable: ') + envelope.capError)));
		}
		container.appendChild(this.engineSection(st, envelope.statusError));
		container.appendChild(this.matrixSection(caps));
		container.appendChild(this.unavailableSection(_('Events'), envelope.events, envelope.eventsError));
		container.appendChild(this.unavailableSection(_('History / ratings'), envelope.history, envelope.historyError));
		return container;
	},

	engineSection: function (st, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Engine'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — orchestra_status: ') + statusError));
			return node;
		}
		var eng = st.engineInArgv || {};
		node.appendChild(this.row(_('zapret-auto.lua in live argv'),
			eng.auto === true ? E('span', { 'class': 'zonebadge ok' }, _('loaded')) : E('span', { 'class': 'zonebadge bad' }, _('NOT loaded'))));
		node.appendChild(this.row(_('antidpi / lib'),
			(eng.antidpi === true ? E('span', { 'class': 'zonebadge ok' }, _('antidpi')) : E('span', { 'class': 'zonebadge bad' }, _('antidpi'))) ,
			' ',
			(eng.lib === true ? E('span', { 'class': 'zonebadge ok' }, _('lib')) : E('span', { 'class': 'zonebadge bad' }, _('lib')))));
		node.appendChild(this.row(_('nfqws2 version'), st.nfqws2Version || _('Unavailable')));
		node.appendChild(this.row(_('lua_compat_ver'), st.luaCompatVer != null ? st.luaCompatVer : _('Unavailable')));
		node.appendChild(this.row(_('debug (event output)'),
			st.debugEnabled ? E('span', { 'class': 'zonebadge ok' }, _('enabled')) : E('span', { 'class': 'zonebadge warn' }, _('disabled — no event stream'))));
		var auto = st.autostate || {};
		node.appendChild(this.row(_('autostate persistence'),
			auto.persisted === false
				? E('span', {}, [_('in-process only'), E('span', { 'class': 'cbi-value-description' }, ' — ' + (auto.reason || ''))])
				: _('Unavailable')));

		var vars = st.autohostlist || {};
		var keys = Object.keys(vars).sort();
		if (keys.length) {
			node.appendChild(E('h4', {}, _('Autohostlist config (verbatim from applied config)')));
			keys.forEach(function (k) {
				node.appendChild(E('div', { 'class': 'cbi-value-description' }, k + ' = ' + vars[k]));
			});
		}
		return node;
	},

	matrixSection: function (caps) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Capability matrix')),
			E('div', { 'class': 'cbi-value-description' },
				(caps.upstreamVersion ? _('upstream ') + caps.upstreamVersion + ' · commit ' + String(caps.upstreamCommit || '').substring(0, 10) + '…' : ''))
		]);
		(caps.matrix || []).forEach(function (c) {
			var cls = c.available === true ? 'ok' : 'warn';
			node.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, c.capability),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'zonebadge ' + cls }, c.available === true ? _('available') : _('unavailable')),
					c.reason ? E('div', { 'class': 'cbi-value-description' }, c.reason) : E('span', {}),
					(c.evidence && c.evidence.length)
						? E('div', { 'class': 'cbi-value-description' }, _('evidence: ') + c.evidence.join(' · '))
						: E('span', {})
				])
			]));
		});
		return node;
	},

	unavailableSection: function (title, res, resError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, title)]);
		if (resError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — backend: ') + resError));
			return node;
		}
		res = res || {};
		if (res.available === false) {
			node.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, [
					E('span', { 'class': 'zonebadge warn' }, _('unavailable')),
					' ' + (res.reason || _('no reason reported'))
				]),
				E('p', { 'class': 'cbi-value-description' },
					_('evidence: ') + (res.evidence || []).join(' · ') +
					(res.upstreamVersion ? _(' · upstream ') + res.upstreamVersion : ''))
			]));
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				res.note || _('Reported as unavailable — not an empty list pretending success.')));
		} else {
			node.appendChild(E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.85em' }, JSON.stringify(res, null, 2)));
		}
		return node;
	},

	row: function (label, value, value2, value3) {
		var field = E('div', { 'class': 'cbi-value-field' }, [value]);
		if (value2) field.appendChild(E('span', {}, value2));
		if (value3) field.appendChild(E('span', {}, value3));
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			field
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
