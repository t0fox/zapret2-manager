'use strict';

'require rpc';
'require view.zapret2-manager.monitor-legacy as LegacyMonitor';

/* Frozen RPC declaration: the legacy monitor owns polling and data handling. */
const callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });

function decorate(root, envelope, owner) {
	root.classList.add('z2m-page', 'z2m-monitor-page');
	var header = root.querySelector('.z2m-page-header');
	if (header) {
		var heading = header.querySelector('h2');
		var description = header.querySelector('p');
		if (heading) heading.textContent = _('Мониторинг');
		if (description) description.textContent = _('Процессы, NFQUEUE, состояние службы и активные предупреждения.');

		var data = envelope && envelope.data || owner && owner._lastGood && owner._lastGood.data || {};
		var runtime = data.runtime || {};
		var warnings = data.warnings || [];
		var state = data.serviceState || _('неизвестно');
		var hero = E('section', { 'class': 'z2m-hero z2m-monitor-hero' }, [
			E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, '●'),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, _('zapret2 / nfqws2: ') + state),
				E('p', {}, _('экземпляров: ') + String(runtime.count != null ? runtime.count : '—') + ' · ' +
					_('профилей: ') + String(runtime.profileCount != null ? runtime.profileCount : '—') + ' · ' +
					_('предупреждений: ') + String(warnings.length))
			])
		]);
		header.parentNode.insertBefore(hero, header.nextSibling);
	}

	Array.prototype.forEach.call(root.querySelectorAll('.z2m-card-grid'), function (grid) {
		grid.classList.add('z2m-monitor-kpis');
	});
	Array.prototype.forEach.call(root.querySelectorAll('.cbi-section'), function (section) {
		section.classList.add('z2m-card');
	});
	Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
		table.classList.add('z2m-table');
		if (table.parentNode && !table.parentNode.classList.contains('z2m-table-wrap'))
			table.parentNode.classList.add('z2m-table-wrap');
	});
	Array.prototype.forEach.call(root.querySelectorAll('pre'), function (node) {
		node.classList.add('z2m-console');
	});
	return root;
}

var legacyBuildContainer = LegacyMonitor.buildContainer;
LegacyMonitor.title = _('Мониторинг');
LegacyMonitor.buildContainer = function (envelope, pollError) {
	return decorate(legacyBuildContainer.call(this, envelope, pollError), envelope, this);
};

return LegacyMonitor;
