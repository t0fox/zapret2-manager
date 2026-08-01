import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const run = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc', 'utf8');
const worker = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-worker-control.uc', 'utf8');
const ui = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js', 'utf8');
const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');

test('continuation keeps the same run id and increments lineage', () => { assert.match(run, /orchestra_run_continue[\s\S]*continuationCount=\(r\.continuationCount\|\|0\)\+1/); });
test('continuation preserves evidence and derives target cursor from results', () => { assert.match(run, /service_progress\(r,snap\.profiles\)/); assert.match(run, /r\.results=\[\]/); });
test('duplicate exclusion is target scoped', () => { assert.match(worker, /done\(r,scope\.domain,c\.id,proto,attempt\)/); });
test('a candidate may be tested for another target', () => { assert.match(worker, /scope\.domain/); assert.match(worker, /targetProgress/); });
test('continuation restores the first target without a winner', () => { assert.match(worker, /for\(let scope in scopes\)/); assert.match(worker, /target_winner\(r,scope\.domain\)/); });
test('confirmed winner stops the target scan', () => { assert.match(worker, /function target_winner/); assert.match(worker, /if\(target_winner\(r,scope\.domain\)\)continue/); });
test('worker advances targets deterministically', () => { assert.match(worker, /for\(let scope in scopes\) \{/); });
test('bounded timeout is partial and continuable', () => { assert.match(worker, /r\.phase='partial';r\.continuable=true/); });
test('completed corpus marks no-winner exhaustion without fallback', () => { assert.match(run, /tp\.exhausted=true;tp\.failureReason='no-winner'/); assert.match(run, /'failed'/); });
test('manifest digest mismatch is ESTALE', () => { assert.match(run, /sm\.digest!=r\.manifestDigest.*ESTALE/); });
test('registry digest mismatch is ESTALE', () => { assert.match(run, /snap\.digest!=r\.candidateRegistryDigest.*ESTALE/); });
test('active worker blocks double continuation', () => { assert.match(run, /worker_matches\(r\)\|\|active\(\)/); });
test('interruption cursor is persisted atomically', () => { assert.match(worker, /note_progress\(r,scope,chosen\)/); assert.match(run, /save\(r\)/); });
test('bounded cleanup removes controls', () => { assert.match(worker, /clear_controls\(id\)/); });
test('UI sends only run id and timeout', () => { assert.match(ui, /runContinueRpc/); assert.match(ui, /pack\(\{ runId: run\.runId, additionalTimeoutSec: 900 \}\)/); assert.doesNotMatch(ui, /runContinueRpc[\s\S]{0,300}candidate/); });
test('RPC is registered and existing service Apply remains gated by ready', () => { assert.match(rpc, /orchestra_run_continue/); assert.match(ui, /run\.phase === 'completed' && run\.serviceVerdict === 'ready'/); });
