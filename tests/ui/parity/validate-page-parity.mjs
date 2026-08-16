import fs from 'node:fs';

export const PAGE_STATUSES = new Set(['EXACT', 'ADAPTED_1TO1', 'PARTIAL', 'MISSING', 'BACKEND_NOT_READY']);
export const BEHAVIOR_STATUSES = new Set(['EXACT', 'PARITY', 'PARTIAL', 'MISSING', 'BACKEND_NOT_READY']);
export const BROWSER_VIEWPORTS = ['1280', '768', '390'];

function unique(values) {
  return [...new Set((values || []).map(String))];
}

export function validateManifest(manifest) {
  const errors = [];
  const donor = unique(manifest?.donor_sections);
  const z2m = unique(manifest?.z2m_sections);
  const extensions = new Set(unique(manifest?.intentional_extensions));
  const missing = donor.filter((section) => !z2m.includes(section));
  const extra = z2m.filter((section) => !donor.includes(section));
  const unexplained = extra.filter((section) => !extensions.has(section));

  if (manifest?.schema_version !== 1) errors.push('schema_version must be 1');
  for (const field of ['page_id', 'donor_sha', 'donor_files', 'z2m_files']) {
    if (manifest?.[field] == null || (Array.isArray(manifest[field]) && !manifest[field].length))
      errors.push(`missing required field: ${field}`);
  }
  if (!/^[0-9a-f]{40}$/.test(manifest?.donor_sha || '')) errors.push('donor_sha must be a 40-character lowercase git SHA');
  if (!PAGE_STATUSES.has(manifest?.visual_status)) errors.push('visual_status has an invalid status');
  for (const field of ['interaction_status', 'runtime_status'])
    if (!BEHAVIOR_STATUSES.has(manifest?.[field])) errors.push(`${field} has an invalid status`);
  if (missing.length) errors.push(`missing donor sections: ${missing.join(', ')}`);
  if (unexplained.length) errors.push(`unexplained extra sections: ${unexplained.join(', ')}`);
  if (manifest?.backend_supported === true && manifest?.runtime_status === 'BACKEND_NOT_READY')
    errors.push('BACKEND_NOT_READY is forbidden for a supported backend');
  if (manifest?.visual_status === 'PARTIAL' || manifest?.visual_status === 'MISSING')
    errors.push(`visual parity is ${manifest.visual_status}`);
  if (!['EXACT', 'PARITY'].includes(manifest?.interaction_status))
    errors.push(`interaction parity is ${manifest?.interaction_status || 'missing'}`);
  if (manifest?.backend_supported === true && manifest?.runtime_status !== 'PARITY' && manifest?.runtime_status !== 'EXACT')
    errors.push(`supported backend runtime is ${manifest?.runtime_status || 'missing'}`);

  for (const viewport of BROWSER_VIEWPORTS) {
    if (manifest?.browser?.[viewport] !== 'PASS') errors.push(`browser ${viewport}px evidence is not PASS`);
  }
  for (const check of ['console_errors', 'network_404', 'horizontal_overflow', 'clipped_controls', 'dead_controls']) {
    if (!Number.isInteger(manifest?.checks?.[check])) errors.push(`missing browser check: ${check}`);
    else if (manifest.checks[check] !== 0) errors.push(`${check} is ${manifest.checks[check]}, expected 0`);
  }
  if (manifest?.completion_status === 'DONE') errors.push('DONE is not a valid parity completion status');

  return {
    complete: errors.length === 0,
    errors,
    diff: {
      missing_donor_sections: missing,
      extra_z2m_sections: extra,
      unexplained_extra_sections: unexplained,
      intentional_extensions: [...extensions],
    },
  };
}

export function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (process.argv[1] && process.argv[1].endsWith('validate-page-parity.mjs')) {
  const index = process.argv.indexOf('--manifest');
  const file = index >= 0 ? process.argv[index + 1] : process.argv[2];
  if (!file) {
    console.error('usage: node validate-page-parity.mjs --manifest <file>');
    process.exitCode = 2;
  } else {
    const result = validateManifest(readManifest(file));
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) {
      console.error('NOT COMPLETE');
      process.exitCode = 1;
    } else console.log('COMPLETE');
  }
}
