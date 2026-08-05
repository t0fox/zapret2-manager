import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const UI_FILES = [
  'orchestra-strategy.js', 'orchestra.js', 'strategies.js', 'lists.js',
  'dns.js', 'monitor.js', 'proxy.js', 'maintenance.js'
];

export const UI_CONTRACT = {
  'orchestra-strategy.js': ['discord_profile_apply','discord_profile_preview','discord_profile_rollback','orchestra_run_history','orchestra_run_start','orchestra_run_status','start','status','stop'],
  'orchestra.js': ['catalog_apply','catalog_get','catalog_list','catalog_preview','catalog_status','health_matrix_get','orchestra_apply_best','orchestra_apply_status','orchestra_auto_disable','orchestra_auto_enable','orchestra_auto_restore','orchestra_auto_run','orchestra_auto_status','orchestra_auto_stop','orchestra_capabilities','orchestra_catalog','orchestra_corpus_get','orchestra_events','orchestra_history','orchestra_preview_best','orchestra_probe_preflight','orchestra_ratings_get','orchestra_restore_previous','orchestra_run_continue','orchestra_run_history','orchestra_run_pause','orchestra_run_resume','orchestra_run_start','orchestra_run_status','orchestra_run_stop','orchestra_status','status'],
  'strategies.js': ['confirm_alive','passthrough','profiles_apply','profiles_clone','profiles_create','profiles_delete','profiles_import_applied','profiles_list','profiles_update','profiles_validate','rollback','status'],
  'lists.js': ['lists_check_domain','lists_get','lists_set'],
  'dns.js': ['dns_apply','dns_check','dns_get','dns_restore_auto','dns_rollback','dns_select_provider','dns_set','dns_validate','dnsprov_components','dnsprov_diagnose','dnsprov_providers','service_dns_apply','service_dns_apply_async','service_dns_apply_status','service_dns_preview','service_dns_providers','service_dns_rollback','service_dns_set','service_dns_status'],
  'monitor.js': ['status'],
  'proxy.js': ['proxy_autostart_set','proxy_capabilities','proxy_config_apply','proxy_config_get','proxy_config_preview','proxy_config_validate','proxy_health','proxy_link_info','proxy_logs_tail','proxy_quick_install','proxy_restart','proxy_secret_rotate','proxy_start','proxy_status','proxy_stop'],
  'maintenance.js': ['backup_create','backup_delete','backup_list','backup_restore','backup_restore_preview','diagnostics_export','events_tail','maintenance_status','versions']
};

export function extractRpcMethods(source) {
  return [...source.matchAll(/method\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

function viewBase(root) {
  return resolve(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
}

export function collectFacadeMethods(root = process.cwd()) {
  return extractRpcMethods(readFileSync(resolve(viewBase(root), 'z2m-api.js'), 'utf8'));
}

export function collectUiContract(root = process.cwd()) {
  const base = viewBase(root);
  const facade = resolve(base, 'z2m-api.js');
  if (existsSync(facade)) {
    const methods = new Set(extractRpcMethods(readFileSync(facade, 'utf8')));
    return Object.fromEntries(Object.entries(UI_CONTRACT).map(([name, expected]) => [
      name, expected.filter((method) => methods.has(method)).sort()
    ]));
  }
  return Object.fromEntries(UI_FILES.map((name) => [
    name, extractRpcMethods(readFileSync(resolve(base, name), 'utf8'))
  ]));
}

if (process.argv.includes('--write')) {
  writeFileSync(resolve('tests/fixtures/ui-rpc-contract.json'), JSON.stringify(collectUiContract(), null, 2) + '\n');
}
