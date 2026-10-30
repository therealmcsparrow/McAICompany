// Read documentation pages by topic. Tests use these instead of one flat file.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// One page, path relative to documentation/ (e.g. 'start/setup.md').
export const docPage = (root, rel) => readFileSync(join(root, 'documentation', rel), 'utf8');

// Every .md in one documentation folder: README.md first, the rest sorted, joined by a newline.
export function docFolder(root, folder) {
  const dir = join(root, 'documentation', folder);
  const names = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md').sort();
  if (readdirSync(dir).includes('README.md')) names.unshift('README.md');
  return names.map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
}

// The page of one command, e.g. commandPage(root, 'fix').
export const commandPage = (root, name) => docPage(root, `commands/${name}.md`);
