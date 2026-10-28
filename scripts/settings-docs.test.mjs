// Drift between the settings defaults in settings.mjs and the prose that tells the Lead what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BRAINSTORM_DEFAULTS, GATE_DEFAULTS, GATES, LANES, MODS, MODS_DEFAULTS, PIPELINE_DEFAULTS, SKILLSPECTOR_DEFAULTS } from './settings.mjs';

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

test('pipeline dispatches in parallel, capped, and lets sequential override the cap', () => {
  assert.equal(PIPELINE_DEFAULTS.dispatch, 'parallel');
  assert.match(pipeline, /\*\*Parallel, capped\.\*\*/);
  assert.match(pipeline, /pipeline\.dispatch.*sequential/);
});

test('every lane key appears in a Playbook', () => {
  const skills = fs.readdirSync(path.join(root, 'skills'))
    .map(d => path.join(root, 'skills', d, 'SKILL.md'))
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8'))
    .filter(t => /^argument-hint:[ \t]*\S/m.test(t));
  for (const key of LANES)
    assert.ok(skills.some(t => t.includes(`lanes.${key}\``)), `no Playbook mentions \`lanes.${key}\``);
});

test('dispatch-prompt is v3.2 or later and lists Name:, Settings: and Context cap:', () => {
  const doc = read('docs/contracts/dispatch-prompt.md');
  assert.match(doc, /^# Contract: dispatch-prompt v3\.(?:[2-9]|\d{2,})$/m);
  assert.match(doc, /`Context cap: <cap> handover <n>`/);
  assert.match(doc, /`Name: <name>`/);
  assert.match(doc, /`Settings: model=<m> effort=<e>(?:\[ floor\])?`/);
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

test('aico-settings v1.3 or later keeps the v1.1 cap range, the brainstorm keys and their defaults', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.match(doc, /^# Contract: aico-settings v1\.(?:[3-9]|\d{2,})$/m);
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

test('aico-settings v1.3 or later names skillspector.mode, its default, the user-level lock and refusal text', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.deepEqual(SKILLSPECTOR_DEFAULTS, { mode: 'no-llm' });
  assert.match(doc, /^# Contract: aico-settings v1\.(?:[3-9]|\d{2,})$/m);
  assert.match(doc, /`skillspector\.mode` \| `no-llm \\| claude_cli`; default `no-llm`; `claude_cli` user level only/);
  assert.match(doc, /\*the scan's data switch is user-level only\.\*/);
  assert.match(doc, /skillspector\.mode: claude_cli from project needs the user level/);
  assert.match(doc, /refused: skillspector\.mode must be no-llm or claude_cli/);
  assert.match(doc, /skillspector\.<key>: unknown key/);
  assert.match(doc, /`SKILLSPECTOR_DEFAULTS` \(v1\.2\)/);
});

test('user docs describe the Personality tab, the Plan Gates and the Legal disclaimer', () => {
  const concepts = read('documentation/concepts.md');
  const commands = read('documentation/commands.md');
  const readme = read('README.md');
  assert.match(concepts, /It has seven tabs, in this order/);
  assert.match(concepts, /\*\*Personality\*\* — one collapsible card per Role/);
  assert.match(concepts, /Filter Roles/);
  assert.match(commands, /on the Personality tab/);
  assert.match(readme, /Personality \(one collapsible card per Role/);
  for (const t of ['concepts.md', 'commands.md'])
    assert.ok(!/Personality\*\* section has one collapsible card/.test(read('documentation/' + t)), t);
  const section = (name) => commands.split(new RegExp('^### `/aico:' + name + '`', 'm'))[1].split(/^### /m)[0];
  for (const p of ['report', 'campaign', 'content']) assert.match(section(p), /Plan Gate/, p);
  assert.match(concepts, /not legal advice or a compliance certificate/);
  assert.match(readme, /not legal advice or a compliance certificate/);
  assert.match(concepts, /deepfake: yes/);
  assert.match(commands, /Directive \(EU\) 2024\/825/);
  assert.match(concepts, /`--json`/);
});

test('aico-settings v1.3 names the personality payload, the phrases, the ignored rule and the page text sources', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.match(doc, /`personalities: \{ rule: \{ text_re, flags, max, levels, phrases \}, roles: /);
  assert.match(doc, /`PERSONALITY_PHRASES` is a frozen/);
  assert.match(doc, /Untouched ignored values stay out of a Save/);
  assert.match(doc, /`roles\.<role>\.personality\.<temperament\\\|talk\\\|topic>`/);
  const page = read('scripts/settings-page.html');
  assert.ok(page.includes("'Personality'"), 'the page has the Personality section');
});

test('aico-settings v1.7 names pipeline.parallel_cap, its range, default, refusal, page hint and pipeline use', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.match(doc, /^# Contract: aico-settings v1\.(?:[7-9]|\d{2,})$/m);
  assert.equal(PIPELINE_DEFAULTS.parallel_cap, 4);
  assert.match(doc, /\| `pipeline\.parallel_cap` \| integer 3-5; default 4 \(v1\.7\) \|/);
  assert.match(doc, /refused: pipeline\.parallel_cap must be a whole number from 3 to 5, nothing written \(v1\.7\)/);
  assert.match(doc, /pipeline: \{fix_rounds, dispatch, parallel_cap, short_path, context_cap, review_format, lanes\}/);
  assert.match(doc, /"Parallel cap: at most this many Steps run at once \(builders, reviewers, QA and security\)\. Plan tasks with no parallel mark, or that share a file with an earlier task, still wait their turn\. Ignored when Dispatch is sequential\."/);
  assert.match(doc, /`pipeline\.dispatch: sequential` overrides it with 1\. Absent or invalid → 4\./);
});

test('aico-settings v1.8 names pipeline.short_path, off wins, the refusal, the page hint and the pipeline use', () => {
  const doc = read('docs/contracts/aico-settings.md');
  assert.match(doc, /^# Contract: aico-settings v1\.(?:[8-9]|\d{2,})$/m);
  assert.equal(PIPELINE_DEFAULTS.short_path, 'on');
  assert.match(doc, /\| `pipeline\.short_path` \| on \\\| off; default on; off wins \(v1\.8\) \|/);
  assert.match(doc, /refused: pipeline\.short_path must be on or off/);
  assert.match(doc, /pipeline\.short_path: a project can only turn the short path off/);
  assert.match(doc, /"Short path: a feature you approve as low risk at the Brief Gate skips the persona, security, compliance and hands-on lanes and the ruleset research; a fix triaged as low risk skips the security lane\. Every Gate and every test stays, and the run goes back to the full route when it touches a risky file\. Off: low-risk runs take the full route\. A project setting can only turn it off\."/);
  assert.match(doc, /Absent, invalid or no `get` JSON → `off`\./);
  assert.match(doc, /"short path off"/);
  assert.ok(!doc.includes('\r'), 'LF only');
});
