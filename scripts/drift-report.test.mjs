import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from './drift-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'drift-report.mjs');

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function write(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

// A product root with contracts c01..cN, each with a script provider, plus any extra files.
function fixture(contracts = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-report-'));
  roots.push(root);
  for (let i = 1; i <= contracts; i += 1) {
    const n = `c${String(i).padStart(2, '0')}`;
    write(root, `docs/contracts/${n}.md`, `# Contract: ${n} v1\n\nProvider: \`scripts/${n}.mjs\` (Node built-ins only).\n`);
    write(root, `scripts/${n}.mjs`, '// provider\n');
  }
  const run = (...args) => main(args, { root });
  return { root, run };
}

function report(root, slug, date, checked) {
  return write(root, `.company/work/${slug}/drift-${date}.md`, `---\nchecked: [${checked.join(', ')}]\ndate: ${date}\n---\n## Items\n- none\n`);
}

const names = (res) => res.lines.filter((l) => !l.startsWith('pick:')).map((l) => l.split(' ')[0]);

describe('pick', () => {
  test('lists never-checked contracts first, then the oldest checked', () => {
    const { root, run } = fixture(4);
    report(root, 'a', '2026-03-01', ['c01']);
    report(root, 'b', '2026-02-01', ['c02', 'c03']);
    const res = run('pick');
    assert.equal(res.code, 0);
    assert.deepEqual(names(res), ['c04', 'c02', 'c03', 'c01']);
  });

  test('the latest report date of a contract decides, not the first', () => {
    const { root, run } = fixture(2);
    report(root, 'a', '2026-01-01', ['c01']);
    report(root, 'b', '2026-05-01', ['c01']);
    report(root, 'c', '2026-03-01', ['c02']);
    assert.deepEqual(names(run('pick')), ['c02', 'c01']);
  });

  test('caps at 8 by default and at --max', () => {
    const { run } = fixture(11);
    assert.equal(names(run('pick')).length, 8);
    assert.equal(names(run('pick', '--max', '3')).length, 3);
    assert.equal(names(run('pick', '--max', '1')).length, 1);
  });

  test('refuses a --max outside 1-8 or not a plain integer', () => {
    const { run } = fixture(2);
    for (const bad of ['0', '9', '-1', '1.5', '01', '3 ', 'x', '', '1e1']) {
      const res = run('pick', '--max', bad);
      assert.equal(res.code, 3, bad);
      assert.match(res.lines[0], /^refused: /);
    }
    assert.equal(run('pick', '--max').code, 3);
    assert.equal(run('pick', '--other').code, 3);
    assert.equal(run('pick', '--max', '2', '--max', '3').code, 3);
  });

  test('skips contracts whose Provider is not a script that exists', () => {
    const { root, run } = fixture(1);
    write(root, 'docs/contracts/roles.md', '# Contract: roles v1\n\nProvider: every Role, through `scripts/c01.mjs`.\n');
    write(root, 'docs/contracts/ghost.md', '# Contract: ghost v1\n\nProvider: `scripts/ghost.mjs`.\n');
    write(root, 'docs/contracts/up.md', '# Contract: up v1\n\nProvider: `scripts/../c01.mjs`.\n');
    write(root, 'docs/contracts/noheader.md', 'Provider: `scripts/c01.mjs`\n');
    assert.deepEqual(names(run('pick')), ['c01']);
  });

  test('is read-only and takes names only from the contract index', () => {
    const { root, run } = fixture(2);
    report(root, 'a', '2026-01-01', ['c01', 'nope-not-indexed']);
    const before = fs.readdirSync(root, { recursive: true }).sort();
    const res = run('pick');
    assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
    assert.deepEqual(names(res), ['c02', 'c01']);
    assert.ok(!res.lines.join('\n').includes('nope-not-indexed'));
  });

  test('ignores a report that is a link, a hard link, oversized or malformed', () => {
    const { root, run } = fixture(3);
    const good = report(root, 'a', '2026-01-01', ['c01']);
    fs.linkSync(good, path.join(root, '.company/work/a/drift-2026-01-02.md'));
    write(root, '.company/work/b/drift-2026-02-01.md', `---\nchecked: [c02]\ndate: 2026-02-01\n---\n${'x'.repeat(70000)}\n`);
    write(root, '.company/work/c/drift-2026-02-02.md', '---\nchecked: c03\ndate: soon\n---\n');
    // the hard-linked pair is skipped as a whole, so c01 counts as never checked
    assert.deepEqual(names(run('pick')).sort(), ['c01', 'c02', 'c03']);
  });

  test('prints pick: none when no contract has a script provider', () => {
    const { root, run } = fixture(0);
    fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
    const res = run('pick');
    assert.equal(res.code, 0);
    assert.deepEqual(res.lines, ['pick: none']);
  });

  test('a junction as the work folder is not followed', () => {
    const { root, run } = fixture(2);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-out-'));
    roots.push(outside);
    report(outside, 'a', '2026-01-01', ['c01']);
    fs.mkdirSync(path.join(root, '.company'), { recursive: true });
    fs.symlinkSync(path.join(outside, '.company', 'work'), path.join(root, '.company', 'work'), 'junction');
    assert.deepEqual(names(run('pick')), ['c01', 'c02']);
  });
});

const DOC = 'docs/contracts/c01.md';
const CODE = 'scripts/c01.mjs';

function item(kind = 'missing-feature', doc = `${DOC}:3`, code = `${CODE}:1`, text = 'the script never writes the record') {
  return `- ${kind} | ${doc} | ${code} | ${text}`;
}

function good(items = [item()], extra = {}) {
  const fm = { checked: '[c01]', date: '2026-10-29', ...extra };
  const head = Object.entries(fm).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${head}\n---\n## Items\n${items.join('\n')}\n`;
}

function lintFixture(text, rel = '.company/work/demo/drift-2026-10-29.md') {
  const fx = fixture(2);
  write(fx.root, rel, text);
  return { ...fx, rel, lint: (r = rel) => fx.run('lint', r) };
}

const errs = (res) => res.lines.filter((l) => l.startsWith('ERROR'));

describe('lint', () => {
  test('accepts a well-formed report', () => {
    const fx = lintFixture(good([item(), item('incomplete-model', `${DOC}:9`, CODE), item('logic-shortcut'), item('architectural-divergence')]));
    const res = fx.lint();
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(res.lines.at(-1), 'drift-report: 0 errors');
  });

  test('accepts - none as the only item', () => {
    assert.equal(lintFixture(good(['- none'])).lint().code, 0);
  });

  test('refuses an unknown kind, in any case or spelling', () => {
    for (const kind of ['nice-idea', 'Missing-Feature', 'missing_feature', 'missing-feature ', '', 'a'.repeat(500)]) {
      const res = lintFixture(good([item(kind)])).lint();
      assert.equal(res.code, 2, JSON.stringify(kind));
      assert.match(errs(res)[0], /^ERROR line 6: /);
    }
  });

  test('refuses a missing path', () => {
    for (const [doc, code] of [[`docs/contracts/none.md:3`, `${CODE}:1`], [`${DOC}:3`, 'scripts/none.mjs:1']]) {
      const res = lintFixture(good([item('missing-feature', doc, code)])).lint();
      assert.equal(res.code, 2);
      assert.equal(errs(res).length, 1);
    }
  });

  test('refuses a doc path with no line number and a path that is a folder', () => {
    assert.equal(lintFixture(good([item('missing-feature', DOC)])).lint().code, 2);
    assert.equal(lintFixture(good([item('missing-feature', 'docs/contracts:1')])).lint().code, 2);
  });

  test('refuses hostile paths without reading them', () => {
    const hostile = ['../outside.md', '/etc/passwd', 'C:/Windows/win.ini', 'docs/../scripts/c01.mjs', '.git/config', 'docs//x', 'docs\\contracts\\c01.md', '~/x', '$HOME/x', 'a b'];
    for (const h of hostile) {
      const res = lintFixture(good([item('missing-feature', `${h}:1`)])).lint();
      assert.equal(res.code, 2, h);
      assert.equal(errs(res).length, 1, h);
    }
  });

  test('refuses a path reached through a link (junction)', () => {
    const fx = lintFixture(good([item('missing-feature', `docs/alias/c01.md:3`)]));
    fs.symlinkSync(path.join(fx.root, 'docs', 'contracts'), path.join(fx.root, 'docs', 'alias'), 'junction');
    const res = fx.lint();
    assert.equal(res.code, 2);
    assert.match(errs(res)[0], /^ERROR line 6: doc path /);
    const fx2 = lintFixture(good([item('missing-feature', `${DOC}:3`, 'lib/c01.mjs:1')]));
    fs.symlinkSync(path.join(fx2.root, 'scripts'), path.join(fx2.root, 'lib'), 'junction');
    const res2 = fx2.lint();
    assert.equal(res2.code, 2);
    assert.match(errs(res2)[0], /code path /);
  });

  test('refuses a file symlink', (t) => {
    const fx = lintFixture(good([item('missing-feature', `${DOC}:3`, 'scripts/link.mjs:1')]));
    try {
      fs.symlinkSync(path.join(fx.root, 'scripts', 'c01.mjs'), path.join(fx.root, 'scripts', 'link.mjs'), 'file');
    } catch (error) {
      t.skip(`file symlinks not allowed here: ${error.code}`);
      return;
    }
    assert.equal(fx.lint().code, 2);
  });

  test('refuses a hard-linked file on either side', () => {
    const fx = lintFixture(good([item('missing-feature', `${DOC}:3`, 'scripts/twin.mjs:1')]));
    fs.linkSync(path.join(fx.root, 'scripts', 'c01.mjs'), path.join(fx.root, 'scripts', 'twin.mjs'));
    const res = fx.lint();
    assert.equal(res.code, 2);
    assert.equal(errs(res).length, 1);
    const fx2 = lintFixture(good([item('missing-feature', 'docs/contracts/twin.md:3')]));
    fs.linkSync(path.join(fx2.root, 'docs', 'contracts', 'c01.md'), path.join(fx2.root, 'docs', 'contracts', 'twin.md'));
    assert.equal(fx2.lint().code, 2);
  });

  test('refuses a report that is itself a hard link or sits outside the run folder shape', () => {
    const fx = lintFixture(good());
    fs.linkSync(path.join(fx.root, fx.rel), path.join(fx.root, '.company/work/demo/drift-2026-10-30.md'));
    assert.notEqual(fx.lint().code, 0);
    assert.notEqual(fx.lint('.company/work/demo/drift-2026-10-30.md').code, 0);
    for (const bad of ['notes.md', '.company/work/demo/other.md', '.company/work/Demo/drift-2026-10-29.md', '../x/drift-2026-10-29.md', '.company/work/demo/drift-2026-13-40.md']) {
      const f = lintFixture(good(), bad.startsWith('.company') ? '.company/work/demo/drift-2026-10-29.md' : 'x.md');
      assert.notEqual(f.run('lint', bad).code, 0, bad);
    }
  });

  test('refuses control characters and over-long arguments', () => {
    const { run } = fixture(1);
    assert.equal(run('lint', 'a\u0000b').code, 3);
    assert.equal(run('lint', 'x'.repeat(5000)).code, 3);
    assert.equal(run('lint').code, 3);
    assert.equal(run('lint', 'a', 'b').code, 3);
    assert.equal(run('nope').code, 3);
    assert.equal(run().code, 3);
  });

  test('checks the frontmatter and the heading', () => {
    const cases = [
      good([item()], { checked: null }),
      good([item()], { date: null }),
      good([item()], { date: '2026-02-30' }),
      good([item()], { date: '29-10-2026' }),
      good([item()], { checked: '[]' }),
      good([item()], { checked: '[ghost]' }),
      good([item()], { checked: '[c01, c01x]' }),
      good([item()], { checked: 'c01' }),
      good([item()], { extra: 'x' }),
      '## Items\n- none\n',
      `---\nchecked: [c01]\ndate: 2026-10-29\n---\n${item()}\n`,
      good([item()]).replace('## Items', '## Findings'),
      good([item()]).replace('## Items\n', '## Items\nprose line\n'),
      good(['- none', item()]),
      good([]),
    ];
    for (const text of cases) {
      const res = lintFixture(text).lint();
      assert.equal(res.code, 2, text);
    }
  });

  test('refuses an item with a bad shape or text', () => {
    const cases = [
      '- missing-feature | docs/contracts/c01.md:3 | scripts/c01.mjs',
      '- missing-feature | docs/contracts/c01.md:3 | scripts/c01.mjs | ',
      `* ${item().slice(2)}`,
      `${item()} `.replace(/ $/, '\u0007'),
      item('missing-feature', `${DOC}:3`, `${CODE}:x`),
      item('missing-feature', `${DOC}:3`, `${CODE}:1`, 'x'.repeat(301)),
      item('missing-feature', `${DOC}:3`, `${CODE}:1`, 'bad \u202e text'),
      item('missing-feature', `${DOC}:${'9'.repeat(40)}`),
    ];
    for (const c of cases) {
      const res = lintFixture(good([c])).lint();
      assert.equal(res.code, 2, c);
    }
  });

  test('is linear on hostile lines and refuses an oversized file', () => {
    const long = `- ${'a'.repeat(60000)}`;
    const t0 = Date.now();
    const res = lintFixture(good([long])).lint();
    assert.equal(res.code, 2);
    assert.ok(Date.now() - t0 < 2000);
    const big = lintFixture(good(['- none']) + 'x'.repeat(70000)).lint();
    assert.equal(big.code, 1);
    const many = lintFixture(good(Array.from({ length: 501 }, () => item()))).lint();
    assert.equal(many.code, 2);
  });

  test('echoes no report text', () => {
    const marker = 'ZZ-SECRET-MARKER';
    const res = lintFixture(good([item(marker, `${marker}/x:1`, marker, marker)])).lint();
    assert.ok(!res.lines.join('\n').includes(marker));
  });
});

describe('informational only', () => {
  const read = (rel) => fs.readFileSync(path.join(PLUGIN, ...rel.split('/')), 'utf8');

  test('no check script and no CI file reads the report', () => {
    const files = ['scripts/check.mjs', 'scripts/contract-drift.mjs', 'scripts/run.mjs', 'package.json'];
    const gh = path.join(PLUGIN, '.github');
    if (fs.existsSync(gh)) {
      for (const f of fs.readdirSync(gh, { recursive: true })) {
        const rel = `.github/${String(f).split(path.sep).join('/')}`;
        if (fs.statSync(path.join(PLUGIN, rel)).isFile()) files.push(rel);
      }
    }
    for (const f of files) {
      if (!fs.existsSync(path.join(PLUGIN, f))) continue;
      assert.ok(!/drift-report|drift-\d{4}/.test(read(f)), f);
    }
    const others = fs.readdirSync(HERE).filter((n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs') && n !== 'drift-report.mjs');
    for (const n of others) assert.ok(!/drift-report\.mjs/.test(read(`scripts/${n}`)), n);
  });

  test('pick and lint never fail a run: exit codes stay local to the command', () => {
    const { run } = fixture(1);
    assert.equal(run('pick').code, 0);
  });

  test('the CLI runs from a product root', () => {
    const { root } = fixture(2);
    const res = spawnSync(process.execPath, [SCRIPT, 'pick', '--max', '1'], { cwd: root, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^c01 /);
  });
});

describe('maintain Playbook', () => {
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills', 'maintain', 'SKILL.md'), 'utf8');
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'maintain', 'references', 'drift.md'), 'utf8');

  test('the drift Step is dispatched only under the drift argument', () => {
    assert.ok(skill.split('\n').length <= 125);
    const mentions = skill.split('\n').filter((l) => /drift-report|references\/drift\.md/.test(l));
    assert.equal(mentions.length, 1);
    assert.match(mentions[0], /only when the argument is exactly `drift`/);
    assert.match(mentions[0], /without it, no drift Step is dispatched and `pick` is not run/);
    assert.match(mentions[0], /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.mjs" drift-report pick/);
    assert.match(skill, /^argument-hint: "\[drift\]"$/m);
  });

  test('the routine steps do not mention the report', () => {
    const routine = skill.split('\n').filter((l) => /^\d\.|^\s+Also run/.test(l)).join('\n');
    assert.ok(!/drift-report|drift-<date>|\bpick\b/.test(routine));
  });

  test('the reference names the kinds, the single dispatch and that nothing blocks', () => {
    for (const k of ['missing-feature', 'incomplete-model', 'logic-shortcut', 'architectural-divergence']) assert.ok(ref.includes(k), k);
    assert.match(ref, /once/);
    assert.match(ref, /never blocks/);
    assert.match(ref, /Minor/);
    assert.ok(!ref.includes('\r'));
    assert.ok(!skill.includes('\r'));
  });

  test('the script is called through run.mjs under the plugin-root variable, never by a bare path', () => {
    for (const text of [skill, ref]) {
      for (const m of text.matchAll(/[^\n]*drift-report[^\n]*/g)) {
        assert.ok(!/scripts\/drift-report\.mjs/.test(m[0]), m[0]);
        if (/ drift-report /.test(m[0])) assert.match(m[0], /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.mjs" drift-report (pick|lint)/);
      }
    }
  });
});

describe('Contract file', () => {
  test('exists with the header and Provider line the index needs', () => {
    const text = fs.readFileSync(path.join(PLUGIN, 'docs', 'contracts', 'drift-report.md'), 'utf8');
    assert.match(text.split('\n')[0], /^# Contract: drift-report v1.3$/);
    assert.match(text, /^Provider: `scripts\/drift-report\.mjs`/m);
    assert.ok(!text.includes('\r'));
  });
});
