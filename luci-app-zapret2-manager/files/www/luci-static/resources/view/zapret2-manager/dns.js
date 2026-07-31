'use strict';
// DNS — Zapret2GUI-aligned DNS management for OpenWrt (r40).
//
// Sections: Setup | Providers | Service Access | Advanced | History.
// Grounding: dnsmasq + UCI + resolvfile. No Windows APIs, no per-adapter model.

'require rpc';

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
		var container = this._buildDOM(this._envelope);
		this._root = container;
		return container;
	},

	_buildDOM: function (envelope) {
		envelope = envelope || {};
		var dns = envelope.dns || {};
		var sdnsStatus = envelope.sdnsStatus || {};
		var sdnsProv = envelope.sdnsProv || {};
		var provs = envelope.provList || {};
		var comps = envelope.provComp || {};
		var self = this;
		var sec = this._section;

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('DNS')),
				E('p', {}, _('Manage DNS upstream servers, test providers, configure service access mappings.'))
			])
		]);

		if (envelope.dnsLoadError && sec !== 'history' && sec !== 'services') {
			container.appendChild(callout('bad', _('DNS data unavailable: ') + esc(envelope.dnsLoadError)));
		}

		// Navigation
		var nav = E('div', { 'class': 'z2m-tabs' });
		SECTIONS.forEach(function (s) {
			var cls = 'z2m-tab' + (sec === s.id ? ' z2m-tab-active' : '');
			var btn = E('button', { 'class': cls, 'type': 'button' }, s.label);
			btn.addEventListener('click', function () { self._section = s.id; self.switchSection(); });
			nav.appendChild(btn);
		});
		container.appendChild(nav);

		switch (sec) {
			case 'setup':     container.appendChild(setupSection(self, dns, comps, envelope)); break;
			case 'providers': container.appendChild(providersSection(self, provs, comps, envelope)); break;
			case 'services':  container.appendChild(servicesSection(self, dns, sdnsStatus, sdnsProv, envelope)); break;
			case 'advanced':  container.appendChild(advancedSection(self, dns, envelope)); break;
			case 'history':   container.appendChild(historySection(self, dns, sdnsStatus)); break;
		}

		if (this._flash) { container.appendChild(callout('warn', this._flash)); this._flash = null; }
		return container;
	},

	switchSection: function () {
		var oldRoot = this._root;
		var newRoot = this._buildDOM(this._envelope);
		if (oldRoot && oldRoot.parentNode) oldRoot.parentNode.replaceChild(newRoot, oldRoot);
		this._root = newRoot;
	},

	reload: function () {
		var self = this;
		this.load().then(function (envelope) {
			self._envelope = envelope;
			var oldRoot = self._root;
			var newRoot = self._buildDOM(envelope);
			if (oldRoot && oldRoot.parentNode) oldRoot.parentNode.replaceChild(newRoot, oldRoot);
			self._root = newRoot;
		});
	},

	refresh: function () { this.reload(); },

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

	// ── Error states ──
	if (envelope.sdnsProvErr || (provs.ok !== true && provs.ok !== undefined)) {
		node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, [
			E('h4', {}, _('Service catalog unavailable')),
			E('p', {}, _('Existing active mappings were not changed.')),
			E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'onclick': function () { view.reload(); } }, _('Retry'))
		]));
		return node;
	}

	// ── Build data maps ──
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

	// Local draft — initialized on first render
	if (!view._sdnsDraft) view._sdnsDraft = { selections: {}, dirty: false };
	var draft = view._sdnsDraft;
	// Copy server selections into draft if draft is empty
	if (Object.keys(draft.selections).length === 0 && Object.keys(selections).length > 0) {
		for (var k in selections) draft.selections[k] = selections[k];
	}

	// ── Compute stats ──
	var serviceOrder = [];
	var seen = {};
	(provs.profiles || []).forEach(function (p) {
		if (!seen[p.serviceId]) { seen[p.serviceId] = true; serviceOrder.push(p.serviceId); }
	});
	serviceOrder.sort();

	var enabledCount = 0, changedCount = 0;
	serviceOrder.forEach(function (svc) {
		var cur = draft.selections[svc] || 'off';
		var app = appliedSel[svc] || 'off';
		if (cur !== 'off') enabledCount++;
		if (cur !== app) changedCount++;
	});

	// ── Page introduction ──
	node.appendChild(E('div', { 'class': 'z2m-sa-intro' }, [
		E('h3', {}, _('Service Access')),
		E('p', {}, _('Choose a DNS answer profile for individual services without changing the global DNS provider.')),
		E('div', { 'class': 'z2m-callout z2m-callout-info', 'style': 'font-size:.85em' },
			_('Only selected service domains are overridden. Other DNS requests continue to use the router\'s normal resolver.'))
	]));

	// ── Status summary ──
	node.appendChild(E('div', { 'class': 'z2m-sa-summary' }, [
		sumCard(String(serviceOrder.length), _('Services'), 'ok'),
		sumCard(String((provs.providers || []).length), _('Providers'), 'neutral'),
		sumCard(String(enabledCount), _('Active'), enabledCount > 0 ? 'ok' : 'neutral'),
		sumCard(String(changedCount), _('Pending changes'), changedCount > 0 ? 'warn' : 'neutral')
	]));

	// ── Collapsible technical details ──
	var techId = 'z2m-sa-tech-' + Math.random().toString(36).slice(2, 8);
	var techHead = E('div', { 'class': 'z2m-sa-cathead collapsed', 'style': 'margin-bottom:10px',
		'onclick': function () { toggleCollapse(this); } }, [
		E('span', { 'class': 'z2m-sa-cat-arr' }, '▶'),
		_('Technical details'),
		E('span', { 'class': 'z2m-sa-cat-count' }, 'v' + esc(provs.datasetVersion || '?'))
	]);
	var techBody = E('div', { 'class': 'z2m-sa-catbody collapsed' }, [
		kv(_('Catalog version'), 'v' + esc(provs.datasetVersion || '?')),
		kv(_('Generated'), esc(provs.generatedAt || _('Unknown'))),
		kv(_('Profiles'), String((provs.profiles || []).length))
	]);
	node.appendChild(techHead);
	node.appendChild(techBody);

	// ── Filter toolbar ──
	var toolbar = E('div', { 'class': 'z2m-sa-toolbar' });
	var searchInput = E('input', { 'type': 'search', 'placeholder': _('Search services\u2026'), 'class': 'z2m-sa-tool-inp',
		'oninput': function () { applyFilters(); } });
	var catFilter = E('select', { 'class': 'z2m-sa-tool-sel', 'onchange': function () { applyFilters(); } }, [
		E('option', { value: '' }, _('All categories')),
		E('option', { value: 'AI' }, _('AI')),
		E('option', { value: 'Media' }, _('Media')),
		E('option', { value: 'Social' }, _('Social & messaging')),
		E('option', { value: 'Games' }, _('Games')),
		E('option', { value: 'Developer' }, _('Developer tools')),
		E('option', { value: 'Other' }, _('Other'))
	]);
	var stateFilter = E('select', { 'class': 'z2m-sa-tool-sel', 'onchange': function () { applyFilters(); } }, [
		E('option', { value: '' }, _('All states')),
		E('option', { value: 'enabled' }, _('Enabled')),
		E('option', { value: 'disabled' }, _('Disabled')),
		E('option', { value: 'changed' }, _('Changed'))
	]);
	var expBtn = E('button', { 'type': 'button', 'onclick': function () { expandAll(true); } }, _('Expand all'));
	var colBtn = E('button', { 'type': 'button', 'onclick': function () { expandAll(false); } }, _('Collapse all'));
	var resLabel = E('span', { 'class': 'z2m-sa-result' });

	toolbar.appendChild(searchInput);
	toolbar.appendChild(catFilter);
	toolbar.appendChild(stateFilter);
	toolbar.appendChild(expBtn);
	toolbar.appendChild(colBtn);
	toolbar.appendChild(resLabel);
	node.appendChild(toolbar);

	// ── Main grid (catalog + sidebar) ──
	var grid = E('div', { 'class': 'z2m-sa-grid' });
	var catalogEl = E('div', { 'class': 'z2m-sa-catalog' });

	// ── Build category groups ──
	var CAT_GROUPS = [
		{ id: 'AI', label: _('AI'), catKeys: ['AI'] },
		{ id: 'Media', label: _('Media'), catKeys: ['music', 'video', 'media'] },
		{ id: 'Social', label: _('Social & messaging'), catKeys: ['social', 'messaging'] },
		{ id: 'Games', label: _('Games'), catKeys: ['games'] },
		{ id: 'Developer', label: _('Developer tools'), catKeys: ['developer'] },
		{ id: 'Other', label: _('Other'), catKeys: ['other'] }
	];
	var catMap = {};
	serviceOrder.forEach(function (svc) {
		var rawCat = (SERVICE_CATEGORIES[svc] || 'other').toLowerCase();
		var groupId = 'Other';
		for (var gi = 0; gi < CAT_GROUPS.length; gi++) {
			if (CAT_GROUPS[gi].catKeys.indexOf(rawCat) >= 0) { groupId = CAT_GROUPS[gi].id; break; }
		}
		if (!catMap[groupId]) catMap[groupId] = [];
		catMap[groupId].push(svc);
	});

	// Render each category group
	CAT_GROUPS.forEach(function (group) {
		var svcs = catMap[group.id] || [];
		var catHead = E('div', { 'class': 'z2m-sa-cathead', 'data-cat': group.id,
			'onclick': function () { toggleCollapse(this); } }, [
			E('span', { 'class': 'z2m-sa-cat-arr' }, '▼'),
			esc(group.label),
			E('span', { 'class': 'z2m-sa-cat-count' }, svcs.length + ' ' + _('services'))
		]);
		var catBody = E('div', { 'class': 'z2m-sa-catbody', 'data-cat': group.id });
		catalogEl.appendChild(catHead);
		catalogEl.appendChild(catBody);
	});

	// ── Render service rows ──
	serviceOrder.forEach(function (svc) {
		var rawCat = (SERVICE_CATEGORIES[svc] || 'other').toLowerCase();
		var groupId = 'Other';
		for (var gi = 0; gi < CAT_GROUPS.length; gi++) {
			if (CAT_GROUPS[gi].catKeys.indexOf(rawCat) >= 0) { groupId = CAT_GROUPS[gi].id; break; }
		}

		var label = SERVICE_LABELS[svc] || svc;
		var sublabel = SERVICE_SUBLABEL[svc] || '';
		var profiles = profilesBySvc[svc] || [];
		var curSel = draft.selections[svc] || 'off';
		var applied = appliedSel[svc] || 'off';
		var rowId = 'z2m-sr-' + svc;

		// Row container
		var cls = 'z2m-sa-row';
		if (curSel !== 'off' && curSel === applied) cls += ' active';
		if (curSel !== applied) cls += ' changed';
		var row = E('div', { 'class': cls, 'id': rowId, 'data-svc': svc, 'data-cat': groupId,
			'data-enabled': curSel !== 'off' ? '1' : '0',
			'data-changed': curSel !== applied ? '1' : '0' });

		// Left: name + meta
		var metaBadges = [];
		if (curSel !== applied) {
			metaBadges.push(E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('Changed')));
			if (applied === 'off' && curSel !== 'off')
				metaBadges.push(E('span', { 'class': 'z2m-sa-change-arrow' }, _('Off \u2192 ') + esc(providerName[curSel] || curSel)));
			else if (curSel === 'off' && applied !== 'off')
				metaBadges.push(E('span', { 'class': 'z2m-sa-change-arrow' }, esc(providerName[applied] || applied) + _(' \u2192 Off')));
			else
				metaBadges.push(E('span', { 'class': 'z2m-sa-change-arrow' }, esc(providerName[applied] || applied) + ' \u2192 ' + esc(providerName[curSel] || curSel)));
		} else if (curSel !== 'off') {
			metaBadges.push(E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('Active')));
		}

		var avp = availableByService[svc] || [];
		var dc = avp.length ? avp[0].domainCount : (profiles.length ? profiles[0].requiredDomains.length : 0);
		metaBadges.push(E('span', {}, dc + ' ' + _('domains')));

		var left = E('div', { 'class': 'z2m-sa-name' }, [
			E('div', {}, [esc(label), sublabel ? E('span', { 'style': 'font-size:.82em;color:var(--cbi-desc);margin-left:4px' }, esc(sublabel)) : null].filter(Boolean)),
			E('div', { 'class': 'z2m-sa-meta' }, metaBadges)
		]);

		// Right: selector + details button
		var sel = E('select', { 'class': 'z2m-sa-sel', 'data-svc': svc, 'aria-label': _('Provider for ') + label,
			'id': 'sel-' + svc,
			'onchange': function () {
				draft.selections[svc] = sel.value;
				draft.dirty = true;
				renderPendingPanel();
				updateStickyBar();
				updateRowState(row, svc, sel.value, applied);
			} });
		sel.appendChild(E('option', { value: 'off' }, _('Off')));

		profiles.forEach(function (p) {
			var pvName = providerName[p.providerId] || p.providerId;
			var pvCount = 0;
			for (var ai = 0; ai < avp.length; ai++) {
				if (avp[ai].profileId === p.id) { pvName = avp[ai].providerName; pvCount = avp[ai].domainCount; break; }
			}
			if (pvCount === 0) pvCount = (p.requiredDomains || []).length;
			var optLabel = pvName + ' \u2014 ' + pvCount + ' ' + _('domains');
			var opt = E('option', { value: p.id }, optLabel);
			if (curSel === p.id) opt.selected = true;
			sel.appendChild(opt);
		});

		var detailBtn = E('button', { 'class': 'z2m-sa-detail-btn', 'type': 'button',
			'onclick': function () { toggleDetail(svc); } }, _('Details'));
		var right = E('div', { 'class': 'z2m-sa-right' }, [sel, detailBtn]);

		row.appendChild(left);
		row.appendChild(right);

		// Detail panel
		var detailPanel = buildDetailPanel(svc, curSel, profiles, providerName, avp);
		var catBody = catalogEl.querySelector('[data-cat="' + groupId + '"]');
		if (catBody) {
			catBody.appendChild(row);
			catBody.appendChild(detailPanel);
		}
	});

	grid.appendChild(catalogEl);

	// ── Pending changes sidebar ──
	var sidebar = E('div', { 'class': 'z2m-sa-sidebar', 'id': 'z2m-sa-sidebar' });
	// Initial population (before DOM insertion)
	buildPendingPanelContent(sidebar);
	grid.appendChild(sidebar);

	// ── Sticky action bar ──
	var sticky = E('div', { 'class': 'z2m-sa-sticky', 'id': 'z2m-sa-sticky' });
	buildStickyBarContent(sticky);
	node.appendChild(grid);
	node.appendChild(sticky);

	// ── Preview dialog (hidden, created on demand) ──
	view._saPreviewDialog = null;

	// ── Initial filter pass ──
	applyFilters();
	// Expand groups that have active mappings
	expandActive();

	// ── Helper functions ──
	function sumCard(num, label, cls) {
		var c = cls === 'warn' ? 'z2m-sa-sumcard' : 'z2m-sa-sumcard';
		return E('div', { 'class': c }, [
			E('span', { 'class': 'z2m-sa-sc-num', 'style': cls === 'warn' ? 'color:#b66' : (cls === 'ok' ? 'color:#4a4' : '') }, num),
			E('span', { 'class': 'z2m-sa-sc-label' }, label)
		]);
	}

	function toggleCollapse(head) {
		var isCollapsed = head.classList.contains('collapsed');
		var body = head.nextElementSibling;
		if (body && body.classList.contains('z2m-sa-catbody')) {
			if (isCollapsed) { head.classList.remove('collapsed'); body.classList.remove('collapsed'); }
			else { head.classList.add('collapsed'); body.classList.add('collapsed'); }
		}
	}

	function expandAll(expand) {
		var heads = node.querySelectorAll('.z2m-sa-cathead');
		for (var i = 0; i < heads.length; i++) {
			var h = heads[i];
			var b = h.nextElementSibling;
			if (!b || !b.classList.contains('z2m-sa-catbody')) continue;
			if (expand) { h.classList.remove('collapsed'); b.classList.remove('collapsed'); }
			else { h.classList.add('collapsed'); b.classList.add('collapsed'); }
		}
	}

	function expandActive() {
		var rows = node.querySelectorAll('.z2m-sa-row');
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i];
			if (r.getAttribute('data-enabled') === '1') {
				var catId = r.getAttribute('data-cat');
				var head = node.querySelector('.z2m-sa-cathead[data-cat="' + catId + '"]');
				if (head && head.classList.contains('collapsed')) toggleCollapse(head);
			}
		}
	}

	function applyFilters() {
		var q = (searchInput.value || '').toLowerCase();
		var cf = catFilter.value;
		var sf = stateFilter.value;
		var visible = 0;
		var rows = node.querySelectorAll('.z2m-sa-row');
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i];
			var svc = r.getAttribute('data-svc');
			var label = (SERVICE_LABELS[svc] || svc).toLowerCase();
			var sub = (SERVICE_SUBLABEL[svc] || '').toLowerCase();
			var cat = r.getAttribute('data-cat');
			var enabled = r.getAttribute('data-enabled') === '1';
			var changed = r.getAttribute('data-changed') === '1';
			var selPv = (draft.selections[svc] || 'off');
			var pvName = (providerName[selPv] || selPv).toLowerCase();

			var show = true;
			if (q && label.indexOf(q) < 0 && sub.indexOf(q) < 0 && svc.indexOf(q) < 0 && pvName.indexOf(q) < 0) show = false;
			if (cf && cat !== cf) show = false;
			if (sf === 'enabled' && !enabled) show = false;
			if (sf === 'disabled' && enabled) show = false;
			if (sf === 'changed' && !changed) show = false;

			r.style.display = show ? '' : 'none';
			// Also hide sibling detail panel
			var dp = r.nextElementSibling;
			if (dp && dp.classList.contains('z2m-sa-detail-panel')) dp.style.display = show ? dp.style.display : 'none';
			if (show) visible++;
		}
		// Auto-expand groups with visible results
		var groupsSeen = {};
		for (var i2 = 0; i2 < rows.length; i2++) {
			if (rows[i2].style.display !== 'none') groupsSeen[rows[i2].getAttribute('data-cat')] = true;
		}
		var heads = node.querySelectorAll('.z2m-sa-cathead');
		for (var i3 = 0; i3 < heads.length; i3++) {
			var h = heads[i3];
			var cid = h.getAttribute('data-cat');
			if (groupsSeen[cid]) { if (h.classList.contains('collapsed')) toggleCollapse(h); }
			else h.style.display = 'none';
		}
		// Restore hidden group headers when filter is cleared
		if (!q && !cf && !sf) {
			for (var i4 = 0; i4 < heads.length; i4++) heads[i4].style.display = '';
		}
		resLabel.textContent = _('Showing ') + visible + _(' of ') + serviceOrder.length;
	}

	function updateRowState(row, svc, newSel, applied) {
		var cls = 'z2m-sa-row';
		if (newSel !== 'off' && newSel === applied) cls += ' active';
		if (newSel !== applied) cls += ' changed';
		row.className = cls;
		row.setAttribute('data-enabled', newSel !== 'off' ? '1' : '0');
		row.setAttribute('data-changed', newSel !== applied ? '1' : '0');
		// Rebuild the meta area
		var metaEl = row.querySelector('.z2m-sa-meta');
		if (metaEl) {
			metaEl.innerHTML = '';
			var metaBadges = [];
			if (newSel !== applied) {
				var appBadge = E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('Changed'));
				var arrText = '';
				if (applied === 'off' && newSel !== 'off') arrText = _('Off \u2192 ') + esc(providerName[newSel] || newSel);
				else if (newSel === 'off' && applied !== 'off') arrText = esc(providerName[applied] || applied) + _(' \u2192 Off');
				else arrText = esc(providerName[applied] || applied) + ' \u2192 ' + esc(providerName[newSel] || newSel);
				metaEl.appendChild(appBadge);
				metaEl.appendChild(E('span', { 'class': 'z2m-sa-change-arrow' }, arrText));
			} else if (newSel !== 'off') {
				var actBadge = E('span', { 'class': 'z2m-badge z2m-badge-ok' }, _('Active'));
				metaEl.appendChild(actBadge);
			}
			var avp2 = availableByService[svc] || [];
			var profiles2 = profilesBySvc[svc] || [];
			var dc = avp2.length ? avp2[0].domainCount : (profiles2.length ? profiles2[0].requiredDomains.length : 0);
			metaEl.appendChild(E('span', {}, dc + ' ' + _('domains')));
		}
	}

	function renderPendingPanel() {
		var panel = document.getElementById('z2m-sa-sidebar');
		if (panel) buildPendingPanelContent(panel);
	}
	function buildPendingPanelContent(panel) {
		if (!panel) return;
		panel.innerHTML = '';
		panel.appendChild(E('h4', {}, _('Pending changes')));

		var changes = [];
		for (var svc in draft.selections) {
			var cur = draft.selections[svc];
			var app = appliedSel[svc] || 'off';
			if (cur === app) continue;
			var avp2 = availableByService[svc] || [];
			var dc = avp2.length ? avp2[0].domainCount : 0;
			changes.push({ svc: svc, cur: cur, app: app, dc: dc });
		}

		if (changes.length === 0) {
			panel.appendChild(E('p', { 'style': 'color:var(--cbi-desc);font-size:.85em' }, _('No unapplied changes.')));
			return;
		}

		changes.forEach(function (ch) {
			var label = SERVICE_LABELS[ch.svc] || ch.svc;
			var pvCur = ch.cur === 'off' ? _('Off') : (providerName[ch.cur] || ch.cur);
			var pvApp = ch.app === 'off' ? _('Off') : (providerName[ch.app] || ch.app);
			panel.appendChild(E('div', { 'class': 'z2m-sa-change' }, [
				E('div', {}, esc(label)),
				E('div', { 'style': 'font-size:.82em' },
					esc(pvApp) + E('span', { 'class': 'z2m-sa-change-arrow' }, '\u2192') + esc(pvCur)),
				E('div', { 'class': 'z2m-sa-recs' }, ch.dc + ' ' + _('domains'))
			]));
		});
	}

	function updateStickyBar() {
		var bar = document.getElementById('z2m-sa-sticky');
		if (bar) buildStickyBarContent(bar);
	}
	function buildStickyBarContent(bar) {
		if (!bar) return;
		bar.innerHTML = '';

		var changes = [];
		for (var svc in draft.selections) {
			var cur = draft.selections[svc];
			var app = appliedSel[svc] || 'off';
			if (cur !== app) changes.push({ svc: svc, cur: cur, app: app });
		}

		var left = E('div', { 'class': 'z2m-sa-st-left' });
		if (changes.length === 0) {
			left.textContent = _('No unapplied changes');
		} else {
			left.textContent = changes.length + ' ' + _('unapplied change(s)');
		}
		bar.appendChild(left);

		var right = E('div', { 'class': 'z2m-sa-st-right' });

		var discardBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'disabled': changes.length === 0,
			'onclick': function () {
				draft.selections = {};
				for (var k in selections) draft.selections[k] = selections[k];
				draft.dirty = false;
				view.reload();
			} }, _('Discard'));
		right.appendChild(discardBtn);

		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'disabled': changes.length === 0,
			'onclick': function () {
				prevBtn.disabled = true;
				callSdnsSet(JSON.stringify({ selections: draft.selections })).then(function () {
					callSdnsPreview().then(function (res) {
						prevBtn.disabled = false;
						showPreviewDialog(res);
					}).catch(function (err) {
						prevBtn.disabled = false;
						view._flash = _('Preview failed: ') + String(err);
						view.reload();
					});
				}).catch(function (err2) {
					prevBtn.disabled = false;
					view._flash = _('Save failed: ') + String(err2);
					view.reload();
				});
			} }, _('Preview changes'));
		right.appendChild(prevBtn);

		var applyBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'disabled': changes.length === 0,
			'onclick': function () {
				applyBtn.disabled = true;
				prevBtn.disabled = true;
				discardBtn.disabled = true;
				callSdnsApply(JSON.stringify({})).then(function (res) {
					if (res && res.ok === true) {
						view._flash = _('Service mappings applied and verified.');
					} else {
						view._flash = _('Apply failed: ') + esc((res && res.error && res.error.message) || res.error || '?');
					}
					view._sdnsDraft = null;
					view.reload();
				}).catch(function (err) {
					applyBtn.disabled = false;
					prevBtn.disabled = false;
					discardBtn.disabled = false;
					view._flash = _('Apply error: ') + String(err);
					view.reload();
				});
			} }, _('Apply all'));
		right.appendChild(applyBtn);

		bar.appendChild(right);
	}

	function showPreviewDialog(pv) {
		// Remove any existing dialog
		var oldOverlay = document.getElementById('z2m-sa-overlay');
		if (oldOverlay) oldOverlay.parentNode.removeChild(oldOverlay);

		var diff = pv.diff || {};
		var addedRecords = pv.added || [];
		var removedRecords = pv.removed || [];
		var warnings = pv.warnings || [];
		var hasConflict = pv.ok !== true;

		var body = [];

		// Summary
		body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
			E('h4', {}, _('Summary')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('Services changed: ') + (diff.addedCount + diff.removedCount || 0)),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('Records added: ') + (diff.addedCount || 0)),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('Records removed: ') + (diff.removedCount || 0)),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('Action: ') + _('dnsmasq reload'))
		]));

		// Service changes
		body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
			E('h4', {}, _('Services')),
			(function () {
				var lines = [];
				for (var svc in draft.selections) {
					var cur = draft.selections[svc];
					var app = appliedSel[svc] || 'off';
					if (cur === app) continue;
					var label = SERVICE_LABELS[svc] || svc;
					lines.push(E('div', { 'class': 'z2m-sa-pv-line' }, esc(label) + ': ' + (providerName[app] || _('Off')) + ' \u2192 ' + (providerName[cur] || _('Off'))));
				}
				return lines.length ? lines : E('div', { 'class': 'z2m-sa-pv-line' }, _('No service changes'));
			})()
		]));

		// DNS records
		if (addedRecords.length > 0 || removedRecords.length > 0) {
			body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
				E('h4', {}, _('DNS records')),
				(function () {
					var recs = [];
					for (var ai = 0; ai < addedRecords.length; ai++) {
						var r = addedRecords[ai];
						recs.push(E('div', { 'class': 'z2m-sa-pv-line z2m-sa-pv-added' }, '+ ' + (r.A && r.A[0] || '?') + ' ' + esc(r.hostname)));
					}
					for (var ri = 0; ri < removedRecords.length; ri++) {
						var rr = removedRecords[ri];
						recs.push(E('div', { 'class': 'z2m-sa-pv-line z2m-sa-pv-removed' }, '\u2212 ' + (rr.A && rr.A[0] || '?') + ' ' + esc(rr.hostname)));
					}
					return recs;
				})()
			]));
		}

		// Safety notes
		body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
			E('h4', {}, _('Safety')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('\u2022 Manager-owned addnhosts file will be updated')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('\u2022 Custom /etc/hosts records will not be removed')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('\u2022 dnsmasq will be reloaded')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('\u2022 Local resolver will be verified')),
			E('div', { 'class': 'z2m-sa-pv-line' }, _('\u2022 Previous snapshot will be restored on failure'))
		]));

		if (warnings.length > 0) {
			body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
				E('h4', {}, _('Warnings')),
				(function () {
					return warnings.map(function (w) {
						return E('div', { 'class': 'z2m-sa-pv-line', 'style': 'color:#b66' }, esc(w.type) + ': ' + esc(w.reason || w.provider || ''));
					});
				})()
			]));
		}

		if (pv.candidate) {
			body.push(E('div', { 'class': 'z2m-sa-pv-section' }, [
				E('h4', {}, _('Generated file')),
				E('pre', { 'style': 'font-size:.8em;max-height:200px;overflow:auto;background:var(--cbi-row-u);padding:8px;border-radius:4px' }, esc(pv.candidate))
			]));
		}

		if (hasConflict) {
			body.push(E('div', { 'class': 'z2m-callout z2m-callout-bad', 'style': 'margin-top:8px' }, _('Cannot apply: validation errors detected.')));
		}

		var dlg = E('div', { 'class': 'z2m-sa-preview-dlg' }, [
			E('h3', {}, _('Review service mapping changes')),
			(function () { return body; })()
		]);

		var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'style': 'margin-top:10px',
			'onclick': function () { overlay.parentNode.removeChild(overlay); } }, _('Close'));
		dlg.appendChild(E('div', { 'class': 'z2m-actions', 'style': 'margin-top:12px' }, [cancelBtn]));

		var overlay = E('div', { 'class': 'z2m-sa-preview-overlay', 'id': 'z2m-sa-overlay',
			'onclick': function (e) { if (e.target === overlay) overlay.parentNode.removeChild(overlay); } }, [dlg]);
		document.body.appendChild(overlay);
	}

	function toggleDetail(svc) {
		var row = document.getElementById('z2m-sr-' + svc);
		if (!row) return;
		var panel = row.nextElementSibling;
		if (!panel || !panel.classList.contains('z2m-sa-detail-panel')) return;
		var isOpen = panel.classList.contains('open');
		if (isOpen) panel.classList.remove('open');
		else panel.classList.add('open');
	}

	function buildDetailPanel(svc, curSel, profiles, providerName, avp) {
		var panel = E('div', { 'class': 'z2m-sa-detail-panel', 'id': 'z2m-sd-' + svc });
		var label = SERVICE_LABELS[svc] || svc;

		panel.appendChild(E('h4', { 'style': 'margin:0 0 6px' }, esc(label) + ' ' + _('details')));

		// Selected provider
		var pvLabel = curSel === 'off' ? _('Off') : (providerName[curSel] || curSel);
		panel.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Provider')),
			E('span', { 'class': 'z2m-kv-value' }, esc(pvLabel))
		]));

		// Domains
		var domains = null;
		for (var pi = 0; pi < profiles.length; pi++) {
			if (profiles[pi].id === curSel) { domains = profiles[pi].requiredDomains; break; }
		}
		if (!domains && profiles.length > 0) domains = profiles[0].requiredDomains;
		if (domains) {
			panel.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, _('Domains')),
				E('span', { 'class': 'z2m-kv-value' }, (function () {
					return domains.map(function (d) { return E('div', { 'style': 'font-family:monospace;font-size:.82em' }, esc(d)); });
				})())
			]));
		}

		// Provider IP for this variant
		var pv = null;
		for (var ai2 = 0; ai2 < avp.length; ai2++) { if (avp[ai2].profileId === curSel) { pv = avp[ai2]; break; } }
		if (pv && pv.providerIpv4 && pv.providerIpv4.length) {
			panel.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, _('Resolver IP')),
				E('span', { 'class': 'z2m-kv-value', 'style': 'font-family:monospace' }, esc(pv.providerIpv4.join(', ')))
			]));
		}

		// Notes/limitations
		panel.appendChild(E('div', { 'style': 'margin-top:8px;font-size:.82em;color:var(--cbi-desc)' },
			_('DNS answers may be cached by clients and browsers. Clear client DNS cache if changes are not immediately visible.')));

		return panel;
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
