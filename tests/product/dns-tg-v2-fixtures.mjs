import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, '..', 'fixtures', 'dns-tg-v2', 'target-baseline.json');

export function loadDnsTgBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

export function classifyProviderRpcRegistration({ sourcePresent, sourceSyntaxValid, ubusObjectPresent }) {
  if (sourcePresent && sourceSyntaxValid && ubusObjectPresent) return 'registered';
  if (sourcePresent && sourceSyntaxValid && !ubusObjectPresent) return 'stale_registration_or_deployment_gap';
  return 'packaging_or_deployment_gap';
}

const SECRET_KEY = /(?:secret|token|password|credential|private.?key|api.?key)/i;

export function assertNoSecretFields(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`secret-bearing field at ${location}.${key}`);
    assertNoSecretFields(child, `${location}.${key}`);
  }
}
