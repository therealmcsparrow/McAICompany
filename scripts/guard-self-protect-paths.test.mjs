// Tests: self-protect through the real event normalizer, for long token lists and glob-shaped write targets.
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

const verdict = async (tmp, tool, command, cwd = tmp) => {
  const r = await normalize({ hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'a1', cwd, tool_name: tool, tool_input: { command } }, mk(tmp));
  return judge(r.event).v;
};
const bash = (tmp, c, cwd) => verdict(tmp, 'Bash', c, cwd);
const ps = (tmp, c, cwd) => verdict(tmp, 'PowerShell', c, cwd);

const junk = (n, sep = '/') => Array.from({ length: n }, (_, i) => `.${sep}j${i}.txt`).join(' ');

test('a protected write after 64+ path tokens still denies', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> .claude/settings.json`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(64)}; echo x >> .claude/settings.json`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> .claude/settings.local.json`), 'deny');
  assert.equal(await ps(tmp, `Get-Content ${junk(70, '\\')}; Set-Content .claude\\settings.json x`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; rm -r .claude`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> .claude/settings.jso?`), 'deny');
  assert.equal(await bash(tmp, `cat ${junk(70)}; F=.claude/settings.json; echo x >> $F`), 'deny');
}));

test('a long token list with an ordinary write still allows', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, `cat ${junk(70)}; echo x >> out.txt`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)} > src/all.txt`), 'allow');
  assert.equal(await ps(tmp, `Get-Content ${junk(70, '\\')}; Set-Content out.txt x`), 'allow');
  assert.equal(await bash(tmp, `cat ${junk(70)}`), 'allow');
}));

test('glob characters in a write target that reach a protected file deny', () => withProject(async (tmp) => {
  for (const t of [
    '.claude/settings.jso?', '.claude/settings.js*', '.claude/[s]ettings.json', '.claude/settings.js[o]n', '.claude/*',
    '.cla*/settings.json', '.c?aude/settings.json', '*/settings.json', '.claude/settings.js{o,x}n', '.{claude,x}/settings.json',
    '.claude/settings.{json,txt}', '.claude/settings.j{s,t}on', '.company/work/P1/01-feature/guard.json?', '.company/work/*/*/guard.jsonl',
    `${tmp.replaceAll('\\', '/')}/.claude/settings.jso?`, '.claude/settings.{a..z}son',
  ]) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'deny', t);
  }
  assert.equal(await bash(tmp, 'tee .claude/settings.jso? < /dev/null'), 'deny');
  assert.equal(await bash(tmp, 'cp x .claude/settings.jso?'), 'deny');
  assert.equal(await bash(tmp, 'rm .cla*'), 'deny');
  assert.equal(await bash(tmp, 'mv .cl?ude elsewhere'), 'deny');
}));

test('glob write targets in PowerShell deny too', () => withProject(async (tmp) => {
  assert.equal(await ps(tmp, 'Set-Content .claude\\settings.jso? x'), 'deny');
  assert.equal(await ps(tmp, 'Set-Content -Path .claude\\sett*.json -Value x'), 'deny');
  assert.equal(await ps(tmp, 'Add-Content .claude\\[s]ettings.json x'), 'deny');
  assert.equal(await ps(tmp, '"x" >> .claude\\settings.jso?'), 'deny');
  assert.equal(await ps(tmp, 'Remove-Item .cla*'), 'deny');
}));

test('a glob after cd into a protected folder denies', () => withProject(async (tmp) => {
  assert.equal(await bash(tmp, 'cd .claude && echo x >> settings.jso?'), 'deny');
  assert.equal(await bash(tmp, 'cd src && echo x >> settings.js{o,x}n'), 'deny');
  assert.equal(await ps(tmp, 'Set-Location .claude; Set-Content settings.jso? x'), 'deny');
}));

test('glob write targets that miss every protected path still allow', () => withProject(async (tmp) => {
  for (const t of ['src/*.txt', 'src/other.js?', 'notes/settings.jso?', '.claude-x/*', 'out.{a,b}', 'src/[a-c].txt', 'src/{a,b}/x.json']) {
    assert.equal(await bash(tmp, `echo x >> ${t}`), 'allow', t);
  }
  assert.equal(await ps(tmp, 'Set-Content src\\*.txt x'), 'allow');
  assert.equal(await bash(tmp, 'cd src && cat a > out.t?'), 'allow');
}));

test('an over-wide brace expansion denies and stays fast', () => withProject(async (tmp) => {
  const braces = '{a,b}'.repeat(12);
  const t = process.hrtime.bigint();
  assert.equal(await bash(tmp, `echo x >> ${braces}`), 'deny');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 1000);
}));

test('pathological glob text stays fast', () => withProject(async (tmp) => {
  const t = process.hrtime.bigint();
  await bash(tmp, `echo x >> ${'*a'.repeat(120)}b/settings.json`);
  await bash(tmp, `echo x >> ${'*a'.repeat(2000)}`);
  await bash(tmp, Array.from({ length: 300 }, (_, i) => `echo x >> s${i}/*.t?t`).join('\n'));
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 3000);
}));
