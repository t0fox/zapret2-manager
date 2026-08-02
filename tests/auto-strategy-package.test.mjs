import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync('zapret2-manager/Makefile', 'utf8');
const luci = readFileSync('luci-app-zapret2-manager/Makefile', 'utf8');
const full = readFileSync('zapret2-manager-full/Makefile', 'utf8');
const build = readFileSync('tools/build-apk-manual.sh', 'utf8');
const plugin = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

function version(source) {
	const v = source.match(/^PKG_VERSION:=(.+)$/m)?.[1];
	const r = source.match(/^PKG_RELEASE:=(\d+)$/m)?.[1];
	return `${v}-r${r}`;
}

test('M8 release is coherent for the supported manager, LuCI, and full-stack install', () => {
	assert.equal(version(manager), version(luci));
	assert.equal(version(manager), version(full));
});

test('manual APK build derives each manager release from package metadata', () => {
	for (const pkg of ['zapret2-manager', 'luci-app-zapret2-manager', 'zapret2-manager-full']) {
		assert.match(build, new RegExp(`package_version ${pkg}`));
	}
	assert.match(build, /build_one "luci-app-zapret2-manager"[\s\S]*"\$LUCI_VER"/);
	assert.match(build, /build_one "zapret2-manager-full"[\s\S]*"\$FULL_VER"/);
});

test('backend package stages controller, RPC plugin, lifecycle hooks, and only safe install actions', () => {
	for (const file of ['auto-strategy.uc', 'auto-strategy-cli.uc', 'watchdog.uc', 'zapret2-manager.uc', '90-zapret2-manager', 'etc/init.d/zapret2-manager']) assert.match(manager, new RegExp(file.replace('.', '\\.')));
	assert.match(build, /files\/usr\/libexec\/zapret2-manager"\/\*\.uc/);
	assert.match(build, /\/etc\/init\.d\/rpcd reload/);
	assert.match(build, /\/etc\/init\.d\/zapret2-manager enable/);
	assert.doesNotMatch(build, /auto_rpc_run|auto-strategy-cli\.uc run/);
	assert.doesNotMatch(build, /apk add[^\n]*--allow-untrusted/);
});

test('persistent Auto Strategy state is runtime-owned and protected from package replacement', () => {
	assert.doesNotMatch(manager, /auto-strategy\.json/);
	assert.doesNotMatch(manager, /auto-strategy-last-good\.json/);
	assert.match(readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8'), /state_path_safe\(\).*last_good_path_safe/s);
	assert.doesNotMatch(build, /rm -rf \/etc\/zapret2-manager/);
});

test('LuCI package stages ACL menu and every shared view, including Orchestra', () => {
	assert.match(luci, /wildcard \.\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/\*\.js/);
	assert.match(build, /for js in "\$VIEW"\/\*\.js/);
	assert.match(build, /for css in "\$VIEW"\/\*\.css/);
});

test('Auto Strategy registration and narrow read/write ACL are packaged together', () => {
	for (const name of ['orchestra_auto_status', 'orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.match(plugin, new RegExp(name));
	assert.ok(acl.read.ubus['zapret2-manager'].includes('orchestra_auto_status'));
	for (const name of ['orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.ok(acl.write.ubus['zapret2-manager'].includes(name));
});
