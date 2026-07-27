// tokenize.test.mjs — safe shell tokenizer unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, extractShellAssignment } from './lib/tokenize.mjs';

test('splits on whitespace including newlines (logical continuation)', () => {
	const { tokens, diagnostics } = tokenize('--filter-tcp=443\n--payload=all');
	assert.equal(diagnostics.length, 0);
	assert.equal(tokens.length, 2);
	assert.deepEqual(tokens.map((t) => t.value), ['--filter-tcp=443', '--payload=all']);
});

test('single quotes are literal', () => {
	const { tokens } = tokenize("--name='My Cool Profile'");
	assert.equal(tokens[0].value, "--name=My Cool Profile");
	assert.equal(tokens[0].quoteStyle, 'single');
});

test('double quotes with escapes', () => {
	const { tokens } = tokenize('--name="A \\"quoted\\" name"');
	assert.equal(tokens[0].value, '--name=A "quoted" name');
	assert.equal(tokens[0].quoteStyle, 'double');
});

test('backslash outside quotes follows DOUBLE-QUOTE rules (literal except $ ` " \\ and newline)', () => {
	// `\:` stays two characters — this is what the native parse_lua_call expects
	const { tokens } = tokenize('--lua-desync=luaexec:code=x\\:y=1');
	assert.equal(tokens[0].value, '--lua-desync=luaexec:code=x\\:y=1');
	// `\\` collapses to one backslash
	const t2 = tokenize('--name=a\\\\b');
	assert.equal(t2.tokens[0].value, '--name=a\\b');
	// quoted form for real spaces
	const t3 = tokenize('--name="one two"');
	assert.equal(t3.tokens[0].value, '--name=one two');
});

test('empty quoted value stays empty (distinct from missing)', () => {
	const { tokens } = tokenize("--name=''");
	assert.equal(tokens[0].value, '--name=');
	assert.equal(tokens[0].quoteStyle, 'single');
});

test('= inside value is kept', () => {
	const { tokens } = tokenize('--lua-desync=fake:tls_mod=rnd,dupsid,sni=www.google.com');
	assert.equal(tokens[0].value, '--lua-desync=fake:tls_mod=rnd,dupsid,sni=www.google.com');
});

test('<HOSTLIST> and <HOSTLIST_NOAUTO> placeholders pass through', () => {
	const { tokens } = tokenize('--hostlist=<HOSTLIST> --ipset=<HOSTLIST_NOAUTO>');
	assert.equal(tokens[0].value, '--hostlist=<HOSTLIST>');
	assert.equal(tokens[1].value, '--ipset=<HOSTLIST_NOAUTO>');
});

test('0xHEX, @/path, colons, commas, ranges with < pass through', () => {
	const { tokens, diagnostics } = tokenize('--blob=blob_zero:0x00000000 --lua-init=@/opt/zapret2/zapret-auto.lua --out-range=<n3 --filter-tcp=80,443');
	assert.equal(diagnostics.length, 0);
	assert.equal(tokens[0].value, '--blob=blob_zero:0x00000000');
	assert.equal(tokens[1].value, '--lua-init=@/opt/zapret2/zapret-auto.lua');
	assert.equal(tokens[2].value, '--out-range=<n3');
	assert.equal(tokens[3].value, '--filter-tcp=80,443');
});

test('UTF-8 in --name survives byte-exact', () => {
	const { tokens } = tokenize('--name=Игры-основные');
	assert.equal(tokens[0].value, '--name=Игры-основные');
	assert.equal(tokens[0].raw, '--name=Игры-основные');
});

test('source offsets map back to the original text', () => {
	const text = '  --filter-tcp=443\n  --payload=all  ';
	const { tokens } = tokenize(text);
	assert.equal(text.slice(tokens[0].start, tokens[0].end), '--filter-tcp=443');
	assert.equal(text.slice(tokens[1].start, tokens[1].end), '--payload=all');
	assert.equal(tokens[0].raw, '--filter-tcp=443');
});

test('unterminated single quote → MANAGER_UNTERMINATED_QUOTE with offset', () => {
	const { diagnostics } = tokenize("--name='abc");
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].code, 'MANAGER_UNTERMINATED_QUOTE');
	assert.equal(diagnostics[0].severity, 'error');
	assert.equal(diagnostics[0].span.start, 7);
});

test('unterminated double quote → MANAGER_UNTERMINATED_QUOTE', () => {
	const { diagnostics } = tokenize('--name="abc');
	assert.equal(diagnostics[0].code, 'MANAGER_UNTERMINATED_QUOTE');
});

test('dangling escape → MANAGER_DANGLING_ESCAPE', () => {
	const { diagnostics } = tokenize('--filter-tcp=443\\');
	assert.equal(diagnostics[0].code, 'MANAGER_DANGLING_ESCAPE');
});

test('NUL and control characters → MANAGER_CONTROL_CHARACTER (removed, never merge words)', () => {
	const { tokens, diagnostics } = tokenize('--a=1\x00 --b=2\x01');
	assert.equal(diagnostics.length, 2);
	assert.ok(diagnostics.every((d) => d.code === 'MANAGER_CONTROL_CHARACTER'));
	assert.deepEqual(tokens.map((t) => t.value), ['--a=1', '--b=2']);
});

test('empty option name after -- → MANAGER_EMPTY_OPTION', () => {
	const { diagnostics } = tokenize('--=x');
	assert.equal(diagnostics[0].code, 'MANAGER_EMPTY_OPTION');
	const d2 = tokenize('--').diagnostics;
	assert.equal(d2[0].code, 'MANAGER_EMPTY_OPTION');
});

test('mixed quote styles recorded', () => {
	const { tokens } = tokenize(`--name='a'"b"`);
	assert.equal(tokens[0].quoteStyle, 'mixed');
});

test('SAFETY: dangerous input is inert text, never executed', () => {
	const dangerous = '--name=$(reboot) --x=`id` ; rm -rf / --y=|sh';
	const { tokens, diagnostics } = tokenize(dangerous);
	assert.equal(diagnostics.length, 0);
	// `;` and `rm` are plain tokens; nothing was interpreted
	assert.ok(tokens.some((t) => t.value === ';'));
	assert.ok(tokens.some((t) => t.value === 'rm'));
	assert.equal(tokens[0].value, '--name=$(reboot)');
});

test('extractShellAssignment reads a multi-line double-quoted NFQWS2_OPT', () => {
	const config = 'NFQWS2_ENABLE=1\nNFQWS2_OPT="\n--filter-tcp=443\n--new=Games\n--filter-udp=443\n"\nMODE_FILTER=none\n';
	const r = extractShellAssignment(config, 'NFQWS2_OPT');
	assert.ok(r);
	assert.equal(r.quoteStyle, 'double');
	assert.ok(r.value.includes('--new=Games'));
	assert.ok(r.value.includes('--filter-tcp=443'));
});
