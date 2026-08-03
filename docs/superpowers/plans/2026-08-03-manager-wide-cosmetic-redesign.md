# Manager-Wide Cosmetic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every Zapret 2 Manager LuCI page to the approved prototype language while preserving every existing frontend/backend contract and all runtime behavior.

**Architecture:** Extend the existing prefixed `z2m-ui.css` design system, then migrate each LuCI view to shared components without changing RPC declarations or payloads. A generated frontend RPC snapshot and a path-based backend diff guard prevent cosmetic work from silently changing behavior.

**Tech Stack:** LuCI JavaScript views, DOM helper `E()`, LuCI `rpc.declare`, CSS, Node.js `node:test`, JSON menu descriptors.

## Global Constraints

- Work only on branch `feat/strategy-first-integration`.
- Cosmetic baseline commit is `144e5d16cfb726aeafb9844da6e4067c4647a11c`.
- Do not modify files under `zapret2-manager/files/usr/libexec/` after the cosmetic baseline.
- Do not modify rpcd plugins, ACLs, strategy catalogs, generators, service manifests, configuration formats, RPC names, RPC parameters, or apply/rollback sequencing.
- Keep route `zapret2-manager/proxy`; only its menu title and presentation become `TG PROXY`.
- Keep advanced Orchestra functionality, but remove the separate `Advanced` menu item.
- Remove the separate `Combo presets` menu item and page from the shipped UI.
- Do not create a second sidebar inside the app.
- Do not add external assets, fonts, icon libraries, or CDN dependencies.
- Keep QR rendering on a white surface.
- Keep strategy selection pending until the existing explicit apply action.
- Use only `z2m-`-prefixed app-owned CSS selectors.

---

## File Map

**Shared design system**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`

**Navigation and packaging**
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Modify: `luci-app-zapret2-manager/Makefile`
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/combo-presets.js`
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.css`

**Views**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js`

**Contract tooling and tests**
- Create: `tools/ui-rpc-contract.mjs`
- Create: `tests/fixtures/ui-rpc-contract.json`
- Create: `tests/ui/manager-cosmetic-redesign.test.mjs`
- Modify: `tests/orchestra-strategy-ui.test.mjs`
- Delete or replace: `tests/ui/combo-presets.test.mjs`

---

### Task 1: Freeze the Existing Frontend RPC Contract

**Files:**
- Create: `tools/ui-rpc-contract.mjs`
- Create: `tests/fixtures/ui-rpc-contract.json`
- Create: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Produces: `extractRpcMethods(source: string): string[]`
- Produces: `collectUiContract(root: string): Record<string, string[]>`
- Produces: immutable baseline fixture `tests/fixtures/ui-rpc-contract.json`.

- [ ] **Step 1: Add the extraction utility**

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const UI_FILES = [
  'orchestra-strategy.js', 'orchestra.js', 'strategies.js', 'lists.js',
  'dns.js', 'monitor.js', 'proxy.js', 'maintenance.js'
];

export function extractRpcMethods(source) {
  return [...source.matchAll(/method\s*:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
}

export function collectUiContract(root = process.cwd()) {
  const base = resolve(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
  return Object.fromEntries(UI_FILES.map((name) => [
    name,
    extractRpcMethods(readFileSync(resolve(base, name), 'utf8'))
  ]));
}

if (process.argv.includes('--write')) {
  writeFileSync(
    resolve('tests/fixtures/ui-rpc-contract.json'),
    JSON.stringify(collectUiContract(), null, 2) + '\n'
  );
}
```

- [ ] **Step 2: Generate the fixture before modifying any view**

```bash
node tools/ui-rpc-contract.mjs --write
```

Expected: fixture contains sorted method names for all eight target views.

- [ ] **Step 3: Add the green baseline contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const expectedRpc = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));

test('frontend RPC method sets remain unchanged', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});
```

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/ui-rpc-contract.mjs tests/fixtures/ui-rpc-contract.json tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "test: freeze LuCI RPC contracts for cosmetic redesign"
```

---

### Task 2: Build the Shared Prototype-Style Design System

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Produces the shared `z2m-` component classes consumed by every later task.

- [ ] **Step 1: Add failing design-system assertions**

```js
const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8');

test('shared design system exposes approved tokens and primitives', () => {
  for (const token of ['#191919', '#202020', '#282827', '#383836', '#5E9FE8', '#72BC8F', '#DE9255', '#E97366'])
    assert.match(css.toUpperCase(), new RegExp(token.toUpperCase()));

  for (const cls of [
    '.z2m-segmented', '.z2m-button-primary', '.z2m-button-secondary',
    '.z2m-button-danger', '.z2m-table', '.z2m-field', '.z2m-switch',
    '.z2m-progress', '.z2m-console', '.z2m-empty-state', '.z2m-sticky-actions'
  ]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="shared design system"
```

Expected: FAIL on missing tokens or primitives.

- [ ] **Step 3: Implement the shared CSS primitives**

```css
.z2m-page {
  --z2m-canvas: #191919;
  --z2m-surface: #202020;
  --z2m-surface-raised: #282827;
  --z2m-surface-hover: #383836;
  --z2m-accent: #5E9FE8;
  --z2m-success: #72BC8F;
  --z2m-warning: #DE9255;
  --z2m-danger: #E97366;
  --z2m-radius: 12px;
}

.z2m-card { border-radius: var(--z2m-radius); }
.z2m-segmented { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; }
.z2m-button-primary,
.z2m-button-secondary,
.z2m-button-danger { min-height: 38px; border-radius: 8px; }
.z2m-table-wrap { overflow-x: auto; }
.z2m-table { width: 100%; border-collapse: collapse; }
.z2m-field input,
.z2m-field select,
.z2m-field textarea { width: 100%; border-radius: 8px; }
.z2m-console { overflow: auto; font-family: monospace; }
.z2m-sticky-actions { position: sticky; bottom: 12px; z-index: 20; }
```

Also add focus-visible states, reduced-motion handling, responsive grids, mobile table scrolling, shared modal/toast surfaces and white `.z2m-proxy-qr-surface`. Keep selectors prefixed or scoped under `.z2m-page`.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="shared design system"
node - <<'NODE'
const fs = require('fs');
const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');
let n = 0;
for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '')) { if (c === '{') n++; if (c === '}') n--; if (n < 0) process.exit(1); }
if (n !== 0) process.exit(1);
NODE
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: add shared prototype design system"
```

---

### Task 3: Simplify Navigation and Finish the Orchestra Shell

**Files:**
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js`
- Modify: `tests/orchestra-strategy-ui.test.mjs`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps frozen RPC method sets.
- Keeps root and Orchestra routes on `zapret2-manager/orchestra-strategy`.
- Opens legacy Orchestra from the in-page mode switch, not a menu item.

- [ ] **Step 1: Add failing menu and Orchestra assertions**

```js
const menu = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'));
const entries = Object.values(menu);
assert.equal(entries.some((entry) => entry.title === 'Advanced'), false);
assert.equal(entries.some((entry) => entry.title === 'Combo presets'), false);
assert.equal(entries.find((entry) => entry.action && entry.action.path === 'zapret2-manager/proxy').title, 'TG PROXY');

assert.match(src, /z2m-segmented/);
assert.match(src, /Простой режим|Simple mode/);
assert.match(src, /Расширенный режим|Advanced mode/);
assert.match(src, /Применить|Apply/);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/orchestra-strategy-ui.test.mjs tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected: FAIL on final menu or shell structure.

- [ ] **Step 3: Implement navigation and Orchestra presentation**

In `orchestra-strategy.js`:

- wrap output in `.z2m-page`;
- add page header, hero, segmented mode control, strategy grid, selected details, targeted-test card, latest-run summary and override list;
- hide raw options behind `<details>`;
- preserve all handlers and payloads;
- keep click-to-select local and explicit apply separate.

In `orchestra.js`:

- wrap legacy panels in `.z2m-page z2m-orchestra-advanced`;
- replace local presentation with shared cards, tables, progress and console classes;
- preserve run, history, rating and diagnostics actions.

In menu JSON:

- remove standalone `advanced` and `combo-presets` entries;
- retain ACL arrays unchanged;
- use the approved visible page titles;
- retain proxy action path and rename its title to `TG PROXY`.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/orchestra-strategy-ui.test.mjs tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js \
  tests/orchestra-strategy-ui.test.mjs tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: unify Orchestra navigation and layout"
```

---

### Task 4: Restyle Profiles and Lists

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps frozen RPC sets and existing save/apply/reset/domain-check payloads.

- [ ] **Step 1: Add failing structure assertions**

```js
for (const name of ['strategies.js', 'lists.js']) {
  const page = readFileSync(`${root}/${name}`, 'utf8');
  assert.match(page, /z2m-page/);
  assert.match(page, /z2m-hero/);
  assert.match(page, /z2m-card/);
}
assert.match(readFileSync(`${root}/lists.js`, 'utf8'), /z2m-tabs/);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="Profiles and Lists"
```

- [ ] **Step 3: Migrate Profiles presentation**

Keep all fields and handlers. Add applied/draft hero, compact profile rows, preset card region, shared modal/callout styles and a collapsed technical options block.

- [ ] **Step 4: Migrate Lists presentation**

Keep include/exclude, IP lists, autohostlist, domain check and conflict validation. Add domain/IP/engine tabs, read-only styling and conflict callouts before action controls.

- [ ] **Step 5: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js
```

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign Profiles and Lists pages"
```

---

### Task 5: Restyle DNS While Preserving All Five Sections

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps section IDs `setup`, `providers`, `services`, `advanced`, `history`.
- Keeps all frozen DNS and service-DNS RPC methods.

- [ ] **Step 1: Add failing DNS assertions**

```js
const dns = readFileSync(`${root}/dns.js`, 'utf8');
for (const id of ['setup', 'providers', 'services', 'advanced', 'history'])
  assert.match(dns, new RegExp(`id:\\s*['"]${id}['"]`));
for (const cls of ['z2m-page', 'z2m-hero', 'z2m-tabs', 'z2m-provider-grid', 'z2m-table'])
  assert.match(dns, new RegExp(cls));
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="DNS"
```

- [ ] **Step 3: Implement the DNS migration**

Keep the current section state machine and every request object. Add a resolver hero, shared tabs, provider cards, themed async results, categorized Service Access grid, calm Advanced form card and History table. Remove only repeated explanatory copy.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js
```

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign DNS workspace"
```

---

### Task 6: Restyle Monitor and Maintenance

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps frozen RPC sets and current refresh, backup, restore and destructive-action handlers.

- [ ] **Step 1: Add failing layout assertions**

```js
for (const name of ['monitor.js', 'maintenance.js']) {
  const page = readFileSync(`${root}/${name}`, 'utf8');
  assert.match(page, /z2m-page/);
  assert.match(page, /z2m-hero/);
  assert.match(page, /z2m-card-grid/);
  assert.match(page, /z2m-table/);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="Monitor and Maintenance"
```

- [ ] **Step 3: Implement Monitor presentation**

Add service-truth hero, KPI cards, warning-first ordering, responsive runtime/job tables and collapsed raw console details. Preserve all controls.

- [ ] **Step 4: Implement Maintenance presentation**

Add latest-backup hero, cards per existing scope, shared history table and separate danger card for destructive actions. Preserve confirmations and RPC payloads.

- [ ] **Step 5: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js
```

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign Monitor and Maintenance"
```

---

### Task 7: Restyle the Existing Proxy Page as TG PROXY

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps route `zapret2-manager/proxy`.
- Keeps all frozen proxy RPC methods and the existing QR generator.
- Keeps link reveal, copy, open, QR, rotate, install, start, stop and restart handlers.

- [ ] **Step 1: Add failing TG PROXY assertions**

```js
const proxy = readFileSync(`${root}/proxy.js`, 'utf8');
assert.match(proxy, /TG PROXY/);
assert.match(proxy, /z2m-proxy-hero/);
assert.match(proxy, /z2m-proxy-connection/);
assert.match(proxy, /z2m-proxy-advanced/);
assert.match(proxy, /qrcode/);
assert.match(proxy, /callProxyStart/);
assert.match(proxy, /callProxyStop/);
assert.match(proxy, /callProxyLinkInfo/);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="TG PROXY"
```

- [ ] **Step 3: Implement the TG PROXY shell**

Leave the QR implementation untouched. Replace the old simple-mode wrapper with page/header/hero components, state-driven primary actions, a connection card, recent activity table and an advanced section for configuration, autostart, rotation, capabilities and logs. Replace inline styling with shared classes and keep QR paper white.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js
```

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign Proxy as TG PROXY"
```

---

### Task 8: Remove Obsolete UI Artifacts and Verify the Complete Cosmetic Diff

**Files:**
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/combo-presets.js`
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.css`
- Delete or replace: `tests/ui/combo-presets.test.mjs`
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Final menu has seven visible pages.
- No shipped view references obsolete assets.
- Backend diff since baseline is empty.

- [ ] **Step 1: Add failing cleanup assertions**

```js
import { existsSync } from 'node:fs';
assert.equal(existsSync(`${root}/combo-presets.js`), false);
assert.equal(existsSync(`${root}/orchestra-strategy.css`), false);
```

Also assert no menu action contains `combo-presets` or a standalone advanced Orchestra route.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="obsolete"
```

- [ ] **Step 3: Perform cleanup**

Delete the two obsolete frontend files. Delete the obsolete combo page test or replace it with assertions that built-in strategies remain in `orchestra-strategy.js`. Increment only `PKG_RELEASE` in `luci-app-zapret2-manager/Makefile`; do not change the backend package release.

- [ ] **Step 4: Run full verification**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs tests/orchestra-strategy-ui.test.mjs
node --test tests/flowseal-combo.test.mjs tests/flowseal-combo-apply.test.mjs tests/flowseal-combo-integration.test.mjs
for f in orchestra-strategy.js orchestra.js strategies.js lists.js dns.js monitor.js proxy.js maintenance.js; do
  node --check "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/$f" || exit 1
done
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
```

Expected: PASS.

- [ ] **Step 5: Prove no cosmetic-phase backend change**

```bash
changed="$(git diff --name-only 144e5d16cfb726aeafb9844da6e4067c4647a11c..HEAD -- zapret2-manager/files/usr/libexec/)"
test -z "$changed" || { printf '%s\n' "$changed"; exit 1; }
```

Expected: no output and exit code 0.

- [ ] **Step 6: Inspect the final frontend diff**

```bash
git diff --stat 144e5d16cfb726aeafb9844da6e4067c4647a11c..HEAD -- \
  luci-app-zapret2-manager tests/ui tests/orchestra-strategy-ui.test.mjs tools/ui-rpc-contract.mjs tests/fixtures/ui-rpc-contract.json
```

- [ ] **Step 7: Commit**

```bash
git add -A luci-app-zapret2-manager tests/ui tests/orchestra-strategy-ui.test.mjs tools/ui-rpc-contract.mjs tests/fixtures/ui-rpc-contract.json
git commit -m "style: complete manager-wide LuCI redesign"
```

---

## Manual Acceptance Checklist

- [ ] Desktop dark theme: all pages share surfaces, typography, buttons and statuses.
- [ ] Desktop light theme: text, borders and async results remain readable.
- [ ] Narrow viewport: grids collapse, tables scroll and sticky actions do not cover controls.
- [ ] Orchestra selection remains pending until explicit apply.
- [ ] Advanced Orchestra remains reachable through the mode switch.
- [ ] Profiles handlers and fields remain intact.
- [ ] Lists conflict blocking and domain check remain intact.
- [ ] All five DNS sections remain reachable and preserve payloads.
- [ ] Monitor refresh and controls remain connected.
- [ ] TG PROXY install/start/stop/restart, link, copy, open, QR and rotation remain connected.
- [ ] Maintenance backup/restore and confirmations remain connected.
- [ ] No standalone Advanced or Combo presets menu entry remains.
- [ ] No backend file changed after cosmetic baseline commit.

## Self-Review Result

- Spec coverage: navigation, shared components, Orchestra, Profiles, Lists, DNS, Monitor, TG PROXY, Maintenance, accessibility, responsive behavior and verification each map to a task.
- Placeholder scan: no `TBD`, `TODO`, “implement later” or undefined interfaces.
- Type consistency: RPC extraction and fixture names remain identical across tasks.
- Task boundaries: every task ends with a green test state and an independently reviewable commit.
- Scope decision: one plan is retained because all pages depend on one shared design system and one immutable RPC fixture.
