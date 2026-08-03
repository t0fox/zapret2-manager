'use strict';

'require rpc';
'require view.zapret2-manager.lists-legacy as LegacyLists';

/* Frozen RPC declarations: the legacy view owns the calls and payloads. */
const callListsGet = rpc.declare({ object: 'zapret2-manager', method: 'lists_get', reject: true });
const callListsCheck = rpc.declare({ object: 'zapret2-manager', method: 'lists_check_domain', params: ['domain'], reject: true });
const callListsSet = rpc.declare({ object: 'zapret2-manager', method: 'lists_set', params: ['edit'], reject: true });

function listCount(lists) {
	var total = 0;
	['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'].forEach(function (key) {
		var entry = lists[key] || {};
		total += Array.isArray(entry.entries) ? entry.entries.length : 0;
	});
	return total;
}

var legacyRender = LegacyLists.render;
LegacyLists.title = _('Списки');
LegacyLists.render = function (envelope) {
	var root = legacyRender.call(this, envelope);
	root.classList.add('z2m-page', 'z2m-lists-page');

	var data = envelope && envelope.data || {};
	var lists = data.lists || {};
	var conflicts = data.conflicts || [];
	var header = root.querySelector('.z2m-page-header');
	var hero = E('section', { 'class': 'z2m-hero z2m-lists-hero' }, [
		E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, '↕'),
		E('div', { 'class': 'z2m-hero-body' }, [
			E('h3', {}, _('Маршрутизация по спискам')),
			E('p', {}, String(listCount(lists)) + ' ' + _('записей') + ' · ' +
				(conflicts.length ? String(conflicts.length) + ' ' + _('конфликтов') : _('конфликтов нет')))
		])
	]);

	var tabs = E('div', { 'class': 'z2m-tabs', role: 'tablist', 'aria-label': _('Тип списка') });
	var groups = [
		{ id: 'domains', label: _('Домены') },
		{ id: 'ip', label: _('IP-адреса') },
		{ id: 'engine', label: _('Системные') }
	];
	var buttons = [];

	function activate(group) {
		buttons.forEach(function (button) {
			var active = button.getAttribute('data-group') === group;
			button.className = 'z2m-tab' + (active ? ' z2m-tab-active' : '');
			button.setAttribute('aria-selected', active ? 'true' : 'false');
		});
		Array.prototype.forEach.call(root.querySelectorAll('[data-list-group]'), function (node) {
			node.hidden = node.getAttribute('data-list-group') !== group;
		});
	}

	groups.forEach(function (group, index) {
		var tab = E('button', {
			type: 'button',
			'class': 'z2m-tab' + (index === 0 ? ' z2m-tab-active' : ''),
			'role': 'tab',
			'data-group': group.id,
			'aria-selected': index === 0 ? 'true' : 'false'
		}, group.label);
		tab.addEventListener('click', function () { activate(group.id); });
		buttons.push(tab);
		tabs.appendChild(tab);
	});

	if (header) {
		header.parentNode.insertBefore(hero, header.nextSibling);
		header.parentNode.insertBefore(tabs, hero.nextSibling);
	}

	var cards = Array.prototype.slice.call(root.querySelectorAll('.z2m-card'));
	cards.forEach(function (card, index) {
		var group = index <= 2 ? 'domains' : index <= 5 ? 'ip' : 'engine';
		card.setAttribute('data-list-group', group);
	});
	Array.prototype.forEach.call(root.querySelectorAll('.cbi-section'), function (section) {
		section.classList.add('z2m-card');
	});
	Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
		table.classList.add('z2m-table');
	});
	activate('domains');
	return root;
};

return LegacyLists;
