#!/usr/bin/ucode
'use strict';
import { readfile } from 'fs';
import { discord_preview, discord_apply, discord_rollback, discord_restore_previous } from './discord-profile.uc';
import { flowseal_combo_list, flowseal_combo_apply } from './flowseal-combo.uc';
function request(path) { try { let x = json(readfile(path)); return x.args || x; } catch (e) { return {}; } }
let mode = ARGV[0], req = length(ARGV) > 1 ? request(ARGV[1]) : {}, result;
if (mode == 'preview') { result = discord_preview(); result.comboCatalog = flowseal_combo_list(); }
else if (mode == 'apply') result = req.candidateId != null ? flowseal_combo_apply(req) : discord_apply(req);
else if (mode == 'rollback') result = discord_rollback();
else if (mode == 'restore_previous') result = discord_restore_previous();
else result = { ok: false, error: 'unknown mode' };
print(sprintf('%J', result) + '\n');
