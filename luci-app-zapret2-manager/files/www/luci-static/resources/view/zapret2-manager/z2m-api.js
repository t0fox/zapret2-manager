'use strict';
'require rpc';
'require request';
'require baseclass';
var Z2K_MUTATION_TIMEOUT_MS = 180000;
var Z2K_READ_TIMEOUT_MS = 15000;
var Z2K_PREPARE_POLL_MS = 1000;
var z2kRpcRequestId = 100000;

function z2kRpcError(code, message) {
  var error = new Error(message || 'RPC request failed');
  error.code = code || 'RPCError';
  return error;
}

function z2kParseRpcResponse(response) {
  if (!response || response.ok !== true)
    throw z2kRpcError('RPCError', 'RPC request failed: ' + (response && response.statusText || 'HTTP error'));
  var frames = response.json();
  var frame = Array.isArray(frames) ? frames[0] : frames;
  if (!frame || frame.jsonrpc !== '2.0') throw z2kRpcError('RPCError', 'RPC response frame is invalid');
  if (frame.error) throw z2kRpcError(frame.error.code || 'RPCError', frame.error.message || 'RPC call failed');
  if (!Array.isArray(frame.result) || frame.result.length === 0) throw z2kRpcError('RPCError', 'RPC result is invalid');
  if (frame.result[0] !== 0) throw z2kRpcError('RPCError', rpc.getStatusText(frame.result[0]));
  return frame.result.length > 1 ? frame.result[1] : frame.result[0];
}

function z2kLongMutation(method, params) {
  var message = {
    jsonrpc: '2.0',
    id: ++z2kRpcRequestId,
    method: 'call',
    params: [rpc.getSessionID(), 'zapret2-manager', method, params]
  };
  return request.post(rpc.getBaseURL(), [message], {
    timeout: Z2K_MUTATION_TIMEOUT_MS,
    nobatch: true,
    credentials: true
  }).then(z2kParseRpcResponse);
}

function z2kReadRpc(method, params, timeoutMs) {
  var message = {
    jsonrpc: '2.0',
    id: ++z2kRpcRequestId,
    method: 'call',
    params: [rpc.getSessionID(), 'zapret2-manager', method, params || {}]
  };
  return request.post(rpc.getBaseURL(), [message], {
    timeout: Number(timeoutMs) || Z2K_READ_TIMEOUT_MS,
    nobatch: true,
    credentials: true
  }).then(z2kParseRpcResponse);
}

function z2kPrepareStatus(value) {
  return z2kReadRpc('z2k_prepare_version_status', { operationId: value && value.operationId || value });
}

function z2kPrepareWait(operationId, elapsedMs) {
  return z2kPrepareStatus(operationId).then(function (status) {
    if (!status || status.ok === false) return status;
    if (status.finished === true || status.phase === 'completed' || status.phase === 'failed') {
      if (status.result != null) return status.result;
      return { ok: false, error: status.error || { code: 'EINTERNAL', message: 'Z2K prepare operation finished without a result.' } };
    }
    if (elapsedMs >= 120000)
      return { ok: false, error: { code: 'ETIMEDOUT', message: 'Z2K prepare operation exceeded its bounded wait.' } };
    return new Promise(function (resolve) { setTimeout(resolve, Z2K_PREPARE_POLL_MS); })
      .then(function () { return z2kPrepareWait(operationId, elapsedMs + Z2K_PREPARE_POLL_MS); });
  });
}

function z2kPrepareVersion(value) {
  var requestValue = value && typeof value === 'object' ? { version: value.version } : { version: value };
  if (value && typeof value === 'object' && value.repair === true) requestValue.repair = true;
  return z2kReadRpc('z2k_prepare_version_start', requestValue).then(function (started) {
    if (!started || started.ok === false || started.completed !== true && !started.operationId) return started;
    if (started.completed === true) return started.result != null ? started.result : { ok: false, error: started.error || { code: 'EINTERNAL', message: 'Z2K prepare operation finished without a result.' } };
    return z2kPrepareWait(started.operationId, 0);
  });
}

function z2kRead(method) {
  return z2kReadRpc(method, {});
}

function z2kReadEdit(method, value) {
  return z2kReadRpc(method, { edit: value });
}

function z2kStrategyRead(method, value) {
  var message = {
    jsonrpc: '2.0',
    id: ++z2kRpcRequestId,
    method: 'call',
    params: [rpc.getSessionID(), 'zapret2-manager', method, { edit: value }]
  };
  return request.post(rpc.getBaseURL(), [message], {
    timeout: 120000,
    nobatch: true,
    credentials: true
  }).then(z2kParseRpcResponse);
}

function z2kStrategyList() {
  var message = {
    jsonrpc: '2.0',
    id: ++z2kRpcRequestId,
    method: 'call',
    params: [rpc.getSessionID(), 'zapret2-manager', 'strategies_list', {}]
  };
  return request.post(rpc.getBaseURL(), [message], {
    timeout: 60000,
    nobatch: true,
    credentials: true
  }).then(z2kParseRpcResponse);
}

function z2kVersions(value) {
  if (value && typeof value === 'object' && value.refresh === true) return calls.z2kVersionsRefresh();
  return z2kReadRpc('z2k_versions', {});
}

function z2kStrategyApply(value) {
  return z2kLongMutation('strategies_apply', { edit: value });
}

var calls={
 statusFast:z2kRead.bind(null, 'status_fast'),start:rpc.declare({object:'zapret2-manager',method:'start',reject:true}),stop:rpc.declare({object:'zapret2-manager',method:'stop',reject:true}),restart:rpc.declare({object:'zapret2-manager',method:'restart',reject:true}),
 catalogList:rpc.declare({object:'zapret2-manager',method:'catalog_list',reject:true}),
 domainHubGet:rpc.declare({object:'zapret2-manager-domain-hub',method:'domain_hub_get',reject:true}),domainHubApply:rpc.declare({object:'zapret2-manager-domain-hub',method:'domain_hub_apply',params:['edit'],reject:true}),

  strategiesList:z2kStrategyList,strategiesRecommendations:rpc.declare({object:'zapret2-manager',method:'strategies_recommendations',reject:true, timeout: 60}),strategiesGet:z2kStrategyRead.bind(null, 'strategies_get'),strategiesDiscordDonor:rpc.declare({object:'zapret2-manager',method:'strategies_discord_donor',params:['edit'],reject:true, timeout: 120}),strategiesCreate:rpc.declare({object:'zapret2-manager',method:'strategies_create',params:['edit'],reject:true}),strategiesUpdate:rpc.declare({object:'zapret2-manager',method:'strategies_update',params:['edit'],reject:true}),strategiesDelete:rpc.declare({object:'zapret2-manager',method:'strategies_delete',params:['edit'],reject:true}),strategiesDuplicate:rpc.declare({object:'zapret2-manager',method:'strategies_duplicate',params:['edit'],reject:true}),strategiesFavorite:rpc.declare({object:'zapret2-manager',method:'strategies_favorite',params:['edit'],reject:true}),strategiesPreview:z2kStrategyRead.bind(null, 'strategies_preview'),strategiesValidate:z2kStrategyRead.bind(null, 'strategies_validate'),strategiesApply:z2kStrategyApply,strategiesCatalogStatus:z2kRead.bind(null, 'strategies_catalog_status'),strategiesCatalogReload:rpc.declare({object:'zapret2-manager',method:'strategies_catalog_reload',reject:true, timeout: 60}),z2kDetectStatus:rpc.declare({object:'zapret2-manager',method:'z2k_detect_status',reject:true}),z2kDetectProbe:rpc.declare({object:'zapret2-manager',method:'z2k_detect_probe',params:['domain','timeoutMs'],reject:true}),z2kDetectClassify:rpc.declare({object:'zapret2-manager',method:'z2k_detect_classify',params:['host','port','hello','repeats','timeoutMs'],reject:true}),z2kDetectQuic:rpc.declare({object:'zapret2-manager',method:'z2k_detect_quic',params:['domain','port','repeats','timeoutMs'],reject:true}),z2kDetectVoice:rpc.declare({object:'zapret2-manager',method:'z2k_detect_voice',params:['repeats','timeoutMs'],reject:true}),z2kDetectTcp16:rpc.declare({object:'zapret2-manager',method:'z2k_detect_tcp16',params:['timeoutMs'],reject:true}),z2kDetectDiscoveryStatus:rpc.declare({object:'zapret2-manager',method:'z2k_detect_discovery_status',reject:true}),z2kDetectDiscoveryEnable:rpc.declare({object:'zapret2-manager',method:'z2k_detect_discovery_enable',params:['dnsSource'],reject:true}),z2kDetectDiscoveryDisable:rpc.declare({object:'zapret2-manager',method:'z2k_detect_discovery_disable',params:['dnsSource'],reject:true}),z2kDetectDiscoveryRestart:rpc.declare({object:'zapret2-manager',method:'z2k_detect_discovery_restart',params:['dnsSource'],reject:true}),
  assetsList:rpc.declare({object:'zapret2-manager',method:'assets_list',reject:true}),assetsContent:rpc.declare({object:'zapret2-manager',method:'assets_content',params:['edit'],reject:true}),assetsValidateContent:rpc.declare({object:'zapret2-manager',method:'assets_validate_content',params:['edit'],reject:true}),assetsImport:rpc.declare({object:'zapret2-manager',method:'assets_import',params:['edit'],reject:true}),assetsImportUrl:rpc.declare({object:'zapret2-manager',method:'assets_import_url',params:['edit'],reject:true}),assetsAsn:rpc.declare({object:'zapret2-manager',method:'assets_asn',params:['edit'],reject:true}),assetsUpdate:rpc.declare({object:'zapret2-manager',method:'assets_update',params:['edit'],reject:true}),assetsDelete:rpc.declare({object:'zapret2-manager',method:'assets_delete',params:['edit'],reject:true}),resourcesStatus:rpc.declare({object:'zapret2-manager',method:'resources_status',reject:true}),resourcesCheck:rpc.declare({object:'zapret2-manager',method:'resources_check',reject:true}),resourcesUpdate:function(value){return z2kLongMutation('resources_update', { edit: value });},resourcesUpdateStatus:rpc.declare({object:'zapret2-manager',method:'resources_update_status',params:['operationId'],reject:true}),z2kVersions:z2kVersions,z2kVersionsRefresh:rpc.declare({object:'zapret2-manager',method:'z2k_versions_refresh',reject:true, timeout: 60}),z2kVersionDetails:rpc.declare({object:'zapret2-manager',method:'z2k_version_details',params:['version','includeCompare'],reject:true}),
 dnsSet:rpc.declare({object:'zapret2-manager',method:'dns_set',params:['edit'],reject:true}),dnsApply:rpc.declare({object:'zapret2-manager',method:'dns_apply',params:['edit'],reject:true}),dnsCheck:rpc.declare({object:'zapret2-manager',method:'dns_check',params:['edit'],reject:true}),dnsRollback:rpc.declare({object:'zapret2-manager',method:'dns_rollback',reject:true}),dnsGlobalGet:rpc.declare({object:'zapret2-manager',method:'dns_global_get',reject:true}),dnsGlobalSet:rpc.declare({object:'zapret2-manager',method:'dns_global_set',params:['edit'],reject:true}),dnsGlobalApply:rpc.declare({object:'zapret2-manager',method:'dns_global_apply',reject:true}),dnsProductGet:rpc.declare({object:'zapret2-manager',method:'dns_product_get',reject:true}),dnsProductProviderSave:rpc.declare({object:'zapret2-manager',method:'dns_product_provider_save',params:['edit'],reject:true}),dnsProductProviderReset:rpc.declare({object:'zapret2-manager',method:'dns_product_provider_reset',params:['edit'],reject:true}),dnsProductProviderDelete:rpc.declare({object:'zapret2-manager',method:'dns_product_provider_delete',params:['edit'],reject:true}),dnsProductStatus:rpc.declare({object:'zapret2-manager',method:'dns_product_status',reject:true}),dnsProductValidate:rpc.declare({object:'zapret2-manager',method:'dns_product_validate',params:['edit'],reject:true}),dnsprovComponents:rpc.declare({object:'zapret2-manager',method:'dnsprov_components',reject:true}),dnsprovDiagnose:rpc.declare({object:'zapret2-manager',method:'dnsprov_diagnose',params:['edit'],reject:true}),dnsSelectProvider:rpc.declare({object:'zapret2-manager',method:'dns_select_provider',params:['edit'],reject:true}),
serviceDnsStatus:rpc.declare({object:'zapret2-manager',method:'service_dns_status',reject:true}),serviceDnsSet:rpc.declare({object:'zapret2-manager',method:'service_dns_set',params:['edit'],reject:true}),serviceDnsApply:rpc.declare({object:'zapret2-manager',method:'service_dns_apply',params:['edit'],reject:true}),serviceDnsApplyStatus:rpc.declare({object:'zapret2-manager',method:'service_dns_apply_status',params:['edit'],reject:true}),serviceDnsTiktokSetAsync:rpc.declare({object:'zapret2-manager',method:'service_dns_tiktok_set_async',params:['edit'],reject:true}),serviceDnsTiktokStatus:rpc.declare({object:'zapret2-manager',method:'service_dns_tiktok_status',reject:true}),serviceDnsTiktokCheck:rpc.declare({object:'zapret2-manager',method:'service_dns_tiktok_check',reject:true}),serviceDnsRollback:rpc.declare({object:'zapret2-manager',method:'service_dns_rollback',reject:true}),
 proxyCapabilities:rpc.declare({object:'zapret2-manager',method:'proxy_capabilities',reject:true, timeout: 60}),proxyStatus:z2kRead.bind(null, 'proxy_status'),proxyConfigGet:rpc.declare({object:'zapret2-manager',method:'proxy_config_get',reject:true}),proxyConfigValidate:rpc.declare({object:'zapret2-manager',method:'proxy_config_validate',params:['edit'],reject:true}),proxyConfigPreview:rpc.declare({object:'zapret2-manager',method:'proxy_config_preview',params:['edit'],reject:true}),proxyConfigApply:rpc.declare({object:'zapret2-manager',method:'proxy_config_apply',params:['edit'],reject:true}),proxySecretRotate:rpc.declare({object:'zapret2-manager',method:'proxy_secret_rotate',reject:true}),proxyHealth:z2kReadEdit.bind(null, 'proxy_health'),proxyLinkInfo:rpc.declare({object:'zapret2-manager',method:'proxy_link_info',params:['edit'],reject:true}),
 tgProductCatalog:rpc.declare({object:'zapret2-manager',method:'tg_product_catalog',reject:true, timeout: 60}),tgProductVersions:rpc.declare({object:'zapret2-manager',method:'tg_product_versions',reject:true, timeout: 60}),tgProductStatus:rpc.declare({object:'zapret2-manager',method:'tg_product_status',reject:true, timeout: 60}),tgProductOperationStatus:rpc.declare({object:'zapret2-manager',method:'tg_product_operation_status',params:['edit'],reject:true}),tgProductCheckUpdates:rpc.declare({object:'zapret2-manager',method:'tg_product_check_updates',params:['edit'],reject:true}),tgProductSwitch:rpc.declare({object:'zapret2-manager',method:'tg_product_switch',params:['edit'],reject:true}),tgProductRemove:rpc.declare({object:'zapret2-manager',method:'tg_product_remove',params:['edit'],reject:true}),tgProductPurge:rpc.declare({object:'zapret2-manager',method:'tg_product_purge',params:['edit'],reject:true}),tgProductStart:rpc.declare({object:'zapret2-manager',method:'tg_product_start',reject:true}),tgProductStop:rpc.declare({object:'zapret2-manager',method:'tg_product_stop',reject:true}),tgProductRestart:rpc.declare({object:'zapret2-manager',method:'tg_product_restart',reject:true}),
 versions:rpc.declare({object:'zapret2-manager',method:'versions',reject:true, timeout: 60}),maintenanceStatus:rpc.declare({object:'zapret2-manager',method:'maintenance_status',reject:true, timeout: 60}),backupList:rpc.declare({object:'zapret2-manager',method:'backup_list',reject:true}),backupCreate:rpc.declare({object:'zapret2-manager',method:'backup_create',params:['edit'],reject:true}),backupRestorePreview:rpc.declare({object:'zapret2-manager',method:'backup_restore_preview',params:['edit'],reject:true}),backupRestore:rpc.declare({object:'zapret2-manager',method:'backup_restore',params:['edit'],reject:true}),backupDelete:rpc.declare({object:'zapret2-manager',method:'backup_delete',params:['edit'],reject:true}),eventsTail:z2kReadEdit.bind(null, 'events_tail'),diagnosticsExport:rpc.declare({object:'zapret2-manager',method:'diagnostics_export',reject:true})
};
calls.strategiesState=rpc.declare({object:'zapret2-manager',method:'strategies_state',reject:true, timeout: 60});
calls.strategiesStateSet=rpc.declare({object:'zapret2-manager',method:'strategies_state_set',params:['edit'],reject:true});
calls.strategiesPools=rpc.declare({object:'zapret2-manager',method:'strategies_pools',reject:true, timeout: 60});
calls.strategiesCatalogUpdate=rpc.declare({object:'zapret2-manager',method:'strategies_catalog_update',params:['edit'],reject:true, timeout: 60});
calls.strategiesCatalogRefreshStart=rpc.declare({object:'zapret2-manager',method:'strategies_catalog_refresh_start',reject:true, timeout: 30});
calls.strategiesCatalogRefreshStatus=rpc.declare({object:'zapret2-manager',method:'strategies_catalog_refresh_status',reject:true, timeout: 30});
calls.strategiesSourcesGet=rpc.declare({object:'zapret2-manager',method:'strategies_sources_get',reject:true, timeout: 60});
calls.strategiesSourceRefresh=rpc.declare({object:'zapret2-manager',method:'strategies_source_refresh',params:['sourceId'],reject:true, timeout: 60});
calls.strategiesSourceSetEnabled=rpc.declare({object:'zapret2-manager',method:'strategies_source_set_enabled',params:['edit'],reject:true, timeout: 60});
calls.strategiesStateClear=rpc.declare({object:'zapret2-manager',method:'strategies_state_clear',params:['edit'],reject:true});
calls.healthcheckStatus=rpc.declare({object:'zapret2-manager',method:'healthcheck_status',reject:true, timeout: 60});
calls.healthcheckRun=rpc.declare({object:'zapret2-manager',method:'healthcheck_run',params:['edit'],reject:true});
calls.healthcheckEnable=rpc.declare({object:'zapret2-manager',method:'healthcheck_enable',params:['edit'],reject:true});
calls.healthcheckDisable=rpc.declare({object:'zapret2-manager',method:'healthcheck_disable',params:['edit'],reject:true});
calls.healthcheckConfig=rpc.declare({object:'zapret2-manager',method:'healthcheck_config',params:['edit'],reject:true});
var engineObject='zapret2-manager'+'-engine',engineCalls={};
function engineCall(method,value){var key=method+(value==null?':read':':edit'),call=engineCalls[key];if(!call){call=rpc.declare({object:engineObject,method:method,params:value==null?undefined:['edit'],reject:true, timeout: value==null ? 60 : undefined});engineCalls[key]=call;}return value==null?call():call(JSON.stringify(value));}
function bounded(value, limit) { var text = value == null ? '' : String(value); return text.length > limit ? text.slice(0, limit) + '…' : text; }
function formatErrorDetails(err, code, raw) {
  if (!err) return raw || code || null;
  if (typeof err === 'string') return err;
  var detailObj = {};
  if (err.name) detailObj.name = String(err.name);
  if (err.message) detailObj.message = String(err.message);
  if (err.code || code) detailObj.code = err.code || code;
  if (err.object) detailObj.object = err.object;
  if (err.method) detailObj.method = err.method;
  if (err.data !== undefined) detailObj.data = err.data;
  if (err.cause) detailObj.cause = typeof err.cause === 'object' ? (err.cause.message || String(err.cause)) : String(err.cause);
  if (err.stack) detailObj.stack = String(err.stack);
  if (typeof err === 'object') {
    Object.keys(err).forEach(function(k) {
      if (detailObj[k] === undefined && err[k] !== undefined) {
        detailObj[k] = err[k];
      }
    });
  }
  try {
    var serialized = JSON.stringify(detailObj, null, 2);
    if (serialized && serialized !== '{}') return serialized;
  } catch (e) {}
  return raw || (err.message ? String(err.message) : String(err));
}
function normalizeError(error){
 var outer=error&&typeof error==='object'?error:{}, value=outer.error!=null?outer.error:error, code='', raw='';
 if (typeof value==='string') raw=value;
 else if (value&&typeof value==='object') { code=String(value.code||outer.code||'error'); raw=String(value.message||value.detail||outer.message||outer.detail||''); }
 else raw=value==null?'':String(value);
 code=code||String(outer.code||'error');
 var hay=(code+' '+raw).toLowerCase(), kind='backend_error', message=_('Backend вернул ошибку.'), retryable=false;
 if (code === 'ECHECK_STALE') { kind='check_stale'; message=_('Данные проверки устарели. Проверьте обновления ещё раз.'); retryable=true; }
 else if (code === 'EUPDATE_NOT_AVAILABLE') { kind='update_not_available'; message=_('Обновление уже не требуется.'); retryable=false; }
 else if (code === 'EZ2K_REVIEW_REQUIRED') { kind='update_blocked_review'; message=_('Обновление заблокировано до проверки upstream-изменений.'); retryable=false; }
 else if (code === 'EZ2K_REBASE_REQUIRED') { kind='update_blocked_rebase'; message=_('Обновление заблокировано до адаптации upstream-изменений.'); retryable=false; }
 else if (code === 'ECONFLICT') { kind='revision_conflict'; message=_('Каталог изменился. Обновите данные и повторите действие.'); retryable=true; }
 else if (code === 'EDEPENDENCY') { kind='dependency_blocked'; message=_('Действие остановлено: провайдер используется конфигурацией.'); retryable=false; }
 else if (code === 'EWRITE') { kind='backend_io'; message=_('Каталог не сохранён: backend не смог записать overlay.'); retryable=true; }
 else if (code === 'EINPUT') { kind='request_rejected'; message=raw || _('Запрос отклонён backend. Проверьте введённые данные.'); retryable=false; }
 else if (/not.?installed|component.?missing|package.?missing|enoent/.test(hay)) { kind='component_not_installed'; message=_('Компонент не установлен.'); retryable=false; }
 else if (/provider|backend provider/.test(hay) && /unavailable|missing|not found|object not found|disabled/.test(hay)) { kind='provider_unavailable'; message=_('Backend provider недоступен.'); retryable=true; }
 else if (/dependency|epref|eprobe|missing dependency|requires/.test(hay)) { kind='dependency_unavailable'; message=_('Зависимость недоступна.'); retryable=true; }
 else if (/object not found|method not found|no such object|no such method|classconstructor|\brpc\b|\bubus\b|eobject|-3200/.test(hay)) { kind='rpc_unavailable'; message=_('RPC-компонент недоступен.'); retryable=true; }
 else if (/malformed|schema|invalid response|parse error|unexpected response/.test(hay)) { kind='malformed_response'; message=_('Backend вернул некорректный ответ.'); retryable=false; }
 else if (/reject|invalid input|validation|bad request|einput/.test(hay)) { kind='request_rejected'; message=_('Запрос отклонён. Проверьте введённые данные.'); retryable=false; }
 else if (code === 'frontend-timeout' || code === 'ETIMEDOUT' || code === 'ETIMEOUT') { kind='backend_timeout'; message=_('Backend не ответил в отведённое время.'); retryable=true; }
 else if (/session|auth|login|expired|401|403/.test(hay)) { kind='session_failure'; message=_('Сеанс LuCI недоступен или требует повторной авторизации.'); retryable=true; }
 else if (/network|timeout|timed.?out|offline|connection|transport|fetch|xhr|http error/.test(hay)) { kind='backend_transport'; message=_('Backend RPC не ответил или транспорт недоступен.'); retryable=true; }
 else if (value instanceof Error || (typeof value === 'object' && value.stack)) { kind='frontend_error'; message=value.message ? String(value.message) : _('Ошибка интерфейса.'); }
 if (kind === 'backend_error' && raw) message = raw;
 var details=bounded(formatErrorDetails(value && typeof value === 'object' ? value : outer, code, raw), 1200);
 var errors = value && typeof value === 'object' && value.errors !== undefined ? value.errors : outer.errors;
 var dependencies = value && typeof value === 'object' && value.dependencies !== undefined ? value.dependencies : outer.dependencies;
 var expectedRevision = value && typeof value === 'object' && value.expectedRevision !== undefined ? value.expectedRevision : outer.expectedRevision;
 var actualRevision = value && typeof value === 'object' && value.actualRevision !== undefined ? value.actualRevision : outer.actualRevision;
 var rollback = value && typeof value === 'object' && value.rollback !== undefined ? value.rollback : outer.rollback;
 return { code:code, kind:kind, message:message, retryable:retryable, technical:bounded(raw, 320), details:details, errors:errors, dependencies:dependencies, expectedRevision:expectedRevision, actualRevision:actualRevision, rollback:rollback };
}
function tgEdit(method, value) { return method(JSON.stringify(value || {})); }
function tgCheckUpdates(selection) {
 if (selection && selection.provider)
  return tgEdit(calls.tgProductCheckUpdates, selection);
 return Promise.resolve({ok:false, error:{code:'EINPUT', message:'provider required'}});
}
 return baseclass.extend({
  normalizeError:normalizeError,
  service:{statusFast:calls.statusFast,start:calls.start,stop:calls.stop,restart:calls.restart},
  z2kDetectStatus:calls.z2kDetectStatus,z2kDetectProbe:calls.z2kDetectProbe,z2kDetectClassify:calls.z2kDetectClassify,z2kDetectQuic:calls.z2kDetectQuic,z2kDetectVoice:calls.z2kDetectVoice,z2kDetectTcp16:calls.z2kDetectTcp16,z2kDetectDiscoveryStatus:calls.z2kDetectDiscoveryStatus,z2kDetectDiscoveryEnable:calls.z2kDetectDiscoveryEnable,z2kDetectDiscoveryDisable:calls.z2kDetectDiscoveryDisable,z2kDetectDiscoveryRestart:calls.z2kDetectDiscoveryRestart,
  strategies:{list:calls.strategiesList,recommendations:calls.strategiesRecommendations,get:calls.strategiesGet,discordDonor:calls.strategiesDiscordDonor,create:calls.strategiesCreate,update:calls.strategiesUpdate,delete:calls.strategiesDelete,duplicate:calls.strategiesDuplicate,favorite:calls.strategiesFavorite,preview:calls.strategiesPreview,validate:calls.strategiesValidate,apply:calls.strategiesApply,catalogStatus:calls.strategiesCatalogStatus,catalogReload:calls.strategiesCatalogReload,catalogUpdate:calls.strategiesCatalogUpdate,catalogRefreshStart:calls.strategiesCatalogRefreshStart,catalogRefreshStatus:calls.strategiesCatalogRefreshStatus,sourcesGet:calls.strategiesSourcesGet,sourceRefresh:calls.strategiesSourceRefresh,sourceSetEnabled:calls.strategiesSourceSetEnabled,learnedState:calls.strategiesState,learnedReset:calls.strategiesStateClear,stateSet:calls.strategiesStateSet,pools:calls.strategiesPools},
  healthcheck:{status:calls.healthcheckStatus,run:calls.healthcheckRun,enable:calls.healthcheckEnable,disable:calls.healthcheckDisable,config:calls.healthcheckConfig},


 domainHub:{get:calls.domainHubGet,apply:calls.domainHubApply},
  services:{catalogList:calls.catalogList},
   assets:{list:calls.assetsList,content:calls.assetsContent,validateContent:calls.assetsValidateContent,import:calls.assetsImport,importUrl:calls.assetsImportUrl,asn:calls.assetsAsn,update:calls.assetsUpdate,delete:calls.assetsDelete},
  resources:{status:calls.resourcesStatus,check:calls.resourcesCheck,update:calls.resourcesUpdate,updateStatus:function(value){return calls.resourcesUpdateStatus(value&&value.operationId||value);},versions:z2kVersions,versionDetails:function(value){return value&&typeof value==='object'?calls.z2kVersionDetails(value.version,value.includeCompare):calls.z2kVersionDetails(value);},prepareVersion:z2kPrepareVersion},
  dns:{set:calls.dnsSet,apply:calls.dnsApply,check:calls.dnsCheck,rollback:calls.dnsRollback,global:{get:calls.dnsGlobalGet,set:calls.dnsGlobalSet,apply:calls.dnsGlobalApply},product:{get:calls.dnsProductGet,providerSave:calls.dnsProductProviderSave,providerReset:calls.dnsProductProviderReset,providerDelete:calls.dnsProductProviderDelete,status:calls.dnsProductStatus,validate:calls.dnsProductValidate},components:calls.dnsprovComponents,diagnose:calls.dnsprovDiagnose,selectProvider:calls.dnsSelectProvider,serviceStatus:calls.serviceDnsStatus,serviceSet:calls.serviceDnsSet,serviceApply:calls.serviceDnsApply,serviceApplyStatus:calls.serviceDnsApplyStatus,serviceTiktokSetAsync:calls.serviceDnsTiktokSetAsync,serviceTiktokStatus:calls.serviceDnsTiktokStatus,serviceTiktokCheck:calls.serviceDnsTiktokCheck,serviceRollback:calls.serviceDnsRollback},
 proxy:{capabilities:calls.proxyCapabilities,status:calls.proxyStatus,configGet:calls.proxyConfigGet,configValidate:calls.proxyConfigValidate,configPreview:calls.proxyConfigPreview,configApply:calls.proxyConfigApply,secretRotate:calls.proxySecretRotate,health:calls.proxyHealth,linkInfo:calls.proxyLinkInfo},
  tg:{product:{catalog:calls.tgProductCatalog,versions:calls.tgProductVersions,status:calls.tgProductStatus,operationStatus:function(value){return tgEdit(calls.tgProductOperationStatus,value || {});},checkUpdates:tgCheckUpdates,switch:function(value){return tgEdit(calls.tgProductSwitch,value);},remove:function(value){return tgEdit(calls.tgProductRemove,value);},purge:function(value){return tgEdit(calls.tgProductPurge,value);},start:calls.tgProductStart,stop:calls.tgProductStop,restart:calls.tgProductRestart}},
 maintenance:{versions:calls.versions,status:calls.maintenanceStatus,backupList:calls.backupList,backupCreate:calls.backupCreate,backupPreview:calls.backupRestorePreview,backupRestore:calls.backupRestore,backupDelete:calls.backupDelete,eventsTail:calls.eventsTail,diagnosticsExport:calls.diagnosticsExport},
  engine:{releases:function(value){return engineCall('engine_releases',value);},status:function(){return engineCall('engine_status',null);},gateStatus:function(){return engineCall('engine_gate_status',null);},check:function(value){return engineCall('engine_check',value);},install:function(value){return engineCall('engine_install',value);},update:function(value){return engineCall('engine_update',value);},reinstall:function(value){return engineCall('engine_reinstall',value);},uninstall:function(value){return engineCall('engine_uninstall',value);},operationStatus:function(value){return engineCall('engine_operation_status',value||{});},operationCancel:function(value){return engineCall('engine_operation_cancel',value);}}
});
