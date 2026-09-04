#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const host = process.env.Z2M_ROUTER || 'root@192.168.1.1';
const rounds = Number(process.env.Z2M_PERF_ROUNDS || 3);
const fanout = Number(process.env.Z2M_PERF_FANOUT || 4);
const timeoutMs = Number(process.env.Z2M_PERF_TIMEOUT_MS || 30000);
const scenarioArg = [...args].find((value) => value.startsWith('--scenario='));
const requestedScenario = scenarioArg ? scenarioArg.slice('--scenario='.length) : 'legacy';

const calls = [
  ['status_fast'],
  ['status'],
  ['strategies_list'],
  ['strategies_catalog_status'],
  ['strategies_recommendations'],
  ['events_tail', JSON.stringify({ edit: JSON.stringify({ limit: 50 }) })],
  ['dns_product_get'],
  ['dns_product_providers'],
  ['dns_product_status'],
  ['service_dns_status'],
  ['service_dns_tiktok_status'],
  ['resources_status'],
  ['maintenance_status'],
  ['diagnostics_export'],
  ['orchestra_status'],
  ['orchestra_history'],
  ['orchestra_history_paginated', JSON.stringify({ limit: '50' })],
  ['engine_releases', null, 'zapret2-manager-engine'],
  ['engine_gate_status', null, 'zapret2-manager-engine'],
  ['engine_status', null, 'zapret2-manager-engine'],
  ['proxy_capabilities'],
  ['proxy_status'],
  ['proxy_config_get'],
  ['proxy_health', JSON.stringify({ edit: JSON.stringify({}) })],
  ['tg_product_status'],
  ['tg_product_operation_status', JSON.stringify({ edit: JSON.stringify({}) })]
];

function call(method) {
  const found = calls.find(([name]) => name === method);
  if (!found) throw new Error(`Unknown benchmark RPC: ${method}`);
  return found;
}

// A scenario is intentionally a transport profile, not a product verdict.
// It measures the RPC work a browser lane admits; browser and traffic
// acceptance remain separate gates.
const scenarios = {
  'dashboard-cold': {
    phases: [
      { name: 'first-paint', mode: 'serial', calls: [call('status_fast')] },
      { name: 'deferred', mode: 'limited', concurrency: 2, calls: [
        call('status'), call('strategies_recommendations'), call('events_tail'),
        call('tg_product_status'), call('engine_status'), call('maintenance_status'),
        call('resources_status')
      ] }
    ]
  },
  'strategies-navigation': {
    phases: [
      { name: 'shell', mode: 'serial', calls: [call('status_fast')] },
      { name: 'strategy-read', mode: 'limited', concurrency: 2, calls: [
        call('strategies_list'), call('strategies_catalog_status')
      ] }
    ]
  },
  'telegram-navigation': {
    phases: [
      { name: 'local-status', mode: 'limited', concurrency: 2, calls: [
        call('tg_product_status'), call('proxy_status'), call('proxy_capabilities'),
        call('proxy_config_get'), call('tg_product_operation_status')
      ] }
    ],
    healthExcluded: true
  },
  'telegram-health-action': {
    phases: [{ name: 'explicit-health', mode: 'serial', calls: [call('proxy_health')] }]
  },
  'logs-navigation': {
    phases: [{ name: 'journal', mode: 'serial', calls: [call('events_tail')] }]
  },
  contention: {
    phases: [{ name: 'contended', mode: 'parallel', calls: [
      ...Array.from({ length: fanout }, () => call('strategies_recommendations')),
      call('events_tail')
    ] }]
  }
};

function runCall([method, payload, object = 'zapret2-manager']) {
  const started = performance.now();
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const remote = ['ubus', '-S', 'call', object, method, payload]
    .filter((value) => value != null)
    .map(shellQuote)
    .join(' ');
  const command = ['-o', 'BatchMode=yes', host, remote];
  return new Promise((resolve) => {
    const child = spawn('ssh', command, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ method, object, ms: Math.round(performance.now() - started), ok: false, error: 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ method, object, ms: Math.round(performance.now() - started), ok: false, error: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let document = null;
      try { document = JSON.parse(stdout); } catch { }
      resolve({
        method,
        object,
        ms: Math.round(performance.now() - started),
        ok: code === 0 && document != null && document.ok !== false,
        exitCode: code,
        bytes: stdout.length,
        error: code === 0 ? null : (stderr.trim() || 'ubus failed')
      });
    });
  });
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarize(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.object}.${result.method}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  return Object.fromEntries([...groups].map(([key, rows]) => {
    const values = rows.map((row) => row.ms);
    return [key, {
      samples: rows.length,
      ok: rows.filter((row) => row.ok).length,
      minMs: Math.min(...values),
      p50Ms: percentile(values, 0.50),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
      errors: rows.filter((row) => !row.ok).map((row) => row.error).filter(Boolean)
    }];
  }));
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

async function runScenario(name, definition) {
  const started = performance.now();
  const phases = [];
  const all = [];
  for (const phase of definition.phases) {
    let rows;
    if (phase.mode === 'parallel') rows = await Promise.all(phase.calls.map(runCall));
    else if (phase.mode === 'limited') rows = await runLimited(phase.calls, phase.concurrency);
    else {
      rows = [];
      for (const item of phase.calls) rows.push(await runCall(item));
    }
    all.push(...rows);
    phases.push({
      name: phase.name,
      rpcCount: rows.length,
      elapsedMs: Math.round(performance.now() - started),
      summary: summarize(rows)
    });
  }
  return {
    schema: 'z2m-rpc-starvation-scenario.v1',
    scenario: name,
    target: host,
    rounds: 1,
    rpcCount: all.length,
    elapsedMs: Math.round(performance.now() - started),
    // The harness has no DOM, so this is the first admitted phase completion,
    // not a browser paint claim. Browser FMP remains a separate acceptance gate.
    firstMeaningfulMs: phases.length && phases[0].summary
      ? phases[0].elapsedMs : null,
    healthExcluded: definition.healthExcluded === true,
    phases,
    summary: summarize(all)
  };
}

if (requestedScenario !== 'legacy') {
  if (!scenarios[requestedScenario]) {
    console.error(`Unknown scenario ${requestedScenario}. Available: ${Object.keys(scenarios).join(', ')}`);
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await runScenario(requestedScenario, scenarios[requestedScenario]), null, 2));
  }
} else {
  const baseline = [];
  for (let round = 0; round < rounds; round++) {
    for (const call of calls) baseline.push(await runCall(call));
  }

  const contention = [];
  for (let i = 0; i < fanout; i++) contention.push(runCall(call('strategies_recommendations')));
  contention.push(runCall(call('events_tail')));
  const contentionResults = await Promise.all(contention);

  const result = {
    schema: 'z2m-rpc-starvation.v1',
    target: host,
    rounds,
    fanout,
    timeoutMs,
    baseline: summarize(baseline),
    contention: contentionResults,
    contentionSummary: summarize(contentionResults)
  };
  console.log(JSON.stringify(result, null, 2));
}
