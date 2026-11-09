// draft-input v1.3: the spec draft takes the reprompt prompt file `.company/work/<name>/prompt.md` whole.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-prompt-')));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const STAMP = '2026-10-31 09.15';
const NAME = `${STAMP} - Reprompt`;
const PNAME = 'P20261031.000001-09.15.00'; // first project of the day, run at 09:15:00 (draft-input v1.5)
const PROMPT = `.company/work/${NAME}/prompt.md`;
const run = (root, ...args) => main(args, { root, now: new Date(2026, 9, 31, 9, 15) });
const tree = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      out.push(path.relative(root, p).split(path.sep).join('/'));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
};

const argPath = (root, f) => path.join(root, '.company', `draft-input-arg-${f}.txt`);
const topicPath = (root) => path.join(root, '.company', 'work-folder-topic-to-spec.txt');
const arg = (root, f, text) => {
  put(root, `.company/draft-input-arg-${f}.txt`, text);
  return run(root, 'arg', '--for', f);
};
const take = (root, rel, f = 'to-spec') => run(root, 'take', rel, '--for', f);
const refused = (r, reason, code = 3) => {
  assert.equal(r.code, code);
  assert.deepEqual(r.lines, [`refused: ${reason}`]);
};

const MULTI = 'Build a login page.\n\nIt must:\n- accept an email\n- refuse a bad password\n';

describe('arg and take --for to-spec with a prompt file', () => {
  test('a multi-line prompt file is accepted for a spec draft', () => {
    const root = fixture({ [PROMPT]: MULTI });
    assert.ok(Buffer.byteLength(MULTI) < 4096);
    assert.deepEqual(arg(root, 'to-spec', PROMPT), { code: 0, lines: [`arg: file ${PROMPT}`] });
    const r = take(root, PROMPT);
    assert.equal(r.code, 0);
    const name = PNAME;
    assert.deepEqual(r.lines, [`slug: ${name}`, `input: .company/work/${name}/input-to-spec.md`, 'kind: text', 'text: 5 lines']);
    const copy = fs.readFileSync(path.join(root, '.company', 'work', name, 'input-to-spec.md'));
    assert.ok(copy.equals(Buffer.from(MULTI)), 'byte-equal copy');
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work', NAME)), ['prompt.md']);
  });

  test('the backslash form of the prompt path is read as the slash form', () => {
    const root = fixture({ [PROMPT]: MULTI });
    assert.deepEqual(arg(root, 'to-spec', PROMPT.replaceAll('/', '\\')), { code: 0, lines: [`arg: file ${PROMPT}`] });
  });

  test('a legacy slug work folder holds a prompt file too', () => {
    const root = fixture({ '.company/work/alpha/prompt.md': MULTI });
    assert.deepEqual(arg(root, 'to-spec', '.company/work/alpha/prompt.md'), { code: 0, lines: ['arg: file .company/work/alpha/prompt.md'] });
    const r = take(root, '.company/work/alpha/prompt.md');
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], `slug: ${PNAME}`);
  });

  test('a prompt file of 16384 bytes is read whole and 16385 bytes is too large', () => {
    const line = `${'word '.repeat(15)}word\n`;
    const body = (n) => line.repeat(Math.ceil(n / line.length)).slice(0, n - 1) + '\n';
    const edge = body(16384);
    const over = `${edge}a`;
    assert.equal(Buffer.byteLength(edge), 16384);
    assert.equal(Buffer.byteLength(over), 16385);

    const ok = fixture({ [PROMPT]: edge });
    assert.deepEqual(arg(ok, 'to-spec', PROMPT), { code: 0, lines: [`arg: file ${PROMPT}`] });
    const r = take(ok, PROMPT);
    assert.equal(r.code, 0);
    const name = PNAME;
    assert.ok(fs.readFileSync(path.join(ok, '.company', 'work', name, 'input-to-spec.md')).equals(Buffer.from(edge)), 'whole copy');

    const big = fixture({ [PROMPT]: over });
    assert.deepEqual(arg(big, 'to-spec', PROMPT), { code: 0, lines: [`arg: file ${PROMPT}`] });
    const before = tree(big);
    refused(take(big, PROMPT), 'too large');
    assert.deepEqual(tree(big), before, 'nothing written');
  });

  test('the spec run is a new project described by the Topic', () => {
    const root = fixture({ [PROMPT]: MULTI, '.company/work-folder-topic-to-spec.txt': 'Login Idea\n' });
    assert.deepEqual(arg(root, 'to-spec', PROMPT), { code: 0, lines: [`arg: file ${PROMPT}`] });
    assert.ok(fs.existsSync(topicPath(root)), 'arg leaves the Topic file for take');
    const r = take(root, PROMPT);
    const name = PNAME;
    assert.equal(r.code, 0);
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', name, '00-summary.md'), 'utf8').split('\n')[0], 'Login Idea');
    assert.deepEqual(r.lines.slice(0, 2), [`slug: ${name}`, `input: .company/work/${name}/input-to-spec.md`]);
    assert.ok(!r.lines[0].includes('Draft'), 'no Draft helper');
    assert.ok(!fs.existsSync(topicPath(root)), 'take consumed the Topic file');
    assert.ok(fs.existsSync(path.join(root, '.company', 'work', name, 'input-to-spec.md')));
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work', NAME)), ['prompt.md'], 'the reprompt folder is untouched');
  });

  test('a draft file path still consumes the Topic file in arg, a prompt path does not', () => {
    const spec = fixture({ [`.company/work/${NAME}/spec.md`]: MULTI, '.company/work-folder-topic-to-spec.txt': 'Login Idea\n' });
    assert.equal(arg(spec, 'to-spec', `.company/work/${NAME}/spec.md`).code, 0);
    assert.ok(!fs.existsSync(topicPath(spec)), 'arg consumed it for a draft file');
    const prompt = fixture({ [PROMPT]: MULTI, '.company/work-folder-topic-to-spec.txt': 'Login Idea\n' });
    assert.equal(arg(prompt, 'to-spec', PROMPT).code, 0);
    assert.ok(fs.existsSync(topicPath(prompt)), 'arg left it for a prompt file');
  });

  test('a refused prompt take still drops the Topic file', () => {
    const root = fixture({ [PROMPT]: `${MULTI}${'a'.repeat(16384)}`, '.company/work-folder-topic-to-spec.txt': 'Login Idea\n' });
    refused(take(root, PROMPT), 'too large');
    assert.ok(!fs.existsSync(topicPath(root)));
  });
});

describe('a prompt file gets the same refusals as a draft file', () => {
  // Builds the same place twice, once holding spec.md and once prompt.md, and returns what arg and take print for each.
  function place(file, kind, name) {
    const dir = `.company/work/${name}`;
    const rel = `${dir}/${file}`;
    let root;
    if (kind === 'junction') {
      root = fixture({ [`elsewhere/${file}`]: MULTI });
      fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
      fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, ...dir.split('/')), 'junction');
    } else if (kind === 'symlink') {
      root = fixture({ 'target.md': MULTI });
      fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
      fs.symlinkSync(path.join(root, 'target.md'), path.join(root, ...rel.split('/')), 'file');
    } else if (kind === 'hardlink') {
      root = fixture({ 'twin.md': MULTI });
      fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
      fs.linkSync(path.join(root, 'twin.md'), path.join(root, ...rel.split('/')));
    } else {
      root = fixture({ [rel]: MULTI });
    }
    return { root, rel };
  }

  const outcome = (file, kind, name, forPath = (rel) => rel) => {
    const a = place(file, kind, name);
    const argR = arg(a.root, 'to-spec', forPath(a.rel));
    const t = place(file, kind, name);
    put(t.root, '.company/work-folder-topic-to-spec.txt', 'Login Idea\n');
    const view = () => tree(t.root).filter((p) => !p.endsWith('work-folder-topic-to-spec.txt')).map((p) => p.replace(file, '<file>'));
    const before = view();
    const takeR = take(t.root, forPath(t.rel));
    const after = view();
    return { argR, takeR, before, after, topic: fs.existsSync(topicPath(t.root)) };
  };

  const same = (label, kind, name, forPath) => {
    const spec = outcome('spec.md', kind, name, forPath);
    const prompt = outcome('prompt.md', kind, name, forPath);
    const swap = (line) => line.replace('/spec.md', '/prompt.md');
    assert.deepEqual(prompt.argR, { ...spec.argR, lines: spec.argR.lines.map(swap) }, `${label}: arg`);
    assert.equal(spec.takeR.code, 3, `${label}: spec.md take is refused`);
    assert.deepEqual(prompt.takeR, spec.takeR, `${label}: take`);
    assert.deepEqual(prompt.after, prompt.before, `${label}: nothing written`);
    assert.equal(prompt.topic, false, `${label}: Topic file dropped`);
    assert.equal(spec.topic, false);
  };

  test('bad names, a junction, a hard link and the wrong prefix are refused alike', () => {
    same('bad work folder name', 'plain', 'Bad_Name');
    same('bad work folder name with a space', 'plain', 'bad name');
    same('junction', 'junction', NAME);
    same('hard link', 'hardlink', NAME);
    same('prefix .company/Work/', 'plain', NAME, (rel) => rel.replace('.company/work/', '.company/Work/'));
    same('prefix .company/Work/ legacy slug', 'plain', 'alpha', (rel) => rel.replace('.company/work/', '.company/Work/'));
  });

  test('a file symlink is refused alike', (t) => {
    const probe = fixture({ 'a.md': 'x' });
    try {
      fs.symlinkSync(path.join(probe, 'a.md'), path.join(probe, 'b.md'), 'file');
    } catch {
      t.skip('file symlinks need a privilege on this host');
      return;
    }
    same('file symlink', 'symlink', NAME);
  });

  test('a wrong-case folder name gets the answer a draft file gets on this host', () => {
    const wrong = NAME.replace('Reprompt', 'REPROMPT');
    const mk = (file) => {
      const root = fixture({ [`.company/work/${NAME}/${file}`]: MULTI });
      return { root, rel: `.company/work/${wrong}/${file}` };
    };
    const s = mk('spec.md');
    const p = mk('prompt.md');
    const sArg = arg(s.root, 'to-spec', s.rel);
    const swap = (line) => line.replace('/spec.md', '/prompt.md');
    assert.deepEqual(arg(p.root, 'to-spec', p.rel), { ...sArg, lines: sArg.lines.map(swap) }, 'arg');
    const sTake = take(s.root, s.rel);
    const pTake = take(p.root, p.rel);
    assert.equal(pTake.code, sTake.code, 'take exit');
    if (sTake.code === 3) assert.deepEqual(pTake, sTake, 'take refusal');
    else assert.deepEqual(pTake.lines.slice(2), sTake.lines.slice(2), 'take kind and summary');
  });
});

describe('only to-spec treats a prompt path as a file', () => {
  test('feature intake still refuses a prompt file as not a draft file', () => {
    const root = fixture({ [PROMPT]: MULTI });
    const before = tree(root);
    refused(take(root, PROMPT, 'feature'), 'not a draft file');
    assert.deepEqual(tree(root), before);
  });

  test('fix intake still refuses a prompt file as not a build plan', () => {
    const root = fixture({ [PROMPT]: MULTI });
    refused(take(root, PROMPT, 'fix'), 'not a build plan');
  });

  test('only to-spec treats a prompt path as a file', () => {
    // A spaced work folder name: today the text is idea text for every word but to-spec.
    const today = {
      grill: { code: 0, lines: ['arg: idea', `slug: ${PNAME}`] },
      'to-tickets': { code: 3, lines: ['refused: needs a file'] },
      feature: { code: 0, lines: ['arg: idea'] },
      fix: { code: 0, lines: ['arg: idea'] },
    };
    for (const [f, want] of Object.entries(today)) {
      const root = fixture({ [PROMPT]: MULTI });
      assert.deepEqual(arg(root, f, PROMPT), want, f);
    }
    // A legacy slug folder: today a one-token path is a file for every word.
    for (const f of ['grill', 'to-tickets', 'feature', 'fix']) {
      const root = fixture({ '.company/work/alpha/prompt.md': MULTI });
      assert.deepEqual(arg(root, f, '.company/work/alpha/prompt.md'), { code: 0, lines: ['arg: file .company/work/alpha/prompt.md'] }, f);
    }
  });
});
