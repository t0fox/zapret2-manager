import test from 'node:test';
import assert from 'node:assert/strict';
import { applyComboTransaction, preflightCombo } from '../tools/flowseal-combo-apply.mjs';

const candidate = {
  managerId: 'flowseal-flowseal-alt10-combo',
  captureMode: 'wide',
  tcpPorts: '80,443-65535',
  udpPorts: '443,19294-19344,50000-65535',
  opt: '--filter-tcp=443 --payload=tls_client_hello --lua-desync=fake'
};

test('wide combo is rejected without explicit acknowledgement', () => {
  const result = preflightCombo(candidate, { wideAcknowledged: false, filesPresent: true, nativePassed: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /wide capture acknowledgement/i);
});

test('transaction writes TCP then UDP then strategy options', () => {
  const calls = [];
  const state = { NFQWS2_PORTS_TCP: '80,443', NFQWS2_PORTS_UDP: '443', NFQWS2_OPT: 'old' };
  const result = applyComboTransaction(candidate, {
    wideAcknowledged: true,
    readConfig: () => JSON.stringify(state),
    restoreConfig: (raw) => Object.assign(state, JSON.parse(raw)),
    readVar: (name) => state[name],
    setVar: (name, value) => { calls.push(name); state[name] = value; return value; },
    applyOpt: (opt) => { calls.push('APPLY_OPT'); state.NFQWS2_OPT = opt; return { ok: true }; },
    restart: () => ({ ok: true }),
    verifyRuntime: () => ({ ok: true })
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['NFQWS2_PORTS_TCP', 'NFQWS2_PORTS_UDP', 'APPLY_OPT']);
});

test('every partial failure restores the complete original config', () => {
  const original = { NFQWS2_PORTS_TCP: '80,443', NFQWS2_PORTS_UDP: '443', NFQWS2_OPT: 'old' };
  for (const failAt of ['tcp', 'udp', 'opt', 'runtime']) {
    const state = structuredClone(original);
    const result = applyComboTransaction(candidate, {
      wideAcknowledged: true,
      readConfig: () => JSON.stringify(state),
      restoreConfig: (raw) => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, JSON.parse(raw)); },
      readVar: (name) => state[name],
      setVar: (name, value) => {
        if (failAt === 'tcp' && name === 'NFQWS2_PORTS_TCP') return null;
        if (failAt === 'udp' && name === 'NFQWS2_PORTS_UDP') return null;
        state[name] = value;
        return value;
      },
      applyOpt: (opt) => failAt === 'opt' ? { ok: false } : (state.NFQWS2_OPT = opt, { ok: true }),
      restart: () => ({ ok: true }),
      verifyRuntime: () => failAt === 'runtime' ? { ok: false } : { ok: true }
    });
    assert.equal(result.ok, false, failAt);
    assert.equal(result.rolledBack, true, failAt);
    assert.deepEqual(state, original, failAt);
  }
});
