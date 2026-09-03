#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [manifestPath = path.join(root, 'tests/fixtures/z2k-signed-update/UPDATES.json')] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const localRoot = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager');
const compilerInputs = [
  ['strats_new2.txt', 'official Z2K compiler'],
  ['quic_strats.ini', 'official Z2K compiler'],
  ['lib/utils.sh', 'official Z2K compiler'],
  ['lib/strategies.sh', 'official Z2K compiler'],
  ['lib/config_official.sh', 'official Z2K compiler'],
];

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function localPath(sourcePath) {
  if (sourcePath.startsWith('files/lua/')) return path.join(localRoot, 'runtime-assets/lua', sourcePath.slice('files/lua/'.length));
  if (sourcePath.startsWith('files/fake/')) return path.join(localRoot, 'runtime-assets/bin', sourcePath.slice('files/fake/'.length));
  if (sourcePath.startsWith('files/lists/')) return path.join(localRoot, 'runtime-assets/lists', sourcePath.slice('files/lists/'.length));
  return null;
}
function classify(sourcePath) {
  if (sourcePath === 'files/lua/z2k-state-persist.lua') return 'exact-managed';
  if (sourcePath === 'files/etc/z2k-update-pub.pem' || sourcePath === 'files/etc/z2k-roots.pem') return 'watched';
  if (/^files\/(lua|fake|lists)\//.test(sourcePath)) return 'exact-managed';
  if (/^(files\/(init\.d|ndm|webpanel)\/|lib\/|mtproxy-client\/|webpanel\/|z2k\.sh$)/.test(sourcePath)) return 'ignored-platform';
  if (/^files\/z2k-(config-validator|update-lists|geosite)\.sh$/.test(sourcePath)) return 'watched';
  return 'ignored-platform';
}
function reviewPolicy(sourcePath) {
  // These shell helpers are observed for upstream drift but are not consumed by
  // the Z2M runtime. Trust roots remain blocking because they change authority.
  if (sourcePath === 'files/etc/z2k-update-pub.pem' || sourcePath === 'files/etc/z2k-roots.pem') return 'blocking';
  if (/^files\/z2k-(config-validator|update-lists|geosite)\.sh$/.test(sourcePath)) return 'advisory';
  return 'blocking';
}
function dependencyClass(klass) {
  return klass === 'exact-managed' ? 'runtime-exact' : klass;
}
function entry(sourcePath, digest) {
  const klass = classify(sourcePath), local = localPath(sourcePath);
  const base = { sourcePath, class: klass, dependencyClass: dependencyClass(klass), type: path.extname(sourcePath).replace('.', '') || 'file', basedOnSha256: digest };
  if (klass === 'exact-managed') {
    base.localName = local ? path.relative(localRoot, local).replaceAll(path.sep, '/') : null;
    base.runtimeTarget = local ? '/' + base.localName : null;
    base.packageBaselinePath = local ? 'zapret2-manager/files/usr/share/zapret2-manager/' + base.localName : null;
    base.consumer = sourcePath.startsWith('files/lua/') ? 'Z2M runtime Lua asset resolver' : 'Z2M managed runtime asset resolver';
    base.requiredCapabilities = sourcePath.endsWith('z2k-modern-core.lua') ? ['Z2K_TLS_MOD'] : [];
  } else if (klass === 'adapted') {
    base.localPath = local ? 'zapret2-manager/files/usr/share/zapret2-manager/' + path.relative(localRoot, local).replaceAll(path.sep, '/') : null;
    base.localSha256 = local && fs.existsSync(local) ? sha256(local) : null;
    base.adaptationId = 'z2m-state-mode-contract-v1';
    base.adaptationReason = 'Z2M preserves auto/frozen/excluded state semantics and its own atomic persistence lifecycle.';
  } else if (klass === 'watched') {
    base.localName = local ? path.relative(localRoot, local).replaceAll(path.sep, '/') : null;
    base.consumer = sourcePath.includes('update-pub') ? 'pinned trust root audit' : 'upstream semantic review only';
    base.reviewPolicy = reviewPolicy(sourcePath);
  } else {
    base.consumer = 'not installed by Z2M; provenance only';
  }
  return base;
}

const files = Object.entries(manifest.files_sha256).map(([sourcePath, digest]) => entry(sourcePath, digest));
const output = {
  schema: 'zapret2-manager.z2k-integration.v2',
  source: { repository: 'necronicle/z2k', branch: manifest.branch, commit: '54b6765f2ab3e0f7f13030c90c809f1dcacfcce2', release: manifest.current, seq: manifest.seq },
  manifestSchema: manifest.schema,
  manifestFileCount: files.length,
  compilerInputs: compilerInputs.map(([sourcePath, consumer]) => ({
    sourcePath,
    class: 'compiler-input',
    dependencyClass: 'compiler-input',
    consumer,
    required: true,
    reviewPolicy: 'blocking',
  })),
  files
};
const destination = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ destination, fileCount: files.length, classes: files.reduce((a, x) => (a[x.class] = (a[x.class] || 0) + 1, a), {}) }, null, 2));
