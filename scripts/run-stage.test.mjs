import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStage, setStage, main, STAGES, MAX_FILE } from './run-stage.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-stage.mjs');
const SLUG = '2026-11-04 01.19 - Skillset Dashboard Draft';

const CASED = '2026-11-04 01.19 - SkillSet Dashboard Draft';

let tmp;
let n = 0;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-stage-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function repo(slug = SLUG) {
  const root = path.join(tmp, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work', slug), { recursive: true });
  return root;
}
const stageFile = (root, slug = SLUG) => path.join(root, '.company', 'work', slug, 'stage.jsonl');

function run(root, ...args) {
  const out = [];
  const code = main(args, { cwd: root, out: line => out.push(line) });
  return { code, text: out.join('\n') };
}

function cli(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, text: r.stdout };
}

function trySymlink(target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false;
  }
}

describe('hostile input', () => {
  test('bad slug shapes are refused and never echoed', () => {
    const root = repo();
    for (const bad of ['..', '../x', 'a/b', '', 'x\u0000y', '..\\..\\etc', 'C:\\x', 'ab'.repeat(200)]) {
      const r = run(root, 'set', bad, 'build');
      assert.equal(r.code, 2);
      assert.equal(r.text, 'refused: bad slug');
      assert.ok(!r.text.includes('..'));
    }
    assert.equal(fs.existsSync(stageFile(root)), false);
  });

  test('wrong letter case is refused', () => {
    const root = repo();
    const r = run(root, 'set', CASED, 'build');
    assert.equal(r.code, 2);
    assert.equal(r.text, 'refused: wrong letter case');
    assert.equal(fs.existsSync(stageFile(root)), false);
  });

  test('unknown stage is refused, nothing written', () => {
    const root = repo();
    for (const s of ['Build', 'done', '', 'build\n', '__proto__', 'build build']) {
      const r = run(root, 'set', SLUG, s);
      assert.equal(r.code, 2);
      assert.equal(r.text, 'refused: unknown stage');
    }
    assert.equal(fs.existsSync(stageFile(root)), false);
  });

  test('missing run folder is refused', () => {
    const root = repo();
    const r = run(root, 'set', '2026-11-04 02.00 - Other Topic', 'build');
    assert.equal(r.code, 2);
    assert.equal(r.text, 'refused: no run folder');
  });

  test('run folder that is a link is refused', t => {
    const root = repo();
    const outside = path.join(tmp, `out${n++}`);
    fs.mkdirSync(outside);
    const slug = '2026-11-04 02.00 - Other Topic';
    if (!trySymlink(outside, path.join(root, '.company', 'work', slug), 'junction')) return t.skip('no links');
    const r = run(root, 'set', slug, 'build');
    assert.equal(r.text, 'refused: no run folder');
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(readStage(root, slug).state, 'none');
  });

  test('stage file that is a link is refused and its target untouched', t => {
    const root = repo();
    const target = path.join(tmp, `t${n++}.txt`);
    fs.writeFileSync(target, 'keep\n');
    if (!trySymlink(target, stageFile(root), 'file')) return t.skip('no links');
    const r = run(root, 'set', SLUG, 'build');
    assert.equal(r.code, 2);
    assert.equal(r.text, 'refused: stage file unreadable');
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep\n');
    assert.equal(readStage(root, SLUG).state, 'unreadable');
  });

  test('stage file that is a directory is unreadable', () => {
    const root = repo();
    fs.mkdirSync(stageFile(root));
    assert.equal(readStage(root, SLUG).state, 'unreadable');
    assert.equal(run(root, 'set', SLUG, 'build').text, 'refused: stage file unreadable');
  });

  test('file at 200 lines is full; 16 KiB is full', () => {
    const root = repo();
    const line = '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}\n';
    fs.writeFileSync(stageFile(root), line.repeat(200));
    let r = run(root, 'set', SLUG, 'review');
    assert.equal(r.code, 2);
    assert.equal(r.text, 'refused: stage file full');
    assert.equal(fs.readFileSync(stageFile(root), 'utf8'), line.repeat(200));

    const root2 = repo();
    fs.writeFileSync(stageFile(root2), ' '.repeat(16 * 1024 - 10) + '\n');
    r = run(root2, 'set', SLUG, 'review');
    assert.equal(r.text, 'refused: stage file full');
  });
});

describe('set and show', () => {
  test('set build then show --json', () => {
    const root = repo();
    const s = run(root, 'set', SLUG, 'build');
    assert.equal(s.code, 0);
    const raw = fs.readFileSync(stageFile(root), 'utf8');
    assert.match(raw, /^\{"v":1,"at":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z","stage":"build"\}\n$/);
    assert.ok(!raw.includes('\r'));
    const show = JSON.parse(run(root, 'show', SLUG, '--json').text);
    assert.equal(show.v, 1);
    assert.equal(show.slug, SLUG);
    assert.equal(show.stage, 'build');
    assert.match(show.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(show.state, 'recorded');
    assert.deepEqual(show, readStage(root, SLUG));
  });

  test('every stage is accepted and the last line wins', () => {
    const root = repo();
    for (const s of STAGES) assert.equal(run(root, 'set', SLUG, s).code, 0);
    assert.equal(readStage(root, SLUG).stage, 'ship-gate');
    assert.equal(fs.readFileSync(stageFile(root), 'utf8').split('\n').length, STAGES.length + 1);
  });

  test('works as a child process from the repo cwd', () => {
    const root = repo();
    assert.equal(cli(root, 'set', SLUG, 'plan').code, 0);
    const r = cli(root, 'show', SLUG, '--json');
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.text).stage, 'plan');
  });
});

describe('readStage', () => {
  test('missing file is none', () => {
    const root = repo();
    assert.deepEqual(readStage(root, SLUG), { v: 1, slug: SLUG, stage: null, at: null, state: 'none' });
  });

  test('empty file is none', () => {
    const root = repo();
    fs.writeFileSync(stageFile(root), '');
    assert.equal(readStage(root, SLUG).state, 'none');
  });

  test('bad slug prints slug null and none, wrong case too', () => {
    const root = repo();
    assert.deepEqual(readStage(root, '../x'), { v: 1, slug: null, stage: null, at: null, state: 'none' });
    assert.deepEqual(readStage(root, CASED),{ v: 1, slug: null, stage: null, at: null, state: 'none' });
    const out = JSON.parse(run(root, 'show', '../x', '--json').text);
    assert.equal(out.slug, null);
    assert.equal(run(root, 'show', '../x', '--json').code, 0);
  });

  test('missing run folder is none', () => {
    const root = repo();
    assert.equal(readStage(root, '2026-11-04 02.00 - Other Topic').state, 'none');
  });

  test('unreadable last lines', () => {
    const good = '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}';
    const bads = [
      'not json',
      '{"v":2,"at":"2026-11-04T01:19:00Z","stage":"build"}',
      '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build","x":1}',
      '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"nope"}',
      '{"v":1,"at":"yesterday","stage":"build"}',
      '{"v":1,"at":"2026-11-04T01:19:00Z"}',
      '[]',
      'null',
      '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build","__proto__":{}}',
      '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}' + ' '.repeat(100),
    ];
    for (const bad of bads) {
      const root = repo();
      fs.writeFileSync(stageFile(root), `${good}\n${bad}\n`);
      assert.deepEqual(readStage(root, SLUG), { v: 1, slug: SLUG, stage: null, at: null, state: 'unreadable' }, bad);
    }
  });

  test('earlier bad lines are history, not checked', () => {
    const root = repo();
    fs.writeFileSync(stageFile(root), 'junk\n{"v":1,"at":"2026-11-04T01:19:00Z","stage":"review"}\n');
    assert.equal(readStage(root, SLUG).stage, 'review');
  });

  test('oversize file is unreadable', () => {
    const root = repo();
    fs.writeFileSync(stageFile(root), 'x'.repeat(16 * 1024 + 1));
    assert.equal(readStage(root, SLUG).state, 'unreadable');
    const root2 = repo();
    fs.writeFileSync(stageFile(root2), '{}\n'.repeat(201));
    assert.equal(readStage(root2, SLUG).state, 'unreadable');
  });

  test('file link is unreadable', t => {
    const root = repo();
    const target = path.join(tmp, `t${n++}.txt`);
    fs.writeFileSync(target, '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}\n');
    if (!trySymlink(target, stageFile(root), 'file')) return t.skip('no links');
    assert.equal(readStage(root, SLUG).state, 'unreadable');
  });
});

describe('hard-linked stage file', () => {
  const REC = '{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}\n';

  function linked(t) {
    const root = repo();
    const other = path.join(tmp, `h${n++}.txt`);
    fs.writeFileSync(other, REC);
    try {
      fs.linkSync(other, stageFile(root));
    } catch {
      t.skip('no hard links');
      return null;
    }
    return { root, other };
  }

  test('readStage refuses it', t => {
    const l = linked(t);
    if (!l) return;
    assert.equal(readStage(l.root, SLUG).state, 'unreadable');
  });

  test('setStage refuses it and leaves the other name untouched', t => {
    const l = linked(t);
    if (!l) return;
    assert.deepEqual(setStage(l.root, SLUG, 'review'), { reason: 'stage file unreadable' });
    assert.equal(fs.readFileSync(l.other, 'utf8'), REC);
  });
});

describe('usage', () => {
  test('bad usage exits 2 with a usage line', () => {
    const root = repo();
    for (const args of [[], ['nope'], ['set', SLUG], ['show', SLUG]]) {
      const r = run(root, ...args);
      assert.equal(r.code, 2);
      assert.match(r.text, /^usage:/);
    }
  });
});

describe('round 2: bigint identity and bounded reads', () => {
  const NAME2 = '2026-11-04 01.19 - Skillset Dashboard Draft';
  function mk(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-r2-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '.company', 'work', NAME2), { recursive: true });
    return root;
  }
  function patch(t, name, wrap) {
    const orig = fs[name];
    fs[name] = wrap(orig);
    t.after(() => { fs[name] = orig; });
  }

  test('lstat and fstat of the stage file use bigint', (t) => {
    const root = mk(t);
    assert.deepEqual(setStage(root, NAME2, 'build'), { ok: true });
    const seen = [];
    for (const name of ['lstatSync', 'fstatSync']) {
      patch(t, name, (orig) => function (target, opts) {
        if (name === 'fstatSync' || String(target).endsWith('stage.jsonl')) seen.push([name, !!(opts && opts.bigint)]);
        return orig.apply(this, arguments);
      });
    }
    assert.equal(readStage(root, NAME2).state, 'recorded');
    assert.ok(seen.some(([n]) => n === 'lstatSync') && seen.some(([n]) => n === 'fstatSync'));
    assert.ok(seen.every(([, b]) => b), JSON.stringify(seen));
  });

  test('a stage file that grows past the cap after fstat is refused', (t) => {
    const root = mk(t);
    const file = path.join(root, '.company', 'work', NAME2, 'stage.jsonl');
    fs.writeFileSync(file, 'x'.repeat(MAX_FILE * 2));
    patch(t, 'fstatSync', (orig) => function (fd, opts) {
      const st = orig.apply(this, arguments);
      return new Proxy(st, { get: (o, k) => (k === 'size' ? (opts && opts.bigint ? 5n : 5) : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
    });
    assert.equal(readStage(root, NAME2).state, 'unreadable');
  });
});
