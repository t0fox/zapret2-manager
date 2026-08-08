function portExpressionValid(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  return value.split(',').every((part) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) return false;
    const start = Number(match[1]);
    const end = match[2] == null ? start : Number(match[2]);
    return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 65535 && start <= end;
  });
}

export function candidateSyntaxErrors(candidate) {
  const errors = [];
  if (!candidate || typeof candidate.opt !== 'string' || !candidate.opt.trim())
    errors.push('candidate options are missing');
  if (!portExpressionValid(candidate && candidate.tcpPorts))
    errors.push('candidate TCP capture is invalid');
  if (!portExpressionValid(candidate && candidate.udpPorts))
    errors.push('candidate UDP capture is invalid');
  const opt = String(candidate && candidate.opt || '');
  if (opt.includes('--wf-') || opt.includes('@{') || opt.includes('\\') || opt.includes('<'))
    errors.push('candidate options contain unsupported syntax');
  return errors;
}

function rejected(code, message) {
  const bounded = String(message || 'candidate preflight failed').slice(0, 160);
  return { ok: false, code, message: bounded, error: bounded };
}

export function preflightCombo(candidate, options = {}) {
  const syntaxErrors = candidateSyntaxErrors(candidate);
  if (syntaxErrors.length) return rejected('ESYNTAX', syntaxErrors[0]);
  if (candidate.captureMode === 'wide' && options.wideAcknowledged !== true)
    return rejected('EACK', 'wide capture acknowledgement is required');
  if (options.filesPresent === false)
    return rejected('EFILES', 'required files are missing');
  if (options.nativePassed === false)
    return rejected('ENATIVE', 'native validation rejected candidate');
  return { ok: true, code: 'OK', message: 'candidate preflight passed' };
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
