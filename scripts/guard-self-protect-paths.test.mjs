// Tests: self-protect through the real event normalizer for run record write targets (long token lists, globs, relative writes) in main, the Lead and a Role; settings and plugin targets pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize } from '../hooks/lib/event.mjs';
import { judge } from '../hooks/rules/self-protect.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = (tmp) => ({ env: { HOME: tmp, USERPROFILE: tmp }, schema: null, pluginRoot: ROOT, mcsHome: path.join(tmp, '.mcsparrow'), resolveRun: null });

async function withProject(fn) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')));
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.company', 'work', 'P1', '01-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    return await fn(tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const WHO = [{}, { agent_id: 'a0', agent_type: 'aico:project-manager' }, { agent_id: 'a1', agent_type: 'aico:backend-engineer' }];
// main, the Lead agent and a Role must be judged alike: one word when all agree, otherwise the split.
const verdict = async (tmp, tool, command, cwd = tmp) => {
  const out = [];
  for (const who of WHO) {
    const r = await normalize({ hook_event_name: 'PreToolUse', session_id: 's', ...who, cwd, tool_name: tool, tool_input: { command } }, mk(tmp));
    out.push(judge(r.event).v);
  }
  return out.every((v) => v === out[0]) ? out[0] : `split:${out.join(',')}`;
};
const bash = (tmp, c, cwd) => verdict(tmp, 'Bash', c, cwd);
const ps = (tmp, c, cwd) => verdict(tmp, 'PowerShell', c, cwd);

const junk = (n, sep = '/') => Array.from({ length: n }, (_, i) => `.${sep}j${i}.txt`).join(' ');

const REC = '.company/work/P1/01-feature';

test('a run record write after 64+ path tokens still denies', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> ${REC}/forms.jsonl`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(64)}; echo x >> ${REC}/run-state.jsonl`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> ${REC}/guard.jsonl`), 'deny');
  assert.equal(await ps(tmp, `Get-Content ${junk(70, '\\')}; Set-Content .company\\work\\P1\\01-feature\\forms.jsonl x`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> ${REC}/forms.json?`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; F=${REC}/forms.jsonl; echo x >> $F`), 'deny');
}));

test('a settings or plugin write after 64+ path tokens allows', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> .claude/settings.json`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> .claude/settings.local.json`), 'allow');
  assert.equal(await ps(tmp, `Get-Content ${junk(70, '\\')}; Set-Content .claude\\settings.json x`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)}; rm -r .claude`), 'allow');
}));

test('a long token list with an ordinary write still allows', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> out.txt`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)} > src/all.txt`), 'allow');
  assert.equal(await ps(tmp, `Get-Content ${junk(70, '\\')}; Set-Content out.txt x`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)}`), 'allow');
}));

test('glob characters in a write target that reach a run record deny', () => withProject(async (tmp) => {
  for (const t of [
    `${REC}/guard.json?`, `${REC}/forms.json?`, `${REC}/run-state.json?`, `${REC}/forms.js*`, `${REC}/[f]orms.jsonl`,
    `${REC}/forms.js[o]nl`, '.company/work/*/*/guard.jsonl', '.company/work/*/*/forms.jsonl', '.company/work/*/*/run-state.jsonl',
    `${REC}/{forms,run-state}.jsonl`, `${REC}/forms.{jsonl,txt}`, `${REC}/*.jsonl`, `${REC}/forms.jsonl*`,
    `${tmp.replaceAll('\\', '/')}/${REC}/forms.json?`,
  ]) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'deny', t);
  }
  assert.equal(await bash(tmp, `tee ${REC}/forms.json? < /dev/null`), 'deny');
  assert.equal(await bash(tmp, `cp x ${REC}/run-state.json?`), 'deny');
  assert.equal(await bash(tmp, `mv x ${REC}/forms.jsonl`), 'deny');
}));

test('glob characters in a write target that reach a settings file allow', () => withProject(async (tmp) => {
  for (const t of [
    '.claude/settings.jso?', '.claude/settings.js*', '.claude/[s]ettings.json', '.claude/*', '.cla*/settings.json', '*/settings.json',
    '.claude/settings.js{o,x}n', '.claude/settings.{a..z}son', `${tmp.replaceAll('\\', '/')}/.claude/settings.jso?`,
  ]) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'allow', t);
  }
  assert.equal(await bash(tmp, 'tee .claude/settings.jso? < /dev/null'), 'allow');
  assert.equal(await bash(tmp, 'cp x .claude/settings.jso?'), 'allow');
  assert.equal(await bash(tmp, 'rm .cla*'), 'allow');
}));

test('a POSIX class in a write target that reaches a run record denies', () => withProject(async (tmp) => {
  for (const t of [
    `${REC}/forms.json[[:alpha:]]`, `${REC}/forms.js[[:lower:]]nl`, `${REC}/forms[[:punct:]]jsonl`,
    `${REC}/forms.jso[[=n=]]l`, `${REC}/forms.js[[.o.]]nl`, `${REC}/[[:alpha:]]orms.jsonl`,
    `${tmp.replaceAll('\\', '/')}/${REC}/run-state.json[[:alpha:]]`,
  ]) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'deny', t);
  }
  assert.equal(await bash(tmp, `tee ${REC}/forms.json[[:alpha:]] < /dev/null`), 'deny');
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> forms.json[[:alpha:]]`), 'deny');
}));

test('a POSIX class that reaches a settings file or misses every record allows', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, 'echo x >> .claude/settings.jso[[:alpha:]]'), 'allow');
  assert.equal(await bash(tmp, 'cd .claude && echo x >> settings.jso[[:alpha:]]'), 'allow');
  assert.equal(await bash(tmp, 'echo x >> src/notes.tx[[:alpha:]]'), 'allow');
  assert.equal(await bash(tmp, 'echo x >> notes/forms.jso[[:alpha:]]'), 'allow');
}));

test('glob write targets in PowerShell deny for a run record and allow for a settings file', () => withProject(async (tmp) => {
  assert.equal(await ps(tmp, 'Set-Content .company\\work\\P1\\01-feature\\forms.json? x'), 'deny');
  assert.equal(await ps(tmp, 'Set-Content -Path .company\\work\\P1\\01-feature\\run-st*.jsonl -Value x'), 'deny');
  assert.equal(await ps(tmp, 'Add-Content .company\\work\\P1\\01-feature\\[f]orms.jsonl x'), 'deny');
  assert.equal(await ps(tmp, '"x" >> .company\\work\\P1\\01-feature\\forms.json?'), 'deny');
  assert.equal(await ps(tmp, 'Set-Content .claude\\settings.jso? x'), 'allow');
  assert.equal(await ps(tmp, 'Add-Content .claude\\[s]ettings.json x'), 'allow');
  assert.equal(await ps(tmp, 'Remove-Item .cla*'), 'allow');
}));

test('a glob after cd into a run folder denies, into a settings folder allows', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> forms.json?`), 'deny');
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> run-state.js{o,x}nl`), 'deny');
  assert.equal(await ps(tmp, `Set-Location ${REC}; Set-Content forms.json? x`), 'deny');
  assert.equal(await bash(tmp, 'cd .claude && echo x >> settings.jso?'), 'allow');
  assert.equal(await ps(tmp, 'Set-Location .claude; Set-Content settings.jso? x'), 'allow');
}));

test('glob write targets that miss every record still allow', () => withProject(async (tmp) => {
  for (const t of ['src/*.txt', 'src/other.js?', 'notes/forms.jso?', '.claude-x/*', 'out.{a,b}', 'src/[a-c].txt', 'src/{a,b}/x.json']) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'allow', t);
  }
  assert.equal(await ps(tmp, 'Set-Content src\\*.txt x'), 'allow');
  assert.equal(await bash(tmp, 'cd src && cat a > out.t?'), 'allow');
}));

test('a relative write after cd into the run folder denies for a record and allows for another file', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> forms.jsonl`), 'deny');
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> run-state.jsonl`), 'deny');
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> notes.md`), 'allow');
}));

test('an over-wide brace expansion denies and stays fast', () => withProject(async (tmp) => {
  const braces = '{a,b}'.repeat(12);
  const t = process.hrtime.bigint();
  assert.equal(await bash(tmp, `echo x >> ${braces}`), 'deny');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 1000);
}));

test('pathological glob text stays fast', () => withProject(async (tmp) => {
  const t = process.hrtime.bigint();
  await bash(tmp, `echo x >> ${'*a'.repeat(120)}b/forms.jsonl`);
  await bash(tmp, `echo x >> ${'*a'.repeat(2000)}`);
  await bash(tmp, Array.from({ length: 300 }, (_, i) => `echo x >> s${i}/*.t?t`).join('\n'));
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 3000);
}));

test('a long token list with cwd inside the plugin tree allows a relative write', () => withProject(async () => {
  assert.equal(await bash(ROOT, `cat ${junk(70)}; echo x >> hooks/rules/x.mjs`, ROOT), 'allow');
  assert.equal(await bash(ROOT, `cat ${junk(70)}; cp /etc/hosts hooks/rules/dotenv.mjs`, ROOT), 'allow');
  assert.equal(await bash(ROOT, `cat ${junk(70)}; cd hooks && echo x >> rules/x.mjs`, ROOT), 'allow');
}));

test('a long token list with a project cwd still allows an ordinary relative write', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> out.txt`, tmp), 'allow');
}));

test('a run record target over 4096 chars denies, any other target allows', () => withProject(async (tmp) => {
  const pad = 'p'.repeat(2100);
  assert.equal(await bash(tmp, `echo y >> ${pad}a=b/../${pad}a=b/../${REC}/guard.jsonl`), 'deny');
  assert.equal(await bash(tmp, `echo y >> ${pad}a=b/../${pad}a=b/../${REC}/forms.jsonl`), 'deny');
  assert.equal(await bash(tmp, `echo y >> ${pad}a=b/../${pad}a=b/../${REC}/run-state.jsonl`), 'deny');
  assert.equal(await bash(tmp, `echo y >> ${pad}a=b/../${pad}a=b/../.claude/settings.json`), 'allow');
  assert.equal(await bash(tmp, `echo y >> ${pad}a=b/../${pad}a=b/../out.txt`), 'allow');
}));

test('a command over 200000 chars denies', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `echo ${'a'.repeat(200001)}`), 'deny');
  assert.equal(await ps(tmp, `Write-Output ${'a'.repeat(200001)}`), 'deny');
}));

test('a POSIX class or glob that stops short of a record name allows (ADR 0079: run-record target set only)', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `echo x >> ${REC}/forms.jso[[:alpha:]]`), 'allow');
  assert.equal(await bash(tmp, `cd ${REC} && echo x >> forms.jso?`), 'allow');
  assert.equal(await ps(tmp, `Set-Location ${REC}; Set-Content forms.jso? x`), 'allow');
}));
