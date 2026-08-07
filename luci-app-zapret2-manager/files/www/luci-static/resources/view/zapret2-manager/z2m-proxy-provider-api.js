'use strict';
'require rpc';
'require baseclass';

var catalog = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_catalog',
  reject: true
});
var status = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_status',
  reject: true
});
var preflight = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_preflight',
  reject: true
});
var checkUpdates = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_check_updates',
  params: ['edit'],
  reject: true
});
var install = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_install',
  params: ['edit'],
  reject: true
});
var remove = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_remove',
  params: ['edit'],
  reject: true
});
var purge = rpc.declare({
  object: 'zapret2-manager-proxy-provider',
  method: 'proxy_provider_purge',
  params: ['edit'],
  reject: true
});

function send(method, value) {
  return method(JSON.stringify(value || {}));
}

return baseclass.extend({
  catalog: catalog,
  status: status,
  preflight: preflight,
  checkUpdates: function () {
    return Promise.all(['rust', 'go'].map(function (provider) {
      return send(checkUpdates, { provider: provider }).then(function (answer) { return answer; }).catch(function (error) {
        return { ok: false, provider: provider, error: error };
      });
    })).then(function (providers) { return { ok: true, providers: providers }; });
  },
  install: function (value) { return send(install, { provider: value.provider, checkToken: value.checkToken }); },
  remove: function () { return send(remove, { confirm: 'REMOVE' }); },
  purge: function () { return send(purge, { confirm: 'PURGE' }); }
});
