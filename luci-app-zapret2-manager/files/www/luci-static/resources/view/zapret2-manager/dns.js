'use strict';
// DNS — Zapret2GUI-aligned DNS management for OpenWrt (r46).
//
// Sections: Setup | Providers | Service Access | Advanced | History.
// Grounding: dnsmasq + UCI + resolvfile. No Windows APIs, no per-adapter model.
'require rpc';

const DNS_UI_BUILD = 'r46.7.0';

function formatRpcError(error) {
	if (error == null) return _('Unknown error');
	if (typeof error === 'string') return error;
	var value = error.error != null ? error.error : error;
	if (typeof value === 'string') return value;
	var code = value.code != null ? value.code : error.code;
	var message = value.message != null ? value.message : (error.message != null ? error.message : (value.detail != null ? value.detail : error.detail));
	if (code != null && message != null) return String(code) + ': ' + String(message);
	if (message != null) return String(message);
	if (code != null) return String(code);
	try { return JSON.stringify(value) || _('Unknown error'); } catch (e) { return _('Unknown error'); }
}

const callDnsGet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_get', reject: true });
const callDnsSet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_set', params: ['edit'], reject: true });
const callDnsValidate   = rpc.declare({ object: 'zapret2-manager', method: 'dns_validate', params: ['edit'], reject: true });
const callDnsApply      = rpc.declare({ object: 'zapret2-manager', method: 'dns_apply', params: ['edit'], reject: true });
const callDnsCheck      = rpc.declare({ object: 'zapret2-manager', method: 'dns_check', params: ['edit'], reject: true });
const callDnsRollback   = rpc.declare({ object: 'zapret2-manager', method: 'dns_rollback', reject: true });
const callDnsRestoreAuto = rpc.declare({ object: 'zapret2-manager', method: 'dns_restore_auto', reject: true });
const callProvComp      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_components', reject: true });
const callProvList      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_providers', reject: true });
const callProvDiag      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_diagnose', params: ['edit'], reject: true });
const callSdnsProv      = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_providers', reject: true });
const callSdnsStatus    = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_status', reject: true });
const callSdnsPreview   = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_preview', reject: true });
const callSdnsSet       = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_set', params: ['edit'], reject: true });
const callSdnsApply     = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply', params: ['edit'], reject: true });
const callSdnsApplyAsync = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply_async', params: ['edit'], reject: true });
const callSdnsApplyStatus = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply_status', params: ['edit'], reject: true });
const callSdnsRollback  = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_rollback', reject: true });

var SERVICE_LABELS = {
	'chatgpt-openai': 'ChatGPT & Sora', 'google-gemini': 'Gemini',
	'claude': 'Claude', 'microsoft-copilot': 'Microsoft Copilot',
	'grok': 'Grok', 'manus': 'Manus', 'meta-ai': 'Meta AI',
	'trae-ai': 'Trae.ai', 'windsurf': 'Windsurf', 'tiktok': 'TikTok',
	'spotify': 'Spotify', 'twitch': 'Twitch', 'notion': 'Notion',
	'deepl': 'DeepL', 'canva': 'Canva', 'elevenlabs': 'ElevenLabs',
	'jetbrains': 'JetBrains', 'mangalib': 'MangaLib', 'parsec': 'Parsec',
	'square': 'Square', 'discord': 'Discord', 'youtube': 'YouTube',
	'github': 'GitHub', 'githubusercontent': 'GitHub Content',
	'whatsapp': 'WhatsApp', 'x-twitter': 'X / Twitter',
	'rutor': 'Rutor', 'ntc-party': 'ntc.party', 'flowseal-discord': 'Discord Voice (Flowseal)',
	'supercell': 'Supercell', 'instagram': 'Instagram',
	'telegram-web': 'Telegram Web'
};

var SERVICE_SUBLABEL = {
	'chatgpt-openai': 'OpenAI', 'google-gemini': 'Google AI',
	'claude': 'Anthropic', 'microsoft-copilot': 'Microsoft',
	'grok': 'xAI', 'manus': null, 'meta-ai': 'Facebook',
	'trae-ai': null, 'windsurf': 'Codeium', 'tiktok': null,
	'spotify': null, 'twitch': null, 'notion': null,
	'deepl': null, 'canva': null, 'elevenlabs': null,
	'jetbrains': null, 'mangalib': null, 'parsec': null,
	'square': null, 'discord': null, 'youtube': 'Google',
	'github': null, 'githubusercontent': null,
	'whatsapp': 'Meta', 'x-twitter': null,
	'rutor': null, 'ntc-party': null, 'flowseal-discord': 'Voice fix',
	'supercell': null, 'instagram': 'Meta',
	'telegram-web': null
};

var SERVICE_CATEGORIES = {
	'chatgpt-openai':'AI','google-gemini':'AI','claude':'AI','microsoft-copilot':'AI',
	'grok':'AI','manus':'AI','meta-ai':'AI','trae-ai':'AI','windsurf':'AI',
	'elevenlabs':'AI','tiktok':'social','spotify':'music','twitch':'video',
	'notion':'other','deepl':'other','canva':'other','jetbrains':'developer',
	'mangalib':'media','parsec':'games','square':'other','discord':'messaging',
	'youtube':'video','github':'developer','githubusercontent':'developer',
	'whatsapp':'messaging','x-twitter':'social','rutor':'other','ntc-party':'other',
	'flowseal-discord':'messaging','supercell':'games','instagram':'social',
	'telegram-web':'messaging'
};

var SECTIONS = [
	{ id: 'setup',     label: _('DNS Setup') },
	{ id: 'providers', label: _('Check & Choose') },
	{ id: 'services',  label: _('Service Access') },
	{ id: 'advanced',  label: _('Advanced') },
	{ id: 'history',   label: _('History') }
];

function esc(s) { return (s == null) ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function h(c) { return document.createTextNode(c); }
function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral', info: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
}
function injectCSS() {
	if (document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}
function kv(label, value) {
	return E('div', { 'class': 'z2m-kv' }, [
		E('span', { 'class': 'z2m-kv-label' }, label),
		E('span', { 'class': 'z2m-kv-value' }, value)
	]);
}
function card(title, body) {
	return E('div', { 'class': 'z2m-card' }, [
		E('h4', {}, title)
	].concat(body));
}
function callout(type, text) {
	var cls = { success: 'z2m-callout z2m-callout-success', warning: 'z2m-callout z2m-callout-warn', warn: 'z2m-callout z2m-callout-warn', error: 'z2m-callout z2m-callout-bad', bad: 'z2m-callout z2m-callout-bad', info: 'z2m-callout z2m-callout-info' };
	return E('div', { 'class': cls[type] || cls.warn }, text);
}

function detectDark() {
	// Check LuCI theme markers first
	var main = document.querySelector('.main');
	var body = document.body;
	var target = main || body;
	if (!target) return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
	var bg = window.getComputedStyle(target).backgroundColor;
	var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (m) {
		var luminance = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
		return luminance < 128;
	}
	return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

return L.view.extend({
	title: _('DNS'),

	load: function () {
		function grab(call) {
			return call().then(function (res) { return { loadError: null, data: res || null }; })
				.catch(function (err) { return { loadError: String(err), data: null }; });
		}
		return Promise.all([
			callDnsGet().then(function (res) { return { loadError: null, data: res || null }; })
				.catch(function (err) { return { loadError: String(err), data: null }; }),
			grab(callSdnsStatus),
			grab(callSdnsProv),
			grab(callProvComp),
			grab(callProvList)
		]).then(function (r) {
			return {
				dnsLoadError: r[0].loadError, dns: r[0].data,
				sdnsStatusErr: r[1].loadError, sdnsStatus: r[1].data,
				sdnsProvErr: r[2].loadError, sdnsProv: r[2].data,
				provComp: r[3].data, provCompError: r[3].loadError,
				provList: r[4].data, provListError: r[4].loadError
			};
		});
	},

	render: function (envelope) {
		injectCSS();
		this._envelope = envelope || {};
		if (!this._section) this._section = 'setup';
		if (typeof this._loadGen !== 'number') this._loadGen = 0;
		if (typeof this._renderGen !== 'number') this._renderGen = 0;
		if (!this._sdnsOp) this._sdnsOp = null;
		if (!this._saDraft) this._saDraft = null;
		var self = this;
		this._renderGen++;

		var container = E('div', { 'class': 'z2m-page', 'id': 'z2m-dns-shell' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('DNS')),
				E('p', {}, _('Manage DNS upstream servers, test providers, configure service access mappings.'))
			])
		]);

		// theme detection — apply one class to shell
		if (detectDark()) container.classList.add('z2m-theme-dark');
		else container.classList.add('z2m-theme-light');

		// persistent tab bar
		this._tabBar = E('div', { 'class': 'z2m-tabs' });
		SECTIONS.forEach(function (s) {
			var btn = E('button', { 'class': 'z2m-tab', 'type': 'button', 'data-section': s.id }, s.label);
			btn.addEventListener('click', function (ev) {
				ev.preventDefault();
				if (self._section === s.id) return;
				self._section = s.id;
				self._renderSection();
				self._updateActiveTab();
			});
			self._tabBar.appendChild(btn);
		});
		container.appendChild(this._tabBar);

		// flash host
		this._flashHost = E('div', { 'id': 'z2m-dns-flash' });
		container.appendChild(this._flashHost);

		// section host
		this._sectionHost = E('div', { 'id': 'z2m-dns-section' });
		container.appendChild(this._sectionHost);

		this._buildShellContent();
		this._updateActiveTab();
		return container;
	},

	_buildShellContent: function () {
		this._updateActiveTab();
		this._showStoredFlash();
		try {
			var content = this._buildSection(this._section, this._envelope);
			this._sectionHost.innerHTML = '';
			if (content) this._sectionHost.appendChild(content);
		} catch (e) {
			this._sectionHost.innerHTML = '';
			this._sectionHost.appendChild(callout('bad', _('Could not render ') + esc(this._section) + '. ' + _('UI build: ') + DNS_UI_BUILD + ' — ' + esc(String(e))));
		}
	},

	_updateActiveTab: function () {
		if (!this._tabBar) return;
		var btns = this._tabBar.querySelectorAll('.z2m-tab');
		for (var i = 0; i < btns.length; i++) {
			var cls = 'z2m-tab';
			if (btns[i].getAttribute('data-section') === this._section) cls += ' z2m-tab-active';
			btns[i].className = cls;
		}
	},

	_renderSection: function () {
		var g = ++this._renderGen;
		this._buildShellContent();
	},

	_buildSection: function (sec, envelope) {
		envelope = envelope || {};
		var dns = envelope.dns || {};
		var sdnsStatus = envelope.sdnsStatus || {};
		var sdnsProv = envelope.sdnsProv || {};
		var provs = envelope.provList || {};
		var comps = envelope.provComp || {};
		var self = this;

		if (sec === 'setup' && envelope.dnsLoadError && sec === this._section) {
			// handled inside setupSection
		}

		switch (sec) {
			case 'setup':     return setupSection(self, dns, comps, envelope);
			case 'providers': return providersSection(self, provs, comps, envelope);
			case 'services':  return servicesSection(self, dns, sdnsStatus, sdnsProv, envelope);
			case 'advanced':  return advancedSection(self, dns, envelope);
			case 'history':   return historySection(self, dns, sdnsStatus);
			default:          return null;
		}
	},

	switchSection: function (sectionId) {
		if (sectionId) this._section = sectionId;
		this._renderSection();
	},

	showFlash: function (msg, type) {
		if (!this._flashHost) return;
		this._flash = { message: msg, type: type || 'info' };
		this._showStoredFlash();
	},

	_showStoredFlash: function () {
		if (!this._flashHost || !this._flash) return;
		this._flashHost.innerHTML = '';
		var flash = typeof this._flash === 'string' ? { message: this._flash, type: 'info' } : this._flash;
		this._flashHost.appendChild(callout(flash.type, flash.message));
		this._flash = null;
	},

	reload: function () {
		var self = this;
		if (this._reloadActive) return this._reloadActive;
		if (typeof this._loadGen !== 'number') this._loadGen = 0;
		var gen = ++this._loadGen;
		this._reloadActive = this.load().then(function (env) {
			if (gen !== self._loadGen) return null;
			if (!env) throw new Error('DNS reload returned no data');
			self._envelope = env;
			if (typeof self._renderGen !== 'number') self._renderGen = 0;
			self._renderGen++;
			self._buildShellContent();
			return env;
		}, function (err) {
			if (gen === self._loadGen) self.showFlash(_('Reload failed: ') + String(err));
			return Promise.reject(err);
		}).then(function (result) {
			if (self._reloadActive === wrapped) self._reloadActive = null;
			return result;
		}, function (err) {
			if (self._reloadActive === wrapped) self._reloadActive = null;
			return Promise.reject(err);
		});
		var wrapped = this._reloadActive;
		return wrapped;
	},

	refresh: function () { return this.reload(); },

	handleSaveApply: null, handleSave: null, handleReset: null
});

// ════════════════════════════════════════════════════════
// DNS SETUP — current state, primary actions
// ════════════════════════════════════════════════════════
function setupSection(view, dns, comps, envelope) {
	var node = E('div');
	var rz = dns.resolver || {};

	// Current state card
	var current = card(_('Current DNS'), buildSetupRows(dns, comps, envelope));
	node.appendChild(current);

	// Diagnostic warnings
	var warns = buildWarnings(dns, comps, envelope);
	if (warns.length) {
		var wc = E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Diagnostics'))].concat(warns));
		node.appendChild(wc);
	}

	// Actions
	var actions = E('div', { 'class': 'z2m-actions' });
	var checkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Check current DNS'));
	checkBtn.addEventListener('click', function () {
		if (checkBtn.disabled) return;
		checkBtn.disabled = true;
		callDnsCheck(JSON.stringify({})).then(function (res) {
			if (!res || res.ok !== true) throw new Error(formatRpcError(res));
			dns._checkResult = res;
			view.showFlash(_('DNS check completed.'), 'success');
			return view.reload();
		}, function (e) {
			view.showFlash(_('DNS check failed: ') + formatRpcError(e), 'error');
		}).then(function () { checkBtn.disabled = false; });
	});
	var chooseBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Choose DNS'));
	chooseBtn.addEventListener('click', function () { view._section = 'providers'; view.switchSection(); });
	var restoreBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Restore automatic DNS'));
	restoreBtn.addEventListener('click', function () {
		if (restoreBtn.disabled || !window.confirm(_('Restore DNS from WAN automatically? This changes the router WAN DNS settings.'))) return;
		restoreBtn.disabled = true;
		callDnsRestoreAuto().then(function (res) {
			if (!res || res.ok !== true) throw new Error(formatRpcError(res));
			view.showFlash(_('Automatic DNS restored.'), 'success');
			return view.reload();
		}, function (e) {
			view.showFlash(_('Restore failed: ') + formatRpcError(e), 'error');
		}).then(function () { restoreBtn.disabled = false; });
	});
	actions.appendChild(checkBtn);
	actions.appendChild(chooseBtn);
	actions.appendChild(restoreBtn);
	node.appendChild(actions);

	// Check result
	if (dns._checkResult) {
		var cr = dns._checkResult;
		if (cr.error) {
			node.appendChild(callout('bad', _('Check failed: ') + esc(cr.error)));
		} else {
			var results = (cr.results || []).map(function (r) {
				return E('div', { 'class': 'z2m-kv' }, [
					E('span', { 'class': 'z2m-kv-label' }, esc(r.domain)),
					E('span', { 'class': 'z2m-kv-value' }, r.matched ? badge(_('resolved'), 'ok') : badge(_('mismatch'), 'bad'))
				]);
			});
			node.appendChild(card(_('Check result'), results));
		}
	}

	return node;
}

function buildSetupRows(dns, comps, envelope) {
	var rz = dns.resolver || {};
	var wan = comps.wan || {};
	var rows = [];

	rows.push(kv(_('Resolver'), esc((rz.components || []).map(function(c){return c.name;}).join(', ') || _('Unknown'))));

	var dm = dns.dnsmasq;
	if (dm) {
		var dmUnknown = !!dns.diagnosticError;
		var dmLabel = dmUnknown ? _('Unknown') : (dm.running ? _('Running') : (dm.installed ? _('Stopped') : _('Not installed')));
		var dmClass = dmUnknown ? 'neutral' : (dm.running ? 'ok' : (dm.installed ? 'bad' : 'neutral'));
		var dmValue = [badge(dmLabel, dmClass)];
		if (dm.running && dm.version) dmValue.push(E('span', { 'class': 'z2m-dnsmasq-version' }, ' ' + _('version ') + esc(dm.version)));
		rows.push(kv(_('dnsmasq'), dmValue));
	} else {
		rows.push(kv(_('dnsmasq'), badge(_('Unknown'), 'neutral')));
	}

	var source = _('Unknown');
	if (dns._managed) source = _('Manager configured');
	else if (wan.peerdns) source = _('Automatic (WAN peer)');
	else if (wan.nameservers && wan.nameservers.length) source = _('Manually configured');
	rows.push(kv(_('Source'), source));

	var ups = rz.upstreamNameservers || wan.nameservers || [];
	if (ups.length) {
		rows.push(kv(_('Primary DNS'), esc(ups[0])));
		if (ups[1]) rows.push(kv(_('Secondary DNS'), esc(ups[1])));
	} else {
		rows.push(kv(_('Upstream'), badge(_('None detected'), 'warn')));
	}

	rows.push(kv(_('Resolvfile'), esc(rz.resolvfile || _('Unknown'))));
	rows.push(kv(_('WAN peerdns'), wan.peerdns ? _('Yes') : _('No')));

	var applied = dns.applied || [];
	rows.push(kv(_('Overrides'), applied.length ? applied.length + _(' entries') : _('None')));
	rows.push(kv(_('Registered in dnsmasq'), dns.registered !== false ? _('Yes') : badge(_('No'), 'warn')));

	if (dns.latestCheck) {
		rows.push(kv(_('Last check'), esc(dns.latestCheck)));
	}

	var rbAvailable = dns.rollbackAvailable === true;
	rows.push(kv(_('Rollback'), rbAvailable ? badge(_('Available'), 'ok') : _('Not available')));

	return rows;
}

function buildWarnings(dns, comps, envelope) {
	var warns = [];
	var rz = dns.resolver || {};
	var ups = rz.upstreamNameservers || [];
	var wan = comps.wan || {};
	var allUps = ups.length ? ups : (wan.nameservers || []);

	if (!allUps.length) {
		warns.push(callout('warn', _('No upstream DNS servers detected. DNS resolution may fail.')));
	}
	if (envelope.dnsLoadError) {
		warns.push(callout('bad', _('Cannot read DNS state: ') + esc(envelope.dnsLoadError)));
	}
	if (dns.registered === false) {
		warns.push(callout('warn', _('Manager overrides file is not registered in dnsmasq. Overrides have no effect.')));
	}
	if (envelope.sdnsProvErr) {
		warns.push(callout('warn', _('Service DNS provider catalog unavailable: ') + esc(envelope.sdnsProvErr)));
	}
	if (envelope.provListError) {
		warns.push(callout('warn', _('DNS provider catalog unavailable: ') + esc(envelope.provListError)));
	}
	(rz.conflicts || []).forEach(function (c) {
		warns.push(callout('bad', _('Resolver conflict: ') + esc(c.name) + ' — ' + esc(c.role)));
	});
	return warns;
}

// ════════════════════════════════════════════════════════
// CHECK & CHOOSE — provider cards, test, select
// ════════════════════════════════════════════════════════
function providersSection(view, provs, comps, envelope) {
	var node = E('div');

	if (envelope.provListError) {
		node.appendChild(callout('bad', _('Provider catalog unavailable: ') + esc(envelope.provListError)));
		node.appendChild(E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Retry')));
		return node;
	}

	var items = provs.providers || [];
	var categories = groupProviders(items);

	// Test all button
	var testAllBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Test all providers'));
	var allResult = E('span', { 'class': 'z2m-provider-result', 'style': 'margin-left:.6em' });
	testAllBtn.addEventListener('click', function () {
		if (testAllBtn.disabled) return;
		testAllBtn.disabled = true;
		allResult.textContent = _('Testing 0 of ') + items.length + '\u2026';
		var results = [], index = 0;
		function next() {
			if (index >= items.length) {
				var good = results.filter(function (r) { return r.ok; }).length;
				allResult.textContent = _('Completed: ') + good + '/' + items.length + ' ' + _('providers passed');
				testAllBtn.disabled = false;
				return;
			}
			var p = items[index++];
			allResult.textContent = _('Testing ') + index + ' of ' + items.length + '\u2026';
			callProvDiag(JSON.stringify({ provider: p.id })).then(function (res) {
				var probe = res && res.probes && res.probes[0];
				results.push({ id: p.id, ok: !!(probe && probe.reachable && probe.answered) });
			}).catch(function () { results.push({ id: p.id, ok: false }); }).then(next);
		}
		next();
	});
	node.appendChild(E('div', { 'class': 'z2m-actions' }, [testAllBtn, allResult]));

	// Custom provider link
	var customBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Add custom provider'));
	node.appendChild(E('div', { 'class': 'z2m-actions', 'style': 'margin-left:.4em' }, [customBtn]));

	customBtn.addEventListener('click', function () {
		node.appendChild(customProviderForm());
	});

	Object.keys(categories).forEach(function (cat) {
		node.appendChild(E('h4', {}, esc(cat)));
		var grid = E('div', { 'class': 'z2m-card-grid' });
		categories[cat].forEach(function (p) {
			grid.appendChild(providerCard(view, p));
		});
		node.appendChild(grid);
	});

	return node;
}

function groupProviders(providers) {
	var cats = {};
	providers.forEach(function (p) {
		var cat = p.category || _('Other');
		if (!cats[cat]) cats[cat] = [];
		cats[cat].push(p);
	});
	return cats;
}

function providerCard(view, p) {
	var ipv4 = (p.ipv4 || []).slice(0, 2).join(', ') || _('No IPv4');
	var ipv6 = (p.ipv6 || []).slice(0, 2).join(', ') || _('None');
	var badges = [];
	if (p.doh) badges.push(badge(_('DoH'), 'ok'));
	badges.push(badge(p.category || '?', 'neutral'));

	var resEl = E('div', { 'class': 'z2m-provider-result', 'style': 'display:none;margin-top:.4em;padding:.3em;border-radius:4px;font-size:.85em' });

	var testBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Test'));
	testBtn.addEventListener('click', function () {
		testBtn.disabled = true;
		resEl.style.display = 'block';
		resEl.style.background = 'var(--bg,#f0f0f0)';
		resEl.textContent = _('Testing...');
		callProvDiag(JSON.stringify({ provider: p.id })).then(function (res) {
			testBtn.disabled = false;
			var probe = (res && res.probes && res.probes.length) ? res.probes[0] : null;
			if (probe && probe.reachable && probe.answered) {
				var ips = (probe.answer || []).slice(0, 3).join(', ');
				resEl.style.background = '#d4edda';
				resEl.style.color = '#155724';
				resEl.textContent = _('OK') + ': ' + ips + ' (via ' + esc(p.ipv4[0] || '?') + ')';
			} else if (probe && probe.reachable) {
				resEl.style.background = '#fff3cd';
				resEl.style.color = '#856404';
				resEl.textContent = _('Reachable, no DNS (ping OK, port 53 timeout)');
			} else {
				resEl.style.background = '#f8d7da';
				resEl.style.color = '#721c24';
				resEl.textContent = _('Unreachable') + (probe ? ': ' + esc(probe.reason || '') : '');
			}
		}).catch(function (err) {
			testBtn.disabled = false;
			resEl.style.background = '#f8d7da';
			resEl.style.color = '#721c24';
			resEl.textContent = _('Error') + ': ' + String(err);
		});
	});
	var selectBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Select'));
	testBtn._provider = p;

	var body = [
		E('div', {}, badges),
		kv(_('IPv4'), esc(ipv4)),
		ipv6 !== _('None') ? kv(_('IPv6'), esc(ipv6)) : null,
		kv(_('Type'), esc(p.notes || p.name)),
		E('div', { 'class': 'z2m-actions', 'style': 'margin-top:.4em' }, [
			testBtn,
			selectBtn
		]),
		resEl
	].filter(Boolean);

	return E('div', { 'class': 'z2m-card' }, [
		E('h4', {}, esc(p.name))
	].concat(body));
}

function customProviderForm() {
	var node = E('div', { 'class': 'z2m-card' }, [
		E('h4', {}, _('Custom DNS Provider')),
		E('div', { 'class': 'z2m-callout z2m-callout-info' },
			_('Enter a custom DNS server. Private and loopback addresses are warned but not blocked. Editing the currently applied provider requires switching first.'))
	]);

	var name = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': _('Provider name'), 'style': 'width:100%' });
	var ipv4_1 = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': _('Primary IPv4'), 'style': 'width:100%' });
	var ipv4_2 = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': _('Secondary IPv4'), 'style': 'width:100%' });

	node.appendChild(kv(_('Name'), name));
	node.appendChild(kv(_('Primary IPv4'), ipv4_1));
	node.appendChild(kv(_('Secondary IPv4'), ipv4_2));

	var btns = E('div', { 'class': 'z2m-actions' });
	var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Save'));
	var testBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Test'));
	var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Cancel'));
	btns.appendChild(saveBtn);
	btns.appendChild(testBtn);
	btns.appendChild(cancelBtn);
	cancelBtn.addEventListener('click', function () {
		if (node.parentNode) node.parentNode.removeChild(node);
	});
	node.appendChild(btns);

	return node;
}

// ════════════════════════════════════════════════════════
// SERVICE ACCESS — per-service DNS mappings
// ════════════════════════════════════════════════════════
function servicesSection(view, dns, sdnsStatus, sdnsProv, envelope) {
	var provs = sdnsProv || {};
	var status = sdnsStatus || {};
	var node = E('div');

	if (envelope.sdnsProvErr || (provs.ok !== true && provs.ok !== undefined)) {
		var btn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Retry'));
		btn.addEventListener('click', function () { view.reload(); });
		node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, [
			E('h4', {}, _('Service catalog unavailable')),
			E('p', {}, _('Existing active mappings were not changed.')), btn
		]));
		return node;
	}

	var providerName = {};
	(provs.providers || []).forEach(function (pr) { providerName[pr.id] = pr.name || pr.id; });

	var profilesBySvc = {};
	(provs.profiles || []).forEach(function (p) {
		if (!profilesBySvc[p.serviceId]) profilesBySvc[p.serviceId] = [];
		profilesBySvc[p.serviceId].push(p);
	});

	var availableByService = status.availableByService || {};
	var selections = status.selections || {};
	var appliedSel = status.applied || {};
	var appliedRev = (typeof status.appliedRevision === 'number') ? status.appliedRevision : 0;
	var draftRev = (typeof status.draftRevision === 'number') ? status.draftRevision : appliedRev;
	var pending = status.pending || null;

	// Initialize draft from backend or saved
	if (!view._saDraft) view._saDraft = { selections: {} };
	var draft = view._saDraft;
	if (Object.keys(draft.selections).length === 0 && Object.keys(selections).length > 0) {
		for (var k in selections) draft.selections[k] = selections[k];
	}

	if (!view._saFilter) view._saFilter = { query: '', state: 'all' };

	var serviceOrder = [];
	var svcSet = {};
	(provs.profiles || []).forEach(function (p) {
		if (!svcSet[p.serviceId]) { svcSet[p.serviceId] = true; serviceOrder.push(p.serviceId); }
	});
	serviceOrder.sort();

	// Pre-build search index per service
	var searchIndex = {};
	serviceOrder.forEach(function (svc) {
		var profiles = profilesBySvc[svc] || [];
		var pNames = [], pIds = [];
		profiles.forEach(function (p) {
			var pn = providerName[p.providerId] || p.providerId;
			pNames.push(pn); pIds.push(p.id);
		});
		var domains = [];
		if (profiles.length) (profiles[0].requiredDomains || []).forEach(function (d) { domains.push(d); });
		searchIndex[svc] = nrm(svc + ' ' + (SERVICE_LABELS[svc] || '') + ' ' + (SERVICE_SUBLABEL[svc] || '') +
			' ' + (SERVICE_CATEGORIES[svc] || '') + ' ' + pNames.join(' ') + ' ' + pIds.join(' ') +
			' ' + domains.join(' '));
	});

	function nrm(v) { return String(v || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

	// ── intro ──
	node.appendChild(E('div', { 'class': 'z2m-sa-intro' }, [
		E('h3', {}, _('Service Access')),
		E('p', {}, _('Choose a DNS answer profile for individual services without changing the global DNS provider.'))
	]));

	// ── summary cards ──
	var sumDiv = E('div', { 'class': 'z2m-sa-summary' });
	node.appendChild(sumDiv);

	// ── filter toolbar with chips ──
	var srch = E('input', { 'type': 'search', 'placeholder': _('Search'), 'class': 'z2m-sa-search' });
	srch.value = view._saFilter.query || '';

	var chips = E('div', { 'class': 'z2m-sa-filterbar' });
	var resLbl = E('span', { 'class': 'z2m-sa-result' });
	var tb = E('div', { 'class': 'z2m-sa-toolbar' });
	tb.appendChild(srch);
	tb.appendChild(chips);
	tb.appendChild(resLbl);
	node.appendChild(tb);

	// ── catalog grid ──
	var grid = E('div', { 'class': 'z2m-sa-grid' });
	var catEl = E('div', { 'class': 'z2m-sa-catalog' });

	var CAT = [
		{ id: 'AI', label: _('AI'), keys: ['ai'] },
		{ id: 'Media', label: _('Media'), keys: ['music','video','media'] },
		{ id: 'Social', label: _('Social'), keys: ['social','messaging'] },
		{ id: 'Games', label: _('Games'), keys: ['games'] },
		{ id: 'Developer', label: _('Developer'), keys: ['developer'] },
		{ id: 'Other', label: _('Other'), keys: ['other'] }
	];

	var catMap = {};
	serviceOrder.forEach(function (svc) {
		var rc = (SERVICE_CATEGORIES[svc] || 'other').toLowerCase();
		var gid = 'Other';
		for (var gi = 0; gi < CAT.length; gi++) {
			if (CAT[gi].keys.indexOf(rc) >= 0) { gid = CAT[gi].id; break; }
		}
		if (!catMap[gid]) catMap[gid] = [];
		catMap[gid].push(svc);
	});

	var catRefs = {};
	CAT.forEach(function (grp, ci) {
		var svcs = catMap[grp.id] || [];
		var hd = E('div', { 'class': 'z2m-sa-cathead', 'data-cat': grp.id });
		var hdArr = E('span', { 'class': 'z2m-sa-cat-arr' }, '');
		hd.appendChild(hdArr);
		hd.appendChild(E('span', { 'class': 'z2m-sa-cat-title' }, esc(grp.label)));
		hd.appendChild(E('span', { 'class': 'z2m-sa-cat-count' }, ''));
		hd.addEventListener('click', function (gid, hd, arr) {
			return function () {
				var cr = catRefs[gid];
				if (!cr) return;
				cr.collapsedByUser = !cr.collapsedByUser;
				refreshCategoryVisibility(gid);
			};
		}(grp.id, hd, hdArr));
		var bd = E('div', { 'class': 'z2m-sa-catbody', 'data-cat': grp.id });
		catEl.appendChild(hd);
		catEl.appendChild(bd);
		catRefs[grp.id] = {
			head: hd, body: bd, arr: hdArr,
			collapsedByUser: svcs.length === 0,
			count: svcs.length
		};
	});

	var rowRefs = [];
	var allRows = [];

	serviceOrder.forEach(function (svc) {
		var rc = (SERVICE_CATEGORIES[svc] || 'other').toLowerCase();
		var gid = 'Other';
		for (var gi = 0; gi < CAT.length; gi++) {
			if (CAT[gi].keys.indexOf(rc) >= 0) { gid = CAT[gi].id; break; }
		}
		var label = SERVICE_LABELS[svc] || svc;
		var sub = SERVICE_SUBLABEL[svc] || '';
		var profiles = profilesBySvc[svc] || [];
		var avp = availableByService[svc] || [];
		var dc = avp.length ? avp[0].domainCount : (profiles.length ? profiles[0].requiredDomains.length : 0);

		var row = E('div', { 'class': 'z2m-sa-row', 'data-svc': svc, 'data-cat': gid });

		// col 1: name
		var nameDiv = E('div', { 'class': 'z2m-sa-name' }, [
			E('div', { 'class': 'z2m-sa-name-title' }, esc(label)),
			sub ? E('div', { 'class': 'z2m-sa-name-sub' }, esc(sub)) : null
		].filter(Boolean));

		// col 2: meta badge
		var metaDiv = E('div', { 'class': 'z2m-sa-meta' });
		function updateMeta() {
			metaDiv.innerHTML = '';
			var c2 = draft.selections[svc] || 'off';
			var a2 = appliedSel[svc] || 'off';
			if (c2 !== a2) {
				metaDiv.appendChild(E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('Changed')));
			} else if (c2 !== 'off') {
				metaDiv.appendChild(E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('On')));
			}
		}
		updateMeta();

		// col 3: custom select (replaces native <select>)
		var selDiv = E('div', { 'class': 'z2m-sa-select-col' });
		var options = [{ value: 'off', label: _('Off'), desc: '' }];
		profiles.forEach(function (p) {
			var pn = providerName[p.providerId] || p.providerId;
			for (var ai = 0; ai < avp.length; ai++) {
				if (avp[ai].profileId === p.id) { pn = avp[ai].providerName; break; }
			}
			options.push({ value: p.id, label: pn, desc: (p.requiredDomains || []).length + ' domains' });
		});
		var customSel = createServiceSelect({
			view: view,
			value: draft.selections[svc] || 'off',
			options: options,
			ariaLabel: label,
			onChange: function (value) {
				draft.selections[svc] = value || 'off';
				draft.dirty = true;
				refreshServiceAccessUI();
			}
		});
		selDiv.appendChild(customSel.element);

		// col 4: details
		var dtlBtn = E('button', { 'class': 'z2m-sa-detail-btn', 'type': 'button' }, _('Details'));
		var dtlPnl = E('div', { 'class': 'z2m-sa-detail-panel' });
		var dtlProvVal = E('span', { 'class': 'z2m-kv-value' }, _('Off'));
		dtlPnl.appendChild(E('h4', { 'style': 'margin:4px 0' }, esc(label)));
		dtlPnl.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Provider')),
			dtlProvVal
		]));
		var doms = (profiles.length ? profiles[0].requiredDomains : []);
		if (doms.length) dtlPnl.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Domains')),
			E('span', { 'class': 'z2m-kv-value' }, (function () { return doms.map(function (d) { return E('div', { 'style': 'font-family:monospace;font-size:.82em' }, esc(d)); }); })())
		]));
		dtlBtn.addEventListener('click', function () {
			dtlPnl.style.display = (dtlPnl.style.display === 'block') ? 'none' : 'block';
		});

		row.appendChild(nameDiv);
		row.appendChild(metaDiv);
		row.appendChild(selDiv);
		row.appendChild(dtlBtn);

		var bd = catRefs[gid] && catRefs[gid].body;
		if (bd) { bd.appendChild(row); bd.appendChild(dtlPnl); }
		allRows.push(row);

		rowRefs.push({
			serviceId: svc, row: row, metaDiv: metaDiv,
			select: customSel, details: dtlPnl, detailsBtn: dtlBtn, detailsProvVal: dtlProvVal,
			searchText: searchIndex[svc], categoryId: gid,
			profiles: profiles, updateMeta: updateMeta
		});
	});

	grid.appendChild(catEl);

	// ── sidebar ──
	var sidebar = E('div', { 'class': 'z2m-sa-sidebar' });
	grid.appendChild(sidebar);
	node.appendChild(grid);

	// ── empty state ──
	var emptyState = E('div', { 'class': 'z2m-sa-empty', 'style': 'display:none' }, [
		E('p', {}, _('No services match the current filters.')),
		E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Clear filters'))
	]);
	node.appendChild(emptyState);

	// ════════════════════════════════════════
	// Unified refresh
	// ════════════════════════════════════════
	function refreshServiceAccessUI() {
		for (var ri = 0; ri < rowRefs.length; ri++) {
			rowRefs[ri].updateMeta();
			var svc = rowRefs[ri].serviceId;
			var cur = draft.selections[svc] || 'off';
			rowRefs[ri].detailsProvVal.textContent = (cur === 'off' ? _('Off') : (providerName[cur] || cur));
		}
		updateSummary();
		buildSidebar();
		buildSticky();
		applyFilters();
	}

	// ════════════════════════════════════════
	// Summary cards
	// ════════════════════════════════════════
	var sumCards = [];
	function sc(n, l) { return E('div', { 'class': 'z2m-sa-sumcard' }, [E('span', { 'class': 'z2m-sa-sc-num' }, String(n)), E('span', { 'class': 'z2m-sa-sc-label' }, l)]); }
	function updateSummary() {
		sumDiv.innerHTML = '';
		var en = 0, ch = 0;
		serviceOrder.forEach(function (svc) {
			var cur = draft.selections[svc] || 'off';
			var app = appliedSel[svc] || 'off';
			if (cur !== 'off') en++;
			if (cur !== app) ch++;
		});
		sumDiv.appendChild(sc(serviceOrder.length, _('Services')));
		sumDiv.appendChild(sc((provs.providers || []).length, _('Providers')));
		sumDiv.appendChild(sc(en, _('Active')));
		sumDiv.appendChild(sc(ch, _('Pending')));
	}
	updateSummary();

	// ════════════════════════════════════════
	// Configuration status bar (tiered)
	// ════════════════════════════════════════
	var statusBar = E('div', { 'class': 'z2m-sa-status-bar' });
	function updateStatusBar() {
		statusBar.innerHTML = '';
		var co = status.configOrigin || {};
		var rt = status.runtime || {};
		var hasFrag = rt.routingRegistered && rt.configuredDirectiveCount > 0;
		var tier = 0;
		var items = [];
		if (co.verified) {
			tier = 1;
			items.push({ label: _('Configuration applied'), ok: true, detail: _('by operation ') + esc(co.operationId || '?') });
			if (hasFrag) {
				tier = 2;
				items.push({ label: _('dnsmasq fragment loaded'), ok: true, detail: (co.directiveCount || rt.configuredDirectiveCount || 0) + ' ' + _('directives') });
			}
		} else if (hasFrag) {
			tier = 1;
			items.push({ label: _('Configuration present'), ok: false, detail: co.reason || _('origin unverified — fragment may be manual') });
		} else if (Array.isArray(status.warnings) && status.warnings.some(function(w) { return w.type === 'unknown-profile'; })) {
			items.push({ label: _('Invalid profile selected'), ok: false, detail: _('Set a valid profile and re-apply') });
		} else if (Object.keys(appliedSel).length === 0 || Object.values(appliedSel).every(function(v) { return v === 'off'; })) {
			items.push({ label: _('All Off'), ok: true, detail: _('No DNS routing active') });
		} else {
			items.push({ label: _('No configuration'), ok: false, detail: _('Select services and press Apply') });
		}
		items.forEach(function(item) {
			var dot = E('span', { 'class': 'z2m-sa-tier-dot' + (item.ok ? ' z2m-sa-tier-dot-ok' : ' z2m-sa-tier-dot-warn') });
			var lbl = E('span', { 'class': 'z2m-sa-tier-label' }, item.label);
			var det = item.detail ? E('span', { 'class': 'z2m-sa-tier-detail' }, item.detail) : null;
			var tierEl = E('div', { 'class': 'z2m-sa-tier-item' }, [dot, lbl]);
			if (det) tierEl.appendChild(det);
			statusBar.appendChild(tierEl);
		});
	}
	updateStatusBar();
	sumDiv.appendChild(statusBar);

	// ════════════════════════════════════════
	// Filter chips
	// ════════════════════════════════════════
	function updateFilterChips() {
		chips.innerHTML = '';
		var total = serviceOrder.length;
		var en = 0, off = 0, ch = 0;
		serviceOrder.forEach(function (svc) {
			var cur = draft.selections[svc] || 'off';
			var app = appliedSel[svc] || 'off';
			if (cur !== 'off') en++; else off++;
			if (cur !== app) ch++;
		});
		var chipData = [
			{ state: 'all', label: _('All'), count: total },
			{ state: 'enabled', label: _('On'), count: en },
			{ state: 'disabled', label: _('Off'), count: off },
			{ state: 'changed', label: _('Changed'), count: ch }
		];
		chipData.forEach(function (cd) {
			var active = view._saFilter.state === cd.state;
			var chip = E('button', {
				'class': 'z2m-sa-filter-chip' + (active ? ' z2m-sa-filter-chip-active' : ''),
				'type': 'button',
				'aria-pressed': active ? 'true' : 'false'
			});
			chip.addEventListener('click', function () {
				view._saFilter.state = cd.state;
				applyFilters();
			});
			chip.appendChild(h(cd.label));
			chip.appendChild(E('span', { 'class': 'z2m-sa-filter-count' }, String(cd.count)));
			chips.appendChild(chip);
		});

		// Clear button
		if (view._saFilter.query || view._saFilter.state !== 'all') {
			var clr = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'style': 'margin-left:8px' }, _('Clear'));
			clr.addEventListener('click', function () {
				view._saFilter.query = '';
				view._saFilter.state = 'all';
				srch.value = '';
				refreshServiceAccessUI();
				srch.focus();
			});
			chips.appendChild(clr);
		}
	}

	// ════════════════════════════════════════
	// Filter logic
	// ════════════════════════════════════════
	function applyFilters() {
		updateFilterChips();
		var q = nrm(srch.value || '');
		var sf = view._saFilter.state || 'all';
		view._saFilter.query = srch.value || '';
		var vis = 0;

		for (var ri = 0; ri < rowRefs.length; ri++) {
			var ref = rowRefs[ri];
			var sv = ref.serviceId;
			var cur = draft.selections[sv] || 'off';
			var app = appliedSel[sv] || 'off';
			var enabled = cur !== 'off';
			var changed = cur !== app;
			var show = true;

			if (q && ref.searchText.indexOf(q) < 0) show = false;
			if (sf === 'enabled' && !enabled) show = false;
			if (sf === 'disabled' && enabled) show = false;
			if (sf === 'changed' && !changed) show = false;

			if (!show) {
				ref.row.style.display = 'none';
				ref.details.style.display = 'none';
			} else {
				ref.row.style.display = '';
				vis++;
			}
		}

		// Category visibility
		var catVis = {};
		for (var ri2 = 0; ri2 < rowRefs.length; ri2++) {
			if (rowRefs[ri2].row.style.display !== 'none') catVis[rowRefs[ri2].categoryId] = true;
		}
		for (var cvk in catRefs) {
			var cr = catRefs[cvk];
			refreshCategoryVisibility(cvk, !!catVis[cvk]);
		}

		resLbl.textContent = _('Showing ') + vis + _(' of ') + serviceOrder.length;
		emptyState.style.display = vis === 0 ? '' : 'none';
	}

	function refreshCategoryVisibility(gid, hasVisible) {
		var cr = catRefs[gid];
		if (!cr) return;
		if (hasVisible === undefined) hasVisible = true;
		if (!hasVisible) {
			cr.head.style.display = 'none';
			cr.body.style.display = 'none';
			return;
		}
		cr.head.style.display = '';
		cr.body.style.display = cr.collapsedByUser ? 'none' : '';
		cr.arr.textContent = cr.collapsedByUser ? '▶' : '▼';
	}

	// ════════════════════════════════════════
	// Sidebar
	// ════════════════════════════════════════
	function buildSidebar() {
		sidebar.innerHTML = '';
		sidebar.appendChild(E('h4', {}, _('Pending changes')));
		var chgs = [];
		for (var svc in draft.selections) {
			var c = draft.selections[svc], a = appliedSel[svc] || 'off';
			if (c === a) continue;
			chgs.push({ svc: svc, cur: c, app: a });
		}
		if (!chgs.length) { sidebar.appendChild(E('p', { 'style': 'margin:8px 0;color:var(--cbi-desc);font-size:.85em' }, _('None.'))); return; }
		chgs.forEach(function (ch) {
			var pvC = ch.cur === 'off' ? _('Off') : (providerName[ch.cur] || ch.cur);
			var pvA = ch.app === 'off' ? _('Off') : (providerName[ch.app] || ch.app);
			sidebar.appendChild(E('div', { 'class': 'z2m-sa-change' }, [
				E('div', {}, esc(SERVICE_LABELS[ch.svc] || ch.svc)),
				E('div', { 'style': 'font-size:.82em;color:var(--cbi-desc)' }, esc(pvA) + ' \u2192 ' + esc(pvC))
			]));
		});
	}
	buildSidebar();

	// ════════════════════════════════════════
	// Sticky bar
	// ════════════════════════════════════════
	var sticky = E('div', { 'class': 'z2m-sa-sticky' });
	var stickyLeft, stickyRight;
	function buildSticky() {
		sticky.innerHTML = '';
		var chgs = [];
		for (var svc in draft.selections) {
			var c = draft.selections[svc], a = appliedSel[svc] || 'off';
			if (c !== a) chgs.push(1);
		}
		var has = chgs.length > 0;
		var appRunning = (view._sdnsOp && view._sdnsOp.promise);
		if (appRunning) {
			stickyLeft = E('div', { 'class': 'z2m-sa-st-left' });
			var phaseText = view._sdnsOp.phase || 'processing';
			stickyLeft.textContent = _('Applying') + ': ' + phaseText + '\u2026';
			sticky.appendChild(stickyLeft);
			return;
		}
		stickyLeft = E('div', { 'class': 'z2m-sa-st-left' });
		stickyLeft.textContent = has ? (chgs.length + ' ' + _('unapplied')) : _('No changes');
		sticky.appendChild(stickyLeft);
		stickyRight = E('div', { 'class': 'z2m-sa-st-right' });

		var disc = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Discard'));
		disc.disabled = !has || appRunning;
		disc.addEventListener('click', function () {
			draft.selections = {};
			draft.dirty = false;
			view.showFlash(_('Draft discarded.'));
			view.reload();
		});
		stickyRight.appendChild(disc);

		var prev = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview'));
		prev.disabled = !has || appRunning;
		prev.addEventListener('click', function () {
			prev.disabled = true;
			callSdnsSet(JSON.stringify({ selections: draft.selections })).then(function () {
				callSdnsPreview().then(function (res) {
					prev.disabled = false;
					showPreview(res);
				})['catch'](function (e) { prev.disabled = false; view.showFlash(String(e)); });
			})['catch'](function (e) { prev.disabled = false; view.showFlash(String(e)); });
		});
		stickyRight.appendChild(prev);

		var appl = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
		appl.disabled = !has || appRunning;
		appl.addEventListener('click', function () {
			if (appRunning) return;
			var opId = createOperationId();
			var snapshot = {};
			for (var k in draft.selections) snapshot[k] = draft.selections[k];

			view._sdnsOp = { id: opId, type: 'apply', phase: 'saving', promise: null, error: null };
			appl.disabled = true; prev.disabled = true; disc.disabled = true;
			buildSticky();

			view._sdnsOp.promise = callSdnsSet(JSON.stringify({ selections: snapshot, revision: draftRev })).then(function (sr) {
				if (!sr || sr.ok !== true) throw new Error(formatRpcError(sr));
				if (typeof sr.draftRevision !== 'number') throw new Error('Set returned no draft revision');
				view._sdnsOp.phase = 'submitting';
				buildSticky();
				return callSdnsApplyAsync(JSON.stringify({ operationId: opId, draftRevision: sr.draftRevision }));
			}).then(function (ar) {
				if (!ar || !ar.accepted) throw new Error(formatRpcError(ar || 'Apply not accepted'));
				view._sdnsOp.phase = 'queued';
				view._sdnsOp.operationId = ar.operationId;
				buildSticky();
				return pollApplyStatus(ar.operationId, function (phase) {
					view._sdnsOp.phase = phase;
					buildSticky();
				});
			}).then(function (r) {
				view._sdnsOp.phase = 'success';
				view._sdnsOp = null;
				view._saDraft = null;
				view._saFilter = null;
				// Tiered banner: header match verifies configuration origin
				if (r && r.originVerified && r.headerMatch) {
					view.showFlash(_('Configuration applied — dnsmasq running'), 'success');
				} else if (r && r.verified) {
					view.showFlash(_('Configuration applied — origin unverified'), 'warning');
				} else {
					view.showFlash(_('Configuration applied'), 'success');
				}
				view.reload();
			}).catch(function (e) {
				view._sdnsOp = null;
				var msg = formatRpcError(e);
				view.showFlash(_('Failed: ') + msg, 'error');
				view.reload();
			});
		});
		stickyRight.appendChild(appl);
		sticky.appendChild(stickyRight);
	}
	buildSticky();
	node.appendChild(sticky);

	// ════════════════════════════════════════
	// Event handlers
	// ════════════════════════════════════════
	srch.addEventListener('input', function () {
		view._saFilter.query = srch.value;
		applyFilters();
	});
	applyFilters();

	// Polling
	function pollApplyStatus(opId, onPhase) {
		return new Promise(function (resolve, reject) {
			var attempts = 0, maxAttempts = 30, deadline = Date.now() + 120000;
			var lastError = null;
			function tick() {
				if (Date.now() > deadline) {
					reject(new Error('Apply status deadline exceeded'));
					return;
				}
				if (attempts >= maxAttempts) {
					reject(new Error('Apply status poll attempts exceeded'));
					return;
				}
				attempts++;
				callSdnsApplyStatus(JSON.stringify({ operationId: opId })).then(function (r) {
					if (!r || r.error) { reject(new Error(formatRpcError(r || 'Status check failed'))); return; }
					if (r.finished) {
						if (r.state === 'success') resolve(r);
						else reject(new Error(formatRpcError(r.error || { message: 'Apply ' + (r.state || 'error'), operationId: opId })));
						return;
					}
					if (onPhase) onPhase(r.state || r.phase);
					setTimeout(tick, attempts < 3 ? 1000 : attempts < 6 ? 2000 : 5000);
				}).catch(function (e) {
					lastError = formatRpcError(e);
					view.showFlash(_('Connection check: ') + lastError.slice(0, 60));
					setTimeout(tick, 2000);
				});
			}
			tick();
		});
	}

	function showPreview(pv) {
		var old = view._saOverlay;
		if (old && old.parentNode) old.parentNode.removeChild(old);
		view._saOverlay = null;
		var diff = pv.diff || {};
		var dlg = E('div', { 'class': 'z2m-sa-preview-dlg' }, [
			E('h3', {}, _('Review changes')),
			E('div', {}, _('Added: ') + (diff.addedCount || 0) + '  ' + _('Removed: ') + (diff.removedCount || 0)),
			pv.candidate ? E('pre', { 'style': 'font-size:.8em;max-height:200px;overflow:auto;background:var(--cbi-row-u);padding:8px;border-radius:4px' }, esc(pv.candidate)) : null,
			(function () { var cls = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Close')); cls.addEventListener('click', function () { if (ov.parentNode) ov.parentNode.removeChild(ov); view._saOverlay = null; }); return cls; })()
		].filter(Boolean));
		var ov = E('div', { 'class': 'z2m-sa-preview-overlay' }, [dlg]);
		ov.addEventListener('click', function (e) { if (e.target === ov) { if (ov.parentNode) ov.parentNode.removeChild(ov); view._saOverlay = null; } });
		view._saOverlay = ov;
		document.body.appendChild(ov);
	}

	function h(el) { return document.createTextNode(el); }

	// Post-reload recovery — check for active operation
	if (pending && pending.operationId) {
		view._sdnsOp = { id: pending.operationId, type: 'apply', phase: pending.phase || 'unknown', promise: null };
		buildSticky();
		pollApplyStatus(pending.operationId, function (phase) {
			if (view._sdnsOp) { view._sdnsOp.phase = phase; buildSticky(); }
		}).then(function () {
			view._sdnsOp = null;
			view._saDraft = null;
			view.showFlash(_('Apply completed.'), 'success');
			view.reload();
		}).catch(function (e) {
			view._sdnsOp = null;
			view.showFlash(_('Apply ended: ') + formatRpcError(e).slice(0, 120), 'error');
			view.reload();
		});
	}

	return node;
}

// ════════════════════════════════════════════════════════
// Custom Service Select (r46.4.2 — fixed display + scroll)
// ════════════════════════════════════════════════════════
function createOperationId() {
	var randomPart;
	if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
		var bytes = new Uint32Array(2);
		window.crypto.getRandomValues(bytes);
		randomPart = bytes[0].toString(16) + bytes[1].toString(16);
	} else {
		randomPart = Math.floor(Math.random() * 0x7fffffff).toString(16);
	}
	return 'sdns-' + Date.now() + '-' + randomPart;
}

var _raf = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16); };
var _caf = window.cancelAnimationFrame  || function (id) { window.clearTimeout(id); };

function createServiceSelect(opts) {
	opts = opts || {};
	var value = (typeof opts.value === 'string' && opts.value.length > 0) ? opts.value : 'off';
	var options = opts.options || [{ value: 'off', label: 'Off', desc: '' }];
	var disabled = opts.disabled === true;
	var onChange = opts.onChange || function () {};
	var ariaLabel = opts.ariaLabel || '';
	var viewRef = opts.view || null;

	var root = E('div', { 'class': 'z2m-select' });
	var trigger = E('button', {
		'class': 'z2m-select-trigger',
		'type': 'button',
		'role': 'combobox',
		'aria-haspopup': 'listbox',
		'aria-expanded': 'false',
		'aria-label': ariaLabel
	});
	trigger.disabled = disabled;

	var valueSpan = E('span', { 'class': 'z2m-select-value' });
	var chevron = E('span', { 'class': 'z2m-select-chevron' }, '\u25be');
	trigger.appendChild(valueSpan);
	trigger.appendChild(chevron);
	root.appendChild(trigger);

	var popup = null;
	var searchInput = null;
	var optionEls = [];
	var activeIdx = -1;
	var opened = false;
	var destroyed = false;
	var resizeTimer = null;
	var positionFrame = null;

	function getSelectedOption() {
		for (var i = 0; i < options.length; i++) { if (options[i].value === value) return options[i]; }
		return null;
	}

	function updateDisplay() {
		var sel = getSelectedOption();
		if (sel) {
			valueSpan.textContent = sel.label || sel.value;
			trigger.title = sel.label || sel.value;
			trigger.setAttribute('aria-label', ariaLabel + ': ' + (sel.label || sel.value));
		} else {
			valueSpan.textContent = value === 'off' ? _('Off') : (_('Unknown: ') + value);
			trigger.title = _('Unknown profile: ') + value;
			trigger.setAttribute('aria-label', ariaLabel + ': ' + value);
		}
	}

	function syncActiveIndexToValue() {
		activeIdx = -1;
		for (var i = 0; i < optionEls.length; i++) {
			if (optionEls[i].getAttribute('aria-selected') === 'true') { activeIdx = i; break; }
		}
		if (activeIdx < 0 && optionEls.length > 0) activeIdx = 0;
	}

	function setValue(newVal, silent) {
		var normal = (typeof newVal === 'string' && newVal.length > 0) ? newVal : 'off';
		if (normal === value) return;
		value = normal;
		updateDisplay();
		if (!silent) onChange(value);
	}

	function getThemeClass() {
		var shell = document.getElementById('z2m-dns-shell');
		if (shell && shell.classList.contains('z2m-theme-dark')) return 'z2m-theme-dark';
		if (shell && shell.classList.contains('z2m-theme-light')) return 'z2m-theme-light';
		return 'z2m-theme-light';
	}

	function positionPopup() {
		if (!popup || !trigger) return;
		var rect = trigger.getBoundingClientRect();
		var vh = window.innerHeight || document.documentElement.clientHeight;
		var vw = window.innerWidth || document.documentElement.clientWidth;
		var gap = 4, edge = 8;
		var below = vh - rect.bottom - gap - edge;
		var above = rect.top - gap - edge;
		var openAbove = below < 180 && above > below;
		var availH = Math.max(120, Math.min(320, openAbove ? above : below));
		popup.style.maxHeight = availH + 'px';

		if (openAbove) {
			popup.style.top = 'auto';
			popup.style.bottom = Math.max(edge, vh - rect.top + gap) + 'px';
		} else {
			popup.style.bottom = 'auto';
			popup.style.top = Math.max(edge, rect.bottom + gap) + 'px';
		}

		var trigW = Math.max(rect.width, 120);
		var pw = Math.min(Math.max(trigW, 200), Math.min(320, vw - edge * 2));
		popup.style.width = pw + 'px';
		popup.style.left = Math.max(edge, Math.min(rect.left, vw - pw - edge)) + 'px';
	}

	function onKey(e) {
		if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); if (optionEls.length) { activeIdx = (activeIdx + 1) % optionEls.length; optionEls[activeIdx].focus(); } }
		else if (e.key === 'ArrowUp') { e.preventDefault(); if (optionEls.length) { activeIdx = activeIdx <= 0 ? optionEls.length - 1 : activeIdx - 1; optionEls[activeIdx].focus(); } }
		else if (e.key === 'Home') { e.preventDefault(); if (optionEls.length) { activeIdx = 0; optionEls[0].focus(); } }
		else if (e.key === 'End') { e.preventDefault(); if (optionEls.length) { activeIdx = optionEls.length - 1; optionEls[optionEls.length - 1].focus(); } }
		else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (activeIdx >= 0 && optionEls[activeIdx]) optionEls[activeIdx].click(); }
		else if (e.key === 'Tab') { closePopup(); }
	}

	function onOutside(e) {
		if (!popup || !opened) return;
		if (popup.contains(e.target) || root.contains(e.target)) return;
		closePopup(false);
	}

	function onScroll(e) {
		if (!popup || !opened) return;
		var t = e.target;
		if (t === popup || (t && popup.contains(t))) return;
		schedulePosition();
	}

	function onResize() {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(positionPopup, 80);
		schedulePosition();
	}

	function schedulePosition() {
		if (positionFrame !== null) return;
		positionFrame = _raf(function () {
			positionFrame = null;
			if (popup && opened && document.documentElement.contains(trigger)) {
				positionPopup();
			}
		});
	}

	function removeListeners() {
		document.removeEventListener('click', onOutside, true);
		window.removeEventListener('resize', onResize);
		window.removeEventListener('scroll', onScroll, true);
		if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
		if (positionFrame !== null) { _caf(positionFrame); positionFrame = null; }
	}

	function closePopup(restoreFocus) {
		if (restoreFocus === undefined) restoreFocus = true;
		opened = false;
		removeListeners();
		if (popup) {
			if (popup.parentNode) popup.parentNode.removeChild(popup);
			popup = null;
		}
		optionEls = [];
		activeIdx = -1;
		searchInput = null;
		trigger.setAttribute('aria-expanded', 'false');
		if (viewRef && viewRef._openServiceSelect === api) viewRef._openServiceSelect = null;
		if (restoreFocus && !destroyed) trigger.focus();
	}

	function openPopup() {
		if (destroyed || trigger.disabled) return;
		if (viewRef && viewRef._openServiceSelect && viewRef._openServiceSelect !== api) {
			viewRef._openServiceSelect.close(false);
		}

		popup = document.createElement('div');
		popup.className = 'z2m-select-popup';
		popup.setAttribute('role', 'listbox');
		popup.classList.add(getThemeClass());

		if (options.length > 8) {
			var sw = document.createElement('div');
			sw.className = 'z2m-select-search';
			searchInput = document.createElement('input');
			searchInput.type = 'search';
			searchInput.placeholder = _('Filter');
			sw.appendChild(searchInput);
			popup.appendChild(sw);
		}

		var list = document.createElement('div');
		list.className = 'z2m-select-list';

		function renderOptions(filter) {
			list.innerHTML = '';
			optionEls = [];
			activeIdx = -1;
			var f = (filter || '').toLowerCase();
			for (var i = 0; i < options.length; i++) {
				var o = options[i];
				if (f && o.label.toLowerCase().indexOf(f) < 0 && o.value.toLowerCase().indexOf(f) < 0) continue;
				var btn = document.createElement('button');
				btn.className = 'z2m-select-option' + (o.value === value ? ' z2m-select-option-selected' : '');
				btn.setAttribute('type', 'button');
				btn.setAttribute('role', 'option');
				btn.setAttribute('aria-selected', o.value === value ? 'true' : 'false');
				var lbl = document.createElement('span');
				lbl.className = 'z2m-select-option-label';
				lbl.textContent = o.label;
				btn.appendChild(lbl);
				if (o.desc) {
					var desc = document.createElement('span');
					desc.className = 'z2m-select-option-description';
					desc.textContent = o.desc;
					btn.appendChild(desc);
				}
				btn.addEventListener('click', (function (val) {
					return function (e) { e.preventDefault(); e.stopPropagation(); setValue(val); closePopup(); };
				})(o.value));
				list.appendChild(btn);
				optionEls.push(btn);
			}
		}
		renderOptions();
		popup.appendChild(list);
		document.body.appendChild(popup);
		positionPopup();
		trigger.setAttribute('aria-expanded', 'true');
		opened = true;

		popup.addEventListener('keydown', onKey);
		setTimeout(function () { document.addEventListener('click', onOutside, true); }, 0);
		window.addEventListener('resize', onResize);
		window.addEventListener('scroll', onScroll, true);

		if (viewRef) viewRef._openServiceSelect = api;

		if (searchInput) {
			searchInput.addEventListener('input', function () { renderOptions(searchInput.value); });
			setTimeout(function () { if (searchInput) searchInput.focus(); }, 50);
		} else if (optionEls.length > 0) {
			syncActiveIndexToValue();
			if (optionEls[activeIdx]) {
				optionEls[activeIdx].focus();
				try { optionEls[activeIdx].scrollIntoView({ block: 'nearest' }); } catch (e) {}
			}
		}
	}

	trigger.addEventListener('click', function () {
		if (opened) { closePopup(); } else { openPopup(); }
	});

	trigger.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
			e.preventDefault();
			openPopup();
		}
	});

	// Initial display — MUST happen before return
	updateDisplay();

	var api = {
		element: root,
		getValue: function () { return value; },
		setValue: setValue,
		setDisabled: function (d) { disabled = !!d; trigger.disabled = disabled; },
		open: function () { openPopup(); },
		close: function (restore) { closePopup(restore); },
		destroy: function () { closePopup(false); destroyed = true; }
	};

	return api;
}

// ════════════════════════════════════════════════════════
// ADVANCED — manual overrides, force DNS
// ════════════════════════════════════════════════════════
function advancedSection(view, dns, envelope) {
	var node = E('div');
	var draft = dns.draft || { entries: [], revision: 0, malformed: false };
	var applied = dns.applied || [];
	if (!view._dnsManualDraft) view._dnsManualDraft = (draft.entries || []).map(function (e) { return { domain: e.domain, ip: e.ip, enabled: e.enabled !== false }; });
	var entries = view._dnsManualDraft;
	var errors = E('div', { 'class': 'z2m-callout z2m-callout-bad', 'style': 'display:none' });

	// Manual overrides
	var mcard = card(_('Manual Host Overrides'), [
		E('p', { 'class': 'cbi-value-description' },
			_('Manual Host Overrides pin hostnames to IPs through a separate manager-owned addnhosts file. Service Access mappings use native dnsmasq UCI server entries. These mechanisms are independent and no longer share a file.'))
	]);
	mcard.appendChild(errors);

	if (draft.malformed) {
		mcard.appendChild(callout('bad', _('Draft is malformed: ') + esc(draft.malformedReason || '?')));
	} else {
		var rows = entries;
		if (!rows.length) {
		}
		var table = E('div', { 'class': 'z2m-manual-override-list' });
		rows.forEach(function (r, i) {
			var domain = E('input', { 'type': 'text', 'class': 'cbi-input', 'placeholder': _('domain'), 'value': r.domain });
			var ip = E('input', { 'type': 'text', 'class': 'cbi-input', 'placeholder': _('IPv4'), 'value': r.ip });
			var enabled = E('input', { 'type': 'checkbox' }); enabled.checked = r.enabled !== false;
			var remove = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Delete'));
			remove.addEventListener('click', function () { entries.splice(i, 1); view.switchSection('advanced'); });
			table.appendChild(E('div', { 'class': 'z2m-manual-override-row' }, [domain, ip, E('label', {}, [enabled, h(_(' Enabled'))]), remove]));
			r._domain = domain; r._ip = ip; r._enabled = enabled;
		});
		mcard.appendChild(table);
		var newDomain = E('input', { 'type': 'text', 'class': 'cbi-input', 'placeholder': _('domain') });
		var newIp = E('input', { 'type': 'text', 'class': 'cbi-input', 'placeholder': _('IPv4') });
		var add = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Add'));
		add.addEventListener('click', function () { if (!newDomain.value.trim() || !newIp.value.trim()) { errors.textContent = _('Domain and IPv4 are required.'); errors.style.display = ''; return; } entries.push({ domain: newDomain.value.trim(), ip: newIp.value.trim(), enabled: true }); view.switchSection('advanced'); });
		mcard.appendChild(E('div', { 'class': 'z2m-actions' }, [newDomain, newIp, add]));
		var save = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Save & Apply'));
		var discard = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Discard'));
		save.addEventListener('click', function () {
			var payload = rows.map(function (r) { return { domain: r._domain ? r._domain.value : r.domain, ip: r._ip ? r._ip.value : r.ip, enabled: r._enabled ? r._enabled.checked : r.enabled }; });
			save.disabled = true; discard.disabled = true; errors.style.display = 'none';
			callDnsValidate(JSON.stringify({ entries: payload })).then(function (v) {
				if (!v || v.valid !== true) { errors.textContent = (v.errors || []).map(function (e) { return (e.index >= 0 ? '#' + (e.index + 1) + ': ' : '') + e.reason; }).join('; ') || _('Validation failed'); errors.style.display = ''; throw new Error(_('Validation failed')); }
				return callDnsSet(JSON.stringify({ entries: payload, revision: draft.revision }));
			}).then(function () { return callDnsApply(JSON.stringify({ mode: 'apply' })); }).then(function (res) {
				if (!res || res.ok !== true) throw new Error(formatRpcError(res));
				view.showFlash(_('Manual overrides applied.'), 'success');
				view._dnsManualDraft = null;
				return view.reload();
			}).catch(function (e) { errors.textContent = formatRpcError(e); errors.style.display = ''; view.showFlash(_('Manual overrides failed: ') + formatRpcError(e), 'error'); }).then(function () { save.disabled = false; discard.disabled = false; });
		});
		discard.addEventListener('click', function () { view._dnsManualDraft = null; view.showFlash(_('Draft discarded.'), 'info'); view.reload(); });
		mcard.appendChild(E('div', { 'class': 'z2m-actions' }, [save, discard]));
	}
	node.appendChild(mcard);

	// Force DNS (informational only)
	var fcard = card(_('Force LAN Clients Through Router DNS'), [
		E('div', { 'class': 'z2m-callout z2m-callout-info' },
			_('Redirects LAN client DNS queries (port 53) to the router. Does NOT intercept encrypted DNS (DoH/DoT). Off by default.')),
		E('p', { 'class': 'cbi-value-description' }, [
			h(_('Status: ')),
			badge(_('Off'), 'neutral')
		]),
		E('p', { 'class': 'cbi-value-description' },
			_('This feature requires manual firewall rule configuration. It is not activated by opening this page.'))
	]);
	node.appendChild(fcard);

	return node;
}

// ════════════════════════════════════════════════════════
// HISTORY — events + safe rollback
// ════════════════════════════════════════════════════════
function historySection(view, dns, sdnsStatus) {
	var node = E('div');

	var dnsEvents = dns.events || [];
	var sdnsEvents = sdnsStatus.events || [];

	var allEvents = [].concat(
		(dnsEvents || []).map(function (e) { return Object.assign({ src: 'dns' }, e); }),
		(sdnsEvents || []).map(function (e) { return Object.assign({ src: 'sdns' }, e); })
	).filter(function (e) { return e.ts; }).sort(function (a, b) { return (a.ts > b.ts) ? -1 : (a.ts < b.ts) ? 1 : 0; });
	var operationRows = {};
	allEvents.forEach(function (ev) {
		var op = ev.operationId || (ev.ts + ':' + ev.action);
		var pending = /async|queued|pending|running/i.test(ev.action || '');
		var final = /success|failed|rollback|rolled/i.test(ev.action || '') || ev.status;
		var old = operationRows[op];
		if (!old || (!pending && final) || /async|queued|pending|running/i.test(old.action || '')) {
			operationRows[op] = Object.assign({}, old, ev, { ts: ev.ts || old.ts });
		}
	});
	allEvents = Object.keys(operationRows).map(function (op) { return operationRows[op]; }).sort(function (a, b) { return (a.ts > b.ts) ? -1 : (a.ts < b.ts) ? 1 : 0; });

	var limit = view._eventLimit || 20;
	var shown = allEvents.slice(0, limit);

	var hcard = card(_('Events') + ' (' + shown.length + '/' + allEvents.length + ')', []);
	if (!shown.length) {
		hcard.appendChild(E('div', { 'class': 'z2m-empty' }, _('No events recorded.')));
	} else {
		shown.forEach(function (ev) {
			var evStatus = ev.status || (/failed/i.test(ev.action || '') ? 'failed' : (/rollback|rolled/i.test(ev.action || '') ? 'rolled_back' : 'success'));
			var sBadge = evStatus === 'failed' ? badge(_('Failed'), 'bad') : (evStatus === 'rolled_back' ? badge(_('Rolled back'), 'warn') : badge(_('Success'), 'ok'));
			hcard.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label', 'style': 'font-family:monospace;font-size:.82em' }, esc(ev.ts || '?')),
				E('span', { 'class': 'z2m-kv-value' }, [sBadge, E('span', {}, ' ' + esc(ev.action || _('DNS operation'))), ev.operationId ? E('span', { 'title': ev.operationId, 'style': 'display:block;font-size:.78em' }, _('operationId: ') + esc(ev.operationId)) : null, ev.revision != null ? E('span', {}, ' ' + _('rev ') + ev.revision) : null, ev.providerCount != null ? E('span', {}, ' ' + ev.providerCount + _(' providers')) : null, ev.routeCount != null ? E('span', {}, ' ' + ev.routeCount + _(' routes')) : null].filter(Boolean))
			]));
		});
	}
	if (allEvents.length > limit) {
		var moreBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' },
			_('Load more (' + (allEvents.length - limit) + ' remaining)'));
		moreBtn.addEventListener('click', function () {
			view._eventLimit = (view._eventLimit || 20) + 20;
			view.switchSection();
		});
		hcard.appendChild(E('div', { 'class': 'z2m-actions' }, [moreBtn]));
	}
	node.appendChild(hcard);

	// Rollback
	var rcard = card(_('Rollback'), [
		kv(_('DNS overrides'), dns.revision != null ? _('rev ') + dns.revision : _('N/A')),
		kv(_('Service mappings'), sdnsStatus.appliedRevision != null ? _('rev ') + sdnsStatus.appliedRevision : _('N/A'))
	]);

	var dnsRbAvailable = dns.rollbackAvailable === true;
	var dnsRb = E('button', {
		'class': 'cbi-button cbi-button-negative',
		'type': 'button',
		'disabled': !dnsRbAvailable,
		'title': dnsRbAvailable ? '' : _('No rollback snapshot')
	}, _('Rollback DNS overrides'));
	if (dnsRbAvailable) dnsRb.addEventListener('click', function () {
		if (!window.confirm(_('Rollback DNS overrides to the last valid snapshot?'))) return;
		dnsRb.disabled = true;
		callDnsRollback().then(function (res) {
			if (!res || res.ok !== true) throw new Error(formatRpcError(res));
			view.showFlash(_('DNS overrides rolled back.'), 'success');
			return view.reload();
		}).catch(function (e) {
			view.showFlash(_('Rollback failed: ') + formatRpcError(e), 'error');
		});
	});

	var sdnsRbAvailable = sdnsStatus.rollbackAvailable === true;
	var sdnsRb = E('button', {
		'class': 'cbi-button cbi-button-negative',
		'type': 'button',
		'disabled': !sdnsRbAvailable,
		'title': sdnsRbAvailable ? '' : _('No rollback snapshot')
	}, _('Rollback service mappings'));
	if (sdnsRbAvailable) sdnsRb.addEventListener('click', function () {
		if (!window.confirm(_('Rollback Service DNS to the last successful native operation?'))) return;
		sdnsRb.disabled = true;
		callSdnsRollback().then(function (res) {
			if (!res || res.ok !== true) throw new Error(formatRpcError(res));
			view.showFlash(_('Service mappings rolled back.'), 'success');
			return view.reload();
		}).catch(function (e) {
			view.showFlash(_('Rollback failed: ') + formatRpcError(e), 'error');
		});
	});

	rcard.appendChild(E('div', { 'class': 'z2m-actions' }, [dnsRb, sdnsRb]));
	node.appendChild(rcard);

	return node;
}
