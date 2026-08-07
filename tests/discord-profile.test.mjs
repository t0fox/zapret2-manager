import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordCandidate, buildDiscordChangeHash } from '../tools/discord-profile.mjs';

const records = [
  { id: 'stressozz-discord-media-dv1', executionStatus: 'native-adapted', compiledDigest: 'media-digest', compiledOptions: { profileName: 'StressOzz_Discord_Media_Dv1', fragment: '--filter-tcp=2053,2083,2087,2096,8443 --filter-l7=tls --hostlist-domains=discord.media --lua-desync=multisplit:pos=2:seqovl=652:seqovl_pattern=blob_stressozz_tls_clienthello_www_google_com' } },
  { id: 'stressozz-discord-voice', executionStatus: 'native-adapted', compiledDigest: 'voice-digest', compiledOptions: { profileName: 'StressOzz_Discord_Voice', fragment: '--filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --lua-desync=fake:blob=blob_stressozz_stun:repeats=6' } }
];

test('builds exactly two named Discord sections and preserves unrelated profiles', () => {
  const current = '--new=YouTube --filter-tcp=443 --hostlist-domains=youtube.com --new=Other --filter-udp=50000';
  const result = buildDiscordCandidate(current, records);
  assert.equal(result.candidate, '--new=YouTube --filter-tcp=443 --hostlist-domains=youtube.com --new=Other --filter-udp=50000 --new=StressOzz_Discord_Media_Dv1 --filter-tcp=2053,2083,2087,2096,8443 --filter-l7=tls --hostlist-domains=discord.media --lua-desync=multisplit:pos=2:seqovl=652:seqovl_pattern=blob_stressozz_tls_clienthello_www_google_com --new=StressOzz_Discord_Voice --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --lua-desync=fake:blob=blob_stressozz_stun:repeats=6');
  assert.equal((result.candidate.match(/--new=StressOzz_Discord/g) || []).length, 2);
  assert.equal(result.candidate.includes('1024-65535'), false);
  assert.equal(result.candidate.includes('game-filter'), false);
});

test('change hash is deterministic and includes both compiled digests', () => {
  const input = { candidateSha256: 'candidate', compiledDigests: ['media-digest', 'voice-digest'] };
  assert.deepEqual(buildDiscordChangeHash(input), buildDiscordChangeHash(input));
  assert.notEqual(buildDiscordChangeHash(input), buildDiscordChangeHash({ ...input, compiledDigests: ['media-digest', 'changed'] }));
});
