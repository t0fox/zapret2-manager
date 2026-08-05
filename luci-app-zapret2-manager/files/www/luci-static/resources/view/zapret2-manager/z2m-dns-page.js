'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-runtime-guards as Guards';
'require view.zapret2-manager.z2m-dns as Dns';

Guards.install(Api);

var SERVICE_TERMINAL = ['success','completed','applied','failed','error','rolled-back','cancelled','canceled','stopped'];

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function same(left, right) { return JSON.stringify(left || {}) === JSON.stringify(right || {}); }
function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function dnsRevision(value) {
  value = object(value);
  return value.revision != null ? value.revision : object(value.draft).revision != null ? object(value.draft).revision : null;
}
function serviceStatus(data) { return object(data && data.service && data.service.value); }
function selectionMap(status, applied) {
  status = object(status);
  var source = applied ? object(status.applied).selections || status.applied :
    status.selections || status.mappings || status.services || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.profileId || item.providerId || item.provider || item.dns || '';
  });
  else Object.keys(object(source)).forEach(function (id) {
    var item = source[id];
    result[id] = typeof item === 'string' ? item : item &&
      (item.profileId || item.providerId || item.provider || item.dns) || '';
  });
  return result;
}
function serviceSelections(data, changes) {
  var result = selectionMap(serviceStatus(data), false);
  Object.keys(object(changes)).forEach(function (id) {
    var change = object(changes[id]);
    result[id] = change.after == null ? '' : String(change.after);
  });
  return result;
}
function profilesFrom(data) {
  return array(object(data && data.serviceProviders && data.serviceProviders.value).profiles);
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
        String(profile.serviceId || profile.id) + ' Â· ' + String(providerNames[profile.providerId] || profile.providerId || ''),
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
function combinedDraft(current, patch, data) {
  var next = clone(object(current));
  if (patch.entries) next.entries = clone(patch.entries);
  if (patch.serviceDns) next.serviceDns = clone(patch.serviceDns);
  next.changes = Object.assign({}, object(next.changes), object(patch.changes));
  var dns = data && data.dns && data.dns.value || {};
  next.expectedRevision = dnsRevision(dns);
  next.applicable = patch.applicable !== false;
  next.blocker = patch.blocker || null;
  return next;
}
function wrapStore(store) {
  var proxy = {};
  Object.keys(store || {}).forEach(function (key) {
    proxy[key] = typeof store[key] === 'function' ? store[key].bind(store) : store[key];
  });
  proxy.get = function () {
    var snapshot = store.get();
    var result = Object.assign({}, snapshot);
    result.draft = Object.assign({}, snapshot.draft || {});
    var dns = clone(object(result.draft.dns));
    if (dns.serviceDns && dns.serviceDns.changes)
      result.draft['service-dns'] = { changes: clone(dns.serviceDns.changes) };
    return result;
  };
  return proxy;
}
function wrap(ctx) {
  return Object.assign({}, ctx, {
    store: wrapStore(ctx.store),
    setDraft: function (scope, value) {
      var current = ctx.store.get().draft && ctx.store.get().draft.dns || {};
      if (scope === 'service-dns') {
        var changes = object(value).changes;
        var selections = serviceSelections(ctx.data, changes);
        var currentService = object(current.serviceDns);
        var baseline = currentService.baseline || selectionMap(serviceStatus(ctx.data), false);
        var draftRevision = serviceStatus(ctx.data).draftRevision;
        return ctx.setDraft('dns', combinedDraft(current, {
          serviceDns: {
            selections: selections,
            baseline: clone(baseline),
            changes: clone(changes),
            expectedDraftRevision: currentService.expectedDraftRevision != null
              ? currentService.expectedDraftRevision : draftRevision
          },
          changes: {
            serviceDns: {
              label: _('DNS ÑĞµÑ€Ğ²Ğ¸ÑĞ¾Ğ²'),
              before: clone(baseline),
              after: clone(selections)
            }
          },
          applicable: true,
          blocker: null
        }, ctx.data));
      }
      return ctx.setDraft('dns', combinedDraft(current, value || {}, ctx.data));
    },
    clearDraft: function (scope) {
      if (scope === 'service-dns') {
        var current = clone(object(ctx.store.get().draft && ctx.store.get().draft.dns));
        delete current.serviceDns;
        if (current.changes) delete current.changes.serviceDns;
        if (Object.keys(object(current.changes)).length) ctx.setDraft('dns', current);
        else ctx.clearDraft('dns');
        return;
      }
      return ctx.clearDraft(scope);
    }
  });
}
function serviceChanged(value) { return !!(value && value.serviceDns && Object.keys(object(value.serviceDns.changes)).length); }
function manualChanged(value) { return !!(value && (value.entries || object(value.changes).entries)); }
function serviceFailure(answer, fallback) {
  if (answer && answer.ok === true) return null;
  var error = answer && answer.error || answer || {};
  return {
    code: error.code || answer && answer.code || 'E_SERVICE_DNS',
    message: error.message || error.detail || answer && answer.message || fallback
  };
}
function validateService(api, service) {
  if (!api.dns || typeof api.dns.serviceProviders !== 'function')
    return Promise.resolve({ ok: false, message: _('Backend Service DNS Ğ½ĞµĞ´Ğ¾ÑÑ‚ÑƒĞ¿ĞµĞ½.') });
  return api.dns.serviceProviders().then(function (answer) {
    var failure = serviceFailure(answer, _('ĞšĞ°Ñ‚Ğ°Ğ»Ğ¾Ğ³ Service DN²È="24¤¤ì(€€€¥˜€¡™…¥±ÕÉ”¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è™…¥±ÕÉ”¹µ•ÍÍ…”ôì(€€€Ù…È­¹½İ¸€ôíôì(€€€…ÉÉ…ä¡…¹Íİ•È¹ÁÉ½™¥±•Ì¤¹™½É… ¡™Õ¹Ñ¥½¸€¡ÁÉ½™¥±”¤ì¥˜€¡ÁÉ½™¥±”€˜˜ÁÉ½™¥±”¹¥¤­¹½İ¹mÁÉ½™¥±”¹¥‘t€ôÑÉÕ”ìô¤ì(€€€Ù…ÈÕ¹­¹½İ¸€ô=‰©•Ğ¹­•åÌ¡½‰©•Ğ¡Í•ÉÙ¥”¹Í•±•Ñ¥½¹Ì¤¤¹™¥±Ñ•È¡™Õ¹Ñ¥½¸€¡¥¤ì(€€€€€Ù…ÈÍ•±•Ñ•€ôÍ•ÉÙ¥”¹Í•±•Ñ¥½¹Ím¥‘tì(€€€€€É•ÑÕÉ¸Í•±•Ñ•€˜˜Í•±•Ñ•€„ôô€½™˜œ€˜˜€…­¹½İ¹mÍ•±•Ñ•‘tì(€€€ô¤ì(€€€É•ÑÕÉ¸Õ¹­¹½İ¸¹±•¹Ñ (€€€€€€üì½¬è™…±Í”°µ•ÍÍ…”è| ŸBwB×BãBßBËB×FFB÷F/Bä9L·BÿFBûFBãBïF0ƒBÓBïF<ƒFB×FBËBãFBÀè€œ¤€¬Õ¹­¹½İ¸¹©½¥¸ œ°€œ¤ô(€€€€€€èì½¬èÑÉÕ”ôì(€ô¤ì)ô)™Õ¹Ñ¥½¸É•ÅÕ•ÍÑ% ¤ì(€¥˜€¡ÑåÁ•½˜ÉåÁÑ¼€„ôô€Õ¹‘•™¥¹•œ€˜˜ÑåÁ•½˜ÉåÁÑ¼¹É…¹‘½µUU%€ôôô€™Õ¹Ñ¥½¸œ¤(€€€É•ÑÕÉ¸€Í•ÉÙ¥”µ‘¹Ì´œ€¬ÉåÁÑ¼¹É…¹‘½µUU% ¤ì(€É•ÑÕÉ¸€Í•ÉÙ¥”µ‘¹Ì´œ€¬…Ñ”¹¹½Ü ¤€¬€œ´œ€¬5…Ñ ¹™±½½È¡5…Ñ ¹É…¹‘½´ ¤€¨€ÄÀÀÀÀÀÀ¤ì)ô)™Õ¹Ñ¥½¸Ñ•Éµ¥¹…°¡½Á•É…Ñ¥½¸¤ì(€Ù…ÈÁ¡…Í”€ôMÑÉ¥¹œ¡½Á•É…Ñ¥½¸€˜˜€¡½Á•É…Ñ¥½¸¹Á¡…Í”ñğ½Á•É…Ñ¥½¸¹ÍÑ…Ñ”ñğ½Á•É…Ñ¥½¸¹ÍÑ…ÑÕÌ¤ñğ€œœ¤¹Ñ½1½İ•É…Í” ¤ì(€É•ÑÕÉ¸½Á•É…Ñ¥½¸€˜˜½Á•É…Ñ¥½¸¹™¥¹¥Í¡•€ôôôÑÉÕ”ñğMIY%}QI5%90¹¥¹‘•á=˜¡Á¡…Í”¤€øô€Àì)ô)™Õ¹Ñ¥½¸ÍÕ••‘•¡½Á•É…Ñ¥½¸¤ì(€Ù…ÈÁ¡…Í”€ôMÑÉ¥¹œ¡½Á•É…Ñ¥½¸€˜˜€¡½Á•É…Ñ¥½¸¹Á¡…Í”ñğ½Á•É…Ñ¥½¸¹ÍÑ…Ñ”ñğ½Á•É…Ñ¥½¸¹ÍÑ…ÑÕÌ¤ñğ€œœ¤¹Ñ½1½İ•É…Í” ¤ì(€É•ÑÕÉ¸½Á•É…Ñ¥½¸€˜˜½Á•É…Ñ¥½¸¹½¬€„ôô™…±Í”€˜˜€¡Á¡…Í”€ôôô€ÍÕ•ÍÌœñğÁ¡…Í”€ôôô€½µÁ±•Ñ•œñğÁ¡…Í”€ôôô€…ÁÁ±¥•œ¤ì)ô)™Õ¹Ñ¥½¸Á½±±M•ÉÙ¥”¡…Á¤°½Á•É…Ñ¥½¹%°‘•…‘±¥¹”¤ì(€¥˜€¡…Ñ”¹¹½Ü ¤€øô‘•…‘±¥¹”¤(€€€É•ÑÕÉ¸AÉ½µ¥Í”¹É•©•Ğ¡ì½‘”è€Q%5=UPœ°µ•ÍÍ…”è| ŸBFBãBóB×B÷B×B÷BãBÔM•ÉÙ¥”9LƒB÷BÔƒBßBÃBËB×FF#BãBïBûFF0ƒBßBÀ€ÄÈÀƒFB×BëFB÷BĞ¸œ¤ô¤ì(€É•ÑÕÉ¸•‘¥Ğ¡…Á¤¹‘¹Ì¹Í•ÉÙ¥•ÁÁ±åMÑ…ÑÕÌ°ì½Á•É…Ñ¥½¹%è½Á•É…Ñ¥½¹%ô¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡…¹Íİ•È¤ì(€€€Ù…È™…¥±ÕÉ”€ôÍ•ÉÙ¥•…¥±ÕÉ”¡…¹Íİ•È°| ŸBwBÔƒFBÓBÃBïBûFF0ƒBÿFBûFBãFBÃFF0ƒFBûFFBûF?B÷BãBÔM•ÉÙ¥”9LƒBûBÿB×FBÃFBãBà¸œ¤¤ì(€€€¥˜€¡™…¥±ÕÉ”¤Ñ¡É½Ü™…¥±ÕÉ”ì(€€€Ù…È½Á•É…Ñ¥½¸€ô…¹Íİ•È¹½Á•É…Ñ¥½¸ñğ…¹Íİ•Èì(€€€¥˜€¡Ñ•Éµ¥¹…°¡½Á•É…Ñ¥½¸¤¤ì(€€€€€¥˜€ …ÍÕ••‘•¡½Á•É…Ñ¥½¸¤¤Ñ¡É½Ü½Á•É…Ñ¥½¸¹•ÉÉ½Èñğì(€€€€€€€½‘”è€}MIY%}9M}AA1dœ°µ•ÍÍ…”è| M•ÉÙ¥”9LƒBßBÃBËB×FF#BãBïFF<ƒFƒBûF#BãBÇBëBûBä¸œ¤(€€€€€ôì(€€€€€É•ÑÕÉ¸½Á•É…Ñ¥½¸ì(€€€ô(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í”¡™Õ¹Ñ¥½¸€¡É•Í½±Ù”¤ìİ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕĞ¡É•Í½±Ù”°€ÄÔÀÀ¤ìô¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€ ¤ì(€€€€€É•ÑÕÉ¸Á½±±M•ÉÙ¥”¡…Á¤°½Á•É…Ñ¥½¹%°‘•…‘±¥¹”¤ì(€€€ô¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸…ÁÁ±åM•ÉÙ¥”¡…Á¤°Í•ÉÙ¥”¤ì(€É•ÑÕÉ¸…Á¤¹‘¹Ì¹Í•ÉÙ¥•MÑ…ÑÕÌ ¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡‰•™½É”¤ì(€€€Ù…È™…¥±ÕÉ”€ôÍ•ÉÙ¥•…¥±ÕÉ”¡‰•™½É”°| ŸB‡BûFFBûF?B÷BãBÔM•ÉÙ¥”9LƒB÷B×BÓBûFFFBÿB÷Bø¸œ¤¤ì(€€€¥˜€¡™…¥±ÕÉ”¤Ñ¡É½Ü™…¥±ÕÉ”ì(€€€¥˜€¡Í•ÉÙ¥”¹•áÁ•Ñ•‘É…™ÑI•Ù¥Í¥½¸€„ô¹Õ±°€˜˜MÑÉ¥¹œ¡‰•™½É”¹‘É…™ÑI•Ù¥Í¥½¸¤€„ôôMÑÉ¥¹œ¡Í•ÉÙ¥”¹•áÁ•Ñ•‘É…™ÑI•Ù¥Í¥½¸¤¤(€€€€€Ñ¡É½Üì½‘”è€=91%Pœ°µ•ÍÍ…”è| ŸBŸB×FB÷BûBËBãBèM•ÉÙ¥”9LƒBãBßBóB×B÷BãBïFF<ƒBÈƒBÓFFBÏBûBğƒFB×BÃB÷FBÔ¸œ¤ôì(€€€É•ÑÕÉ¸•‘¥Ğ¡…Á¤¹‘¹Ì¹Í•ÉÙ¥•M•Ğ°ìÍ•±•Ñ¥½¹ÌèÍ•ÉÙ¥”¹Í•±•Ñ¥½¹Ìô¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡Í•Ñ¹Íİ•È¤ì(€€€€€Ù…ÈÍ•Ñ…¥±ÕÉ”€ôÍ•ÉÙ¥•…¥±ÕÉ”¡Í•Ñ¹Íİ•È°| ŸBwBÔƒFBÓBÃBïBûFF0ƒFBûFFBÃB÷BãFF0ƒFB×FB÷BûBËBãBèM•ÉÙ¥”9L¸œ¤¤ì(€€€€€¥˜€¡Í•Ñ…¥±ÕÉ”¤Ñ¡É½ÜÍ•Ñ…¥±ÕÉ”ì(€€€€€Ù…ÈÉ•Ù¥Í¥½¸€ôÍ•Ñ¹Íİ•È¹‘É…™ÑI•Ù¥Í¥½¸ì(€€€€€É•ÑÕÉ¸…Á¤¹‘¹Ì¹Í•ÉÙ¥•AÉ•Ù¥•Ü ¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡ÁÉ•Ù¥•Ü¤ì(€€€€€€€Ù…ÈÁÉ•Ù¥•İ…¥±ÕÉ”€ôÍ•ÉÙ¥•…¥±ÕÉ”¡ÁÉ•Ù¥•Ü°| i•É¼µİÉ¥Ñ”ÁÉ•Ù¥•ÜM•ÉÙ¥”9LƒBûFBëBïBûB÷FGBô¸œ¤¤ì(€€€€€€€¥˜€¡ÁÉ•Ù¥•İ…¥±ÕÉ”ñğÁÉ•Ù¥•Ü¹é•É½]É¥Ñ•Ì€„ôôÑÉÕ”ñğ€…ÁÉ•Ù¥•Ü¹ÁÉ•½¹‘¥Ñ¥½¸ñğ(€€€€€€€€€€€MÑÉ¥¹œ¡ÁÉ•Ù¥•Ü¹ÁÉ•½¹‘¥Ñ¥½¸¹‘É…™ÑI•Ù¥Í¥½¸¤€„ôôMÑÉ¥¹œ¡É•Ù¥Í¥½¸¤¤ì(€€€€€€€€€Ù…ÈÉ•…Í½¸€ôÁÉ•Ù¥•İ…¥±ÕÉ”ñğì½‘”è€}AIY%\œ°µ•ÍÍ…”è| AÉ•Ù¥•ÜƒB÷BÔƒBÿBûBÓFBËB×FBÓBãBìƒFBûFB÷FF8ƒFB×BËBãBßBãF8M•ÉÙ¥”9L¸œ¤ôì(€€€€€€€€€É•ÑÕÉ¸•‘¥Ğ¡…Á¤¹‘¹Ì¹Í•ÉÙ¥•M•Ğ°ìÍ•±•Ñ¥½¹ÌèÍ•ÉÙ¥”¹‰…Í•±¥¹”ñğíôô¤¹…Ñ ¡™Õ¹Ñ¥½¸€ ¤íô¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€€€€€Ñ¡É½ÜÉ•…Í½¸ì(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€Ù…È½Á•É…Ñ¥½¹%€ôÉ•ÅÕ•ÍÑ% ¤ì(€€€€€€€É•ÑÕÉ¸•‘¥Ğ¡…Á¤¹‘¹Ì¹Í•ÉÙ¥•ÁÁ±åÍå¹Œ°ì½Á•É…Ñ¥½¹%è½Á•É…Ñ¥½¹%°‘É…™ÑI•Ù¥Í¥½¸èÉ•Ù¥Í¥½¸ô¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡ÍÑ…ÉĞ¤ì(€€€€€€€€€Ù…ÈÍÑ…ÉÑ…¥±ÕÉ”€ôÍ•ÉÙ¥•…¥±ÕÉ”¡ÍÑ…ÉĞ°| ŸBwBÔƒFBÓBÃBïBûFF0ƒBßBÃBÿFFFBãFF0M•ÉÙ¥”9L…ÁÁ±ä¸œ¤¤ì(€€€€€€€€€¥˜€¡ÍÑ…ÉÑ…¥±ÕÉ”¤Ñ¡É½ÜÍÑ…ÉÑ…¥±ÕÉ”ì(€€€€€€€€€É•ÑÕÉ¸Á½±±M•ÉÙ¥”¡…Á¤°ÍÑ…ÉĞ¹½Á•É…Ñ¥½¹%ñğ½Á•É…Ñ¥½¹%°…Ñ”¹¹½Ü ¤€¬€ÄÈÀÀÀÀ¤ì(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€ô¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸É•…Ñ•‘…ÁÑ•È¡…Á¤°µ½‘Õ±”¤ì(€Ù…Èµ…¹Õ…°€ô¹Ì¹É•…Ñ•‘…ÁÑ•È¡…Á¤°µ½‘Õ±”ñğ¹Ì¤ì(€™Õ¹Ñ¥½¸É•±½…‘ÁÁ±¥•‘MÑ…Ñ” ¤ì(€€€É•ÑÕÉ¸µ…¹Õ…°¹É•±½…‘ÁÁ±¥•‘MÑ…Ñ” ¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡É•…¤ì(€€€€€¥˜€ ……Á¤¹‘¹ÌñğÑåÁ•½˜…Á¤¹‘¹Ì¹Í•ÉÙ¥•MÑ…ÑÕÌ€„ôô€™Õ¹Ñ¥½¸œ¤É•ÑÕÉ¸É•…ì(€€€€€É•ÑÕÉ¸…Á¤¹‘¹Ì¹Í•ÉÙ¥•MÑ…ÑÕÌ ¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡ÍÑ…ÑÕÌ¤ì(€€€€€€€É•…¹Ù…±Õ”€ô=‰©•Ğ¹…ÍÍ¥¸¡íô°½‰©•Ğ¡É•…¹Ù…±Õ”¤°ìÍ•ÉÙ¥•¹ÌèÍÑ…ÑÕÌñğíôô¤ì(€€€€€€€É•ÑÕÉ¸É•…ì(€€€€€ô¤¹…Ñ ¡™Õ¹Ñ¥½¸€ ¤ìÉ•ÑÕÉ¸É•…ìô¤ì(€€€ô¤ì(€ô(€É•ÑÕÉ¸ì(€€€ÍÕÁÁ½ÉÑ•èÑÉÕ”°(€€€Ù…±¥‘…Ñ•É…™Ğè™Õ¹Ñ¥½¸€¡Í½Á”°Ù…±Õ”°½¹Ñ•áĞ¤ì(€€€€€¥˜€¡µ…¹Õ…±¡…¹•¡Ù…±Õ”¤€˜˜Í•ÉÙ¥•¡…¹•¡Ù…±Õ”¤¤(€€€€€€€É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡ì½¬è™…±Í”°µ•ÍÍ…”è| ŸBƒFFB÷BûBä9LƒBà9LƒFB×FBËBãFBûBÈƒBÿFBãBóB×B÷F?F;FFF<ƒBûFBÓB×BïF3B÷F/BóBàƒBûBÿB×FBÃFBãF?BóBà¸ƒB‡B÷BÃFBÃBïBÀƒBÿFBãBóB×B÷BãFBÔƒBûBÓBãBôƒBÇBïBûBèƒBãBßBóB×B÷B×B÷BãBä¸œ¤ô¤ì(€€€€€¥˜€¡Í•ÉÙ¥•¡…¹•¡Ù…±Õ”¤¤É•ÑÕÉ¸Ù…±¥‘…Ñ•M•ÉÙ¥”¡…Á¤°Ù…±Õ”¹Í•ÉÙ¥•¹Ì¤ì(€€€€€É•ÑÕÉ¸µ…¹Õ…°¹Ù…±¥‘…Ñ•É…™Ğ¡Í½Á”°Ù…±Õ”°½¹Ñ•áĞ¤ì(€€€ô°(€€€ÁÉ•Ù¥•İÉ…™Ğè™Õ¹Ñ¥½¸€¡Í½Á”°Ù…±Õ”°½¹Ñ•áĞ¤ì(€€€€€¥˜€ …Í•ÉÙ¥•¡…¹•¡Ù…±Õ”¤¤É•ÑÕÉ¸µ…¹Õ…°¹ÁÉ•Ù¥•İÉ…™Ğ¡Í½Á”°Ù…±Õ”°½¹Ñ•áĞ¤ì(€€€€€Ù…ÈÉ•…€ô½¹Ñ•áĞ€˜˜½¹Ñ•áĞ¹…ÁÁ±¥•€˜˜½¹Ñ•áĞ¹…ÁÁ±¥•¹‘¹Ìñğíôì(€€€€€Ù…ÈÉ•Ù¥Í¥½¸€ô‘¹ÍI•Ù¥Í¥½¸¡É•…¹É…ÜñğÉ•…¤ì(€€€€€É•ÑÕÉ¸Ù…±¥‘…Ñ•M•ÉÙ¥”¡…Á¤°Ù…±Õ”¹Í•ÉÙ¥•¹Ì¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡…¹Íİ•È¤ì(€€€€€€€¥˜€ ……¹Íİ•Èñğ…¹Íİ•È¹½¬€„ôôÑÉÕ”¤É•ÑÕÉ¸…¹Íİ•Èì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½¬èÑÉÕ”°(€€€€€€€€€Ù…±¥èÑÉÕ”°(€€€€€€€€€é•É½]É¥Ñ•ÌèÑÉÕ”°(€€€€€€€€€ÁÉ•½¹‘¥Ñ¥½¸èì(€€€€€€€€€€€É•Ù¥Í¥½¸èÉ•Ù¥Í¥½¸°(€€€€€€€€€€€Í•ÉÙ¥•É…™ÑI•Ù¥Í¥½¸èÙ…±Õ”¹Í•ÉÙ¥•¹Ì¹•áÁ•Ñ•‘É…™ÑI•Ù¥Í¥½¸(€€€€€€€€€ô(€€€€€€€ôì(€€€€€ô¤ì(€€€ô°(€€€ÁÉ•Ù¥•İY…±¥è™Õ¹Ñ¥½¸€¡…¹Íİ•È¤ì(€€€€€É•ÑÕÉ¸€„„¡…¹Íİ•È€˜˜…¹Íİ•È¹½¬€ôôôÑÉÕ”€˜˜…¹Íİ•È¹ÁÉ•½¹‘¥Ñ¥½¸€˜˜…¹Íİ•È¹ÁÉ•½¹‘¥Ñ¥½¸¹É•Ù¥Í¥½¸€„ô¹Õ±°¤ì(€€€ô°(€€€…ÁÁ±åÉ…™Ğè™Õ¹Ñ¥½¸€¡Í½Á”°Ù…±Õ”°•áÁ•Ñ•‘I•Ù¥Í¥½¸°½¹Ñ•áĞ¤ì(€€€€€¥˜€ …Í•ÉÙ¥•¡…¹•¡Ù…±Õ”¤¤É•ÑÕÉ¸µ…¹Õ…°¹…ÁÁ±åÉ…™Ğ¡Í½Á”°Ù…±Õ”°•áÁ•Ñ•‘I•Ù¥Í¥½¸°½¹Ñ•áĞ¤ì(€€€€€É•ÑÕÉ¸…ÁÁ±åM•ÉÙ¥”¡…Á¤°Ù…±Õ”¹Í•ÉÙ¥•¹Ì¤¹Ñ¡•¸¡™Õ¹Ñ¥½¸€¡½Á•É…Ñ¥½¸¤ì(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°Ù•É¥™¥•èÑÉÕ”°½Á•É…Ñ¥½¸è½Á•É…Ñ¥½¸ôì(€€€€€ô¤ì(€€€ô°(€€€É•±½…‘ÁÁ±¥•‘MÑ…Ñ”èÉ•±½…‘ÁÁ±¥•‘MÑ…Ñ”°(€€€Ù•É¥™åÁÁ±¥•è™Õ¹Ñ¥½¸€¡Ù…±Õ”°½¹Ñ•áĞ°É•…¤ì(€€€€€¥˜€ …Í•ÉÙ¥•¡…¹•¡Ù…±Õ”¤¤É•ÑÕÉ¸µ…¹Õ…°¹Ù•É¥™åÁÁ±¥•¡Ù…±Õ”°½¹Ñ•áĞ°É•…¤ì(€€€€€Ù…ÈÍÑ…ÑÕÌ€ô½‰©•Ğ¡É•…€˜˜É•…¹Ù…±Õ”€˜˜É•…¹Ù…±Õ”¹Í•ÉÙ¥•¹Ì¤ì(€€€€€Ù…È…ÁÁ±¥•€ôÍ•±•Ñ¥½¹5…À¡ÍÑ…ÑÕÌ°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸Í…µ”¡…ÁÁ±¥•°Ù…±Õ”¹Í•ÉÙ¥•¹Ì¹Í•±•Ñ¥½¹Ì¤ì(€€€ô°(€€€É•Í•ÑÉ…™Ğè™Õ¹Ñ¥½¸€ ¤ì(€€€€€¥˜€¡µ½‘Õ±”€˜˜µ½‘Õ±”¹É•Í•ÑÉ…™Ğ¤µ½‘Õ±”¹É•Í•ÑÉ…™Ğ ¤ì(€€€€€•±Í”¥˜€¡¹Ì¹É•Í•ÑÉ…™Ğ¤¹Ì¹É•Í•ÑÉ…™Ğ ¤ì(€€€ô(€ôì)ô()É•ÑÕÉ¸‰…Í•±…ÍÌ¹•áÑ•¹¡ì(€¥è€‘¹Ìœ°(€Ñ¥Ñ±”è| 9Lœ¤°(€ÍÕ‰Ñ¥Ñ±”è| ŸB{FB÷BûBËB÷BûBä9L°ƒBÿFBûBËB×FBëBàƒBÿFBûBËBÃBçBÓB×FBûBÈƒBà9LƒFB×FBËBãFBûBÈœ¤°(€±½…è™Õ¹Ñ¥½¸€¡Ñà¤ìÉ•ÑÕÉ¸¹Ì¹±½…¡İÉ…À¡Ñà¤¤¹Ñ¡•¸¡•¹É¥ ¤ìô°(€É•¹‘•Èè™Õ¹Ñ¥½¸€¡Ñà¤ìÉ•ÑÕÉ¸¹Ì¹É•¹‘•È¡İÉ…À¡=‰©•Ğ¹…ÍÍ¥¸¡íô°Ñà°ì‘…Ñ„è•¹É¥ ¡Ñà¹‘…Ñ„ñğíô¤ô¤¤¤ìô°(€µ½Õ¹Ğè™Õ¹Ñ¥½¸€¡Ñà¤ì¥˜€¡¹Ì¹µ½Õ¹Ğ¤¹Ì¹µ½Õ¹Ğ¡İÉ…À¡Ñà¤¤ìô°(€Õ¹µ½Õ¹Ğè™Õ¹Ñ¥½¸€¡Ñà¤ì¥˜€¡¹Ì¹Õ¹µ½Õ¹Ğ¤¹Ì¹Õ¹µ½Õ¹Ğ¡İÉ…À¡Ñàñğíô¤¤ìô°(€½Á•¹É…™Ğè¹Ì¹½Á•¹É…™Ğ°(€™½ÕÍÉ…™Ğè¹Ì¹™½ÕÍÉ…™Ğ°(€É•Í•ÑÉ…™Ğè¹Ì¹É•Í•ÑÉ…™Ğ°(€É•…Ñ•‘…ÁÑ•ÈèÉ•…Ñ•‘…ÁÑ•È)ô¤ì(