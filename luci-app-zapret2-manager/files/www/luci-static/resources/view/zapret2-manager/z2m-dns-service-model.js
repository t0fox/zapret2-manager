'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function normalizeServiceSelectionValue(value) {
  return value == null || value === '' || value === 'off' ? '' : value;
}
function normalizeServiceSelectionMap(value) {
  var source = object(value), result = {};
  Object.keys(source).forEach(function (serviceId) {
    result[serviceId] = normalizeServiceSelectionValue(source[serviceId]);
  });
  return result;
}
function sameServiceSelections(left, right) {
  var a = normalizeServiceSelectionMap(left), b = normalizeServiceSelectionMap(right), ids = Object.keys(a).concat(Object.keys(b)), seen = {};
  for (var i = 0; i < ids.length; i++) {
    var serviceId = ids[i];
    if (seen[serviceId]) continue;
    seen[serviceId] = true;
    if (normalizeServiceSelectionValue(a[serviceId]) !== normalizeServiceSelectionValue(b[serviceId])) return false;
  }
  return true;
}
function configuredServiceSelectionCount(value) {
  var selections = normalizeServiceSelectionMap(value);
  return Object.keys(selections).filter(function (serviceId) { return selections[serviceId] !== ''; }).length;
}
var SERVICE_APPLY_PHASES = ['checking', 'validating', 'saving', 'applying', 'verifying'];
function serviceApplyProgress(phase) {
  var value = String(phase || '').toLowerCase();
  var index = SERVICE_APPLY_PHASES.indexOf(value);
  if (value === 'success') return { phase: value, index: SERVICE_APPLY_PHASES.length, terminal: true, ok: true };
  if (value === 'error') return { phase: value, index: -1, terminal: true, ok: false };
  return index < 0 ? { phase: 'idle', index: -1, terminal: false, ok: null } :
    { phase: value, index: index, terminal: false, ok: null };
}
function verifyServiceDnsApply(desired, status, expectedRevision) {
  var applied = status && status.applied;
  var hasApplied = applied && typeof applied === 'object' && !Array.isArray(applied);
  var requestedUi = normalizeServiceSelectionMap(desired);
  var appliedUi = normalizeServiceSelectionMap(applied);
  var revisionMatches = expectedRevision == null || status && status.appliedRevision != null && String(status.appliedRevision) === String(expectedRevision);
  var ok = hasApplied === true && sameServiceSelections(appliedUi, requestedUi) && revisionMatches === true;
  return { ok: ok, code: ok ? null : 'E_VERIFY', requested: requestedUi, applied: appliedUi, revisionMatches: revisionMatches === true };
}
function commitServiceDnsApply(state, desired, status, expectedRevision) {
  var verification = verifyServiceDnsApply(desired, status, expectedRevision);
  if (!verification.ok) return { ok: false, code: verification.code, verification: verification };
  var next = Object.assign({}, state || {});
  next.serviceBaseline = verification.applied;
  next.selections = Object.assign({}, verification.applied);
  next.serviceBaselineRevision = status && status.appliedRevision != null ? String(status.appliedRevision) :
    status && status.draftRevision != null ? String(status.draftRevision) : null;
  return { ok: true, state: next, verification: verification };
}

function enrich(data) {
  data = data || {};
  var envelope = data.serviceProviders || {};
  var value = object(envelope.value);
  var profiles = array(value.profiles);
  var providers = array(value.providers);
  if (!profiles.length) return data;
  var providerNames = {};
  providers.forEach(function (provider) {
    if (provider && provider.id) providerNames[provider.id] = provider.name || provider.label || provider.id;
  });
  var options = profiles.map(function (profile) {
    var domains = array(profile.requiredDomains);
    return Object.assign({}, profile, {
      id: profile.id,
      name: profile.name || profile.label ||
        String(profile.serviceId || profile.id) + ' · ' + String(providerNames[profile.providerId] || profile.providerId || ''),
      notes: domains.length ? domains.join(', ') : profile.notes
    });
  });
  envelope.value = Object.assign({}, value, { resolverProviders: providers, providers: options });
  data.serviceProviders = envelope;

  var serviceEnvelope = data.service || {};
  var status = object(serviceEnvelope.value);
  var services = object(status.services);
  profiles.forEach(function (profile) {
    var id = profile && profile.serviceId;
    if (!id || services[id]) return;
    services[id] = { id: id, name: profile.serviceName || profile.serviceLabel || id };
  });
  serviceEnvelope.value = Object.assign({}, status, { services: services });
  data.service = serviceEnvelope;
  return data;
}

return baseclass.extend({
  object: object,
  array: array,
  normalizeServiceSelectionValue: normalizeServiceSelectionValue,
  normalizeServiceSelectionMap: normalizeServiceSelectionMap,
  sameServiceSelections: sameServiceSelections,
  configuredServiceSelectionCount: configuredServiceSelectionCount,
  serviceApplyProgress: serviceApplyProgress,
  verifyServiceDnsApply: verifyServiceDnsApply,
  commitServiceDnsApply: commitServiceDnsApply,
  enrich: enrich
});
