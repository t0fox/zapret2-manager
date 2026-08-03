'use strict';

'require rpc';
'require view.zapret2-manager.proxy-legacy as LegacyProxy';

/* Frozen RPC declarations: the legacy proxy owns every call and payload. */
var callProxyCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'proxy_capabilities', reject: true });
var callProxyStatus = rpc.declare({ object: 'zapret2-manager', method: 'proxy_status', reject: true });
var callProxyConfigGet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_get', reject: true });
var callProxyConfigValidate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_validate', params: ['edit'], reject: true });
var callProxyConfigPreview = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_preview', params: ['edit'], reject: true });
var callProxyConfigApply = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_apply', params: ['edit'], reject: true });
var callProxyStart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_start', reject: true });
var callProxyStop = rpc.declare({ object: 'zapret2-manager', method: 'proxy_stop', reject: true });
var callProxyRestart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_restart', reject: true });
var callProxyAutostartSet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_autostart_set', params: ['edit'], reject: true });
var callProxySecretRotate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_secret_rotate', reject: true });
var callProxyLogsTail = rpc.declare({ object: 'zapret2-manager', method: 'proxy_logs_tail', params: ['edit'], reject: true });
var callProxyHealth = rpc.declare({ object: 'zapret2-manager', method: 'proxy_health', params: ['edit'], reject: true });
var callProxyLinkInfo = rpc.declare({ object: 'zapret2-manager', method: 'proxy_link_info', params: ['edit'], reject: true });
var callProxyQuickInstall = rpc.declare({ object: 'zapret2-manager', method: 'proxy_quick_install', reject: true });

function injectCss() {
	if (!document.getElementById('z2m-ui-css')) {
		var link = document.createElement('link');
		link.id = 'z2m-ui-css';
		link.rel = 'stylesheet';
		link.href = L.resource('view/zapret2-manager/z2m-ui.css');
		document.head.appendChild(link);
	}
}

function value(source, keys, fallback) {
	for (var i = 0; i < keys.length; i++) {
		if (source && source[keys[i]] != null && source[keys[i]] !== '') return String(source[keys[i]]);
	}
	return fallback;
}

var legacyRender = LegacyProxy.render;
var legacyToast = LegacyProxy._showToast;
LegacyProxy.title = _('TG PROXY');

LegacyProxy._showToast = function (text, isError) {
	legacyToast.call(this, text, isError);
	var toast = document.getElementById('px-toast');
	if (toast) {
		toast.style.cssText = '';
		toast.className = 'z2m-toast ' + (isError ? 'z2m-callout-bad' : 'z2m-callout-success');
	}
};

LegacyProxy.render = function (envelope) {
	injectCss();
	var root = legacyRender.call(this, envelope);
	root.classList.remove('cbi-map');
	root.classList.add('z2m-page', 'z2m-proxy-page');

	var oldTitle = root.querySelector('h2');
	var oldDescription = oldTitle && oldTitle.nextElementSibling;
	var header = E('header', { 'class': 'z2m-page-header' }, [
		E('div', {}, [
			E('h2', {}, 'TG PROXY'),
			E('p', {}, _('Telegram MTProto WebSocket proxy: установка, подключение и диагностика.'))
		])
	]);
	if (oldTitle) oldTitle.remove();
	if (oldDescription && oldDescription.classList.contains('cbi-value-description')) oldDescription.remove();
	root.insertBefore(header, root.firstChild);

	var status = envelope && envelope.status || {};
	var config = envelope && envelope.configGet || {};
	var installed = status.installed === true;
	var state = status.state || (installed ? _('установлен') : _('не установлен'));
	var server = value(config, ['server', 'listenAddress', 'bindAddress', 'host'], _('адрес не определён'));
	var port = value(config, ['port', 'listenPort'], '1443');
	var hero = E('section', { 'class': 'z2m-hero z2m-proxy-hero' }, [
		E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, 'TG'),
		E('div', { 'class': 'z2m-hero-body' }, [
			E('h3', {}, installed ? _('Прокси: ') + state : _('TG PROXY не установлен')),
			E('p', {}, installed ? server + ':' + port : _('Установка выполняется существующим подписанным workflow менеджера.'))
		])
	]);
	header.parentNode.insertBefore(hero, header.nextSibling);

	var simple = root.querySelector('.cbi-section');
	if (simple) simple.classList.add('z2m-card', 'z2m-proxy-connection');
	var linkCard = root.querySelector('#px-link-card');
	if (linkCard) linkCard.classList.add('z2m-card', 'z2m-proxy-connection');

	Array.prototype.forEach.call(root.querySelectorAll('details'), function (details) {
		details.classList.add('z2m-card', 'z2m-proxy-advanced');
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
};

return LegacyProxy;
