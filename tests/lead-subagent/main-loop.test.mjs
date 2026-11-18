// T13 (AC1, AC8, AC9): QA tests for T14. Red until T14 writes the Playbook head line,
// skills/lead/references/main-loop.md and the maintain/feedback form split.
// Pins lead-relay v1 (Rules, STATUS block, Start prompt) and the Playbook head line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const HEAD = '**Runs in:** the Lead agent `aico:project-manager`. In the main session, run none of the steps below: follow `aico:lead` `references/main-loop.md`, which spawns the Lead with `aico start: <playbook>` and `Request:`.';
const playbooks = () => readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(root, 'skills', d.name, 'SKILL.md')))
  .map(d => `skills/${d.name}/SKILL.md`)
  .filter(p => /^description:\s*"?aico Playbook\./m.test(read(p).split('\n---')[0]));
const afterHeading = text => {
  const lines = text.split('\n');
  const i = lines.findIndex(l => /^# /.test(l));
  if (i < 0) return null;
  return lines.slice(i + 1).find(l => l.trim() !== '') ?? null;
};
const MAIN_LOOP = 'skills/lead/references/main-loop.md';
const loop = () => { assert.ok(existsSync(join(root, MAIN_LOOP)), `${MAIN_LOOP} exists`); return read(MAIN_LOOP); };

test('AC1: the scan finds the Playbooks (24 today, standards included)', () => {
  const p = playbooks();
  assert.ok(p.length >= 24, `found ${p.length}`);
  assert.ok(p.includes('skills/standards/SKILL.md'));
});

test('AC1: every aico Playbook SKILL.md head line is byte-equal to the Decided text', () => {
  const bad = playbooks().filter(p => afterHeading(read(p)) !== HEAD);
  assert.deepEqual(bad, [], 'Playbooks without the head line right after the # heading');
});

test('AC8: main-loop.md names each STATUS branch', () => {
  const t = loop();
  for (const s of ['needs-ceo', 'handover', 'done', 'blocked']) assert.ok(t.includes(s), `branch ${s}`);
  assert.ok(t.includes('STATUS'));
  assert.ok(t.includes('no STATUS line'), 'missing line 1 is blocked');
});

test('AC8: main-loop.md has the fixed start and resume prompts', () => {
  const t = loop();
  assert.ok(t.includes('aico start: <playbook>'));
  assert.ok(t.includes('Request:'));
  for (const k of ['handover', 'answer', 'retry']) assert.ok(t.includes(`aico resume: <slug> (${k}`) || /aico resume: <slug> \(<handover\|answer\|retry>\)/.test(t), `resume ${k}`);
  assert.ok(t.includes('lead-resume.md'), 'boot reference');
});

test('AC8: main-loop.md allows one retry only', () => {
  const t = loop();
  assert.ok(/one\s+`?retry`?/i.test(t), 'one retry');
});

test('AC8: main-loop.md declined-form branch: no respawn, fixed line', () => {
  const t = loop();
  assert.ok(t.includes('aico: run <slug> waits on form <id>; say resume to be asked again'));
  assert.ok(/(no|never|not)[^.\n]{0,40}(respawn|spawn)/i.test(t), 'no respawn on decline');
  assert.ok(t.includes('lead-relay'), 'cites lead-relay');
});

test('AC8: main-loop.md maps (multi) to multiSelect: true and spawns the Lead in the foreground', () => {
  const t = loop();
  assert.ok(t.includes('(multi)'));
  assert.ok(t.includes('multiSelect: true'));
  assert.ok(/foreground/i.test(t));
  assert.ok(/run_in_background/.test(t) || /never[^.\n]*background/i.test(t), 'no background spawn');
});

for (const name of ['maintain', 'feedback']) {
  const f = `skills/${name}/SKILL.md`;
  test(`AC9: ${name} Gate lines hold no multiSelect`, () => {
    const gates = read(f).split('\n').filter(l => /Gate/.test(l) && !/^\s*$/.test(l));
    assert.ok(gates.some(l => /Brief Gate/.test(l)), 'has a Brief Gate line');
    assert.deepEqual(gates.filter(l => /multiSelect/.test(l)), []);
  });
  test(`AC9: ${name} asks the picks first as an ask form, then the Brief Gate single-select gate:brief`, () => {
    const t = read(f);
    const ask = t.search(/`ask` form/);
    const gate = t.search(/`gate:brief`/);
    assert.ok(ask >= 0, 'names the `ask` form');
    assert.ok(gate >= 0, 'names `gate:brief`');
    assert.ok(ask < gate, 'picks come before the Brief Gate');
    assert.ok(/single-select/.test(t), 'Brief Gate is single-select');
    assert.ok(t.includes('lead-relay'), 'cites lead-relay');
  });
}
