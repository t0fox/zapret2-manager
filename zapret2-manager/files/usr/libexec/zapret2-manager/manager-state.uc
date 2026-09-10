'use strict';

// Shared manager state lifecycle for current DNS, Domain Hub/catalog, and
// backup products. Strategy state is stored by strategy-state.uc.

import { readfile, writefile, stat, unlink, popen } from 'fs';
import { PATHS } from './constants.uc';

const STATE_SCHEMA = 1;
const STATE = PATHS.draft_state;
const BAK1 = STATE + '.bak.1';
const BAK2 = STATE + '.bak.2';
const BAK3 = STATE + '.bak.3';
const MARKER = '/tmp/zapret2-manager/state.writing';

function empty_state() {
	return { schema: STATE_SCHEMA, updatedAt: null };
}

function copy_current_fields(source) {
	let state = empty_state();
	for (let key in ['dns', 'dns-global', 'catalog'])
		if (type(source[key]) == 'object' && source[key] != null) state[key] = source[key];
	return state;
}

function parse_state(text) {
	if (text == null || trim('' + text) == '') return { ok: true, state: empty_state() };
	let obj = null;
	try { obj = json(text); } catch (e) {
		return { ok: false, malformed: true, reason: 'state.json is not valid JSON', state: null };
	}
	if (type(obj) != 'object' || obj == null)
		return { ok: false, malformed: true, reason: 'state.json is not an object', state: null };
	if (obj.schema != null && obj.schema != STATE_SCHEMA)
		return { ok: false, malformed: true, reason: 'unsupported state schema (expected ' + STATE_SCHEMA + ')', state: null };
	let state = copy_current_fields(obj);
	if (type(obj.updatedAt) == 'int') state.updatedAt = obj.updatedAt;
	return { ok: true, state: state };
}

export const load_state = function() {
	return parse_state(readfile(STATE));
};

export const save_state = function(state) {
	if (type(state) != 'object' || state == null) return false;
	let clean = copy_current_fields(state);
	clean.updatedAt = time();
	if (stat(MARKER)) {
		let mt = trim(readfile(MARKER));
		let age = time() - (+mt);
		if (mt && age < 60) return false;
		try { unlink(MARKER); } catch (e) { }
	}
	try { writefile(MARKER, '' + time() + '\n'); } catch (e) { }
	if (stat(BAK2)) {
		let p = popen('mv -f ' + BAK2 + ' ' + BAK3 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}
	if (stat(BAK1)) {
		let p = popen('mv -f ' + BAK1 + ' ' + BAK2 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}
	if (stat(STATE)) {
		let p = popen('cp -p ' + STATE + ' ' + BAK1 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}
	let tmp = STATE + '.tmp.' + time();
	writefile(tmp, sprintf('%J', clean) + '\n');
	let p = popen('mv -f ' + tmp + ' ' + STATE + ' 2>/dev/null', 'r');
	if (p) p.close();
	try { unlink(MARKER); } catch (e) { }
	if (stat(tmp)) { try { unlink(tmp); } catch (e) { } return false; }
	return true;
};

export const restore_state_raw = function(content) {
	let parsed = parse_state(content);
	if (!parsed.ok) return { ok: false, reason: 'restore content is not valid manager state: ' + parsed.reason };
	if (!save_state(parsed.state)) return { ok: false, reason: 'failed to write manager state (lock active or disk error)' };
	return { ok: true };
};
