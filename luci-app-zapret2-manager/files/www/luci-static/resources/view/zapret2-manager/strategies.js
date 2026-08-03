'use strict';

'require rpc';
'require view.zapret2-manager.strategies-legacy as LegacyProfiles';

/* Frozen RPC declarations: the legacy view owns the calls and payloads. */
var callStatus = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
var callProfilesList = rpc.declare({ object: 'zapret2-manager', method: 'profiles_list', reject: true });
var callProfilesCreate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_create', params: ['edit'], reject: true });
var callProfilesUpdate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_update', params: ['edit'], reject: true });
var callProfilesClone = rpc.declare({ object: 'zapret2-manager', method: 'profiles_clone', params: ['edit'], reject: true });
var callProfilesDelete = rpc.declare({ object: 'zapret2-manager', method: 'profiles_delete', params: ['edit'], reject: true });
var callProfilesValidate = rpc.declare({ object: 'zapret2-manager', method: 'profiles_validate', params: ['edit'], reject: true });
var callProfilesImportApplied = rpc.declare({ object: 'zapret2-manager', method: 'profiles_import_applied', reject: true });
var callProfilesApply = rpc.declare({ object: 'zapret2-manager', method: 'profiles_apply', params: ['edit'], reject: true });
var callPassthrough = rpc.declare({ object: 'zapret2-manager', method: 'passthrough', params: ['enabled'], reject: true });
var callConfirmAlive = rpc.declare({ object: 'zapret2-manager', method: 'confirm_alive', reject: true });
var callRollback = rpc.declare({ object: 'zapret2-manager', method: 'rollback', reject: true });

var legacyRender = LegacyProfiles.render;
LegacyProfiles.title = _('Профили');
LegacyProfiles.render = function (envelope) {
	var root = legacyRender.call(this, envelope);
	root.classList.add('z2m-page', 'z2m-profiles-page');

	var header = root.querySelector('.z2m-page-header');
	if (header) {
		var heading = header.querySelector('h2');
		var description = header.querySelector('p');
		if (heading) heading.textContent = _('Профили');
		if (description) description.textContent = _('Ручные профили и состав текущей конфигурации zapret2.');

		var data = envelope && envelope.data || {};
		var profiles = envelope && envelope.profilesData || {};
		var draft = profiles.draft || {};
		var state = data.serviceState || _('неизвестно');
		var hero = E('section', { 'class': 'z2m-hero z2m-profiles-hero' }, [
			E('div', { 'class': 'z2m-hero-icon', 'aria-hidden': 'true' }, '≡'),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, _('Состав текущей конфигурации')),
				E('p', {}, _('Служба: ') + state + ' · ' +
					_('применено: ') + String(profiles.profileCount || 0) + ' · ' +
					_('в черновике: ') + String(draft.profileCount || 0))
			])
		]);
		header.parentNode.insertBefore(hero, header.nextSibling);
	}

	Array.prototype.forEach.call(root.querySelectorAll('.cbi-section'), function (section) {
		section.classList.add('z2m-card');
	});
	Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
		table.classList.add('z2m-table');
	});
	Array.prototype.forEach.call(root.querySelectorAll('details'), function (details) {
		details.classList.add('z2m-details');
	});
	return root;
};

return LegacyProfiles;
