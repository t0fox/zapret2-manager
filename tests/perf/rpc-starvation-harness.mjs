#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const host = process.env.Z2M_ROUTER || 'root@192.168.1.1';
const rounds = Number(process.env.Z2M_PERF_ROUNDS || 3);
const fanout = Number(process.env.Z2M_PERF_FANOUT || 4);
const timeoutMs = Number(process.env.Z2M_PERF_TIMEOUT_MS || 30000);

const calls = [
  ['status_fast'],
  ['status'],
  ['strategies_list'],
  ['strategies_recommendations'],
  ['events_tail', JSON.stringify({ edit: JSON.stringify({ limit: 50 }) })],
  ['dns_product_get'],
  ['dns_product_providers'],
  ['dns_product_status'],
  ['service_dns_status'],
  ['service_dns_tiktok_status'],
  ['resources_status'],
  ['maintenance_status'],
  ['engine_gate_status', null, 'zapret2-manager-engine'],
  ['engine_status', null, 'zapret2-manager-engine']
];

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

const baseline = [];
for (let round = 0; round < rounds; round++) {
  for (const call of calls) baseline.push(await runCall(call));
}

const contention = [];
for (let i = 0; i < fanout; i++) contention.push(runCall(calls.find(([method]) => method === 'strategies_recommendations')));
contention.push(runCall(calls.find(([method]) => method === 'events_tail')));
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
