'use strict';
'require baseclass';

var KEY = '__engineGate';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function errorValue(value) { return object(value && value.error || value); }
function isMissing(value) {
  value = object(value);
  var error = errorValue(value);
  var state = String(value.state || value.serviceState || error.code || '').toLowerCase();
  return value.installed === false || state === 'engine_missing' || state === 'eengine_missing';
}
function normalizeError(ctx, error) {
  return ctx && ctx.api && typeof ctx.api.normalizeError === 'function'
    ? ctx.api.normalizeError(error)
    : { code: error && error.code || 'engine-status-unavailable', message: error && error.message || String(error || _('Состояние движка недоступно.')) };
}
function envelope(allowed, status, data, error) {
  var result = {};
  result[KEY] = { allowed: allowed === true, missing: isMissing(status) || isMissing(error), status: status || null, error: error || null };
  result.data = data;
  return result;
}
function hasEnvelope(ctx) {
  return !!(ctx && ctx.data && Object.prototype.hasOwnProperty.call(ctx.data, KEY));
}
function childContext(ctx) {
  return Object.assign({}, ctx, { data: ctx && ctx.data ? ctx.data.data || {} : {} });
}
function materialize(module) {
  if (typeof module === 'function' && module.prototype) {
    try { return new module(); }
    catch (error) { return module; }
  }
  return module || {};
}
function loadCore(module, ctx, status) {
  return Promise.resolve(module.load ? module.load(ctx) : {}).then(function (data) {
    return envelope(true, status || { installed: true, compatibilityMode: true }, data || {}, null);
  });
}
function loadGuarded(module, ctx) {
  var statusCall = ctx && ctx.api && ctx.api.engine && ctx.api.engine.status;
  if (typeof statusCall !== 'function') return loadCore(module, ctx, null);
  return Promise.resolve(statusCall()).then(function (status) {
    if (!status || status.ok === false) {
      var backendError = status && status.error || { code: 'engine-status-unavailable', message: _('Backend не вернул состояние движка.') };
      return envelope(false, status, null, normalizeError(ctx, backendError));
    }
    if (isMissing(status)) return envelope(false, status, null, null);
    if (status.installed !== true)
      return envelope(false, status, null, normalizeError(ctx, { code: 'engine-status-unavailable', message: _('Наличие движка не подтверждено backend.') }));
    return loadCore(module, ctx, status);
  }, function (error) {
    return envelope(false, null, null, normalizeError(ctx, error));
  });
}
function installButton(ctx) {
  return ctx.shell.button(_('Установить движок'), 'primary', function () {
    return ctx.navigate('maintenance');
  });
}
function blocker(module, ctx) {
  var gate = object(ctx.data && ctx.data[KEY]);
  var missing = gate.missing === true;
  var message = missing
    ? _('Движок zapret2 не установлен. Этот раздел зависит от nfqws2, но Maintenance, backups, diagnostics и Telegram Proxy остаются доступны.')
    : (gate.error && gate.error.message || _('Не удалось подтвердить состояние движка. Раздел заблокирован безопасно.'));
  return E('section', { 'class': 'z2m-view on z2m-engine-missing', id: 'z2m-view-' + (module.id || 'engine-dependent') }, [
    E('div', { 'class': 'z2m-phead' }, E('div', {}, [
      E('h1', {}, module.title || _('Раздел недоступен')),
      E('p', {}, module.subtitle || _('Требуется установленный движок zapret2'))
    ])),
    ctx.shell.statePanel({
      title: missing ? _('Требуется движок zapret2') : _('Состояние движка недоступно'),
      message: message,
      kind: missing ? 'warning' : 'error'
    }),
    E('div', { 'class': 'z2m-btnrow z2m-engine-missing-actions' }, installButton(ctx))
  ]);
}
function wrap(module) {
  var core = materialize(module);
  var wrapped = {};
  for (var key in core) wrapped[key] = core[key];
  wrapped.load = function (ctx) { return loadGuarded(core, ctx); };
  wrapped.render = function (ctx) {
    if (!hasEnvelope(ctx)) return core.render ? core.render(ctx) : E('div');
    var gate = object(ctx.data[KEY]);
    return gate.allowed === true && core.render ? core.render(childContext(ctx)) : blocker(core, ctx);
  };
  wrapped.mount = function (ctx) {
    if (!hasEnvelope(ctx)) { if (core.mount) core.mount(ctx); return; }
    var gate = object(ctx.data[KEY]);
    if (gate.allowed === true && core.mount) core.mount(childContext(ctx));
  };
  wrapped.unmount = function (ctx) {
    if (!hasEnvelope(ctx)) { if (core.unmount) core.unmount(ctx); return; }
    var gate = object(ctx.data[KEY]);
    if (gate.allowed === true && core.unmount) core.unmount(childContext(ctx));
  };
  return wrapped;
}

return baseclass.extend({
  wrap: wrap,
  isMissing: isMissing,
  key: KEY
});
