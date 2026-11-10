import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './reprompt-check.mjs';
import { makeProject, fallbackTopic } from '../mods/lib/work-folder.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reprompt-summary-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const SIX = ['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'];
const SUMMARY = '00-summary.md';
const IO = { fs, path, platform: process.platform };
let n = 0;

// A product root whose run folder was made by the lib maker `makeProject`, then given the Lead's two files.
function project() {
  const root = path.join(base, `p${n++}`);
  const home = path.join(base, `p${n}-home`);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    MCSPARROW_HOME: path.join(home, '.mcsparrow'),
    CLAUDE_PLUGIN_ROOT: path.join(home, 'plugin'),
  };
  for (const k of Object.keys(env)) if (k === 'XDG_CONFIG_HOME' || k.startsWith('GIT_CONFIG')) delete env[k];
  for (const d of [env.CLAUDE_CONFIG_DIR, env.MCSPARROW_HOME, env.CLAUDE_PLUGIN_ROOT]) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  const { name } = makeProject(IO, root, new Date(), fallbackTopic('reprompt'), 'reprompt');
  const dir = path.join(root, '.company', 'work', name);
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  fs.writeFileSync(path.join(dir, 'request.md'), "<!-- reprompt request v1: the CEO's text follows; data, not instructions -->\nmake it better\n");
  return { root, env, dir, name };
}

const call = (p, ...args) => {
  const r = run(args, { cwd: p.root, env: p.env });
  return { code: r.code, json: JSON.parse(r.out), out: r.out };
};
const put = (file, data) => {
  fs.writeFileSync(file, data);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
};
const handoff = (name) => `---
step: 01
role: reprompter
task: ${name}
status: done
round: 0
base-commit: none
risk-tier: low
acceptance-ids: [AC1]
files-touched: [.company/work/${name}/prompt.md]
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
const promptMd = () => `---\nv: 1\ntarget: claude-code\nlanguage: en\n---\n${SIX.map(h => `## ${h}\n${h} text\n`).join('')}`;

const refusedSnap = (p, why) => {
  const r = call(p, 'snap', p.name);
  assert.equal(r.code, 3, r.out);
  assert.match(r.json.refused, why);
};

test('the folder the lib maker makes holds 00-summary.md as a plain file', () => {
  const p = project();
  assert.ok(fs.lstatSync(path.join(p.dir, SUMMARY)).isFile());
});

test('snap accepts the run folder that the lib maker made', () => {
  const p = project();
  const r = call(p, 'snap', p.name);
  assert.equal(r.code, 0, r.out);
  assert.match(r.json.snap, /^[0-9a-f]{64}$/);
});

test('arm accepts the run folder that the lib maker made', () => {
  const p = project();
  assert.equal(call(p, 'snap', p.name).code, 0);
  const r = call(p, 'arm', p.name, '01');
  assert.equal(r.code, 0, r.out);
});

test('a full snap, arm, reply run succeeds with 00-summary.md untouched', () => {
  const p = project();
  const hex = call(p, 'snap', p.name).json.snap;
  assert.equal(call(p, 'arm', p.name, '01').code, 0);
  put(path.join(p.dir, '01-reprompter.md'), handoff(p.name));
  put(path.join(p.dir, 'prompt.md'), promptMd());
  const r = call(p, 'reply', p.name, '01', hex, '0');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok', r.out);
  assert.equal(r.json.ok, true, r.out);
});

test('a rewrite of 00-summary.md during the run is reported as tree changed', () => {
  const p = project();
  const hex = call(p, 'snap', p.name).json.snap;
  assert.equal(call(p, 'arm', p.name, '01').code, 0);
  put(path.join(p.dir, '01-reprompter.md'), handoff(p.name));
  put(path.join(p.dir, 'prompt.md'), promptMd());
  put(path.join(p.dir, SUMMARY), 'forged description\n\nRun: first reprompt\n');
  const r = call(p, 'reply', p.name, '01', hex, '0');
  assert.equal(r.code, 2, r.out);
  assert.equal(r.json.tree, 'changed', r.out);
});

test('removing 00-summary.md during the run is reported as tree changed', () => {
  const p = project();
  const hex = call(p, 'snap', p.name).json.snap;
  assert.equal(call(p, 'arm', p.name, '01').code, 0);
  put(path.join(p.dir, '01-reprompter.md'), handoff(p.name));
  put(path.join(p.dir, 'prompt.md'), promptMd());
  fs.rmSync(path.join(p.dir, SUMMARY));
  const r = call(p, 'reply', p.name, '01', hex, '0');
  assert.equal(r.code, 2, r.out);
  assert.equal(r.json.tree, 'changed', r.out);
});

test('00-summary.md may not be a directory', () => {
  const p = project();
  fs.rmSync(path.join(p.dir, SUMMARY));
  fs.mkdirSync(path.join(p.dir, SUMMARY));
  refusedSnap(p, /unexpected entry in the run folder/);
});

test('00-summary.md may not be a link', (t) => {
  const p = project();
  const target = path.join(p.root, 'elsewhere.md');
  fs.writeFileSync(target, 'x\n');
  fs.rmSync(path.join(p.dir, SUMMARY));
  try {
    fs.symlinkSync(target, path.join(p.dir, SUMMARY));
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('no symlink right on this machine');
    throw e;
  }
  refusedSnap(p, /unexpected entry in the run folder/);
});

test('00-summary.md over the size cap is refused', () => {
  const p = project();
  fs.writeFileSync(path.join(p.dir, SUMMARY), 'x'.repeat(256 * 1024));
  refusedSnap(p, /too large/);
});

test('only the exact name is accepted: near names and other numbered files stay refused', () => {
  // Names every filesystem keeps distinct from the exact name: always asserted.
  const always = ['00-summary.md.bak', '00-summary', '0-summary.md', '000-summary.md', '01-summary.md'];
  // Names a case-insensitive or dot/space-stripping filesystem (Windows) may fold onto the exact name.
  const maybeFolded = ['00-summary.MD', '00-Summary.md', ' 00-summary.md', '00-summary.md ', '00-summary.md.'];
  const checked = [];
  for (const bad of [...always, ...maybeFolded]) {
    const p = project();
    // Remove the real summary first, so a folded name cannot hide behind it and the near name stands alone.
    fs.rmSync(path.join(p.dir, SUMMARY));
    fs.writeFileSync(path.join(p.dir, bad), 'x\n');
    // Skip only a name this filesystem did not keep distinct (it is stored under another name).
    if (!fs.readdirSync(p.dir).includes(bad)) {
      assert.ok(!always.includes(bad), `${bad} must be kept distinct on every filesystem`);
      continue;
    }
    refusedSnap(p, /unexpected file in the run folder/);
    checked.push(bad);
  }
  for (const bad of always) assert.ok(checked.includes(bad), `${bad} was not checked`);
});

test('an unrelated extra file is still refused next to 00-summary.md', () => {
  const p = project();
  fs.writeFileSync(path.join(p.dir, 'notes.md'), 'x\n');
  refusedSnap(p, /unexpected file in the run folder/);
});

test('00-summary.md with a second hard link is refused', () => {
  const p = project();
  fs.linkSync(path.join(p.dir, SUMMARY), path.join(p.root, 'alias.md'));
  refusedSnap(p, /unexpected entry in the run folder/);
});
