import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './idea-flow.mjs';

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const root = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-flow-')); tmps.push(d); return d; };
const run = (cwd, ...argv) => main(argv, cwd);
const letters = (r) => r.out.split('\n').filter((l) => l.startsWith('option ')).map((l) => l.split(' ')[1]);
const ok = (r) => { assert.equal(r.code, 0, r.out); return r; };
const rec = (cwd, slug) => path.join(cwd, '.company', 'work', slug, 'idea-flow.jsonl');

function toRoutes(cwd, slug, kind) {
  ok(run(cwd, 'start', slug, '--kind', kind));
  ok(run(cwd, 'pick', slug, '1'));
  ok(run(cwd, 'done', slug, 'grilling'));
  ok(run(cwd, 'done', slug, 'reprompt'));
}
function toTickets(cwd, slug, kind) {
  toRoutes(cwd, slug, kind);
  ok(run(cwd, 'pick', slug, 'D'));
  ok(run(cwd, 'done', slug, 'to-spec'));
  ok(run(cwd, 'done', slug, 'to-tickets'));
}

test('hostile arguments are refused before anything is written', async (t) => {
  const cwd = root();
  const bad = ['', 'A', '-x', 'a'.repeat(65), 'a/b', 'a\\b', '..', 'a b', 'a\u202eb', 'a\nb', 'x\u0000y', 'Ab'];
  for (const s of bad) {
    await t.test(`slug ${JSON.stringify(s).slice(0, 20)}`, () => {
      const r = run(cwd, 'start', s, '--kind', 'idea');
      assert.equal(r.code, 3);
      assert.ok(s === '' || !r.out.includes(s));
    });
  }
  assert.equal(fs.existsSync(path.join(cwd, '.company')), false);
  assert.equal(run(cwd, 'start', 'ok', '--kind', 'feature').code, 3);
  assert.equal(run(cwd, 'start', 'ok').code, 3);
  assert.equal(run(cwd, 'start', 'ok', '--kind', 'idea', '--x', 'y').code, 3);
  assert.equal(run(cwd, 'nope', 'ok').code, 3);
  assert.equal(run(cwd).code, 3);
  assert.equal(run(cwd, 'state', 'x'.repeat(5000)).code, 3);
  assert.equal(run(cwd, 'state', 'nothere').code, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.company')), false);
});

test('start creates once and refuses a second start', () => {
  const cwd = root();
  ok(run(cwd, 'start', 'one', '--kind', 'idea'));
  assert.equal(run(cwd, 'start', 'one', '--kind', 'bug').code, 1);
  assert.equal(fs.readFileSync(rec(cwd, 'one'), 'utf8').includes('\r'), false);
});

test('follow-up forms offer only allowed routes', async (t) => {
  for (const kind of ['idea', 'bug']) {
    await t.test(kind, () => {
      const cwd = root();
      ok(run(cwd, 'start', 's', '--kind', kind));
      assert.deepEqual(letters(run(cwd, 'options', 's')), ['1', '2', '3']);
      assert.equal(run(cwd, 'pick', 's', 'A').code, 3);
      ok(run(cwd, 'pick', 's', '2'));
      assert.match(run(cwd, 'options', 's').out, /pending grill-me/);
      assert.equal(run(cwd, 'pick', 's', 'A').code, 3);
      assert.equal(run(cwd, 'done', 's', 'grilling').code, 1);
      ok(run(cwd, 'done', 's', 'grill-me'));
      assert.match(run(cwd, 'options', 's').out, /pending reprompt/);
      ok(run(cwd, 'done', 's', 'reprompt'));
      assert.deepEqual(letters(run(cwd, 'options', 's')), ['A', 'B', 'C', 'D', 'E']);
      ok(run(cwd, 'pick', 's', 'A'));
      ok(run(cwd, 'done', 's', 'cooler'));
      assert.deepEqual(letters(run(cwd, 'options', 's')), ['B', 'C', 'D', 'E']);
      assert.equal(run(cwd, 'pick', 's', 'A').code, 3);
      ok(run(cwd, 'pick', 's', 'B'));
      ok(run(cwd, 'done', 's', 'brainstorm'));
      assert.deepEqual(letters(run(cwd, 'options', 's')), ['C', 'D', 'E']);
      assert.equal(run(cwd, 'pick', 's', 'B').code, 3);
      ok(run(cwd, 'pick', 's', 'C'));
      ok(run(cwd, 'done', 's', 'research'));
      assert.match(run(cwd, 'options', 's').out, /pending reprompt/);
      assert.equal(run(cwd, 'pick', 's', 'D').code, 3);
      ok(run(cwd, 'done', 's', 'reprompt'));
      assert.deepEqual(letters(run(cwd, 'options', 's')), ['D', 'E']);
      for (const l of ['A', 'B', 'C', 'F', 'G', 'a', 'DD', '', 'D ', '1']) {
        assert.equal(run(cwd, 'pick', 's', l).code, 3, l);
      }
    });
  }
});

test('A then C skips B and still reprompts after C', () => {
  const cwd = root();
  toRoutes(cwd, 'k', 'idea');
  ok(run(cwd, 'pick', 'k', 'C'));
  ok(run(cwd, 'done', 'k', 'research'));
  ok(run(cwd, 'done', 'k', 'reprompt'));
  assert.deepEqual(letters(run(cwd, 'options', 'k')), ['D', 'E']);
});

test('both kinds offer identical letters at every form', () => {
  const seen = {};
  for (const kind of ['idea', 'bug']) {
    const cwd = root();
    const trace = [];
    const snap = () => trace.push(run(cwd, 'options', 's').out);
    ok(run(cwd, 'start', 's', '--kind', kind)); snap();
    ok(run(cwd, 'pick', 's', '3')); snap();
    ok(run(cwd, 'done', 's', 'grill-with-docs')); snap();
    ok(run(cwd, 'done', 's', 'reprompt')); snap();
    ok(run(cwd, 'pick', 's', 'D')); snap();
    ok(run(cwd, 'done', 's', 'to-spec')); snap();
    ok(run(cwd, 'done', 's', 'to-tickets')); snap();
    seen[kind] = trace;
    const st = run(cwd, 'state', 's').out;
    assert.match(st, new RegExp(`kind: ${kind}\\n`));
    assert.match(st, kind === 'idea' ? /build: feature/ : /build: fix/);
  }
  assert.deepEqual(seen.idea, seen.bug);
});

test('tickets form offers F G E and F builds after triage', () => {
  const cwd = root();
  toTickets(cwd, 't', 'bug');
  assert.deepEqual(letters(run(cwd, 'options', 't')), ['F', 'G', 'E']);
  assert.equal(run(cwd, 'pick', 't', 'D').code, 3);
  ok(run(cwd, 'pick', 't', 'F'));
  assert.equal(run(cwd, 'done', 't', 'triage').code, 3);
  assert.equal(run(cwd, 'done', 't', 'triage', '--size', 'XL', '--tier', 'low').code, 3);
  assert.equal(run(cwd, 'done', 't', 'triage', '--size', 'S', '--tier', 'max').code, 3);
  assert.equal(run(cwd, 'done', 't', 'build').code, 1);
  ok(run(cwd, 'done', 't', 'triage', '--size', 'S', '--tier', 'medium', '--out', '.company/work/t/triage.md'));
  ok(run(cwd, 'done', 't', 'build'));
  assert.match(run(cwd, 'options', 't').out, /ended/);
  assert.equal(run(cwd, 'pick', 't', 'F').code, 3);
  assert.equal(run(cwd, 'done', 't', 'build').code, 1);
  assert.match(run(cwd, 'read', 't').out, /triage/);
});

test('G ends the flow with nothing built', () => {
  const cwd = root();
  toTickets(cwd, 'g', 'idea');
  ok(run(cwd, 'pick', 'g', 'G'));
  assert.match(run(cwd, 'state', 'g').out, /form: ended/);
});

test('size, tier and out are refused outside their use', () => {
  const cwd = root();
  toRoutes(cwd, 'u', 'idea');
  ok(run(cwd, 'pick', 'u', 'A'));
  assert.equal(run(cwd, 'done', 'u', 'cooler', '--size', 'S').code, 3);
  assert.equal(run(cwd, 'done', 'u', 'cooler', '--size', 'S', '--tier', 'low').code, 3);
  assert.equal(run(cwd, 'done', 'u', 'bogus').code, 3);
  for (const o of ['/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'C:\\x', 'a'.repeat(201), 'a\u202eb', '', 'a|b', 'a/']) {
    assert.equal(run(cwd, 'done', 'u', 'cooler', '--out', o).code, 3, JSON.stringify(o));
  }
  ok(run(cwd, 'done', 'u', 'cooler', '--out', '.company/work/u/cooler.md'));
});

test('E parks the idea and only then', () => {
  const cwd = root();
  toRoutes(cwd, 'p', 'idea');
  assert.equal(run(cwd, 'park-idea', 'p', 'my-idea').code, 1);
  ok(run(cwd, 'pick', 'p', 'E'));
  const work = path.join(cwd, '.company', 'work', 'p');
  fs.writeFileSync(path.join(work, 'grill.md'), 'hello\n');
  fs.mkdirSync(path.join(work, 'sub'));
  fs.writeFileSync(path.join(work, 'sub', 'a.md'), 'a\n');
  assert.equal(run(cwd, 'done', 'p', 'to-spec').code, 1);
  const r = ok(run(cwd, 'park-idea', 'p', 'my-idea'));
  assert.match(r.out, /parked my-idea/);
  const dest = path.join(cwd, '.company', 'ideas', 'my-idea');
  assert.equal(fs.readFileSync(path.join(dest, 'grill.md'), 'utf8'), 'hello\n');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'a.md'), 'utf8'), 'a\n');
  assert.ok(fs.existsSync(path.join(work, 'grill.md')), 'work folder stays');
  assert.match(run(cwd, 'state', 'p').out, /form: ended/);
  assert.equal(run(cwd, 'park-idea', 'p', 'other-name').code, 1);
});

test('park names are an allow-list', async (t) => {
  const refused = ['ab', 'A-idea', '-abc', 'abc_def', 'abc.def', 'abc def', 'a'.repeat(65), '../abc', 'abc/def', 'abc\\def',
    'con', 'nul', 'aux', 'prn', 'com1', 'lpt9', 'CON', 'con-2', 'com1-x', 'abc\u202e', 'abc\u0000', 'abc\n', 'é-idea', 'ａｂｃ', 'abc:', ''];
  for (const n of refused) {
    await t.test(`refuse ${JSON.stringify(n).slice(0, 24)}`, () => {
      const cwd = root();
      toRoutes(cwd, 'n', 'idea');
      ok(run(cwd, 'pick', 'n', 'E'));
      const r = run(cwd, 'park-idea', 'n', n);
      assert.ok(r.code === 1 || r.code === 3, String(r.code));
      assert.equal(fs.existsSync(path.join(cwd, '.company', 'ideas')), false);
      assert.match(run(cwd, 'state', 'n').out, /pending park-idea/);
      assert.ok(n.length < 4 || !r.out.includes(n));
    });
  }
  for (const n of ['abc', 'a-1', 'consol', 'communication', 'x'.repeat(64)]) {
    await t.test(`accept ${n.slice(0, 12)}`, () => {
      const cwd = root();
      toRoutes(cwd, 'n', 'idea');
      ok(run(cwd, 'pick', 'n', 'E'));
      assert.equal(ok(run(cwd, 'park-idea', 'n', n)).out.trim(), `parked ${n}`);
    });
  }
});

test('collisions get -2 to -9 then refuse', () => {
  const cwd = root();
  const names = [];
  for (let i = 0; i < 9; i++) {
    const s = `c${i}`;
    toRoutes(cwd, s, 'idea');
    ok(run(cwd, 'pick', s, 'E'));
    names.push(ok(run(cwd, 'park-idea', s, 'same-name')).out.trim());
  }
  assert.deepEqual(names, ['parked same-name', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `parked same-name-${n}`)]);
  toRoutes(cwd, 'c9', 'idea');
  ok(run(cwd, 'pick', 'c9', 'E'));
  const r = run(cwd, 'park-idea', 'c9', 'same-name');
  assert.equal(r.code, 1);
  assert.match(r.out, /name taken/);
});

test('park never follows a link in the work folder', { skip: process.platform === 'win32' }, () => {
  const cwd = root();
  toRoutes(cwd, 'l', 'idea');
  ok(run(cwd, 'pick', 'l', 'E'));
  const secret = path.join(cwd, 'secret.txt');
  fs.writeFileSync(secret, 'top');
  fs.symlinkSync(secret, path.join(cwd, '.company', 'work', 'l', 'link.md'));
  ok(run(cwd, 'park-idea', 'l', 'linked'));
  assert.equal(fs.existsSync(path.join(cwd, '.company', 'ideas', 'linked', 'link.md')), false);
});

test('a broken or hostile record fails loud', async (t) => {
  const ts = '"ts":"2026-10-30T00:00:00.000Z"';
  const cases = {
    'not json': 'nope\n',
    'unknown key': `{"e":"start","kind":"idea","x":1,${ts}}\n`,
    'proto key': `{"e":"start","kind":"idea","__proto__":{"a":1},${ts}}\n`,
    'bad kind': `{"e":"start","kind":"feature",${ts}}\n`,
    'no start': `{"e":"done","step":"reprompt",${ts}}\n`,
    'out of order': `{"e":"start","kind":"idea",${ts}}\n{"e":"pick","letter":"D","route":"to-spec",${ts}}\n`,
    'array': '[]\n',
    'long line': `{"e":"start","kind":"idea","ts":"${'x'.repeat(2000)}"}\n`,
    'bad ts': '{"e":"start","kind":"idea","ts":"yesterday"}\n',
  };
  for (const [name, text] of Object.entries(cases)) {
    await t.test(name, () => {
      const cwd = root();
      ok(run(cwd, 'start', 'b', '--kind', 'idea'));
      fs.writeFileSync(rec(cwd, 'b'), text);
      for (const cmd of [['options', 'b'], ['state', 'b'], ['read', 'b'], ['pick', 'b', '1']]) {
        const r = run(cwd, ...cmd);
        assert.equal(r.code, 1, cmd[0]);
        assert.match(r.out, /broken record/);
      }
      assert.equal(fs.readFileSync(rec(cwd, 'b'), 'utf8'), text);
    });
  }
  await t.test('too many lines and too large', () => {
    const cwd = root();
    ok(run(cwd, 'start', 'b', '--kind', 'idea'));
    const line = `{"e":"start","kind":"idea",${ts}}\n`;
    fs.writeFileSync(rec(cwd, 'b'), line.repeat(2001));
    assert.equal(run(cwd, 'state', 'b').code, 1);
    fs.writeFileSync(rec(cwd, 'b'), ' '.repeat(300 * 1024));
    const r = run(cwd, 'state', 'b');
    assert.equal(r.code, 1);
    assert.match(r.out, /too large/);
  });
  await t.test('a directory in place of the record', () => {
    const cwd = root();
    fs.mkdirSync(rec(cwd, 'd'), { recursive: true });
    assert.equal(run(cwd, 'state', 'd').code, 1);
  });
  await t.test('a hard link is refused', () => {
    const cwd = root();
    ok(run(cwd, 'start', 'h', '--kind', 'idea'));
    fs.linkSync(rec(cwd, 'h'), path.join(cwd, 'other'));
    const r = run(cwd, 'pick', 'h', '1');
    assert.equal(r.code, 1);
    assert.match(r.out, /hard-linked/);
  });
});

test('every appended line is LF-only valid JSON with a fixed shape', () => {
  const cwd = root();
  toTickets(cwd, 'j', 'idea');
  const text = fs.readFileSync(rec(cwd, 'j'), 'utf8');
  assert.equal(text.includes('\r'), false);
  for (const l of text.trimEnd().split('\n')) {
    const o = JSON.parse(l);
    assert.ok(['start', 'pick', 'done', 'park'].includes(o.e));
    assert.match(o.ts, /^\d{4}-\d\d-\d\dT/);
  }
});

test('the CLI runs as a process and echoes no argument on refusal', () => {
  const cwd = root();
  const script = path.resolve(import.meta.dirname, 'idea-flow.mjs');
  const p = spawnSync(process.execPath, [script, 'state', 'EVIL<script>'], { cwd, encoding: 'utf8' });
  assert.equal(p.status, 3);
  assert.equal((p.stdout + p.stderr).includes('EVIL'), false);
  const q = spawnSync(process.execPath, [script, 'start', 'cli', '--kind', 'bug'], { cwd, encoding: 'utf8' });
  assert.equal(q.status, 0);
  assert.match(q.stdout, /started/);
});
