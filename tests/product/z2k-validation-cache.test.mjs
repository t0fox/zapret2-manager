import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CLI = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'strategy-cli.uc');

test('Strategy Validate may reuse only an exact Preview candidate snapshot', () => {
	const source = readFileSync(CLI, 'utf8');

	assert.match(source, /strategy_preview_cache/,
		'preview cache must be explicit and bounded');
	assert.match(source, /STRATEGY_PREVIEW_CACHE_PATH\s*=\s*['"]\/tmp\//,
		'preview cache must remain volatile and outside the persistent state');
	assert.match(source, /writefile\(temporary[\s\S]*STRATEGY_PREVIEW_CACHE_PATH/,
		'preview cache publication must be atomic and bounded');
	assert.match(source, /snapshotId[\s\S]*compositionSnapshotId[\s\S]*membershipDigest/,
		'cache identity must bind to the canonical runtime composition');
	assert.match(source, /requireValidation != true[\s\S]*strategy_preview_cache/,
		'only a non-validating Preview may populate the cache');
	assert.match(source, /native_preflight\(candidate\.strategyArgs/,
		'Validate must still run the native preflight on the cached candidate');
	assert.match(source, /let candidate = strategy_preview_cache_get\(previewCacheKey\)/,
		'Preview must reuse an exact volatile candidate when a prior bounded compile populated it');
	assert.match(source, /strategy_apply_candidate\(resolved, trusted\.environment, input, currentCatalog\)/,
		'Apply must be able to reuse the exact candidate already inspected by Preview');
	assert.match(source, /function strategy_apply_candidate\(resolved, environment, input, currentCatalog\)/,
		'Apply cache lookup must stay inside the shared Strategy adapter');
});

test('Z2K compiler does not re-parse fragments after its post-transform validation', () => {
	const compiler = readFileSync(path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
		'zapret2-manager', 'strategy-compiler.uc'), 'utf8');
	const apply = readFileSync(path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
		'zapret2-manager', 'profiles-apply.uc'), 'utf8');

	assert.match(compiler, /validate_fragment\(fragments\[i\], enabled\[i\]\.id, false\)/,
		'compiler must retain its post-transform structural validation');
	assert.match(compiler, /profiles_render_candidate\(drafts, true\)/,
		'compiler must use the validated renderer after that proof');
	assert.match(apply, /profiles_render_candidate = function\(profiles, alreadyValidated\)/,
		'renderer must expose an explicit internal validated path');
	assert.match(apply, /alreadyValidated !== true/,
		'renderer validation bypass must require an explicit trusted flag');
});
