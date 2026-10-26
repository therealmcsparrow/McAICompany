// Drift between the settings defaults in settings.mjs and the prose that tells the Lead what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LANES, PIPELINE_DEFAULTS } from './settings.mjs';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pipeline = read('skills/pipeline/SKILL.md');

test('PIPELINE_DEFAULTS.fix_rounds matches pipeline prose', () => {
  const n = PIPELINE_DEFAULTS.fix_rounds;
  const fixSection = pipeline.split('## 5. Fix rounds')[1].split('\n## ')[0];
  assert.ok(fixSection.includes(`(max ${n})`) || fixSection.includes(`at most ${n}`), fixSection);
  assert.ok(fixSection.includes('pipeline.fix_rounds'), 'section 5 reads the limit from settings');
});

test('pipeline says parallel by default', () => {
  assert.equal(PIPELINE_DEFAULTS.dispatch, 'parallel');
  assert.match(pipeline, /Parallel by default/);
  assert.match(pipeline, /pipeline\.dispatch.*sequential/);
});

test('every lane key appears in a Playbook', () => {
  const skills = fs.readdirSync(path.join(root, 'skills'))
    .map(d => path.join(root, 'skills', d, 'SKILL.md'))
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8'))
    .filter(t => /^disable-model-invocation:\s*true\s*$/m.test(t));
  for (const key of LANES)
    assert.ok(skills.some(t => t.includes(`lanes.${key}\``)), `no Playbook mentions \`lanes.${key}\``);
});

test('dispatch-prompt is v3 and lists Name: and Settings:', () => {
  const doc = read('docs/contracts/dispatch-prompt.md');
  assert.match(doc, /^# Contract: dispatch-prompt v3$/m);
  assert.match(doc, /`Name: <name>`/);
  assert.match(doc, /`Settings: model=<m> effort=<e>`/);
  assert.match(pipeline, /^Name: /m);
  assert.match(pipeline, /^Settings: /m);
});

test('handoff skill documents the By: line', () => {
  const doc = read('skills/handoff/SKILL.md');
  assert.match(doc, /By: <Name> \(<role>\)/);
});

test('cooler cues use names', () => {
  assert.ok(read('skills/cooler/SKILL.md').includes('<NAME> (<ROLE>)'));
});

test('roles.md lists every default name', () => {
  const names = JSON.parse(read('company/names.json'));
  const doc = read('documentation/roles.md');
  for (const [role, name] of Object.entries(names))
    assert.ok(doc.includes(`| ${name} |`), `roles.md lacks ${name} (${role})`);
});
