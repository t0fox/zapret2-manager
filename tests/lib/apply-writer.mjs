// Node reference implementation of the apply.uc writer algorithm.
//
// This is the ALGORITHM SPEC for the shipped ucode apply.uc. ucode does not
// run in this build environment, so this node module is what the local
// self-test exercises; the ucode apply.uc implements the same logic and is
// run on the target router via tools/smoke.sh. Keep the two in lockstep.
//
// Operates on the config TEXT (a string), not on a file, so it is pure and
// testable. The ucode apply.uc wraps the same parse/replace with file I/O on
// /opt/zapret2/config.
//
// Shell-style config rules handled:
//   - simple  VAR=value            (e.g. NFQWS2_ENABLE=1)
//   - quoted  VAR="value"          (single-line, e.g. IPSET_OPT="...")
//   - multi   VAR="                (opening quote alone; closing " on a later
//                                    line alone — e.g. NFQWS2_OPT)
//   - commented  #VAR=value        (NOT matched; a write appends a new active
//                                    assignment rather than rewriting the
//                                    comment)
//   - value may contain "=" (split on the FIRST "=" after the var name only)

// Is a line a comment? Leading whitespace then #. (Shell config vars sit at
// column 0, so a # prefix means the line is not an active assignment.)
function isComment(line) {
	return /^\s*#/.test(line);
}

// Read the current value of `name`, or null if there is no active assignment.
// For multi-line quoted values, returns the text BETWEEN the opening and
// closing double quotes (newlines preserved), without the quotes themselves.
export function read_var(config, name) {
	const lines = config.split('\n');
	const prefix = name + '=';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.startsWith(prefix) || isComment(line)) continue;
		const rest = line.slice(prefix.length); // after "NAME="
		if (rest.startsWith('"')) {
			// single-line quoted?  "...." with the only inner " at the last pos
			const closeAt = rest.indexOf('"', 1);
			if (closeAt === rest.length - 1) {
				return rest.slice(1, closeAt); // content between the quotes
			}
			// multi-line quoted: collect until the line that carries the close.
			const buf = [];
			if (rest.length > 1) buf.push(rest.slice(1)); // content after opening "
			for (let j = i + 1; j < lines.length; j++) {
				const q = lines[j].indexOf('"');
				if (q >= 0) {
					if (q > 0) buf.push(lines[j].slice(0, q));
					return buf.join('\n');
				}
				buf.push(lines[j]);
			}
			return buf.join('\n'); // unterminated quote (should not happen)
		}
		return rest; // unquoted single-line value
	}
	return null;
}

// Set `name` to `value` in the config text. Surgical: only the named
// assignment changes; every other line is preserved. If `name` has no active
// assignment (only a commented one, or none), a new assignment is APPENDED.
// Multi-line quoted assignments are rewritten preserving the original
// opening/closing style (opening " alone → opening " alone).
export function write_var(config, name, value) {
	const lines = config.split('\n');
	const prefix = name + '=';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.startsWith(prefix) || isComment(line)) continue;
		const rest = line.slice(prefix.length);
		const closeAt = rest.startsWith('"') ? rest.indexOf('"', 1) : -1;
		const isMultiQuoted = rest.startsWith('"') && closeAt !== rest.length - 1;
		if (isMultiQuoted) {
			// find the line carrying the closing "
			let end = i;
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[j].indexOf('"') >= 0) { end = j; break; }
			}
			const before = lines.slice(0, i);
			const after = lines.slice(end + 1);
			// preserve the original opening style: " alone, or "content...
			const openAlone = (rest === '"');
			let block;
			if (openAlone) {
				block = [name + '="', value, '"'];
			} else {
				block = [name + '="' + value + '"'];
			}
			return [...before, ...block, ...after].join('\n');
		}
		// single-line (quoted or unquoted): replace the one line
		const before = lines.slice(0, i);
		const after = lines.slice(i + 1);
		return [...before, name + '=' + value, ...after].join('\n');
	}
	// not found (or only commented): append a new active assignment
	const sep = (config.length === 0 || config.endsWith('\n')) ? '' : '\n';
	return config + sep + name + '=' + value;
}
