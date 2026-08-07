import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStrategy, parsePreset, serializePreset } from './lib/preset-apply.mjs';

const REAL_PRESET = `# Built-in sample; retain this comment\n--daemon-opt=keep-me\n\n--filter-tcp=440-450 --hostlist-domains=*.example.com --unknown=preserve --lua-desync=old --new\n--filter-udp=443 --ipset=/tmp/games --new\n`;

test('real preset round-trips comments, order, and unknown options byte-for-byte', () => {
	const doc = parsePreset(REAL_PRESET);
	assert.equal(serializePreset(doc), REAL_PRESET);
});

test('apply updates the matching TCP 443 wildcard-suffix profile and stays idempotent', () => {
	const first = applyStrategy({ text: REAL_PRESET, strategy: '--lua-desync=new', target: 'video.example.com', protocol: 'tcp_https' });
	assert.equal(first.operation, 'updated');
	assert.match(first.preview.changed[0], /--lua-desync=old/);
	assert.match(first.preview.changed[1], /--lua-desync=new/);
	const second = applyStrategy({ text: first.text, strategy: '--lua-desync=new', target: 'video.example.com', protocol: 'tcp_https' });
	assert.equal(second.operation, 'updated');
	assert.equal(parsePreset(second.text).profiles.length, 2, 'repeat apply must not create a second profile');
});

test('apply creates a first profile with the protocol template when no match exists', () => {
	const result = applyStrategy({ text: '# Empty\n', strategy: '--lua-desync=fake', target: 'discord.com', protocol: 'tcp_https' });
	assert.equal(result.operation, 'created');
	assert.match(result.text, /^# Empty\n--filter-tcp=443 --hostlist-domains=discord\.com --out-range=-d8 --lua-desync=fake/);
});

test('UDP templates retain scope-selected ipsets and voice selectors', () => {
	const voice = applyStrategy({ text: '', strategy: '--lua-desync=x', protocol: 'stun_voice' });
	assert.match(voice.text, /--wf-udp-out=443-65535 --filter-l7=stun,discord --payload=stun,discord_ip_discovery --lua-desync=x/);
	const games = applyStrategy({ text: '', strategy: '--lua-desync=x', protocol: 'udp_games', ipsets: ['/etc/zapret2-manager/ipset/games.txt'] });
	assert.match(games.text, /--wf-udp-out=443,50000-65535 --filter-udp=443,50000-65535 --ipset=\/etc\/zapret2-manager\/ipset\/games.txt --lua-desync=x/);
});
