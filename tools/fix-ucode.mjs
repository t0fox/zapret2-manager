import { readFileSync, writeFileSync } from 'fs';

const path = 'G:/zapret2-manager/zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc';
let c = readFileSync(path, 'utf-8');

// Fix: word.push( → push(word, 
c = c.replace(/(\w+)\.push\(/g, 'push($1, ');

// Fix: word.sort() → sort(word)
c = c.replace(/(\w+)\.sort\(\)/g, 'sort($1)');

// Fix: .toLowerCase()
c = c.replace(/trim\(raw\)\.toLowerCase\(\)/g, 'lc(trim(raw))');
c = c.replace(/t\.toLowerCase\(\)/g, 'lc(t)');

// Fix: .replace()
c = c.replace(/rendered\.replace\(/g, 'replace(rendered, ');

// Fix: /pat/.test(var) → match(var, /pat/)
// handle ! negation
c = c.replace(/!(\/.+?\/\w*)\.test\(([^)]+)\)/g, '!match($2, $1)');
// handle positive
c = c.replace(/(?<!!)(\/.+?\/\w*)\.test\(([^)]+)\)/g, 'match($2, $1)');

// Verify no more .test() calls
const tests = c.match(/\.test\(/g);
if (tests) console.log('Remaining .test():', tests.length);

writeFileSync(path, c, 'utf-8');
console.log('Done');
