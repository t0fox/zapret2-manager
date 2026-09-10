'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function payload(value) {
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) { value = value[0]; continue; }
    if (value && typeof value === 'object' && value.value !== undefined) { value = value.value; continue; }
    break;
  }
  return object(value);
}
function firstDefined(values) {
  for (var i = 0; i < values.length; i++)
    if (values[i] != null && values[i] !== '') return values[i];
  return null;
}
function hasValue(value) { return value !== null && value !== undefined && value !== ''; }
function hasAny(objectValue, keys) {
  objectValue = object(objectValue);
  for (var i = 0; i < keys.length; i++)
    if (hasValue(objectValue[keys[i]])) return true;
  return false;
}

function runtimeHealth(status) {
  status = object(status);
  var runtime = object(status.runtime);
  var process = object(runtime.process);
  var connectivity = object(runtime.connectivity);
  var explicit = object(status.health);
  var state = firstDefined([status.serviceState, status.state]);
  var verified = connectivity.verified === true ||
    explicit.status === 'healthy' || explicit.verified === true ||
    status.bypassVerified === true;

  if (state === 'stopped')
    return { label: 'Обход остановлен', detail: 'Служба zapret2 остановлена', kind: 'r', verified: false };
  if (verified)
    return { label: 'Обход работает', detail: 'Backend подтвердил runtime и связность', kind: 'g', verified: true };
  if (state === 'running' || process.found === true)
    return { label: 'Служба запущена', detail: 'Связность ещё не подтверждена backend', kind: 'o', verified: false };
  return { label: 'Состояние неизвестно', detail: 'Backend не предоставил runtime evidence', kind: 'o', verified: false };
}

function strategyInfo(canonical, status) {
	canonical = object(canonical);
	status = object(status);
	canonical = object(canonical.strategy || canonical.item || canonical);
	var statusStrategy = object(status.strategyStatus);
	var name = firstDefined([canonical.name, canonical.displayName,
		statusStrategy.name, statusStrategy.displayName, statusStrategy.id, statusStrategy.strategyId]);
	var description = firstDefined([canonical.description, canonical.summary,
		statusStrategy.description, statusStrategy.summary]);
  if (name && !description) {
    var suffix = /\s*\(([^()]+)\)\s*$/.exec(String(name));
    if (suffix) {
      name = String(name).slice(0, suffix.index).trim();
      description = suffix[1];
    }
  }
	return {
		id: firstDefined([canonical.id, canonical.strategyId,
			statusStrategy.id, statusStrategy.strategyId]),
		name: name,
		description: description,
		source: firstDefined([canonical.source]),
		appliedAt: firstDefined([canonical.appliedAt]),
		argv: firstDefined([canonical.argv]),
		revision: firstDefined([canonical.revision])
	};
}

function normalize(data) {
	data = object(data);
	var status = payload(data.status);
	var canonicalStrategy = payload(data.strategy);
	var errors = [];

  Object.keys(data).forEach(function (key) {
    var error = object(data[key]).error;
    if (!error) return;
    var message = firstDefined([error.message, error.detail, error.code]);
    errors.push({ code: error.code || 'EUNAVAILABLE', message: message ? String(message) : 'Backend request failed' });
	});

	var health = runtimeHealth(status);
	var strategy = strategyInfo(canonicalStrategy, status);
	var view = {
		health: health,
		strategy: strategy,
		errors: errors,
		visible: {
			health: health !== null,
			strategy: hasAny(strategy, ['id', 'name', 'description', 'source', 'appliedAt', 'argv', 'revision']),
			errors: errors.length > 0
    }
  };
  return view;
}

return baseclass.extend({
  normalize: normalize});
