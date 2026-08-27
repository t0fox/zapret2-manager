'use strict';
'require baseclass';

var STATES = {
	current: { label: _('Актуально'), kind: 'g', severity: 0 },
	'update-available': { label: _('Доступно обновление'), kind: 'o', severity: 1 },
	'review-required': { label: _('Требуется проверка'), kind: 'o', severity: 1 },
	'rebase-required': { label: _('Требуется адаптация'), kind: 'o', severity: 1 },
	'integration-required': { label: _('Требуется интеграция'), kind: 'o', severity: 1 },
	broken: { label: _('Ошибка'), kind: 'r', severity: 2 },
	failed: { label: _('Ошибка'), kind: 'r', severity: 2 },
	unknown: { label: _('Не проверено'), kind: '', severity: 0 }
};

var ALIASES = {
	update: 'update-available',
	attention: 'review-required',
	error: 'failed'
};

function state(value) {
	var raw = value && typeof value === 'object' ? value.state || value.updateState : value;
	raw = raw === null || raw === undefined ? '' : String(raw).toLowerCase();
	return STATES[raw] ? raw : ALIASES[raw] && STATES[ALIASES[raw]] ? ALIASES[raw] : 'unknown';
}

function describe(value) {
	var normalized = state(value);
	var definition = STATES[normalized];
	return {
		state: normalized,
		label: definition.label,
		kind: definition.kind,
		severity: definition.severity
	};
}

return baseclass.extend({
	states: STATES,
	normalize: state,
	describe: describe
});
