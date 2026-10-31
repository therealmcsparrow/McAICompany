// Regression tests for reprompt v2.2, T2: an over-limit snap asks for a pick (exit 4) and Raise doubles the bound.
// Suspected Module: scripts/reprompt-check.mjs (run, snap, reply, git, readBaseline).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './reprompt-check.mjs';

const mod = await import('./reprompt-check.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reprompt-limits-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const SLUG = 'reprompt-20261027-0905';
const MIB = 1024 * 1024;
const FULL_ENTRIES = 50000;
const FULL_GIT = 8 * MIB;
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
function project({ withGit = false, files = 0 } = {}) {
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
  addFiles(root, files);
  return { root, env, dir };
}
function addFiles(root, count, tag = 'f') {
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(root, `${tag}-${String(i).padStart(4, '0')}-${'x'.repeat(40)}.txt`), 'x');
}
// The test-only `limits` option; both values are always given so the tests do not depend on how a half-set object is read.
const lim = (entries = FULL_ENTRIES, gitOut = FULL_GIT) => ({ entries, gitOut });
const call = (p, args, limits) => {
  const r = run(args, { cwd: p.root, env: p.env, ...(limits ? { limits } : {}) });
  return { code: r.code, json: JSON.parse(r.out), out: r.out };
};
const treeFile = p => path.join(p.dir, '.tree.json');
const readTree = p => JSON.parse(fs.readFileSync(treeFile(p), 'utf8'));
// Entries the checker counted: the three maps share one budget and the baseline file itself is skipped.
const count = p => { const d = readTree(p); return d.watch.length + d.view.length + d.centries.length; };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function put(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}
function referenceEntries(p) {
  const r = call(p, ['snap', SLUG]);
  assert.equal(r.code, 0, r.out);
  const total = count(p);
  fs.rmSync(treeFile(p));
  return total;
}
const PICK = { kind: 'pick', offer: ['walk-less', 'raise'] };

function handoff(nn = '01') {
  return `---
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
}
const PROMPT = `---\nv: 1\ntarget: claude-code\nlanguage: en\n---\n${['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'].map(h => `## ${h}\n${h} text\n`).join('')}`;

test('guard: LIMITS is frozen at 50000 entries and 8 MiB, CEILING is exactly 2, a limits option above LIMITS is refused', () => {
  assert.ok(mod.LIMITS, 'LIMITS is exported');
  assert.ok(Object.isFrozen(mod.LIMITS));
  assert.deepEqual({ ...mod.LIMITS }, { entries: 50000, gitOut: 8 * MIB });
  assert.equal(mod.CEILING, 2);
  const p = project();
  for (const bad of [lim(FULL_ENTRIES + 1), lim(FULL_ENTRIES, FULL_GIT + 1), lim(0), lim(-1), lim(1.5), lim(FULL_ENTRIES, 0), lim(Number.MAX_SAFE_INTEGER + 2), { entries: '10', gitOut: FULL_GIT }]) {
    const r = call(p, ['snap', SLUG], bad);
    assert.equal(r.code, 3, JSON.stringify(bad));
    assert.match(r.json.refused, /^refused: bad arguments/, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(treeFile(p)), false);
});

test('the limit token is optional and only raise is a valid token here; any other third argument is a usage refusal', () => {
  const p = project();
  for (const tok of ['', 'RAISE', 'raise ', 'none', 'walk', 'raise;ls']) {
    const r = call(p, ['snap', SLUG, tok]);
    assert.equal(r.code, 3, JSON.stringify(tok));
    assert.match(r.json.refused, /^refused: bad arguments/);
  }
  assert.equal(call(p, ['snap', SLUG, 'raise']).code, 0);
});

test('snap over the entry limit with no pick exits 4 with the two offers and writes no baseline', () => {
  const p = project({ files: 40 });
  const total = referenceEntries(p);
  const r = call(p, ['snap', SLUG], lim(total - 1));
  assert.equal(r.code, 4, r.out);
  assert.deepEqual(r.json, PICK);
  assert.equal(fs.existsSync(treeFile(p)), false, 'exit 4 writes no .tree.json');
  assert.equal(call(p, ['snap', SLUG], lim(total)).code, 0, 'exactly at the limit still works');
});

test('exit 4 leaves an earlier baseline untouched', () => {
  const p = project({ files: 40 });
  const first = call(p, ['snap', SLUG]);
  assert.equal(first.code, 0, first.out);
  const total = count(p);
  const before = sha(treeFile(p));
  addFiles(p.root, 5, 'g');
  const r = call(p, ['snap', SLUG], lim(total));
  assert.equal(r.code, 4, r.out);
  assert.deepEqual(r.json, PICK);
  assert.equal(sha(treeFile(p)), before);
  assert.equal(before, first.json.snap);
});

test('raise finishes within the 2x ceiling and is refused above it', () => {
  const p = project({ files: 40 });
  const total = referenceEntries(p);
  const within = Math.ceil(total / 2);
  assert.ok(within < total);
  assert.equal(call(p, ['snap', SLUG], lim(within)).code, 4, 'without the pick the same tree needs one');
  const ok = call(p, ['snap', SLUG, 'raise'], lim(within));
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.json.snap, /^[0-9a-f]{64}$/);
  const doc = readTree(p);
  assert.equal(doc.v, 2);
  assert.equal(doc.limit, 'raise');
  fs.rmSync(treeFile(p));
  const above = Math.floor((total - 1) / 2);
  assert.ok(above >= 1 && 2 * above < total);
  const bad = call(p, ['snap', SLUG, 'raise'], lim(above));
  assert.equal(bad.code, 3, bad.out);
  assert.equal(bad.json.refused, 'refused: tree too large');
  assert.equal(fs.existsSync(treeFile(p)), false);
});

test('the same ceiling holds for git output: exit 4 without a pick, snap within 2x with raise, refused above it', () => {
  const p = project({ withGit: true, files: 300 });
  const sizes = ['--untracked-files=all', '--ignored=traditional'].map(a => {
    const r = spawnSync('git', ['status', '--porcelain=v1', '-z', a, '--ignore-submodules=all'], { cwd: p.root, env: p.env });
    assert.equal(r.status, 0);
    return r.stdout.length;
  });
  const out = Math.max(...sizes);
  assert.ok(out > 12000, `fixture output ${out}`);
  const within = Math.ceil(out / 2);
  const r4 = call(p, ['snap', SLUG], lim(FULL_ENTRIES, within));
  assert.equal(r4.code, 4, r4.out);
  assert.deepEqual(r4.json, PICK);
  assert.equal(fs.existsSync(treeFile(p)), false);
  const ok = call(p, ['snap', SLUG, 'raise'], lim(FULL_ENTRIES, within));
  assert.equal(ok.code, 0, ok.out);
  assert.equal(readTree(p).limit, 'raise');
  fs.rmSync(treeFile(p));
  const bad = call(p, ['snap', SLUG, 'raise'], lim(FULL_ENTRIES, Math.floor((out - 1) / 2)));
  assert.equal(bad.code, 3, bad.out);
  assert.equal(bad.json.refused, 'refused: tree too large');
});

test('reply reads the pick from the baseline: a raise baseline applies the ceiling with no argument', () => {
  const p = project({ files: 100 });
  const total = referenceEntries(p);
  const limit = Math.ceil(total / 2) + 5;
  assert.ok(limit < total);
  const s = call(p, ['snap', SLUG, 'raise'], lim(limit));
  assert.equal(s.code, 0, s.out);
  assert.equal(call(p, ['arm', SLUG, '01'], lim(limit)).code, 0);
  put(path.join(p.dir, '01-reprompter.md'), handoff());
  put(path.join(p.dir, 'prompt.md'), PROMPT);
  const r = call(p, ['reply', SLUG, '01', s.json.snap, '1'], lim(limit));
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok');
});

test('reply over the bound of a none baseline stays refused: tree too large', () => {
  const p = project({ files: 100 });
  const total = referenceEntries(p);
  const s = call(p, ['snap', SLUG], lim(total + 3));
  assert.equal(s.code, 0, s.out);
  assert.equal(readTree(p).limit ?? 'none', 'none');
  assert.equal(call(p, ['arm', SLUG, '01'], lim(total + 3)).code, 0);
  addFiles(p.root, 10, 'late');
  put(path.join(p.dir, '01-reprompter.md'), handoff());
  put(path.join(p.dir, 'prompt.md'), PROMPT);
  const r = call(p, ['reply', SLUG, '01', s.json.snap, '1'], lim(total + 3));
  assert.equal(r.code, 3, r.out);
  assert.equal(r.json.refused, 'refused: tree too large');
});

test('baseline limit key: a present key of another shape is refused as baseline changed; absent reads as none', () => {
  const p = project({ files: 5 });
  const s = call(p, ['snap', SLUG]);
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  for (const bad of ['bogus', 3, ['raise'], { a: 1 }, true]) {
    fs.writeFileSync(treeFile(p), JSON.stringify({ ...doc, limit: bad }));
    const r = call(p, ['reply', SLUG, '01', sha(treeFile(p)), '1']);
    assert.equal(r.code, 3, `${JSON.stringify(bad)}: ${r.out}`);
    assert.equal(r.json.refused, 'refused: baseline changed', JSON.stringify(bad));
  }
  // The same file with no key behaves as a v2.1 baseline: it passes the baseline check and stops later at the gate.
  fs.writeFileSync(treeFile(p), JSON.stringify(doc));
  const ok = call(p, ['reply', SLUG, '01', sha(treeFile(p)), '1']);
  assert.equal(ok.json.refused, 'refused: write gate not active');
});

test('baseline size cap is 64 MiB on the read side', () => {
  const p = project();
  const s = call(p, ['snap', SLUG]);
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  const pad = size => {
    const head = JSON.stringify({ ...doc, watch: [], view: [], pad: '' });
    return head.slice(0, -2) + 'p'.repeat(size - head.length) + '"}';
  };
  const mid = pad(20 * MIB);
  fs.writeFileSync(treeFile(p), mid);
  const hex = crypto.createHash('sha256').update(mid).digest('hex');
  const r = call(p, ['reply', SLUG, '01', hex, '1']);
  assert.notEqual(r.json.refused, 'refused: baseline changed', 'a baseline over the old 16 MiB cap but under 64 MiB is read');
  const huge = pad(64 * MIB + 16);
  fs.writeFileSync(treeFile(p), huge);
  const r2 = call(p, ['reply', SLUG, '01', crypto.createHash('sha256').update(huge).digest('hex'), '1']);
  assert.equal(r2.json.refused, 'refused: baseline changed');
});
