// Tests for the hooks.json wiring of lead-relay v1 and lead-handoff v3.0 (AC2, AC6, AC12).
// PostToolUse `answer` and PreToolUse `preset` (both matcher AskUserQuestion), SubagentStop `measure`, the Stop `measure` stays,
// the `turn` and `resume` adapters are gone, and the pins match the wired files (mod-hook v1.1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
const cmd = (script, word) => `node "\${CLAUDE_PLUGIN_ROOT}/scripts/${script}.mjs"${word ? ` ${word}` : ''}`;
const entriesRunning = (event, script, word) => cfg.hooks[event].filter((e) => e.hooks.some((h) => h.command === cmd(script, word)));

describe('lead-relay v1: AskUserQuestion entries', () => {
  test('one PostToolUse entry, matcher AskUserQuestion, runs lead-relay answer', () => {
    assert.deepEqual(Object.keys(cfg.hooks.PostToolUse ?? {}).length, 1, 'exactly one PostToolUse entry');
    const [e] = cfg.hooks.PostToolUse;
    assert.equal(e.matcher, 'AskUserQuestion');
    assert.equal(e.hooks.length, 1);
    assert.equal(e.hooks[0].type, 'command');
    assert.equal(e.hooks[0].command, cmd('lead-relay', 'answer'));
  });

  test('one PreToolUse entry, matcher AskUserQuestion, runs lead-relay preset with onFailure block', () => {
    const hits = entriesRunning('PreToolUse', 'lead-relay', 'preset');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].matcher, 'AskUserQuestion');
    assert.equal(hits[0].hooks.length, 1);
    assert.equal(hits[0].hooks[0].onFailure, 'block');
  });

  test('the PreToolUse guard host entry is still there with onFailure block', () => {
    const hits = entriesRunning('PreToolUse', 'hook-host');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hooks[0].onFailure, 'block');
  });
});

describe('lead-handoff v3.0: measure on SubagentStop', () => {
  test('one SubagentStop entry runs lead-handover measure', () => {
    const hits = entriesRunning('SubagentStop', 'lead-handover', 'measure');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hooks.length, 1);
  });

  test('the Stop measure entry stays (main peak) and step-times and the host stay on SubagentStop', () => {
    assert.equal(entriesRunning('Stop', 'lead-handover', 'measure').length, 1);
    assert.equal(entriesRunning('SubagentStop', 'step-times', 'stop').length, 1);
    assert.equal(entriesRunning('SubagentStop', 'hook-host').length, 1);
  });

  test('no hook runs the turn or resume adapter and UserPromptSubmit is gone', () => {
    const all = Object.values(cfg.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(all.length > 0);
    for (const c of all) assert.ok(!/lead-handover\.mjs"? (turn|resume)\b/.test(c), c);
    assert.ok(!('UserPromptSubmit' in cfg.hooks));
    assert.ok(!(cfg.hooks.SessionStart ?? []).some((e) => e.matcher === 'compact'));
  });
});

describe('pins', () => {
  test('hook-pins check on the plugin root exits 0 (pins match the wired files after T12)', async () => {
    const { main } = await import('../../scripts/hook-pins.mjs');
    const r = main(['check', '--root', repo]);
    assert.equal(typeof r, 'object');
    assert.equal(r.code, 0, JSON.stringify(r));
  });
});
