'use strict';
'require baseclass';

var ROOT = typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window : this;
var WRAPPED = '__z2mRuntimeGuardWrapped';

function normalizedError(label, timeoutMs) {
  return {
    code: 'ETIMEOUT',
    message: _('Операция «%s» не завершилась за %d секунд. Интерфейс разблокирован; перечитайте состояние перед повтором.')
      .format(label || 'RPC', Math.ceil(timeoutMs / 1000))
  };
}

function withTimeout(promise, timeoutMs, label) {
  timeoutMs = Number(timeoutMs) || 20000;
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = ROOT.setTimeout(function () {
      if (done) return;
      done = true;
      reject(normalizedError(label, timeoutMs));
    }, timeoutMs);
    Promise.resolve(promise).then(function (value) {
      if (done) return;
      done = true;
      ROOT.clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (done) return;
      done = true;
      ROOT.clearTimeout(timer);
      reject(error);
    });
  });
}

function wrap(owner, key, timeoutMs, label, transform) {
  if (!owner || typeof owner[key] !== 'function' || owner[key][WRAPPED]) return;
  var original = owner[key];
  var guarded = function () {
    var context = this;
    var args = arguments;
    var result;
    try { result = original.apply(context, args); }
    catch (error) { return Promise.reject(error); }
    return withTimeout(result, timeoutMs, label).then(function (value) {
      return transform ? transform(value) : value;
    });
  };
  guarded[WRAPPED] = true;
  guarded.original = original;
  owner[key] = guarded;
}

function nullishText(value) {
  var compact = String(value == null ? '' : value).replace(/\s+/g, '').toLowerCase();
  return compact === 'null' || compact === 'undefined' || compact === 'nullnull' ||
    compact === 'undefinedundefined';
}

function sanitizeNode(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    if (nullishText(root.nodeValue)) root.nodeValue = '';
    return;
  }
  var children = root.childNodes;
  if (!children) return;
  for (var index = 0; index < children.length; index++) sanitizeNode(children[index]);
}

function installDomObserver() {
  if (!ROOT || !ROOT.document || ROOT.__z2mNullObserverInstalled) return;
  ROOT.__z2mNullObserverInstalled = true;
  var document = ROOT.document;
  var target = document.documentElement || document.body;
  if (target) sanitizeNode(target);
  if (typeof ROOT.MutationObserver !== 'function' || !target) return;
  var observer = new ROOT.MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'characterData') sanitizeNode(record.target);
      for (var index = 0; index < record.addedNodes.length; index++)
        sanitizeNode(record.addedNodes[index]);
    });
  });
  observer.observe(target, { childList: true, subtree: true, characterData: true });
  ROOT.__z2mNullObserver = observer;
}

function install(api) {
  api = api || {};
  installDomObserver();
  wrap(api.dns, 'diagnose', 20000, 'dnsprov_diagnose');
  wrap(api.dns, 'check', 20000, 'dns_check');
  wrap(api.dns, 'serviceApplyStatus', 20000, 'service_dns_apply_status');
  return api;
}

return baseclass.extend({
  install: install
});
