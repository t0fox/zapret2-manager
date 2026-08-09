import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

function entryType(value) {
  if (value.isFile()) return 'file';
  if (value.isDirectory()) return 'directory';
  if (value.isSymbolicLink()) return 'symlink';
  return 'other';
}

function snapshotTarget(targetPath) {
  try {
    const stat = lstatSync(targetPath);
    const snapshot = { type: entryType(stat), mode: stat.mode & 0o7777 };
    if (snapshot.type === 'file') snapshot.bytes = readFileSync(targetPath);
    return snapshot;
  } catch (error) {
    if (error.code === 'ENOENT') return { type: 'absent' };
    throw error;
  }
}

function snapshotParent(targetPath) {
  const parentPath = dirname(targetPath);
  try {
    const entries = readdirSync(parentPath, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, type: entryType(entry) }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    return { type: 'directory', entries };
  } catch (error) {
    if (error.code === 'ENOENT') return { type: 'absent', entries: [] };
    throw error;
  }
}

export function snapshotAtomicWriteJsonFilesystem(targetPath) {
  return { target: snapshotTarget(targetPath), parent: snapshotParent(targetPath) };
}

function captureResult(response) {
  const value = response?.ok ? response.data : response?.error;
  return {
    code: response?.ok ? null : value?.code ?? null,
    stage: response?.ok ? null : value?.stage ?? null,
    committed: value?.committed ?? null,
    durability: value?.durability ?? null,
  };
}

export function runAtomicWriteJsonCases(cases, invoke) {
  return cases.map((testCase) => {
    const before = snapshotAtomicWriteJsonFilesystem(testCase.targetPath);
    const run = invoke(testCase.request);
    const after = snapshotAtomicWriteJsonFilesystem(testCase.targetPath);
    const canonicalBytes = after.target.type === 'file' ? after.target.bytes : null;
    const observation = {
      id: testCase.id,
      run,
      before,
      after,
      canonicalBytes,
      result: captureResult(run?.response),
    };
    if (testCase.expected?.canonicalBytes !== undefined)
      assert.deepEqual(canonicalBytes, Buffer.from(testCase.expected.canonicalBytes), `${testCase.id}: canonical bytes`);
    if (testCase.expected?.result)
      assert.deepEqual(observation.result, testCase.expected.result, `${testCase.id}: result`);
    if (testCase.expected?.filesystemUnchanged)
      assert.deepEqual(after, before, `${testCase.id}: filesystem changed`);
    return observation;
  });
}
