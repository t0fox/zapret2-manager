#!/usr/bin/ucode
'use strict';
// Applies one scanner recommendation into an editable user preset. No daemon
// control is performed here; the next normal preset activation owns runtime.
import { readfile, writefile, stat, popen } from 'fs';

const BUILTIN = '/usr/share/zapret2-manager/presets';
const USER = '/etc/zapret2-manager/presets';
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }
function run(cmd) { let p = popen(cmd + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all'); let rc = p.close(); return { rc: rc, out: out || '' }; }
function q(s) { return "'" + s + "'"; }
function values(text, option) { let r = []; for (let line in split(text, '\n')) for (let token in split(trim(line), ' ')) if (substr(token, 0, length(option) + 1) == option + '=') push(r, substr(token, length(option) + 1)); return r; }
function port443(v) { let a = split(v, ','); for (let i = 0; i < length(a); i++) { let p = split(a[i], '-'); let lo = int(p[0]); let hi = length(p) > 1 ? int(p[1]) : lo; if (lo <= 443 && hi >= 443) return true; } return false; }
function covers(target, entry) { entry = lc(trim(entry)); target = lc(trim(target)); while (substr(entry, 0, 1) == '.') entry = substr(entry, 1); while (substr(target, 0, 1) == '.') target = substr(target, 1); if (substr(entry, 0, 2) == '*.') entry = substr(entry, 2); return length(target) && length(entry) && (target == entry || (length(target) > length(entry) && substr(target, length(target) - length(entry) - 1) == '.' + entry)); }
function hostfile_covers(path, target) { let t = readfile(path); if (!t) return false; for (let l in split(t, '\n')) { l = trim(split(l, '#')[0]); if (length(l) && covers(target, split(l, ' ')[0])) return true; } return false; }
function profile_start(line) { return match(line, /(^|[ \t])--(filter-tcp|filter-udp|wf-udp-out|hostlist|hostlist-domains|ipset|out-range|filter-l7|payload)=/); }
function signature(raw) { return sprintf('%J', { tcp: values(raw, '--filter-tcp'), udp: values(raw, '--filter-udp'), domains: values(raw, '--hostlist-domains'), hostlist: values(raw, '--hostlist'), ipset: values(raw, '--ipset') }); }
function parse_preset(text) { let preamble = '', body = '', found = false, lines = split(text, '\n'), trailing = length(text) && substr(text, length(text) - 1, 1) == '\n'; for (let i = 0; i < length(lines); i++) { let piece = lines[i] + (i < length(lines) - 1 || (trailing && i == length(lines) - 1) ? '\n' : ''); if (!found && profile_start(lines[i])) found = true; if (found) body += piece; else preamble += piece; } let profiles = [], parts = split(body, '--new'); for (let i = 0; i < length(parts); i++) { let raw = parts[i] + (i < length(parts) - 1 ? '--new' : ''); if (length(trim(raw))) push(profiles, { raw: raw, index: length(profiles), enabled: !match(raw, /(^|[ \t])--skip([ \t]|$)/), matchSignature: signature(raw) }); } return { preamble: preamble, profiles: profiles, ending: trailing ? '\n' : '' }; }
function serialize_preset(doc) { let out = doc.preamble; for (let profile in doc.profiles) out += profile.raw; return out + doc.ending; }
function profile_for_tcp(doc, target) { for (let i = 0; i < length(doc.profiles); i++) { let profile = doc.profiles[i], tcp = values(profile.raw, '--filter-tcp'), dom = values(profile.raw, '--hostlist-domains'), files = values(profile.raw, '--hostlist'), matchit = false; for (let y = 0; y < length(dom); y++) for (let d in split(dom[y], ',')) if (covers(target, d)) matchit = true; for (let y = 0; y < length(files); y++) for (let file in split(files[y], ',')) if (hostfile_covers(file, target)) matchit = true; for (let x = 0; x < length(tcp); x++) if (port443(tcp[x]) && matchit) return i; } return -1; }
function is_match_option(token) { let p = ['--filter-tcp=', '--filter-udp=', '--hostlist-domains=', '--hostlist=', '--ipset=']; for (let i = 0; i < length(p); i++) if (substr(token, 0, length(p[i])) == p[i]) return true; return false; }
function old_strategy_option(token) { let p = ['--lua-desync=', '--dpi-desync=', '--payload=', '--tamper=', '--fooling=', '--split-pos=', '--out-range=', '--in-range=', '--wf-udp-out=', '--filter-l7=']; for (let i = 0; i < length(p); i++) if (substr(token, 0, length(p[i])) == p[i]) return true; return false; }
function replace_strategy(raw, replacement) { let lines = split(raw, '\n'), done = false, out = []; for (let line in lines) { if (!done && profile_start(line)) { let kept = [], strategy = [], had_new = match(line, /(^|[ \t])--new([ \t]|$)/); for (let token in split(trim(line), ' ')) if (token != '--new' && !old_strategy_option(token)) push(kept, token); for (let token in split(trim(replacement), ' ')) if (!is_match_option(token)) push(strategy, token); line = join(' ', kept) + ' ' + join(' ', strategy) + (had_new ? ' --new' : ''); done = true; } push(out, line); } return join('\n', out); }
function main(req) {
	if (type(req) != 'object') return err('EINPUT', 'request is required');
	let protocol = req.protocol || 'tcp_https'; let name = type(req.fileName) == 'string' ? req.fileName : protocol + '.txt';
	if (!match(name, /^[A-Za-z0-9._-]+\.txt$/)) return err('EINPUT', 'invalid preset file name');
	let up = USER + '/' + name, bp = BUILTIN + '/' + name;
	if (req.mode == 'rollback') {
		let snapshot = up + '.rollback', beforeRollback = readfile(up), original = readfile(snapshot);
		if (original == null) return err('ESTATE', 'no preset rollback snapshot for ' + name);
		let tmpRollback = up + '.tmp.rollback.' + time(); writefile(tmpRollback, original);
		if (run('mv -f ' + q(tmpRollback) + ' ' + q(up)).rc != 0) return err('EWRITE', 'rollback rename failed');
		return { ok: true, mode: 'rollback', fileName: name, before: beforeRollback, after: original };
	}
	let source = stat(up) ? up : bp, before = readfile(source);
	if (before == null) return err('ETARGET', 'preset not found: ' + name);
	let doc = parse_preset(before);
	if (req.mode == 'roundtrip') { let afterRoundtrip = serialize_preset(doc); return { ok: true, mode: 'roundtrip', fileName: name, identical: before == afterRoundtrip, before: before, after: afterRoundtrip }; }
	if (type(req.strategy) != 'string' || !length(trim(req.strategy))) return err('EINPUT', 'strategy is required');
	let target = lc(trim(req.target || 'discord.com')), line;
	if (protocol == 'stun_voice') line = '--wf-udp-out=443-65535 --filter-l7=stun,discord --payload=stun,discord_ip_discovery ' + trim(req.strategy);
	else if (protocol == 'udp_games') { let ips = type(req.ipsets) == 'array' ? req.ipsets : []; line = '--wf-udp-out=443,50000-65535 --filter-udp=443,50000-65535'; for (let i = 0; i < length(ips); i++) line += ' --ipset=' + ips[i]; line += ' ' + trim(req.strategy); }
	else line = '--filter-tcp=443 --hostlist-domains=' + target + ' --out-range=-d8 ' + trim(req.strategy);
	let candidate = parse_preset(line + ' --new\n'), candidateSignature = length(candidate.profiles) ? candidate.profiles[0].matchSignature : '', index = -1, after, op;
	for (let i = 0; i < length(doc.profiles); i++) if (doc.profiles[i].matchSignature == candidateSignature) { index = i; break; }
	if (index < 0 && protocol == 'tcp_https') index = profile_for_tcp(doc, target);
	if (index < 0) { candidate.profiles[0].raw = line + ' --new\n'; candidate.profiles[0].index = 0; unshift(doc.profiles, candidate.profiles[0]); after = serialize_preset(doc); op = 'created'; }
	else { doc.profiles[index].raw = replace_strategy(doc.profiles[index].raw, line); doc.profiles[index].enabled = true; after = serialize_preset(doc); op = 'updated'; }
	let preview = { added: op == 'created' ? [line] : [], changed: op == 'updated' ? [line] : [] };
	if (req.mode == 'preview') return { ok: true, mode: 'preview', strategyName: req.strategy, appliedProfile: protocol == 'tcp_https' ? target : protocol, fileName: name, operation: op, preview: preview, before: before, after: after };
	if (run('mkdir -p ' + q(USER)).rc != 0) return err('EWRITE', 'cannot create user preset directory');
	let snapshot = up + '.rollback', tmp = up + '.tmp.' + time();
	writefile(snapshot, before);
	if (readfile(snapshot) != before) return err('EWRITE', 'snapshot failed');
	writefile(tmp, after);
	if (run('mv -f ' + q(tmp) + ' ' + q(up)).rc != 0) { if (stat(snapshot)) run('mv -f ' + q(snapshot) + ' ' + q(up)); return err('EWRITE', 'atomic rename failed; snapshot restored'); }
	return { ok: true, strategyName: req.strategy, appliedProfile: protocol == 'tcp_https' ? target : protocol, fileName: name, operation: op, preview: preview, before: before, after: after };
}
let raw = ARGV[0] ? readfile(ARGV[0]) : null, req = null; try { req = json(raw); } catch (e) {} print(sprintf('%J', main(req)) + '\n');
