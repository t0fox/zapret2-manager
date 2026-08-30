#!/usr/bin/ucode
'use strict';

import { resource_center_recover_pending } from './resource-update.uc';

function emit(value) { print(sprintf('%J', value) + '\n'); }

let result = ARGV[0] == 'recover'
	? resource_center_recover_pending()
	: { ok: false, error: { code: 'EINPUT', message: 'unsupported lifecycle recovery operation' } };
emit(result);
if (!result || result.ok !== true) exit(1);
