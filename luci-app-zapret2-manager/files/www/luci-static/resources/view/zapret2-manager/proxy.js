'use strict';

// Proxy page (Phase F) — READ-ONLY TG WS Proxy adapter over
// proxy_capabilities + proxy_status.
//
// Honesty rules baked into this page:
//   - capabilities are provider KNOWLEDGE, never installation state;
//   - the canonical Rust provider is MTProto-only (no SOCKS5 mode exists);
//   - nothing is installed → "adapter available / not installed", not an error;
//   - a wildcard listener means "all local interfaces" — WAN reachability is
//     NOT claimed (it depends on firewall policy, which is not scanned);
//   - secret values are never shown (metadata only);
//   - no fake counters, no fake "stopped", no fake active port, no mutation
//     buttons (install/start/stop/config do not exist in this slice — stated
//     as a product fact, not as a load failure).

'require rpc';

const callProxyCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'proxy_capabilities', reject: true });
const callProxyStatus = rpc.declare({ object: 'zapret2-manager', method: 'proxy_status', reject: true });

return L.view.extend({
	title: _('Proxy'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
		}
		return Promise.all([grab(callProxyCapabilities), grab(callProxyStatus)]).then(function (r) {
			return {
				capError: r[0].loadError, capabilities: r[0].data,
				statusError: r[1].loadError, status: r[1].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var caps = envelope.capabilities || {};
		var st = envelope.status || {};
		var provider = caps.provider || {};

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Proxy')),
			E('div', { 'class': 'cbi-value-description' },
				_('Telegram MTProto WebSocket bridge proxy — supervised read-only. The proxy itself is a separate optional package; the manager never embeds it.'))
		]);

		if (envelope.capError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Capabilities unavailable: ') + envelope.capError)));
		}
		if (envelope.statusError) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Status unavailable: ') + envelope.statusError)));
		}

		container.appendChild(this.providerSection(provider, caps));
		container.appendChild(this.stateSection(st, envelope.statusError));
		container.appendChild(this.listenersSection(st));
		container.appendChild(this.filesSection(st));
		container.appendChild(this.warningsSection(st));
		container.appendChild(this.constraintsSection(caps));
		container.appendChild(this.controlSection());
		return container;
	},

	// ---- canonical provider (knowledge, not installation state) ---------------

	providerSection: function (provider, caps) {
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Canonical provider (recommended)'))
		]);
		if (!provider.id) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable')));
			return node;
		}
		node.appendChild(this.row(_('Provider'), provider.name || provider.id));
		node.appendChild(this.row(_('Pinned release'), (provider.release || _('Unavailable')) + ' · ' + String(provider.sourceCommit || '').substring(0, 10) + '…'));
		node.appendChild(this.row(_('License'), provider.license || _('Unavailable')));
		node.appendChild(this.row(_('Protocol'), [
			E('span', { 'class': 'zonebadge ok' }, _('MTProto')),
			' ',
			E('span', { 'class': 'zonebadge warn' }, _('SOCKS5: not supported')),
			E('div', { 'class': 'cbi-value-description' },
				_('The Rust provider is an MTProto bridge by design — it has no --mode flag and no SOCKS5 server mode.'))
		]));
		node.appendChild(this.row(_('Pinned asset'), provider.asset || _('Unavailable')));
		node.appendChild(this.row(_('Asset SHA-256'), E('code', {}, provider.assetSha256 || _('Unavailable'))));
		node.appendChild(this.row(_('Target ABI'), provider.abi || _('Unavailable')));
		node.appendChild(this.row(_('Default port'),
			(provider.defaultPort != null ? String(provider.defaultPort) : _('Unavailable')) + ' — ' + _('provider knowledge, not an active listener')));
		node.appendChild(this.row(_('Upstream'), provider.upstreamUrl || _('Unavailable')));
		if (caps.adr)
			node.appendChild(this.row(_('Decision record'), caps.adr));
		var rejected = caps.rejectedAlternatives || [];
		if (rejected.length) {
			node.appendChild(E('h4', {}, _('Rejected alternatives')));
			rejected.forEach(function (a) {
				node.appendChild(E('div', { 'class': 'cbi-value-description' },
					(a.id || '?') + ' (' + (a.release || '?') + ', ' + (a.license || '?') + ') — ' + (a.reason || '')));
			});
		}
		return node;
	},

	// ---- live state --------------------------------------------------------------

	stateSection: function (st, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('State'))]);
		if (statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — proxy_status: ') + statusError));
			return node;
		}
		if (st.installed === false) {
			node.appendChild(E('div', { 'class': 'alert-message' }, [
				E('p', {}, [
					E('span', { 'class': 'zonebadge ok' }, _('adapter operational')),
					' ',
					E('span', { 'class': 'zonebadge warn' }, _('proxy not installed'))
				]),
				E('p', { 'class': 'cbi-value-description' },
					st.note || _('Read-only adapter is operational; TG WS Proxy is not installed.'))
			]));
		} else {
			node.appendChild(this.row(_('Installed'),
				st.installed === true ? E('span', { 'class': 'zonebadge ok' }, _('yes')) : _('Unavailable')));
			var det = st.detectedProvider || null;
			node.appendChild(this.row(_('Detected provider'),
				det ? (det.id + (det.basis ? ' (' + det.basis + ')' : '')) : _('Unavailable')));
			node.appendChild(this.row(_('Package version'), st.packageVersion || _('Unavailable')));
			node.appendChild(this.row(_('Binary'), st.selectedBinary || _('Unavailable')));
			var stateBadge;
			if (st.state === 'running') stateBadge = E('span', { 'class': 'zonebadge ok' }, _('running'));
			else if (st.state === 'stopped') stateBadge = E('span', { 'class': 'zonebadge warn' }, _('stopped'));
			else if (st.state === 'unknown') stateBadge = E('span', { 'class': 'zonebadge warn' }, _('unknown (process probe incomplete)'));
			else stateBadge = _('Unavailable');
			node.appendChild(this.row(_('Process state'), stateBadge));
			node.appendChild(this.row(_('PIDs'),
				(st.pids && st.pids.length) ? st.pids.join(', ') : _('none')));
			var init = st.init || {};
			node.appendChild(this.row(_('Init script'), init.present === true ? _('present') : _('absent')));
			node.appendChild(this.row(_('Enabled (autostart)'),
				init.enabled === true ? E('span', { 'class': 'zonebadge ok' }, _('enabled')) : E('span', { 'class': 'zonebadge warn' }, _('disabled'))));
			node.appendChild(this.row(_('Mode'), this.modeBadge(st)));
		}
		var arch = st.architecture || {};
		var archBadge;
		if (arch.compatible === true) archBadge = E('span', { 'class': 'zonebadge ok' }, _('compatible'));
		else if (arch.compatible === false) archBadge = E('span', { 'class': 'zonebadge bad' }, _('unsupported'));
		else archBadge = E('span', { 'class': 'zonebadge warn' }, _('unknown'));
		node.appendChild(this.row(_('Architecture'), [
			archBadge,
			E('span', { 'class': 'cbi-value-description' },
				' — ' + (arch.reason || _('Unavailable')))
		]));
		return node;
	},

	modeBadge: function (st) {
		if (st.mode === 'mtproto') return E('span', { 'class': 'zonebadge ok' }, _('MTProto'));
		if (st.mode === 'unknown')
			return E('span', { 'class': 'zonebadge warn' },
				_('unknown (unidentified provider — never assumed SOCKS5)'));
		if (st.mode) return E('span', {}, st.mode);
		return _('Unavailable');
	},

	// ---- listeners -----------------------------------------------------------------

	listenersSection: function (st) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Listeners'))]);
		var probes = st.probes || {};
		if (probes.netstat === 'unavailable') {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Unavailable — the netstat probe is unavailable; listeners cannot be enumerated (absent listeners are not claimed either).')));
			return node;
		}
		var listeners = st.listeners || [];
		if (!listeners.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('No listeners detected. The provider default port (1443) is knowledge only — it is not shown as active.')));
			return node;
		}
		listeners.forEach(function (l) {
			var cls = l.classification || 'specific';
			var badgeCls = (cls === 'loopback' || cls === 'lan') ? 'ok' : 'warn';
			node.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, (l.protocol || '?') + ' ' + (l.address || '?') + ':' + (l.port != null ? l.port : '?')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'zonebadge ' + badgeCls }, cls),
					' ',
					E('span', { 'class': 'cbi-value-description' },
						(l.pid != null ? 'pid ' + l.pid : (l.process || _('unknown owner'))))
				])
			]));
			if (cls === 'wildcard') {
				node.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('Wildcard: the process listens on all local interfaces. WAN-side reachability was not actively tested and depends on firewall policy (not scanned here).')));
			}
		});
		return node;
	},

	// ---- files (config/secret/log metadata — never secret content) --------------------

	filesSection: function (st) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Files (metadata only)'))]);
		var cfg = st.config || {};
		node.appendChild(this.row(_('Config'),
			cfg.exists === true
				? _('present') + ' (' + (cfg.size != null ? cfg.size : '?') + ' B' + (cfg.readable === false ? ', ' + _('unreadable') : '') + ')'
				: _('absent')));
		var parsed = cfg.parsed || {};
		var keys = Object.keys(parsed).sort().filter(function (k) {
			// defense in depth: even if a backend ever sent a secret-shaped key,
			// this page must not render it (the backend allowlist is the primary
			// gate — this is the second fence).
			return !/secret|token|pass|key|seed/i.test(k);
		});
		if (keys.length) {
			keys.forEach(function (k) {
				node.appendChild(E('div', { 'class': 'cbi-value-description' }, k + ' = ' + parsed[k]));
			});
		}
		var sec = st.secret || {};
		var secText;
		if (sec.exists === true) {
			if (sec.securePermissions === true)
				secText = _('present — permissions ') + (sec.modeOctal || '?') + _(' (secure)');
			else if (sec.securePermissions === false)
				secText = _('present — permissions ') + (sec.modeOctal || '?') + _(' (TOO BROAD — expected 0600)');
			else
				secText = _('present — permissions unavailable');
		} else {
			secText = _('absent');
		}
		node.appendChild(this.row(_('Secret file'), secText));
		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('The secret value is never read, displayed, or transmitted — metadata only.')));
		var lg = st.log || {};
		node.appendChild(this.row(_('Log'),
			lg.exists === true
				? _('present') + ' (' + (lg.size != null ? lg.size : '?') + ' B)'
				: _('absent')));
		return node;
	},

	// ---- warnings -----------------------------------------------------------------------

	warningsSection: function (st) {
		var warnings = st.warnings || [];
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Warnings'))]);
		if (!warnings.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('none')));
			return node;
		}
		warnings.forEach(function (w) {
			node.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, [E('strong', {}, (w.code || '?') + ': '), w.message || ''])
			]));
		});
		return node;
	},

	// ---- constraints -----------------------------------------------------------------------

	constraintsSection: function (caps) {
		var constraints = caps.constraints || [];
		if (!constraints.length) return E('div', {});
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Constraints'))]);
		constraints.forEach(function (c) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, '• ' + c));
		});
		return node;
	},

	// ---- control (honest read-only statement — no fake buttons) ------------------------------

	controlSection: function () {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Control')),
			E('div', { 'class': 'cbi-value-description' },
				_('This slice is read-only: install, start, stop, restart, configure, and secret rotation intentionally do not exist as methods. They will arrive with the future trusted package slice — not as disabled buttons pretending to work.'))
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
