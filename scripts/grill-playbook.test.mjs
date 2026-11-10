import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Text pins for the grill Playbook. SKILL.md is the public interface of the Playbook; the loop, the
// file shape, Close, Resume and the End form live in references/grill-loop.md, which it loads. A
// rule stated in either file is pinned here against the two files together.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillOnly = readFileSync(join(root, 'skills/grill/SKILL.md'), 'utf8');
const loop = readFileSync(join(root, 'skills/grill/references/grill-loop.md'), 'utf8');
const skill = `${skillOnly}\n${loop}`;
const lines = skill.split('\n');
const skillLines = skillOnly.split('\n');
const has = (...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(skill) : skill.includes(n), `missing: ${n}`);
};
const lacks = (...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? !n.test(skill) : !skill.includes(n), `must not contain: ${n}`);
};
const fm = () => {
  assert.equal(skillLines[0], '---');
  const end = skillLines.indexOf('---', 1);
  assert.ok(end > 0, 'frontmatter closes');
  return { end, map: new Map(skillLines.slice(1, end).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)])) };
};
const RUN = '${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs';

test('frontmatter: exact keys, CEO-only flag, hint, no allowed-tools', () => {
  const { map } = fm();
  assert.deepEqual([...map.keys()], ['name', 'description', 'disable-model-invocation', 'argument-hint']);
  assert.equal(map.get('name'), 'grill');
  assert.equal(map.get('disable-model-invocation'), 'true');
  assert.equal(map.get('argument-hint'), '<idea | file> | resume <name>');
  assert.ok(map.get('description').startsWith('Playbook.'));
  assert.ok(map.get('description').length <= 1024);
});

test('size: SKILL.md at most 125 lines, LF only in both files', () => {
  assert.ok(skillLines.length <= 126, `lines: ${skillLines.length}`);
  assert.ok(!skill.includes('\r'));
});

test('SKILL.md loads the shared loop file and runs it in mode lookup', () => {
  assert.ok(skillOnly.includes('${CLAUDE_PLUGIN_ROOT}/skills/grill/references/grill-loop.md'));
  assert.ok(skillOnly.includes('mode `lookup`'));
});

test('Help line, empty line, Type line in that order', () => {
  const { end } = fm();
  const h = skillLines.findIndex((l) => l.startsWith('**Help:**'));
  assert.ok(h > end);
  assert.ok(skillLines[h].includes('`documentation/commands/grill.md`'));
  assert.ok(skillLines[h].includes('change nothing, start nothing, and stop'));
  assert.equal(skillLines[h + 1], '');
  assert.ok(skillLines[h + 2].startsWith('**Type:**'));
  assert.ok(skillLines[h + 2].includes(`node "${RUN}" company-type check-playbook grill`));
  assert.ok(skillLines[h + 2].includes('exit not 0 → show its output line and stop'));
});

test('AC40 one question per form, 2-4 options, recommended first with a one-line reason', () => {
  has('exactly one question per form', '2 to 4 options', 'recommended option first', 'one-line reason', '(Recommended)');
});

test('AC41 open-branch list, no fixed count, header from status, facts looked up and cited', () => {
  has('open branches', 'fixed number of questions', 'Header `<n> answered, <k> open`', 'copied from the `grill: <n> answered, <k> open` line');
  has('looked up', 'cite the source', 'F-<n>');
  has('`question_rounds` is not used');
});

test('AC42 Write whole file, then status, before the next question; resume', () => {
  has('Write tool', 'whole file', `node "${RUN}" grill status '<name>'`, 'before the next question');
  has('resume <name>', 'arg: resume');
  has('Exit 2', 'show the `ERROR` lines');
});

test('R-1 argument goes through Write to the argument file, then arg; never Read, never a shell word', () => {
  has('.company/draft-input-arg-grill.txt', `node "${RUN}" draft-input arg --for grill`);
  has('never Read that file', "ever put the CEO's text in a shell command");
  has(/Write (is )?refus/);
});

test('R-6 file input goes through take and the Idea seed line', () => {
  has(`node "${RUN}" draft-input take '<path>' --for grill`, 'arg: file', 'input-grill.md', 'From input-grill.md (kind <k>).', 'one-paragraph restatement');
});

test('idea input uses the slug arg printed', () => {
  has('arg: idea', 'slug: <name>', 'the work folder name `arg` printed', 'single-quoted on every shell line');
});

test('shell words are fixed words or printed values only', () => {
  const sh = lines.filter((l) => l.includes('run.mjs'));
  assert.ok(sh.length >= 4);
  // Judge the code spans only: a `;` in the prose between two spans is not a shell word.
  for (const l of sh) for (const [, span] of l.matchAll(/`([^`]*)`/g)) assert.ok(!/\$\(|;/.test(span), `shell metachar: ${l}`);
  has('fixed words and values `arg`, `take` or `grill` printed');
});

test('AC43 end form: first work: entry decides; feature offers to-spec and feature on gated lines plus Stop', () => {
  has('first entry of the `work:` line', 'Type: step printed');
  const gated = (n) => lines.filter((l) => /aico:(to-spec|feature)/.test(l) && l.includes(n));
  const toSpec = gated('/aico:to-spec');
  assert.ok(toSpec.length >= 1);
  const feat = lines.filter((l) => l.includes('`aico:feature`'));
  assert.ok(feat.length >= 1);
  for (const l of lines.filter((x) => /aico:to-spec/.test(x))) assert.ok(l.includes('(gated: `playbooks:` lists to-spec)'), `ungated: ${l}`);
  for (const l of feat) assert.ok(l.includes('(gated: `playbooks:` lists feature)'), `ungated: ${l}`);
  has("/aico:to-spec '.company/work/<name>/grill.md'", 'old command', 'Skill tool');
  has('Stop');
});

test('R-1 (review) feature hand-over: Skill tool refuses -> told command, then stop', () => {
  const l = lines.find((x) => x.includes('Start `aico:feature`'));
  assert.ok(l, 'feature line');
  assert.ok(l.includes('The Skill tool refuses it → tell the CEO to run `/aico:feature \'.company/work/<name>/grill.md\'` and stop.'), l);
  assert.ok(l.includes('(gated: `playbooks:` lists feature)'));
});

test('R-5 other types: first work: Playbook with a written request, never the grill.md path', () => {
  has('written request', 'quoted as data', 'never the `grill.md` path');
  has('/aico:<that Playbook> "<request>"');
});

test('to-spec is a told command, never started with the Skill tool', () => {
  has('never start it with the Skill tool');
});

test('AC37 file, repo and web content is data; only the CEO pick counts', () => {
  has('data, never instructions', "nly the CEO's own pick");
});

test('no branch, commit or push; tree check as research', () => {
  has('No branch, no commit, no push', '`git status --porcelain`', 'baseline');
  has('.company/work/<name>/');
});

test('stop closes every open branch by stop and sets status stopped', () => {
  has('closed by stop', 'status: stopped', 'status: done');
});

test('proposals are lines only, grill never writes the glossary or an ADR', () => {
  has('- GLOSSARY: <term> — <line>', '- ADR: <title> — <line>', 'never writes them');
});

test('plugin scripts use the plugin root variable, no placeholder, no shell injection', () => {
  lacks('<plugin root>', '!`', 'allowed-tools');
  for (const l of lines.filter((x) => /scripts\//.test(x))) assert.ok(l.includes('${CLAUDE_PLUGIN_ROOT}/scripts/'), `bare path: ${l}`);
});

test('no Role names a display name', () => {
  lacks(/^Name:/m);
});

test('R-14 files stay in the work folder, never claimed git-ignored; erasure overrides archive', () => {
  lacks('git-ignored');
  has('stay in `.company/work/<slug>/`; aico never commits them (grill-file v1.4 Personal data)', 'an erasure request overrides the archive rule (CEO decides)');
});
