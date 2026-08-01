#!/usr/bin/ucode
'use strict';
import { readfile } from 'fs';
import { discord_preview, discord_apply, discord_rollback, discord_restore_previous } from './discord-profile.uc';
function request(path) { try { let x = json(readfile(path)); return x.args || x; } catch (e) { return {}; } }
let mode = ARGV[0], req = length(ARGV) > 1 ? request(ARGV[1]) : {};
let result = mode == 'preview' ? discord_preview() : mode == 'apply' ? discord_apply(req) : mode == 'rollback' ? discord_rollback() : mode == 'restore_previous' ? discord_restore_previous() : { ok: false, error: 'unknown mode' };
print(sprintf('%J', result) + '\n');
