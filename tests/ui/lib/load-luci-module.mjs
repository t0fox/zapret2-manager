import { readFile } from 'node:fs/promises';
export async function loadLuciModule(path, extra={}) {
  let source=await readFile(path,'utf8');
  source=source.replace(/^\s*'require [^']+';\s*$/gm,'');
  const globals=Object.assign({
    baseclass:{extend:value=>value},
    view:{extend:value=>value},rpc:{declare:()=>()=>Promise.resolve({})},uci:{},fs:{},poll:{add:()=>{}},ui:{},form:{},
    _:value=>value,E:()=>({}),window:{},document:{}
  },extra);
  const names=Object.keys(globals),values=names.map(name=>globals[name]);
  return Function(...names,source)(...values);
}
