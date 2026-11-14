import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Tests for the git-add guard (rule git-add.M-SEC1) plus evasion. Seam: hooks/rules/git-add.mjs#judge(event, snapshot) -> verdict (mod-hook v1,
// hook-event v1). Every deny form is listed below.
// The tests build normalized events by hand (tool.command and tool.paths)
// and never touch the engine, so they hold the rule alone.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'git-add.M-SEC1';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);

async function load() {
  const file = path.join(root, 'hooks', 'rules', 'git-add.mjs');
  assert.ok(fs.existsSync(file), 'hooks/rules/git-add.mjs exists');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.judge, 'function', 'git-add.mjs exports judge');
  return mod.judge;
}

// Words that look like a path operand become tool.paths entries, as the host does; `dirs`
// names the ones that exist as directories (hook-event v1 tool.paths[].dir).
function pathsOf(command, dirs) {
  const toks = command.match(/"[^"]*"|'[^']*'|[^\s;&|(){}]+/g) ?? [];
  return toks
    .map((t) => t.replace(/^["']|["']$/g, ''))
    .filter((t) => t && !t.startsWith('-') && !t.startsWith('&') && /^[A-Za-z0-9_.:()*?\[\]\\/ -]+$/.test(t))
    .map((raw) => ({ raw, expanded: null, real: raw, exists: dirs.includes(raw), dir: dirs.includes(raw) }));
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
function ev(command, { tool = 'Bash', dirs = [], session = 'lead' } = {}) {
  return deepFreeze({
    v: 1, event: 'PreToolUse', session, sessionKey: 'aaaaaaaaaaaa', agentKey: null, agentType: null,
    tool: { name: tool, command, paths: command == null ? [] : pathsOf(command, dirs), model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: [], run: null, drift: [], stopHookActive: null,
  });
}
const SNAP = deepFreeze({ v: 1, at: 'x', threshold: 100000, savers: {}, floor: {}, drift: false, settingsWarnings: [] });

async function verdict(command, opts) {
  const judge = await load();
  const v = await judge(ev(command, opts), SNAP);
  assert.ok(v && typeof v === 'object', 'judge returns a verdict object');
  return v;
}
async function denies(command, opts) {
  const v = await verdict(command, opts);
  assert.equal(v.v, 'deny', `deny: ${command} (got ${JSON.stringify(v)})`);
  assert.equal(v.rule, RULE);
  assert.ok(typeof v.message === 'string' && v.message.length >= 1 && v.message.length <= 300, 'message 1-300 chars');
  assert.ok(!v.message.includes(command), 'the deny message never echoes the command');
}
async function allows(command, opts) {
  const v = await verdict(command, opts);
  assert.deepEqual(v, { v: 'allow' }, `allow: ${command}`);
}

// ---------- every deny form ----------
const DENY = [
  'git add .', 'git add ..', 'git add :/', 'git add -A', 'git add --all', 'git add --no-ignore-removal',
  'git add -u', 'git add --update', 'git stage .', 'git stage -A', 'git stage --all', 'git stage -u',
  'git add :(glob)*', 'git add ":(glob)**/*.js"', 'git add :(top)a.txt', 'git add :(exclude)a.txt',
  'git add *.js', 'git add a?.txt', 'git add [ab].txt', 'git add src/', 'git add src\\',
  'git add --pathspec-from-file=x', 'git add --pathspec-from-file x', 'git add a.txt .',
  'git add -- .', 'git add -f .', 'git add -v -A',
  'git commit -a', 'git commit --all', 'git commit -am "m"', 'git commit -a -m m', 'git commit -m m -a',
  'git commit -sam m', 'git commit -m m --all',
];
for (const c of DENY) test(`AC5 deny: ${c}`, async () => { await denies(c); });

test('AC5 deny: a pathspec that is a directory (src as a directory, tool.paths[].dir)', async () => {
  await denies('git add src', { dirs: ['src'] });
  await denies('git add a.txt src', { dirs: ['src'] });
  await denies('git stage src', { dirs: ['src'] });
});
test('AC5 pass: the same name as a file (dir false) is a named file', async () => {
  await allows('git add src');
});

// ---------- pass forms ----------
const PASS = [
  'git add a.txt', 'git add -- a.txt', 'git add -p a.txt', 'git add a.txt b.txt', 'git add src/a.js',
  'git add -- src/a.js', "git add 'a b.txt'", 'git stage a.txt', 'git add -f a.txt', 'git add --patch a.txt',
  'git commit a.txt -m m', 'git commit -m m', 'git commit -m "fix the -a flag"', 'git commit -m "add ."',
  'git commit --amend -m m', 'git commit --no-edit', 'git commit -S -m m',
  'git status', 'git log --all', 'git diff', 'git stash -a', 'git branch -a', 'ls -a', 'echo hi',
];
for (const c of PASS) test(`AC5 pass: ${c}`, async () => { await allows(c); });

// ---------- evasion ----------
const EVADE = [
  'git status; git add .', 'git status && git add -A', 'cd sub && git add .', 'git add a.txt; git add .',
  'git status | cat; git add --all', 'true || git add .', 'echo x\ngit add .', '(git add .)', '{ git add .; }',
  '"git" add .', "git 'add' .", 'git add "."', "git add '.'", 'git "add" -A',
  'git -C sub add .', 'git -C sub add -A', 'git -C "sub dir" commit -a', 'git -c core.autocrlf=false add .',
  'git -c user.name=x -C sub add -A', 'git --no-pager add -A', 'git --git-dir=.git add .', 'git -C sub -c a.b=c stage .',
  'GIT_DIR=.git git add .', 'FOO=1 git add -A', 'FOO=1 BAR=2 git commit -am m', 'env FOO=1 git add .',
  'git.exe add .', 'git.exe -C sub commit -a', '/usr/bin/git add -A', 'C:\\Git\\cmd\\git.exe add .',
  '"C:\\Program Files\\Git\\cmd\\git.exe" add .',
];
for (const c of EVADE) test(`evasion deny: ${JSON.stringify(c)}`, async () => { await denies(c); });

test('evasion deny: a chained dir pathspec', async () => {
  await denies('cd x && git add src', { dirs: ['src'] });
  await denies('git -C sub add src', { dirs: ['src'] });
});

test('evasion pass: modifiers that still name files one by one', async () => {
  for (const c of ['git -C sub add a.txt', 'git -c core.autocrlf=false add a.txt', 'GIT_DIR=.git git add a.txt',
    'FOO=1 git add a.txt', 'git.exe add a.txt', '"git" add a.txt', 'git status && git add a.txt',
    'git add a.txt && git commit a.txt -m m', 'cd sub && git add a.txt']) await allows(c);
});

// ---------- PowerShell ----------
const PS_DENY = [
  'git add .', '& git add .', '& git.exe add -A', "& 'C:\\Program Files\\Git\\cmd\\git.exe' add .",
  '& "git" add --all', 'git status; git add -A', 'git status; if ($?) { git add . }', 'if ($true) { git add . }',
  'git status | Out-Null; git commit -am "m"', 'Set-Location sub; git add .', 'git -C sub add .',
  '$env:GIT_DIR=".git"; git add .',
  'git commit -a',
];
for (const c of PS_DENY) test(`PowerShell deny: ${c}`, async () => { await denies(c, { tool: 'PowerShell' }); });
test('PowerShell pass: named files', async () => {
  for (const c of ['git add a.txt', '& git.exe add a.txt', 'git add -p a.txt', 'git status; git add a.txt',
    'git commit a.txt -m m', 'Get-ChildItem -Recurse']) await allows(c, { tool: 'PowerShell' });
});

// ---------- scope ----------
test('other tools and an absent command pass', async () => {
  await allows(null);
  await allows('git add .', { tool: 'Read' });
  await allows('git add .', { tool: 'Write' });
});
test('a Step session is judged like the Lead (no session special case)', async () => {
  await denies('git add .', { session: 'step' });
  await allows('git add a.txt', { session: 'step' });
});
test('the verdict is a plain allow-list object and the frozen event is left unchanged', async () => {
  const judge = await load();
  const e = ev('git add -A');
  const before = JSON.stringify(e);
  const v = await judge(e, SNAP);
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v']);
  assert.equal(JSON.stringify(e), before);
  assert.equal(typeof v.then, 'undefined', 'no promise');
});
test('judge is deterministic: the same event twice gives the same verdict', async () => {
  const judge = await load();
  assert.deepEqual(await judge(ev('git add .'), SNAP), await judge(ev('git add .'), SNAP));
});

// ---------- fixtures: per-rule folder, one pass and one block at least ----------
function fixtures() {
  assert.ok(fs.existsSync(FIX), 'hooks/fixtures/git-add.M-SEC1/ exists');
  return fs.readdirSync(FIX).filter((f) => f.endsWith('.json'));
}
test('AC4 fixtures: at least one pass-*.json and one block-*.json, names only pass-/block-', () => {
  const files = fixtures();
  assert.ok(files.some((f) => f.startsWith('pass-')), 'a pass fixture');
  assert.ok(files.some((f) => f.startsWith('block-')), 'a block fixture');
  for (const f of files) assert.match(f, /^(pass|block)-[a-z0-9-]+\.json$/);
});
test('AC4 fixtures: synthetic PreToolUse payloads of the allow-list, no real session values', () => {
  for (const f of fixtures()) {
    const j = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
    assert.equal(j.hook_event_name, 'PreToolUse');
    assert.ok(['Bash', 'PowerShell'].includes(j.tool_name), `${f} tool_name`);
    assert.equal(typeof j.tool_input.command, 'string');
    assert.equal(j.session_id, 'fixture');
    assert.ok(!('agent_id' in j) || /^[A-Za-z0-9_-]+$/.test(j.agent_id));
  }
});
test('AC4 fixtures: judge allows each pass-* and denies each block-* with rule git-add.M-SEC1', async () => {
  const judge = await load();
  for (const f of fixtures()) {
    const j = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
    const v = await judge(ev(j.tool_input.command, { tool: j.tool_name }), SNAP);
    if (f.startsWith('pass-')) assert.deepEqual(v, { v: 'allow' }, f);
    else { assert.equal(v.v, 'deny', f); assert.equal(v.rule, RULE, f); }
  }
});
test('fixtures cover the Decided deny forms: dot, all, glob, pathspec-from-file, commit -a / -am, chained, PowerShell', () => {
  const cmds = fixtures().filter((f) => f.startsWith('block-'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')));
  const has = (re, tool) => cmds.some((j) => re.test(j.tool_input.command) && (!tool || j.tool_name === tool));
  assert.ok(has(/\badd \.$/), 'add .');
  assert.ok(has(/--all/), '--all');
  assert.ok(has(/:\(glob\)/), ':(glob)');
  assert.ok(has(/--pathspec-from-file/), '--pathspec-from-file');
  assert.ok(has(/commit -a\b/), 'commit -a');
  assert.ok(has(/commit -am/), 'commit -am');
  assert.ok(has(/&&/), 'chained');
  assert.ok(has(/git\.exe/, 'PowerShell'), 'PowerShell git.exe');
});
