'use strict';

// Proxy page (Phase F) — FUNCTIONAL TG WS Proxy adapter.
//
// Honesty rules baked into this page:
//   - capabilities are provider KNOWLEDGE, never installation state;
//   - the canonical Rust provider is MTProto-only (no SOCKS5 mode exists);
//   - install is NEVER a LuCI action: the optional package arrives only via
//     the signed feed workflow — this page has no download/install button;
//   - a wildcard listener means "all local interfaces" — WAN reachability is
//     NOT claimed (it depends on firewall policy, which is not scanned; the
//     manager installs no firewall rules in v1);
//   - the secret VALUE is never rendered: status/config carry metadata only,
//     the full tg:// link requires a two-step guarded reveal and is shown
//     only after an explicit confirmation;
//   - buttons that cannot succeed right now (nothing installed) are DISABLED
//     with the reason shown — no fake buttons;
//   - the UI is thin: it never builds shell commands or parses files; every
//     action is one ubus call with a JSON-string `edit` payload.

'require rpc';

const callProxyCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'proxy_capabilities', reject: true });
const callProxyStatus = rpc.declare({ object: 'zapret2-manager', method: 'proxy_status', reject: true });
const callProxyConfigGet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_get', reject: true });
const callProxyConfigValidate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_validate', params: ['edit'], reject: true });
const callProxyConfigPreview = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_preview', params: ['edit'], reject: true });
const callProxyConfigApply = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_apply', params: ['edit'], reject: true });
const callProxyStart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_start', reject: true });
const callProxyStop = rpc.declare({ object: 'zapret2-manager', method: 'proxy_stop', reject: true });
const callProxyRestart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_restart', reject: true });
const callProxyAutostartSet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_autostart_set', params: ['edit'], reject: true });
const callProxySecretRotate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_secret_rotate', reject: true });
const callProxyLogsTail = rpc.declare({ object: 'zapret2-manager', method: 'proxy_logs_tail', params: ['edit'], reject: true });
const callProxyHealth = rpc.declare({ object: 'zapret2-manager', method: 'proxy_health', params: ['edit'], reject: true });
const callProxyLinkInfo = rpc.declare({ object: 'zapret2-manager', method: 'proxy_link_info', params: ['edit'], reject: true });

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
		return Promise.all([grab(callProxyCapabilities), grab(callProxyStatus), grab(callProxyConfigGet)]).then(function (r) {
			return {
				capError: r[0].loadError, capabilities: r[0].data,
				statusError: r[1].loadError, status: r[1].data,
				cfgError: r[2].loadError, configGet: r[2].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var self = this;
		self._env = envelope;
		self._f = {};
		self._armed = {};

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Proxy')),
			E('div', { 'class': 'cbi-value-description' },
				_('Telegram MTProto WebSocket bridge proxy — supervised by the manager. The proxy itself is a separate optional package; the manager never embeds it and never downloads it at runtime.'))
		]);
		self._root = container;

		[['capError', _('Capabilities unavailable: '), envelope.capError],
		 ['statusError', _('Status unavailable: '), envelope.statusError],
		 ['cfgError', _('Configuration unavailable: '), envelope.cfgError]].forEach(function (e) {
			if (e[2]) container.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, e[1] + e[2])));
		});

		container.appendChild(this.providerSection(envelope));
		container.appendChild(this.runtimeSection(envelope));
		container.appendChild(this.configSection(envelope));
		container.appendChild(this.secretSection(envelope));
		container.appendChild(this.controlSection(envelope));
		container.appendChild(this.diagnosticsSection(envelope));
		return container;
	},

	installed: function (env) {
		var st = (env || this._env || {}).status || {};
		return st.installed === true;
	},

	// ---- 1. provider / package ----------------------------------------------------

	providerSection: function (envelope) {
		var caps = envelope.capabilities || {};
		var provider = caps.provider || {};
		var st = envelope.status || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Provider / package'))]);
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
		node.appendChild(this.row(_('Pinned asset'), (provider.asset || _('Unavailable'))));
		node.appendChild(this.row(_('Asset SHA-256'), E('code', {}, provider.assetSha256 || _('Unavailable'))));
		node.appendChild(this.row(_('Default port'),
			(provider.defaultPort != null ? String(provider.defaultPort) : _('Unavailable')) + ' — ' + _('provider knowledge, not an active listener')));

		var pkgBadge;
		if (st.installed === true) pkgBadge = E('span', { 'class': 'zonebadge ok' }, _('installed') + (st.packageVersion ? ' ' + st.packageVersion : ''));
		else if (st.installed === false) pkgBadge = E('span', { 'class': 'zonebadge warn' }, _('not installed'));
		else pkgBadge = _('Unavailable');
		node.appendChild(this.row(_('Package'), [
			pkgBadge,
			E('div', { 'class': 'cbi-value-description' },
				_('Installation happens only through the signed feed workflow (pinned asset + APK signature) — never from this page, never with --allow-untrusted.'))
		]));

		var arch = st.architecture || {};
		var archBadge;
		if (arch.compatible === true) archBadge = E('span', { 'class': 'zonebadge ok' }, _('compatible'));
		else if (arch.compatible === false) archBadge = E('span', { 'class': 'zonebadge bad' }, _('unsupported'));
		else archBadge = E('span', { 'class': 'zonebadge warn' }, _('unknown'));
		node.appendChild(this.row(_('Architecture'), [archBadge, E('span', { 'class': 'cbi-value-description' }, ' — ' + (arch.reason || _('Unavailable')))]));
		return node;
	},

	// ---- 2. runtime -----------------------------------------------------------------

	runtimeSection: function (envelope) {
		var st = envelope.status || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Runtime'))]);
		if (envelope.statusError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — proxy_status: ') + envelope.statusError));
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
					st.note || _('TG WS Proxy adapter is operational; the optional proxy package is not installed.'))
			]));
		} else {
			var stateBadge;
			if (st.state === 'running') stateBadge = E('span', { 'class': 'zonebadge ok' }, _('running'));
			else if (st.state === 'stopped') stateBadge = E('span', { 'class': 'zonebadge warn' }, _('stopped'));
			else if (st.state === 'unknown') stateBadge = E('span', { 'class': 'zonebadge warn' }, _('unknown (process probe incomplete)'));
			else stateBadge = _('Unavailable');
			node.appendChild(this.row(_('Service state'), stateBadge));
			node.appendChild(this.row(_('Binary'), st.selectedBinary || _('Unavailable')));
			node.appendChild(this.row(_('PID'), (st.pids && st.pids.length) ? st.pids.join(', ') : _('none')));
			var listeners = st.listeners || [];
			if (listeners.length) {
				listeners.forEach(function (l) {
					var cls = l.classification || 'specific';
					var badgeCls = (cls === 'loopback' || cls === 'lan') ? 'ok' : 'warn';
					node.appendChild(E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Listener')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('span', {}, (l.protocol || '?') + ' ' + (l.address || '?') + ':' + (l.port != null ? l.port : '?')),
							' ',
							E('span', { 'class': 'zonebadge ' + badgeCls }, cls),
							' ',
							E('span', { 'class': 'cbi-value-description' }, (l.pid != null ? 'pid ' + l.pid : (l.process || _('unknown owner'))))
						])
					]));
					if (cls === 'wildcard')
						node.appendChild(E('div', { 'class': 'cbi-value-description' },
							_('Wildcard: the process listens on all local interfaces. WAN-side reachability was not actively tested and depends on firewall policy (not scanned here; the manager installs no firewall rules in v1).')));
				});
			} else {
				node.appendChild(this.row(_('Listener'), _('none — no active listener (the provider default port is knowledge only, never shown as active)')));
			}
			var init = st.init || {};
			node.appendChild(this.row(_('Autostart'),
				init.enabled === true ? E('span', { 'class': 'zonebadge ok' }, _('enabled')) : E('span', { 'class': 'zonebadge warn' }, _('disabled'))));
			node.appendChild(this.row(_('Mode'), this.modeBadge(st)));
		}
		var warnings = st.warnings || [];
		if (warnings.length) {
			node.appendChild(E('h4', {}, _('Warnings')));
			warnings.forEach(function (w) {
				node.appendChild(E('div', { 'class': 'alert-message warning' }, [
					E('p', {}, [E('strong', {}, (w.code || '?') + ': '), w.message || ''])
				]));
			});
		}
		return node;
	},

	modeBadge: function (st) {
		if (st.mode === 'mtproto') return E('span', { 'class': 'zonebadge ok' }, _('MTProto'));
		if (st.mode === 'unknown')
			return E('span', { 'class': 'zonebadge warn' }, _('unknown (unidentified provider — never assumed SOCKS5)'));
		if (st.mode) return E('span', {}, st.mode);
		return _('Unavailable');
	},

	// ---- 3. configuration -----------------------------------------------------------

	configSection: function (envelope) {
		var self = this;
		var cg = envelope.configGet || {};
		var draft = cg.draft || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Configuration'))]);
		if (envelope.cfgError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — proxy_config_get: ') + envelope.cfgError));
			return node;
		}
		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('Manager-owned configuration. Draft edits are validated and previewed before anything is written; apply is atomic with snapshot + verified rollback. Upstream proxy secrets are never shown: unchanged entries keep their stored secret.')));

		function textField(key, label, value, placeholder) {
			var inp = E('input', { 'class': 'cbi-input-text', type: 'text', id: 'px-' + key, placeholder: placeholder || '' });
			inp.value = (value != null ? String(value) : '');
			self._f[key] = inp;
			node.appendChild(self.row(label, inp));
		}
		function boolField(key, label, checked) {
			var inp = E('input', { type: 'checkbox', id: 'px-' + key });
			inp.checked = (checked === true);
			self._f[key] = inp;
			node.appendChild(self.row(label, inp));
		}
		function areaField(key, label, lines, placeholder) {
			var ta = E('textarea', { 'class': 'cbi-input-text', rows: '3', id: 'px-' + key, placeholder: placeholder || '' });
			ta.value = (lines || '');
			self._f[key] = ta;
			node.appendChild(self.row(label, ta));
		}

		boolField('enabled', _('Enabled'), draft.enabled === true);
		boolField('autostart', _('Start at boot (autostart)'), draft.autostart === true);
		textField('host', _('Listen address (LAN IPv4 or 127.x)'), draft.host, '192.168.1.1');
		textField('port', _('Listen port'), (draft.port != null ? draft.port : 1443), '1443');
		textField('linkIp', _('Link address (tg:// link IP; empty = listen address)'), draft.linkIp, '');
		textField('faketlsDomain', _('FakeTLS SNI domain (empty = classic dd mode)'), draft.faketlsDomain, 'www.yandex.ru');
		areaField('dcIps', _('Telegram DC mappings (DC:IPv4, comma or newline)'), (draft.dcIps || []).join('\n'), '2:149.154.167.220');
		areaField('cfDomains', _('Cloudflare domains (comma or newline)'), (draft.cfDomains || []).join('\n'), 'proxy.example.com');
		areaField('cfWorkerDomains', _('Cloudflare Worker domains'), (draft.cfWorkerDomains || []).join('\n'), 'name.user.workers.dev');
		boolField('cfPriority', _('Cloudflare priority (CF before direct WS)'), draft.cfPriority === true);
		boolField('cfBalance', _('Cloudflare round-robin balance'), draft.cfBalance === true);
		boolField('defaultDomains', _('Use upstream default CF domain list'), draft.defaultDomains === true);

		var proxyLines = (draft.mtprotoProxies || []).map(function (e) { return e.host + ':' + e.port; }).join('\n');
		areaField('mtprotoProxies', _('Upstream MTProto fallback (host:port:secret; unchanged host:port keeps its secret)'), proxyLines, 'proxy.example.com:443:dd…');
		textField('outboundProxy', _('Outbound proxy (http/socks5/socks5h URL; empty = direct)'), draft.outboundProxy, 'socks5h://127.0.0.1:1080');
		textField('noProxy', _('Outbound proxy bypass list'), draft.noProxy, 'localhost,127.0.0.1');
		textField('poolSize', _('WS pool size per DC'), (draft.poolSize != null ? draft.poolSize : 4), '4');
		textField('bufKb', _('Socket buffer (KiB)'), (draft.bufKb != null ? draft.bufKb : 256), '256');
		textField('maxConnections', _('Max connections (0 = auto)'), (draft.maxConnections != null ? draft.maxConnections : 0), '0');
		boolField('quiet', _('Quiet logging'), draft.quiet === true);
		boolField('verbose', _('Verbose (debug) logging'), draft.verbose === true);

		// actions: validate → preview → apply (the backend validates richly;
		// the UI never pre-judges)
		var applyBtn = E('button', { 'class': 'cbi-button cbi-button-apply' }, _('Apply'));
		applyBtn.addEventListener('click', function () { self.doApply(); });
		if (!this.installed(envelope)) applyBtn.disabled = true;
		var previewBtn = E('button', { 'class': 'cbi-button' }, _('Preview'));
		previewBtn.addEventListener('click', function () { self.doPreview(); });
		var validateBtn = E('button', { 'class': 'cbi-button' }, _('Validate'));
		validateBtn.addEventListener('click', function () { self.doValidate(); });
		node.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Review & write')),
			E('div', { 'class': 'cbi-value-field' }, [validateBtn, ' ', previewBtn, ' ', applyBtn])
		]));
		if (!this.installed(envelope))
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Apply is disabled: the optional package is not installed. Preview/Validate still answer honestly (including the missing-package finding).')));
		var result = E('div', { id: 'px-config-result' });
		self._f.configResult = result;
		node.appendChild(result);
		return node;
	},

	// read the form into a config object (thin — backend validates)
	readConfig: function () {
		var f = this._f || {};
		function txt(k) { return f[k] ? String(f[k].value || '').trim() : ''; }
		function bool(k) { return f[k] ? (f[k].checked === true) : false; }
		function list(k) {
			var raw = f[k] ? String(f[k].value || '') : '';
			return raw.split(/[\n,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
		}
		var cfg = {
			enabled: bool('enabled'),
			autostart: bool('autostart'),
			host: txt('host'),
			port: txt('port'),
			linkIp: txt('linkIp'),
			faketlsDomain: txt('faketlsDomain'),
			dcIps: list('dcIps'),
			cfDomains: list('cfDomains'),
			cfWorkerDomains: list('cfWorkerDomains'),
			cfPriority: bool('cfPriority'),
			cfBalance: bool('cfBalance'),
			defaultDomains: bool('defaultDomains'),
			outboundProxy: txt('outboundProxy'),
			noProxy: txt('noProxy'),
			poolSize: txt('poolSize'),
			bufKb: txt('bufKb'),
			maxConnections: txt('maxConnections'),
			quiet: bool('quiet'),
			verbose: bool('verbose')
		};
		// upstream proxies: an unchanged "host:port" line keeps its stored
		// secret (keepSecret); anything else is treated as a full
		// host:port:secret entry and validated by the backend.
		var meta = (((this._env || {}).configGet || {}).draft || {}).mtprotoProxies || [];
		var metaKeys = {};
		meta.forEach(function (e) { metaKeys[e.host + ':' + e.port] = true; });
		cfg.mtprotoProxies = list('mtprotoProxies').map(function (line) {
			if (metaKeys[line]) {
				var parts = line.split(':');
				return { host: parts[0], port: parseInt(parts[1], 10), keepSecret: true };
			}
			return line;
		});
		return cfg;
	},

	renderIssueList: function (panel, title, ok, errors, warnings) {
		panel.appendChild(E('div', { 'class': ok ? 'alert-message' : 'alert-message warning' }, [
			E('p', {}, [E('strong', {}, title + ': '), ok ? _('no blocking errors') : _('failed')])
		]));
		(errors || []).forEach(function (e) {
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, (e.field ? e.field + ': ' : '') + (e.code ? e.code + ' — ' : '') + (e.message || ''))));
		});
		(warnings || []).forEach(function (e) {
			panel.appendChild(E('div', { 'class': 'cbi-value-description' }, (e.field ? e.field + ': ' : '') + (e.message || '')));
		});
	},

	doValidate: function () {
		var self = this;
		var panel = self._f.configResult;
		panel.children.length = 0;
		var cfg = self.readConfig();
		callProxyConfigValidate(JSON.stringify({ config: cfg })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				self.renderIssueList(panel, _('Validate'), false, [res.error], []);
				return;
			}
			self.renderIssueList(panel, _('Validate'), res.ok === true, res.errors, res.warnings);
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Validate RPC failed: ') + String(err))));
		});
	},

	doPreview: function () {
		var self = this;
		var panel = self._f.configResult;
		panel.children.length = 0;
		var cfg = self.readConfig();
		callProxyConfigPreview(JSON.stringify({ config: cfg })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				self.renderIssueList(panel, _('Preview'), false, [res.error].concat(res.errors || []), res.warnings);
				return;
			}
			panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, [
				E('strong', {}, _('Preview (no writes): ')),
				_('service: ') + (res.serviceAction || '?') + ', ' +
				_('autostart: ') + (res.autostartAction || '?') + ', ' +
				_('secret: ') + (res.secretAction || '?') + ', ' +
				_('listener: ') + ((res.listenerImpact || {}).change || '?') + ', ' +
				_('revision precondition: ') + (((res.precondition || {}).appliedRevision != null) ? res.precondition.appliedRevision : '?')
			])));
			var diff = res.diff || [];
			if (!diff.length) panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('no field changes')));
			diff.forEach(function (ch) {
				panel.appendChild(E('div', { 'class': 'cbi-value-description' },
					ch.field + ': ' + JSON.stringify(ch.from) + ' → ' + JSON.stringify(ch.to)));
			});
			(res.rollbackPlan || []).forEach(function (step, i) {
				panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('rollback ') + (i + 1) + ': ' + step));
			});
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Preview RPC failed: ') + String(err))));
		});
	},

	doApply: function () {
		var self = this;
		var panel = self._f.configResult;
		panel.children.length = 0;
		var cfg = self.readConfig();
		var rev = (((self._env || {}).configGet || {}).appliedRevision);
		callProxyConfigApply(JSON.stringify({ config: cfg, expectedAppliedRevision: (rev != null ? rev : 0) })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true) {
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, [
					E('strong', {}, _('Applied: ')),
					_('revision ') + res.revision + ', ' + _('service: ') + res.serviceAction + ', ' +
					_('autostart: ') + res.autostartAction + ', ' + _('secret: ') + res.secretAction +
					((res.reread && res.reread.listeners && res.reread.listeners.length)
						? (', ' + _('listener: ') + res.reread.listeners[0].address + ':' + res.reread.listeners[0].port)
						: '')
				])));
				self.refresh();
				return;
			}
			var errs = [];
			if (res.error && typeof res.error === 'object') errs.push(res.error);
			errs = errs.concat(res.errors || []).concat(res.failures || []);
			self.renderIssueList(panel, _('Apply') + (res.rolledBack ? _(' (rolled back)') : ''), false, errs, []);
			if (res.error && res.error.code === 'ECONFLICT')
				panel.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('The applied config moved since this page loaded — reload the page and re-preview before retrying.')));
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Apply RPC failed: ') + String(err))));
		});
	},

	// ---- 4. secret -----------------------------------------------------------------

	secretSection: function (envelope) {
		var self = this;
		var cg = envelope.configGet || {};
		var sec = cg.secret || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Secret'))]);
		var secText;
		if (envelope.cfgError) secText = _('Unavailable');
		else if (sec.exists === true) {
			if (sec.securePermissions === true) secText = _('configured — permissions ') + (sec.modeOctal || '?') + _(' (secure)');
			else if (sec.securePermissions === false) secText = _('configured — permissions ') + (sec.modeOctal || '?') + _(' (TOO BROAD — expected 0600)');
			else secText = _('configured — permissions unavailable');
		} else secText = _('not configured (generated on first enable or rotate)');
		node.appendChild(this.row(_('MTProto secret'), secText));
		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('The secret is generated from a CSPRNG, stored root-only at 0600, passed to the provider via environment only (never argv), and never displayed, logged, or backed up by the manager.')));

		var rotateBtn = E('button', { 'class': 'cbi-button cbi-button-negative' }, _('Rotate secret'));
		rotateBtn.addEventListener('click', function () { self.doRotate(rotateBtn); });
		if (!this.installed(envelope)) rotateBtn.disabled = true;
		node.appendChild(this.row(_('Rotation'), [rotateBtn]));
		var panel = E('div', { id: 'px-secret-result' });
		self._f.secretResult = panel;
		node.appendChild(panel);
		return node;
	},

	doRotate: function (btn) {
		var self = this;
		var panel = self._f.secretResult;
		if (!self._armed.rotate) {
			self._armed.rotate = true;
			btn.textContent = _('Confirm rotation — every Telegram client must update the secret');
			return;
		}
		self._armed.rotate = false;
		btn.disabled = true;
		callProxySecretRotate().then(function (res) {
			btn.disabled = false;
			btn.textContent = _('Rotate secret');
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true)
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					_('Secret rotated') + (res.restarted ? _(' and the service restarted (listener verified)') : _(' (service was stopped)')) + '. ' + _('The new value is stored at 0600 and never shown.'))));
			else
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Rotation failed: ') + ((res.error && res.error.message) || _('unknown error')))));
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			btn.textContent = _('Rotate secret');
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Rotate RPC failed: ') + String(err))));
		});
	},

	// ---- 5. control -----------------------------------------------------------------

	controlSection: function (envelope) {
		var self = this;
		var st = envelope.status || {};
		var cg = envelope.configGet || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Control'))]);
		var installed = this.installed(envelope);

		function actionBtn(label, call) {
			var b = E('button', { 'class': 'cbi-button' }, label);
			b.addEventListener('click', function () { self.doControl(label, b, call); });
			if (!installed) b.disabled = true;
			return b;
		}
		node.appendChild(this.row(_('Service'), [
			actionBtn(_('Start'), callProxyStart), ' ',
			actionBtn(_('Stop'), callProxyStop), ' ',
			actionBtn(_('Restart'), callProxyRestart)
		]));

		var auto = cg.autostart || {};
		var autoBtn = E('button', { 'class': 'cbi-button' },
			auto.rcDEnabled === true ? _('Disable autostart') : _('Enable autostart'));
		autoBtn.addEventListener('click', function () { self.doAutostart(autoBtn, auto.rcDEnabled !== true); });
		if (!installed) autoBtn.disabled = true;
		node.appendChild(this.row(_('Autostart'), [autoBtn]));
		if (auto.drift === true)
			node.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, auto.message || _('autostart drift'))));
		if (!installed)
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Controls are disabled: the optional package is not installed. Installation is a signed-feed action, never a button here.')));
		var panel = E('div', { id: 'px-control-result' });
		self._f.controlResult = panel;
		node.appendChild(panel);
		return node;
	},

	doControl: function (label, btn, call) {
		var self = this;
		var panel = self._f.controlResult;
		btn.disabled = true;
		call().then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true) {
				var lis = (res.reread && res.reread.listeners) || [];
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					label + _(': ok') + (lis.length ? (' — ' + _('listener ') + lis[0].address + ':' + lis[0].port) : ''))));
			} else {
				var msg = (res.error && res.error.message) || _('failed');
				var det = (res.failures || []).map(function (f) { return f.message; }).join('; ');
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, label + ': ' + msg + (det ? (' — ' + det) : ''))));
			}
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, label + _(' RPC failed: ') + String(err))));
		});
	},

	doAutostart: function (btn, enable) {
		var self = this;
		var panel = self._f.controlResult;
		btn.disabled = true;
		callProxyAutostartSet(JSON.stringify({ enabled: enable })).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true)
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					_('Autostart ') + (res.enabled ? _('enabled') : _('disabled')) + (res.drift ? _(' (rc.d drift — re-check)') : ''))));
			else
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Autostart failed: ') + ((res.error && res.error.message) || _('unknown error')))));
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Autostart RPC failed: ') + String(err))));
		});
	},

	// ---- 6. diagnostics --------------------------------------------------------------

	diagnosticsSection: function (envelope) {
		var self = this;
		var st = envelope.status || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Diagnostics'))]);

		node.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('Bounded probes only: the health test distinguishes the LOCAL listener from upstream Telegram TCP reachability (an MTProto handshake is never claimed); logs are redacted before display; the manager installs no firewall rules — exposure is governed by the bind address.')));

		var healthBtn = E('button', { 'class': 'cbi-button' }, _('Run health test'));
		healthBtn.addEventListener('click', function () { self.doHealth(healthBtn); });
		var logsBtn = E('button', { 'class': 'cbi-button' }, _('Load redacted logs'));
		logsBtn.addEventListener('click', function () { self.doLogs(logsBtn); });
		var linkBtn = E('button', { 'class': 'cbi-button' }, _('Show connection link'));
		linkBtn.addEventListener('click', function () { self.doLink(linkBtn); });
		node.appendChild(this.row(_('Probes'), [healthBtn, ' ', logsBtn, ' ', linkBtn]));

		var panel = E('div', { id: 'px-diag-result' });
		self._f.diagResult = panel;
		node.appendChild(panel);

		// listener / firewall warning (static honesty panel)
		var listeners = st.listeners || [];
		var wildcard = listeners.filter(function (l) { return l.classification === 'wildcard'; });
		if (wildcard.length)
			node.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
				_('A wildcard listener is active: the process listens on ALL local interfaces. The manager installs no firewall rules in v1; LAN-only exposure is enforced by the configured bind address, not by the firewall.'))));
		return node;
	},

	doHealth: function (btn) {
		var self = this;
		var panel = self._f.diagResult;
		btn.disabled = true;
		panel.children.length = 0;
		panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('running bounded health probes…')));
		callProxyHealth(JSON.stringify({})).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Health failed: ') + (res.error.message || ''))));
				return;
			}
			panel.appendChild(E('div', { 'class': res.ok ? 'alert-message' : 'alert-message warning' }, E('p', {},
				[E('strong', {}, _('Health: ')), res.ok ? _('ok (infra + local listener)') : _('problems found')])));
			(res.checks || []).forEach(function (c) {
				panel.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, c.name || '?'),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'class': 'zonebadge ' + (c.ok ? 'ok' : 'bad') }, c.ok ? _('ok') : _('fail')),
						' ',
						E('span', { 'class': 'cbi-value-description' }, c.detail || '')
					])
				]));
			});
			var route = res.route || {};
			[['local', route.local], ['upstream', route.upstream]].forEach(function (pair) {
				var r = pair[1] || {};
				panel.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('route ') + pair[0]),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'class': 'zonebadge ' + (r.ok ? 'ok' : (r.attempted ? 'bad' : 'warn')) },
							r.attempted ? (r.ok ? _('reachable') : _('unreachable')) : _('not attempted')),
						' ',
						E('span', { 'class': 'cbi-value-description' }, (r.detail || '') + (r.meaning ? (' — ' + r.meaning) : ''))
					])
				]));
			});
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Health RPC failed: ') + String(err))));
		});
	},

	doLogs: function (btn) {
		var self = this;
		var panel = self._f.diagResult;
		btn.disabled = true;
		callProxyLogsTail(JSON.stringify({ n: 50 })).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok !== true) {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Logs unavailable: ') + ((res.error && res.error.message) || _('unknown error')))));
				return;
			}
			panel.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('last ') + (res.lines || []).length + _(' line(s), ') + (res.redacted || 0) + _(' redacted — secret-shaped tokens and tg:// links never leave the router.')));
			var pre = E('pre', { 'class': 'cbi-value-description', style: 'max-height:18em;overflow:auto' });
			pre.textContent = (res.lines || []).join('\n') || _('(empty log)');
			panel.appendChild(pre);
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Logs RPC failed: ') + String(err))));
		});
	},

	doLink: function (btn) {
		var self = this;
		var panel = self._f.diagResult;
		if (!self._armed.link) {
			self._armed.link = true;
			btn.textContent = _('Confirm reveal — the link embeds the secret');
			return;
		}
		self._armed.link = false;
		btn.disabled = true;
		callProxyLinkInfo(JSON.stringify({ reveal: true, confirm: 'REVEAL' })).then(function (res) {
			btn.disabled = false;
			btn.textContent = _('Show connection link');
			panel.children.length = 0;
			res = res || {};
			if (res.revealed === true && res.link) {
				panel.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('Connection link (') + (res.transport || '?') + _(') — shown once, never logged or stored by the manager:')));
				panel.appendChild(E('code', { 'class': 'cbi-value-description' }, res.link));
			} else if (res.error && typeof res.error === 'object') {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Reveal failed: ') + (res.error.message || ''))));
			} else {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Link unavailable: ') + (res.reason || _('the proxy is not configured yet')))));
			}
		}).catch(function (err) {
			btn.disabled = false;
			btn.textContent = _('Show connection link');
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Link RPC failed: ') + String(err))));
		});
	},

	// ---- shared -----------------------------------------------------------------------

	refresh: function () {
		var self = this;
		return this.load().then(function (envelope) {
			self._env = envelope;
			var fresh = self.render(envelope);
			if (self._root && fresh && fresh.children) {
				self._root.children.length = 0;
				fresh.children.forEach(function (c) { self._root.appendChild(c); });
			}
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
