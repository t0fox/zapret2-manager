#!/usr/bin/ucode
'use strict';
import { readfile } from 'fs';
import { resource_center_status, resource_center_check, resource_center_update, resource_center_prepare_version } from './resource-update.uc';
import { z2k_versions, z2k_version_details } from './z2k-versions.uc';
function emit(value) { print(sprintf('%J', value) + '\n'); }
function request_file(path) { if (type(path) != 'string' || index(path, '/tmp/z2m-resources-edit.') != 0) return {}; let raw = readfile(path); if (raw == null || length(raw) > 32 * 1024 * 1024) return {}; try { let value = json(raw); return type(value) == 'object' && value != null ? value : {}; } catch (e) { return {}; } }
let mode = ARGV[0], result = mode == 'status' ? resource_center_status() : (mode == 'check' ? resource_center_check() : (mode == 'versions' ? z2k_versions() : (mode == 'details' ? z2k_version_details(ARGV[1]) : (mode == 'prepare' ? resource_center_prepare_version(ARGV[1]) : (mode == 'update' ? resource_center_update(request_file(ARGV[1])) : { ok: false, error: { code: 'EINPUT', message: 'unsupported Resource Center operation' } }))));
emit(result); if (!result || result.ok !== true) exit(1);
