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
//
// LuCI JS API: luci.js 26.x exports `L.rpc` via `require rpc`; there is NO
// `L.ubus` (calling it throws "Cannot read properties of undefined"). All RPC
// here goes through rpc.declare; every promise has a .catch so a rejected
// call renders a visible error instead of hanging the page.
//
// Backend availability: when lists_get fails (RPC error or {ok:false}), the
// page switches to a read-only UNAVAILABLE mode — textareas are locked and
// Apply is disabled, so a failed load can never wipe a list by applying
// empty textareas.
//
// lists_set payload: the ubus signature declares `edit` as type "string"
// (verified on the router: an object argument is rejected with "Invalid
// argument"), so the UI sends the edit object as a JSON string.

'require rpc';

const callListsGet = rpc.declare({ object: 'zapret2-manager', method: 'lists_get' });
const callListsCheck = rpc.declare({
	object: 'zapret2-manager', method: 'lists_check_domain', params: ['domain']
});
const callListsSet = rpc.declare({
	object: 'zapret2-manager', method: 'lists_set', params: ['edit']
});

// normalize mirrors lists.uc/tests/lib/lists-logic.mjs (lowercase, trim,
// strip leading dot). Used ONLY for the client-side pre-apply conflict hint;
// the backend remains the authority.
function normalizeDomain(d) {
	var s = String(d == null ? '' : d).trim().toLowerCase();
	if (s.charAt(0) === '.') s = s.substring(1);
	return s;
}

return L.view.extend({
	title: _('Lists'),

	load: function () {
		// Never reject: an RPC failure becomes a visible envelope, not a hang.
		return callListsGet().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
	},

	render: function (envelope) {
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var backendError = envelope.loadError ||
			(data && data.ok === false ? (data.error || 'backend error') : null) ||
			(data && data.error ? data.error : null);

		var ul = (data && data.userLists) || {};
		var el = (data && data.engineLists) || {};
		var paths = (data && data.paths) || {};
		var conflicts = (data && data.conflicts) || [];
		var readOnly = backendError != null;

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Lists')),
			E('div', { 'class': 'cbi-value-description' },
				_('User lists are editable and written through the backend apply path. Engine lists are read-only. A domain in BOTH include and exclude is refused before anything is written.'))
		]);

		if (backendError) {
			container.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('List backend unavailable: ') + backendError),
				E('p', {}, _('Editing is locked so a failed load cannot overwrite existing lists with empty content. Entries shown below as "Unavailable" are not fabricated.'))
			]));
		}

		// Conflict warning (protection: domains in BOTH include and exclude)
		if (conflicts.length > 0) {
			container.appendChild(E('div', { 'class': 'alert-message danger' }, [
				E('p', {}, _('Conflict: these domains are in BOTH include and exclude:')),
				E('pre', {}, conflicts.join('\n')),
				E('p', {}, _('Remove them from one list before applying.'))
			]));
		}

		container.appendChild(this.domainCheckSection(readOnly));

		var self = this;
		var userLists = [
			[_('Domain include'), 'domainInclude', paths.domainInclude],
			[_('Domain exclude'), 'domainExclude', paths.domainExclude],
			[_('IP include (IPv4)'), 'ipInclude', paths.ipInclude],
			[_('IP exclude (IPv4)'), 'ipExclude', paths.ipExclude],
			[_('IP full-block (IPv4)'), 'ipBlock', paths.ipBlock]
		];
		userLists.forEach(function (spec) {
			container.appendChild(self.userListSection(
				spec[0], spec[1],
				backendError ? null : (ul[spec[1]] || []),
				spec[2], readOnly));
		});

		container.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('IPv6 lists: not present in the current backend list set (no IPv6 list files are defined). Shown as unavailable rather than invented.')));

		container.appendChild(this.engineListSection(
			_('Autohostlist (engine-owned, read-only)'),
			backendError ? null : (el.autohostlist || []),
			el.autohostlistPath || paths.autohostlist || null,
			(el.engineSupplied || {}).autohostlist));

		container.appendChild(this.applySection(readOnly));

		return container;
	},

	domainCheckSection: function (readOnly) {
		var input = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'placeholder': _('enter a domain to check'), 'id': 'z2m-domain-check' });
		var result = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Check'));
		btn.addEventListener('click', function () {
			var d = input.value.trim();
			if (!d) return;
			btn.disabled = true;
			result.className = 'cbi-value-description';
			result.textContent = _('Checking…');
			callListsCheck({ domain: d }).then(function (res) {
				btn.disabled = false;
				res = res || {};
				if (res.error || res.ok === false) {
					result.textContent = _('Check unavailable: ') + (res.error || _('backend error'));
					result.className = 'cbi-value-description alert-message warning';
					return;
				}
				if (res.conflict) {
					result.textContent = _('CONFLICT: ') + d + _(' is in BOTH include and exclude');
					result.className = 'cbi-value-description alert-message danger';
				} else {
					var parts = [];
					if (res.userInclude) parts.push(_('user include'));
					if (res.userExclude) parts.push(_('user exclude'));
					if (res.autohostlist) parts.push(_('autohostlist (engine)'));
					if (parts.length === 0) parts.push(_('no list'));
					result.textContent = d + _(' matches: ') + parts.join(', ');
					result.className = 'cbi-value-description';
				}
			}).catch(function (err) {
				btn.disabled = false;
				result.textContent = _('Check failed: ') + String(err);
				result.className = 'cbi-value-description alert-message danger';
			});
		});
		if (readOnly) {
			btn.disabled = true;
			result.textContent = _('Unavailable — list backend did not respond.');
		}
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

	// items === null → unavailable (backend failed): locked placeholder, never
	// an empty editable textarea (applying it would erase the on-disk list).
	userListSection: function (title, key, items, sourcePath, readOnly) {
		var unavailable = items === null;
		var list = unavailable ? [] : items;
		var ta = E('textarea', { 'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:120px;font-family:monospace' },
			list.join('\n'));
		ta.setAttribute('data-list-key', key);
		if (unavailable || readOnly) ta.readOnly = true;

		var count = E('span', { 'class': 'cbi-value-description' },
			unavailable ? _('Unavailable — backend did not return this list.')
				: list.length + _(' entries'));
		var preview = E('pre', { 'style': 'white-space:pre-wrap;max-height:160px;overflow:auto;font-family:monospace;display:none' }, '');
		var filter = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'placeholder': _('filter entries (client-side)'), 'style': 'max-width:32em' });

		function refreshPreview() {
			var q = filter.value.trim().toLowerCase();
			var lines = ta.value.split('\n').map(function (l) { return l.trim(); })
				.filter(function (l) { return l.length > 0; });
			var shown = q ? lines.filter(function (l) { return l.toLowerCase().indexOf(q) !== -1; }) : lines;
			count.textContent = q
				? shown.length + _(' of ') + lines.length + _(' entries match')
				: lines.length + _(' entries');
			preview.textContent = shown.join('\n');
			preview.style.display = q ? '' : 'none';
		}
		filter.addEventListener('input', refreshPreview);
		ta.addEventListener('input', refreshPreview);
		if (unavailable) { filter.disabled = true; }

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-value-description' },
				_('One entry per line. User list — editable.') +
				(sourcePath ? ' ' + _('Source file: ') + sourcePath : '')),
			filter, E('div', {}, [count]), ta, preview
		]);
	},

	engineListSection: function (title, items, sourcePath, engineSupplied) {
		var unavailable = items === null;
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-value-description' },
				_('Engine-owned list — editing is disabled here by design.') +
				(engineSupplied ? '' : ' ' + _('(engine file not present on disk)')) +
				(sourcePath ? ' ' + _('Source file: ') + sourcePath : '')),
			E('div', { 'class': 'cbi-value-description' },
				unavailable ? _('Unavailable — backend did not return this list.')
					: items.length + _(' entries.')),
			E('pre', { 'style': 'white-space:pre-wrap;max-height:200px;overflow:auto;font-family:monospace' },
				unavailable ? _('Unavailable') : (items.length ? items.join('\n') : _('(empty or file not present)')))
		]);
	},

	applySection: function (readOnly) {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
		if (readOnly) btn.disabled = true;

		btn.addEventListener('click', function () {
			var edit = {};
			var tas = document.querySelectorAll('textarea[data-list-key]');
			for (var i = 0; i < tas.length; i++) {
				var key = tas[i].getAttribute('data-list-key');
				var lines = tas[i].value.split('\n').map(function (l) { return l.trim(); })
					.filter(function (l) { return l.length > 0; });
				edit[key] = lines;
			}
			// client-side conflict pre-check (backend still refuses authoritative)
			var ex = {};
			(edit.domainExclude || []).forEach(function (d) { ex[normalizeDomain(d)] = true; });
			var pre = (edit.domainInclude || []).filter(function (d) { return ex[normalizeDomain(d)]; });
			if (pre.length > 0) {
				status.textContent = _('CONFLICT: ') + pre.join(', ') + _(' in both include and exclude. Remove from one list.');
				status.className = 'cbi-value-description alert-message danger';
				return;
			}

			btn.disabled = true;
			status.className = 'cbi-value-description';
			status.textContent = _('Applying…');
			// ubus signature declares edit as string → send JSON text.
			callListsSet({ edit: JSON.stringify(edit) }).then(function (res) {
				btn.disabled = false;
				res = res || {};
				if (res.ok) {
					status.textContent = _('Applied: ') + (res.written || []).join(', ') + _(' lists written.');
					self.refresh();
				} else if (res.error === 'conflict') {
					status.textContent = _('CONFLICT: ') + (res.conflicts || []).join(', ') + _(' in both include and exclude. Remove from one list.');
					status.className = 'cbi-value-description alert-message danger';
				} else {
					status.textContent = _('Failed: ') + (res.error || _('unknown backend error'));
					status.className = 'cbi-value-description alert-message danger';
				}
			}).catch(function (err) {
				btn.disabled = false;
				status.textContent = _('Apply call failed: ') + String(err);
				status.className = 'cbi-value-description alert-message danger';
			});
		});
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Apply')),
			E('div', { 'class': 'cbi-value-description' },
				readOnly
					? _('Unavailable — the list backend did not respond, so Apply is disabled.')
					: _('Writes the user lists through the apply module. If a domain is in BOTH include and exclude, the apply is refused and the conflicts are reported.')),
			btn,
			status
		]);
	},

	refresh: function () {
		var self = this;
		callListsGet().then(function (data) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render({ loadError: null, data: data || {} }), old);
		}).catch(function (err) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode)
				old.parentNode.replaceChild(self.render({ loadError: String(err), data: null }), old);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
