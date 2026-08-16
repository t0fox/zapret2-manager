import fs from 'node:fs';
import path from 'node:path';

export function inventoryAvatarPage(file) {
  const source = fs.readFileSync(file, 'utf8');
  const sections = new Set();
  for (const match of source.matchAll(/(?:class|id|className)\s*[:=]\s*[`"']([^`"']+)[`"']/g)) {
    for (const token of match[1].split(/\s+/)) if (token) sections.add(token);
  }
  const headings = [...source.matchAll(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi)].map((match) => match[1].trim());
  const imports = [...source.matchAll(/(?:import\s+[^'"`]+from\s*|require\(\s*)['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);
  const tabs = [...source.matchAll(/(?:href|route|tab)\s*[:=]\s*['"`]([^'"`#]+)['"`]/g)].map((match) => match[1]);
  return {
    source_file: path.resolve(file),
    dependent_components: [...new Set(imports)].sort(),
    obvious_sections: [...sections].sort(),
    headings: [...new Set(headings)],
    tabs: [...new Set(tabs)].sort(),
    warning: 'Evidence-only inventory. It does not decide parity and does not modify source.',
  };
}

if (process.argv[1] && process.argv[1].endsWith('inventory-avatar-page.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/inventory-avatar-page.mjs <donor-page-file>');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(inventoryAvatarPage(file), null, 2));
  }
}
