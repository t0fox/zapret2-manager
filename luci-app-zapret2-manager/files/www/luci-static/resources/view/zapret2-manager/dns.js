'use strict';

// DNS page — validated domain DNS overrides (S6).
//
// Grounding (captured READ-ONLY from the target): dnsmasq is the resolver
// (/etc/config/dhcp); odhcpd does RA; no third-party resolver components on
// this device. The manager owns ONE addnhosts file
// (/etc/zapret2-manager/dns-overrides.hosts); dnsmasq's own option lists are
// never edited. Draft entries live in the manager state; apply is preview →
// snapshot → write → register-once → reload → verify → rollback-on-failure.
// No browser-direct UCI writes — every write goes through dns_* methods.

'require rpc';

const callDnsGet = rpc.declare({ object: 'zapret2-manager', method: 'dns_get', reject: true });
const callDnsSet = rpc.declare({ object: 'zapret2-manager', method: 'dns_set', params: ['edit'], reject: true });
const callDnsValidate = rpc.declare({ object: 'zapret2-manager', method: 'dns_validate', params: ['edit'], reject: true });
const callDnsApply = rpc.declare({ object: 'zapret2-manager', method: 'dns_apply', params: ['edit'], reject: true });
const callDnsCheck = rpc.declare({ object: 'zapret2-manager', method: 'dns_check', params: ['edit'], reject: true });
const callDnsRollback = rpc.declare({ object: 'zapret2-manager', method: 'dns_rollback', reject: true });
const callDnsProvComponents = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_components', reject: true });
const callDnsProvProviders = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_providers', reject: true });
const callDnsProvDiagnose = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_diagnose', params: ['edit'], reject: true });

return L.view.extend({
	title: _('DNS'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
		}
		return Promise.all([
			callDnsGet().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			}),
			grab(callDnsProvComponents),
			grab(callDnsProvProviders)
		]).then(function (r) {
			return {
				loadError: r[0].loadError, data: r[0].data,
				provCompError: r[1].loadError, provComponents: r[1].data,
				provListError: r[2].loadError, provList: r[2].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var data = envelope.data || {};
		var unavailable = envelope.loadError || (data.ok === false ? 'dns_get failed' : null);

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — DNS')),
			E('div', { 'class': 'cbi-value-description' },
				_('Domain DNS overrides pinned through dnsmasq. The manager owns one addnhosts file; system DNS configuration is never edited. Overrides work only when DNS itself resolves — they cannot fix a spoofed resolver.'))
		]);

		if (unavailable) {
			container.appendChild(E('div', { 'class': 'alert-message warning' },
				E('p', {}, _('Unavailable: ') + unavailable)));
			return container;
		}

		container.appendChild(this.resolverSection(data));
		container.appendChild(this.providersSection(envelope));
		container.appendChild(this.appliedSection(data));
		container.appendChild(this.draftSection(data));
		container.appendChild(this.applySection(data));
		if (this._flash) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	resolverSection: function (data) {
		var rz = data.resolver || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Resolver'))]);
		var comps = (rz.components || []).map(function (c) { return c.name; }).join(', ');
		node.appendChild(this.row(_('Components'), comps || _('Unavailable')));
		node.appendChild(this.row(_('Upstream nameservers'),
			(rz.upstreamNameservers || []).join(', ') || _('Unavailable')));
		node.appendChild(this.row(_('Resolvfile'), rz.resolvfile || _('Unavailable')));
		(rz.conflicts || []).forEach(function (c) {
			node.appendChild(E('div', { 'class': 'alert-message danger' },
				_('Resolver conflict: ') + c.name + ' — ' + c.role));
		});
		return node;
	},

	// ---- Providers + component diagnostics (Phase E) --------------------------
	// Read-only intelligence: provider catalog, component detection, bounded
	// consistency diagnostics with CONFIDENCE. Nothing here activates DoH or
	// changes the resolver — divergence is never called poisoning.
	providersSection: function (envelope) {
		var self = this;
		var comps = envelope.provComponents || {};
		var provs = envelope.provList || {};
		var provUnavailable = envelope.provListError || (provs.ok === false ? ((provs.error && provs.error.message) || 'provider catalog is invalid') : null);
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('DNS providers & diagnostics')),
			E('div', { 'class': 'cbi-value-description' },
				_('A versioned provider catalog and read-only diagnostics. DoH endpoints are data, never activation. Diagnostics report evidence with confidence — a divergent answer is NOT automatically poisoning (CDN anycast gives the same picture legitimately).'))
		]);

		if (envelope.provCompError) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Components unavailable: ') + envelope.provCompError));
		} else {
			var cps = comps.components || [];
			var resolverPath = (comps.likelyResolverPath || []).join(' → ');
			node.appendChild(this.row(_('Likely resolver path'), resolverPath || _('unknown')));
			(comps.conflicts || []).forEach(function (c) {
				node.appendChild(E('div', { 'class': 'alert-message danger' },
					_('Resolver conflict: ') + c.reason));
			});
			var wan = comps.wan || {};
			node.appendChild(this.row(_('WAN upstreams (resolvfile)'),
				(wan.nameservers || []).join(', ') || _('Unavailable') +
				(wan.peerdns ? _(' · peerdns=') + wan.peerdns : '')));
		}

		if (provUnavailable) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Providers unavailable: ') + provUnavailable));
		} else {
			node.appendChild(E('h4', {}, _('Provider catalog (v') + (provs.version || '?') + _(') — data only')));
			(provs.providers || []).forEach(function (p) {
				var badges = [E('span', { 'class': 'zonebadge' }, p.category)];
				if (p.doh) badges.push(E('span', { 'class': 'zonebadge' }, _('DoH on record')));
				else badges.push(E('span', { 'class': 'zonebadge warn' }, _('no DoH on record')));
				node.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, p.name),
					E('div', { 'class': 'cbi-value-field' }, [
						E('div', {}, badges),
						E('div', { 'class': 'cbi-value-description' },
							(p.ipv4 || []).join(', ') + (p.doh ? ' · ' + p.doh : '') + ' — ' + p.notes)
					])
				]));
			});
		}

		var diagBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-dnsprov-diagnose' }, _('Run consistency diagnostics'));
		if (provUnavailable) diagBtn.disabled = true;
		diagBtn.addEventListener('click', function () {
			diagBtn.disabled = true;
			callDnsProvDiagnose('{}').then(function (res) {
				self._provDiag = res || {};
				self.refresh();
			}).catch(function (err) {
				self._provDiag = { error: String(err) };
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'cbi-button-row' }, [diagBtn]));

		var d = this._provDiag;
		if (d) {
			this._provDiag = null;
			if (d.error) {
				node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Diagnostics failed: ') + d.error));
			} else {
				var v = d.verdict || {};
				var vcls = v.confidence === 'high' ? 'ok' : 'warn';
				node.appendChild(E('div', { 'class': 'cbi-section', 'id': 'z2m-dnsprov-diag' }, [
					E('h4', {}, _('Consistency verdict')),
					E('div', {}, [
						E('span', { 'class': 'zonebadge ' + vcls }, (v.verdict || _('unknown')) + ' · confidence: ' + (v.confidence || '?')),
						E('div', { 'class': 'cbi-value-description' }, v.reason || '')
					]),
					this.row(_('Local resolver answers'), ((d.localResolver && d.localResolver.answers) || []).join(', ') || _('none'))
				]));
				(d.probes || []).forEach(function (p) {
					var cls = p.outcome === 'consistent' ? 'ok' : (p.outcome === 'divergent' ? 'warn' : 'bad');
					node.appendChild(E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, p.provider),
						E('div', { 'class': 'cbi-value-field' }, [
							E('span', { 'class': 'zonebadge ' + cls }, p.outcome),
							' ',
							E('span', { 'class': 'zonebadge' }, _('conf: ') + (p.confidence || '?')),
							E('div', { 'class': 'cbi-value-description' },
								(p.reachable ? _('reachable') : _('unreachable')) +
								(p.answer && p.answer.length ? ' · ' + _('answers: ') + p.answer.join(', ') : '') +
								' — ' + (p.reason || ''))
						])
					]));
				});
			}
		}
		return node;
	},

	appliedSection: function (data) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Applied overrides')),
			E('div', { 'class': 'cbi-value-description' },
				(data.overridesPath || '') + (data.registered === false ? _(' — NOT yet registered in /etc/config/dhcp (registration happens on apply)') : ''))
		]);
		var applied = data.applied || [];
		if (!applied.length) {
			node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('(no overrides applied)')));
		} else {
			applied.forEach(function (e) {
				node.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'style': 'font-family:monospace' }, e.domain),
					E('div', { 'class': 'cbi-value-field' },
						e.ip + (e.enabled === false ? _(' (disabled)') : ''))
				]));
			});
			var checkBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-dns-check' }, _('Check resolution now'));
			checkBtn.addEventListener('click', function () {
				checkBtn.disabled = true;
				callDnsCheck('{}').then(function (res) {
					self._check = res || {};
					self.refresh();
				}).catch(function (err) {
					self._check = { error: String(err) };
					self.refresh();
				});
			});
			node.appendChild(E('div', { 'class': 'cbi-button-row' }, [checkBtn]));
			if (this._check) {
				var c = this._check;
				this._check = null;
				if (c.error) node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Check failed: ') + c.error));
				else {
					(c.results || []).forEach(function (r) {
						node.appendChild(E('div', { 'class': 'cbi-value-description' }, [
							E('span', { 'class': 'zonebadge ' + (r.matched ? 'ok' : 'bad') }, r.matched ? _('match') : _('MISMATCH')),
							' ' + r.domain + ' → ' + r.expectedIp
						]));
					});
					if (c.note) node.appendChild(E('div', { 'class': 'cbi-value-description' }, c.note));
				}
			}
		}
		return node;
	},

	draftSection: function (data) {
		var self = this;
		var draft = data.draft || { entries: [], revision: 0, malformed: false };
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Draft overrides')),
			E('div', { 'class': 'cbi-value-description' },
				_('Drafts live in the manager state; nothing reaches dnsmasq until apply.'))
		]);
		if (draft.malformed) {
			node.appendChild(E('div', { 'class': 'alert-message danger' },
				_('Draft state is MALFORMED: ') + (draft.malformedReason || _('unknown'))));
			return node;
		}
		var rows = this._dnsRows || (draft.entries || []).map(function (e) {
			return { domain: e.domain, ip: e.ip };
		});
		this._dnsRows = rows;

		var table = E('div', { 'id': 'z2m-dns-rows' });
		rows.forEach(function (r, i) {
			var dom = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'data-dns-row': i, 'data-field': 'domain', 'value': r.domain || '', 'placeholder': 'example.com' });
			var ip = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'data-dns-row': i, 'data-field': 'ip', 'value': r.ip || '', 'placeholder': '1.2.3.4' });
			var del = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button' }, _('Remove'));
			dom.addEventListener('input', function () { r.domain = dom.value; });
			ip.addEventListener('input', function () { r.ip = ip.value; });
			del.addEventListener('click', function () { rows.splice(i, 1); self.refresh(); });
			table.appendChild(E('div', { 'style': 'display:flex;gap:.4em;margin:.2em 0' }, [dom, ip, del]));
		});
		node.appendChild(table);

		var addBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-dns-add' }, _('Add entry'));
		addBtn.addEventListener('click', function () {
			rows.push({ domain: '', ip: '' });
			self.refresh();
		});

		var saveBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-dns-save' }, _('Save draft'));
		saveBtn.addEventListener('click', function () {
			saveBtn.disabled = true;
			var entries = rows.filter(function (r) { return String(r.domain || '').trim() !== ''; });
			callDnsSet(JSON.stringify({ entries: entries, revision: draft.revision })).then(function (res) {
				res = res || {};
				if (res.ok !== true) {
					saveBtn.disabled = false;
					self._draftError = ((res.error && res.error.message) || res.error || _('Save failed')) +
						(res.errors ? ': ' + res.errors.map(function (e) { return e.reason; }).join('; ') : '');
				} else {
					self._dnsRows = null;
				}
				self.refresh();
			}).catch(function (err) {
				saveBtn.disabled = false;
				self._draftError = _('Save call failed: ') + String(err);
				self.refresh();
			});
		});

		var valBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-dns-validate' }, _('Validate'));
		valBtn.addEventListener('click', function () {
			var entries = rows.filter(function (r) { return String(r.domain || '').trim() !== ''; });
			callDnsValidate(JSON.stringify({ entries: entries })).then(function (res) {
				self._validation = res || {};
				self.refresh();
			}).catch(function (err) {
				self._validation = { error: String(err) };
				self.refresh();
			});
		});

		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [addBtn, saveBtn, valBtn]));
		if (this._draftError) {
			node.appendChild(E('div', { 'class': 'alert-message danger' }, this._draftError));
			this._draftError = null;
		}
		if (this._validation) {
			var v = this._validation;
			this._validation = null;
			if (v.error) node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Validate failed: ') + v.error));
			else {
				node.appendChild(E('div', { 'class': 'cbi-value-description' }, [
					E('span', { 'class': 'zonebadge ' + (v.valid ? 'ok' : 'bad') }, v.valid ? _('valid') : _('invalid'))
				]));
				(v.errors || []).forEach(function (e) {
					node.appendChild(E('div', { 'class': 'cbi-value-description' }, '# ' + e.index + ': ' + e.reason));
				});
				(v.foreignConflicts || []).forEach(function (c) {
					node.appendChild(E('div', { 'class': 'alert-message warning' }, c.domain + ': ' + c.reason));
				});
				(v.resolverConflicts || []).forEach(function (c) {
					node.appendChild(E('div', { 'class': 'alert-message danger' }, c.name + ': ' + c.role));
				});
			}
		}
		return node;
	},

	applySection: function (data) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply overrides')),
			E('div', { 'class': 'cbi-value-description' },
				_('Apply snapshots the current state, writes the overrides file, registers it once, reloads dnsmasq (HUP — no listener drop), and verifies resolution. A failed verification rolls back automatically. Manual rollback is available.'))
		]);
		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-neutral', 'type': 'button', 'id': 'z2m-dns-preview' }, _('Preview apply'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			callDnsApply(JSON.stringify({ mode: 'preview' })).then(function (res) {
				self._apply = { preview: res || {} };
				self.refresh();
			}).catch(function (err) {
				self._apply = { error: String(err) };
				self.refresh();
			});
		});
		var rbBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button', 'id': 'z2m-dns-rollback' }, _('Roll back DNS'));
		rbBtn.addEventListener('click', function () {
			rbBtn.disabled = true;
			callDnsRollback().then(function (res) {
				res = res || {};
				self._flash = (res.ok === true) ? _('Rolled back and reloaded.') : (_('Rollback failed: ') + ((res.error && res.error.message) || res.error || _('unknown')));
				self.refresh();
			}).catch(function (err) {
				self._flash = _('Rollback call failed: ') + String(err);
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'cbi-button-row' }, [prevBtn, rbBtn]));

		var ap = this._apply;
		if (ap && ap.error) node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Apply call failed: ') + ap.error));
		if (ap && ap.preview) node.appendChild(this.applyPreviewBox(ap.preview));
		if (ap && ap.result) node.appendChild(this.applyResultBox(ap.result));
		return node;
	},

	applyPreviewBox: function (pv) {
		var self = this;
		if (pv.ok !== true) {
			return E('div', { 'class': 'alert-message danger' },
				_('Preview refused: ') + ((pv.error && pv.error.message) || pv.error || _('unknown')));
		}
		var diff = pv.diff || {};
		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-dns-preview-box' }, [
			E('h4', {}, _('Apply preview')),
			this.row(_('Added'), (diff.added || []).length),
			this.row(_('Removed'), (diff.removed || []).length),
			this.row(_('Changed'), (diff.changed || []).length),
			this.row(_('Registration needed'), pv.registrationNeeded ? _('yes (addnhosts not registered yet)') : _('no')),
			E('pre', { 'style': 'white-space:pre-wrap;font-family:monospace;font-size:.85em;max-height:160px;overflow:auto' }, pv.candidate || _('(empty overrides)'))
		]);
		var armed = this._apply && this._apply.armed;
		var applyBtn = E('button', {
			'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'),
			'type': 'button', 'id': 'z2m-dns-apply-run'
		}, armed ? _('Confirm apply (dnsmasq reloads)?') : _('Apply overrides'));
		applyBtn.addEventListener('click', function () {
			if (!self._apply.armed) { self._apply.armed = true; self.refresh(); return; }
			applyBtn.disabled = true;
			callDnsApply(JSON.stringify({ mode: 'apply' })).then(function (res) {
				self._apply = { result: res || {}, preview: pv };
				self._dnsRows = null;
				self.refresh();
			}).catch(function (err) {
				self._apply = { error: String(err), preview: pv };
				self.refresh();
			});
		});
		box.appendChild(E('div', { 'class': 'cbi-button-row' }, [applyBtn]));
		return box;
	},

	applyResultBox: function (res) {
		if (res.ok !== true) {
			return E('div', { 'class': 'alert-message warning' }, [
				E('p', {}, _('Apply failed') + (res.stage ? ' (' + res.stage + ')' : '') + ': ' + ((res.error && res.error.message) || res.error || _('unknown')))
			]);
		}
		var v = res.verify || {};
		var box = E('div', { 'class': 'cbi-section' }, [
			E('h4', {}, _('Applied and verified')),
			this.row(_('dnsmasq process'), v.processAlive ? E('span', { 'class': 'zonebadge ok' }, _('alive')) : E('span', { 'class': 'zonebadge bad' }, _('dead'))),
			this.row(_('port 53'), v.portListening ? E('span', { 'class': 'zonebadge ok' }, _('listening')) : E('span', { 'class': 'zonebadge bad' }, _('not listening'))),
			this.row(_('entries resolve'), v.entriesMatch ? E('span', { 'class': 'zonebadge ok' }, _('all matched')) : E('span', { 'class': 'zonebadge bad' }, _('MISMATCH')))
		]);
		(v.entries || []).forEach(function (e) {
			box.appendChild(E('div', { 'class': 'cbi-value-description' },
				(e.matched ? '✓ ' : '✗ ') + e.domain + ' → ' + e.expectedIp));
		});
		return box;
	},

	refresh: function () {
		var self = this;
		this.load().then(function (envelope) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render(envelope), old);
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
