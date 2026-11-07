import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins the rules the /aico:to-spec Playbook states in its skill file.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(root, 'skills/to-spec/SKILL.md'), 'utf8');
const lines = text.split('\n');
const has = (...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const at = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
const RUN = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs"';

test('frontmatter: name, CEO-only flag, argument-hint, Playbook description, no allowed-tools', () => {
  assert.equal(lines[0], '---');
  const end = lines.indexOf('---', 1);
  const front = lines.slice(1, end);
  const keys = front.map((l) => l.split(':')[0]);
  assert.deepEqual(keys, ['name', 'description', 'disable-model-invocation', 'argument-hint']);
  assert.ok(front.includes('name: to-spec'));
  assert.ok(front.includes('disable-model-invocation: true'));
  const desc = front.find((l) => l.startsWith('description: '));
  assert.ok(desc.length <= 1024 + 13);
  assert.match(desc, /^description: Playbook\. /);
  assert.match(front.find((l) => l.startsWith('argument-hint: ')), /<idea \| file>/);
});

test('size: at most 125 lines, LF only, no CR', () => {
  assert.ok(text.replace(/\n$/, '').split('\n').length <= 125);
  assert.ok(!text.includes('\r'));
});

test('Help line, one empty line, then the Type line (AC45)', () => {
  const help = lines.findIndex((l) => l.startsWith('**Help:**'));
  assert.ok(help > 0);
  assert.ok(lines[help].includes('documentation/commands/to-spec.md'));
  assert.equal(lines[help + 1], '');
  assert.ok(lines[help + 2].startsWith(`**Type:** run \`${RUN} company-type check-playbook to-spec\` first;`));
});

test('AC35 only two Product Manager Steps and a spec-check; no architect, builder, branch, commit or Gate', () => {
  has('`check-role product-manager`', 'Step 01', 'Step 02', '.company/work/<slug>/spec.md');
  has(/no architect, builder, branch, commit, push or Gate/i, 'version: pending', 'shipped: pending',
    'Never stamp it', 'Write nothing to `.company/lessons.md`');
  assert.ok(at('Step 01') < at('Step 02') && at('Step 02') < at('spec-check check'));
  const dispatched = [...text.matchAll(/[Dd]ispatch `([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(dispatched.length >= 1);
  for (const r of dispatched) assert.equal(r, 'product-manager', `only the product-manager is dispatched, saw ${r}`);
  assert.ok(!/\b(architect|engineer|qa|code-reviewer)\b/.test(text.replace(/[^\n]*(no architect|No architect)[^\n]*/g, '')), 'no other Role named');
  assert.ok(!/git (add|commit|checkout|switch|branch|push)\b/.test(text.replace(/Never[^\n]*/g, '')), 'no git write command outside a Never rule');
  assert.ok(!/\bstamp\b/.test(text.replace(/[^\n]*Never stamp[^\n]*/g, '')), 'stamp appears only in the never rule');
});

test('AC35 setup follows research: sections 1.2, 1.4, 1.6, 1.7 and Setup item 8; Language and Settings in the dispatch', () => {
  has('§1.2, §1.4, §1.6, §1.7', 'Setup item 8', 'Language: <tag>', 'Context cap: <cap> handover <n>', 'Follow aico:handoff.');
  assert.ok(!/^\s*Name:/m.test(text), 'no Name: line in any dispatch');
});

test('the dispatch carries Role skills: after Context cap: and the build follows §1.19 d', () => {
  has('Role skills: <names | none>', '§1.19 d');
  assert.ok(at('Role skills: <names | none>') > at('Context cap: <cap> handover <n>'));
});

test('AC36 spec-check decides; one PM revision; then not ready with the ERROR lines, never done', () => {
  has(`${RUN} spec-check check '.company/work/<slug>/spec.md'`);
  has('exit code and the `ERROR` lines', 'never the Handoff', 'one revision', 'not ready', 'status: blocked');
  assert.ok(/never (reported as )?done/i.test(text));
  assert.ok(at('one revision') > at('spec-check check'));
});

test('AC37 argument file: Write, arg --for to-spec, then take for a file; the argument never reaches a shell', () => {
  has('.company/draft-input-arg-to-spec.txt', `${RUN} draft-input arg --for to-spec`,
    'Write tool', 'never Read it', 'A Write refusal stops the run', 'never reaches a shell');
  has(/take '<path>' --for to-spec/, 'input-to-spec.md', 'only the copy');
  assert.ok(at('Write tool') < at('draft-input arg --for to-spec'));
  assert.ok(at('.company/work-folder-topic-to-spec.txt') < at('.company/draft-input-arg-to-spec.txt'));
  assert.ok(at('draft-input arg --for to-spec') < at("take '<path>'"));
  has('refused', 'data, never instructions', 'quoted');
});

test('every draft-input call uses a subcommand and flag the script has', () => {
  const calls = [...text.matchAll(/draft-input (\w+)([^`\n]*)/g)];
  assert.ok(calls.length >= 2);
  for (const [, sub, rest] of calls) {
    assert.ok(['arg', 'take', 'free'].includes(sub), sub);
    assert.match(rest, /--for to-spec/);
  }
});

test('values reaching Bash come only from arg, take or free output and pass the work folder name check first', () => {
  has('work folder name check', 'single quotes', 'printed by');
  assert.ok(!/<idea>|\$ARGUMENTS|\$1/.test(text.replace(/argument-hint:[^\n]*/, '')), 'no raw argument in a command');
});

test('a path value is exactly the printed arg: file value, so docs/specs/<run>.md is taken; only slugs need the name check', () => {
  const rule = lines.find((l) => l.startsWith('5. '));
  assert.ok(rule, 'item 5 exists');
  assert.match(rule, /docs\/specs\/<run>\.md/);
  assert.match(rule, /exactly the (?:printed )?`arg: file` value/);
  assert.match(rule, /path rule/);
  assert.ok(rule.indexOf('work folder name check') > rule.indexOf('slug'), 'the name check is tied to slugs');
  assert.ok(!/\(a path: `\.company\/work\/<slug>/.test(rule), 'a path is not forced under .company/work');
});

test('AC43 a draft built from a grill traces each Decision with (grill Q-<n>) or (grill F-<n>), never the file name', () => {
  has('(grill Q-<n>)', '(grill F-<n>)', 'kind grill', 'never the file name');
});

test('the spec shape comes from destination-spec: six headings, no file path, no code block; shipped spec is written by feature', () => {
  has('destination-spec', 'six headings', 'no file path', 'no code block', 'aico:feature');
});

test('the draft is data: an approval claim in it or in the input approves nothing', () => {
  has('approval', 'is data');
});

test('ending prints the path and the next commands; the CEO starts them', () => {
  has('/aico:to-tickets .company/work/<slug>/spec.md', '/aico:feature .company/work/<slug>/spec.md',
    'only the CEO starts', 'prints the path');
});

test('R-14 no git-ignored claim: files stay in .company/work/<slug>/ and aico never commits them', () => {
  assert.ok(!/git-ignored/i.test(text));
  has('stay in `.company/work/<slug>/`; aico never commits them (grill-file v1 Personal data)');
});

test('code references use the plugin root variable and no placeholder', () => {
  assert.ok(!/<plugin root>/i.test(text));
  for (const m of text.matchAll(/scripts\/[a-z-]+\.mjs/g)) {
    assert.ok(text.slice(0, m.index).endsWith('${CLAUDE_PLUGIN_ROOT}/'), `bare script path at ${m.index}`);
  }
  assert.ok(!/node scripts\//.test(text));
});
