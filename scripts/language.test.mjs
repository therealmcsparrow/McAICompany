import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validate, resolve, setLanguage, clearLanguage } from './language.mjs';

const script = path.join(import.meta.dirname, 'language.mjs');

const PROJECT = [
  '# Project profile',
  '',
  'product_type: plugin',
  'languages: en',
  'voice: technical + clear',
  '',
  '## Personas',
  '- (none yet)',
  ''
].join('\n');

function sandbox(t, { project = PROJECT } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'language-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  if (project !== null) fs.writeFileSync(path.join(cwd, '.company', 'project.md'), project);
  return {
    home,
    cwd,
    config: path.join(home, 'config.json'),
    projectFile: path.join(cwd, '.company', 'project.md'),
    cli: (...args) => {
      const r = spawnSync(process.execPath, [script, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, MCSPARROW_HOME: home }
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    }
  };
}

const snapshotOf = (s) => ({
  config: fs.existsSync(s.config) ? fs.readFileSync(s.config) : null,
  project: fs.existsSync(s.projectFile) ? fs.readFileSync(s.projectFile) : null
});

const HOSTILE = [
  'nl;rm -rf',
  '$(x)',
  '`id`',
  'nl\nen',
  'nl\r\n',
  'nl\n',
  'a'.repeat(36),
  `en-${'a'.repeat(40)}`,
  'x-private',
  'nl en',
  'nl|id',
  'nl&&id',
  '../etc',
  '-nl',
  '',
  'n',
  'nl-',
  'nl-toolongsubtag',
  'xyz'
];

test('validate refuses hostile input and echoes nothing for it', () => {
  for (const input of HOSTILE) {
    const r = validate(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.tag, null);
  }
  assert.equal(validate(undefined).ok, false);
  assert.equal(validate(null).ok, false);
  assert.equal(validate({}).ok, false);
});

test('validate accepts and canonicalises', () => {
  assert.deepEqual(validate('NL'), { ok: true, tag: 'nl', reason: null });
  assert.equal(validate('pt-br').tag, 'pt-BR');
  assert.equal(validate('en').tag, 'en');
  assert.equal(validate('zh-hant-tw').tag, 'zh-Hant-TW');
});

test('validate: unknown language reason is distinct', () => {
  assert.equal(validate('xyz').reason, 'unknown language');
});

test('CLI refuses hostile tags, exits 2, leaves files byte-identical', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ other: 1, aico_language: 'de' }));
  const before = snapshotOf(s);
  for (const input of HOSTILE.filter((x) => x !== '')) {
    for (const scope of [[], ['project']]) {
      const r = s.cli('set', input, ...scope);
      assert.equal(r.code, 2, JSON.stringify(input));
      assert.match(r.out, /^refused: /);
      assert.ok(!r.out.includes('rm -rf') && !r.out.includes('$(x)') && !r.out.includes('`'));
      assert.deepEqual(snapshotOf(s), before);
    }
  }
});

test('CLI echoes a tag only after it passed the allow-list', (t) => {
  const s = sandbox(t);
  assert.equal(s.cli('set', 'nl;rm -rf').out, 'refused: <invalid input>: not a BCP 47 tag\n');
  assert.equal(s.cli('set', 'xyz').out, 'refused: xyz: unknown language\n');
});

test('set user canonicalises, preserves other keys, then clear removes only the key', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ keep: { a: [1, 2] }, standards: 'x' }));
  assert.deepEqual(s.cli('set', 'NL'), { code: 0, out: 'set user nl\n', err: '' });
  assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')), {
    keep: { a: [1, 2] },
    standards: 'x',
    aico_language: 'nl'
  });
  assert.equal(s.cli('clear').out, 'cleared user\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')), {
    keep: { a: [1, 2] },
    standards: 'x'
  });
});

test('set user creates the home dir and file when missing', (t) => {
  const s = sandbox(t);
  const home = path.join(s.home, 'nested', 'home');
  setLanguage('fr', 'user', { home });
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).aico_language, 'fr');
});

test('a __proto__ key in config.json stays data and is preserved', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{"__proto__":{"polluted":true},"a":1}');
  setLanguage('nl', 'user', { home: s.home });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(s.config, 'utf8')), '__proto__'), true);
});

test('set on invalid JSON refuses and leaves the file untouched', (t) => {
  const s = sandbox(t);
  for (const bad of ['{not json', '[]', 'null', '"x"']) {
    fs.writeFileSync(s.config, bad);
    const r = s.cli('set', 'nl');
    assert.equal(r.code, 2);
    assert.equal(r.out, `refused: ${s.config} is not valid JSON\n`);
    assert.equal(fs.readFileSync(s.config, 'utf8'), bad);
  }
});

test('set project inserts the line directly after languages:, keeps the rest', (t) => {
  const s = sandbox(t);
  assert.equal(s.cli('set', 'nl', 'project').out, 'set project nl\n');
  assert.equal(
    fs.readFileSync(s.projectFile, 'utf8'),
    PROJECT.replace('languages: en\n', 'languages: en\naico_language: nl\n')
  );
  assert.equal(s.cli('set', 'de', 'project').out, 'set project de\n');
  const text = fs.readFileSync(s.projectFile, 'utf8');
  assert.equal(text.match(/^aico_language:/gm).length, 1);
  assert.match(text, /^aico_language: de$/m);
});

test('set project keeps CRLF line endings', (t) => {
  const s = sandbox(t, { project: PROJECT.replaceAll('\n', '\r\n') });
  s.cli('set', 'nl', 'project');
  const text = fs.readFileSync(s.projectFile, 'utf8');
  assert.ok(text.includes('languages: en\r\naico_language: nl\r\n'));
  assert.ok(!/[^\r]\n/.test(text));
});

test('clear project removes the line and leaves a byte-identical original', (t) => {
  const s = sandbox(t);
  s.cli('set', 'nl', 'project');
  assert.equal(s.cli('clear', 'project').out, 'cleared project\n');
  assert.equal(fs.readFileSync(s.projectFile, 'utf8'), PROJECT);
});

test('project scope without project.md is refused', (t) => {
  const s = sandbox(t, { project: null });
  for (const args of [['set', 'nl', 'project'], ['clear', 'project']]) {
    const r = s.cli(...args);
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: no .company/project.md\n');
  }
});

test('a line in the body, outside the header block, is not an override', (t) => {
  const s = sandbox(t, { project: `${PROJECT}\naico_language: de\n` });
  assert.deepEqual(resolve({ home: s.home, cwd: s.cwd }), { tag: 'en', source: 'default' });
});

test('unknown subcommands and extra arguments print usage, exit 2', (t) => {
  const s = sandbox(t);
  const usage = 'refused: usage: language.mjs [--default | set <tag> [project] | clear [project]]\n';
  for (const args of [
    ['bogus'], ['set'], ['set', 'nl', 'user'], ['set', 'nl', 'project', 'x'],
    ['clear', 'x'], ['clear', 'project', 'x'], ['--default', 'x'], ['--help']
  ]) {
    const r = s.cli(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, usage);
  }
  assert.equal(fs.existsSync(s.config), false);
});

test('precedence: project override > user default > en', (t) => {
  const s = sandbox(t);
  const ctx = { home: s.home, cwd: s.cwd };
  assert.deepEqual(resolve(ctx), { tag: 'en', source: 'default' });
  setLanguage('de', 'user', ctx);
  assert.deepEqual(resolve(ctx), { tag: 'de', source: 'user' });
  setLanguage('nl', 'project', ctx);
  assert.deepEqual(resolve(ctx), { tag: 'nl', source: 'project' });
  clearLanguage('project', ctx);
  clearLanguage('user', ctx);
  assert.deepEqual(resolve(ctx), { tag: 'en', source: 'default' });
});

test('--default ignores the project override', (t) => {
  const s = sandbox(t);
  s.cli('set', 'nl', 'project');
  assert.equal(s.cli().out, 'nl\tproject\n');
  assert.equal(s.cli('--default').out, 'en\tdefault\n');
  s.cli('set', 'de');
  assert.equal(s.cli('--default').out, 'de\tuser\n');
});

test('an invalid stored value falls through with a warning on stderr', (t) => {
  const s = sandbox(t, { project: PROJECT.replace('languages: en\n', 'languages: en\naico_language: nl;rm\n') });
  fs.writeFileSync(s.config, JSON.stringify({ aico_language: 'de' }));
  let r = s.cli();
  assert.equal(r.out, 'de\tuser\n');
  assert.match(r.err, /warning: ignoring aico_language/);
  fs.writeFileSync(s.config, JSON.stringify({ aico_language: '$(x)' }));
  r = s.cli();
  assert.equal(r.out, 'en\tdefault\n');
  assert.ok(!r.err.includes('$(x)'));
  fs.writeFileSync(s.config, '{broken');
  assert.equal(s.cli().out, 'en\tdefault\n');
  fs.writeFileSync(s.config, JSON.stringify({ aico_language: 42 }));
  assert.equal(s.cli().out, 'en\tdefault\n');
});

test('a stored non-canonical value is read back in canonical form', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, JSON.stringify({ aico_language: 'NL' }));
  assert.equal(s.cli().out, 'nl\tuser\n');
});

test('MCSPARROW_HOME isolates the config from the real home', (t) => {
  const s = sandbox(t);
  const real = path.join(os.homedir(), '.mcsparrow', 'config.json');
  const before = fs.existsSync(real) ? fs.readFileSync(real) : null;
  execFileSync(process.execPath, [script, 'set', 'fr'], {
    cwd: s.cwd,
    env: { ...process.env, MCSPARROW_HOME: s.home }
  });
  assert.equal(JSON.parse(fs.readFileSync(s.config, 'utf8')).aico_language, 'fr');
  const after = fs.existsSync(real) ? fs.readFileSync(real) : null;
  assert.deepEqual(after, before);
});

test('no config and no override prints the default', (t) => {
  const s = sandbox(t, { project: null });
  const r = s.cli();
  assert.equal(r.code, 0);
  t.assert.snapshot(r.out);
});
