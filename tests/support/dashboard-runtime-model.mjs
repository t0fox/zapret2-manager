export function settleRead(read, { timeoutMs = 100, label = 'read' } = {}) {
  let timer;
  const started = Date.now();
  const operation = Promise.resolve().then(read).then(
    (value) => ({ state: 'LOADED', label, value, elapsedMs: Date.now() - started }),
    (error) => ({ state: 'ERROR', label, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }),
  );
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: 'TIMEOUT', label, error: `${label} exceeded ${timeoutMs}ms budget`, elapsedMs: Date.now() - started }), timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

export async function collectStatusProjection(parts, options) {
  const entries = await Promise.all(Object.entries(parts).map(async ([label, read]) => [label, await settleRead(read, { ...options, label })]));
  const fields = {};
  const degraded = [];
  for (const [label, result] of entries) {
    if (result.state === 'LOADED') fields[label] = result.value;
    else degraded.push({ label, state: result.state });
  }
  return { ok: true, fields, degraded };
}

export async function loadDashboardRuntime({ status, strategy, events }, options = {}) {
  const statusResult = await collectStatusProjection(status, options);
  const [strategyResult, eventsResult] = await Promise.all([
    settleRead(strategy, { ...options, label: 'strategy' }),
    settleRead(events, { ...options, label: 'events' }),
  ]);
  return { status: statusResult, strategy: strategyResult, events: eventsResult };
}
