import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, readParallel } from './plan-tasks.mjs';

// QA-first segment: scope outcomes (in, qa-owned, sibling, extra), the `qa` key on `out`,
// the summary suffix, `done` refusal, the Fix round dependency, `red`, and v1.6 bytes without the flag.
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const ROLES = ['backend-engineer', 'qa'];
const SLUG = 'demo';
const NAME = '02-plan.md';

let home;
let envBackup;
const roots = [];

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-qa-home-'));
  envBackup = { ...process.env };
  process.env.MCSPARROW_HOME = path.join(home, 'mcs');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

after(() => {
  for (const key of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  fs.rmSync(home, { recursive: true, force: true });
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function block(id, { role = 'backend-engineer', files, deps = 'none', seams }) {
  const lines = [`### ${id} title of ${id}`, `- role: ${role}`, `- files: ${files}`, `- depends-on: ${deps}`, '- parallel: yes'];
  if (seams) lines.push(`- seams: ${seams}`);
  return `${lines.join('\n')}\n`;
}

// T1 and T4 are QA tasks; T2, T3 and T5 are build tasks covered by them.
const PLAN = `${[
  '# Plan', '', '## Tasks', '',
  block('T1', { role: 'qa', files: 'scripts/a.test.mjs, scripts/b.test.mjs', seams: 'none — tests only' }),
  block('T2', { files: 'scripts/a.mjs', deps: 'T1', seams: 'scripts/a.mjs#main' }),
  block('T3', { files: 'scripts/c.mjs', deps: 'T1', seams: 'scripts/c.mjs#main' }),
  block('T4', { role: 'qa', files: 'tests/qa-dir/', seams: 'none — tests only' }),
  block('T5', { files: 'scripts/e.mjs', deps: 'T4', seams: 'scripts/e.mjs#main' })
].join('\n')}\n`;

function fixture(text = PLAN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-qa-'));
  roots.push(root);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.28.0' }));
  for (const a of ROLES) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const product = path.join(root, 'product');
  const dir = path.join(product, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, NAME), text);
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(homeDir);
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, home: homeDir });
  const record = path.join(dir, 'parallel.jsonl');
  const events = () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { root: product, dir, plan: path.join(dir, NAME), run, record, events };
}

function begin(fx, qa = true) {
  const args = ['begin', SLUG, NAME, '--cap', '5', '--mode', 'parallel'];
  if (qa) args.push('--qa-first');
  const r = fx.run(...args);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(r.lines.at(-1), 'begun');
}

function step(fx, cmd, id) {
  const r = fx.run(cmd, SLUG, id);
  assert.equal(r.code, 0, `${cmd} ${id}: ${r.lines.join('\n')}`);
}

// Round 0 with the QA tasks done and T2 and T3 running.
function running(qa = true) {
  const fx = fixture();
  begin(fx, qa);
  for (const id of ['T1', 'T4']) {
    step(fx, 'start', id);
    step(fx, 'done', id);
  }
  step(fx, 'start', 'T2');
  step(fx, 'start', 'T3');
  return fx;
}

const scope = (fx, id, ...paths) => fx.run('scope', SLUG, id, '--', ...paths);

describe('begin --qa-first and the segment flag', () => {
  test('begin with the flag writes qa true on the begin event and the view reads qa_first', () => {
    const fx = fixture();
    begin(fx);
    assert.equal(fx.events()[0].qa, true);
    assert.equal(readParallel(fx.root, SLUG).qa_first, true);
  });

  test('begin without the flag writes no qa key and the view has no qa_first key', () => {
    const fx = fixture();
    begin(fx, false);
    assert.equal('qa' in fx.events()[0], false);
    assert.equal('qa_first' in readParallel(fx.root, SLUG), false);
  });
});

describe('scope in a QA-first segment', () => {
  test('hostile spellings of a QA path: backslash and case-folded spellings are qa-owned', () => {
    const fx = running();
    const r = scope(fx, 'T2', 'scripts\\a.test.mjs', 'Scripts/A.Test.mjs', 'SCRIPTS\\B.TEST.MJS');
    assert.deepEqual(r, {
      code: 0,
      lines: [
        'qa-owned T1 scripts/a.test.mjs', 'qa-owned T1 Scripts/A.Test.mjs', 'qa-owned T1 SCRIPTS/B.TEST.MJS',
        'scope: 0 extra, 0 sibling, 3 qa-owned'
      ]
    });
  });

  test('hostile spellings of a QA path: dot segments, absolute and drive forms are extra ? and never qa-owned', () => {
    const fx = running();
    const r = scope(fx, 'T2', 'scripts/../scripts/a.test.mjs', './scripts/a.test.mjs', '/scripts/a.test.mjs', 'C:/x/a.test.mjs', '\\scripts\\a.test.mjs', 'scripts/a.test.mjs\u202e');
    assert.deepEqual(r.lines, [
      'extra ?', 'extra ?', 'extra ?', 'extra ?', 'extra ?', 'extra ?', 'scope: 6 extra, 0 sibling, 0 qa-owned'
    ]);
    assert.deepEqual(fx.events().at(-1).qa, []);
    assert.equal(fx.run('done', SLUG, 'T2').code, 0);
  });

  test('a path under a QA folder is qa-owned', () => {
    const fx = running();
    step(fx, 'start', 'T5');
    assert.deepEqual(scope(fx, 'T5', 'tests/qa-dir/sub/x.test.mjs', 'tests/qa-dir-other/x.mjs').lines, [
      'qa-owned T4 tests/qa-dir/sub/x.test.mjs', 'extra tests/qa-dir-other/x.mjs', 'scope: 1 extra, 0 sibling, 1 qa-owned'
    ]);
  });

  test('outcomes in order: in, qa-owned, sibling, extra, with the summary suffix', () => {
    const fx = running();
    const r = scope(fx, 'T2', '.company/work/demo/04-x.md', 'scripts/a.mjs', 'scripts/a.test.mjs', 'scripts/c.mjs', 'scripts/zzz.mjs');
    assert.deepEqual(r, {
      code: 0,
      lines: [
        'in .company/work/demo/04-x.md', 'in scripts/a.mjs', 'qa-owned T1 scripts/a.test.mjs',
        'sibling T3 scripts/c.mjs', 'extra scripts/zzz.mjs', 'scope: 1 extra, 1 sibling, 1 qa-owned'
      ]
    });
  });

  test('the out event records the qa-owned keys under qa, next to extra and sibling', () => {
    const fx = running();
    scope(fx, 'T2', 'scripts/a.test.mjs', 'scripts/c.mjs', 'scripts/zzz.mjs');
    const out = fx.events().at(-1);
    assert.equal(out.ev, 'out');
    assert.deepEqual(out.qa, ['scripts/a.test.mjs']);
    assert.deepEqual(out.sibling, ['scripts/c.mjs']);
    assert.deepEqual(out.extra, ['scripts/zzz.mjs']);
  });

  test('a scope with no candidates records an out event with an empty qa list', () => {
    const fx = running();
    const n = fx.events().length;
    assert.deepEqual(scope(fx, 'T2'), { code: 0, lines: ['scope: 0 extra, 0 sibling, 0 qa-owned'] });
    assert.equal(fx.events().length, n + 1);
    assert.deepEqual(fx.events().at(-1).qa, []);
  });

  test('the running QA task owns its own files: they are in, not qa-owned', () => {
    const fx = fixture();
    begin(fx);
    step(fx, 'start', 'T1');
    assert.deepEqual(scope(fx, 'T1', 'scripts/a.test.mjs').lines, ['in scripts/a.test.mjs', 'scope: 0 extra, 0 sibling, 0 qa-owned']);
  });
});

describe('done in a QA-first segment', () => {
  test('refused with qa-owned paths and nothing written while the latest scope lists one', () => {
    const fx = running();
    scope(fx, 'T2', 'scripts/a.test.mjs');
    const before = fs.readFileSync(fx.record, 'utf8');
    assert.deepEqual(fx.run('done', SLUG, 'T2'), { code: 3, lines: ['refused: qa-owned paths'] });
    assert.equal(fs.readFileSync(fx.record, 'utf8'), before);
  });

  test('still refused after a later scope that again lists a qa-owned path', () => {
    const fx = running();
    scope(fx, 'T2', 'scripts/a.test.mjs');
    scope(fx, 'T2', 'scripts/a.mjs', 'scripts/b.test.mjs');
    assert.equal(fx.run('done', SLUG, 'T2').code, 3);
  });

  test('cleared by a later scope with no qa-owned path', () => {
    const fx = running();
    scope(fx, 'T2', 'scripts/a.test.mjs');
    assert.equal(scope(fx, 'T2', 'scripts/a.mjs').code, 0);
    assert.equal(fx.run('done', SLUG, 'T2').code, 0);
    assert.equal(fx.events().at(-1).ev, 'done');
  });

  test('a task with no out event is not refused', () => {
    const fx = running();
    assert.equal(fx.run('done', SLUG, 'T2').code, 0);
  });

  test('a qa-owned scope of one task does not refuse done of another', () => {
    const fx = running();
    scope(fx, 'T2', 'scripts/a.test.mjs');
    assert.equal(fx.run('done', SLUG, 'T3').code, 0);
  });
});

describe('Fix round in a QA-first segment', () => {
  function allDone(qa) {
    const fx = running(qa);
    step(fx, 'done', 'T2');
    step(fx, 'done', 'T3');
    step(fx, 'start', 'T5');
    step(fx, 'done', 'T5');
    return fx;
  }

  test('a build task waits for the QA task of the same round', () => {
    const fx = allDone(true);
    const r = fx.run('round', SLUG, '1', '--', 'scripts/a.test.mjs', 'scripts/a.mjs');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(fx.run('next', SLUG).lines.slice(0, 3), ['next: round 1, running 0 of cap 5', 'start T1 qa', 'wait T2 depends T1']);
  });

  test('the test path goes to the QA task that owns it', () => {
    const fx = allDone(true);
    const r = fx.run('round', SLUG, '1', '--', 'scripts/a.test.mjs');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.match(r.lines[0], /^round 1: T1 \(\+0 paths\)$/);
    assert.equal(fx.run('next', SLUG).lines.some((l) => l.startsWith('wait')), false);
  });

  test('a build task whose QA task is not in the round does not wait', () => {
    const fx = allDone(true);
    fx.run('round', SLUG, '1', '--', 'scripts/a.mjs');
    assert.deepEqual(fx.run('next', SLUG).lines.slice(0, 2), ['next: round 1, running 0 of cap 5', 'start T2 backend-engineer']);
  });

  test('after the QA task is done the build task of the round starts', () => {
    const fx = allDone(true);
    fx.run('round', SLUG, '1', '--', 'scripts/a.test.mjs', 'scripts/a.mjs');
    step(fx, 'start', 'T1');
    step(fx, 'done', 'T1');
    assert.equal(fx.run('next', SLUG).lines[1], 'start T2 backend-engineer');
  });

  test('without the flag dependencies stay ignored inside the round', () => {
    const fx = allDone(false);
    fx.run('round', SLUG, '1', '--', 'scripts/a.test.mjs', 'scripts/a.mjs');
    assert.deepEqual(fx.run('next', SLUG).lines.slice(0, 3), ['next: round 1, running 0 of cap 5', 'start T1 qa', 'start T2 backend-engineer']);
  });
});

describe('red', () => {
  test('outside a QA-first segment prints red: off and exits 0', () => {
    const fx = fixture();
    begin(fx, false);
    assert.deepEqual(fx.run('red', SLUG), { code: 0, lines: ['red: off'] });
  });

  test('a begin without the flag ends the QA-first segment', () => {
    const fx = fixture();
    begin(fx);
    step(fx, 'start', 'T1');
    step(fx, 'done', 'T1');
    begin(fx, false);
    assert.deepEqual(fx.run('red', SLUG).lines, ['red: off']);
  });

  test('no QA task done yet gives no paths', () => {
    const fx = fixture();
    begin(fx);
    assert.deepEqual(fx.run('red', SLUG), { code: 0, lines: ['red: 0 paths'] });
  });

  test('lists the files of a done QA task while a build task that depends on it is pending', () => {
    const fx = fixture();
    begin(fx);
    step(fx, 'start', 'T1');
    step(fx, 'done', 'T1');
    assert.deepEqual(fx.run('red', SLUG), {
      code: 0,
      lines: ['red T1 scripts/a.test.mjs', 'red T1 scripts/b.test.mjs', 'red: 2 paths']
    });
  });

  test('QA tasks in plan order, then files in files order', () => {
    const fx = fixture();
    begin(fx);
    step(fx, 'start', 'T4');
    step(fx, 'done', 'T4');
    step(fx, 'start', 'T1');
    step(fx, 'done', 'T1');
    const lines = fx.run('red', SLUG).lines;
    assert.equal(lines[0], 'red T1 scripts/a.test.mjs');
    assert.equal(lines[1], 'red T1 scripts/b.test.mjs');
    assert.match(lines[2], /^red T4 tests\/qa-dir\/?$/);
    assert.equal(lines.at(-1), 'red: 3 paths');
  });

  test('stays listed while one dependent is pending and drops when every dependent is done', () => {
    const fx = running();
    step(fx, 'done', 'T2');
    assert.equal(fx.run('red', SLUG).lines.at(-1), 'red: 3 paths');
    step(fx, 'done', 'T3');
    assert.deepEqual(fx.run('red', SLUG).lines.filter((l) => l.startsWith('red T1')), []);
    assert.equal(fx.run('red', SLUG).lines.at(-1), 'red: 1 paths');
  });

  test('a plan changed since begin is refused with nothing written', () => {
    const fx = fixture();
    begin(fx);
    fs.appendFileSync(fx.plan, '\nextra line\n');
    const before = fs.readFileSync(fx.record, 'utf8');
    assert.deepEqual(fx.run('red', SLUG), { code: 3, lines: ['refused: plan changed since begin'] });
    assert.equal(fs.readFileSync(fx.record, 'utf8'), before);
  });

  test('is read-only', () => {
    const fx = running();
    const before = fs.readFileSync(fx.record, 'utf8');
    fx.run('red', SLUG);
    assert.equal(fs.readFileSync(fx.record, 'utf8'), before);
  });
});

describe('scope and done without the flag keep the v1.6 bytes', () => {
  test('scope prints no qa-owned line and no suffix, and a QA path is extra', () => {
    const fx = running(false);
    const r = scope(fx, 'T2', '.company/work/demo/04-x.md', 'scripts/a.mjs', 'scripts/c.mjs', 'scripts/a.test.mjs');
    assert.deepEqual(r, {
      code: 0,
      lines: ['in .company/work/demo/04-x.md', 'in scripts/a.mjs', 'sibling T3 scripts/c.mjs', 'extra scripts/a.test.mjs', 'scope: 1 extra, 1 sibling']
    });
  });

  test('the out event has no qa key', () => {
    const fx = running(false);
    scope(fx, 'T2', 'scripts/a.test.mjs');
    assert.deepEqual(Object.keys(fx.events().at(-1)).sort(), ['at', 'ev', 'extra', 'round', 'sibling', 'task', 'v']);
  });

  test('done is not refused after a scope of a QA path', () => {
    const fx = running(false);
    scope(fx, 'T2', 'scripts/a.test.mjs');
    assert.equal(fx.run('done', SLUG, 'T2').code, 0);
  });
});
