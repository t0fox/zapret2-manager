'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-strategy-workflow-core as Core';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function runEnvelope(data) {
  var envelope = object(data && data.run && data.run.value);
  return object(envelope.run || envelope.activeRun || envelope);
}
function firstReason(value, depth) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (var index = 0; index < value.length; index++) {
      var nested = firstReason(value[index], depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  var preferred = ['reason','message','detail','blocker','stderr','error'];
  for (var key = 0; key < preferred.length; key++) {
    var found = firstReason(value[preferred[key]], depth + 1);
    if (found && found !== 'infrastructure-error') return found;
  }
  return null;
}
function render(ctx) {
  var root = Core.render(ctx);
  var run = runEnvelope(ctx.data || {});
  var phase = String(run.phase || run.status || '').toLowerCase();
  if (phase !== 'infrastructure-error') return root;

  var failures = array(run.infrastructureFailures || run.failures || run.candidateJournal);
  var reason = firstReason(failures, 0) || firstReason(run.error, 0) ||
    _('Backend отметил запуск как infrastructure-error без подробной причины.');
  var banner = ctx.shell.statePanel({
    title: _('Полный прогон остановлен из-за инфраструктуры'),
    message: reason + ' ' +
      _('Исправьте preflight/runner и запустите новый прогон. Этот запуск не выбирает победителя и ничего не применяет.'),
    kind: 'error'
  });
  if (root && typeof root.insertBefore === 'function') root.insertBefore(banner, root.children && root.children[1] || null);
  else if (root && typeof root.appendChild === 'function') root.appendChild(banner);
  return root;
}

return baseclass.extend({
  id: Core.id || 'strategy',
  title: Core.title || _('Стратегия'),
  subtitle: Core.subtitle || _('Выбор и проверка способа обхода DPI'),
  load: function (ctx) { return Core.load(ctx); },
  render: render,
  mount: function (ctx) { if (Core.mount) Core.mount(ctx); },
  unmount: function (ctx) { if (Core.unmount) Core.unmount(ctx); },
  createAdapter: Core.createAdapter
});
