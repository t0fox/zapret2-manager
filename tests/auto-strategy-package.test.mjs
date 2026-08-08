import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const manager = readFileSync('zapret2-manager/Makefile', 'utf8');
const luci = readFileSync('luci-app-zapret2-manager/Makefile', 'utf8');
const full = readFileSync('zapret2-manager-full/Makefile', 'utf8');
const plugin = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

function packageVersion(source) {
	return source.match(/^PKG_VERSION:=(.+)$/m)?.[1];
}
function packageRelease(source) {
	return Number(source.match(/^PKG_RELEASE:=(\d+)$/m)?.[1]);
}

test('M8 package versions are coherent while frontend release may advance independently', () => {
	assert.equal(packageVersion(manager), packageVersion(luci));
	assert.equal(packageVersion(manager), packageVersion(full));
	assert.equal(packageRelease(manager), packageRelease(luci));
	assert.equal(packageRelease(manager), packageRelease(full));
});

test('standard OpenWrt package metadata is the release and build authority', () => {
	assert.match(manager, /define Build\/Prepare[\s\S]*src\/z2m-core-helper/);
	assert.match(manager, /define Build\/Compile[\s\S]*\$\(TARGET_CC\)/);
	assert.match(manager, /-ljson-c/);
	assert.doesNotMatch(manager, /^\s*DEPENDS:=[^\n]*\+zapret2(?:\s|$)/m);
	assert.equal(existsSync('tools/build-apk-manual.sh'), false,
		'obsolete manual APK builder must not be restored');
});

test('backend package stages controller, RPC plugin, lifecycle hooks, and only safe install actions', () => {
	assert.match(manager, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
	for (const file of [
		'zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc',
		'zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy-cli.uc',
		'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc',
		'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc',
		'zapret2-manager/files/etc/init.d/zapret2-manager'
	]) assert.equal(existsSync(file), true, `missing packaged runtime file: ${file}`);
	for (const file of [
		'blockcheck-run.sh',
		'engine-operation-worker.sh',
		'health-run.sh',
		'log-rotate.sh',
		'orchestra-candidate-run.sh',
		'orchestra-probe-preflight.sh',
		'proxy-provider-go-init.sh'
	]) {
		assert.equal(existsSync(`zapret2-manager/files/usr/libexec/zapret2-manager/${file}`), true,
			`missing packaged shell entry point: ${file}`);
	}
	assert.match(manager, /\/etc\/init\.d\/rpcd reload/);
	assert.match(manager, /\/etc\/init\.d\/zapret2-manager enable/);
	assert.doesNotMatch(manager, /auto_rpc_run|auto-strategy-cli\.uc run/);
	assert.doesNotMatch(manager, /--allow-untrusted/);
});

test('persistent Auto Strategy state is runtime-owned and protected from package replacement', () => {
	assert.doesNotMatch(manager, /auto-strategy\.json/);
	assert.doesNotMatch(manager, /auto-strategy-last-good\.json/);
	assert.match(readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8'), /state_path_safe\(\).*last_good_path_safe/s);
	assert.doesNotMatch(manager, /rm -rf \/etc\/zapret2-manager/);
});

test('LuCI package stages ACL menu and every shared view', () => {
	assert.match(luci, /wildcard \.\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/\*\.js/);
	assert.match(luci, /wildcard \.\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/\*\.css/);
	assert.match(luci, /files\/usr\/share\/rpcd\/acl\.d/);
	assert.match(luci, /files\/usr\/share\/luci\/menu\.d/);
});

test('Auto Strategy registration and narrow read/write ACL are packaged together', () => {
	for (const name of ['orchestra_auto_status', 'orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.match(plugin, new RegExp(name));
	assert.ok(acl.read.ubus['zapret2-manager'].includes('orchestra_auto_status'));
	for (const name of ['orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.ok(acl.write.ubus['zapret2-manager'].includes(name));
});
