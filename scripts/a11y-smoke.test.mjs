import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

// CLI: node scripts/a11y-smoke.mjs [file.html ...]
// With files: checks exactly those. Without: tracked *.html under the working directory
// (git ls-files), minus any path with a "fixtures" folder. Exit 0 = no barrier found, exit 1 =
// a barrier or an unreadable file. Every report line for a barrier names the file and the rule.

const SCRIPT = path.join(import.meta.dirname, 'a11y-smoke.mjs');
const FIX = path.join(import.meta.dirname, 'fixtures', 'a11y-smoke');
const fx = (n) => path.join(FIX, n);

let tmp;
let env;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-smoke-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  // os.devNull is "\\.\nul" on Windows and git rejects it; use a real empty file instead.
  const emptyGitConfig = path.join(tmp, 'empty.gitconfig');
  fs.writeFileSync(emptyGitConfig, '');
  env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    MCSPARROW_HOME: path.join(home, '.mcsparrow'),
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function run(args, { cwd = tmp, timeout = 30000 } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, signal: r.signal, error: r.error, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// A report line that names the file and matches every given pattern.
function hasLine(out, file, ...pats) {
  const base = path.basename(file);
  return out.split(/\r?\n/).some((l) => l.includes(base) && pats.every((p) => p.test(l)));
}

describe('clean page', () => {
  test('exit 0 and says smoke check', () => {
    const r = run([fx('clean.html')]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /smoke check/i);
  });

  test('never calls a page accessible or compliant', () => {
    const r = run([fx('clean.html')]);
    assert.match(r.out, /smoke check/i);
    assert.doesNotMatch(r.out, /\b(is|are|pages?)\s+(fully\s+)?accessible\b/i);
    assert.doesNotMatch(r.out, /\b(compliant|conformant|conforms)\b/i);
  });

  test('barriers only inside comments are not barriers', () => {
    const r = run([fx('commented-bad.html')]);
    assert.equal(r.code, 0, r.out);
  });
});

describe('each rule: exit 1 naming file and rule', () => {
  const cases = [
    ['no-lang.html', [/lang/i]],
    ['empty-lang.html', [/lang/i]],
    ['no-main.html', [/main/i]],
    ['two-main.html', [/main/i]],
    ['no-main-comment-main.html', [/main/i]],
    ['skip-missing.html', [/skip/i]],
    ['button-no-name.html', [/button/i, /name/i]],
    ['link-no-name.html', [/link|\ba\b/i, /name/i]],
    ['input-no-name.html', [/input/i, /name/i]],
    ['select-no-name.html', [/select/i, /name/i]],
    ['textarea-no-name.html', [/textarea/i, /name/i]],
    ['outline-none.html', [/outline|focus/i]],
    ['outline-zero-visible.html', [/outline|focus/i]],
    ['outline-none-important.html', [/outline|focus/i]],
  ];
  for (const [file, pats] of cases) {
    test(file, () => {
      const r = run([fx(file)]);
      assert.equal(r.code, 1, r.out);
      assert.ok(hasLine(r.out, file, ...pats), `no line names ${file} with ${pats}:\n${r.out}`);
      assert.match(r.out, /smoke check/i);
    });
  }

  test('one run reports every bad file and still exits 1 with a clean one beside it', () => {
    const r = run([fx('clean.html'), fx('no-lang.html'), fx('button-no-name.html')]);
    assert.equal(r.code, 1, r.out);
    assert.ok(hasLine(r.out, 'no-lang.html', /lang/i), r.out);
    assert.ok(hasLine(r.out, 'button-no-name.html', /button/i), r.out);
    assert.ok(!hasLine(r.out, 'clean.html', /lang|main|skip|name|outline/i), `clean page flagged:\n${r.out}`);
  });
});

describe('default file set', () => {
  function repo(name, files) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    const git = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'ignore' });
    git('init', '-q');
    for (const [rel, src] of Object.entries(files)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, src);
      git('add', '--', rel);
    }
    return dir;
  }
  const read = (n) => fs.readFileSync(fx(n), 'utf8');

  test('tracked html outside fixtures is checked; a barrier fails by name', () => {
    const dir = repo('set-bad', { 'page.html': read('no-lang.html'), 'docs/ok.html': read('clean.html') });
    const r = run([], { cwd: dir });
    assert.equal(r.code, 1, r.out);
    assert.ok(hasLine(r.out, 'page.html', /lang/i), r.out);
  });

  test('html under a fixtures folder is skipped at any depth', () => {
    const dir = repo('set-fixtures', {
      'ok.html': read('clean.html'),
      'fixtures/bad.html': read('no-lang.html'),
      'a/b/fixtures/deep/bad.html': read('no-main.html'),
    });
    const r = run([], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /bad\.html/);
  });

  test('untracked html is not checked', () => {
    const dir = repo('set-untracked', { 'ok.html': read('clean.html') });
    fs.writeFileSync(path.join(dir, 'new.html'), read('no-lang.html'));
    const r = run([], { cwd: dir });
    assert.equal(r.code, 0, r.out);
  });

  test('non-html tracked files are not read as pages', () => {
    const dir = repo('set-nonhtml', { 'ok.html': read('clean.html'), 'notes.md': '<button></button>', 'x.txt': '<html>' });
    const r = run([], { cwd: dir });
    assert.equal(r.code, 0, r.out);
  });
});

describe('hostile input gives a bounded verdict', () => {
  const page = (body, head = '') => `<!doctype html><html lang="en"><head><title>t</title>${head}</head><body><a href="#c">Skip to content</a><main id="c">${body}</main></body></html>`;
  const sane = (r, name) => {
    assert.equal(r.error, undefined, `${name}: ${r.error}`);
    assert.equal(r.signal, null, `${name}: killed by ${r.signal}`);
    assert.ok(r.code === 0 || r.code === 1, `${name}: exit ${r.code}\n${r.out.slice(0, 500)}`);
    assert.doesNotMatch(r.out, /RangeError|Maximum call stack|heap out of memory|\n\s+at .*\.mjs:\d+/, `${name}: crash text`);
    assert.match(r.out, /smoke check/i, `${name}: no smoke check report`);
    assert.ok(r.out.length < 200000, `${name}: output ${r.out.length} bytes`);
  };
  const hostile = {
    'huge-file': () => page('<p>x</p>'.repeat(1_000_000)),
    'deep-nesting-unclosed': () => page('<div>'.repeat(200_000)),
    'unclosed-comment': () => `<html lang="en"><body><main><!-- ${'<button>'.repeat(100_000)}`,
    'unclosed-tag-spaces': () => page(`<button ${' '.repeat(500_000)}`),
    'attr-flood': () => page(`<a ${'a="1" '.repeat(200_000)}>x</a>`),
    'quote-flood': () => page(`<input ${'"'.repeat(500_000)}>`),
    'unclosed-style': () => page('<p>x</p>', `<style>${':focus{'.repeat(100_000)}`),
    'focus-rules-flood': () => page('<p>x</p>', `<style>${'a:focus { color: red } '.repeat(100_000)}</style>`),
    'many-buttons': () => page('<button>b</button>'.repeat(200_000)),
    'lang-quote-edge': () => '<html lang=""><body><main></main></body></html>',
    'nul-bytes': () => page('<p>\0\0\0</p><button>\0</button>'),
    'binary-garbage': () => Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 131) % 256)),
  };
  for (const [name, make] of Object.entries(hostile)) {
    test(name, () => {
      const f = path.join(tmp, `${name}.html`);
      fs.writeFileSync(f, make());
      const t0 = Date.now();
      const r = run([f], { timeout: 20000 });
      sane(r, name);
      assert.ok(Date.now() - t0 < 15000, `${name}: took ${Date.now() - t0} ms`);
    });
  }

  test('unclosed comment does not hide later markup but also is not read as markup', () => {
    const f = path.join(tmp, 'comment-open.html');
    fs.writeFileSync(f, '<!doctype html><html lang="en"><body><main id="c"><p>x</p></main><!-- <button></button>');
    const r = run([f]);
    sane(r, 'comment-open');
  });

  test('missing file: exit 1, names the file, no stack trace', () => {
    const r = run([path.join(tmp, 'nope.html')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /smoke check/i);
    assert.match(r.out, /nope\.html/);
    assert.doesNotMatch(r.out, /\n\s+at /);
  });

  test('a directory given as a file is refused, not read', () => {
    const r = run([tmp]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /smoke check/i);
    assert.doesNotMatch(r.out, /\n\s+at /);
  });

  test('printed file names escape control characters', () => {
    const hostileName = path.join(tmp, 'bad\x1b[31m\x07name\r\n.html');
    const r = run([hostileName]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /smoke check/i);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(r.out, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
    assert.doesNotMatch(r.out, /\x1b/);
    // a CR or LF inside the name must not forge a second report line
    assert.doesNotMatch(r.out, /^\.html/m);
  });

  test('a name that looks like an option is a file, not a flag', () => {
    const r = run(['--help-me-not.html']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /help-me-not\.html/);
  });

  test('page text cannot inject a fake pass line or ANSI into the report', () => {
    const f = path.join(tmp, 'inject.html');
    fs.writeFileSync(f, '<!doctype html><html><body><main><button title="\x1b[2J"></button></main><!-- 0 barriers, smoke check passed --></body></html>');
    const r = run([f]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /smoke check/i);
    assert.doesNotMatch(r.out, /\x1b/);
  });
});
