'use strict';
'require rpc';
'require baseclass';

function call(object, method, params) {
  return rpc.declare({ object: object, method: method, params: params, reject: true });
}

function read(object, method) {
  var invoke = call(object, method);
  return function () { return invoke(); };
}

function edit(object, method) {
  var invoke = call(object, method, ['edit']);
  return function (value) { return invoke(JSON.stringify(value || {})); };
}

function settle(promise) {
  return Promise.resolve(promise).then(function (value) { return { value: value }; }, function (error) { return { error: error }; });
}

var service = {
  status: read('zapret2-manager', 'status'),
  start: read('zapret2-manager', 'start'),
  stop: read('zapret2-manager', 'stop'),
  restart: read('zapret2-manager', 'restart'),
  passthrough: call('zapret2-manager', 'passthrough', ['enabled'])
};

var jobs = {
  get: edit('zapret2-manager', 'job_get'),
  list: read('zapret2-manager', 'job_list')
};

var dns = {
  get: read('zapret2-manager', 'dns_get'),
  set: edit('zapret2-manager', 'dns_set'),
  validate: edit('zapret2-manager', 'dns_validate'),
  apply: edit('zapret2-manager', 'dns_apply'),
  check: edit('zapret2-manager', 'dns_check'),
  rollback: read('zapret2-manager', 'dns_rollback'),
  restoreAuto: read('zapret2-manager', 'dns_restore_auto'),
  components: read('zapret2-manager', 'dnsprov_components'),
  providers: read('zapret2-manager', 'dnsprov_providers'),
  diagnose: edit('zapret2-manager', 'dnsprov_diagnose'),
  selectProvider: edit('zapret2-manager', 'dns_select_provider'),
  globalGet: read('zapret2-manager', 'dns_global_get'),
  globalSet: edit('zapret2-manager', 'dns_global_set'),
  globalPreview: read('zapret2-manager', 'dns_global_preview'),
  globalApply: read('zapret2-manager', 'dns_global_apply'),
  globalRollback: read('zapret2-manager', 'dns_global_rollback'),
  serviceProviders: read('zapret2-manager', 'service_dns_providers'),
  serviceStatus: read('zapret2-manager', 'service_dns_status'),
  serviceCheck: read('zapret2-manager', 'service_dns_check'),
  servicePreview: read('zapret2-manager', 'service_dns_preview'),
  serviceSet: edit('zapret2-manager', 'service_dns_set'),
  serviceApply: edit('zapret2-manager', 'service_dns_apply'),
  serviceApplyAsync: edit('zapret2-manager', 'service_dns_apply_async'),
  serviceApplyStatus: edit('zapret2-manager', 'service_dns_apply_status'),
  serviceRollback: read('zapret2-manager', 'service_dns_rollback')
};

var proxy = {
  capabilities: read('zapret2-manager', 'proxy_capabilities'),
  status: read('zapret2-manager', 'proxy_status'),
  configGet: read('zapret2-manager', 'proxy_config_get'),
  configValidate: edit('zapret2-manager', 'proxy_config_validate'),
  configPreview: edit('zapret2-manager', 'proxy_config_preview'),
  configApply: edit('zapret2-manager', 'proxy_config_apply'),
  start: read('zapret2-manager', 'proxy_start'),
  stop: read('zapret2-manager', 'proxy_stop'),
  restart: read('zapret2-manager', 'proxy_restart'),
  autostartSet: edit('zapret2-manager', 'proxy_autostart_set'),
  secretRotate: read('zapret2-manager', 'proxy_secret_rotate'),
  logsTail: edit('zapret2-manager', 'proxy_logs_tail'),
  health: edit('zapret2-manager', 'proxy_health'),
  linkInfo: edit('zapret2-manager', 'proxy_link_info'),
  quickInstall: read('zapret2-manager', 'proxy_quick_install')
};

var proxyProvider = {
  catalog: read('zapret2-manager-proxy-provider', 'proxy_provider_catalog'),
  status: read('zapret2-manager-proxy-provider', 'proxy_provider_status'),
  preflight: read('zapret2-manager-proxy-provider', 'proxy_provider_preflight'),
  checkUpdates: edit('zapret2-manager-proxy-provider', 'proxy_provider_check_updates'),
  install: edit('zapret2-manager-proxy-provider', 'proxy_provider_install'),
  remove: edit('zapret2-manager-proxy-provider', 'proxy_provider_remove'),
  purge: edit('zapret2-manager-proxy-provider', 'proxy_provider_purge')
};

var monitor = {
  snapshot: edit('zapret2-manager-monitor', 'monitor_snapshot'),
  status: service.status,
  eventsTail: edit('zapret2-manager', 'events_tail')
};

var maintenance = {
  versions: read('zapret2-manager', 'versions'),
  status: read('zapret2-manager', 'maintenance_status'),
  eventsTail: edit('zapret2-manager', 'events_tail'),
  diagnosticsExport: read('zapret2-manager', 'diagnostics_export'),
  backupList: read('zapret2-manager', 'backup_list'),
  backupCreate: edit('zapret2-manager', 'backup_create'),
  backupPreview: edit('zapret2-manager', 'backup_restore_preview'),
  backupRestore: edit('zapret2-manager', 'backup_restore'),
  backupDelete: edit('zapret2-manager', 'backup_delete')
};

function capabilities() {
  return {
    service: true,
    jobs: true,
    dns: true,
    proxy: true,
    monitoring: true,
    maintenance: true,
    routing: false,
    masque: false
  };
}

return baseclass.extend({
  settle: settle,
  capabilities: capabilities,
  service: service,
  jobs: jobs,
  dns: dns,
  proxy: proxy,
  proxyProvider: proxyProvider,
  monitor: monitor,
  maintenance: maintenance
});
