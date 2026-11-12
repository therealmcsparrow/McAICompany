import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const pagePath = ['documentation', 'commands', 'i-have-adhd.md'];

describe('i-have-adhd command page', () => {
  it('AC9: starts with the command title and shows usage with [help]', () => {
    const page = read(...pagePath);
    assert.equal(page.split('\n')[0], '# `/aico:i-have-adhd`');
    assert.ok(page.includes('`/aico:i-have-adhd [help]`'));
  });

  it('AC5: says only the CEO starts it', () => {
    assert.ok(read(...pagePath).includes('Only you start this command'));
  });

  it('AC3: names both off phrases', () => {
    const page = read(...pagePath);
    assert.ok(page.includes('stop adhd mode'));
    assert.ok(page.includes('normal mode'));
  });

  it('has no CR byte', () => {
    assert.ok(!read(...pagePath).includes('\r'));
  });
});

describe('i-have-adhd listings', () => {
  it('AC9: commands README lists it under Setup and help', () => {
    const readme = read('documentation', 'commands', 'README.md');
    const start = readme.indexOf('### Setup and help');
    assert.ok(start >= 0);
    const next = readme.indexOf('\n### ', start + 1);
    const section = readme.slice(start, next < 0 ? undefined : next);
    assert.ok(section.includes('[`/aico:i-have-adhd`](i-have-adhd.md)'));
  });

  it('AC9: README command table has a row after /aico:add-skill', () => {
    const readme = read('README.md');
    const rows = readme.split('\n').filter((l) => l.startsWith('| `/aico:'));
    const add = rows.findIndex((l) => l.startsWith('| `/aico:add-skill`'));
    assert.ok(add >= 0);
    assert.ok(rows[add + 1] && rows[add + 1].startsWith('| `/aico:i-have-adhd`'));
  });

  it('AC9: spec has a bullet for the command', () => {
    const spec = read('docs', 'spec.md');
    assert.ok(spec.split('\n').some((l) => l.startsWith('- ') && l.includes('`/aico:i-have-adhd`')));
  });
});

describe('i-have-adhd credit', () => {
  it('AC7: README Credits names repo, author and MIT', () => {
    const readme = read('README.md');
    const credits = readme.slice(readme.indexOf('## Credits'));
    assert.ok(credits.includes('## Credits'));
    const line = credits.split('\n').find((l) => l.includes('ayghri/i-have-adhd'));
    assert.ok(line, 'credit line missing');
    assert.ok(line.includes('https://github.com/ayghri/i-have-adhd'));
    assert.ok(line.includes('Ayoub Ghriss'));
    assert.ok(line.includes('MIT'));
  });
});

describe('i-have-adhd changelog and glossary', () => {
  it('AC10: Unreleased names ADHD mode and keeps the settings console line', () => {
    const log = read('CHANGELOG.md');
    const start = log.indexOf('## [Unreleased]');
    assert.ok(start >= 0);
    const next = log.indexOf('\n## [', start + 1);
    const section = log.slice(start, next < 0 ? undefined : next);
    assert.ok(/ADHD mode/i.test(section));
    assert.ok(section.includes('**Settings page matches the control console look.**'));
  });

  it('GLOSSARY has the ADHD mode entry', () => {
    const lines = read('GLOSSARY.md').split('\n');
    assert.ok(lines.some((l) => l.startsWith('**ADHD mode** — ')));
  });
});
