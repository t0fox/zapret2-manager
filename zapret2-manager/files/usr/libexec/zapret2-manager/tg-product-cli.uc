#!/usr/bin/ucode
'use strict';

import { readfile } from 'fs';
import {
	tg_product_get, tg_product_catalog, tg_product_status, tg_product_versions,
	tg_product_validate, tg_product_preview, tg_product_apply, tg_product_health,
	tg_product_check_updates, tg_product_switch, tg_product_install, tg_product_update,
	tg_product_remove, tg_product_purge, tg_product_start, tg_product_stop, tg_product_restart
} from './tg-product.uc';

function input(path) {
	if (!path) return null;
	let raw = readfile(path);
	try { return raw ? json(raw) : null; } catch (e) { return null; }
}
function emit(value) { print(sprintf('%J', value) + '\n'); }

let mode = ARGV[0], value = input(ARGV[1]);
if (mode == 'get') emit(tg_product_get());
else if (mode == 'catalog') emit(tg_product_catalog());
else if (mode == 'status') emit(tg_product_status());
else if (mode == 'versions') emit(tg_product_versions());
else if (mode == 'validate') emit(tg_product_validate(value));
else if (mode == 'preview') emit(tg_product_preview(value));
else if (mode == 'apply') emit(tg_product_apply(value));
else if (mode == 'health') emit(tg_product_health(value));
else if (mode == 'check_updates') emit(tg_product_check_updates(value));
else if (mode == 'switch') emit(tg_product_switch(value));
else if (mode == 'install') emit(tg_product_install(value));
else if (mode == 'update') emit(tg_product_update(value));
else if (mode == 'remove') emit(tg_product_remove(value));
else if (mode == 'purge') emit(tg_product_purge(value));
else if (mode == 'start') emit(tg_product_start());
else if (mode == 'stop') emit(tg_product_stop());
else if (mode == 'restart') emit(tg_product_restart());
else { print('usage: tg-product-cli.uc get|catalog|status|versions|validate|preview|apply|health|check_updates|switch|install|update|remove|purge|start|stop|restart [input]\n'); exit(1); }
