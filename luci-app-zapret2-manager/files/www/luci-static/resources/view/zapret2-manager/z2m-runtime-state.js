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

function isRunning(status) { return state(status) === 'running'; }
function pid(status) {
  var summary = object(object(status).runtimeSummary);
  var process = object(summary.process);
  return process.pid == null || process.pid === '' ? null : process.pid;
}

return baseclass.extend({
  state: state,
  isRunning: isRunning,
  pid: pid,
  snapshot: function (status) {
    status = object(status);
    return {
      state: state(status),
      pid: pid(status),
      installedRelease: object(status.engine).installedRelease || null,
      installedOrigin: object(status.engine).installedOrigin || null,
      packageVersion: object(status.engine).packageVersion || null,
      runtimeVersion: object(status.engine).runtimeVersion || null,
      observedAt: status.generatedAt || null
    };
  }
});
