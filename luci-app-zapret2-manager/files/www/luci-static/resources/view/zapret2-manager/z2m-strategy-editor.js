'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-code-editor as CodeEditor';
'require view.zapret2-manager.z2m-editor-nfqws2 as Nfqws2Editor';
'require view.zapret2-manager.z2m-nfqws2-ide as Nfqws2Ide';

function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function clear(host) { while (host && host.firstChild) host.removeChild(host.firstChild); }
function element(document, tag, className, value) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function labelWithInput(document, title, className, value, type) {
  var label = element(document, 'label', 'strategy-editor-field');
  label.appendChild(element(document, 'span', 'strategy-editor-field-label', title));
  var input = element(document, 'input', className || 'form-input');
  input.type = type || 'text';
  input.value = text(value);
  label.appendChild(input);
  return { label: label, input: input };
}
function diagnosticSeverity(value) {
  return value === 'error' ? 'error' : value === 'warn' ? 'warning' : 'info';
}

return baseclass.extend({
  create: function (ctx, editorState, hosts) {
    var document = hosts.editorHost.ownerDocument || globalThis.document;
    var strategy = editorState.strategy;
    var activeId = null;
    var handle = null;
    var nfqws2 = Nfqws2Editor.create({
      assets: editorState.assets || [],
      onHelp: renderInspector,
    });
    var backendProblems = [];
    var destroyed = false;
    var syncSource = null;
    var listeners = [];

    function profileId(profile, index) {
      return text(profile && (profile.id || 'profile-' + String(index + 1)));
    }
    function profileIndex(id) {
      return array(strategy.profiles).findIndex(function (profile, index) {
        return profileId(profile, index) === id;
      });
    }
    function activeProfile() {
      var index = profileIndex(activeId);
      return index < 0 ? null : strategy.profiles[index];
    }
    function activeIndex() {
      var index = profileIndex(activeId);
      return index < 0 ? 0 : index;
    }
    function viewFor(profile, index) {
      var byProfile = editorState.viewByProfile || {};
      return byProfile[index] === 'visual' ? 'visual' : 'code';
    }
    function markDirty() { editorState.dirty = true; }
    function setText(host, value) {
      if (!host) return;
      clear(host);
      host.appendChild(element(document, 'span', '', text(value)));
    }
    function renderInspector(help) {
      if (!hosts.inspectorHost || destroyed || !help) return;
      clear(hosts.inspectorHost);
      hosts.inspectorHost.appendChild(element(document, 'strong', '', help.title || 'Справка по синтаксису'));
      hosts.inspectorHost.appendChild(element(document, 'p', '', help.text || 'Выберите флаг, значение или asset.'));
    }
    function renderMetadata() {
      var fields = hosts.fieldsHost;
      if (!fields) return;
      clear(fields);
      var group = element(document, 'div', 'strategy-editor-metadata');
      var id = labelWithInput(document, 'ID стратегии', 'form-input', strategy.id);
      id.input.id = 'edit-id';
      id.input.readOnly = editorState.mode === 'edit';
      var name = labelWithInput(document, 'Название', 'form-input', strategy.name);
      name.input.id = 'edit-name';
      var description = labelWithInput(document, 'Описание', 'form-input', strategy.description);
      description.input.id = 'edit-desc';
      [id, name, description].forEach(function (field) {
        field.input.addEventListener('input', function () {
          if (field.input === id.input) strategy.id = field.input.value.trim();
          else if (field.input === name.input) strategy.name = field.input.value.trim();
          else strategy.description = field.input.value.trim();
          markDirty();
        });
        group.appendChild(field.label);
      });
      fields.appendChild(group);
    }
    function renderProfileTabs() {
      var host = hosts.profilesHost;
      if (!host) return;
      clear(host);
      var heading = element(document, 'div', 'strategy-editor-profiles-heading');
      heading.appendChild(element(document, 'strong', '', 'Профили стратегии'));
      host.appendChild(heading);
      var tabs = element(document, 'div', 'strategy-editor-profile-tabs');
      array(strategy.profiles).forEach(function (profile, index) {
        var id = profileId(profile, index);
        var button = element(document, 'button', 'btn btn-ghost btn-sm' + (id === activeId ? ' is-active' : ''), profile.name || id);
        button.type = 'button';
        button.dataset.profileId = id;
        button.addEventListener('click', function () { switchProfile(id); });
        tabs.appendChild(button);
      });
      host.appendChild(tabs);
    }
    function renderVisual() {
      var profile = activeProfile(), host = hosts.fieldsHost;
      if (!host || !profile) return;
      var old = host.querySelector('.strategy-editor-visual');
      if (old) old.remove();
      var parsed = Nfqws2Ide.parseProfile(text(profile.args));
      var visual = element(document, 'div', 'strategy-editor-visual');
      visual.dataset.mode = parsed.mode;
      visual.appendChild(element(document, 'div', 'strategy-editor-section-title', 'Visual'));
      if (parsed.mode !== 'structured' || parsed.lossless !== true) {
        visual.appendChild(element(document, 'p', 'strategy-editor-raw-only', 'Raw-only: неизвестный синтаксис сохранён без изменений; Visual отключён.'));
        host.appendChild(visual);
        return;
      }
      var values = parsed.visual || {};
      var ports = values.ports || {};
      var fields = [
        ['TCP-порты', 'tcp', array(ports.tcp).join(',')],
        ['UDP-порты', 'udp', array(ports.udp).join(',')],
        ['Hostlist', 'hostlist', array(values.hostlists)[0] || ''],
        ['IPSet', 'ipset', array(values.ipsets)[0] || ''],
        ['L7', 'l7', array(parsed.fields && parsed.fields.filters).filter(function (item) { return typeof item === 'string'; }).join(',')],
        ['Payload', 'payload', array(values.payloads).join(',')],
      ];
      fields.forEach(function (item) {
        var field = labelWithInput(document, item[0], 'form-input form-input-sm', item[2]);
        field.input.dataset.visualField = item[1];
        field.input.addEventListener('change', function () {
          var edits = {};
          visual.querySelectorAll('[data-visual-field]').forEach(function (input) { edits[input.dataset.visualField] = input.value.trim(); });
          applyVisualEdits(profile, edits);
        });
        visual.appendChild(field.label);
      });
      host.appendChild(visual);
    }
    function renderProblems() {
      if (!hosts.problemsHost) return;
      clear(hosts.problemsHost);
      var profile = activeProfile();
      var problems = profile ? (Nfqws2Ide.diagnostics(text(profile.args)) || []).map(function (item) {
        return {
          source: 'IDE',
          severity: diagnosticSeverity(item.severity),
          message: item.message || 'Некорректный синтаксис',
          from: Number.isFinite(item.start) ? item.start : undefined,
          to: Number.isFinite(item.end) ? item.end : undefined,
        };
      }) : [];
      problems = problems.concat(backendProblems);
      hosts.problemsHost.appendChild(element(document, 'div', 'strategy-editor-section-title', 'Problems'));
      if (!problems.length) {
        hosts.problemsHost.appendChild(element(document, 'p', 'strategy-editor-problems-ok', 'Нет проблем.'));
        return;
      }
      problems.forEach(function (problem) {
        var row = element(document, 'div', 'strategy-editor-problem ' + problem.severity);
        row.dataset.source = problem.source || 'IDE';
        row.appendChild(element(document, 'b', '', problem.source || 'IDE'));
        row.appendChild(element(document, 'span', '', ': ' + text(problem.message)));
        hosts.problemsHost.appendChild(row);
      });
    }
    function renderCodeMode() {
      var profile = activeProfile();
      if (!profile || !hosts.editorHost) return;
      var mode = viewFor(profile, activeIndex());
      hosts.editorHost.style.display = mode === 'visual' ? 'none' : '';
      if (!handle) {
        handle = CodeEditor.mount(hosts.editorHost, {
          value: text(profile.args),
          extensions: nfqws2.extensions,
          onChange: function (value) {
            if (syncSource === 'visual') return;
            profile.args = value;
            markDirty();
            if (handle && handle.view) handle.setDiagnostics(nfqws2.lintSource(handle.view));
            renderVisual();
            renderProblems();
          },
          onCursor: function (selection) {
            nfqws2.helpAt(text(profile.args), selection.head);
          },
          onSave: function () {
            if (typeof editorState.onSave === 'function') editorState.onSave();
          },
        });
      } else if (handle.getValue() !== text(profile.args)) {
        handle.setValue(text(profile.args), { preserveHistory: true });
      }
      if (handle.view) handle.setDiagnostics(nfqws2.lintSource(handle.view));
    }
    function applyVisualEdits(profile, edits) {
      var parsed = Nfqws2Ide.parseProfile(text(profile.args));
      if (!parsed || parsed.mode !== 'structured' || parsed.lossless !== true) return false;
      var next = Nfqws2Ide.serializeProfile(parsed, edits);
      profile.args = next;
      markDirty();
      if (handle && profile === activeProfile() && handle.getValue() !== next) {
        syncSource = 'visual';
        try { handle.setValue(next, { preserveHistory: true }); }
        finally { syncSource = null; }
      }
      renderVisual();
      renderProblems();
      return true;
    }
    function flush() {
      if (handle && activeProfile()) activeProfile().args = handle.getValue();
      var id = hosts.fieldsHost && hosts.fieldsHost.querySelector('#edit-id');
      var name = hosts.fieldsHost && hosts.fieldsHost.querySelector('#edit-name');
      var description = hosts.fieldsHost && hosts.fieldsHost.querySelector('#edit-desc');
      if (id) strategy.id = id.value.trim();
      if (name) strategy.name = name.value.trim();
      if (description) strategy.description = description.value.trim();
      return strategy;
    }
    function switchProfile(id) {
      if (destroyed || id === activeId) return;
      flush();
      activeId = id;
      renderProfileTabs();
      renderVisual();
      renderCodeMode();
      renderProblems();
    }
    function renderActions() {
      if (!hosts.actionsHost) return;
      clear(hosts.actionsHost);
      [['editorValidate', 'Validate'], ['editorPreview', 'Preview'], ['saveEditor', editorState.mode === 'create' ? 'Создать' : 'Сохранить'], ['closeModal', 'Отмена']].forEach(function (item) {
        var button = element(document, 'button', 'btn ' + (item[0] === 'saveEditor' ? 'btn-primary' : 'btn-ghost'), item[1]);
        button.type = 'button';
        button.dataset.action = item[0];
        if (item[0] === 'editorValidate' || item[0] === 'editorPreview' || item[0] === 'saveEditor') button.dataset.operation = item[0] === 'editorValidate' ? 'validate' : item[0] === 'editorPreview' ? 'preview' : 'save';
        hosts.actionsHost.appendChild(button);
      });
    }
    function render() {
      strategy = editorState.strategy;
      if (!activeId || profileIndex(activeId) < 0) activeId = profileId(array(strategy.profiles)[0], 0);
      renderMetadata();
      renderProfileTabs();
      renderActions();
      renderVisual();
      renderCodeMode();
      renderProblems();
    }
    render();
    return {
      update: function (nextState) {
        if (destroyed) return;
        editorState = nextState || editorState;
        strategy = editorState.strategy;
        if (!activeId || profileIndex(activeId) < 0) activeId = profileId(array(strategy.profiles)[0], 0);
        flush();
        renderMetadata();
        renderProfileTabs();
        renderVisual();
        renderCodeMode();
        renderProblems();
      },
      flush: flush,
      applyVisualEdits: applyVisualEdits,
      setBackendDiagnostics: function (items) {
        backendProblems = array(items).map(function (item) {
          var problem = { source: 'Backend', severity: diagnosticSeverity(item.severity), message: text(item.message || item.code || 'Backend diagnostic') };
          if (Number.isFinite(item.from) && Number.isFinite(item.to)) { problem.from = item.from; problem.to = item.to; }
          return problem;
        });
        renderProblems();
      },
      setValidation: function (value) { setText(hosts.validationHost, value); },
      setPreview: function (value) { setText(hosts.previewHost, value); },
      getHandle: function () { return handle; },
      destroy: function () {
        destroyed = true;
        listeners.forEach(function (item) { item.node.removeEventListener(item.type, item.listener); });
        listeners = [];
        if (handle) handle.destroy();
        handle = null;
        clear(hosts.fieldsHost);
        clear(hosts.profilesHost);
        clear(hosts.editorHost);
        clear(hosts.validationHost);
        clear(hosts.previewHost);
        clear(hosts.actionsHost);
        clear(hosts.inspectorHost);
        clear(hosts.problemsHost);
      },
    };
  },
});
