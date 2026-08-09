import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', import.meta.url);

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const declarations = [];
  const context = vm.createContext({
    baseclass: { extend: value => value },
    rpc: {
      declare(spec) {
        declarations.push({ object: spec.object, method: spec.method, params: spec.params || [] });
        return (...args) => Promise.resolve({ object: spec.object, method: spec.method, args });
      }
    },
    _: value => value,
    console
  });
  const api = new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
  return { api, declarations };
}

test('declares every RPC required by the frontend foundation', async () => {
  const { declarations } = await loadModule();
  const declared = new Set(declarations.map(item => `${item.object}.${item.method}`));
  const required = [
    'zapret2-manager.status', 'zapret2-manager.start', 'zapret2-manager.stop',
    'zapret2-manager.restart', 'zapret2-manager.passthrough',
    'zapret2-manager.job_get', 'zapret2-manager.job_list',
    'zapret2-manager.dns_get', 'zapret2-manager.dns_set', 'zapret2-manager.dns_validate',
    'zapret2-manager.dns_apply', 'zapret2-manager.dns_check', 'zapret2-manager.dns_rollback',
    'zapret2-manager.dns_restore_auto', 'zapret2-manager.dnsprov_components',
    'zapret2-manager.dnsprov_providers', 'zapret2-manager.dnsprov_diagnose',
    'zapret2-manager.dns_select_provider', 'zapret2-manager.dns_global_get',
    'zapret2-manager.dns_global_set', 'zapret2-manager.dns_global_preview',
    'zapret2-manager.dns_global_apply', 'zapret2-manager.dns_global_rollback',
    'zapret2-manager.service_dns_providers', 'zapret2-manager.service_dns_status',
    'zapret2-manager.service_dns_check', 'zapret2-manager.service_dns_preview',
    'zapret2-manager.service_dns_set', 'zapret2-manager.service_dns_apply',
    'zapret2-manager.service_dns_apply_async', 'zapret2-manager.service_dns_apply_status',
    'zapret2-manager.service_dns_rollback',
    'zapret2-manager.proxy_capabilities', 'zapret2-manager.proxy_status',
    'zapret2-manager.proxy_config_get', 'zapret2-manager.proxy_config_validate',
    'zapret2-manager.proxy_config_preview', 'zapret2-manager.proxy_config_apply',
    'zapret2-manager.proxy_start', 'zapret2-manager.proxy_stop', 'zapret2-manager.proxy_restart',
    'zapret2-manager.proxy_autostart_set', 'zapret2-manager.proxy_secret_rotate',
    'zapret2-manager.proxy_logs_tail', 'zapret2-manager.proxy_health',
    'zapret2-manager.proxy_link_info', 'zapret2-manager.proxy_quick_install',
    'zapret2-manager-proxy-provider.proxy_provider_catalog',
    'zapret2-manager-proxy-provider.proxy_provider_status',
    'zapret2-manager-proxy-provider.proxy_provider_preflight',
    'zapret2-manager-proxy-provider.proxy_provider_check_updates',
    'zapret2-manager-proxy-provider.proxy_provider_install',
    'zapret2-manager-proxy-provider.proxy_provider_remove',
    'zapret2-manager-proxy-provider.proxy_provider_purge',
    'zapret2-manager-monitor.monitor_snapshot',
    'zapret2-manager.versions', 'zapret2-manager.maintenance_status',
    'zapret2-manager.events_tail', 'zapret2-manager.diagnostics_export',
    'zapret2-manager.backup_list', 'zapret2-manager.backup_create',
    'zapret2-manager.backup_restore_preview', 'zapret2-manager.backup_restore',
    'zapret2-manager.backup_delete'
  ];

  for (const method of required) assert.equal(declared.has(method), true, `missing ${method}`);
});

test('exports task-oriented API domains', async () => {
  const { api } = await loadModule();
  for (const domain of ['service', 'jobs', 'dns', 'proxy', 'proxyProvider', 'monitor', 'maintenance']) {
    assert.equal(typeof api[domain], 'object', `missing ${domain}`);
  }
  assert.equal(typeof api.settle, 'function');
  assert.equal(typeof api.capabilities, 'function');
});

test('serializes edit payloads exactly once', async () => {
  const { api } = await loadModule();
  const result = await api.dns.set({ mode: 'doh', primary: 'cloudflare' });
  assert.deepEqual(result.args, ['{"mode":"doh","primary":"cloudflare"}']);
});

test('settle preserves success and transport errors as distinct outcomes', async () => {
  const { api } = await loadModule();
  assert.deepEqual(JSON.parse(JSON.stringify(await api.settle(Promise.resolve({ ok: true })))), {
    value: { ok: true }
  });
  const error = new Error('ubus unavailable');
  const settled = await api.settle(Promise.reject(error));
  assert.equal(settled.error, error);
  assert.equal('value' in settled, false);
});

test('capabilities reports frontend integrations without claiming runtime availability', async () => {
  const { api } = await loadModule();
  assert.deepEqual(JSON.parse(JSON.stringify(api.capabilities())), {
    service: true,
    jobs: true,
    dns: true,
    proxy: true,
    monitoring: true,
    maintenance: true,
    routing: false,
    masque: false
  });
});
