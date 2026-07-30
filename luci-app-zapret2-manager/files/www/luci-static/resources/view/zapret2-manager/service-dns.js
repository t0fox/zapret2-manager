'use strict';
// Compatibility redirect: old Service DNS route → unified DNS Centre.
// The Service DNS menu entry was removed in r38; this hidden route
// ensures bookmarked links still work.

return L.view.extend({
	title: _('Service DNS'),
	load: function () { return Promise.resolve({}); },
	render: function () {
		return E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Service DNS has moved')),
				E('p', {},
					_('Service DNS mappings are now part of the unified DNS Centre. ') +
					E('a', { href: L.url('admin/services/zapret2-manager/dns') }, _('Open DNS Centre')))
			]),
			E('script', {}, 'window.location.replace(' + JSON.stringify(L.url('admin/services/zapret2-manager/dns')) + ');')
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
