export function preflightCombo(candidate, options = {}) {
  if (!candidate || typeof candidate.opt !== 'string' || !candidate.opt.trim()) return { ok: false, error: 'candidate missing' };
  if (candidate.captureMode === 'wide' && options.wideAcknowledged !== true) return { ok: false, error: 'wide capture acknowledgement is required' };
  if (options.filesPresent === false) return { ok: false, error: 'required files are missing' };
  if (options.nativePassed === false) return { ok: false, error: 'native validation rejected candidate' };
  return { ok: true };
}

export function applyComboTransaction(candidate, io) {
  const preflight = preflightCombo(candidate, {
    wideAcknowledged: io.wideAcknowledged,
    filesPresent: true,
    nativePassed: true
  });
  if (!preflight.ok) return preflight;
  const original = io.readConfig();
  const rollback = (stage, detail) => {
    io.restoreConfig(original);
    return { ok: false, stage, detail, rolledBack: true };
  };
  if (io.setVar('NFQWS2_PORTS_TCP', candidate.tcpPorts) == null || io.readVar('NFQWS2_PORTS_TCP') !== candidate.tcpPorts)
    return rollback('write-tcp');
  if (io.setVar('NFQWS2_PORTS_UDP', candidate.udpPorts) == null || io.readVar('NFQWS2_PORTS_UDP') !== candidate.udpPorts)
    return rollback('write-udp');
  const applied = io.applyOpt(candidate.opt);
  if (!applied || applied.ok !== true) return rollback('apply-opt', applied);
  if (io.readVar('NFQWS2_OPT') !== candidate.opt) return rollback('readback-opt');
  const restarted = io.restart();
  if (!restarted || restarted.ok !== true) return rollback('restart', restarted);
  const runtime = io.verifyRuntime();
  if (!runtime || runtime.ok !== true) return rollback('verify-runtime', runtime);
  return { ok: true, variables: ['NFQWS2_PORTS_TCP', 'NFQWS2_PORTS_UDP', 'NFQWS2_OPT'] };
}
