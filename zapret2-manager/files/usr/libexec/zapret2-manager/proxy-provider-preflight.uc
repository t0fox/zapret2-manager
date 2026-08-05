'use strict';

import { readfile, unlink, popen } from 'fs';

const RUST_RELEASE_URL = 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/v2.0.0/tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz';
const RUST_API_URL = 'https://api.github.com/repos/valnesfjord/tg-ws-proxy-rs/releases/latest';
const GO_API_URL = 'https://api.github.com/repos/spatiumstas/tg-ws-proxy-go/releases/latest';

function run(command) {
	let p = popen(command + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '';
	let rc = p.close();
	return { rc: rc, out: trim(out) };
}
function release_tag(url, prefix) {
	let file = '/tmp/z2m-proxy-release-' + prefix + '.' + time() + '.json';
	let fetched = run("uclient-fetch -q -T 15 -O '" + file + "' '" + url + "'");
	if (fetched.rc != 0) { try { unlink(file); } catch (e) { } return { ok: false, error: substr(fetched.out, 0, 256) }; }
	let raw = readfile(file); try { unlink(file); } catch (e) { }
	if (!raw) return { ok: false, error: 'empty release response' };
	try {
		let value = json(raw);
		let tag = value != null && type(value) == 'object' ? value.tag_name : null;
		return type(tag) == 'string' && tag != '' ? { ok: true, tag: tag } : { ok: false, error: 'release tag missing' };
	} catch (e) { return { ok: false, error: 'release response is invalid' }; }
}

export const proxy_provider_preflight = function () {
	let arch = trim(run('apk --print-arch').out);
	let rust = run("uclient-fetch -q -T 15 --spider '" + RUST_RELEASE_URL + "'");
	return {
		ok: true,
		readOnly: true,
		architecture: arch || null,
		providers: [
			{ provider: 'rust', source: 'pinned-release', available: arch == 'aarch64' && rust.rc == 0,
				reason: arch != 'aarch64' ? 'Rust release разрешён только для aarch64.' : rust.rc == 0 ? null : 'Pinned Rust release недоступен по HTTPS.' },
			{ provider: 'go', source: 'signed-upstream-apk', available: arch == 'aarch64',
				reason: arch == 'aarch64' ? null : 'Go release разрешён только для aarch64.' }
		]
	};
};

export const proxy_provider_check_updates = function () {
	let rust = release_tag(RUST_API_URL, 'rust');
	let go = release_tag(GO_API_URL, 'go');
	return {
		ok: rust.ok || go.ok,
		checkedAt: time(),
		providers: [
			{ provider: 'rust', approvedVersion: '2.0.0', upstreamVersion: rust.ok ? rust.tag : null,
				updateAvailable: rust.ok && rust.tag != 'v2.0.0', installable: true, error: rust.ok ? null : rust.error },
			{ provider: 'go', approvedVersion: '0.9.3-2', upstreamVersion: go.ok ? go.tag : null,
				updateAvailable: go.ok && go.tag != '0.9.3-rev2', installable: true, error: go.ok ? null : go.error }
		]
	};
};
