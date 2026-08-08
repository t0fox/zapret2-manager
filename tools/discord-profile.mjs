import crypto from 'node:crypto';

const SECTION_NAMES = new Set(['StressOzz_Discord_Media_Dv1', 'StressOzz_Discord_Voice']);

function splitSections(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const starts = [];
  const re = /(?:^|\s)--new(?:=|\s+)([^\s]+)?/g;
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + (source[match.index] === ' ' ? 1 : 0);
    starts.push({ start, name: match[1] || null });
  }
  if (!starts.length) return [{ name: null, text: source }];
  const result = [];
  if (starts[0].start > 0) result.push({ name: null, text: source.slice(0, starts[0].start).trim() });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].start : source.length;
    const header = source.slice(starts[i].start, end).trim();
    const parts = header.split(/\s+/);
    const body = parts[0].startsWith('--new=') ? parts.slice(1).join(' ') : parts.slice(2).join(' ');
    result.push({ name: starts[i].name, text: body });
  }
  return result.filter((section) => section.text || section.name);
}

export function buildDiscordCandidate(current, records) {
  const preserved = splitSections(current).filter((section) => !SECTION_NAMES.has(section.name));
  const adapted = records.filter((record) => record.executionStatus === 'native-adapted');
  if (adapted.length !== 2) throw new Error('expected exactly two native-adapted Discord records');
  const sections = preserved.concat(adapted.map((record) => ({
    name: record.compiledOptions.profileName,
    text: record.compiledOptions.fragment
  })));
  const candidate = sections.map((section, index) => `${index > 0 ? ' --new=' : (section.name ? '--new=' : '')}${section.name ? section.name + ' ' : ''}${section.text}`).join('').trim();
  return { candidate, sections, records: adapted };
}

export function buildDiscordChangeHash({ candidateSha256, compiledDigests }) {
  const canonical = JSON.stringify({ candidateSha256, compiledDigests: [...compiledDigests] });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
