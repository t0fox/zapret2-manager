'use strict';
// DNS — Zapret2GUI-aligned DNS management for OpenWrt (r46).
//
// Sections: Setup | Providers | Service Access | Advanced | History.
// Grounding: dnsmasq + UCI + resolvfile. No Windows APIs, no per-adapter model.
'require rpc';

const DNS_UI_BUILD = 'r46';

const callDnsGet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_get', reject: true });
const callDnsSet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_set', params: ['edit'], reject: true });
const callDnsValidate   = rpc.declare({ object: 'zapret2-manager', method: 'dns_validate', params: ['edit'], reject: true });
const callDnsApply      = rpc.declare({ object: 'zapret2-manager', method: 'dns_apply', params: ['edit'], reject: true });
const callDnsCheck      = rpc.declare({ object: 'zapret2-manager', method: 'dns_check', params: ['edit'], reject: true });
const callDnsRollback   = rpc.declare({ object: 'zapret2-manager', method: 'dns_rollback', reject: true });
const callProvComp      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_components', reject: true });
const callProvList      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_providers', reject: true });
const callProvDiag      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_diagnose', params: ['edit'], reject: true });
const callSdnsProv      = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_providers', reject: true });
const callSdnsStatus    = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_status', reject: true });
const callSdnsPreview   = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_preview', reject: true });
const callSdnsSet       = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_set', params: ['edit'], reject: true });
const callSdnsApply     = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply', params: ['edit'], reject: true });
const callSdnsApplyAsync = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply_async', reject: true });
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
	var cls = { warn: 'z2m-callout z2m-callout-warn', bad: 'z2m-callout z2m-callout-bad', info: 'z2m-callout z2m-callout-info' };
	return E('div', { 'class': cls[type] || cls.warn }, text);
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

	showFlash: function (msg) {
		if (!this._flashHost) return;
		this._flash = msg;
		this._showStoredFlash();
	},

	_showStoredFlash: function () {
		if (!this._flashHost || !this._flash) return;
		this._flashHost.innerHTML = '';
		this._flashHost.appendChild(callout('warn', this._flash));
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
	var chooseBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Choose DNS'));
	chooseBtn.addEventListener('click', function () { view._section = 'providers'; view.switchSection(); });
	var restoreBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Restore automatic DNS'));
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
		rows.push(kv(_('dnsmasq'), dm.running ? badge(_('Running'), 'ok') : badge(_('Stopped'), 'bad')));
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

	var rbAvailable = dns.revision != null || dns.rollbackAvailable;
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
	testAllBtn.addEventListener('click', function () { /* run diag */ });
	node.appendChild(E('div', { 'class': 'z2m-actions' }, [testAllBtn]));

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

	if (!view._saDraft) view._saDraft = { selections: {} };
	var draft = view._saDraft;
	if (Object.keys(draft.selections).length === 0 && Object.keys(selections).length > 0) {
		for (var k in selections) draft.selections[k] = selections[k];
	}

	var serviceOrder = [];
	var svcSet = {};
	(provs.profiles || []).forEach(function (p) {
		if (!svcSet[p.serviceId]) { svcSet[p.serviceId] = true; serviceOrder.push(p.serviceId); }
	});
	serviceOrder.sort();

	var enabledCount = 0, changedCount = 0;
	serviceOrder.forEach(function (svc) {
		var cur = draft.selections[svc] || 'off';
		var app = appliedSel[svc] || 'off';
		if (cur !== 'off') enabledCount++;
		if (cur !== app) changedCount++;
	});

	// ── intro ──
	node.appendChild(E('div', { 'class': 'z2m-sa-intro' }, [
		E('h3', {}, _('Service Access')),
		E('p', {}, _('Choose a DNS answer profile for individual services without changing the global DNS provider.'))
	]));

	// ── summary ──
	node.appendChild(E('div', { 'class': 'z2m-sa-summary' }, [
		sc(serviceOrder.length, _('Services')),
		sc((provs.providers || []).length, _('Providers')),
		sc(enabledCount, _('Active')),
		sc(changedCount, _('Pending'))
	]));

	// ── toolbar ──
	var srch = E('input', { 'type': 'search', 'placeholder': _('Search') });
	var sfSel = E('select', {}, [
		E('option', { value: '' }, _('All')),
		E('option', { value: 'enabled' }, _('On')),
		E('option', { value: 'disabled' }, _('Off')),
		E('option', { value: 'changed' }, _('Changed'))
	]);
	var resLbl = E('span', { 'class': 'z2m-sa-result' });
	var tb = E('div', { 'class': 'z2m-sa-toolbar' });
	tb.appendChild(srch);
	tb.appendChild(sfSel);
	tb.appendChild(resLbl);
	node.appendChild(tb);

	// ── catalog ──
	var grid = E('div', { 'class': 'z2m-sa-grid' });
	var catEl = E('div', { 'class': 'z2m-sa-catalog' });

	var CAT = [
		{ id: 'AI', label: _('AI'), keys: ['AI'] },
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

	var catHeadRefs = [], catBodyRefs = [], allRows = [];

	CAT.forEach(function (grp) {
		var svcs = catMap[grp.id] || [];
		var empty = svcs.length === 0;
		var hd = E('div', { 'class': 'z2m-sa-cathead', 'data-cat': grp.id });
		var hdArr = E('span', { 'class': 'z2m-sa-cat-arr' }, empty ? '' : '▼');
		hd._arr = hdArr;
		hd.appendChild(hdArr);
		hd.appendChild(E('span', { 'class': 'z2m-sa-cat-title' }, esc(grp.label)));
		hd.appendChild(E('span', { 'class': 'z2m-sa-cat-count' }, svcs.length + ' ' + _('svc')));
		hd.addEventListener('click', function () {
			var bd = this.nextElementSibling;
			if (bd) { var hide = !bd._hidden; bd._hidden = hide; bd.style.display = hide ? 'none' : ''; this._arr.textContent = hide ? '▶' : '▼'; }
		});
		var bd = E('div', { 'class': 'z2m-sa-catbody', 'data-cat': grp.id });
		if (empty) { bd.style.display = 'none'; bd._hidden = true; hdArr.textContent = ''; }
		catEl.appendChild(hd);
		catEl.appendChild(bd);
		catHeadRefs.push(hd);
		catBodyRefs.push(bd);
	});

	serviceOrder.forEach(function (svc) {
		var rc = (SERVICE_CATEGORIES[svc] || 'other').toLowerCase();
		var gid = 'Other';
		for (var gi = 0; gi < CAT.length; gi++) {
			if (CAT[gi].keys.indexOf(rc) >= 0) { gid = CAT[gi].id; break; }
		}
		var label = SERVICE_LABELS[svc] || svc;
		var sub = SERVICE_SUBLABEL[svc] || '';
		var profiles = profilesBySvc[svc] || [];
		var cur = draft.selections[svc] || 'off';
		var app = appliedSel[svc] || 'off';
		var avp = availableByService[svc] || [];
		var dc = avp.length ? avp[0].domainCount : (profiles.length ? profiles[0].requiredDomains.length : 0);

		var row = E('div', { 'class': 'z2m-sa-row', 'data-svc': svc, 'data-cat': gid });

		// col 1: name
		var nameDiv = E('div', { 'class': 'z2m-sa-name' }, [
			E('div', { 'class': 'z2m-sa-name-title' }, esc(label)),
			sub ? E('div', { 'class': 'z2m-sa-name-sub' }, esc(sub)) : null
		].filter(Boolean));

		// col 2: meta
		var metaDiv = E('div', { 'class': 'z2m-sa-meta' });
		var rebadge = function () {
			metaDiv.innerHTML = '';
			var c2 = draft.selections[svc] || 'off';
			var a2 = appliedSel[svc] || 'off';
			if (c2 !== a2) {
				metaDiv.appendChild(E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('Changed')));
				metaDiv.appendChild(h(E('span', {}, 'Off'.substring(0,0)))); // placeholder
			} else if (c2 !== 'off') {
				metaDiv.appendChild(E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('On')));
			}
			metaDiv.appendChild(h(E('span', {}, ' ')));
			metaDiv.appendChild(h(E('span', {}, dc + ' ' + _('domains'))));
		};
		rebadge();

		// col 3: selector
		var sel = E('select', { 'class': 'z2m-sa-sel', 'id': 'sel-' + svc });
		sel.appendChild(E('option', { value: 'off' }, _('Off')));
		profiles.forEach(function (p) {
			var pn = providerName[p.providerId] || p.providerId;
			var pc = 0;
			for (var ai = 0; ai < avp.length; ai++) {
				if (avp[ai].profileId === p.id) { pn = avp[ai].providerName; pc = avp[ai].domainCount; break; }
			}
			if (!pc) pc = (p.requiredDomains || []).length;
			var opt = E('option', { value: p.id }, pn);
			if (cur === p.id) opt.selected = true;
			sel.appendChild(opt);
		});
		sel.addEventListener('change', function () {
			draft.selections[svc] = sel.value;
			draft.dirty = true;
			rebadge();
			buildSidebar();
			buildSticky();
		});

		// col 4: details
		var dtlBtn = E('button', { 'class': 'z2m-sa-detail-btn', 'type': 'button' }, _('Details'));
		var dtlPnl = E('div', { 'class': 'z2m-sa-detail-panel', 'id': 'dtl-' + svc });
		dtlPnl.appendChild(E('h4', { 'style': 'margin:4px 0' }, esc(label)));
		dtlPnl.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Provider')),
			E('span', { 'class': 'z2m-kv-value' }, cur === 'off' ? _('Off') : (providerName[cur] || cur))
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
		row.appendChild(sel);
		row.appendChild(dtlBtn);

		// Find correct category body
		for (var bi = 0; bi < catBodyRefs.length; bi++) {
			if (catBodyRefs[bi].getAttribute('data-cat') === gid) {
				catBodyRefs[bi].appendChild(row);
				catBodyRefs[bi].appendChild(dtlPnl);
				break;
			}
		}
		allRows.push(row);
	});

	grid.appendChild(catEl);

	// ── sidebar ──
	var sidebar = E('div', { 'class': 'z2m-sa-sidebar' });
	function buildSidebar() {
		sidebar.innerHTML = '';
		sidebar.appendChild(E('h4', {}, _('Pending changes')));
		var chgs = [];
		for (var svc in draft.selections) {
			var c = draft.selections[svc], a = appliedSel[svc] || 'off';
			if (c === a) continue;
			chgs.push({ svc: svc, cur: c, app: a });
		}
		if (!chgs.length) { sidebar.appendChild(E('p', { 'style': 'color:var(--cbi-desc);font-size:.85em' }, _('None.'))); return; }
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
	grid.appendChild(sidebar);
	node.appendChild(grid);

	// ── filter logic ──
	function doFilter() {
		var q = (srch.value || '').toLowerCase();
		var sf = sfSel.value;
		var vis = 0;
		for (var i = 0; i < allRows.length; i++) {
			var r = allRows[i];
			var sv = r.getAttribute('data-svc');
			var sl = (SERVICE_LABELS[sv] || sv).toLowerCase();
			var sb = (SERVICE_SUBLABEL[sv] || '').toLowerCase();
			var ct = r.getAttribute('data-cat');
			var en = draft.selections[sv] !== 'off';
			var ch = (draft.selections[sv] || 'off') !== (appliedSel[sv] || 'off');
			var show = true;
			if (q && sl.indexOf(q) < 0 && sb.indexOf(q) < 0 && sv.indexOf(q) < 0) show = false;
			if (sf === 'enabled' && !en) show = false;
			if (sf === 'disabled' && en) show = false;
			if (sf === 'changed' && !ch) show = false;
			r.style.display = show ? '' : 'none';
			var dp = r.nextElementSibling;
			if (dp && dp.classList && dp.classList.contains('z2m-sa-detail-panel')) dp.style.display = 'none';
			if (show) vis++;
		}
		// Show/hide category heads
		var seen = {};
		for (var i2 = 0; i2 < allRows.length; i2++) { if (allRows[i2].style.display !== 'none') seen[allRows[i2].getAttribute('data-cat')] = true; }
		for (var i3 = 0; i3 < catHeadRefs.length; i3++) {
			var hd = catHeadRefs[i3];
			var cid = hd.getAttribute('data-cat');
			var bd = catBodyRefs[i3];
			if (seen[cid]) {
				hd.style.display = '';
				if (bd._hidden) { bd._hidden = false; bd.style.display = ''; hd._arr.textContent = '▼'; }
			} else {
				hd.style.display = 'none';
				bd.style.display = 'none';
			}
		}
		resLbl.textContent = _('Showing ') + vis + _(' of ') + serviceOrder.length;
	}
	srch.addEventListener('input', doFilter);
	sfSel.addEventListener('change', doFilter);
	doFilter();

	// ── sticky bar ──
	var sticky = E('div', { 'class': 'z2m-sa-sticky' });
	function buildSticky() {
		sticky.innerHTML = '';
		var chgs = [];
		for (var svc in draft.selections) {
			var c = draft.selections[svc], a = appliedSel[svc] || 'off';
			if (c !== a) chgs.push(1);
		}
		var has = chgs.length > 0;
		var left = E('div', { 'class': 'z2m-sa-st-left' });
		left.textContent = has ? (chgs.length + ' ' + _('unapplied')) : _('No changes');
		sticky.appendChild(left);
		var right = E('div', { 'class': 'z2m-sa-st-right' });

		var disc = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Discard'));
		disc.disabled = !has || (view._sdnsOp && view._sdnsOp.promise);
		disc.addEventListener('click', function () {
			draft.selections = {};
			for (var k in selections) draft.selections[k] = selections[k];
			draft.dirty = false;
			view.showFlash(_('Draft discarded.'));
			view.reload();
		});
		right.appendChild(disc);

		var prev = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview'));
		prev.disabled = !has || (view._sdnsOp && view._sdnsOp.promise);
		prev.addEventListener('click', function () {
			prev.disabled = true;
			callSdnsSet(JSON.stringify({ selections: draft.selections })).then(function () {
				callSdnsPreview().then(function (res) {
					prev.disabled = false;
					showPreview(res);
				})['catch'](function (e) { prev.disabled = false; view.showFlash(String(e)); });
			})['catch'](function (e) { prev.disabled = false; view.showFlash(String(e)); });
		});
		right.appendChild(prev);

		var appl = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
		appl.disabled = !has || (view._sdnsOp && view._sdnsOp.promise);
		appl.addEventListener('click', function () {
			if (view._sdnsOp && view._sdnsOp.promise) return;
			var opId = 'sdns-' + Date.now();
			var snapshot = {};
			for (var k in draft.selections) snapshot[k] = draft.selections[k];

			view._sdnsOp = { id: opId, type: 'apply', phase: 'saving', promise: null, error: null };
			appl.disabled = true; prev.disabled = true; disc.disabled = true;
			left.textContent = _('Saving\u2026');

			view._sdnsOp.promise = callSdnsSet(JSON.stringify({ selections: snapshot })).then(function (sr) {
				if (!sr || sr.ok !== true) throw new Error('Set failed');
				view._sdnsOp.phase = 'submitting';
				left.textContent = _('Starting Apply\u2026');
				return callSdnsApplyAsync();
			}).then(function (ar) {
				if (!ar || !ar.accepted) throw new Error('Apply not accepted');
				view._sdnsOp.phase = 'queued';
				view._sdnsOp.operationId = ar.operationId;
				left.textContent = _('Applying\u2026');
				return pollApplyStatus(ar.operationId, function (phase) {
					if (phase === 'reloading') left.textContent = _('Reloading DNS\u2026');
					else if (phase === 'verifying') left.textContent = _('Verifying\u2026');
					else if (phase === 'rolling_back') left.textContent = _('Rolling back\u2026');
				});
			}).then(function () {
				view._sdnsOp.phase = 'success';
				view._sdnsOp = null;
				view._saDraft = null;
				view.showFlash(_('Applied and verified.'));
				view.reload();
			}).catch(function (e) {
				view._sdnsOp.phase = 'error';
				view._sdnsOp.error = String(e);
				view._sdnsOp.promise = null;
				view.showFlash(_('Failed: ') + String(e).slice(0, 120));
				view.reload();
			});
		});
		right.appendChild(appl);
		sticky.appendChild(right);
	}
	buildSticky();
	node.appendChild(sticky);

	function sc(n, l) { return E('div', { 'class': 'z2m-sa-sumcard' }, [E('span', { 'class': 'z2m-sa-sc-num' }, String(n)), E('span', { 'class': 'z2m-sa-sc-label' }, l)]); }
	function h(el) { return el; }

	function pollApplyStatus(opId, onPhase) {
		return new Promise(function (resolve, reject) {
			var attempts = 0, maxAttempts = 30;
			function tick() {
				if (attempts >= maxAttempts) { reject(new Error('Apply status poll timeout')); return; }
				attempts++;
				callSdnsApplyStatus(JSON.stringify({ operationId: opId })).then(function (r) {
					if (!r || !r.ok) { reject(new Error('Status check failed')); return; }
					if (r.finished) {
						if (r.state === 'success') resolve(r);
						else reject(new Error('Apply ' + (r.state || 'error') + ': ' + (r.error || '')));
						return;
					}
					if (onPhase) onPhase(r.state);
					setTimeout(tick, attempts < 3 ? 1000 : attempts < 8 ? 2000 : 5000);
				}).catch(function (e) { reject(e); });
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

	return node;
}

// ════════════════════════════════════════════════════════
// ADVANCED — manual overrides, force DNS
// ════════════════════════════════════════════════════════
function advancedSection(view, dns, envelope) {
	var node = E('div');
	var draft = dns.draft || { entries: [], revision: 0, malformed: false };
	var applied = dns.applied || [];

	// Manual overrides
	var mcard = card(_('Manual Host Overrides'), [
		E('p', { 'class': 'cbi-value-description' },
			_('Pin specific hostnames to IP addresses through dnsmasq addnhosts. These work alongside service-generated mappings and share the same overrides file.'))
	]);

	if (draft.malformed) {
		mcard.appendChild(callout('bad', _('Draft is malformed: ') + esc(draft.malformedReason || '?')));
	} else {
		var rows = draft.entries || [];
		if (!rows.length) {
			mcard.appendChild(E('div', { 'class': 'z2m-empty' }, _('No manual overrides. Add entries below.')));
		} else {
			rows.forEach(function (r, i) {
				mcard.appendChild(E('div', { 'class': 'z2m-kv' }, [
					E('span', { 'class': 'z2m-kv-label', 'style': 'font-family:monospace' }, esc(r.domain)),
					E('span', { 'class': 'z2m-kv-value' }, esc(r.ip))
				]));
			});
		}
	}
	node.appendChild(mcard);

	// Force DNS (informational only)
	var fcard = card(_('Force LAN Clients Through Router DNS'), [
		E('div', { 'class': 'z2m-callout z2m-callout-info' },
			_('Redirects LAN client DNS queries (port 53) to the router. Does NOT intercept encrypted DNS (DoH/DoT). Off by default.')),
		E('p', { 'class': 'cbi-value-description' },
			_('Status: ') + badge(_('Off'), 'neutral')),
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
		(dnsEvents || []).map(function (e) { return { src: 'dns', ts: e.ts, action: e.action }; }),
		(sdnsEvents || []).map(function (e) { return { src: 'sdns', ts: e.ts, action: e.action }; })
	).filter(function (e) { return e.ts; }).sort(function (a, b) { return (a.ts > b.ts) ? -1 : (a.ts < b.ts) ? 1 : 0; });

	var limit = view._eventLimit || 20;
	var shown = allEvents.slice(0, limit);

	var hcard = card(_('Events') + ' (' + shown.length + '/' + allEvents.length + ')', []);
	if (!shown.length) {
		hcard.appendChild(E('div', { 'class': 'z2m-empty' }, _('No events recorded.')));
	} else {
		shown.forEach(function (ev) {
			var sBadge = ev.src === 'sdns' ? badge(_('Service'), 'ok') : badge(_('DNS'), 'neutral');
			hcard.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label', 'style': 'font-family:monospace;font-size:.82em' }, esc(ev.ts || '?')),
				E('span', { 'class': 'z2m-kv-value' }, [sBadge, ' ' + esc(ev.action)])
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
		kv(_('Service mappings'), (sdnsStatus.applied && sdnsStatus.applied.revision != null) ? _('rev ') + sdnsStatus.applied.revision : _('N/A'))
	]);

	var dnsRbAvailable = dns.revision != null || dns.rollbackAvailable;
	var dnsRb = E('button', {
		'class': 'cbi-button cbi-button-negative',
		'type': 'button',
		'disabled': !dnsRbAvailable,
		'title': dnsRbAvailable ? '' : _('No rollback snapshot')
	}, _('Rollback DNS overrides'));
	if (dnsRbAvailable) dnsRb.addEventListener('click', function () {
		dnsRb.disabled = true;
		callDnsRollback().then(function (res) {
			view._flash = (res && res.ok === true) ? _('Rolled back.') : _('Rollback failed.');
			view.reload();
		});
	});

	var sdnsRbAvailable = sdnsStatus.applied && sdnsStatus.applied.revision != null;
	var sdnsRb = E('button', {
		'class': 'cbi-button cbi-button-negative',
		'type': 'button',
		'disabled': !sdnsRbAvailable,
		'title': sdnsRbAvailable ? '' : _('No rollback snapshot')
	}, _('Rollback service mappings'));
	if (sdnsRbAvailable) sdnsRb.addEventListener('click', function () {
		sdnsRb.disabled = true;
		callSdnsRollback().then(function (res) {
			view._flash = (res && res.ok === true) ? _('Rolled back.') : _('Rollback failed.');
			view.reload();
		});
	});

	rcard.appendChild(E('div', { 'class': 'z2m-actions' }, [dnsRb, sdnsRb]));
	node.appendChild(rcard);

	return node;
}
