'use strict';

// Service Catalog page (Phase B) — a versioned, local, auditable catalog of
// services with an ownership-safe enable/disable flow over domainInclude.
//
// Honesty rules of this page:
//   - the backend owns all reads/writes; the UI never parses list files;
//   - mechanisms are DECLARED: anything beyond domainInclude renders as
//     "unsupported" — never as working;
//   - no "unblocked" claims anywhere (limitations text is always shown);
//   - enable/disable goes through preview → exact plan → arm→confirm →
//     apply with optimistic revision+hash; a failed read blocks mutation;
//   - user entries always survive (the page says so at the preview).

'require rpc';

const callCatalogList = rpc.declare({ object: 'zapret2-manager', method: 'catalog_list', reject: true });
const callCatalogStatus = rpc.declare({ object: 'zapret2-manager', method: 'catalog_status', reject: true });
const callCatalogPreview = rpc.declare({ object: 'zapret2-manager', method: 'catalog_preview', params: ['edit'], reject: true });
const callCatalogApply = rpc.declare({ object: 'zapret2-manager', method: 'catalog_apply', params: ['edit'], reject: true });

const MECHANISM_LABELS = {
	domainInclude: { cls: 'ok', text: _('domain list') },
	domainExclude: { cls: '', text: _('domain exclude') },
	dnsOverride: { cls: 'warn', text: _('DNS override (not applied)') },
	dnsProvider: { cls: 'warn', text: _('DNS provider (not applied)') },
	proxyRoute: { cls: 'bad', text: _('proxy route (NOT supported)') },
	unsupportedGeo: { cls: 'bad', text: _('GEO-limited (not bypassable here)') }
};

return L.view.extend({
	title: _('Service Catalog'),

	load: function () {
		var listP = callCatalogList().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		var statusP = callCatalogStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
		return Promise.all([listP, statusP]).then(function (r) {
			return { listError: r[0].loadError, list: r[0].data, statusError: r[1].loadError, status: r[1].data };
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var list = envelope.list || {};
		var st = envelope.status || {};
		var unavailable = envelope.listError || (list.ok === false ? ((list.error && list.error.message) || 'catalog_list failed') : null);

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Service Catalog')),
			E('div', { 'class': 'cbi-value-description' },
				_('A small reviewed catalog of services. Enabling adds the service domains to the user domain list (domainInclude) through an ownership ledger: only catalog-added domains are ever removed, user entries always survive. This page never claims a service works — mechanisms and limitations are shown verbatim.'))
		]);

		if (unavailable) {
			container.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Catalog unavailable: ') + unavailable),
				E('p', {}, _('The catalog failed validation or the backend is unreachable — mutation is BLOCKED (fail-closed).'))
			]));
			return container;
		}

		container.appendChild(this.metaSection(list, st, envelope.statusError));
		container.appendChild(this.servicesSection(list, st));
		if (this._preview) container.appendChild(this.previewSection(this._preview));
		if (this._applyResult) container.appendChild(this.applyResultSection(this._applyResult));
		if (this._flash) {
			container.appendChild(E('div', { 'class': 'alert-message warning' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	metaSection: function (list, st, statusError) {
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Catalog state'))]);
		node.appendChild(this.row(_('Catalog version'), (list.catalogVersion || _('Unavailable')) +
			(list.digestOk === false ? _(' (digest MISMATCH — refusing to trust)') : '')));
		if (list.stale && list.stale.length)
			node.appendChild(E('div', { 'class': 'alert-message warning' }, _('Stale entries: ') + list.stale.join(', ')));
		if (list.overlaps && list.overlaps.length)
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Domain overlaps across services (the ownership ledger resolves them): ') + list.overlaps.length));
		if (statusError) {
			node.appendChild(E('div', { 'class': 'alert-message danger' }, _('Ledger status unavailable: ') + statusError + _(' — mutation blocked (anti-wipe).')));
		} else if (st.ledger) {
			node.appendChild(this.row(_('Enabled services'), (st.ledger.enabled || []).join(', ') || _('(none)')));
			node.appendChild(this.row(_('Ledger revision'), st.ledger.revision != null ? st.ledger.revision : _('Unavailable')));
			node.appendChild(this.row(_('Catalog-owned domains'), (st.ownedDomains != null ? st.ownedDomains : _('Unavailable')) +
				' · ' + _('present ') + (st.ownedPresent != null ? st.ownedPresent : '?') +
				' · ' + _('user domains ') + (st.userDomains != null ? st.userDomains : '?')));
			if (st.drift && st.drift.divergent) {
				node.appendChild(E('div', { 'class': 'alert-message warning' },
					_('Drift: ') + (st.drift.reason || '') + ' — ' + (st.ownedMissing || []).join(', ')));
			}
		}
		return node;
	},

	servicesSection: function (list, st) {
		var self = this;
		var enabledSet = {};
		((st.ledger && st.ledger.enabled) || []).forEach(function (id) { enabledSet[id] = true; });
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Services')),
			E('div', { 'class': 'cbi-value-description' },
				_('Check services to include in the desired set, then Preview the exact list changes. Unsupported mechanisms are shown, never applied.'))
		]);

		var byCat = {};
		(list.services || []).forEach(function (s) {
			if (!byCat[s.category]) byCat[s.category] = [];
			byCat[s.category].push(s);
		});
		var cats = list.categories || [];
		var filterSel = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-catalog-filter' });
		filterSel.appendChild(E('option', { 'value': '' }, _('all categories')));
		cats.forEach(function (c) { filterSel.appendChild(E('option', { 'value': c }, c)); });
		node.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Filter')),
			E('div', { 'class': 'cbi-value-field' }, [filterSel])
		]));

		this._checks = this._checks || {};
		cats.forEach(function (cat) {
			node.appendChild(E('h4', { 'data-category': cat }, cat));
			byCat[cat].forEach(function (s) {
				var checked = self._checks[s.id] != null ? self._checks[s.id] : !!enabledSet[s.id];
				self._checks[s.id] = checked;
				var cb = E('input', { 'type': 'checkbox', 'id': 'z2m-catalog-svc-' + s.id, 'data-category': s.category });
				cb.checked = checked;
				cb.addEventListener('change', function () { self._checks[s.id] = !!cb.checked; });
				var badges = [E('span', { 'class': 'zonebadge' }, s.category)];
				(s.mechanisms || []).forEach(function (m) {
					var ml = MECHANISM_LABELS[m] || { cls: 'warn', text: m };
					badges.push(E('span', { 'class': 'zonebadge ' + ml.cls }, ml.text));
				});
				if (s.stability !== 'reviewed') badges.push(E('span', { 'class': 'zonebadge warn' }, s.stability));
				var card = E('div', { 'class': 'cbi-value', 'data-category': s.category }, [
					E('label', { 'class': 'cbi-value-title' }, [cb, ' ' + s.name]),
					E('div', { 'class': 'cbi-value-field' }, [
						E('div', {}, badges),
						E('div', { 'class': 'cbi-value-description' },
							(s.domainCount != null ? s.domainCount : '?') + _(' domains · ') + s.limitations)
					])
				]);
				node.appendChild(card);
			});
		});

		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button', 'id': 'z2m-catalog-preview' }, _('Preview changes'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			var enabled = [];
			Object.keys(self._checks || {}).forEach(function (id) { if (self._checks[id]) enabled.push(id); });
			callCatalogPreview(JSON.stringify({ enabled: enabled })).then(function (res) {
				prevBtn.disabled = false;
				self._preview = res || {};
				self._applyResult = null;
				self.refresh();
			}).catch(function (err) {
				prevBtn.disabled = false;
				self._flash = _('Preview call failed: ') + String(err);
				self.refresh();
			});
		});
		node.appendChild(E('div', { 'class': 'cbi-button-row', 'style': 'margin:.4em 0' }, [prevBtn]));
		return node;
	},

	previewSection: function (pv) {
		var self = this;
		if (pv.ok === false || pv.error) {
			return E('div', { 'class': 'alert-message danger' },
				_('Preview refused: ') + ((pv.error && pv.error.message) || pv.error || _('unknown')));
		}
		var box = E('div', { 'class': 'cbi-section', 'id': 'z2m-catalog-preview-box' }, [
			E('h4', {}, _('Exact plan (target: ') + (pv.targetFile || _('?')) + ')')
		]);
		function listBlock(title, items, render) {
			if (!items || !items.length) return null;
			var d = E('div', {}, [E('h4', {}, title + ' (' + items.length + ')')]);
			items.forEach(function (it) { d.appendChild(E('div', { 'class': 'cbi-value-description' }, render(it))); });
			return d;
		}
		box.appendChild(listBlock(_('Additions'), pv.additions, function (a) { return '+ ' + a.domain + '  [' + (a.owners || []).join(',') + ']'; }));
		box.appendChild(listBlock(_('Removals (solely catalog-owned)'), pv.removals, function (r) { return '− ' + r.domain + '  [was: ' + (r.previousOwners || []).join(',') + ']'; }));
		box.appendChild(listBlock(_('Shared domains kept'), pv.keepShared, function (k) { return '= ' + k.domain + '  [still: ' + (k.owners || []).join(',') + ']'; }));
		box.appendChild(listBlock(_('Already present as USER entries (never claimed)'), pv.alreadyUserOwned, function (u) { return '= ' + u.domain; }));
		box.appendChild(listBlock(_('Preserved USER entries (never touched)'), pv.preservedUser, function (u) { return '= ' + u; }));
		if (pv.unsupported && pv.unsupported.length) {
			box.appendChild(E('div', { 'class': 'alert-message warning' },
				_('Unsupported mechanisms (REPORTED, never applied): ') +
				pv.unsupported.map(function (u) { return u.service + ' [' + u.mechanisms.join(',') + ']'; }).join('; ')));
		}
		if (pv.unknownIds && pv.unknownIds.length) {
			box.appendChild(E('div', { 'class': 'alert-message warning' },
				_('Unknown service ids ignored: ') + pv.unknownIds.join(', ')));
		}

		var pre = pv.precondition || {};
		box.appendChild(this.row(_('Precondition'), _('ledger rev ') + (pre.ledgerRevision != null ? pre.ledgerRevision : '?') +
			' · ' + _('file sha256 ') + (pre.fileSha256 ? String(pre.fileSha256).substring(0, 12) + '…' : _('Unavailable'))));

		var armed = this._applyArmed;
		var applyBtn = E('button', {
			'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'),
			'type': 'button', 'id': 'z2m-catalog-apply'
		}, armed ? _('Confirm apply (list file will be rewritten)?') : _('Apply this plan'));
		applyBtn.addEventListener('click', function () {
			if (!self._applyArmed) { self._applyArmed = true; self.refresh(); return; }
			self._applyArmed = false;
			applyBtn.disabled = true;
			callCatalogApply(JSON.stringify({
				enabled: (function () { var e = []; Object.keys(self._checks || {}).forEach(function (id) { if (self._checks[id]) e.push(id); }); return e; })(),
				revision: pre.ledgerRevision,
				fileSha256: pre.fileSha256
			})).then(function (res) {
				self._applyResult = res || {};
				self._preview = null;
				self.refresh();
			}).catch(function (err) {
				self._applyResult = { ok: false, error: String(err) };
				self._preview = null;
				self.refresh();
			});
		});
		box.appendChild(E('div', { 'class': 'cbi-button-row' }, [applyBtn]));
		return box;
	},

	applyResultSection: function (res) {
		if (res.ok === false || res.error) {
			var box = E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Apply failed: ') + ((res.error && res.error.message) || res.error || _('unknown')))
			]);
			if (res.rolledBack) box.appendChild(E('p', {}, _('Rolled back to the pre-apply snapshot.')));
			if (res.error && res.error.code === 'ECONFLICT')
				box.appendChild(E('p', {}, _('The ledger or list file changed since preview — re-run Preview.')));
			return box;
		}
		var a = res.applied || {};
		return E('div', { 'class': 'cbi-section' }, [
			E('h4', {}, _('Applied and verified')),
			this.row(_('Added / removed'), '+' + (a.added != null ? a.added : '?') + ' / −' + (a.removed != null ? a.removed : '?')),
			this.row(_('Shared kept / user preserved'),
				(a.keptShared != null ? a.keptShared : '?') + ' / ' + (a.preservedUser != null ? a.preservedUser : '?')),
			this.row(_('Ledger revision'), (res.ledger && res.ledger.revision) != null ? res.ledger.revision : _('Unavailable')),
			(res.unsupported && res.unsupported.length)
				? E('div', { 'class': 'alert-message warning' }, _('Unsupported mechanisms were NOT applied: ') + res.unsupported.map(function (u) { return u.service; }).join(', '))
				: E('span', {})
		]);
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
