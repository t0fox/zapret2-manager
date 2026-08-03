# Manager-Wide Cosmetic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every Zapret 2 Manager LuCI page to the approved prototype language while preserving every existing frontend/backend contract and all runtime behavior.

**Architecture:** Extend the existing prefixed `z2m-ui.css` design system, then migrate each LuCI view to the shared components without changing RPC declarations or payloads. A generated frontend RPC snapshot and a path-based backend diff guard prevent cosmetic work from silently changing backend behavior.

**Tech Stack:** LuCI JavaScript views, DOM helper `E()`, LuCI `rpc.declare`, CSS, Node.js `node:test`, JSON menu descriptors.

## Global Constraints

- Work only on branch `feat/strategy-first-integration`.
- Cosmetic baseline commit is `144e5d16cfb726aeafb9844da6e4067c4647a11c`.
- Do not modify files under `zapret2-manager/files/usr/libexec/` after the cosmetic baseline.
- Do not modify rpcd plugins, ACLs, strategy catalogs, generators, service manifests, configuration formats, RPC names, RPC parameters, or apply/rollback sequencing.
- Keep the route `zapret2-manager/proxy`; only its menu title and presentation become `TG PROXY`.
- Keep advanced Orchestra functionality, but remove the separate `Advanced` menu item.
- Remove the separate `Combo presets` menu item and page from the shipped UI.
- Do not create a second sidebar inside the app.
- Do not add external assets, fonts, icon libraries, or CDN dependencies.
- Keep QR rendering on a white surface.
- Keep strategy selection pending until the existing explicit apply action.
- Use only `z2m-`-prefixed CSS selectors for app-owned styles.

---

## File Map

**Shared design system**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`

**Navigation and packaging**
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Modify: `luci-app-zapret2-manager/Makefile`
- Delete after migration: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/combo-presets.js`
- Delete after migration: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.css`

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

### Task 1: Freeze Frontend RPC Contracts and Add the Cosmetic Safety Gate

**Files:**
- Create: `tools/ui-rpc-contract.mjs`
- Create: `tests/fixtures/ui-rpc-contract.json`
- Create: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Produces: `extractRpcMethods(source: string): string[]`
- Produces: `collectUiContract(root: string): Record<string, string[]>`
- Produces: `tests/fixtures/ui-rpc-contract.json`, generated from the approved baseline before any view rewrite.

- [ ] **Step 1: Add the RPC extraction utility**

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

- [ ] **Step 2: Generate the baseline fixture before modifying any view**

Run:

```bash
node tools/ui-rpc-contract.mjs --write
```

Expected: `tests/fixtures/ui-rpc-contract.json` contains sorted RPC method names for all eight target views.

- [ ] **Step 3: Write the failing cosmetic contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8');
const menu = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'));
const expectedRpc = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));

test('frontend RPC contract is byte-for-byte stable by method set', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});

test('shared design system exposes the approved primitives', () => {
  for (const cls of [
    '.z2m-segmented', '.z2m-button-primary', '.z2m-button-secondary',
    '.z2m-button-danger', '.z2m-table', '.z2m-field', '.z2m-switch',
    '.z2m-progress', '.z2m-console', '.z2m-empty-state', '.z2m-sticky-actions'
  ]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
});

test('menu has no standalone Advanced or Combo presets and keeps proxy route', () => {
  const entries = Object.values(menu);
  assert.equal(entries.some((entry) => entry.title === 'Advanced'), false);
  assert.equal(entries.some((entry) => entry.title === 'Combo presets'), false);
  const proxy = entries.find((entry) => entry.action?.path === 'zapret2-manager/proxy');
  assert.equal(proxy.title, 'TG PROXY');
});
```

- [ ] **Step 4: Run the test and verify RED**

Run:

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected: FAIL because the complete primitive set and final menu titles are not present yet; the RPC snapshot subtest passes.

- [ ] **Step 5: Commit the safety harness only**

```bash
git add tools/ui-rpc-contract.mjs tests/fixtures/ui-rpc-contract.json tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "test: freeze LuCI RPC contracts for cosmetic redesign"
```

---

### Task 2: Build the Shared Prototype-Style Design System

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Produces the `z2m-` component classes listed in the specification.
- Consumed by every remaining task through each page's existing `injectCSS()` path.

- [ ] **Step 1: Add a failing token assertion**

Extend the design-system test to require these literal prototype tokens:

```js
for (const token of ['#191919', '#202020', '#282827', '#383836', '#5E9FE8', '#72BC8F', '#DE9255', '#E97366']) {
  assert.match(css.toUpperCase(), new RegExp(token.toUpperCase()));
}
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="shared design system"
```

Expected: FAIL on missing prototype tokens or missing primitives.

- [ ] **Step 3: Implement the shared tokens and primitives**

Add or normalize:

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

Also add:

- focus-visible states;
- reduced-motion handling;
- responsive single-column grids;
- mobile-safe table scrolling;
- shared modal and toast surfaces;
- white `.z2m-proxy-qr-surface`.

Do not use unprefixed selectors except inside `.z2m-page` descendants.

- [ ] **Step 4: Run the focused test and CSS brace sanity**

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
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps every RPC method already frozen in `tests/fixtures/ui-rpc-contract.json`.
- Keeps the root and Orchestra routes pointing to `zapret2-manager/orchestra-strategy`.
- Advanced mode switches to the existing Orchestra view without adding a menu item.

- [ ] **Step 1: Extend the failing Orchestra tests**

Require:

```js
assert.match(src, /z2m-segmented/);
assert.match(src, /Простой режим|Simple mode/);
assert.match(src, /Расширенный режим|Advanced mode/);
assert.match(src, /Применить|Apply/);
assert.doesNotMatch(src, /callApply\([^)]*\)[\s\S]{0,120}render/);
```

Require the menu to contain only the seven approved visible entries.

- [ ] **Step 2: Run RED**

```bash
node --test tests/orchestra-strategy-ui.test.mjs tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected: FAIL on final shell/menu structure.

- [ ] **Step 3: Implement the Orchestra visual shell**

In `orchestra-strategy.js`:

- wrap output in `.z2m-page`;
- add page header, hero cards, segmented mode control, strategy grid, selected-strategy details, targeted test card, latest-run summary and override list;
- hide raw `NFQWS2_OPT` behind `<details>`;
- keep existing event handlers and RPC payloads unchanged;
- keep click-to-select local and explicit apply separate.

In `orchestra.js`:

- wrap legacy panels in `.z2m-page z2m-orchestra-advanced`;
- use shared cards, tables, callouts, progress and console classes;
- remove duplicate top headings when embedded from simple mode;
- keep run/history/ratings/diagnostics handlers unchanged.

In menu JSON:

- remove `admin/services/zapret2-manager/advanced`;
- keep `admin/services/zapret2-manager` and `/orchestra` routed to `orchestra-strategy`;
- rename visible titles to Russian where specified;
- keep ACL arrays unchanged.

- [ ] **Step 4: Run tests and syntax checks**

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

### Task 4: Restyle Profiles and Lists Without Changing Their Editors

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js`
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps the frozen RPC sets for `strategies.js` and `lists.js`.
- Keeps existing save/apply/reset/domain-check payload construction.

- [ ] **Step 1: Add failing source-structure assertions**

```js
for (const name of ['strategies.js', 'lists.js']) {
  const src = readFileSync(`${root}/${name}`, 'utf8');
  assert.match(src, /z2m-page/);
  assert.match(src, /z2m-hero/);
  assert.match(src, /z2m-card/);
}
assert.match(readFileSync(`${root}/lists.js`, 'utf8'), /z2m-tabs/);
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="Profiles and Lists"
```

Expected: FAIL.

- [ ] **Step 3: Migrate Profiles**

- preserve all existing form fields and handlers;
- add a hero with active profile count and applied/draft state;
- render profile rows as compact rule cards or a responsive table;
- place presets in a second card/grid region;
- put the generated technical options in `<details class="z2m-technical-details">`;
- use shared modal/toast/callout styles.

- [ ] **Step 4: Migrate Lists**

- keep domain include/exclude, IP lists, autohostlist and domain check;
- add tabs for domains, IP and engine lists;
- mark engine lists read-only visually;
- show conflict results before action buttons;
- keep existing validation and RPC calls untouched.

- [ ] **Step 5: Run tests and syntax checks**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategies.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/lists.js \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign Profiles and Lists pages"
```

---

### Task 5: Restyle DNS While Preserving All Five Sections and RPC Calls

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js`
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps section IDs `setup`, `providers`, `services`, `advanced`, `history`.
- Keeps every DNS and service-DNS RPC method from the frozen fixture.

- [ ] **Step 1: Add failing DNS structure tests**

```js
const dns = readFileSync(`${root}/dns.js`, 'utf8');
for (const id of ['setup', 'providers', 'services', 'advanced', 'history']) {
  assert.match(dns, new RegExp(`id:\\s*['"]${id}['"]`));
}
for (const cls of ['z2m-page', 'z2m-hero', 'z2m-tabs', 'z2m-provider-grid', 'z2m-table']) {
  assert.match(dns, new RegExp(cls));
}
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="DNS"
```

Expected: FAIL on the missing final layout classes.

- [ ] **Step 3: Implement the DNS cosmetic migration**

- keep the current `SECTIONS` array and tab state machine;
- add a resolver hero and concise primary action;
- convert provider cards to shared card/button/progress classes;
- keep async testing results on theme-aware surfaces;
- group Service Access by existing categories;
- convert Advanced into a calm form card;
- convert History into `.z2m-table` inside `.z2m-table-wrap`;
- remove redundant long descriptions but keep all data and actions;
- do not alter any request object passed to DNS RPCs.

- [ ] **Step 4: Run tests and syntax**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign DNS workspace"
```

---

### Task 6: Restyle Monitor and Maintenance

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js`
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps the frozen RPC sets and all existing refresh, backup, restore and destructive-action handlers.

- [ ] **Step 1: Add failing layout tests**

```js
for (const name of ['monitor.js', 'maintenance.js']) {
  const src = readFileSync(`${root}/${name}`, 'utf8');
  assert.match(src, /z2m-page/);
  assert.match(src, /z2m-hero/);
  assert.match(src, /z2m-card-grid/);
  assert.match(src, /z2m-table/);
}
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="Monitor and Maintenance"
```

Expected: FAIL.

- [ ] **Step 3: Implement Monitor presentation**

- hero for service truth;
- KPI cards for uptime, RSS, queues and health;
- warnings before technical tables;
- runtime instances and jobs in responsive tables;
- raw JSON/log details in `<details>` and `.z2m-console`;
- keep refresh/control handlers unchanged.

- [ ] **Step 4: Implement Maintenance presentation**

- hero for latest backup/restore state;
- one card per existing backup scope;
- history as a shared table;
- destructive actions in a separate danger card;
- retain current confirmation and RPC flows.

- [ ] **Step 5: Run tests and syntax**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/monitor.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/maintenance.js
```

Expected: PASS.

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
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Test: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Keeps route `zapret2-manager/proxy`.
- Keeps all proxy RPC methods and existing QR generator.
- Keeps link reveal, copy, open, QR, rotate, install, start, stop and restart handlers.

- [ ] **Step 1: Add failing TG PROXY tests**

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

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="TG PROXY"
```

Expected: FAIL on the final page classes/title.

- [ ] **Step 3: Implement the TG PROXY shell**

- retain the current large QR implementation unchanged;
- replace the old `cbi-section` simple mode shell with `.z2m-page` and `.z2m-proxy-hero`;
- use state-driven primary actions already backed by existing handlers;
- render connection link, Open, Copy, QR and Regenerate in `.z2m-proxy-connection`;
- render recent activity as a shared table;
- group configuration, autostart, secret rotation, capabilities and logs into `.z2m-proxy-advanced` details/tabs;
- replace inline colors and spacing with shared classes;
- keep QR paper white and modal keyboard-close behavior.

- [ ] **Step 4: Run tests and syntax**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/proxy.js \
  luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: redesign Proxy as TG PROXY"
```

---

### Task 8: Remove Obsolete UI Artifacts, Bump LuCI Release, and Verify the Full Cosmetic Diff

**Files:**
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/combo-presets.js`
- Delete: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.css`
- Delete or replace: `tests/ui/combo-presets.test.mjs`
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`

**Interfaces:**
- Final menu has seven visible pages.
- No shipped view references `combo-presets` or `orchestra-strategy.css`.
- Backend diff since baseline is empty.

- [ ] **Step 1: Add failing cleanup assertions**

```js
import { existsSync } from 'node:fs';
assert.equal(existsSync(`${root}/combo-presets.js`), false);
assert.equal(existsSync(`${root}/orchestra-strategy.css`), false);
```

Also assert no menu action path contains `combo-presets` or standalone `orchestra` advanced route.

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/manager-cosmetic-redesign.test.mjs --test-name-pattern="obsolete"
```

Expected: FAIL while obsolete files still exist.

- [ ] **Step 3: Remove obsolete frontend artifacts and update the old combo test**

- delete `combo-presets.js`;
- delete one-line `orchestra-strategy.css` after all relevant styles live in `z2m-ui.css`;
- delete `tests/ui/combo-presets.test.mjs` or replace it with assertions inside the manager-wide test that built-in strategies remain in `orchestra-strategy.js` and no separate page exists;
- bump only `PKG_RELEASE` in `luci-app-zapret2-manager/Makefile` by one; do not change backend package release.

- [ ] **Step 4: Run the complete verification suite**

```bash
node tools/ui-rpc-contract.mjs
node --test tests/ui/manager-cosmetic-redesign.test.mjs tests/orchestra-strategy-ui.test.mjs
node --test tests/flowseal-combo.test.mjs tests/flowseal-combo-apply.test.mjs tests/flowseal-combo-integration.test.mjs
for f in \
  orchestra-strategy.js orchestra.js strategies.js lists.js dns.js monitor.js proxy.js maintenance.js; do
  node --check "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/$f" || exit 1
done
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
```

Expected: all tests and syntax checks PASS.

- [ ] **Step 5: Prove no backend files changed during the cosmetic phase**

```bash
changed="$(git diff --name-only 144e5d16cfb726aeafb9844da6e4067c4647a11c..HEAD -- zapret2-manager/files/usr/libexec/)"
test -z "$changed" || { printf '%s\n' "$changed"; exit 1; }
```

Expected: no output and exit code 0.

- [ ] **Step 6: Inspect the final frontend-only diff**

```bash
git diff --stat 144e5d16cfb726aeafb9844da6e4067c4647a11c..HEAD -- \
  luci-app-zapret2-manager tests/ui tests/orchestra-strategy-ui.test.mjs tools/ui-rpc-contract.mjs
```

Expected: only LuCI views, shared CSS, menu, LuCI package release, frontend contract tooling and UI tests.

- [ ] **Step 7: Commit**

```bash
git add -A luci-app-zapret2-manager tests/ui tests/orchestra-strategy-ui.test.mjs tools/ui-rpc-contract.mjs tests/fixtures/ui-rpc-contract.json
git commit -m "style: complete manager-wide LuCI redesign"
```

---

## Manual Acceptance Checklist

- [ ] Desktop dark theme: every page uses the same surfaces, typography, buttons and statuses.
- [ ] Desktop light theme: text, borders and async result states remain readable.
- [ ] Narrow viewport: grids collapse, tables scroll, no sticky bar covers controls.
- [ ] Orchestra: selecting a strategy does not call apply; explicit apply and rollback controls remain.
- [ ] Advanced Orchestra opens from the mode switch and all legacy panels remain reachable.
- [ ] Profiles: edit/save/apply/reset handlers still operate on the same fields.
- [ ] Lists: include/exclude conflicts still block apply and domain check still works.
- [ ] DNS: all five sections open; provider testing and apply UI retain previous payloads.
- [ ] Monitor: refresh and service controls remain connected.
- [ ] TG PROXY: install/start/stop/restart, link reveal, copy, open, QR and rotate controls remain.
- [ ] Maintenance: backup/restore and destructive confirmations remain.
- [ ] No standalone Advanced or Combo presets menu entry.
- [ ] No backend file changed after cosmetic baseline commit.

## Self-Review Result

- Spec coverage: all navigation, shared component, Orchestra, Profiles, Lists, DNS, Monitor, TG PROXY, Maintenance, accessibility, responsive and verification requirements map to a task.
- Placeholder scan: no `TBD`, `TODO`, “implement later” or undefined interfaces.
- Type consistency: RPC contract extraction and fixture names are consistent across all tasks.
- Scope decision: one plan is retained because all pages depend on one shared design system and one immutable RPC fixture; each task remains independently reviewable and testable.
