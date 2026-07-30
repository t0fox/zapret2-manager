'use strict';

// Lists page — manage user domain lists, show read-only IP/engine lists
// with explicit reasons, check domain membership. r38: z2m-ui integration.

'require rpc';

const callListsGet   = rpc.declare({ object: 'zapret2-manager', method: 'lists_get', reject: true });
const callListsCheck = rpc.declare({ object: 'zapret2-manager', method: 'lists_check_domain', params: ['domain'], reject: true });
const callListsSet   = rpc.declare({ object: 'zapret2-manager', method: 'lists_set', params: ['edit'], reject: true });

function normalizeDomain(d) {
	var s = String(d == null ? '' : d).trim().toLowerCase();
	if (s.charAt(0) === '.') s = s.substring(1);
	return s;
}

function esc(s) { return (s == null) ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
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
	title: _('Lists'),

	load: function () {
		return callListsGet().then(function (res) {
			return { loadError: null, data: res || null };
		}).catch(function (err) {
			return { loadError: String(err), data: null };
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || { loadError: 'no data', data: null };
		var data = envelope.data || {};
		var backendError = envelope.loadError ||
			(data && data.ok === false ? (data.error || 'backend error') : null) ||
			(data && data.error ? data.error : null);
		var lists = (data && data.lists) || {};
		var conflicts = (data && data.conflicts) || [];
		var readOnly = backendError != null;
		var self = this;

		var container = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Lists')),
				E('p', {}, _('User domain lists are editable through the backend apply path. IP and engine lists are read-only. A domain in both include and exclude is refused before writing.'))
			])
		]);

		if (backendError) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' },
				_('List backend unavailable: ') + esc(backendError) + '. ' + _('Editing is locked.')));
		}

		if (conflicts.length > 0) {
			container.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, [
				E('p', {}, _('Conflict: domains in BOTH include and exclude:')),
				E('pre', { 'class': 'z2m-mono' }, conflicts.join('\n'))
			]));
		}

		container.appendChild(this.domainCheckSection(readOnly));

		var userLists = [
			[_('Domain include'), 'domainInclude'],
			[_('Domain exclude'), 'domainExclude'],
			[_('IP include (IPv4)'), 'ipInclude'],
			[_('IP exclude (IPv4)'), 'ipExclude'],
			[_('IP full-block (IPv4)'), 'ipBlock']
		];
		userLists.forEach(function (spec) {
			var meta = lists[spec[1]] || {};
			var editable = backendError ? true : (meta.editable === true);
			var locked = readOnly || !editable;
			var items = backendError ? null : (meta.entries !== undefined ? meta.entries : null);
			container.appendChild(self.userListSection(
				spec[0], spec[1], items, meta.path != null ? meta.path : null,
				locked, editable, meta.reason || null));
		});

		var auto = lists.autohostlist || {};
		container.appendChild(this.engineListSection(
			_('Autohostlist (engine-owned)'),
			backendError ? null : (auto.entries !== undefined ? auto.entries : null),
			auto.path != null ? auto.path : null,
			auto.present === true, auto.reason || null));

		container.appendChild(this.applySection(readOnly));
		return container;
	},

	domainCheckSection: function (readOnly) {
		var result = E('div', { 'class': 'cbi-value-description' }, '');
		var input = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'placeholder': _('enter a domain to check') });
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Check'));
		btn.addEventListener('click', function () {
			var d = input.value.trim(); if (!d) return;
			btn.disabled = true;
			result.className = 'cbi-value-description';
			result.textContent = _('Checking…');
			callListsCheck(d).then(function (res) {
				btn.disabled = false; res = res || {};
				if (res.error || res.ok === false) {
					result.textContent = _('Check unavailable: ') + (res.error || _('backend error'));
					result.className = 'z2m-callout z2m-callout-warn';
					return;
				}
				if (res.conflict) {
					result.textContent = _('CONFLICT: ') + d + _(' in both include and exclude');
					result.className = 'z2m-callout z2m-callout-bad';
				} else {
					var parts = [];
					if (res.userInclude) parts.push(_('user include'));
					if (res.userExclude) parts.push(_('user exclude'));
					if (res.autohostlist) parts.push(_('autohostlist'));
					if (parts.length === 0) parts.push(_('no list'));
					result.textContent = d + _(' matches: ') + parts.join(', ');
					result.className = 'cbi-value-description';
				}
			}).catch(function (err) {
				btn.disabled = false;
				result.textContent = _('Check failed: ') + String(err);
				result.className = 'z2m-callout z2m-callout-bad';
			});
		});
		if (readOnly) { btn.disabled = true; result.textContent = _('Unavailable.'); }

		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Domain check')),
			E('p', { 'class': 'cbi-value-description' },
				_('Check whether a domain falls under the autohostlist or user lists.'))
		]);
		node.appendChild(E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, _('Domain')),
			E('span', { 'class': 'z2m-kv-value' }, input)
		]));
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [btn]));
		node.appendChild(result);
		return node;
	},

	userListSection: function (title, key, items, sourcePath, locked, editable, reason) {
		var unavailable = items === null;
		var list = unavailable ? [] : items;

		var info = (editable ? _('Editable user list.') : _('Read-only — backend refuses writes.')) +
			(sourcePath ? ' ' + _('Source: ') + sourcePath : '');
		if (!editable && reason) info += ' ' + _('Reason: ') + reason;

		if (!editable) {
			var card = E('div', { 'class': 'z2m-card' }, [
				E('h4', {}, title),
				E('p', { 'class': 'cbi-value-description' }, info),
				E('div', { 'class': 'cbi-value-description' },
					unavailable ? _('Unavailable — no proven path.')
						: badge(list.length + _(' entries'), 'neutral'))
			]);
			if (!unavailable && list.length) {
				card.appendChild(E('pre', { 'class': 'z2m-mono' },
					list.length ? list.join('\n') : _('(empty)')));
			}
			return card;
		}

		var ta = E('textarea', { 'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:100px;font-family:monospace' }, list.join('\n'));
		ta.setAttribute('data-list-key', key);
		if (unavailable || locked) ta.readOnly = true;

		var count = E('span', { 'class': 'cbi-value-description' },
			unavailable ? _('Unavailable.') : list.length + _(' entries'));

		var filter = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'placeholder': _('filter entries'), 'style': 'max-width:24em' });
		var preview = E('pre', { 'class': 'z2m-mono', 'style': 'display:none' }, '');

		function refreshPreview() {
			var q = filter.value.trim().toLowerCase();
			var lines = ta.value.split('\n').map(function (l) { return l.trim(); })
				.filter(function (l) { return l.length > 0; });
			var shown = q ? lines.filter(function (l) { return l.toLowerCase().indexOf(q) !== -1; }) : lines;
			count.textContent = q ? shown.length + _(' of ') + lines.length + _(' entries match') : lines.length + _(' entries');
			preview.textContent = shown.join('\n');
			preview.style.display = q ? '' : 'none';
		}
		filter.addEventListener('input', refreshPreview);
		ta.addEventListener('input', refreshPreview);
		if (unavailable) filter.disabled = true;

		return E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, title),
			E('p', { 'class': 'cbi-value-description' }, info),
			E('div', { 'class': 'z2m-actions' }, [filter]),
			count, ta, preview
		]);
	},

	engineListSection: function (title, items, sourcePath, engineSupplied, reason) {
		var unavailable = items === null;
		var card = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, title),
			E('p', { 'class': 'cbi-value-description' },
				_('Engine-owned — not editable here.') +
				(!engineSupplied ? ' ' + _('(file not present on disk)') : '') +
				(sourcePath ? ' ' + _('Source: ') + sourcePath : '')),
			reason ? E('p', { 'class': 'cbi-value-description' }, _('Reason: ') + reason) : null
		].filter(Boolean));

		if (unavailable) {
			card.appendChild(E('div', { 'class': 'z2m-empty' }, _('Unavailable.')));
		} else {
			card.appendChild(E('div', { 'class': 'cbi-value-description' },
				badge(items.length + _(' entries'), 'neutral')));
			if (items.length) {
				card.appendChild(E('pre', { 'class': 'z2m-mono' }, items.join('\n')));
			}
		}
		return card;
	},

	applySection: function (readOnly) {
		var self = this;
		var status = E('div', { 'class': 'cbi-value-description' }, '');
		var btn = E('button', { 'class': 'cbi-button cbi-button-apply', 'type': 'button' }, _('Apply'));
		if (readOnly) btn.disabled = true;

		btn.addEventListener('click', function () {
			var edit = {};
			document.querySelectorAll('textarea[data-list-key]').forEach(function (ta) {
				var key = ta.getAttribute('data-list-key');
				var lines = ta.value.split('\n').map(function (l) { return l.trim(); })
					.filter(function (l) { return l.length > 0; });
				edit[key] = lines;
			});
			var ex = {};
			(edit.domainExclude || []).forEach(function (d) { ex[normalizeDomain(d)] = true; });
			var pre = (edit.domainInclude || []).filter(function (d) { return ex[normalizeDomain(d)]; });
			if (pre.length > 0) {
				status.className = 'z2m-callout z2m-callout-bad';
				status.textContent = _('CONFLICT: ') + pre.join(', ') + _(' in both lists.');
				return;
			}
			btn.disabled = true;
			status.className = 'cbi-value-description';
			status.textContent = _('Applying…');
			callListsSet(JSON.stringify(edit)).then(function (res) {
				btn.disabled = false; res = res || {};
				if (res.ok) {
					self.refresh();
				} else if (res.error === 'conflict') {
					status.className = 'z2m-callout z2m-callout-bad';
					status.textContent = _('CONFLICT: ') + (res.conflicts || []).join(', ');
				} else {
					status.className = 'z2m-callout z2m-callout-bad';
					status.textContent = _('Failed: ') + (res.error || _('backend error'));
				}
			}).catch(function (err) {
				btn.disabled = false;
				status.className = 'z2m-callout z2m-callout-bad';
				status.textContent = _('Apply call failed: ') + String(err);
			});
		});

		var node = E('div', { 'class': 'z2m-card' }, [
			E('h4', {}, _('Apply')),
			E('p', { 'class': 'cbi-value-description' },
				readOnly
					? _('Unavailable — list backend did not respond, Apply disabled.')
					: _('Writes user lists through the apply module. Domains in both include and exclude are refused.'))
		]);
		node.appendChild(E('div', { 'class': 'z2m-actions' }, [btn]));
		node.appendChild(status);
		node.appendChild(E('p', { 'class': 'cbi-value-description' },
			_('Only manager-owned lists are written. Engine lists, IP sets and firewall rules are never modified.')));
		return node;
	},

	refresh: function () {
		var self = this;
		callListsGet().then(function (data) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode) old.parentNode.replaceChild(self.render({ loadError: null, data: data || {} }), old);
		}).catch(function (err) {
			var old = document.querySelector('.cbi-map');
			if (old && old.parentNode) old.parentNode.replaceChild(self.render({ loadError: String(err), data: null }), old);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
