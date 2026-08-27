'use strict';
'require baseclass';
'require view.zapret2-manager.vendor.z2m-codemirror';

var vendor = globalThis.Z2MCodeMirrorVendor || null;
var FALLBACK_WARNING = 'Расширенный редактор недоступен; используется простой режим.';

function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

function addExtensions(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(function (extension) { addExtensions(target, extension); });
    return;
  }
  if (typeof value.extensions === 'function') {
    addExtensions(target, value.extensions());
    return;
  }
  target.push(value);
}

function selectionOf(view) {
  var range = view.state.selection.main;
  return {
    anchor: range.anchor,
    head: range.head,
    from: range.from,
    to: range.to,
  };
}

function diagnosticsForDocument(doc, diagnostics) {
  var length = doc.length;
  return (Array.isArray(diagnostics) ? diagnostics : []).filter(function (item) {
    return item && Number.isFinite(item.from) && Number.isFinite(item.to);
  }).map(function (item) {
    var from = Math.max(0, Math.min(length, Math.floor(item.from)));
    var to = Math.max(from, Math.min(length, Math.floor(item.to)));
    return Object.assign({}, item, { from: from, to: to });
  });
}

function fallbackEditor(host, options) {
  var document = host.ownerDocument || globalThis.document;
  clearHost(host);
  host.classList.add('z2m-code-editor');
  var textarea = document.createElement('textarea');
  textarea.className = 'z2m-code-editor-fallback';
  textarea.value = String(options.value == null ? '' : options.value);
  textarea.readOnly = Boolean(options.readOnly);
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', options.ariaLabel || 'Code editor');
  var warning = document.createElement('div');
  warning.className = 'z2m-code-editor-warning';
  warning.setAttribute('role', 'status');
  warning.textContent = FALLBACK_WARNING;
  host.appendChild(textarea);
  host.appendChild(warning);

  function onInput() {
    if (typeof options.onChange === 'function') options.onChange(textarea.value);
  }
  function onKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
      event.preventDefault();
      if (typeof options.onSave === 'function') options.onSave(handle);
    }
  }
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKeydown);

  var handle = {
    view: null,
    getValue: function () { return textarea.value; },
    setValue: function (value) {
      var next = String(value == null ? '' : value);
      if (next !== textarea.value) textarea.value = next;
    },
    setReadOnly: function (readOnly) { textarea.readOnly = Boolean(readOnly); },
    setDiagnostics: function () {},
    focus: function () { textarea.focus(); },
    getSelection: function () {
      return {
        anchor: textarea.selectionStart || 0,
        head: textarea.selectionEnd || 0,
        from: Math.min(textarea.selectionStart || 0, textarea.selectionEnd || 0),
        to: Math.max(textarea.selectionStart || 0, textarea.selectionEnd || 0),
      };
    },
    destroy: function () {
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onKeydown);
      clearHost(host);
    },
  };
  return handle;
}

var CodeEditor = baseclass.extend({
  vendor: vendor,
  theme: vendor ? vendor.EditorView.theme({
    '&': {
      height: '100%',
      width: '100%',
      minWidth: '0',
      color: '#e8edf2',
      backgroundColor: '#182029',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1.55',
    },
    '.cm-content': {
      minHeight: '100%',
      caretColor: '#d7e8f5',
    },
    '.cm-gutters': {
      color: '#8795a3',
      backgroundColor: '#141b22',
      borderRight: '1px solid #2b3742',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: '#24313d',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: '#345875',
    },
  }, { dark: true }) : null,
  baseExtensions: vendor ? [
    vendor.lineNumbers(),
    vendor.highlightActiveLine(),
    vendor.highlightActiveLineGutter(),
    vendor.keymap.of([].concat(
      vendor.defaultKeymap,
      vendor.historyKeymap,
      vendor.searchKeymap,
      vendor.completionKeymap,
      vendor.foldKeymap,
      vendor.indentWithTab,
    )),
    vendor.autocompletion(),
    vendor.lintGutter(),
    vendor.bracketMatching(),
    vendor.foldGutter(),
    vendor.syntaxHighlighting(vendor.defaultHighlightStyle, { fallback: true }),
  ] : [],
  mount: function (host, options) {
    options = options || {};
    if (!host || !vendor) return fallbackEditor(host, options);

    var document = host.ownerDocument || globalThis.document;
    clearHost(host);
    host.classList.add('z2m-code-editor');
    var readOnlyCompartment = new vendor.Compartment();
    var diagnosticsCompartment = new vendor.Compartment();
    var historyCompartment = new vendor.Compartment();
    var extensions = this.baseExtensions.slice();
    addExtensions(extensions, this.theme);
    addExtensions(extensions, options.language);
    addExtensions(extensions, options.extensions);
    extensions.push(readOnlyCompartment.of([
      vendor.EditorState.readOnly.of(Boolean(options.readOnly)),
      vendor.EditorView.editable.of(!options.readOnly),
    ]));
    extensions.push(historyCompartment.of(vendor.history()));
    extensions.push(diagnosticsCompartment.of(vendor.linter(function () { return []; })));

    var handle;
    var view;
    function onKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
        event.preventDefault();
        if (typeof options.onSave === 'function') options.onSave(handle);
      }
    }
    extensions.push(vendor.EditorView.updateListener.of(function (update) {
      if (update.docChanged && typeof options.onChange === 'function') {
        options.onChange(update.state.doc.toString(), update);
      }
      if (update.focusChanged && typeof options.onFocus === 'function') {
        options.onFocus(view.hasFocus, update);
      }
      if (update.selectionSet && typeof options.onCursor === 'function') {
        options.onCursor(selectionOf(view), update);
      }
    }));
    try {
      var state = vendor.EditorState.create({
        doc: String(options.value == null ? '' : options.value),
        extensions: extensions,
      });
      view = new vendor.EditorView({ state: state, parent: host });
      host.addEventListener('keydown', onKeydown, true);

      var destroyed = false;
      handle = {
        view: view,
        getValue: function () { return view.state.doc.toString(); },
        setValue: function (value, config) {
          config = config || {};
          var next = String(value == null ? '' : value);
          if (next === view.state.doc.toString()) return;
          var effects = [];
          if (config.resetHistory) effects.push(historyCompartment.reconfigure(vendor.history()));
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            effects: effects,
          });
        },
        setReadOnly: function (readOnly) {
          view.dispatch({
            effects: readOnlyCompartment.reconfigure([
              vendor.EditorState.readOnly.of(Boolean(readOnly)),
              vendor.EditorView.editable.of(!readOnly),
            ]),
          });
        },
        setDiagnostics: function (diagnostics) {
          view.dispatch(vendor.setDiagnostics(
            view.state,
            diagnosticsForDocument(view.state.doc, diagnostics),
          ));
        },
        focus: function () { view.focus(); },
        getSelection: function () { return selectionOf(view); },
        destroy: function () {
          if (destroyed) return;
          destroyed = true;
          host.removeEventListener('keydown', onKeydown, true);
          view.destroy();
          clearHost(host);
        },
      };
      if (Array.isArray(options.diagnostics) && options.diagnostics.length) {
        handle.setDiagnostics(options.diagnostics);
      }
      return handle;
    } catch (error) {
      if (handle) {
        try { handle.destroy(); } catch (_destroyError) { clearHost(host); }
      } else {
        host.removeEventListener('keydown', onKeydown, true);
        if (view) view.destroy();
        clearHost(host);
      }
      throw error;
    }
  },
});

return CodeEditor;
