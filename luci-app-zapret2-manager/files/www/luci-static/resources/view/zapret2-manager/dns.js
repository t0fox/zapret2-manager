'use strict';
// DNS Centre — unified DNS surface (r38).
// Merger: DNS overrides + service-DNS mappings + providers + history.
//
// Grounding: dnsmasq is the resolver (/etc/config/dhcp); odhcpd does RA;
// no third-party resolver on this device. The manager owns ONE addnhosts
// file (/etc/zapret2-manager/dns-overrides.hosts). Service-generated A
// records and user DNS overrides coexist. Ownership tracked at
// hostname+family+address; user records are NEVER claimed.
// No browser-direct UCI writes — every write goes through rpc methods.

'require rpc';

// ---- DNS override RPC ----
const callDnsGet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_get', reject: true });
const callDnsSet        = rpc.declare({ object: 'zapret2-manager', method: 'dns_set', params: ['edit'], reject: true });
const callDnsValidate   = rpc.declare({ object: 'zapret2-manager', method: 'dns_validate', params: ['edit'], reject: true });
const callDnsApply      = rpc.declare({ object: 'zapret2-manager', method: 'dns_apply', params: ['edit'], reject: true });
const callDnsCheck      = rpc.declare({ object: 'zapret2-manager', method: 'dns_check', params: ['edit'], reject: true });
const callDnsRollback   = rpc.declare({ object: 'zapret2-manager', method: 'dns_rollback', reject: true });

// ---- DNS providers RPC ----
const callProvComp      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_components', reject: true });
const callProvList      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_providers', reject: true });
const callProvDiag      = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_diagnose', params: ['edit'], reject: true });

// ---- Service DNS RPC ----
const callSdnsProv      = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_providers', reject: true });
const callSdnsStatus    = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_status', reject: true });
const callSdnsPreview   = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_preview', reject: true });
const callSdnsSet       = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_set', params: ['edit'], reject: true });
const callSdnsApply     = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply', params: ['edit'], reject: true });
const callSdnsRollback  = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_rollback', reject: true });

// ---- constants ----
var SERVICE_LABELS = {
	'chatgpt-openai': 'ChatGPT / OpenAI', 'google-gemini': 'Google Gemini',
	'discord': 'Discord', 'youtube': 'YouTube', 'twitch': 'Twitch',
	'spotify': 'Spotify', 'supercell': 'Supercell', 'github': 'GitHub',
	'githubusercontent': 'GitHubusercontent', 'telegram-web': 'Telegram Web',
	'notion': 'Notion'
};

var TABS = [
	{ id: 'overview',  label: _('Overview') },
	{ id: 'svc',       label: _('Service mappings') },
	{ id: 'manual',    label: _('Manual overrides') },
	{ id: 'providers', label: _('Providers & diagnostics') },
	{ id: 'history',   label: _('History & rollback') }
];

// ---- helpers ----
function esc(s) { return (s == null) ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function h(c) { return document.createTextNode(c); }
function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
	return E('span', { 'class': map[cls] || map.neutral }, esc(label));
}
function trustBadgeCls(trust, applicable) {
	if (!applicable) return 'zonebadge bad';
	if (trust === 'bundled-reviewed') return 'zonebadge ok';
	if (trust === 'pinned-hash') return 'zonebadge';
	return 'zonebadge warn';
}
function completenessBadgeCls(status) {
	if (status === 'complete') return 'zonebadge ok';
	if (status === 'partial') return 'zonebadge warn';
	if (status === 'unsupported address family') return 'zonebadge warn';
	return 'zonebadge bad';
}
function injectCSS() {
	if (document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

return L.view.extend({
	title: _('DNS'),

	load: function () {
		var self = this;
		function grab(call) {
			return call().then(function (res) { return { loadError: null, data: res || null }; })
				.catch(function (err) { return { loadError: String(err), data: null }; });
		}
		return Promise.all([
			// 0: dns_get
			callDnsGet().then(function (res) { return { loadError: null, data: res || null }; })
				.catch(function (err) { return { loadError: String(err), data: null }; }),
			// 1: service_dns_status
			grab(callSdnsStatus),
			// 2: service_dns_providers
			grab(callSdnsProv)
		]).then(function (r) {
			return {
				dnsLoadError: r[0].loadError, dns: r[0].data,
				sdnsStatusErr: r[1].loadError, sdnsStatus: r[1].data,
				sdnsProvErr: r[2].loadError, sdnsProv: r[2].data,
				provComp: null, provCompError: null, provList: null, provListError: null
			};
		});
	},

	render: function (envelope) {
		injectCSS();
		this._envelope = envelope || {};
		if (!this._tab) this._tab = 'overview';
		var container = this._buildDOM(this._envelope);
		this._root = container;
		return container;
	},

	// ---- DOM builder (shared by initial render and tab switches) --------
	_buildDOM: function (envelope) {
		envelope = envelope || {};
		var dns = envelope.dns || {};
		var sdnsStatus = envelope.sdnsStatus || {};
		var sdnsProv = envelope.sdnsProv || {};
		var self = this;

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('DNS Centre')),
				E('p', {}, _('Unified DNS management: overview, service mappings, manual overrides, provider intelligence, and audit history.'))
			])
		]);

		if (envelope.dnsLoadError) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('DNS data unavailable: ') + esc(envelope.dnsLoadError)));
			return container;
		}

		if (!this._tab) this._tab = 'overview';
		var tab = this._tab;

		// ---- tab navigation ----
		var nav = E('div', { 'class': 'z2m-tabs' });
		TABS.forEach(function (t) {
			var btn = E('button', {
				'class': 'z2m-tab' + (tab === t.id ? ' z2m-tab-active' : ''),
				'type': 'button'
			}, t.label);
			btn.addEventListener('click', function () { self.switchTab(t.id); });
			nav.appendChild(btn);
		});
		container.appendChild(nav);

		// ---- render active tab ----
		switch (tab) {
			case 'overview':  container.appendChild(this.overviewTab(dns, sdnsStatus, sdnsProv, envelope)); break;
			case 'svc':       container.appendChild(this.svcTab(dns, sdnsStatus, sdnsProv, envelope)); break;
			case 'manual':    container.appendChild(this.manualTab(dns, envelope)); break;
			case 'providers': container.appendChild(this.providersTab(envelope)); break;
			case 'history':   container.appendChild(this.historyTab(dns, sdnsStatus)); break;
		}

		if (this._flash) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	// ════════════════════════════════════════════════════════════
	// TAB: Overview
	// ════════════════════════════════════════════════════════════
	overviewTab: function (dns, sdnsStatus, sdnsProv, envelope) {
		var rz = dns.resolver || {};
		var node = E('div');

		// show error callouts when RPC failed
		if (envelope.dnsLoadError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('DNS data unavailable: ') + esc(envelope.dnsLoadError)));
		}
		if (envelope.sdnsStatusErr) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Service DNS status unavailable: ') + esc(envelope.sdnsStatusErr)));
		}
		if (envelope.sdnsProvErr) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Service DNS providers unavailable: ') + esc(envelope.sdnsProvErr)));
		}

		// ---- status cards ----
		var cards = E('div', { 'class': 'z2m-card-grid' });

		// resolver card
		var comps = (rz.components || []).map(function (c) { return c.name; }).join(', ') || _('unknown');
		var ups = (rz.upstreamNameservers || []).join(', ') || _('unknown');
		cards.appendChild(this.statusCard(
			_('Resolver'), _('status'),
			[
				this.kvRow(_('Component'), comps),
				this.kvRow(_('Upstream NS'), ups),
				this.kvRow(_('Resolvfile'), esc(rz.resolvfile || _('unknown')))
			]
		));

		// dnsmasq card — truthful: only show running/stopped when confirmed
		var dm = dns.dnsmasq;
		if (dm) {
			var dmRunning = dm.running ? badge(_('running'), 'ok') : badge(_('stopped'), 'warn');
			var dmPid = dm.pid ? 'pid ' + dm.pid : _('unknown');
		} else {
			var dmRunning = badge(_('unknown'), 'neutral');
			var dmPid = _('unknown');
		}
		cards.appendChild(this.statusCard(
			_('dnsmasq'), _('status'),
			[
				this.kvRow(_('State'), dmRunning),
				this.kvRow(_('PID'), dmPid),
				this.kvRow(_('Resolver'), esc((dns.resolver && dns.resolver.components || []).map(function(c){return c.name;}).join(', ') || _('unknown')))
			]
		));

		// override status card
		var applied = dns.applied || [];
		var draft = dns.draft || {};
		var drift = dns.drift;
		cards.appendChild(this.statusCard(
			_('Overrides'), _('status'),
			[
				this.kvRow(_('Applied'), applied.length + _(' entries')),
				this.kvRow(_('Draft'), ((draft.entries && draft.entries.length) || 0) + _(' entries')),
				this.kvRow(_('Registered'), dns.registered !== false ? _('yes') : badge(_('no'), 'warn')),
				drift && drift.divergent ? this.kvRow(_('Drift'), badge(_('divergent'), 'warn')) : this.kvRow(_('Drift'), badge(_('synced'), 'ok'))
			]
		));

		// service mappings card
		var sdnsSelections = sdnsStatus.selections || {};
		var sdnsApplied = sdnsStatus.applied || {};
		var enabledCount = 0, appliedCount = 0;
		Object.keys(sdnsSelections).forEach(function (k) { if (sdnsSelections[k] !== 'off') enabledCount++; });
		Object.keys(sdnsApplied).forEach(function (k) { if (sdnsApplied[k] !== 'off') appliedCount++; });
		var sdnsHasDrift = sdnsStatus.drift && sdnsStatus.drift.serviceId;
		var sdnsStatusOk = sdnsStatus.ok;
		var sdnsOwnershipCount = sdnsStatus.ownership ? Object.keys(sdnsStatus.ownership).length : 0;
		cards.appendChild(this.statusCard(
			_('Service mappings'), _('status'),
			[
				sdnsStatusOk === undefined ? this.kvRow(_('Selected'), badge(_('unknown'), 'neutral')) :
				envelope.sdnsStatusErr ? this.kvRow(_('Selected'), badge(_('unavailable'), 'bad')) :
				this.kvRow(_('Selected'), enabledCount + ' / ' + Object.keys(SERVICE_LABELS).length),
				sdnsStatusOk === undefined ? this.kvRow(_('Applied'), badge(_('unknown'), 'neutral')) :
				this.kvRow(_('Applied'), appliedCount + ' / ' + Object.keys(SERVICE_LABELS).length),
				sdnsStatusOk === undefined ? this.kvRow(_('Drift'), badge(_('unknown'), 'neutral')) :
				sdnsHasDrift ? this.kvRow(_('Drift'), badge(_('drift detected'), 'warn')) :
				this.kvRow(_('Drift'), badge(_('synced'), 'ok')),
				sdnsStatusOk === undefined ? this.kvRow(_('Ownership'), badge(_('unknown'), 'neutral')) :
				this.kvRow(_('Ownership records'), String(sdnsOwnershipCount))
			]
		));

		// provider card
		var provCount = sdnsProv.providers ? sdnsProv.providers.length : 0;
		var provVersion = sdnsProv.datasetVersion || '?';
		var provOk = sdnsProv.ok;
		cards.appendChild(this.statusCard(
			_('Providers'), _('status'),
			[
				this.kvRow(_('Catalog'), provOk !== undefined && !provOk ? badge(_('unavailable'), 'bad') : (provCount + _(' providers'))),
				this.kvRow(_('Version'), 'v' + provVersion),
				provOk === undefined ? this.kvRow(_('Health'), badge(_('unknown'), 'neutral')) :
				provOk !== true ? this.kvRow(_('Health'), badge(_('unavailable'), 'bad')) :
				this.kvRow(_('Health'), badge(_('available'), 'ok'))
			]
		));

		// rollback availability
		var rbAvail = (dns.rollbackAvailable !== false) || (sdnsStatus.rollbackAvailable !== false);
		cards.appendChild(this.statusCard(
			_('Rollback'), _('status'),
			[
				this.kvRow(_('Available'), rbAvail ? badge(_('yes'), 'ok') : badge(_('no'), 'neutral')),
				this.kvRow(_('DNS revision'), String(dns.revision != null ? dns.revision : '?')),
				this.kvRow(_('Service revision'), String(sdnsStatus.applied && sdnsStatus.applied.revision != null ? sdnsStatus.applied.revision : '?'))
			]
		));

		node.appendChild(cards);

		// resolver conflicts
		(rz.conflicts || []).forEach(function (c) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Resolver conflict: ') + esc(c.name) + ' — ' + esc(c.role)));
		});

		return node;
	},

	// ════════════════════════════════════════════════════════════
	// TAB: Service mappings
	// ════════════════════════════════════════════════════════════
	svcTab: function (dns, sdnsStatus, sdnsProv, envelope) {
		var self = this;
		var provs = sdnsProv || {};
		var status = sdnsStatus || {};
		var sdnsProvErr = envelope.sdnsProvErr;
		var sdnsStatusErr = envelope.sdnsStatusErr;
		var node = E('div');

		if (sdnsProvErr || (provs.ok !== true && provs.ok !== undefined)) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Provider dataset unavailable: ') + esc(sdnsProvErr || ((provs.error && provs.error.message) || provs.error || '?'))));
			return node;
		}

		if (sdnsStatusErr || (status.ok !== true && status.ok !== undefined && !sdnsStatusErr)) {
			var msg = sdnsStatusErr || ((status.error && status.error.message) || status.error || _('status unavailable'));
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('State error: ') + esc(msg)));
		}

		// provider info summary
		var provCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Provider dataset') + ' v' + esc(provs.datasetVersion || '?')),
			E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, _('Generated')),
				E('span', { 'class': 'z2m-kv-value' }, esc(provs.generatedAt || _('unknown')))
			]),
			E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, _('Provider count')),
				E('span', { 'class': 'z2m-kv-value' }, String((provs.providers || []).length))
			])
		]);
		(provs.providers || []).forEach(function (p) {
			var b = [
				E('span', { 'class': trustBadgeCls(p.trust, p.applicable) }, esc(p.trust || '?')),
				p.trustWarning ? E('span', { 'class': 'zonebadge bad' }, esc(p.trustReason || '')) : null
			].filter(Boolean);
			if (p.expiresAt) b.push(E('span', { 'class': 'zonebadge' }, _('exp: ') + esc(p.expiresAt)));
			provCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
				E('span', { 'class': 'z2m-kv-label' }, esc(p.name || p.id)),
				E('span', { 'class': 'z2m-kv-value' }, b)
			]));
		});
		node.appendChild(provCard);

		// service selection
		var selCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Service mappings')),
			E('p', { 'class': 'cbi-value-description' },
				_('Choose a provider profile per service. Only selected services generate DNS records.'))
		]);

		var profilesByService = {};
		var serviceOrder = [];
		(provs.profiles || []).forEach(function (p) {
			if (!profilesByService[p.serviceId]) { profilesByService[p.serviceId] = []; serviceOrder.push(p.serviceId); }
			profilesByService[p.serviceId].push(p);
		});

		var selections = status.selections || {};
		var appliedSel = status.applied || {};
		var warnings = status.warnings || [];
		var warnMap = {};
		warnings.forEach(function (w) { warnMap[w.serviceId + ':' + (w.profileId || '')] = w; });

		serviceOrder.sort().forEach(function (svc) {
			var label = SERVICE_LABELS[svc] || svc;
			var profiles = profilesByService[svc] || [];
			var curSel = selections[svc] || 'off';
			var appliedPid = appliedSel[svc] || 'off';
			var drift = (status.drift && status.drift.serviceId === svc) ? status.drift : null;

			var profileMeta = {};
			profiles.forEach(function (p) {
				profileMeta[p.id] = { completeness: p.completeness, applicable: p.applicable, providerTrust: p.providerTrust, providerExpiresAt: p.providerExpiresAt, limitations: p.limitations };
			});

			var row = E('div', { 'class': 'z2m-kv', 'style': 'padding:.4em 0;border-bottom:1px solid var(--border,#ddd)' });
			row.appendChild(E('span', { 'class': 'z2m-kv-label' }, esc(label)));

			var field = E('span', { 'class': 'z2m-kv-value' });

			var sel = E('select', { 'class': 'cbi-input-select', 'data-service': svc, 'style': 'margin-right:.4em' });
			sel.appendChild(E('option', { value: 'off' }, _('Off')));
			profiles.forEach(function (p) {
				if (!p.applicable) return;
				var opt = E('option', { value: p.id }, p.id + (p.limitations ? ' (' + p.limitations + ')' : ''));
				if (curSel === p.id) opt.selected = true;
				sel.appendChild(opt);
			});
			field.appendChild(sel);

			var curMeta = profileMeta[curSel];
			if (curMeta && curSel !== 'off') {
				field.appendChild(E('span', { 'class': completenessBadgeCls(curMeta.completeness && curMeta.completeness.status) }, esc((curMeta.completeness && curMeta.completeness.status) || '?')));
				field.appendChild(E('span', { 'class': trustBadgeCls(curMeta.providerTrust, curMeta.applicable) }, esc(curMeta.providerTrust || '?')));
			}
			if (drift) {
				field.appendChild(E('span', { 'class': 'zonebadge warn' }, _('drift: ') + esc(drift.desired + ' → ' + drift.applied)));
			}
			if (appliedPid !== curSel && curSel !== 'off') {
				field.appendChild(E('span', { 'class': 'zonebadge warn' }, _('unapplied')));
			}

			row.appendChild(field);
			selCard.appendChild(row);

			// expandable profile details
			if (profiles.length > 0) {
				var detDiv = E('div', { 'class': 'cbi-value-description', 'style': 'margin-left:2em;margin-bottom:.5em' });
				profiles.forEach(function (p) {
					var comp = p.completeness || {};
					var parts = [
						E('span', { 'class': completenessBadgeCls(comp.status) }, esc(comp.status)),
						' ' + esc(p.id) + ' — ' + (p.requiredDomains || []).length + _(' req, ') + (p.optionalDomains || []).length + _(' opt, ') + (p.desiredCount || 0) + _(' A records')
					];
					if (comp.missingRequired && comp.missingRequired.length)
						parts.push(E('br'), _('missing: ') + comp.missingRequired.join(', '));
					if (p.unsupported && p.unsupported.length)
						parts.push(E('br'), _('unsupported AAAA: ') + p.unsupported.length + _(' addresses'));
					if (p.limitations) parts.push(E('br'), _('limit: ') + esc(p.limitations));
					if (p.diagnosticTargets && p.diagnosticTargets.length)
						parts.push(E('br'), _('diag: ') + p.diagnosticTargets.join(', '));
					detDiv.appendChild(E('div', {}, parts));
				});
				selCard.appendChild(detDiv);
			}

			// warning callout
			var wkey = svc + ':' + curSel;
			if (warnMap[wkey]) {
				selCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn', 'style': 'margin-bottom:.3em' },
					esc(warnMap[wkey].type) + ': ' + esc(warnMap[wkey].reason || '')));
			}
		});
		node.appendChild(selCard);

		// ---- actions ----
		// Save draft
		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-sdns-save' }, _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var newSel = {};
			document.querySelectorAll('select[data-service]').forEach(function (s) { newSel[s.getAttribute('data-service')] = s.value; });
			var edit = { selections: newSel, revision: (status.applied && Number.isInteger(status.applied.revision)) ? status.applied.revision : 0 };
			callSdnsSet(JSON.stringify(edit)).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					saveBtn.disabled = false;
					self._flash = ((res.error && res.error.message) || res.error || _('Save failed'));
				} else {
					self._flash = _('Draft saved (rev ') + (res.revision || '?') + ')';
				}
				self.refresh();
			}).catch(function (err) {
				saveBtn.disabled = false;
				self._flash = _('Save call failed: ') + String(err);
				self.refresh();
			});
		});

		// Preview
		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-sdns-preview' }, _('Preview changes'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			callSdnsPreview().then(function (res) { self._sdnsPreview = res || {}; self.refresh(); })
				.catch(function (err) { self._sdnsPreview = { error: String(err) }; self.refresh(); });
		});

		// Apply
		var apBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-sdns-apply' }, _('Apply mappings'));
		apBtn.addEventListener('click', function () {
			if (!self._sdnsPreview || !self._sdnsPreview.ok) return;
			if (!self._applyArmed) { self._applyArmed = true; self.refresh(); return; }
			apBtn.disabled = true;
			var edit = { revision: (status.applied && Number.isInteger(status.applied.revision)) ? status.applied.revision : 0 };
			if (self._sdnsPreview && self._sdnsPreview.precondition && self._sdnsPreview.precondition.expectedFileHash)
				edit.expectedFileHash = self._sdnsPreview.precondition.expectedFileHash;
			callSdnsApply(JSON.stringify(edit)).then(function (res) {
				self._applyResult = res || {}; self._applyArmed = false; self._sdnsPreview = null; self.refresh();
			}).catch(function (err) {
				self._applyResult = { error: String(err) }; self._applyArmed = false; self.refresh();
			});
		});

		// Rollback
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button', 'id': 'z2m-sdns-rollback' }, _('Rollback'));
		rbBtn.addEventListener('click', function () {
			rbBtn.disabled = true;
			callSdnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Rolled back.') : (_('Rollback failed: ') + esc((res.error && res.error.message) || res.error || _('unknown')));
				self._applyResult = null; self._sdnsPreview = null; self._applyArmed = false; self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err); self.refresh();
			});
		});

		node.appendChild(E('div', { 'class': 'z2m-actions' }, [saveBtn, prevBtn, apBtn, rbBtn]));

		// preview box
		var pv = this._sdnsPreview;
		if (pv) {
			this._sdnsPreview = null;
			if (pv.ok !== true && !pv.error) {
				node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
					_('Preview refused: ') + esc((pv.error && pv.error.message) || pv.error || _('unknown'))));
			} else {
				var diff = pv.diff || {};
				var pvCard = E('div', { 'class': 'z2m-card', 'id': 'z2m-sdns-preview-box' }, [
					E('h4', {}, _('Preview')),
					this.kvRow(_('Added'), String(diff.addedCount || 0)),
					this.kvRow(_('Removed'), String(diff.removedCount || 0)),
					this.kvRow(_('Preserved'), String(diff.preservedCount || 0)),
					this.kvRow(_('Shared kept'), String(diff.sharedKeptCount || 0)),
					(pv.warnings && pv.warnings.length) ? E('div', { 'class': 'z2m-callout z2m-callout-warn' },
						pv.warnings.map(function (w) { return w.type + ': ' + (w.reason || w.serviceId || ''); }).join('; ')) : null
				].filter(Boolean));
				if (pv.candidate) {
					pvCard.appendChild(E('pre', { 'class': 'z2m-mono' }, esc(pv.candidate)));
				}

				if (this._applyArmed) {
					var confirm = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Confirm apply?'));
					confirm.addEventListener('click', function () {
						confirm.disabled = true;
						var edit = { revision: (status.applied && Number.isInteger(status.applied.revision)) ? status.applied.revision : 0 };
						if (pv.precondition && pv.precondition.expectedFileHash) edit.expectedFileHash = pv.precondition.expectedFileHash;
						callSdnsApply(JSON.stringify(edit)).then(function (res) {
							self._applyResult = res || {}; self._applyArmed = false; self._sdnsPreview = null; self.refresh();
						}).catch(function (err) {
							self._applyResult = { error: String(err) }; self._applyArmed = false; self.refresh();
						});
					});
					pvCard.appendChild(E('div', { 'class': 'z2m-actions' }, [confirm]));
				}
				node.appendChild(pvCard);
			}
		}

		// apply result
		var ar = this._applyResult;
		if (ar) {
			this._applyResult = null;
			if (ar.ok !== true) {
				node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
					_('Apply failed') + (ar.stage ? ' (' + esc(ar.stage) + ')' : '') + ': ' + esc((ar.error && ar.error.message) || ar.error || _('unknown'))));
			} else {
				node.appendChild(E('div', { 'class': 'z2m-card' }, [
					E('h4', {}, _('Applied')),
					this.kvRow(_('Revision'), String(ar.revision || '?')),
					this.kvRow(_('Records written'), String(ar.recordsWritten || 0)),
					this.kvRow(_('Resolver OK'), ar.resolverOk ? badge(_('yes'), 'ok') : badge(_('no'), 'bad')),
					(ar.warnings && ar.warnings.length) ? E('div', { 'class': 'z2m-callout z2m-callout-warn' },
						ar.warnings.map(function (w) { return w.type + ': ' + (w.reason || w.serviceId || ''); }).join('; ')) : null
				].filter(Boolean)));
			}
		}

		// ownership ledger (read-only)
		if (status.ownership && Object.keys(status.ownership).length > 0) {
			var ownKeys = Object.keys(status.ownership).slice(0, 50);
			var ownCard = E('div', { 'class': 'z2m-card' }, [
				E('h4', {}, _('Ownership ledger')),
				E('p', { 'class': 'cbi-value-description' },
					_('Each tuple: hostname | family | address. User-owned tuples are never claimed.'))
			]);
			ownKeys.forEach(function (k) {
				ownCard.appendChild(E('div', { 'class': 'cbi-value-description', 'style': 'font-family:monospace' },
					esc(k) + '  →  ' + esc(status.ownership[k])));
			});
			if (Object.keys(status.ownership).length > 50) {
				ownCard.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('... and ') + (Object.keys(status.ownership).length - 50) + _(' more (truncated)')));
			}
			node.appendChild(ownCard);
		}

		return node;
	},

	// ════════════════════════════════════════════════════════════
	// TAB: Manual overrides
	// ════════════════════════════════════════════════════════════
	manualTab: function (dns, envelope) {
		var self = this;
		var node = E('div');
		var draft = dns.draft || { entries: [], revision: 0, malformed: false };
		var applied = dns.applied || [];

		// applied status card
		var apCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Applied overrides')),
			E('p', { 'class': 'cbi-value-description' }, esc(dns.overridesPath || '') +
				(dns.registered === false ? _(' — NOT registered (use Apply)') : ''))
		]);
		if (!applied.length) {
			apCard.appendChild(E('div', { 'class': 'z2m-empty' }, _('(no overrides applied)')));
		} else {
			applied.forEach(function (e) {
				apCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
					E('span', { 'class': 'z2m-kv-label', 'style': 'font-family:monospace' }, esc(e.domain)),
					E('span', { 'class': 'z2m-kv-value' }, esc(e.ip) + (e.enabled === false ? _(' (disabled)') : ''))
				]));
			});
		}
		node.appendChild(apCard);

		// draft editor card
		var draftCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Draft overrides')),
			E('p', { 'class': 'cbi-value-description' },
				_('Drafts live in the manager state; nothing reaches dnsmasq until apply.'))
		]);

		if (draft.malformed) {
			draftCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Draft is MALFORMED: ') + esc(draft.malformedReason || _('unknown'))));
			node.appendChild(draftCard);
			return node;
		}

		var rows = this._dnsRows || (draft.entries || []).map(function (e) {
			return { domain: e.domain || '', ip: e.ip || '' };
		});
		this._dnsRows = rows;

		if (!rows.length) {
			draftCard.appendChild(E('div', { 'class': 'z2m-empty' }, _('No draft entries. Use Add entry to begin.')));
		} else {
			rows.forEach(function (r, i) {
				var dom = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'data-dns-row': i, 'data-field': 'domain', 'value': r.domain || '', 'placeholder': 'example.com' });
				var ip = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'data-dns-row': i, 'data-field': 'ip', 'value': r.ip || '', 'placeholder': '1.2.3.4' });
				var del = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Remove'));
				dom.addEventListener('input', function () { r.domain = dom.value; });
				ip.addEventListener('input', function () { r.ip = ip.value; });
				del.addEventListener('click', function () { rows.splice(i, 1); self.refresh(); });
				draftCard.appendChild(E('div', { 'style': 'display:flex;gap:.4em;margin:.2em 0' }, [dom, ip, del]));
			});
		}

		// buttons
		var addBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Add entry'));
		addBtn.addEventListener('click', function () { rows.push({ domain: '', ip: '' }); self.refresh(); });

		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var entries = rows.filter(function (r) { return String(r.domain || '').trim() !== ''; });
			callDnsSet(JSON.stringify({ entries: entries, revision: draft.revision })).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					saveBtn.disabled = false;
					self._draftError = ((res.error && res.error.message) || res.error || _('Save failed')) +
						(res.errors ? ': ' + res.errors.map(function (e) { return e.reason; }).join('; ') : '');
				} else { self._dnsRows = null; }
				self.refresh();
			}).catch(function (err) {
				saveBtn.disabled = false;
				self._draftError = _('Save call failed: ') + String(err);
				self.refresh();
			});
		});

		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			var entries = rows.filter(function (r) { return String(r.domain || '').trim() !== ''; });
			callDnsValidate(JSON.stringify({ entries: entries })).then(function (res) {
				self._validation = res || {}; self.refresh();
			}).catch(function (err) {
				self._validation = { error: String(err) }; self.refresh();
			});
		});

		draftCard.appendChild(E('div', { 'class': 'z2m-actions' }, [addBtn, saveBtn, valBtn]));

		if (this._draftError) {
			draftCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, this._draftError));
			this._draftError = null;
		}
		if (this._validation) {
			var v = this._validation;
			this._validation = null;
			if (v.error) draftCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Validate failed: ') + esc(v.error)));
			else {
				draftCard.appendChild(E('div', {}, [
					E('span', { 'class': v.valid ? 'z2m-badge z2m-badge-ok' : 'z2m-badge z2m-badge-bad' }, v.valid ? _('valid') : _('invalid'))
				]));
				(v.errors || []).forEach(function (e) {
					draftCard.appendChild(E('div', { 'class': 'cbi-value-description' }, '#' + e.index + ': ' + esc(e.reason)));
				});
			}
		}
		node.appendChild(draftCard);

		// apply section
		var applyCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Apply overrides')),
			E('p', { 'class': 'cbi-value-description' },
				_('Apply snapshots state, writes the overrides file, registers it in dnsmasq, reloads (HUP), and verifies. Failed verification rolls back automatically.'))
		]);

		var prevBtn2 = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Preview apply'));
		prevBtn2.addEventListener('click', function () {
			prevBtn2.disabled = true;
			callDnsApply(JSON.stringify({ mode: 'preview' })).then(function (res) {
				self._manualApply = { preview: res || {} }; self.refresh();
			}).catch(function (err) {
				self._manualApply = { error: String(err) }; self.refresh();
			});
		});

		var rbBtn2 = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Rollback DNS'));
		rbBtn2.addEventListener('click', function () {
			rbBtn2.disabled = true;
			callDnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Rolled back.') : (_('Rollback failed: ') + esc((res.error && res.error.message) || res.error || _('unknown')));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err); self.refresh();
			});
		});

		applyCard.appendChild(E('div', { 'class': 'z2m-actions' }, [prevBtn2, rbBtn2]));

		// preview
		var ma = this._manualApply;
		if (ma && ma.error) {
			applyCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Apply call failed: ') + esc(ma.error)));
		}
		if (ma && ma.preview) {
			var pv = ma.preview;
			if (pv.ok !== true) {
				applyCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
					_('Preview refused: ') + esc((pv.error && pv.error.message) || pv.error || _('unknown'))));
			} else {
				var diff = pv.diff || {};
				var pvBox = E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'z2m-kv' }, [h(_('Added')), h(String((diff.added || []).length))]),
					E('div', { 'class': 'z2m-kv' }, [h(_('Removed')), h(String((diff.removed || []).length))]),
					E('div', { 'class': 'z2m-kv' }, [h(_('Changed')), h(String((diff.changed || []).length))]),
					pv.candidate ? E('pre', { 'class': 'z2m-mono' }, esc(pv.candidate)) : null
				].filter(Boolean));
				if (!ma.armed) {
					var apRun = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply overrides'));
					apRun.addEventListener('click', function () {
						if (!self._manualApply) self._manualApply = {};
						if (!self._manualApply.armed) { self._manualApply.armed = true; self.refresh(); return; }
						apRun.disabled = true;
						callDnsApply(JSON.stringify({ mode: 'apply' })).then(function (res) {
							self._manualApply = { result: res || {} }; self._dnsRows = null; self.refresh();
						}).catch(function (err) {
							self._manualApply = { error: String(err) }; self.refresh();
						});
					});
					pvBox.appendChild(E('div', { 'class': 'z2m-actions' }, [apRun]));
				}
				applyCard.appendChild(pvBox);
			}
		}
		if (ma && ma.result && ma.result.ok === true) {
			applyCard.appendChild(E('div', { 'class': 'z2m-card' }, [
				E('h4', {}, _('Applied and verified')),
				this.kvRow(_('Status'), badge(_('ok'), 'ok'))
			]));
		}

		node.appendChild(applyCard);

		// check resolution
		var chkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Check resolution now'));
		chkBtn.addEventListener('click', function () {
			chkBtn.disabled = true;
			callDnsCheck('{}').then(function (res) { self._check = res || {}; self.refresh(); })
				.catch(function (err) { self._check = { error: String(err) }; self.refresh(); });
		});
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [chkBtn]));

		if (this._check) {
			var c = this._check;
			this._check = null;
			var chkCard = E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Resolution check'))]);
			if (c.error) chkCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, esc(c.error)));
			else {
				(c.results || []).forEach(function (r) {
					chkCard.appendChild(E('div', {}, [
						E('span', { 'class': r.matched ? 'z2m-badge z2m-badge-ok' : 'z2m-badge z2m-badge-bad' },
							r.matched ? _('match') : _('MISMATCH')),
						' ' + esc(r.domain) + ' → ' + esc(r.expectedIp)
					]));
				});
			}
			node.appendChild(chkCard);
		}

		// explain coexistence
		node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-info' },
			_('Manual overrides and service-generated mappings share one manager-owned addnhosts file but have separate ownership records. User entries are never claimed by service profiles.')));

		return node;
	},

	// ════════════════════════════════════════════════════════════
	// TAB: Providers & diagnostics
	// ════════════════════════════════════════════════════════════
	providersTab: function (envelope) {
		var self = this;
		var node = E('div');

		// lazy-load provider data if not yet fetched
		if (!envelope.provComp && !envelope._provFetched) {
			envelope._provFetched = true;
			function grab(call) {
				return call().then(function (res) { return { loadError: null, data: res || null }; })
					.catch(function (err) { return { loadError: String(err), data: null }; });
			}
			Promise.all([grab(callProvComp), grab(callProvList)]).then(function (r) {
				envelope.provComp = r[0].data; envelope.provCompError = r[0].loadError;
				envelope.provList = r[1].data; envelope.provListError = r[1].loadError;
				self.refresh();
			});
			node.appendChild(E('div', { 'class': 'z2m-loading' }, _('Loading provider data…')));
			return node;
		}

		var comps = envelope.provComp || {};
		var provs = envelope.provList || {};
		var provCompError = envelope.provCompError;
		var provListError = envelope.provListError;

		// component intelligence
		var compCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Resolver intelligence'))
		]);
		if (provCompError) {
			compCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Components unavailable: ') + esc(provCompError)));
		} else {
			var resolverPath = (comps.likelyResolverPath || []).join(' → ');
			compCard.appendChild(this.kvRow(_('Likely resolver path'), esc(resolverPath || _('unknown'))));

			var wan = comps.wan || {};
			compCard.appendChild(this.kvRow(_('WAN upstreams'),
				esc((wan.nameservers || []).join(', ') || _('Unavailable')) +
				(wan.peerdns ? ' (peerdns=' + wan.peerdns + ')' : '')));

			(comps.conflicts || []).forEach(function (c) {
				compCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
					_('Resolver conflict: ') + esc(c.reason)));
			});
		}
		node.appendChild(compCard);

		// provider catalog
		var provCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Provider catalog (v') + esc(provs.version || '?') + _(') — data only'))
		]);
		if (provListError || provs.ok === false) {
			provCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Providers unavailable: ') + esc(provListError || ((provs.error && provs.error.message) || '?'))));
		} else {
			(provs.providers || []).forEach(function (p) {
				var badges = [badge(p.category || '?', 'neutral')];
				if (p.doh) badges.push(badge(_('DoH'), 'neutral'));
				else badges.push(badge(_('no DoH'), 'warn'));
				provCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
					E('span', { 'class': 'z2m-kv-label' }, esc(p.name)),
					E('span', { 'class': 'z2m-kv-value' }, [
						E('div', {}, badges),
						E('div', { 'class': 'cbi-value-description' },
							esc((p.ipv4 || []).join(', ') + (p.doh ? ' · ' + p.doh : '') + ' — ' + (p.notes || '')))
					])
				]));
			});
		}
		node.appendChild(provCard);

		// diagnostics
		var diagCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Consistency diagnostics')),
			E('p', { 'class': 'cbi-value-description' },
				_('Read-only diagnostics with confidence scores. A divergent answer is NOT automatically poisoning — CDN anycast gives the same picture legitimately.'))
		]);

		var diagBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Run diagnostics'));
		if (provListError || provs.ok === false) diagBtn.disabled = true;
		diagBtn.addEventListener('click', function () {
			diagBtn.disabled = true;
			callProvDiag('{}').then(function (res) { self._provDiag = res || {}; self.refresh(); })
				.catch(function (err) { self._provDiag = { error: String(err) }; self.refresh(); });
		});
		diagCard.appendChild(E('div', { 'class': 'z2m-actions' }, [diagBtn]));

		var d = this._provDiag;
		if (d) {
			this._provDiag = null;
			if (d.error) {
				diagCard.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Diagnostics failed: ') + esc(d.error)));
			} else {
				var v = d.verdict || {};
				diagCard.appendChild(this.kvRow(_('Verdict'), badge(v.verdict || _('unknown'), v.confidence === 'high' ? 'ok' : 'warn')));
				diagCard.appendChild(this.kvRow(_('Confidence'), esc(v.confidence || '?')));
				if (v.reason) diagCard.appendChild(E('div', { 'class': 'cbi-value-description' }, esc(v.reason)));
				diagCard.appendChild(this.kvRow(_('Local resolver answers'),
					esc(((d.localResolver && d.localResolver.answers) || []).join(', ') || _('none'))));
				(d.probes || []).forEach(function (p) {
					var cls = p.outcome === 'consistent' ? 'ok' : (p.outcome === 'divergent' ? 'warn' : 'bad');
					diagCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
						E('span', { 'class': 'z2m-kv-label' }, esc(p.provider)),
						E('span', { 'class': 'z2m-kv-value' }, [
							badge(p.outcome, cls),
							' conf: ' + esc(p.confidence || '?'),
							p.reachable ? ' ' + _('reachable') : ' ' + _('unreachable'),
							p.answer && p.answer.length ? ' · ' + p.answer.join(', ') : ''
						])
					]));
				});
			}
		}
		node.appendChild(diagCard);

		return node;
	},

	// ════════════════════════════════════════════════════════════
	// TAB: History & rollback
	// ════════════════════════════════════════════════════════════
	historyTab: function (dns, sdnsStatus) {
		var self = this;
		var node = E('div');

		// DNS override events
		var dnsEvents = dns.events || [];
		var sdnsEvents = sdnsStatus.events || [];

		// merge and sort
		var allEvents = [].concat(
			(dnsEvents || []).map(function (e) { return { source: 'dns', ts: e.ts, action: e.action, revision: e.revision, records: e.records }; }),
			(sdnsEvents || []).map(function (e) { return { source: 'sdns', ts: e.ts, action: e.action, revision: e.revision, records: e.records }; })
		).filter(function (e) { return e.ts; }).sort(function (a, b) {
			return (a.ts > b.ts) ? -1 : (a.ts < b.ts) ? 1 : 0;
		});

		var limit = this._eventLimit || 20;
		var shown = allEvents.slice(0, limit);

		var histCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Event timeline') + ' (' + Math.min(shown.length, allEvents.length) + ' / ' + allEvents.length + ')')
		]);

		if (!shown.length) {
			histCard.appendChild(E('div', { 'class': 'z2m-empty' }, _('No events recorded.')));
		} else {
			shown.forEach(function (ev) {
				var srcBadge = ev.source === 'sdns' ? badge(_('Service'), 'ok') : badge(_('Override'), 'neutral');
				histCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
					E('span', { 'class': 'z2m-kv-label', 'style': 'font-family:monospace;font-size:.85em' }, esc(ev.ts || '?')),
					E('span', { 'class': 'z2m-kv-value' }, [
						srcBadge,
						' ' + esc(ev.action),
						ev.revision ? ' r' + ev.revision : '',
						ev.records ? ' (' + ev.records + ' rec)' : ''
					])
				]));
			});
		}

		if (allEvents.length > limit) {
			var moreBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' },
				_('Load more (' + (allEvents.length - limit) + ' remaining)'));
			moreBtn.addEventListener('click', function () {
				self._eventLimit = (self._eventLimit || 20) + 20;
				self.refresh();
			});
			histCard.appendChild(E('div', { 'class': 'z2m-actions' }, [moreBtn]));
		}
		node.appendChild(histCard);

		// rollback card
		var rbCard = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Rollback'))
		]);

		// DNS override rollback
		rbCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('DNS overrides')),
			E('span', { 'class': 'z2m-kv-value' }, [
				dns.latestRollback ? esc(dns.latestRollback.ts || dns.latestRollback.revision || '?') : _('N/A'),
				' — rev ' + (dns.revision != null ? dns.revision : '?')
			])
		]));
		rbCard.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Service mappings')),
			E('span', { 'class': 'z2m-kv-value' }, [
				sdnsStatus.latestRollback ? esc(sdnsStatus.latestRollback.ts || sdnsStatus.latestRollback.revision || '?') : _('N/A'),
				' — rev ' + (sdnsStatus.applied && sdnsStatus.applied.revision != null ? sdnsStatus.applied.revision : '?')
			])
		]));

		// DNS rollback button
		var dnsRb = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Rollback DNS overrides'));
		dnsRb.addEventListener('click', function () {
			dnsRb.disabled = true;
			callDnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('DNS rolled back.') : (_('Rollback failed: ') + esc((res.error && res.error.message) || res.error));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err); self.refresh();
			});
		});

		// Service DNS rollback button
		var sdnsRb = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Rollback service mappings'));
		sdnsRb.addEventListener('click', function () {
			sdnsRb.disabled = true;
			callSdnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Service DNS rolled back.') : (_('Rollback failed: ') + esc((res.error && res.error.message) || res.error));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err); self.refresh();
			});
		});

		rbCard.appendChild(E('div', { 'class': 'z2m-actions' }, [dnsRb, sdnsRb]));
		node.appendChild(rbCard);

		return node;
	},

	// ════════════════════════════════════════════════════════════
	// Shared UI primitives
	// ════════════════════════════════════════════════════════════
	statusCard: function (title, subtitle, rows) {
		return E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, title),
			E('div', {}, rows.filter(Boolean))
		]);
	},

	kvRow: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, label),
			E('span', { 'class': 'z2m-kv-value' }, value)
		]);
	},

	row: function (label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, value)
		]);
	},

	// ---- internal tab switch (no RPC reload) ----
	switchTab: function (tabId) {
		this._tab = tabId;
		var oldRoot = this._root;
		var newRoot = this._buildDOM(this._envelope);
		if (oldRoot && oldRoot.parentNode)
			oldRoot.parentNode.replaceChild(newRoot, oldRoot);
		this._root = newRoot;
	},

	// ---- full reload (after data mutations) ----
	reload: function () {
		var self = this;
		this.load().then(function (envelope) {
			self._envelope = envelope;
			var oldRoot = self._root;
			var newRoot = self._buildDOM(envelope);
			if (oldRoot && oldRoot.parentNode)
				oldRoot.parentNode.replaceChild(newRoot, oldRoot);
			self._root = newRoot;
		});
	},

	refresh: function () {
		this.reload();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
