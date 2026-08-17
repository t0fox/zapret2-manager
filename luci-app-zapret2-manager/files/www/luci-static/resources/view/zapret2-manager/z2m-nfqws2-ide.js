'use strict';
'require baseclass';

/*
 * Canonical LuCI nfqws2 editor helpers. This is deliberately a small local
 * module: it provides the donor's syntax/lint/autocomplete boundary without
 * importing the donor's HTTP API, sidebar or page shell.
 */
(function (root) {
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var known = {
    '--filter-tcp': 1, '--filter-udp': 1, '--filter-l7': 1, '--payload': 1,
    '--hostlist': 1, '--hostlist-exclude': 1, '--hostlist-auto': 1,
    '--ipset': 1, '--ipset-exclude': 1, '--lua-desync': 1, '--new': 1,
    '--qnum': 1, '--blob': 1
  };
  var NfqwsSyntax = {
    highlight: function (value) {
      return String(value || '').split(/(\s+)/).map(function (token) {
        if (/^\s+$/.test(token) || !token) return token;
        var match = token.match(/^(--[\w-]+)(=)(.*)$/);
        if (match) return '<span class="nfq-flag">' + esc(match[1]) + '</span><span class="nfq-eq">=</span><span class="nfq-value">' + esc(match[3]) + '</span>';
        if (/^--[\w-]+$/.test(token)) return '<span class="nfq-flag">' + esc(token) + '</span>';
        return esc(token);
      }).join('');
    },
    highlightWithDiagnostics: function (value, diagnostics) {
      var output = NfqwsSyntax.highlight(value);
      if (diagnostics && diagnostics.length) output = '<span class="nfq-diagnostic-range">' + output + '</span>';
      return output;
    },
    hasNfqwsArgs: function (value) { return /(^|\s)--[\w-]+/.test(String(value || '')); }
  };
  var Nfqws2Lint = {
    analyze: function (value) {
      var text = String(value || ''), diagnostics = [];
      text.split(/\s+/).filter(Boolean).forEach(function (token) {
        var flag = token.split('=')[0];
        if (token.indexOf('--') === 0 && !known[flag]) diagnostics.push({ severity: 'error', message: 'Неизвестный флаг ' + flag });
      });
      if (/--lua-desync=/.test(text) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/.test(text)) diagnostics.push({ severity: 'warn', code: 'missing-target', message: 'Для desync не задан target scope' });
      return diagnostics;
    },
    tokenHelp: function (value) { return value ? 'nfqws2 token: ' + value : 'Введите -- для списка флагов'; }
  };
  var attached = [];
  var resources = [];
  var NfqwsAutocomplete = {
    setResources: function (value) {
      var items = value && (value.assets || value.items || value.list) || [];
      resources = Array.isArray(items) ? items.map(function (item) { return String(item.name || item.id || item.path || item); }).filter(Boolean).slice(0, 128) : [];
    },
    attach: function (textarea) {
      if (!textarea || textarea.dataset.nfqAutocomplete === '1') return;
      textarea.dataset.nfqAutocomplete = '1';
      var handler = function (event) {
        if (!event.ctrlKey && !event.metaKey || event.key !== ' ') return;
        event.preventDefault();
        var before = textarea.value.slice(0, textarea.selectionStart), prefix = before.split(/\s+/).pop() || '--';
        var choices = /--(?:blob|hostlist|ipset)=/.test(before) ? resources.filter(function (item) { return item.indexOf(prefix) === 0; }) : Object.keys(known).filter(function (item) { return item.indexOf(prefix) === 0; });
        if (choices.length) {
          var start = textarea.selectionStart - prefix.length, insert = choices[0];
          textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(textarea.selectionStart);
          textarea.selectionStart = textarea.selectionEnd = start + insert.length;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      textarea.addEventListener('keydown', handler); attached.push({ textarea: textarea, handler: handler });
    },
    detachAll: function () { attached.forEach(function (item) { item.textarea.removeEventListener('keydown', item.handler); delete item.textarea.dataset.nfqAutocomplete; }); attached = []; }
  };
  root.NfqwsSyntax = NfqwsSyntax; root.Nfqws2Lint = Nfqws2Lint; root.NfqwsAutocomplete = NfqwsAutocomplete;
}(window));

return baseclass.extend({
  syntax: window.NfqwsSyntax,
  lint: window.Nfqws2Lint,
  autocomplete: window.NfqwsAutocomplete
});
