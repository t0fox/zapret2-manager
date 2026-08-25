'use strict';
'require baseclass';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }

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
  enrich: enrich
});
