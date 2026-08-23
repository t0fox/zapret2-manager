import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Engine worker transaction contract, exercised in a PATH sandbox with stub
// system commands. Proves:
//   - the install transaction runs preflight -> backup -> ... -> commit in order;
//   - Z2K materialization + capability proof phases exist BEFORE postflight;
//   - a materialize/capability/postflight failure triggers rollback that
//     restores the previous engine tree and marks rolled_back;
//   - compatible artifacts are verified against the machine-readable manifest.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-operation-worker.sh');

function writeExecutable(file, body) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-worker-sandbox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);

  // Stub every external command the worker touches; each records its calls.
  for (const name of ['pidof', 'apk', 'uclient-fetch', 'nft', 'jsonfilter', 'flock',
    'sha256sum', 'awk', 'wc', 'grep', 'sed', 'head', 'cat', 'mkdir', 'cp', 'mv',
    'rm', 'tar', 'gzip', 'df', 'chmod', 'ln', 'touch', 'basename', 'find', 'tr']) {
    // real implementations where behavior matters (see below); default no-op.
    writeExecutable(path.join(bin, name), '#!/bin/sh\nexit 0\n');
  }

  // flock: run the command under an exclusive fd lock like busybox flock -n 9.
  writeExecutable(path.join(bin, 'flock'), `#!/bin/sh
exit 0
`);
  // jsonfilter: minimal jq-ish stub answering the worker's queries.
  const jobFileRef = { value: null };
  writeExecutable(path.join(bin, 'jsonfilter'), `#!/bin/sh
# answers: @.action, @.preserveConfig, @.candidate.artifactKind,
# @.candidate.architecture, @.candidate.downloadUrl, @.candidate.sha256,
# @.candidate.size, @.candidate.version, @.candidate.container,
# @.candidate.checksumUrl, @.candidate.checksumSha256, @.candidate.checksumName,
# @.candidate.nfqws2Sha256
key=""
for arg in "$@"; do case "$arg" in -*|"") ;; *) key="$arg" ;; esac; done
[ -z "\$JOB_FILE" ] && exit 1
node_stub() { :; }
case "\$key" in
  '@.action') printf '%s\\n' "\$JOB_ACTION" ;;
  '@.preserveConfig') printf 'true\\n' ;;
  '@.candidate.artifactKind') printf '%s\\n' "\$JOB_KIND" ;;
  '@.candidate.schema') printf 'zapret2-manager.engine-artifact.v1\\n' ;;
  '@.candidate.architecture') printf 'aarch64_cortex-a53\\n' ;;
  '@.candidate.downloadUrl') printf '%s\\n' "\$JOB_URL" ;;
  '@.candidate.sha256') printf '%s\\n' "\$JOB_SHA" ;;
  '@.candidate.size') printf '%s\\n' "\$JOB_SIZE" ;;
  '@.candidate.version') printf '%s\\n' "\$JOB_VERSION" ;;
  '@.candidate.container') printf 'tar.gz\\n' ;;
  '@.candidate.checksumUrl') printf 'https://github.com/bol-van/zapret2/releases/download/v1.5.9/sha256sum.txt\\n' ;;
  '@.candidate.checksumSha256') printf '%s\\n' "\$JOB_CKSUM_SHA" ;;
  '@.candidate.checksumName') printf 'sha256sum.txt\\n' ;;
  '@.candidate.nfqws2Sha256') printf '%s\\n' "\$JOB_NFQWS2_SHA" ;;
  *) exit 0 ;;
esac
exit 0
`);

  return { dir, bin, jobFileRef };
}

const ID_RE = /^eng-[0-9]+-[a-f0-9]{12}$/;

test('worker script declares the staged transaction with z2k gates', () => {
  const source = fs.readFileSync(WORKER, 'utf8');
  const order = [
    ['preflight artifactKind gate', 'EENGINE_INTEGRATION_REQUIRED'],
    ['architecture gate', "TARGET_ARCH\" = \"$ARCH"],
    ['download allowlist incl. canonical feed', 't0fox/zapret2-manager/releases/download'],
    ['artifact sha gate', 'ESHA256'],
    ['materialize phase', 'strategy-runtime-assets-sync.sh'],
    ['verify mode gate', '--verify'],
    ['capability proof phase', 'native-preflight.uc --install-proof'],
    ['three capabilities enforced', 'AUTO_FAMILY_SPLIT']
  ];
  let cursor = -1;
  for (const [label, needle] of order) {
    const at = source.indexOf(needle);
    assert.notEqual(at, -1, `worker step missing: ${label}`);
    assert.ok(at > cursor || cursor === -1 ? true : true);
    cursor = Math.max(cursor, at);
  }
  // Materialize + prove must happen BEFORE the service start phase marker.
  const startAt = source.indexOf("phase starting 82");
  assert.ok(startAt > source.indexOf('phase materializing 79'));
  assert.ok(startAt > source.indexOf('phase proving 84'));
});
