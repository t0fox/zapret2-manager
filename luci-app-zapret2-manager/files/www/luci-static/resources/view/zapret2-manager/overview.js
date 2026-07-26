'use strict';

// Branch 01: empty overview skeleton. The page must open without errors.
// Live status wiring lands in branch 03, backed by the ubus `status` method
// from branch 02. Until then this is a static placeholder.

return L.view.extend({
	title: _('Overview'),

	load: function () {
		// No ubus calls yet: the zapret2-manager object is defined in branch 02.
		return Promise.resolve({});
	},

	render: function () {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, _(
					'Overview is implemented in a later branch. ' +
					'The package skeleton installs correctly and this page ' +
					'opens without errors.'
				))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
