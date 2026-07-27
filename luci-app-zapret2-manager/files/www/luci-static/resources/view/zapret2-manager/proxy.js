'use strict';

// Proxy page — Telegram WebSocket Proxy (planned: Rust/Go implementation).
//
// Backend reality: there is NO proxy ubus object and no proxy methods today.
// This page is therefore an honest informative empty state:
//   - every field renders "Unavailable" — no invented counters, no fake
//     "stopped" state;
//   - start/stop/restart render DISABLED with the exact method names they
//     wait for;
//   - the manager does not implement the proxy itself and never will from
//     the browser side (no shell, no SSH from JS).

'require rpc';

const MISSING_METHODS = [
	'proxy_status', 'proxy_install', 'proxy_start', 'proxy_stop', 'proxy_restart'
];

return L.view.extend({
	title: _('Proxy'),

	load: function () {
		// No proxy RPC exists on the bus to probe (there is no object list call
		// available to the frontend either). The resolved envelope below is the
		// explicit "nothing to load" path; the .catch keeps the page safe the
		// day a real probe replaces it — a rejected promise must never hang
		// this view.
		return Promise.resolve({ loadError: null, data: null })
			.catch(function (err) {
				return { loadError: String(err), data: null };
			});
	},

	render: function (envelope) {
		envelope = envelope || { loadError: null, data: null };

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Proxy')),
			E('div', { 'class': 'cbi-value-description' },
				_('Telegram WebSocket Proxy — a planned companion service (Rust/Go implementation). The manager will only supervise it; the proxy itself is a separate component.'))
		]);

		if (envelope.loadError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Load failed: ') + envelope.loadError)));
		}

		container.appendChild(E('div', { 'class': 'alert-message' }, [
			E('p', {}, _('Proxy backend is not installed / not registered on the bus.')),
			E('p', {}, _('Every field below is "Unavailable" by design: with no backend contract there is no truthful value to show.'))
		]));

		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			this.row(_('Installed'), _('Unavailable')),
			this.row(_('State'), _('Unavailable')),
			this.row(_('Implementation'), _('Unavailable (Rust / Go / unknown)')),
			this.row(_('Listen address'), _('Unavailable')),
			this.row(_('Port'), _('Unavailable')),
			this.row(_('Upstream'), _('Unavailable')),
			this.row(_('Active connections'), _('Unavailable')),
			this.row(_('Traffic counters'), _('Unavailable')),
			this.row(_('Autostart'), _('Unavailable')),
			this.row(_('Last error'), _('Unavailable'))
		]));

		container.appendChild(this.actionsSection());

		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Required backend methods')),
			E('div', { 'class': 'cbi-value-description' },
				_('For this page to become functional, the backend must register: ') +
				MISSING_METHODS.join(', ') + '.'),
			E('div', { 'class': 'cbi-value-description' },
				_('No counters or states are shown until then — an unavailable value is never replaced by a fabricated one.'))
		]));

		return container;
	},

	actionsSection: function () {
		var buttons = [_('Start'), _('Stop'), _('Restart')].map(function (n) {
			return E('button', {
				'class': 'cbi-button cbi-button-neutral', 'type': 'button',
				'disabled': 'disabled', 'title': _('Backend method unavailable')
			}, n);
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Control')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, buttons),
			E('div', { 'class': 'cbi-value-description' },
				_('Start/Stop/Restart require backend methods that are not registered yet: ') +
				MISSING_METHODS.join(', ') + '.')
		]);
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
