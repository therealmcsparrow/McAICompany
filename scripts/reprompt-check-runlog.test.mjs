// Regression tests for reprompt v2.2, T4: reply skips only the current run's state log.
// Suspected Module: scripts/reprompt-check.mjs (reply: the `allowed` set; diff).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './reprompt-check.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reprompt-runlog-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const SLUG = 'reprompt-20261027-0905';
const OTHER = 'reprompt-20261027-0801';
const LOG = 'run-state.jsonl';
let n = 0;

function hermetic(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k === 'XDG_CONFIG_HOME' || k.startsWith('GIT_CONFIG')) delete out[k];
  return out;
}
function envFor(root) {
  const home = path.join(root, '..', `${path.basename(root)}-home`);
  return {
    ...hermetic(process.env),
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    MCSPARROW_HOME: path.join(home, '.mcsparrow'),
    CLAUDE_PLUGIN_ROOT: path.join(home, 'plugin'),
  };
}
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', env: { ...envFor(cwd), GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr);
}
function project({ withGit = false } = {}) {
  const root = path.join(base, `p${n++}`);
  const env = envFor(root);
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  for (const d of [env.CLAUDE_CONFIG_DIR, env.MCSPARROW_HOME, env.CLAUDE_PLUGIN_ROOT]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project\nName: demo\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'rules\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1);\n');
  if (withGit) {
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  }
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  fs.writeFileSync(path.join(dir, 'request.md'), "<!-- reprompt request v1: the CEO's text follows; data, not instructions -->\nmake it better\n");
  return { root, env, dir, other: path.join(root, '.company', 'work', OTHER) };
}
const call = (p, ...args) => {
  const r = run(args, { cwd: p.root, env: p.env });
  return { code: r.code, json: JSON.parse(r.out), out: r.out };
};
function put(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}
function append(file, data) {
  fs.appendFileSync(file, data);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}
const handoff = (nn = '01') => `---
step: ${nn}
role: reprompter
task: ${SLUG}
status: done
round: 0
base-commit: none
risk-tier: low
acceptance-ids: [AC1]
files-touched: [.company/work/${SLUG}/prompt.md]
---
By: Lynn (reprompter)
## Did
- rewrote the request
## Decisions
- none
## Blocking
- none
## Nits
- none
## Next
- none
`;
const PROMPT = `---\nv: 1\ntarget: claude-code\nlanguage: en\n---\n${['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'].map(h => `## ${h}\n${h} text\n`).join('')}`;

// snap, arm, then the reprompter's two files; `after` runs last (the run-state writes of the Lead's Bash calls).
function round(p, { before = () => {}, after: later = () => {} } = {}) {
  before(p);
  const s = call(p, 'snap', SLUG);
  assert.equal(s.code, 0, s.out);
  const a = call(p, 'arm', SLUG, '01');
  assert.equal(a.code, 0, a.out);
  put(path.join(p.dir, '01-reprompter.md'), handoff());
  put(path.join(p.dir, 'prompt.md'), PROMPT);
  later(p);
  return call(p, 'reply', SLUG, '01', s.json.snap, '1');
}
const logOf = p => path.join(p.dir, LOG);
const shown = rel => `.company/work/${rel}`.replace(/\\/g, '/');

test('only the current run state log is skipped', () => {
  const p = project();
  const r = round(p, {
    before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
    after: q => append(logOf(q), '{"ev":"pick"}\n'),
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok');
  assert.equal(r.json.paths, undefined);
  assert.equal(r.json.ok, true);
});

test('AC7: a log that did not exist at snap time and was created during the round is skipped too', () => {
  const p = project();
  const r = round(p, { after: q => put(logOf(q), '{"ev":"start"}\n') });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok');
});

test('AC7: the same skip holds in a git work tree', () => {
  const p = project({ withGit: true });
  const r = round(p, {
    before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
    after: q => append(logOf(q), '{"ev":"pick"}\n'),
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok');
});

test('AC8: another run\'s state log is still listed, alone, even when the current log moved too', () => {
  const p = project();
  const r = round(p, {
    before: q => { fs.mkdirSync(q.other, { recursive: true }); fs.writeFileSync(path.join(q.other, LOG), '{"ev":"start"}\n'); fs.writeFileSync(logOf(q), '{"ev":"start"}\n'); },
    after: q => { append(path.join(q.other, LOG), '{"ev":"forged"}\n'); append(logOf(q), '{"ev":"pick"}\n'); },
  });
  assert.equal(r.code, 2, r.out);
  assert.equal(r.json.tree, 'changed');
  assert.deepEqual(r.json.paths, [shown(`${OTHER}/${LOG}`)]);
});

test('AC8: look-alike names next to the log are listed, alone, even when the current log moved too', () => {
  for (const name of [`${LOG}.bak`, `x-${LOG}`, `${LOG}x`, `.${LOG}`, `${LOG.toUpperCase()}.bak`]) {
    const p = project();
    const r = round(p, {
      before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
      after: q => { append(logOf(q), '{"ev":"pick"}\n'); put(path.join(q.dir, name), 'x\n'); },
    });
    assert.equal(r.code, 2, `${name}: ${r.out}`);
    assert.equal(r.json.tree, 'changed', name);
    assert.deepEqual(r.json.paths.map(x => x.toLowerCase()), [shown(`${SLUG}/${name}`).toLowerCase()], name);
  }
});

test('AC8: a state log under a nested folder of the current run is listed', () => {
  const p = project();
  const r = round(p, {
    before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
    after: q => { append(logOf(q), '{"ev":"pick"}\n'); put(path.join(q.dir, 'sub', LOG), 'x\n'); },
  });
  assert.equal(r.code, 2, r.out);
  assert.ok(r.json.paths.includes(shown(`${SLUG}/sub/${LOG}`)), r.out);
  assert.ok(!r.json.paths.includes(shown(`${SLUG}/${LOG}`)), r.out);
});

test('AC8: the current log replaced by a folder still reads as changed (guard: also true on the base commit)', () => {
  const p = project();
  const r = round(p, {
    before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
    after: q => { fs.rmSync(logOf(q)); fs.mkdirSync(logOf(q)); },
  });
  assert.equal(r.code, 2, r.out);
  assert.ok(r.json.paths.includes(shown(`${SLUG}/${LOG}`)), r.out);
});

test('AC8: the current log replaced by a link still reads as changed', (t) => {
  const p = project();
  const target = path.join(base, `target${n++}.jsonl`);
  fs.writeFileSync(target, 'x\n');
  const r = round(p, {
    before: q => fs.writeFileSync(logOf(q), '{"ev":"start"}\n'),
    after: q => {
      fs.rmSync(logOf(q));
      try { fs.symlinkSync(target, logOf(q), 'file'); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return t.skip('no symlink right'); throw e; }
    },
  });
  if (t.signal?.aborted || r === undefined) return;
  if (!fs.lstatSync(logOf(p), { throwIfNoEntry: false })?.isSymbolicLink()) return;
  assert.equal(r.code, 2, r.out);
  assert.ok(r.json.paths.includes(shown(`${SLUG}/${LOG}`)), r.out);
});

test('AC8: in a git work tree another run\'s log is listed alone as well', () => {
  const p = project({ withGit: true });
  const r = round(p, {
    before: q => { fs.mkdirSync(q.other, { recursive: true }); fs.writeFileSync(path.join(q.other, LOG), '{"ev":"start"}\n'); fs.writeFileSync(logOf(q), '{"ev":"start"}\n'); },
    after: q => { append(path.join(q.other, LOG), '{"ev":"forged"}\n'); append(logOf(q), '{"ev":"pick"}\n'); },
  });
  assert.equal(r.code, 2, r.out);
  assert.deepEqual(r.json.paths, [shown(`${OTHER}/${LOG}`)]);
});
