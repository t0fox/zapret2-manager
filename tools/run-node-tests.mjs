#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
const ROOT='tests',VALID_GROUPS=new Set(['all','frontend','backend']),group=process.argv[2]||'all';
if(!VALID_GROUPS.has(group)){console.error(`Unknown test group: ${group}`);console.error('Usage: node tools/run-node-tests.mjs [all|frontend|backend]');process.exit(2);}
async function discover(directory){const entries=await readdir(directory,{withFileTypes:true}),files=[];for(const entry of entries){const entryPath=path.join(directory,entry.name);if(entry.isDirectory())files.push(...await discover(entryPath));else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))files.push(entryPath.split(path.sep).join('/'));}return files;}
function regularFrontend(file){if(file.startsWith('tests/ui/'))return true;const name=path.posix.basename(file);return /^(?:luci-|t4-|orchestra-strategy-ui)/.test(name)||/(?:^|-)ui\.test\.mjs$/.test(name);}
function isFrontendTest(file){return regularFrontend(file)||(!regularFrontend(file)&&file>='tests/proxy'&&file<'tests/release');}
function belongsToGroup(file){if(group==='all')return true;return group==='frontend'?isFrontendTest(file):!isFrontendTest(file);}
let discovered;try{discovered=(await discover(ROOT)).sort();}catch(error){console.error(`Unable to discover tests under ${ROOT}:`,error);process.exit(2);}
const selected=discovered.filter(belongsToGroup);if(!selected.length){console.error(`Refusing to pass: no ${group} tests were discovered.`);process.exit(2);}
console.log(`Discovered ${discovered.length} repository tests; running ${selected.length} ${group} tests.`);
const failures=[];for(const file of selected){console.log(`\n=== ${file} ===`);const result=spawnSync(process.execPath,[file],{cwd:process.cwd(),env:{...process.env,CI:'1'},stdio:'inherit'});if(result.error){console.error(result.error);failures.push({file,status:'spawn_error'});}else if(result.status!==0)failures.push({file,status:result.status??'signal'});}
if(failures.length){console.error(`\n${failures.length} test file(s) failed:`);for(const failure of failures)console.error(`- ${failure.file} (${failure.status})`);process.exit(1);}
console.log(`\nPASS: ${selected.length} ${group} test file(s).`);
