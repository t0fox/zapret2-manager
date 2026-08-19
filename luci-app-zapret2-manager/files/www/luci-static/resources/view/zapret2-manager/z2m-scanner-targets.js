'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

function isString(v) { return typeof v === 'string'; }
function isArray(v) { return Array.isArray(v); }

function normalizeDomain(raw) {
  if (!raw) return null;
  var s = String(raw).trim().toLowerCase();
  // Strip protocol
  s = s.replace(/^https?:\/\//i, '');
  // Strip path and query/hash
  s = s.split('/')[0];
  s = s.split('?')[0];
  s = s.split('#')[0];
  // Strip port
  s = s.split(':')[0];
  // Strip trailing dot
  if (s.endsWith('.')) s = s.slice(0, -1);
  s = s.trim();

  // Validate FQDN format
  if (!s || s.length > 253 || s.indexOf('..') >= 0) return null;
  if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(s)) return null; // Reject raw IPv4

  var labels = s.split('.');
  if (labels.length < 2) return null;

  for (var i = 0; i < labels.length; i++) {
    var l = labels[i];
    if (!l || l.length > 63 || l.startsWith('-') || l.endsWith('-')) return null;
    if (!/^[a-z0-9-]+$/.test(l)) return null;
  }
  return s;
}

function validate(domain) {
  var norm = normalizeDomain(domain);
  if (!norm) {
    return { ok: false, error: 'Некорректное доменное имя (пример: youtube.com)' };
  }
  return { ok: true, domain: norm };
}

function parseTargetList(input) {
  if (!input) return [];
  var rawList = [];
  if (isArray(input)) {
    rawList = input;
  } else if (isString(input)) {
    rawList = input.split(/[\r\n,]+/);
  }
  var seen = {};
  var result = [];
  for (var i = 0; i < rawList.length; i++) {
    var norm = normalizeDomain(rawList[i]);
    if (norm && !seen[norm]) {
      seen[norm] = true;
      result.push(norm);
    }
  }
  return result;
}

function renderChips(targets, options) {
  options = options || {};
  var onRemove = options.onRemove || function() {};
  var onAdd = options.onAdd || function() {};

  var container = document.createElement('div');
  container.className = 'target-chips-container';

  var chipsWrap = document.createElement('div');
  chipsWrap.className = 'target-chips-list';

  (targets || []).forEach(function(target) {
    var chip = document.createElement('span');
    chip.className = 'target-chip';
    chip.innerHTML = '<span class="target-chip-label">' + target + '</span>' +
      '<button type="button" class="target-chip-remove" title="Удалить ' + target + '">' + Icons.html('x', { size: 12 }) + '</button>';

    var removeBtn = chip.querySelector('.target-chip-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        onRemove(target);
      });
    }
    chipsWrap.appendChild(chip);
  });

  var inputWrap = document.createElement('div');
  inputWrap.className = 'target-add-wrap';
  inputWrap.innerHTML = '<input type="text" class="form-input target-add-input" placeholder="+ Добавить домен (или вставить список)...">' +
    '<button type="button" class="btn btn-ghost btn-sm target-add-btn">' + Icons.html('plus', { size: 13 }) + '<span>Добавить</span></button>';

  var input = inputWrap.querySelector('.target-add-input');
  var addBtn = inputWrap.querySelector('.target-add-btn');

  function handleAdd() {
    var val = input.value;
    if (!val) return;
    var parsed = parseTargetList(val);
    if (parsed.length > 0) {
      onAdd(parsed);
      input.value = '';
    }
  }

  if (addBtn) addBtn.addEventListener('click', handleAdd);
  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      }
    });
    input.addEventListener('paste', function(e) {
      setTimeout(handleAdd, 50);
    });
  }

  container.appendChild(chipsWrap);
  container.appendChild(inputWrap);
  return container;
}

return baseclass.extend({
  normalizeDomain: normalizeDomain,
  validate: validate,
  parseTargetList: parseTargetList,
  renderChips: renderChips
});
