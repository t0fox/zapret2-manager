'use strict';
'require baseclass';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function state(status) {
  status = object(status);
  if (status.error) return 'unavailable';
  var summary = object(status.runtimeSummary);
  var value = String(summary.status || '').toLowerCase();
  return value || 'unknown';
}

return baseclass.extend({
  state: state
});