// Node reference: count profiles by the profile SEPARATOR in an NFQWS2_OPT value.
//
// The real options string splits profiles with the `--new` separator (not the
// ':strategy=N' marker the pre-reset sample used — the real default config
// has no :strategy= at all). count_profiles returns the number of profiles =
// the number of `--new` separators + 1 (the first profile has no --new before it).
// A profile with a separator but no --comment= name still counts as a profile
// (profiles are counted, not names). If the value is null or has NO --new, it is
// ONE profile (null only when the value itself is null/absent). Mirrored by the
// ucode profile_count in status.uc.

const SEPARATOR = '--new';

export function count_profiles(value) {
	if (value == null) return null;
	let n = 0;
	let i = 0;
	while (true) {
		let p = value.indexOf(SEPARATOR, i);
		if (p < 0) break;
		n++;
		i = p + SEPARATOR.length;
	}
	// profiles = separators + 1 (the first profile has no --new before it).
	// null only when the value is null; a real string with no --new is 1 profile.
	return n + 1;
}
