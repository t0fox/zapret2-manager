#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const host = process.env.Z2M_ROUTER || 'root@192.168.1.1';
const rounds = Math.max(1, Number(process.env.Z2M_PERF_ROUNDS || 3));
const fanout = Math.max(1, Number(process.env.Z2M_PERF_FANOUT || 4));
const timeoutMs = Math.max(1000, Number(process.env.Z2M_PERF_TIMEOUT_MS || 30000));
const scenarioArg = [...args].find((value) => value.startsWith('--scenario='));
const requestedScenario = scenarioArg ? scenarioArg.slice('--scenario='.length) : 'legacy';
const mutationAllowed = process.env.Z2M_PERF_ALLOW_MUTATION === '1';
const dnsBootstrapProfile = process.env.Z2M_PERF_DNS_BOOTSTRAP || 'after';
const strategyId = process.env.Z2M_PERF_STRATEGY_ID || 'z2k:z2k_all_in_one';
const catalogDigest = process.env.Z2M_PERF_CATALOG_DIGEST ||
  '70c80982d955f72ed16d4cbb48abf809092f1e39cd09be8d0a537e4da8e93fff';

function editPayload(value = {}) {
  return JSON.stringify({ edit: JSON.stringify(value) });
}

function rpc(method, options = {}) {
  return {
    method,
    object: options.object || 'zapret2-manager',
    payload: options.payload,
    canonicalOwner: options.canonicalOwner || `${options.object || 'zapret2-manager'}.${method}`,
    rpcName: `${options.object || 'zapret2-manager'}.${method}`,
    timeout: options.timeout || timeoutMs,
  };
}

const calls = {
  statusFast: rpc('status_fast', { canonicalOwner: 'runtime.status_fast' }),
  status: rpc('status', { canonicalOwner: 'runtime.status' }),
  strategiesList: rpc('strategies_list', { canonicalOwner: 'strategies.list' }),
  strategiesCatalogStatus: rpc('strategies_catalog_status', { canonicalOwner: 'strategies.catalog-status' }),
  strategiesRecommendations: rpc('strategies_recommendations', { canonicalOwner: 'strategies.recommendations', timeout: 60000 }),
  strategiesGet: rpc('strategies_get', {
    payload: editPayload({ id: strategyId }),
    canonicalOwner: 'strategies.active',
    timeout: 120000,
  }),
  strategiesPreview: rpc('strategies_preview', {
    payload: editPayload({ strategy_id: strategyId, revision: 0, catalog_digest: catalogDigest }),
    canonicalOwner: 'strategies.preview',
    timeout: 120000,
  }),
  strategiesValidate: rpc('strategies_validate', {
    payload: editPayload({ strategy_id: strategyId, revision: 0, catalog_digest: catalogDigest }),
    canonicalOwner: 'strategies.validate',
    timeout: 120000,
  }),
  strategiesApply: rpc('strategies_apply', {
    payload: editPayload({ strategy_id: strategyId, revision: 0, catalog_digest: catalogDigest }),
    canonicalOwner: 'strategies.apply-mutation',
    timeout: 180000,
  }),
  eventsTail: rpc('events_tail', {
    payload: editPayload({ limit: 50 }),
    canonicalOwner: 'journal.events_tail',
  }),
  dnsProductGet: rpc('dns_product_get', { canonicalOwner: 'dns.product-snapshot' }),
  dnsProductProviders: rpc('dns_product_providers', { canonicalOwner: 'dns.provider-catalog' }),
  dnsProductStatus: rpc('dns_product_status', { canonicalOwner: 'dns.product-snapshot' }),
  dnsGet: rpc('dns_get', { canonicalOwner: 'dns.product-snapshot' }),
  dnsGlobalGet: rpc('dns_global_get', { canonicalOwner: 'dns.product-snapshot' }),
  serviceDnsStatus: rpc('service_dns_status', { canonicalOwner: 'dns.product-snapshot' }),
  serviceDnsProviders: rpc('service_dns_providers', { canonicalOwner: 'dns.service-catalog' }),
  dnsprovComponents: rpc('dnsprov_components', { canonicalOwner: 'dns.provider-catalog' }),
  dnsprovProviders: rpc('dnsprov_providers', { canonicalOwner: 'dns.provider-catalog' }),
  catalogList: rpc('catalog_list', { canonicalOwner: 'services.catalog' }),
  tiktokStatus: rpc('service_dns_tiktok_status', { canonicalOwner: 'dns.tiktok' }),
  resourcesStatus: rpc('resources_status', { canonicalOwner: 'z2k.resources-status' }),
  resourcesVersions: rpc('z2k_versions', { canonicalOwner: 'z2k.resources-catalog' }),
  maintenanceStatus: rpc('maintenance_status', { canonicalOwner: 'system.maintenance-status', timeout: 60000 }),
  versions: rpc('versions', { canonicalOwner: 'system.versions', timeout: 60000 }),
  diagnosticsExport: rpc('diagnostics_export', { canonicalOwner: 'diagnostics.export' }),
  orchestraStatus: rpc('orchestra_status', { canonicalOwner: 'orchestra.status' }),
  orchestraHistory: rpc('orchestra_history', { canonicalOwner: 'orchestra.history' }),
  orchestraHistoryPaginated: rpc('orchestra_history_paginated', {
    payload: JSON.stringify({ limit: '50' }),
    canonicalOwner: 'orchestra.history',
  }),
  domainHubGet: rpc('domain_hub_get', { object: 'zapret2-manager-domain-hub', canonicalOwner: 'services.domain-hub' }),
  orchestraProbePreflight: rpc('orchestra_probe_preflight', { canonicalOwner: 'orchestra.preflight' }),
  orchestraRunStatus: rpc('orchestra_run_status', {
    payload: editPayload(process.env.Z2M_PERF_RUN_ID ? { runId: process.env.Z2M_PERF_RUN_ID } : {}),
    canonicalOwner: 'orchestra.run-status',
  }),
  engineReleases: rpc('engine_releases', { object: 'zapret2-manager-engine', canonicalOwner: 'engine.catalog', timeout: 60000 }),
  engineStatus: rpc('engine_status', { object: 'zapret2-manager-engine', canonicalOwner: 'engine.status' }),
  proxyCapabilities: rpc('proxy_capabilities', { canonicalOwner: 'telegram.local-capabilities', timeout: 60000 }),
  proxyStatus: rpc('proxy_status', { canonicalOwner: 'telegram.proxy-status' }),
  proxyConfigGet: rpc('proxy_config_get', { canonicalOwner: 'telegram.local-config' }),
  proxyHealth: rpc('proxy_health', { payload: editPayload({}), canonicalOwner: 'telegram.upstream-health', timeout: 60000 }),
  tgProductStatus: rpc('tg_product_status', { canonicalOwner: 'telegram.local-status', timeout: 60000 }),
  tgProductCatalog: rpc('tg_product_catalog', { canonicalOwner: 'telegram.catalog', timeout: 60000 }),
  tgProductVersions: rpc('tg_product_versions', { canonicalOwner: 'telegram.versions', timeout: 60000 }),
  tgProductOperationStatus: rpc('tg_product_operation_status', {
    payload: editPayload({}),
    canonicalOwner: 'telegram.operation-status',
  }),
  tgProductStart: rpc('tg_product_start', { canonicalOwner: 'telegram.lifecycle-mutation', timeout: 120000 }),
  tgProductStop: rpc('tg_product_stop', { canonicalOwner: 'telegram.lifecycle-mutation', timeout: 120000 }),
  tgProductRestart: rpc('tg_product_restart', { canonicalOwner: 'telegram.lifecycle-mutation', timeout: 120000 }),
  scannerStatus: rpc('scanner_status', {
    payload: editPayload(process.env.Z2M_PERF_SCANNER_ID ? { id: process.env.Z2M_PERF_SCANNER_ID } : {}),
    canonicalOwner: 'scanner.status',
  }),
};

function call(name, overrides = {}) {
  const found = calls[name];
  if (!found) throw new Error(`Unknown benchmark RPC: ${name}`);
  return { ...found, ...overrides };
}

function dnsNavigationPhases() {
  if (dnsBootstrapProfile === 'before') {
    return [
      { name: 'legacy-bootstrap', mode: 'parallel', calls: [
        call('dnsProductGet'), call('dnsProductStatus'), call('dnsGet'),
        call('serviceDnsStatus'), call('dnsGlobalGet'),
      ] },
      { name: 'legacy-enrichment', mode: 'limited', concurrency: 2, calls: [
        call('dnsProductProviders'), call('serviceDnsProviders'), call('dnsprovComponents'),
        call('dnsprovProviders'), call('catalogList'), call('tiktokStatus'),
      ] },
    ];
  }
  return [
    { name: 'canonical-bootstrap', mode: 'serial', calls: [call('dnsProductGet')] },
    { name: 'deferred-enrichment', mode: 'limited', concurrency: 2, calls: [call('dnsprovComponents'), call('catalogList'), call('tiktokStatus')] },
  ];
}

// A scenario is a transport profile, not a product verdict. It measures the
// RPC work a browser lane admits. Browser rendering and LAN traffic remain
// separate acceptance gates.
const scenarios = {
  'dashboard-cold': {
    phases: [
      { name: 'first-paint', mode: 'serial', calls: [call('statusFast')] },
      { name: 'deferred-priority', mode: 'limited', concurrency: 2, calls: [
        call('eventsTail'), call('tgProductStatus'), call('strategiesGet'), call('engineStatus'),
        call('maintenanceStatus'), call('strategiesPreview'), call('strategiesRecommendations'),
        call('versions'), call('resourcesStatus'),
      ] },
    ],
  },
  'dashboard-revisit': {
    phases: [{ name: 'fresh-visible-status', mode: 'serial', calls: [call('statusFast')] }],
  },
  'strategies-navigation': {
    phases: [
      { name: 'shell', mode: 'serial', calls: [call('statusFast')] },
      { name: 'strategy-read', mode: 'parallel', calls: [call('strategiesList'), call('strategiesCatalogStatus')] },
      { name: 'selected-detail', mode: 'serial', calls: [call('strategiesGet')] },
    ],
  },
  'strategy-apply': {
    requiresMutation: true,
    scenarioRounds: 1,
    phases: [
      { name: 'preview', mode: 'serial', calls: [call('strategiesPreview')] },
      { name: 'validate', mode: 'serial', calls: [call('strategiesValidate')] },
      { name: 'apply', mode: 'serial', calls: [call('strategiesApply')] },
      { name: 'postflight', mode: 'serial', calls: [call('statusFast')] },
    ],
  },
  'telegram-navigation': {
    phases: [
      { name: 'local-bootstrap', mode: 'parallel', calls: [
        call('tgProductStatus'), call('proxyCapabilities'), call('proxyConfigGet'), call('tgProductOperationStatus'),
      ] },
      { name: 'deferred-metadata', mode: 'limited', concurrency: 2, calls: [
        call('proxyStatus'), call('tgProductCatalog'), call('tgProductVersions'), call('eventsTail'),
      ] },
    ],
    healthExcluded: true,
  },
  'telegram-start': {
    requiresMutation: true,
    scenarioRounds: 1,
    phases: [
      { name: 'start', mode: 'serial', calls: [call('tgProductStart')] },
      { name: 'postflight', mode: 'serial', calls: [call('tgProductStatus')] },
    ],
  },
  'telegram-stop': {
    requiresMutation: true,
    scenarioRounds: 1,
    phases: [
      { name: 'stop', mode: 'serial', calls: [call('tgProductStop')] },
      { name: 'postflight', mode: 'serial', calls: [call('tgProductStatus')] },
    ],
    cleanup: [{ name: 'restore-running', mode: 'serial', calls: [call('tgProductStart'), call('tgProductStatus')] }],
  },
  'telegram-restart': {
    requiresMutation: true,
    scenarioRounds: 1,
    phases: [
      { name: 'restart', mode: 'serial', calls: [call('tgProductRestart')] },
      { name: 'postflight', mode: 'serial', calls: [call('tgProductStatus')] },
    ],
  },
  'telegram-health-action': {
    phases: [{ name: 'explicit-health', mode: 'serial', calls: [call('proxyHealth')] }],
  },
  'dns-navigation': {
    phases: dnsNavigationPhases(),
    dnsBootstrapProfile,
  },
  'services-check': {
    phases: [
      { name: 'service-read', mode: 'serial', calls: [call('domainHubGet')] },
      { name: 'bounded-poll', mode: 'limited', concurrency: 2, calls: [call('orchestraProbePreflight'), call('orchestraStatus')] },
    ],
  },
  'scanner-polling': {
    phases: [{ name: 'status-poll', mode: 'serial', calls: [call('scannerStatus')] }],
  },
  'components-navigation': {
    phases: [
      { name: 'local-first', mode: 'parallel', calls: [call('versions'), call('engineStatus'), call('resourcesStatus')] },
      { name: 'deferred-metadata', mode: 'limited', concurrency: 2, calls: [call('engineReleases'), call('resourcesVersions'), call('tgProductStatus')] },
    ],
  },
  'diagnostics-navigation': {
    phases: [
      { name: 'shell', mode: 'serial', calls: [call('statusFast')] },
      { name: 'local-diagnostics', mode: 'parallel', calls: [call('maintenanceStatus'), call('engineStatus'), call('dnsProductStatus'), call('tgProductStatus')] },
      { name: 'explicit-upstream-health', mode: 'serial', calls: [call('proxyHealth')] },
    ],
  },
  'logs-navigation': {
    phases: [{ name: 'journal', mode: 'serial', calls: [call('eventsTail')] }],
  },
  contention: {
    phases: [{ name: 'contended', mode: 'parallel', calls: [
      ...Array.from({ length: fanout }, () => call('strategiesRecommendations')),
      call('statusFast'), call('eventsTail'), call('proxyHealth'),
    ] }],
    healthExcluded: false,
  },
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function boundedString(value, max = 160) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function responseEvidence(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const body = document.result && typeof document.result === 'object' && !Array.isArray(document.result)
    ? document.result : document;
  const applied = body.applied && typeof body.applied === 'object' && !Array.isArray(body.applied)
    ? body.applied : body;
  const strategy = body.strategy && typeof body.strategy === 'object' && !Array.isArray(body.strategy)
    ? body.strategy : {};
  const selected = body.identity && typeof body.identity === 'object' && body.identity.selected
    && typeof body.identity.selected === 'object' && !Array.isArray(body.identity.selected)
    ? body.identity.selected : {};
  const timingSource = body.timing && typeof body.timing === 'object' && !Array.isArray(body.timing)
    ? body.timing : applied.timing && typeof applied.timing === 'object' && !Array.isArray(applied.timing)
      ? applied.timing : null;
  const timing = timingSource
    ? Object.fromEntries(['guardMs', 'beginMs', 'catalogResolveMs', 'strategyResolveMs', 'runtimeResolveMs',
      'compileDependenciesMs', 'lockedTransactionMs', 'preflightMs', 'totalMs', 'preflightCount']
      .filter(key => Number.isFinite(timingSource[key]))
      .map(key => [key, timingSource[key]]))
    : null;
  const closure = body.dependencyClosure || body.dependencies?.dependencyClosure
    || applied.dependencyClosure || applied.dependencies?.dependencyClosure || null;
  const native = body.nativeValidation || body.dependencies?.nativeValidation
    || applied.nativeValidation || applied.dependencies?.nativeValidation || null;
  const missing = closure && Array.isArray(closure.missing)
    ? closure.missing.slice(0, 16).map(item => boundedString(typeof item === 'string' ? item : item?.reference || item?.id))
    : null;
  const diagnostics = native && Array.isArray(native.diagnostics)
    ? native.diagnostics.slice(0, 16).map(item => ({
      severity: boundedString(item?.severity, 32), code: boundedString(item?.code, 64),
    }))
    : null;
  return {
    ok: body.ok === true ? true : body.ok === false ? false : null,
    schema: boundedString(body.schema || body.schemaVersion),
    strategyId: boundedString(body.strategyId || strategy.id || body.strategy_id || selected.id),
    canonicalStrategyId: boundedString(body.canonicalStrategyId || strategy.canonicalStrategyId || selected.canonicalStrategyId),
    entryKind: boundedString(body.entryKind || strategy.entryKind || selected.entryKind),
    origin: boundedString(body.origin || strategy.origin || body.strategyOrigin || selected.origin),
    sourceCommit: boundedString(body.sourceCommit || strategy.sourceCommit || selected.sourceCommit, 64),
    preflightCount: Number.isFinite(timingSource?.preflightCount)
      ? timingSource.preflightCount : Number.isFinite(applied.preflightCount) ? applied.preflightCount : null,
    timing,
    profilesCount: Number.isFinite(body.profilesCount) ? body.profilesCount
      : Number.isFinite(applied.profiles) ? applied.profiles : null,
    effectiveCommandBytes: Number.isFinite(body.effectiveCommandBytes) ? body.effectiveCommandBytes : null,
    digest: boundedString(body.digest || body.candidateSha256 || applied.candidateSha256, 128),
    dependencyClosure: closure && typeof closure === 'object' ? {
      available: closure.available === true,
      missingCount: Array.isArray(closure.missing) ? closure.missing.length : 0,
      missing,
      runtimeBundleDigest: boundedString(closure.runtimeBundleDigest, 128),
      counts: closure.counts && typeof closure.counts === 'object' ? {
        lua: closure.counts.lua, blobs: closure.counts.blobs, hostlists: closure.counts.hostlists,
        ipsets: closure.counts.ipsets, dynamic: closure.counts.dynamic, runtime: closure.counts.runtime,
        builtins: closure.counts.builtins, missing: closure.counts.missing,
      } : null,
    } : null,
    nativeValidation: native && typeof native === 'object' ? {
      status: boundedString(native.status, 32),
      coverage: native.coverage && typeof native.coverage === 'object' ? native.coverage : null,
      diagnosticCount: Array.isArray(native.diagnostics) ? native.diagnostics.length : 0,
      diagnostics,
    } : null,
  };
}

function runCall(definition) {
  const started = performance.now();
  const remote = ['ubus', '-t', String(Math.max(1, Math.ceil(definition.timeout / 1000))), '-S', 'call', definition.object, definition.method, definition.payload]
    .filter((value) => value != null)
    .map(shellQuote)
    .join(' ');
  const command = ['-o', 'BatchMode=yes', host, remote];
  return new Promise((resolve) => {
    const child = spawn('ssh', command, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        method: definition.method,
        object: definition.object,
        rpcName: definition.rpcName,
        canonicalOwner: definition.canonicalOwner,
        ms: Math.round(performance.now() - started),
        ...result,
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'timeout', timeout: true });
    }, definition.timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message, timeout: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let document = null;
      try { document = JSON.parse(stdout); } catch { }
      const validJson = document !== null;
      const error = validJson
        ? document.ok === false ? JSON.stringify(document.error || document) : null
        : (code === 0 ? 'invalid-json' : (stderr.trim() || 'ubus failed'));
      finish({
        ok: code === 0 && validJson && document.ok !== false,
        exitCode: code,
        bytes: stdout.length,
        error,
        timeout: false,
        responseEvidence: validJson ? responseEvidence(document) : null,
      });
    });
  });
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function ownerCounts(results) {
  return results.reduce((out, result) => {
    out[result.canonicalOwner] = (out[result.canonicalOwner] || 0) + 1;
    return out;
  }, {});
}

function summarize(results) {
  const values = results.map((row) => row.ms);
  const owners = ownerCounts(results);
  const duplicateOwners = Object.fromEntries(Object.entries(owners).filter(([, count]) => count > 1));
  const byRpc = {};
  for (const result of results) {
    const key = result.rpcName;
    if (!byRpc[key]) byRpc[key] = [];
    byRpc[key].push(result);
  }
  const rpcSummary = Object.fromEntries(Object.entries(byRpc).map(([key, rows]) => {
    const times = rows.map((row) => row.ms);
    return [key, {
      samples: rows.length,
      ok: rows.filter((row) => row.ok).length,
      p50Ms: percentile(times, 0.50),
      p95Ms: percentile(times, 0.95),
      maxMs: Math.max(...times),
      errors: rows.filter((row) => !row.ok && !row.timeout).map((row) => row.error).filter(Boolean),
      timeouts: rows.filter((row) => row.timeout).map((row) => row.error).filter(Boolean),
    }];
  }));
  return {
    rpcCount: results.length,
    rpcNames: results.map((result) => result.rpcName),
    canonicalOwners: owners,
    duplicateCanonicalOwnerCount: Object.values(duplicateOwners).reduce((sum, count) => sum + count - 1, 0),
    duplicateCanonicalOwners: duplicateOwners,
    minMs: values.length ? Math.min(...values) : null,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
    errorCount: results.filter((row) => !row.ok && !row.timeout).length,
    timeoutCount: results.filter((row) => row.timeout).length,
    errors: results.filter((row) => !row.ok && !row.timeout).map((row) => row.error).filter(Boolean),
    timeouts: results.filter((row) => row.timeout).map((row) => row.error).filter(Boolean),
    byRpc: rpcSummary,
  };
}

async function runLimited(items, concurrency) {
  const rows = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      rows[index] = await runCall(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency || 1, items.length) }, worker));
  return rows;
}

async function runPhase(phase) {
  if (phase.mode === 'parallel') return Promise.all(phase.calls.map(runCall));
  if (phase.mode === 'limited') return runLimited(phase.calls, phase.concurrency);
  const rows = [];
  for (const item of phase.calls) rows.push(await runCall(item));
  return rows;
}

async function runScenarioRound(definition) {
  const started = performance.now();
  const phases = [];
  const all = [];
  for (const phase of definition.phases) {
    const rows = await runPhase(phase);
    all.push(...rows);
    phases.push({
      name: phase.name,
      rpcCount: rows.length,
      elapsedMs: Math.round(performance.now() - started),
      firstMeaningful: phase.firstMeaningful !== false,
      responses: rows.map(row => row.responseEvidence).filter(Boolean),
      summary: summarize(rows),
    });
  }
  return {
    rpcCount: all.length,
    elapsedMs: Math.round(performance.now() - started),
    firstMeaningfulPhase: phases.find((phase) => phase.firstMeaningful) || null,
    phases,
    summary: summarize(all),
  };
}

async function runCleanup(definition) {
  const phases = [];
  const all = [];
  for (const phase of definition.cleanup || []) {
    const rows = await runPhase(phase);
    all.push(...rows);
    phases.push({ name: phase.name, rpcCount: rows.length, summary: summarize(rows) });
  }
  return { rpcCount: all.length, phases, summary: summarize(all) };
}

async function runScenario(name, definition) {
  if (definition.requiresMutation && !mutationAllowed) {
    return {
      schema: 'z2m-rpc-starvation-scenario.v2', scenario: name, target: host,
      skipped: true, skipReason: 'mutation scenario requires Z2M_PERF_ALLOW_MUTATION=1',
      mutationAllowed, healthExcluded: definition.healthExcluded === true,
      dnsBootstrapProfile: definition.dnsBootstrapProfile || null,
    };
  }
  const scenarioRounds = definition.scenarioRounds || rounds;
  const roundResults = [];
  for (let round = 0; round < scenarioRounds; round++) roundResults.push(await runScenarioRound(definition));
  const phaseSummaries = roundResults.flatMap((round) => round.phases);
  const timing = roundResults.map((round) => round.elapsedMs);
  const firstTimings = roundResults.map((round) => round.firstMeaningfulPhase?.elapsedMs).filter((value) => value != null);
  const phaseRpcCount = roundResults.reduce((sum, round) => sum + round.rpcCount, 0);
  const aggregateRpcNames = phaseSummaries.flatMap((phase) => phase.summary.rpcNames);
  const aggregateOwners = phaseSummaries.reduce((out, phase) => {
    for (const [owner, count] of Object.entries(phase.summary.canonicalOwners)) out[owner] = (out[owner] || 0) + count;
    return out;
  }, {});
  // Repeated benchmark rounds are samples, not duplicate UI owners. Count
  // duplicates inside each page-load round, then expose the per-round values
  // so a repeated status_fast sample cannot look like a fanout regression.
  const duplicateCanonicalOwnerCountPerRound = roundResults.map((round) => round.summary.duplicateCanonicalOwnerCount);
  const duplicateOwners = {};
  for (const round of roundResults) {
    for (const [owner, count] of Object.entries(round.summary.duplicateCanonicalOwners))
      duplicateOwners[owner] = (duplicateOwners[owner] || 0) + count;
  }
  const errorCount = phaseSummaries.reduce((sum, phase) => sum + phase.summary.errorCount, 0);
  const timeoutCount = phaseSummaries.reduce((sum, phase) => sum + phase.summary.timeoutCount, 0);
  const rpcSummary = {};
  for (const phase of phaseSummaries) {
    for (const [key, value] of Object.entries(phase.summary.byRpc)) {
      const bucket = rpcSummary[key] || (rpcSummary[key] = { samples: 0, ok: 0, p50Ms: [], p95Ms: [], maxMs: 0, errors: [], timeouts: [] });
      bucket.samples += value.samples;
      bucket.ok += value.ok;
      bucket.p50Ms.push(value.p50Ms);
      bucket.p95Ms.push(value.p95Ms);
      bucket.maxMs = Math.max(bucket.maxMs, value.maxMs || 0);
      bucket.errors.push(...value.errors);
      bucket.timeouts.push(...value.timeouts);
    }
  }
  Object.values(rpcSummary).forEach((value) => {
    value.p50Ms = percentile(value.p50Ms.filter((item) => item != null), 0.50);
    value.p95Ms = percentile(value.p95Ms.filter((item) => item != null), 0.95);
  });
  const cleanup = await runCleanup(definition);
  return {
    schema: 'z2m-rpc-starvation-scenario.v2', scenario: name, target: host,
    rounds: scenarioRounds, scenarioRounds, mutationAllowed, skipped: false,
    healthExcluded: definition.healthExcluded === true,
    dnsBootstrapProfile: definition.dnsBootstrapProfile || null,
    rpcCount: phaseRpcCount, rpcCountPerRound: roundResults.map((round) => round.rpcCount),
    elapsedMs: { p50Ms: percentile(timing, 0.50), p95Ms: percentile(timing, 0.95), maxMs: Math.max(...timing) },
    firstMeaningfulPhase: roundResults[0]?.firstMeaningfulPhase?.name || null,
    firstMeaningfulMs: { p50Ms: percentile(firstTimings, 0.50), p95Ms: percentile(firstTimings, 0.95), maxMs: firstTimings.length ? Math.max(...firstTimings) : null },
    rpcNames: aggregateRpcNames, canonicalOwners: aggregateOwners,
    duplicateCanonicalOwnerCount: duplicateCanonicalOwnerCountPerRound.reduce((sum, count) => sum + count, 0),
    duplicateCanonicalOwnerCountPerRound,
    duplicateCanonicalOwners: duplicateOwners, errorCount, timeoutCount,
    errors: phaseSummaries.flatMap((phase) => phase.summary.errors),
    timeouts: phaseSummaries.flatMap((phase) => phase.summary.timeouts),
    summary: rpcSummary, roundsDetail: roundResults, cleanup,
    note: 'firstMeaningfulMs is first admitted phase completion, not browser FMP; traffic acceptance is separate.',
  };
}

function legacyCalls() {
  return [
    call('statusFast'), call('status'), call('strategiesList'), call('strategiesCatalogStatus'),
    call('strategiesRecommendations'), call('eventsTail'), call('dnsProductGet'), call('dnsProductProviders'),
    call('dnsProductStatus'), call('serviceDnsStatus'), call('tiktokStatus'), call('resourcesStatus'),
    call('maintenanceStatus'), call('diagnosticsExport'), call('orchestraStatus'), call('orchestraHistory'),
    call('orchestraHistoryPaginated'), call('engineReleases'), call('engineStatus'), call('proxyCapabilities'),
    call('proxyStatus'), call('proxyConfigGet'), call('proxyHealth'), call('tgProductStatus'),
    call('tgProductOperationStatus'),
  ];
}

async function runLegacy() {
  const baseline = [];
  for (let round = 0; round < rounds; round++) {
    for (const definition of legacyCalls()) baseline.push(await runCall(definition));
  }
  const contention = await Promise.all([
    ...Array.from({ length: fanout }, () => runCall(call('strategiesRecommendations'))),
    runCall(call('statusFast')), runCall(call('eventsTail')), runCall(call('proxyHealth')),
  ]);
  console.log(JSON.stringify({
    schema: 'z2m-rpc-starvation.v2', target: host, rounds, fanout, timeoutMs,
    mutationAllowed, baseline: summarize(baseline), contention, contentionSummary: summarize(contention),
    note: 'Legacy aggregate is retained for continuity; scenario reports are the PERF-2 acceptance format.',
  }, null, 2));
}

if (requestedScenario !== 'legacy') {
  if (!scenarios[requestedScenario]) {
    console.error(`Unknown scenario ${requestedScenario}. Available: ${Object.keys(scenarios).join(', ')}`);
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await runScenario(requestedScenario, scenarios[requestedScenario]), null, 2));
  }
} else {
  await runLegacy();
}
