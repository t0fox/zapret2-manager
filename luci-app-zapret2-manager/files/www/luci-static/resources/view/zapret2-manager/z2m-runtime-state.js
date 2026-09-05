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
  if (value === 'engine_missing' || value === 'not-installed') return 'missing';
  return value || 'unknown';
}

function snapshot(status) {
  status = object(status);
  var summary = object(status.runtimeSummary);
  var process = object(summary.process);
  return {
    state: state(status),
    pid: process.pid || null,
    installedRelease: summary.installedRelease || null
  };
}

return baseclass.extend({
  state: state,
  snapshot: snapshot
});
