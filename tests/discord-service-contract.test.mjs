import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/services/discord.json';
const runSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc';
const uiSourcePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';
const runnerSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';

test('Discord manifest is declarative and contains exactly the three TCP targets', () => {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	assert.deepEqual(manifest.requiredTargetIds, ['web', 'gateway', 'cdn']);
	assert.deepEqual(manifest.targets, [
		{ id: 'web', domain: 'discord.com', protocol: 'tcp_https', probe: 'https' },
		{ id: 'gateway', domain: 'gateway.discord.gg', protocol: 'tcp_https', probe: 'websocket' },
		{ id: 'cdn', domain: 'cdn.discordapp.com', protocol: 'tcp_https', probe: 'bounded_download' }
	]);
	assert.deepEqual(manifest.dnsChecks, ['discord.com', 'gateway.discord.gg', 'cdn.discordapp.com', 'discordapp.net', 'discord.media']);
	const serialized = readFileSync(manifestPath, 'utf8');
	for (const forbidden of ['candidateId', 'strategy', 'winner', 'score', 'profile']) assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
});

test('Discord run and UI use only the service contract, never client candidates or domains', () => {
	const runSource = readFileSync(runSourcePath, 'utf8');
	const uiSource = readFileSync(uiSourcePath, 'utf8');
	assert.match(runSource, /SERVICES\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/services/);
	assert.match(runSource, /manifestDigest/);
	assert.match(runSource, /candidateRegistryDigest/);
	assert.match(runSource, /targetResults/);
	assert.match(runSource, /serviceVerdict.*ready/);
	assert.doesNotMatch(runSource, /if\s*\(.*targetId.*discord/);
	assert.match(uiSource, /targetType:\s*'service'/);
	assert.match(uiSource, /targetId:\s*discord\.id/);
	assert.match(runSource, /targetType=='service'.*zapret2gui-only/);
	const serviceSection = uiSource.slice(uiSource.indexOf('_servicesSection:'), uiSource.indexOf('_findSection:'));
	assert.doesNotMatch(serviceSection, /candidateIds\s*:/);
});

test('probe verdicts require typed evidence for websocket and bounded downloads', () => {
	const runSource = readFileSync(runnerSourcePath, 'utf8');
	assert.match(runSource, /probe.*websocket/);
	assert.match(runSource, /Upgrade.*websocket|websocket.*Upgrade/);
	assert.match(runSource, /bounded_download/);
	assert.match(runSource, /probe_bytes|bodyBytes/);
});
