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
function values(text, option) { let r = [], a = split(text, ' '); for (let i = 0; i < length(a); i++) if (substr(a[i], 0, length(option) + 1) == option + '=') push(r, substr(a[i], length(option) + 1)); return r; }
function port443(v) { let a = split(v, ','); for (let i = 0; i < length(a); i++) { let p = split(a[i], '-'); let lo = int(p[0]); let hi = length(p) > 1 ? int(p[1]) : lo; if (lo <= 443 && hi >= 443) return true; } return false; }
function covers(target, entry) { entry = lc(entry); target = lc(target); if (substr(entry, 0, 2) == '*.') entry = substr(entry, 2); return target == entry || substr(target, length(target) - length(entry) - 1) == '.' + entry; }
function hostfile_covers(path, target) { let t = readfile(path); if (!t) return false; for (let l in split(t, '\n')) { l = trim(split(l, '#')[0]); if (length(l) && covers(target, split(l, ' ')[0])) return true; } return false; }
function profile_for_tcp(text, target) { let ps = split(text, '--new'); for (let i = 0; i < length(ps); i++) { let tcp = values(ps[i], '--filter-tcp'), dom = values(ps[i], '--hostlist-domains'), files = values(ps[i], '--hostlist'), matchit = false; for (let y = 0; y < length(dom); y++) if (covers(target, dom[y])) matchit = true; for (let y = 0; y < length(files); y++) if (hostfile_covers(files[y], target)) matchit = true; for (let x = 0; x < length(tcp); x++) if (port443(tcp[x]) && matchit) return i; } return -1; }
function is_match_option(token) { let p = ['--filter-tcp=', '--filter-udp=', '--hostlist-domains=', '--hostlist=', '--ipset=', '--wf-udp-out=', '--filter-l7=', '--payload=', '--out-range=', '--in-range=']; for (let i = 0; i < length(p); i++) if (substr(token, 0, length(p[i])) == p[i]) return true; return false; }
function replace_strategy(profile, strategy) { let kept = []; for (let token in split(trim(profile), ' ')) if (is_match_option(token)) push(kept, token); return join(' ', kept) + ' ' + trim(strategy) + '\n'; }
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
	if (type(req.strategy) != 'string' || !length(trim(req.strategy))) return err('EINPUT', 'strategy is required');
	let source = stat(up) ? up : bp, before = readfile(source);
	if (before == null) return err('ETARGET', 'preset not found: ' + name);
	let target = lc(trim(req.target || 'discord.com')), line;
	if (protocol == 'stun_voice') line = '--wf-udp-out=443-65535 --filter-l7=stun,discord --payload=stun,discord_ip_discovery ' + trim(req.strategy);
	else if (protocol == 'udp_games') { let ips = type(req.ipsets) == 'array' ? req.ipsets : []; line = '--wf-udp-out=443,50000-65535 --filter-udp=443,50000-65535'; for (let i = 0; i < length(ips); i++) line += ' --ipset=' + ips[i]; line += ' ' + trim(req.strategy); }
	else line = '--filter-tcp=443 --hostlist-domains=' + target + ' --out-range=-d8 ' + trim(req.strategy);
	let index = protocol == 'tcp_https' ? profile_for_tcp(before, target) : -1, after, op;
	if (index < 0) { after = line + ' --new\n' + before; op = 'created'; }
	else { let ps = split(before, '--new'); ps[index] = replace_strategy(ps[index], req.strategy); after = join('--new', ps); op = 'updated'; }
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
