#!/usr/bin/ucode
'use strict';

import { readfile } from 'fs';
import {
	tg_product_get, tg_product_catalog, tg_product_versions, tg_product_status,
	tg_product_validate, tg_product_preview, tg_product_apply, tg_product_health,
	tg_product_check_updates, tg_product_switch, tg_product_install, tg_product_update,
	tg_product_remove, tg_product_purge, tg_product_start, tg_product_stop,
	tg_product_restart
} from './tg-product.uc';

function read_args(path) {
	if (!path) return null;
	let raw = readfile(path);
	if (!raw) return null;
	try { return json(raw); } catch (e) { return null; }
}

function emit(value) { print(sprintf('%J', value) + '\n'); }

let mode = ARGV[0], input = read_args(ARGV[1]);
if (mode == 'get') emit(tg_product_get());
else if (mode == 'catalog') emit(tg_product_catalog());
else if (mode == 'versions') emit(tg_product_versions(input));
else if (mode == 'status') emit(tg_product_status());
else if (mode == 'validate') emit(tg_product_validate(input));
else if (mode == 'preview') emit(tg_product_preview(input));
else if (mode == 'apply') emit(tg_product_apply(input));
else if (mode == 'health') emit(tg_product_health(input));
else if (mode == 'check_updates') emit(tg_product_check_updates(input));
else if (mode == 'switch') emit(tg_product_switch(input));
else if (mode == 'install') emit(tg_product_install(input));
else if (mode == 'update') emit(tg_product_update(input));
else if (mode == 'remove') emit(tg_product_remove(input));
else if (mode == 'purge') emit(tg_product_purge(input));
else if (mode == 'start') emit(tg_product_start());
else if (mode == 'stop') emit(tg_product_stop());
else if (mode == 'restart') emit(tg_product_restart());
else { print('usage: tg-product-cli.uc get|catalog|versions|status|validate|preview|apply|health|check_updates|switch|install|update|remove|purge|start|stop|restart [input]\n'); exit(1); }
