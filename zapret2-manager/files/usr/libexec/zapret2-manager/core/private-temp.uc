'use strict';
import { popen, unlink } from 'fs';
const PREFIX = '/tmp/z2m-private.';
export const private_tempfile = function() {
	let p = popen('umask 077; mktemp /tmp/z2m-private.XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let file = trim(p.read('all') || ''), rc = p.close();
	if (rc != 0 || !length(file) || index(file, PREFIX) != 0 || length(file) > 64) {
		if (length(file) && index(file, PREFIX) == 0) try { unlink(file); } catch (e) { }
		return null;
	}
	return file;
};
