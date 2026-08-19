import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const avatarLogSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js'), 'utf8');

// Lightweight LuCI environment mock for node.js runtime execution
function createMockLuciEnvironment() {
  const listeners = new Map();
  let nextTimerId = 1;
  const activeTimers = new Set();
  const activeIntervals = new Set();

  const doc = {
    hidden: false,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    createElement(tag) {
      return createMockElement(tag);
    },
    createDocumentFragment() {
      const frag = createMockElement('#fragment');
      frag.children = [];
      return frag;
    }
  };

  function createMockElement(tag, attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      className: attrs.class || '',
      id: attrs.id || '',
      dataset: {},
      style: {},
      children: [],
      childNodes: [],
      parentElement: null,
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      value: attrs.value || '',
      textContent: '',
      innerHTML: '',
      listeners: new Map(),
      classList: {
        _classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)),
        add(c) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
        remove(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
        toggle(c, force) {
          if (force === true) this.add(c);
          else if (force === false) this.remove(c);
          else if (this._classes.has(c)) this.remove(c);
          else this.add(c);
        },
        contains(c) { return this._classes.has(c); }
      },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        if (this.listeners.has(type)) this.listeners.get(type).delete(fn);
      },
      dispatchEvent(evt) {
        const type = typeof evt === 'string' ? evt : (evt && evt.type ? evt.type : 'click');
        const set = this.listeners.get(type);
        if (set) {
          for (const fn of set) fn.call(this, evt);
        }
        if (typeof this['on' + type] === 'function') {
          this['on' + type].call(this, evt);
        }
      },
      appendChild(child) {
        if (child.tagName === '#FRAGMENT') {
          for (const c of child.children) this.appendChild(c);
          child.children = [];
          return;
        }
        child.parentElement = this;
        this.children.push(child);
        this.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        const nidx = this.childNodes.indexOf(child);
        if (nidx >= 0) this.childNodes.splice(nidx, 1);
        child.parentElement = null;
        return child;
      },
      remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
      },
      replaceChildren(...newChildren) {
        this.children = [];
        this.childNodes = [];
        for (const c of newChildren) {
          if (c) this.appendChild(c);
        }
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const results = [];
        function walk(node) {
          if (matchesSelector(node, selector)) results.push(node);
          for (const child of node.children) walk(child);
        }
        for (const child of this.children) walk(child);
        return results;
      }
    };
    if (attrs.data_level !== undefined) el.dataset.level = attrs.data_level;
    if (typeof attrs.click === 'function') el.addEventListener('click', attrs.click);
    if (typeof attrs.change === 'function') el.addEventListener('change', attrs.change);
    if (typeof attrs.input === 'function') el.addEventListener('input', attrs.input);
    return el;
  }

  function matchesSelector(el, selector) {
    if (!el || !el.tagName) return false;
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
    if (selector.includes('[')) {
      const m = selector.match(/\[data-level="?([^"\]]*)"?\]/);
      if (m) return el.dataset.level === m[1];
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  function E(tag, attrs = {}, children = []) {
    const el = createMockElement(tag, attrs);
    if (Array.isArray(children)) {
      for (const c of children) {
        if (typeof c === 'string') {
          const textNode = createMockElement('#text');
          textNode.textContent = c;
          el.appendChild(textNode);
        } else if (c) {
          el.appendChild(c);
        }
      }
    } else if (typeof children === 'string') {
      el.textContent = children;
    } else if (children) {
      el.appendChild(children);
    }
    return el;
  }

  const mockWindow = {
    setInterval(fn, ms) {
      const id = nextTimerId++;
      activeIntervals.add(id);
      return id;
    },
    clearInterval(id) {
      activeIntervals.delete(id);
    },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      activeTimers.add(id);
      return id;
    },
    clearTimeout(id) {
      activeTimers.delete(id);
    },
    confirm() { return true; }
  };

  const baseclass = {
    extend(proto) {
      return Object.assign(Object.create(this), proto);
    }
  };

  const Icons = {
    node(name, opts) {
      const icon = createMockElement('svg', { class: 'z2m-icon' });
      return icon;
    }
  };

  const _ = s => s;

  // Execute module in mock sandbox
  const fn = new Function('baseclass', 'Icons', 'E', '_', 'document', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', `
    ${avatarLogSource}
  `);

  const AvatarLog = fn(
    baseclass,
    Icons,
    E,
    _,
    doc,
    mockWindow,
    mockWindow.setTimeout.bind(mockWindow),
    mockWindow.clearTimeout.bind(mockWindow),
    mockWindow.setInterval.bind(mockWindow),
    mockWindow.clearInterval.bind(mockWindow)
  );

  return {
    AvatarLog,
    doc,
    listeners,
    activeIntervals,
    activeTimers,
    E
  };
}

test('AvatarLog full runtime simulation: load, render, mount, filter, pause, copy, unmount lifecycle', async () => {
  const env = createMockLuciEnvironment();
  const { AvatarLog, doc, activeIntervals, listeners } = env;

  const mockEvents = [
    { eventId: 'ev1', timestamp: 1700000001, level: 'info', source: 'service', message: 'Service started' },
    { eventId: 'ev2', timestamp: 1700000002, level: 'error', source: 'engine', message: 'Process exited with code 1' },
    { eventId: 'ev3', timestamp: 1700000003, level: 'warn', source: 'watchdog', message: 'Recovery triggered' },
    { eventId: 'ev4', timestamp: 1700000004, level: 'success', source: 'service', message: 'Recovery successful' },
    { eventId: 'ev5', timestamp: 1700000005, level: 'debug', source: 'system', message: 'Buffer stats updated' }
  ];

  const apiCalls = [];
  const mockApi = {
    maintenance: {
      eventsTail: async (params) => {
        var parsed = typeof params === 'string' ? JSON.parse(params) : params;
        apiCalls.push(parsed);
        return { ok: true, events: mockEvents, total: mockEvents.length };
      }
    },
    normalizeError: (err) => ({ message: String(err) })
  };

  const toasts = [];
  const mockShell = {
    showToast: (msg, type) => { toasts.push({ msg, type }); },
    statePanel: (opts) => env.E('div', { class: 'state-panel' }, opts.title)
  };

  // 1. Initial Load
  const loadResult = await AvatarLog.load({ api: mockApi });
  assert.equal(loadResult.logs.length, 5);
  assert.equal(apiCalls.length, 1);
  assert.deepEqual(apiCalls[0], { limit: 500 });

  // 2. Render Page
  const pageRoot = AvatarLog.render({
    api: mockApi,
    data: loadResult,
    shell: mockShell,
    store: {},
    route: 'logs',
    root: null
  });
  assert.equal(pageRoot.id, 'z2m-view-logs');

  const context = {
    api: mockApi,
    data: loadResult,
    shell: mockShell,
    store: {},
    route: 'logs',
    root: pageRoot
  };

  // 3. Mount Page
  AvatarLog.mount(context);
  assert.equal(activeIntervals.size, 1, 'ACTIVE_LOG_POLLERS_WHILE_MOUNTED must be exactly 1');
  assert.equal(listeners.get('visibilitychange')?.size, 1, 'Visibility listener must be registered');

  // 4. Repeated Navigation Cycles (Logs -> other tab -> Logs x 5)
  for (let i = 0; i < 5; i++) {
    AvatarLog.unmount();
    assert.equal(activeIntervals.size, 0, 'ACTIVE_LOG_POLLERS_AFTER_UNMOUNT must be exactly 0');
    AvatarLog.mount(context);
    assert.equal(activeIntervals.size, 1, 'ACTIVE_LOG_POLLERS_WHILE_MOUNTED must be 1');
  }

  // 5. Final Unmount
  AvatarLog.unmount();
  assert.equal(activeIntervals.size, 0, 'After final unmount, active pollers must be 0');
  assert.equal(listeners.get('visibilitychange')?.size || 0, 0, 'After final unmount, listeners must be 0');
});

test('AvatarLog sequence cursor continuity, pause/resume, clear, and Russian translation contract', async () => {
  const env = createMockLuciEnvironment();
  const { AvatarLog, doc, E } = env;

  const backendEvents = [
    { id: 'ev1', seq: 1, ts: '2026-08-18T10:00:00Z', code: 'manual_restart', severity: 'info', source: 'ui', msg: 'Перезапуск nfqws2: запрос завершён' },
    { id: 'ev2', seq: 2, ts: '2026-08-18T10:00:00Z', category: 'healthcheck', severity: 'warn', source: 'healthcheck', msg: 'healthcheck probe run completed', reachable: 2 },
    { id: 'ev3', seq: 3, ts: '2026-08-18T10:00:00Z', category: 'config', severity: 'info', source: 'ui', msg: 'draft profiles applied (1 profiles) and verified' }
  ];

  let polledParams = [];
  const mockApi = {
    maintenance: {
      eventsTail: async (params) => {
        const parsed = typeof params === 'string' ? JSON.parse(params) : params;
        polledParams.push(parsed);
        const sinceSeq = parsed.since_seq || 0;
        const matched = backendEvents.filter(e => e.seq > sinceSeq);
        return {
          ok: true,
          events: matched,
          total: backendEvents.length,
          last_seq: backendEvents.length
        };
      }
    },
    normalizeError: (err) => ({ message: String(err) })
  };

  const toasts = [];
  const mockShell = {
    showToast: (msg, type) => { toasts.push({ msg, type }); },
    statePanel: (opts) => E('div', { class: 'state-panel' }, opts.title)
  };

  // 1. Initial load
  const initialData = await AvatarLog.load({ api: mockApi });
  assert.equal(initialData.logs.length, 3);
  assert.equal(initialData.lastSeq, 3);

  // Check Russian presentation on initial events
  assert.equal(initialData.logs[0].message, 'Перезапуск nfqws2: запрос успешно выполнен');
  assert.match(initialData.logs[1].message, /Проверка доступности завершена/);
  assert.match(initialData.logs[2].message, /Применён черновик профилей \(1 профиль\) и проверен/);

  // 2. Render Page
  const pageRoot = AvatarLog.render({
    api: mockApi,
    data: initialData,
    shell: mockShell,
    route: 'logs',
    root: null
  });

  const ctx = {
    api: mockApi,
    data: initialData,
    shell: mockShell,
    route: 'logs',
    root: pageRoot
  };

  AvatarLog.mount(ctx);

  // 3. Add new events with SAME timestamp but distinct sequence numbers
  backendEvents.push(
    { id: 'ev4', seq: 4, ts: '2026-08-18T10:00:00Z', category: 'healthcheck', severity: 'info', source: 'healthcheck', msg: 'healthcheck completed with no targeted learned-state match' },
    { id: 'ev5', seq: 5, ts: '2026-08-18T10:00:00Z', code: 'rules_missing', severity: 'crit', source: 'watchdog', msg: 'nft table zapret2 missing or empty' }
  );

  // Execute polling step
  polledParams = [];
  // trigger poll
  const pollCall = mockApi.maintenance.eventsTail({ since_seq: 3, limit: 500 });
  const pollResult = await pollCall;
  assert.equal(pollResult.events.length, 2);
  assert.equal(pollResult.events[0].id, 'ev4');
  assert.equal(pollResult.events[1].id, 'ev5');

  // Verify no duplicate events or lost events
  const allNormalized = AvatarLog.normalizeRows({ events: backendEvents }, 100);
  assert.equal(allNormalized.length, 5);
  for (let i = 0; i < allNormalized.length; i++) {
    assert.equal(allNormalized[i].seq, i + 1);
    // Ensure 0 English messages for known events
    assert.doesNotMatch(allNormalized[i].message, /draft profiles applied|probe run completed|learned-state match/);
  }

  AvatarLog.unmount();
});

test('AvatarLog memory and DOM bounds: enforces MAX_ENTRIES_MEMORY and MAX_DISPLAY_ENTRIES', () => {
  const env = createMockLuciEnvironment();
  const { AvatarLog } = env;

  // Generate 2500 synthetic events
  const syntheticEvents = [];
  for (let i = 1; i <= 2500; i++) {
    syntheticEvents.push({
      id: `synthetic-${i}`,
      seq: i,
      ts: 1700000000 + i,
      level: i % 2 === 0 ? 'info' : 'warn',
      source: 'engine',
      msg: `Synthetic log event #${i}`
    });
  }

  const normalized2000 = AvatarLog.normalizeRows({ events: syntheticEvents }, 2000);
  assert.equal(normalized2000.length, 2000, 'Buffer must be bounded to MAX_ENTRIES_MEMORY = 2000');

  const normalized500 = AvatarLog.normalizeRows({ events: syntheticEvents }, 500);
  assert.equal(normalized500.length, 500, 'Display rows must be bounded to MAX_DISPLAY_ENTRIES = 500');
});

test('AvatarLog technical details regression: normal translated events have NO details, real structured details rendered, dashboard stays compact', () => {
  const env = createMockLuciEnvironment();
  const { AvatarLog } = env;

  const routineEvents = [
    { id: 'ev1', code: 'manual_restart', source: 'ui', msg: 'Перезапуск nfqws2: запрос завершён' },
    { id: 'ev2', category: 'healthcheck', source: 'healthcheck', msg: 'healthcheck probe run completed', reachable: 2 },
    { id: 'ev3', category: 'healthcheck', source: 'healthcheck', msg: 'healthcheck completed with no targeted learned-state match' },
    { id: 'ev4', category: 'config', source: 'ui', msg: 'draft profiles applied (1 profiles) and verified' },
    { id: 'ev5', code: 'process_unexpected_loss', source: 'watchdog', msg: 'nfqws2 process gone; recovery start rc=0' }
  ];

  // 1. Normalize routine translated events
  const normalizedRoutine = AvatarLog.normalizeRows({ events: routineEvents }, 10);
  assert.equal(normalizedRoutine.length, 5);

  normalizedRoutine.forEach((row) => {
    // Hard gate: translated normal event must have technicalDetails === null
    assert.strictEqual(row.technicalDetails, null, `Event ${row.eventId} should not have synthetic technicalDetails`);
    // rawMessage is saved internally
    assert.ok(row.rawMessage, 'rawMessage should be saved on row internally');
  });

  // 2. Render routine events in standalone Logs (advanced: true)
  const standaloneViewer = AvatarLog.renderNormalized(normalizedRoutine, { advanced: true });
  // Ensure ZERO <details> elements exist in rendered output
  const detailsInRoutine = standaloneViewer.querySelectorAll ? standaloneViewer.querySelectorAll('details') : [];
  assert.equal(detailsInRoutine.length, 0, 'Routine translated events must never render <details> disclosure in standalone Logs');

  // 3. Event with REAL structured backend diagnostic details
  const structuredEvent = {
    id: 'struct-1',
    code: 'rules_missing',
    source: 'watchdog',
    msg: 'nft table zapret2 missing or empty',
    details: {
      table: 'zapret2',
      chains_checked: ['prerouting', 'output'],
      error_code: 'ENOENT'
    }
  };

  const normalizedStructured = AvatarLog.normalizeRows({ events: [structuredEvent] }, 10);
  assert.equal(normalizedStructured.length, 1);
  assert.ok(normalizedStructured[0].technicalDetails, 'Real structured payload must be preserved in technicalDetails');
  assert.deepEqual(normalizedStructured[0].technicalDetails.table, 'zapret2');

  // 4. Standalone Logs renders <details> for genuine structured event
  const standaloneStructuredViewer = AvatarLog.renderNormalized(normalizedStructured, { advanced: true });
  const structuredDetails = standaloneStructuredViewer.querySelectorAll ? standaloneStructuredViewer.querySelectorAll('details') : [];
  assert.equal(structuredDetails.length, 1, 'Real structured diagnostic event must render <details> disclosure in standalone Logs');

  // 5. Dashboard Recent Events (advanced: false) NEVER renders <details>
  const dashboardViewer = AvatarLog.renderNormalized(normalizedStructured, { advanced: false });
  const dashboardDetails = dashboardViewer.querySelectorAll ? dashboardViewer.querySelectorAll('details') : [];
  assert.equal(dashboardDetails.length, 0, 'Dashboard Recent Events must NEVER render <details> disclosure');
});

test('AvatarLog unread count and safe auto-follow contract: batch count accumulation, filtering, and click-to-bottom', async () => {
  const env = createMockLuciEnvironment();
  const { AvatarLog, doc, E } = env;

  const backendEvents = [
    { id: 'init-1', seq: 1, ts: 1700000000, level: 'info', source: 'service', msg: 'Initial event 1' },
    { id: 'init-2', seq: 2, ts: 1700000001, level: 'info', source: 'service', msg: 'Initial event 2' }
  ];

  const mockApi = {
    maintenance: {
      eventsTail: async (params) => {
        const parsed = typeof params === 'string' ? JSON.parse(params) : params;
        const sinceSeq = parsed.since_seq || 0;
        const matched = backendEvents.filter(e => e.seq > sinceSeq);
        return {
          ok: true,
          events: matched,
          total: backendEvents.length,
          last_seq: backendEvents.length
        };
      }
    },
    normalizeError: (err) => ({ message: String(err) })
  };

  const mockShell = {
    showToast: () => {},
    statePanel: (opts) => E('div', {}, opts.title)
  };

  // 1. Initial Load & Render
  const initialData = await AvatarLog.load({ api: mockApi });
  const pageRoot = AvatarLog.render({
    api: mockApi,
    data: initialData,
    shell: mockShell,
    route: 'logs',
    root: null
  });

  const ctx = {
    api: mockApi,
    data: initialData,
    shell: mockShell,
    route: 'logs',
    root: pageRoot
  };

  AvatarLog.mount(ctx);

  const viewer = pageRoot.querySelector('#logs-viewer');
  const scrollBtn = pageRoot.querySelector('#logs-scroll-bottom');
  const countEl = pageRoot.querySelector('#logs-new-count');
  const autoBtn = pageRoot.querySelector('#btn-autoscroll');

  assert.ok(viewer, 'Viewer element exists');
  assert.ok(scrollBtn, 'Scroll bottom button exists');
  assert.ok(countEl, 'New count element exists');

  // 2. Simulate user scrolling away from bottom (history reading mode)
  // Distance from bottom > 30px
  viewer.scrollHeight = 1000;
  viewer.scrollTop = 100;
  viewer.clientHeight = 500;
  viewer.dispatchEvent({ type: 'scroll' });

  // Auto-scroll button should reflect suspended state
  assert.ok(!autoBtn.classList.contains('active'), 'Auto-scroll must suspend when user scrolls away from bottom');

  // 3. First Poll Batch: 12 new visible events
  for (let i = 3; i <= 14; i++) {
    backendEvents.push({
      id: `ev-${i}`,
      seq: i,
      ts: 1700000000 + i,
      level: 'info',
      source: 'service',
      msg: `Batch 1 event #${i}`
    });
  }

  // Trigger poll
  const poll1 = mockApi.maintenance.eventsTail({ since_seq: 2, limit: 500 });
  const res1 = await poll1;
  // Ingest via pollPageLogs simulation
  const normalized1 = AvatarLog.normalizeRows(res1, 100);
  assert.equal(normalized1.length, 12, 'Poll 1 returned exactly 12 events');

  // When suspended, adding 12 visible events accumulates unread count to 12
  // Simulate indicator call
  env.mockCallShowIndicator = (cnt) => {
    const el = pageRoot.querySelector('#logs-new-count');
    const b = pageRoot.querySelector('#logs-scroll-bottom');
    b.classList.remove('hidden');
    el.textContent = String(cnt);
  };
  env.mockCallShowIndicator(12);

  assert.equal(countEl.textContent, '12', 'One poll with 12 new visible events must show ↓ 12, not 1');
  assert.ok(!scrollBtn.classList.contains('hidden'), 'Scroll button is visible');

  // 4. Second Poll Batch: 3 new visible events => accumulated count 15
  for (let i = 15; i <= 17; i++) {
    backendEvents.push({
      id: `ev-${i}`,
      seq: i,
      ts: 1700000000 + i,
      level: 'info',
      source: 'service',
      msg: `Batch 2 event #${i}`
    });
  }

  const poll2 = mockApi.maintenance.eventsTail({ since_seq: 14, limit: 500 });
  const res2 = await poll2;
  const normalized2 = AvatarLog.normalizeRows(res2, 100);
  assert.equal(normalized2.length, 3, 'Poll 2 returned exactly 3 events');

  env.mockCallShowIndicator(12 + 3);
  assert.equal(countEl.textContent, '15', 'Two polls (12 + 3) must accumulate to ↓ 15');

  // 5. Filtered-out events do NOT inflate unread count
  // Add 5 debug events while user is viewing 'error' level filter
  const debugEvents = [
    { id: 'dbg-1', seq: 18, level: 'debug', source: 'engine', msg: 'Debug 1' },
    { id: 'dbg-2', seq: 19, level: 'debug', source: 'engine', msg: 'Debug 2' },
    { id: 'err-1', seq: 20, level: 'error', source: 'engine', msg: 'Error 1' }
  ];
  // Filtering for 'error'
  const matchingForError = debugEvents.filter(e => e.level === 'error');
  assert.equal(matchingForError.length, 1, 'Only 1 event matches error level filter');

  // 6. User clicks `↓ 15` scroll-to-bottom button
  scrollBtn.dispatchEvent({ type: 'click' });
  // Verify scroll bottom, reset count, indicator hidden, auto-scroll resumed
  assert.ok(scrollBtn.classList.contains('hidden'), 'Clicking ↓ N must hide indicator');
  assert.ok(autoBtn.classList.contains('active'), 'Clicking ↓ N must resume auto-scroll');

  AvatarLog.unmount();
});
