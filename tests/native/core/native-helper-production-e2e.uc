import * as native from '/usr/libexec/zapret2-manager/core/native-helper.uc';

function require(condition, message) {
	if (!condition) {
		warn(sprintf('production smoke: %s\n', message));
		exit(1);
	}
}

let child = ARGV[0];
require(match(child, /^task3-[A-Za-z0-9._-]+$/), 'invalid harness child literal');

let file = child + '/payload.bin';
let missing = child + '/definitely-missing';
let made = native.mkdir_private('runtime', child, true);
require(made.ok && made.data.committed == true &&
	made.data.durability == 'tmpfs_visible', 'mkdir_private failed');

let written = native.atomic_write('runtime', file, 'AAEC', true);
require(written.ok && written.data.byteLength == 3 &&
	written.data.committed == true && written.data.durability == 'tmpfs_visible',
	'atomic_write failed');

let stated = native.stat_regular('runtime', file);
require(stated.ok && stated.data.type == 'regular' && stated.data.mode == '0600' &&
	stated.data.size == 3, 'stat_regular failed');

let read = native.read_regular('runtime', file, 3);
require(read.ok && read.data.content == 'AAEC' && read.data.byteLength == 3,
	'read_regular failed');

let hashed = native.sha256_regular('runtime', file, 3);
require(hashed.ok && hashed.data.byteLength == 3 &&
	hashed.data.sha256 == 'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc',
	'sha256_regular failed');

let absent = native.stat_regular('runtime', missing);
require(!absent.ok && absent.error.code == 'EDEPENDENCY' &&
	!exists(absent.error, 'commitState'), 'missing object semantic mapping failed');

printf('%J\n', {
	ok: true,
	child,
	content: read.data.content,
	byteLength: read.data.byteLength,
	mode: stated.data.mode,
	sha256: hashed.data.sha256,
	missingCode: absent.error.code,
	missingHasCommitState: exists(absent.error, 'commitState')
});
