import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TAG = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const match = TAG.match(/^v([0-9][0-9A-Za-z.]*)-r([0-9]+)-rc([1-9][0-9]*)$/);

function fail(message) {
  console.error(`RC tag check failed: ${message}`);
  process.exit(1);
}

if (!match) fail(`expected v<version>-r<release>-rc<N>, got ${TAG || '<empty>'}`);

const identities = [
  'zapret2-manager/Makefile',
  'luci-app-zapret2-manager/Makefile',
  'zapret2-manager-full/Makefile'
].map((relativePath) => {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  return {
    version: source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1],
    release: source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1]
  };
});

for (const identity of identities) {
  if (identity.version !== match[1] || identity.release !== match[2]) {
    fail(`tag ${TAG} does not match package identity ${identity.version}-r${identity.release}`);
  }
}

console.log(`RC tag ${TAG} matches all three manager packages`);
