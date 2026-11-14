import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Self-protect: here-strings and quoted text piped into an interpreter are program bodies.

const root = path.resolve(import.meta.dirname, '..');
const { judge } = await import(pathToFileURL(path.join(root, 'hooks/rules/self-protect.mjs')).href);

const HOME = 'C:/Users/test';
const PROT = [
  `${HOME}/.claude/settings.json`, `${HOME}/.mcsparrow/config.json`, 'c:/proj/.claude/settings.json',
].map((p) => p.toLowerCase());

function ev(tool, command) {
  return {
    v: 1, event: 'PreToolUse', session: 'step', sessionKey: 'aaaaaaaaaaaa', agentKey: 'bbbbbbbbbbbb', agentType: null,
    tool: { name: tool, command, paths: [], model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: PROT, run: null, drift: [], stopHookActive: null,
  };
}
const denied = (tool, command) => {
  const v = judge(ev(tool, command));
  assert.equal(v.v, 'deny', `deny: ${command}`);
  assert.equal(v.rule, 'self-protect.M-SEC1');
};
const allowed = (tool, command) => assert.deepEqual(judge(ev(tool, command)), { v: 'allow' }, `allow: ${command}`);

test('a PowerShell here-string piped into an interpreter denies when it names a settings file', () => {
  denied('PowerShell', `@'\nopen(".claude/settings.json","w").write("{}")\n'@ | python -`);
  denied('PowerShell', `@"\nopen('.claude/settings.json','w')\n"@ | python3 -`);
  denied('PowerShell', `@'\nimport pathlib\npathlib.Path.home().joinpath('x').write_text('{}')\n'@ | python -`);
});

test('quoted text piped into an interpreter denies when it names a settings file', () => {
  denied('Bash', `echo "open('/home/u/.claude/settings.json','w')" | python3`);
  denied('Bash', `printf '%s' "require('fs').writeFileSync('.claude/settings.json','{}')" | node`);
  denied('Bash', `echo 'open(".claude/settings.json","w")' | python3 -`);
});

test('plain data in a here-string or pipe still allows', () => {
  allowed('PowerShell', `@'\nprint(1 + 1)\n'@ | python -`);
  allowed('PowerShell', `@'\nopen(".claude/settings.json")\n'@ | Set-Content out.txt`);
  allowed('Bash', `echo "print(1 + 1)" | python3`);
  allowed('Bash', `echo "settings.json" | grep settings`);
});

const timed = (tool, command) => {
  const t = process.hrtime.bigint();
  const v = judge(ev(tool, command));
  return { v, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};

const BS = String.fromCharCode(92);
const LOOSE_MS = 500;

test('a quoted Windows path with a pipe does not backtrack and still allows', () => {
  const cmd = `echo "C:${BS.repeat(40)}" | grep x`;
  const { v, ms } = timed('Bash', cmd);
  assert.deepEqual(v, { v: 'allow' });
  assert.ok(ms < LOOSE_MS, `took ${ms} ms`);
  allowed('Bash', String.raw`echo 'C:\Users\me\' | grep x`);
});

test('worst-case backslash text piped to an interpreter stays fast and still denies', () => {
  const cmd = `echo "${BS.repeat(60)} .claude/settings.json" | python3`;
  const { v, ms } = timed('Bash', cmd);
  assert.equal(v.v, 'deny');
  assert.ok(ms < LOOSE_MS, `took ${ms} ms`);
});

test('escaped quotes after a pipe and a quote scale linearly', () => {
  const run = (n) => timed('Bash', `x | "${`${BS}"`.repeat(n)}`);
  run(2000);
  const small = run(10000);
  const large = run(40000);
  assert.deepEqual(small.v, { v: 'allow' });
  assert.deepEqual(large.v, { v: 'allow' });
  assert.ok(large.ms < LOOSE_MS, `took ${large.ms} ms`);
  assert.ok(large.ms < Math.max(small.ms, 5) * 12, `${small.ms} ms -> ${large.ms} ms for 4x the input`);
});

test('escaped quotes inside piped text still deny and still allow', () => {
  denied('Bash', String.raw`echo "say \"hi\" open('.claude/settings.json','w')" | python3`);
  denied('Bash', String.raw`echo "open('.claude/settings.json','w')\" | python3`);
  allowed('Bash', String.raw`echo "say \"hi\"" | python3`);
});

test('many here-string openers without a closer stay linear', () => {
  const cmd = "@'\n".repeat(60000);
  const { v, ms } = timed('PowerShell', cmd);
  assert.deepEqual(v, { v: 'allow' });
  assert.ok(ms < LOOSE_MS, `took ${ms} ms`);
});

test('a here-string after many unclosed openers of the other quote still denies', () => {
  const cmd = `${'@"\n'.repeat(500)}@'\nopen(".claude/settings.json","w")\n'@ | python -`;
  denied('PowerShell', cmd);
});
