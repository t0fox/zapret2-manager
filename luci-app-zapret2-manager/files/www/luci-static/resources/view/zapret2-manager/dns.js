'use strict';

'require rpc';
'require view.zapret2-manager.dns-legacy as LegacyDns';

/* Frozen RPC declarations: the legacy DNS workspace owns all calls and payloads. */
const callDnsGet = rpc.declare({ object: 'zapret2-manager', method: 'dns_get', reject: true });
const callDnsSet = rpc.declare({ object: 'zapret2-manager', method: 'dns_set', params: ['edit'], reject: true });
const callDnsValidate = rpc.declare({ object: 'zapret2-manager', method: 'dns_validate', params: ['edit'], reject: true });
const callDnsApply = rpc.declare({ object: 'zapret2-manager', method: 'dns_apply', params: ['edit'], reject: true });
const callDnsCheck = rpc.declare({ object: 'zapret2-manager', method: 'dns_check', params: ['edit'], reject: true });
const callDnsRollback = rpc.declare({ object: 'zapret2-manager', method: 'dns_rollback', reject: true });
const callDnsRestoreAuto = rpc.declare({ object: 'zapret2-manager', method: 'dns_restore_auto', reject: true });
const callProvComp = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_components', reject: true });
const callProvList = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_providers', reject: true });
const callProvDiag = rpc.declare({ object: 'zapret2-manager', method: 'dnsprov_diagnose', params: ['edit'], reject: true });
const callProvSelect = rpc.declare({ object: 'zapret2-manager', method: 'dns_select_provider', params: ['edit'], reject: true });
const callSdnsProv = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_providers', reject: true });
const callSdnsStatus = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_status', reject: true });
const callSdnsPreview = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_preview', reject: true });
const callSdnsSet = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_set', params: ['edit'], reject: true });
const callSdnsApply = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply', params: ['edit'], reject: true });
const callSdnsApplyAsync = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply_async', params: ['edit'], reject: true });
const callSdnsApplyStatus = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_apply_status', params: ['edit'], reject: true });
const callSdnsRollback = rpc.declare({ object: 'zapret2-manager', method: 'service_dns_rollback', reject: true });

const SECTION_MARKERS = [
	{ id: 'setup' },
	{ id: 'providers' },
	{ id: 'services' },
	{ id: 'advanced' },
	{ id: 'history' }
];

function firstValue(values) {
	for (var i = 0; i < values.length; i++) {
		if (values[i] != null && values[i] !== '') return String(values[i]);
	}
	return _('не определён');
}

function providerCount(envelope) {
	var source = envelope && envelope.provList || {};
	var providers = source.providers || source.items || [];
	return Array.isArray(providers) ? providers.length : 0;
}

var legacyRender = LegacyDns.render;
LegacyDns.title = _('DNS');
LegacyDns.render = function (envelope) {
	var root = legacyRender.call(this, envelope);
	root.classList.add('z2m-page', 'z2m-dns-page');
	root.setAttribute('data-sections', SECTION_MARKERS.map(function (section) { return section.id; }).join(','));

	var header = root.querySelector('.z2m-page-header');
	if (header) {
		var description = header.querySelector('p');
		if (description) description.textContent = _('Резолвер, провайдеры и DNS-доступ для отдельных сервисов.');

		var dns = envelope && envelope.dns || {};
		var config = dns.config || dns.current || dns;
		var resolver = firstValue([
			config.providerName,
			config.provider,
			config.mode,
			config.resolver,
			config.resolvfile
		]);
		var serviceStatus = envelope && envelope.sdnsStatus || {};
		var enabledServices = serviceStatus.enabledCount != null ? serviceStatus.enabledCount :
			serviceStatus.count != null ? serviceStatus.count : _('—');

		var hero = E('section', { 'class': 'z2m-hero z2m-dns-hero' }, [
			E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, 'DNS'),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, resolver),
				E('p', {}, String(providerCount(envelope)) + ' ' + _('провайдеров доступно') + ' · ' +
					String(enabledServices) + ' ' + _('сервисных правил включено'))
			])
		]);
		header.parentNode.insertBefore(hero, header.nextSibling);
	}

	var tabs = root.querySelector('.z2m-tabs');
	if (tabs) {
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', _('Раздел DNS'));
	}
	Array.prototype.forEach.call(root.querySelectorAll('.z2m-tab'), function (tab) {
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-selected', tab.classList.contains('z2m-tab-active') ? 'true' : 'false');
	});
	Array.prototype.forEach.call(root.querySelectorAll('.z2m-provider-grid'), function (grid) {
		grid.classList.add('z2m-card-grid');
	});
	Array.prototype.forEach.call(root.querySelectorAll('.cbi-section'), function (section) {
		section.classList.add('z2m-card');
	});
	Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
		table.classList.add('z2m-table');
	});
	return root;
};

return LegacyDns;
