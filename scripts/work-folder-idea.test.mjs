import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './idea-flow.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-idea-'));
  tmps.push(d);
  return d;
};
const work = (cwd, name) => path.join(cwd, '.company', 'work', name);
const mkWork = (cwd, name) => fs.mkdirSync(work(cwd, name), { recursive: true });
const run = (cwd, ...argv) => main(argv, cwd);
const ok = (r) => { assert.equal(r.code, 0, r.out); return r; };

const NEW = '2026-10-30 22.42 - Login Idea';
const HELPER = '2026-10-30 22.42 - Login Idea Draft 2';

test('hostile new-shaped names are refused before anything is written', async (t) => {
  const cwd = repo();
  mkWork(cwd, NEW);
  const bad = [
    '2026-10-30 22.42 - Fix-login',
    '2026-10-30 22.42 - Fix Login Build 2',
    '2026-10-30 22.42 - Login Idea.',
    '2026-02-30 22.42 - Login Idea',
    '2026-10-30 24.00 - Login Idea',
    '2026-10-30 22.42 - Login\' Idea',
    '2026-10-30 22.42 - Login $(x)',
    '2026-10-30 22.42 - ..',
    '2026-10-30 22.42 - Login/Idea',
    '2026-10-30 22.42 - Login\\Idea',
    '2026-10-30 22.42 - Login\nIdea',
    '2026-10-30 22.42 - Login‮Idea',
    '2026-10-30 22.42 - Login Idea Extra Words Go Past Five',
    '2026-10-30 22.42 - Pipeline Fix Review Gate Plan Draft Extra',
    `2026-10-30 22.42 - ${'A'.repeat(61)}`,
    '2026-10-30 22.42 -  Login Idea',
    '2026-10-30 22.42 - login idea',
  ];
  for (const s of bad) {
    for (const cmd of ['start', 'options', 'state', 'read']) {
      await t.test(`${cmd} ${JSON.stringify(s).slice(0, 28)}`, () => {
        const argv = cmd === 'start' ? [cmd, s, '--kind', 'idea'] : [cmd, s];
        const r = run(cwd, ...argv);
        assert.equal(r.code, 3);
        const control = /[\u0000-\u001f‮]/.test(s);
        assert.equal(r.out, control ? 'refused: argument is not accepted\n' : 'refused: bad slug\n');
      });
    }
  }
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.company', 'work')), [NEW]);
  assert.deepEqual(fs.readdirSync(work(cwd, NEW)), []);
});

test('start in an existing new-name folder records there', () => {
  const cwd = repo();
  mkWork(cwd, NEW);
  assert.equal(ok(run(cwd, 'start', NEW, '--kind', 'idea')).out, 'started\n');
  assert.ok(fs.existsSync(path.join(work(cwd, NEW), 'idea-flow.jsonl')));
  assert.match(ok(run(cwd, 'state', NEW)).out, /^kind: idea\nform: grill\n/);
  assert.equal(run(cwd, 'start', NEW, '--kind', 'idea').out, 'error: exists\n');
});

test('start refuses a missing new-name folder and creates nothing', () => {
  const cwd = repo();
  fs.mkdirSync(path.join(cwd, '.company', 'work'), { recursive: true });
  for (const name of [NEW, HELPER]) {
    const r = run(cwd, 'start', name, '--kind', 'bug');
    assert.equal(r.code, 1);
    assert.equal(r.out, 'error: unknown slug\n');
  }
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.company', 'work')), []);
});

test('start refuses a new name when .company/work is missing and creates nothing', () => {
  const cwd = repo();
  const r = run(cwd, 'start', NEW, '--kind', 'idea');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: unknown slug\n');
  assert.equal(fs.existsSync(path.join(cwd, '.company')), false);
});

test('start still creates a legacy slug folder', () => {
  const cwd = repo();
  assert.equal(ok(run(cwd, 'start', 'idea-20261030-2242', '--kind', 'idea')).out, 'started\n');
  assert.ok(fs.existsSync(path.join(work(cwd, 'idea-20261030-2242'), 'idea-flow.jsonl')));
});

test('a legacy flow still resumes', () => {
  const cwd = repo();
  const slug = 'bug-20261030-2242';
  ok(run(cwd, 'start', slug, '--kind', 'bug'));
  ok(run(cwd, 'pick', slug, '1'));
  ok(run(cwd, 'done', slug, 'grill'));
  assert.match(ok(run(cwd, 'state', slug)).out, /build: fix/);
  assert.match(ok(run(cwd, 'read', slug)).out, /1 start kind=bug/);
});

test('a new-name flow runs from start to parked', () => {
  const cwd = repo();
  mkWork(cwd, NEW);
  ok(run(cwd, 'start', NEW, '--kind', 'idea'));
  ok(run(cwd, 'pick', NEW, '1'));
  ok(run(cwd, 'done', NEW, 'grill'));
  ok(run(cwd, 'done', NEW, 'reprompt', '--out', `.company/work/${NEW} Draft/prompt.md`));
  assert.match(ok(run(cwd, 'options', NEW)).out, /option E park-idea/);
  ok(run(cwd, 'pick', NEW, 'E'));
  assert.equal(ok(run(cwd, 'park-idea', NEW, 'login-idea')).out, 'parked login-idea\n');
  assert.match(ok(run(cwd, 'read', NEW)).out, /out=\.company\/work\/2026-10-30 22\.42 - Login Idea Draft\/prompt\.md/);
  assert.ok(fs.existsSync(path.join(cwd, '.company', 'ideas', 'login-idea', 'idea-flow.jsonl')));
});

test('a linked new-name folder is refused', () => {
  const cwd = repo();
  const outside = path.join(cwd, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(cwd, '.company', 'work'), { recursive: true });
  fs.symlinkSync(outside, work(cwd, NEW), 'junction');
  const r = run(cwd, 'start', NEW, '--kind', 'idea');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: link\n');
  assert.deepEqual(fs.readdirSync(outside), []);
});

for (const name of ['idea', 'bug']) {
  test(`skills/${name}/SKILL.md uses the Topic-file form`, () => {
    const text = read(`skills/${name}/SKILL.md`);
    assert.ok(text.split('\n').length <= 125);
    assert.ok(!text.includes('\r'));
    assert.match(text, new RegExp(`work-folder new --playbook '${name}' --topic file`));
    assert.match(text, /Write tool/);
    assert.match(text, /idea-flow start '<name>'/);
    assert.match(text, /never goes on a shell line/);
    assert.match(text, /work-folder-topic-/);
    assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" work-folder new'));
    assert.ok(!/Name:/.test(text));
  });
}

test('the contract names v1.2 and both name forms', () => {
  const text = read('docs/contracts/idea-flow.md');
  assert.match(text, /^# Contract: idea-flow v1\.4/);
  assert.match(text, /work-folder-name/);
  assert.match(text, /unknown slug/);
  assert.ok(!text.includes('\r'));
  assert.match(read('scripts/idea-flow.mjs'), /contract idea-flow v1\.4/);
});
