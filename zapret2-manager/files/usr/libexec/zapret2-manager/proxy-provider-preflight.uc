'use strict';

import { popen } from 'fs';

const TARGETS = [
	{ provider: 'rust', package: 'tg-ws-proxy-rs' },
	{ provider: 'go', package: 'tg-ws-proxy-go' }
];

function run(command) {
	let p = popen(command + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '';
	let rc = p.close();
	return { rc: rc, out: trim(out) };
}

function probe(target) {
	let result = run('command -v apk');
	return {
		provider: target.provider,
		package: target.package,
		available: result.rc == 0,
		reason: result.rc == 0 ? null : 'Пакетный менеджер APK недоступен.',
		detail: result.rc == 0 ? null : substr(result.out, 0, 512)
	};
}

export const proxy_provider_preflight = function () {
	let rows = [];
	for (let i = 0; i < length(TARGETS); i++) push(rows, probe(TARGETS[i]));
	let architecture = trim(run('apk --print-arch').out);
	return {
		ok: true,
		readOnly: true,
		architecture: length(architecture) ? architecture : null,
		providers: rows
	};
};
