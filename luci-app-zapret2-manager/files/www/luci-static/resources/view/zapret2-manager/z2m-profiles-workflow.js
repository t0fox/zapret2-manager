'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function drafts(value) { return Array.isArray(object(object(value).draft).profiles) ? value.draft.profiles : []; }

function createState() {
  return { busy: false, preview: null, replaceFullSet: false };
}

function invalidate(state) {
  state.preview = null;
  state.replaceFullSet = false;
}

function runMutation(state, request) {
  if (state.busy) return Promise.resolve({ skipped: true });
  state.busy = true;
  return Promise.resolve().then(request).then(function (answer) {
    if (!answer || answer.ok !== true) throw answer || new Error('profile mutation failed');
    invalidate(state);
    return answer;
  }).then(function (answer) {
    state.busy = false;
    return answer;
  }, function (error) {
    state.busy = false;
    throw error;
  });
}

function buildReorderRequest(read, movedId, offset) {
  return Promise.resolve().then(read).then(function (latest) {
    var profiles = drafts(latest);
    var index = profiles.map(function (profile) { return profile.id; }).indexOf(movedId);
    var swap = index + offset;
    if (index < 0 || swap < 0 || swap >= profiles.length)
      throw { code: 'ESTATE', message: 'profile order changed' };
    var ids = profiles.map(function (profile) { return profile.id; });
    var revisions = {};
    profiles.forEach(function (profile) { revisions[profile.id] = profile.revision; });
    ids[index] = ids[swap];
    ids[swap] = movedId;
    return { ids: ids, revisions: revisions };
  });
}

function capture(promise, key) {
  return Promise.resolve(promise).then(function (value) {
    var result = {};
    result[key] = value;
    return result;
  }, function (error) {
    var result = {};
    result[key + 'Error'] = error;
    return result;
  });
}

function applyAndReread(apply, readProfiles, readStatus) {
  return Promise.resolve().then(apply).then(
    function (answer) { return { answer: answer, rejected: false }; },
    function (error) { return { answer: error, rejected: true }; }
  ).then(function (settlement) {
    return Promise.all([
      capture(Promise.resolve().then(readProfiles), 'applied'),
      capture(Promise.resolve().then(readStatus), 'status')
    ]).then(function (reads) {
      return Object.assign(settlement, reads[0], reads[1]);
    });
  });
}

function verifyAppliedResult(expected, reads) {
  var applied = object(reads.applied);
  var appliedBlock = object(applied.applied);
  var runtime = object(object(reads.status).runtime);
  var actualHash = appliedBlock.optSha256 || object(appliedBlock.source).optSha256 ||
    applied.optSha256 || object(applied.source).optSha256;
  var actualCount = runtime.profileCount;
  var ok = actualHash === expected.candidateSha256 && actualCount === expected.profiles;
  return { ok: ok, expectedHash: expected.candidateSha256, actualHash: actualHash,
    expectedProfiles: expected.profiles, actualProfiles: actualCount };
}

function compatibilityPane(current) {
  return current === 'compatibility' ? 'compatibility' : 'list';
}

return baseclass.extend({
  createState: createState,
  invalidate: invalidate,
  runMutation: runMutation,
  buildReorderRequest: buildReorderRequest,
  applyAndReread: applyAndReread,
  verifyAppliedResult: verifyAppliedResult,
  compatibilityPane: compatibilityPane
});
