// packaging.test.mjs — backend package completeness gate.
//
// The backend Makefile (zapret2-manager/Makefile) installs each libexec file
// by an explicit INSTALL_DATA/INSTALL_BIN line — a file added to the tree
// without a matching install line silently never reaches the router (the
// exact defect class the LuCI wildcard rewrite fixed for views; gate 16
// covers views, this gate covers the backend package).
//
// The checker is a pure function over Makefile TEXT so the negative control
// can prove redness without touching the real Makefile.
//
// Run: node --test tests/packaging.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, '..', 'zapret2-manager');
const MAKEFILE = join(PKG_DIR, 'Makefile');
const LIBEXEC_DIR = join(PKG_DIR, 'files', 'usr', 'libexec', 'zapret2-manager');
const RPCD_DIR = join(PKG_DIR, 'files', 'usr', 'share', 'rpcd', 'ucode');

// checkBackendPackaging(makefileText, libexecFiles, rpcdFiles) → error strings
// ([] = pass). Every shipped file must appear in an install line naming its
// basename.
export function checkBackendPackaging(makefileText, libexecFiles, rpcdFiles) {
	const errs = [];
	for (const f of libexecFiles) {
		const re = new RegExp('INSTALL_(DATA|BIN).*/' + f.replace(/\./g, '\\.') + '\\b');
		if (!re.test(makefileText))
			errs.push(`backend Makefile does not install libexec file: ${f}`);
	}
	for (const f of rpcdFiles) {
		const re = new RegExp('INSTALL_(DATA|BIN).*/' + f.replace(/\./g, '\\.') + '\\b');
		if (!re.test(makefileText))
			errs.push(`backend Makefile does not install rpcd plugin: ${f}`);
	}
	// fixed single files that must always be installed
	for (const fixed of ['etc/zapret2-manager/state.json', 'etc/hotplug.d/iface/90-zapret2-manager', 'etc/init.d/zapret2-manager']) {
		if (!makefileText.includes(fixed.split('/').pop()))
			errs.push(`backend Makefile does not install: ${fixed}`);
	}
	return errs;
}

function listFiles(dir, filter) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => filter(f)).sort();
}

test('backend Makefile installs EVERY shipped libexec/rpcd file', () => {
	const mk = readFileSync(MAKEFILE, 'utf8');
	const libexec = listFiles(LIBEXEC_DIR, (f) => /\.(uc|json|sh)$/.test(f));
	const rpcd = listFiles(RPCD_DIR, (f) => f.endsWith('.uc'));
	assert.ok(libexec.length > 0, 'libexec dir must not be empty (discovery broken?)');
	assert.ok(rpcd.length > 0, 'rpcd plugin dir must not be empty (discovery broken?)');
	assert.ok(libexec.includes('profiles.uc') && libexec.includes('profiles-cli.uc'),
		'the profiles backend must be part of the tree');
	assert.deepEqual(checkBackendPackaging(mk, libexec, rpcd), []);
});

test('NEGATIVE CONTROL: dropping an install line reddens the packaging gate', () => {
	const mk = readFileSync(MAKEFILE, 'utf8');
	const libexec = listFiles(LIBEXEC_DIR, (f) => /\.(uc|json|sh)$/.test(f));
	const rpcd = listFiles(RPCD_DIR, (f) => f.endsWith('.uc'));
	// remove the profiles.uc install lines (both continuation lines) from a COPY
	const broken = mk.replace(/\$\(INSTALL_DATA\) \.\/files\/usr\/libexec\/zapret2-manager\/profiles\.uc \\\n\t\t\$\(1\)\/usr\/libexec\/zapret2-manager\/\n/, '');
	assert.ok(broken !== mk && !/profiles\.uc/.test(broken.replace(/profiles-cli/g, '')),
		'mutation must remove the profiles.uc install line');
	const errs = checkBackendPackaging(broken, libexec, rpcd);
	assert.ok(errs.some((e) => e.includes('profiles.uc')),
		'the gate MUST flag the missing profiles.uc install line');
});

// ---- ubus ACL coherence -------------------------------------------------------
//
// The ACL grants methods ONE BY ONE (read/write lists). A method registered
// in the rpcd plugin but absent from the ACL registers fine yet LuCI gets a
// permission denial that renders as an empty section with no error — a silent
// ship-breaker (profiles_list almost shipped this way). This gate extracts
// the method names from the plugin's signature and requires each in the ACL.

const PLUGIN = join(PKG_DIR, 'files', 'usr', 'share', 'rpcd', 'ucode', 'zapret2-manager.uc');
const ACL = join(HERE, '..', 'luci-app-zapret2-manager', 'files', 'usr', 'share', 'rpcd', 'acl.d', 'luci-app-zapret2-manager.json');

export function pluginMethods(pluginText) {
	// methods are the `name: { call:` entries inside the returned signature
	const out = [];
	const re = /(\w+):\s*\{\s*(?:args:\s*\{[^}]*\},\s*)?call:\s*function/g;
	let m;
	while ((m = re.exec(pluginText)) !== null) out.push(m[1]);
	return out.sort();
}

export function aclGrantedMethods(aclJson) {
	const out = [];
	for (const groupName of Object.keys(aclJson)) {
		const group = aclJson[groupName];
		for (const rw of ['read', 'write']) {
			const ubus = group && group[rw] && group[rw].ubus;
			if (!ubus) continue;
			for (const obj of Object.keys(ubus)) {
				for (const meth of ubus[obj]) out.push(meth);
			}
		}
	}
	return [...new Set(out)].sort();
}

export function checkAclCoherence(pluginText, aclJson) {
	const granted = aclGrantedMethods(aclJson);
	const errs = [];
	for (const meth of pluginMethods(pluginText)) {
		if (!granted.includes(meth))
			errs.push(`method '${meth}' is registered in the rpcd plugin but NOT granted in the ACL — LuCI would be permission-denied (empty page, no error)`);
	}
	return errs;
}

test('ACL grants EVERY method the rpcd plugin registers', () => {
	const plugin = readFileSync(PLUGIN, 'utf8');
	const acl = JSON.parse(readFileSync(ACL, 'utf8'));
	const methods = pluginMethods(plugin);
	assert.ok(methods.includes('profiles_list'), 'profiles_list must be registered in the plugin');
	assert.ok(methods.includes('status'), 'plugin method discovery must find status');
	assert.deepEqual(checkAclCoherence(plugin, acl), []);
});

test('NEGATIVE CONTROL: an ungranted plugin method reddens the ACL coherence gate', () => {
	const plugin = readFileSync(PLUGIN, 'utf8');
	const acl = JSON.parse(readFileSync(ACL, 'utf8'));
	// strip profiles_list from the ACL copy
	acl['zapret2-manager'].read.ubus['zapret2-manager'] =
		acl['zapret2-manager'].read.ubus['zapret2-manager'].filter((m) => m !== 'profiles_list');
	const errs = checkAclCoherence(plugin, acl);
	assert.ok(errs.some((e) => e.includes('profiles_list')),
		'the gate MUST flag an ungranted profiles_list');
});
