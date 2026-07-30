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
	'chatgpt-openai': 'ChatGPT / OpenAI', 'google-gemini': 'Google Gemini',
	'discord': 'Discord', 'youtube': 'YouTube', 'twitch': 'Twitch',
	'spotify': 'Spotify', 'supercell': 'Supercell', 'github': 'GitHub',
	'githubusercontent': 'GitHubusercontent', 'telegram-web': 'Telegram Web',
	'notion': 'Notion'
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
	if (p.doh) badges.push(badge(_('DoH on record'), 'neutral'));
	badges.push(badge(p.category || '?', 'neutral'));

	var testBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Test'));
	testBtn.addEventListener('click', function () {
		testBtn.disabled = true;
		callProvDiag(JSON.stringify({ target: p.id })).then(function (res) {
			testBtn.disabled = false;
			view._flash = _('Test completed for ') + esc(p.name) + ': ' + (res && res.ok ? _('reachable') : _('failed'));
			view.reload();
		}).catch(function (err) {
			testBtn.disabled = false;
			view._flash = _('Test failed: ') + String(err);
			view.reload();
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
		])
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
		node.appendChild(callout('bad',
			_('Service DNS catalog unavailable: ') + esc(envelope.sdnsProvErr || ((provs.error && provs.error.message) || provs.error || '?'))));
		return node;
	}
	if (envelope.sdnsStatusErr) {
		node.appendChild(callout('warn', _('Service status unavailable: ') + esc(envelope.sdnsStatusErr)));
	}

	// Provider info
	var pinfo = card(_('Provider Dataset'), [
		kv(_('Version'), 'v' + esc(provs.datasetVersion || '?')),
		kv(_('Generated'), esc(provs.generatedAt || _('Unknown'))),
		kv(_('Providers'), String((provs.providers || []).length))
	]);
	node.appendChild(pinfo);

	// Service list
	var profilesByService = {};
	var serviceOrder = [];
	(provs.profiles || []).forEach(function (p) {
		if (!profilesByService[p.serviceId]) { profilesByService[p.serviceId] = []; serviceOrder.push(p.serviceId); }
		profilesByService[p.serviceId].push(p);
	});

	var selections = status.selections || {};
	var appliedSel = status.applied || {};

	var svcCard = card(_('Services') + ' (' + serviceOrder.length + ')', []);
	serviceOrder.sort().forEach(function (svc) {
		var label = SERVICE_LABELS[svc] || svc;
		var profiles = profilesByService[svc] || [];
		var curSel = selections[svc] || 'off';
		var applied = appliedSel[svc] || 'off';
		var drift = (status.drift && status.drift.serviceId === svc) ? status.drift : null;

		var sel = E('select', { 'class': 'cbi-input-select', 'data-service': svc, 'style': 'margin-right:.4em' });
		sel.appendChild(E('option', { value: 'off' }, _('Off')));
		profiles.forEach(function (p) {
			if (!p.applicable) return;
			var opt = E('option', { value: p.id }, p.id);
			if (curSel === p.id) opt.selected = true;
			sel.appendChild(opt);
		});

		var b = [];
		if (drift) b.push(E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('drift')));
		if (applied !== curSel && curSel !== 'off') b.push(E('span', { 'class': 'z2m-badge z2m-badge-warn' }, _('unapplied')));

		svcCard.appendChild(E('div', { 'class': 'z2m-kv', 'style': 'padding:.2em 0;border-bottom:1px solid var(--border,#ddd)' }, [
			E('span', { 'class': 'z2m-kv-label' }, esc(label)),
			E('span', { 'class': 'z2m-kv-value' }, [sel].concat(b))
		]));
	});
	node.appendChild(svcCard);

	// Actions
	var actions = E('div', { 'class': 'z2m-actions' });
	var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview changes'));
	prevBtn.addEventListener('click', function () {
		prevBtn.disabled = true;
		callSdnsPreview().then(function (res) {
			view._sdnsPreview = res || {};
			view.reload();
		}).catch(function (err) {
			view._sdnsPreview = { error: String(err) };
			view.reload();
		});
	});
	actions.appendChild(prevBtn);
	node.appendChild(actions);

	// Preview result if available
	var pv = view._sdnsPreview;
	if (pv) {
		view._sdnsPreview = null;
		var diff = pv.diff || {};
		var prevCard = card(_('Preview'), [
			kv(_('Added'), String(diff.addedCount || 0)),
			kv(_('Removed'), String(diff.removedCount || 0)),
			kv(_('Preserved'), String(diff.preservedCount || 0)),
			pv.candidate ? E('pre', { 'class': 'z2m-mono' }, esc(pv.candidate)) : null
		].filter(Boolean));
		if (pv.ok === true && pv.candidate) {
			var apBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
			apBtn.addEventListener('click', function () {
				apBtn.disabled = true;
				callSdnsApply(JSON.stringify({})).then(function (res) {
					view._flash = (res && res.ok === true) ? _('Applied.') : _('Apply failed.');
					view.reload();
				});
			});
			prevCard.appendChild(E('div', { 'class': 'z2m-actions' }, [apBtn]));
		}
		node.appendChild(prevCard);
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
