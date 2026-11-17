import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, readdirSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGolden } from './contract-fixtures.mjs';
import { branchId } from '../mods/lib/work-folder.mjs';

const SCRIPT = fileURLToPath(new URL('./diff-facts.mjs', import.meta.url));
const SLUG = 'P20261116.000003/01-feature';
const RUN_REL = '.company/work/P20261116.000003/01-feature';
const FLAGS = ['ui_changed', 'strings_changed', 'contract_changed', 'docs_only'];
const FACT_KEYS = ['base', 'contract_changed', 'docs_only', 'head', 'paths', 'step', 'strings_changed', 'truncated', 'ui_changed', 'v'];

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 }); });

const load = () => import('./diff-facts.mjs');
const entry = (path, o = {}) => ({ path, from: null, status: 'M', added: 1, removed: 1, similarity: null, ...o });

// Environment for every child: no inherited GIT_* or runner variables, git config and home in the sandbox.
function childEnv(root, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(GIT_|GITHUB_|MCSPARROW_|AICO_)/.test(k)) env[k] = v;
  }
  const home = join(root, 'home');
  return {
    ...env,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    MCSPARROW_HOME: join(home, '.mcsparrow'),
    HOME: home,
    USERPROFILE: home,
    ...extra,
  };
}

// A temp git repo with its own git config and home; returns helpers bound to it.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'dfacts-'));
  roots.push(root);
  mkdirSync(join(root, 'home'));
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n\tprotectNTFS = false\n\tprotectHFS = false\n');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const env = childEnv(root);
  const git = (args, input) => execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q']);
  const s = {
    root, repo, env, git,
    put(rel, content) {
      const abs = join(repo, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    },
    commit(msg = 'c') {
      git(['add', '-A']);
      git(['commit', '-q', '-m', msg]);
      return git(['rev-parse', 'HEAD']).trim();
    },
    cli(args, extraEnv = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000,
      });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
    handoff(step, base) {
      s.put(`${RUN_REL}/${step}.md`, `---\nstep: ${step.slice(0, 2)}\nrole: ${step.slice(3)}\ntask: ${SLUG}\nstatus: done\nround: 0\nbase-commit: ${base}\nrisk-tier: high\n---\nBy: ${step.slice(3)}\n`);
    },
    factsDir: () => join(repo, ...RUN_REL.split('/'), 'facts'),
  };
  return s;
}

// A commit on top of `parent` that adds files with arbitrary path bytes, through plumbing only.
// Trees are built with mktree -z: update-index refuses names such as '..' or control characters on some platforms.
function commitPaths(s, parent, paths) {
  const run = (args, input) => execFileSync('git', args, { cwd: s.repo, env: s.env, input, maxBuffer: 1 << 26 });
  const blob = s.git(['hash-object', '-w', '--stdin'], 'x\n').trim();
  const root = new Map(); // name (latin1 string of the bytes) -> { mode, id } | Map
  const add = (bytes, mode, id) => {
    const parts = [];
    let from = 0;
    for (let i = 0; i <= bytes.length; i++) {
      if (i === bytes.length || bytes[i] === 0x2f) { parts.push(bytes.subarray(from, i).toString('latin1')); from = i + 1; }
    }
    let dir = root;
    for (const seg of parts.slice(0, -1)) {
      if (!(dir.get(seg) instanceof Map)) dir.set(seg, new Map());
      dir = dir.get(seg);
    }
    dir.set(parts.at(-1), { mode, id });
  };
  for (const rec of run(['ls-tree', '-r', '-z', parent]).toString('latin1').split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t');
    const [mode, , id] = rec.slice(0, tab).split(' ');
    add(Buffer.from(rec.slice(tab + 1), 'latin1'), mode, id);
  }
  for (const p of paths) add(Buffer.isBuffer(p) ? p : Buffer.from(p), '100644', blob);
  const write = dir => {
    const input = Buffer.concat([...dir].map(([name, v]) => {
      const [mode, type, id] = v instanceof Map ? ['040000', 'tree', write(v)] : [v.mode, 'blob', v.id];
      return Buffer.concat([Buffer.from(`${mode} ${type} ${id}\t`), Buffer.from(name, 'latin1'), Buffer.from([0])]);
    }));
    return run(['mktree', '-z'], input).toString().trim();
  };
  return s.git(['commit-tree', write(root), '-p', parent, '-m', 'paths']).trim();
}

const parse = r => JSON.parse(r.stdout);
const refused = r => r.status === 2 && r.stdout.startsWith('refused:');
const failSafe = r => refused(r) || (r.status === 0 && parse(r).ui_changed === true);
const rawControl = text => /[\x00-\x08\x0b-\x1f\x7f]/.test(text);

function kindsOf(facts) { return Object.fromEntries(facts.paths.map(p => [p.path, p.kind])); }

// ---------------------------------------------------------------- hostile input first

test('classify: control characters and .. segments are kind unknown and never docs', async t => {
  const { classify } = await load();
  const hostile = [
    'docs/a\nb.md', 'docs/a\tb.md', 'docs/a\x1b[31mb.md', 'docs/a\rb.md', 'docs/a\x00b.md', 'docs/a\x7fb.md',
    'docs/../x.md', '../docs/a.md', 'docs/a/..', 'docs/./../a.md',
  ];
  for (const p of hostile) {
    await t.test(JSON.stringify(p), () => {
      const alone = classify([entry(p)], null);
      assert.equal(alone.paths.length, 1);
      assert.equal(alone.paths[0].kind, 'unknown');
      assert.equal(alone.ui_changed, true);
      assert.equal(alone.contract_changed, true);
      assert.equal(alone.docs_only, false);
      const beside = classify([entry('docs/ok.md'), entry(p)], null);
      assert.equal(beside.ui_changed, true);
      assert.equal(beside.docs_only, false);
    });
  }
});

test('classify: a leading dash, a very long name and a replacement character never give ui_changed false', async t => {
  const { classify } = await load();
  const names = ['-docs.md', `docs/${'a'.repeat(5000)}.md`, 'docs/\ufffd.md', 'docs/-rf.md'];
  for (const p of names) {
    await t.test(p.slice(0, 30), () => {
      assert.equal(classify([entry(p)], null).ui_changed, true);
    });
  }
});

test('classify: object-prototype names are plain paths', async () => {
  const { classify } = await load();
  const r = classify([entry('__proto__'), entry('constructor'), entry('toString')], null);
  assert.deepEqual(r.paths.map(p => p.kind), ['unknown', 'unknown', 'unknown']);
  assert.equal(r.ui_changed, true);
  assert.equal(({}).polluted, undefined);
});

test('classify: frozen input is not mutated and added/removed/similarity are not echoed', async () => {
  const { classify } = await load();
  const entries = Object.freeze([Object.freeze(entry('docs/a.md', { from: 'docs/b.md', status: 'R', similarity: 90 }))]);
  const r = classify(entries, null);
  assert.deepEqual(Object.keys(r.paths[0]).sort(), ['from', 'kind', 'path', 'status']);
});

test('show: hostile paths in a real commit give ui_changed true and are never echoed raw', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  const names = [
    'docs/x\ny.md', 'docs/x\ty.md', 'docs/x\x1b[31my.md', 'docs/x\ry.md', 'docs/a/../b.md', 'docs/x\x07y.md',
  ];
  for (const p of names) {
    await t.test(JSON.stringify(p), () => {
      const head = commitPaths(s, base, [p]);
      const r = s.cli(['show', '--base', base, '--head', head]);
      assert.equal(r.status, 0, r.stderr);
      const facts = parse(r);
      assert.equal(facts.ui_changed, true);
      assert.equal(facts.docs_only, false);
      assert.equal(facts.paths.length, 1);
      assert.equal(facts.paths[0].kind, 'unknown');
      assert.equal(rawControl(r.stdout), false, 'stdout carries a raw control character');
      assert.equal(rawControl(r.stderr), false, 'stderr carries a raw control character');
      assert.equal(r.stdout.includes('x\ny'), false);
      assert.equal(r.stdout.includes('x\ty'), false);
    });
  }
});

test('show: dash-led, non-UTF-8 and very long names in a real commit give ui_changed true', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  const names = [
    '-docs.md',
    Buffer.from([0x64, 0x6f, 0x63, 0x73, 0x2f, 0xff, 0xfe, 0x2e, 0x6d, 0x64]),
    `docs/${'a'.repeat(5000)}.md`,
  ];
  for (const [i, p] of names.entries()) {
    await t.test(`name ${i}`, () => {
      const head = commitPaths(s, base, [p]);
      const r = s.cli(['show', '--base', base, '--head', head]);
      assert.ok(failSafe(r), `${r.status} ${r.stdout.slice(0, 200)}`);
      assert.equal(rawControl(r.stdout), false);
    });
  }
});

test('show: a --base that is not a full commit id is refused before git runs', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  const canary = join(s.root, 'canary.txt');
  const values = [
    '', 'HEAD', 'main', 'HEAD~1', base.slice(0, 7), base.slice(0, 39), `${base}0`, 'g'.repeat(40), ` ${base}`, `${base}\n`,
    '-n', '--upload-pack=touch canary', `--output=${canary}`, `${base}..HEAD`, `${base};touch canary`, '$(touch canary)',
  ];
  for (const v of values) {
    await t.test(JSON.stringify(v.slice(0, 40)), () => {
      const out = join(s.root, 'gh-out.txt');
      const r = s.cli(['show', '--base', v, '--github-output'], { GITHUB_OUTPUT: out });
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
      assert.equal(existsSync(canary), false);
      assert.equal(existsSync(join(s.repo, 'canary')), false);
      assert.equal(existsSync(out) ? readFileSync(out, 'utf8') : '', '');
    });
  }
});

test('show: a --head that is not a full commit id is refused', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  for (const v of ['-n', '--upload-pack=x', 'main', 'abc', `${base}\n`, 'zz']) {
    await t.test(JSON.stringify(v), () => {
      const r = s.cli(['show', '--base', base, '--head', v]);
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
    });
  }
});

test('show: a well-formed id that is not in the repo is refused or fail-safe, never docs-only', () => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  const out = join(s.root, 'gh-out.txt');
  for (const args of [['show', '--base', 'a'.repeat(40), '--head', base], ['show', '--base', base, '--head', 'b'.repeat(40)]]) {
    const r = s.cli([...args, '--github-output'], { GITHUB_OUTPUT: out });
    assert.ok(failSafe(r), `${r.status} ${r.stdout.slice(0, 200)}`);
  }
  const written = existsSync(out) ? readFileSync(out, 'utf8') : '';
  assert.equal(written.includes('ui_changed=false'), false);
  assert.equal(written.includes('docs_only=true'), false);
});

test('cli: unknown command, missing arguments and unknown options are refused', async t => {
  const s = sandbox();
  const cases = [[], ['frobnicate'], ['show'], ['show', '--base'], ['write'], ['write', SLUG], ['latest'], ['show', '--no-such-flag']];
  for (const args of cases) {
    await t.test(JSON.stringify(args), () => {
      const r = s.cli(args);
      assert.equal(refused(r), true, `${r.status} ${r.stdout} ${r.stderr}`);
    });
  }
});

test('write: bad slug or step is refused and nothing is written', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  s.handoff('05-backend-engineer', base);
  const slugs = ['..', 'x/../y', 'P20261116.000003/../01-feature', '', 'not a slug', `${SLUG}\n`, `${SLUG}/extra`, '/abs/path', 'C:\\x', `-${SLUG}`];
  for (const slug of slugs) {
    await t.test(`slug ${JSON.stringify(slug)}`, () => {
      const r = s.cli(['write', slug, '05-backend-engineer']);
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
      assert.equal(existsSync(s.factsDir()), false);
    });
  }
  const steps = ['5-x', '05-X', '05-', '05', '05-role/../x', '05-a b', '../05-x', '05-x\n', '-05-x', `05-${'a'.repeat(60)}`, '05-backend-engineer.json'];
  for (const step of steps) {
    await t.test(`step ${JSON.stringify(step)}`, () => {
      const r = s.cli(['write', SLUG, step]);
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
      assert.equal(existsSync(s.factsDir()), false);
    });
  }
});

test('write: no Handoff, a hostile or absent base-commit is refused and nothing is written', async t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  await t.test('no Handoff', () => {
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(refused(r), true, r.stdout);
    assert.equal(existsSync(s.factsDir()), false);
  });
  const bad = ['--upload-pack=touch x', 'HEAD', 'main', base.slice(0, 7), 'g'.repeat(40), 'c'.repeat(40), '', 'a'.repeat(41)];
  for (const v of bad) {
    await t.test(`base-commit ${JSON.stringify(v)}`, () => {
      s.handoff('05-backend-engineer', v);
      const r = s.cli(['write', SLUG, '05-backend-engineer']);
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
      assert.equal(existsSync(s.factsDir()) ? readdirSync(s.factsDir()).length : 0, 0);
    });
  }
});

test('write: a facts folder that is a link out of the run is refused', t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  const base = s.commit('base');
  s.handoff('05-backend-engineer', base);
  const outside = join(s.root, 'outside');
  mkdirSync(outside);
  try { symlinkSync(outside, s.factsDir(), 'junction'); } catch { t.skip('links are not available here'); return; }
  const r = s.cli(['write', SLUG, '05-backend-engineer']);
  assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
  assert.deepEqual(readdirSync(outside), []);
});

// ---------------------------------------------------------------- config

test('config: a bad config is ignored with one warning and no path counts as docs', async t => {
  const { badConfigs } = loadGolden('diff-facts').json('cases.json');
  assert.ok(badConfigs.length >= 10);
  const big = [
    { name: 'over 16 KiB', raw: `{"v":1,"not_docs":[]}${' '.repeat(17000)}` },
    { name: 'over 1 MiB', raw: `{"v":1,"not_docs":[]}${' '.repeat(2 * 1024 * 1024)}` },
    { name: '101 globs', raw: JSON.stringify({ v: 1, not_docs: Array.from({ length: 101 }, (_, i) => `zz${i}/**`) }) },
  ];
  for (const c of [...badConfigs, ...big]) {
    await t.test(c.name, () => {
      const s = sandbox();
      s.put('README.md', '# r\n');
      s.put('diff-facts.config.json', c.raw);
      const base = s.commit('base');
      s.put('docs/a.md', 'new\n');
      const head = s.commit('head');
      const r = s.cli(['show', '--base', base, '--head', head]);
      assert.equal(r.status, 0, r.stderr);
      const warnings = r.stderr.split('\n').filter(l => l.startsWith('diff-facts: config ignored: '));
      assert.equal(warnings.length, 1, r.stderr);
      const facts = parse(r);
      assert.equal(facts.ui_changed, true);
      assert.equal(facts.docs_only, false);
      assert.equal(rawControl(r.stderr.replace(/\n/g, '')), false);
    });
  }
});

test('config: a linked config is ignored with one warning', t => {
  const s = sandbox();
  s.put('README.md', '# r\n');
  s.put('real-config.json', '{"v":1,"not_docs":[]}\n');
  const base0 = s.commit('base');
  s.put('docs/a.md', 'new\n');
  const head = s.commit('head');
  try { symlinkSync(join(s.repo, 'real-config.json'), join(s.repo, 'diff-facts.config.json'), 'file'); } catch { t.skip('links are not available here'); return; }
  const r = s.cli(['show', '--base', base0, '--head', head]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.split('\n').filter(l => l.startsWith('diff-facts: config ignored: ')).length, 1, r.stderr);
  assert.equal(parse(r).ui_changed, true);
});

test('config: a valid config narrows docs and a missing one warns about nothing', async t => {
  await t.test('valid not_docs turns a generated docs path into non-docs', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('diff-facts.config.json', '{"v":1,"not_docs":["docs/generated/**"]}\n');
    const base = s.commit('base');
    s.put('docs/generated/api.md', 'x\n');
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.includes('config ignored'), false);
    assert.equal(parse(r).ui_changed, true);
    assert.equal(kindsOf(parse(r))['docs/generated/api.md'], 'code');
  });
  await t.test('valid not_docs leaves other docs paths docs', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('diff-facts.config.json', '{"v":1,"not_docs":["docs/generated/**"]}\n');
    const base = s.commit('base');
    s.put('docs/guide.md', 'x\n');
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(parse(r).ui_changed, false);
    assert.equal(parse(r).docs_only, true);
  });
  await t.test('exactly 100 globs is accepted', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('diff-facts.config.json', JSON.stringify({ v: 1, not_docs: Array.from({ length: 100 }, (_, i) => `zz${i}/**`) }));
    const base = s.commit('base');
    s.put('docs/guide.md', 'x\n');
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.stderr.includes('config ignored'), false, r.stderr);
    assert.equal(parse(r).docs_only, true);
  });
  await t.test('no config file means no warning', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('docs/guide.md', 'x\n');
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.stderr.includes('config'), false, r.stderr);
    assert.equal(parse(r).docs_only, true);
  });
});

// ---------------------------------------------------------------- classify table

test('classify: every case of the shared table', async t => {
  const { classify } = await load();
  const table = loadGolden('diff-facts').json('cases.json').classify;
  assert.ok(table.length >= 30);
  for (const c of table) {
    await t.test(c.name, () => {
      const r = classify(structuredClone(c.entries), c.config === undefined ? null : c.config);
      assert.deepEqual(kindsOf(r), c.kinds);
      for (const f of FLAGS) assert.equal(r[f], c.flags[f], f);
      assert.equal(r.truncated, false);
      assert.deepEqual(r.paths.map(p => p.path), [...r.paths.map(p => p.path)].sort());
      for (const p of r.paths) assert.deepEqual(Object.keys(p).sort(), ['from', 'kind', 'path', 'status']);
    });
  }
});

test('classify: docs-only and tests-only diffs give ui_changed false', async () => {
  const { classify } = await load();
  assert.equal(classify([entry('docs/a.md'), entry('README.md')], null).ui_changed, false);
  assert.equal(classify([entry('tests/a.test.mjs'), entry('src/x.spec.ts')], null).ui_changed, false);
  assert.equal(classify([entry('docs/a.md'), entry('tests/a.test.mjs')], null).ui_changed, false);
});

test('classify: every non-docs, non-test kind turns ui_changed on', async () => {
  const { classify } = await load();
  const one = {
    binary: entry('x.png', { added: null, removed: null }),
    rename: entry('b.mjs', { from: 'a.mjs', status: 'R', added: 0, removed: 0, similarity: 100 }),
    contract: entry('docs/contracts/x.md'),
    locale: entry('a/locales/en.json'),
    style: entry('a.css'),
    ui: entry('a.html'),
    config: entry('package.json'),
    code: entry('a.mjs'),
    unknown: entry('Makefile'),
  };
  for (const [kind, e] of Object.entries(one)) {
    const r = classify([entry('docs/a.md'), e], null);
    assert.equal(r.paths.find(p => p.path === e.path).kind, kind);
    assert.equal(r.ui_changed, true, kind);
  }
});

test('classify: more than 5000 entries is truncated and every flag is fail-safe', async () => {
  const { classify } = await load();
  const many = n => Array.from({ length: n }, (_, i) => entry(`docs/${String(i).padStart(5, '0')}.md`));
  const over = classify(many(5001), null);
  assert.equal(over.truncated, true);
  assert.equal(over.paths.length, 5000);
  for (const f of FLAGS.filter(f => f !== 'docs_only')) assert.equal(over[f], true, f);
  assert.equal(over.ui_changed, true);
  assert.equal(over.contract_changed, true);
  assert.equal(over.docs_only, false);
  const exact = classify(many(5000), null);
  assert.equal(exact.truncated, false);
  assert.equal(exact.paths.length, 5000);
  assert.equal(exact.ui_changed, false);
  assert.equal(exact.docs_only, true);
});

// ---------------------------------------------------------------- show on real commits

test('show: facts of a commit range, written nowhere', async t => {
  await t.test('docs-only range', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('src/a.mjs', 'export const a = 1;\n');
    const base = s.commit('base');
    s.put('docs/new.md', 'x\n');
    s.put('README.md', '# r2\n');
    const head = s.commit('head');
    s.put('src/a.mjs', 'export const a = 2;\n');
    s.put('later.txt', 'x\n');
    const before = s.git(['status', '--porcelain']);
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, r.stderr);
    const facts = parse(r);
    assert.deepEqual(kindsOf(facts), { 'README.md': 'docs', 'docs/new.md': 'docs' });
    assert.equal(facts.ui_changed, false);
    assert.equal(facts.strings_changed, false);
    assert.equal(facts.contract_changed, false);
    assert.equal(facts.docs_only, true);
    assert.equal(facts.truncated, false);
    assert.equal(s.git(['status', '--porcelain']), before);
    assert.equal(existsSync(join(s.repo, '.company')), false);
  });
  await t.test('without --head show refuses, it never picks HEAD itself', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('docs/new.md', 'x\n');
    s.commit('head');
    for (const args of [['show', '--base', base], ['show', '--base', base, '--github-output']]) {
      const out = join(s.root, 'gh-out.txt');
      const r = s.cli(args, { GITHUB_OUTPUT: out });
      assert.equal(refused(r), true, `${args.join(' ')} -> ${r.status} ${r.stdout}`);
      assert.match(r.stdout, /--head is required/);
      assert.equal(existsSync(out), false, 'nothing may be appended to GITHUB_OUTPUT');
    }
  });
  await t.test('an explicit full --head still works', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('docs/new.md', 'x\n');
    const head = s.commit('head');
    const a = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.equal(a.head, head);
    assert.equal(a.ui_changed, false);
  });
  await t.test('working tree and untracked files are not part of show', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('src/a.mjs', 'x\n');
    const base = s.commit('base');
    s.put('docs/new.md', 'x\n');
    const head = s.commit('head');
    s.put('src/a.mjs', 'changed\n');
    s.put('untracked.mjs', 'x\n');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(Object.keys(kindsOf(facts)), ['docs/new.md']);
  });
  await t.test('empty range gives ui_changed true', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    const facts = parse(s.cli(['show', '--base', base, '--head', base]));
    assert.deepEqual(facts.paths, []);
    assert.equal(facts.ui_changed, true);
    assert.equal(facts.docs_only, false);
  });
  await t.test('css-only range', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('src/app.css', 'a { color: red; }\n');
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'src/app.css': 'style' });
    assert.equal(facts.ui_changed, true);
    assert.equal(facts.strings_changed, false);
  });
  await t.test('binary file', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 0, 2, 0xff, 0]));
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'assets/logo.png': 'binary' });
    assert.equal(facts.contract_changed, true);
    assert.equal(facts.ui_changed, true);
  });
  await t.test('NUL file under docs with a diff attribute is binary', () => {
    const s = sandbox();
    s.put('.gitattributes', 'docs/* diff\n');
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('docs/blob.md', Buffer.from([0x61, 0, 0x62, 0x0a]));
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'docs/blob.md': 'binary' });
    assert.equal(facts.contract_changed, true);
    assert.equal(facts.docs_only, false);
  });
  await t.test('text file marked -diff is classified by path', () => {
    const s = sandbox();
    s.put('.gitattributes', 'docs/* -diff\n');
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('docs/note.md', 'plain text\n');
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'docs/note.md': 'docs' });
    assert.equal(facts.docs_only, true);
    assert.equal(facts.contract_changed, false);
  });
  await t.test('rename only', () => {
    const s = sandbox();
    s.put('src/old.mjs', Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};\n`).join(''));
    const base = s.commit('base');
    s.git(['mv', 'src/old.mjs', 'src/new.mjs']);
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'src/new.mjs': 'rename' });
    assert.equal(facts.paths[0].from, 'src/old.mjs');
    assert.equal(facts.paths[0].status, 'R');
    assert.equal(facts.ui_changed, true);
  });
  await t.test('deleted contract', () => {
    const s = sandbox();
    s.put('docs/contracts/x.md', '# Contract: x v1.0\n');
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.git(['rm', '-q', 'docs/contracts/x.md']);
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), { 'docs/contracts/x.md': 'contract' });
    assert.equal(facts.paths[0].status, 'D');
    assert.equal(facts.contract_changed, true);
  });
  await t.test('locale, theme token, config and unknown files', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('src/locales/en.json', '{}\n');
    s.put('src/theme/colors.json', '{}\n');
    s.put('.github/workflows/ci.yml', 'a: 1\n');
    s.put('data/blob.xyz', 'x\n');
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.deepEqual(kindsOf(facts), {
      'src/locales/en.json': 'locale', 'src/theme/colors.json': 'style', '.github/workflows/ci.yml': 'config', 'data/blob.xyz': 'unknown',
    });
    assert.equal(facts.ui_changed, true);
    assert.equal(facts.contract_changed, true);
  });
  await t.test('tests-only range is ui false and not docs_only', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('tests/a.test.mjs', 'x\n');
    const head = s.commit('head');
    const facts = parse(s.cli(['show', '--base', base, '--head', head]));
    assert.equal(facts.ui_changed, false);
    assert.equal(facts.docs_only, false);
  });
  await t.test('output is bounded for a big range', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    const blob = s.git(['hash-object', '-w', '--stdin'], 'x\n').trim();
    const lines = Array.from({ length: 5100 }, (_, i) => `100644 ${blob} 0\tdocs/f${String(i).padStart(5, '0')}.md\n`).join('');
    execFileSync('git', ['update-index', '--index-info'], { cwd: s.repo, env: s.env, input: lines });
    const tree = s.git(['write-tree']).trim();
    const head = s.git(['commit-tree', tree, '-p', base, '-m', 'many']).trim();
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, r.stderr);
    const facts = parse(r);
    assert.equal(facts.truncated, true);
    assert.equal(facts.paths.length, 5000);
    assert.equal(facts.ui_changed, true);
    assert.equal(facts.docs_only, false);
    assert.ok(r.stdout.length < 1024 * 1024);
  });
});

test('show --github-output: appends docs_only and ui_changed and nothing else', async t => {
  const run = (build, extra) => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    build(s);
    const head = s.commit('head');
    const out = join(s.root, 'gh-out.txt');
    writeFileSync(out, 'prior=1\n');
    const r = s.cli(['show', '--base', base, '--head', head, ...extra], { GITHUB_OUTPUT: out });
    return { r, out: readFileSync(out, 'utf8'), s };
  };
  await t.test('docs-only', () => {
    const { r, out } = run(s => s.put('docs/a.md', 'x\n'), ['--github-output']);
    assert.equal(r.status, 0, r.stderr);
    const lines = out.split('\n');
    assert.equal(lines[0], 'prior=1');
    assert.deepEqual(lines.slice(1).sort(), ['', 'docs_only=true', 'ui_changed=false']);
    assert.equal(out.includes('\r'), false);
    assert.equal(parse(r).ui_changed, false);
  });
  await t.test('code change', () => {
    const { out } = run(s => s.put('src/a.mjs', 'x\n'), ['--github-output']);
    assert.deepEqual(out.split('\n').slice(1).sort(), ['', 'docs_only=false', 'ui_changed=true']);
  });
  await t.test('tests-only', () => {
    const { out } = run(s => s.put('tests/a.test.mjs', 'x\n'), ['--github-output']);
    assert.deepEqual(out.split('\n').slice(1).sort(), ['', 'docs_only=false', 'ui_changed=false']);
  });
  await t.test('without the flag the file is untouched', () => {
    const { r, out } = run(s => s.put('docs/a.md', 'x\n'), []);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parse(r).docs_only, true);
    assert.equal(out, 'prior=1\n');
  });
  await t.test('a hostile path never appends a false', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    const head = commitPaths(s, base, ['docs/x\ny.md']);
    const out = join(s.root, 'gh-out.txt');
    const r = s.cli(['show', '--base', base, '--head', head, '--github-output'], { GITHUB_OUTPUT: out });
    assert.ok(failSafe(r));
    const text = existsSync(out) ? readFileSync(out, 'utf8') : '';
    assert.equal(text.includes('ui_changed=false'), false);
    assert.equal(text.includes('docs_only=true'), false);
  });
});

// ---------------------------------------------------------------- git.M-SEC4 rename reading (d): the two -z -M calls must agree

const DIVERGENT = fileURLToPath(new URL('../tests/contracts/diff-facts/divergent-git.mjs', import.meta.url));

test('git.M-SEC4 rename reading (d): differing path sets from the two -z -M calls refuse', async t => {
  const range = () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    s.put('src/keep.mjs', 'export const k = 1;\n');
    const base = s.commit('base');
    s.put('docs/a.md', 'a\n');
    s.put('src/ui.tsx', 'export const u = 1;\n');
    const head = s.commit('head');
    return { s, base, head };
  };
  const run = (s, base, head, mode, path) => {
    const r = spawnSync(process.execPath, [DIVERGENT, 'show', '--base', base, '--head', head], {
      cwd: s.repo, env: { ...s.env, DF_MODE: mode, DF_PATH: path }, encoding: 'utf8', timeout: 30000,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  await t.test('control: the runner is transparent when both calls agree', () => {
    const { s, base, head } = range();
    const r = run(s, base, head, 'none', '');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(Object.keys(kindsOf(parse(r))).sort(), ['docs/a.md', 'src/ui.tsx']);
  });
  await t.test('a path only the status call lists (numstat dropped it) is refused, not read as binary', () => {
    const { s, base, head } = range();
    const r = run(s, base, head, 'numstat-drop', 'src/ui.tsx');
    assert.ok(refused(r), `expected refusal, got ${r.status}: ${r.stdout}`);
  });
  await t.test('a path only the numstat call lists is refused, not dropped', () => {
    const { s, base, head } = range();
    const r = run(s, base, head, 'numstat-extra', 'src/extra.tsx');
    assert.ok(refused(r), `expected refusal, got ${r.status}: ${r.stdout}`);
  });
  await t.test('a path the status call lost is refused, not dropped from the facts', () => {
    const { s, base, head } = range();
    const r = run(s, base, head, 'status-drop', 'src/ui.tsx');
    assert.ok(refused(r), `expected refusal, got ${r.status}: ${r.stdout}`);
  });
});

// ---------------------------------------------------------------- write and latest

// `write` only judges on the run branch: refs/heads/aico/<branchId(slug)>.
const RUN_BRANCH = `aico/${branchId(SLUG)}`;

function writeRepo() {
  const s = sandbox();
  s.put('README.md', '# r\n');
  s.put('src/app.mjs', 'export const a = 1;\n');
  s.put('.gitignore', 'ignored.log\n');
  const base = s.commit('base');
  s.git(['checkout', '-q', '-b', RUN_BRANCH]);
  return { s, base };
}

test('write: facts of base to working tree plus untracked files, created once', async t => {
  await t.test('writes the facts file and prints its path', () => {
    const { s, base } = writeRepo();
    s.put('src/app.mjs', 'export const a = 2;\n');
    s.put('docs/new.md', 'x\n');
    s.put('ignored.log', 'noise\n');
    s.handoff('05-backend-engineer', base);
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const printed = r.stdout.trim().replaceAll('\\', '/');
    assert.ok(printed.endsWith(`${RUN_REL}/facts/05-backend-engineer.json`), printed);
    const file = resolve(s.repo, printed);
    assert.equal(file, resolve(s.factsDir(), '05-backend-engineer.json'));
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('\r'), false);
    assert.ok(text.length < 1024 * 1024);
    const facts = JSON.parse(text);
    assert.deepEqual(Object.keys(facts).sort(), FACT_KEYS);
    assert.equal(facts.v, 1);
    assert.equal(facts.step, '05-backend-engineer');
    assert.equal(facts.base, base);
    assert.equal(facts.head, s.git(['rev-parse', 'HEAD']).trim());
    assert.equal(facts.truncated, false);
    const kinds = kindsOf(facts);
    assert.equal(kinds['src/app.mjs'], 'code');
    assert.equal(kinds['docs/new.md'], 'docs');
    assert.equal(Object.hasOwn(kinds, 'ignored.log'), false);
    const byPath = Object.fromEntries(facts.paths.map(p => [p.path, p]));
    assert.equal(byPath['src/app.mjs'].status, 'M');
    assert.equal(byPath['docs/new.md'].status, 'A');
    assert.equal(byPath['docs/new.md'].from, null);
    assert.deepEqual(facts.paths.map(p => p.path), [...facts.paths.map(p => p.path)].sort());
    assert.equal(facts.ui_changed, true);
    assert.equal(facts.docs_only, false);
  });
  await t.test('a second write is refused and the file is unchanged', () => {
    const { s, base } = writeRepo();
    s.put('docs/new.md', 'x\n');
    s.handoff('05-backend-engineer', base);
    const first = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(first.status, 0, first.stdout);
    const file = join(s.factsDir(), '05-backend-engineer.json');
    const before = readFileSync(file);
    s.put('src/app.mjs', 'export const a = 3;\n');
    const second = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(refused(second), true, `${second.status} ${second.stdout}`);
    assert.deepEqual(readFileSync(file), before);
  });
  await t.test('docs-only change gives ui_changed false and docs_only true', () => {
    const { s, base } = writeRepo();
    s.put('README.md', '# changed\n');
    s.put('docs/new.md', 'x\n');
    s.handoff('05-backend-engineer', base);
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const facts = JSON.parse(readFileSync(join(s.factsDir(), '05-backend-engineer.json'), 'utf8'));
    assert.equal(facts.ui_changed, false);
    assert.equal(facts.strings_changed, false);
    assert.equal(facts.contract_changed, false);
    assert.equal(facts.docs_only, true);
  });
  await t.test('tests-only change gives ui_changed false and docs_only false', () => {
    const { s, base } = writeRepo();
    s.put('tests/a.test.mjs', 'x\n');
    s.handoff('05-backend-engineer', base);
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const facts = JSON.parse(readFileSync(join(s.factsDir(), '05-backend-engineer.json'), 'utf8'));
    assert.equal(facts.ui_changed, false);
    assert.equal(facts.docs_only, false);
  });
  await t.test('a staged and deleted file is part of the change', () => {
    const { s, base } = writeRepo();
    s.git(['rm', '-q', 'src/app.mjs']);
    s.handoff('05-backend-engineer', base);
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const facts = JSON.parse(readFileSync(join(s.factsDir(), '05-backend-engineer.json'), 'utf8'));
    assert.equal(facts.paths.find(p => p.path === 'src/app.mjs').status, 'D');
    assert.equal(facts.ui_changed, true);
  });
});

test('latest: newest facts file of the run, or none', async t => {
  await t.test('none before any write', () => {
    const { s } = writeRepo();
    const r = s.cli(['latest', SLUG]);
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.stdout.trim(), 'none');
  });
  await t.test('highest NN wins', () => {
    const { s, base } = writeRepo();
    s.put('docs/new.md', 'x\n');
    s.handoff('05-backend-engineer', base);
    s.handoff('07-qa', base);
    assert.equal(s.cli(['write', SLUG, '05-backend-engineer']).status, 0);
    assert.equal(s.cli(['write', SLUG, '07-qa']).status, 0);
    const r = s.cli(['latest', SLUG]);
    assert.equal(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes('07-qa'), r.stdout);
    assert.equal(r.stdout.includes('05-backend-engineer'), false);
  });
  await t.test('a bad slug is refused', () => {
    const { s } = writeRepo();
    for (const slug of ['..', 'x/../y', '', `${SLUG}\n`, '-x']) {
      assert.equal(refused(s.cli(['latest', slug])), true, JSON.stringify(slug));
    }
  });
});

// ---------------------------------------------------------------- readLatest

function factsObject(over = {}) {
  return {
    v: 1, step: '05-backend-engineer', base: 'a'.repeat(40), head: 'b'.repeat(40),
    paths: [{ path: 'docs/a.md', from: null, status: 'A', kind: 'docs' }],
    truncated: false, ui_changed: false, strings_changed: false, contract_changed: false, docs_only: true,
    ...over,
  };
}

function runDirWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'dfacts-rl-'));
  roots.push(root);
  mkdirSync(join(root, 'facts'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'facts', name), content);
  return root;
}

test('readLatest: newest valid facts object, otherwise null', async t => {
  const { readLatest } = await load();
  await t.test('returns the object of the highest NN', () => {
    const dir = runDirWith({
      '03-architect.json': JSON.stringify(factsObject({ step: '03-architect' })),
      '07-qa.json': JSON.stringify(factsObject({ step: '07-qa', docs_only: false, ui_changed: true })),
    });
    const r = readLatest(dir);
    assert.equal(r.step, '07-qa');
    assert.equal(r.ui_changed, true);
  });
  await t.test('three-digit step numbers sort after two-digit ones', () => {
    const dir = runDirWith({
      '99-a.json': JSON.stringify(factsObject({ step: '99-a' })),
      '100-b.json': JSON.stringify(factsObject({ step: '100-b' })),
    });
    assert.equal(readLatest(dir).step, '100-b');
  });
  await t.test('no facts folder is null', () => {
    const root = mkdtempSync(join(tmpdir(), 'dfacts-rl-'));
    roots.push(root);
    assert.equal(readLatest(root), null);
  });
  await t.test('empty facts folder is null', () => {
    assert.equal(readLatest(runDirWith({})), null);
  });
  await t.test('a missing run folder is null', () => {
    assert.equal(readLatest(join(tmpdir(), 'dfacts-does-not-exist-xyz')), null);
  });
  const badNewest = {
    'invalid JSON': '{ nope',
    'a JSON array': '[]',
    'null': 'null',
    'v other than 1': JSON.stringify(factsObject({ v: 2 })),
    'v as a string': JSON.stringify(factsObject({ v: '1' })),
    'missing key': JSON.stringify((({ docs_only, ...rest }) => rest)(factsObject())),
    'extra key': JSON.stringify(factsObject({ extra: 1 })),
    'flag not a boolean': JSON.stringify(factsObject({ ui_changed: 'false' })),
    'paths not an array': JSON.stringify(factsObject({ paths: 'x' })),
    'over 1 MiB': JSON.stringify(factsObject({ pad: 'x'.repeat(1024 * 1024 + 10) })),
    'empty file': '',
  };
  for (const [name, content] of Object.entries(badNewest)) {
    await t.test(`a bad newest file is null: ${name}`, () => {
      const dir = runDirWith({
        '03-architect.json': JSON.stringify(factsObject({ step: '03-architect' })),
        '07-qa.json': content,
      });
      assert.equal(readLatest(dir), null);
    });
  }
  await t.test('a facts folder that is a link is null', t2 => {
    const real = runDirWith({ '07-qa.json': JSON.stringify(factsObject({ step: '07-qa' })) });
    const root = mkdtempSync(join(tmpdir(), 'dfacts-rl-'));
    roots.push(root);
    try { symlinkSync(join(real, 'facts'), join(root, 'facts'), 'junction'); } catch { t2.skip('links are not available here'); return; }
    assert.equal(readLatest(root), null);
  });
  await t.test('keys named like prototype members are plain data', () => {
    const dir = runDirWith({ '07-qa.json': '{"v":1,"__proto__":{"ui_changed":false}}' });
    assert.equal(readLatest(dir), null);
    assert.equal(({}).ui_changed, undefined);
  });
});

test('fixtures: version.txt matches the Contract header', () => {
  const g = loadGolden('diff-facts');
  assert.equal(g.version, '1.0');
});

// ---------------------------------------------------------------- write branch, git environment, blob probe and write path sets

const ENV_PROBE = fileURLToPath(new URL('../tests/contracts/diff-facts/env-probe-git.mjs', import.meta.url));
const MIB = 1024 * 1024;

function runScript(s, script, args, extra = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: s.repo, env: { ...s.env, ...extra }, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function factsOf(s, step = '05-backend-engineer') {
  return JSON.parse(readFileSync(join(s.factsDir(), `${step}.json`), 'utf8'));
}

test('write judges only on refs/heads/aico/<branchId(slug)>', async t => {
  assert.equal(RUN_BRANCH, 'aico/P20261116.000003');
  const attempt = (s, base) => {
    s.put('docs/new.md', 'x\n');
    s.handoff('05-backend-engineer', base);
    return s.cli(['write', SLUG, '05-backend-engineer']);
  };
  for (const other of ['feature/x', 'aico/P20261116.000004', `${RUN_BRANCH}x`, 'aico/other', 'main2']) {
    await t.test(`branch ${other} is refused`, () => {
      const { s, base } = writeRepo();
      s.git(['checkout', '-q', '-b', other]);
      const r = attempt(s, base);
      assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
      assert.match(r.stdout, /not on the run branch/);
      assert.equal(existsSync(s.factsDir()), false);
    });
  }
  await t.test('the default branch is refused', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    const r = attempt(s, base);
    assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
    assert.match(r.stdout, /not on the run branch/);
    assert.equal(existsSync(s.factsDir()), false);
  });
  await t.test('a detached HEAD is refused', () => {
    const { s, base } = writeRepo();
    s.git(['checkout', '-q', '--detach']);
    const r = attempt(s, base);
    assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
    assert.equal(existsSync(s.factsDir()), false);
  });
  await t.test('control: on the run branch the same call succeeds', () => {
    const { s, base } = writeRepo();
    const r = attempt(s, base);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
  });
});

test('every git child runs with GIT_NO_LAZY_FETCH=1 and no other caller GIT_ variable', async t => {
  const calls = (s, args, extra) => {
    const log = join(s.root, 'env.log');
    const r = runScript(s, ENV_PROBE, args, { DF_LOG: log, ...extra });
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    return readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  };
  const hostileEnv = { GIT_NO_LAZY_FETCH: '0', GIT_EXTERNAL_DIFF: 'evil', GIT_SSH_COMMAND: 'evil' };
  const check = list => {
    assert.ok(list.length >= 3, 'git was called');
    assert.ok(list.some(c => c.sub === 'cat-file'), 'the blob probe ran');
    for (const c of list) {
      assert.equal(c.env.GIT_NO_LAZY_FETCH, '1', `${c.sub}: ${JSON.stringify(c.env)}`);
      for (const k of ['GIT_EXTERNAL_DIFF', 'GIT_SSH_COMMAND']) assert.equal(Object.hasOwn(c.env, k), false, `${c.sub} leaks ${k}`);
    }
  };
  await t.test('show', () => {
    const s = sandbox();
    s.put('src/a.mjs', 'a\n');
    const base = s.commit('base');
    s.put('src/a.mjs', 'b\n');
    const head = s.commit('head');
    check(calls(s, ['show', '--base', base, '--head', head], hostileEnv));
  });
  await t.test('write', () => {
    const { s, base } = writeRepo();
    s.put('src/app.mjs', 'export const a = 2;\n');
    s.handoff('05-backend-engineer', base);
    check(calls(s, ['write', SLUG, '05-backend-engineer'], hostileEnv));
  });
  await t.test('also when the caller sets nothing', () => {
    const s = sandbox();
    s.put('src/a.mjs', 'a\n');
    const base = s.commit('base');
    s.put('src/a.mjs', 'b\n');
    const head = s.commit('head');
    check(calls(s, ['show', '--base', base, '--head', head], {}));
  });
});

test('the blob probe reads a bounded prefix, so big blobs are not refused for size', async t => {
  const line = `${'x'.repeat(79)}\n`;
  const big = (n, extra = '') => `${extra}${line.repeat(n * MIB / 80)}`;
  await t.test('a text blob of 20 MiB on both sides (over 32 MiB together) gives facts, not "git failed"', () => {
    const s = sandbox();
    s.put('src/big.mjs', big(20));
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('src/big.mjs', `${big(20)}tail\n`);
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, `${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
    const facts = parse(r);
    assert.equal(kindsOf(facts)['src/big.mjs'], 'code');
    assert.equal(facts.truncated, false);
  });
  await t.test('a big blob with a NUL in its first 8000 bytes is still binary', () => {
    const s = sandbox();
    s.put('assets/big.dat', big(20, '\0'));
    s.put('README.md', '# r\n');
    const base = s.commit('base');
    s.put('assets/big.dat', `${big(20, '\0')}tail\n`);
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, `${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
    assert.equal(kindsOf(parse(r))['assets/big.dat'], 'binary');
  });
  await t.test('many mid-size blobs adding up over 32 MiB are not refused either', () => {
    const s = sandbox();
    s.put('README.md', '# r\n');
    const names = Array.from({ length: 8 }, (_, i) => `src/m${i}.mjs`);
    for (const n of names) s.put(n, big(5));
    const base = s.commit('base');
    for (const n of names) s.put(n, `${big(5)}tail\n`);
    const head = s.commit('head');
    const r = s.cli(['show', '--base', base, '--head', head]);
    assert.equal(r.status, 0, `${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
    assert.equal(Object.keys(kindsOf(parse(r))).length, 8);
  });
  await t.test('write: a changed 40 MiB worktree file is not refused (guard: the worktree probe is bounded too)', () => {
    const { s, base } = writeRepo();
    s.put('src/app.mjs', big(40));
    s.handoff('05-backend-engineer', base);
    const r = s.cli(['write', SLUG, '05-backend-engineer']);
    assert.equal(r.status, 0, `${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
    assert.ok(Object.hasOwn(kindsOf(factsOf(s)), 'src/app.mjs'));
  });
});

test('write path sets and attributes', async t => {
  const stepArgs = ['write', SLUG, '05-backend-engineer'];
  await t.test('path set: the two -z -M calls must agree in write too', async t2 => {
    const prep = () => {
      const { s, base } = writeRepo();
      s.put('src/ui.tsx', 'export const u = 1;\n');
      s.put('src/app.mjs', 'export const a = 2;\n');
      s.git(['add', 'src/ui.tsx']);
      s.handoff('05-backend-engineer', base);
      return s;
    };
    const run = (s, mode, path) => runScript(s, DIVERGENT, stepArgs, { DF_MODE: mode, DF_PATH: path });
    await t2.test('control: transparent when both calls agree', () => {
      const s = prep();
      const r = run(s, 'none', '');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(Object.hasOwn(kindsOf(factsOf(s)), 'src/ui.tsx'));
    });
    for (const [mode, path] of [['numstat-drop', 'src/ui.tsx'], ['numstat-extra', 'src/extra.tsx'], ['status-drop', 'src/ui.tsx']]) {
      await t2.test(`${mode} is refused and nothing is written`, () => {
        const s = prep();
        const r = run(s, mode, path);
        assert.equal(refused(r), true, `${r.status} ${r.stdout}`);
        assert.equal(existsSync(join(s.factsDir(), '05-backend-engineer.json')), false);
      });
    }
  });
  await t.test('a staged rename is R with its from path', () => {
    const { s, base } = writeRepo();
    s.git(['mv', 'src/app.mjs', 'src/moved.mjs']);
    s.handoff('05-backend-engineer', base);
    const r = s.cli(stepArgs);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const e = factsOf(s).paths.find(p => p.path === 'src/moved.mjs');
    assert.equal(e.status, 'R');
    assert.equal(e.from, 'src/app.mjs');
  });
  await t.test('a tracked file that gains a NUL, and an untracked file with a NUL, are binary', () => {
    const { s, base } = writeRepo();
    s.put('src/app.mjs', 'a\0b\n');
    s.put('assets/new.dat', 'a\0b\n');
    s.handoff('05-backend-engineer', base);
    const r = s.cli(stepArgs);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const k = kindsOf(factsOf(s));
    assert.equal(k['src/app.mjs'], 'binary');
    assert.equal(k['assets/new.dat'], 'binary');
  });
  const attrCase = (name, attrs, body = 'export const a = 2;\n', want = 'code') => t.test(`attributes: ${name}`, () => {
    const { s, base } = writeRepo();
    s.put('.gitattributes', attrs);
    s.put('src/app.mjs', body);
    s.handoff('05-backend-engineer', base);
    const r = s.cli(stepArgs);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const facts = factsOf(s);
    assert.equal(kindsOf(facts)['src/app.mjs'], want);
    assert.equal(facts.paths.find(p => p.path === 'src/app.mjs').status, 'M');
    assert.equal(facts.ui_changed, true);
  });
  await attrCase('-diff on a text file does not hide it', '*.mjs -diff\n');
  await attrCase('binary on a text file does not hide it', '* binary\n');
  await attrCase('eol=crlf and text', '*.mjs text eol=crlf\n');
  await attrCase('-text', '*.mjs -text\n');
  await attrCase('diff forced on a file with a NUL is still binary', '*.mjs diff\n', 'a\0b\n', 'binary');
  const hook = (key, attr, cfg) => t.test(`attributes: a configured ${key} command is never run`, () => {
    const { s, base } = writeRepo();
    const marker = join(s.root, `${key}.ran`).replaceAll('\\', '/');
    const script = join(s.root, 'mark.mjs').replaceAll('\\', '/');
    writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);\n`);
    s.git(['config', cfg, `node "${script}"`]);
    s.put('.gitattributes', `*.mjs ${attr}\n`);
    s.put('src/app.mjs', 'export const a = 2;\n');
    s.handoff('05-backend-engineer', base);
    const r = s.cli(stepArgs);
    assert.equal(existsSync(marker), false, `${key} ran during write`);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.equal(kindsOf(factsOf(s))['src/app.mjs'], 'code');
  });
  await hook('textconv', 'diff=evil', 'diff.evil.textconv');
  await hook('clean', 'filter=evil', 'filter.evil.clean');
  await hook('external-diff', 'diff=evil', 'diff.external');
});
