#!/usr/bin/ucode
'use strict';

import { readfile } from 'fs';
import { asset_registry_reconcile_builtin } from './asset-registry.uc';

const MANIFEST = '/usr/share/zapret2-manager/assets/manifest.json';
function emit(value) { print(sprintf('%J', value) + '\n'); }
let raw = readfile(MANIFEST), manifest = null;
if (raw == null || length(raw) > 128 * 1024) { emit({ ok: false, error: { code: 'EINPUT', message: 'package asset manifest is unavailable' } }); exit(1); }
try { manifest = json(raw); } catch (e) { emit({ ok: false, error: { code: 'EINPUT', message: 'package asset manifest is malformed' } }); exit(1); }
if (type(manifest) != 'object' || manifest.schema != 1 || type(manifest.assets) != 'array') { emit({ ok: false, error: { code: 'EINPUT', message: 'package asset manifest schema is invalid' } }); exit(1); }
let results = [], ok = true;
for (let i = 0; i < length(manifest.assets); i++) { let result = asset_registry_reconcile_builtin(manifest.assets[i]); push(results, result); if (!result.ok) ok = false; }
emit({ ok: ok, assets: results });
if (!ok) exit(1);
