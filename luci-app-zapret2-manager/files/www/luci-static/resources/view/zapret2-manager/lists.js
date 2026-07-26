'use strict';

// Lists page — manage user domain/IP lists, show engine-supplied lists, check
// domain membership. ЦЕЛЬ ДВА (ui/07-lists-page).
//
// User lists (editable): domain include, domain exclude, IP include, IP
// exclude, IP full-block. Engine lists (read-only): autohostlist (auto-formed).
// A domain in BOTH include and exclude is an error reported BEFORE apply.
// Domain check: "does this domain fall under the autohostlist?" — the main
// user-confusion source. File generation goes through the apply module only
// (lists.uc → apply.uc write_list_file); this page never writes files itself.
// IP sets and firewall rules are read-only here.

return L.view.extend({
	title: _('Lists'),

	load: function () {
		return L.resolveDefault(L.ubus.call('zapret2-manager', 'lists_get'), {
			userLists: { domainInclude: [], domainExclude: [],
				ipInclude: [], ipExclude: [], ipBlock: [] },
			engineLists: { autohostlist: [], engineSupplied: {} },
			conflicts: []
		});
	},

	render: function (data) {
		var ul = data.userLists || {};
		var el = data.engineLists || {};
		var conflicts = data.conflicts || [];

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Lists'))
		]);

		// Conflict warning (protection: domains in BOTH include and exclude)
		if (conflicts.length > 0) {
			container.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Conflict: these domains are in BOTH include and exclude:')),
				E('pre', {}, conflicts.join('\n')),
				E('p', {}, _('Remove them from one list before applying.'))
			]));
		}

		// Domain check
		container.appendChild(this.domainCheckSection());

		// User lists (editable)
		container.appendChild(this.userListSection(_('Domain include'), 'domainInclude', ul.domainInclude || []));
		container.appendChild(this.userListSection(_('Domain exclude'), 'domainExclude', ul.domainExclude || []));
		container.appendChild(this.userListSection(_('IP include'), 'ipInclude', ul.ipInclude || []));
		container.appendChild(this.userListSection(_('IP exclude'), 'ipExclude', ul.ipExclude || []));
		container.appendChild(this.userListSection(_('IP full-block'), 'ipBlock', ul.ipBlock || []));

		// Engine lists (read-only)
		container.appendChild(this.engineListSection(_('Autohostlist (engine, read-only)'),
			el.autohostlist || [], el.engineSupplied || {}));

		container.appendChild(this.applySection());

		return container;
	},

	domainCheckSection: function () {
		var self = this;
		var input = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'placeholder': _('enter a domain to check'), 'id': 'z2m-domain-check' });
		var result = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Check'));
		btn.addEventListener('click', function () {
			var d = input.value.trim();
			if (!d) return;
			result.textContent = _('Checking…');
			L.ubus.call('zapret2-manager', 'lists_check_domain', { domain: d }).then(function (res) {
				res = res || {};
				if (res.conflict) {
					result.textContent = _('CONFLICT: %(d)s is in BOTH include and exclude').format({ d: d });
					result.className = 'cbi-value-description alert-message danger';
				} else {
					var parts = [];
					if (res.userInclude) parts.push(_('user include'));
					if (res.userExclude) parts.push(_('user exclude'));
					if (res.autohostlist) parts.push(_('autohostlist (engine)'));
					if (parts.length === 0) parts.push(_('no list'));
					result.textContent = _('%(d)s matches: %(p)s').format({ d: d, p: parts.join(', ') });
					result.className = 'cbi-value-description';
				}
			});
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Domain check')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Domain')),
				E('div', { 'class': 'cbi-value-field' }, input)
			]),
			btn,
			result,
			E('div', { 'class': 'cbi-value-description' },
				_('Check whether a domain falls under the autohostlist (engine) or the user lists. The main source of confusion: you added a domain manually, but the autohostlist covers it, or vice versa.'))
		]);
	},

	userListSection: function (title, key, items) {
		var ta = E('textarea', { 'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:120px;font-family:monospace' },
			items.join('\n'));
		ta.setAttribute('data-list-key', key);
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-value-description' },
				_('One entry per line. User list — editable.')),
			ta
		]);
	},

	engineListSection: function (title, items, supplied) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-value-description' },
				_('Engine-supplied list — not editable. %(n)s entries.').format({ n: items.length })),
			E('pre', { 'style': 'white-space:pre-wrap;max-height:200px;overflow:auto;font-family:monospace' },
				items.length ? items.join('\n') : _('(empty or file not present)'))
		]);
	},

	applySection: function () {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
		btn.addEventListener('click', function () {
			btn.disabled = true;
			status.textContent = _('Applying…');
			// collect all textareas with data-list-key
			var edit = {};
			var tas = document.querySelectorAll('textarea[data-list-key]');
			for (var i = 0; i < tas.length; i++) {
				var key = tas[i].getAttribute('data-list-key');
				var lines = tas[i].value.split('\n').map(function (l) { return l.trim(); })
					.filter(function (l) { return l.length > 0; });
				edit[key] = lines;
			}
			L.ubus.call('zapret2-manager', 'lists_set', { edit: edit }).then(function (res) {
				btn.disabled = false;
				res = res || {};
				if (res.ok) {
					status.textContent = _('Applied: %(w)s lists written.').format({ w: (res.written || []).join(', ') });
				} else if (res.error === 'conflict') {
					status.textContent = _('CONFLICT: %(d)s in both include and exclude. Remove from one list.').format({ d: (res.conflicts || []).join(', ') });
					status.className = 'cbi-value-description alert-message danger';
				} else {
					status.textContent = _('Failed: %(e)s').format({ e: res.error || 'unknown' });
				}
				if (res.ok) self.refresh();
			});
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply')),
			E('div', { 'class': 'cbi-value-description' },
				_('Writes the user lists through the apply module. If a domain is in BOTH include and exclude, the apply is refused and the conflicts are reported.')),
			btn,
			status
		]);
	},

	refresh: function () {
		var self = this;
		L.resolveDefault(L.ubus.call('zapret2-manager', 'lists_get'), {})
			.then(function (data) {
				var old = document.querySelector('.cbi-map');
				if (old && old.parentNode)
					old.parentNode.replaceChild(self.render(data || {}), old);
			});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
