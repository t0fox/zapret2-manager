'use strict';

// Single NDJSON writer for manager event journals. The lock is bounded so a
// stale or contended writer fails explicitly instead of blocking rpcd forever.
import { popen } from 'fs';

const MAX_EVENT_LINE = 65536;

function shell_quote(value) {
	let out = "'";
	let text = '' + (value != null ? value : '');
	for (let i = 0; i < length(text); i++) {
		let c = substr(text, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}

export const event_id = function(source) {
	let p = popen('cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d - | cut -c1-12', 'r');
	let token = '';
	if (p) { token = trim(p.read('all') || ''); p.close(); }
	if (!length(token)) token = '' + time();
	return source + '-' + time() + '-' + token;
};

export const append_ndjson = function(path, value) {
	let line = sprintf('%J', value);
	if (path == null || length(line) == 0 || length(line) > MAX_EVENT_LINE) return false;
	let lock = path + '.lock';
	let cmd = 'umask 077; exec 9>' + shell_quote(lock) +
		'; flock -w 2 -x 9 || exit 75; printf \'%s\\n\' ' + shell_quote(line) +
		' >> ' + shell_quote(path);
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return false;
	p.read('all');
	return p.close() == 0;
};
