// Drift between the settings defaults in settings.mjs and the prose that tells the Lead what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BRAINSTORM_DEFAULTS, GATE_DEFAULTS, GATES, LANES, MODS, MODS_DEFAULTS, PIPELINE_DEFAULTS } from './settings.mjs';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pipeline = read('skills/pipeline/SKILL.md');

test('PIPELINE_DEFAULTS.fix_rounds matches pipeline prose', () => {
  const n = PIPELINE_DEFAULTS.fix_rounds;
  const fixSection = pipeline.split('## 5. Fix rounds')[1].split('\n## ')[0];
  assert.ok(fixSection.includes(`(max ${n})`) || fixSection.includes(`at most ${n}`), fixSection);
  assert.ok(fixSection.includes('pipeline.fix_rounds'), 'section 5 reads the limit from settings');
});

test('every Gate defaults to ask, as the pipeline prose says', () => {
  for (const gate of GATES) assert.equal(GATE_DEFAULTS[gate], 'ask', gate);
  assert.deepEqual(Object.keys(GATE_DEFAULTS).sort(), [...GATES].sort());
  assert.match(pipeline, /A Gate is never skipped/);
  assert.match(pipeline, /ask in a form \(Approve \/ Change \/ Stop\)/);
  assert.match(pipeline, /every Gate `ask`/);
});

test('feature Fix-round default matches PIPELINE_DEFAULTS.fix_rounds', () => {
  const m = /max `pipeline\.fix_rounds`, default (\d+)/.exec(read('skills/feature/SKILL.md'));
  assert.ok(m, 'feature Playbook names the Fix-round default');
  assert.equal(Number(m[1]), PIPELINE_DEFAULTS.fix_rounds);
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

test('dispatch-prompt is v3.1 and lists Name:, Settings: and Context cap:', () => {
  const doc = read('docs/contracts/dispatch-prompt.md');
  assert.match(doc, /^# Contract: dispatch-prompt v3\.1$/m);
  assert.match(doc, /`Context cap: <cap> handover <n>`/);
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

test('aico-settings v1.2 keeps the v1.1 cap range, the brainstorm keys and their defaults', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.match(doc, /^# Contract: aico-settings v1\.2$/m);
  assert.equal(PIPELINE_DEFAULTS.context_cap, 150000);
  assert.match(doc, /`pipeline\.context_cap` \| integer 60000–1000000; default 150000/);
  assert.match(doc, /`roles\.<role>\.context_cap` \| integer 60000–1000000/);
  assert.match(doc, /refused: context_cap must be a whole number from 60000 to 1000000/);
  assert.deepEqual(BRAINSTORM_DEFAULTS, { film_script: false, debate: 'crossfire' });
  assert.match(doc, /`brainstorm\.film_script` \| boolean; default `false`/);
  assert.match(doc, /`brainstorm\.debate` \| `crossfire \\| full_pass`; default `crossfire`/);
  assert.match(doc, /refused: brainstorm\.debate must be crossfire or full_pass/);
  assert.match(doc, /Plugin defaults include `context_cap` 150000, `review_format` `plain`, `film_script` false and `debate` `crossfire`/);
  assert.equal(PIPELINE_DEFAULTS.review_format, 'plain');
  assert.match(doc, /`pipeline\.review_format` \| `plain \\| pilot`; default `plain`/);
  assert.match(doc, /refused: pipeline\.review_format must be plain or pilot/);
});

test('aico-settings v1.1 names the mods keys, defaults, three locks and refusal text', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.deepEqual(MODS, ['savvy', 'cache_tax', 'reflect', 'blast_radius']);
  assert.deepEqual(MODS_DEFAULTS.blast_radius, { enabled: true, core: 'ask', contract: 'warn', security: 'ask' });
  assert.equal(MODS_DEFAULTS.reflect.mode, 'deterministic');
  assert.ok(Object.values(MODS_DEFAULTS).every((m) => m.enabled === true), 'all four mods on');
  assert.ok(!JSON.stringify(MODS_DEFAULTS).includes('keep_warm'));
  assert.match(doc, /Plugin defaults for Blast Radius \(CEO, part M\): `core: ask`, `contract: warn`, `security: ask`/);
  assert.match(doc, /`mods\.<savvy\\|cache_tax\\|reflect\\|blast_radius>\.enabled` \| boolean; default `true`/);
  assert.match(doc, /`mods\.reflect\.mode` \| `deterministic \\| model`; default `deterministic`; `model` user level only/);
  assert.match(doc, /`mods\.blast_radius\.<core\\|contract\\|security>` \| `ask \\| warn`; default `ask` for `core` and `security`, `warn` for `contract`/);
  assert.match(doc, /refused: mods\.<path> must be <allowed values>/);
  assert.match(doc, /\*The spend switch is user-level only\.\*/);
  assert.match(doc, /\*The commit gate only tightens from a project\.\*/);
  assert.match(doc, /\*Security stays asked unless unlocked\.\*/);
  assert.ok(!/^\| `mods\..*keep/m.test(doc), 'no keep-warm row in the Contract schema');
});
