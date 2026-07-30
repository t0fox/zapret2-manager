'use strict';
// Service DNS — Per-Service DNS Mapping (Slice 7).
//
// Grounding: dnsmasq is the resolver (/etc/config/dhcp); odhcpd does RA;
// no third-party resolver on this device. The manager owns ONE addnhosts
// file (/etc/zapret2-manager/dns-overrides.hosts). Service-generated A
// records and user DNS overrides coexist. Ownership is tracked at
// hostname+family+address granularity; user records are NEVER claimed
// (anti-wipe). AAAA records are preserved in the dataset but NOT applied
// on the current IPv4-only target.

'require rpc';

const callServiceDnsProviders = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_providers', reject: true });
const callServiceDnsStatus = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_status', reject: true });
const callServiceDnsCheck = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_check', reject: true });
const callServiceDnsPreview = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_preview', reject: true });
const callServiceDnsSet = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_set', params: ['edit'], reject: true });
const callServiceDnsApply = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply', params: ['edit'], reject: true });
const callServiceDnsRollback = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_rollback', reject: true });

// service display-name map (catalog serviceId → human label)
var SERVICE_LABELS = {
	'chatgpt-openai': 'ChatGPT / OpenAI',
	'google-gemini': 'Google Gemini',
	'discord': 'Discord',
	'youtube': 'YouTube',
	'twitch': 'Twitch',
	'spotify': 'Spotify',
	'supercell': 'Supercell',
	'github': 'GitHub',
	'githubusercontent': 'GitHubusercontent',
	'telegram-web': 'Telegram Web',
	'notion': 'Notion'
};

// trust badge class
function trustBadge(trust, applicable) {
	if (!applicable) return 'zonebadge bad';
	if (trust == 'bundled-reviewed') return 'zonebadge ok';
	if (trust == 'pinned-hash') return 'zonebadge';
	return 'zonebadge warn';
}

// completeness badge class
function completenessBadge(status) {
	if (status == 'complete') return 'zonebadge ok';
	if (status == 'partial') return 'zonebadge warn';
	if (status == 'unsupported address family') return 'zonebadge warn';
	return 'zonebadge bad';
}

return L.view.extend({
	title: _('Service DNS'),

	load: function () {
		var self = this;
		return Promise.all([
			callServiceDnsProviders().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			}),
			callServiceDnsStatus().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			})
		]).then(function (r) {
			return {
				provError: r[0].loadError, providers: r[0].data,
				statusError: r[1].loadError, status: r[1].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var provs = envelope.providers || {};
		var status = envelope.status || {};
		var provErr = envelope.provError;
		var statusErr = envelope.statusError;

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Service DNS')),
			E('div', { 'class': 'cbi-value-description' },
				_('Per-service hostname-to-IP mappings through dnsmasq addnhosts. Only the selected services\' domains are pinned; other domains use the router\'s normal DNS. AAAA records are preserved in the dataset but not applied (IPv4-only target).'))
		]);

		// dataset / provider warnings
		if (provErr || (provs.ok !== true)) {
			container.appendChild(E('div', { 'class': 'alert-message danger' },
				_('Provider dataset unavailable: ') + (provErr || ((provs.error && provs.error.message) || provs.error || '?'))));
			return container;
		}

		// state warnings
		if (statusErr || (status.ok !== true && !statusErr)) {
			var msg = statusErr || ((status.error && status.error.message) || status.error || _('status unavailable'));
			container.appendChild(E('div', { 'class': 'alert-message danger' }, _('State error: ') + msg));
		}

		// provider info bar
		var provInfo = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Provider dataset (v') + (provs.datasetVersion || '?') + _(')')),
			this.row(_('Generated at'), provs.generatedAt || _('unknown')),
			this.row(_('Now'), provs.now || _('unknown'))
		]);
		(provs.providers || []).forEach(function (p) {
			var badges = [
				E('span', { 'class': trustBadge(p.trust, p.applicable) }, p.trust || '?'),
				p.trustWarning ? E('span', { 'class': 'zonebadge bad' }, p.trustReason || '') : E('span', { 'class': 'zonebadge' }, _('ok'))
			];
			if (p.expiresAt) badges.push(E('span', { 'class': 'zonebadge' }, _('expires: ') + p.expiresAt));
			provInfo.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, p.name || p.id),
				E('div', { 'class': 'cbi-value-field' }, badges)
			]));
		});
		container.appendChild(provInfo);

		// service selection table
		var selNode = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service mappings')),
			E('div', { 'class': 'cbi-value-description' },
				_('Choose a provider profile per service. Only selected services generate DNS records.'))
		]);

		var profilesByService = {};
		var serviceOrder = [];
		(provs.profiles || []).forEach(function (p) {
			if (!profilesByService[p.serviceId]) { profilesByService[p.serviceId] = []; serviceOrder.push(p.serviceId); }
			profilesByService[p.serviceId].push(p);
		});

		var selections = (status.selections) || {};
		var appliedSel = (status.applied) || {};
		var warnings = (status.warnings) || [];
		var warnMap = {};
		warnings.forEach(function (w) { warnMap[w.serviceId + ':' + (w.profileId || '')] = w; });

		serviceOrder.sort().forEach(function (svc) {
			var label = SERVICE_LABELS[svc] || svc;
			var profiles = profilesByService[svc] || [];
			var curSel = selections[svc] || 'off';
			var appliedPid = appliedSel[svc] || 'off';
			var drift = (status.drift && status.drift.serviceId == svc) ? status.drift : null;

			// find profile completeness/trust
			var profileMeta = {};
			profiles.forEach(function (p) {
				profileMeta[p.id] = { completeness: p.completeness, applicable: p.applicable, providerTrust: p.providerTrust, providerExpiresAt: p.providerExpiresAt, limitations: p.limitations };
			});

			var row = E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, label)
			]);
			var field = E('div', { 'class': 'cbi-value-field' });

			// dropdown
			var sel = E('select', { 'class': 'cbi-input-select', 'data-service': svc });
			sel.appendChild(E('option', { value: 'off' }, _('Off')));
			profiles.forEach(function (p) {
				if (!p.applicable) return;
				var opt = E('option', { value: p.id }, p.id + (p.limitations ? ' (' + p.limitations + ')' : ''));
				if (curSel == p.id) opt.selected = true;
				sel.appendChild(opt);
			});
			field.appendChild(sel);

			// badges
			var curMeta = profileMeta[curSel];
			if (curMeta && curSel != 'off') {
				field.appendChild(E('span', { 'class': completenessBadge(curMeta.completeness.status) }, curMeta.completeness.status));
				field.appendChild(E('span', { 'class': trustBadge(curMeta.providerTrust, curMeta.applicable) }, curMeta.providerTrust));
				if (curMeta.providerExpiresAt) field.appendChild(E('span', { 'class': 'zonebadge' }, _('exp: ') + curMeta.providerExpiresAt));
			}
			if (drift) {
				field.appendChild(E('span', { 'class': 'zonebadge warn' }, _('drift: ') + drift.desired + ' → ' + drift.applied));
			}
			if (appliedPid != curSel && curSel != 'off') {
				field.appendChild(E('span', { 'class': 'zonebadge warn' }, _('unapplied')));
			}

			row.appendChild(field);
			selNode.appendChild(row);

			// expandable details
			if (profiles.length > 0) {
				var det = E('div', { 'class': 'cbi-value-description', 'style': 'margin-left:2em' });
				profiles.forEach(function (p) {
					var comp = p.completeness || {};
					var lines = [
						E('span', { 'class': completenessBadge(comp.status) }, comp.status),
						' ' + p.id + ' — ' + (p.requiredDomains || []).length + _(' required, ') + (p.optionalDomains || []).length + _(' optional domains, ') + (p.desiredCount || 0) + _(' A records')
					];
					if (comp.missingRequired && comp.missingRequired.length)
						lines.push(E('br'), _('missing: ') + comp.missingRequired.join(', '));
					if (p.unsupported && p.unsupported.length)
						lines.push(E('br'), _('unsupported AAAA: ') + p.unsupported.length + _(' addresses'));
					if (p.limitations) lines.push(E('br'), _('limitation: ') + p.limitations);
					if (p.diagnosticTargets && p.diagnosticTargets.length)
						lines.push(E('br'), _('diagnostics: ') + p.diagnosticTargets.join(', ')));
					det.appendChild(E('div', {}, lines));
				});
				selNode.appendChild(det);
			}
		});
		container.appendChild(selNode);

		// save draft button
		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-sdns-save' }, _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var newSel = {};
			var sels = container.querySelectorAll('select[data-service]');
			sels.forEach(function (s) { newSel[s.getAttribute('data-service')] = s.value; });
			var edit = { selections: newSel, revision: (status.applied && type(status.applied.revision) == 'int') ? status.applied.revision : 0 };
			callServiceDnsSet(JSON.stringify(edit)).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					saveBtn.disabled = false;
					self._flash = ((res.error && res.error.message) || res.error || _('Save failed'));
				} else {
					self._flash = _('Draft saved (revision ') + (res.revision || '?') + ')';
					self._statusRev = res.revision;
				}
				self.refresh();
			}).catch(function (err) {
				saveBtn.disabled = false;
				self._flash = _('Save call failed: ') + String(err);
				self.refresh();
			});
		});
		container.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [saveBtn]));

		// preview / apply section
		var applyNode = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply mappings')),
			E('div', { 'class': 'cbi-value-description' },
				_('Preview shows the exact DNS diff (added/removed records) with ownership tags. Apply snapshots state, writes the addnhosts file, registers it once in dhcp, reloads dnsmasq, and verifies. Failed verification rolls back automatically.'))
		]);
		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-sdns-preview' }, _('Preview changes'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			callServiceDnsPreview().then(function (res) {
				self._preview = res || {};
				self.refresh();
			}).catch(function (err) {
				self._preview = { error: String(err) };
				self.refresh();
			});
		});
		var apBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-sdns-apply' }, _('Apply mappings'));
		apBtn.addEventListener('click', function () {
			if (!self._preview || !self._preview.ok) return;
			if (!self._applyArmed) { self._applyArmed = true; self.refresh(); return; }
			apBtn.disabled = true;
			var edit = { revision: (status.applied && type(status.applied.revision) == 'int') ? status.applied.revision : 0 };
			if (self._preview && self._preview.precondition && self._preview.precondition.expectedFileHash)
				edit.expectedFileHash = self._preview.precondition.expectedFileHash;
			callServiceDnsApply(JSON.stringify(edit)).then(function (res) {
				self._applyResult = res || {};
				self._applyArmed = false;
				self._preview = null;
				self.refresh();
			}).catch(function (err) {
				self._applyResult = { error: String(err) };
				self._applyArmed = false;
				self.refresh();
			});
		});
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button', 'id': 'z2m-sdns-rollback' }, _('Rollback'));
		rbBtn.addEventListener('click', function () {
			rbBtn.disabled = true;
			callServiceDnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Rolled back.') : (_('Rollback failed: ') + ((res.error && res.error.message) || res.error || _('unknown')));
				self._applyResult = null;
				self._preview = null;
				self._applyArmed = false;
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err);
				self.refresh();
			});
		});
		applyNode.appendChild(E('div', { 'class': 'cbi-button-row' }, [prevBtn, apBtn, rbBtn]));

		// preview box
		var pv = this._preview;
		if (pv) {
			this._preview = null;
			if (pv.ok !== true) {
				applyNode.appendChild(E('div', { 'class': 'alert-message danger' },
					_('Preview refused: ') + ((pv.error && pv.error.message) || pv.error || _('unknown'))));
			} else {
				var diff = pv.diff || {};
				var pvBox = E('div', { 'class': 'cbi-section', 'id': 'z2m-sdns-preview-box' }, [
					E('h4', {}, _('Preview')),
					this.row(_('Added'), (diff.addedCount || 0)),
					this.row(_('Removed'), (diff.removedCount || 0)),
					this.row(_('Preserved'), (diff.preservedCount || 0)),
					this.row(_('Shared kept'), (diff.sharedKeptCount || 0)),
					(pv.warnings && pv.warnings.length) ? E('div', { 'class': 'alert-message warning' },
						(pv.warnings.map(function (w) { return w.type + ': ' + (w.reason || w.serviceId || ''); })).join('; ')) : '',
					E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.85em;max-height:200px;overflow:auto' }, pv.candidate || _('(empty)'))
				]);
				if (this._applyArmed) {
					var confirm = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button', 'id': 'z2m-sdns-apply-confirm' }, _('Confirm apply?'));
					confirm.addEventListener('click', function () {
						confirm.disabled = true;
						var edit = { revision: (status.applied && type(status.applied.revision) == 'int') ? status.applied.revision : 0 };
						if (pv.precondition && pv.precondition.expectedFileHash) edit.expectedFileHash = pv.precondition.expectedFileHash;
						callServiceDnsApply(JSON.stringify(edit)).then(function (res) {
							self._applyResult = res || {};
							self._applyArmed = false;
							self._preview = null;
							self.refresh();
						}).catch(function (err) {
							self._applyResult = { error: String(err) };
							self._applyArmed = false;
							self.refresh();
						});
					});
					pvBox.appendChild(E('div', { 'class': 'cbi-button-row' }, [confirm]));
				}
				applyNode.appendChild(pvBox);
			}
		}

		// apply result
		var ar = this._applyResult;
		if (ar) {
			this._applyResult = null;
			if (ar.ok !== true) {
				applyNode.appendChild(E('div', { 'class': 'alert-message warning' },
					_('Apply failed') + (ar.stage ? ' (' + ar.stage + ')' : '') + ': ' + ((ar.error && ar.error.message) || ar.error || _('unknown'))));
			} else {
				applyNode.appendChild(E('div', { 'class': 'cbi-section', 'id': 'z2m-sdns-apply-result' }, [
					E('h4', {}, _('Applied')),
					this.row(_('Revision'), ar.revision || '?'),
					this.row(_('Records written'), ar.recordsWritten || 0),
					this.row(_('Resolver OK'), ar.resolverOk ? E('span', { 'class': 'zonebadge ok' }, _('yes')) : E('span', { 'class': 'zonebadge bad' }, _('no'))),
					(ar.warnings && ar.warnings.length) ? E('div', { 'class': 'alert-message warning' },
						ar.warnings.map(function (w) { return w.type + ': ' + (w.reason || w.serviceId || ''); }).join('; ')) : ''
				]));
			}
		}
		container.appendChild(applyNode);

		// ownership section (read-only)
		if (status.ownership && length(Object.keys(status.ownership)) > 0) {
			var ownNode = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Ownership ledger')),
				E('div', { 'class': 'cbi-value-description' },
					_('Each tuple is hostname | family | address. User-owned tuples are never claimed by service profiles.'))
			]);
			var ownKeys = Object.keys(status.ownership).slice(0, 50);
			ownKeys.forEach(function (k) {
				ownNode.appendChild(E('div', { 'class': 'cbi-value-description', 'style': 'font-family:monospace' },
					k + '  →  ' + status.ownership[k]));
			});
			if (length(Object.keys(status.ownership)) > 50)
				ownNode.appendChild(E('div', { 'class': 'cbi-value-description' },
					_('... and ') + (length(Object.keys(status.ownership)) - 50) + _(' more (truncated)')));
			container.appendChild(ownNode);
		}

		// events
		if (status.events && status.events.length) {
			var evNode = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Recent events'))
			]);
			status.events.slice(-10).reverse().forEach(function (ev) {
				evNode.appendChild(E('div', { 'class': 'cbi-value-description', 'style': 'font-family:monospace' },
					(ev.ts || '?') + '  ' + ev.action + (ev.revision ? ' r' + ev.revision : '') + (ev.records ? ' (' + ev.records + ' rec)' : '')));
			});
			container.appendChild(evNode);
		}

		if (this._flash) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, this._flash));
			this._flash = null;
		}
		return container;
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
