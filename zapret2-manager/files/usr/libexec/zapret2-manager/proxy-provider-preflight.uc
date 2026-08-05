'use strict';

import { popen } from 'fs';

const TARGETS = [
	{ provider: 'rust', package: 'tg-ws-proxy-rs', packageVersion: '1.7.1-r1' },
	{ provider: 'go', package: 'tg-ws-proxy-go', packageVersion: '0.9.3-r2' }
];

function run(command) {
	let p = popen(command + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '';
	let rc = p.close();
	return { rc: rc, out: trim(out) };
}

function probe(target) {
	let exact = target.package + '=' + target.packageVersion;
	let result = run('apk add --simulate --no-interactive ' + exact);
	return {
		provider: target.provider,
		package: target.package,
		packageVersion: target.packageVersion,
		available: result.rc == 0,
		reason: result.rc == 0 ? null :
			'Пакет ' + exact + ' недоступен в настроенных доверенных APK-репозиториях.',
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
