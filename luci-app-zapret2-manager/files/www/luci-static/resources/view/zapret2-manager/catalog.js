'use strict';

// Service Catalog page (Phase B) — versioned, local, auditable catalog with
// ownership-safe enable/disable flow over domainInclude. v2: shared design system.

'require rpc';

var callCatalogList = rpc.declare({ object: 'zapret2-manager', method: 'catalog_list', reject: true });
var callCatalogStatus = rpc.declare({ object: 'zapret2-manager', method: 'catalog_status', reject: true });
var callCatalogPreview = rpc.declare({ object: 'zapret2-manager', method: 'catalog_preview', params: ['edit'], reject: true });
var callCatalogApply = rpc.declare({ object: 'zapret2-manager', method: 'catalog_apply', params: ['edit'], reject: true });
var callHealthGet = rpc.declare({ object: 'zapret2-manager', method: 'health_matrix_get', reject: true });
var callHealthStart = rpc.declare({ object: 'zapret2-manager', method: 'health_matrix_start', params: ['edit'], reject: true });
var callHealthCancel = rpc.declare({ object: 'zapret2-manager', method: 'health_matrix_job_cancel', params: ['edit'], reject: true });

var MECHANISM_LABELS = {
	domainInclude: { cls: 'ok', text: _('domain list') },
	domainExclude: { cls: '', text: _('domain exclude') },
	dnsOverride: { cls: 'warn', text: _('DNS override') },
	dnsProvider: { cls: 'warn', text: _('DNS provider') },
	proxyRoute: { cls: 'bad', text: _('proxy route') },
	unsupportedGeo: { cls: 'bad', text: _('GEO-limited') }
};

function esc(s) {
	if (s == null) return '';
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function h(c) { return document.createTextNode(c); }

function badge(label, cls) {
	var map = { ok: 'z2m-badge z2m-badge-ok', warn: 'z2m-badge z2m-badge-warn', bad: 'z2m-badge z2m-badge-bad', neutral: 'z2m-badge z2m-badge-neutral' };
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

return L.view.extend({
	title: _('Service Catalog'),

	load: function () {
		var listP = callCatalogList().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) { return { loadError: String(err), data: null }; });
		var statusP = callCatalogStatus().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) { return { loadError: String(err), data: null }; });
		var healthP = callHealthGet().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) { return { loadError: String(err), data: null }; });
		return Promise.all([listP, statusP, healthP]).then(function (r) {
			return {
				listError: r[0].loadError, list: r[0].data,
				statusError: r[1].loadError, status: r[1].data,
				healthError: r[2].loadError, health: r[2].data
			};
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var list = envelope.list || {};
		var st = envelope.status || {};
		var unavailable = envelope.listError || (list.ok === false ? ((list.error && list.error.message) || 'catalog_list failed') : null);

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Service Catalog')),
				E('p', {}, _('A small reviewed catalog of services. Enabling adds service domains to the user domain list through an ownership ledger.'))
			])
		]);

		if (unavailable) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Catalog unavailable: ') + esc(unavailable)));
			return container;
		}

		container.appendChild(this.metaSection(list, st, envelope.statusError));
		container.appendChild(this.servicesSection(list, st));
		container.appendChild(this.healthSection(envelope.health, envelope.healthError, st));
		if (this._preview) container.appendChild(this.previewSection(this._preview));
		if (this._applyResult) container.appendChild(this.applyResultSection(this._applyResult));
		if (this._flash) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, this._flash));
			this._flash = null;
		}
		return container;
	},

	// ---- meta / state ----
	metaSection: function (list, st, statusError) {
		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Catalog state'))
		]);
		node.appendChild(this.kv(_('Catalog version'), esc(list.catalogVersion || _('Unavailable')) +
			(list.digestOk === false ? _(' (digest MISMATCH)') : '')));
		if (list.stale && list.stale.length)
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('Stale entries: ') + esc(list.stale.join(', '))));
		if (statusError) {
			node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, _('Ledger status unavailable: ') + esc(statusError)));
		} else if (st.ledger) {
			node.appendChild(this.kv(_('Enabled services'), esc((st.ledger.enabled || []).join(', ') || _('(none)'))));
			node.appendChild(this.kv(_('Catalog-owned domains'), String(st.ownedDomains != null ? st.ownedDomains : '?')));
			if (st.drift && st.drift.divergent) {
				node.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
					_('Drift: ') + esc(st.drift.reason || '')));
			}
		}
		return node;
	},

	// ---- services by category ----
	servicesSection: function (list, st) {
		var self = this;
		var enabledSet = {};
		((st.ledger && st.ledger.enabled) || []).forEach(function (id) { enabledSet[id] = true; });
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Services'))]);

		var byCat = {};
		(list.services || []).forEach(function (s) {
			if (!byCat[s.category]) byCat[s.category] = [];
			byCat[s.category].push(s);
		});
		var cats = list.categories || [];
		this._checks = this._checks || {};

		cats.forEach(function (cat) {
			node.appendChild(E('h4', { 'data-category': cat }, esc(cat)));
			var grid = E('div', { 'class': 'z2m-card-grid' });

			byCat[cat].forEach(function (s) {
				var checked = self._checks[s.id] != null ? self._checks[s.id] : !!enabledSet[s.id];
				self._checks[s.id] = checked;

				var cb = E('input', { 'type': 'checkbox', 'id': 'z2m-catalog-svc-' + s.id, 'data-category': s.category });
				cb.checked = checked;
				cb.addEventListener('change', function () { self._checks[s.id] = !!cb.checked; });

				var badges = [];
				(s.mechanisms || []).forEach(function (m) {
					var ml = MECHANISM_LABELS[m] || { cls: 'neutral', text: m };
					badges.push(badge(ml.text, ml.cls));
				});
				if (s.stability !== 'reviewed') badges.push(badge(s.stability, 'warn'));

				var card = E('div', { 'class': 'z2m-card', 'data-category': s.category }, [
					E('h4', {}, [cb, ' ' + esc(s.name)]),
					E('div', { 'style': 'margin-bottom:.3em' }, badges),
					E('div', { 'class': 'z2m-kv' }, [
						E('span', { 'class': 'z2m-kv-label' }, _('Domains')),
						E('span', { 'class': 'z2m-kv-value' }, (s.domainCount != null ? s.domainCount : '?') + ' domains')
					]),
					E('div', { 'class': 'cbi-value-description' }, esc(s.limitations))
				]);
				grid.appendChild(card);
			});
			node.appendChild(grid);
		});

		var prevBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Preview changes'));
		prevBtn.addEventListener('click', function () {
			prevBtn.disabled = true;
			var enabled = [];
			Object.keys(self._checks || {}).forEach(function (id) { if (self._checks[id]) enabled.push(id); });
			callCatalogPreview(JSON.stringify({ enabled: enabled })).then(function (res) {
				prevBtn.disabled = false; self._preview = res || {}; self._applyResult = null; self.refresh();
			}).catch(function (err) { prevBtn.disabled = false; self._flash = _('Preview call failed: ') + String(err); self.refresh(); });
		});
		node.appendChild(E('div', { 'class': 'z2m-actions', 'style': 'margin-top:.5em' }, [prevBtn]));
		return node;
	},

	// ---- preview section ----
	previewSection: function (pv) {
		var self = this;
		if (pv.ok === false || pv.error) {
			return E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Preview refused: ') + esc((pv.error && pv.error.message) || pv.error || _('unknown')));
		}

		function listBlock(title, items, render) {
			if (!items || !items.length) return null;
			var d = E('div', {}, [E('h4', {}, title + ' (' + items.length + ')')]);
			items.forEach(function (it) { d.appendChild(E('div', { 'class': 'cbi-value-description' }, esc(render(it)))); });
			return d;
		}

		var card = E('div', { 'class': 'z2m-card', 'id': 'z2m-catalog-preview-box' }, [
			E('h4', {}, _('Exact plan (target: ') + esc(pv.targetFile || '?') + ')')
		]);
		card.appendChild(listBlock(_('Additions'), pv.additions, function (a) { return '+ ' + a.domain + '  [' + (a.owners || []).join(',') + ']'; }));
		card.appendChild(listBlock(_('Removals (solely catalog-owned)'), pv.removals, function (r) { return '- ' + r.domain + '  [was: ' + (r.previousOwners || []).join(',') + ']'; }));
		card.appendChild(listBlock(_('Shared domains kept'), pv.keepShared, function (k) { return '= ' + k.domain; }));
		card.appendChild(listBlock(_('Already user-owned (never claimed)'), pv.alreadyUserOwned, function (u) { return '= ' + u.domain; }));
		if (pv.unsupported && pv.unsupported.length) {
			card.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' },
				_('Unsupported mechanisms: ') + pv.unsupported.map(function (u) { return u.service; }).join(', ')));
		}

		var pre = pv.precondition || {};
		card.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Precondition')),
			E('span', { 'class': 'z2m-kv-value' }, _('ledger rev ') + (pre.ledgerRevision != null ? pre.ledgerRevision : '?'))
		]));

		var armed = this._applyArmed;
		var applyBtn = E('button', {
			'class': 'cbi-button ' + (armed ? 'cbi-button-negative' : 'cbi-button-apply'), 'type': 'button'
		}, armed ? _('Confirm apply (list file will be rewritten)?') : _('Apply this plan'));
		applyBtn.addEventListener('click', function () {
			if (!self._applyArmed) { self._applyArmed = true; self.refresh(); return; }
			self._applyArmed = false; applyBtn.disabled = true;
			callCatalogApply(JSON.stringify({
				enabled: (function () { var e = []; Object.keys(self._checks || {}).forEach(function (id) { if (self._checks[id]) e.push(id); }); return e; })(),
				revision: pre.ledgerRevision, fileSha256: pre.fileSha256
			})).then(function (res) { self._applyResult = res || {}; self._preview = null; self.refresh(); })
				.catch(function (err) { self._applyResult = { ok: false, error: String(err) }; self._preview = null; self.refresh(); });
		});
		card.appendChild(E('div', { 'class': 'z2m-actions' }, [applyBtn]));
		return card;
	},

	applyResultSection: function (res) {
		if (res.ok === false || res.error) {
			return E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('Apply failed: ') + esc((res.error && res.error.message) || res.error || _('unknown')));
		}
		var a = res.applied || {};
		return E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Applied and verified')),
			E('div', { 'class': 'z2m-kv' }, [h(_('Added / removed')), h('+' + (a.added != null ? a.added : '?') + ' / -' + (a.removed != null ? a.removed : '?'))]),
			E('div', { 'class': 'z2m-kv' }, [h(_('Kept / preserved')), h((a.keptShared != null ? a.keptShared : '?') + ' / ' + (a.preservedUser != null ? a.preservedUser : '?'))]),
		]);
	},

	// ---- health matrix ----
	healthSection: function (health, healthError, st) {
		var self = this;
		var node = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Health matrix')),
			E('div', { 'class': 'cbi-value-description' },
				_('Per-layer probes over catalog targets. Nothing here says a service "works".'))
		]);

		if (healthError) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable — health_matrix_get: ') + esc(healthError)));
			return node;
		}

		var matrix = health && health.matrix;
		var active = matrix && (matrix.status === 'pending' || matrix.status === 'running');

		var startBtn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' },
			active ? _('Matrix running…') : _('Run health matrix'));
		if (active || healthError) startBtn.disabled = true;
		startBtn.addEventListener('click', function () {
			startBtn.disabled = true;
			var enabled = [];
			Object.keys(self._checks || {}).forEach(function (id) { if (self._checks[id]) enabled.push(id); });
			callHealthStart(JSON.stringify(enabled.length ? { services: enabled } : {})).then(function (res) {
				res = res || {};
				if (res.ok !== true) { startBtn.disabled = false; self._flash = _('Matrix start refused: ') + esc((res.error && res.error.message) || res.error || _('unknown')); }
				self.refresh();
			}).catch(function (err) { startBtn.disabled = false; self._flash = _('Matrix start call failed: ') + String(err); self.refresh(); });
		});
		var row = E('div', { 'class': 'z2m-actions' }, [startBtn]);

		if (active) {
			var cancelBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Cancel matrix'));
			cancelBtn.addEventListener('click', function () {
				cancelBtn.disabled = true;
				callHealthCancel(JSON.stringify({ id: matrix.id })).then(function () { self.refresh(); })
					.catch(function (err) { self._flash = _('Cancel call failed: ') + String(err); self.refresh(); });
			});
			row.appendChild(cancelBtn);
		}
		node.appendChild(row);

		if (!matrix) {
			node.appendChild(E('div', { 'class': 'z2m-empty' }, _('No health matrix run yet.')));
			return node;
		}

		var badgeCls = matrix.status === 'succeeded' ? 'ok' : (matrix.status === 'failed' || matrix.status === 'cancelled') ? 'bad' : 'warn';
		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			h(_('Last matrix')), E('span', {}, [badge(matrix.status, badgeCls), h(' · ' + (matrix.elapsedSec != null ? matrix.elapsedSec + 's' : '?'))])
		]));

		if (matrix.summary && matrix.summary.byClass) {
			var parts = [];
			Object.keys(matrix.summary.byClass).forEach(function (k) {
				parts.push(badge(k + ': ' + matrix.summary.byClass[k], 'neutral'));
			});
			node.appendChild(E('div', { 'class': 'z2m-kv' }, [h(_('Classes')), E('span', {}, parts)]));
		}

		// rows as responsive table
		var rows = (matrix.rows || []).map(function (r) {
			if (r.malformed) {
				return E('tr', {}, [E('td', { 'colspan': 2 }, badge(_('malformed'), 'bad'))]);
			}
			var probes = r.probes || {};
			var pBadges = [];
			function pb(name, p) { pBadges.push(badge(name + (p && p.rc != null ? ':' + p.rc : ''), p && p.rc === 0 ? 'ok' : (p ? 'warn' : 'neutral'))); }
			pb('list', probes.catalog ? { rc: probes.catalog.domainsPresent ? 0 : 1 } : null);
			pb('dns', probes.dns ? { rc: probes.dns.ok ? 0 : 1 } : null);
			pb('tcp', probes.tcp);
			pb('tls', probes.tls);
			pb('http', probes.http);
			var classCls = r.class === 'reachable-http' ? 'ok' : (r.class === 'skipped' ? 'neutral' : 'warn');
			return E('tr', {}, [
				E('td', {}, [h(r.id), E('div', { 'class': 'cbi-value-description' }, esc(r.reason || ''))]),
				E('td', {}, pBadges.concat([badge(r.class, classCls)]))
			]);
		});

		node.appendChild(E('div', { 'class': 'z2m-table-wrap' },
			E('table', { 'class': 'table' }, [
				E('tr', {}, [E('th', {}, _('Service')), E('th', {}, _('Probes + class'))])
			].concat(rows))));

		if (active) this.scheduleHealthPoll();
		return node;
	},

	scheduleHealthPoll: function () {
		var self = this;
		if (this._healthPolled) return;
		this._healthPolled = true;
		setTimeout(function () { self._healthPolled = false; self.refresh(); }, 3000);
	},

	kv: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, esc(label)),
			E('span', { 'class': 'z2m-kv-value' }, typeof value === 'string' ? esc(value) : value)
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

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
