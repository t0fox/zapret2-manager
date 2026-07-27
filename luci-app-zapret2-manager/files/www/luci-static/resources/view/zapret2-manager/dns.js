'use strict';

// DNS page — DNS upstreams, domain rules, DoH, and the DNS consistency check.
//
// Backend reality: there are NO DNS ubus methods yet (the contract is
// extend-only; dns_* will be added by a later branch). This page therefore:
//   - renders the one DNS fact the status contract HAS today — the
//     dns_consistency health check (status.health.checks[], closed id set);
//   - shows every other section as an honest "Unavailable" panel naming the
//     backend method it waits for;
//   - offers well-known options as EXAMPLE PRESETS ONLY — never presented as
//     the current configuration;
//   - writes nothing: /etc/config/dhcp and network UCI are never touched from
//     the browser — a future backend contract will own all writes.

'require rpc';

const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status' });

const MISSING_METHODS = ['dns_get', 'dns_set', 'dns_validate', 'dns_apply', 'dns_check'];

return L.view.extend({
	title: _('DNS'),

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
		var checks = (data.health && data.health.checks) || [];
		var dnsCheck = null;
		for (var i = 0; i < checks.length; i++)
			if (checks[i] && checks[i].id === 'dns_consistency') { dnsCheck = checks[i]; break; }

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — DNS')),
			E('div', { 'class': 'cbi-value-description' },
				_('DNS upstreams, per-domain DNS rules, and DoH for the bypass path. Read-only until the dns_* backend methods land — this page never writes dhcp/network UCI from the browser.'))
		]);

		if (statusError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Status unavailable: ') + statusError)));
		}

		container.appendChild(this.checkSection(dnsCheck, statusError));

		// Live-config sections — all waiting on dns_get.
		container.appendChild(this.unavailableSection(_('Current DNS upstreams'),
			_('Router DNS upstreams, peer DNS enabled/disabled, and the dnsmasq server list.'), 'dns_get'));
		container.appendChild(this.unavailableSection(_('Domain rules'),
			_('Per-domain DNS rules and a separate DNS for selected sites, plus conflict warnings when rules overlap.'), 'dns_get'));
		container.appendChild(this.unavailableSection(_('DoH endpoint'),
			_('DNS-over-HTTPS endpoint for the bypass path.'), 'dns_get'));
		container.appendChild(this.unavailableSection(_('Applied / draft'),
			_('Whether the shown DNS state is applied or a staged draft.'), 'dns_get'));

		container.appendChild(this.presetsSection());
		container.appendChild(this.actionsSection());

		return container;
	},

	// The one real DNS fact available today: the backend health check.
	checkSection: function (check, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('DNS consistency check'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — status not reported.')));
			return node;
		}
		if (!check) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Check not reported — the backend did not include a dns_consistency result in this collection (absent = not checked; that is different from a null result).')));
			return node;
		}
		var keys = Object.keys(check);
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			var v = check[k];
			node.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, k),
				E('div', { 'class': 'cbi-value-field' },
					v == null ? _('Unavailable (checked, no value)') : (typeof v === 'object' ? JSON.stringify(v) : String(v)))
			]));
		}
		return node;
	},

	unavailableSection: function (title, what, method) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-value-description' }, what),
			E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — requires backend method ') + method +
				_('. Shown as unavailable rather than fabricated.'))
		]);
	},

	// Example presets — clearly labelled, NOT the running configuration. No
	// addresses are invented here: names only, values to be confirmed by the
	// operator when the dns_* methods exist.
	presetsSection: function () {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Known options (example presets — not the current configuration)')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('COMSS DNS')),
				E('div', { 'class': 'cbi-value-field' },
					_('Public DNS family (comss.one) with filtering variants. Upstream addresses are intentionally not hardcoded here — confirm them before use.'))
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('DoH endpoint')),
				E('div', { 'class': 'cbi-value-field' },
					_('DNS-over-HTTPS resolver URL (operator-chosen). Example shape: https://<resolver>/dns-query — shown as a shape, not as a configured value.'))
			]),
			E('div', { 'class': 'cbi-value-description' },
				_('These presets are informational. Applying one will go through the dns_* backend contract once it exists.'))
		]);
	},

	actionsSection: function () {
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button',
			'disabled': 'disabled', 'title': _('Backend method unavailable') }, _('Save DNS draft'));
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Changes')),
			E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [btn]),
			E('div', { 'class': 'cbi-value-description' },
				_('DNS changes require backend methods that are not registered yet: ') +
				MISSING_METHODS.join(', ') +
				_('. This page never edits /etc/config/dhcp or network UCI directly.'))
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
