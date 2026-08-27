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
function markHost(host, region) {
  if (!host) return;
  host.setAttribute('data-editor-owner', 'strategy');
  host.setAttribute('data-editor-region', region);
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
    var profileMemory = {};
    var destroyed = false;
    var syncSource = null;
    var listeners = [];
    markHost(hosts.fieldsHost, 'fields');
    markHost(hosts.profilesHost, 'profiles');
    markHost(hosts.editorHost, 'editor');
    markHost(hosts.validationHost, 'validation');
    markHost(hosts.previewHost, 'preview');
    markHost(hosts.actionsHost, 'actions');
    markHost(hosts.inspectorHost, 'inspector');
    markHost(hosts.problemsHost, 'problems');

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
      if (byProfile[index] !== 'visual') return 'code';
      var parsed = Nfqws2Ide.parseProfile(text(profile && profile.args));
      return parsed && parsed.mode === 'structured' && parsed.lossless === true ? 'visual' : 'code';
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
      var add = element(document, 'button', 'btn btn-ghost btn-sm', 'Добавить профиль');
      add.type = 'button';
      add.dataset.editorAction = 'add-profile';
      add.addEventListener('click', addProfile);
      heading.appendChild(add);
      host.appendChild(heading);
      var tabs = element(document, 'div', 'strategy-editor-profile-tabs');
      array(strategy.profiles).forEach(function (profile, index) {
        var id = profileId(profile, index);
        var tab = element(document, 'div', 'strategy-editor-profile-tab');
        var button = element(document, 'button', 'btn btn-ghost btn-sm' + (id === activeId ? ' is-active' : ''), profile.name || id);
        button.type = 'button';
        button.dataset.profileId = id;
        button.addEventListener('click', function () { switchProfile(id); });
        tab.appendChild(button);
        var remove = element(document, 'button', 'btn-icon-only', '×');
        remove.type = 'button';
        remove.title = 'Удалить профиль';
        remove.dataset.editorAction = 'remove-profile';
        remove.dataset.profileId = id;
        remove.disabled = array(strategy.profiles).length <= 1;
        remove.addEventListener('click', function () { removeProfile(id); });
        tab.appendChild(remove);
        tabs.appendChild(tab);
      });
      host.appendChild(tabs);
      var modes = element(document, 'div', 'strategy-editor-mode-tabs');
      var current = activeProfile(), parsed = current ? Nfqws2Ide.parseProfile(text(current.args)) : null;
      ['visual', 'code'].forEach(function (mode) {
        var button = element(document, 'button', 'btn btn-ghost btn-sm' + (current && viewFor(current, activeIndex()) === mode ? ' is-active' : ''), mode === 'visual' ? 'Визуально' : 'Code');
        button.type = 'button';
        button.disabled = mode === 'visual' && (!parsed || parsed.mode !== 'structured' || parsed.lossless !== true);
        button.addEventListener('click', function () {
          editorState.viewByProfile = editorState.viewByProfile || {};
          editorState.viewByProfile[activeIndex()] = mode;
          renderProfileTabs();
          renderVisual();
          renderCodeMode();
        });
        modes.appendChild(button);
      });
      host.appendChild(modes);
      if (current) {
        var controls = element(document, 'div', 'strategy-editor-profile-controls');
        var enabled = element(document, 'input', 'profile-toggle');
        enabled.type = 'checkbox';
        enabled.checked = current.enabled !== false;
        enabled.dataset.profileEnabled = 'true';
        enabled.addEventListener('change', function () { current.enabled = enabled.checked; markDirty(); });
        var enabledLabel = element(document, 'label', 'strategy-editor-profile-enabled', 'Включён');
        enabledLabel.insertBefore(enabled, enabledLabel.firstChild);
        controls.appendChild(enabledLabel);
        var name = element(document, 'input', 'form-input form-input-sm');
        name.type = 'text';
        name.value = text(current.name || 'Профиль ' + String(activeIndex() + 1));
        name.dataset.profileName = 'true';
        name.setAttribute('aria-label', 'Имя активного профиля');
        name.addEventListener('input', function () { current.name = name.value; markDirty(); });
        controls.appendChild(name);
        host.appendChild(controls);
      }
    }
    function syncProfileControls() {
      var current = activeProfile();
      if (!current || !hosts.profilesHost) return;
      var enabled = hosts.profilesHost.querySelector('[data-profile-enabled="true"]');
      var name = hosts.profilesHost.querySelector('[data-profile-name="true"]');
      if (enabled) current.enabled = enabled.checked;
      if (name) current.name = name.value;
    }
    function addProfile() {
      if (destroyed) return;
      syncProfileControls();
      flush();
      var index = array(strategy.profiles).length + 1;
      var id = 'profile-' + String(index);
      while (profileIndex(id) >= 0) { index++; id = 'profile-' + String(index); }
      strategy.profiles.push({ id: id, name: 'Новый профиль', enabled: true, args: '' });
      activeId = id;
      editorState.viewByProfile = editorState.viewByProfile || {};
      editorState.viewByProfile[index - 1] = 'code';
      markDirty();
      render();
    }
    function removeProfile(id) {
      if (destroyed || array(strategy.profiles).length <= 1) return;
      syncProfileControls();
      flush();
      var index = profileIndex(id);
      if (index < 0) return;
      strategy.profiles.splice(index, 1);
      delete profileMemory[id];
      activeId = profileId(strategy.profiles[Math.max(0, Math.min(index, strategy.profiles.length - 1))], Math.max(0, Math.min(index, strategy.profiles.length - 1)));
      markDirty();
      render();
    }
    function circularBuilder(profile, visual) {
      if (!visual || !visual.circular) return null;
      var builder = element(document, 'div', 'strategy-editor-circular');
      builder.appendChild(element(document, 'div', 'strategy-editor-section-title', 'Circular: порядок шагов'));
      var steps = element(document, 'div', 'strategy-editor-circular-steps');
      array(visual.circularSteps).forEach(function (step, index) {
        var row = element(document, 'div', 'strategy-editor-circular-step');
        row.dataset.circularIndex = String(index);
        var key = element(document, 'input', 'form-input form-input-sm');
        key.value = text(step.key);
        key.dataset.circularField = 'key';
        key.setAttribute('aria-label', 'Параметр шага ' + String(index + 1));
        var value = element(document, 'input', 'form-input form-input-sm');
        value.value = step.value === true ? '' : text(step.value);
        value.dataset.circularField = 'value';
        value.setAttribute('aria-label', 'Значение шага ' + String(index + 1));
        var remove = element(document, 'button', 'btn-icon-only', '×');
        remove.type = 'button';
        remove.dataset.editorAction = 'remove-circular-step';
        remove.addEventListener('click', function () {
          var next = collectCircularSteps().filter(function (_item, itemIndex) { return itemIndex !== index; });
          applyVisualEdits(profile, { circularSteps: next });
        });
        [key, element(document, 'span', 'strategy-editor-circular-equals', '='), value, remove].forEach(function (item) { row.appendChild(item); });
        [key, value].forEach(function (input) { input.addEventListener('change', function () { applyVisualEdits(profile, { circularSteps: collectCircularSteps() }); }); });
        steps.appendChild(row);
      });
      builder.appendChild(steps);
      function collectCircularSteps() {
        return Array.prototype.map.call(builder.querySelectorAll('[data-circular-index]'), function (row) {
          return {
            key: row.querySelector('[data-circular-field="key"]').value.trim(),
            value: row.querySelector('[data-circular-field="value"]').value.trim(),
          };
        }).filter(function (step) { return step.key; });
      }
      var add = element(document, 'button', 'btn btn-ghost btn-sm', 'Добавить шаг');
      add.type = 'button';
      add.dataset.editorAction = 'add-circular-step';
      add.addEventListener('click', function () {
        var next = collectCircularSteps();
        next.push({ key: 'strategy', value: 'autocircular' });
        applyVisualEdits(profile, { circularSteps: next });
      });
      builder.appendChild(add);
      builder.appendChild(element(document, 'div', 'form-hint', 'Порядок сохраняется в profile.args; серверная validation остаётся обязательной.'));
      return builder;
    }
    function renderVisual() {
      var profile = activeProfile(), host = hosts.fieldsHost;
      if (!host || !profile) return;
      var old = host.querySelector('.strategy-editor-visual');
      if (old) old.remove();
      var parsed = Nfqws2Ide.parseProfile(text(profile.args));
      var visual = element(document, 'div', 'strategy-editor-visual');
      visual.dataset.mode = parsed.mode;
      visual.style.display = viewFor(profile, activeIndex()) === 'visual' ? '' : 'none';
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
      var circular = circularBuilder(profile, values);
      if (circular) visual.appendChild(circular);
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
        if (problem.profileIndex !== undefined) row.dataset.profileIndex = String(problem.profileIndex);
        row.appendChild(element(document, 'b', '', problem.source || 'IDE'));
        row.appendChild(element(document, 'span', '', ': ' + text(problem.message)));
        if (Number.isFinite(problem.from) && Number.isFinite(problem.to) && handle) {
          row.addEventListener('click', function () {
            if (problem.profileIndex !== undefined && problem.profileIndex !== activeIndex()) switchProfile(profileId(strategy.profiles[problem.profileIndex], problem.profileIndex));
            if (handle && handle.view) {
              handle.view.dispatch({ selection: { anchor: problem.from, head: problem.to }, scrollIntoView: true });
              handle.focus();
            }
          });
        }
        hosts.problemsHost.appendChild(row);
      });
    }
    function rememberProfile() {
      var profile = activeProfile();
      if (!profile || !handle) return;
      syncProfileControls();
      profile.args = handle.getValue();
      profileMemory[activeId] = {
        selection: handle.getSelection(),
        scrollTop: handle.view && handle.view.scrollDOM ? handle.view.scrollDOM.scrollTop : 0,
      };
    }
    function restoreProfile() {
      var memory = profileMemory[activeId];
      if (!memory || !handle || !handle.view) return;
      if (memory.selection) handle.view.dispatch({ selection: memory.selection });
      if (handle.view.scrollDOM) handle.view.scrollDOM.scrollTop = memory.scrollTop || 0;
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
            var current = activeProfile();
            if (!current) return;
            current.args = value;
            markDirty();
            if (handle && handle.view) handle.setDiagnostics(nfqws2.lintSource(handle.view));
            renderVisual();
            renderProblems();
          },
          onCursor: function (selection) {
            var current = activeProfile();
            if (current) nfqws2.helpAt(text(current.args), selection.head);
          },
          onSave: function () {
            if (typeof editorState.onSave === 'function') editorState.onSave();
          },
        });
      } else if (handle.getValue() !== text(profile.args)) {
        handle.setValue(text(profile.args), { preserveHistory: true });
      }
      if (handle.view) handle.setDiagnostics(nfqws2.lintSource(handle.view));
      restoreProfile();
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
      syncProfileControls();
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
      rememberProfile();
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
      if (ctx && ctx.api && ctx.api.strategies && ctx.api.strategies.test) {
        var testButton = element(document, 'button', 'btn btn-ghost btn-sm', 'Test');
        testButton.type = 'button';
        testButton.dataset.action = 'editorTest';
        hosts.actionsHost.insertBefore(testButton, hosts.actionsHost.lastChild);
      } else {
        hosts.actionsHost.appendChild(element(document, 'span', 'ide-capability-note', 'Временный runtime-тест не предоставлен backend; сначала используйте Validate и Preview.'));
      }
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
    function backendProblem(item) {
      item = item || {};
      var problem = {
        source: 'Backend',
        severity: diagnosticSeverity(item.severity),
        message: text(item.message || item.code || 'Backend diagnostic'),
      };
      var profileValue = item.profileIndex !== undefined ? item.profileIndex : item.profile_index;
      if (Number.isInteger(Number(profileValue))) problem.profileIndex = Number(profileValue);
      if (item.path !== undefined && item.path !== null) problem.path = text(item.path);
      var offset = Number(item.offset);
      var length = Number(item.length);
      if (Number.isFinite(offset) && offset >= 0) {
        problem.from = offset;
        problem.to = Number.isFinite(length) && length >= 0 ? offset + length : offset;
        return problem;
      }
      var profile = problem.profileIndex !== undefined ? strategy.profiles[problem.profileIndex] : activeProfile();
      var line = Number(item.line);
      if (!profile || !Number.isInteger(line) || line < 1) return problem;
      var lines = text(profile.args).replace(/\r/g, '').split('\n');
      if (line > lines.length) return problem;
      var lineStart = 0;
      for (var index = 0; index < line - 1; index++) lineStart += lines[index].length + 1;
      var column = Number(item.column);
      var columnOffset = Number.isFinite(column) && column > 0 ? Math.min(lines[line - 1].length, column - 1) : 0;
      problem.from = lineStart + columnOffset;
      problem.to = problem.from + (Number.isFinite(length) && length >= 0 ? length : 0);
      return problem;
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
        backendProblems = array(items).map(backendProblem);
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
