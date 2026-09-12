import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const css = fs.readFileSync(`${ROOT}/z2m-ui.css`, 'utf8');
const shell = fs.readFileSync(`${ROOT}/z2m-shell.js`, 'utf8');
const navCss = css.slice(css.lastIndexOf('/* Reference-style product navigation.'));

test('reference header keeps the product mark prominent without changing shell ownership', () => {
  assert.match(css, /\.z2m-app \.z2m-apptop \.z2m-brand \.mark\s*\{[\s\S]*?width:44px[\s\S]*?height:44px/);
  assert.match(css, /\.z2m-app \.z2m-brand \.nm\s*\{[\s\S]*?font-size:clamp\(24px,2\.4vw,30px\)/);
  assert.match(css, /\.z2m-app \.z2m-navigation-shell\s*\{[\s\S]*?overflow:hidden/);
  assert.match(shell, /header-branding-20260903-r1-visual-theme-20260904-r2-reference-header-20260912-r9-compact-brand-gap/);
  assert.match(css, /\.z2m-apptop \.z2m-chip\.g\s*\{[\s\S]*?min-width:0[\s\S]*?width:max-content[\s\S]*?min-height:30px/);
});

test('primary navigation is an icon-led reference-style strip with a contained scroller', () => {
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav\s*\{[\s\S]*?min-height:44px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav\s*\{[\s\S]*?scroll-padding-inline:18px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav button\s*\{[\s\S]*?min-height:42px[\s\S]*?padding:7px 14px 8px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav button\s*\{[\s\S]*?flex-direction:row/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav \.z2m-primary-nav-icon\s*\{[\s\S]*?width:22px[\s\S]*?height:22px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav button\s*\{[\s\S]*?border:1px solid transparent[\s\S]*?border-radius:12px[\s\S]*?background:transparent/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav button\.on\s*\{[\s\S]*?border-color:rgba\(75,159,213,.38\)[\s\S]*?background:linear-gradient/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav,\n\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav\s*\{[\s\S]*?overflow-x:auto[\s\S]*?scrollbar-width:none/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-primary-nav::-webkit-scrollbar,[\s\S]*?display:none/);
});

test('secondary navigation has a readable text hierarchy and preserves the active underline', () => {
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav\s*\{[\s\S]*?min-height:38px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav\s*\{[\s\S]*?margin:0/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav\s*\{[\s\S]*?padding:0 22px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav button\s*\{[\s\S]*?min-height:36px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav button\s*\{[\s\S]*?font-size:14px/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav button\s*\{[\s\S]*?border:0[\s\S]*?border-radius:0[\s\S]*?background:transparent/);
  assert.match(navCss, /\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav button\.on\s*\{[\s\S]*?color:var\(--blue\)[\s\S]*?border-bottom:2px solid var\(--blue\)/);
  assert.match(navCss, /@media \(prefers-reduced-motion:reduce\)[\s\S]*?\.z2m-app \.z2m-navigation-shell \.z2m-secondary-nav button\s*\{[\s\S]*?transition:none/);
});
