const mutations = new Set(['atomic_write', 'atomic_write_json', 'mkdir_private', 'rename_owned', 'unlink_owned']);

export function classifyHelperTransport({ operation, exitCode, response }) {
  if (exitCode !== 74 && response !== null) return null;
  if (mutations.has(operation)) {
    return { code: 'EDEPENDENCY', commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile' };
  }
  return { code: 'EDEPENDENCY', commitState: 'not_applicable', automaticRetry: false, recovery: 'none' };
}
