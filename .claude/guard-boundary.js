// guard-boundary.js — PreToolUse hook for zapret2-manager.
// Mechanical enforcement of the project's hard rule: upstream zapret2 files are
// never edited, and the edit boundary is this repository's catalog. Upstream
// files live on the router (not in this repo), so they are unreachable; this
// hook additionally blocks any Edit/Write/NotebookEdit whose target path falls
// outside G:/zapret2-manager/, so a stray edit outside the repo is rejected
// before it lands.
//
// Hook contract: read one JSON object on stdin ({tool_name, tool_input}),
// exit 0 to allow, exit 2 to block (stderr shown to Claude). Any parse failure
// is allow (never accidentally block legitimate work).
'use strict';
// Repo roots whose edits are allowed. The main checkout (G:/zapret2-manager/) AND
// its git worktrees (G:/z2m-wt/<branch>/) share one .git, so a worktree IS the
// same repository — edits there are in-repo, not outside. The hard guarantee
// (upstream zapret2 files are never in this repo, so they are unreachable)
// holds regardless of which checkout the edit lands in.
const REPO_ROOTS = ['G:/zapret2-manager/', 'G:/z2m-wt/'];
let data = '';
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
	try {
		const j = JSON.parse(data);
		const ti = j.tool_input || {};
		let p = ti.file_path || ti.notebook_path || ti.path;
		if (!p) process.exit(0);
		p = String(p).replace(/\\/g, '/');
		const low = p.toLowerCase();
		for (const root of REPO_ROOTS) {
			if (low.indexOf(root.toLowerCase()) === 0) process.exit(0);
		}
		process.stderr.write('GUARD: edit outside repo boundary blocked: ' + p + '\n');
		process.exit(2);
	} catch (e) {
		process.exit(0);
	}
});
