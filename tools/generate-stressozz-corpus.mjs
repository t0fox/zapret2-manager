#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SOURCE_REPO = 'StressOzz/Zapret-Manager';
export const SOURCE_COMMIT = 'b3269f852ed2d70b4c24918750c6b5b46b8b6a69';

function sourceFile(repo, path) {
	return execFileSync('git', ['show', `${SOURCE_COMMIT}:${path}`], { cwd: repo, encoding: 'utf8' });
}

function shellOptions(text, name) {
	const match = text.match(new RegExp(`^${name}=\\$'([\\s\\S]*?)'`, 'm'));
	if (!match) throw new Error(`missing ${name}`);
	return match[1].replaceAll('\\n', '\n').split('\n');
}

function optionValue(options, prefix) {
	return options.find((option) => option.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function record(id, feature, sourceName, originalOptions, filters, payloadReferences) {
	return { id, feature, sourceRepo: SOURCE_REPO, sourceCommit: SOURCE_COMMIT, sourceName,
		originalOptions, filters, payloadReferences, executionStatus: 'not-adapted' };
}

export function generateCorpus(repo = resolve(import.meta.dirname, '..')) {
	const script = sourceFile(repo, 'Zapret-Manager.sh');
	const strategy = sourceFile(repo, 'Strategies.md');
	const records = [];
	for (let i = 1; i <= 17; i++) {
		const options = shellOptions(script, `Dv${i}`);
		records.push(record(`stressozz-discord-media-dv${i}`, 'discord-media', `Dv${i}`, options, {
			tcpPorts: optionValue(options, '--filter-tcp='), domains: optionValue(options, '--hostlist-domains=')?.split(',') ?? []
		}, options.filter((option) => option.includes('pattern') || option.includes('--dpi-desync-fake-'))
			.map((option) => option.split('=', 2)[1])));
	}
	const voiceOptions = ['--filter-udp=19294-19344,50000-50100', '--filter-l7=discord,stun', '--dpi-desync=fake',
		'--dpi-desync-fake-discord=/opt/zapret/files/fake/stun.bin', '--dpi-desync-fake-stun=/opt/zapret/files/fake/stun.bin', '--dpi-desync-repeats=6'];
	records.push(record('stressozz-discord-voice', 'discord-voice', 'discord voice/STUN', voiceOptions, {
		udpPorts: optionValue(voiceOptions, '--filter-udp='), l7: optionValue(voiceOptions, '--filter-l7=')?.split(',') ?? []
	}, ['/opt/zapret/files/fake/stun.bin']));
	records.push(record('stressozz-discord-finland', 'discord-finland', 'Finnish Discord media scope',
		['104\\.25\\.158\\.178 finland[0-9]\\{5\\}\\.discord\\.media'], {
			hostnames: ['finland[0-9]{5}.discord.media'], ips: ['104.25.158.178']
	}, []));
	const udp = script.match(/PORTS_UDP="([^"]+)"/)?.[1];
	const tcp = script.match(/PORTS_TCP="([^"]+)"/)?.[1];
	if (!udp || !tcp) throw new Error('missing game port sets');
	const gameOptions = ['--filter-udp=' + udp, '--dpi-desync=fake', '--dpi-desync-cutoff=d2', '--dpi-desync-any-protocol=1',
		'--dpi-desync-fake-unknown-udp=/opt/zapret/files/fake/stun.bin', '--new', '--filter-tcp=' + tcp,
		'--dpi-desync-any-protocol=1', '--dpi-desync-cutoff=n5', '--dpi-desync=multisplit', '--dpi-desync-split-seqovl=582',
		'--dpi-desync-split-pos=1', '--dpi-desync-split-seqovl-pattern=/opt/zapret/files/fake/stun.bin'];
	records.push(record('stressozz-game-filter', 'game-filter', 'Gv1', gameOptions, {
		tcpPorts: tcp, udpPorts: udp, metadata: { enable: 'fix_GAME installs Gv1', disable: 'fix_GAME removes Gv1', strategyVariants: ['Gv1', 'Gv2', 'Gv3', 'Gv4'] }
	}, ['/opt/zapret/files/fake/stun.bin']));
	return { schemaVersion: 1, sourceRepo: SOURCE_REPO, sourceCommit: SOURCE_COMMIT, records };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const output = process.argv[2] ?? resolve(import.meta.dirname, '../zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
	writeFileSync(output, `${JSON.stringify(generateCorpus(), null, '\t')}\n`);
}
